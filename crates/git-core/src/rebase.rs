//! Interactive-rebase engine.
//!
//! Replays a contiguous run of commits onto a new base, one step at a time,
//! honouring a **plan** of `pick` / `reword` / `squash` / `fixup` / `drop`
//! actions. Each replayed commit is cherry-picked *in memory* (no working-tree
//! churn until the end) so a conflict can be detected without leaving a
//! half-applied rebase on disk; when one IS detected, the run pauses — the
//! conflict is materialized for the user to resolve and the branch ref stays
//! untouched (see `resolve.rs`).
//!
//! Like every rewriting op (history.rs), a run holds the mutation lock and
//! snapshots the branch with a backup ref first, so it is reversible via
//! `reflog_undo`. The convenience entry points
//! (`rebase_onto`, `drop_commit`) and `history::reword` of an older commit all
//! build a plan and feed it through the same [`execute`] core.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use git2::{build::CheckoutBuilder, BranchType, Commit, Oid, Repository, Signature, Sort};
use serde::{Deserialize, Serialize};

use crate::branch::checkout;
use crate::error::{AdgitterError, AdgitterResult};
use crate::git::open_repo;
use crate::history::{abort_to, current_branch, resolve_commit, signature};
use crate::mutate::{create_backup, lock_mutations};
use crate::remap::{remap_descendants, RemapOutcome};
use crate::resolve::{
    ensure_not_paused, materialize_pause, read_paused, write_paused, HistoryOpResult, PausedOp,
};

/// What to do with one commit in a rebase plan.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RebaseAction {
    /// Keep the commit as-is.
    Pick,
    /// Keep the commit but replace its message (`RebaseStep::message`).
    Reword,
    /// Meld into the previous kept commit, combining messages.
    Squash,
    /// Meld into the previous kept commit, discarding this message.
    Fixup,
    /// Remove the commit entirely.
    Drop,
}

/// One line of a rebase plan: act on `commit` with `action`. Also `Serialize`
/// so a paused step (the one that conflicted, plus everything still queued
/// behind it) can be persisted to `adgitter-resolve.json` (`resolve.rs`) and
/// read back after an app restart.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RebaseStep {
    /// The commit this step acts on (a sha or rev).
    pub commit: String,
    /// The action to apply.
    pub action: RebaseAction,
    /// New message for `Reword`/`Squash` (ignored otherwise).
    #[serde(default)]
    pub message: Option<String>,
}

/// Commits reachable from `tip` but not from `base`, oldest-first.
fn commits_between(repo: &Repository, base: Oid, tip: Oid) -> AdgitterResult<Vec<Oid>> {
    let mut walk = repo.revwalk()?;
    walk.push(tip)?;
    walk.hide(base)?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::REVERSE)?;
    let mut out = Vec::new();
    for oid in walk {
        out.push(oid?);
    }
    Ok(out)
}

/// Build a plan over `base..tip` (oldest-first), choosing each commit's action
/// with `action_of`. Used by the convenience wrappers and `history::reword`.
pub(crate) fn pick_steps(
    repo: &Repository,
    base: Oid,
    tip: Oid,
    action_of: impl Fn(Oid) -> RebaseAction,
) -> AdgitterResult<Vec<RebaseStep>> {
    Ok(commits_between(repo, base, tip)?
        .into_iter()
        .map(|oid| RebaseStep {
            commit: oid.to_string(),
            action: action_of(oid),
            message: None,
        })
        .collect())
}

/// Mutable rebase-replay progress: the running head commit, whether a pick
/// has happened yet (squash/fixup needs one to meld into), the accumulated
/// old->new commit map, and which old oids are currently folded into `head`
/// (for squash/fixup chains — see [`ReplayRun`]'s doc comment). Shared by a
/// fresh [`execute`] run and a [`crate::resolve::continue_op`] resume so both
/// apply a step through the exact same code ([`apply_step`]/[`finish_step`]).
pub(crate) struct ReplayCursor<'r> {
    pub(crate) head: Commit<'r>,
    pub(crate) picked_any: bool,
    pub(crate) rewritten: HashMap<Oid, Oid>,
    pub(crate) head_group: Vec<Oid>,
}

/// One step's outcome: either it applied cleanly (folded into the cursor in
/// place) or it hit a genuine content conflict and the cursor was left
/// UNCHANGED (the caller still has the pre-step state to persist).
enum StepResult {
    Applied,
    Conflict,
}

/// Result of running (part of) a plan: either it ran to completion, or it
/// paused on a conflict — carrying everything needed to materialize a
/// resumable pause ([`crate::resolve::materialize_pause`]) or, on a later
/// resume, to pause again.
pub(crate) enum ReplayRun<'r> {
    /// New tip oid AND the old->new commit map for the replayed range (every
    /// step's own commit oid, mapped to wherever its content ended up):
    /// - `Pick`/`Reword` map straight to the commit just created.
    /// - `Drop` maps to the running head UNCHANGED — there is no new commit
    ///   for a dropped one, but a descendant forking off it still needs a
    ///   base to rebase onto, and that base is exactly "as if the dropped
    ///   commit had never existed", i.e. its predecessor's new self.
    /// - `Squash`/`Fixup` map both this step's own commit AND every commit
    ///   already folded into the running head to the freshly melded commit —
    ///   a descendant of any commit absorbed into a squash needs to land on
    ///   the FINAL melded result, not an intermediate one.
    ///
    /// This map is consumed by [`crate::remap::remap_descendants`].
    Completed(Oid, HashMap<Oid, Oid>),
    /// Paused before applying `current_step`: `cursor` is the state as of
    /// immediately BEFORE that step (so its `head` is the correct cherry-pick
    /// base to materialize against), and `remaining_steps` is everything
    /// still queued behind it.
    Paused {
        cursor: ReplayCursor<'r>,
        current_step: RebaseStep,
        remaining_steps: Vec<RebaseStep>,
    },
}

/// Apply ONE step to `cursor` in memory (no ref/worktree writes — a
/// cherry-pick-commit index only), returning [`StepResult::Conflict`] without
/// mutating `cursor` if it doesn't apply cleanly.
fn apply_step<'r>(
    repo: &'r Repository,
    cursor: &mut ReplayCursor<'r>,
    committer: &Signature<'static>,
    step: &RebaseStep,
) -> AdgitterResult<StepResult> {
    let commit = resolve_commit(repo, &step.commit)?;
    if step.action == RebaseAction::Drop {
        cursor.rewritten.insert(commit.id(), cursor.head.id());
        return Ok(StepResult::Applied);
    }
    if matches!(step.action, RebaseAction::Squash | RebaseAction::Fixup) && !cursor.picked_any {
        return Err(AdgitterError::Internal(
            "squash/fixup needs a preceding pick".into(),
        ));
    }
    if commit.parent_count() > 1 {
        // libgit2 would reject this itself, but as a raw `GIT_ERROR` reading
        // "mainline branch is not specified but <oid> is a merge commit" —
        // an internal concept the user never chose. Refuse up front with a
        // typed domain error instead (error.rs::MergeCommitInRange). Replaying
        // a merge would mean picking a mainline and flattening the other side,
        // which no caller of this engine has asked for.
        return Err(AdgitterError::MergeCommitInRange {
            sha: commit.id().to_string(),
        });
    }
    let mut index = repo.cherrypick_commit(&commit, &cursor.head, 0, None)?;
    if index.has_conflicts() {
        return Ok(StepResult::Conflict);
    }
    let tree = repo.find_tree(index.write_tree_to(repo)?)?;
    finish_step(repo, cursor, committer, step, &commit, tree)?;
    Ok(StepResult::Applied)
}

