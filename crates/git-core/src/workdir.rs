//! Working-tree operations: status, staging, and committing.
//!
//! These are the first *mutating* commands (the read-only invariant from the
//! Phase-0 viewer applies only to history browsing). Writes acquire the global
//! [`lock_mutations`](crate::mutate::lock_mutations) guard so concurrent
//! gestures can't corrupt index state. `commit(amend=true)` rewrites
//! the HEAD commit, so it snapshots a backup ref first.

use std::path::{Path, PathBuf};

use git2::{ObjectType, Status, StatusOptions};
use serde::Serialize;

use crate::error::{AdgitterError, AdgitterResult};
use crate::git::open_repo;
use crate::mutate::{create_backup, lock_mutations};

/// One changed path in the working tree / index.
#[derive(Debug, Clone, Serialize)]
pub struct StatusEntry {
    pub path: String,
    /// `new` | `modified` | `deleted` | `renamed` | `typechange`.
    pub status: &'static str,
    /// Previous path for renames; `null` otherwise.
    pub old_path: Option<String>,
}

/// Working-tree status grouped like the design's Changed-Files panel.
#[derive(Debug, Default, Serialize)]
pub struct RepoStatus {
    pub staged: Vec<StatusEntry>,
    pub changed: Vec<StatusEntry>,
    pub untracked: Vec<StatusEntry>,
    pub ignored: Vec<StatusEntry>,
    /// Paths with unresolved merge/cherry-pick conflicts (a paused op — see
    /// `resolve.rs`). A conflicted path is reported ONLY here, never also in
    /// `staged`/`changed`, even though libgit2 may set index/workdir delta
    /// bits alongside `CONFLICTED`.
    pub conflicted: Vec<StatusEntry>,
}

fn path_str(p: &Path) -> String {
    p.display().to_string()
}

fn staged_kind(s: Status) -> &'static str {
    if s.contains(Status::INDEX_NEW) {
        "new"
    } else if s.contains(Status::INDEX_DELETED) {
        "deleted"
    } else if s.contains(Status::INDEX_RENAMED) {
        "renamed"
    } else if s.contains(Status::INDEX_TYPECHANGE) {
        "typechange"
    } else {
        "modified"
    }
}

fn wt_kind(s: Status) -> &'static str {
    if s.contains(Status::WT_DELETED) {
        "deleted"
    } else if s.contains(Status::WT_RENAMED) {
        "renamed"
    } else if s.contains(Status::WT_TYPECHANGE) {
        "typechange"
    } else {
        "modified"
    }
}

fn make_entry(e: &git2::StatusEntry, kind: &'static str, staged: bool) -> StatusEntry {
    let delta = if staged {
        e.head_to_index()
    } else {
        e.index_to_workdir()
    };
    let new_path = delta
        .as_ref()
        .and_then(|d| d.new_file().path().map(path_str));
    let old_path = delta
        .as_ref()
        .and_then(|d| d.old_file().path().map(path_str));
    let path = new_path
        .clone()
        .or_else(|| old_path.clone())
        .or_else(|| e.path().map(str::to_string))
        .unwrap_or_default();
    let old_path = match (&old_path, &new_path) {
        (Some(o), Some(n)) if o != n => Some(o.clone()),
        _ => None,
    };
    StatusEntry {
        path,
        status: kind,
        old_path,
    }
}

/// Group the working tree into Staged / Changed / Untracked / Ignored.
pub fn status(repo_path: PathBuf) -> AdgitterResult<RepoStatus> {
    let repo = open_repo(&repo_path)?;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .include_ignored(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);

    let statuses = repo.statuses(Some(&mut opts))?;
    let mut out = RepoStatus::default();
    for e in statuses.iter() {
        let s = e.status();
        if s.contains(Status::IGNORED) {
            out.ignored.push(make_entry(&e, "ignored", false));
            continue;
        }
        if s.contains(Status::CONFLICTED) {
            out.conflicted.push(make_entry(&e, "conflicted", false));
            continue;
        }
        if s.intersects(
            Status::INDEX_NEW
                | Status::INDEX_MODIFIED
                | Status::INDEX_DELETED
                | Status::INDEX_RENAMED
                | Status::INDEX_TYPECHANGE,
        ) {
            out.staged.push(make_entry(&e, staged_kind(s), true));
        }
        if s.contains(Status::WT_NEW) {
            out.untracked.push(make_entry(&e, "new", false));
        } else if s.intersects(
            Status::WT_MODIFIED | Status::WT_DELETED | Status::WT_RENAMED | Status::WT_TYPECHANGE,
        ) {
            out.changed.push(make_entry(&e, wt_kind(s), false));
        }
    }
    Ok(out)
}

