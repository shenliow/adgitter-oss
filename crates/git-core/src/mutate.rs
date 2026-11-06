//! Mutation safety net for history-rewriting operations.
//!
//! Every operation that rewrites history (rebase, reset, reword, drop, …) MUST
//! run while holding [`lock_mutations`] and MUST snapshot the affected ref with
//! [`create_backup`] first, so the change is reversible via [`reflog_undo`]
//!.
//!
//! Backups live under `refs/adgitter/backup/<ms>-<seq>/<op>/<original-ref>` so
//! they survive a crash and need no external state: the restore point (oid) is
//! the backup ref's own target, and the op + original ref are recovered from its
//! name. This keeps the whole mechanism inside the libgit2 ref model.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use git2::{build::CheckoutBuilder, Oid, Repository};

use crate::error::{AdgitterError, AdgitterResult};

const BACKUP_PREFIX: &str = "refs/adgitter/backup/";

/// Process-wide mutation lock. ADGitter opens one repository at a time, so a
/// single global lock serializes all history-mutating operations.
static OP_LOCK: Mutex<()> = Mutex::new(());

/// Strictly-increasing per-process sequence, used as a tiebreaker so backups
/// created within the same millisecond still order deterministically.
static SEQ: AtomicU64 = AtomicU64::new(0);

/// Acquire the global mutation lock. Hold the returned guard for the duration of
/// a mutating operation; the lock releases when it drops. Poisoning is ignored —
/// a panicked op still leaves the repo recoverable via its backup ref.
pub fn lock_mutations() -> MutexGuard<'static, ()> {
    OP_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// A pre-operation snapshot of a ref, recorded under `refs/adgitter/backup/`.
/// Also `Deserialize` so a paused conflict-resolution state (`resolve.rs`) can
/// round-trip its identity through the on-disk `adgitter-resolve.json` and
/// survive an app restart.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Backup {
    /// Full backup ref name (`refs/adgitter/backup/<ms>-<seq>/<op>/<ref>`).
    pub backup_ref: String,
    /// Operation label that created it (e.g. `rebase`).
    pub op: String,
    /// The ref that was snapshotted (e.g. `refs/heads/main`).
    pub original_ref: String,
    /// Hex oid the original ref pointed at — the restore point.
    pub target: String,
    /// Creation time (unix millis), for ordering.
    pub created_ms: u64,
    /// Per-process creation sequence, tiebreaker for `created_ms`.
    pub seq: u64,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Snapshot `original_ref`'s current target before a rewrite. `op` is a short
/// label without slashes. Should be called while holding [`lock_mutations`].
///
/// Starts a brand-new backup **batch** (see [`add_to_batch`]): its
/// `(created_ms, seq)` pair is freshly generated, so this backup is undone on
/// its own unless more refs are folded into the same batch afterward.
pub fn create_backup(repo: &Repository, op: &str, original_ref: &str) -> AdgitterResult<Backup> {
    backup_with_key(repo, op, original_ref, next_batch_key())
}

/// A fresh, strictly-increasing batch key. Shared with `undo.rs` so a commit's
/// snapshot record orders against backup batches on the same scale — the
/// newest in-app action has to win regardless of which namespace recorded it.
pub(crate) fn next_batch_key() -> (u64, u64) {
    (now_ms(), SEQ.fetch_add(1, Ordering::Relaxed))
}

/// Snapshot `original_ref` into the SAME backup batch as `batch` (typically
/// the [`Backup`] [`create_backup`] just returned for the primary ref an
/// operation moved). A single [`reflog_undo`]/[`undo_last`] call restores
/// every ref backed up under a shared `(created_ms, seq)` key together, so
/// this is how a multi-ref rewrite (a history op plus the descendant branches
/// it re-based alongside it) stays undoable as ONE unit instead of requiring
/// one undo per ref. The ref format is otherwise identical to
/// [`create_backup`]'s, so older, single-ref backups remain readable by
/// [`list_backups`]/[`parse_backup`] unchanged.
pub(crate) fn add_to_batch(
    repo: &Repository,
    batch: &Backup,
    op: &str,
    original_ref: &str,
) -> AdgitterResult<Backup> {
    backup_with_key(repo, op, original_ref, (batch.created_ms, batch.seq))
}

fn backup_with_key(
    repo: &Repository,
    op: &str,
    original_ref: &str,
    (created_ms, seq): (u64, u64),
) -> AdgitterResult<Backup> {
    if op.contains('/') {
        return Err(AdgitterError::Internal(format!(
            "backup op label must not contain '/': {op}"
        )));
    }
    let reference = repo.find_reference(original_ref)?;
    let target = reference.target().ok_or_else(|| {
        AdgitterError::Internal(format!("cannot back up symbolic ref {original_ref}"))
    })?;

    let backup_ref = format!("{BACKUP_PREFIX}{created_ms}-{seq}/{op}/{original_ref}");
    repo.reference(
        &backup_ref,
        target,
        false,
        &format!("adgitter backup: {op}"),
    )?;

    Ok(Backup {
        backup_ref,
        op: op.to_string(),
        original_ref: original_ref.to_string(),
        target: target.to_string(),
        created_ms,
        seq,
    })
}

