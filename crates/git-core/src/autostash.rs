//! Autostash: park uncommitted work while a rewriting op moves the working
//! tree, then put it back (PRD User Story 19 — "a gesture operation on a dirty
//! working tree stashes automatically and pops automatically when it's done").
//!
//! Every rewriting op in this crate ends by force-checking-out the rewritten
//! tip (`CheckoutBuilder::force()` + `checkout_head`), and every *failing* one
//! ends by hard-resetting back to the pre-op tip (`history::abort_to`). Both
//! overwrite unstaged edits to tracked files. `rebase_branch` already solved
//! this for the "we have to switch branches" case with a stash/pop pair; this
//! module is that same mechanism, factored out so the SAME-branch rewrite
//! paths (`rebase::execute`, `inject`, `purge`) can use it too, and so
//! `rebase_branch` keeps exactly one implementation of it.
//!
//! ## Tracked-only by default
//!
//! [`stash_if_dirty`] takes an `include_untracked` flag because the two
//! callers need different reach:
//!
//! * A **branch switch** (`rebase_branch`) must include untracked files: the
//!   checkout can refuse or clobber them, and they belong to the branch the
//!   user was on.
//! * A **same-branch rewrite** must NOT: a forced `checkout_head` never
//!   removes untracked files (that would need `REMOVE_UNTRACKED`), so they are
//!   not at risk — and stashing them would actively break
//!   `inject::add_file_to_commit`, whose whole input is an untracked file that
//!   the op then commits. Popping it back afterwards would collide with the
//!   very file the op just checked out.
//!
//! ## Two repository handles
//!
//! `Repository::stash_save`/`stash_pop` need `&mut Repository`, but the
//! callers hold a shared `&Repository` (often with live `Commit` borrows out
//! of it). So the stash itself runs on a second handle opened on the same
//! path — the identical split `resolve::continue_rebase` already uses. The
//! caller's handle then re-reads its index so it cannot act on a stale
//! snapshot of one we just rewrote underneath it.
//!
//! ## Locking
//!
//! These functions take NO lock: they are called from inside code that
//! already holds the (non-reentrant) mutation lock. `rebase_branch`'s
//! path-based wrappers keep their own lock scopes.

use git2::{Repository, StashFlags, StatusOptions};

use crate::error::AdgitterResult;
use crate::history::signature;

/// True when the working tree or index has uncommitted changes. Ignored files
/// never count (nothing to lose there, and `stash_save` doesn't take them
/// without `INCLUDE_IGNORED`); untracked ones count only if asked for.
fn is_dirty(repo: &Repository, include_untracked: bool) -> AdgitterResult<bool> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(include_untracked)
        .recurse_untracked_dirs(include_untracked);
    Ok(!repo.statuses(Some(&mut opts))?.is_empty())
}

/// Open a second handle on `repo`'s path so `&mut self` stash calls are
/// possible while the caller keeps its shared borrow.
fn writable(repo: &Repository) -> AdgitterResult<Repository> {
    Ok(Repository::open(repo.path())?)
}

/// Re-read the caller's index from disk after the other handle changed it, so
/// a later `checkout_head`/`write_tree` cannot resurrect a stale snapshot.
fn refresh_index(repo: &Repository) {
    if let Ok(mut index) = repo.index() {
        let _ = index.read(true);
    }
}

/// Stash the working tree/index if dirty, labelled `label`. Returns whether a
/// stash was actually created — pass that to [`pop`] (or persist it, as a
/// paused op does) so the pop only happens when there is something to pop.
pub(crate) fn stash_if_dirty(
    repo: &Repository,
    label: &str,
    include_untracked: bool,
) -> AdgitterResult<bool> {
    if !is_dirty(repo, include_untracked)? {
        return Ok(false);
    }
    let mut writable = writable(repo)?;
    let sig = signature(&writable)?;
    let flags = if include_untracked {
        StashFlags::INCLUDE_UNTRACKED
    } else {
        StashFlags::DEFAULT
    };
    writable.stash_save(&sig, label, Some(flags))?;
    refresh_index(repo);
    Ok(true)
}

/// Pop the stash [`stash_if_dirty`] created. Always index 0 — nothing else
/// touches the stash stack between the save and this call.
pub(crate) fn pop(repo: &Repository) -> AdgitterResult<()> {
    let mut writable = writable(repo)?;
    writable.stash_pop(0, None)?;
    refresh_index(repo);
    Ok(())
}

/// The error a failed pop turns into: the operation itself SUCCEEDED, so the
/// user must be told their changes are parked, not lost. Mirrors the wording
/// `rebase_branch` already uses for the same situation.
pub(crate) fn pop_failed(op: &str, e: crate::error::AdgitterError) -> crate::error::AdgitterError {
    crate::error::AdgitterError::Internal(format!(
        "the {op} succeeded, but restoring your uncommitted changes failed: {e} — they are \
         still saved in the stash; run `git stash pop` manually"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workdir;
    use std::path::Path;

    fn init_repo(dir: &Path) -> Repository {
        let repo = Repository::init(dir).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Tester").unwrap();
        cfg.set_str("user.email", "t@example.com").unwrap();
        repo
    }

    fn commit(dir: &Path, name: &str, content: &str) {
        std::fs::write(dir.join(name), content).unwrap();
        workdir::stage(dir.to_path_buf(), vec![name.to_string()]).unwrap();
        workdir::commit(dir.to_path_buf(), format!("add {name}"), false).unwrap();
    }

    /// The same-branch rewrite paths pass `include_untracked = false` on
    /// purpose: an untracked file (inject's whole input) must stay put, while
    /// a tracked edit is parked and restored.
    #[test]
    fn tracked_only_stash_parks_the_edit_and_leaves_untracked_files_alone() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "a.txt", "committed\n");
        std::fs::write(p.join("a.txt"), "edited\n").unwrap();
        std::fs::write(p.join("new.txt"), "untracked\n").unwrap();

        assert!(stash_if_dirty(&repo, "test", false).unwrap());
        assert_eq!(
            std::fs::read_to_string(p.join("a.txt")).unwrap(),
            "committed\n",
            "the tracked edit is parked"
        );
        assert!(
            p.join("new.txt").exists(),
            "an untracked file is not swept into a tracked-only stash"
        );

        pop(&repo).unwrap();
        assert_eq!(
            std::fs::read_to_string(p.join("a.txt")).unwrap(),
            "edited\n",
            "the tracked edit comes back"
        );
    }

    /// A clean tree stashes nothing — so the caller's `stashed` flag stays
    /// false and no pop is attempted against an empty stack.
    #[test]
    fn a_clean_tree_is_not_stashed() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "a.txt", "committed\n");
        assert!(!stash_if_dirty(&repo, "test", false).unwrap());
        // An untracked file alone is not "dirty" for a tracked-only stash…
        std::fs::write(p.join("new.txt"), "untracked\n").unwrap();
        assert!(!stash_if_dirty(&repo, "test", false).unwrap());
        // …but it is for a branch-switch stash.
        assert!(stash_if_dirty(&repo, "test", true).unwrap());
        assert!(!p.join("new.txt").exists());
        pop(&repo).unwrap();
        assert!(p.join("new.txt").exists());
    }
}
