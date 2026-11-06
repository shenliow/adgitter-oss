//! Inject a working-tree file into a historic commit: the
//! exact INVERSE of `purge.rs` — "I forgot to commit this file back then, add
//! it retroactively".
//!
//! [`add_file_to_commit`] takes the CURRENT working tree's content of `path`
//! and writes it into the tree of `sha` **and** every descendant commit up to
//! the current branch tip, then rewrites the branch onto the result. Setting
//! it in only one commit would not be enough — a descendant that doesn't
//! touch the path would keep carrying its OLD (pre-`sha`) tree state forward,
//! which for a purely-added path means it would simply be missing again by
//! the tip. So, mirroring purge, every commit from `sha` to the tip is
//! rewritten with the same content set.
//!
//! Like `purge.rs`, this is pure tree surgery, not diff replay: each
//! commit's own tree gets `path` set directly (via a scratch in-memory
//! `Index`, never the repo's on-disk one) to the SAME blob, and the commit is
//! re-created with its parents mapped to their rewritten counterparts. There
//! is no diff application, so this can never conflict — including on commits
//! that already touch `path` with different content, which are simply
//! overwritten to the worktree's content (documented decision: mirrors
//! purge's unconditional removal; the confirm dialog warns it rewrites the
//! range). The graph's shape (merges included) survives untouched — see
//! `purge.rs`'s `rewrite` doc for why anything else would corrupt the
//! intermediate history; the same reasoning applies here unchanged.
//!
//! Like every rewriting op in this crate, it holds the mutation lock and
//! snapshots the branch with a backup ref first (mutate.rs), so it is
//! reversible via `undo_last`.

use std::collections::HashMap;
use std::path::PathBuf;

use git2::{
    build::CheckoutBuilder, Commit, Index, IndexEntry, IndexTime, Oid, Repository, ResetType,
};

use crate::error::{AdgitterError, AdgitterResult};
use crate::git::open_repo;
use crate::history::{current_branch, resolve_commit, signature};
use crate::mutate::{create_backup, lock_mutations};
use crate::purge::range_inclusive;

/// The oid of `tree` with `path` set to `blob`'s content, overwriting any
/// existing entry at that path (or creating it fresh, including any missing
/// intermediate directory trees). Built via a scratch in-memory `Index` —
/// never the repo's on-disk one — exactly like `purge.rs`'s
/// `tree_without_path`.
///
/// The `IndexEntry`'s stat fields (dev/ino/uid/gid/file_size/ctime/mtime) are
/// zeroed: this entry is never checked against a real working-tree file, it
/// only exists to be written into a tree, and `Index::add` recomputes the
/// path-length bits of `flags` itself, so a zeroed `flags` is fine too.
fn tree_with_path(
    repo: &Repository,
    tree: &git2::Tree,
    path: &str,
    blob: Oid,
) -> AdgitterResult<Oid> {
    let mut index = Index::new()?;
    index.read_tree(tree)?;
    let entry = IndexEntry {
        ctime: IndexTime::new(0, 0),
        mtime: IndexTime::new(0, 0),
        dev: 0,
        ino: 0,
        mode: 0o100_644,
        uid: 0,
        gid: 0,
        file_size: 0,
        id: blob,
        flags: 0,
        flags_extended: 0,
        path: path.as_bytes().to_vec(),
    };
    index.add(&entry)?;
    Ok(index.write_tree_to(repo)?)
}

