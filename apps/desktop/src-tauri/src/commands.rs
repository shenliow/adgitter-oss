//! Tauri IPC commands.
//!
//! Each #[tauri::command] is exposed to the JS side via `invoke(name, args)`.
//! Keep these thin: validate inputs, delegate to a domain module, return.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, State};

use git_core::{
    self as git, AdgitterError, AdgitterResult, Backup, CommitPage, FileDiff, RebaseStep,
    RepoStatus,
};

use crate::watch::{self, WatchState};

/// Health-check command. Used by the frontend on mount to verify IPC works.
#[tauri::command]
pub fn ping() -> &'static str {
    "pong"
}

/// Live hardware modifier-key state, as reported by `modifier_flags` below.
#[derive(serde::Serialize)]
pub struct ModifierFlags {
    pub shift: bool,
    pub alt: bool,
    pub meta: bool,
    pub ctrl: bool,
}

/// Poll the OS for the modifier keys held *right now* (the gesture grammar:
/// Shift = rebase, Alt = cherry-pick, Shift/Cmd = reset mode).
///
/// This exists because macOS WKWebView delivers **no keyboard events to the
/// page at all** for the entire duration of a native HTML5 drag session — no
/// keydown, no keyup — so a modifier pressed or released mid-drag is
/// otherwise invisible to the frontend (see MetroGraph.svelte's "WKWebView
/// modifier workaround" for the full picture, including the pre-drag
/// tracking this backs up). The frontend polls this command every ~80ms
/// while a drag is in progress and treats the hardware state as
/// authoritative — replacing, not merging into, its keyboard-tracked
/// snapshot — which also recovers from keyups that were swallowed mid-drag.
///
/// On every other platform Chromium/WebView2 populate `DragEvent`'s own
/// `shiftKey`/`altKey`/`metaKey`/`ctrlKey` correctly, so there is nothing to
/// poll: this returns `None` and the frontend stops polling.
#[tauri::command]
pub fn modifier_flags() -> Option<ModifierFlags> {
    #[cfg(target_os = "macos")]
    {
        Some(macos_modifiers::current())
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

/// Reads the live hardware modifier state via `CGEventSourceFlagsState`,
/// which — unlike `NSEvent.modifierFlags` or any event-delivery-based API —
/// queries the window server directly and stays accurate even when the page
/// (and even AppKit's own event queue, since a drag session runs its own
/// runloop mode) is receiving no key events whatsoever. Kept dependency-free:
/// a raw `extern "C"` binding to the CoreGraphics framework rather than a
/// crate, since this is the only native call the desktop app needs.
#[cfg(target_os = "macos")]
mod macos_modifiers {
    use super::ModifierFlags;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceFlagsState(state_id: i32) -> u64;
    }

    /// `kCGEventSourceStateHIDSystemState` — the PHYSICAL keyboard state as
    /// seen by the HID system. Deliberately NOT the combined-session state
    /// (`kCGEventSourceStateCombinedSessionState` = 0): that one ORs in
    /// synthetic modifier events posted by ANY process in the login session
    /// (IMEs, key remappers, automation tools), and a latched synthetic
    /// Shift once made a real user's plain drag resolve as rebase. The
    /// gesture grammar wants exactly what the user's fingers are doing, so
    /// query the hardware state only.
    const HID_SYSTEM_STATE: i32 = 1;
    pub(super) const SHIFT_MASK: u64 = 0x0002_0000;
    pub(super) const CTRL_MASK: u64 = 0x0004_0000;
    pub(super) const ALT_MASK: u64 = 0x0008_0000;
    pub(super) const CMD_MASK: u64 = 0x0010_0000;

    pub(super) fn from_flags(flags: u64) -> ModifierFlags {
        ModifierFlags {
            shift: flags & SHIFT_MASK != 0,
            alt: flags & ALT_MASK != 0,
            meta: flags & CMD_MASK != 0,
            ctrl: flags & CTRL_MASK != 0,
        }
    }

    pub fn current() -> ModifierFlags {
        // SAFETY: CGEventSourceFlagsState takes a plain integer state id and
        // returns a plain integer bitmask — no pointers, no aliasing, no
        // preconditions beyond the CoreGraphics framework being linked (it
        // always is, transitively, on macOS). Safe to call from any thread.
        let flags = unsafe { CGEventSourceFlagsState(HID_SYSTEM_STATE) };
        from_flags(flags)
    }
}

#[cfg(all(test, target_os = "macos"))]
mod macos_modifiers_tests {
    use super::macos_modifiers::{from_flags, ALT_MASK, CMD_MASK, CTRL_MASK, SHIFT_MASK};

    #[test]
    fn decodes_the_hardware_modifier_bitmask() {
        // Querying CGEventSourceFlagsState needs an interactive WindowServer
        // session and can block a headless test runner. Test the pure decode
        // here; `current` is intentionally only the thin FFI read above it.
        let flags = from_flags(SHIFT_MASK | ALT_MASK | CMD_MASK | CTRL_MASK);
        assert!(flags.shift);
        assert!(flags.alt);
        assert!(flags.meta);
        assert!(flags.ctrl);

        let empty = from_flags(0);
        assert!(!empty.shift);
        assert!(!empty.alt);
        assert!(!empty.meta);
        assert!(!empty.ctrl);
    }
}

/// Toggle consent-gated crash reporting. Called by the WebView whenever ad/
/// telemetry consent changes. Returns whether a Sentry DSN is compiled in (the
/// UI can reflect availability). The DSN is injected at build time via the
/// `SENTRY_DSN` env var and is never committed; with it absent this is inert.
#[tauri::command]
pub fn init_crash_reporting(enabled: bool) -> bool {
    let dsn = option_env!("SENTRY_DSN");
    if enabled {
        telemetry::enable_reporting(dsn);
    } else {
        telemetry::disable_reporting();
    }
    dsn.is_some()
}

/// Forward a frontend (WebView) error to the same Sentry project. The message is
/// re-scrubbed in the sink; sending is gated by the consent flag set above.
#[tauri::command]
pub fn report_event(error_code: String, message: String) {
    telemetry::report(&error_code, &message);
}

/// DEBUG-ONLY smoke test: deliberately panic on a worker thread so the global
/// panic hook captures a scrubbed `PANIC` packet and (with consent + a DSN)
/// flushes it to Sentry — proving the backend crash pipeline end to end. The
/// panic is isolated in `spawn_blocking` so it never poisons the event loop; the
/// `JoinError` surfaces to JS as `INTERNAL_ERROR`. Compiled inert in release so
/// it can never be a shipped backdoor.
#[tauri::command]
pub async fn debug_trigger_crash() -> AdgitterResult<()> {
    #[cfg(debug_assertions)]
    {
        tauri::async_runtime::spawn_blocking(|| {
            panic!("debug_trigger_crash: intentional Sentry pipeline smoke test");
        })
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?;
        Ok(())
    }
    #[cfg(not(debug_assertions))]
    {
        Err(AdgitterError::Internal(
            "debug_trigger_crash is disabled in release builds".into(),
        ))
    }
}

/// Open `url` in the user's default system browser (desktop OAuth — login
/// happens in the real browser, never embedded in the WebView). Restricted to
/// `https://` so it can't be used to launch arbitrary schemes or local files.
#[tauri::command]
pub fn open_external_url(url: String) -> AdgitterResult<()> {
    if !url.starts_with("https://") {
        return Err(AdgitterError::Internal(
            "refusing to open a non-https url".into(),
        ));
    }
    opener::open(&url).map_err(|e| AdgitterError::Internal(e.to_string()))
}

/// Resolve `rel` (a repo-relative path supplied by the frontend) against
/// `repo_path`, refusing anything that escapes the repository.
///
/// Split out from [`open_path`] so the guard is unit-testable without launching
/// a real application. Both sides are canonicalized before the containment
/// check, so `../` traversal, an absolute path, and a symlink pointing out of
/// the tree are all rejected rather than handed to the OS opener.
fn resolve_in_repo(repo_path: &Path, rel: &str) -> AdgitterResult<PathBuf> {
    let root = std::fs::canonicalize(repo_path)
        .map_err(|e| AdgitterError::Internal(format!("cannot resolve repository path: {e}")))?;
    let target = std::fs::canonicalize(root.join(rel))
        .map_err(|_| AdgitterError::Internal(format!("file not found: {rel}")))?;
    if !target.starts_with(&root) {
        return Err(AdgitterError::Internal(
            "refusing to open a path outside the repository".into(),
        ));
    }
    Ok(target)
}

/// Open a working-tree file in the user's default application for its type.
#[tauri::command]
pub fn open_path(repo_path: String, path: String) -> AdgitterResult<()> {
    let target = resolve_in_repo(Path::new(&repo_path), &path)?;
    opener::open(&target).map_err(|e| AdgitterError::Internal(e.to_string()))
}

// ── Project settings (frontend-owned schema) ────────────────────────────────
//
// Per-repository project settings (branch colours, issue-branch bindings, etc.)
// live at `<repo_root>/adgitter.config.json` — a plain file in the working
// tree, so users may choose to commit it. The backend treats the content as
// opaque JSON: it only validates shape/size and handles the read/write
// plumbing; the frontend owns the schema.

/// Filename for the per-repository project settings file, always resolved
/// directly under the repository's working-directory root. The frontend never
/// gets to name an arbitrary path — only `repo_path` is accepted, exactly
/// mirroring the discovery `open_repo` uses elsewhere in this codebase
/// (`Repository::discover`, walking up from any directory inside the working
/// copy), plus pinning the result to that repo's root.
const PROJECT_CONFIG_FILENAME: &str = "adgitter.config.json";

/// Refuse to read or write a config file bigger than this — defence against a
/// giant or hostile file at this well-known path.
const PROJECT_CONFIG_MAX_BYTES: u64 = 256 * 1024;

/// Resolve `repo_path` to `<repo_root>/adgitter.config.json`. Canonicalizes
/// `repo_path`, verifies it is (or sits inside) a real repository, then
/// canonicalizes the repo's working-directory root before joining the fixed
/// filename — so the result can never be influenced by anything other than
/// which repository `repo_path` resolves to.
fn project_config_path(repo_path: &Path) -> AdgitterResult<PathBuf> {
    let start = std::fs::canonicalize(repo_path)
        .map_err(|_| AdgitterError::RepoNotFound(repo_path.display().to_string()))?;
    let repo = git2::Repository::discover(&start)
        .map_err(|_| AdgitterError::RepoNotFound(repo_path.display().to_string()))?;
    let workdir = repo.workdir().ok_or_else(|| {
        AdgitterError::InvalidPath(format!(
            "{} is a bare repository (no working directory)",
            repo_path.display()
        ))
    })?;
    let root = std::fs::canonicalize(workdir)
        .map_err(|e| AdgitterError::Internal(format!("cannot resolve repository root: {e}")))?;
    Ok(root.join(PROJECT_CONFIG_FILENAME))
}

/// Validate `content` for [`write_project_config`]: under the size cap, valid
/// JSON, and a top-level object. Returns the pretty-printed form to write, so
/// the file on disk always diffs well under version control regardless of how
/// the frontend serialized it.
fn validate_project_config_content(content: &str) -> AdgitterResult<String> {
    if content.len() as u64 > PROJECT_CONFIG_MAX_BYTES {
        return Err(AdgitterError::Internal(format!(
            "adgitter.config.json content is too large ({} bytes, max {})",
            content.len(),
            PROJECT_CONFIG_MAX_BYTES
        )));
    }
    let value: serde_json::Value = serde_json::from_str(content).map_err(|e| {
        AdgitterError::Internal(format!("adgitter.config.json is not valid JSON: {e}"))
    })?;
    if !value.is_object() {
        return Err(AdgitterError::Internal(
            "adgitter.config.json must be a JSON object at the top level".to_string(),
        ));
    }
    serde_json::to_string_pretty(&value)
        .map_err(|e| AdgitterError::Internal(format!("failed to format adgitter.config.json: {e}")))
}

/// Infix of a [`write_atomically`] temp file: `<target>.tmp.<pid>.<seq>`.
const TMP_INFIX: &str = ".tmp.";

/// How long a temp file belonging to *another* process must have sat untouched
/// before [`sweep_stale_temps`] treats it as crash litter rather than a write
/// in flight. Generous on purpose: reclaiming litter is housekeeping, while
/// deleting a live writer's temp would make its rename fail.
const STALE_TMP_AGE: std::time::Duration = std::time::Duration::from_secs(60 * 60);

/// Strictly-increasing per-process counter that makes each temp file name
/// unique *within* this process, where the pid cannot.
static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// Per-target-path state guarded by the config write lock.
#[derive(Default)]
struct ConfigWriteState {
    /// Whether this process has already swept crash litter for this path.
    /// Once per path per process is enough — nothing accumulates while we are
    /// running, so re-reading the directory on every write would be pure cost.
    swept: bool,
}

/// One lock per config file path. Keyed by the fully canonicalized path that
/// [`project_config_path`] produces, so the same file is always the same key.
///
/// Deliberately NOT `git_core::lock_mutations`: that lock is held for the whole
/// duration of a rebase / purge / checkout, and config writes fire on ordinary
/// UI actions (opening an issue panel writes the file). Funnelling them through
/// the git lock would stall the UI behind long history operations, and a config
/// write would in turn briefly block git. Keying per path also keeps two open
/// repositories from serializing against each other. The map grows by one small
/// entry per repository opened in a session, which is bounded and tiny.
static CONFIG_WRITE_LOCKS: Mutex<BTreeMap<PathBuf, Arc<Mutex<ConfigWriteState>>>> =
    Mutex::new(BTreeMap::new());

fn config_write_lock(path: &Path) -> Arc<Mutex<ConfigWriteState>> {
    let mut map = CONFIG_WRITE_LOCKS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    Arc::clone(map.entry(path.to_path_buf()).or_default())
}

/// Delete temp files for `file_name` left behind by a crash between create and
/// rename. Best effort: every error is ignored, because failing to tidy up is
/// never a reason to fail the write that is actually being asked for.
///
/// Called while holding the path lock, so no temp file of *this* process can be
/// in flight. Temp files of another process are only reclaimed once they are
/// older than [`STALE_TMP_AGE`].
fn sweep_stale_temps(dir: &Path, file_name: &str) {
    let prefix = format!("{file_name}{TMP_INFIX}");
    // The name used before temp files were made unique. Always ours to remove:
    // no version of this code writes it any more.
    let legacy = format!("{file_name}.tmp");
    let me = std::process::id().to_string();

    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == legacy {
            let _ = std::fs::remove_file(entry.path());
            continue;
        }
        let Some(rest) = name.strip_prefix(&prefix) else {
            continue;
        };
        if rest.split('.').next() == Some(me.as_str()) {
            let _ = std::fs::remove_file(entry.path());
            continue;
        }
        let abandoned = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|age| age > STALE_TMP_AGE);
        if abandoned {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// Write `bytes` to `path` atomically: write to a *uniquely named* sibling temp
/// file, fsync, then rename over the target. A crash between the two steps can
/// only ever leave a temp file behind — never a truncated `path` — and the temp
/// file is removed on any failure.
///
/// Serialized per target path (see [`CONFIG_WRITE_LOCKS`]). Both halves matter,
/// and they fix two distinct defects:
///
/// 1. A *fixed* temp name let two concurrent writers share one inode. Their
///    `File` handles keep independent offsets, so the second `File::create`
///    truncating to zero does not protect the first writer's later `write_all`:
///    the longer payload's tail survived past the shorter one, and the rename
///    published a splice of two documents. That really happened — see the
///    regression tests below.
/// 2. Even with unique temp names, two unserialized writers race to `rename`,
///    and the *older* payload can land last, silently reverting settings the
///    user just changed.
fn write_atomically(path: &Path, bytes: &[u8]) -> AdgitterResult<()> {
    let dir = path.parent().ok_or_else(|| {
        AdgitterError::Internal("config path has no parent directory".to_string())
    })?;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(PROJECT_CONFIG_FILENAME);

    // Held across the rename below: two writers racing to publish would
    // otherwise let the OLDER payload land last, silently reverting the
    // settings the user just changed (defect 2 above).
    let lock = config_write_lock(path);
    let _guard = lock
        .lock()
        .map(|mut state| {
            // Crash litter from an earlier run. Once per path per process is
            // enough — nothing accumulates while we are the one writing.
            if !state.swept {
                sweep_stale_temps(dir, file_name);
                state.swept = true;
            }
            state
        })
        .unwrap_or_else(|poisoned| {
            // A previous writer panicked mid-write. The bytes it was writing
            // are its own temp file's problem, not ours; the target is either
            // its old content or its new one, never a splice. Carry on rather
            // than refusing every future save for the life of the process.
            poisoned.into_inner()
        });

    // Unique per write (defect 1 above): a shared temp name let two writers
    // open the SAME inode, and their independent file offsets spliced one
    // payload's front onto the other's tail.
    let tmp_path = dir.join(format!(
        "{file_name}{TMP_INFIX}{}.{}",
        std::process::id(),
        TMP_SEQ.fetch_add(1, Ordering::Relaxed)
    ));

    let result = (|| -> AdgitterResult<()> {
        use std::io::Write as _;
        let mut f = std::fs::File::create(&tmp_path)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        std::fs::rename(&tmp_path, path)?;
        Ok(())
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&tmp_path);
    }
    result
}

/// Read the project settings file, or `None` when it does not exist (most
/// repos won't have one). Errors on an unreadable file or one over the size cap.
fn read_project_config_sync(repo_path: &Path) -> AdgitterResult<Option<String>> {
    let path = project_config_path(repo_path)?;
    if !path.exists() {
        return Ok(None);
    }
    let meta = std::fs::metadata(&path)?;
    if meta.len() > PROJECT_CONFIG_MAX_BYTES {
        return Err(AdgitterError::Internal(format!(
            "adgitter.config.json is too large ({} bytes, max {})",
            meta.len(),
            PROJECT_CONFIG_MAX_BYTES
        )));
    }
    Ok(Some(std::fs::read_to_string(&path)?))
}

/// Name shape of a preserved copy of an unparseable config file:
/// `adgitter.config.json.corrupt-<unix-seconds>.bak`, with a `-<n>` disambiguator
/// when two different corrupt contents are quarantined within the same second.
const PROJECT_CONFIG_QUARANTINE_PREFIX: &str = "adgitter.config.json.corrupt-";
const PROJECT_CONFIG_QUARANTINE_SUFFIX: &str = ".bak";
/// How many same-second name collisions to walk past before giving up.
const PROJECT_CONFIG_QUARANTINE_MAX_TRIES: u32 = 100;

/// Size cap for a quarantine COPY, deliberately far above
/// [`PROJECT_CONFIG_MAX_BYTES`]. Being over the read cap is one of the very
/// reasons a config becomes unreadable, so applying the read cap here too
/// would make exactly the files that need preserving unpreservable. A byte
/// copy needs no parsing and no UTF-8 decoding, and streams — the only reason
/// for any cap at all is to refuse a pathologically huge file at this
/// well-known path rather than duplicate gigabytes of it.
const PROJECT_CONFIG_QUARANTINE_MAX_BYTES: u64 = 64 * 1024 * 1024;

/// Byte-compare two files without loading either into memory. Used to notice
/// that an existing `.bak` already preserves exactly these bytes.
fn files_have_equal_contents(a: &Path, b: &Path) -> std::io::Result<bool> {
    use std::io::BufRead as _;
    let mut fa = std::io::BufReader::new(std::fs::File::open(a)?);
    let mut fb = std::io::BufReader::new(std::fs::File::open(b)?);
    loop {
        // Scoped so the buffer borrows end before `consume` needs `&mut`.
        let (equal, n, at_end) = {
            let ba = fa.fill_buf()?;
            let bb = fb.fill_buf()?;
            if ba.is_empty() || bb.is_empty() {
                (ba.is_empty() && bb.is_empty(), 0usize, true)
            } else {
                let n = ba.len().min(bb.len());
                (ba[..n] == bb[..n], n, false)
            }
        };
        if at_end || !equal {
            return Ok(equal);
        }
        fa.consume(n);
        fb.consume(n);
    }
}

/// Copy `<repo>/adgitter.config.json` aside, byte for byte, so its contents
/// survive whatever the app writes next. Called by the frontend whenever the
/// file could not be turned into settings — it failed to parse, OR
/// [`read_project_config_sync`] refused it (over the read cap, not valid
/// UTF-8, permissions/IO). A config we cannot read still holds real user
/// settings, and the very next settings save would otherwise overwrite them
/// with defaults (see `loadProjectConfig` in `projectConfig.svelte.ts`).
///
/// Because this is a raw byte copy it succeeds for two of the three things
/// that make a file unreadable — an oversized file (its own, much larger cap
/// applies, see [`PROJECT_CONFIG_QUARANTINE_MAX_BYTES`]) and one that is not
/// valid UTF-8. A file whose BYTES cannot be read at all (no permission, IO
/// error) cannot be preserved, and this returns `Err`; the frontend then
/// refuses to save over it rather than trading it for defaults.
///
/// Deliberately a COPY, not a move: the corrupt file is left exactly where the
/// user put it. Nothing here mutates or "repairs" the config — the original is
/// only ever replaced by an explicit, user-initiated save.
///
/// Repeat corruption: an existing quarantine file with byte-identical content
/// is reused (relaunching with the same broken file does not pile up copies);
/// genuinely different content gets its own file. Created with `create_new`, so
/// an existing backup is never clobbered.
///
/// Returns the quarantine file's NAME (not a full path — it is meant for a UI
/// message), or `None` when there is no config file to preserve.
fn quarantine_project_config_sync(repo_path: &Path) -> AdgitterResult<Option<String>> {
    let path = project_config_path(repo_path)?;
    if !path.exists() {
        return Ok(None);
    }
    let meta = std::fs::metadata(&path)?;
    if meta.len() > PROJECT_CONFIG_QUARANTINE_MAX_BYTES {
        return Err(AdgitterError::Internal(format!(
            "adgitter.config.json is too large to preserve ({} bytes, max {})",
            meta.len(),
            PROJECT_CONFIG_QUARANTINE_MAX_BYTES
        )));
    }
    let dir = path.parent().ok_or_else(|| {
        AdgitterError::Internal("config path has no parent directory".to_string())
    })?;

    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with(PROJECT_CONFIG_QUARANTINE_PREFIX)
                || !name.ends_with(PROJECT_CONFIG_QUARANTINE_SUFFIX)
            {
                continue;
            }
            if !entry.metadata().is_ok_and(|m| m.len() == meta.len()) {
                continue;
            }
            if files_have_equal_contents(&path, &entry.path()).unwrap_or(false) {
                return Ok(Some(name));
            }
        }
    }

    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    for n in 0..PROJECT_CONFIG_QUARANTINE_MAX_TRIES {
        let name = if n == 0 {
            format!("{PROJECT_CONFIG_QUARANTINE_PREFIX}{secs}{PROJECT_CONFIG_QUARANTINE_SUFFIX}")
        } else {
            format!(
                "{PROJECT_CONFIG_QUARANTINE_PREFIX}{secs}-{n}{PROJECT_CONFIG_QUARANTINE_SUFFIX}"
            )
        };
        let candidate = dir.join(&name);
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(mut f) => {
                // Stream the original through unchanged: it may be over the
                // read cap and may not be valid UTF-8 — neither matters to a
                // byte copy. On any failure the half-written backup is
                // removed, so a failed quarantine never leaves a truncated
                // copy that looks like a good one.
                let copied = std::fs::File::open(&path)
                    .and_then(|mut src| std::io::copy(&mut src, &mut f))
                    .and_then(|_| f.sync_all());
                if let Err(e) = copied {
                    drop(f);
                    let _ = std::fs::remove_file(&candidate);
                    return Err(e.into());
                }
                return Ok(Some(name));
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.into()),
        }
    }
    Err(AdgitterError::Internal(
        "could not find a free name to preserve the unreadable adgitter.config.json".to_string(),
    ))
}

/// Validate + atomically write the project settings file.
fn write_project_config_sync(repo_path: &Path, content: &str) -> AdgitterResult<()> {
    let pretty = validate_project_config_content(content)?;
    let path = project_config_path(repo_path)?;
    write_atomically(&path, pretty.as_bytes())
}

/// Read `<repo>/adgitter.config.json` (per-repo project settings — branch
/// colours, issue-branch bindings, etc.). `None` when the file does not exist
/// yet, which is the common case, not an error. The frontend owns the JSON
/// schema; this treats the content as opaque text.
#[tauri::command]
pub async fn read_project_config(repo_path: String) -> AdgitterResult<Option<String>> {
    tauri::async_runtime::spawn_blocking(move || read_project_config_sync(Path::new(&repo_path)))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Write `<repo>/adgitter.config.json`. `content` must parse as a JSON object
/// (not an array/string/number/etc.) under the 256 KiB size cap — anything
/// else is rejected before touching disk. Stored pretty-printed so the file
/// diffs cleanly under version control (it lives in the working tree; users
/// may choose to commit it), via write-to-temp-then-rename so a crash mid-write
/// can never leave a truncated file at the real path.
#[tauri::command]
pub async fn write_project_config(repo_path: String, content: String) -> AdgitterResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        write_project_config_sync(Path::new(&repo_path), &content)
    })
    .await
    .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Preserve an unreadable `<repo>/adgitter.config.json` as a sibling
