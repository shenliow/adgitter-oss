//! "Log Anytime" foreground snapshot: write the current working tree onto a
//! dedicated log branch without touching HEAD, the user's index, or the
//! working tree (free-tier foreground core).
//!
//! The UI timer calls [`log_commit`] at each interval. No background scheduler
//! and no squash are involved — those are pro-tier and out of scope here.
//!
//! # Non-disruption guarantee
//!
//! * **HEAD** – never moved; we commit directly to `refs/heads/<branch>` via
//!   [`git2::Repository::commit`], which accepts an explicit refname.
//! * **On-disk index** (`.git/index`) – we open a mutable in-memory view with
//!   [`Repository::index`], call [`Index::add_all`] to capture the working
//!   tree, then [`Index::write_tree_to`] to materialise the tree objects.
//!   Because we never call [`Index::write`], the file on disk is byte-for-byte
//!   unchanged, and [`git_index_free`] (called by `Drop`) does not flush.
//! * **Working tree** – read only; no checkout, no reset.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use git2::IndexAddOption;

use crate::error::AdgitterResult;
use crate::git::open_repo;
use crate::mutate::lock_mutations;

/// Snapshot the current working tree onto `refs/heads/<branch>` without
/// disturbing HEAD, the user's staging area, or the working tree.
///
/// # Returns
/// * `Ok(Some(sha))` — a new commit was created and `sha` is its full hex OID.
/// * `Ok(None)` — the working tree is identical to the previous snapshot
///   (no-change skip; nothing was written to the log branch).
///
/// # Errors
/// Propagates any `git2` or I/O error as [`crate::error::AdgitterError`].
pub fn log_commit(repo_path: PathBuf, branch: String) -> AdgitterResult<Option<String>> {
    let _lock = lock_mutations();
    let repo = open_repo(&repo_path)?;

    // ── Build a snapshot tree from the working tree ──────────────────────────
    //
    // `repo.index()` opens the repo's index with the repository attached, so
    // `add_all` can locate the workdir and apply .gitignore rules.
    // We intentionally never call `index.write()`, so the on-disk .git/index
    // file is not touched.
    let mut index = repo.index()?;
    index.add_all(["*"], IndexAddOption::DEFAULT, None)?;
    let tree_oid = index.write_tree_to(&repo)?;

    // ── Resolve the existing log branch (if any) ─────────────────────────────
    let log_ref = format!("refs/heads/{branch}");
    let parent_commit = repo
        .find_reference(&log_ref)
        .ok()
        .and_then(|r| r.peel_to_commit().ok());

    // ── No-change check ──────────────────────────────────────────────────────
    if let Some(ref pc) = parent_commit {
        if pc.tree_id() == tree_oid {
            return Ok(None);
        }
    }

    // ── Author / committer signature ─────────────────────────────────────────
    // Same precedence as an ordinary commit — git's identity, then the account
    // address — with the anonymous placeholder as a last resort so a
    // background snapshot never fails over a missing `user.email`.
    let sig = crate::identity::signature_or_none(&repo).unwrap_or_else(|| {
        git2::Signature::now("ADGitter Log", "log@adgitter")
            .expect("placeholder signature must be valid")
    });

    // ── Commit message ───────────────────────────────────────────────────────
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let message = format!("log: snapshot {millis}");

    // ── Build parent list ────────────────────────────────────────────────────
    let parents: Vec<git2::Commit<'_>> = parent_commit.into_iter().collect();
    let parent_refs: Vec<&git2::Commit<'_>> = parents.iter().collect();

    // ── Create the tree object and commit directly to the log ref ────────────
    //
    // Passing `Some(&log_ref)` (not `Some("HEAD")`) means only `refs/heads/<branch>`
    // is updated; the user's HEAD and current branch are untouched.
    let tree = repo.find_tree(tree_oid)?;
    let commit_oid = repo.commit(Some(&log_ref), &sig, &sig, &message, &tree, &parent_refs)?;

    Ok(Some(commit_oid.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::Repository;
    use std::path::Path;

    fn init_repo(dir: &Path) -> Repository {
        let repo = Repository::init(dir).unwrap();
        {
            let mut cfg = repo.config().unwrap();
            cfg.set_str("user.name", "Tester").unwrap();
            cfg.set_str("user.email", "t@example.com").unwrap();
        }
        repo
    }

    fn write_file(dir: &Path, name: &str, content: &str) {
        std::fs::write(dir.join(name), content).unwrap();
    }

    /// Create an initial commit via the public workdir helpers (same helpers
    /// other test suites use), so the repo has a HEAD.
    fn initial_commit(p: &Path) {
        write_file(p, "base.txt", "base");
        crate::workdir::stage(p.to_path_buf(), vec!["base.txt".into()]).unwrap();
        crate::workdir::commit(p.to_path_buf(), "initial".into(), false).unwrap();
    }

    // ── Test 1: basic snapshot ────────────────────────────────────────────────

    #[test]
    fn snapshot_creates_log_branch_commit_and_leaves_head_unchanged() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path().to_path_buf();
        let repo = init_repo(dir.path());
        initial_commit(dir.path());

        // Capture the HEAD branch before the snapshot.
        let head_branch_before = repo.head().unwrap().shorthand().unwrap().to_string();

        // Write an untracked working-tree file (not staged).
        write_file(dir.path(), "snap.txt", "snapshot content");

        // Stage a different file so we can verify staging is preserved.
        write_file(dir.path(), "staged.txt", "staged");
        crate::workdir::stage(p.clone(), vec!["staged.txt".into()]).unwrap();

        // Verify staged.txt is staged before the snapshot.
        let status_before = crate::workdir::status(p.clone()).unwrap();
        assert!(
            status_before.staged.iter().any(|e| e.path == "staged.txt"),
            "staged.txt should be staged before log_commit"
        );

        // ── Call the function under test ──────────────────────────────────────
        let sha = log_commit(p.clone(), "adgitter-log".into())
            .unwrap()
            .expect("first snapshot must return Some(sha)");

        // SHA is a 40-char hex string.
        assert_eq!(sha.len(), 40, "SHA should be 40 hex chars");

        // ── refs/heads/adgitter-log must exist and contain snap.txt ───────────
        let log_ref = repo.find_reference("refs/heads/adgitter-log").unwrap();
        let log_commit_obj = log_ref.peel_to_commit().unwrap();
        assert_eq!(log_commit_obj.id().to_string(), sha);

        let log_tree = log_commit_obj.tree().unwrap();
        assert!(
            log_tree.get_name("snap.txt").is_some(),
            "log branch tree must contain snap.txt"
        );

        // ── HEAD must still be on the user's branch ───────────────────────────
        let head_branch_after = repo.head().unwrap().shorthand().unwrap().to_string();
        assert_eq!(
            head_branch_before, head_branch_after,
            "log_commit must not move HEAD"
        );

        // ── On-disk index must be unchanged (staged.txt still staged) ─────────
        let status_after = crate::workdir::status(p.clone()).unwrap();
        assert!(
            status_after.staged.iter().any(|e| e.path == "staged.txt"),
            "staged.txt must still be staged after log_commit — on-disk index unchanged"
        );
    }

    // ── Test 2: chained commits (parent chain) ────────────────────────────────

    #[test]
    fn second_snapshot_chains_onto_first() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path().to_path_buf();
        let repo = init_repo(dir.path());
        initial_commit(dir.path());

        // First snapshot.
        write_file(dir.path(), "a.txt", "v1");
        let sha1 = log_commit(p.clone(), "adgitter-log".into())
            .unwrap()
            .expect("first snapshot");

        // Second snapshot with a change.
        write_file(dir.path(), "a.txt", "v2");
        let sha2 = log_commit(p.clone(), "adgitter-log".into())
            .unwrap()
            .expect("second snapshot");

        assert_ne!(sha1, sha2, "second snapshot must produce a new commit");

        // Verify the parent chain has length 2.
        let tip = repo
            .find_reference("refs/heads/adgitter-log")
            .unwrap()
            .peel_to_commit()
            .unwrap();
        assert_eq!(tip.id().to_string(), sha2);
        assert_eq!(tip.parent_count(), 1);
        assert_eq!(tip.parent(0).unwrap().id().to_string(), sha1);
    }

    // ── Test 3: no-change returns None ────────────────────────────────────────

    #[test]
    fn no_change_since_last_snapshot_returns_none() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path().to_path_buf();
        let _repo = init_repo(dir.path());
        initial_commit(dir.path());

        // First snapshot: adds a file.
        write_file(dir.path(), "stable.txt", "same content");
        let sha1 = log_commit(p.clone(), "adgitter-log".into())
            .unwrap()
            .expect("first snapshot");

        // Second call with no changes: must return None.
        let result = log_commit(p.clone(), "adgitter-log".into()).unwrap();
        assert!(
            result.is_none(),
            "calling log_commit without any working-tree change must return None"
        );

        // The log branch tip must still be sha1.
        let _repo2 = Repository::open(p).unwrap();
        let tip = _repo2
            .find_reference("refs/heads/adgitter-log")
            .unwrap()
            .peel_to_commit()
            .unwrap();
        assert_eq!(tip.id().to_string(), sha1, "no new commit must be created");
    }
}
