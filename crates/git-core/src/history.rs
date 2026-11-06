//! Discrete history-rewriting operations: merge, reset,
//! cherry-pick, revert, reword. Each holds the mutation lock and writes a
//! backup ref first, so it is reversible via `reflog_undo`. The replay-based ops (interactive rebase, drop, reword of an
//! older commit) live in `rebase.rs` and build on the same safety net.
//!
//! Cherry-pick/revert conflicts are surfaced as a recoverable error after
//! aborting back to the pre-op tip (extending them to the pausable resolver
//! is a v2 follow-up). A `merge` conflict instead PAUSES the operation for
//! in-app resolution — see `resolve.rs`.

use std::path::PathBuf;

use git2::{build::CheckoutBuilder, Commit, MergeOptions, Oid, Repository, ResetType};

use crate::error::{AdgitterError, AdgitterResult};
use crate::git::open_repo;
use crate::mutate::{create_backup, lock_mutations};

/// Full ref name of the current branch, erroring on a detached/unborn HEAD.
pub(crate) fn current_branch(repo: &Repository) -> AdgitterResult<String> {
    if repo.head_detached().unwrap_or(false) {
        return Err(AdgitterError::Internal("HEAD is detached".into()));
    }
    let head = repo
        .head()
        .map_err(|_| AdgitterError::Internal("no current branch (unborn HEAD)".into()))?;
    head.name()
        .map(str::to_string)
        .ok_or_else(|| AdgitterError::Internal("invalid HEAD reference".into()))
}

pub(crate) fn resolve_commit<'r>(repo: &'r Repository, rev: &str) -> AdgitterResult<Commit<'r>> {
    Ok(repo.revparse_single(rev)?.peel_to_commit()?)
}

/// Author/committer signature for a rewrite. Git's configured `user.email`
/// always wins; the account address is a fallback only (see `identity`).
pub(crate) fn signature(repo: &Repository) -> AdgitterResult<git2::Signature<'static>> {
    crate::identity::signature_for(repo)
}

/// Abort an in-progress merge/cherry-pick/revert: clear the state and hard-reset
/// back to `oid`, leaving the working tree clean.
pub(crate) fn abort_to(repo: &Repository, oid: Oid) -> AdgitterResult<()> {
    repo.cleanup_state()?;
    let obj = repo.find_object(oid, None)?;
    let mut co = CheckoutBuilder::new();
    co.force();
    repo.reset(&obj, ResetType::Hard, Some(&mut co))?;
    Ok(())
}

/// Best-effort removal of a backup ref (used when an op is a no-op or aborts,
/// so no useless/undoable entry is left behind). Errors are ignored. Also
/// used by `resolve::abort_op`, which mirrors this exact cleanup for a paused
/// op the user chose to abandon.
pub(crate) fn drop_backup(repo: &Repository, backup: &crate::mutate::Backup) {
    if let Ok(mut r) = repo.find_reference(&backup.backup_ref) {
        let _ = r.delete();
    }
}

