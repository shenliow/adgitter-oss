//! Purge a file path from history, starting at a given commit: "a secret got committed, erase it from this point on".
//!
//! [`purge_path`] removes a path from the tree of `sha` **and** from every
//! descendant commit up to the current branch tip, then rewrites the branch
//! onto the result. Removing it from only one commit would not be enough — a
//! descendant that still touches the path would resurrect it (or conflict
//! with the rewritten ancestor), so every commit from `sha` to the tip is
//! rewritten.
//!
//! Unlike `rebase.rs`'s `replay` (which cherry-picks each commit's *diff*
//! onto a new parent via a 3-way merge, and can therefore hit real
//! conflicts), this is pure tree surgery: each commit's own tree has the path
//! removed from it directly (via a scratch in-memory `Index`, never the
//! repo's on-disk one) and the commit is re-created with its parents mapped
//! to their rewritten counterparts. There is no diff application, so a purge
//! can never conflict — including on the very commits that modify the path
//! being purged, which is the whole point of the operation. The graph's shape
//! (merges included) survives untouched; see [`rewrite`] for why anything
//! else would corrupt the intermediate history.
//!
//! Like every rewriting op (history.rs, rebase.rs), it holds the mutation
//! lock and snapshots the branch with a backup ref first (mutate.rs), so it
//! is reversible via `undo_last`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use git2::{build::CheckoutBuilder, Commit, ErrorCode, Index, ObjectType, Oid, Repository, Sort};

use crate::error::{AdgitterError, AdgitterResult};
use crate::git::open_repo;
use crate::history::{current_branch, resolve_commit, signature};
use crate::mutate::{create_backup, lock_mutations};

/// Oids from `sha` (inclusive) through `tip` (inclusive), oldest-first.
/// Errors when `sha` is neither `tip` itself nor an ancestor of it.
///
/// Shared with `inject.rs` (`add_file_to_commit`), which needs the exact same
/// "sha through tip" range for its inverse operation.
pub(crate) fn range_inclusive(repo: &Repository, sha: Oid, tip: Oid) -> AdgitterResult<Vec<Oid>> {
    if sha != tip && !repo.graph_descendant_of(tip, sha).unwrap_or(false) {
        return Err(AdgitterError::Internal(format!(
            "{sha} is not an ancestor of the current branch tip"
        )));
    }

    let mut walk = repo.revwalk()?;
    walk.push(tip)?;
    // Hide `sha`'s own parent(s) so the walk stops exactly at `sha`,
    // including it. A root commit has no parent to hide — the walk then
    // naturally runs to the very start of history, which is correct since
    // `sha` being the root means the whole branch is in range.
    let target = repo.find_commit(sha)?;
    for parent in target.parent_ids() {
        walk.hide(parent)?;
    }
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::REVERSE)?;

    let mut out = Vec::new();
    for oid in walk {
        out.push(oid?);
    }
    Ok(out)
}

/// The oid of `tree` with `path` removed, or `tree`'s own oid unchanged when
/// `path` is absent from it. `commit` names which commit's tree this is,
/// purely so a directory-path rejection can point at a specific commit.
///
/// Directory paths are rejected with a clear error rather than supported
/// recursively — purge only removes a single file's blob from history; the
/// UI can call it once per file for a directory's contents if that's ever
/// needed.
fn tree_without_path(
    repo: &Repository,
    tree: &git2::Tree,
    path: &str,
    commit: Oid,
) -> AdgitterResult<Oid> {
    match tree.get_path(Path::new(path)) {
        Ok(entry) if entry.kind() == Some(ObjectType::Tree) => {
            return Err(AdgitterError::Internal(format!(
                "{path} is a directory in commit {commit} — purge only supports \
                 a single file path, not a directory"
            )));
        }
        Ok(_) => {}
        Err(e) if e.code() == ErrorCode::NotFound => return Ok(tree.id()), // no-op for this tree
        Err(e) => return Err(e.into()),
    }

    // Build the new tree via a scratch in-memory index (never the repo's
    // on-disk index), exactly like `rebase.rs`'s cherry-pick core does for
    // its own tree writes — no working-tree churn until the branch moves.
    let mut index = Index::new()?;
    index.read_tree(tree)?;
    index.remove_path(Path::new(path))?;
    Ok(index.write_tree_to(repo)?)
}