fn parse_backup(name: &str, target: Oid) -> Option<Backup> {
    let rest = name.strip_prefix(BACKUP_PREFIX)?;
    let (head, after) = rest.split_once('/')?; // head = "<ms>-<seq>"
    let (op, original_ref) = after.split_once('/')?;
    let (ms_str, seq_str) = head.split_once('-')?;
    Some(Backup {
        backup_ref: name.to_string(),
        op: op.to_string(),
        original_ref: original_ref.to_string(),
        target: target.to_string(),
        created_ms: ms_str.parse().ok()?,
        seq: seq_str.parse().ok()?,
    })
}

/// List all backups, newest first. Backups sharing a `(created_ms, seq)`
/// batch (see [`add_to_batch`]) are then ordered by `original_ref` so the
/// group is returned deterministically.
pub fn list_backups(repo: &Repository) -> AdgitterResult<Vec<Backup>> {
    let mut out = Vec::new();
    for r in repo.references()? {
        let r = r?;
        let Some(name) = r.name() else { continue };
        if !name.starts_with(BACKUP_PREFIX) {
            continue;
        }
        let Some(target) = r.target() else { continue };
        if let Some(b) = parse_backup(name, target) {
            out.push(b);
        }
    }
    out.sort_by(|a, b| {
        std::cmp::Reverse((a.created_ms, a.seq))
            .cmp(&std::cmp::Reverse((b.created_ms, b.seq)))
            .then_with(|| a.original_ref.cmp(&b.original_ref))
    });
    Ok(out)
}

/// The newest backup **batch**: every backup sharing the newest
/// `(created_ms, seq)` key, in [`list_backups`] order (so `.first()` is
/// representative of the whole batch's `op`). Empty when nothing is undoable.
/// Peeking at the batch without consuming it lets [`undo_last`] inspect the
/// operation it is about to reverse while the repository is still in its
/// post-op state.
fn newest_batch(repo: &Repository) -> AdgitterResult<Vec<Backup>> {
    let all = list_backups(repo)?;
    let Some(latest) = all.first().cloned() else {
        return Ok(Vec::new());
    };
    let key = (latest.created_ms, latest.seq);
    Ok(all
        .into_iter()
        .filter(|b| (b.created_ms, b.seq) == key)
        .collect())
}

/// Restore every backup sharing the newest `(created_ms, seq)` batch key
/// (ordinarily just one ref, but a history op that also re-based descendant
/// branches — see `remap.rs` — folds all of them into the SAME batch via
/// [`add_to_batch`], so they undo together as a single unit). Returns every
/// restored backup, newest-batch-first, or an empty vec when there is nothing
/// to undo.
fn reflog_undo_group(repo: &Repository) -> AdgitterResult<Vec<Backup>> {
    let group = newest_batch(repo)?;
    restore_group(repo, &group)?;
    Ok(group)
}

/// Move every ref in `group` back to its saved target and drop the backups.
/// Split out so [`undo_last`] can restore the batch it has already validated
/// as this app's own work, instead of re-deriving "the newest batch" and
/// risking acting on a different one than it checked.
fn restore_group(repo: &Repository, group: &[Backup]) -> AdgitterResult<()> {
    for b in group {
        let oid = Oid::from_str(&b.target)?;
        repo.reference(
            &b.original_ref,
            oid,
            true,
            &format!("adgitter undo: {}", b.op),
        )?;
    }
    for b in group {
        let mut backup = repo.find_reference(&b.backup_ref)?;
        backup.delete()?;
    }
    Ok(())
}

/// Undo the most recent backup **batch**: move every ref in it back to its
/// saved target and drop the backups. Returns a representative restored
/// backup (every entry in a batch shares the same `op` label, so `.op` is
/// meaningful regardless of which ref happens to be picked), or `None` if
/// there are no backups.
///
/// This restores *ref* state (the reachable DAG). An operation that also changed
/// the working tree/index is responsible for resetting those as part of its undo.
///
/// This is the low-level, **unguarded** primitive: it restores whatever batch is
/// newest, without asking whether the refs are still where the app left them.
/// [`undo_last`] is the user-facing entry point and is the one that enforces the
/// in-app-only rule (`undo::classify`). Nothing user-facing should call this.
pub fn reflog_undo(repo: &Repository) -> AdgitterResult<Option<Backup>> {
    Ok(reflog_undo_group(repo)?.into_iter().next())
}

/// Delete every backup ref older than `max_age_ms`, so ghost commits they keep
/// reachable eventually fall out of the graph. Returns the number removed.
/// Holds the lock, since deleting refs is itself a mutation of repo state.
///
/// Commit-undo snapshot records expire on the same clock and are included in
/// the tally; the left-marks beside them are metadata and are swept once
/// nothing refers to them (see `undo::expire`).
pub fn expire_backups(repo_path: PathBuf, max_age_ms: u64) -> AdgitterResult<usize> {
    let _lock = lock_mutations();
    let repo = crate::git::open_repo(&repo_path)?;
    let now = now_ms();
    let mut removed = 0usize;
    for backup in list_backups(&repo)? {
        if backup.created_ms + max_age_ms >= now {
            continue;
        }
        let mut reference = repo.find_reference(&backup.backup_ref)?;
        reference.delete()?;
        removed += 1;
    }
    removed += crate::undo::expire(&repo, now, max_age_ms)?;
    Ok(removed)
}

