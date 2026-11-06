//! Pausable conflict resolution for merge and the rebase engine.
//!
//! Historically every history-rewriting op that hit a genuine content
//! conflict aborted back to its pre-op state and returned
//! [`crate::error::AdgitterError::Conflict`] — no half-applied state was ever
//! left on disk (see the module docs on `history.rs`/`rebase.rs`). This module
//! replaces that abort-on-conflict behaviour for `merge` and the whole
//! rebase-engine family (`rebase`, `rebase_onto`, `rebase_branch`,
//! `drop_commit`, `squash_range`, and `reword` of an older commit): instead of
//! aborting, the op **pauses** — the conflicted index and worktree are left in
//! place exactly as libgit2 wrote them, and enough state is persisted to
//! `<repo>/.git/adgitter-resolve.json` that the pause survives an app
//! restart. The frontend probes it with [`conflict_state`], and once the user
//! has staged every resolution, finishes it with [`continue_op`] (which may
//! re-pause on a LATER conflicting step) or throws it away with [`abort_op`].
//!
//! # Why a real (materialized) conflict for rebase, not just an in-memory one
//! `rebase.rs`'s replay engine builds its whole chain as detached, in-memory
//! commits — no ref/worktree writes — precisely so a conflict can be detected
//! without touching disk. A pause inverts that: the user needs an actual
//! conflicted index and worktree (with `<<<<<<<` markers) to resolve in their
//! editor, exactly like `git rebase` leaves behind. So [`materialize_pause`]
//! detaches HEAD at the partial chain's tip and runs a REAL
//! `repo.cherrypick(...)` of the same commit that just failed in-memory. This
//! is the same three-way merge (`cherrypick_commit`'s in-memory version merges
//! the identical base/ours/theirs trees), so it is expected to reproduce the
//! identical conflict — this module asserts that rather than silently trusting
//! it, and surfaces a clear internal error in the (should-be-impossible) case
//! it doesn't, rather than persisting a pause that doesn't match reality.
//!
//! # Meld-on-continue
//! A `Squash`/`Fixup` step that paused mid-meld is finished the same way a
//! fresh one would have been: [`crate::rebase::finish_step`] is the single
//! place that builds a step's commit from a conflict-free tree, shared by the
//! first pass (`apply_step`, tree from an in-memory cherry-pick) and a resume
//! (this module, tree from the user's staged index) — so "author kept from
//! the running head, committer freshly stamped, message per the meld rule" is
//! identical whichever path built the tree.

use std::collections::HashMap;
use std::path::PathBuf;

use git2::{build::CheckoutBuilder, CherrypickOptions, Oid, Repository, RepositoryState};
use serde::{Deserialize, Serialize};

use crate::error::{AdgitterError, AdgitterResult};
use crate::git::open_repo;
use crate::history::{abort_to, drop_backup, resolve_commit, signature};
use crate::mutate::{lock_mutations, Backup};
use crate::rebase::{finish_step, run_replay, RebaseStep, ReplayCursor, ReplayRun};
use crate::remap::{remap_descendants, RemapOutcome};

/// Name of the paused-state file, written inside `.git/` (never the
/// worktree) so it never shows up as an untracked file and survives exactly
/// as long as the repository itself.
const PAUSED_FILE: &str = "adgitter-resolve.json";

/// Everything needed to resume — or abandon — a paused conflict, persisted as
/// pretty JSON to `.git/adgitter-resolve.json` (see [`write_paused`]).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum PausedOp {
    /// A `merge` that hit a content conflict. `theirs`/`theirs_label` let
    /// [`continue_op`] build the exact same merge commit `history::merge`
    /// would have on success (same parents, same `"Merge {label}"` message).
    Merge {
        /// Backup label (`"merge"`).
        op: String,
        /// FULL ref name of the branch the merge was applied to.
        branch: String,
        /// The branch's tip before the merge started (`ours`).
        pre_tip: String,
        /// The backup ref `history::merge` already created — kept, not
        /// dropped, so undo bookkeeping still works once this resolves.
        backup: Backup,
        /// The commit that failed to apply (equals `theirs` for a merge —
        /// there is only ever one).
        conflict_sha: String,
        /// The incoming commit being merged in.
        theirs: String,
        /// The original `source` argument `history::merge` was called with
        /// (a branch/rev name), reused verbatim for the `"Merge {label}"`
        /// commit message on continue.
        theirs_label: String,
    },
    /// A rebase-engine run (`rebase`/`rebase_onto`/`rebase_branch`/
    /// `drop_commit`/`squash_range`/`reword`-of-an-older-commit) that hit a
    /// content conflict partway through its plan.
    Rebase {
        /// Backup label (`"rebase"` or `"squash"` — whatever `execute`'s
        /// caller passed as `op`).
        op: String,
        /// FULL ref name of the branch being rewritten. Never moved until
        /// the WHOLE plan finishes — a pause leaves it exactly where it was.
        branch: String,
        /// The branch's tip before this run started.
        pre_tip: String,
        /// The backup ref `execute` already created — kept, not dropped.
        backup: Backup,
        /// The commit that failed to apply (`current_step.commit`).
        conflict_sha: String,
        /// The original `onto` target, resolved to an oid at the start of
        /// the run (stays valid across a detached HEAD; the original rev
        /// string, e.g. `"HEAD"`, would not).
        onto: String,
        /// The partial chain's tip — HEAD is detached here while paused.
        head: String,
        /// Old oids currently folded into `head` (squash/fixup chain state).
        head_group: Vec<String>,
        /// Old->new oid map accumulated so far (everything before the
        /// paused step).
        rewritten: Vec<(String, String)>,
        /// The step that conflicted — resolved by [`continue_op`] from the
        /// user's staged index.
        current_step: RebaseStep,
        /// Steps still queued behind `current_step`, oldest-first.
        remaining_steps: Vec<RebaseStep>,
        /// The wrapper's original branch (SHORT name, `refs/heads/`
        /// stripped) to restore once the WHOLE plan finishes, when this
        /// rebase was started by [`crate::rebase::rebase_branch`] on a
        /// branch other than the one checked out at the time. `None` for a
        /// same-branch rebase (`rebase`, `rebase_onto`, `drop_commit`,
        /// `squash_range`, `reword`) or a `rebase_branch` call that targeted
        /// the already-checked-out branch — those never move HEAD away from
        /// `branch` in the first place. [`materialize_pause`] always writes
        /// `None` here (it has no knowledge of an outer wrapper);
        /// `rebase_branch` patches it onto the just-written pause via
        /// [`PausedOp::set_rebase_restore`] before returning the conflict to
        /// its caller. `#[serde(default)]` so a pause file written by a
        /// build predating this field still parses instead of being
        /// silently discarded by [`read_paused`].
        #[serde(default, skip_serializing_if = "Option::is_none")]
        restore_branch: Option<String>,
        /// Whether an autostash is parked for this run — either
        /// `rebase_branch`'s (it stashed the wrapper's original dirty worktree
        /// before switching branches) or `rebase::execute`'s own same-branch
        /// one (`autostash.rs`; a pause must keep it, since popping onto the
        /// materialized conflict would destroy what the user has to resolve).
        /// When true, [`continue_op`] (on full completion) and [`abort_op`]
        /// pop it — after checking `restore_branch` back out if there is one.
        /// Independent of `restore_branch`: a same-branch rewrite stashes with
        /// nothing to check back out. `#[serde(default)]` for the same
        /// forward-compat reason as `restore_branch`.
        #[serde(default)]
        restore_stashed: bool,
    },
}