/// Merge `source` into the current branch. Fast-forwards when possible, else
/// creates a merge commit. A content conflict does NOT abort: the merge state
/// (MERGE_HEAD, conflicted index, worktree markers) is left in place and the
/// op pauses (`resolve.rs`) — the frontend probes it via `conflict_state`,
/// then resolves via `continue_op`/`abort_op`.
pub fn merge(
    repo_path: PathBuf,
    source: String,
) -> AdgitterResult<crate::resolve::HistoryOpResult> {
    let _lock = lock_mutations();
    let repo = open_repo(&repo_path)?;
    crate::resolve::ensure_not_paused(&repo)?;
    let branch = current_branch(&repo)?;
    let backup = create_backup(&repo, "merge", &branch)?;

    let theirs = resolve_commit(&repo, &source)?;
    let ours = repo.head()?.peel_to_commit()?;
    let annotated = repo.find_annotated_commit(theirs.id())?;
    let (analysis, _) = repo.merge_analysis(&[&annotated])?;

    if analysis.is_up_to_date() {
        // Nothing to merge — don't leave a no-op undo entry behind.
        drop_backup(&repo, &backup);
        return Ok(crate::resolve::HistoryOpResult::completed(
            crate::remap::RemapOutcome::default(),
        ));
    }
    if analysis.is_fast_forward() {
        let mut reference = repo.find_reference(&branch)?;
        reference.set_target(theirs.id(), "merge: fast-forward")?;
        repo.set_head(&branch)?;
        let mut co = CheckoutBuilder::new();
        co.force();
        repo.checkout_head(Some(&mut co))?;
        crate::undo::seal(&repo, &backup)?;
        return Ok(crate::resolve::HistoryOpResult::completed(
            crate::remap::RemapOutcome::default(),
        ));
    }

    let mut co = CheckoutBuilder::new();
    repo.merge(&[&annotated], Some(&mut MergeOptions::new()), Some(&mut co))?;
    if repo.index()?.has_conflicts() {
        // Leave MERGE_HEAD/index/worktree exactly as libgit2 wrote them and
        // persist enough to resume later — no abort, no dropped backup.
        let paused = crate::resolve::PausedOp::Merge {
            op: "merge".to_string(),
            branch: branch.clone(),
            pre_tip: ours.id().to_string(),
            backup,
            conflict_sha: theirs.id().to_string(),
            theirs: theirs.id().to_string(),
            theirs_label: source,
        };
        crate::resolve::write_paused(&repo, &paused)?;
        return Ok(crate::resolve::HistoryOpResult::conflict(&paused));
    }

    let sig = signature(&repo)?;
    let tree = repo.find_tree(repo.index()?.write_tree()?)?;
    repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        &format!("Merge {source}"),
        &tree,
        &[&ours, &theirs],
    )?;
    repo.cleanup_state()?;
    crate::undo::seal(&repo, &backup)?;
    Ok(crate::resolve::HistoryOpResult::completed(
        crate::remap::RemapOutcome::default(),
    ))
}

/// Reset the current branch to `target` with `mode` = "soft" | "mixed" | "hard".
pub fn reset(repo_path: PathBuf, target: String, mode: String) -> AdgitterResult<()> {
    let _lock = lock_mutations();
    let repo = open_repo(&repo_path)?;
    let branch = current_branch(&repo)?;
    let backup = create_backup(&repo, "reset", &branch)?;

    let obj = repo.revparse_single(&target)?;
    let kind = match mode.as_str() {
        "soft" => ResetType::Soft,
        "hard" => ResetType::Hard,
        "mixed" => ResetType::Mixed,
        other => {
            return Err(AdgitterError::Internal(format!(
                "unknown reset mode: {other}"
            )))
        }
    };
    if kind == ResetType::Hard {
        let mut co = CheckoutBuilder::new();
        co.force();
        repo.reset(&obj, kind, Some(&mut co))?;
    } else {
        repo.reset(&obj, kind, None)?;
    }
    crate::undo::seal(&repo, &backup)?;
    Ok(())
}

/// Cherry-pick `commits` (in order) onto the current branch.
pub fn cherry_pick(repo_path: PathBuf, commits: Vec<String>) -> AdgitterResult<()> {
    let _lock = lock_mutations();
    let repo = open_repo(&repo_path)?;
    let branch = current_branch(&repo)?;
    let backup = create_backup(&repo, "cherry-pick", &branch)?;
    let committer = signature(&repo)?;

    for rev in &commits {
        let pick = resolve_commit(&repo, rev)?;
        let head = repo.head()?.peel_to_commit()?;
        repo.cherrypick(&pick, None)?;
        if repo.index()?.has_conflicts() {
            abort_to(&repo, head.id())?;
            return Err(AdgitterError::Conflict {
                sha: pick.id().to_string(),
            });
        }
        let tree = repo.find_tree(repo.index()?.write_tree()?)?;
        repo.commit(
            Some("HEAD"),
            &pick.author(),
            &committer,
            pick.message().unwrap_or("cherry-pick"),
            &tree,
            &[&head],
        )?;
        repo.cleanup_state()?;
    }
    crate::undo::seal(&repo, &backup)?;
    Ok(())
}