/// `adgitter.config.json.corrupt-<unix-seconds>.bak` before anything can
/// overwrite it. Resolves to the backup file's name, or `null` when the repo
/// has no config file at all. See [`quarantine_project_config_sync`].
#[tauri::command]
pub async fn quarantine_project_config(repo_path: String) -> AdgitterResult<Option<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        quarantine_project_config_sync(Path::new(&repo_path))
    })
    .await
    .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// List commits for the repository at `repo_path`, newest first.
///
/// The path may point at any directory inside a working copy — discovery
/// walks up to find the `.git` dir. Returns a [`CommitPage`] carrying a
/// `truncated` flag when the repository has more history than `limit`.
#[tauri::command]
pub async fn list_commits(repo_path: String, limit: Option<usize>) -> AdgitterResult<CommitPage> {
    let path = PathBuf::from(repo_path);
    // Run the (potentially expensive) revwalk on a blocking thread so the
    // Tauri event loop stays responsive on huge repos.
    tauri::async_runtime::spawn_blocking(move || git::list_commits(path, limit))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// List all references (HEAD, branches, remotes, tags) for the repository.
#[tauri::command]
pub async fn list_refs(repo_path: String) -> AdgitterResult<git::RefList> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::list_refs(path))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// List the files changed by the commit `sha`, diffed against its first parent.
#[tauri::command]
pub async fn list_commit_files(
    repo_path: String,
    sha: String,
) -> AdgitterResult<Vec<git::FileChange>> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::list_commit_files(path, sha))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Structured diff of file `path` in commit `sha` (vs. its first parent).
#[tauri::command]
pub async fn diff_file(repo_path: String, sha: String, path: String) -> AdgitterResult<FileDiff> {
    let repo = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::diff_file(repo, sha, path))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Commits reachable from HEAD that changed `path`, newest first.
#[tauri::command]
pub async fn file_history(
    repo_path: String,
    path: String,
    limit: Option<usize>,
) -> AdgitterResult<Vec<git::Commit>> {
    let repo = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::file_history(repo, path, limit))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Structured diff of file `path` in the working tree (staged + unstaged vs. HEAD).
#[tauri::command]
pub async fn diff_worktree(repo_path: String, path: String) -> AdgitterResult<FileDiff> {
    let repo = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::diff_worktree(repo, path))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Classify a chosen folder for the Welcome flow (repo / empty / non-repo).
#[tauri::command]
pub async fn probe_path(path: String) -> AdgitterResult<git::ProbeResult> {
    let p = PathBuf::from(path);
    tauri::async_runtime::spawn_blocking(move || git::probe_path(p))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Initialize a new repository at `path`.
#[tauri::command]
pub async fn init_repository(path: String) -> AdgitterResult<()> {
    let p = PathBuf::from(path);
    tauri::async_runtime::spawn_blocking(move || git::init_repository(p))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Per-object transfer progress emitted during a clone (`clone-progress` event).
#[derive(Clone, serde::Serialize)]
struct CloneProgress {
    received: usize,
    total: usize,
}

/// Clone `url` into `dest` with `auth`, emitting `clone-progress` events to the
/// calling window only.
#[tauri::command]
pub async fn clone_repository(
    window: tauri::Window,
    url: String,
    dest: String,
    auth: git::CloneAuth,
) -> AdgitterResult<()> {
    let p = PathBuf::from(dest);
    tauri::async_runtime::spawn_blocking(move || {
        git::clone_repository(url, p, auth, |received, total| {
            let _ = window.emit_to(
                window.label(),
                "clone-progress",
                CloneProgress { received, total },
            );
        })
    })
    .await
    .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Snapshot the working tree onto the Log-Anytime branch. Returns the new
/// commit sha, or null when nothing changed since the last snapshot.
#[tauri::command]
pub async fn log_commit(repo_path: String, branch: String) -> AdgitterResult<Option<String>> {
    let p = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::log_commit(p, branch))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

// ── Guided tutorial demo repository ───────────────────────────────────
//
// Thin wrappers over `git_core::tutorial_demo`, which owns the demo script and
// the path confinement: every command below resolves `repo_path` against
// `<app_data_dir>/tutorial` and refuses anything that is not
// `<that>/demo-<ms>/repo`.

/// `<app_data_dir>/tutorial`, created on first use.
fn tutorial_base_dir(app: &AppHandle) -> AdgitterResult<PathBuf> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AdgitterError::Internal(format!("app data dir unavailable: {e}")))?
        .join("tutorial");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Tutorial step 3: create a fresh demo repo (+ bare `origin`) and return
/// `{ repoPath, remotePath }`.
#[tauri::command]
pub async fn tutorial_demo_create(app: AppHandle) -> AdgitterResult<git::tutorial_demo::DemoRepo> {
    let base = tutorial_base_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || git::tutorial_demo::create_demo(&base))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Tutorial step 5: write the untracked starter files; returns their
/// repo-relative paths.
#[tauri::command]
pub async fn tutorial_demo_seed_files(
    app: AppHandle,
    repo_path: String,
) -> AdgitterResult<Vec<String>> {
    let base = tutorial_base_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        git::tutorial_demo::seed_files(&base, Path::new(&repo_path))
    })
    .await
    .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Tutorial step 6: create the demo branches, tags and history and push them.
#[tauri::command]
pub async fn tutorial_demo_seed_history(app: AppHandle, repo_path: String) -> AdgitterResult<()> {
    let base = tutorial_base_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        git::tutorial_demo::seed_history(&base, Path::new(&repo_path))
    })
    .await
    .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Write one file inside the demo repo (`path` is repo-relative).
#[tauri::command]
pub async fn tutorial_demo_write_file(
    app: AppHandle,
    repo_path: String,
    path: String,
    content: String,
) -> AdgitterResult<()> {
    let base = tutorial_base_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        git::tutorial_demo::write_file(&base, Path::new(&repo_path), &path, &content)
    })
    .await
    .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Tutorial step 20: add `count` simulated Log Anytime snapshots to `branch`;
/// returns their shas.
#[tauri::command]
pub async fn tutorial_demo_simulate_log(
    app: AppHandle,
    repo_path: String,
    branch: String,
    count: usize,
) -> AdgitterResult<Vec<String>> {
    let base = tutorial_base_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        git::tutorial_demo::simulate_log(&base, Path::new(&repo_path), &branch, count)
    })
    .await
    .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Delete the whole demo directory (repo + `origin.git`) that holds `repo_path`.
#[tauri::command]
pub async fn tutorial_demo_remove(app: AppHandle, repo_path: String) -> AdgitterResult<()> {
    let base = tutorial_base_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        git::tutorial_demo::remove_demo(&base, Path::new(&repo_path))
    })
    .await
    .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Ahead/behind of the current branch versus its upstream.
#[tauri::command]
pub async fn ahead_behind(repo_path: String) -> AdgitterResult<git::AheadBehind> {
    let p = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::ahead_behind(p))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// The configured URL of a remote (default "origin"), or None when unset —
/// the desktop reflects it in Settings and gates PAT-only features on its
/// scheme.
#[tauri::command]
pub async fn remote_url(repo_path: String, remote: String) -> AdgitterResult<Option<String>> {
    let p = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::remote_url(p, remote))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Fetch a remote (default refspecs), updating remote-tracking refs.
#[tauri::command]
pub async fn fetch(
    repo_path: String,
    remote: String,
    auth: git::CloneAuth,
    url: Option<String>,
) -> AdgitterResult<()> {
    let p = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::fetch(p, remote, auth, url))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Pull = fetch + merge the current branch's upstream. `url` overrides the
/// fetch target (a user-configured Settings URL over the `.git` origin).
#[tauri::command]
pub async fn pull(
    repo_path: String,
    remote: String,
    auth: git::CloneAuth,
    url: Option<String>,
) -> AdgitterResult<()> {
    let p = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::pull(p, remote, auth, url))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Push the current branch to a remote. `force` (advanced, destructive) lets
/// the update overwrite a remote branch whose tip is not an ancestor of the
/// new value — the frontend must gate this behind explicit confirmation.
#[tauri::command]
pub async fn push(
    repo_path: String,
    remote: String,
    auth: git::CloneAuth,
    force: bool,
    url: Option<String>,
) -> AdgitterResult<()> {
    let p = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::push(p, remote, auth, force, url))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Push only the named local branch with an ordinary same-name update.
#[tauri::command]
pub async fn push_branch(
    repo_path: String,
    branch: String,
    remote: String,
    auth: git::CloneAuth,
    url: Option<String>,
) -> AdgitterResult<()> {
    let p = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::push_branch(p, branch, remote, auth, url))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Start watching the repository at `repo_path` for on-disk changes.
///
/// The frontend calls this when the window gains focus; while active, changes
/// under the repo's `.git` dir emit a `repo-changed` event targeted at the
/// calling window only. Idempotent per window: calling again
/// replaces only that window's previous watcher, leaving other windows' watch
/// state untouched.
#[tauri::command]
pub fn start_repo_watch(
    app: AppHandle,
    window: tauri::Window,
    state: State<'_, WatchState>,
    repo_path: String,
) -> AdgitterResult<()> {
    watch::start(app, state.inner(), window.label().to_string(), repo_path)
}

/// Stop watching the repository. The frontend calls this when the window loses
/// focus so no disk watching happens while inactive. Only the calling
/// window's watcher is removed.
#[tauri::command]
pub fn stop_repo_watch(window: tauri::Window, state: State<'_, WatchState>) -> AdgitterResult<()> {
    watch::stop(state.inner(), window.label());
    Ok(())
}

/// Working-tree status grouped Staged / Changed / Untracked / Ignored.
#[tauri::command]
pub async fn repo_status(repo_path: String) -> AdgitterResult<RepoStatus> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::status(path))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Stage the given paths (add modifications/new files; record deletions).
#[tauri::command]
pub async fn stage_paths(repo_path: String, paths: Vec<String>) -> AdgitterResult<()> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::stage(path, paths))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Unstage the given paths (reset their index entries back to HEAD).
#[tauri::command]
pub async fn unstage_paths(repo_path: String, paths: Vec<String>) -> AdgitterResult<()> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::unstage(path, paths))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Discard unstaged working-tree changes for the given tracked paths.
#[tauri::command]
pub async fn discard_paths(repo_path: String, paths: Vec<String>) -> AdgitterResult<()> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::discard(path, paths))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Commit the staged index with `message`; `amend` replaces the HEAD commit.
/// Returns the new commit sha.
#[tauri::command]
pub async fn create_commit(
    app: AppHandle,
    repo_path: String,
    message: String,
    amend: bool,
) -> AdgitterResult<String> {
    // Refresh the account default before writing. A configured `user.email`
    // still wins — this only decides what stands in when git has none.
    sync_commit_identity(&app).await;
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::commit(path, message, amend))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Create local branch `name` at `from` (a ref name or sha).
#[tauri::command]
pub async fn create_branch(repo_path: String, name: String, from: String) -> AdgitterResult<()> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::create_branch(path, name, from))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Rename a local branch.
#[tauri::command]
pub async fn rename_branch(
    repo_path: String,
    old_name: String,
    new_name: String,
) -> AdgitterResult<()> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::rename_branch(path, old_name, new_name))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Set (or clear, with `None`) a local branch's upstream.
#[tauri::command]
pub async fn set_upstream(
    repo_path: String,
    branch: String,
    upstream: Option<String>,
) -> AdgitterResult<()> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::set_upstream(path, branch, upstream))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// A local branch's current upstream shorthand, or None.
#[tauri::command]
pub async fn branch_upstream(repo_path: String, branch: String) -> AdgitterResult<Option<String>> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::branch_upstream(path, branch))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Delete a local branch (refuses the currently checked-out branch).
#[tauri::command]
pub async fn delete_branch(repo_path: String, name: String) -> AdgitterResult<()> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::delete_branch(path, name))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Check out a branch or commit (updates HEAD + working tree).
#[tauri::command]
pub async fn checkout(repo_path: String, target: String) -> AdgitterResult<()> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::checkout(path, target))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Classify "the user wants to check out this remote branch" so the UI can ask
/// the one question that fits — or, when the local branch already tracks it at
/// the same commit, none at all.
///
/// Read-only. The whole matrix is decided here, in one pass over the repo,
/// rather than by the frontend probing `branch_upstream` + `list_refs` and
/// assembling the verdict itself: the repo can move between probes, and the
/// rule would otherwise live twice, in two languages.
#[tauri::command]
pub async fn inspect_remote_checkout(
    repo_path: String,
    remote_name: String,
    local_name: String,
) -> AdgitterResult<git::RemoteCheckoutPlan> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || {
        git::inspect_remote_checkout(path, remote_name, local_name)
    })
    .await
    .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Check out an existing local branch and point its upstream at `remote_name` —
/// step one of the `adoptUpstream` row's two-step flow (step two, the optional
/// pull, is the caller's `pull`). Re-classifies first, so a branch that has
/// meanwhile acquired a different upstream is still refused.
#[tauri::command]
pub async fn adopt_remote_upstream_and_checkout(
    repo_path: String,
    remote_name: String,
    local_name: String,
) -> AdgitterResult<()> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || {
        git::adopt_remote_upstream_and_checkout(path, remote_name, local_name)
    })
    .await
    .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Create a local branch tracking `remote_name` at its tip and check it out —
/// the confirm-dialog primary action for checking out a remote branch, i.e. the `createLocal` row of
/// [`inspect_remote_checkout`]'s matrix. Errors when the remote branch is
/// unknown or `local_name` already names an existing local branch.
#[tauri::command]
pub async fn checkout_remote_branch(
    repo_path: String,
    remote_name: String,
    local_name: String,
) -> AdgitterResult<()> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || {
        git::checkout_remote_branch(path, remote_name, local_name)
    })
    .await
    .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Create a tag (annotated when `message` is set, else lightweight).
#[tauri::command]
pub async fn create_tag(
    repo_path: String,
    name: String,
    target: String,
    message: Option<String>,
) -> AdgitterResult<()> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::create_tag(path, name, target, message))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Delete a tag by short name.
#[tauri::command]
pub async fn delete_tag(repo_path: String, name: String) -> AdgitterResult<()> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::delete_tag(path, name))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Merge `source` into the current branch. A content conflict does
/// NOT abort: the op pauses (`status: "conflict"`) for in-app resolution via
/// `conflict_state`/`continue_op`/`abort_op`.
#[tauri::command]
pub async fn merge(repo_path: String, source: String) -> AdgitterResult<git::HistoryOpResult> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::merge(path, source))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Reset the current branch to `target` (mode = "soft" | "mixed" | "hard").
#[tauri::command]
pub async fn reset(repo_path: String, target: String, mode: String) -> AdgitterResult<()> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::reset(path, target, mode))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Cherry-pick `commits` (in order) onto the current branch.
#[tauri::command]
pub async fn cherry_pick(repo_path: String, commits: Vec<String>) -> AdgitterResult<()> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::cherry_pick(path, commits))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Revert a commit (creates an inverse commit on the current branch).
#[tauri::command]
pub async fn revert(repo_path: String, commit: String) -> AdgitterResult<()> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::revert(path, commit))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Change a commit's message (HEAD amend for now).
#[tauri::command]
pub async fn reword(
    repo_path: String,
    sha: String,
    message: String,
) -> AdgitterResult<git::HistoryOpResult> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::reword(path, sha, message))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Rebase the current branch onto `onto` (all-picks of merge-base..HEAD).
#[tauri::command]
pub async fn rebase_onto(repo_path: String, onto: String) -> AdgitterResult<git::HistoryOpResult> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::rebase_onto(path, onto))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Rebase `branch` onto `onto`, whether or not `branch` is the branch
/// currently checked out. When it isn't, this stashes any dirty working
/// tree/index, checks out `branch`, rebases it, checks the original branch
/// back out, and restores the stash — so the user ends up back where they
/// started (see `git_core::rebase::rebase_branch` for the full contract).
#[tauri::command]
pub async fn rebase_branch(
    repo_path: String,
    branch: String,
    onto: String,
) -> AdgitterResult<git::HistoryOpResult> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::rebase_branch(path, branch, onto))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Run an explicit interactive-rebase plan onto `onto` (steps oldest-first).
#[tauri::command]
pub async fn rebase(
    repo_path: String,
    onto: String,
    steps: Vec<RebaseStep>,
) -> AdgitterResult<git::HistoryOpResult> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::rebase(path, onto, steps))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Drop a commit from the current branch (replays its descendants without it).
#[tauri::command]
pub async fn drop_commit(repo_path: String, sha: String) -> AdgitterResult<git::HistoryOpResult> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::drop_commit(path, sha))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Squash a user-selected, contiguous range of commits on the current branch
/// into one commit carrying `message`.
#[tauri::command]
pub async fn squash_range(
    repo_path: String,
    shas: Vec<String>,
    message: String,
) -> AdgitterResult<git::HistoryOpResult> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::squash_range(path, shas, message))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Purge `path` from `sha`'s tree and every descendant commit up to the
/// current branch tip ("a secret got committed, erase it from this point
/// on"). A single file path only — a directory path errors clearly.
#[tauri::command]
pub async fn purge_path(
    repo_path: String,
    sha: String,
    path: String,
) -> AdgitterResult<git::HistoryOpOutcome> {
    let repo = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::purge_path(repo, sha, path))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Add the working tree's current content of `path` into `sha`'s tree and
/// every descendant commit up to the current branch tip — the inverse of
/// `purge_path` ("I forgot to commit this file back then, add it
/// retroactively"). A single file path only — a directory path errors
/// clearly.
#[tauri::command]
pub async fn add_file_to_commit(
    repo_path: String,
    sha: String,
    path: String,
) -> AdgitterResult<git::HistoryOpOutcome> {
    let repo = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::add_file_to_commit(repo, sha, path))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Probe whether a paused conflict resolution is waiting in `repo_path`
/// (survives an app restart — the state lives in `.git/adgitter-resolve.json`).
#[tauri::command]
pub async fn conflict_state(repo_path: String) -> AdgitterResult<Option<git::ResolveState>> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::conflict_state(path))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Finish a paused op once every conflicted file has been staged. May pause
/// again (`status: "conflict"`) if a LATER rebase step also conflicts.
#[tauri::command]
pub async fn continue_op(repo_path: String) -> AdgitterResult<git::HistoryOpResult> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::continue_op(path))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Abandon a paused op, restoring the exact pre-op state (tip, worktree, no
/// leftover backup or undo entry).
#[tauri::command]
pub async fn abort_op(repo_path: String) -> AdgitterResult<()> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::abort_op(path))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Whether Undo is on offer, and why not when it is not.
///
/// The rule lives in `git-core` (`undo::classify`), not here and not in the
/// frontend: deciding it from several separate probes would let the repository
/// change between them, and would mean writing the same rule twice in two
/// languages where only one of them could be the one the action obeys.
#[tauri::command]
pub async fn undo_state(repo_path: String) -> AdgitterResult<git::UndoState> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::undo_state(path))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Undo the most recent mutating operation (restores ref + working tree).
#[tauri::command]
pub async fn undo(repo_path: String) -> AdgitterResult<Option<Backup>> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git::undo_last(path))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Backups older than this no longer protect an undo a user would plausibly
/// still want, so their ref is deleted, letting the ghost commit they kept
/// reachable disappear from the graph.
const GHOST_BACKUP_MAX_AGE_MS: u64 = 48 * 3600 * 1000;

/// Delete expired backup refs (older than 48h) so the commits they were
/// keeping reachable stop showing up as "ghosted" in the graph. When any are
/// removed, also best-effort kick off a `git gc` to reclaim the now-
/// unreachable objects — fire-and-forget, since a missed/failed gc just means
/// slightly more disk use until the next successful run.
#[tauri::command]
pub async fn expire_backups(repo_path: String) -> AdgitterResult<usize> {
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || {
        let removed = git::expire_backups(path.clone(), GHOST_BACKUP_MAX_AGE_MS)?;
        if removed > 0 {
            let _ = std::process::Command::new("git")
                .args(["gc", "--prune=now", "--quiet"])
                .current_dir(&path)
                .spawn();
        }
        Ok(removed)
    })
    .await
    .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

// ── Entitlement: signed-license verification ───────────────────────────
//
// The frontend `plan` is driven by a verified Ed25519 license, defaulting to
// `free` with no/invalid token. Verification is fully offline; only the public
// key ships with the app. The production signing key lives in the (not-yet-
// built) cloud signing service and is NEVER embedded in the binary.

use base64::{engine::general_purpose::STANDARD, Engine};
use std::time::{SystemTime, UNIX_EPOCH};

/// plugin-store file + key the persisted license token lives under. The frontend
/// writes it here (see `ipc.ts`), and `verify_license(None)` reads it back. This
/// is also the fallback store for `issue_license` when the OS keychain is
/// unavailable (headless Linux/CI).
const LICENSE_FILE: &str = "license.json";
const LICENSE_TOKEN_KEY: &str = "token";

/// OS-keychain service/account the issued license token is stored under.
pub(crate) const KEYCHAIN_SERVICE: &str = "adgitter";
pub(crate) const KEYCHAIN_ACCOUNT: &str = "license";

/// plugin-store file + key holding this install's device id. Kept
/// separate from `license.json` on purpose: the license is revocable and gets
/// rewritten on every re-issue, whereas the device id must outlive every license
/// — sign out, sign in as someone else, a revoked token, all keep the same id.
const DEVICE_FILE: &str = "device.json";
const DEVICE_ID_KEY: &str = "id";

/// Base URL of the license server.
///
/// Resolution order: the `ADGITTER_API_URL` env var at **runtime** (so a dev
/// run can point anywhere per-invocation), then the value baked at **build**
/// time by `build.rs`, then the local dev server. Still never a hardcoded prod
/// URL — the source default is localhost and the real one arrives from the
/// build environment or a gitignored `.env`, exactly like `LICENSE_PUBLIC_KEY`.
///
/// The baked layer is not a convenience: a packaged app launched from Finder
/// inherits no shell environment, so a runtime-only lookup meant every release
/// build talked to `localhost:8080` and every licence and checkout call failed
/// with a connection refusal.
pub(crate) fn api_base() -> String {
    resolve_api_base(
        std::env::var("ADGITTER_API_URL").ok().as_deref(),
        option_env!("ADGITTER_API_URL"),
    )
}

/// The precedence rule behind [`api_base`], as a pure function so it is
/// testable without `std::env::set_var` (process-global, and it would race the
/// other tests in this binary). Blank is treated as absent at every layer: an
/// empty `ADGITTER_API_URL=` in a shell or `.env` means "not configured", not
/// "use the empty string".
fn resolve_api_base(runtime: Option<&str>, baked: Option<&str>) -> String {
    const FALLBACK: &str = "http://localhost:8080";
    [runtime, baked]
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|v| !v.is_empty())
        .unwrap_or(FALLBACK)
        .to_string()
}

/// IPC-facing view of a [`license::LicenseStatus`] (camelCase per convention).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatusDto {
    /// "active" | "grace" | "invalid".
    pub status: String,
    /// Plan tier ("free" | "basic" | "advance" | "enterprise") when valid.
    pub plan: Option<String>,
    /// Human-readable reason when `status == "invalid"`.
    pub error: Option<String>,
    /// License expiry (Unix ms) when valid.
    pub expires_ms: Option<u64>,
    /// Server-derived entitlement features when valid (empty for `invalid`).
    /// The frontend caches these to answer `hasFeature("NoAd")` etc.
    pub features: Vec<String>,
    /// One-time purchased theme ids when valid (empty for `invalid`). Independent
    /// of `plan` — the store gates Apply on these, not the tier.
    pub owned_themes: Vec<String>,
    /// Account email carried by the license, when valid and present.
    ///
    /// Two uses, both legitimate: the account panel shows the user their own
    /// address, and it is the *default* commit identity used only when git has
    /// none. `None` for an invalid license, and for a pre-`email` token.
    ///
    /// PII — the frontend displays it; nothing logs it.
    pub email: Option<String>,
    /// Display name carried by the license (see `license::License::name`), when
    /// valid and present. `None` for an invalid license and for a pre-`name`
    /// token.
    ///
    /// PII — the frontend displays it; nothing logs it.
    pub name: Option<String>,
    /// Avatar URL carried by the license (see `license::License::avatar_url`),
    /// when valid and present. Still must be run through `sanitizeAvatarUrl`
    /// on the frontend before use — see its doc comment.
    ///
    /// PII — the frontend displays it; nothing logs it.
    pub avatar_url: Option<String>,
    /// Username carried by the license (see `license::License::username`),
    /// when valid and present.
    ///
    /// PII — the frontend displays it; nothing logs it.
    pub username: Option<String>,
    /// When this licence's free trial ends or ended (Unix ms), when it is a
    /// trial — see `license::License::trial_ends_ms`. Past it, `plan` and
    /// `features` are already Free.
    pub trial_ends_ms: Option<u64>,
}