impl PausedOp {
    fn op(&self) -> &str {
        match self {
            Self::Merge { op, .. } | Self::Rebase { op, .. } => op,
        }
    }

    fn branch(&self) -> &str {
        match self {
            Self::Merge { branch, .. } | Self::Rebase { branch, .. } => branch,
        }
    }

    fn conflict_sha(&self) -> &str {
        match self {
            Self::Merge { conflict_sha, .. } | Self::Rebase { conflict_sha, .. } => conflict_sha,
        }
    }

    fn backup(&self) -> &Backup {
        match self {
            Self::Merge { backup, .. } | Self::Rebase { backup, .. } => backup,
        }
    }

    /// Record the calling wrapper's original branch (and whether it
    /// autostashed) onto an already-materialized `Rebase` pause, so
    /// [`continue_op`]/[`abort_op`] can restore them once resolved. See
    /// `restore_branch`'s doc comment for why this exists as a post-write
    /// patch rather than a [`materialize_pause`] parameter. No-op on
    /// `Merge` (a merge pause never moves HEAD off the branch it started
    /// on, so there is nothing to restore).
    pub(crate) fn set_rebase_restore(&mut self, restore_branch: Option<String>, stashed: bool) {
        if let Self::Rebase {
            restore_branch: rb,
            restore_stashed: rs,
            ..
        } = self
        {
            *rb = restore_branch;
            // OR, never overwrite: `rebase::execute` may already have recorded
            // its own same-branch autostash here. In practice the two can't
            // co-occur (an outer `rebase_branch` stash leaves a clean tree, so
            // the inner one finds nothing to stash), but losing a `true` here
            // would strand the user's changes in a stash nobody pops.
            *rs = *rs || stashed;
        }
    }
}

/// Wire shape for the frontend: what op paused, which branch, and which
/// commit failed to apply. Serialized camelCase — `{ op, branch, sha }`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveState {
    /// Backup label: `"merge"` | `"rebase"` | `"squash"` | `"reword"`.
    pub op: String,
    /// SHORT branch name (`refs/heads/` stripped) for display.
    pub branch: String,
    /// The commit being applied when the conflict hit.
    pub sha: String,
}

fn to_dto(paused: &PausedOp) -> ResolveState {
    let branch = paused.branch();
    ResolveState {
        op: paused.op().to_string(),
        branch: branch
            .strip_prefix("refs/heads/")
            .unwrap_or(branch)
            .to_string(),
        sha: paused.conflict_sha().to_string(),
    }
}

/// Tagged result every history-rewriting IPC command now returns instead of
/// erroring on conflict. Serialized as `{ "status": "completed", "outcome":
/// {...} }` or `{ "status": "conflict", "state": {...} }`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum HistoryOpResult {
    Completed { outcome: RemapOutcome },
    Conflict { state: ResolveState },
}

impl HistoryOpResult {
    pub(crate) fn completed(outcome: RemapOutcome) -> Self {
        Self::Completed { outcome }
    }

    pub(crate) fn conflict(paused: &PausedOp) -> Self {
        Self::Conflict {
            state: to_dto(paused),
        }
    }

    /// Test convenience: unwrap the `Completed` outcome, panicking (with the
    /// conflict state) if the op paused instead.
    #[cfg(test)]
    pub(crate) fn unwrap_completed(self) -> RemapOutcome {
        match self {
            Self::Completed { outcome } => outcome,
            Self::Conflict { state } => panic!("expected Completed, got Conflict: {state:?}"),
        }
    }

    /// Test convenience: unwrap the `Conflict` state, panicking if the op
    /// completed instead.
    #[cfg(test)]
    pub(crate) fn unwrap_conflict(self) -> ResolveState {
        match self {
            Self::Conflict { state } => state,
            Self::Completed { outcome } => panic!("expected Conflict, got Completed: {outcome:?}"),
        }
    }
}

fn paused_path(repo: &Repository) -> PathBuf {
    repo.path().join(PAUSED_FILE)
}

/// Persist `paused` to `.git/adgitter-resolve.json`.
pub(crate) fn write_paused(repo: &Repository, paused: &PausedOp) -> AdgitterResult<()> {
    let json = serde_json::to_string_pretty(paused).map_err(|e| {
        AdgitterError::Internal(format!("failed to serialize paused resolve state: {e}"))
    })?;
    std::fs::write(paused_path(repo), json)?;
    Ok(())
}