/// Stage `paths` (add modifications/new files; record deletions).
pub fn stage(repo_path: PathBuf, paths: Vec<String>) -> AdgitterResult<()> {
    let _lock = lock_mutations();
    let repo = open_repo(&repo_path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| AdgitterError::Internal("cannot stage in a bare repository".into()))?
        .to_path_buf();
    let mut index = repo.index()?;
    for p in &paths {
        if workdir.join(p).exists() {
            index.add_path(Path::new(p))?;
        } else {
            index.remove_path(Path::new(p))?;
        }
    }
    index.write()?;
    Ok(())
}

/// Unstage `paths` — reset their index entries back to HEAD.
pub fn unstage(repo_path: PathBuf, paths: Vec<String>) -> AdgitterResult<()> {
    let _lock = lock_mutations();
    let repo = open_repo(&repo_path)?;
    match repo.head() {
        Ok(head) => {
            let target = head.peel(ObjectType::Commit)?;
            repo.reset_default(Some(&target), paths.iter().map(String::as_str))?;
        }
        Err(_) => {
            // Unborn HEAD: there is nothing to reset to, just drop from the index.
            let mut index = repo.index()?;
            for p in &paths {
                let _ = index.remove_path(Path::new(p));
            }
            index.write()?;
        }
    }
    Ok(())
}

/// Discard unstaged working-tree changes for tracked `paths` (restore from the
/// index). Untracked files are left untouched.
pub fn discard(repo_path: PathBuf, paths: Vec<String>) -> AdgitterResult<()> {
    let _lock = lock_mutations();
    let repo = open_repo(&repo_path)?;
    let mut cb = git2::build::CheckoutBuilder::new();
    cb.force();
    for p in &paths {
        cb.path(p.as_str());
    }
    repo.checkout_index(None, Some(&mut cb))?;
    Ok(())
}