/// Revert `commit` — create a new commit that undoes its changes.
pub fn revert(repo_path: PathBuf, commit: String) -> AdgitterResult<()> {
    let _lock = lock_mutations();
    let repo = open_repo(&repo_path)?;
    let branch = current_branch(&repo)?;
    let backup = create_backup(&repo, "revert", &branch)?;

    let target = resolve_commit(&repo, &commit)?;
    let head = repo.head()?.peel_to_commit()?;
    repo.revert(&target, None)?;
    if repo.index()?.has_conflicts() {
        abort_to(&repo, head.id())?;
        return Err(AdgitterError::Conflict {
            sha: target.id().to_string(),
        });
    }
    let sig = signature(&repo)?;
    let tree = repo.find_tree(repo.index()?.write_tree()?)?;
    repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        &format!("Revert \"{}\"", target.summary().unwrap_or("")),
        &tree,
        &[&head],
    )?;
    repo.cleanup_state()?;
    crate::undo::seal(&repo, &backup)?;
    Ok(())
}

/// Change a commit's message. The HEAD commit is a cheap amend; an older commit
/// is reworded by replaying the intervening commits through the rebase engine
/// (`rebase.rs`), so descendants are rewritten on top of the new message.
pub fn reword(
    repo_path: PathBuf,
    sha: String,
    message: String,
) -> AdgitterResult<crate::resolve::HistoryOpResult> {
    let _lock = lock_mutations();
    let repo = open_repo(&repo_path)?;
    crate::resolve::ensure_not_paused(&repo)?;
    if message.trim().is_empty() {
        return Err(AdgitterError::Internal(
            "commit message must not be empty".into(),
        ));
    }
    let head = repo.head()?.peel_to_commit()?;
    let target = resolve_commit(&repo, &sha)?;
    let branch = current_branch(&repo)?;

    if target.id() == head.id() {
        // Amending the tip still rewrites a commit other branches may sit on
        // or descend from (a fork made AT the tip shares this very oid), so
        // the one-pair map goes through the same descendant remap as the
        // engine path. A HEAD amend can never conflict, so this always
        // completes.
        let backup = create_backup(&repo, "reword", &branch)?;
        let old_id = head.id();
        let new_id = head.amend(Some("HEAD"), None, None, None, Some(&message), None)?;
        let mut rewritten = std::collections::HashMap::new();
        rewritten.insert(old_id, new_id);
        let outcome =
            crate::remap::remap_descendants(&repo, &rewritten, &branch, "reword", &backup);
        crate::undo::seal(&repo, &backup)?;
        return Ok(crate::resolve::HistoryOpResult::completed(outcome));
    }

    // Older commit: replay `target^..HEAD` with `target` reworded. That range
    // only CONTAINS `target` when `target` is an ancestor of HEAD; when it is
    // not, the plan is every commit of the current branch replayed onto an
    // unrelated commit's parent — which used to report success while rewording
    // nothing and silently re-parenting the checked-out branch onto another
    // branch's history. Refuse instead: rewording a commit means rewriting the
    // branch it lives on, so the user has to be standing on that branch.
    // (Same precondition, same wording style as `purge::range_inclusive`'s.)
    if !repo.graph_descendant_of(head.id(), target.id())? {
        return Err(AdgitterError::Internal(format!(
            "{} is not on the current branch ({}) — check out a branch that contains it, then \
             reword",
            target.id(),
            branch.strip_prefix("refs/heads/").unwrap_or(&branch),
        )));
    }

    // We already hold the lock, so call the engine's lock-free core directly.
    let parent = target
        .parent(0)
        .map_err(|_| AdgitterError::Internal("cannot reword the root commit via rebase".into()))?;
    let target_id = target.id();
    let steps = crate::rebase::pick_steps(&repo, parent.id(), head.id(), |oid| {
        if oid == target_id {
            crate::rebase::RebaseAction::Reword
        } else {
            crate::rebase::RebaseAction::Pick
        }
    })?
    .into_iter()
    .map(|mut s| {
        if s.commit == target_id.to_string() {
            s.message = Some(message.clone());
        }
        s
    })
    .collect::<Vec<_>>();
    crate::rebase::execute(&repo, &parent.id().to_string(), &steps, "reword")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::branch::{checkout, create_branch};
    use crate::mutate::list_backups;
    use crate::workdir;
    use git2::Repository;
    use std::path::Path;

    fn init_repo(dir: &Path) -> Repository {
        let repo = Repository::init(dir).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Tester").unwrap();
        cfg.set_str("user.email", "t@example.com").unwrap();
        repo
    }

    /// Commit `content` to `name` on HEAD via the crate's own ops; return sha.
    fn commit(dir: &Path, name: &str, content: &str) -> String {
        std::fs::write(dir.join(name), content).unwrap();
        workdir::stage(dir.to_path_buf(), vec![name.to_string()]).unwrap();
        workdir::commit(dir.to_path_buf(), format!("add {name}"), false).unwrap()
    }

    fn head(repo: &Repository) -> Oid {
        repo.head().unwrap().peel_to_commit().unwrap().id()
    }

    #[test]
    fn merge_fast_forwards() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "a.txt", "1");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();
        create_branch(p.into(), "feature".into(), "HEAD".into()).unwrap();
        checkout(p.into(), "feature".into()).unwrap();
        let tip = commit(p, "b.txt", "2");
        checkout(p.into(), main.clone()).unwrap();

        merge(p.into(), "feature".into()).unwrap();
        assert_eq!(
            head(&repo).to_string(),
            tip,
            "main fast-forwarded to feature"
        );
    }

    // `merge_creates_merge_commit_for_divergent_branches` lived here; it is
    // superseded by `tests/matrix.rs::merge_head_target_*_open`, which asserts
    // the same two-parent shape and `merge` backup plus both parent
    // identities, the exact set of refs moved, and the undo round-trip.

    /// PREMISE CHANGE (pausable resolver): a merge conflict no longer aborts —
    /// it pauses with the conflicted merge state left in place. The full
    /// pause/continue/abort battery lives in `resolve.rs`; this covers the
    /// merge entry point's own behaviour.
    #[test]
    fn merge_conflict_pauses_with_state_left_in_place() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "a.txt", "base\n");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();
        create_branch(p.into(), "feature".into(), "HEAD".into()).unwrap();
        checkout(p.into(), "feature".into()).unwrap();
        let feature_tip = commit(p, "a.txt", "feature\n");
        checkout(p.into(), main.clone()).unwrap();
        let pre = commit(p, "a.txt", "main\n"); // conflicts with feature on a.txt

        let state = merge(p.into(), "feature".into()).unwrap().unwrap_conflict();
        assert_eq!(state.op, "merge");
        assert_eq!(state.branch, main, "short branch name for display");
        assert_eq!(
            state.sha, feature_tip,
            "conflict names the incoming commit that failed to apply"
        );

        // The merge state is LEFT IN PLACE: MERGE_HEAD, conflicted index,
        // markers in the worktree; the branch tip has not moved.
        assert_eq!(repo.state(), git2::RepositoryState::Merge);
        assert!(repo.index().unwrap().has_conflicts());
        assert!(std::fs::read_to_string(p.join("a.txt"))
            .unwrap()
            .contains("<<<<<<<"));
        assert_eq!(head(&repo).to_string(), pre, "branch tip unchanged");
        // The backup is KEPT — the op is still in flight, not abandoned.
        assert!(list_backups(&repo).unwrap().iter().any(|b| b.op == "merge"));
        // And the pause is probeable.
        let probed = crate::resolve::conflict_state(p.into()).unwrap().unwrap();
        assert_eq!(probed.sha, feature_tip);
    }

    #[test]
    fn reset_mixed_and_hard_move_the_branch() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        let c1 = commit(p, "a.txt", "1");
        let _c2 = commit(p, "a.txt", "2");

        reset(p.into(), c1.clone(), "hard".into()).unwrap();
        assert_eq!(head(&repo).to_string(), c1, "branch reset to c1");
        assert_eq!(std::fs::read_to_string(p.join("a.txt")).unwrap(), "1");
        assert!(list_backups(&repo).unwrap().iter().any(|b| b.op == "reset"));
    }

    // `cherry_pick_applies_a_commit` lived here; it is superseded by
    // `tests/matrix.rs::cherry_pick_head_target_*`, which asserts the same
    // "picked file lands in the working tree" plus the appended commit's
    // parent and message, the exact set of refs moved, the `cherry-pick`
    // backup, and the undo round-trip.

    #[test]
    fn revert_undoes_a_commit() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "a.txt", "base");
        let bad = commit(p, "b.txt", "added");
        assert!(p.join("b.txt").exists());

        revert(p.into(), bad).unwrap();
        assert!(!p.join("b.txt").exists(), "revert removed the added file");
        let _ = &repo;
    }

    #[test]
    fn reword_changes_the_head_message() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "a.txt", "1");
        let sha = head(&repo).to_string();

        reword(p.into(), sha, "a much better message".into()).unwrap();
        let msg = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(msg.summary().unwrap(), "a much better message");
    }
}