fn plan_str(plan: license::Plan) -> String {
    match plan {
        license::Plan::Free => "free",
        license::Plan::Basic => "basic",
        license::Plan::Advance => "advance",
        license::Plan::Enterprise => "enterprise",
    }
    .to_string()
}

/// Dev-only entitlement features for a plan, mirroring the server's
/// `derive_features`. Only the debug `mint_test_license` path
/// uses this; real licenses get their features from the license server.
#[cfg(debug_assertions)]
fn dev_features(plan: license::Plan) -> Vec<String> {
    let paid = !matches!(plan, license::Plan::Free);
    let advance_plus = matches!(plan, license::Plan::Advance | license::Plan::Enterprise);
    use license::Feature;
    let mut f = Vec::new();
    if paid {
        f.push(Feature::NoAd.as_str().to_string());
    }
    // Applying custom themes is free on every tier.
    f.push(Feature::ApplyTheme.as_str().to_string());
    if paid {
        f.push(Feature::TicketsPriority.as_str().to_string());
        f.push(Feature::MultiWindow.as_str().to_string());
    }
    if advance_plus {
        f.push(Feature::LogAnytimeBackground.as_str().to_string());
        f.push(Feature::LogAnytimeSquash.as_str().to_string());
        f.push(Feature::TeamSeats.as_str().to_string());
        f.push(Feature::IssueTracker.as_str().to_string());
    }
    f
}

/// Parse a plan string into [`license::Plan`] for the dev mint paths.
#[cfg(debug_assertions)]
fn parse_dev_plan(plan: &str) -> AdgitterResult<license::Plan> {
    Ok(match plan {
        "free" => license::Plan::Free,
        "basic" => license::Plan::Basic,
        "advance" => license::Plan::Advance,
        "enterprise" => license::Plan::Enterprise,
        other => return Err(AdgitterError::Internal(format!("unknown plan: {other}"))),
    })
}

/// Build a signed dev license token for `plan` valid for `valid_days`, using the
/// committed TEST key. Shared by `mint_test_license` and `dev_seed_license`.
#[cfg(debug_assertions)]
fn build_dev_token(plan: license::Plan, valid_days: i64) -> String {
    let issued_ms = now_ms();
    let valid_ms = (valid_days.max(0) as u64).saturating_mul(24 * 60 * 60 * 1000);
    let lic = license::License {
        trial_ends_ms: None,
        plan,
        subject: "dev@local".to_string(),
        // Dev token: a stable placeholder device id (full per-machine binding
        // lands in T9 when the desktop issues real licenses from the server).
        device_id: "dev-device".to_string(),
        features: dev_features(plan),
        owned_themes: Vec::new(),
        seats: dev_seats(plan),
        issued_ms,
        expires_ms: issued_ms.saturating_add(valid_ms),
        iat_ms: issued_ms,
        device_limit: 3,
        // A dev token carries a placeholder account address so the fallback path
        // (and the account panel) can be exercised without a live server.
        email: Some("dev@adgitter.local".to_string()),
        name: None,
        avatar_url: None,
        username: None,
    };
    license::sign(&lic, &license::test_keys::signing_key())
}

/// Dev-only team-seat cap for a plan. Mirrors the server's
/// `db::entitlement::seats_for`: Enterprise alone has seats, and `None` means
/// **no team seats** (it never meant "unlimited" — see `license::License`'s
/// `seats` doc for why that reading was wrong even when it was written down).
#[cfg(debug_assertions)]
fn dev_seats(plan: license::Plan) -> Option<u32> {
    match plan {
        license::Plan::Enterprise => Some(5),
        license::Plan::Free | license::Plan::Basic | license::Plan::Advance => None,
    }
}

/// Map a verification result onto the IPC DTO.
fn status_to_dto(status: license::LicenseStatus) -> LicenseStatusDto {
    match status {
        license::LicenseStatus::Active(l) => LicenseStatusDto {
            status: "active".into(),
            plan: Some(plan_str(l.plan)),
            error: None,
            expires_ms: Some(l.expires_ms),
            features: l.features,
            owned_themes: l.owned_themes,
            email: l.email,
            name: l.name,
            avatar_url: l.avatar_url,
            username: l.username,
            trial_ends_ms: l.trial_ends_ms,
        },
        license::LicenseStatus::Grace(l) => LicenseStatusDto {
            status: "grace".into(),
            plan: Some(plan_str(l.plan)),
            error: None,
            expires_ms: Some(l.expires_ms),
            features: l.features,
            owned_themes: l.owned_themes,
            email: l.email,
            name: l.name,
            avatar_url: l.avatar_url,
            username: l.username,
            trial_ends_ms: l.trial_ends_ms,
        },
        license::LicenseStatus::Invalid(e) => LicenseStatusDto {
            status: "invalid".into(),
            plan: None,
            error: Some(e.to_string()),
            expires_ms: None,
            features: Vec::new(),
            owned_themes: Vec::new(),
            email: None,
            name: None,
            avatar_url: None,
            username: None,
            trial_ends_ms: None,
        },
    }
}

fn invalid_dto(reason: &str) -> LicenseStatusDto {
    LicenseStatusDto {
        status: "invalid".into(),
        plan: None,
        error: Some(reason.into()),
        expires_ms: None,
        features: Vec::new(),
        owned_themes: Vec::new(),
        email: None,
        name: None,
        avatar_url: None,
        username: None,
        trial_ends_ms: None,
    }
}

/// Resolve the Ed25519 public key used to verify licenses.
///
/// Precedence:
/// 1. `LICENSE_PUBLIC_KEY` baked at build time (standard-base64 of 32 bytes) —
///    how production ships its real key (build.rs reads it from env/`.env`).
/// 2. Debug builds only: fall back to the committed TEST verifying key so the
///    pipeline can be exercised locally with `mint_test_license`.
/// 3. Release builds with no (or a malformed) baked key: `None` ⇒ every token is
///    treated as Invalid (inert). Never panics over a missing/bad key.
fn resolve_public_key() -> Option<[u8; 32]> {
    resolve_public_key_from(option_env!("LICENSE_PUBLIC_KEY"))
}

/// The precedence rule behind [`resolve_public_key`], with the baked value
/// passed in.
///
/// Split out because `option_env!` is resolved at compile time and cannot be
/// varied per test: whether a key is baked depends on the developer's `.env`,
/// so tests written against `resolve_public_key` directly asserted the
/// TEST-key fallback and then broke the moment someone configured a real key
/// locally — which is exactly what configuring the app for a live sign-in
/// does. A test suite that fails because the app was set up properly is
/// testing the environment, not the code.
fn resolve_public_key_from(baked: Option<&str>) -> Option<[u8; 32]> {
    if let Some(b64) = baked {
        let decoded = STANDARD
            .decode(b64)
            .ok()
            .and_then(|v| <[u8; 32]>::try_from(v).ok());
        if decoded.is_some() {
            return decoded;
        }
        // A malformed baked key is a build misconfiguration; fall through to the
        // debug TEST key (debug) or stay inert (release).
    }
    test_fallback_key()
}

#[cfg(debug_assertions)]
fn test_fallback_key() -> Option<[u8; 32]> {
    Some(license::test_keys::verifying_key_bytes())
}

#[cfg(not(debug_assertions))]
fn test_fallback_key() -> Option<[u8; 32]> {
    None
}

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Process-lifetime cache for the licence token, and the generation counter
/// that keeps it honest.
///
/// `stored_token` sits on the path of every entitlement check, session
/// restore, renew, checkout and device call — and each miss is a real OS
/// keychain read. On macOS a keychain read can raise an authorisation prompt,
/// so re-reading turns one unavoidable prompt into one per call; even when it
/// does not prompt it is a syscall per feature check.
///
/// `value`: `None` = never read; `Some(None)` = read, and there is no token.
///
/// `generation` exists for one specific hazard: sign-out must not be undone by
/// a read that was already in flight. A concurrent `stored_token` can sample
/// the stores *before* the deletes land and try to cache that value *after*
/// them, which would leave paid features unlocked on a signed-out app —
/// precisely the split state `destroy_credentials` exists to remove. A reader
/// records the generation it started under and stores its result only if
/// nothing has invalidated the cache since.
struct TokenCache {
    generation: u64,
    value: Option<Option<String>>,
}

impl TokenCache {
    /// A cache hit (`Some`) or a miss (`None`), paired with the generation the
    /// caller must quote back to [`Self::store_if_current`].
    fn read(&self) -> (u64, Option<Option<String>>) {
        (self.generation, self.value.clone())
    }

    /// Store a freshly read token **only** if nothing invalidated the cache
    /// while that read was in flight. Dropping a stale result is the whole
    /// point: the losing case is a sign-out being silently undone.
    fn store_if_current(&mut self, generation: u64, token: Option<String>) {
        if self.generation == generation {
            self.value = Some(token);
        }
    }

    /// Replace the value and invalidate every read in flight.
    fn set(&mut self, token: Option<String>) {
        self.generation = self.generation.wrapping_add(1);
        self.value = Some(token);
    }

    /// Forget the value and invalidate every read in flight.
    fn clear(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.value = None;
    }
}

static TOKEN_CACHE: Mutex<TokenCache> = Mutex::new(TokenCache {
    generation: 0,
    value: None,
});

/// Replace the cached token (after a successful persist) and bump the
/// generation, so any read still in flight discards its now-stale result.
fn cache_token(token: Option<String>) {
    if let Ok(mut c) = TOKEN_CACHE.lock() {
        c.set(token);
    }
}

/// Drop the cached token. Called by `destroy_credentials` after the deletes,
/// so the next read goes to the real stores.
fn invalidate_token_cache() {
    if let Ok(mut c) = TOKEN_CACHE.lock() {
        c.clear();
    }
}

/// Read the persisted licence token from the real stores, bypassing the cache.
///
/// Source order is **inverted in debug builds**, and that is the whole point:
/// a keychain item's ACL is bound to the binary that created it, `pnpm dev`
/// rebuilds an unsigned executable on every change, and so every dev launch
/// asks macOS for permission that can never stick. `persist_token` already
/// keeps a `license.json` copy in debug precisely because the keychain read
/// cannot succeed across a rebuild — reading that copy *first* means the
/// doomed keychain read (and its modal prompt) never happens in the normal
/// case. The keychain stays as a fallback for a debug build whose store file
/// is missing (a token written by a release build on the same machine, or one
/// predating the dual-write), which self-heals on the next persist.
///
/// Release builds keep the keychain first, where the token belongs.
fn stored_token_uncached(app: &AppHandle) -> Option<String> {
    #[cfg(debug_assertions)]
    {
        store_get_token(app).or_else(keychain_get_token)
    }
    #[cfg(not(debug_assertions))]
    {
        keychain_get_token().or_else(|| store_get_token(app))
    }
}

/// Run a keychain-touching closure on Tauri's blocking pool and wait for it.
///
/// **Every keychain access goes through here**, because none of them may run on
/// a thread that is driving the async runtime — which is where the body of an
/// `async` command runs. On Linux the `keyring` backend is the Secret Service
/// over zbus's *blocking* API, which calls `block_on` on a runtime of its own,
/// and tokio refuses that outright on a runtime thread ("Cannot start a runtime
/// from within a runtime") — before any D-Bus connection is attempted, so it
/// panicked on every Linux machine, keyring daemon or not. A blocking-pool
/// thread is allowed to block, so the same call is fine there. macOS and
/// Windows do not panic, but a keychain read can sit behind an authorisation
/// prompt for as long as the user takes, and that does not belong on a runtime
/// worker either.
///
/// `None` means the closure panicked. Callers treat that like any other
/// unavailable keychain instead of failing the command.
async fn off_runtime<T, F>(f: F) -> Option<T>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    match tauri::async_runtime::spawn_blocking(f).await {
        Ok(value) => Some(value),
        Err(e) => {
            tracing::warn!(error = %e, "credential store task failed");
            None
        }
    }
}

/// Read the persisted license token. Prefers the OS keychain (where
/// `issue_license` writes on this platform), then falls back to the plugin-store
/// file (headless Linux/CI, or a token written by the frontend) — see
/// [`stored_token_uncached`] for why debug builds reverse that order. Either
/// source keeps `verify_license(None)` working across restarts.
///
/// Cached for the life of the process (see [`TokenCache`]); a hit answers
/// without leaving the calling task. A miss is a real keychain read, so it runs
/// on the blocking pool (see [`off_runtime`]). A read that could not complete
/// is reported as "no stored token", exactly like an unavailable keychain.
pub(crate) async fn stored_token(app: &AppHandle) -> Option<String> {
    // Scoped so the guard is gone before the `.await` below.
    {
        if let Ok(c) = TOKEN_CACHE.lock() {
            if let (_, Some(cached)) = c.read() {
                return cached;
            }
        }
    }
    let app = app.clone();
    off_runtime(move || stored_token_blocking(&app))
        .await
        .flatten()
}

/// [`stored_token`] on the calling thread. **Blocks on the OS keychain**: never
/// call it from an `async fn` — go through [`stored_token`].
///
/// The lock is not held across the store read: a keychain read can block on a
/// user-facing prompt, and stalling every other entitlement check behind that
/// would be worse than the duplicate read a race can cause.
fn stored_token_blocking(app: &AppHandle) -> Option<String> {
    let generation = match TOKEN_CACHE.lock() {
        Ok(c) => match c.read() {
            (_, Some(cached)) => return cached,
            (generation, None) => generation,
        },
        // A poisoned lock is not a reason to report "signed out": fall through
        // to an uncached read and simply do not cache the result.
        Err(_) => return stored_token_uncached(app),
    };
    let token = stored_token_uncached(app);
    if let Ok(mut c) = TOKEN_CACHE.lock() {
        c.store_if_current(generation, token.clone());
    }
    token
}

/// Read the token from the plugin-store `license.json`, if present.
fn store_get_token(app: &AppHandle) -> Option<String> {
    use tauri_plugin_store::StoreExt;
    let store = app.store(LICENSE_FILE).ok()?;
    store
        .get(LICENSE_TOKEN_KEY)
        .and_then(|v| v.as_str().map(str::to_string))
}

/// Read the token from the OS keychain, or `None` when unset/unavailable.
/// Blocking — reached only through [`off_runtime`].
fn keychain_get_token() -> Option<String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).ok()?;
    entry.get_password().ok()
}

/// Persist a verified token: keychain first, plugin-store file on any keychain
/// error (unavailable backend / locked keyring) so the token still survives a
/// restart. Failures are swallowed — a persist miss only means a re-issue later.
///
/// The keychain write runs on the blocking pool (see [`off_runtime`]).
async fn persist_token(app: &AppHandle, token: &str) {
    let app = app.clone();
    let token = token.to_string();
    // `None` (the write panicked) is one more swallowed persist miss.
    let _ = off_runtime(move || persist_token_blocking(&app, &token)).await;
}

/// [`persist_token`] on the calling thread. **Blocks on the OS keychain**:
/// never call it from an `async fn` — go through [`persist_token`].
fn persist_token_blocking(app: &AppHandle, token: &str) {
    // The cache is why a later `stored_token` need not touch the keychain at
    // all; seed it here rather than making the next reader pay for it.
    cache_token(Some(token.to_string()));
    if keychain_set_token(token).is_ok() {
        // Debug builds ALSO keep a copy in the store file. A keychain item's
        // ACL is bound to the binary that created it, and `pnpm dev` produces
        // a freshly built, unsigned executable on every change — so the next
        // rebuild cannot read back what this one wrote, `stored_token` falls
        // through to a file that was never written, and the app is silently
        // signed out again. That makes any multi-step flow (sign in, then buy)
        // untestable in development. Release builds keep the token in the
        // keychain only, where it belongs.
        #[cfg(debug_assertions)]
        store_set_token(app, token);
        return;
    }
    // TODO: OS keychain hardening — surface a diagnostic when both the
    // keychain and the store write fail (currently best-effort / non-fatal).
    store_set_token(app, token);
}

/// Store the token in the OS keychain. Errors bubble up so the caller can fall
/// back to the plugin-store file. Blocking — reached only through
/// [`off_runtime`].
fn keychain_set_token(token: &str) -> Result<(), keyring::Error> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)?.set_password(token)
}

// ── Sign-out: local credential destruction (2026-08-18 decision) ────────────
//
// **Signing out destroys this machine's credentials, online or off.** Signing
// *in* has always required the network (a Clerk session exchanged for a signed
// licence), so "signed out offline cannot sign back in until there is a
// network" is a consequence of that, not a defect — the user is told before
// they confirm (see the account panel). What is *not* acceptable is the state
// this replaces: a UI that said "signed out" while the licence token sat in the
// keychain, so every paid feature stayed unlocked and — far worse — commits
// kept being authored with the signed-out account's email.
//
// Three pieces of state have to go, and a miss on any one of them is a
// user-visible security failure:
//
// 1. **The keychain token.** The credential proper.
// 2. **The plugin-store token.** `persist_token` writes a *second* copy here on
//    debug builds (and on any release build whose keychain was unavailable),
//    and `stored_token` reads `keychain.or_else(store)` — so deleting only the
//    keychain copy leaves a dev build fully entitled and still signed in after
//    the next restart. Both copies, every time.
// 3. **`git-core`'s fallback commit identity.** It is a process-global holding
//    the account address, and it is the reason this is not merely a billing
//    bug: a commit written after sign-out would carry the signed-out account's
//    email into git history — permanent, and pushed to every mirror. It is
//    cleared here *unconditionally*, even if a token delete failed, because a
//    stale entitlement is recoverable and a forged author line is not.
//
// Seat release is deliberately absent: the server has no device-removal
// endpoint (the license server exposes issue/renew/checkout/themes/webhooks only),
// and adding one is out of scope. A seat is reclaimed the next time the same
// device id signs in, and the cap is 99 today. Sign-out must never depend on
// the network anyway — that is the whole point of this path.

/// The persisted places a licence token can live, behind a trait so the
/// destroy-*every*-copy rule is testable without a keychain, a store file, or a
/// running Tauri app. The keychain-only bug this fixes was invisible to any test
/// that could not see both sources.
trait CredentialStores {
    /// Remove the keychain copy. `true` when the keychain is left with no token
    /// of ours (including "there was none", and "there is no keychain backend on
    /// this platform" — nothing of ours can be in one that does not exist).
    fn delete_keychain_token(&self) -> bool;
    /// Remove the plugin-store copy. `true` when the file is left with no token.
    fn delete_store_token(&self) -> bool;
    /// Whether a token is *still* readable from either source. This is the only
    /// assertion that matters: it is read back after both deletes rather than
    /// inferred from their return values.
    fn token_remains(&self) -> bool;
}

/// What a local sign-out could **not** destroy. All-false is the normal answer.
///
/// Reported rather than swallowed: a token that survives means the app looks
/// signed out while paid features stay unlocked, which is exactly the split
/// state this work exists to remove. The frontend completes the sign-out
/// regardless and warns.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignOutReport {
    /// A licence token is still readable after the wipe (a locked or failing
    /// keychain, or an unwritable store file).
    pub token_remains: bool,
}

/// Destroy every local credential. Pure with respect to the ambient app: the
/// stores arrive as an argument so the "both copies, and the identity even when
/// a delete fails" rule can be pinned by unit tests.
fn destroy_credentials<S: CredentialStores>(stores: &S) -> SignOutReport {
    // Both deletes run unconditionally — no `&&`, no `?`. A short-circuit here
    // is the bug: a keychain that refuses to delete would leave the store copy
    // behind, and `stored_token` falls through to it.
    let _keychain = stores.delete_keychain_token();
    let _store = stores.delete_store_token();
    // Before `token_remains` reads back: that check exists to prove the token
    // is really gone, so it must see the stores, never a cached copy of what
    // was just deleted.
    invalidate_token_cache();
    // Always, and last: the account address must stop being a commit-author
    // default even if a token could not be removed.
    git_core::set_fallback_identity(None);
    SignOutReport {
        token_remains: stores.token_remains(),
    }
}

/// The real stores: the OS keychain and this app's `license.json`.
struct AppCredentials<'a>(&'a AppHandle);

impl CredentialStores for AppCredentials<'_> {
    fn delete_keychain_token(&self) -> bool {
        let Ok(entry) = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) else {
            // No usable keychain backend (headless Linux/CI). Nothing of ours
            // can be stored in one we cannot even address.
            return true;
        };
        matches!(
            entry.delete_credential(),
            Ok(()) | Err(keyring::Error::NoEntry)
        )
    }

    fn delete_store_token(&self) -> bool {
        use tauri_plugin_store::StoreExt;
        let Ok(store) = self.0.store(LICENSE_FILE) else {
            return false;
        };
        store.delete(LICENSE_TOKEN_KEY);
        // Saved explicitly: an unsaved delete leaves the token on disk for the
        // next launch to read back, which is a sign-out that undoes itself.
        store.save().is_ok()
    }

    fn token_remains(&self) -> bool {
        // Uncached on purpose — see `destroy_credentials`. This is the
        // assertion that a sign-out actually landed.
        stored_token_uncached(self.0).is_some()
    }
}

/// Sign out on this machine: destroy the persisted licence token (**both**
/// copies) and clear the account-derived commit identity.
///
/// Never fails and never touches the network — see the module note above for
/// why sign-out must not be blockable by connectivity, and why seat release is
/// not attempted. The returned [`SignOutReport`] tells the frontend whether
/// anything survived so it can warn rather than lie.
///
/// The wipe deletes from the OS keychain and reads it back, so it runs on the
/// blocking pool (see [`off_runtime`]).
#[tauri::command]
pub async fn sign_out(app: AppHandle) -> AdgitterResult<SignOutReport> {
    let report = off_runtime(move || destroy_credentials(&AppCredentials(&app))).await;
    Ok(report.unwrap_or_else(|| {
        // The wipe panicked part-way, so nothing is known about what it
        // removed. `destroy_credentials`' two unconditional promises are kept
        // here regardless — no cached token, and no account address left as a
        // commit-author default — and the token is reported as surviving so
        // the frontend warns instead of claiming a clean sign-out.
        invalidate_token_cache();
        git_core::set_fallback_identity(None);
        SignOutReport {
            token_remains: true,
        }
    }))
}

// ── Device identity ────────────────────────────────────────────────
//
// Licenses are bound to a device id, and a plan's seat count is enforced against
// the set of ids a user has registered. The id therefore has exactly
// two requirements: it must be *stable* for the life of the install, and it must
// not identify the hardware. A random UUID generated once and persisted meets
// both; a hostname / MAC / machine serial meets neither (they change on network
// or OS changes, silently re-binding the license and burning another seat, and
// they leak real machine identity to the server).

/// Pick the device id given whatever is already persisted: reuse a stored id
/// verbatim, otherwise mint a fresh random one. Pure (the randomness aside) so
/// the reuse-vs-generate decision is unit-testable without a running app.
/// Returns `(id, is_new)`; `is_new` tells the caller it has to be persisted.
fn resolve_device_id(existing: Option<&str>) -> (String, bool) {
    match existing.map(str::trim) {
        Some(id) if !id.is_empty() => (id.to_string(), false),
        _ => (uuid::Uuid::new_v4().to_string(), true),
    }
}

/// The slice of the plugin store `device_id` needs. Abstracted so the
/// persist-failure path — which must leave *no* trace of the un-persisted id —
/// is testable without a running Tauri app.
trait DeviceIdStore {
    fn get_id(&self) -> Option<String>;
    fn set_id(&self, id: &str);
    fn delete_id(&self);
    fn save(&self) -> Result<(), String>;
}

impl<R: tauri::Runtime> DeviceIdStore for std::sync::Arc<tauri_plugin_store::Store<R>> {
    fn get_id(&self) -> Option<String> {
        (**self)
            .get(DEVICE_ID_KEY)
            .and_then(|v| v.as_str().map(str::to_string))
    }
    fn set_id(&self, id: &str) {
        (**self).set(DEVICE_ID_KEY, id.to_string());
    }
    fn delete_id(&self) {
        (**self).delete(DEVICE_ID_KEY);
    }
    fn save(&self) -> Result<(), String> {
        (**self).save().map_err(|e| e.to_string())
    }
}

/// Resolve (and persist on first use) the device id held by `store`.
///
/// A failure to *persist* a freshly minted id is an error rather than a
/// best-effort miss: handing back an id we couldn't store would give the user a
/// different device on every launch, and each one consumes a seat against their
/// plan's `device_limit`. Failing loudly at sign-in beats silently exhausting
/// the seats.
///
/// The rollback is what keeps that loud failure *loud*. `set` mutates the
/// in-memory store before `save` touches the disk, so a failed save would
/// otherwise leave the id readable by the next call in the same session — which
/// would take the `is_new == false` path, skip saving entirely, and hand back an
/// `Ok(id)` that never reached disk. Deleting the key restores the pre-call
/// state so every subsequent call re-attempts the whole mint-and-persist.
fn device_id_from_store<S: DeviceIdStore>(store: &S) -> AdgitterResult<String> {
    let (id, is_new) = resolve_device_id(store.get_id().as_deref());
    if is_new {
        store.set_id(&id);
        if let Err(e) = store.save() {
            store.delete_id();
            return Err(AdgitterError::Internal(format!(
                "could not persist device id: {e}"
            )));
        }
    }
    Ok(id)
}

