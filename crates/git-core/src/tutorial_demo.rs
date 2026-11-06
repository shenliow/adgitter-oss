//! Demo-repository builder for the guided tutorial (task T1).
//!
//! The tutorial walks a new user through the gesture grammar on a disposable
//! repository. This module builds that repository — a working clone plus a
//! bare `origin` — and scripts the state each tutorial step expects, so the
//! desktop shell only has to call a handful of thin commands.
//!
//! # Layout
//!
//! ```text
//! <base_dir>/demo-<unix_ms>/
//!     repo/        working repository (branch `main`, upstream `origin/main`)
//!     origin.git/  bare remote (a plain path — no network, no credentials)
//! ```
//!
//! # Confinement
//!
//! Everything except [`create_demo`] takes an explicit `base_dir` (the shell
//! passes `<app_data_dir>/tutorial`) and refuses any path that is not exactly
//! `<base_dir>/demo-<digits>/repo`, after canonicalisation — so `..`, a
//! symlinked `repo`, or a path elsewhere on disk can never be written to or
//! deleted. A repo-relative path given to [`write_file`] is checked the same
//! way: no absolute paths, no `..`, nothing under `.git` (including its NTFS
//! spellings — `.git.`, `.git `, `GIT~1`, `.git::$INDEX_ALLOCATION` — checked
//! on every platform), and no write that a symlink inside the repo would
//! redirect outside it.
//!
//! The path shape alone is not enough: the app's usual `open_repo` walks *up*
//! looking for a repository, so a demo that lost its own `.git` would silently
//! resolve to whatever encloses the app-data directory (a dotfiles repo at `~`)
//! and the history script would then create branches in, hard-reset and push
//! *that*. Every function that touches the repository therefore opens the demo
//! through [`open_demo`] — no upward search, and the opened repository's work
//! tree and git dir must be exactly `<root>` and `<root>/.git` — and refuses
//! otherwise.
//!
//! # Stale demos
//!
//! Closing the app mid-tutorial leaves its `demo-<ms>` directory behind, so
//! [`create_demo`] first deletes every other `demo-<digits>` directory in the
//! base directory (never following a symlink, best effort).
//!
//! # Commit times
//!
//! Every commit this module creates carries a strictly increasing author and
//! committer time, so the graph orders deterministically (it sorts by time,
//! then topologically). Offsets are whole seconds — the history is seeded
//! "just now" rather than back-dated, because the user's own step-5 commit
//! (real time) is its parent and a child must not look older than its parent.
//!
//! # Per-repo settings
//!
//! [`create_demo`] also writes `adgitter.config.json` with
//! `general.autoPull = "off"` (the same JSON `projectConfig.svelte.ts` reads),
//! so a user whose global settings say "warn" does not get a pull prompt that
//! pre-empts the step-17 push rejection. The file is listed in
//! `.git/info/exclude`, so it never shows up as an untracked file, is never
//! committed, and is never part of a Log Anytime snapshot.

use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use git2::{
    build::CheckoutBuilder, BranchType, ObjectType, Oid, Repository, RepositoryInitOptions,
    RepositoryOpenFlags, ResetType, Signature, Time, Tree,
};
use serde::Serialize;

use crate::error::{AdgitterError, AdgitterResult};
use crate::mutate::lock_mutations;

/// Identity of every commit and tag the demo creates, and the repo-local git
/// config, so the tutorial never depends on (or leaks) the user's own identity.
const LEARNER_NAME: &str = "ADGitter Learner";
const LEARNER_EMAIL: &str = "learner@example.com";

/// The only branch the history script starts from.
const MAIN: &str = "main";

/// The untracked files [`seed_files`] writes, repo-relative.
const SEED_FILES: [(&str, &str); 3] = [
    (
        "src/app.js",
        "// A tiny demo app used by the ADGitter tutorial.\n\
         export function greet(name) {\n  return `Hello, ${name}!`;\n}\n\n\
         console.log(greet(\"ADGitter\"));\n",
    ),
    (
        "src/style.css",
        "/* Base styles for the demo app. */\n\
         body {\n  margin: 0;\n  font-family: system-ui, sans-serif;\n  line-height: 1.5;\n}\n\n\
         h1 {\n  font-size: 1.5rem;\n}\n",
    ),
    (
        "docs/notes.md",
        "# Notes\n\n\
         - The demo app greets whoever you ask it to.\n\
         - Styles live in `src/style.css`.\n\
         - Ideas: a login page, a dark theme, faster rendering.\n",
    ),
];

/// File [`simulate_log`] edits for each simulated snapshot.
const SIM_FILE: &str = "scratch.md";

/// Upper bound for [`simulate_log`]'s `count` — a tutorial needs three.
const SIM_MAX: usize = 20;

/// `adgitter.config.json`, the per-repo project config (see
/// `apps/desktop/src/lib/projectConfig.svelte.ts`). Only the `general` slice is
/// present: the other slices stay `null` and are seeded from global settings
/// in memory exactly as for any freshly opened repo. `autoPullBefore` is all
/// off to match `autoPull: "off"`; everything else is the global default.
const PROJECT_CONFIG_FILENAME: &str = "adgitter.config.json";

fn demo_project_config() -> String {
    let cfg = serde_json::json!({
        "general": {
            "autoPull": "off",
            "autoPullBefore": { "createBranch": false, "push": false, "commit": false },
            "unstaged": "warn",
            "undoRedo": 3,
            "dryRun": false,
            "hideGhosts": false,
            "remoteUrl": ""
        }
    });
    serde_json::to_string_pretty(&cfg).expect("static JSON always serialises") + "\n"
}

/// Where a freshly created demo lives, serialised camelCase for the shell.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DemoRepo {
    /// The working repository (what the app opens).
    pub repo_path: String,
    /// The bare `origin` the working repository pushes to.
    pub remote_path: String,
}

// ── Confinement ──────────────────────────────────────────────────────────────

fn invalid(msg: impl Into<String>) -> AdgitterError {
    AdgitterError::InvalidPath(msg.into())
}

/// `demo-<digits>`, the name [`create_demo`] gives each demo directory.
fn is_demo_dir_name(name: &str) -> bool {
    name.strip_prefix("demo-")
        .is_some_and(|ms| !ms.is_empty() && ms.bytes().all(|b| b.is_ascii_digit()))
}

/// Check that `demo` is exactly `<base>/demo-<digits>` (both canonical).
fn check_demo_shape(base: &Path, demo: &Path) -> AdgitterResult<()> {
    let name_ok = demo
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(is_demo_dir_name);
    if name_ok && demo.parent() == Some(base) {
        Ok(())
    } else {
        Err(invalid(format!(
            "{} is not a tutorial demo directory",
            demo.display()
        )))
    }
}

/// Canonicalise `base_dir` and `repo` and require
/// `repo == <base_dir>/demo-<digits>/repo`; returns the canonical repo path.
///
/// Canonicalising first is what makes this sound: `..` segments and symlinks
/// are resolved before the comparison, so a `repo` that merely *looks* like it
/// is inside `base_dir` (or that points out of it through a link) is refused.
fn confine_repo(base_dir: &Path, repo: &Path) -> AdgitterResult<PathBuf> {
    let base = std::fs::canonicalize(base_dir)
        .map_err(|_| invalid(format!("{} does not exist", base_dir.display())))?;
    let repo = std::fs::canonicalize(repo)
        .map_err(|_| AdgitterError::RepoNotFound(repo.display().to_string()))?;
    let demo = repo
        .parent()
        .ok_or_else(|| invalid(format!("{} is not a tutorial demo", repo.display())))?
        .to_path_buf();
    if repo.file_name().and_then(|n| n.to_str()) != Some("repo") {
        return Err(invalid(format!(
            "{} is not a tutorial demo repository",
            repo.display()
        )));
    }
    check_demo_shape(&base, &demo)?;
    Ok(repo)
}

/// Open the demo repository at `root` (canonical, already confined) — and only
/// that repository.
///
/// `open_repo` (`Repository::discover`) walks up from `root` until it finds a
/// `.git`, so a demo whose own `.git` is gone would resolve to an enclosing
/// repository. This opens with `NO_SEARCH` and then insists that the work tree
/// is exactly `root` and the git dir is a real `<root>/.git` directory (not a
/// symlink, and not a `.git` *file* redirecting to another repository's git
/// dir). Anything else is refused.
fn open_demo(root: &Path) -> AdgitterResult<Repository> {
    let repo = Repository::open_ext(root, RepositoryOpenFlags::NO_SEARCH, &[] as &[&OsStr])
        .map_err(|_| AdgitterError::RepoNotFound(root.display().to_string()))?;
    let dot_git = root.join(".git");
    let real_dot_git_dir = std::fs::symlink_metadata(&dot_git).is_ok_and(|m| m.is_dir());
    let canon = |p: &Path| std::fs::canonicalize(p).ok();
    let workdir_ok = repo
        .workdir()
        .and_then(canon)
        .is_some_and(|w| w.as_path() == root);
    let gitdir_ok = canon(repo.path()).is_some_and(|g| g == dot_git);
    if real_dot_git_dir && workdir_ok && gitdir_ok {
        Ok(repo)
    } else {
        Err(invalid(format!(
            "{} is not a self-contained tutorial demo repository",
            root.display()
        )))
    }
}

/// [`confine_repo`] plus [`open_demo`]'s check, for the functions that only
/// write files: they must not touch a demo that has lost its repository.
fn confine_demo(base_dir: &Path, repo: &Path) -> AdgitterResult<PathBuf> {
    let root = confine_repo(base_dir, repo)?;
    open_demo(&root)?;
    Ok(root)
}