/// Fold an already-resolved `tree` for `step`/`commit` into `cursor`, per the
/// action's meld semantics (see [`ReplayRun::Completed`]'s doc comment).
/// Called from [`apply_step`] once a fresh cherry-pick applied cleanly, AND
/// from [`crate::resolve::continue_op`] once the USER has staged a manual
/// resolution for the step that paused — in both cases the same commit gets
/// built the same way from a conflict-free tree.
pub(crate) fn finish_step<'r>(
    repo: &'r Repository,
    cursor: &mut ReplayCursor<'r>,
    committer: &Signature<'static>,
    step: &RebaseStep,
    commit: &Commit<'r>,
    tree: git2::Tree<'r>,
) -> AdgitterResult<()> {
    let old_id = commit.id();
    match step.action {
        RebaseAction::Drop => unreachable!("Drop never reaches finish_step — no merge to resolve"),
        RebaseAction::Pick | RebaseAction::Reword => {
            let message = match step.action {
                RebaseAction::Reword => step.message.clone().ok_or_else(|| {
                    AdgitterError::Internal("reword step is missing a message".into())
                })?,
                _ => commit.message().unwrap_or("").to_string(),
            };
            let oid = repo.commit(
                None,
                &commit.author(),
                committer,
                &message,
                &tree,
                &[&cursor.head],
            )?;
            cursor.head = repo.find_commit(oid)?;
            cursor.picked_any = true;
            cursor.rewritten.insert(old_id, oid);
            cursor.head_group = vec![old_id];
        }
        RebaseAction::Squash | RebaseAction::Fixup => {
            // Meld into `cursor.head`: the combined commit replaces it,
            // re-parented onto head's own parent.
            let base_parent = cursor.head.parent(0)?;
            let message = match step.action {
                RebaseAction::Squash => step.message.clone().unwrap_or_else(|| {
                    format!(
                        "{}\n\n{}",
                        cursor.head.message().unwrap_or("").trim_end(),
                        commit.message().unwrap_or("").trim_end()
                    )
                }),
                _ => cursor.head.message().unwrap_or("").to_string(),
            };
            let oid = repo.commit(
                None,
                &cursor.head.author(),
                committer,
                &message,
                &tree,
                &[&base_parent],
            )?;
            // Re-point EVERY commit already melded into the running head
            // (kept, not drained: a further squash must move the whole group
            // again, or a fork off the first picked commit would land on a
            // dangling intermediate meld).
            for prev in &cursor.head_group {
                cursor.rewritten.insert(*prev, oid);
            }
            cursor.rewritten.insert(old_id, oid);
            cursor.head_group.push(old_id);
            cursor.head = repo.find_commit(oid)?;
        }
    }
    Ok(())
}

/// Run `steps` from `cursor`'s current state, applying each in turn until
/// either the plan completes or one conflicts. Used both for a plan's first
/// pass (fresh `cursor`, full `steps`) and to resume after the user resolves
/// a paused step (`cursor` already advanced past it, `steps` = what was still
/// queued).
pub(crate) fn run_replay<'r>(
    repo: &'r Repository,
    mut cursor: ReplayCursor<'r>,
    steps: &[RebaseStep],
) -> AdgitterResult<ReplayRun<'r>> {
    let committer = signature(repo)?;
    for (i, step) in steps.iter().enumerate() {
        match apply_step(repo, &mut cursor, &committer, step)? {
            StepResult::Applied => continue,
            StepResult::Conflict => {
                return Ok(ReplayRun::Paused {
                    cursor,
                    current_step: step.clone(),
                    remaining_steps: steps[i + 1..].to_vec(),
                });
            }
        }
    }
    Ok(ReplayRun::Completed(cursor.head.id(), cursor.rewritten))
}

/// Lock-free rebase core: snapshot the current branch, replay `steps` onto
/// `onto_rev`. On a clean run, move the branch to the new tip, sync the
/// working tree, then best-effort re-base every OTHER local branch that
/// descended from the replayed range onto the new chain (see
/// `remap::remap_descendants` — its backups join this op's batch, so one undo
/// restores everything) and return `HistoryOpResult::Completed`. On a
/// conflict, MATERIALIZE a resumable pause (`resolve::materialize_pause`) —
/// detach HEAD at the partial chain, cherry-pick the conflicting commit for
/// real so the index/worktree carry the same conflict, persist enough state
/// to resume after a restart — and return `HistoryOpResult::Conflict` instead
/// of erroring. The caller MUST already hold [`lock_mutations`]. A genuine
/// internal error (not a content conflict) still deletes the just-made backup
/// and leaves refs/worktree untouched, exactly like before.
///
/// # Uncommitted work
/// Both endings above move the working tree — the clean one force-checks-out
/// the rewritten tip, the failing one hard-resets back to `pre_tip` — and both
/// would otherwise overwrite unstaged edits to tracked files. So the run
/// autostashes them first (tracked only; see `autostash.rs` for why untracked
/// files stay put) and pops them back on the way out, whichever way it ends
/// (PRD User Story 19). A PAUSE keeps the stash instead: the paused worktree
/// carries the conflict the user must resolve, so the pop is deferred onto the
/// pause record (`PausedOp::Rebase::restore_stashed`) for
/// `continue_op`/`abort_op` to run — exactly how `rebase_branch`'s own
/// autostash already behaves while paused.
pub(crate) fn execute(
    repo: &Repository,
    onto_rev: &str,
    steps: &[RebaseStep],
    op: &str,
) -> AdgitterResult<HistoryOpResult> {
    ensure_not_paused(repo)?;
    let branch = current_branch(repo)?;
    let pre_tip = repo.head()?.peel_to_commit()?.id();
    let stashed = crate::autostash::stash_if_dirty(repo, "adgitter: rewrite autostash", false)?;
    let backup = create_backup(repo, op, &branch)?;

    let onto = resolve_commit(repo, onto_rev)?;
    let onto_id = onto.id();
    let cursor = ReplayCursor {
        head: onto,
        picked_any: false,
        rewritten: HashMap::new(),
        head_group: Vec::new(),
    };

    match run_replay(repo, cursor, steps) {
        Ok(ReplayRun::Completed(new_head, rewritten)) => {
            let mut reference = repo.find_reference(&branch)?;
            reference.set_target(new_head, "rebase")?;
            repo.set_head(&branch)?;
            let mut co = CheckoutBuilder::new();
            co.force();
            repo.checkout_head(Some(&mut co))?;
            let outcome = remap_descendants(repo, &rewritten, &branch, op, &backup);
            crate::undo::seal(repo, &backup)?;
            if stashed {
                crate::autostash::pop(repo).map_err(|e| crate::autostash::pop_failed(op, e))?;
            }
            Ok(HistoryOpResult::completed(outcome))
        }
        Ok(ReplayRun::Paused {
            cursor,
            current_step,
            remaining_steps,
        }) => {
            let paused_result = materialize_pause(
                repo,
                &branch,
                pre_tip,
                &onto_id.to_string(),
                &backup,
                op,
                cursor,
                current_step,
                remaining_steps,
            )?;
            // Hand the autostash over to the pause: popping it now would blow
            // away the conflict the user has to resolve. `materialize_pause`
            // writes `restore_stashed: false` (it knows nothing about this
            // layer), so patch the flag on — `continue_op`/`abort_op` pop it.
            if stashed {
                if let Some(mut paused) = read_paused(repo) {
                    paused.set_rebase_restore(None, true);
                    write_paused(repo, &paused)?;
                }
            }
            Ok(paused_result)
        }
        Err(e) => {
            // Replay only wrote loose objects; refs/worktree are unchanged.
            // Drop the orphaned backup so it does not pollute the undo stack,
            // and best-effort clear any partial state.
            if let Ok(mut r) = repo.find_reference(&backup.backup_ref) {
                let _ = r.delete();
            }
            let _ = abort_to(repo, pre_tip);
            // `abort_to` is a hard reset: without this the failure path would
            // destroy the very uncommitted work the success path preserves.
            if stashed {
                let _ = crate::autostash::pop(repo);
            }
            Err(e)
        }
    }
}