/// Delete the paused-state file, if any. Best-effort — a missing file is not
/// an error.
pub(crate) fn clear_paused(repo: &Repository) {
    let _ = std::fs::remove_file(paused_path(repo));
}

/// Read back a paused state, validating it is still plausible. Returns `None`
/// (deleting the file) when: it doesn't exist, fails to parse, is a `Merge`
/// pause but the repo's `state()` is already `Clean` (the user resolved and
/// finished — or aborted — outside the app), or is a `Rebase` pause but HEAD
/// is no longer detached (materializing a pause always detaches HEAD, so a
/// re-attached HEAD means the pause was already resolved externally).
pub(crate) fn read_paused(repo: &Repository) -> Option<PausedOp> {
    let contents = std::fs::read_to_string(paused_path(repo)).ok()?;
    let paused: PausedOp = match serde_json::from_str(&contents) {
        Ok(p) => p,
        Err(_) => {
            clear_paused(repo);
            return None;
        }
    };
    let stale = match &paused {
        PausedOp::Merge { .. } => repo.state() == RepositoryState::Clean,
        PausedOp::Rebase { .. } => !repo.head_detached().unwrap_or(false),
    };
    if stale {
        clear_paused(repo);
        return None;
    }
    Some(paused)
}

/// Error out with a clear message if an operation is already paused. Called
/// at the top of every history-rewriting entry point (`merge`, the
/// rebase-engine family via `rebase::execute`, `purge_path`,
/// `add_file_to_commit`, `undo_last`) so a second mutation can't run — or
/// silently clobber the paused index/worktree — while one is waiting for
/// resolution.
pub(crate) fn ensure_not_paused(repo: &Repository) -> AdgitterResult<()> {
    if read_paused(repo).is_some() {
        return Err(AdgitterError::Internal(
            "an operation is waiting for conflict resolution".into(),
        ));
    }
    Ok(())
}

/// Probe whether `repo_path` has a paused conflict resolution waiting, for
/// the frontend to poll on load/focus (and after an app restart).
pub fn conflict_state(repo_path: PathBuf) -> AdgitterResult<Option<ResolveState>> {
    let repo = open_repo(&repo_path)?;
    Ok(read_paused(&repo).as_ref().map(to_dto))
}

/// Materialize a rebase-engine pause: detach HEAD at the partial chain's tip,
/// force-checkout it, then run a REAL `repo.cherrypick` of the step that just
/// failed in-memory so the index/worktree carry the same conflict a `git
/// rebase` would leave — and persist everything needed to resume. See this
/// module's doc comment for why a real cherry-pick is required and why it is
/// expected to reproduce the identical conflict.
#[allow(clippy::too_many_arguments)]
pub(crate) fn materialize_pause(
    repo: &Repository,
    branch: &str,
    pre_tip: Oid,
    onto: &str,
    backup: &Backup,
    op: &str,
    cursor: ReplayCursor<'_>,
    current_step: RebaseStep,
    remaining_steps: Vec<RebaseStep>,
) -> AdgitterResult<HistoryOpResult> {
    let head_id = cursor.head.id();
    repo.set_head_detached(head_id)?;
    let mut checkout_head = CheckoutBuilder::new();
    checkout_head.force();
    repo.checkout_head(Some(&mut checkout_head))?;

    let conflicting = resolve_commit(repo, &current_step.commit)?;
    let mut cherrypick_checkout = CheckoutBuilder::new();
    cherrypick_checkout.force();
    let mut opts = CherrypickOptions::new();
    opts.checkout_builder(cherrypick_checkout);
    repo.cherrypick(&conflicting, Some(&mut opts))?;

    if !repo.index()?.has_conflicts() {
        // The in-memory cherry-pick (`cherrypick_commit`) that triggered this
        // pause conflicted against the exact same base/ours/theirs trees this
        // real `repo.cherrypick` just merged — this should be unreachable.
        // Surface a clear error rather than silently persisting a pause that
        // doesn't match the actual repo state.
        return Err(AdgitterError::Internal(
            "conflict vanished while materializing the paused state — this is a bug".into(),
        ));
    }

    let paused = PausedOp::Rebase {
        op: op.to_string(),
        branch: branch.to_string(),
        pre_tip: pre_tip.to_string(),
        backup: backup.clone(),
        conflict_sha: conflicting.id().to_string(),
        onto: onto.to_string(),
        head: head_id.to_string(),
        head_group: cursor.head_group.iter().map(Oid::to_string).collect(),
        rewritten: cursor
            .rewritten
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
        current_step,
        remaining_steps,
        // Unknown at this layer — `rebase_branch` patches these onto the
        // just-written pause via `PausedOp::set_rebase_restore` if it
        // called through a non-current-branch wrapper. See `restore_branch`'s
        // doc comment.
        restore_branch: None,
        restore_stashed: false,
    };
    write_paused(repo, &paused)?;
    Ok(HistoryOpResult::conflict(&paused))
}

/// Finish a paused op once the user has staged every conflicted file: builds
/// the real commit(s) from the staged resolution and, for a rebase, resumes
/// replaying whatever was still queued (which may pause again on a LATER
/// conflicting step — see [`HistoryOpResult::Conflict`]).
pub fn continue_op(repo_path: PathBuf) -> AdgitterResult<HistoryOpResult> {
    let _lock = lock_mutations();
    let repo = open_repo(&repo_path)?;
    let paused = read_paused(&repo).ok_or_else(|| {
        AdgitterError::Internal("no operation is waiting for conflict resolution".into())
    })?;
    if repo.index()?.has_conflicts() {
        return Err(AdgitterError::Internal(
            "unresolved conflicts remain — stage every conflicted file first".into(),
        ));
    }

    match paused {
        PausedOp::Merge {
            pre_tip,
            backup,
            theirs,
            theirs_label,
            ..
        } => continue_merge(&repo, &pre_tip, &backup, &theirs, &theirs_label),
        PausedOp::Rebase {
            op,
            branch,
            pre_tip,
            backup,
            onto,
            head,
            head_group,
            rewritten,
            current_step,
            remaining_steps,
            restore_branch,
            restore_stashed,
            ..
        } => continue_rebase(
            &repo,
            &op,
            &branch,
            &pre_tip,
            &backup,
            &onto,
            &head,
            &head_group,
            &rewritten,
            &current_step,
            remaining_steps,
            restore_branch,
            restore_stashed,
        ),
    }
}