/// Is this a spelling of `.git` that a Windows (NTFS) filesystem would resolve
/// to the git directory? Mirrors git's own `is_ntfs_dotgit`: trailing dots and
/// spaces are ignored, and the 8.3 short name is `GIT~<n>`. Case-insensitive.
fn is_dot_git_alias(segment: &str) -> bool {
    let name = segment.trim_end_matches(['.', ' ']);
    if name.eq_ignore_ascii_case(".git") {
        return true;
    }
    name.get(..4)
        .is_some_and(|head| head.eq_ignore_ascii_case("git~"))
        && name.len() > 4
        && name[4..].bytes().all(|b| b.is_ascii_digit())
}

/// Refuse one path component that is, or could be read as, part of `.git`.
///
/// `:` is refused outright (NTFS alternate data streams such as
/// `.git::$INDEX_ALLOCATION`, drive letters). A backslash is a separator on
/// Windows, so a component is also checked piecewise on `\` — the verdict must
/// not depend on the platform the demo happens to run on.
fn is_forbidden_component(part: &str) -> bool {
    part.contains(':') || part.split('\\').any(is_dot_git_alias)
}

/// Validate a repo-relative path and return it joined onto `repo_root`
/// (canonical). Refuses absolute paths, `..`, anything under `.git` (in any
/// spelling — see [`is_dot_git_alias`]), an empty path, and any path whose
/// deepest existing ancestor (or the file itself) resolves outside the
/// repository through a symlink.
fn confine_rel(repo_root: &Path, rel_path: &str) -> AdgitterResult<PathBuf> {
    if rel_path.is_empty() || rel_path.contains('\0') {
        return Err(invalid("path must be a non-empty relative path"));
    }
    let mut target = repo_root.to_path_buf();
    let mut normals = 0;
    for comp in Path::new(rel_path).components() {
        match comp {
            Component::Normal(part) => {
                if is_forbidden_component(&part.to_string_lossy()) {
                    return Err(invalid(format!("{rel_path}: .git is off limits")));
                }
                target.push(part);
                normals += 1;
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(invalid(format!(
                    "{rel_path}: must be relative and stay inside the repository"
                )));
            }
        }
    }
    if normals == 0 {
        return Err(invalid("path must name a file"));
    }
    // A symlink *inside* the repo can still lead out of it: resolve the deepest
    // part of the path that exists and require it to stay under the root.
    let mut probe = target.as_path();
    while !probe.exists() && std::fs::symlink_metadata(probe).is_err() {
        probe = match probe.parent() {
            Some(p) => p,
            None => return Err(invalid(format!("{rel_path}: cannot be resolved"))),
        };
    }
    let resolved = std::fs::canonicalize(probe)
        .map_err(|_| invalid(format!("{rel_path}: cannot be resolved")))?;
    if !resolved.starts_with(repo_root) {
        return Err(invalid(format!(
            "{rel_path}: resolves outside the repository"
        )));
    }
    Ok(target)
}

/// Write `content` to `rel_path` inside `repo_root` (canonical), creating
/// parent directories. Never follows a symlink out of the repository.
fn write_confined(repo_root: &Path, rel_path: &str, content: &str) -> AdgitterResult<()> {
    let target = confine_rel(repo_root, rel_path)?;
    if let Ok(meta) = std::fs::symlink_metadata(&target) {
        if meta.file_type().is_symlink() {
            return Err(invalid(format!("{rel_path}: is a symlink")));
        }
        if meta.is_dir() {
            return Err(invalid(format!("{rel_path}: is a directory")));
        }
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
        // Re-check after creating: the parent now exists, so this is the real
        // resolved location of everything we are about to write under.
        if !std::fs::canonicalize(parent)?.starts_with(repo_root) {
            return Err(invalid(format!(
                "{rel_path}: resolves outside the repository"
            )));
        }
    }
    std::fs::write(&target, content)?;
    Ok(())
}

// ── Building blocks ──────────────────────────────────────────────────────────

fn unix_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn learner_at(secs: i64) -> AdgitterResult<Signature<'static>> {
    Ok(Signature::new(
        LEARNER_NAME,
        LEARNER_EMAIL,
        &Time::new(secs, 0),
    )?)
}

/// `base` with `blob` at `comps` (a path split into components), creating any
/// missing directories and replacing a file already there. Returns the new
/// tree's oid. Used instead of the index so seeding never depends on — or
/// disturbs — whatever the user has staged.
fn tree_with_blob(
    repo: &Repository,
    base: Option<&Tree<'_>>,
    comps: &[&str],
    blob: Oid,
) -> AdgitterResult<Oid> {
    let mut builder = repo.treebuilder(base)?;
    match comps {
        [] => return Err(AdgitterError::Internal("empty path".into())),
        [leaf] => {
            builder.insert(leaf, blob, 0o100644)?;
        }
        [dir, rest @ ..] => {
            let existing = base
                .and_then(|t| t.get_name(dir))
                .filter(|e| e.kind() == Some(ObjectType::Tree))
                .map(|e| repo.find_tree(e.id()))
                .transpose()?;
            let sub = tree_with_blob(repo, existing.as_ref(), rest, blob)?;
            builder.insert(dir, sub, 0o040000)?;
        }
    }
    Ok(builder.write()?)
}

/// Creates the scripted commits as loose objects, one tick of the clock each.
struct History<'r> {
    repo: &'r Repository,
    next_time: i64,
}

impl<'r> History<'r> {
    /// A commit on top of `parent` adding/replacing `files`; no ref is moved.
    fn commit(
        &mut self,
        parent: Oid,
        files: &[(&str, &str)],
        message: &str,
    ) -> AdgitterResult<Oid> {
        self.commit_on(&[parent], files, message)
    }

    /// Like [`Self::commit`] with several parents (a merge): the tree starts
    /// from the first parent's and `files` are applied on top.
    fn commit_on(
        &mut self,
        parents: &[Oid],
        files: &[(&str, &str)],
        message: &str,
    ) -> AdgitterResult<Oid> {
        let parents = parents
            .iter()
            .map(|p| self.repo.find_commit(*p))
            .collect::<Result<Vec<_>, _>>()?;
        let mut tree = parents[0].tree()?;
        for (path, content) in files {
            let blob = self.repo.blob(content.as_bytes())?;
            let comps: Vec<&str> = path.split('/').collect();
            let oid = tree_with_blob(self.repo, Some(&tree), &comps, blob)?;
            tree = self.repo.find_tree(oid)?;
        }
        let sig = learner_at(self.next_time)?;
        self.next_time += 1;
        let refs: Vec<&git2::Commit> = parents.iter().collect();
        Ok(self.repo.commit(None, &sig, &sig, message, &tree, &refs)?)
    }
}

/// Push `branches`/`tags` to `origin`, make sure the remote-tracking refs
/// exist, and set each branch's upstream to `origin/<branch>`.
fn publish(repo: &Repository, branches: &[&str], tags: &[&str]) -> AdgitterResult<()> {
    let specs: Vec<String> = branches
        .iter()
        .map(|b| format!("refs/heads/{b}:refs/heads/{b}"))
        .chain(tags.iter().map(|t| format!("refs/tags/{t}:refs/tags/{t}")))
        .collect();
    repo.find_remote("origin")?.push(&specs, None)?;
    for branch in branches {
        // libgit2 normally updates the tracking ref after a push; writing it
        // ourselves makes `set_upstream` (which needs it) independent of that.
        let oid = repo.refname_to_id(&format!("refs/heads/{branch}"))?;
        repo.reference(
            &format!("refs/remotes/origin/{branch}"),
            oid,
            true,
            "tutorial demo: publish",
        )?;
        repo.find_branch(branch, BranchType::Local)?
            .set_upstream(Some(&format!("origin/{branch}")))?;
    }
    Ok(())
}

/// Delete every `demo-<digits>` *directory* directly inside `base_dir`.
///
/// Called from [`create_demo`] before it makes the new one, so everything it
/// finds is a leftover (the app was closed mid-tutorial). Entries are looked
/// at with `symlink_metadata`, so a symlink — even one named `demo-123` that
/// points at a directory — is skipped and never followed; files and other
/// names are left alone. Best effort: a failure on one entry (in use, no
/// permission) is ignored, and so is an unreadable `base_dir`.
fn remove_stale_demos(base_dir: &Path) {
    let Ok(entries) = std::fs::read_dir(base_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let is_demo = entry.file_name().to_str().is_some_and(is_demo_dir_name);
        let path = entry.path();
        let is_real_dir = std::fs::symlink_metadata(&path).is_ok_and(|m| m.is_dir());
        if is_demo && is_real_dir {
            let _ = std::fs::remove_dir_all(&path);
        }
    }
}

// ── Public API ───────────────────────────────────────────────────────────────