/// Run an explicit interactive-rebase `plan` onto `onto` (a rev). The plan's
/// steps are applied in order (oldest-first) — the caller owns reordering.
pub fn rebase(
    repo_path: PathBuf,
    onto: String,
    steps: Vec<RebaseStep>,
) -> AdgitterResult<HistoryOpResult> {
    let _lock = lock_mutations();
    let repo = open_repo(&repo_path)?;
    execute(&repo, &onto, &steps, "rebase")
}

/// Rebase the current branch onto `onto`: replay every commit in
/// `merge_base(onto, HEAD)..HEAD` (all picks) on top of `onto`. No-op when the
/// branch already sits on `onto`.
pub fn rebase_onto(repo_path: PathBuf, onto: String) -> AdgitterResult<HistoryOpResult> {
    let _lock = lock_mutations();
    let repo = open_repo(&repo_path)?;
    let onto_commit = resolve_commit(&repo, &onto)?;
    let head = repo.head()?.peel_to_commit()?;
    if onto_commit.id() == head.id() {
        return Ok(HistoryOpResult::completed(RemapOutcome::default()));
    }
    let base = repo.merge_base(onto_commit.id(), head.id())?;
    if base == onto_commit.id() {
        // Current already builds on `onto` — nothing to replay.
        return Ok(HistoryOpResult::completed(RemapOutcome::default()));
    }
    let steps = pick_steps(&repo, base, head.id(), |_| RebaseAction::Pick)?;
    execute(&repo, &onto, &steps, "rebase")
}

/// Drop `sha` from the current branch by replaying its descendants without it.
pub fn drop_commit(repo_path: PathBuf, sha: String) -> AdgitterResult<HistoryOpResult> {
    let _lock = lock_mutations();
    let repo = open_repo(&repo_path)?;
    let target = resolve_commit(&repo, &sha)?;
    let target_id = target.id();
    let parent = target
        .parent(0)
        .map_err(|_| AdgitterError::Internal("cannot drop the root commit".into()))?;
    let head = repo.head()?.peel_to_commit()?;
    let steps = pick_steps(&repo, parent.id(), head.id(), |oid| {
        if oid == target_id {
            RebaseAction::Drop
        } else {
            RebaseAction::Pick
        }
    })?;
    execute(&repo, &parent.id().to_string(), &steps, "rebase")
}

/// Squash a user-selected, contiguous range of commits on the current branch
/// into ONE commit carrying `message`.
///
/// `shas` may be given in any order (the oldest/newest of the selection are
/// found by position, not by list order), but must resolve to at least two
/// distinct commits that:
/// - are each an ordinary, single-parent commit — a merge commit anywhere in
///   the selection, or the repository's root commit, is rejected;
/// - form a contiguous run on the current branch: walking first-parents from
///   HEAD, the selected commits must occupy one unbroken stretch (no gaps,
///   and every one of them reachable from HEAD at all).
///
/// The oldest selected commit becomes a `Pick` (so the melded commit inherits
/// its author identity, matching `squash_melds_two_commits_into_one`); every
/// other selected commit becomes a `Squash`, with `message` attached to the
/// LAST squash step so it wins as the final message (`replay`'s meld rule).
/// Everything outside the selection, older or newer, is replayed as a plain
/// `Pick` — untouched below the range, carried forward unchanged above it.
pub fn squash_range(
    repo_path: PathBuf,
    shas: Vec<String>,
    message: String,
) -> AdgitterResult<HistoryOpResult> {
    let _lock = lock_mutations();
    let repo = open_repo(&repo_path)?;

    if shas.len() < 2 {
        return Err(AdgitterError::Internal(
            "select at least two commits to squash".into(),
        ));
    }

    let mut selected: Vec<Oid> = Vec::with_capacity(shas.len());
    for sha in &shas {
        selected.push(resolve_commit(&repo, sha)?.id());
    }
    let selected_set: std::collections::HashSet<Oid> = selected.into_iter().collect();
    if selected_set.len() < 2 {
        return Err(AdgitterError::Internal(
            "select at least two distinct commits to squash".into(),
        ));
    }

    for &oid in &selected_set {
        let commit = repo.find_commit(oid)?;
        if commit.parent_count() > 1 {
            return Err(AdgitterError::Internal(
                "cannot squash a range containing a merge commit".into(),
            ));
        }
        if commit.parent_count() == 0 {
            return Err(AdgitterError::Internal(
                "cannot squash a range containing the root commit".into(),
            ));
        }
    }

    // Walk the current branch's first-parent chain from HEAD down to the
    // root, newest-first, so the selection's position (and contiguity) can
    // be checked positionally rather than by ancestry queries pairwise.
    let head = repo.head()?.peel_to_commit()?;
    let mut chain: Vec<Oid> = Vec::new();
    let mut cursor = Some(head.clone());
    while let Some(c) = cursor {
        chain.push(c.id());
        cursor = c.parent(0).ok();
    }
    let index_of: HashMap<Oid, usize> = chain.iter().enumerate().map(|(i, &o)| (o, i)).collect();

    let mut indices: Vec<usize> = Vec::with_capacity(selected_set.len());
    for &oid in &selected_set {
        match index_of.get(&oid) {
            Some(&i) => indices.push(i),
            None => {
                return Err(AdgitterError::Internal(
                    "selection is not on the current branch".into(),
                ));
            }
        }
    }
    indices.sort_unstable();
    let newest_idx = indices[0];
    let oldest_idx = *indices.last().expect("checked len >= 2 above");
    if oldest_idx - newest_idx + 1 != indices.len() {
        return Err(AdgitterError::Internal(
            "selected commits are not a contiguous range".into(),
        ));
    }

    let oldest = chain[oldest_idx];
    let onto = repo.find_commit(oldest)?.parent(0)?;

    let mut steps = pick_steps(&repo, onto.id(), head.id(), |oid| {
        if oid == oldest {
            RebaseAction::Pick
        } else if selected_set.contains(&oid) {
            RebaseAction::Squash
        } else {
            RebaseAction::Pick
        }
    })?;
    // The LAST squash step's message wins as the final melded message (see
    // `replay`'s meld rule); every other step's message stays None.
    if let Some(last_squash) = steps
        .iter_mut()
        .rev()
        .find(|s| s.action == RebaseAction::Squash)
    {
        last_squash.message = Some(message);
    }

    execute(&repo, &onto.id().to_string(), &steps, "squash")
}