/// The `op` label of `inject.rs`'s `add_file_to_commit` — the one operation
/// whose undo has to put a file BACK on disk (see [`carry_over_injected`]).
const INJECT_OP: &str = "add-file";

/// A working-tree file that [`undo_last`]'s checkout is about to delete,
/// captured so it can be written straight back afterwards.
///
/// The bytes are held in memory rather than moved aside to a scratch path:
/// one file at a time, and libgit2's own checkout already round-trips whole
/// blobs through memory, so this costs nothing a normal checkout does not
/// already pay — and it keeps the failure modes to "read failed" (before any
/// ref moves) and "write failed" (reported, with the path named).
struct CarriedFile {
    /// Absolute path in the working tree.
    path: PathBuf,
    /// Repo-relative path, for re-staging (see [`rescue_staged_only`]).
    rel: PathBuf,
    /// The file's CURRENT on-disk bytes (see [`carry_over_injected`] on why
    /// current, not as-injected).
    bytes: Vec<u8>,
    perms: std::fs::Permissions,
    /// Whether to put the path back into the INDEX after writing it to disk.
    /// An inject's carry-over restores its file as plainly untracked
    /// ([`carry_over_injected`]); a staged-only rescue must come back STAGED,
    /// because that is the state it was in before the undo
    /// ([`rescue_staged_only`]).
    restage: bool,
}

/// Snapshot every path whose only copy is the index — present as an index
/// entry, but in neither the tree this undo restores nor the tree HEAD
/// currently points at. The hard restore below rewrites the index from the
/// restored tree and force-checks-out, which deletes such a path from both
/// the index AND the disk, and because its content was never committed
/// anywhere it is then recoverable from nothing at all.
///
/// This is the general form of the hazard [`carry_over_injected`] was written
/// for: staged, never-committed work destroyed by an undo. It is NOT per-op —
/// a plain `merge`, `reset`, `cherry-pick`, `revert`, `rebase`, `squash` or
/// `reword` reaches it just as readily as an inject, so gating it on an op
/// label would leave every other route open. The route commit-undo opens is
/// one more instance, not a new hazard: inject, commit, Undo, Undo leaves the
/// committed file staged and in no tree.
///
/// Both exclusions matter and are the reason this cannot simply rescue
/// everything the checkout would remove. In both cases the path is one the
/// undo legitimately rewrites — NOT one where nothing is at stake:
///   * in the **restored** tree → putting that content back is precisely what
///     the undo is for; rescuing it would defeat the undo.
///   * in **HEAD's** tree → the path is accounted for by a commit, so the
///     undo is entitled to rewrite it. Also what keeps an undone merge's
///     files (committed by the merge, absent before it) correctly deleted.
///
/// Be careful about what the HEAD-tree exclusion does and does not cost. It
/// is NOT true that the content is always recoverable: for a path that is
/// committed AND has a staged modification, only the *committed* blob is
/// reachable. The user's staged edit is an odb object with no ref pointing at
/// it, findable through no part of this app and eligible for gc — measured,
/// not assumed. The resulting asymmetry is deliberate but sharp:
///
///   * a staged **new** file (in no tree) is protected;
///   * a staged **modification** of a committed file is NOT — the undo
///     rewrites the path and the uncommitted edit is gone.
///
/// Widening the rescue to cover staged modifications would mean an undo could
/// no longer restore a path's committed content, which is its core job; the
/// two cannot both be satisfied for one path.
///
/// Called BEFORE any ref moves, so an I/O failure aborts the undo with the
/// repository untouched rather than half-rescued.
fn rescue_staged_only(
    repo: &Repository,
    group: &[Backup],
    head_ref: &str,
) -> AdgitterResult<Vec<CarriedFile>> {
    let Some(workdir) = repo.workdir().map(|w| w.to_path_buf()) else {
        return Ok(Vec::new()); // bare repo: no working tree to protect
    };
    let Some(backup) = group.iter().find(|b| b.original_ref == head_ref) else {
        return Ok(Vec::new());
    };
    let restored_tree = repo.find_commit(Oid::from_str(&backup.target)?)?.tree()?;
    let head_tree = repo.head()?.peel_to_commit()?.tree()?;

    let mut out = Vec::new();
    for entry in repo.index()?.iter() {
        // Stage 0 only: a conflict side is mid-resolution, and `undo_last`
        // refuses to run while an op is paused anyway.
        if (entry.flags >> 12) & 0x3 != 0 {
            continue;
        }
        let Ok(rel) = std::str::from_utf8(&entry.path) else {
            continue;
        };
        let rel = PathBuf::from(rel);
        if restored_tree.get_path(&rel).is_ok() || head_tree.get_path(&rel).is_ok() {
            continue;
        }
        let path = workdir.join(&rel);
        // A path the user has since deleted from disk is not resurrected,
        // matching `carry_over_injected`'s decision: re-creating it would
        // contradict a deliberate deletion.
        if !path.is_file() {
            continue;
        }
        let perms = std::fs::metadata(&path)?.permissions();
        out.push(CarriedFile {
            bytes: std::fs::read(&path)?,
            path,
            rel,
            perms,
            restage: true,
        });
    }
    Ok(out)
}