/// Create `<base_dir>/demo-<unix_ms>/{repo, origin.git}`: a repo on `main` with
/// a small starter history (C1 "Initial commit" - "Add project skeleton" -
/// "Write getting-started guide" - merge of the two-commit `docs/intro` branch -
/// "Add license", tag `v0.0.1` on the merge, so the graph tour has lanes, a
/// merge, a tag and a branch to point at), a bare `origin`, the push of `main`,
/// `docs/intro` and the tag, and `origin/<branch>` upstreams. Also writes the per-repo project
/// config that turns auto-pull off (see the module docs).
///
/// Any other `demo-<digits>` directory already in `base_dir` is an abandoned
/// earlier demo and is deleted first (see [`remove_stale_demos`]).
pub fn create_demo(base_dir: &Path) -> AdgitterResult<DemoRepo> {
    std::fs::create_dir_all(base_dir)?;
    remove_stale_demos(base_dir);
    let mut ms = unix_ms();
    let demo = loop {
        let candidate = base_dir.join(format!("demo-{ms}"));
        match std::fs::create_dir(&candidate) {
            Ok(()) => break candidate,
            // Two demos in the same millisecond: take the next free name.
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => ms += 1,
            Err(e) => return Err(e.into()),
        }
    };
    let repo_path = demo.join("repo");
    let remote_path = demo.join("origin.git");

    Repository::init_opts(
        &remote_path,
        RepositoryInitOptions::new().bare(true).initial_head(MAIN),
    )?;
    let repo = Repository::init_opts(&repo_path, RepositoryInitOptions::new().initial_head(MAIN))?;
    {
        let mut cfg = repo.config()?;
        cfg.set_str("user.name", LEARNER_NAME)?;
        cfg.set_str("user.email", LEARNER_EMAIL)?;
    }

    // Per-repo settings, hidden from status/commits via `.git/info/exclude`.
    std::fs::write(
        repo_path.join(PROJECT_CONFIG_FILENAME),
        demo_project_config(),
    )?;
    let info = repo.path().join("info");
    std::fs::create_dir_all(&info)?;
    let exclude = info.join("exclude");
    let mut text = std::fs::read_to_string(&exclude).unwrap_or_default();
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    text.push_str(PROJECT_CONFIG_FILENAME);
    text.push('\n');
    std::fs::write(&exclude, text)?;

    // Starter history, back-dated a little so the user's own commit (real time)
    // follows it. C1 first, one second apart from here on:
    //
    //   main:       C1 - skeleton - guide ------- merge - license   (tag v0.0.1 @ merge)
    //   docs/intro:          \- draft - polish -/
    let start = unix_secs() - 100;
    std::fs::write(
        repo_path.join("README.md"),
        "# ADGitter tutorial repository\n\n\
         A small practice repository. Nothing here is real, and it is deleted when the \
         tutorial ends.\n",
    )?;
    let mut index = repo.index()?;
    index.add_path(Path::new("README.md"))?;
    index.write()?;
    let tree = repo.find_tree(index.write_tree()?)?;
    let sig = learner_at(start)?;
    let c1 = repo.commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])?;

    let mut h = History {
        repo: &repo,
        next_time: start + 1,
    };
    let skeleton = h.commit(
        c1,
        &[(
            "package.json",
            "{\n  \"name\": \"tutorial-demo\",\n  \"private\": true\n}\n",
        )],
        "Add project skeleton",
    )?;
    let draft = h.commit(
        skeleton,
        &[(
            "docs/intro.md",
            "# Intro\n\nA first draft of the intro page.\n",
        )],
        "Draft intro page",
    )?;
    let polish = h.commit(
        draft,
        &[(
            "docs/intro.md",
            "# Introduction\n\nWelcome! This page explains what the demo is for.\n",
        )],
        "Polish intro wording",
    )?;
    let guide = h.commit(
        skeleton,
        &[(
            "docs/getting-started.md",
            "# Getting started\n\n1. Open the repository.\n2. Look at the commit graph.\n",
        )],
        "Write getting-started guide",
    )?;
    let merge = h.commit_on(
        &[guide, polish],
        &[(
            "docs/intro.md",
            "# Introduction\n\nWelcome! This page explains what the demo is for.\n",
        )],
        "Merge branch 'docs/intro'",
    )?;
    let license = h.commit(
        merge,
        &[(
            "LICENSE",
            "MIT License (demo only; nothing here is real).\n",
        )],
        "Add license",
    )?;

    let why = "tutorial demo: starter history";
    repo.reference("refs/heads/docs/intro", polish, false, why)?;
    let tagger = learner_at(start + 1)?;
    repo.tag(
        "v0.0.1",
        &repo.find_object(merge, None)?,
        &tagger,
        "Release v0.0.1",
        false,
    )?;
    let mut co = CheckoutBuilder::new();
    co.force();
    repo.reference(&format!("refs/heads/{MAIN}"), license, true, why)?;
    repo.reset(
        &repo.find_object(license, None)?,
        ResetType::Hard,
        Some(&mut co),
    )?;

    repo.remote("origin", &remote_path.to_string_lossy())?;
    publish(&repo, &[MAIN, "docs/intro"], &["v0.0.1"])?;

    Ok(DemoRepo {
        repo_path: repo_path.to_string_lossy().into_owned(),
        remote_path: remote_path.to_string_lossy().into_owned(),
    })
}

/// Tutorial step 5: write the untracked files the user stages and commits.
/// Returns their repo-relative paths.
pub fn seed_files(base_dir: &Path, repo: &Path) -> AdgitterResult<Vec<String>> {
    let root = confine_demo(base_dir, repo)?;
    SEED_FILES
        .iter()
        .map(|(path, content)| {
            write_confined(&root, path, content)?;
            Ok((*path).to_string())
        })
        .collect()
}

/// Tutorial step 6: build the rest of the demo history on top of whatever
/// `main` is now (C2, the user's commit) and publish it.
///
/// ```text
/// main:           C2 - C3 "Add config" - C4 "Add helpers" - C5 "Update docs"   (tags v0.1.0@C3, v0.2.0@C4)
/// feature/login:  from C4 - "Add login form" - "Validate login"
/// feature/theme:  from C5 - "Add drak theme" (typo, on purpose) - "Add theme switch"
/// experiment:     from C2 - "Try faster render" - "Log timings"
/// ```
///
/// `C3` also adds `secrets.env`, which step 14 purges. No file this adds
/// overlaps a seeded file, so the result never depends on which of those the
/// user committed or what they wrote — and every later merge, rebase and
/// cherry-pick in the script is conflict-free.
///
/// HEAD stays on `main`, hard-reset to C5 so the working tree matches. Seeded
/// files the user chose *not* to commit are removed, so the tree ends clean.
/// Branches and tags are pushed with `origin/<name>` upstreams.
pub fn seed_history(base_dir: &Path, repo: &Path) -> AdgitterResult<()> {
    let root = confine_repo(base_dir, repo)?;
    let _lock = lock_mutations();
    let repo = open_demo(&root)?;

    let head_ref = crate::history::current_branch(&repo)?;
    if head_ref != format!("refs/heads/{MAIN}") {
        return Err(AdgitterError::Internal(format!(
            "the demo history is seeded from `{MAIN}`, but HEAD is on {head_ref}"
        )));
    }
    for name in ["feature/login", "feature/theme", "experiment"] {
        if repo.find_branch(name, BranchType::Local).is_ok() {
            return Err(AdgitterError::Internal(format!(
                "demo history already seeded ({name} exists)"
            )));
        }
    }

    let c2 = repo.head()?.peel_to_commit()?;
    let c2_time = c2.time().seconds();
    // Strictly after C2 (which carries real time), then one second apart.
    let mut h = History {
        repo: &repo,
        next_time: c2_time.max(unix_secs()) + 1,
    };

    // Creation order doubles as the time order: the experiment forks early,
    // the login branch forks from C4, the theme branch from C5.
    let e1 = h.commit(
        c2.id(),
        &[(
            "src/render.js",
            "export const render = (el) => el.replaceChildren();\n",
        )],
        "Try faster render",
    )?;
    let e2 = h.commit(
        e1,
        &[(
            "src/timing.js",
            "export const time = (label) => console.time(label);\n",
        )],
        "Log timings",
    )?;
    let c3 = h.commit(
        c2.id(),
        &[
            (
                "config.json",
                "{\n  \"name\": \"demo\",\n  \"debug\": false\n}\n",
            ),
            (
                "secrets.env",
                "API_KEY=demo-not-a-real-key\nDB_PASSWORD=demo-not-a-real-password\n",
            ),
        ],
        "Add config",
    )?;
    let c4 = h.commit(
        c3,
        &[(
            "src/utils.js",
            "export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));\n",
        )],
        "Add helpers",
    )?;
    let l1 = h.commit(
        c4,
        &[(
            "src/login.js",
            "export function loginForm() {\n  return '<form id=\"login\"></form>';\n}\n",
        )],
        "Add login form",
    )?;
    let l2 = h.commit(
        l1,
        &[(
            "src/login.js",
            "export function loginForm() {\n  return '<form id=\"login\"></form>';\n}\n\n\
             export function validate(user, pass) {\n  return user.length > 0 && pass.length >= 8;\n}\n",
        )],
        "Validate login",
    )?;
    let c5 = h.commit(
        c4,
        &[(
            "docs/guide.md",
            "# Guide\n\nRun the app, then open the page. See `notes.md` for ideas.\n",
        )],
        "Update docs",
    )?;
    let t1 = h.commit(
        c5,
        &[(
            "themes/dark.css",
            "body {\n  background: #111;\n  color: #eee;\n}\n",
        )],
        "Add drak theme",
    )?;
    let t2 = h.commit(
        t1,
        &[(
            "themes/switch.js",
            "export const toggle = () => document.body.classList.toggle('dark');\n",
        )],
        "Add theme switch",
    )?;

    // Objects are all written; only now move refs, so a failure above leaves
    // the repository untouched.
    let why = "tutorial demo: seed history";
    for (name, oid) in [
        ("feature/login", l2),
        ("feature/theme", t2),
        ("experiment", e2),
    ] {
        repo.reference(&format!("refs/heads/{name}"), oid, false, why)?;
    }
    let tagger = learner_at(c2_time.max(unix_secs()))?;
    for (name, oid) in [("v0.1.0", c3), ("v0.2.0", c4)] {
        let target = repo.find_object(oid, None)?;
        repo.tag(name, &target, &tagger, &format!("Release {name}"), false)?;
    }

    // Move `main` to C5 and bring index + working tree with it.
    let c5_obj = repo.find_object(c5, None)?;
    let mut co = CheckoutBuilder::new();
    co.force();
    repo.reset(&c5_obj, ResetType::Hard, Some(&mut co))?;

    // A hard reset leaves untracked files alone: drop the seeded files the user
    // did not commit so the tree really is clean.
    for (path, _) in SEED_FILES {
        let leftover = repo
            .status_file(Path::new(path))
            .is_ok_and(|s| s.contains(git2::Status::WT_NEW));
        if leftover {
            let _ = std::fs::remove_file(root.join(path));
        }
    }

    publish(
        &repo,
        &[MAIN, "feature/login", "feature/theme", "experiment"],
        &["v0.1.0", "v0.2.0"],
    )
}