/// The merge's branch is still checked out (a merge pause never moves HEAD),
/// so committing via `"HEAD"` lands the merge commit on it directly.
fn continue_merge(
    repo: &Repository,
    pre_tip: &str,
    backup: &Backup,
    theirs: &str,
    theirs_label: &str,
) -> AdgitterResult<HistoryOpResult> {
    let ours = repo.find_commit(Oid::from_str(pre_tip)?)?;
    let theirs_commit = repo.find_commit(Oid::from_str(theirs)?)?;
    let sig = signature(repo)?;
    let tree = repo.find_tree(repo.index()?.write_tree()?)?;
    repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        &format!("Merge {theirs_label}"),
        &tree,
        &[&ours, &theirs_commit],
    )?;
    repo.cleanup_state()?;
    clear_paused(repo);
    // The op only lands here — the pause kept its backup, so this is the first
    // point at which "where the app left the branch" is known.
    crate::undo::seal(repo, backup)?;
    // A merge never remaps descendant branches (matches `history::merge`'s
    // success path).
    Ok(HistoryOpResult::completed(RemapOutcome::default()))
}

#[allow(clippy::too_many_arguments)]
fn continue_rebase(
    repo: &Repository,
    op: &str,
    branch: &str,
    pre_tip: &str,
    backup: &Backup,
    onto: &str,
    head: &str,
    head_group: &[String],
    rewritten: &[(String, String)],
    current_step: &RebaseStep,
    remaining_steps: Vec<RebaseStep>,
    restore_branch: Option<String>,
    restore_stashed: bool,
) -> AdgitterResult<HistoryOpResult> {
    let head_commit = repo.find_commit(Oid::from_str(head)?)?;
    let head_group_oids: Vec<Oid> = head_group
        .iter()
        .map(|s| Oid::from_str(s).map_err(AdgitterError::from))
        .collect::<AdgitterResult<_>>()?;
    let rewritten_map: HashMap<Oid, Oid> = rewritten
        .iter()
        .map(|(a, b)| Ok::<_, AdgitterError>((Oid::from_str(a)?, Oid::from_str(b)?)))
        .collect::<AdgitterResult<_>>()?;

    let mut cursor = ReplayCursor {
        head: head_commit,
        // A paused step is always Pick/Reword/Squash/Fixup (Drop can never
        // conflict), and Squash/Fixup can only be reached after a preceding
        // Pick already ran — so resuming always has a real prior pick.
        picked_any: true,
        rewritten: rewritten_map,
        head_group: head_group_oids,
    };
    let committer = signature(repo)?;
    let commit = resolve_commit(repo, &current_step.commit)?;
    let tree = repo.find_tree(repo.index()?.write_tree()?)?;
    finish_step(repo, &mut cursor, &committer, current_step, &commit, tree)?;
    // Clears CHERRY_PICK_HEAD (and any other partial-op markers) now that the
    // step's commit is built — mirrors every other rewrite op's cleanup.
    repo.cleanup_state()?;

    let replay = run_replay(repo, cursor, &remaining_steps)?;
    let result = match replay {
        ReplayRun::Completed(new_head, rewritten_final) => {
            let mut reference = repo.find_reference(branch)?;
            reference.set_target(new_head, "rebase")?;
            repo.set_head(branch)?;
            let mut co = CheckoutBuilder::new();
            co.force();
            repo.checkout_head(Some(&mut co))?;
            clear_paused(repo);
            let outcome = remap_descendants(repo, &rewritten_final, branch, op, backup);
            // Same as `continue_merge`: a resumed rebase only reaches its final
            // ref positions here, so this is where the batch gets sealed.
            crate::undo::seal(repo, backup)?;
            // The WHOLE plan just finished — if this rebase was started by
            // `rebase_branch` on a branch other than the one checked out at
            // the time, restore that original branch (and pop its
            // autostash) now, exactly like `rebase_branch`'s own
            // uninterrupted success path does. See `restore_branch`'s doc
            // comment on `PausedOp::Rebase`.
            if let Some(orig) = restore_branch {
                let full = format!("refs/heads/{orig}");
                repo.set_head(&full)?;
                let mut co = CheckoutBuilder::new();
                co.force();
                repo.checkout_head(Some(&mut co))?;
            }
            // Pop whatever autostash this run parked — `rebase_branch`'s (only
            // now that its original branch is back) or `rebase::execute`'s
            // same-branch one, which has no branch to restore first.
            // `autostash::pop` uses a second handle because `Repository::
            // stash_pop` needs `&mut self` while `repo` here still carries
            // borrows from the replay.
            if restore_stashed {
                crate::autostash::pop(repo)?;
            }
            Ok(HistoryOpResult::completed(outcome))
        }
        ReplayRun::Paused {
            cursor,
            current_step,
            remaining_steps,
        } => {
            let result = materialize_pause(
                repo,
                branch,
                Oid::from_str(pre_tip)?,
                onto,
                backup,
                op,
                cursor,
                current_step,
                remaining_steps,
            )?;
            // Re-paused on a LATER step: `materialize_pause` always writes
            // fresh `restore_branch: None`/`restore_stashed: false` (it has
            // no knowledge of an outer wrapper) — carry this run's restore
            // bookkeeping forward onto the new pause so it isn't lost.
            if restore_branch.is_some() || restore_stashed {
                if let Some(mut p) = read_paused(repo) {
                    p.set_rebase_restore(restore_branch, restore_stashed);
                    write_paused(repo, &p)?;
                }
            }
            Ok(result)
        }
    };
    result
}