/// Commit the staged index with `message`. When `amend` is true, replace the
/// HEAD commit (a rewrite — a backup ref is written first). Returns the new sha.
///
/// # What exactly gets committed, and what gets snapshotted
///
/// This commits the **whole index**: the tree comes from `index.write_tree()`,
/// with no path filtering anywhere. There is no partial-commit mode — the
/// frontend stages the paths it wants and then commits everything staged — so
/// "the staged files" and "the committed tree" are the same tree here, and the
/// undo snapshot can be that tree without further qualification. If a partial
/// commit is ever added, the snapshot must become the *index* tree rather than
/// the committed tree, and the two would no longer coincide.
///
/// A plain commit records an undo snapshot first (`undo::record_commit_snapshot`)
/// because a commit leaves no reflog entry to rewind and must not be undone by
/// force-restoring a ref — see `undo.rs`. `amend` keeps the pre-existing
/// backup-ref mechanism instead: its restore point is the commit it replaces,
/// not a parent, so it would need a differently-shaped snapshot than a plain
/// commit does, and converting it is deliberately out of scope here.
pub fn commit(repo_path: PathBuf, message: String, amend: bool) -> AdgitterResult<String> {
    let _lock = lock_mutations();
    let repo = open_repo(&repo_path)?;
    if message.trim().is_empty() {
        return Err(AdgitterError::Internal(
            "commit message must not be empty".into(),
        ));
    }
    // Git's configured identity (repo-local, then global) always wins; the
    // ADGitter account address stands in only when git has none.
    let sig = crate::identity::signature_for(&repo)?;

    let mut index = repo.index()?;
    let tree = repo.find_tree(index.write_tree()?)?;
    let head_commit = repo.head().ok().and_then(|h| h.peel_to_commit().ok());

    let oid = if amend {
        let hc = head_commit
            .as_ref()
            .ok_or_else(|| AdgitterError::Internal("nothing to amend".into()))?;
        // Rewriting the HEAD commit — snapshot the branch first so it is reversible.
        let backup = repo
            .head()
            .ok()
            .and_then(|h| h.name().map(str::to_string))
            .map(|name| create_backup(&repo, "amend", &name))
            .transpose()?;
        let amended = hc.amend(
            Some("HEAD"),
            Some(&sig),
            Some(&sig),
            None,
            Some(&message),
            Some(&tree),
        )?;
        if let Some(b) = &backup {
            crate::undo::seal(&repo, b)?;
        }
        amended
    } else {
        // The ref this commit is about to move, which is what an undo puts
        // back. A symbolic HEAD names the branch, readable even when it is
        // unborn — `repo.head()` fails outright on an unborn HEAD, so the
        // symbolic target is the only way to learn the branch name for a
        // first commit. No symbolic target means a detached HEAD: there is no
        // branch, and HEAD itself is the direct reference that moves, so
        // `HEAD` is the ref the record names. A detached-HEAD commit is a
        // commit like any other and gets a snapshot like any other —
        // recording nothing here used to leave Undo reversing whatever older
        // record it found instead.
        let moved_ref = repo
            .find_reference("HEAD")
            .ok()
            .and_then(|h| h.symbolic_target().map(str::to_string))
            .unwrap_or_else(|| crate::undo::HEAD_REF.to_string());
        let pending =
            crate::undo::record_commit_snapshot(&repo, &moved_ref, &tree, head_commit.as_ref())?;

        let parents: Vec<git2::Commit> = head_commit.into_iter().collect();
        let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
        let made = repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &parent_refs)?;

        crate::undo::seal_commit(&repo, &pending, made)?;
        made
    };
    Ok(oid.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::Repository;

    fn init_repo(dir: &Path) -> Repository {
        let repo = Repository::init(dir).unwrap();
        {
            let mut cfg = repo.config().unwrap();
            cfg.set_str("user.name", "Tester").unwrap();
            cfg.set_str("user.email", "t@example.com").unwrap();
        }
        repo
    }

    fn write(dir: &Path, name: &str, content: &str) {
        std::fs::write(dir.join(name), content).unwrap();
    }

    #[test]
    fn status_groups_staged_changed_untracked_ignored() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path().to_path_buf();
        let _repo = init_repo(&p);

        // Base commit with a tracked file and a committed .gitignore.
        write(&p, "tracked.txt", "v1");
        write(&p, ".gitignore", "ignored.txt\n");
        stage(p.clone(), vec!["tracked.txt".into(), ".gitignore".into()]).unwrap();
        commit(p.clone(), "base".into(), false).unwrap();

        write(&p, "tracked.txt", "v2"); // modified (unstaged) → changed
        write(&p, "untracked.txt", "x"); // → untracked
        write(&p, "staged.txt", "y");
        stage(p.clone(), vec!["staged.txt".into()]).unwrap(); // → staged
        write(&p, "ignored.txt", "z"); // → ignored

        let st = status(p).unwrap();
        assert!(st.staged.iter().any(|e| e.path == "staged.txt"));
        assert!(st.changed.iter().any(|e| e.path == "tracked.txt"));
        assert!(st.untracked.iter().any(|e| e.path == "untracked.txt"));
        assert!(st.ignored.iter().any(|e| e.path == "ignored.txt"));
    }

    #[test]
    fn stage_then_commit_roundtrip_leaves_clean_tree() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path().to_path_buf();
        let _repo = init_repo(&p);

        write(&p, "a.txt", "hello");
        stage(p.clone(), vec!["a.txt".into()]).unwrap();
        let sha = commit(p.clone(), "add a".into(), false).unwrap();
        assert_eq!(sha.len(), 40);

        let st = status(p).unwrap();
        assert!(st.staged.is_empty() && st.changed.is_empty() && st.untracked.is_empty());
    }

    #[test]
    fn unstage_moves_entry_out_of_staged() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path().to_path_buf();
        let _repo = init_repo(&p);
        write(&p, "a.txt", "base");
        stage(p.clone(), vec!["a.txt".into()]).unwrap();
        commit(p.clone(), "base".into(), false).unwrap();

        write(&p, "b.txt", "new");
        stage(p.clone(), vec!["b.txt".into()]).unwrap();
        assert!(status(p.clone())
            .unwrap()
            .staged
            .iter()
            .any(|e| e.path == "b.txt"));

        unstage(p.clone(), vec!["b.txt".into()]).unwrap();
        let st = status(p).unwrap();
        assert!(!st.staged.iter().any(|e| e.path == "b.txt"));
        assert!(st.untracked.iter().any(|e| e.path == "b.txt"));
    }

    #[test]
    fn commit_rejects_empty_message() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path().to_path_buf();
        let _repo = init_repo(&p);
        write(&p, "a.txt", "x");
        stage(p.clone(), vec!["a.txt".into()]).unwrap();
        assert!(matches!(
            commit(p, "   ".into(), false),
            Err(AdgitterError::Internal(_))
        ));
    }

    #[test]
    fn amend_rewrites_head_and_writes_backup() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path().to_path_buf();
        let repo = init_repo(&p);
        write(&p, "a.txt", "1");
        stage(p.clone(), vec!["a.txt".into()]).unwrap();
        let first = commit(p.clone(), "first".into(), false).unwrap();

        write(&p, "a.txt", "2");
        stage(p.clone(), vec!["a.txt".into()]).unwrap();
        let amended = commit(p.clone(), "first (amended)".into(), true).unwrap();

        assert_ne!(first, amended, "amend produced a new commit");
        let backups = crate::mutate::list_backups(&repo).unwrap();
        assert_eq!(backups.len(), 1);
        assert_eq!(backups[0].op, "amend");
        assert_eq!(
            backups[0].target, first,
            "backup points at the pre-amend tip"
        );
    }
}