/// This install's device id, generating and persisting one on first use.
fn device_id(app: &AppHandle) -> AdgitterResult<String> {
    use tauri_plugin_store::StoreExt;
    let store = app
        .store(DEVICE_FILE)
        .map_err(|e| AdgitterError::Internal(format!("device id store unavailable: {e}")))?;
    device_id_from_store(&store)
}

/// This install's stable device id, minted on first call. The frontend
/// needs it to exchange a Clerk JWT for a device-bound license.
#[tauri::command]
pub async fn get_device_id(app: AppHandle) -> AdgitterResult<String> {
    device_id(&app)
}

/// Store the token in the plugin-store `license.json` (keychain fallback).
fn store_set_token(app: &AppHandle, token: &str) {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app.store(LICENSE_FILE) {
        store.set(LICENSE_TOKEN_KEY, token.to_string());
        let _ = store.save();
    }
}

/// Verify a token offline against the embedded public key and map to the DTO.
/// `expected_device_id` pins device binding when `Some`. Absent public
/// key resolves to an inert `invalid` — never an error.
fn verify_token(token: &str, expected_device_id: Option<&str>) -> LicenseStatusDto {
    verify_token_with(token, expected_device_id, resolve_public_key())
}

/// [`verify_token`] with the verifying key supplied, so tests can pin which key
/// is in play instead of inheriting whatever the developer's `.env` baked in.
fn verify_token_with(
    token: &str,
    expected_device_id: Option<&str>,
    pubkey: Option<[u8; 32]>,
) -> LicenseStatusDto {
    let Some(pubkey) = pubkey else {
        return invalid_dto("no license public key configured");
    };
    status_to_dto(license::verify(
        token,
        &pubkey,
        now_ms(),
        expected_device_id,
    ))
}

/// Verify a signed license token and report the resulting entitlement.
///
/// `token` wins when supplied; otherwise the persisted token (if any) is used.
/// Absent token or public key resolves to an inert `invalid` status — never an
/// error — so the frontend simply defaults to the free tier.
///
/// `pin_device` (default **false**) re-checks the license's device binding
/// against *this* install's id. Entitlement refresh leaves it off: the
/// token was already device-checked at issue time, and `issue_license` is where
/// the binding is established. **Session restore turns it on** — a license file
/// lifted from another machine must not make the app look signed in, and unlike
/// the entitlement path there is no server round-trip behind session restore to
/// catch it later. The id is resolved here rather than accepted as an argument
/// so the WebView cannot choose which device it claims to be.
#[tauri::command]
pub async fn verify_license(
    app: AppHandle,
    token: Option<String>,
    pin_device: Option<bool>,
) -> AdgitterResult<LicenseStatusDto> {
    let token = match token {
        Some(t) => t,
        None => match stored_token(&app).await {
            Some(t) => t,
            None => return Ok(invalid_dto("no license token")),
        },
    };
    let device = if pin_device.unwrap_or(false) {
        // No readable device id means we cannot prove this license belongs to
        // this install — refuse rather than fall back to an unpinned check.
        match device_id(&app) {
            Ok(id) => Some(id),
            Err(_) => return Ok(invalid_dto("no device id")),
        }
    } else {
        None
    };
    Ok(verify_token(&token, device.as_deref()))
}

// ── Feature gating ───────────────────────────────────────────────
//
// Every paid command must re-check entitlement at its IPC entry so a direct
// `invoke(...)` bypassing the UI is still rejected. `require_feature` is that
// reusable guard; `check_feature` is a queryable entry the frontend uses to
// decide what to enable. Both read the same persisted/verified license as
// `verify_license(None)` (keychain-first, then plugin-store) and delegate the
// grant/deny decision to `license::require`.

/// Resolve the persisted license into a `LicenseStatus` (same read path as
/// `verify_license(None)`), **bound to this device**.
///
/// The device id is resolved here, in Rust, from this install's own store — it
/// is never an argument, so a tampered WebView cannot choose which machine it
/// claims to be. Without the binding, copying `license.json` (or the keychain
/// item) to a second machine unlocked every paid feature there, and the licence design's
/// seat cap meant nothing.
///
/// This is the entitlement path only. `verify_license`'s own `pin_device`
/// default stays `false` on purpose (see its doc comment); the paths that must
/// not accept a foreign licence — session restore, and now this — opt in.
async fn resolve_license_status(app: &AppHandle) -> license::LicenseStatus {
    let token = stored_token(app).await;
    // Resolved only when there is a token to check it against: `device_id`
    // *mints and persists* on first call, and an install with no licence has no
    // reason to acquire one here. `.ok()` — an unreadable id is handled by
    // `resolve_status_from` as a binding failure, not as licence to skip the
    // binding.
    let device = token.as_ref().and_then(|_| device_id(app).ok());
    resolve_status_from(
        resolve_public_key(),
        token.as_deref(),
        device.as_deref(),
        now_ms(),
    )
}

/// The decision behind [`resolve_license_status`], with every ambient input
/// passed in so the device-binding rule is unit-testable without an
/// `AppHandle` (the gap that let it ship unbound in the first place).
///
/// **A missing device id fails closed as `DeviceMismatch`.** Falling back to an
/// unbound verification would reinstate the exact hole this closes — any
/// machine that cannot write its device-id store would be a machine where a
/// copied licence works. Reporting it as a mismatch rather than a generic
/// invalid keeps the user's next step right: it is a binding problem, and
/// signing in again is what re-establishes a binding. If the store is still
/// broken at that point, `issue_license` fails loudly with its own
/// `could not persist device id` error rather than silently granting anything.
/// This mirrors `verify_license(pin_device: true)`, which already refuses on an
/// unreadable device id.
fn resolve_status_from(
    pubkey: Option<[u8; 32]>,
    token: Option<&str>,
    device_id: Option<&str>,
    now_ms: u64,
) -> license::LicenseStatus {
    let Some(pubkey) = pubkey else {
        return license::LicenseStatus::Invalid(license::LicenseError::Malformed);
    };
    let Some(token) = token else {
        return license::LicenseStatus::Invalid(license::LicenseError::Malformed);
    };
    let Some(device_id) = device_id else {
        return license::LicenseStatus::Invalid(license::LicenseError::DeviceMismatch);
    };
    license::verify(token, &pubkey, now_ms, Some(device_id))
}

// ── Commit identity ─────────────────────────────────────────────────
//
// The account email is the **default** commit identity, never an override: a
// configured `user.email` (repo, then global) always wins, and this only fills
// the gap when git has none. `git-core`'s `identity` module holds the rule; the
// shell's job is just to keep it supplied with the current account address.
//
// It is resolved from the *persisted* license immediately before each use
// rather than cached at sign-in. A cache would go stale across sign-out, a
// re-issue with a changed address, or an expiry that happened while the app was
// open — and a stale address is precisely the silent-substitution failure the
// account-address rule forbids. Verifying an Ed25519 signature per commit costs microseconds.
//
// Privacy: the address is passed straight to `git-core` and never logged.

/// The account email from a resolved license status, when it is valid (active or
/// in grace) and carries one. Pre-`email` tokens simply have none.
///
/// "Valid" includes device-bound (see [`resolve_license_status`]): a licence
/// copied from another machine yields no address here, so commits made with it
/// fall back to git's own `user.email` instead of authoring as the licence's
/// owner. That is the right way round — the identity default is a consequence of
/// holding a licence that is valid *here*.
///
/// **Its only input is a verified licence.** That is the whole guarantee, and it
/// is why the signature has no other parameter: an address can only come from a
/// licence that verified *here*, so no development affordance — the dev unlock
/// included — has any way to inject one. A capability that was granted by
/// mistake is switched off; an address written into a commit is in the history
/// for good.
fn account_email_from(status: license::LicenseStatus) -> Option<String> {
    match status {
        license::LicenseStatus::Active(l) | license::LicenseStatus::Grace(l) => l.email,
        license::LicenseStatus::Invalid(_) => None,
    }
}

/// The fallback commit identity implied by a licence status — same rule, in the
/// shape `git-core` consumes.
fn fallback_identity_from(status: license::LicenseStatus) -> Option<git_core::FallbackIdentity> {
    account_email_from(status)
        .as_deref()
        .and_then(git_core::FallbackIdentity::from_account_email)
}

/// Refresh `git-core`'s fallback identity from the persisted license. Called
/// before anything that writes a commit or reports what identity would be used.
async fn sync_commit_identity(app: &AppHandle) {
    git_core::set_fallback_identity(fallback_identity_from(resolve_license_status(app).await));
}

/// Report which identity the next commit in `repo_path` would carry — git's own
/// `user.email`, the ADGitter account address standing in for a missing one, or
/// neither — **without writing anything**.
///
/// This is what keeps the fallback honest. The UI calls it alongside the staged
/// file list and, when the source is `account`, tells the user which address the
/// commit will be authored with before they press Commit (the app says so
/// when it does).
#[tauri::command]
pub async fn git_identity_status(
    app: AppHandle,
    repo_path: String,
) -> AdgitterResult<git_core::IdentityStatus> {
    sync_commit_identity(&app).await;
    let path = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || git_core::identity_status(path))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Read `user.email` at global scope and (when a repo is given) project scope.
#[tauri::command]
pub async fn git_email_get(repo_path: Option<String>) -> AdgitterResult<git_core::GitEmailConfig> {
    let path = repo_path.map(PathBuf::from);
    tauri::async_runtime::spawn_blocking(move || git_core::read_git_email(path))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Set or clear (`None`/empty) `user.email` at the given scope.
#[tauri::command]
pub async fn git_email_set(
    scope: git_core::GitEmailScope,
    repo_path: Option<String>,
    email: Option<String>,
) -> AdgitterResult<()> {
    let path = repo_path.map(PathBuf::from);
    tauri::async_runtime::spawn_blocking(move || git_core::write_git_email(scope, path, email))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Set or clear `user.name` at global or project scope.
#[tauri::command]
pub async fn git_name_set(
    scope: git_core::GitEmailScope,
    repo_path: Option<String>,
    name: Option<String>,
) -> AdgitterResult<()> {
    let path = repo_path.map(PathBuf::from);
    tauri::async_runtime::spawn_blocking(move || git_core::write_git_name(scope, path, name))
        .await
        .map_err(|e| AdgitterError::Internal(e.to_string()))?
}

/// Pure grant/deny check over an already-resolved status. Factored out of
/// `require_feature` so it is unit-testable without an `AppHandle`.
///
/// A denial is **not** one thing. Collapsing every reason into `FEATURE_LOCKED`
/// ("this feature needs a paid plan") was survivable while the only reason was
/// a low tier; with device binding on the entitlement path it would greet a
/// paying user on a reinstalled machine with a sales pitch. The two reasons
/// that have a different remedy get their own codes:
///
/// - `DeviceMismatch` → `LICENSE_DEVICE_MISMATCH`: sign in again to bind here.
/// - `Expired`        → `LICENSE_EXPIRED`: renew.
///
/// Everything else (tier too low, malformed, bad signature) stays
/// `FEATURE_LOCKED` — for those, "you are not entitled" is the honest summary,
/// and the underlying reason rides along in the message.
fn check_status_feature(
    status: &license::LicenseStatus,
    feature: license::Feature,
) -> AdgitterResult<()> {
    license::require(status, feature).map_err(|e| match e {
        license::LicenseError::DeviceMismatch => AdgitterError::LicenseDeviceMismatch,
        license::LicenseError::Expired => AdgitterError::LicenseExpired,
        other => AdgitterError::FeatureLocked(other.to_string()),
    })
}

/// The complete grant/deny decision for a paid feature: the licence, plus (debug
/// builds only) the dev unlock.
///
/// **This is the single place the dev unlock is allowed to say yes**, and it
/// says yes to a *capability*, never to a licence. Everything upstream —
/// `resolve_license_status`, and therefore `account_email` and the commit
/// identity that hangs off it — is untouched by it. See `dev_unlock.rs` for why
/// that separation is not negotiable.
///
/// `dev` is a parameter rather than a call to `dev_unlock::plan()` inside so the
/// decision is testable in *both* build configurations: a
/// `#[cfg(not(debug_assertions))]` test can hand it the strongest possible
/// override and assert the feature is still refused, which is what pins "the
/// bypass is not in the release binary" to something executable rather than to a
/// promise. In a release build the `dev` branch below does not exist at all, so
/// the argument is inert by construction.
fn decide_feature(
    dev: Option<license::Plan>,
    status: &license::LicenseStatus,
    feature: license::Feature,
) -> AdgitterResult<()> {
    #[cfg(debug_assertions)]
    if crate::dev_unlock::grants(dev, feature) {
        return Ok(());
    }
    #[cfg(not(debug_assertions))]
    let _ = dev;
    check_status_feature(status, feature)
}

/// The dev-unlock tier in effect, always `None` in a release build.
#[cfg(debug_assertions)]
fn dev_plan_override() -> Option<license::Plan> {
    crate::dev_unlock::plan()
}

/// Release builds have no dev unlock: the module that reads the switch is not
/// compiled in (see `dev_unlock.rs`), so there is nothing to consult.
#[cfg(not(debug_assertions))]
fn dev_plan_override() -> Option<license::Plan> {
    None
}

/// Guard a paid command: read the verified license and reject when it does not
/// grant `feature`. This is the "reject direct-IPC bypass" mechanism.
///
/// `pub(crate)` so `lib.rs`'s single-instance relaunch hook can gate the
/// MultiWindow entitlement the same way `open_repo_window` does.
pub(crate) async fn require_feature(
    app: &AppHandle,
    feature: license::Feature,
) -> AdgitterResult<()> {
    decide_feature(
        dev_plan_override(),
        &resolve_license_status(app).await,
        feature,
    )
}

/// Query whether the current license entitles `feature` (a canonical feature
/// string). Returns `false` when locked; errors only on an unknown feature
/// string. The frontend calls this to enable/disable paid affordances, and it
/// exercises the same `require_feature` guard real paid commands will use.
#[tauri::command]
pub async fn check_feature(app: AppHandle, feature: String) -> AdgitterResult<bool> {
    let parsed = feature
        .parse::<license::Feature>()
        .map_err(|_| AdgitterError::Internal(format!("unknown feature: {feature}")))?;
    Ok(require_feature(&app, parsed).await.is_ok())
}

/// `/license/issue` 200 response (see `contracts/license-api.md`). Only `license`
/// is consumed here — the plan/exp are re-derived from the verified token so the
/// client trusts the signed payload, never the wrapper JSON.
#[derive(serde::Deserialize)]
struct IssueResponse {
    license: String,
    #[allow(dead_code)]
    plan: String,
    #[allow(dead_code)]
    exp: i64,
}

/// Read the server's stable machine `code` out of an error response, without
/// ever carrying the body itself any further.
///
/// The license server answers every failure as `{ code, message }`, and the
/// `code` is the only part the client is meant to branch on. Returning just that — rather than the text — is what keeps a response
/// body out of an error message that is shown to the user and shipped in
/// diagnostic packets. Mirrors what `create_customer_portal` already does.
async fn error_code_of(resp: reqwest::Response) -> String {
    resp.json::<serde_json::Value>()
        .await
        .ok()
        .and_then(|v| v.get("code").and_then(|c| c.as_str()).map(str::to_owned))
        .unwrap_or_default()
}

/// Exchange a Clerk session JWT for a real signed license and persist it.
///
/// POSTs `{clerkJwt, deviceId, deviceName, evictOldestDevice}` to
/// `<ADGITTER_API_URL>/license/issue`, verifies the returned token **offline**
/// with the embedded public key — pinning `device_id` — and, when
/// valid, stores it (keychain first, plugin-store fallback) so
/// `verify_license(None)` reads it back on the next launch. Network/parse
/// failures map to `AdgitterError`; it never panics.
///
/// `evict_oldest` (default **false**) is the user's answer to the "device limit
/// exceeded" prompt. With it unset, an account already at its plan's device cap
/// comes back as `AdgitterError::DeviceSeatLimit` and **nothing on the server
/// changes**; the frontend asks, and only then calls again with `Some(true)`,
/// at which point the server drops the account's oldest device by `last_seen`
/// and seats this one. The desktop never names which device goes — it cannot:
/// the wire field is a boolean.
#[tauri::command]
pub async fn issue_license(
    app: AppHandle,
    clerk_jwt: String,
    device_id: String,
    evict_oldest: Option<bool>,
) -> AdgitterResult<LicenseStatusDto> {
    let url = format!("{}/license/issue", api_base().trim_end_matches('/'));
    let body = serde_json::json!({
        "clerkJwt": clerk_jwt,
        "deviceId": device_id,
        "deviceName": device_name(),
        "evictOldestDevice": evict_oldest.unwrap_or(false),
    });

    // Retry the transport and 5xx, but never a 4xx: a rejected JWT is an
    // answer, and repeating it only delays telling the user.
    //
    // This is the last hop of signing in, and it lands on a service that Fly
    // may have scaled to zero. On 2026-08-14 a real sign-in died exactly here
    // — the bridge had a valid session token, and the proxy answered "could
    // not find a good candidate within 40 attempts at load balancing" while it
    // failed to wake a machine. `min_machines_running = 1` makes that rare;
    // this makes a cold start survivable rather than fatal.
    const ATTEMPT_DELAYS_MS: [u64; 3] = [0, 1_500, 4_000];
    let client = reqwest::Client::new();
    let mut last: Option<AdgitterError> = None;

    for (attempt, delay) in ATTEMPT_DELAYS_MS.iter().enumerate() {
        if *delay > 0 {
            // `tokio` is not a direct dependency of this crate; the Tauri
            // runtime's blocking pool is what it already uses elsewhere.
            let wait = std::time::Duration::from_millis(*delay);
            let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(wait)).await;
        }
        let sent = client.post(&url).json(&body).send().await;
        let resp = match sent {
            Ok(r) => r,
            Err(e) => {
                last = Some(AdgitterError::Internal(format!(
                    "license request failed: {e}"
                )));
                continue;
            }
        };
        let status = resp.status();
        if status.is_success() {
            return license_from_response(&app, resp, &device_id).await;
        }
        let code = error_code_of(resp).await;
        // The account is full. Its own typed code so the frontend can offer the
        // eviction prompt instead of string-matching a 403 out of a message.
        if status == reqwest::StatusCode::FORBIDDEN && code == "SEAT_LIMIT" {
            return Err(AdgitterError::DeviceSeatLimit);
        }
        let err = AdgitterError::Internal(format!("license issue rejected ({status}): {code}"));
        if !status.is_server_error() {
            return Err(err);
        }
        tracing::warn!(
            attempt = attempt + 1,
            %status,
            "license issue got a server error; retrying"
        );
        last = Some(err);
    }
    Err(last
        .unwrap_or_else(|| AdgitterError::Internal("license issue failed with no response".into())))
}

/// A human-readable name for this machine, for the account's device list.
///
/// `/license/issue` requires it — omitting it made the server answer 422
/// "missing field `deviceName`", which failed every sign-in silently: 422 is a
/// client error, so it is (correctly) not retried, and the API logs nothing at
/// info level, so neither side left a trace.
///
/// macOS carries the name the user actually chose in Sharing settings, which
/// is what they will recognise in a device list. `scutil` is the supported way
/// to read it and is present on every macOS. Everything else falls back to the
/// OS name, which is honest rather than wrong — the id, not the name, is what
/// binds a licence.
fn device_name() -> String {
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = std::process::Command::new("/usr/sbin/scutil")
            .args(["--get", "ComputerName"])
            .output()
        {
            let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !name.is_empty() {
                return name;
            }
        }
    }
    std::env::consts::OS.to_string()
}

/// Parse and verify a successful `/license/issue` response.
async fn license_from_response(
    app: &AppHandle,
    resp: reqwest::Response,
    device_id: &str,
) -> AdgitterResult<LicenseStatusDto> {
    let issued: IssueResponse = resp
        .json()
        .await
        .map_err(|e| AdgitterError::Internal(format!("license response parse failed: {e}")))?;

    // Verify offline, pinning this machine's device id, before we trust or store.
    let dto = verify_token(&issued.license, Some(device_id));
    if dto.status != "invalid" {
        persist_token(app, &issued.license).await;
    }
    Ok(dto)
}

/// Re-issue the persisted license from the server's *current* entitlement.
///
/// This is the post-purchase path (`adgitter://checkout-complete`): sign-in
/// exchanges a Clerk JWT for a license and does not keep the JWT, so
/// `/license/issue` is unreachable afterwards. `/license/renew` therefore
/// authenticates with the stored license token itself — it is our own Ed25519
/// signature, bound to this device — and the server re-reads the entitlement
/// from its database, which is how a just-purchased theme or plan arrives.
///
/// The returned token is verified **offline** with the embedded public key,
/// pinned to this machine's device id, before it is trusted or persisted —
/// exactly as `issue_license` does. Nothing in the triggering deep link is
/// consulted: entitlement comes only from a signature we can verify.
///
/// No stored license ⇒ `NOT_SIGNED_IN` (nothing to renew).
///
/// ## This is also the device-seat ping
///
/// `/license/renew` re-runs the server's seat check, which bumps this device's
/// `last_seen` — so the renew the app already fires in the background at
/// startup *is* "register the UUID and last-login time with the server". There
/// is no second scheduler and no extra round trip.
///
/// A renew can therefore hit the cap: this device's row is gone (evicted from
/// another machine, or deauthorized in the account panel) and the account is
/// full. That comes back as `AdgitterError::DeviceSeatLimit`, with nothing
/// changed server-side, and `evict_oldest: Some(true)` is the retry the user
/// authorizes by pressing OK on the prompt.
///
/// **Failing here never costs the user anything.** The licence on disk is
/// untouched by a failed renew — `verify_license` keeps reading it offline,
/// so no network, a sleeping server or a refusal all leave the app
/// exactly as it was.
#[tauri::command]
pub async fn renew_license(
    app: AppHandle,
    evict_oldest: Option<bool>,
) -> AdgitterResult<LicenseStatusDto> {
    let current = stored_token(&app).await.ok_or(AdgitterError::NotSignedIn)?;
    let device = device_id(&app)?;
    let url = format!("{}/license/renew", api_base().trim_end_matches('/'));

    let resp = reqwest::Client::new()
        .post(&url)
        .json(&serde_json::json!({
            "license": current,
            "evictOldestDevice": evict_oldest.unwrap_or(false),
        }))
        .send()
        .await
        .map_err(|e| AdgitterError::Internal(format!("license renew failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let code = error_code_of(resp).await;
        if status == reqwest::StatusCode::FORBIDDEN && code == "SEAT_LIMIT" {
            return Err(AdgitterError::DeviceSeatLimit);
        }
        return Err(AdgitterError::Internal(format!(
            "license renew rejected ({status}): {code}"
        )));
    }

    let issued: IssueResponse = resp
        .json()
        .await
        .map_err(|e| AdgitterError::Internal(format!("renew response parse failed: {e}")))?;

    let dto = verify_token(&issued.license, Some(&device));
    if dto.status != "invalid" {
        persist_token(&app, &issued.license).await;
    }
    Ok(dto)
}

// ── Free trial ──────────────────────────────────────────────────────────────
//
// 14 days of Advance, no card, once per account and once per computer — run by
// the license server, which is the authority on all of it. What
// the app adds is the "computer": the device id above is random per install
// and resets with a reinstall, so a trial also sends a hash of the OS's own
// machine id. Only the hash leaves the machine, and only to the trial
// endpoints — it is not the device id, and nothing else uses it.

/// Salt for [`machine_hash`], so the hash is ours alone and can't be matched
/// against another vendor's hash of the same machine id.
const MACHINE_HASH_SALT: &str = "adgitter-trial-v1:";

/// SHA-256 (lowercase hex) of the salted machine id. Pure — unit-tested.
fn hash_machine_id(raw: &str) -> Option<String> {
    use sha2::{Digest, Sha256};
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let digest = Sha256::digest(format!("{MACHINE_HASH_SALT}{raw}").as_bytes());
    Some(digest.iter().map(|b| format!("{b:02x}")).collect())
}

/// The value after `"IOPlatformUUID" = ` in `ioreg` output. Pure — unit-tested.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn ioreg_platform_uuid(out: &str) -> Option<&str> {
    out.lines()
        .find(|l| l.contains("\"IOPlatformUUID\""))
        .and_then(|l| l.split('=').nth(1))
        .map(|v| v.trim().trim_matches('"'))
}

/// The `MachineGuid` value in `reg query` output. Pure — unit-tested.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn reg_machine_guid(out: &str) -> Option<&str> {
    out.lines()
        .find(|l| l.trim_start().starts_with("MachineGuid"))
        .and_then(|l| l.split_whitespace().last())
}