/// Rewrite every commit in `range` (oldest-first) with `path` stripped from
/// its tree, returning the new tip oid. Message, author identity, and author
/// date are copied from the original commit; only the tree (and any parent
/// that was itself rewritten) changes. The committer is stamped fresh,
/// matching every other rewrite op in this crate (history::reword,
/// rebase::replay).
///
/// **The commit graph's shape is preserved exactly** — including merges. Each
/// commit's parents are its ORIGINAL parents mapped through `rewritten`
/// (parents outside the range, i.e. `sha`'s own, map to themselves). Because
/// `range` is topologically ordered oldest-first, every in-range parent has
/// already been rewritten by the time its child is reached.
///
/// Re-parenting the range into a straight line instead would corrupt the
/// history whenever a merge is in range: this is pure tree surgery, so each
/// commit keeps its OWN tree, and a side-branch commit dangled after a
/// mainline one would appear to revert it (its tree predates those changes).
/// The tip would still come out right, every commit in between would lie.
///
/// If stripping `path` leaves a commit's tree identical to its (rewritten)
/// parent's — i.e. the original commit only ever touched `path` — the commit
/// is KEPT as an empty commit rather than silently dropped: dropping commits
/// is a different, more surprising operation (see `rebase::drop_commit`).
fn rewrite(
    repo: &Repository,
    range: &[Oid],
    path: &str,
    tip: Oid,
) -> AdgitterResult<(Oid, HashMap<Oid, Oid>)> {
    let committer = signature(repo)?;
    let mut rewritten: HashMap<Oid, Oid> = HashMap::new();

    for oid in range {
        let commit = repo.find_commit(*oid)?;
        let new_tree_id = tree_without_path(repo, &commit.tree()?, path, *oid)?;
        let new_tree = repo.find_tree(new_tree_id)?;

        let parent_commits: Vec<Commit> = commit
            .parent_ids()
            .map(|p| repo.find_commit(*rewritten.get(&p).unwrap_or(&p)))
            .collect::<Result<_, _>>()?;
        let parent_refs: Vec<&Commit> = parent_commits.iter().collect();

        let new_oid = repo.commit(
            None,
            &commit.author(),
            &committer,
            commit.message().unwrap_or(""),
            &new_tree,
            &parent_refs,
        )?;
        rewritten.insert(*oid, new_oid);
    }

    let new_tip = *rewritten
        .get(&tip)
        .expect("range_inclusive always ends at the tip");
    Ok((new_tip, rewritten))
}