/// Rewrite every commit in `range` (oldest-first) with `path` set to `blob`
/// in its tree, returning the new tip oid. Message, author identity, and
/// author date are copied from the original commit; only the tree (and any
/// parent that was itself rewritten) changes. The committer is stamped
/// fresh, matching every other rewrite op in this crate (history::reword,
/// rebase::replay, purge::rewrite).
///
/// The commit graph's shape is preserved exactly — including merges — for
/// the same reason `purge.rs`'s `rewrite` preserves it: this is pure tree
/// surgery, so each commit keeps its OWN tree, and re-parenting the range
/// into a straight line would silently corrupt any merge in range.
fn rewrite(
    repo: &Repository,
    range: &[Oid],
    path: &str,
    blob: Oid,
    tip: Oid,
) -> AdgitterResult<(Oid, HashMap<Oid, Oid>)> {
    let committer = signature(repo)?;
    let mut rewritten: HashMap<Oid, Oid> = HashMap::new();

    for oid in range {
        let commit = repo.find_commit(*oid)?;
        let new_tree_id = tree_with_path(repo, &commit.tree()?, path, blob)?;
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

/// Set `path` to its CURRENT working-tree content in `sha`'s tree and in
/// every commit from `sha` through the current branch tip, then rewrite the
/// branch onto the result.
///
/// Preconditions (matching the other rewriting ops in this crate): the
/// current branch is not detached (`current_branch`), `sha` resolves to a
/// real commit, `sha` is an ancestor of (or equal to) the branch tip, and
/// `path` names an existing regular file in the working tree (a missing path
/// or a directory errors clearly rather than guessing intent).
pub fn add_file_to_commit(
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

    let workdir = repo
        .workdir()
        .ok_or_else(|| AdgitterError::Internal("cannot add a file in a bare repository".into()))?
        .to_path_buf();
    let full_path = workdir.join(&path);
    if !full_path.exists() {
        return Err(AdgitterError::Internal(format!(
            "{path} does not exist in the working tree"
        )));
    }
    if full_path.is_dir() {
        return Err(AdgitterError::Internal(format!(
            "{path} is a directory in the working tree — add_file_to_commit only \
             supports a single file path, not a directory"
        )));
    }
    if !full_path.is_file() {
        return Err(AdgitterError::Internal(format!(
            "{path} is not a regular file"
        )));
    }

    let range = range_inclusive(&repo, target.id(), tip.id())?;

    // Read the file bytes ONCE up front: one blob shared by every rewritten
    // tree, so every in-range commit ends up with byte-identical content.
    let bytes = std::fs::read(&full_path)?;
    let blob = repo.blob(&bytes)?;

    // Only NOW park any uncommitted work: the forced `checkout_head` below
    // would overwrite unstaged edits to tracked files (PRD User Story 19).
    // After the blob is read, so injecting a tracked-but-modified file still
    // injects the WORKING TREE's content, not the committed one — and
    // tracked-only, so the untracked file this op usually injects stays where
    // the user put it (see `autostash.rs`).
    let stashed = crate::autostash::stash_if_dirty(&repo, "adgitter: add-file autostash", false)?;

    let backup = create_backup(&repo, "add-file", &branch)?;

    let (new_tip, rewritten) = match rewrite(&repo, &range, &path, blob, tip.id()) {
        Ok(res) => res,
        Err(e) => {
            // Rewrite only wrote loose objects; refs/worktree are unchanged.
            // Drop the orphaned backup so it does not pollute the undo stack
            // (mirrors purge_path's / rebase::execute's failure handling).
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
    reference.set_target(new_tip, "add-file")?;
    repo.set_head(&branch)?;
    // A hard reset rather than a bare `checkout_head`: the injected file is
    // typically UNTRACKED in the working tree and its content already matches
    // the tree we just built, so checkout skips it — and skips adding it to
    // the index, leaving the file the op just committed showing up as a staged
    // DELETION plus an untracked file. Resetting writes the index straight
    // from the new tip's tree, so index, worktree and HEAD agree (which the
    // autostash pop below also requires: libgit2 refuses to apply a stash onto
    // an index that disagrees with HEAD).
    let obj = repo.find_object(new_tip, None)?;
    let mut co = CheckoutBuilder::new();
    co.force();
    repo.reset(&obj, ResetType::Hard, Some(&mut co))?;
    // Best-effort: carry every other local branch that descends from the
    // rewritten range over to the new chain (their backups join this op's
    // batch, so a single undo restores all of it).
    let outcome = crate::remap::remap_descendants(&repo, &rewritten, &branch, "add-file", &backup);
    crate::undo::seal(&repo, &backup)?;
    if stashed {
        crate::autostash::pop(&repo).map_err(|e| crate::autostash::pop_failed("add-file", e))?;
    }
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mutate::{list_backups, undo_last};
    use crate::workdir;
    use git2::{Repository, Sort};
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

    fn content_at(repo: &Repository, tree_id: Oid, path: &str) -> String {
        let tree = repo.find_tree(tree_id).unwrap();
        let entry = tree.get_path(StdPath::new(path)).unwrap();
        let blob = entry.to_object(repo).unwrap();
        std::str::from_utf8(blob.as_blob().unwrap().content())
            .unwrap()
            .to_string()
    }

    #[test]
    fn add_file_to_commit_adds_the_file_from_sha_through_tip() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);

        let _before = commit(p, "keep.txt", "safe");
        let target = commit(p, "b.txt", "2");
        commit(p, "c.txt", "3");

        // The file being injected exists only in the CURRENT working tree —
        // it was never committed.
        std::fs::write(p.join("injected.txt"), "injected-content").unwrap();

        add_file_to_commit(p.into(), target, "injected.txt".into()).unwrap();

        assert_eq!(
            std::fs::read_to_string(p.join("injected.txt")).unwrap(),
            "injected-content"
        );

        let log = log_all(&repo);
        assert_eq!(log.len(), 3, "no commits dropped, none added");
        for (sha, _subject, tree_id) in &log[1..] {
            assert_eq!(
                content_at(&repo, *tree_id, "injected.txt"),
                "injected-content",
                "injected.txt must carry the worktree content at {sha}"
            );
        }
    }

    #[test]
    fn add_file_to_commit_leaves_commits_before_sha_untouched() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);

        let c1 = commit(p, "a.txt", "1");
        let c2 = commit(p, "b.txt", "2");
        let target = commit(p, "c.txt", "3");
        commit(p, "d.txt", "4");

        std::fs::write(p.join("injected.txt"), "hello").unwrap();
        add_file_to_commit(p.into(), target, "injected.txt".into()).unwrap();

        let log = log_all(&repo);
        assert_eq!(log[0].0, c1, "root commit sha unchanged");
        assert_eq!(log[1].0, c2, "second commit sha unchanged");
        assert_eq!(log[0].1, "add a.txt");
        assert_eq!(log[1].1, "add b.txt");
    }

    #[test]
    fn add_file_to_commit_preserves_unrelated_file_content_and_messages_and_authors() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);

        let target = commit(p, "a.txt", "1");
        edit(p, "unrelated.txt", "keep-me", "add unrelated");

        std::fs::write(p.join("injected.txt"), "hello").unwrap();
        add_file_to_commit(p.into(), target, "injected.txt".into()).unwrap();

        assert_eq!(
            std::fs::read_to_string(p.join("unrelated.txt")).unwrap(),
            "keep-me",
            "unrelated file content survives the rewrite"
        );

        let log = log_all(&repo);
        let subjects: Vec<&str> = log.iter().map(|(_, s, _)| s.as_str()).collect();
        assert_eq!(subjects, vec!["add a.txt", "add unrelated"]);

        let head = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.author().name(), Some("Tester"));
        assert_eq!(head.author().email(), Some("t@example.com"));
    }

    #[test]
    fn add_file_to_commit_creates_a_backup_and_undo_restores_the_original_tip() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);

        commit(p, "a.txt", "1");
        let target = commit(p, "b.txt", "2");
        let original_tip = commit(p, "c.txt", "3");

        std::fs::write(p.join("injected.txt"), "hello").unwrap();
        add_file_to_commit(p.into(), target, "injected.txt".into()).unwrap();
        assert_ne!(
            repo.head()
                .unwrap()
                .peel_to_commit()
                .unwrap()
                .id()
                .to_string(),
            original_tip,
            "tip moved after the op"
        );
        assert!(list_backups(&repo)
            .unwrap()
            .iter()
            .any(|b| b.op == "add-file"));

        let restored = undo_last(p.to_path_buf()).unwrap().expect("a backup");
        assert_eq!(restored.op, "add-file");
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

        // The file was the USER'S, sitting untracked on disk before the op —
        // undo returns it to exactly that state. It must NOT leave with the
        // commit: pressing Undo may never delete working-tree content that
        // exists nowhere else (see `mutate::carry_over_injected`).
        assert_eq!(
            std::fs::read_to_string(p.join("injected.txt")).unwrap(),
            "hello",
            "undo puts the injected file back on disk with its content"
        );
        let status = workdir::status(p.to_path_buf()).unwrap();
        assert!(
            status.untracked.iter().any(|e| e.path == "injected.txt"),
            "and it is back to being untracked: {status:?}"
        );
        assert!(
            status.staged.is_empty() && status.changed.is_empty(),
            "undo leaves no phantom staged deletion behind either: {status:?}"
        );
    }

    /// Data safety over fidelity-to-the-op: if the user edited the injected
    /// file after the inject, undo must keep the CURRENT bytes, not silently
    /// roll the file back to the injected snapshot. Undo reverses the history
    /// change, not the user's later edits.
    #[test]
    fn undo_of_an_inject_keeps_the_files_current_content_not_the_injected_one() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let _repo = init_repo(p);

        commit(p, "a.txt", "1");
        let target = commit(p, "b.txt", "2");
        commit(p, "c.txt", "3");

        std::fs::write(p.join("injected.txt"), "as-injected").unwrap();
        add_file_to_commit(p.into(), target, "injected.txt".into()).unwrap();
        // The user keeps working on the file after the inject.
        std::fs::write(p.join("injected.txt"), "edited-after-the-inject").unwrap();

        undo_last(p.to_path_buf()).unwrap().expect("a backup");

        assert_eq!(
            std::fs::read_to_string(p.join("injected.txt")).unwrap(),
            "edited-after-the-inject",
            "undo must not discard edits made after the inject"
        );
        let status = workdir::status(p.to_path_buf()).unwrap();
        assert!(status.untracked.iter().any(|e| e.path == "injected.txt"));
    }

    /// The mirror case: the user DELETED the file after the inject. There is
    /// no content of theirs left to protect, and re-creating it would
    /// contradict a deliberate deletion — so undo leaves it gone, with a clean
    /// tree.
    #[test]
    fn undo_of_an_inject_does_not_resurrect_a_file_the_user_deleted() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let _repo = init_repo(p);

        commit(p, "a.txt", "1");
        let target = commit(p, "b.txt", "2");

        std::fs::write(p.join("injected.txt"), "hello").unwrap();
        add_file_to_commit(p.into(), target, "injected.txt".into()).unwrap();
        std::fs::remove_file(p.join("injected.txt")).unwrap();

        undo_last(p.to_path_buf()).unwrap().expect("a backup");

        assert!(!p.join("injected.txt").exists(), "not resurrected");
        let status = workdir::status(p.to_path_buf()).unwrap();
        assert!(
            status.staged.is_empty() && status.changed.is_empty(),
            "and the tree is clean, not a pending deletion: {status:?}"
        );
    }

    /// A nested path is carried back with its directories re-created — the
    /// checkout that removes the file prunes the (now empty) directory too.
    #[test]
    fn undo_of_an_inject_restores_a_file_in_a_nested_directory() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let _repo = init_repo(p);

        commit(p, "a.txt", "1");
        let target = commit(p, "b.txt", "2");

        std::fs::create_dir_all(p.join("deep/nest")).unwrap();
        std::fs::write(p.join("deep/nest/f.txt"), "nested").unwrap();
        add_file_to_commit(p.into(), target, "deep/nest/f.txt".into()).unwrap();

        undo_last(p.to_path_buf()).unwrap().expect("a backup");

        assert_eq!(
            std::fs::read_to_string(p.join("deep/nest/f.txt")).unwrap(),
            "nested"
        );
        let status = workdir::status(p.to_path_buf()).unwrap();
        assert!(
            status.staged.is_empty() && status.changed.is_empty(),
            "no phantom pending change: {status:?}"
        );
    }

    /// Two injects in a row undo one at a time, each returning its own file to
    /// disk — the second undo must not be confused by the first one's file
    /// already sitting there untracked.
    #[test]
    fn undo_of_two_stacked_injects_returns_both_files_to_disk() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);

        commit(p, "a.txt", "1");
        let target = commit(p, "b.txt", "2");

        std::fs::write(p.join("one.txt"), "first").unwrap();
        add_file_to_commit(p.into(), target, "one.txt".into()).unwrap();

        // The first inject rewrote the range, so the second one targets the
        // NEW tip (the old sha is no longer an ancestor of it).
        let tip_after_first = repo
            .head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .id()
            .to_string();
        std::fs::write(p.join("two.txt"), "second").unwrap();
        add_file_to_commit(p.into(), tip_after_first, "two.txt".into()).unwrap();

        undo_last(p.to_path_buf()).unwrap().expect("a backup");
        assert_eq!(
            std::fs::read_to_string(p.join("two.txt")).unwrap(),
            "second"
        );
        assert!(
            p.join("one.txt").exists(),
            "still tracked from the first inject"
        );

        undo_last(p.to_path_buf()).unwrap().expect("a backup");
        assert_eq!(std::fs::read_to_string(p.join("one.txt")).unwrap(), "first");

        let status = workdir::status(p.to_path_buf()).unwrap();
        let mut untracked: Vec<String> = status.untracked.iter().map(|e| e.path.clone()).collect();
        untracked.sort();
        assert_eq!(
            untracked,
            vec!["one.txt".to_string(), "two.txt".to_string()],
            "both files are back to untracked: {status:?}"
        );
        assert!(status.staged.is_empty() && status.changed.is_empty());
    }

    /// Undoing an inject that the user has since committed ON TOP of also
    /// rolls back those later commits (they descend from the rewritten tip) —
    /// so their files would vanish from disk too. They are the user's content
    /// just as much as the injected file, so they are carried back rather
    /// than deleted.
    ///
    /// The sequence is the reachable one, start to finish: inject, a real
    /// in-app commit, Undo, Undo. The first Undo dissolves the commit back
    /// into staged changes — and `undo::restore_commit` returns the branch to
    /// the snapshot's parent, which IS the post-inject tip, so the inject's
    /// left-mark matches again and its record becomes undoable on its own,
    /// with no re-sealing needed. The second Undo then reverses the inject
    /// with a hard restore, at which point `later.txt` is staged and in no
    /// tree: without `mutate::rescue_staged_only` the reset deletes it
    /// outright, destroying user-authored content recoverable from nowhere.
    #[test]
    fn undo_of_an_inject_also_keeps_files_added_by_later_commits() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let _repo = init_repo(p);

        commit(p, "a.txt", "1");
        let target = commit(p, "b.txt", "2");

        std::fs::write(p.join("injected.txt"), "hello").unwrap();
        add_file_to_commit(p.into(), target, "injected.txt".into()).unwrap();

        // Normal work afterwards, through the app's own entry point, so it
        // carries an undo record and takes its turn ahead of the inject's.
        commit(p, "later.txt", "written-later");

        let first = undo_last(p.to_path_buf()).unwrap().expect("a backup");
        assert_eq!(first.op, "commit", "the commit undoes first");
        let second = undo_last(p.to_path_buf()).unwrap().expect("a backup");
        assert_eq!(second.op, "add-file", "then the inject");

        assert_eq!(
            std::fs::read_to_string(p.join("injected.txt")).unwrap(),
            "hello"
        );
        assert_eq!(
            std::fs::read_to_string(p.join("later.txt")).unwrap(),
            "written-later",
            "a file from a rolled-back later commit is kept on disk too"
        );
        let status = workdir::status(p.to_path_buf()).unwrap();
        assert!(
            status
                .staged
                .iter()
                .any(|e| e.path == "later.txt" && e.status == "new"),
            "later.txt is still STAGED, as it was before the undo: {status:?}"
        );
        assert!(
            status.untracked.iter().any(|e| e.path == "injected.txt"),
            "the injected file returns untracked, as before the inject: \
             {status:?}"
        );
    }

    /// The post-condition of an inject: the file is committed AND the index
    /// agrees, so `status` is clean. Pins the fix for the phantom staged
    /// deletion described in the undo test above.
    #[test]
    fn add_file_to_commit_leaves_the_injected_file_tracked_and_the_status_clean() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let _repo = init_repo(p);

        commit(p, "a.txt", "1");
        let target = commit(p, "b.txt", "2");
        commit(p, "c.txt", "3");

        std::fs::write(p.join("injected.txt"), "hello").unwrap();
        add_file_to_commit(p.into(), target, "injected.txt".into()).unwrap();

        let status = workdir::status(p.to_path_buf()).unwrap();
        assert!(
            status.staged.is_empty() && status.changed.is_empty() && status.untracked.is_empty(),
            "the injected file is committed and tracked — nothing left pending: {status:?}"
        );
        assert_eq!(
            std::fs::read_to_string(p.join("injected.txt")).unwrap(),
            "hello",
            "and it is still on disk with its content"
        );
    }

    #[test]
    fn add_file_to_commit_errors_when_sha_is_not_an_ancestor_of_the_tip() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);

        commit(p, "base.txt", "0");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();
        crate::branch::create_branch(p.into(), "feature".into(), "HEAD".into()).unwrap();
        crate::branch::checkout(p.into(), "feature".into()).unwrap();
        let off_branch = commit(p, "f.txt", "f");
        crate::branch::checkout(p.into(), main).unwrap();
        commit(p, "main-only.txt", "m");

        std::fs::write(p.join("injected.txt"), "hello").unwrap();
        let err = add_file_to_commit(p.into(), off_branch, "injected.txt".into()).unwrap_err();
        assert!(matches!(err, AdgitterError::Internal(_)));
        assert!(
            list_backups(&repo).unwrap().is_empty(),
            "a rejected precondition leaves no backup"
        );
    }

    #[test]
    fn add_file_to_commit_errors_when_the_worktree_file_does_not_exist() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);

        let sha = commit(p, "a.txt", "1");

        let err = add_file_to_commit(p.into(), sha, "missing.txt".into()).unwrap_err();
        assert!(matches!(err, AdgitterError::Internal(_)));
        assert!(list_backups(&repo).unwrap().is_empty());
    }

    #[test]
    fn add_file_to_commit_rejects_a_directory_path() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);

        let sha = commit(p, "a.txt", "1");
        std::fs::create_dir(p.join("adir")).unwrap();
        std::fs::write(p.join("adir").join("f.txt"), "x").unwrap();

        let err = add_file_to_commit(p.into(), sha, "adir".into()).unwrap_err();
        assert!(matches!(err, AdgitterError::Internal(_)));
        assert!(list_backups(&repo).unwrap().is_empty());
    }

    #[test]
    fn add_file_to_commit_works_on_the_root_commit() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);

        let root = commit(p, "a.txt", "1");
        commit(p, "b.txt", "2");

        std::fs::write(p.join("injected.txt"), "root-content").unwrap();
        add_file_to_commit(p.into(), root, "injected.txt".into()).unwrap();

        assert!(p.join("injected.txt").exists());
        let log = log_all(&repo);
        assert_eq!(log.len(), 2, "no commit dropped or added");
        for (_, _, tree_id) in &log {
            assert_eq!(content_at(&repo, *tree_id, "injected.txt"), "root-content");
        }
    }

    /// A merge inside the range must keep its two parents and every commit
    /// must keep its own content, mirroring
    /// `purge_path_preserves_a_merge_and_its_side_branch_content`.
    #[test]
    fn add_file_to_commit_preserves_a_merge_and_its_side_branch_content() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);

        let base = commit(p, "keep.txt", "base");

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

        std::fs::write(p.join("injected.txt"), "carried-across").unwrap();
        add_file_to_commit(p.to_path_buf(), base.clone(), "injected.txt".into()).unwrap();

        let tip = repo.head().unwrap().peel_to_commit().unwrap();
        // The merge survives as a merge.
        assert_eq!(tip.parent_count(), 2, "the merge lost a parent");
        // Both sides' content is intact at the tip, plus the injected file.
        let tree = tip.tree().unwrap();
        for (file, want) in [
            ("keep.txt", "base"),
            ("main.txt", "from-main"),
            ("side.txt", "from-side"),
            ("injected.txt", "carried-across"),
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
        // And every commit in the rewritten history carries the injected file.
        for (_, _, tree_id) in log_all(&repo) {
            assert_eq!(content_at(&repo, tree_id, "injected.txt"), "carried-across");
        }
    }

    /// A later in-range commit already has `path` with DIFFERENT content —
    /// after the op every in-range commit must carry the worktree content,
    /// including that one (unconditional overwrite, matching purge's
    /// unconditional removal).
    #[test]
    fn add_file_to_commit_overwrites_a_later_commit_that_already_has_the_path() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);

        let target = commit(p, "a.txt", "1");
        // A later commit already touches the same path, with different
        // content than what will be injected.
        let with_old_content = commit(p, "injected.txt", "stale-content");
        commit(p, "c.txt", "3");

        std::fs::write(p.join("injected.txt"), "fresh-content").unwrap();
        add_file_to_commit(p.into(), target, "injected.txt".into()).unwrap();

        assert_eq!(
            std::fs::read_to_string(p.join("injected.txt")).unwrap(),
            "fresh-content"
        );
        let log = log_all(&repo);
        for (sha, _subject, tree_id) in &log {
            assert_eq!(
                content_at(&repo, *tree_id, "injected.txt"),
                "fresh-content",
                "{sha} must carry the fresh worktree content, not stale-content"
            );
        }
        let _ = with_old_content; // only used to seed the fixture
    }

    /// Remap analog of `remap::purge_carries_a_downstream_fork_onto_the_stripped_chain`:
    /// a fork branched after `sha` gets remapped and carries the added file.
    #[test]
    fn add_file_to_commit_carries_a_downstream_fork_onto_the_extended_chain() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        let base = commit(p, "base.txt", "0");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();
        let target = commit(p, "x.txt", "x");
        commit(p, "d1.txt", "d");

        crate::branch::create_branch(p.into(), "feature".into(), "HEAD".into()).unwrap();
        crate::branch::checkout(p.into(), "feature".into()).unwrap();
        commit(p, "f1.txt", "f");

        crate::branch::checkout(p.into(), main).unwrap();
        std::fs::write(p.join("injected.txt"), "everywhere").unwrap();
        let outcome = add_file_to_commit(p.into(), target, "injected.txt".into()).unwrap();
        assert_eq!(outcome.remapped, vec!["refs/heads/feature".to_string()]);

        // The injected file is present in EVERY commit of the remapped fork
        // from the rewritten `target` onward. `base` predates the range: it
        // is untouched (same oid) and rightly still lacks the file, so it is
        // hidden from the walk.
        let feature_tip = repo
            .find_branch("feature", git2::BranchType::Local)
            .unwrap()
            .get()
            .target()
            .unwrap();
        let mut walk = repo.revwalk().unwrap();
        walk.push(feature_tip).unwrap();
        walk.hide(Oid::from_str(&base).unwrap()).unwrap();
        let mut seen = 0;
        for oid in walk {
            let c = repo.find_commit(oid.unwrap()).unwrap();
            assert!(
                c.tree()
                    .unwrap()
                    .get_path(StdPath::new("injected.txt"))
                    .is_ok(),
                "injected.txt missing from {} on the remapped fork",
                c.id()
            );
            seen += 1;
        }
        assert_eq!(seen, 3, "target + d1 + f1 must all be checked");
    }
}