/// Read the working-tree files that undoing an **inject** would otherwise
/// delete: everything present in HEAD's tree but absent from the tree this
/// undo restores. Called BEFORE any ref moves, so an I/O failure here aborts
/// the undo with the repository untouched rather than losing the file.
///
/// Why inject is special-cased instead of making undo never delete anything:
/// `add_file_to_commit`'s precondition is that `path` already exists in the
/// working tree — the content is the USER'S, it lived on disk (typically
/// untracked) before the op, and the op's whole job was to also put it into
/// history. Undoing that must return it to disk, or pressing Undo destroys
/// user data that exists nowhere else (post-undo state must match
/// pre-op). Every other op's undo deletes only content that came out of
/// commits which still exist (a cherry-picked or merged file), so leaving
/// those behind would litter the working tree with recoverable junk — and
/// would change the undo round-trip of every op, not just this one.
///
/// The bytes carried over are the file's CURRENT ones, not the ones that were
/// injected: if the user edited the file after the inject, those edits are
/// unsaved work that only exists on disk, and undo must not silently revert
/// them to the injected snapshot. Undo reverses the *history* change; it is
/// not a working-tree time machine.
///
/// A path that is no longer on disk at all (the user deleted it after the
/// inject) is not resurrected: there is nothing of theirs to protect, and
/// re-creating it would contradict a deliberate deletion.
fn carry_over_injected(
    repo: &Repository,
    group: &[Backup],
    head_ref: &str,
) -> AdgitterResult<Vec<CarriedFile>> {
    let Some(workdir) = repo.workdir().map(|w| w.to_path_buf()) else {
        return Ok(Vec::new()); // bare repo: no working tree to protect
    };
    let Some(backup) = group.iter().find(|b| b.original_ref == head_ref) else {
        return Ok(Vec::new());
    };
    let restored_tree = repo.find_commit(Oid::from_str(&backup.target)?)?.tree()?;
    let head_tree = repo.head()?.peel_to_commit()?.tree()?;

    let diff = repo.diff_tree_to_tree(Some(&restored_tree), Some(&head_tree), None)?;
    let mut out = Vec::new();
    for delta in diff.deltas() {
        if delta.status() != git2::Delta::Added {
            continue; // only paths that would VANISH need carrying over
        }
        let Some(rel) = delta.new_file().path() else {
            continue;
        };
        let path = workdir.join(rel);
        // `is_file` also skips directories and dangling symlinks; a symlink to
        // a real file is carried over as its content, matching how the inject
        // read it in the first place.
        if !path.is_file() {
            continue;
        }
        let perms = std::fs::metadata(&path)?.permissions();
        out.push(CarriedFile {
            bytes: std::fs::read(&path)?,
            path,
            rel: rel.to_path_buf(),
            perms,
            restage: false,
        });
    }
    Ok(out)
}

/// Write the carried-over files back. An inject's carry-over returns its file
/// as a plain, UNTRACKED working-tree file (the checkout already dropped its
/// index entry along with the file, so re-creating the file alone leaves
/// exactly the pre-inject state); a staged-only rescue additionally re-stages
/// the path, because staged is the state it was in before the undo. A file the
/// checkout decided to keep is never clobbered.
fn write_back(repo: &Repository, files: &[CarriedFile]) -> AdgitterResult<()> {
    for f in files {
        if !f.path.exists() {
            if let Some(parent) = f.path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(&f.path, &f.bytes)?;
            // Best-effort: content is what matters; a permission bit that will
            // not apply (e.g. a read-only mount quirk) must not fail the undo.
            let _ = std::fs::set_permissions(&f.path, f.perms.clone());
        }
    }
    // Re-stage in one index round-trip. Done after every file is on disk,
    // since `add_path` reads the working-tree copy.
    let staged: Vec<&CarriedFile> = files.iter().filter(|f| f.restage).collect();
    if !staged.is_empty() {
        let mut index = repo.index()?;
        for f in &staged {
            index.add_path(&f.rel)?;
        }
        index.write()?;
    }
    Ok(())
}