/// Write one file inside the demo repo (`rel_path` is repo-relative).
pub fn write_file(
    base_dir: &Path,
    repo: &Path,
    rel_path: &str,
    content: &str,
) -> AdgitterResult<()> {
    let root = confine_demo(base_dir, repo)?;
    write_confined(&root, rel_path, content)
}

/// Tutorial step 20: append `count` simulated Log Anytime snapshots to
/// `branch` and return their shas, oldest first.
///
/// Each round edits `scratch.md` in the working tree, then calls the real
/// [`crate::log_anytime::log_commit`], so the snapshots are exactly what the
/// timer would have produced. `log_commit` never moves HEAD or touches the
/// index, which leaves the edit behind in the working tree — so afterwards the
/// file is put back as it was (deleted if it did not exist), leaving the tree
/// as clean as it was before the call. `branch` must be a valid branch name
/// other than the checked-out one.
pub fn simulate_log(
    base_dir: &Path,
    repo: &Path,
    branch: &str,
    count: usize,
) -> AdgitterResult<Vec<String>> {
    let root = confine_repo(base_dir, repo)?;
    let checked_out = crate::history::current_branch(&open_demo(&root)?)?;
    if count > SIM_MAX {
        return Err(AdgitterError::Internal(format!(
            "at most {SIM_MAX} simulated snapshots at a time"
        )));
    }
    if !git2::Reference::is_valid_name(&format!("refs/heads/{branch}")) {
        return Err(AdgitterError::Internal(format!(
            "invalid branch name: {branch}"
        )));
    }
    if checked_out == format!("refs/heads/{branch}") {
        return Err(AdgitterError::Internal(format!(
            "{branch} is checked out — a simulated log would rewrite the user's branch"
        )));
    }

    let sim_path = confine_rel(&root, SIM_FILE)?;
    let original = std::fs::read(&sim_path).ok();
    let mut shas = Vec::new();
    let mut result = Ok(());
    for i in 1..=count {
        let mut text = original
            .as_ref()
            .map(|b| String::from_utf8_lossy(b).into_owned())
            .unwrap_or_default();
        for n in 1..=i {
            text.push_str(&format!(
                "Edit {n}: tweaked the demo while Log Anytime was on.\n"
            ));
        }
        // `log_commit` opens the repo with `discover` (it walks up), so each
        // round re-verifies that `root` still holds the demo's own repository
        // right before handing it over.
        let step = write_confined(&root, SIM_FILE, &text)
            .and_then(|()| open_demo(&root).map(drop))
            .and_then(|()| crate::log_anytime::log_commit(root.clone(), branch.to_string()));
        match step {
            Ok(Some(sha)) => shas.push(sha),
            Ok(None) => {}
            Err(e) => {
                result = Err(e);
                break;
            }
        }
    }
    // Restore the working tree whatever happened above.
    match &original {
        Some(bytes) => std::fs::write(&sim_path, bytes)?,
        None => {
            let _ = std::fs::remove_file(&sim_path);
        }
    }
    result.map(|()| shas)
}