/// Remove `path` from `sha`'s tree and from every commit from `sha` through
/// the current branch tip, then rewrite the branch onto the result.
///
/// Preconditions (matching the other rewriting ops in this crate): the
/// current branch is not detached (`current_branch`), `sha` resolves to a
/// real commit, `sha` is an ancestor of (or equal to) the branch tip, and
/// `path` appears in at least one commit in that range (otherwise this is
/// almost certainly a typo, not intent, so it errors rather than silently
/// no-op'ing).
pub fn purge_path(
    repo_path: PathBuf,
    sha: String,
    path: String,
) -> AdgitterResult<crate::remap::RemapOutcome> {
    let _lock = lock_mutations();
    let repo = open_repo(&repo_path)?;
    crate::resolve::ensure_not_paused(&repo)?;
    let branch = current_branch(&repo)?;
    let tip = repo.head()?.peel_to_commit()?;
    let target = resolve_commit(&repo, &sha)?;

    let range = range_inclusive(&repo, target.id(), tip.id())?;

    let mut touched = false;
    for oid in &range {
        if repo
            .find_commit(*oid)?
            .tree()?
            .get_path(Path::new(&path))
            .is_ok()
        {
            touched = true;
            break;
        }
    }
    if !touched {
        return Err(AdgitterError::Internal(format!(
            "{path} does not appear in any commit from {} to the branch tip",
            target.id()
        )));
    }

    // Park any uncommitted work: the forced `checkout_head` below would
    // overwrite unstaged edits to tracked files (PRD User Story 19).
    // Tracked-only — a forced checkout never removes untracked files, so
    // there is nothing to protect there (see `autostash.rs`).
    let stashed = crate::autostash::stash_if_dirty(&repo, "adgitter: purge autostash", false)?;

    let backup = create_backup(&repo, "purge-path", &branch)?;

    let (new_tip, rewritten) = match rewrite(&repo, &range, &path, tip.id()) {
        Ok(res) => res,
        Err(e) => {
            // Rewrite only wrote loose objects; refs/worktree are unchanged.
            // Drop the orphaned backup so it does not pollute the undo
            // stack (mirrors rebase::execute's failure handling).
            if let Ok(mut r) = repo.find_reference(&backup.backup_ref) {
                let _ = r.delete();
            }
            // A failed op must not cost the user their uncommitted work either.
            if stashed {
                let _ = crate::autostash::pop(&repo);
            }
            return Err(e);
        }
    };

    let mut reference = repo.find_reference(&branch)?;
    reference.set_target(new_tip, "purge-path")?;
    repo.set_head(&branch)?;
    let mut co = CheckoutBuilder::new();
    co.force();
    repo.checkout_head(Some(&mut co))?;
    // Best-effort: carry every other local branch that descends from the
    // purged range over to the rewritten chain (their backups join this op's
    // batch, so a single undo restores all of it).
    let outcome =
        crate::remap::remap_descendants(&repo, &rewritten, &branch, "purge-path", &backup);
    crate::undo::seal(&repo, &backup)?;
    if stashed {
        crate::autostash::pop(&repo).map_err(|e| crate::autostash::pop_failed("purge", e))?;
    }
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mutate::{list_backups, undo_last};
    use crate::workdir;
    use git2::Repository;
    use std::path::Path as StdPath;

    fn init_repo(dir: &StdPath) -> Repository {
        let repo = Repository::init(dir).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Tester").unwrap();
        cfg.set_str("user.email", "t@example.com").unwrap();
        repo
    }

    fn commit(dir: &StdPath, name: &str, content: &str) -> String {
        std::fs::write(dir.join(name), content).unwrap();
        workdir::stage(dir.to_path_buf(), vec![name.to_string()]).unwrap();
        workdir::commit(dir.to_path_buf(), format!("add {name}"), false).unwrap()
    }

    fn edit(dir: &StdPath, name: &str, content: &str, message: &str) -> String {
        std::fs::write(dir.join(name), content).unwrap();
        workdir::stage(dir.to_path_buf(), vec![name.to_string()]).unwrap();
        workdir::commit(dir.to_path_buf(), message.to_string(), false).unwrap()
    }

    /// Commits reachable from HEAD, oldest-first: (sha, subject, tree_id).
    fn log_all(repo: &Repository) -> Vec<(String, String, Oid)> {
        let mut walk = repo.revwalk().unwrap();
        walk.push_head().unwrap();
        walk.set_sorting(Sort::TOPOLOGICAL | Sort::REVERSE).unwrap();
        walk.map(|o| {
            let oid = o.unwrap();
            let c = repo.find_commit(oid).unwrap();
            (
                oid.to_string(),
                c.summary().unwrap().to_string(),
                c.tree().unwrap().id(),
            )
        })
        .collect()
    }

    #[test]
    fn purge_path_removes_the_file_from_sha_through_tip() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);

        let _before = commit(p, "keep.txt", "safe");
        let secret_added = commit(p, "secret.txt", "sk-12345");
        commit(p, "other.txt", "unrelated");
        edit(p, "secret.txt", "sk-67890-still-secret", "rotate secret");

        purge_path(p.into(), secret_added.clone(), "secret.txt".into()).unwrap();

        assert!(!p.join("secret.txt").exists(), "secret.txt gone from tip");
        assert!(p.join("keep.txt").exists());
        assert!(p.join("other.txt").exists());

        let log = log_all(&repo);
        assert_eq!(log.len(), 4, "no commits dropped, none added");
        // Every commit from secret_added onward (indices 1..=3) must lack the
        // path in its own tree — the blob is unreachable from any of them.
        for (sha, _subject, _tree) in &log[1..] {
            let oid = Oid::from_str(sha).unwrap();
            let tree = repo.find_commit(oid).unwrap().tree().unwrap();
            assert!(
                tree.get_path(Path::new("secret.txt")).is_err(),
                "secret.txt must be absent from {sha}"
            );
        }
    }

    #[test]
    fn purge_path_leaves_commits_before_sha_untouched() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);

        let c1 = commit(p, "a.txt", "1");
        let c2 = commit(p, "b.txt", "2");
        let secret_added = commit(p, "secret.txt", "sk");
        commit(p, "c.txt", "3");

        purge_path(p.into(), secret_added, "secret.txt".into()).unwrap();

        let log = log_all(&repo);
        assert_eq!(log[0].0, c1, "root commit sha unchanged");
        assert_eq!(log[1].0, c2, "second commit sha unchanged");
        assert_eq!(log[0].1, "add a.txt");
        assert_eq!(log[1].1, "add b.txt");
    }

    #[test]
    fn purge_path_preserves_unrelated_file_content_and_messages_and_authors() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);

        let secret_added = commit(p, "secret.txt", "sk-1");
        edit(p, "unrelated.txt", "keep-me", "add unrelated");

        purge_path(p.into(), secret_added, "secret.txt".into()).unwrap();

        assert_eq!(
            std::fs::read_to_string(p.join("unrelated.txt")).unwrap(),
            "keep-me",
            "unrelated file content survives the rewrite"
        );

        let log = log_all(&repo);
        let subjects: Vec<&str> = log.iter().map(|(_, s, _)| s.as_str()).collect();
        assert_eq!(subjects, vec!["add secret.txt", "add unrelated"]);

        let head = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.author().name(), Some("Tester"));
        assert_eq!(head.author().email(), Some("t@example.com"));
    }

    #[test]
    fn purge_path_keeps_a_now_empty_commit_instead_of_dropping_it() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);

        let c1 = commit(p, "keep.txt", "1");
        let secret_added = commit(p, "secret.txt", "sk"); // touches ONLY secret.txt
        commit(p, "other.txt", "x");

        purge_path(p.into(), secret_added, "secret.txt".into()).unwrap();

        let log = log_all(&repo);
        assert_eq!(
            log.len(),
            3,
            "the now-empty commit is kept, not dropped — still 3 commits"
        );
        let subjects: Vec<&str> = log.iter().map(|(_, s, _)| s.as_str()).collect();
        assert_eq!(
            subjects,
            vec!["add keep.txt", "add secret.txt", "add other.txt"]
        );

        // The kept "add secret.txt" commit's tree is now identical to its
        // parent's (c1's original tree) — that's what "empty" means here.
        let c1_tree = repo
            .find_commit(Oid::from_str(&c1).unwrap())
            .unwrap()
            .tree()
            .unwrap()
            .id();
        assert_eq!(
            log[1].2, c1_tree,
            "purged commit's tree now matches its parent's — it's empty, but present"
        );
    }

    #[test]
    fn purge_path_creates_a_backup_and_undo_restores_the_original_tip() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);

        commit(p, "a.txt", "1");
        let secret_added = commit(p, "secret.txt", "sk");
        let original_tip = commit(p, "b.txt", "2");

        purge_path(p.into(), secret_added, "secret.txt".into()).unwrap();
        assert_ne!(
            repo.head()
                .unwrap()
                .peel_to_commit()
                .unwrap()
                .id()
                .to_string(),
            original_tip,
            "tip moved after purge"
        );
        assert!(list_backups(&repo)
            .unwrap()
            .iter()
            .any(|b| b.op == "purge-path"));

        let restored = undo_last(p.to_path_buf()).unwrap().expect("a backup");
        assert_eq!(restored.op, "purge-path");
        assert_eq!(
            repo.head()
                .unwrap()
                .peel_to_commit()
                .unwrap()
                .id()
                .to_string(),
            original_tip,
            "undo restores the original tip"
        );
        assert!(
            p.join("secret.txt").exists(),
            "undo restored the working tree too"
        );
    }

    #[test]
    fn purge_path_errors_when_sha_is_not_an_ancestor_of_the_tip() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);

        commit(p, "base.txt", "0");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();
        crate::branch::create_branch(p.into(), "feature".into(), "HEAD".into()).unwrap();
        crate::branch::checkout(p.into(), "feature".into()).unwrap();
        let off_branch = commit(p, "secret.txt", "sk");
        crate::branch::checkout(p.into(), main).unwrap();
        commit(p, "main-only.txt", "m");

        let err = purge_path(p.into(), off_branch, "secret.txt".into()).unwrap_err();
        assert!(matches!(err, AdgitterError::Internal(_)));
        assert!(
            list_backups(&repo).unwrap().is_empty(),
            "a rejected precondition leaves no backup"
        );
    }

    #[test]
    fn purge_path_errors_for_a_path_absent_from_the_whole_range() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);

        let sha = commit(p, "a.txt", "1");
        commit(p, "b.txt", "2");

        let err = purge_path(p.into(), sha, "nope.txt".into()).unwrap_err();
        assert!(matches!(err, AdgitterError::Internal(_)));
        assert!(list_backups(&repo).unwrap().is_empty());
    }

    #[test]
    fn purge_path_rejects_a_directory_path() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);

        std::fs::create_dir(p.join("secrets")).unwrap();
        let sha = commit(p, "secrets/api_key.txt", "sk");

        let err = purge_path(p.into(), sha, "secrets".into()).unwrap_err();
        assert!(matches!(err, AdgitterError::Internal(_)));
        assert!(list_backups(&repo).unwrap().is_empty());
    }

    #[test]
    fn purge_path_on_the_whole_branch_root_to_tip_works() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);

        let root = commit(p, "secret.txt", "sk"); // secret from the very first commit
        commit(p, "b.txt", "2");

        purge_path(p.into(), root, "secret.txt".into()).unwrap();

        assert!(!p.join("secret.txt").exists());
        assert!(p.join("b.txt").exists());
        let log = log_all(&repo);
        assert_eq!(log.len(), 2, "root commit kept as an empty commit");
    }

    /// A merge inside the purge range must keep its two parents and every
    /// commit must keep its own content. Purge is pure tree surgery, so if the
    /// range were re-parented into a straight line, the side-branch commit
    /// would land after the mainline one carrying a tree that predates it —
    /// silently reverting the mainline change in the middle of history, with
    /// only the tip coming out right. This is the regression guard for that.
    #[test]
    fn purge_path_preserves_a_merge_and_its_side_branch_content() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);

        let base = commit(p, "keep.txt", "base");
        commit(p, "secret.txt", "leaked");

        // Mainline commit on the current branch.
        edit(p, "main.txt", "from-main", "add main.txt");
        let main_branch = repo.head().unwrap().shorthand().unwrap().to_string();

        // Side branch off `base`, then merge it back.
        let base_commit = repo.find_commit(Oid::from_str(&base).unwrap()).unwrap();
        repo.branch("side", &base_commit, false).unwrap();
        crate::branch::checkout(p.to_path_buf(), "side".into()).unwrap();
        edit(p, "side.txt", "from-side", "add side.txt");
        crate::branch::checkout(p.to_path_buf(), main_branch.clone()).unwrap();
        crate::history::merge(p.to_path_buf(), "side".into()).unwrap();

        let tip_before = repo.head().unwrap().peel_to_commit().unwrap().id();
        assert_eq!(
            repo.find_commit(tip_before).unwrap().parent_count(),
            2,
            "fixture must actually produce a merge commit"
        );

        purge_path(p.to_path_buf(), base.clone(), "secret.txt".into()).unwrap();

        let tip = repo.head().unwrap().peel_to_commit().unwrap();
        // The merge survives as a merge.
        assert_eq!(tip.parent_count(), 2, "the merge lost a parent");
        // Both sides' content is intact at the tip, and the secret is gone.
        let tree = tip.tree().unwrap();
        assert!(tree.get_path(StdPath::new("secret.txt")).is_err());
        for (file, want) in [
            ("keep.txt", "base"),
            ("main.txt", "from-main"),
            ("side.txt", "from-side"),
        ] {
            let blob = tree
                .get_path(StdPath::new(file))
                .unwrap()
                .to_object(&repo)
                .unwrap();
            assert_eq!(
                std::str::from_utf8(blob.as_blob().unwrap().content()).unwrap(),
                want,
                "{file} content changed"
            );
        }
        // And no commit in the rewritten history still carries the secret.
        for (_, _, tree_id) in log_all(&repo) {
            let t = repo.find_tree(tree_id).unwrap();
            assert!(
                t.get_path(StdPath::new("secret.txt")).is_err(),
                "secret.txt survived in a rewritten commit"
            );
        }
    }
}