/// The OS's own id for this computer: one that a reinstall of the app doesn't
/// change. `None` when the OS won't say — the trial then rests on the account
/// and the install alone.
fn os_machine_id() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let out = std::process::Command::new("/usr/sbin/ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
            .ok()?;
        ioreg_platform_uuid(&String::from_utf8_lossy(&out.stdout)).map(str::to_owned)
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let out = std::process::Command::new("reg")
            .args([
                "query",
                r"HKLM\SOFTWARE\Microsoft\Cryptography",
                "/v",
                "MachineGuid",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()?;
        reg_machine_guid(&String::from_utf8_lossy(&out.stdout)).map(str::to_owned)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        ["/etc/machine-id", "/var/lib/dbus/machine-id"]
            .iter()
            .find_map(|p| std::fs::read_to_string(p).ok())
    }
}

/// [`os_machine_id`], hashed — what the trial endpoints receive.
fn machine_hash() -> Option<String> {
    os_machine_id().as_deref().and_then(hash_machine_id)
}

/// Where this account stands with the free trial on this computer
/// (`POST /license/trial/status`).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrialStatusDto {
    /// `"available" | "active" | "used" | "paid"`.
    pub state: String,
    /// When the account's trial ends or ended (Unix ms), when it has one.
    #[serde(default)]
    pub ends_ms: Option<u64>,
    pub days: u32,
    pub plan: String,
}

/// POST `{license, machineId}` to a trial endpoint.
async fn trial_request(app: &AppHandle, path: &str) -> AdgitterResult<reqwest::Response> {
    let license = stored_token(app).await.ok_or(AdgitterError::NotSignedIn)?;
    let url = format!("{}{path}", api_base().trim_end_matches('/'));
    let machine = tauri::async_runtime::spawn_blocking(machine_hash)
        .await
        .ok()
        .flatten();
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&serde_json::json!({ "license": license, "machineId": machine }))
        .send()
        .await
        .map_err(|e| AdgitterError::Internal(format!("trial request failed: {e}")))?;
    if resp.status().is_success() {
        return Ok(resp);
    }
    let status = resp.status();
    let code = error_code_of(resp).await;
    Err(AdgitterError::Internal(format!(
        "trial rejected ({status}): {code}"
    )))
}

/// Can this account start the free trial here? No stored licence ⇒
/// `NOT_SIGNED_IN` — the trial needs an account, so the UI signs in first.
#[tauri::command]
pub async fn trial_status(app: AppHandle) -> AdgitterResult<TrialStatusDto> {
    trial_request(&app, "/license/trial/status")
        .await?
        .json()
        .await
        .map_err(|e| AdgitterError::Internal(format!("trial status parse failed: {e}")))
}

/// Start the free trial and persist the licence that carries it.
///
/// Verified offline and pinned to this install before it is stored, exactly as
/// [`renew_license`] does. A refusal (`TRIAL_USED`, `ALREADY_SUBSCRIBED`) is an
/// `Internal` error naming the code; the panel then re-reads [`trial_status`],
/// which says the same thing as a state it can render.
#[tauri::command]
pub async fn start_trial(app: AppHandle) -> AdgitterResult<LicenseStatusDto> {
    let device = device_id(&app)?;
    let issued: IssueResponse = trial_request(&app, "/license/trial")
        .await?
        .json()
        .await
        .map_err(|e| AdgitterError::Internal(format!("trial response parse failed: {e}")))?;
    let dto = verify_token(&issued.license, Some(&device));
    if dto.status != "invalid" {
        persist_token(&app, &issued.license).await;
    }
    Ok(dto)
}

/// Create a Polar checkout for the signed-in user (the Polar payment
/// flow). Authenticates with the persisted license token (the desktop's durable
/// credential — a fresh Clerk JWT isn't retained after sign-in); the server
/// verifies its signature and reads the buyer from it. POSTs `{license, kind,
/// id}` to `<ADGITTER_API_URL>/checkout` and returns the hosted checkout URL for
/// the caller to open in the browser (the server holds the Polar access token;
/// the desktop never sees it). `kind` is `"plan"` or `"theme"`; `id` is the tier
/// / theme id. Network / non-2xx failures map to `AdgitterError::Internal`; never
/// panics.
///
/// No stored license ⇒ `AdgitterError::NotSignedIn` (code `NOT_SIGNED_IN`) — a
/// distinct, recoverable code rather than a generic internal error, so the
/// frontend can launch sign-in and automatically resume this same checkout
/// (lazy sign-in) without matching on message text.
#[tauri::command]
pub async fn create_checkout(app: AppHandle, kind: String, id: String) -> AdgitterResult<String> {
    let license = stored_token(&app).await.ok_or(AdgitterError::NotSignedIn)?;
    let url = format!("{}/checkout", api_base().trim_end_matches('/'));
    let body = serde_json::json!({ "license": license, "kind": kind, "id": id });

    let resp = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| AdgitterError::Internal(format!("checkout request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let detail = resp.text().await.unwrap_or_default();
        return Err(AdgitterError::Internal(format!(
            "checkout rejected ({status}): {detail}"
        )));
    }

    let v: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AdgitterError::Internal(format!("checkout response parse failed: {e}")))?;
    v.get("url")
        .and_then(|u| u.as_str())
        .map(str::to_owned)
        .ok_or_else(|| AdgitterError::Internal("checkout response had no url".into()))
}

/// Open Polar's **customer portal** for the signed-in subscriber
/// (E-subscription-portal) — cancel, change payment method, download invoices.
///
/// Authenticated exactly like [`create_checkout`]: the persisted licence token
/// is the credential, the server verifies its Ed25519 signature and derives the
/// customer from its `subject` alone. This command therefore takes **no
/// arguments at all** — there is no customer id, email or user id for a caller
/// (or a compromised page) to supply, because the server would ignore one
/// anyway.
///
/// # Secret handling
///
/// The returned URL embeds a `customer_session_token` that *is* a credential
/// for managing that customer's billing. It is returned to the caller to hand
/// straight to `open_external_url` and is **never logged**, never put into an
/// error message, and never persisted. Note the asymmetry with
/// [`create_checkout`]: on a non-2xx that one echoes the response body for
/// diagnosis, and this one deliberately does not — it reports the status and
/// the server's stable `code` only, so no response body from this endpoint can
/// ever reach a log or a diagnostic packet.
///
/// # Errors
///
/// * `NOT_SIGNED_IN` — no licence on disk, or the server rejected the one we
///   sent (401). Recoverable: the frontend signs in and retries this same
///   action, exactly as it does for a checkout.
/// * `NO_SUBSCRIPTION` — 404: the account has no Polar customer on record, so
///   there is nothing to manage. A specific, expected outcome, not a fault.
/// * `INTERNAL_ERROR` — anything else (Polar not provisioned, network, an
///   unexpected status), named by status + code and never by response body.
#[tauri::command]
pub async fn create_customer_portal(app: AppHandle) -> AdgitterResult<String> {
    let license = stored_token(&app).await.ok_or(AdgitterError::NotSignedIn)?;
    let url = format!("{}/portal", api_base().trim_end_matches('/'));

    let resp = reqwest::Client::new()
        .post(&url)
        // The ONLY field. Nothing identifies a customer here; the server reads
        // the subject out of this signed token.
        .json(&serde_json::json!({ "license": license }))
        .send()
        .await
        .map_err(|e| AdgitterError::Internal(format!("portal request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        // Read only the stable machine `code` out of the error body — never the
        // body itself, so nothing from this endpoint's responses is ever echoed.
        let code = resp
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|v| v.get("code").and_then(|c| c.as_str()).map(str::to_owned))
            .unwrap_or_default();
        return Err(match (status.as_u16(), code.as_str()) {
            // "Sign in again" — the same collapse `themes.rs` makes for a 401,
            // so the established sign-in-and-retry handling applies unchanged.
            (401, _) | (_, "INVALID_JWT") => AdgitterError::NotSignedIn,
            (404, _) | (_, "NO_SUBSCRIPTION") => AdgitterError::NoSubscription,
            _ => AdgitterError::Internal(format!("portal rejected ({status}): {code}")),
        });
    }

    let v: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AdgitterError::Internal(format!("portal response parse failed: {e}")))?;
    v.get("url")
        .and_then(|u| u.as_str())
        .map(str::to_owned)
        // Names the missing field, never the body — a well-formed body here
        // carries the session token.
        .ok_or_else(|| AdgitterError::Internal("portal response had no url".into()))
}

// ── Clerk account-portal capabilities (dead "Two-factor auth" button) ───────
//
// The account panel offers buttons for account-portal sections — Organizations,
// two-factor auth — that not every Clerk instance actually has configured;
// clicking one on an instance where the section is off opens a page that
// doesn't exist. The frontend cannot probe this itself: the WebView's CSP has
// a fixed `connect-src`, and the Clerk host is only known at runtime (derived
// from the publishable key), so the request has to happen here.

/// What the signed-in Clerk instance actually offers, so the account panel can
/// hide buttons for sections the instance has not configured. camelCase on the
/// wire — this is a **fixed contract** the frontend is coding against.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClerkPortalCapabilities {
    /// The hosted URL for Clerk's user-profile page, when Clerk reports one.
    pub user_profile_url: Option<String>,
    /// The hosted URL for Clerk's organization-profile page, when Clerk
    /// reports one. Meaningless unless `organizations_enabled`.
    pub organization_profile_url: Option<String>,
    /// Whether this instance has Organizations turned on at all.
    pub organizations_enabled: bool,
    /// Whether any user attribute is configured as a second factor. Clerk's
    /// account portal renders no 2FA section at all otherwise.
    pub mfa_enabled: bool,
}

/// How long `clerk_portal_capabilities` waits for Clerk's environment endpoint
/// before giving up. This runs while a settings panel is opening, so it must
/// never hang the UI on a slow or unreachable network.
const CLERK_ENVIRONMENT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Extract the capabilities we care about from a Clerk `GET /v1/environment`
/// response. Parses **tolerantly**: every field is optional, unknown fields
/// are ignored, and a missing/garbled payload degrades to "unknown"
/// (`None`/`false`) rather than erroring — a shape change on Clerk's side must
/// not crash a settings panel. Kept pure and separate from the network call so
/// it is unit-testable with no live Clerk; models the same
/// tolerant-navigation style the license server uses for
/// Clerk payloads.
fn parse_clerk_environment(v: &serde_json::Value) -> ClerkPortalCapabilities {
    let display = v.get("display_config");
    let user_profile_url = display
        .and_then(|d| d.get("user_profile_url"))
        .and_then(|u| u.as_str())
        .map(str::to_string);
    let organization_profile_url = display
        .and_then(|d| d.get("organization_profile_url"))
        .and_then(|u| u.as_str())
        .map(str::to_string);
    let organizations_enabled = v
        .get("organization_settings")
        .and_then(|o| o.get("enabled"))
        .and_then(|e| e.as_bool())
        .unwrap_or(false);
    // `used_for_second_factor` lives per-attribute (`totp`, `backup_code`,
    // `phone_number`, …); the account portal shows a 2FA section iff *some*
    // attribute has it set, so "any" is the question that matches what the
    // portal would actually render.
    let mfa_enabled = v
        .get("user_settings")
        .and_then(|u| u.get("attributes"))
        .and_then(|a| a.as_object())
        .is_some_and(|attrs| {
            attrs.iter().any(|(name, attr)| {
                let flag = |key: &str| {
                    attr.get(key)
                        .and_then(serde_json::Value::as_bool)
                        .unwrap_or(false)
                };
                // The general signal, verified against a live instance: every
                // attribute carries `used_for_second_factor`.
                flag("used_for_second_factor")
                    // `authenticator_app` and `backup_code` exist for no other
                    // purpose, and an instance that has turned one on can
                    // report it as plain `enabled`. Accepting both shapes errs
                    // toward *showing* the button: hiding a section the portal
                    // really does render is the worse failure of the two.
                    || (matches!(name.as_str(), "authenticator_app" | "backup_code")
                        && flag("enabled"))
            })
        });
    ClerkPortalCapabilities {
        user_profile_url,
        organization_profile_url,
        organizations_enabled,
        mfa_enabled,
    }
}

/// Probe the signed-in Clerk instance for which account-portal sections it
/// actually has configured, so the account panel can hide a button that would
/// otherwise open a page that doesn't exist (e.g. "Two-factor auth" when the
/// instance has no second factor configured at all).
///
/// `GET /v1/environment` is **public** — it needs no `CLERK_SECRET_KEY` and no
/// session; it's the same request Clerk JS itself issues on every page load to
/// configure the widgets it renders. So the publishable key (already public,
/// already shipped in the WebView bundle) is all this needs. The Frontend API
/// host is derived with the existing `clerk_frontend_api` (see
/// `loopback_auth.rs`) rather than re-decoding the key here; a malformed or
/// absent key is a real error, not a silent default. Neither the key nor the
/// response body is ever logged.
#[tauri::command]
pub async fn clerk_portal_capabilities(
    publishable_key: String,
) -> AdgitterResult<ClerkPortalCapabilities> {
    let fapi = crate::loopback_auth::clerk_frontend_api(&publishable_key).ok_or_else(|| {
        AdgitterError::Internal(
            "cannot check the Clerk instance's capabilities: the publishable key is missing or \
             malformed."
                .into(),
        )
    })?;
    let url = format!(
        "https://{fapi}/v1/environment?__clerk_api_version=2025-04-10&_clerk_js_version=5.0.0"
    );
    let client = reqwest::Client::builder()
        .timeout(CLERK_ENVIRONMENT_TIMEOUT)
        .build()
        .map_err(|e| AdgitterError::Internal(format!("could not build an HTTP client: {e}")))?;
    let resp =
        client.get(&url).send().await.map_err(|e| {
            AdgitterError::Internal(format!("could not reach the Clerk instance: {e}"))
        })?;
    // A non-2xx answer is a *failed probe*, not an instance with nothing
    // configured. Reporting it as the latter would silently hide the very
    // buttons this probe exists to govern, so a Clerk hiccup would look
    // exactly like "your instance has no 2FA". The caller has a fallback for
    // an error (show the default set); it has none for a confident lie.
    let status = resp.status();
    if !status.is_success() {
        return Err(AdgitterError::Internal(format!(
            "the Clerk instance refused the capability probe (HTTP {})",
            status.as_u16()
        )));
    }
    // Past the status check, stay tolerant: an unparsable body still yields an
    // honest "nothing configured" rather than failing the settings panel over
    // what is, at worst, a cosmetic capability probe.
    let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
    Ok(parse_clerk_environment(&body))
}

#[cfg(test)]
mod clerk_portal_capabilities_tests {
    use super::*;

    /// Shaped like the real `discrete-ibex-7.clerk.accounts.dev` response that
    /// motivated this command: Organizations off, no attribute configured as a
    /// second factor, both hosted URLs present.
    #[test]
    fn parses_the_real_instance_shape() {
        let payload = serde_json::json!({
            "display_config": {
                "user_profile_url": "https://accounts.example.dev/user",
                "organization_profile_url": "https://accounts.example.dev/organization"
            },
            "organization_settings": { "enabled": false },
            "user_settings": {
                "attributes": {
                    "email_address": { "enabled": true, "used_for_second_factor": false },
                    "password": { "enabled": true, "used_for_second_factor": false },
                    "totp": { "enabled": false, "used_for_second_factor": false },
                    "backup_code": { "enabled": false, "used_for_second_factor": false }
                }
            }
        });
        let caps = parse_clerk_environment(&payload);
        assert_eq!(
            caps.user_profile_url.as_deref(),
            Some("https://accounts.example.dev/user")
        );
        assert_eq!(
            caps.organization_profile_url.as_deref(),
            Some("https://accounts.example.dev/organization")
        );
        assert!(!caps.organizations_enabled);
        assert!(!caps.mfa_enabled);
    }

    /// Any attribute with `used_for_second_factor: true` turns MFA on — not
    /// just `totp`.
    #[test]
    fn any_second_factor_attribute_enables_mfa() {
        let payload = serde_json::json!({
            "user_settings": {
                "attributes": {
                    "totp": { "enabled": true, "used_for_second_factor": true },
                    "email_address": { "enabled": true, "used_for_second_factor": false }
                }
            }
        });
        assert!(parse_clerk_environment(&payload).mfa_enabled);
    }

    /// `authenticator_app` and `backup_code` exist only as second factors, so
    /// an instance that reports one as plain `enabled` has MFA — accepting
    /// that shape too keeps the button visible on a portal that really does
    /// render the section. The live instance carries the same two attribute
    /// names with both flags false, which is what `parses_the_real_instance_shape`
    /// pins; this is the mirror case.
    #[test]
    fn an_enabled_authenticator_app_counts_as_mfa() {
        for attr in ["authenticator_app", "backup_code"] {
            let payload = serde_json::json!({
                "user_settings": {
                    "attributes": { attr: { "enabled": true, "used_for_second_factor": false } }
                }
            });
            assert!(
                parse_clerk_environment(&payload).mfa_enabled,
                "an enabled {attr} must read as MFA"
            );
        }
        // An attribute that is *not* inherently a second factor must not:
        // every account has an enabled password, and that is not 2FA.
        let payload = serde_json::json!({
            "user_settings": {
                "attributes": { "password": { "enabled": true, "used_for_second_factor": false } }
            }
        });
        assert!(!parse_clerk_environment(&payload).mfa_enabled);
    }

    /// An empty or garbled payload must degrade to "nothing configured", never
    /// panic — this is what a shape change on Clerk's side, or a network body
    /// that isn't the environment doc at all, looks like.
    #[test]
    fn an_empty_or_garbage_payload_is_all_false_and_never_panics() {
        for payload in [
            serde_json::json!({}),
            serde_json::Value::Null,
            serde_json::json!({ "unexpected": "shape", "user_settings": "not an object" }),
            serde_json::json!({ "organization_settings": "also not an object" }),
        ] {
            let caps = parse_clerk_environment(&payload);
            assert_eq!(caps.user_profile_url, None);
            assert_eq!(caps.organization_profile_url, None);
            assert!(!caps.organizations_enabled);
            assert!(!caps.mfa_enabled);
        }
    }
}

// ── Device / seat management ────────────────────────────────
//
// The signed-in account's devices are managed server-side (the license server), so
// the desktop just proxies list/remove over HTTP using the same `ADGITTER_API_URL`
// base + reqwest client as `issue_license`, authenticated with the persisted
// token (keychain-first, plugin-store fallback — the same read path as
// `verify_license(None)`). The live server isn't deployed yet, so `list_devices`
// degrades to a clean empty list on any auth/network failure rather than erroring
// (the UI shows a friendly "sign in to sync" state); `remove_device` surfaces a
// typed error. Neither ever panics.

/// IPC-facing view of a registered device (camelCase per convention). Also the
/// wire shape decoded from `GET /devices`, so it round-trips server → UI.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceDto {
    /// Server-side device id (used as the `remove_device` argument).
    pub id: String,
    /// Human-readable device name (e.g. hostname).
    pub name: String,
    /// Last-seen timestamp (Unix ms); 0 when unknown.
    #[serde(default)]
    pub last_seen: u64,
    /// True for the device this app instance runs on.
    #[serde(default)]
    pub current: bool,
}

/// Fetch the account's devices from `<base>/devices` (pure network helper, kept
/// separate so `list_devices` can map any failure to an empty list).
async fn fetch_devices(url: &str, token: &str) -> Result<Vec<DeviceDto>, reqwest::Error> {
    reqwest::Client::new()
        .get(url)
        .bearer_auth(token)
        .send()
        .await?
        .error_for_status()?
        .json::<Vec<DeviceDto>>()
        .await
}

/// List the signed-in account's registered devices. Reads the persisted
/// token (keychain-first) for auth; with no token — or on any network/parse
/// failure (the server isn't deployed yet) — resolves to an empty list so the UI
/// renders its friendly empty state instead of an error.
#[tauri::command]
pub async fn list_devices(app: AppHandle) -> AdgitterResult<Vec<DeviceDto>> {
    let Some(token) = stored_token(&app).await else {
        return Ok(Vec::new());
    };
    let url = format!("{}/devices", api_base().trim_end_matches('/'));
    Ok(fetch_devices(&url, &token).await.unwrap_or_default())
}

/// Remove (deauthorize) a device by id. DELETEs `<base>/devices/{id}`
/// with the persisted token. Returns a typed error when signed-out or on a
/// network/HTTP failure; never panics.
#[tauri::command]
pub async fn remove_device(app: AppHandle, device_id: String) -> AdgitterResult<()> {
    let token = stored_token(&app)
        .await
        .ok_or_else(|| AdgitterError::Internal("not signed in".into()))?;
    let url = format!("{}/devices/{}", api_base().trim_end_matches('/'), device_id);
    reqwest::Client::new()
        .delete(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| AdgitterError::Internal(format!("device removal failed: {e}")))?
        .error_for_status()
        .map_err(|e| AdgitterError::Internal(format!("device removal rejected: {e}")))?;
    Ok(())
}

/// DEBUG-ONLY: mint a signed dev license with the committed TEST key (feature
/// `mint`) and return the token. The frontend can store it and feed it to
/// `verify_license`. Inert in release builds: the signing path is never reached
/// and the command returns an error.
#[tauri::command]
pub async fn mint_test_license(plan: String, valid_days: i64) -> AdgitterResult<String> {
    #[cfg(debug_assertions)]
    {
        Ok(build_dev_token(parse_dev_plan(&plan)?, valid_days))
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = (plan, valid_days);
        Err(AdgitterError::Internal(
            "mint_test_license is disabled in release builds".into(),
        ))
    }
}

/// DEBUG-ONLY: mint a signed dev license for `plan`, **persist** it (keychain /
/// plugin-store), and return the verified status. Unlike `mint_test_license`
/// this makes the license the *active* one. ~10-year validity. Inert in release
/// builds (returns an error; no signing path is reached).
///
/// ⚠️ **Not the way to unlock paid features in dev — use `VITE_DEV_PLAN`.**
/// This exists to exercise the *signed-in* flows (account panel, sign-out,
/// renewal) without a live server, and it is no longer called on startup.
///
/// The token it writes carries `email: dev@adgitter.local`, and the account
/// email is the default git commit author (`account_email_from`). It does not
/// leak into commits today only because the token is bound to `"dev-device"` and
/// so fails this install's device check — i.e. the safety is incidental. If you
/// are tempted to "fix" that device id to make paid commands work: don't. That
/// change would author real commits with a fabricated address, permanently.
/// `dev_unlock.rs` unlocks the features without touching identity at all.
#[tauri::command]
pub async fn dev_seed_license(app: AppHandle, plan: String) -> AdgitterResult<LicenseStatusDto> {
    #[cfg(debug_assertions)]
    {
        let token = build_dev_token(parse_dev_plan(&plan)?, 3650);
        persist_token(&app, &token).await;
        Ok(verify_token(&token, None))
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = (app, plan);
        Err(AdgitterError::Internal(
            "dev_seed_license is disabled in release builds".into(),
        ))
    }
}

/// DEBUG-ONLY: retarget the dev paid-feature unlock at `plan` for the rest of
/// this process, so the native gates agree with the account menu's dev plan
/// switcher. `None` means **no override**: fall through to the real licence,
/// ignoring even a baked `VITE_DEV_PLAN`.
///
/// # Why this one is `#[cfg]`-absent rather than `#[cfg]`-refusing
///
/// Its sibling `dev_seed_license` exists in every build and returns an error in
/// release. That shape is fine for something that merely writes a token nothing
/// will accept. It is **not** fine here: this is a live setter for the paid
/// entitlement gate, and anything executing in the webview can `invoke` a
/// registered command. A command that exists and refuses is one bad `cfg`
/// expression away from a command that exists and obeys; a command that is not
/// in the binary cannot be invoked at all, however the refusal is written.
///
/// So this command, and its line in `lib.rs`'s `generate_handler!`, are both
/// `#[cfg(debug_assertions)]`, and neither has a release-side fallback:
///
/// - delete the guard here → the body's `crate::dev_unlock::set_runtime_plan`
///   has no module to resolve against in release, and the build fails;
/// - delete the guard on the registration → `commands::set_dev_plan` is
///   unresolved in release, and the build fails;
/// - delete the guard on `mod dev_unlock` itself → its `compile_error!` fires.
///
/// Three ways to remove the gate, three failed release builds. None of them is
/// reachable from configuration: there is no env var, setting or runtime toggle
/// that can put this command into a release binary — only recompiling with
/// `debug_assertions` on, which is what "a debug build" means.
#[cfg(debug_assertions)]
#[tauri::command]
pub async fn set_dev_plan(plan: Option<String>) -> AdgitterResult<()> {
    let next = match plan.as_deref() {
        // Absent/`null` is the menu's "no override — use the real licence".
        None => None,
        // `Plan::from_str` is the single validator and it is strict: an empty
        // or misspelled tier is refused loudly rather than silently unlocking
        // (or silently locking) something the developer did not ask for.
        Some(raw) => Some(parse_dev_plan(raw)?),
    };
    crate::dev_unlock::set_runtime_plan(next);
    Ok(())
}

#[cfg(test)]
mod license_tests {
    use super::*;

    fn sample(plan: license::Plan, expires_ms: u64) -> license::License {
        license::License {
            trial_ends_ms: None,
            plan,
            subject: "dev@local".to_string(),
            device_id: "dev-device".to_string(),
            features: vec![],
            owned_themes: vec![],
            seats: None,
            issued_ms: 0,
            expires_ms,
            iat_ms: 0,
            device_limit: 3,
            email: Some("ada@example.com".to_string()),
            name: Some("Ada Lovelace".to_string()),
            avatar_url: None,
            username: Some("ada".to_string()),
        }
    }