/// Stash any dirty working tree/index (tracked **and** untracked — a branch
/// switch can clobber or refuse untracked files too) so the switch is never
/// blocked or destructive. Returns whether a stash was actually created. A
/// short, self-contained mutation: see [`rebase_branch`]'s doc comment for why
/// it takes and releases the lock on its own rather than being folded into one
/// big locked section. The stashing itself is `autostash.rs`'s, shared with the
/// same-branch rewrite paths.
fn stash_if_dirty(repo_path: &Path) -> AdgitterResult<bool> {
    let _lock = lock_mutations();
    let repo = open_repo(repo_path)?;
    crate::autostash::stash_if_dirty(&repo, "adgitter: rebase_branch autostash", true)
}

/// Pop the stash [`stash_if_dirty`] created. Always index 0 — nothing else
/// touches the stash stack between the save and this call.
fn pop_stash(repo_path: &Path) -> AdgitterResult<()> {
    let _lock = lock_mutations();
    let repo = open_repo(repo_path)?;
    crate::autostash::pop(&repo)
}

/// Rebase `branch` onto `onto`, whether or not `branch` is the branch
/// currently checked out.
///
/// When `branch` *is* HEAD's branch, this is exactly [`rebase_onto`] — no
/// checkout dance needed. Otherwise: stash any dirty working tree/index
/// (tracked + untracked), check out `branch`, rebase it onto `onto` (reusing
/// [`rebase_onto`] itself, so the backup-ref/undo behaviour `execute` already
/// provides is unchanged), check the *original* branch back out, and restore
/// the stash — the user ends up exactly where they started, with `branch`
/// rebased and their uncommitted changes intact.
///
/// # Lock discipline
/// [`crate::branch::checkout`] and [`rebase_onto`] are each already
/// self-contained, lock-taking mutations (the global mutation lock is
/// non-reentrant), so this function calls them sequentially instead of
/// holding the lock across the whole flow — the same structure
/// [`crate::branch::checkout_remote_branch`] uses for its own two-phase
/// branch-then-checkout. `stash_if_dirty`/`pop_stash` are likewise their own
/// short lock scopes. ADGitter drives one repo from one frontend at a time,
/// so the brief unlocked windows between these steps carry no real
/// interleaving risk in practice; avoiding the deadlock a reentrant acquire
/// around `checkout`/`rebase_onto` would cause takes priority.
///
/// # Failure handling
/// If checking out `branch` or the rebase itself fails, that is the error
/// returned — after a best-effort attempt to check the original branch back
/// out and pop the stash, so the user is never left silently stranded even
/// though they do see an error. If that primary step instead *succeeds* but
/// restoring the original checkout or the stash afterward fails, THAT failure
/// is surfaced instead (with context): a silent success would leave the
/// user's changes invisibly parked in the stash or on the wrong branch,
/// exactly the bug this function exists to close.
/// # Pausing on a conflict
/// When the rebase itself pauses on a conflict (`HistoryOpResult::Conflict` —
/// see `resolve.rs`), this function returns that result immediately WITHOUT
/// running its usual restoration: the pause has already detached HEAD onto
/// `branch`'s partial chain and left a real conflicted index/worktree there
/// (`resolve::materialize_pause`'s contract), so checking the original branch
/// back out or popping the autostash at this point would silently blow away
/// the very state the user needs to resolve. Instead, this wrapper's original
/// branch (short name) and whether it autostashed are patched onto the
/// just-written pause (`PausedOp::Rebase::restore_branch`/`restore_stashed`,
/// via `PausedOp::set_rebase_restore`) before returning the conflict to the
/// caller — so once the user resolves it, `continue_op` (on full plan
/// completion — a further conflict re-pauses and carries this bookkeeping
/// forward instead) and `abort_op` check the original branch back out and pop
/// the autostash themselves. Only a clean completion or a genuine error still
/// goes through the full stash/checkout-back dance below.
pub fn rebase_branch(
    repo_path: PathBuf,
    branch: String,
    onto: String,
) -> AdgitterResult<HistoryOpResult> {
    let (original_full, target_full) = {
        let repo = open_repo(&repo_path)?;
        let original_full = current_branch(&repo).map_err(|_| {
            AdgitterError::Internal(
                "cannot rebase a branch while HEAD is detached — check out a branch first".into(),
            )
        })?;
        let target_full = repo
            .find_branch(&branch, BranchType::Local)
            .map_err(|_| AdgitterError::Internal(format!("unknown local branch: {branch}")))?
            .get()
            .name()
            .map(str::to_string)
            .ok_or_else(|| AdgitterError::Internal("invalid branch name".into()))?;
        (original_full, target_full)
    };

    if target_full == original_full {
        // Already on `branch` — today's behaviour, unchanged.
        return rebase_onto(repo_path, onto);
    }
    let original_short = original_full
        .strip_prefix("refs/heads/")
        .unwrap_or(&original_full)
        .to_string();

    let stashed = stash_if_dirty(&repo_path)?;

    let onto_for_msg = onto.clone();
    let op_result = checkout(repo_path.clone(), branch.clone())
        .and_then(|()| rebase_onto(repo_path.clone(), onto));

    // A pause leaves a real conflict materialized on `branch` — do not touch
    // the original branch or the stash; see this function's doc comment.
    // Instead, patch this wrapper's original branch/autostash bookkeeping
    // onto the just-written pause so `continue_op`/`abort_op` can restore
    // them once the user resolves (or abandons) it.
    if let Ok(conflict @ HistoryOpResult::Conflict { .. }) = &op_result {
        let repo = open_repo(&repo_path)?;
        if let Some(mut paused) = read_paused(&repo) {
            debug_assert!(
                matches!(paused, PausedOp::Rebase { .. }),
                "rebase_branch only ever conflicts via the rebase engine, never a merge"
            );
            paused.set_rebase_restore(Some(original_short), stashed);
            write_paused(&repo, &paused)?;
        }
        return Ok(conflict.clone());
    }

    // Best-effort restoration, regardless of whether the rebase succeeded.
    let checkout_back = checkout(repo_path.clone(), original_short);
    let pop_result = if stashed {
        match &checkout_back {
            // Only pop once we're actually back on the branch the stash was
            // taken against — popping it onto the wrong branch risks a bogus
            // conflict on top of an already-bad situation. Leave the stash in
            // place (never drop it) so nothing is lost either way.
            Ok(()) => pop_stash(&repo_path),
            Err(_) => Ok(()),
        }
    } else {
        Ok(())
    };

    // The rebase attempt is the error the user needs to see when it fails;
    // restoration above was already attempted best-effort regardless of it.
    let outcome = op_result?;
    if let Err(e) = checkout_back {
        return Err(AdgitterError::Internal(format!(
            "rebase of '{branch}' onto '{onto_for_msg}' succeeded, but checking the original \
             branch back out failed: {e}{}",
            if stashed {
                " — your stashed changes are still saved; run `git stash pop` manually"
            } else {
                ""
            }
        )));
    }
    pop_result.map_err(|e| {
        AdgitterError::Internal(format!(
            "rebase of '{branch}' onto '{onto_for_msg}' succeeded and the original branch is \
             restored, but restoring your stashed changes failed: {e} — they are still saved; \
             run `git stash pop` manually"
        ))
    })?;
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;
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

    fn commit(dir: &Path, name: &str, content: &str) -> String {
        std::fs::write(dir.join(name), content).unwrap();
        workdir::stage(dir.to_path_buf(), vec![name.to_string()]).unwrap();
        workdir::commit(dir.to_path_buf(), format!("add {name}"), false).unwrap()
    }

    fn log_subjects(repo: &Repository) -> Vec<String> {
        let mut walk = repo.revwalk().unwrap();
        walk.push_head().unwrap();
        walk.map(|o| {
            repo.find_commit(o.unwrap())
                .unwrap()
                .summary()
                .unwrap()
                .to_string()
        })
        .collect()
    }

    #[test]
    fn rebase_onto_replays_commits_on_a_new_base() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "base.txt", "0");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();

        // feature diverges with f1, f2.
        crate::branch::create_branch(p.into(), "feature".into(), "HEAD".into()).unwrap();
        crate::branch::checkout(p.into(), "feature".into()).unwrap();
        commit(p, "f1.txt", "1");
        commit(p, "f2.txt", "2");

        // main advances with m1.
        crate::branch::checkout(p.into(), main.clone()).unwrap();
        commit(p, "m1.txt", "m");
        let main_tip = repo.head().unwrap().target().unwrap();

        // Rebase feature onto main: its two commits replay on top of m1.
        crate::branch::checkout(p.into(), "feature".into()).unwrap();
        rebase_onto(p.into(), main.clone()).unwrap();

        // All four files coexist and the new base is main's tip.
        assert!(p.join("m1.txt").exists() && p.join("f1.txt").exists());
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        // Walk down to the first commit that has m1 as ancestor: feature's new
        // base parent chain must include main_tip.
        let mut found = false;
        let mut walk = repo.revwalk().unwrap();
        walk.push(head.id()).unwrap();
        for o in walk {
            if o.unwrap() == main_tip {
                found = true;
                break;
            }
        }
        assert!(found, "rebased feature builds on main's tip");
    }

    #[test]
    fn drop_commit_removes_a_middle_commit() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "a.txt", "a");
        let mid = commit(p, "b.txt", "b");
        commit(p, "c.txt", "c");

        drop_commit(p.into(), mid).unwrap();

        assert!(p.join("a.txt").exists());
        assert!(!p.join("b.txt").exists(), "dropped commit's file is gone");
        assert!(p.join("c.txt").exists(), "later commit survives the rebase");
        let subjects = log_subjects(&repo);
        assert!(!subjects.iter().any(|s| s == "add b.txt"));
        assert!(subjects.iter().any(|s| s == "add c.txt"));
    }

    #[test]
    fn squash_melds_two_commits_into_one() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        let c0 = commit(p, "a.txt", "a");
        let c1 = commit(p, "b.txt", "b");
        let c2 = commit(p, "c.txt", "c");

        // Plan over c0..HEAD: pick c1, squash c2 into it.
        let steps = vec![
            RebaseStep {
                commit: c1,
                action: RebaseAction::Pick,
                message: None,
            },
            RebaseStep {
                commit: c2,
                action: RebaseAction::Squash,
                message: Some("b+c".into()),
            },
        ];
        rebase(p.into(), c0, steps).unwrap();

        let subjects = log_subjects(&repo);
        assert_eq!(
            subjects[0], "b+c",
            "squashed commit carries the new message"
        );
        // Two original commits became one: a.txt's commit + the squashed pair.
        assert!(p.join("b.txt").exists() && p.join("c.txt").exists());
        assert!(!subjects.iter().any(|s| s == "add c.txt"));
    }

    #[test]
    fn reword_of_an_older_commit_rewrites_descendants() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "a.txt", "a");
        let older = commit(p, "b.txt", "b");
        commit(p, "c.txt", "c");

        crate::history::reword(p.into(), older, "renamed b".into()).unwrap();

        let subjects = log_subjects(&repo);
        assert_eq!(subjects[0], "add c.txt", "tip preserved");
        assert!(subjects.iter().any(|s| s == "renamed b"));
        assert!(!subjects.iter().any(|s| s == "add b.txt"));
        // The descendant still applies cleanly on the reworded commit.
        assert!(p.join("c.txt").exists());
    }

    /// PREMISE CHANGE (pausable resolver): a conflicting rebase no longer
    /// aborts — it pauses with HEAD detached at the partial chain, a REAL
    /// cherry-pick conflict materialized in the index/worktree, the branch
    /// ref unmoved, and the backup kept. The full continue/abort battery
    /// lives in `resolve.rs`.
    #[test]
    fn conflicting_rebase_pauses_detached_with_branch_unmoved() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "shared.txt", "base");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();

        crate::branch::create_branch(p.into(), "feature".into(), "HEAD".into()).unwrap();
        crate::branch::checkout(p.into(), "feature".into()).unwrap();
        let feature_change = commit(p, "shared.txt", "feature-change");

        crate::branch::checkout(p.into(), main.clone()).unwrap();
        let main_tip = commit(p, "shared.txt", "main-change");

        // Rebasing feature onto main touches the same line → conflict.
        crate::branch::checkout(p.into(), "feature".into()).unwrap();
        let before = repo.head().unwrap().target().unwrap();
        let state = rebase_onto(p.into(), main).unwrap().unwrap_conflict();
        assert_eq!(state.op, "rebase");
        assert_eq!(state.branch, "feature");
        assert_eq!(
            state.sha, feature_change,
            "conflict names the replayed commit that failed to apply"
        );

        // Paused: HEAD detached at the partial chain (nothing applied before
        // the conflicting step, so exactly at `onto` = main's tip), with a
        // real cherry-pick conflict in the index and worktree.
        assert!(repo.head_detached().unwrap());
        assert_eq!(
            repo.head().unwrap().target().unwrap().to_string(),
            main_tip,
            "detached at the partial chain tip"
        );
        assert_eq!(repo.state(), git2::RepositoryState::CherryPick);
        assert!(repo.index().unwrap().has_conflicts());
        assert!(std::fs::read_to_string(p.join("shared.txt"))
            .unwrap()
            .contains("<<<<<<<"));

        // The branch ref itself was never moved, and the backup is kept.
        assert_eq!(
            repo.find_branch("feature", BranchType::Local)
                .unwrap()
                .get()
                .target()
                .unwrap(),
            before,
            "branch ref unmoved while paused"
        );
        assert!(crate::mutate::list_backups(&repo)
            .unwrap()
            .iter()
            .any(|b| b.op == "rebase"));
    }

    /// Number of entries currently on the stash stack.
    fn stash_count(path: &Path) -> usize {
        let mut repo = Repository::open(path).unwrap();
        let mut n = 0;
        repo.stash_foreach(|_, _, _| {
            n += 1;
            true
        })
        .unwrap();
        n
    }

    #[test]
    fn rebase_branch_stashes_dirty_tree_rebases_other_branch_and_restores() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "base.txt", "0");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();

        // feature diverges with f1.
        crate::branch::create_branch(p.into(), "feature".into(), "HEAD".into()).unwrap();
        crate::branch::checkout(p.into(), "feature".into()).unwrap();
        commit(p, "f1.txt", "1");

        // main advances with m1 — feature's rebase target moves forward.
        crate::branch::checkout(p.into(), main.clone()).unwrap();
        let main_tip = commit(p, "m1.txt", "m");
        let main_tip_oid = Oid::from_str(&main_tip).unwrap();

        // Dirty, untracked change on the CURRENT branch (main), which is not
        // the branch being rebased (feature) — this must survive the whole
        // stash/checkout/rebase/checkout-back/pop round trip.
        std::fs::write(p.join("dirty.txt"), "keep-me").unwrap();

        rebase_branch(p.into(), "feature".into(), main.clone()).unwrap();

        // Back on the original branch, dirty file intact, stash consumed.
        assert_eq!(repo.head().unwrap().shorthand().unwrap(), main);
        assert_eq!(
            std::fs::read_to_string(p.join("dirty.txt")).unwrap(),
            "keep-me",
            "dirty file survives the stash round trip"
        );
        assert_eq!(stash_count(p), 0, "the stash was popped, not left behind");

        // `feature` itself was rebased onto main's new tip.
        let feature_tip = repo
            .find_branch("feature", BranchType::Local)
            .unwrap()
            .get()
            .target()
            .unwrap();
        let mut walk = repo.revwalk().unwrap();
        walk.push(feature_tip).unwrap();
        assert!(
            walk.into_iter().any(|o| o.unwrap() == main_tip_oid),
            "feature builds on main's new tip"
        );
    }

    #[test]
    fn rebase_branch_with_clean_tree_still_restores_original_branch() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "base.txt", "0");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();

        crate::branch::create_branch(p.into(), "feature".into(), "HEAD".into()).unwrap();
        crate::branch::checkout(p.into(), "feature".into()).unwrap();
        commit(p, "f1.txt", "1");

        crate::branch::checkout(p.into(), main.clone()).unwrap();
        let main_tip = commit(p, "m1.txt", "m");
        let main_tip_oid = Oid::from_str(&main_tip).unwrap();
        // Working tree is clean here — nothing should be stashed.

        rebase_branch(p.into(), "feature".into(), main.clone()).unwrap();

        // Back on main's own working tree — feature's f1.txt is not checked
        // out here, but main's own files are untouched.
        assert_eq!(repo.head().unwrap().shorthand().unwrap(), main);
        assert_eq!(stash_count(p), 0, "nothing to stash on a clean tree");
        assert!(p.join("m1.txt").exists());

        // `feature` itself was rebased onto main's new tip.
        let feature_tip = repo
            .find_branch("feature", BranchType::Local)
            .unwrap()
            .get()
            .target()
            .unwrap();
        let mut walk = repo.revwalk().unwrap();
        walk.push(feature_tip).unwrap();
        assert!(
            walk.into_iter().any(|o| o.unwrap() == main_tip_oid),
            "feature builds on main's new tip"
        );
    }

    // `rebase_branch_same_as_current_delegates_to_rebase_onto` lived here; it
    // is superseded by `tests/matrix.rs::rebase_head_from_clean_*_open`, which
    // asserts the same "still on the rebased branch, and it builds on the
    // target's tip" plus the exact set of refs moved (so the checkout dance is
    // observably skipped), the `rebase` backup, and the undo round-trip.

    #[test]
    fn rebase_branch_conflict_then_abort_restores_original_branch_and_dirty_file() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "shared.txt", "base");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();

        crate::branch::create_branch(p.into(), "feature".into(), "HEAD".into()).unwrap();
        crate::branch::checkout(p.into(), "feature".into()).unwrap();
        let feature_change = commit(p, "shared.txt", "feature-change");

        crate::branch::checkout(p.into(), main.clone()).unwrap();
        commit(p, "shared.txt", "main-change"); // conflicts with feature's edit

        std::fs::write(p.join("dirty.txt"), "keep-me").unwrap();

        // While paused, rebase_branch deliberately does NOT restore the
        // original branch or pop the autostash — doing so would destroy the
        // materialized conflict the user must now resolve (see
        // rebase_branch's doc comment). It DOES, however, remember `main`
        // (and that it autostashed) so abort_op/continue_op can finish the
        // restoration once the pause is resolved one way or the other.
        let state = rebase_branch(p.into(), "feature".into(), main.clone())
            .unwrap()
            .unwrap_conflict();
        assert_eq!(state.op, "rebase");
        assert_eq!(state.branch, "feature");
        assert_eq!(state.sha, feature_change);

        // Paused on feature's partial chain: HEAD detached, conflict staged.
        assert!(repo.head_detached().unwrap());
        assert!(repo.index().unwrap().has_conflicts());
        // The dirty file is parked in the autostash (NOT popped — the paused
        // worktree carries the conflict), never lost.
        assert!(!p.join("dirty.txt").exists());
        assert_eq!(stash_count(p), 1, "autostash kept while paused");

        // Aborting the pause now finishes the wrapper's own undo dance: back
        // on `main` (not `feature`, the branch being rebased), autostash
        // popped, dirty file restored.
        crate::resolve::abort_op(p.into()).unwrap();
        assert_eq!(repo.head().unwrap().shorthand().unwrap(), main);
        assert!(
            crate::mutate::list_backups(&repo).unwrap().is_empty(),
            "an aborted rebase leaves no orphan backup"
        );
        assert_eq!(stash_count(p), 0, "autostash popped once restored to main");
        assert_eq!(
            std::fs::read_to_string(p.join("dirty.txt")).unwrap(),
            "keep-me",
            "dirty file survives the stash round trip"
        );
    }

    #[test]
    fn rebase_branch_conflict_then_continue_restores_original_branch_and_pops_stash() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "shared.txt", "base");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();

        crate::branch::create_branch(p.into(), "feature".into(), "HEAD".into()).unwrap();
        crate::branch::checkout(p.into(), "feature".into()).unwrap();
        let feature_change = commit(p, "shared.txt", "feature-change");

        crate::branch::checkout(p.into(), main.clone()).unwrap();
        commit(p, "shared.txt", "main-change"); // conflicts with feature's edit

        std::fs::write(p.join("dirty.txt"), "keep-me").unwrap();

        // Rebase `feature` onto `main` while `main` is checked out — pauses
        // on the single conflicting commit, autostashing `dirty.txt`.
        let state = rebase_branch(p.into(), "feature".into(), main.clone())
            .unwrap()
            .unwrap_conflict();
        assert_eq!(state.sha, feature_change);
        assert_eq!(stash_count(p), 1, "autostash kept while paused");

        // Resolve the conflict and stage it; continuing finishes the whole
        // plan (only one conflicting step), so the wrapper's own
        // checkout-back/pop-stash dance should now run to completion.
        std::fs::write(p.join("shared.txt"), "resolved").unwrap();
        workdir::stage(p.to_path_buf(), vec!["shared.txt".to_string()]).unwrap();
        let outcome = crate::resolve::continue_op(p.into())
            .unwrap()
            .unwrap_completed();
        assert!(outcome.remapped.is_empty() && outcome.skipped.is_empty());

        // Back on `main` (the wrapper's original branch), not `feature`.
        assert!(!repo.head_detached().unwrap());
        assert_eq!(repo.head().unwrap().shorthand().unwrap(), main);
        assert_eq!(
            std::fs::read_to_string(p.join("dirty.txt")).unwrap(),
            "keep-me",
            "dirty file survives the stash round trip"
        );
        assert_eq!(stash_count(p), 0, "autostash popped once restored to main");

        // `feature` itself was correctly rewritten with the resolution.
        let feature_tip = repo
            .find_branch("feature", BranchType::Local)
            .unwrap()
            .get()
            .peel_to_commit()
            .unwrap();
        let blob = feature_tip
            .tree()
            .unwrap()
            .get_path(Path::new("shared.txt"))
            .unwrap()
            .to_object(&repo)
            .unwrap();
        assert_eq!(
            String::from_utf8(blob.as_blob().unwrap().content().to_vec()).unwrap(),
            "resolved",
            "feature carries the staged resolution"
        );
    }

    #[test]
    fn rebase_branch_errors_clearly_on_detached_head() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        let sha = commit(p, "a.txt", "1");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();

        // Detach HEAD at the commit itself (checkout by sha, not branch name).
        crate::branch::checkout(p.into(), sha).unwrap();
        assert!(repo.head_detached().unwrap());

        let err = rebase_branch(p.into(), main, "HEAD".into()).unwrap_err();
        assert!(matches!(err, AdgitterError::Internal(_)));
    }

    /// Commit `content` to `name` with an explicit `author` signature (rather
    /// than the repo's configured identity), using `HEAD`'s committer for the
    /// commit's committer field — lets a test tell "author kept from the
    /// oldest commit" apart from "committer freshly stamped".
    fn commit_with_author(
        dir: &Path,
        repo: &Repository,
        name: &str,
        content: &str,
        author: &git2::Signature,
    ) -> String {
        std::fs::write(dir.join(name), content).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new(name)).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
        let parents: Vec<Commit> = parent.into_iter().collect();
        let parent_refs: Vec<&Commit> = parents.iter().collect();
        let committer = repo.signature().unwrap();
        repo.commit(
            Some("HEAD"),
            author,
            &committer,
            &format!("add {name}"),
            &tree,
            &parent_refs,
        )
        .unwrap()
        .to_string()
    }

    #[test]
    fn squash_range_squashes_two_commits_into_one_with_given_message() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "a.txt", "a");
        let c1 = commit(p, "b.txt", "b");
        let c2 = commit(p, "c.txt", "c");
        let original_newest_tree = repo
            .find_commit(Oid::from_str(&c2).unwrap())
            .unwrap()
            .tree_id();

        squash_range(p.into(), vec![c1, c2], "squashed b+c".into()).unwrap();

        let subjects = log_subjects(&repo);
        assert_eq!(
            subjects,
            vec!["squashed b+c".to_string(), "add a.txt".to_string()],
            "two commits became one, carrying the given message"
        );
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(
            head.tree_id(),
            original_newest_tree,
            "squashed content matches the newest original commit's tree"
        );
        assert!(p.join("b.txt").exists() && p.join("c.txt").exists());
    }

    #[test]
    fn squash_range_middle_range_replays_above_and_leaves_below_untouched() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "base.txt", "0");
        let c1 = commit(p, "a.txt", "a"); // below the range — must stay byte-identical
        let c1_oid = Oid::from_str(&c1).unwrap();
        let c2 = commit(p, "b.txt", "b");
        let c3 = commit(p, "c.txt", "c");
        commit(p, "d.txt", "d"); // above the range — replayed on top

        squash_range(p.into(), vec![c2, c3], "b+c squashed".into()).unwrap();

        let subjects = log_subjects(&repo);
        assert_eq!(
            subjects,
            vec![
                "add d.txt".to_string(),
                "b+c squashed".to_string(),
                "add a.txt".to_string(),
                "add base.txt".to_string(),
            ]
        );

        // The commit below the range kept its exact original oid.
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        let below = head.parent(0).unwrap().parent(0).unwrap();
        assert_eq!(
            below.id(),
            c1_oid,
            "commit below the squashed range is byte-identical"
        );
        assert!(p.join("d.txt").exists() && p.join("b.txt").exists() && p.join("c.txt").exists());
    }

    #[test]
    fn squash_range_keeps_oldest_authors_identity_with_a_fresh_committer() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "a.txt", "a");

        let past_author = git2::Signature::new(
            "Old Author",
            "old@example.com",
            &git2::Time::new(1_000_000_000, 0),
        )
        .unwrap();
        let c1 = commit_with_author(p, &repo, "b.txt", "b", &past_author);
        let c2 = commit(p, "c.txt", "c");

        squash_range(p.into(), vec![c1, c2], "squashed".into()).unwrap();

        let head = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(
            head.author().name(),
            Some("Old Author"),
            "oldest selected commit's author identity is kept"
        );
        assert_eq!(
            head.author().when().seconds(),
            1_000_000_000,
            "author date preserved from the oldest commit"
        );
        assert_eq!(
            head.committer().name(),
            Some("Tester"),
            "committer is the current git identity"
        );
        assert_ne!(
            head.committer().when().seconds(),
            1_000_000_000,
            "committer is freshly stamped, not copied from the oldest author"
        );
    }

    #[test]
    fn squash_range_errors_when_selection_contains_a_merge_commit() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "base.txt", "0");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();

        crate::branch::create_branch(p.into(), "side".into(), "HEAD".into()).unwrap();
        crate::branch::checkout(p.into(), "side".into()).unwrap();
        commit(p, "s1.txt", "s");

        crate::branch::checkout(p.into(), main.clone()).unwrap();
        let m1 = commit(p, "m1.txt", "m");
        crate::history::merge(p.into(), "side".into()).unwrap();
        let merge_sha = repo
            .head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .id()
            .to_string();
        assert_eq!(
            repo.find_commit(Oid::from_str(&merge_sha).unwrap())
                .unwrap()
                .parent_count(),
            2,
            "fixture must actually produce a merge commit"
        );

        let err = squash_range(p.into(), vec![m1, merge_sha], "nope".into()).unwrap_err();
        match err {
            AdgitterError::Internal(msg) => assert!(msg.contains("merge commit"), "{msg}"),
            other => panic!("expected Internal, got {other:?}"),
        }
    }

    #[test]
    fn squash_range_errors_when_range_is_not_contiguous() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let _repo = init_repo(p);
        commit(p, "a.txt", "a");
        let c1 = commit(p, "b.txt", "b");
        commit(p, "c.txt", "c");
        let c3 = commit(p, "d.txt", "d");

        let err = squash_range(p.into(), vec![c1, c3], "x".into()).unwrap_err();
        match err {
            AdgitterError::Internal(msg) => {
                assert!(msg.contains("not a contiguous range"), "{msg}")
            }
            other => panic!("expected Internal, got {other:?}"),
        }
    }

    #[test]
    fn squash_range_errors_when_selection_includes_the_root_commit() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let _repo = init_repo(p);
        let c0 = commit(p, "a.txt", "a");
        let c1 = commit(p, "b.txt", "b");

        let err = squash_range(p.into(), vec![c0, c1], "x".into()).unwrap_err();
        match err {
            AdgitterError::Internal(msg) => assert!(msg.contains("root commit"), "{msg}"),
            other => panic!("expected Internal, got {other:?}"),
        }
    }

    #[test]
    fn squash_range_errors_with_fewer_than_two_shas() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let _repo = init_repo(p);
        let c0 = commit(p, "a.txt", "a");

        let err = squash_range(p.into(), vec![c0], "x".into()).unwrap_err();
        assert!(matches!(err, AdgitterError::Internal(_)));
    }

    #[test]
    fn squash_range_errors_when_selection_is_not_on_the_current_branch() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "base.txt", "0");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();
        let c1 = commit(p, "a.txt", "a");

        crate::branch::create_branch(p.into(), "side".into(), "HEAD".into()).unwrap();
        crate::branch::checkout(p.into(), "side".into()).unwrap();
        let side_commit = commit(p, "s1.txt", "s");

        crate::branch::checkout(p.into(), main).unwrap();
        commit(p, "b.txt", "b");

        let err = squash_range(p.into(), vec![c1, side_commit], "x".into()).unwrap_err();
        match err {
            AdgitterError::Internal(msg) => {
                assert!(msg.contains("not on the current branch"), "{msg}")
            }
            other => panic!("expected Internal, got {other:?}"),
        }
    }

    #[test]
    fn squash_range_creates_a_backup_labeled_squash_and_undo_restores_original_tip() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "a.txt", "a");
        let c1 = commit(p, "b.txt", "b");
        let c2 = commit(p, "c.txt", "c");
        let original_tip = repo.head().unwrap().target().unwrap();

        squash_range(p.into(), vec![c1, c2], "squashed".into()).unwrap();
        assert_ne!(repo.head().unwrap().target().unwrap(), original_tip);

        let backups = crate::mutate::list_backups(&repo).unwrap();
        assert_eq!(backups.len(), 1);
        assert_eq!(backups[0].op, "squash");

        let restored = crate::mutate::undo_last(p.into())
            .unwrap()
            .expect("a backup");
        assert_eq!(restored.op, "squash");
        assert_eq!(
            repo.head().unwrap().target().unwrap(),
            original_tip,
            "undo restores the pre-squash tip"
        );
    }

    #[test]
    fn squash_range_remaps_a_descendant_fork() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "base.txt", "0");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();
        let c1 = commit(p, "a.txt", "a");
        let c2 = commit(p, "b.txt", "b");

        crate::branch::create_branch(p.into(), "feature".into(), "HEAD".into()).unwrap();
        crate::branch::checkout(p.into(), "feature".into()).unwrap();
        commit(p, "f1.txt", "f");

        crate::branch::checkout(p.into(), main.clone()).unwrap();
        let outcome = squash_range(p.into(), vec![c1, c2], "squashed a+b".into())
            .unwrap()
            .unwrap_completed();

        assert_eq!(outcome.remapped, vec!["refs/heads/feature".to_string()]);
        assert!(outcome.skipped.is_empty());

        let feature_tip = repo
            .find_branch("feature", BranchType::Local)
            .unwrap()
            .get()
            .target()
            .unwrap();
        let tree = repo.find_commit(feature_tip).unwrap().tree().unwrap();
        assert!(tree.get_path(Path::new("a.txt")).is_ok());
        assert!(tree.get_path(Path::new("b.txt")).is_ok());
        assert!(tree.get_path(Path::new("f1.txt")).is_ok());
    }
}