/// Delete the whole `demo-<ms>` directory that contains `repo` (working
/// repository and `origin.git`). Already-gone is success, so exiting and then
/// finishing the tutorial can both call it.
pub fn remove_demo(base_dir: &Path, repo: &Path) -> AdgitterResult<()> {
    let base = std::fs::canonicalize(base_dir)
        .map_err(|_| invalid(format!("{} does not exist", base_dir.display())))?;
    let not_a_demo = || {
        invalid(format!(
            "{} is not a tutorial demo repository",
            repo.display()
        ))
    };
    if repo.file_name().and_then(|n| n.to_str()) != Some("repo") {
        return Err(not_a_demo());
    }
    let demo = match repo.parent().map(std::fs::canonicalize) {
        Some(Ok(d)) => d,
        // Nothing there to delete.
        Some(Err(e)) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Some(Err(e)) => return Err(e.into()),
        None => return Err(not_a_demo()),
    };
    check_demo_shape(&base, &demo)?;
    // A `repo` that exists must really be `<demo>/repo` — not a link elsewhere.
    match std::fs::canonicalize(repo) {
        Ok(real) if real != demo.join("repo") => return Err(not_a_demo()),
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    std::fs::remove_dir_all(&demo)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::remote::push;
    use crate::repo::CloneAuth;
    use crate::{workdir, GitRef};
    use std::collections::HashSet;
    use tempfile::TempDir;

    /// A base dir inside a fresh temp dir (not created until `create_demo`).
    fn base() -> (TempDir, PathBuf) {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path().join("tutorial");
        (tmp, base)
    }

    fn demo() -> (TempDir, PathBuf, PathBuf) {
        let (tmp, base) = base();
        let d = create_demo(&base).unwrap();
        (tmp, base, PathBuf::from(d.repo_path))
    }

    /// `create_demo` + `seed_files` + the user's step-5 commit of every seeded
    /// file, as the real flow does through the UI.
    fn demo_with_c2() -> (TempDir, PathBuf, PathBuf) {
        let (tmp, base, repo) = demo();
        let files = seed_files(&base, &repo).unwrap();
        workdir::stage(repo.clone(), files).unwrap();
        workdir::commit(repo.clone(), "Add starter files".into(), false).unwrap();
        (tmp, base, repo)
    }

    fn git(repo: &Path) -> Repository {
        Repository::open(repo).unwrap()
    }

    fn rev(repo: &Path, spec: &str) -> String {
        git(repo)
            .revparse_single(spec)
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .id()
            .to_string()
    }

    fn subject(repo: &Path, spec: &str) -> String {
        git(repo)
            .revparse_single(spec)
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .summary()
            .unwrap()
            .to_string()
    }

    fn parents(repo: &Path, spec: &str) -> Vec<String> {
        git(repo)
            .revparse_single(spec)
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .parent_ids()
            .map(|p| p.to_string())
            .collect()
    }

    /// The one commit reachable from `from` with this subject — how the script
    /// finds commits after earlier steps rewrote their shas.
    ///
    /// Deliberately NOT "the one live commit in the graph": once step 14 has
    /// rewritten history, the tags `v0.1.0`/`v0.2.0` still hold the old
    /// "Add config"/"Add helpers" alive (see the script test), so the graph has
    /// two of each. Reachability from the branch being edited disambiguates.
    fn by_subject(repo: &Path, from: &str, wanted: &str) -> String {
        let r = git(repo);
        let mut walk = r.revwalk().unwrap();
        walk.push(r.revparse_single(from).unwrap().id()).unwrap();
        let hits: Vec<String> = walk
            .map(|oid| r.find_commit(oid.unwrap()).unwrap())
            .filter(|c| c.summary() == Some(wanted))
            .map(|c| c.id().to_string())
            .collect();
        assert_eq!(
            hits.len(),
            1,
            "expected exactly one {wanted:?} under {from}: {hits:?}"
        );
        hits[0].clone()
    }

    fn assert_clean(repo: &Path) {
        let st = workdir::status(repo.to_path_buf()).unwrap();
        assert!(
            st.staged.is_empty() && st.changed.is_empty() && st.untracked.is_empty(),
            "working tree not clean: staged {:?} changed {:?} untracked {:?}",
            st.staged,
            st.changed,
            st.untracked
        );
        assert!(st.conflicted.is_empty());
    }

    fn head_branch(repo: &Path) -> String {
        crate::list_refs(repo.to_path_buf())
            .unwrap()
            .head
            .branch
            .unwrap()
    }

    fn tree_has(repo: &Path, spec: &str, path: &str) -> bool {
        git(repo)
            .revparse_single(spec)
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .tree()
            .unwrap()
            .get_path(Path::new(path))
            .is_ok()
    }

    /// Does any commit reachable from `spec` carry `path`?
    fn history_has(repo: &Path, spec: &str, path: &str) -> bool {
        let r = git(repo);
        let mut walk = r.revwalk().unwrap();
        walk.push(r.revparse_single(spec).unwrap().id()).unwrap();
        walk.any(|oid| {
            r.find_commit(oid.unwrap())
                .unwrap()
                .tree()
                .unwrap()
                .get_path(Path::new(path))
                .is_ok()
        })
    }

    fn branch<'a>(refs: &'a [GitRef], name: &str) -> &'a GitRef {
        refs.iter()
            .find(|b| b.name == name)
            .unwrap_or_else(|| panic!("no branch {name}"))
    }

    // ── create_demo ──────────────────────────────────────────────────────────

    #[test]
    fn create_demo_builds_repo_and_bare_origin_with_pushed_main() {
        let (_tmp, _base, repo) = demo();

        let demo_dir = repo.parent().unwrap();
        assert!(is_demo_dir_name(
            demo_dir.file_name().unwrap().to_str().unwrap()
        ));
        assert_eq!(repo.file_name().unwrap(), "repo");
        let origin = demo_dir.join("origin.git");
        assert!(Repository::open(&origin).unwrap().is_bare());

        let r = git(&repo);
        let cfg = r.config().unwrap().snapshot().unwrap();
        assert_eq!(cfg.get_str("user.name").unwrap(), "ADGitter Learner");
        assert_eq!(cfg.get_str("user.email").unwrap(), "learner@example.com");
        assert_eq!(head_branch(&repo), "main");
        // Starter history: main is C1 - skeleton - guide - merge - license,
        // with docs/intro (2 commits) merged in and v0.0.1 on the merge.
        assert_eq!(subject(&repo, "HEAD"), "Add license");
        assert_eq!(subject(&repo, "HEAD~"), "Merge branch 'docs/intro'");
        assert_eq!(parents(&repo, "HEAD~").len(), 2);
        assert_eq!(subject(&repo, "HEAD~2"), "Write getting-started guide");
        assert_eq!(subject(&repo, "HEAD~3"), "Add project skeleton");
        assert_eq!(subject(&repo, "HEAD~4"), "Initial commit");
        assert!(parents(&repo, "HEAD~4").is_empty());
        assert_eq!(subject(&repo, "HEAD~^2"), "Polish intro wording");
        assert_eq!(subject(&repo, "HEAD~^2~"), "Draft intro page");
        assert!(tree_has(&repo, "HEAD", "README.md"));
        assert!(tree_has(&repo, "HEAD", "docs/intro.md"));
        assert!(tree_has(&repo, "HEAD", "LICENSE"));
        assert_eq!(rev(&repo, "docs/intro"), rev(&repo, "HEAD~^2"));

        // main is published and tracks origin/main.
        let refs = crate::list_refs(repo.clone()).unwrap();
        let main = branch(&refs.branches, "main");
        assert_eq!(main.has_upstream, Some(true));
        assert_eq!(
            branch(&refs.branches, "docs/intro").has_upstream,
            Some(true)
        );
        let tag = refs.tags.iter().find(|t| t.name == "v0.0.1").unwrap();
        assert_eq!(tag.target, rev(&repo, "HEAD~"));
        assert!(Repository::open(&origin)
            .unwrap()
            .refname_to_id("refs/tags/v0.0.1")
            .is_ok());
        assert_eq!(
            crate::branch_upstream(repo.clone(), "main".into()).unwrap(),
            Some("origin/main".into())
        );
        assert_eq!(
            Repository::open(&origin)
                .unwrap()
                .refname_to_id("refs/heads/main")
                .unwrap()
                .to_string(),
            rev(&repo, "HEAD")
        );
        assert_clean(&repo);
    }

    #[test]
    fn create_demo_turns_auto_pull_off_in_the_project_config_and_hides_the_file() {
        let (_tmp, _base, repo) = demo();
        let text = std::fs::read_to_string(repo.join("adgitter.config.json")).unwrap();
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["general"]["autoPull"], "off");
        assert!(v["general"]["autoPullBefore"]
            .as_object()
            .unwrap()
            .values()
            .all(|b| b == false));
        // Not untracked, not committed, not snapshotted.
        assert_clean(&repo);
        assert!(!tree_has(&repo, "HEAD", "adgitter.config.json"));
        let st = workdir::status(repo.clone()).unwrap();
        assert!(st.ignored.iter().any(|e| e.path == "adgitter.config.json"));
    }

    #[test]
    fn create_demo_json_is_camel_case() {
        let json = serde_json::to_value(DemoRepo {
            repo_path: "a".into(),
            remote_path: "b".into(),
        })
        .unwrap();
        assert_eq!(json["repoPath"], "a");
        assert_eq!(json["remotePath"], "b");
    }

    // ── seed_files / write_file ──────────────────────────────────────────────

    #[test]
    fn seed_files_writes_three_untracked_files() {
        let (_tmp, base, repo) = demo();
        let files = seed_files(&base, &repo).unwrap();
        assert_eq!(files, ["src/app.js", "src/style.css", "docs/notes.md"]);
        let st = workdir::status(repo.clone()).unwrap();
        let mut untracked: Vec<_> = st.untracked.iter().map(|e| e.path.clone()).collect();
        untracked.sort();
        assert_eq!(untracked, ["docs/notes.md", "src/app.js", "src/style.css"]);
        assert!(st.staged.is_empty() && st.changed.is_empty());
    }

    #[test]
    fn write_file_creates_parents_and_overwrites() {
        let (_tmp, base, repo) = demo();
        write_file(&base, &repo, "a/b/c.txt", "one").unwrap();
        assert_eq!(
            std::fs::read_to_string(repo.join("a/b/c.txt")).unwrap(),
            "one"
        );
        write_file(&base, &repo, "a/b/c.txt", "two").unwrap();
        assert_eq!(
            std::fs::read_to_string(repo.join("a/b/c.txt")).unwrap(),
            "two"
        );
        write_file(&base, &repo, "./top.txt", "x").unwrap();
        assert!(repo.join("top.txt").exists());
    }

    // ── seed_history ─────────────────────────────────────────────────────────

    #[test]
    fn seed_history_builds_the_scripted_topology() {
        let (_tmp, _base, repo) = demo_with_c2();
        let base = _base;
        let c2 = rev(&repo, "HEAD");
        seed_history(&base, &repo).unwrap();

        // main: C2 - C3 - C4 - C5, HEAD on main, tree clean.
        assert_eq!(head_branch(&repo), "main");
        assert_eq!(subject(&repo, "main"), "Update docs");
        assert_eq!(subject(&repo, "main~"), "Add helpers");
        assert_eq!(subject(&repo, "main~2"), "Add config");
        assert_eq!(rev(&repo, "main~3"), c2);
        assert_eq!(subject(&repo, "main~3"), "Add starter files");
        assert_clean(&repo);
        assert!(tree_has(&repo, "main", "secrets.env"));
        assert!(tree_has(&repo, "main", "docs/guide.md"));
        assert!(
            tree_has(&repo, "main", "docs/notes.md"),
            "C2's files survive"
        );

        // Tags on C3 / C4 (annotated, but they still resolve to the commit).
        let refs = crate::list_refs(repo.clone()).unwrap();
        assert_eq!(
            refs.tags
                .iter()
                .find(|t| t.name == "v0.1.0")
                .unwrap()
                .target,
            rev(&repo, "main~2")
        );
        assert_eq!(
            refs.tags
                .iter()
                .find(|t| t.name == "v0.2.0")
                .unwrap()
                .target,
            rev(&repo, "main~")
        );

        // feature/login from C4.
        assert_eq!(subject(&repo, "feature/login"), "Validate login");
        assert_eq!(subject(&repo, "feature/login~"), "Add login form");
        assert_eq!(rev(&repo, "feature/login~2"), rev(&repo, "main~"));
        assert!(tree_has(&repo, "feature/login", "src/login.js"));
        // feature/theme from C5.
        assert_eq!(subject(&repo, "feature/theme"), "Add theme switch");
        assert_eq!(subject(&repo, "feature/theme~"), "Add drak theme");
        assert_eq!(rev(&repo, "feature/theme~2"), rev(&repo, "main"));
        assert!(tree_has(&repo, "feature/theme~", "themes/dark.css"));
        assert!(tree_has(&repo, "feature/theme", "themes/switch.js"));
        // experiment from C2.
        assert_eq!(subject(&repo, "experiment"), "Log timings");
        assert_eq!(subject(&repo, "experiment~"), "Try faster render");
        assert_eq!(rev(&repo, "experiment~2"), c2);
        assert!(tree_has(&repo, "experiment~", "src/render.js"));
        assert!(tree_has(&repo, "experiment", "src/timing.js"));

        // Everything is published with upstreams.
        let origin = git(&repo.parent().unwrap().join("origin.git"));
        for b in ["main", "feature/login", "feature/theme", "experiment"] {
            assert_eq!(
                origin
                    .refname_to_id(&format!("refs/heads/{b}"))
                    .unwrap()
                    .to_string(),
                rev(&repo, b),
                "{b} pushed"
            );
            assert_eq!(
                crate::branch_upstream(repo.clone(), b.into()).unwrap(),
                Some(format!("origin/{b}")),
                "{b} upstream"
            );
        }
        for t in ["v0.1.0", "v0.2.0"] {
            assert!(
                origin.refname_to_id(&format!("refs/tags/{t}")).is_ok(),
                "{t} pushed"
            );
        }
    }

    /// Subjects of the starter history `create_demo` builds (before step 5).
    const STARTER_SUBJECTS: [&str; 7] = [
        "Initial commit",
        "Add project skeleton",
        "Draft intro page",
        "Polish intro wording",
        "Write getting-started guide",
        "Merge branch 'docs/intro'",
        "Add license",
    ];

    #[test]
    fn seeded_commits_have_distinct_increasing_times_after_c2() {
        let (_tmp, base, repo) = demo_with_c2();
        let c2_time = git(&repo)
            .head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .time()
            .seconds();
        seed_history(&base, &repo).unwrap();

        let page = crate::list_commits(repo.clone(), None).unwrap();
        let seeded: Vec<_> = page
            .commits
            .iter()
            .filter(|c| c.author_email == "learner@example.com")
            .filter(|c| c.subject != "Add starter files")
            .filter(|c| !STARTER_SUBJECTS.contains(&c.subject.as_str()))
            .collect();
        assert_eq!(seeded.len(), 9, "C3-C5 + 2 login + 2 theme + 2 experiment");
        let times: HashSet<i64> = seeded.iter().map(|c| c.timestamp).collect();
        assert_eq!(times.len(), 9, "every seeded commit has its own time");
        assert!(seeded.iter().all(|c| c.timestamp > c2_time));
        // A child is never older than its parent.
        for c in &seeded {
            for p in &c.parents {
                let parent = page.commits.iter().find(|x| &x.sha == p).unwrap();
                assert!(
                    c.timestamp > parent.timestamp,
                    "{} vs {}",
                    c.subject,
                    parent.subject
                );
            }
        }
    }

    #[test]
    fn seed_history_cleans_up_seeded_files_the_user_did_not_commit() {
        let (_tmp, base, repo) = demo();
        let files = seed_files(&base, &repo).unwrap();
        // The user commits only one of the three files.
        workdir::stage(repo.clone(), vec![files[0].clone()]).unwrap();
        workdir::commit(repo.clone(), "Add the app".into(), false).unwrap();
        seed_history(&base, &repo).unwrap();

        assert_clean(&repo);
        assert!(!repo.join("src/style.css").exists());
        assert!(!repo.join("docs/notes.md").exists());
        assert_eq!(subject(&repo, "main~3"), "Add the app");
        assert!(repo.join("src/app.js").exists());
        assert!(repo.join("docs/guide.md").exists());
    }

    #[test]
    fn seed_history_does_not_depend_on_what_the_user_committed() {
        // The user ignored the seeded files and committed their own `docs`
        // dir and a file already named like one of ours.
        let (_tmp, base, repo) = demo();
        write_file(&base, &repo, "docs/guide.md", "my own guide\n").unwrap();
        write_file(&base, &repo, "src/login.js", "// mine\n").unwrap();
        workdir::stage(
            repo.clone(),
            vec!["docs/guide.md".into(), "src/login.js".into()],
        )
        .unwrap();
        workdir::commit(repo.clone(), "My commit".into(), false).unwrap();
        seed_history(&base, &repo).unwrap();
        assert_clean(&repo);
        assert_eq!(subject(&repo, "main"), "Update docs");
        assert_eq!(subject(&repo, "feature/login"), "Validate login");
    }

    #[test]
    fn seed_history_refuses_off_main_and_a_second_run() {
        let (_tmp, base, repo) = demo_with_c2();
        crate::branch::create_branch(repo.clone(), "side".into(), "main".into()).unwrap();
        crate::branch::checkout(repo.clone(), "side".into()).unwrap();
        assert!(seed_history(&base, &repo).is_err(), "HEAD is not on main");
        crate::branch::checkout(repo.clone(), "main".into()).unwrap();
        seed_history(&base, &repo).unwrap();
        assert!(seed_history(&base, &repo).is_err(), "already seeded");
    }

    // ── simulate_log ─────────────────────────────────────────────────────────

    #[test]
    fn simulate_log_adds_snapshots_to_the_branch_and_restores_the_tree() {
        let (_tmp, base, repo) = demo_with_c2();
        seed_history(&base, &repo).unwrap();
        crate::branch::checkout(repo.clone(), "feature/theme".into()).unwrap();
        let head_before = rev(&repo, "HEAD");

        let shas = simulate_log(&base, &repo, "adgitter-log", 3).unwrap();
        assert_eq!(shas.len(), 3);
        assert_eq!(shas.iter().collect::<HashSet<_>>().len(), 3);

        // The branch holds exactly those commits, chained, newest on top.
        assert_eq!(rev(&repo, "adgitter-log"), shas[2]);
        assert_eq!(parents(&repo, "adgitter-log"), [shas[1].clone()]);
        assert_eq!(parents(&repo, &shas[1]), [shas[0].clone()]);
        assert!(subject(&repo, "adgitter-log").starts_with("log: snapshot"));
        assert!(tree_has(&repo, "adgitter-log", "scratch.md"));
        assert!(tree_has(&repo, "adgitter-log", "themes/dark.css"));

        // HEAD, branch and tree are as before.
        assert_eq!(head_branch(&repo), "feature/theme");
        assert_eq!(rev(&repo, "HEAD"), head_before);
        assert!(!repo.join("scratch.md").exists());
        assert_clean(&repo);

        // A later call keeps chaining onto the same branch.
        let more = simulate_log(&base, &repo, "adgitter-log", 1).unwrap();
        assert_eq!(parents(&repo, &more[0]), [shas[2].clone()]);
    }

    #[test]
    fn simulate_log_refuses_the_checked_out_branch_bad_names_and_huge_counts() {
        let (_tmp, base, repo) = demo_with_c2();
        assert!(simulate_log(&base, &repo, "main", 1).is_err());
        assert!(simulate_log(&base, &repo, "bad name", 1).is_err());
        assert!(simulate_log(&base, &repo, "x", SIM_MAX + 1).is_err());
        assert_eq!(
            simulate_log(&base, &repo, "x", 0).unwrap(),
            Vec::<String>::new()
        );
        assert!(git(&repo).find_branch("x", BranchType::Local).is_err());
    }

    #[test]
    fn simulate_log_preserves_an_existing_scratch_file() {
        let (_tmp, base, repo) = demo_with_c2();
        write_file(&base, &repo, "scratch.md", "mine\n").unwrap();
        simulate_log(&base, &repo, "adgitter-log", 2).unwrap();
        assert_eq!(
            std::fs::read_to_string(repo.join("scratch.md")).unwrap(),
            "mine\n"
        );
    }

    // ── remove_demo ──────────────────────────────────────────────────────────

    #[test]
    fn remove_demo_deletes_the_whole_demo_directory_and_only_that() {
        let (_tmp, base) = base();
        let a = PathBuf::from(create_demo(&base).unwrap().repo_path);
        // `create_demo` clears older demos, so the neighbour is made by hand.
        let b = base.join("demo-5").join("repo");
        std::fs::create_dir_all(&b).unwrap();
        let a_dir = a.parent().unwrap().to_path_buf();
        remove_demo(&base, &a).unwrap();
        assert!(!a_dir.exists(), "repo and origin.git gone");
        assert!(b.exists(), "the other demo is untouched");
        remove_demo(&base, &a).unwrap(); // already gone is fine
        assert!(base.exists());
    }

    // ── confinement ──────────────────────────────────────────────────────────

    fn is_invalid<T: std::fmt::Debug>(r: AdgitterResult<T>) -> bool {
        matches!(
            r,
            Err(AdgitterError::InvalidPath(_) | AdgitterError::RepoNotFound(_))
        )
    }

    #[test]
    fn every_function_refuses_a_repo_outside_the_base_dir() {
        let (tmp, base, _repo) = demo();
        // A perfectly valid demo-shaped repo — but under another base.
        let other_base = tmp.path().join("elsewhere");
        let other = PathBuf::from(create_demo(&other_base).unwrap().repo_path);
        assert!(is_invalid(seed_files(&base, &other)));
        assert!(is_invalid(seed_history(&base, &other)));
        assert!(is_invalid(write_file(&base, &other, "x.txt", "x")));
        assert!(is_invalid(simulate_log(&base, &other, "log", 1)));
        assert!(is_invalid(remove_demo(&base, &other)));
        assert!(other.exists(), "nothing was deleted");
        assert!(!other.join("x.txt").exists());
    }

    #[test]
    fn repo_paths_must_be_exactly_base_demo_repo() {
        let (tmp, base, repo) = demo();
        let demo_dir = repo.parent().unwrap().to_path_buf();
        // The base itself, the demo dir, the bare origin, and `..` tricks.
        for bad in [
            base.clone(),
            demo_dir.clone(),
            demo_dir.join("origin.git"),
            repo.join(".."),
            repo.join("..").join(".."),
            demo_dir
                .join("repo")
                .join("..")
                .join("repo")
                .join("..")
                .join(".."),
            tmp.path().to_path_buf(),
            PathBuf::from("/"),
        ] {
            assert!(is_invalid(write_file(&base, &bad, "x.txt", "x")), "{bad:?}");
            assert!(is_invalid(remove_demo(&base, &bad)), "remove {bad:?}");
        }
        assert!(demo_dir.exists() && base.exists() && tmp.path().exists());

        // A repo-shaped dir in a directory that is not named demo-<digits>.
        let fake = base.join("not-a-demo").join("repo");
        std::fs::create_dir_all(&fake).unwrap();
        assert!(is_invalid(write_file(&base, &fake, "x.txt", "x")));
        let fake2 = base.join("demo-12x").join("repo");
        std::fs::create_dir_all(&fake2).unwrap();
        assert!(is_invalid(write_file(&base, &fake2, "x.txt", "x")));
        assert!(is_invalid(remove_demo(&base, &fake2)));
        assert!(fake2.exists());
    }

    #[test]
    fn write_file_refuses_paths_that_escape_the_repo() {
        let (tmp, base, repo) = demo();
        let outside = tmp.path().join("outside.txt");
        for rel in [
            "../outside.txt",
            "../../outside.txt",
            "a/../../outside.txt",
            "a/../../../outside.txt",
            "/etc/adgitter-test",
            outside.to_str().unwrap(),
            ".git/config",
            ".git/hooks/pre-commit",
            ".GIT/hooks/pre-commit",
            "sub/.git/config",
            "",
            ".",
            "nul\0byte",
        ] {
            assert!(
                is_invalid(write_file(&base, &repo, rel, "pwned")),
                "{rel:?} must be refused"
            );
        }
        assert!(!outside.exists());
        assert!(!Path::new("/etc/adgitter-test").exists());
        let cfg = std::fs::read_to_string(repo.join(".git/config")).unwrap();
        assert!(!cfg.contains("pwned"));
    }

    #[cfg(unix)]
    #[test]
    fn write_file_refuses_symlink_escapes() {
        use std::os::unix::fs::symlink;
        let (tmp, base, repo) = demo();
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(&outside).unwrap();

        // A directory link out of the repo, written through at any depth.
        symlink(&outside, repo.join("link")).unwrap();
        assert!(is_invalid(write_file(&base, &repo, "link/x.txt", "x")));
        assert!(is_invalid(write_file(
            &base,
            &repo,
            "link/deep/er/x.txt",
            "x"
        )));
        assert!(!outside.join("x.txt").exists());
        assert!(!outside.join("deep").exists());

        // A file link out of the repo is not written through either.
        std::fs::write(outside.join("target.txt"), "original").unwrap();
        symlink(outside.join("target.txt"), repo.join("flink.txt")).unwrap();
        assert!(is_invalid(write_file(&base, &repo, "flink.txt", "x")));
        assert_eq!(
            std::fs::read_to_string(outside.join("target.txt")).unwrap(),
            "original"
        );

        // The repo itself linked from inside the base is refused (it resolves
        // outside the base).
        let stolen = base.join("demo-1");
        std::fs::create_dir_all(&stolen).unwrap();
        symlink(&outside, stolen.join("repo")).unwrap();
        assert!(is_invalid(write_file(
            &base,
            &stolen.join("repo"),
            "x.txt",
            "x"
        )));
        assert!(is_invalid(remove_demo(&base, &stolen.join("repo"))));
        assert!(outside.exists());
    }

    // ── L2: the demo is opened without searching upwards ─────────────────────

    /// An enclosing repository on `main` with one (empty-tree) commit and a
    /// `tutorial` base directory inside it — the shape of a dotfiles repo at
    /// `~` that a demo whose own `.git` vanished would otherwise fall into.
    fn enclosing_repo() -> (TempDir, PathBuf, Vec<(String, String)>) {
        let outer = TempDir::new().unwrap();
        let repo = Repository::init_opts(
            outer.path(),
            RepositoryInitOptions::new().initial_head(MAIN),
        )
        .unwrap();
        let tree = repo
            .find_tree(repo.treebuilder(None).unwrap().write().unwrap())
            .unwrap();
        let sig = learner_at(unix_secs() - 3600).unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "outer", &tree, &[])
            .unwrap();
        let snapshot = ref_snapshot(outer.path());
        let base = outer.path().join("tutorial");
        (outer, base, snapshot)
    }

    /// Every ref (and HEAD) of the repo at `path` with the oid it resolves to.
    fn ref_snapshot(path: &Path) -> Vec<(String, String)> {
        let repo = Repository::open(path).unwrap();
        let mut refs: Vec<(String, String)> = repo
            .references()
            .unwrap()
            .map(|r| {
                let r = r.unwrap();
                (
                    r.name().unwrap().to_string(),
                    r.resolve().unwrap().target().unwrap().to_string(),
                )
            })
            .collect();
        refs.push((
            "HEAD".into(),
            repo.head().unwrap().target().unwrap().to_string(),
        ));
        refs.sort();
        refs
    }

    /// Every demo function must refuse `repo` and leave `outer` — the
    /// enclosing repository — and the demo working tree untouched.
    fn assert_refused_and_outer_untouched(
        outer: &Path,
        snapshot: &[(String, String)],
        base: &Path,
        repo: &Path,
    ) {
        assert!(is_invalid(seed_files(base, repo)));
        assert!(is_invalid(seed_history(base, repo)));
        assert!(is_invalid(write_file(base, repo, "x.txt", "x")));
        assert!(is_invalid(simulate_log(base, repo, "log", 2)));
        assert_eq!(ref_snapshot(outer), snapshot, "enclosing repo's refs moved");
        for leftover in ["src", "docs/notes.md", "x.txt", "scratch.md"] {
            assert!(!repo.join(leftover).exists(), "{leftover} was written");
            assert!(!outer.join(leftover).exists(), "{leftover} leaked upwards");
        }
        let outer_repo = Repository::open(outer).unwrap();
        assert!(outer_repo.head().unwrap().is_branch());
        // Nothing staged or edited there: the only changes are the demo's own
        // (untracked) files under `tutorial/`.
        for entry in outer_repo.statuses(None).unwrap().iter() {
            assert!(
                entry.path().unwrap().starts_with("tutorial/")
                    && entry.status() == git2::Status::WT_NEW,
                "{:?} changed in the enclosing repo",
                entry.path()
            );
        }
    }

    #[test]
    fn a_demo_that_lost_its_dot_git_never_acts_on_an_enclosing_repo() {
        let (outer, base, snapshot) = enclosing_repo();
        let repo = PathBuf::from(create_demo(&base).unwrap().repo_path);
        std::fs::remove_dir_all(repo.join(".git")).unwrap();
        // `Repository::discover(repo)` would now find `outer` — which sits on
        // `main`, so the history script would happily run on it.
        assert!(Repository::discover(&repo).is_ok());
        assert_refused_and_outer_untouched(outer.path(), &snapshot, &base, &repo);
        // The demo is still removable.
        remove_demo(&base, &repo).unwrap();
        assert!(!repo.exists());
    }

    #[test]
    fn a_demo_whose_git_dir_lives_elsewhere_is_refused_too() {
        let (outer, base, snapshot) = enclosing_repo();
        let repo = PathBuf::from(create_demo(&base).unwrap().repo_path);
        // `.git` becomes a file pointing at the enclosing repo's git dir: the
        // work tree is right, but the refs it would move are not the demo's.
        std::fs::remove_dir_all(repo.join(".git")).unwrap();
        let outer_git = std::fs::canonicalize(outer.path().join(".git")).unwrap();
        std::fs::write(
            repo.join(".git"),
            format!("gitdir: {}\n", outer_git.display()),
        )
        .unwrap();
        assert_refused_and_outer_untouched(outer.path(), &snapshot, &base, &repo);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_dot_git_is_refused() {
        let (outer, base, snapshot) = enclosing_repo();
        let repo = PathBuf::from(create_demo(&base).unwrap().repo_path);
        std::fs::remove_dir_all(repo.join(".git")).unwrap();
        std::os::unix::fs::symlink(outer.path().join(".git"), repo.join(".git")).unwrap();
        assert_refused_and_outer_untouched(outer.path(), &snapshot, &base, &repo);
    }

    #[test]
    fn an_intact_demo_inside_another_repo_still_works() {
        // The guard must not reject a healthy demo just because something
        // encloses it: the demo's own `.git` wins.
        let (outer, base, snapshot) = enclosing_repo();
        let repo = PathBuf::from(create_demo(&base).unwrap().repo_path);
        write_file(&base, &repo, "x.txt", "x").unwrap();
        assert_eq!(seed_files(&base, &repo).unwrap().len(), 3);
        assert_eq!(ref_snapshot(outer.path()), snapshot);
        assert!(!simulate_log(&base, &repo, "log", 2).unwrap().is_empty());
        assert_eq!(ref_snapshot(outer.path()), snapshot);
    }

    // ── L3: NTFS spellings of `.git` ─────────────────────────────────────────

    #[test]
    fn write_file_refuses_every_spelling_of_dot_git() {
        let (_tmp, base, repo) = demo();
        for rel in [
            // Trailing dots / spaces are dropped by Windows.
            ".git.",
            ".git ",
            ".git. .",
            ".GIT ",
            ".git...",
            // 8.3 short name.
            "GIT~1",
            "git~1",
            "Git~12",
            "GIT~1.",
            // Alternate data streams.
            ".git::$INDEX_ALLOCATION",
            ".git:stream",
            ".git.:x",
            // Any component, any depth, with a payload underneath.
            "sub/.git.",
            "sub/.git /hooks/pre-commit",
            "sub/GIT~1/hooks/pre-commit",
            ".git./hooks/pre-commit",
            "a/.git::$INDEX_ALLOCATION/hooks/pre-commit",
            // `:` is refused anywhere in a component (streams, drive letters).
            "notes:1.md",
            "dir:x/file.md",
            // A backslash is a separator on Windows, so it splits here too.
            "sub\\.git\\hooks\\pre-commit",
            "sub\\.git.\\config",
            "sub\\GIT~1\\config",
        ] {
            assert!(
                is_invalid(write_file(&base, &repo, rel, "pwned")),
                "{rel:?} must be refused"
            );
        }
        for stray in [".git.", ".git ", "GIT~1", "sub", "notes:1.md", "dir:x"] {
            assert!(!repo.join(stray).exists(), "{stray:?} was created");
        }
        let cfg = std::fs::read_to_string(repo.join(".git/config")).unwrap();
        assert!(!cfg.contains("pwned"));
    }

    #[test]
    fn write_file_still_accepts_names_that_merely_resemble_dot_git() {
        let (_tmp, base, repo) = demo();
        for rel in [
            ".gitignore",
            ".github/workflows/ci.yml",
            ".gitattributes",
            ".gitx",
            "my.git/readme.md",
            "git.md",
            "git~",
            "git~x",
            "git~1x",
            "digit~1",
            "legit~1/a.txt",
            "git/readme.md",
        ] {
            write_file(&base, &repo, rel, "ok")
                .unwrap_or_else(|e| panic!("{rel:?} must be accepted: {e}"));
            assert_eq!(std::fs::read_to_string(repo.join(rel)).unwrap(), "ok");
        }
    }

    // ── M2: stale demos are cleaned up ───────────────────────────────────────

    #[test]
    fn create_demo_removes_stale_demo_dirs_and_nothing_else() {
        let (tmp, base) = base();
        std::fs::create_dir_all(&base).unwrap();
        // Two abandoned demos, with content (a closed app mid-tutorial).
        for stale in ["demo-1", "demo-1700000000000"] {
            let repo = base.join(stale).join("repo");
            std::fs::create_dir_all(&repo).unwrap();
            std::fs::write(repo.join("README.md"), "stale").unwrap();
            std::fs::create_dir_all(base.join(stale).join("origin.git")).unwrap();
        }
        // Things that are not `demo-<digits>` directories.
        let keep_dir = base.join("keep");
        std::fs::create_dir_all(keep_dir.join("nested")).unwrap();
        std::fs::write(keep_dir.join("nested").join("f.txt"), "keep").unwrap();
        let keep_names = [
            "demo-",
            "demo-12x",
            "demo-x",
            "my-demo-5",
            "Demo-5",
            "demo-5-",
        ];
        for name in keep_names {
            std::fs::create_dir_all(base.join(name)).unwrap();
        }
        std::fs::write(base.join("notes.txt"), "keep").unwrap();
        // A *file* named like a demo is not a demo directory.
        std::fs::write(base.join("demo-777"), "keep").unwrap();
        // A symlink named like a demo: never followed, never removed.
        #[cfg(unix)]
        let outside = {
            let outside = tmp.path().join("outside");
            std::fs::create_dir_all(&outside).unwrap();
            std::fs::write(outside.join("precious.txt"), "precious").unwrap();
            std::os::unix::fs::symlink(&outside, base.join("demo-123")).unwrap();
            outside
        };
        let _ = &tmp;

        let fresh = create_demo(&base).unwrap();

        assert!(!base.join("demo-1").exists());
        assert!(!base.join("demo-1700000000000").exists());
        assert!(Path::new(&fresh.repo_path).join(".git").exists());
        assert!(Path::new(&fresh.remote_path).exists());
        assert!(keep_dir.join("nested").join("f.txt").exists());
        for name in keep_names {
            assert!(base.join(name).is_dir(), "{name} must survive");
        }
        assert_eq!(
            std::fs::read_to_string(base.join("notes.txt")).unwrap(),
            "keep"
        );
        assert_eq!(
            std::fs::read_to_string(base.join("demo-777")).unwrap(),
            "keep"
        );
        #[cfg(unix)]
        {
            assert!(std::fs::symlink_metadata(base.join("demo-123"))
                .unwrap()
                .file_type()
                .is_symlink());
            assert_eq!(
                std::fs::read_to_string(outside.join("precious.txt")).unwrap(),
                "precious"
            );
        }
    }

    #[test]
    fn create_demo_keeps_only_the_newest_demo() {
        let (_tmp, base) = base();
        let first = create_demo(&base).unwrap();
        let second = create_demo(&base).unwrap();
        assert!(!Path::new(&first.repo_path).exists());
        assert!(Path::new(&second.repo_path).join(".git").exists());
        let demos = std::fs::read_dir(&base).unwrap().count();
        assert_eq!(demos, 1);
    }

    // ── The whole tutorial script, replayed on the real engines ──────────────

    /// Steps 7-17 of the guided tutorial, driven through the
    /// same public operations the UI calls, resolving commits by subject at
    /// each step. If this passes, the demo is conflict-free and every scripted
    /// operation succeeds — and step 17a really is rejected.
    #[test]
    fn the_full_tutorial_script_replays_on_the_real_engines() {
        let (_tmp, base, repo) = demo_with_c2();
        let p = || repo.clone();
        seed_history(&base, &repo).unwrap();
        assert_clean(&repo);

        // Step 8: merge feature/login into main (drag the merge handle).
        let main_before = rev(&repo, "main");
        crate::merge(p(), "feature/login".into())
            .unwrap()
            .unwrap_completed();
        assert_eq!(parents(&repo, "main").len(), 2, "a real merge commit");
        assert_eq!(parents(&repo, "main")[0], main_before);
        assert_eq!(parents(&repo, "main")[1], rev(&repo, "feature/login"));
        assert!(tree_has(&repo, "main", "src/login.js"));
        assert_clean(&repo);
        let merge_tip = rev(&repo, "main");

        // Step 10a: rebase feature/theme onto main.
        crate::rebase_branch(p(), "feature/theme".into(), "main".into())
            .unwrap()
            .unwrap_completed();
        assert_eq!(head_branch(&repo), "main", "HEAD is restored to main");
        assert_eq!(
            rev(&repo, "feature/theme~2"),
            merge_tip,
            "now sits on main's tip"
        );
        assert_eq!(subject(&repo, "feature/theme~"), "Add drak theme");
        assert_clean(&repo);

        // Step 10b: cherry-pick E1 "Try faster render" onto main.
        let e1 = by_subject(&repo, "experiment", "Try faster render");
        crate::cherry_pick(p(), vec![e1]).unwrap();
        assert_eq!(subject(&repo, "main"), "Try faster render");
        assert_eq!(parents(&repo, "main"), std::slice::from_ref(&merge_tip));
        assert!(tree_has(&repo, "main", "src/render.js"));
        assert_clean(&repo);

        // Step 11: undo the cherry-pick.
        crate::undo_last(p()).unwrap().expect("something to undo");
        assert_eq!(rev(&repo, "main"), merge_tip);
        assert!(!tree_has(&repo, "HEAD", "src/render.js"));
        assert_clean(&repo);

        // Step 12: reset main to an ancestor on its first-parent line (C4), mixed.
        let c4 = by_subject(&repo, "main", "Add helpers");
        crate::reset(p(), c4.clone(), "mixed".into()).unwrap();
        assert_eq!(rev(&repo, "main"), c4);

        // Step 13a: undo the reset.
        crate::undo_last(p()).unwrap().expect("something to undo");
        assert_eq!(rev(&repo, "main"), merge_tip);
        assert_clean(&repo);

        // Step 13b: check out feature/theme.
        crate::branch::checkout(p(), "feature/theme".into()).unwrap();
        assert_eq!(head_branch(&repo), "feature/theme");
        assert_clean(&repo);

        // Step 14: purge secrets.env from "Add config" (and everything after it).
        let c3 = by_subject(&repo, "HEAD", "Add config");
        assert!(tree_has(&repo, &c3, "secrets.env"));
        crate::purge_path(p(), c3, "secrets.env".into()).unwrap();
        for spec in ["feature/theme", "main", "feature/login"] {
            assert!(
                !history_has(&repo, spec, "secrets.env"),
                "{spec} still has secrets.env"
            );
        }
        assert_eq!(head_branch(&repo), "feature/theme");
        assert_clean(&repo);
        // Engine behaviour worth knowing (not a failure): purge remaps branches
        // but not tags, so `v0.1.0`/`v0.2.0` keep the pre-purge commits alive —
        // secrets.env included — and the graph shows two "Add config" commits.
        // The tutorial's by-subject lookup must therefore prefer the commit
        // reachable from the current branch (see `by_subject`).
        assert!(tree_has(&repo, "v0.1.0", "secrets.env"));
        assert_ne!(
            rev(&repo, "v0.1.0"),
            by_subject(&repo, "HEAD", "Add config")
        );

        // Step 15: write secrets.example.env, then add it into the new "Add config".
        let c3 = by_subject(&repo, "HEAD", "Add config");
        assert!(!tree_has(&repo, &c3, "secrets.example.env"));
        write_file(
            &base,
            &repo,
            "secrets.example.env",
            "API_KEY=\nDB_PASSWORD=\n",
        )
        .unwrap();
        crate::add_file_to_commit(p(), c3, "secrets.example.env".into()).unwrap();
        let c3 = by_subject(&repo, "HEAD", "Add config");
        assert!(tree_has(&repo, &c3, "secrets.example.env"));
        assert!(tree_has(&repo, "feature/theme", "secrets.example.env"));
        assert!(!history_has(&repo, "feature/theme", "secrets.env"));
        assert_clean(&repo);

        // Step 16: reword "Add drak theme" -> "Add dark theme".
        let t1 = by_subject(&repo, "HEAD", "Add drak theme");
        crate::reword(p(), t1, "Add dark theme".into())
            .unwrap()
            .unwrap_completed();
        assert_eq!(subject(&repo, "feature/theme~"), "Add dark theme");
        assert_eq!(subject(&repo, "feature/theme"), "Add theme switch");
        // The typo survives only where it was published: `origin/feature/theme`
        // still points at the old chain until step 17b's force push.
        let r = git(&repo);
        let mut walk = r.revwalk().unwrap();
        walk.push(r.refname_to_id("refs/heads/feature/theme").unwrap())
            .unwrap();
        assert!(walk
            .all(|oid| r.find_commit(oid.unwrap()).unwrap().summary() != Some("Add drak theme")));
        assert_eq!(subject(&repo, "origin/feature/theme~"), "Add drak theme");
        assert_clean(&repo);

        // Step 17a: a plain push is rejected — the branch was rewritten.
        let err = push(p(), "origin".into(), CloneAuth::None, false, None)
            .expect_err("a non-fast-forward push must be rejected");
        eprintln!("step 17a rejection: {err}");
        let origin = git(&repo.parent().unwrap().join("origin.git"));
        assert_ne!(
            origin
                .refname_to_id("refs/heads/feature/theme")
                .unwrap()
                .to_string(),
            rev(&repo, "feature/theme"),
            "the remote was not touched"
        );

        // Step 17b: force push succeeds.
        push(p(), "origin".into(), CloneAuth::None, true, None).unwrap();
        assert_eq!(
            origin
                .refname_to_id("refs/heads/feature/theme")
                .unwrap()
                .to_string(),
            rev(&repo, "feature/theme")
        );
        let ab = crate::ahead_behind(p()).unwrap();
        assert_eq!(
            (ab.ahead, ab.behind),
            (0, 0),
            "in sync after the force push"
        );

        // Steps 19-21: simulated Log Anytime on the (rewritten) feature/theme.
        let shas = simulate_log(&base, &repo, "adgitter-log", 3).unwrap();
        assert_eq!(shas.len(), 3);
        assert_eq!(head_branch(&repo), "feature/theme");
        assert_clean(&repo);
    }
}
