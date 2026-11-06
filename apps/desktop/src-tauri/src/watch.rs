//! Filesystem watching for the open repository.
//!
//! A `notify` watcher on the repository's working-tree root emits a
//! `repo-changed` Tauri event whenever anything changes on disk under that
//! root: new/modified/deleted working-tree files (e.g. creating `test.md`)
//! as well as history, refs, or HEAD changes, since `.git` lives nested
//! inside the working tree and is covered by the same recursive watch. For a
//! bare repository (no working tree) the watch falls back to the git
//! directory itself.
//!
//! The watcher is created only while the application window is focused — the
//! frontend starts it on focus and stops it on blur via the
//! [`start_repo_watch`](crate::commands::start_repo_watch) /
//! [`stop_repo_watch`](crate::commands::stop_repo_watch) commands — so no disk
//! watching happens while the window is inactive.
//! Debouncing/coalescing of the resulting refreshes lives on the frontend
//! (`lib/repoWatch.ts`, a 300ms trailing debounce), so this module stays
//! deliberately dumb: it only says "something changed".

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use git_core::{AdgitterError, AdgitterResult};

/// Held in Tauri managed state; keeps the active watchers alive, one per
/// window label.
/// Dropping an inner watcher stops that window's OS-level watch and releases
/// its descriptors.
#[derive(Default)]
pub struct WatchState(pub Mutex<HashMap<String, RecommendedWatcher>>);

#[derive(Clone, Serialize)]
struct RepoChanged {
    repo_path: String,
}

/// Resolve the root directory to watch for changes to the repository at
/// `path`: the working-tree root for a normal repository (which contains
/// `.git`, so ref/HEAD/history changes are covered too), or the git
/// directory itself when the repository is bare and has no working tree.
fn watch_root(path: &Path) -> AdgitterResult<PathBuf> {
    if !path.exists() {
        return Err(AdgitterError::InvalidPath(path.display().to_string()));
    }
    let repo = git2::Repository::discover(path)
        .map_err(|_| AdgitterError::RepoNotFound(path.display().to_string()))?;
    Ok(repo
        .workdir()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| repo.path().to_path_buf()))
}

/// Start (or replace) the watcher for `repo_path`, scoped to `label` (the
/// calling window). Emits `repo-changed` — targeted at that window only — on
/// any change under the repository's working-tree root (or, for a bare
/// repository, its git directory).
pub fn start(
    app: AppHandle,
    state: &WatchState,
    label: String,
    repo_path: String,
) -> AdgitterResult<()> {
    let root = watch_root(Path::new(&repo_path))?;
    let emit_path = repo_path;
    let emit_label = label.clone();

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        // Only relay successful change notifications; the frontend re-reads
        // via the typed commands, so a minimal "changed" signal is enough.
        if res.is_ok() {
            let _ = app.emit_to(
                &emit_label,
                "repo-changed",
                RepoChanged {
                    repo_path: emit_path.clone(),
                },
            );
        }
    })
    .map_err(|e| AdgitterError::Io(std::io::Error::other(e)))?;

    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| AdgitterError::Io(std::io::Error::other(e)))?;

    // Replacing this window's stored watcher drops any previous one for the
    // same label, stopping its watch. Other windows' watchers are untouched.
    state.0.lock().unwrap().insert(label, watcher);
    Ok(())
}

/// Stop watching for `label` (the calling window): drop its active watcher,
/// releasing OS resources. Idempotent. Other windows' watchers are untouched.
pub fn stop(state: &WatchState, label: &str) {
    state.0.lock().unwrap().remove(label);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn watch_root_resolves_workdir_for_repo_and_subdir() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().to_path_buf();
        git2::Repository::init(&path).unwrap();

        let resolved = watch_root(&path).expect("resolve workdir");
        assert!(
            resolved.join(".git").is_dir(),
            "expected workdir root containing .git, got {resolved:?}"
        );

        // Discovery walks up from a nested subdirectory.
        let sub = path.join("nested/deep");
        std::fs::create_dir_all(&sub).unwrap();
        let resolved_sub = watch_root(&sub).expect("resolve from subdir");
        assert!(
            resolved_sub.join(".git").is_dir(),
            "expected workdir root containing .git, got {resolved_sub:?}"
        );
    }

    #[test]
    fn watch_root_falls_back_to_git_dir_for_bare_repo() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().to_path_buf();
        git2::Repository::init_bare(&path).unwrap();

        let resolved = watch_root(&path).expect("resolve bare repo git dir");
        // A bare repo has no working tree, so the resolved root should be the
        // git directory itself (its root holds HEAD, objects/, refs/, ...).
        assert!(
            resolved.join("HEAD").is_file(),
            "expected git dir root, got {resolved:?}"
        );
    }

    #[test]
    fn watch_root_errors_for_non_repo() {
        let dir = tempfile::TempDir::new().unwrap();
        assert!(matches!(
            watch_root(dir.path()),
            Err(AdgitterError::RepoNotFound(_))
        ));
    }

    /// The watch primitive itself fires on a change to a WORKING TREE file
    /// (not under `.git`) — the working-tree change the watcher previously
    /// missed when it watched only the `.git` directory. (The Tauri `emit`
    /// path is covered by quickstart Scenario E; here we assert the
    /// underlying `notify` mechanism, watching the same root `start()`
    /// resolves, fires for a plain working-tree edit.)
    #[test]
    fn notify_fires_on_change_under_workdir_root() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().to_path_buf();
        git2::Repository::init(&path).unwrap();
        let root = watch_root(&path).unwrap();

        let (tx, rx) = mpsc::channel();
        let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if res.is_ok() {
                let _ = tx.send(());
            }
        })
        .unwrap();
        watcher.watch(&root, RecursiveMode::Recursive).unwrap();

        // Create a new file directly in the working-tree root, e.g. as if the
        // user added `test.md` — not touching `.git` at all.
        std::fs::write(root.join("test.md"), b"hello").unwrap();

        assert!(
            rx.recv_timeout(Duration::from_secs(5)).is_ok(),
            "expected a filesystem event for a new working-tree file"
        );
    }
}