    #[test]
    fn plan_str_matches_lowercase_serde() {
        assert_eq!(plan_str(license::Plan::Free), "free");
        assert_eq!(plan_str(license::Plan::Basic), "basic");
        assert_eq!(plan_str(license::Plan::Advance), "advance");
        assert_eq!(plan_str(license::Plan::Enterprise), "enterprise");
    }

    #[test]
    fn dto_maps_active_grace_invalid() {
        let active = status_to_dto(license::LicenseStatus::Active(sample(
            license::Plan::Advance,
            42,
        )));
        assert_eq!(active.status, "active");
        assert_eq!(active.plan.as_deref(), Some("advance"));
        assert_eq!(active.expires_ms, Some(42));
        assert!(active.error.is_none());

        let grace = status_to_dto(license::LicenseStatus::Grace(sample(
            license::Plan::Basic,
            7,
        )));
        assert_eq!(grace.status, "grace");
        assert_eq!(grace.plan.as_deref(), Some("basic"));
        assert_eq!(grace.expires_ms, Some(7));

        let invalid = status_to_dto(license::LicenseStatus::Invalid(
            license::LicenseError::Expired,
        ));
        assert_eq!(invalid.status, "invalid");
        assert!(invalid.plan.is_none());
        assert!(invalid.expires_ms.is_none());
        assert!(invalid.error.is_some());
    }

    #[test]
    fn dto_serializes_camel_case() {
        let json = serde_json::to_string(&status_to_dto(license::LicenseStatus::Active(sample(
            license::Plan::Basic,
            99,
        ))))
        .unwrap();
        assert!(json.contains("\"expiresMs\":99"), "got {json}");
        assert!(json.contains("\"status\":\"active\""), "got {json}");
    }

    // ── Account email on the DTO ────────────────────────────────────

    /// The account panel showed a dash forever because the DTO never carried an
    /// address. It must reach the frontend for a valid license…
    #[test]
    fn a_valid_license_exposes_the_account_email() {
        let active = status_to_dto(license::LicenseStatus::Active(sample(
            license::Plan::Advance,
            42,
        )));
        assert_eq!(active.email.as_deref(), Some("ada@example.com"));

        let grace = status_to_dto(license::LicenseStatus::Grace(sample(
            license::Plan::Basic,
            7,
        )));
        assert_eq!(grace.email.as_deref(), Some("ada@example.com"));
    }

    /// …and must not for an invalid one: an unverified token's payload is not
    /// evidence of anything, least of all of who the user is.
    #[test]
    fn an_invalid_license_exposes_no_email() {
        let invalid = status_to_dto(license::LicenseStatus::Invalid(
            license::LicenseError::BadSignature,
        ));
        assert_eq!(invalid.email, None);
        assert_eq!(invalid_dto("no license token").email, None);
    }

    /// A token minted before the `email` claim existed must still map cleanly —
    /// no address, everything else intact.
    #[test]
    fn a_pre_email_license_maps_to_no_email() {
        let dto = status_to_dto(license::LicenseStatus::Active(license::License {
            email: None,
            ..sample(license::Plan::Basic, 5)
        }));
        assert_eq!(dto.status, "active");
        assert_eq!(dto.email, None);
    }

    /// The address is PII. It may reach the frontend (the user's own account
    /// panel) but must never appear in an error string, which is logged and is
    /// eligible for a telemetry packet.
    #[test]
    fn no_dto_error_string_can_contain_an_address() {
        for status in [
            license::LicenseStatus::Invalid(license::LicenseError::BadSignature),
            license::LicenseStatus::Invalid(license::LicenseError::Expired),
            license::LicenseStatus::Invalid(license::LicenseError::DeviceMismatch),
            license::LicenseStatus::Invalid(license::LicenseError::Malformed),
            license::LicenseStatus::Invalid(license::LicenseError::FeatureNotEntitled),
        ] {
            let dto = status_to_dto(status);
            let err = dto.error.unwrap_or_default();
            assert!(!err.contains('@'), "error leaked an address: {err}");
        }
    }

    /// `telemetry::scrub` is the shared backstop for anything that does get
    /// logged; confirm an address cannot survive it, so even a future accidental
    /// log line is masked rather than recorded.
    #[test]
    fn telemetry_scrubbing_masks_an_account_address() {
        let scrubbed = telemetry::scrub("commit authored as ada@example.com");
        assert!(!scrubbed.contains("ada@example.com"), "{scrubbed}");
        assert!(scrubbed.contains("<email>"), "{scrubbed}");
    }

    // ── Fallback identity derivation ────────────────────────────────
    //
    // The precedence rule itself lives in (and is tested by) `git-core`; what
    // matters here is that the shell hands it a well-formed value, and nothing
    // at all when the license has no usable address.

    #[test]
    fn a_license_email_becomes_a_usable_fallback_identity() {
        let id = git_core::FallbackIdentity::from_account_email("ada@example.com").unwrap();
        assert_eq!(id.email(), "ada@example.com");
        assert_eq!(id.name(), "ada");
    }

    #[test]
    fn a_license_without_a_usable_email_registers_no_fallback() {
        for missing in [None, Some(""), Some("   "), Some("garbage")] {
            let id = missing.and_then(git_core::FallbackIdentity::from_account_email);
            assert_eq!(id, None, "{missing:?} must not become a fallback");
        }
    }

    // With no LICENSE_PUBLIC_KEY baked in, debug builds fall back to the TEST
    // verifying key; that key must verify tokens minted by the TEST signing key.
    //
    // `None` is passed explicitly rather than calling `resolve_public_key()`:
    // `option_env!` is fixed at compile time, so whether a key is baked depends
    // on the developer's `.env`. Reading it here made this test fail for anyone
    // who configured a real key — i.e. for anyone who set the app up to sign in
    // against the live service.
    #[cfg(debug_assertions)]
    #[test]
    fn debug_resolves_test_key_and_round_trips() {
        let key = resolve_public_key_from(None).expect("debug build must resolve the TEST key");
        assert_eq!(key, license::test_keys::verifying_key_bytes());

        let lic = sample(license::Plan::Basic, u64::MAX);
        let token = license::sign(&lic, &license::test_keys::signing_key());
        let dto = status_to_dto(license::verify(&token, &key, 1_000, None));
        assert_eq!(dto.status, "active");
        assert_eq!(dto.plan.as_deref(), Some("basic"));
    }

    // The production direction: a baked key must be used, not the TEST fallback.
    // Without this, nothing would catch a regression that silently ignored the
    // configured key and verified against the committed test key instead.
    #[test]
    fn a_baked_key_wins_over_the_test_fallback() {
        let baked = STANDARD.encode([7u8; 32]);
        assert_eq!(resolve_public_key_from(Some(&baked)), Some([7u8; 32]));
        assert_ne!(
            resolve_public_key_from(Some(&baked)),
            resolve_public_key_from(None),
            "a configured key must not resolve to the test key"
        );
    }

    // A malformed baked key is a build misconfiguration, not a reason to panic
    // or to trust a half-decoded key.
    #[test]
    fn a_malformed_baked_key_falls_through_instead_of_panicking() {
        assert_eq!(
            resolve_public_key_from(Some("not base64!!")),
            resolve_public_key_from(None)
        );
        assert_eq!(
            resolve_public_key_from(Some(&STANDARD.encode([1u8; 8]))),
            resolve_public_key_from(None)
        );
    }

    // A license bound to a device, minted with the TEST key. Mirrors the token
    // `issue_license` receives from the server so the verify+map path is testable
    // without a live network POST.
    #[cfg(debug_assertions)]
    fn issued_token(plan: license::Plan, device_id: &str) -> String {
        let lic = license::License {
            device_id: device_id.to_string(),
            ..sample(plan, u64::MAX)
        };
        license::sign(&lic, &license::test_keys::signing_key())
    }

    // The exact offline verify+map `issue_license` runs on the server's token:
    // a device-matched, in-date token maps to an `active` DTO with the plan.
    #[cfg(debug_assertions)]
    #[test]
    fn issued_token_maps_to_active_dto() {
        let token = issued_token(license::Plan::Advance, "machine-1");
        let dto = verify_token_with(&token, Some("machine-1"), resolve_public_key_from(None));
        assert_eq!(dto.status, "active");
        assert_eq!(dto.plan.as_deref(), Some("advance"));
        assert!(dto.error.is_none());
    }

    // Device binding: the same token verified on a different machine is
    // rejected — so `issue_license` would never persist it.
    #[cfg(debug_assertions)]
    #[test]
    fn issued_token_device_mismatch_is_invalid() {
        let token = issued_token(license::Plan::Advance, "machine-1");
        let dto = verify_token_with(&token, Some("other-machine"), resolve_public_key_from(None));
        assert_eq!(dto.status, "invalid");
        assert!(dto.plan.is_none());
        assert!(
            dto.error
                .as_deref()
                .unwrap_or("")
                .contains("different device"),
            "got {:?}",
            dto.error
        );
    }

    // Why session restore passes `pin_device: true`. Verified *without* a device
    // the very same stolen token reads as a perfectly good `active` license —
    // which is exactly how a `license.json` copied off another machine would
    // have presented itself as a signed-in session. Pinning is the difference.
    #[cfg(debug_assertions)]
    #[test]
    fn an_unpinned_check_cannot_see_a_device_mismatch() {
        let token = issued_token(license::Plan::Advance, "machine-1");
        let key = resolve_public_key_from(None);
        assert_eq!(verify_token_with(&token, None, key).status, "active");
        assert_eq!(
            verify_token_with(&token, Some("machine-2"), key).status,
            "invalid"
        );
    }

    // Session restore accepts `grace` as well as `active`: an expired card is a
    // billing problem, not a reason to tell someone they are logged out.
    #[cfg(debug_assertions)]
    #[test]
    fn a_license_inside_the_grace_window_still_restores() {
        let lic = license::License {
            device_id: "machine-1".to_string(),
            ..sample(license::Plan::Basic, now_ms() - 1_000)
        };
        let token = license::sign(&lic, &license::test_keys::signing_key());
        let dto = verify_token_with(&token, Some("machine-1"), resolve_public_key_from(None));
        assert_eq!(dto.status, "grace");
        assert_eq!(dto.plan.as_deref(), Some("basic"));
    }

    // Past the grace window it is over: `invalid`, so restore leaves the app
    // signed out rather than showing a session no server would honour.
    #[cfg(debug_assertions)]
    #[test]
    fn a_license_past_the_grace_window_restores_nothing() {
        let expired = now_ms() - license::GRACE_MS - 1_000;
        let lic = license::License {
            device_id: "machine-1".to_string(),
            ..sample(license::Plan::Basic, expired)
        };
        let token = license::sign(&lic, &license::test_keys::signing_key());
        let dto = verify_token_with(&token, Some("machine-1"), resolve_public_key_from(None));
        assert_eq!(dto.status, "invalid");
        assert!(dto.plan.is_none());
    }

    // The device id must survive every restart — a rotating id would re-bind the
    // license and eat another seat each launch (see `device_id`).
    #[test]
    fn a_persisted_device_id_is_reused_verbatim() {
        let (id, is_new) = resolve_device_id(Some("2b9d0e1c-0000-4000-8000-abcdefabcdef"));
        assert_eq!(id, "2b9d0e1c-0000-4000-8000-abcdefabcdef");
        assert!(!is_new, "an existing id must not be regenerated");
    }

    // First run (and a store that came back blank/whitespace) mints a fresh
    // random id, flagged as new so the caller persists it.
    #[test]
    fn a_missing_device_id_is_generated_and_flagged_new() {
        for existing in [None, Some(""), Some("   ")] {
            let (id, is_new) = resolve_device_id(existing);
            assert!(is_new, "{existing:?} should mint a new id");
            let parsed = uuid::Uuid::parse_str(&id).expect("a valid uuid");
            assert_eq!(parsed.get_version_num(), 4, "must be random, not derived");
        }
    }

    /// An in-memory stand-in for the plugin store, with a switchable `save`
    /// failure — the only way to exercise the persist-failure path without a
    /// running Tauri app. Mirrors the real store's semantics: `set` mutates the
    /// map immediately, `save` is the separate step that can fail.
    #[derive(Default)]
    struct FakeStore {
        value: std::cell::RefCell<Option<String>>,
        save_fails: std::cell::Cell<bool>,
        saves: std::cell::Cell<usize>,
    }

    impl DeviceIdStore for FakeStore {
        fn get_id(&self) -> Option<String> {
            self.value.borrow().clone()
        }
        fn set_id(&self, id: &str) {
            *self.value.borrow_mut() = Some(id.to_string());
        }
        fn delete_id(&self) {
            *self.value.borrow_mut() = None;
        }
        fn save(&self) -> Result<(), String> {
            self.saves.set(self.saves.get() + 1);
            if self.save_fails.get() {
                Err("disk full".to_string())
            } else {
                Ok(())
            }
        }
    }

    // The happy path: mint once, persist once, then reuse — no second write.
    #[test]
    fn device_id_persists_once_then_reuses() {
        let store = FakeStore::default();
        let first = device_id_from_store(&store).expect("first call mints and persists");
        assert_eq!(store.saves.get(), 1);
        let second = device_id_from_store(&store).expect("second call reuses");
        assert_eq!(second, first, "the persisted id must be reused verbatim");
        assert_eq!(store.saves.get(), 1, "a reused id must not be re-saved");
    }

    // A failed save must not leave the un-persisted id behind: otherwise the
    // *next* call in the same session reads it back, takes the "already have
    // one" path, skips saving and returns Ok — an id that vanishes on restart
    // and burns a fresh device seat on every launch, which is precisely what
    // the loud failure exists to prevent.
    #[test]
    fn a_device_id_that_could_not_be_saved_is_not_left_behind() {
        let store = FakeStore::default();
        store.save_fails.set(true);

        let err = device_id_from_store(&store).expect_err("a failed save must be loud");
        assert!(
            format!("{err:?}").contains("could not persist device id"),
            "got {err:?}"
        );
        assert!(
            store.get_id().is_none(),
            "the un-persisted id must be rolled out of the store"
        );

        // Still failing ⇒ still loud, and it really did re-attempt the write.
        assert!(device_id_from_store(&store).is_err(), "must stay loud");
        assert_eq!(store.saves.get(), 2, "every call must re-attempt the save");

        // Once the store recovers, the very next call succeeds and persists.
        store.save_fails.set(false);
        let id = device_id_from_store(&store).expect("recovered store persists");
        assert_eq!(store.get_id().as_deref(), Some(id.as_str()));
        assert_eq!(
            device_id_from_store(&store).expect("stable"),
            id,
            "the persisted id is now stable across calls"
        );
    }

    // ── Sign-out destroys local credentials (2026-08-18 decision) ───────────
    //
    // Sign-out used to reset only the frontend view, leaving the licence token
    // in the keychain: "signed out" and "paid features unlocked" coexisted, and
    // commits kept being authored with the signed-out account's address. These
    // tests pin each piece of that.

    /// Serialises **every** test that calls `destroy_credentials`.
    ///
    /// Not optional bookkeeping: `destroy_credentials` clears `git-core`'s
    /// process-global fallback identity as part of its job, so any two of these
    /// tests running concurrently (cargo's default) have one clearing the
    /// identity the other just registered. That is precisely how the
    /// identity-clearing assertions failed spuriously the first time round.
    static SIGN_OUT_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// Take [`SIGN_OUT_LOCK`], ignoring poisoning — a panic in one sign-out test
    /// must fail that test, not cascade into the rest.
    fn sign_out_guard() -> std::sync::MutexGuard<'static, ()> {
        SIGN_OUT_LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Both persisted token copies, in memory, with independently switchable
    /// delete failures. Two separate slots is the point: the real bug shape is
    /// "one copy deleted, the other left behind", and `stored_token` reads
    /// `keychain.or_else(store)`, so a survivor in *either* slot signs the user
    /// back in on the next launch.
    #[derive(Default)]
    struct FakeCredentials {
        keychain: std::cell::Cell<bool>,
        store: std::cell::Cell<bool>,
        keychain_delete_fails: std::cell::Cell<bool>,
        store_delete_fails: std::cell::Cell<bool>,
        keychain_deletes: std::cell::Cell<usize>,
        store_deletes: std::cell::Cell<usize>,
    }

    impl FakeCredentials {
        /// Both copies present — `persist_token`'s debug-build outcome, and the
        /// state any release build lands in when the keychain was unavailable.
        fn with_both_copies() -> Self {
            let f = Self::default();
            f.keychain.set(true);
            f.store.set(true);
            f
        }
    }

    impl CredentialStores for FakeCredentials {
        fn delete_keychain_token(&self) -> bool {
            self.keychain_deletes.set(self.keychain_deletes.get() + 1);
            if self.keychain_delete_fails.get() {
                return false;
            }
            self.keychain.set(false);
            true
        }
        fn delete_store_token(&self) -> bool {
            self.store_deletes.set(self.store_deletes.get() + 1);
            if self.store_delete_fails.get() {
                return false;
            }
            self.store.set(false);
            true
        }
        fn token_remains(&self) -> bool {
            // Exactly `stored_token`'s rule: keychain first, then the file.
            self.keychain.get() || self.store.get()
        }
    }

    /// **The regression this work exists for.** Deleting one copy is not
    /// deleting the token: a debug build (and any keychain-less release build)
    /// keeps a second copy in `license.json`, and `stored_token` falls through
    /// to it — so the app is fully entitled again after a restart. Both slots
    /// must be empty, asserted separately.
    #[test]
    fn signing_out_destroys_both_persisted_token_copies() {
        let _guard = sign_out_guard();
        let creds = FakeCredentials::with_both_copies();

        let report = destroy_credentials(&creds);

        assert!(!creds.keychain.get(), "the keychain copy must be destroyed");
        assert!(
            !creds.store.get(),
            "the plugin-store copy must be destroyed — `stored_token` reads it \
             when the keychain has none"
        );
        assert!(
            !creds.token_remains(),
            "no token may be readable afterwards"
        );
        assert_eq!(report, SignOutReport::default(), "nothing survived");
    }

    /// A keychain that refuses to delete must not stop the *store* copy from
    /// being removed. A `&&`/`?` short-circuit here would leave the readable
    /// fallback copy behind — the exact failure the two-slot design invites.
    #[test]
    fn a_failing_keychain_delete_does_not_skip_the_store_delete() {
        let _guard = sign_out_guard();
        let creds = FakeCredentials::with_both_copies();
        creds.keychain_delete_fails.set(true);

        let report = destroy_credentials(&creds);

        assert_eq!(creds.store_deletes.get(), 1, "the store delete must run");
        assert!(!creds.store.get(), "the store copy must still be destroyed");
        assert!(
            report.token_remains,
            "the surviving keychain copy must be reported, not swallowed"
        );
    }

    /// …and symmetrically.
    #[test]
    fn a_failing_store_delete_does_not_skip_the_keychain_delete() {
        let _guard = sign_out_guard();
        let creds = FakeCredentials::with_both_copies();
        creds.store_delete_fails.set(true);

        let report = destroy_credentials(&creds);

        assert_eq!(creds.keychain_deletes.get(), 1);
        assert!(!creds.keychain.get());
        assert!(report.token_remains);
    }

    /// Signing out with nothing stored is a no-op that still reports clean —
    /// sign-out is idempotent and must never look like a failure.
    #[test]
    fn signing_out_twice_is_clean_and_idempotent() {
        let _guard = sign_out_guard();
        let creds = FakeCredentials::with_both_copies();
        assert!(!destroy_credentials(&creds).token_remains);
        assert!(!destroy_credentials(&creds).token_remains);
        assert_eq!(creds.keychain_deletes.get(), 2, "both calls really tried");
    }

    /// **The most important assertion in this change.** The account address is
    /// a process-global commit-author default (`git-core`'s `FALLBACK`). Leaving
    /// it set means commits written *after* sign-out carry the signed-out
    /// account's email into git history — permanent and pushed to every mirror,
    /// which is strictly worse than an unlocked paid feature. The repository-level
    /// proof ("the commit does not use the account email") lives in
    /// `git-core/tests/account_email_fallback.rs`, which owns the process-global
    /// isolation; this pins that the *shell's* sign-out is what clears it.
    #[test]
    fn signing_out_clears_the_account_commit_identity() {
        let _guard = sign_out_guard();
        git_core::set_fallback_identity(git_core::FallbackIdentity::from_account_email(
            "signed-out-user@example.com",
        ));
        assert!(
            git_core::fallback_identity().is_some(),
            "precondition: an account identity is registered"
        );

        destroy_credentials(&FakeCredentials::with_both_copies());

        assert_eq!(
            git_core::fallback_identity(),
            None,
            "a commit after sign-out must not be authored with the account email"
        );
    }

    /// The identity must be cleared **even when a token survives**. A stale
    /// entitlement is recoverable; a forged author line in history is not, so
    /// the identity clear cannot be conditional on the wipe succeeding.
    #[test]
    fn the_commit_identity_is_cleared_even_when_a_token_survives() {
        let _guard = sign_out_guard();
        git_core::set_fallback_identity(git_core::FallbackIdentity::from_account_email(
            "stuck@example.com",
        ));

        let creds = FakeCredentials::with_both_copies();
        creds.keychain_delete_fails.set(true);
        creds.store_delete_fails.set(true);
        let report = destroy_credentials(&creds);

        assert!(report.token_remains, "precondition: the wipe failed");
        assert_eq!(
            git_core::fallback_identity(),
            None,
            "the account email must stop authoring commits regardless"
        );
    }

    /// With no token left, the entitlement path resolves to invalid and every
    /// paid feature is refused — the `require_feature` half of sign-out. Asserted
    /// through `resolve_status_from`, the pure core `require_feature` reads, so no
    /// `AppHandle` is needed.
    #[test]
    fn with_no_stored_token_every_paid_feature_is_refused() {
        let status = resolve_status_from(
            resolve_public_key_from(None),
            None, // what `stored_token` returns after sign-out
            Some("machine-1"),
            now_ms(),
        );
        for f in [
            license::Feature::NoAd,
            license::Feature::MultiWindow,
            license::Feature::IssueTracker,
            license::Feature::LogAnytimeBackground,
            license::Feature::TeamSeats,
        ] {
            assert!(
                check_status_feature(&status, f).is_err(),
                "{f:?} must be refused with no licence"
            );
        }
        // …and no address is exposed either, so `sync_commit_identity` on the
        // next commit would register nothing even if sign-out had not cleared it.
        assert!(matches!(status, license::LicenseStatus::Invalid(_)));
    }

    // Two installs must not collide, so generation is random rather than derived
    // from anything about the machine.
    #[test]
    fn generated_device_ids_are_unique() {
        let (a, _) = resolve_device_id(None);
        let (b, _) = resolve_device_id(None);
        assert_ne!(a, b);
    }

    // A pro license carrying the feature. Building the status directly avoids
    // needing an `AppHandle` (which `require_feature` reads through) — the pure
    // `check_status_feature` decides grant/deny, exactly as the guard does.
    fn active_with(features: &[license::Feature]) -> license::LicenseStatus {
        let lic = license::License {
            features: features.iter().map(|f| f.as_str().to_string()).collect(),
            ..sample(license::Plan::Basic, u64::MAX)
        };
        license::LicenseStatus::Active(lic)
    }

    // Guard behavior: a free license (no features) is denied with the
    // stable FEATURE_LOCKED code; a pro license carrying the feature is allowed.
    #[test]
    fn require_feature_free_denied_pro_allowed() {
        let free = license::LicenseStatus::Active(sample(license::Plan::Free, u64::MAX));
        let err = check_status_feature(&free, license::Feature::NoAd)
            .expect_err("free tier must be locked out");
        assert_eq!(err.code(), "FEATURE_LOCKED");

        let pro = active_with(&[license::Feature::NoAd, license::Feature::ApplyTheme]);
        assert!(check_status_feature(&pro, license::Feature::NoAd).is_ok());
        // A feature the license does not carry is still locked.
        assert_eq!(
            check_status_feature(&pro, license::Feature::TeamSeats)
                .unwrap_err()
                .code(),
            "FEATURE_LOCKED"
        );
    }

    // ── Dev unlock (VITE_DEV_PLAN) ──────────────────────────────────────────
    //
    // Three properties, one per test below:
    //   1. off by default — a dev build without the switch is locked exactly as
    //      it is today;
    //   2. absent from release builds — asserted by running the very same gate
    //      with the strongest possible override under `cargo test --release`;
    //   3. no identity — the unlock grants capabilities and never an account
    //      email, so it can never author a commit.

    /// Every paid feature this app gates on. Kept exhaustive on purpose: a new
    /// `Feature` variant that is not listed here is a gate nobody checked.
    const EVERY_FEATURE: [license::Feature; 8] = [
        license::Feature::NoAd,
        license::Feature::ApplyTheme,
        license::Feature::TicketsPriority,
        license::Feature::LogAnytimeBackground,
        license::Feature::LogAnytimeSquash,
        license::Feature::TeamSeats,
        license::Feature::IssueTracker,
        license::Feature::MultiWindow,
    ];