/// Path-based undo: restore the most recent backup **batch** and bring the
/// working tree in line with the restored ref (so undoing a hard reset /
/// merge restores files, not just the ref). Checks the working tree out
/// again whenever ANY ref in the restored batch is the currently checked-out
/// branch — not just a single representative entry — since a descendant-
/// branch remap can fold several refs into one batch and the checked-out one
/// need not be first. Holds the lock. Returns a representative restored
/// backup (see [`reflog_undo`]).
///
/// Undoing an inject additionally carries the injected file back onto disk as
/// an untracked file instead of letting the checkout delete it — see
/// [`carry_over_injected`] for why that one op needs it.
///
/// Regardless of op, staged work that exists in no tree is snapshotted before
/// the hard restore and written back staged afterwards — see
/// [`rescue_staged_only`]; the reset would otherwise destroy content that is
/// recoverable from nowhere.
///
/// Only ever undoes this app's own work. If the newest record's refs are no
/// longer where ADGitter left them, history was changed outside the app and
/// this returns `Ok(None)` rather than force-restoring over the newer state —
/// see `undo.rs`. The UI asks `undo::undo_state` the same question up front, so
/// in practice the button is already disabled and this is the backstop.
///
/// A commit does not take the ref-restore path at all: it is undone from the
/// staged snapshot recorded before it was created, which puts the files back in
/// the index without touching the working tree (`undo::restore_commit`).
pub fn undo_last(repo_path: PathBuf) -> AdgitterResult<Option<Backup>> {
    let _lock = lock_mutations();
    let repo = crate::git::open_repo(&repo_path)?;
    crate::resolve::ensure_not_paused(&repo)?;

    let Some(record) = crate::undo::newest_record(&repo)? else {
        return Ok(None);
    };
    if !crate::undo::is_in_app(&repo, &record)? {
        return Ok(None);
    }
    let key = record.key();
    let group = match record {
        crate::undo::Record::Commit(rec) => {
            let restored = crate::undo::restore_commit(&repo, &rec)?;
            crate::undo::clear_left(&repo, key)?;
            return Ok(Some(restored));
        }
        crate::undo::Record::Backups(group) => group,
    };

    // Peek at the batch first: what an inject's undo has to rescue can only be
    // read while the repository is still in its post-op state.
    let head_name = repo.head().ok().and_then(|h| h.name().map(str::to_string));
    let pending = group.clone();
    let head_moved = head_name
        .as_ref()
        .is_some_and(|hn| pending.iter().any(|b| &b.original_ref == hn));
    // The one condition under which anything below is restored HARD. Decided
    // up front and shared with the reset at the bottom, so neither rescue can
    // run for an undo that will not disturb the index or the working tree at
    // all: reading files a restore will not touch could only fail an undo that
    // was never at risk. (A plain commit's undo is softer still — it returned
    // above, via `undo::restore_commit`, before reaching here.)
    let hard_restore = !group.is_empty() && head_moved;
    let mut carried = match (&head_name, hard_restore) {
        (Some(hn), true) if pending.first().is_some_and(|b| b.op == INJECT_OP) => {
            carry_over_injected(&repo, &pending, hn)?
        }
        _ => Vec::new(),
    };
    // Independent of the op: staged work that is in no tree would otherwise be
    // destroyed irrecoverably. The two sets cannot overlap, and the general
    // path does NOT subsume the inject one: an injected file IS in HEAD's tree,
    // which `rescue_staged_only` excludes, and what makes it need rescuing —
    // that its pre-op home was the user's untracked working tree — is knowable
    // only from the op label. Both steps are load-bearing: stubbing
    // `carry_over_injected` out fails inject's undo tests outright.
    if let (Some(hn), true) = (&head_name, hard_restore) {
        carried.extend(rescue_staged_only(&repo, &pending, hn)?);
    }

    restore_group(&repo, &group)?;
    crate::undo::clear_left(&repo, key)?;
    if hard_restore {
        // A hard reset onto the (already restored) HEAD commit rather than a
        // bare `checkout_head`, for the same reason `inject.rs` uses one: a
        // forced checkout only rewrites index entries for the files it
        // actually touches, so a path that is missing from disk is skipped and
        // its stale index entry survives as a phantom staged add + worktree
        // deletion. Resetting writes the index straight from the restored
        // tree, so index, worktree and HEAD always agree afterwards. Untracked
        // files are left alone either way.
        let head_commit = repo.head()?.peel_to_commit()?;
        let obj = head_commit.as_object().clone();
        let mut co = CheckoutBuilder::new();
        co.force();
        repo.reset(&obj, git2::ResetType::Hard, Some(&mut co))?;
        write_back(&repo, &carried)?;
    }
    Ok(group.into_iter().next())
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Repository, Signature};
    use std::collections::BTreeMap;
    use std::path::Path;

    /// Reachable repository state: HEAD target + all non-backup ref targets.
    /// Equality of two states means refs/HEAD point at the same commits — the
    /// invariant a backup+undo round-trip must restore.
    fn repo_state(repo: &Repository) -> BTreeMap<String, String> {
        let mut m = BTreeMap::new();
        if let Ok(head) = repo.head() {
            if let Some(oid) = head.target() {
                m.insert("HEAD".to_string(), oid.to_string());
            }
        }
        for r in repo.references().unwrap() {
            let r = r.unwrap();
            let name = r.name().unwrap_or_default().to_string();
            if name.starts_with(BACKUP_PREFIX) {
                continue;
            }
            if let Some(oid) = r.target() {
                m.insert(name, oid.to_string());
            }
        }
        m
    }

    /// Commit `content` to `name` on HEAD, returning the new commit oid.
    fn commit_file(repo: &Repository, name: &str, content: &str, parents: &[Oid]) -> Oid {
        let sig = Signature::now("Tester", "t@example.com").unwrap();
        std::fs::write(repo.workdir().unwrap().join(name), content).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new(name)).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let parent_commits: Vec<_> = parents
            .iter()
            .map(|p| repo.find_commit(*p).unwrap())
            .collect();
        let parent_refs: Vec<&git2::Commit> = parent_commits.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, "msg", &tree, &parent_refs)
            .unwrap()
    }

    #[test]
    fn backup_then_undo_restores_ref_state() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();

        let c1 = commit_file(&repo, "a.txt", "1", &[]);
        // Resolve the actual default branch (main or master per git config).
        let branch = repo.head().unwrap().name().unwrap().to_string();
        let c2 = commit_file(&repo, "a.txt", "2", &[c1]);

        let before = repo_state(&repo);
        assert_eq!(before[&branch], c2.to_string());

        // Snapshot, then simulate a rewrite by moving the branch forward.
        let backup = create_backup(&repo, "rebase", &branch).unwrap();
        assert_eq!(backup.original_ref, branch);
        assert_eq!(backup.target, c2.to_string());

        let c3 = commit_file(&repo, "a.txt", "3", &[c2]);
        assert_eq!(repo_state(&repo)[&branch], c3.to_string());
        assert_ne!(repo_state(&repo), before, "branch moved");

        // Undo restores the branch to c2 — reachable state matches the snapshot.
        let restored = reflog_undo(&repo).unwrap().expect("a backup");
        assert_eq!(restored.target, c2.to_string());
        assert_eq!(
            repo_state(&repo),
            before,
            "undo restores reachable ref state"
        );
        assert!(list_backups(&repo).unwrap().is_empty(), "backup consumed");
    }

    #[test]
    fn list_backups_is_newest_first_and_roundtrips_metadata() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let c1 = commit_file(&repo, "a.txt", "1", &[]);
        let branch = repo.head().unwrap().name().unwrap().to_string();
        let _c2 = commit_file(&repo, "a.txt", "2", &[c1]);

        create_backup(&repo, "reset", &branch).unwrap();
        create_backup(&repo, "rebase", &branch).unwrap();

        let list = list_backups(&repo).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].op, "rebase", "newest first");
        assert_eq!(list[0].original_ref, branch);
        assert_eq!(list[1].op, "reset");
    }

    #[test]
    fn undo_with_no_backups_is_noop() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let _c1 = commit_file(&repo, "a.txt", "1", &[]);
        assert!(reflog_undo(&repo).unwrap().is_none());
    }

    #[test]
    fn create_backup_rejects_op_with_slash() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let _c1 = commit_file(&repo, "a.txt", "1", &[]);
        let branch = repo.head().unwrap().name().unwrap().to_string();
        assert!(matches!(
            create_backup(&repo, "bad/op", &branch),
            Err(AdgitterError::Internal(_))
        ));
    }

    #[test]
    fn mutation_lock_serializes() {
        // Sequentially acquiring the lock works; the guard releases on drop.
        {
            let _g = lock_mutations();
        }
        let _g2 = lock_mutations();
    }

    #[test]
    fn undo_last_restores_ref_and_worktree() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = Repository::init(p).unwrap();
        {
            let mut c = repo.config().unwrap();
            c.set_str("user.name", "T").unwrap();
            c.set_str("user.email", "t@e.com").unwrap();
        }
        let write_commit = |content: &str, msg: &str| {
            std::fs::write(p.join("a.txt"), content).unwrap();
            crate::workdir::stage(p.to_path_buf(), vec!["a.txt".into()]).unwrap();
            crate::workdir::commit(p.to_path_buf(), msg.into(), false).unwrap()
        };
        let c1 = write_commit("1", "c1");
        write_commit("2", "c2");

        // Hard reset to c1 (writes a backup, moves the ref, clears the tree).
        crate::history::reset(p.to_path_buf(), c1.clone(), "hard".into()).unwrap();
        assert_eq!(std::fs::read_to_string(p.join("a.txt")).unwrap(), "1");

        let restored = undo_last(p.to_path_buf()).unwrap().expect("a backup");
        assert_eq!(restored.op, "reset");
        assert_eq!(
            std::fs::read_to_string(p.join("a.txt")).unwrap(),
            "2",
            "undo restored the working tree, not just the ref"
        );
    }

    #[test]
    fn add_to_batch_undoes_every_ref_in_one_call() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = Repository::init(p).unwrap();
        let c1 = commit_file(&repo, "a.txt", "1", &[]);
        let branch = repo.head().unwrap().name().unwrap().to_string();
        let c2 = commit_file(&repo, "a.txt", "2", &[c1]);

        // A second, independent branch at c1 — pretend a history op moved
        // both `branch` and `other` and folded both backups into one batch.
        repo.branch("other", &repo.find_commit(c1).unwrap(), false)
            .unwrap();

        let primary = create_backup(&repo, "rebase", &branch).unwrap();
        let secondary = add_to_batch(&repo, &primary, "rebase", "refs/heads/other").unwrap();
        assert_eq!(
            (primary.created_ms, primary.seq),
            (secondary.created_ms, secondary.seq),
            "both backups share the same batch key"
        );

        // Simulate the rewrite: both refs move forward.
        let c3 = commit_file(&repo, "a.txt", "3", &[c2]);
        let mut other_ref = repo.find_reference("refs/heads/other").unwrap();
        other_ref.set_target(c3, "simulated remap").unwrap();

        assert_eq!(list_backups(&repo).unwrap().len(), 2, "two batched backups");

        // ONE undo call restores BOTH refs to their pre-op targets.
        let restored = reflog_undo(&repo).unwrap().expect("a backup");
        assert_eq!(restored.op, "rebase");
        assert_eq!(
            repo.find_reference(&branch).unwrap().target().unwrap(),
            c2,
            "primary branch restored"
        );
        assert_eq!(
            repo.find_reference("refs/heads/other")
                .unwrap()
                .target()
                .unwrap(),
            c1,
            "secondary branch restored by the SAME undo call"
        );
        assert!(
            list_backups(&repo).unwrap().is_empty(),
            "the whole batch was consumed"
        );
    }

    fn init_repo_with_identity(p: &Path) -> Repository {
        let repo = Repository::init(p).unwrap();
        let mut c = repo.config().unwrap();
        c.set_str("user.name", "T").unwrap();
        c.set_str("user.email", "t@e.com").unwrap();
        drop(c);
        repo
    }

    /// Stage `paths` and commit them through the real entry point (the one
    /// that writes the undo record), returning the new sha.
    fn app_commit(p: &Path, paths: &[&str], msg: &str) -> String {
        crate::workdir::stage(
            p.to_path_buf(),
            paths.iter().map(|s| s.to_string()).collect(),
        )
        .unwrap();
        crate::workdir::commit(p.to_path_buf(), msg.into(), false).unwrap()
    }

    /// Staged, never-committed work survives a hard undo and stays STAGED —
    /// for `merge`. Not an op-specific guarantee (see `rescue_staged_only`);
    /// pinned for two unrelated ops precisely because it is general.
    #[test]
    fn hard_undo_of_a_merge_keeps_staged_only_work() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo_with_identity(p);

        std::fs::write(p.join("a.txt"), "base\n").unwrap();
        app_commit(p, &["a.txt"], "base");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();

        crate::branch::create_branch(p.to_path_buf(), "side".into(), "HEAD".into()).unwrap();
        crate::branch::checkout(p.to_path_buf(), "side".into()).unwrap();
        std::fs::write(p.join("side.txt"), "side\n").unwrap();
        app_commit(p, &["side.txt"], "side work");
        crate::branch::checkout(p.to_path_buf(), main).unwrap();
        std::fs::write(p.join("main.txt"), "main\n").unwrap();
        app_commit(p, &["main.txt"], "main work");

        crate::history::merge(p.to_path_buf(), "side".into()).unwrap();

        // Brand-new work, staged but never committed: its only copy is the
        // index + disk.
        std::fs::write(p.join("staged-only.txt"), "precious\n").unwrap();
        crate::workdir::stage(p.to_path_buf(), vec!["staged-only.txt".into()]).unwrap();

        let restored = undo_last(p.to_path_buf()).unwrap().expect("a backup");
        assert_eq!(restored.op, "merge");

        assert_eq!(
            std::fs::read(p.join("staged-only.txt")).unwrap(),
            b"precious\n",
            "staged-only work survives byte-identically"
        );
        let st = crate::workdir::status(p.to_path_buf()).unwrap();
        assert!(
            st.staged
                .iter()
                .any(|e| e.path == "staged-only.txt" && e.status == "new"),
            "and is still STAGED, not merely left on disk: {st:?}"
        );
        // The merge's own content is still correctly reverted — the rescue
        // does not preserve what the undo is supposed to undo.
        assert!(
            !p.join("side.txt").exists(),
            "the merged-in file is still removed"
        );
    }

    /// The same guarantee for `reset`, a different hard-restoring op.
    #[test]
    fn hard_undo_of_a_reset_keeps_staged_only_work() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let _repo = init_repo_with_identity(p);

        std::fs::write(p.join("a.txt"), "one\n").unwrap();
        let c1 = app_commit(p, &["a.txt"], "base");
        std::fs::write(p.join("a.txt"), "two\n").unwrap();
        app_commit(p, &["a.txt"], "second");

        crate::history::reset(p.to_path_buf(), c1, "hard".into()).unwrap();

        std::fs::write(p.join("staged-only.txt"), "precious\n").unwrap();
        crate::workdir::stage(p.to_path_buf(), vec!["staged-only.txt".into()]).unwrap();

        let restored = undo_last(p.to_path_buf()).unwrap().expect("a backup");
        assert_eq!(restored.op, "reset");

        assert_eq!(
            std::fs::read(p.join("staged-only.txt")).unwrap(),
            b"precious\n",
            "staged-only work survives byte-identically"
        );
        let st = crate::workdir::status(p.to_path_buf()).unwrap();
        assert!(
            st.staged
                .iter()
                .any(|e| e.path == "staged-only.txt" && e.status == "new"),
            "and is still STAGED: {st:?}"
        );
        // The reset's undo still restored the committed content it owns.
        assert_eq!(
            std::fs::read(p.join("a.txt")).unwrap(),
            b"two\n",
            "the undone reset's own content came back"
        );
    }

    /// DOCUMENTED ASYMMETRY (see `rescue_staged_only`): a staged
    /// *modification* of a path the restored tree also holds is NOT rescued —
    /// the restored tree's content wins, because restoring it is the undo's
    /// whole job. The user's uncommitted staged edit is lost, and the blob it
    /// made is reachable from nothing afterwards.
    #[test]
    fn hard_undo_lets_the_restored_tree_win_over_a_staged_modification() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo_with_identity(p);

        std::fs::write(p.join("a.txt"), "one\n").unwrap();
        let c1 = app_commit(p, &["a.txt"], "base");
        std::fs::write(p.join("a.txt"), "two\n").unwrap();
        app_commit(p, &["a.txt"], "second");

        crate::history::reset(p.to_path_buf(), c1, "hard".into()).unwrap();

        // Staged MODIFICATION of a committed path — not a new file.
        std::fs::write(p.join("a.txt"), "my uncommitted edit\n").unwrap();
        crate::workdir::stage(p.to_path_buf(), vec!["a.txt".into()]).unwrap();
        let staged_blob = repo
            .index()
            .unwrap()
            .get_path(Path::new("a.txt"), 0)
            .unwrap()
            .id;

        undo_last(p.to_path_buf()).unwrap().expect("a backup");

        assert_eq!(
            std::fs::read(p.join("a.txt")).unwrap(),
            b"two\n",
            "the restored tree's content wins over the staged edit"
        );
        // And the edit really is unrecoverable through the app: the blob may
        // linger in the odb until gc, but no ref reaches it.
        let mut reachable_from_a_ref = false;
        for r in repo.references().unwrap() {
            let r = r.unwrap();
            let Some(oid) = r.target() else { continue };
            if let Ok(c) = repo.find_commit(oid) {
                if c.tree()
                    .unwrap()
                    .get_path(Path::new("a.txt"))
                    .map(|e| e.id())
                    == Ok(staged_blob)
                {
                    reachable_from_a_ref = true;
                }
            }
        }
        assert!(
            !reachable_from_a_ref,
            "the staged edit is reachable from no ref — the HEAD-tree \
             exclusion's cost, documented rather than claimed harmless"
        );
    }

    /// The other half of the HEAD-tree exclusion: a path present in HEAD but
    /// NOT in the restored tree (one the undone op introduced) is reverted —
    /// deleted — even when the user has a staged modification of it.
    #[test]
    fn hard_undo_reverts_a_staged_modification_of_a_head_only_path() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo_with_identity(p);

        std::fs::write(p.join("a.txt"), "base\n").unwrap();
        app_commit(p, &["a.txt"], "base");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();

        crate::branch::create_branch(p.to_path_buf(), "side".into(), "HEAD".into()).unwrap();
        crate::branch::checkout(p.to_path_buf(), "side".into()).unwrap();
        std::fs::write(p.join("side.txt"), "from side\n").unwrap();
        app_commit(p, &["side.txt"], "side work");
        crate::branch::checkout(p.to_path_buf(), main).unwrap();
        std::fs::write(p.join("main.txt"), "main\n").unwrap();
        app_commit(p, &["main.txt"], "main work");

        crate::history::merge(p.to_path_buf(), "side".into()).unwrap();

        // `side.txt` exists only because of the merge, and the user has since
        // staged an edit to it.
        std::fs::write(p.join("side.txt"), "edited after the merge\n").unwrap();
        crate::workdir::stage(p.to_path_buf(), vec!["side.txt".into()]).unwrap();

        undo_last(p.to_path_buf()).unwrap().expect("a backup");

        assert!(
            !p.join("side.txt").exists(),
            "a path the undone op introduced is reverted even with a staged \
             modification pending — it is in HEAD's tree, so the undo owns it"
        );
    }

    #[test]
    fn expire_backups_removes_old_but_keeps_fresh() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path().to_path_buf();
        let repo = Repository::init(&p).unwrap();
        let c1 = commit_file(&repo, "a.txt", "1", &[]);
        let branch = repo.head().unwrap().name().unwrap().to_string();

        // Manufacture an old backup by writing the ref directly, mirroring the
        // `<ms>-<seq>/<op>/<ref>` name format with a timestamp far in the past.
        let old_ref = format!("{BACKUP_PREFIX}1000-0/reword/{branch}");
        repo.reference(&old_ref, c1, false, "old backup").unwrap();

        // A freshly created backup should survive the same expiry pass.
        let fresh = create_backup(&repo, "reword", &branch).unwrap();

        let removed = expire_backups(p, 48 * 3600 * 1000).unwrap();
        assert_eq!(removed, 1);
        assert!(repo.find_reference(&old_ref).is_err(), "old backup expired");
        assert!(
            repo.find_reference(&fresh.backup_ref).is_ok(),
            "fresh backup survives"
        );
    }

    #[test]
    fn expire_backups_on_repo_with_none_is_zero() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path().to_path_buf();
        let repo = Repository::init(&p).unwrap();
        let _c1 = commit_file(&repo, "a.txt", "1", &[]);

        let removed = expire_backups(p, 48 * 3600 * 1000).unwrap();
        assert_eq!(removed, 0);
    }
}