/// Abandon a paused op: restore the pre-op state exactly like today's
/// abort-on-conflict behaviour did, and drop the backup (nothing to undo — a
/// discarded pause never happened as far as the reflog-undo stack is
/// concerned).
pub fn abort_op(repo_path: PathBuf) -> AdgitterResult<()> {
    let _lock = lock_mutations();
    let repo = open_repo(&repo_path)?;
    let paused = read_paused(&repo).ok_or_else(|| {
        AdgitterError::Internal("no operation is waiting for conflict resolution".into())
    })?;
    repo.cleanup_state()?;
    match &paused {
        PausedOp::Merge { pre_tip, .. } => {
            abort_to(&repo, Oid::from_str(pre_tip)?)?;
        }
        PausedOp::Rebase {
            branch,
            restore_branch,
            restore_stashed,
            ..
        } => {
            // The branch ref was never moved (materialize_pause only
            // detaches HEAD), so simply pointing HEAD back at it and
            // checking it out restores the pre-op state exactly.
            repo.set_head(branch)?;
            let mut co = CheckoutBuilder::new();
            co.force();
            repo.checkout_head(Some(&mut co))?;
            // If this rebase was started by `rebase_branch` on a branch
            // other than the one checked out at the time, finish undoing
            // its checkout/autostash dance too — see `restore_branch`'s doc
            // comment on `PausedOp::Rebase`.
            if let Some(orig) = restore_branch {
                let full = format!("refs/heads/{orig}");
                repo.set_head(&full)?;
                let mut co = CheckoutBuilder::new();
                co.force();
                repo.checkout_head(Some(&mut co))?;
            }
            // …then restore the autostash, whoever parked it — see the
            // matching comment in `continue_rebase`.
            if *restore_stashed {
                crate::autostash::pop(&repo)?;
            }
        }
    }
    drop_backup(&repo, paused.backup());
    clear_paused(&repo);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::branch::{checkout, create_branch};
    use crate::history::merge;
    use crate::mutate::{list_backups, undo_last};
    use crate::rebase::{rebase_onto, RebaseAction};
    use crate::workdir;
    use git2::{BranchType, Repository};
    use std::path::Path;

    fn init_repo(dir: &Path) -> Repository {
        let repo = Repository::init(dir).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Tester").unwrap();
        cfg.set_str("user.email", "t@example.com").unwrap();
        repo
    }

    /// The frontend is built against these EXACT serialized shapes — lock
    /// them down independently of any repo behaviour.
    #[test]
    fn wire_shapes_match_the_ipc_contract() {
        let completed = HistoryOpResult::completed(RemapOutcome::default());
        assert_eq!(
            serde_json::to_value(&completed).unwrap(),
            serde_json::json!({
                "status": "completed",
                "outcome": { "remapped": [], "skipped": [] }
            })
        );
        let conflict = HistoryOpResult::Conflict {
            state: ResolveState {
                op: "merge".into(),
                branch: "main".into(),
                sha: "abc123".into(),
            },
        };
        assert_eq!(
            serde_json::to_value(&conflict).unwrap(),
            serde_json::json!({
                "status": "conflict",
                "state": { "op": "merge", "branch": "main", "sha": "abc123" }
            })
        );
    }

    /// Commit `content` to `name` on HEAD via the crate's own ops; return sha.
    fn commit(dir: &Path, name: &str, content: &str) -> String {
        std::fs::write(dir.join(name), content).unwrap();
        workdir::stage(dir.to_path_buf(), vec![name.to_string()]).unwrap();
        workdir::commit(dir.to_path_buf(), format!("add {name}"), false).unwrap()
    }

    /// Resolve a conflicted `name` by writing `content` and staging it (the
    /// staging collapses the conflict's stage-1/2/3 entries to stage 0).
    fn resolve_file(dir: &Path, name: &str, content: &str) {
        std::fs::write(dir.join(name), content).unwrap();
        workdir::stage(dir.to_path_buf(), vec![name.to_string()]).unwrap();
    }

    fn tip(repo: &Repository, branch: &str) -> git2::Oid {
        repo.find_branch(branch, BranchType::Local)
            .unwrap()
            .get()
            .target()
            .unwrap()
    }

    fn file_at_tip(repo: &Repository, branch: &str, name: &str) -> String {
        let tree = repo.find_commit(tip(repo, branch)).unwrap().tree().unwrap();
        let blob = tree
            .get_path(Path::new(name))
            .unwrap()
            .to_object(repo)
            .unwrap();
        String::from_utf8(blob.as_blob().unwrap().content().to_vec()).unwrap()
    }

    /// base -> main edits a.txt; feature edits the same lines. Merging
    /// feature into main conflicts. Returns (main, feature_tip, pre_tip).
    fn merge_conflict_fixture(p: &Path, repo: &Repository) -> (String, String, String) {
        commit(p, "a.txt", "base\n");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();
        create_branch(p.into(), "feature".into(), "HEAD".into()).unwrap();
        checkout(p.into(), "feature".into()).unwrap();
        let feature_tip = commit(p, "a.txt", "feature\n");
        checkout(p.into(), main.clone()).unwrap();
        let pre = commit(p, "a.txt", "main\n");
        let state = merge(p.into(), "feature".into()).unwrap().unwrap_conflict();
        assert_eq!(state.sha, feature_tip);
        (main, feature_tip, pre)
    }

    #[test]
    fn merge_pause_reports_conflicted_status_entries_exclusively() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        let _ = merge_conflict_fixture(p, &repo);

        let st = workdir::status(p.into()).unwrap();
        assert!(
            st.conflicted
                .iter()
                .any(|e| e.path == "a.txt" && e.status == "conflicted"),
            "conflicted file reported in the conflicted group"
        );
        assert!(!st.staged.iter().any(|e| e.path == "a.txt"));
        assert!(!st.changed.iter().any(|e| e.path == "a.txt"));
        assert!(!st.untracked.iter().any(|e| e.path == "a.txt"));
    }

    #[test]
    fn merge_continue_after_staging_builds_the_merge_commit_and_undo_restores() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        let (main, feature_tip, pre) = merge_conflict_fixture(p, &repo);

        resolve_file(p, "a.txt", "resolved\n");
        let outcome = continue_op(p.into()).unwrap().unwrap_completed();
        assert_eq!(outcome, RemapOutcome::default(), "merge never remaps");

        let merge_commit = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(merge_commit.parent_count(), 2);
        assert_eq!(merge_commit.parent_id(0).unwrap().to_string(), pre);
        assert_eq!(merge_commit.parent_id(1).unwrap().to_string(), feature_tip);
        assert_eq!(
            merge_commit.summary().unwrap(),
            "Merge feature",
            "same message convention as a clean merge"
        );
        assert_eq!(file_at_tip(&repo, &main, "a.txt"), "resolved\n");
        assert_eq!(repo.state(), RepositoryState::Clean);
        assert!(conflict_state(p.into()).unwrap().is_none());
        assert!(!repo.path().join(PAUSED_FILE).exists());

        // The kept backup makes the whole merge undoable.
        let restored = undo_last(p.into()).unwrap().expect("a merge backup");
        assert_eq!(restored.op, "merge");
        assert_eq!(
            repo.head().unwrap().target().unwrap().to_string(),
            pre,
            "undo restores the pre-merge tip"
        );
    }

    #[test]
    fn merge_abort_restores_pre_op_state_completely() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        let (_main, _feature_tip, pre) = merge_conflict_fixture(p, &repo);

        abort_op(p.into()).unwrap();

        assert_eq!(repo.head().unwrap().target().unwrap().to_string(), pre);
        assert_eq!(std::fs::read_to_string(p.join("a.txt")).unwrap(), "main\n");
        assert_eq!(repo.state(), RepositoryState::Clean);
        assert!(!repo.index().unwrap().has_conflicts());
        assert!(list_backups(&repo).unwrap().is_empty(), "no orphan backup");
        assert!(conflict_state(p.into()).unwrap().is_none());
    }

    /// base -> feature(f1 clean, f2 conflicting, f3 clean); main edits the
    /// same lines f2 does. Rebasing feature onto main pauses at f2. Returns
    /// (main_tip, f2, feature_pre_tip).
    fn rebase_conflict_fixture(p: &Path, repo: &Repository) -> (String, String, String) {
        commit(p, "shared.txt", "base\n");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();
        create_branch(p.into(), "feature".into(), "HEAD".into()).unwrap();
        checkout(p.into(), "feature".into()).unwrap();
        commit(p, "extra.txt", "one\n"); // f1 — applies cleanly
        let f2 = commit(p, "shared.txt", "feature\n"); // f2 — conflicts
        let f3 = commit(p, "later.txt", "three\n"); // f3 — applies cleanly
        checkout(p.into(), main.clone()).unwrap();
        let main_tip = commit(p, "shared.txt", "main\n");
        checkout(p.into(), "feature".into()).unwrap();

        let state = rebase_onto(p.into(), main).unwrap().unwrap_conflict();
        assert_eq!(state.op, "rebase");
        assert_eq!(state.branch, "feature");
        assert_eq!(state.sha, f2);
        (main_tip, f2, f3)
    }

    #[test]
    fn rebase_pause_sits_detached_on_the_partial_chain_mid_range() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        let (main_tip, _f2, feature_pre) = rebase_conflict_fixture(p, &repo);

        // Detached at f1' (one commit past onto), cherry-pick conflict live.
        assert!(repo.head_detached().unwrap());
        let detached = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(detached.parent_id(0).unwrap().to_string(), main_tip);
        assert!(detached
            .tree()
            .unwrap()
            .get_path(Path::new("extra.txt"))
            .is_ok());
        assert_eq!(repo.state(), RepositoryState::CherryPick);
        assert!(repo.index().unwrap().has_conflicts());
        assert!(p.join("extra.txt").exists(), "partial chain checked out");
        assert_eq!(
            tip(&repo, "feature").to_string(),
            feature_pre,
            "branch ref unmoved"
        );
    }

    #[test]
    fn rebase_continue_resumes_and_finishes_the_plan() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        let (main_tip, _f2, _f3) = rebase_conflict_fixture(p, &repo);

        resolve_file(p, "shared.txt", "resolved\n");
        let outcome = continue_op(p.into()).unwrap().unwrap_completed();
        assert!(outcome.remapped.is_empty() && outcome.skipped.is_empty());

        // Back on feature; the full chain: main_tip <- f1' <- f2' <- f3'.
        assert!(!repo.head_detached().unwrap());
        assert_eq!(repo.head().unwrap().shorthand().unwrap(), "feature");
        let new_tip = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(new_tip.summary().unwrap(), "add later.txt");
        let f2_new = new_tip.parent(0).unwrap();
        assert_eq!(f2_new.summary().unwrap(), "add shared.txt");
        let f1_new = f2_new.parent(0).unwrap();
        assert_eq!(f1_new.summary().unwrap(), "add extra.txt");
        assert_eq!(f1_new.parent_id(0).unwrap().to_string(), main_tip);

        // The conflicted commit carries the staged resolution; later commits
        // replayed on top; worktree synced and clean.
        assert_eq!(file_at_tip(&repo, "feature", "shared.txt"), "resolved\n");
        assert!(p.join("later.txt").exists() && p.join("extra.txt").exists());
        assert_eq!(repo.state(), RepositoryState::Clean);
        assert!(conflict_state(p.into()).unwrap().is_none());
    }

    #[test]
    fn rebase_continue_remaps_pre_and_post_pause_forks_and_undo_restores_all() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "shared.txt", "base\n");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();
        create_branch(p.into(), "feature".into(), "HEAD".into()).unwrap();
        checkout(p.into(), "feature".into()).unwrap();
        let f1 = commit(p, "extra.txt", "one\n");
        let f2 = commit(p, "shared.txt", "feature\n");
        let f3 = commit(p, "later.txt", "three\n");

        // fork1 splits off f1 (BEFORE the pause point), fork2 off f3 (AFTER).
        create_branch(p.into(), "fork1".into(), f1.clone()).unwrap();
        checkout(p.into(), "fork1".into()).unwrap();
        commit(p, "fk1.txt", "fk1\n");
        let old_fork1 = tip(&repo, "fork1");
        create_branch(p.into(), "fork2".into(), f3.clone()).unwrap();
        checkout(p.into(), "fork2".into()).unwrap();
        commit(p, "fk2.txt", "fk2\n");
        let old_fork2 = tip(&repo, "fork2");

        checkout(p.into(), main.clone()).unwrap();
        commit(p, "shared.txt", "main\n");
        checkout(p.into(), "feature".into()).unwrap();
        let old_feature = tip(&repo, "feature");

        let state = rebase_onto(p.into(), main.clone())
            .unwrap()
            .unwrap_conflict();
        assert_eq!(state.sha, f2);
        resolve_file(p, "shared.txt", "resolved\n");
        let outcome = continue_op(p.into()).unwrap().unwrap_completed();
        assert_eq!(
            outcome.remapped,
            vec![
                "refs/heads/fork1".to_string(),
                "refs/heads/fork2".to_string()
            ],
            "the accumulated map covers pre-pause AND post-pause rewrites"
        );
        assert!(outcome.skipped.is_empty());

        // fork1's new parent is f1's replayed self (reachable from feature's
        // new chain 2 commits down); fork2 sits directly on the new tip.
        let new_feature = tip(&repo, "feature");
        let f1_new = repo
            .find_commit(new_feature)
            .unwrap()
            .parent(0)
            .unwrap()
            .parent_id(0)
            .unwrap();
        assert_eq!(
            repo.find_commit(tip(&repo, "fork1"))
                .unwrap()
                .parent_id(0)
                .unwrap(),
            f1_new
        );
        assert_eq!(
            repo.find_commit(tip(&repo, "fork2"))
                .unwrap()
                .parent_id(0)
                .unwrap(),
            new_feature
        );

        // ONE undo restores the whole batch: feature and both forks.
        undo_last(p.into()).unwrap().expect("a rebase backup");
        assert_eq!(tip(&repo, "feature"), old_feature);
        assert_eq!(tip(&repo, "fork1"), old_fork1);
        assert_eq!(tip(&repo, "fork2"), old_fork2);
    }

    #[test]
    fn rebase_with_two_conflicting_steps_pauses_twice_then_completes() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "shared.txt", "base\n");
        commit(p, "other.txt", "obase\n");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();
        create_branch(p.into(), "feature".into(), "HEAD".into()).unwrap();
        checkout(p.into(), "feature".into()).unwrap();
        let f1 = commit(p, "shared.txt", "feature-s\n");
        let f2 = commit(p, "other.txt", "feature-o\n");
        checkout(p.into(), main.clone()).unwrap();
        commit(p, "shared.txt", "main-s\n");
        commit(p, "other.txt", "main-o\n");
        checkout(p.into(), "feature".into()).unwrap();

        let state = rebase_onto(p.into(), main).unwrap().unwrap_conflict();
        assert_eq!(state.sha, f1, "first pause on the first conflicting step");

        resolve_file(p, "shared.txt", "r1\n");
        let state = continue_op(p.into()).unwrap().unwrap_conflict();
        assert_eq!(state.sha, f2, "continue pauses AGAIN on the second step");
        assert_eq!(repo.state(), RepositoryState::CherryPick);

        resolve_file(p, "other.txt", "r2\n");
        continue_op(p.into()).unwrap().unwrap_completed();
        assert_eq!(file_at_tip(&repo, "feature", "shared.txt"), "r1\n");
        assert_eq!(file_at_tip(&repo, "feature", "other.txt"), "r2\n");
        assert!(conflict_state(p.into()).unwrap().is_none());
        assert_eq!(repo.state(), RepositoryState::Clean);
    }

    #[test]
    fn rebase_abort_restores_branch_worktree_and_leaves_nothing_behind() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        let (_main_tip, _f2, feature_pre) = rebase_conflict_fixture(p, &repo);

        abort_op(p.into()).unwrap();

        assert!(!repo.head_detached().unwrap());
        assert_eq!(repo.head().unwrap().shorthand().unwrap(), "feature");
        assert_eq!(tip(&repo, "feature").to_string(), feature_pre);
        assert_eq!(
            std::fs::read_to_string(p.join("shared.txt")).unwrap(),
            "feature\n",
            "worktree restored to the original branch content"
        );
        assert_eq!(repo.state(), RepositoryState::Clean);
        assert!(!repo.index().unwrap().has_conflicts());
        assert!(!repo.path().join(PAUSED_FILE).exists());
        assert!(list_backups(&repo).unwrap().is_empty(), "no orphan backup");
    }

    #[test]
    fn continue_with_unresolved_conflicts_errors_and_keeps_the_pause() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        let (_main, feature_tip, _pre) = merge_conflict_fixture(p, &repo);

        let err = continue_op(p.into()).unwrap_err();
        match err {
            AdgitterError::Internal(msg) => {
                assert!(msg.contains("stage every conflicted file"), "{msg}")
            }
            other => panic!("expected Internal, got {other:?}"),
        }
        // Pause unchanged: still probeable, merge state still live.
        let state = conflict_state(p.into()).unwrap().expect("still paused");
        assert_eq!(state.sha, feature_tip);
        assert_eq!(repo.state(), RepositoryState::Merge);
        assert!(repo.index().unwrap().has_conflicts());
    }

    #[test]
    fn conflict_state_survives_an_app_restart() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        let (main, feature_tip, _pre) = merge_conflict_fixture(p, &repo);
        drop(repo); // "close the app"

        // A completely fresh Repository (as after a restart) still sees it.
        let state = conflict_state(p.into()).unwrap().expect("state persisted");
        assert_eq!(state.op, "merge");
        assert_eq!(state.branch, main);
        assert_eq!(state.sha, feature_tip);

        // And the resumed flow works off the persisted state alone.
        resolve_file(p, "a.txt", "resolved\n");
        continue_op(p.into()).unwrap().unwrap_completed();
        let reopened = Repository::open(p).unwrap();
        assert_eq!(
            reopened
                .head()
                .unwrap()
                .peel_to_commit()
                .unwrap()
                .parent_count(),
            2
        );
    }

    #[test]
    fn ensure_not_paused_blocks_every_other_history_op() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        let (_main, _feature_tip, pre) = merge_conflict_fixture(p, &repo);

        let expect_blocked = |r: AdgitterResult<HistoryOpResult>| match r {
            Err(AdgitterError::Internal(msg)) => {
                assert!(msg.contains("waiting for conflict resolution"), "{msg}")
            }
            other => panic!("expected the paused-op guard, got {other:?}"),
        };
        expect_blocked(merge(p.into(), "feature".into()));
        expect_blocked(crate::rebase::drop_commit(p.into(), pre.clone()));
        expect_blocked(crate::history::reword(p.into(), pre.clone(), "x".into()));

        match crate::purge::purge_path(p.into(), pre.clone(), "a.txt".into()) {
            Err(AdgitterError::Internal(msg)) => {
                assert!(msg.contains("waiting for conflict resolution"), "{msg}")
            }
            other => panic!("expected the paused-op guard, got {other:?}"),
        }
        match undo_last(p.into()) {
            Err(AdgitterError::Internal(msg)) => {
                assert!(msg.contains("waiting for conflict resolution"), "{msg}")
            }
            other => panic!("expected the paused-op guard, got {other:?}"),
        }
        // The pause itself is untouched by the rejected attempts.
        assert!(conflict_state(p.into()).unwrap().is_some());
    }

    /// A conflicting SQUASH step (op label "squash") pauses, and continue
    /// melds from the staged resolution: parents = the running head's parent,
    /// author = the running head's author, message = the squash step's.
    #[test]
    fn squash_conflict_pauses_and_continue_melds_from_the_staged_tree() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "shared.txt", "base\n");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();
        create_branch(p.into(), "side".into(), "HEAD".into()).unwrap();
        checkout(p.into(), "side".into()).unwrap();
        let s1 = commit(p, "shared.txt", "side\n");
        checkout(p.into(), main.clone()).unwrap();
        let c1 = commit(p, "a.txt", "a\n"); // picks cleanly onto side
        let c2 = commit(p, "shared.txt", "main2\n"); // squash — conflicts with side

        let steps = vec![
            RebaseStep {
                commit: c1,
                action: RebaseAction::Pick,
                message: None,
            },
            RebaseStep {
                commit: c2.clone(),
                action: RebaseAction::Squash,
                message: Some("melded".into()),
            },
        ];
        // Same core `squash_range` funnels into, with its "squash" op label.
        let state = crate::rebase::execute(&repo, &s1, &steps, "squash")
            .unwrap()
            .unwrap_conflict();
        assert_eq!(state.op, "squash");
        assert_eq!(state.sha, c2);
        assert_eq!(repo.state(), RepositoryState::CherryPick);

        resolve_file(p, "shared.txt", "resolved\n");
        continue_op(p.into()).unwrap().unwrap_completed();

        let melded = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(melded.summary().unwrap(), "melded");
        assert_eq!(
            melded.parent_id(0).unwrap().to_string(),
            s1,
            "meld re-parents onto the running head's own parent"
        );
        assert_eq!(file_at_tip(&repo, &main, "shared.txt"), "resolved\n");
        assert!(melded.tree().unwrap().get_path(Path::new("a.txt")).is_ok());
        let backups = list_backups(&repo).unwrap();
        assert_eq!(backups.len(), 1);
        assert_eq!(backups[0].op, "squash");
    }

    #[test]
    fn reword_head_amend_still_completes_and_reword_label_pauses() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "shared.txt", "base\n");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();
        let head_sha = commit(p, "a.txt", "a\n");

        // HEAD amend can't conflict — always Completed.
        let outcome = crate::history::reword(p.into(), head_sha, "amended".into())
            .unwrap()
            .unwrap_completed();
        assert!(outcome.remapped.is_empty());
        assert_eq!(
            repo.head()
                .unwrap()
                .peel_to_commit()
                .unwrap()
                .summary()
                .unwrap(),
            "amended"
        );

        // The replay path shares `execute`; a conflicting plan under the
        // "reword" label pauses and reports that label.
        create_branch(p.into(), "side".into(), "HEAD~1".into()).unwrap();
        checkout(p.into(), "side".into()).unwrap();
        let s1 = commit(p, "a.txt", "side\n");
        checkout(p.into(), main).unwrap();
        let tip_sha = repo.head().unwrap().target().unwrap().to_string();
        let steps = vec![RebaseStep {
            commit: tip_sha.clone(),
            action: RebaseAction::Reword,
            message: Some("renamed".into()),
        }];
        let state = crate::rebase::execute(&repo, &s1, &steps, "reword")
            .unwrap()
            .unwrap_conflict();
        assert_eq!(state.op, "reword");
        assert_eq!(state.sha, tip_sha);
        abort_op(p.into()).unwrap();
        assert!(conflict_state(p.into()).unwrap().is_none());
    }

    #[test]
    fn continue_and_abort_error_clearly_when_nothing_is_paused() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let _repo = init_repo(p);
        commit(p, "a.txt", "1\n");

        for err in [
            continue_op(p.into()).unwrap_err(),
            abort_op(p.into()).unwrap_err(),
        ] {
            match err {
                AdgitterError::Internal(msg) => assert!(
                    msg.contains("no operation is waiting for conflict resolution"),
                    "{msg}"
                ),
                other => panic!("expected Internal, got {other:?}"),
            }
        }
    }
}