    /// The status `require_feature` sees with no licence installed.
    fn unlicensed() -> license::LicenseStatus {
        resolve_status_from(
            resolve_public_key_from(None),
            None,
            Some("machine-1"),
            now_ms(),
        )
    }

    /// (1) With the switch unset, the gate is exactly as strict as before the
    /// dev unlock existed. `None` is what `dev_plan_override()` returns whenever
    /// `VITE_DEV_PLAN` is absent, which is every developer who has not opted in
    /// and every CI job.
    #[test]
    fn without_the_dev_switch_every_paid_feature_stays_locked() {
        let status = unlicensed();
        for f in EVERY_FEATURE {
            assert!(
                decide_feature(None, &status, f).is_err(),
                "{f:?} must stay locked with no licence and no dev override"
            );
        }
        // Nor does it loosen a licence that is merely too low a tier.
        let free = license::LicenseStatus::Active(sample(license::Plan::Free, u64::MAX));
        assert_eq!(
            decide_feature(None, &free, license::Feature::IssueTracker)
                .unwrap_err()
                .code(),
            "FEATURE_LOCKED"
        );
    }

    /// (2a) DEBUG: the override opens the gate, capped at what the tier really
    /// sells — `basic` must not reach an advance-only feature, or paid UI gets
    /// built against an entitlement nobody can buy.
    #[cfg(debug_assertions)]
    #[test]
    fn the_dev_switch_unlocks_exactly_its_tier() {
        let status = unlicensed();
        for f in EVERY_FEATURE {
            assert!(
                decide_feature(Some(license::Plan::Enterprise), &status, f).is_ok(),
                "enterprise dev override must grant {f:?}"
            );
        }
        assert!(
            decide_feature(
                Some(license::Plan::Basic),
                &status,
                license::Feature::IssueTracker,
            )
            .is_err(),
            "basic must not reach an advance-only feature"
        );
        assert!(decide_feature(
            Some(license::Plan::Basic),
            &status,
            license::Feature::MultiWindow,
        )
        .is_ok());
        // `free` is a tier, not an unlock.
        assert!(decide_feature(
            Some(license::Plan::Free),
            &status,
            license::Feature::MultiWindow,
        )
        .is_err());
    }

    /// The compile-time chain, end to end: `VITE_DEV_PLAN` → `build.rs` →
    /// `option_env!` → `dev_unlock::plan` → `dev_plan_override` → the gate.
    ///
    /// It reads the switch this binary was actually built with rather than
    /// hard-coding one, so it is meaningful either way and never goes red just
    /// because a developer legitimately configured their `.env.development`
    /// (the trap `resolve_public_key_from` documents). Both arms are real
    /// assertions:
    ///
    /// - `cargo test -p adgitter` — switch off, everything must be locked;
    /// - `VITE_DEV_PLAN=enterprise cargo test -p adgitter` — switch on,
    ///   everything must be unlocked. That second command is the acceptance
    ///   check for "the unlock actually reaches the native gates".
    #[cfg(debug_assertions)]
    #[test]
    fn the_compile_time_switch_surfaces_at_the_gate() {
        let status = unlicensed();
        let dev = dev_plan_override();
        for f in EVERY_FEATURE {
            assert_eq!(
                decide_feature(dev, &status, f).is_ok(),
                dev.is_some_and(|p| p.grants(f)),
                "{f:?}: the gate must agree with the baked switch ({dev:?})"
            );
        }
    }

    /// (2b) RELEASE: **the bypass is not in the binary.** Compiled only when
    /// `debug_assertions` is off, this feeds the gate the strongest override
    /// there is and requires a refusal anyway — the dev branch inside
    /// `decide_feature` does not exist here to honour it.
    ///
    /// Run it with `cargo test --release -p adgitter`. Setting `VITE_DEV_PLAN`
    /// for that run changes nothing, which is the point: `build.rs` refuses to
    /// bake under `PROFILE=release`, and even a baked value has no reader.
    #[cfg(not(debug_assertions))]
    #[test]
    fn a_release_build_has_no_dev_unlock() {
        assert_eq!(
            dev_plan_override(),
            None,
            "a release build must not resolve a dev tier at all"
        );
        let status = unlicensed();
        for plan in [
            license::Plan::Free,
            license::Plan::Basic,
            license::Plan::Advance,
            license::Plan::Enterprise,
        ] {
            for f in EVERY_FEATURE {
                assert!(
                    decide_feature(Some(plan), &status, f).is_err(),
                    "release must refuse {f:?} even asked to honour {plan:?}"
                );
            }
        }
    }

    /// (2c) RELEASE: **the runtime setter is not even a command there.**
    ///
    /// `decide_feature` above proves the *decision* is absent from a release
    /// build. This pins the thing that made a runtime switch riskier than the
    /// compile-time one it joins: `set_dev_plan` is an IPC entry point, and a
    /// registered command is invokable by anything running in the webview. The
    /// only durable defence is that the command is not in the binary.
    ///
    /// Absence is awkward to assert from inside the binary that lacks it — you
    /// cannot name the item you are claiming does not exist without failing to
    /// compile. So this reads the two source files and requires each guard to
    /// be physically present, which is exactly the edit that would re-open the
    /// hole. It runs in **both** profiles (there is nothing profile-specific
    /// about "the guard is written down") and it is the executable half of a
    /// three-part argument; the other two are compile failures, not tests:
    ///
    ///   - drop the guard on the definition → release cannot resolve
    ///     `crate::dev_unlock` (there is no `#[cfg(not(debug_assertions))]`
    ///     fallback arm to fall into);
    ///   - drop the guard on `mod dev_unlock` → its `compile_error!` fires.
    ///
    /// The third leg is empirical: a release `.rlib` contains no `set_dev_plan`
    /// string, because `generate_handler!` only emits the name it was given.
    #[test]
    fn the_runtime_dev_switch_is_guarded_out_of_release_builds() {
        // The definition. Matched as the exact attribute sequence so the guard
        // cannot be satisfied by a `#[cfg(debug_assertions)]` somewhere else in
        // the file — including the ones in this very test module, which is why
        // the needle carries the `#[tauri::command]` and the signature too.
        let commands_rs = include_str!("commands.rs");
        assert!(
            commands_rs.contains(concat!(
                "#[cfg(debug_assertions)]\n",
                "#[tauri::command]\n",
                "pub async fn set_dev_plan(plan: Option<String>)",
            )),
            "set_dev_plan must be defined behind #[cfg(debug_assertions)] — a \
             runtime paid-feature setter must not exist in a release binary"
        );
        // And it must not have grown a release-side arm — the `dev_seed_license`
        // shape, which is what would let the definition survive the guard's
        // removal. The needle is split across two literals so this file's own
        // text does not satisfy the search it is performing (it did, first try).
        assert!(
            !commands_rs.contains(concat!("set_dev_plan is ", "disabled in release")),
            "set_dev_plan must be ABSENT in release, not present-and-refusing"
        );

        // The registration. A guarded definition that is registered
        // unconditionally does not compile in release, but asserting it here
        // names the requirement instead of leaving it to a build error.
        let lib_rs = include_str!("lib.rs");
        assert!(
            lib_rs.contains(concat!(
                "#[cfg(debug_assertions)]\n",
                "            commands::set_dev_plan,",
            )),
            "the set_dev_plan handler registration must be #[cfg(debug_assertions)] — \
             an unregistered command cannot be invoked from the webview"
        );

        // …and the module the setter lives in is itself debug-only, so there is
        // no third path by which the bypass reaches a shipped binary.
        assert!(
            lib_rs.contains("#[cfg(debug_assertions)]\nmod dev_unlock;"),
            "mod dev_unlock must stay #[cfg(debug_assertions)]"
        );
    }

    /// (3) **The unlock grants capabilities, never an identity.** A forged
    /// licence in `resolve_license_status` would have been the shorter fix and
    /// would also have handed `account_email` a made-up address — which git
    /// would then write into commits as the author, permanently. So the
    /// identity path derives from a verified licence and nothing else, and this
    /// asserts both halves at once: the gate opens, the address does not appear.
    #[test]
    fn the_dev_unlock_never_supplies_a_commit_identity() {
        let status = unlicensed();

        // The capability really is granted (in a debug build) — so the identity
        // assertions below are not passing merely because nothing is unlocked.
        #[cfg(debug_assertions)]
        assert!(decide_feature(
            Some(license::Plan::Enterprise),
            &status,
            license::Feature::IssueTracker,
        )
        .is_ok());

        // …and yet there is no account address, and therefore no fallback
        // author, anywhere in the commit path.
        assert_eq!(
            account_email_from(status.clone()),
            None,
            "an unlicensed install must not expose an account email"
        );
        assert_eq!(
            fallback_identity_from(status),
            None,
            "the dev unlock must never author a commit"
        );

        // A real licence still supplies its own address — the guarantee is
        // "only from a verified licence", not "never".
        let real = license::LicenseStatus::Active(license::License {
            email: Some("ada@example.com".to_string()),
            ..sample(license::Plan::Enterprise, u64::MAX)
        });
        assert_eq!(
            account_email_from(real),
            Some("ada@example.com".to_string())
        );
    }

    // The paid Log-Anytime commands gate on these features: free is
    // locked out via the same FEATURE_LOCKED code, advance+ is allowed. This is
    // the desktop half of the T010 gate matrix.
    #[test]
    fn log_anytime_gate_denies_free_allows_advance() {
        let free = license::LicenseStatus::Active(sample(license::Plan::Free, u64::MAX));
        for f in [
            license::Feature::LogAnytimeSquash,
            license::Feature::LogAnytimeBackground,
        ] {
            assert_eq!(
                check_status_feature(&free, f).unwrap_err().code(),
                "FEATURE_LOCKED",
                "free must not get {f:?}"
            );
        }
        let adv = active_with(&[
            license::Feature::LogAnytimeSquash,
            license::Feature::LogAnytimeBackground,
        ]);
        assert!(check_status_feature(&adv, license::Feature::LogAnytimeSquash).is_ok());
        assert!(check_status_feature(&adv, license::Feature::LogAnytimeBackground).is_ok());
    }

    // The paid issue-branch command gates on `IssueTracker`: free is
    // locked out via the same FEATURE_LOCKED code, advance+ is allowed. This is a
    // runtime gate only — the command ships in the free binary but rejects a
    // direct `invoke(...)` from a free/tampered frontend.
    #[test]
    fn issue_tracker_gate_denies_free_allows_advance() {
        let free = license::LicenseStatus::Active(sample(license::Plan::Free, u64::MAX));
        assert_eq!(
            check_status_feature(&free, license::Feature::IssueTracker)
                .unwrap_err()
                .code(),
            "FEATURE_LOCKED"
        );
        let adv = active_with(&[license::Feature::IssueTracker]);
        assert!(check_status_feature(&adv, license::Feature::IssueTracker).is_ok());
    }

    // `open_repo_window` gates on `MultiWindow` (basic+, not advance-only like
    // the two tests above): free is locked out via the same FEATURE_LOCKED
    // code, and basic — the lowest paid tier — is already enough to pass.
    #[test]
    fn multi_window_gate_denies_free_allows_basic() {
        let free = license::LicenseStatus::Active(sample(license::Plan::Free, u64::MAX));
        assert_eq!(
            check_status_feature(&free, license::Feature::MultiWindow)
                .unwrap_err()
                .code(),
            "FEATURE_LOCKED"
        );
        let basic = active_with(&[license::Feature::MultiWindow]);
        assert!(check_status_feature(&basic, license::Feature::MultiWindow).is_ok());
    }

    // ── Device binding on the entitlement path ───────────
    //
    // The hole these close: `resolve_license_status` verified with
    // `expected_device_id = None`, so copying `license.json` (or the keychain
    // item) onto a second machine unlocked every paid feature there — no code
    // change, no tampering, just a file copy, and the seat cap meant nothing.
    // The rules live in `resolve_status_from`, which takes its inputs instead of
    // reading the `AppHandle`, so the binding is provable without a Tauri
    // runtime — the very testability gap that let it ship unbound.

    const THIS_DEVICE: &str = "device-this-install";
    const OTHER_DEVICE: &str = "device-someone-elses-laptop";

    /// A genuinely signed token bound to `device`, carrying `features` and
    /// expiring at `expires_ms`. Signed with the committed TEST key, which is
    /// what `resolve_public_key` resolves to in a debug build — so these tokens
    /// are indistinguishable from real ones as far as the gate is concerned.
    fn token_for(device: &str, features: &[license::Feature], expires_ms: u64) -> String {
        let lic = license::License {
            device_id: device.to_string(),
            features: features.iter().map(|f| f.as_str().to_string()).collect(),
            ..sample(license::Plan::Advance, expires_ms)
        };
        license::sign(&lic, &license::test_keys::signing_key())
    }

    fn test_pubkey() -> Option<[u8; 32]> {
        Some(license::test_keys::verifying_key_bytes())
    }

    /// Every paid feature the desktop gates on, so a future gate cannot be
    /// added that quietly skips the device check.
    const ALL_GATED: [license::Feature; 5] = [
        license::Feature::MultiWindow,
        license::Feature::IssueTracker,
        license::Feature::LogAnytimeSquash,
        license::Feature::LogAnytimeBackground,
        license::Feature::NoAd,
    ];

    /// **The core of this fix.** A perfectly valid, unexpired, fully entitled
    /// licence that belongs to *another machine* must unlock nothing here.
    #[test]
    fn a_licence_from_another_machine_unlocks_no_paid_feature() {
        let copied = token_for(OTHER_DEVICE, &ALL_GATED, u64::MAX);

        let status = resolve_status_from(test_pubkey(), Some(&copied), Some(THIS_DEVICE), 1_000);
        assert_eq!(
            status,
            license::LicenseStatus::Invalid(license::LicenseError::DeviceMismatch),
            "a copied licence must not verify on this install"
        );
        for f in ALL_GATED {
            assert!(
                check_status_feature(&status, f).is_err(),
                "{f:?} must stay locked for a licence bound elsewhere"
            );
        }
    }

    /// …while the same licence on the machine it was issued to still works —
    /// the fix must not lock out the people who paid.
    #[test]
    fn the_same_licence_on_its_own_machine_still_unlocks() {
        let mine = token_for(THIS_DEVICE, &ALL_GATED, u64::MAX);

        let status = resolve_status_from(test_pubkey(), Some(&mine), Some(THIS_DEVICE), 1_000);
        assert!(
            matches!(status, license::LicenseStatus::Active(_)),
            "got {status:?}"
        );
        for f in ALL_GATED {
            assert!(
                check_status_feature(&status, f).is_ok(),
                "{f:?} must stay unlocked on the licensed machine"
            );
        }
    }

    /// A device id we cannot read is not permission to skip the check. Falling
    /// back to an unbound verification would restore the hole on exactly the
    /// machines least able to prove who they are.
    #[test]
    fn an_unreadable_device_id_never_degrades_to_an_unbound_check() {
        let copied = token_for(OTHER_DEVICE, &ALL_GATED, u64::MAX);
        let mine = token_for(THIS_DEVICE, &ALL_GATED, u64::MAX);

        for token in [copied, mine] {
            let status = resolve_status_from(test_pubkey(), Some(&token), None, 1_000);
            assert_eq!(
                status,
                license::LicenseStatus::Invalid(license::LicenseError::DeviceMismatch),
                "no device id ⇒ no proof of binding ⇒ no entitlement"
            );
            assert_eq!(
                check_status_feature(&status, license::Feature::MultiWindow)
                    .unwrap_err()
                    .code(),
                "LICENSE_DEVICE_MISMATCH"
            );
        }
    }

    // ── Why a denial happened is part of the answer ─────────────────────────
    //
    // With binding on, "denied" now covers a paying user on a new machine. If
    // every denial kept collapsing into FEATURE_LOCKED ("this feature needs a
    // paid plan"), the fix would tell that user to buy what they already own.

    /// Wrong machine ⇒ its own code, never the upgrade prompt.
    #[test]
    fn a_wrong_device_is_reported_as_a_device_problem_not_an_upsell() {
        let copied = token_for(OTHER_DEVICE, &ALL_GATED, u64::MAX);
        let status = resolve_status_from(test_pubkey(), Some(&copied), Some(THIS_DEVICE), 1_000);

        for f in ALL_GATED {
            let code = check_status_feature(&status, f).unwrap_err().code();
            assert_eq!(code, "LICENSE_DEVICE_MISMATCH", "{f:?}");
            assert_ne!(code, "FEATURE_LOCKED", "{f:?} must not read as 'go buy it'");
        }
    }

    /// Lapsed ⇒ "renew", not "upgrade". Note this is *past the grace window*;
    /// inside grace the licence still grants, which the next test pins.
    #[test]
    fn an_expired_licence_is_reported_as_expiry_not_an_upsell() {
        let expires_ms = 10_000;
        let mine = token_for(THIS_DEVICE, &ALL_GATED, expires_ms);
        let after_grace = expires_ms + license::GRACE_MS + 1;

        let status =
            resolve_status_from(test_pubkey(), Some(&mine), Some(THIS_DEVICE), after_grace);
        assert_eq!(
            status,
            license::LicenseStatus::Invalid(license::LicenseError::Expired)
        );
        let code = check_status_feature(&status, license::Feature::IssueTracker)
            .unwrap_err()
            .code();
        assert_eq!(code, "LICENSE_EXPIRED");
        assert_ne!(code, "FEATURE_LOCKED");
    }

    /// The offline grace window is unaffected by binding: on its own machine, a
    /// just-lapsed licence keeps working for the grace period as before.
    #[test]
    fn a_bound_licence_inside_the_grace_window_still_unlocks() {
        let expires_ms = 10_000;
        let mine = token_for(THIS_DEVICE, &ALL_GATED, expires_ms);
        let inside_grace = expires_ms + license::GRACE_MS - 1;

        let status =
            resolve_status_from(test_pubkey(), Some(&mine), Some(THIS_DEVICE), inside_grace);
        assert!(
            matches!(status, license::LicenseStatus::Grace(_)),
            "got {status:?}"
        );
        assert!(check_status_feature(&status, license::Feature::IssueTracker).is_ok());
    }

    /// And the original meaning survives: a valid licence on the right machine
    /// that simply does not carry the feature is still FEATURE_LOCKED — that
    /// user really does need a higher tier.
    #[test]
    fn a_tier_that_lacks_the_feature_is_still_feature_locked() {
        let basic = token_for(THIS_DEVICE, &[license::Feature::MultiWindow], u64::MAX);
        let status = resolve_status_from(test_pubkey(), Some(&basic), Some(THIS_DEVICE), 1_000);

        assert!(check_status_feature(&status, license::Feature::MultiWindow).is_ok());
        assert_eq!(
            check_status_feature(&status, license::Feature::IssueTracker)
                .unwrap_err()
                .code(),
            "FEATURE_LOCKED",
            "a genuine tier gap must still say 'paid plan'"
        );
    }

    /// A tampered or foreign-key token stays FEATURE_LOCKED rather than being
    /// dressed up as a device problem — signature failure is not a "sign in
    /// again on this machine" situation, and the device check runs only after
    /// the signature passes.
    #[test]
    fn a_forged_token_is_not_reported_as_a_device_problem() {
        // Keep a genuine signature, swap in a payload that grants everything —
        // the classic tamper, and what a self-upgrading free user would try.
        let honest = token_for(THIS_DEVICE, &[], u64::MAX);
        let (_, sig_b64) = honest.split_once('.').expect("token has a signature part");
        let upgraded = license::License {
            device_id: THIS_DEVICE.to_string(),
            features: ALL_GATED.iter().map(|f| f.as_str().to_string()).collect(),
            ..sample(license::Plan::Enterprise, u64::MAX)
        };
        let forged = format!(
            "{}.{}",
            STANDARD.encode(serde_json::to_vec(&upgraded).unwrap()),
            sig_b64
        );

        let status = resolve_status_from(test_pubkey(), Some(&forged), Some(THIS_DEVICE), 1_000);
        assert_eq!(
            status,
            license::LicenseStatus::Invalid(license::LicenseError::BadSignature)
        );
        assert_eq!(
            check_status_feature(&status, license::Feature::MultiWindow)
                .unwrap_err()
                .code(),
            "FEATURE_LOCKED"
        );
    }

    /// No token / no public key still deny, and still read as "not entitled" —
    /// neither is evidence about a device.
    #[test]
    fn an_absent_token_or_key_denies_as_feature_locked() {
        for status in [
            resolve_status_from(test_pubkey(), None, Some(THIS_DEVICE), 1_000),
            resolve_status_from(
                None,
                Some(&token_for(THIS_DEVICE, &ALL_GATED, u64::MAX)),
                Some(THIS_DEVICE),
                1_000,
            ),
        ] {
            assert_eq!(
                status,
                license::LicenseStatus::Invalid(license::LicenseError::Malformed)
            );
            assert_eq!(
                check_status_feature(&status, license::Feature::MultiWindow)
                    .unwrap_err()
                    .code(),
                "FEATURE_LOCKED"
            );
        }
    }

    // DeviceDto is the wire shape for `GET /devices`; the camelCase rename must
    // hold in both directions so the server list round-trips into the IPC view.
    #[test]
    fn device_dto_camel_case_round_trips() {
        let dev = DeviceDto {
            id: "dev-1".into(),
            name: "Sefi's Mac".into(),
            last_seen: 1_700_000_000_000,
            current: true,
        };
        let json = serde_json::to_string(&dev).unwrap();
        assert!(json.contains("\"lastSeen\":1700000000000"), "got {json}");
        assert!(json.contains("\"current\":true"), "got {json}");
        let back: DeviceDto = serde_json::from_str(&json).unwrap();
        assert_eq!(back, dev);
    }

    // The server may omit optional fields; missing `lastSeen`/`current` default
    // rather than fail to decode (a lenient list keeps the UI resilient).
    #[test]
    fn device_dto_defaults_missing_optionals() {
        let dev: DeviceDto = serde_json::from_str(r#"{"id":"d","name":"n"}"#).unwrap();
        assert_eq!(dev.last_seen, 0);
        assert!(!dev.current);
    }
}

#[cfg(test)]
mod open_path_tests {
    use super::*;

    /// The traversal guard is the whole point of `resolve_in_repo`: the relative
    /// path arrives from the WebView, so a `../` chain or an absolute path must
    /// never reach the OS opener.
    #[test]
    fn resolves_a_file_inside_the_repo() {
        let dir = tempfile::TempDir::new().unwrap();
        std::fs::write(dir.path().join("a.txt"), "hi").unwrap();

        let got = resolve_in_repo(dir.path(), "a.txt").unwrap();

        assert_eq!(
            got,
            std::fs::canonicalize(dir.path().join("a.txt")).unwrap()
        );
    }

    #[test]
    fn rejects_a_path_that_escapes_the_repo() {
        let dir = tempfile::TempDir::new().unwrap();
        let outside = dir.path().join("outside.txt");
        std::fs::write(&outside, "secret").unwrap();
        let repo = dir.path().join("repo");
        std::fs::create_dir(&repo).unwrap();

        let err = resolve_in_repo(&repo, "../outside.txt").unwrap_err();

        assert!(
            err.to_string().contains("outside the repository"),
            "expected a containment rejection, got: {err}"
        );
    }

    #[test]
    fn rejects_an_absolute_path() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = dir.path().join("repo");
        std::fs::create_dir(&repo).unwrap();

        // `Path::join` with an absolute path discards the root entirely, so this
        // would open /etc/hosts if the containment check were missing.
        let err = resolve_in_repo(&repo, "/etc/hosts").unwrap_err();

        assert!(
            err.to_string().contains("outside the repository"),
            "expected a containment rejection, got: {err}"
        );
    }

    #[test]
    fn reports_a_missing_file_cleanly() {
        let dir = tempfile::TempDir::new().unwrap();

        let err = resolve_in_repo(dir.path(), "gone.txt").unwrap_err();

        assert!(
            err.to_string().contains("file not found"),
            "expected a not-found error, got: {err}"
        );
    }
}

#[cfg(test)]
mod api_base_tests {
    use super::resolve_api_base;

    const LOCAL: &str = "http://localhost:8080";
    const DEPLOYED: &str = "https://adgitter-api.fly.dev";

    #[test]
    fn falls_back_to_localhost_when_nothing_is_configured() {
        assert_eq!(resolve_api_base(None, None), LOCAL);
    }

    /// The bug this guards: a packaged app inherits no shell environment, so
    /// with only a runtime lookup every release build talked to localhost and
    /// every licence/checkout call failed with a connection refusal.
    #[test]
    fn a_baked_url_is_used_when_the_runtime_env_is_absent() {
        assert_eq!(resolve_api_base(None, Some(DEPLOYED)), DEPLOYED);
    }

    #[test]
    fn the_runtime_env_overrides_a_baked_url() {
        assert_eq!(
            resolve_api_base(Some("http://127.0.0.1:9999"), Some(DEPLOYED)),
            "http://127.0.0.1:9999"
        );
    }

    #[test]
    fn blank_counts_as_absent_at_every_layer() {
        // `ADGITTER_API_URL=` in a shell or `.env` means "not configured".
        assert_eq!(resolve_api_base(Some("  "), Some(DEPLOYED)), DEPLOYED);
        assert_eq!(resolve_api_base(Some(""), None), LOCAL);
        assert_eq!(resolve_api_base(None, Some("\n")), LOCAL);
    }

    #[test]
    fn surrounding_whitespace_is_trimmed() {
        // A `.env` line or `cargo:rustc-env` value can carry a stray newline;
        // an untrimmed URL would make every request fail to parse.
        assert_eq!(
            resolve_api_base(None, Some("  https://x.test\n")),
            "https://x.test"
        );
    }
}

#[cfg(test)]
mod project_config_tests {
    use super::*;

    fn init_repo(dir: &Path) -> git2::Repository {
        git2::Repository::init(dir).unwrap()
    }

    #[test]
    fn round_trips_through_write_then_read() {
        let dir = tempfile::TempDir::new().unwrap();
        init_repo(dir.path());
        let original = r#"{"branchColors": {"main": "red"}, "issueBindings": []}"#;

        write_project_config_sync(dir.path(), original).unwrap();
        let read_back = read_project_config_sync(dir.path())
            .unwrap()
            .expect("file should now exist");

        // The stored file is pretty-printed, so compare parsed values rather
        // than raw text.
        let want: serde_json::Value = serde_json::from_str(original).unwrap();
        let got: serde_json::Value = serde_json::from_str(&read_back).unwrap();
        assert_eq!(want, got);
        assert!(read_back.contains('\n'), "expected pretty-printed output");
    }

    #[test]
    fn reading_a_repo_with_no_config_file_is_ok_none() {
        let dir = tempfile::TempDir::new().unwrap();
        init_repo(dir.path());

        assert_eq!(read_project_config_sync(dir.path()).unwrap(), None);
    }

    #[test]
    fn write_rejects_non_json_content() {
        let dir = tempfile::TempDir::new().unwrap();
        init_repo(dir.path());

        let err = write_project_config_sync(dir.path(), "not json at all").unwrap_err();
        assert!(err.to_string().contains("not valid JSON"), "got {err}");
    }

    #[test]
    fn write_rejects_a_top_level_array() {
        let dir = tempfile::TempDir::new().unwrap();
        init_repo(dir.path());

        let err = write_project_config_sync(dir.path(), "[1, 2, 3]").unwrap_err();
        assert!(err.to_string().contains("JSON object"), "got {err}");
    }

    #[test]
    fn write_rejects_a_top_level_string() {
        let dir = tempfile::TempDir::new().unwrap();
        init_repo(dir.path());

        let err = write_project_config_sync(dir.path(), "\"just a string\"").unwrap_err();
        assert!(err.to_string().contains("JSON object"), "got {err}");
    }

    #[test]
    fn write_rejects_content_over_the_size_cap() {
        let dir = tempfile::TempDir::new().unwrap();
        init_repo(dir.path());

        // A single oversized string value, comfortably past the 256 KiB cap.
        let huge = "x".repeat(PROJECT_CONFIG_MAX_BYTES as usize + 1);
        let content = format!(r#"{{"pad":"{huge}"}}"#);
        let err = write_project_config_sync(dir.path(), &content).unwrap_err();
        assert!(err.to_string().contains("too large"), "got {err}");
    }

    #[test]
    fn write_into_a_non_repo_directory_errors() {
        let dir = tempfile::TempDir::new().unwrap();
        // Deliberately no `git init` here — a plain directory.

        let err = write_project_config_sync(dir.path(), "{}").unwrap_err();
        assert!(matches!(err, AdgitterError::RepoNotFound(_)), "got {err:?}");
    }

    #[test]
    fn successful_write_leaves_no_tmp_file_behind() {
        let dir = tempfile::TempDir::new().unwrap();
        init_repo(dir.path());

        write_project_config_sync(dir.path(), "{}").unwrap();

        let leftovers: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|name| name.contains(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "leftover temp files: {leftovers:?}");
    }

    // ── Concurrent writes (the corruption root cause) ───────────────────────

    /// Payloads of deliberately different lengths: the splice this guards
    /// against is only visible when the longer one's tail outlives the shorter
    /// one's truncation.
    fn concurrency_payloads(n: usize) -> Vec<String> {
        (0..n)
            .map(|i| format!(r#"{{"writer": {i}, "pad": "{}"}}"#, "x".repeat(i * 97)))
            .collect()
    }

    /// The pretty-printed bytes each payload lands on disk as.
    fn expected_on_disk(payloads: &[String]) -> Vec<String> {
        payloads
            .iter()
            .map(|p| validate_project_config_content(p).unwrap())
            .collect()
    }

    /// The load-bearing regression test. Several threads write different-length
    /// payloads to one config path in a tight loop; the file must, at every
    /// observation, be *exactly* one whole payload — never the front of one
    /// document followed by the tail of a longer one.
    ///
    /// On the pre-fix code (fixed `<name>.tmp` temp file, no lock) this fails
    /// within the first few iterations: two `File::create` calls on the same
    /// inode keep independent write offsets, so the shorter payload overwrites
    /// only the first N bytes of the longer one and the rename publishes the
    /// splice — the same shape as the corrupted file reported from disk.
    #[test]
    fn concurrent_writes_never_publish_a_spliced_file() {
        let dir = tempfile::TempDir::new().unwrap();
        init_repo(dir.path());
        let root = dir.path().to_path_buf();

        let payloads = concurrency_payloads(4);
        let expected = std::sync::Arc::new(expected_on_disk(&payloads));
        // Seed the file so a reader never races the very first create.
        write_project_config_sync(&root, &payloads[0]).unwrap();

        let barrier = std::sync::Arc::new(std::sync::Barrier::new(payloads.len()));
        let mut handles = Vec::new();
        for payload in payloads.clone() {
            let root = root.clone();
            let expected = std::sync::Arc::clone(&expected);
            let barrier = std::sync::Arc::clone(&barrier);
            handles.push(std::thread::spawn(move || {
                barrier.wait();
                for _ in 0..200 {
                    write_project_config_sync(&root, &payload).unwrap();
                    let got = std::fs::read_to_string(root.join(PROJECT_CONFIG_FILENAME)).unwrap();
                    assert!(
                        expected.contains(&got),
                        "config file is not any single payload — spliced write.\n\
                         got {} bytes: {got:?}",
                        got.len()
                    );
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
    }

    /// Serialization, stated as the property that actually matters: whichever
    /// write returns *last* is the one left on disk. Without a lock the two
    /// renames can complete out of order, so a write can report success and
    /// then be silently reverted by an older payload landing after it.
    #[test]
    fn concurrent_writes_do_not_lose_the_last_write() {
        let dir = tempfile::TempDir::new().unwrap();
        init_repo(dir.path());
        let root = dir.path().to_path_buf();
        let payloads = concurrency_payloads(4);
        let expected = expected_on_disk(&payloads);

        for _ in 0..100 {
            // (finish time, index) of every write in this round.
            let finished: std::sync::Arc<Mutex<Vec<(std::time::Instant, usize)>>> =
                std::sync::Arc::new(Mutex::new(Vec::new()));
            let barrier = std::sync::Arc::new(std::sync::Barrier::new(payloads.len()));
            let mut handles = Vec::new();
            for (i, payload) in payloads.iter().enumerate() {
                let root = root.clone();
                let payload = payload.clone();
                let finished = std::sync::Arc::clone(&finished);
                let barrier = std::sync::Arc::clone(&barrier);
                handles.push(std::thread::spawn(move || {
                    barrier.wait();
                    write_project_config_sync(&root, &payload).unwrap();
                    finished
                        .lock()
                        .unwrap()
                        .push((std::time::Instant::now(), i));
                }));
            }
            for h in handles {
                h.join().unwrap();
            }

            let mut finished = finished.lock().unwrap().clone();
            finished.sort();
            let (_, last) = *finished.last().unwrap();
            let got = std::fs::read_to_string(root.join(PROJECT_CONFIG_FILENAME)).unwrap();
            assert_eq!(
                got, expected[last],
                "the write that returned last is not the one on disk — lost update"
            );
        }
    }

    /// Unique temp names must not turn into litter: after a burst of concurrent
    /// writes the directory holds the config file and nothing else temp-shaped.
    #[test]
    fn concurrent_writes_leave_no_temp_files_behind() {
        let dir = tempfile::TempDir::new().unwrap();
        init_repo(dir.path());
        let root = dir.path().to_path_buf();
        let payloads = concurrency_payloads(4);

        let mut handles = Vec::new();
        for payload in payloads {
            let root = root.clone();
            handles.push(std::thread::spawn(move || {
                for _ in 0..50 {
                    write_project_config_sync(&root, &payload).unwrap();
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }

        let leftovers: Vec<_> = std::fs::read_dir(&root)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|name| name.contains(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "leftover temp files: {leftovers:?}");
    }

    /// Crash litter — a temp file left by a process that died between create
    /// and rename — is reclaimed by the next write, so unique names cannot
    /// accumulate forever in the user's working tree.
    #[test]
    fn a_write_sweeps_crash_litter_from_earlier_temp_files() {
        let dir = tempfile::TempDir::new().unwrap();
        init_repo(dir.path());
        let me = std::process::id();

        // Litter this process could have left, plus the fixed name used before
        // temp files were made unique.
        let ours = dir
            .path()
            .join(format!("{PROJECT_CONFIG_FILENAME}{TMP_INFIX}{me}.999999"));
        let legacy = dir.path().join(format!("{PROJECT_CONFIG_FILENAME}.tmp"));
        // A temp file that looks like it belongs to a live foreign process:
        // young, so it is left alone rather than yanked out from under a writer.
        let foreign = dir
            .path()
            .join(format!("{PROJECT_CONFIG_FILENAME}{TMP_INFIX}{}.1", me + 1));
        // An unrelated file that merely shares the prefix must survive.
        let bystander = dir.path().join(format!("{PROJECT_CONFIG_FILENAME}.bak"));
        for p in [&ours, &legacy, &foreign, &bystander] {
            std::fs::write(p, "litter").unwrap();
        }

        write_project_config_sync(dir.path(), "{}").unwrap();

        assert!(!ours.exists(), "our own crash litter must be reclaimed");
        assert!(
            !legacy.exists(),
            "the pre-fix fixed temp name must be reclaimed"
        );
        assert!(
            foreign.exists(),
            "a live foreign writer's temp must be left alone"
        );
        assert!(
            bystander.exists(),
            "an unrelated sibling must be left alone"
        );
    }

    /// The exact shape from the user report: a valid config followed by four
    /// stray trailing bytes.
    const CORRUPT: &str = "{\n  \"branchColors\": {\"main\": \"#ff0000\"}\n}\n  }\n}";

    fn write_raw_config(dir: &Path, content: &str) {
        std::fs::write(dir.join(PROJECT_CONFIG_FILENAME), content).unwrap();
    }

    fn quarantine_files(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| {
                n.starts_with(PROJECT_CONFIG_QUARANTINE_PREFIX)
                    && n.ends_with(PROJECT_CONFIG_QUARANTINE_SUFFIX)
            })
            .collect();
        names.sort();
        names
    }

    #[test]
    fn quarantine_copies_the_unreadable_bytes_and_leaves_the_original() {
        let dir = tempfile::TempDir::new().unwrap();
        init_repo(dir.path());
        write_raw_config(dir.path(), CORRUPT);

        let name = quarantine_project_config_sync(dir.path())
            .unwrap()
            .expect("a config file exists, so it must be preserved");

        assert_eq!(
            std::fs::read_to_string(dir.path().join(&name)).unwrap(),
            CORRUPT
        );
        // The original is a copy source, never a move source.
        assert_eq!(
            std::fs::read_to_string(dir.path().join(PROJECT_CONFIG_FILENAME)).unwrap(),
            CORRUPT
        );
    }

    #[test]
    fn quarantining_the_same_content_twice_reuses_the_first_backup() {
        let dir = tempfile::TempDir::new().unwrap();
        init_repo(dir.path());
        write_raw_config(dir.path(), CORRUPT);

        let first = quarantine_project_config_sync(dir.path()).unwrap().unwrap();
        let second = quarantine_project_config_sync(dir.path()).unwrap().unwrap();

        assert_eq!(first, second);
        assert_eq!(quarantine_files(dir.path()), vec![first]);
    }

    #[test]
    fn a_second_distinct_corruption_gets_its_own_backup() {
        let dir = tempfile::TempDir::new().unwrap();
        init_repo(dir.path());
        write_raw_config(dir.path(), CORRUPT);
        let first = quarantine_project_config_sync(dir.path()).unwrap().unwrap();

        write_raw_config(dir.path(), "{\"branchColors\": {} } trailing garbage");
        let second = quarantine_project_config_sync(dir.path()).unwrap().unwrap();

        assert_ne!(first, second);
        assert_eq!(quarantine_files(dir.path()).len(), 2);
        // Neither backup was clobbered.
        assert_eq!(
            std::fs::read_to_string(dir.path().join(&first)).unwrap(),
            CORRUPT
        );
    }

    #[test]
    fn quarantine_with_no_config_file_is_ok_none() {
        let dir = tempfile::TempDir::new().unwrap();
        init_repo(dir.path());

        assert_eq!(quarantine_project_config_sync(dir.path()).unwrap(), None);
        assert!(quarantine_files(dir.path()).is_empty());
    }

    // ── Reads that FAIL (as opposed to returning unparseable text) ──────────
    //
    // Each case below must come back as `Err`, never as `Ok(None)`: `None`
    // means "this repo has no settings" and lets the frontend write defaults
    // over the file. Whether the bytes can then be preserved is the second
    // half of each test, and it decides whether saving stays allowed.

    /// An actually-oversized file (not a mocked error): over the read cap, so
    /// `read_project_config_sync` refuses it — but a byte copy does not care
    /// about the read cap, so it is still preserved.
    #[test]
    fn an_oversized_config_fails_to_read_but_is_still_quarantined() {
        let dir = tempfile::TempDir::new().unwrap();
        init_repo(dir.path());
        let huge = "x".repeat(PROJECT_CONFIG_MAX_BYTES as usize + 1);
        write_raw_config(dir.path(), &huge);

        let err = read_project_config_sync(dir.path()).unwrap_err();
        assert!(err.to_string().contains("too large"), "got {err}");

        let name = quarantine_project_config_sync(dir.path())
            .unwrap()
            .expect("an oversized file still has bytes worth preserving");
        assert_eq!(
            std::fs::read(dir.path().join(&name)).unwrap(),
            huge.as_bytes()
        );
        // Untouched, as always.
        assert_eq!(
            std::fs::read(dir.path().join(PROJECT_CONFIG_FILENAME)).unwrap(),
            huge.as_bytes()
        );
    }

    /// Actually-invalid UTF-8 (a lone 0xFF byte): `read_to_string` fails, but
    /// the copy is byte-for-byte and needs no decoding.
    #[test]
    fn a_non_utf8_config_fails_to_read_but_is_still_quarantined() {
        let dir = tempfile::TempDir::new().unwrap();
        init_repo(dir.path());
        let bytes: &[u8] = &[b'{', 0xff, 0xfe, b'}'];
        std::fs::write(dir.path().join(PROJECT_CONFIG_FILENAME), bytes).unwrap();

        assert!(read_project_config_sync(dir.path()).is_err());

        let name = quarantine_project_config_sync(dir.path())
            .unwrap()
            .expect("non-UTF-8 bytes are still the user's settings");
        assert_eq!(std::fs::read(dir.path().join(&name)).unwrap(), bytes);
    }

    /// An IO failure whose bytes cannot be reached at all — here a DIRECTORY
    /// sitting at the config path (root-proof, unlike a chmod trick). Both the
    /// read and the quarantine must fail, which is what makes the frontend
    /// refuse to write rather than replace it with defaults.
    #[test]
    fn a_config_path_that_cannot_be_read_fails_both_read_and_quarantine() {
        let dir = tempfile::TempDir::new().unwrap();
        init_repo(dir.path());
        std::fs::create_dir(dir.path().join(PROJECT_CONFIG_FILENAME)).unwrap();

        assert!(
            read_project_config_sync(dir.path()).is_err(),
            "an unreadable path must not masquerade as a missing file"
        );
        assert!(quarantine_project_config_sync(dir.path()).is_err());
        // A failed quarantine leaves no half-written backup pretending to be
        // a good copy.
        assert!(quarantine_files(dir.path()).is_empty());
    }

    #[test]
    fn quarantine_refuses_a_file_past_its_own_much_larger_cap() {
        let dir = tempfile::TempDir::new().unwrap();
        init_repo(dir.path());
        let f = std::fs::File::create(dir.path().join(PROJECT_CONFIG_FILENAME)).unwrap();
        // Sparse where the filesystem supports it — we only need the length.
        f.set_len(PROJECT_CONFIG_QUARANTINE_MAX_BYTES + 1).unwrap();
        drop(f);

        let err = quarantine_project_config_sync(dir.path()).unwrap_err();
        assert!(
            err.to_string().contains("too large to preserve"),
            "got {err}"
        );
    }

    /// Re-opening a repo whose oversized config is unchanged must not pile up
    /// copies — the dedup path is a streaming compare now, so it has to keep
    /// working above the read cap.
    #[test]
    fn quarantining_the_same_oversized_content_twice_reuses_the_backup() {
        let dir = tempfile::TempDir::new().unwrap();
        init_repo(dir.path());
        write_raw_config(
            dir.path(),
            &"y".repeat(PROJECT_CONFIG_MAX_BYTES as usize + 7),
        );

        let first = quarantine_project_config_sync(dir.path()).unwrap().unwrap();
        let second = quarantine_project_config_sync(dir.path()).unwrap().unwrap();

        assert_eq!(first, second);
        assert_eq!(quarantine_files(dir.path()), vec![first]);
    }

    /// Same length, different bytes: the cheap length pre-filter must not be
    /// mistaken for the comparison itself.
    #[test]
    fn a_same_length_but_different_corruption_gets_its_own_backup() {
        let dir = tempfile::TempDir::new().unwrap();
        init_repo(dir.path());
        write_raw_config(dir.path(), "{\"a\": 1} }");
        let first = quarantine_project_config_sync(dir.path()).unwrap().unwrap();

        write_raw_config(dir.path(), "{\"b\": 2} }");
        let second = quarantine_project_config_sync(dir.path()).unwrap().unwrap();

        assert_ne!(first, second);
        assert_eq!(
            std::fs::read_to_string(dir.path().join(&first)).unwrap(),
            "{\"a\": 1} }"
        );
    }
}

#[cfg(test)]
mod token_cache_tests {
    use super::TokenCache;

    fn empty() -> TokenCache {
        TokenCache {
            generation: 0,
            value: None,
        }
    }

    #[test]
    fn a_fresh_cache_is_a_miss() {
        let (generation, hit) = empty().read();
        assert_eq!(generation, 0);
        assert!(hit.is_none(), "nothing has been read yet");
    }

    #[test]
    fn a_read_that_nothing_interrupted_is_stored() {
        let mut c = empty();
        let (generation, _) = c.read();
        c.store_if_current(generation, Some("tok".into()));
        assert_eq!(c.read().1, Some(Some("tok".into())));
    }

    /// The hazard the generation counter exists for: a `stored_token` already
    /// in flight sampled the stores BEFORE sign-out deleted them, and must not
    /// write that value back afterwards. Letting it through leaves paid
    /// features unlocked on an app that says it is signed out.
    #[test]
    fn a_read_overtaken_by_sign_out_is_discarded() {
        let mut c = empty();
        let (generation, _) = c.read();
        c.clear(); // sign-out lands while the read is in flight
        c.store_if_current(generation, Some("tok".into()));
        assert!(
            c.read().1.is_none(),
            "the stale token must not resurrect the session"
        );
    }

    /// The same rule in the other direction: a fresh sign-in wrote a new token
    /// while an older read was in flight, and the older value must lose.
    #[test]
    fn a_read_overtaken_by_a_new_token_is_discarded() {
        let mut c = empty();
        let (generation, _) = c.read();
        c.set(Some("new".into()));
        c.store_if_current(generation, Some("old".into()));
        assert_eq!(c.read().1, Some(Some("new".into())));
    }

    /// "Read it, and there was no token" is a cacheable answer — otherwise
    /// every entitlement check on a signed-out app re-reads the keychain, which
    /// is exactly the prompt storm the cache exists to stop.
    #[test]
    fn absence_is_cached_too_and_is_not_a_miss() {
        let mut c = empty();
        let (generation, _) = c.read();
        c.store_if_current(generation, None);
        assert_eq!(
            c.read().1,
            Some(None),
            "a cached absence must read as a hit, not as never-read"
        );
    }

    #[test]
    fn clearing_returns_the_cache_to_never_read() {
        let mut c = empty();
        c.set(Some("tok".into()));
        c.clear();
        assert!(c.read().1.is_none());
    }
}

#[cfg(test)]
mod off_runtime_tests {
    use super::off_runtime;

    /// Run `fut` the way an `async` Tauri command runs: as a task on the async
    /// runtime, i.e. on a runtime worker thread — not on the test thread.
    fn on_a_runtime_worker<T, Fut>(fut: Fut) -> T
    where
        T: Send + 'static,
        Fut: std::future::Future<Output = T> + Send + 'static,
    {
        tauri::async_runtime::block_on(tauri::async_runtime::spawn(fut))
            .expect("the async task itself must not panic")
    }

    /// The property the keychain needs: inside `off_runtime`, code is allowed
    /// to block on a runtime. Called straight from the task instead, the same
    /// `block_on` panics with "Cannot start a runtime from within a runtime".
    #[test]
    fn the_closure_may_block_on_a_runtime() {
        let value = on_a_runtime_worker(async {
            off_runtime(|| tauri::async_runtime::block_on(async { 7 })).await
        });
        assert_eq!(value, Some(7));
    }

    /// A panicking credential store is an unavailable one, not a dead command.
    #[test]
    fn a_panicking_closure_is_reported_as_none() {
        let value = on_a_runtime_worker(async {
            off_runtime(|| -> u8 { panic!("off_runtime_tests: intentional") }).await
        });
        assert_eq!(value, None);
    }

    /// The Linux startup panic itself, against the real Secret Service backend:
    /// a keychain read issued from an async task must come back with an answer.
    /// The entry is one nothing ever writes, so the answer is "nothing there"
    /// whether a keyring daemon is running (no such item) or not (no backend).
    #[cfg(target_os = "linux")]
    #[test]
    fn a_keychain_read_from_an_async_task_returns_instead_of_panicking() {
        let read = on_a_runtime_worker(async {
            off_runtime(|| {
                keyring::Entry::new("adgitter-test-off-runtime", "never-written")
                    .and_then(|entry| entry.get_password())
                    .ok()
            })
            .await
        });
        assert_eq!(read, Some(None), "the read must complete, and find nothing");
    }
}

#[cfg(test)]
mod trial_tests {
    use super::*;

    #[test]
    fn machine_hash_is_salted_sha256_hex() {
        use sha2::{Digest, Sha256};
        let h = hash_machine_id("  ABC-123\n").unwrap();
        assert_eq!(h.len(), 64);
        assert!(h.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')));
        // Trimmed, so a trailing newline from /etc/machine-id doesn't matter…
        assert_eq!(Some(h.clone()), hash_machine_id("ABC-123"));
        // …and salted, so it is not a bare SHA-256 of the id.
        let bare: String = Sha256::digest(b"ABC-123")
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        assert_ne!(h, bare);
        assert_eq!(hash_machine_id("   "), None);
    }

    #[test]
    fn machine_id_parsers_read_the_os_output() {
        let ioreg = r#"+-o J316sAP  <class IOPlatformExpertDevice>
    {
      "IOPlatformSerialNumber" = "XYZ"
      "IOPlatformUUID" = "1A2B3C4D-0000-1111-2222-333344445555"
    }"#;
        assert_eq!(
            ioreg_platform_uuid(ioreg),
            Some("1A2B3C4D-0000-1111-2222-333344445555")
        );
        let reg = "\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    9f8e7d6c-1111-2222-3333-444455556666\r\n";
        assert_eq!(
            reg_machine_guid(reg),
            Some("9f8e7d6c-1111-2222-3333-444455556666")
        );
        assert_eq!(ioreg_platform_uuid("nothing here"), None);
        assert_eq!(reg_machine_guid("ERROR: not found"), None);
    }

    /// The dev host (macOS) really answers, and the same way twice.
    #[test]
    fn this_machine_has_a_stable_machine_hash() {
        let h = machine_hash().expect("machine id");
        assert_eq!(Some(h), machine_hash());
    }

    #[test]
    fn trial_status_parses_the_server_shape() {
        let v: TrialStatusDto =
            serde_json::from_str(r#"{"state":"active","endsMs":5,"days":14,"plan":"advance"}"#)
                .unwrap();
        assert_eq!(
            (v.state.as_str(), v.ends_ms, v.days),
            ("active", Some(5), 14)
        );
        let v: TrialStatusDto =
            serde_json::from_str(r#"{"state":"available","days":14,"plan":"advance"}"#).unwrap();
        assert_eq!(v.ends_ms, None);
    }
}
