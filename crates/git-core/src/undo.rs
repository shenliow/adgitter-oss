//! In-app-only undo: what ADGitter changed, ADGitter can undo — nothing else.
//!
//! `mutate.rs` records where a ref *was* before an operation (the restore
//! point). That alone is not enough to undo safely: it says nothing about
//! whether the ref is still where this app put it. If history moved
//! underneath — a commit from the terminal, another git tool, anything that
//! records no backup of its own — a forced restore would silently overwrite
//! the newer position and everything added since would become reachable from
//! no ref at all.
//!
//! So every undoable in-app action also records where it **left** the ref,
//! and [`classify`] compares that mark against reality:
//!
//! * mark matches  → the app is still the last writer; Undo is on offer.
//! * mark differs, or the ref vanished (or re-appeared) → history was changed
//!   outside the app; Undo is **unavailable**, with
//!   [`UndoBlockedReason::ExternalChange`] so the UI can say why.
//!
//! Unavailable is a dead end for that record on purpose. Nothing re-validates
//! or repairs it; the next in-app change opens a fresh record with a fresh
//! mark, and that re-arms Undo for the new action only.
//!
//! Where the state lives, and why each thing lives where it does:
//!
//! | store | holds |
//! |---|---|
//! | `refs/adgitter/backup/<ms>-<seq>/<op>/<ref>` | the restore point (`mutate.rs`, unchanged) |
//! | `refs/adgitter/commit-undo/<ms>-<seq>/<parent>/<ref>` → staged index TREE | a commit's staged-index snapshot; `<parent>` is the pre-commit tip in hex, or `unborn` (see below), and `<ref>` is the branch or `HEAD` when detached |
//! | `.git/adgitter-undo.json` | the left-marks |
//!
//! A ref is the right home for the first two because they have to **anchor an
//! object**: a ref is what keeps the restore point and the staged tree alive
//! against gc. The left-marks anchor nothing — they are pure bookkeeping, an
//! oid written down so it can be compared later — and making them refs turned
//! out to be actively wrong: everything that enumerates refs then sees them.
//! `git::list_commits` walks `refs/*`, and the ref namespace is the repository's
//! public surface, so internal notes do not belong in it. They go to a JSON
//! file beside `resolve.rs`'s `adgitter-resolve.json`, which keeps per-repo
//! op state the same way for the same reason.
//!
//! # Why a commit needs its own record
//!
//! Creating a commit produces no reflog entry to rewind, and it must NOT be
//! undone the way the other ops are. `undo_last`'s generic path force-restores
//! the ref and then hard-resets the working tree when that ref is checked out
//! — which for a commit would wipe the very content the user just committed
//! out of both the index and the working tree. Destroying work is not an undo.
//!
//! Instead, `workdir::commit` records a snapshot *before* the real commit
//! exists: a ref pointing straight at the **index tree** — the staged files
//! exactly as they stood when the user pressed Commit. That ref is the anchor,
//! which is the point: a tree held by a ref keeps itself and all its blobs
//! reachable, so even if the commit later leaves the branch (by this undo, or
//! by anything else) gc cannot eat the staged content out from under a pending
//! Undo.
//!
//! The anchor is deliberately a **tree, not a commit**. `git::list_commits`
//! walks `refs/*`, so a snapshot commit would surface in the graph as a
//! duplicate of every commit the user makes; a tree ref is invisible to a
//! revwalk while anchoring exactly the same objects.
//!
//! The restore point travels in the ref *name* instead (`<parent>`), the same
//! trick the left-marks use: the pre-commit tip in hex, or the literal
//! `unborn` when the branch had no commit yet. It needs no anchor of its own —
//! while the record is live the tip is the committed commit's parent and so is
//! reachable from the branch, and the moment Undo consumes the record it
//! becomes the branch tip itself.
//!
//! A commit made on a **detached HEAD** is recorded the same way, with `HEAD`
//! itself as the `<ref>`: it is the direct reference the commit moved, so it
//! anchors nothing extra and compares like any other ref. Such a commit is as
//! real as any other and must be as undoable — the alternative, recording
//! nothing, left Undo reaching past it to reverse some older, unrelated op.
//!
//! Undoing it ([`restore_commit`]) moves the branch back to that parent (or
//! deletes the branch, returning it to unborn; or moves a detached HEAD back
//! to the parent, still detached) and rewrites the **index** from
//! the snapshot tree. The working tree is never touched: a file the user kept
//! editing after committing keeps its newer bytes on disk, and only the
//! staging area is rewound.

use std::path::PathBuf;

use git2::{Oid, Repository};
use serde::Serialize;

use crate::error::AdgitterResult;
use crate::mutate::{list_backups, Backup};

const COMMIT_UNDO_PREFIX: &str = "refs/adgitter/commit-undo/";

/// Where the left-marks are kept, under the repository's `.git`.
const MARKS_FILE: &str = "adgitter-undo.json";

/// `<parent>` segment of a commit-undo record meaning the branch had no commit
/// at all — the record is for a repository's very first commit, and undoing it
/// returns the branch to unborn.
const UNBORN: &str = "unborn";

/// The ref a commit made on a **detached HEAD** moved. There is no branch to
/// name, and `repo.find_reference("HEAD")` on a detached HEAD is a *direct*
/// reference whose target is the commit, so `HEAD` names the thing that moved
/// as precisely as a branch name does: a record and a left-mark can both use
/// it, and the mark comparison in [`is_in_app`] reads it the same way as any
/// other ref. (A re-attached HEAD is symbolic and has no target, so it reads
/// as "the ref moved under us" — correctly unavailable, not silently wrong.)
pub(crate) const HEAD_REF: &str = "HEAD";

/// The `op` label recorded for a plain commit's undo record.
pub(crate) const COMMIT_OP: &str = "commit";

/// Identifies one undoable action. Shared by every ref an action moved, so a
/// multi-ref rewrite undoes as a single unit (`mutate::add_to_batch`).
pub(crate) type BatchKey = (u64, u64);

/// Why Undo is not being offered. Serialized in snake_case so the frontend
/// switches on `"external_change"` rather than a Rust variant spelling.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UndoBlockedReason {
    /// No in-app action is on record — nothing was done yet, or the record
    /// already expired. The ordinary empty state, not a warning.
    Nothing,
    /// History moved outside ADGitter since the last in-app action, so that
    /// action can no longer be reversed without trampling the newer state.
    /// The one case the UI has to explain, or a dead Undo button is a mystery.
    ExternalChange,
    /// A conflict resolution is still waiting; the paused op has not landed.
    Paused,
}

/// Whether Undo is on offer, and what it would reverse. Computed in one pass
/// over the repository so the UI never has to assemble the rule from several
/// probes that could disagree as the repo changes between them.
#[derive(Debug, Clone, Serialize)]
pub struct UndoState {
    pub available: bool,
    /// The op label Undo would reverse (e.g. `rebase`, `commit`), when available.
    pub op: Option<String>,
    /// Why not, when unavailable. `None` exactly when `available`.
    pub reason: Option<UndoBlockedReason>,
}

impl UndoState {
    fn blocked(reason: UndoBlockedReason) -> Self {
        Self {
            available: false,
            op: None,
            reason: Some(reason),
        }
    }
}

/// Where an in-app action left the refs it moved.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct LeftMark {
    pub created_ms: u64,
    pub seq: u64,
    /// The op label, for debugging a stale file by eye.
    pub op: String,
    /// One entry per ref the action moved: the ref name, and the oid in hex
    /// the action left it at — `None` when the action removed the ref (a
    /// deliberate `delete-branch`), which must not read as an outside change.
    pub left: Vec<(String, Option<String>)>,
}

impl LeftMark {
    fn key(&self) -> BatchKey {
        (self.created_ms, self.seq)
    }
}

fn marks_path(repo: &Repository) -> PathBuf {
    repo.path().join(MARKS_FILE)
}

/// Read the left-marks. A missing or unparseable file reads as "no marks",
/// which disarms Undo rather than guessing — the conservative direction.
fn left_marks(repo: &Repository) -> AdgitterResult<Vec<LeftMark>> {
    let Ok(body) = std::fs::read_to_string(marks_path(repo)) else {
        return Ok(Vec::new());
    };
    Ok(serde_json::from_str(&body).unwrap_or_default())
}

fn write_marks(repo: &Repository, marks: &[LeftMark]) -> AdgitterResult<()> {
    if marks.is_empty() {
        let _ = std::fs::remove_file(marks_path(repo));
        return Ok(());
    }
    let json = serde_json::to_string_pretty(marks).map_err(|e| {
        crate::error::AdgitterError::Internal(format!("failed to serialize undo marks: {e}"))
    })?;
    std::fs::write(marks_path(repo), json)?;
    Ok(())
}

/// A commit's staged-index snapshot record.
#[derive(Debug, Clone)]
pub(crate) struct CommitUndo {
    /// The record ref itself, so it can be deleted when consumed.
    pub record_ref: String,
    /// The ref the commit moved: the branch it was made on, or [`HEAD_REF`]
    /// when it was made on a detached HEAD, where HEAD is itself the direct
    /// reference that moved and there is no branch to name.
    pub original_ref: String,
    /// The staged index, as a tree. The record ref points at this, which is
    /// what keeps it and its blobs alive.
    pub tree: Oid,
    /// The tip before the commit — where Undo puts the ref back.
    /// `None` means the branch was unborn and Undo deletes it again.
    pub parent: Option<Oid>,
    pub key: BatchKey,
}

/// Which shape "put the ref back" takes for a commit record. All three are
/// the same decision — where does the ref this commit moved belong now — and
/// differ only in what the ref is and whether it survives at all.
#[derive(Debug, Clone, Copy)]
enum Restore {
    /// A branch: move it back to the commit's parent.
    Branch(Oid),
    /// A detached HEAD: re-point HEAD itself at the parent and leave it
    /// detached, so undoing a detached-HEAD commit does not quietly attach to
    /// a branch the user was not on.
    Detached(Oid),
    /// A branch with no parent to return to — the repository's very first
    /// commit. Deleting the branch ref is exactly the unborn state again.
    Unborn,
}

impl Restore {
    /// The restore point as a `Backup.target` string; `Unborn` has no oid, and
    /// reports the zero oid the way it always has.
    fn target(self) -> String {
        match self {
            Self::Branch(oid) | Self::Detached(oid) => oid.to_string(),
            Self::Unborn => Oid::zero().to_string(),
        }
    }
}

impl CommitUndo {
    fn restore(&self) -> Restore {
        match (self.parent, self.original_ref == HEAD_REF) {
            // A detached HEAD is detached *at* a commit, so it always has a
            // parent: `record_commit_snapshot` never names `HEAD` without
            // one, which is why there is no detached-and-unborn shape.
            (Some(parent), true) => Restore::Detached(parent),
            (Some(parent), false) => Restore::Branch(parent),
            (None, _) => Restore::Unborn,
        }
    }
}

/// The newest undoable action, whichever kind it is.
pub(crate) enum Record {
    /// A ref-restore action: every backup sharing the newest batch key.
    Backups(Vec<Backup>),
    /// A commit, undone from its staged snapshot instead.
    Commit(CommitUndo),
}

impl Record {
    pub(crate) fn key(&self) -> BatchKey {
        match self {
            // Every backup in a batch shares the key by construction.
            Self::Backups(g) => g.first().map(|b| (b.created_ms, b.seq)).unwrap_or((0, 0)),
            Self::Commit(c) => c.key,
        }
    }

    pub(crate) fn op(&self) -> String {
        match self {
            Self::Backups(g) => g
                .first()
                .map(|b| b.op.clone())
                .unwrap_or_else(|| "unknown".into()),
            Self::Commit(_) => COMMIT_OP.to_string(),
        }
    }

    /// Every ref this action moved, with a fallback oid that is guaranteed to
    /// exist (used to anchor a `gone` mark, which has no "left" oid of its own).
    fn refs(&self) -> Vec<(String, String)> {
        match self {
            Self::Backups(g) => g
                .iter()
                .map(|b| (b.original_ref.clone(), b.target.clone()))
                .collect(),
            // The anchor oid is only ever used for a `gone` mark, which a
            // commit record cannot produce (the branch always exists once the
            // commit is made), so the tree stands in harmlessly.
            Self::Commit(c) => vec![(c.original_ref.clone(), c.tree.to_string())],
        }
    }
}

fn parse_commit_undo(name: &str, target: Oid) -> Option<CommitUndo> {
    let rest = name.strip_prefix(COMMIT_UNDO_PREFIX)?;
    let (head, after) = rest.split_once('/')?; // head = "<ms>-<seq>"
                                               // Only the first two segments are metadata; `original_ref` keeps its slashes.
    let (parent, original_ref) = after.split_once('/')?;
    let (ms, seq) = head.split_once('-')?;
    let parent = if parent == UNBORN {
        None
    } else {
        Some(Oid::from_str(parent).ok()?)
    };
    Some(CommitUndo {
        record_ref: name.to_string(),
        original_ref: original_ref.to_string(),
        tree: target,
        parent,
        key: (ms.parse().ok()?, seq.parse().ok()?),
    })
}

fn commit_records(repo: &Repository) -> AdgitterResult<Vec<CommitUndo>> {
    let mut out = Vec::new();
    for r in repo.references()? {
        let r = r?;
        let Some(name) = r.name() else { continue };
        let Some(target) = r.target() else { continue };
        if let Some(c) = parse_commit_undo(name, target) {
            out.push(c);
        }
    }
    Ok(out)
}

/// The newest undoable action across both record namespaces, or `None` when
/// there is nothing on record.
///
/// Commit records deliberately live in their own namespace rather than in
/// `refs/adgitter/backup/`: `list_backups` is public API that other crates' restore
/// paths and a good deal of test scaffolding read as "the backups the
/// ops under test wrote", and folding commits into it would change what every
/// one of those callers sees. Ordering is still shared, because both
/// namespaces are keyed by the same `(created_ms, seq)` pair — so the newest
/// action wins regardless of which kind it is, and a commit can never be
/// skipped over in favour of an older rebase.
pub(crate) fn newest_record(repo: &Repository) -> AdgitterResult<Option<Record>> {
    let backups = list_backups(repo)?; // newest-first
    let newest_backup = backups.first().map(|b| (b.created_ms, b.seq));
    let commits = commit_records(repo)?;
    let newest_commit = commits.iter().map(|c| c.key).max();

    match (newest_backup, newest_commit) {
        (None, None) => Ok(None),
        (Some(bk), Some(ck)) if ck > bk => Ok(Some(Record::Commit(
            commits
                .into_iter()
                .find(|c| c.key == ck)
                .expect("just found"),
        ))),
        (Some(bk), _) => Ok(Some(Record::Backups(
            backups
                .into_iter()
                .filter(|b| (b.created_ms, b.seq) == bk)
                .collect(),
        ))),
        (None, Some(ck)) => Ok(Some(Record::Commit(
            commits
                .into_iter()
                .find(|c| c.key == ck)
                .expect("just found"),
        ))),
    }
}

/// Is `record` still exactly where the app left it?
///
/// Requires a left-mark for **every** ref the action moved, and requires each
/// one to match. A record with no marks at all cannot be shown to be this
/// app's work (it predates this mechanism, or an op forgot to seal), and the
/// conservative answer is the safe one: refuse rather than force-restore over
/// a position we cannot vouch for.
///
/// Multi-ref batches are all-or-nothing. A history op that also re-based
/// descendant branches folds every ref it moved into one batch precisely
/// because they only make sense together; restoring the subset that still
/// matches would leave history half-rewritten, in a shape the user never had
/// and cannot reason about — strictly worse than declining. So if any single
/// ref in the batch has moved, the batch is not atomically undoable and Undo
/// goes unavailable for all of it.
pub(crate) fn is_in_app(repo: &Repository, record: &Record) -> AdgitterResult<bool> {
    let key = record.key();
    let Some(mark) = left_marks(repo)?.into_iter().find(|m| m.key() == key) else {
        return Ok(false);
    };
    for (refname, _) in record.refs() {
        let Some((_, left)) = mark.left.iter().find(|(r, _)| *r == refname) else {
            return Ok(false); // partially sealed — cannot vouch for the whole batch
        };
        let now = repo
            .find_reference(&refname)
            .ok()
            .and_then(|r| r.target())
            .map(|o| o.to_string());
        let matches = match (&now, left) {
            (Some(now), Some(left)) => now == left,
            // The op removed the ref and it is still absent.
            (None, None) => true,
            // Either the ref vanished under us, or something re-created a ref
            // the op had removed. Both are changes from outside.
            _ => false,
        };
        if !matches {
            return Ok(false);
        }
    }
    Ok(true)
}

/// The single place the "can this be undone" rule is decided. The frontend
/// asks this one question instead of probing refs itself, so the rule exists
/// once, in one language, and cannot be read differently by the button and by
/// the action behind it.
pub(crate) fn classify(repo: &Repository) -> AdgitterResult<UndoState> {
    // A paused op has not landed yet; there is nothing finished to reverse.
    if crate::resolve::read_paused(repo).is_some() {
        return Ok(UndoState::blocked(UndoBlockedReason::Paused));
    }
    let Some(record) = newest_record(repo)? else {
        return Ok(UndoState::blocked(UndoBlockedReason::Nothing));
    };
    if !is_in_app(repo, &record)? {
        return Ok(UndoState::blocked(UndoBlockedReason::ExternalChange));
    }
    Ok(UndoState {
        available: true,
        op: Some(record.op()),
        reason: None,
    })
}

/// Whether Undo is on offer for `repo_path`, for the UI to reflect. Read-only:
/// it takes no mutation lock and changes nothing.
pub fn undo_state(repo_path: PathBuf) -> AdgitterResult<UndoState> {
    let repo = crate::git::open_repo(&repo_path)?;
    classify(&repo)
}

/// Record where the action identified by `key` left every ref it moved.
/// Called once, after the action has finished and its refs have settled.
///
/// Overwrites any marks already carrying `key`, so a re-seal replaces rather
/// than accumulating a second, contradictory mark for the same ref.
fn mark_left(
    repo: &Repository,
    key: BatchKey,
    op: &str,
    refs: &[(String, String)],
) -> AdgitterResult<()> {
    let left = refs
        .iter()
        .map(|(refname, _)| {
            let now = repo
                .find_reference(refname)
                .ok()
                .and_then(|r| r.target())
                .map(|o| o.to_string());
            (refname.clone(), now)
        })
        .collect();
    let mut marks = left_marks(repo)?;
    marks.retain(|m| m.key() != key);
    marks.push(LeftMark {
        created_ms: key.0,
        seq: key.1,
        op: op.to_string(),
        left,
    });
    write_marks(repo, &marks)
}

/// Seal the batch `batch` belongs to: record where every ref in it now sits,
/// which is what re-arms Undo for this action. Call it as the last step of a
/// successful op, once the refs have stopped moving.
///
/// An op that never seals is simply not undoable — [`is_in_app`] refuses a
/// record it has no marks for — so forgetting this is a loss of function, not
/// a loss of data.
pub(crate) fn seal(repo: &Repository, batch: &Backup) -> AdgitterResult<()> {
    let key = (batch.created_ms, batch.seq);
    let group: Vec<Backup> = list_backups(repo)?
        .into_iter()
        .filter(|b| (b.created_ms, b.seq) == key)
        .collect();
    let refs = Record::Backups(group).refs();
    mark_left(repo, key, &batch.op, &refs)
}

/// [`seal`] for callers outside this crate (a history rewrite elsewhere that
/// writes a backup through the public `create_backup` and so has to be able to
/// seal it too — an unsealed batch would be treated as somebody else's work and
/// would block Undo until the next sealed action).
pub fn seal_backup(repo: &Repository, batch: &Backup) -> AdgitterResult<()> {
    seal(repo, batch)
}

/// Drop every left-mark for `key`, once its record has been consumed.
pub(crate) fn clear_left(repo: &Repository, key: BatchKey) -> AdgitterResult<()> {
    let mut marks = left_marks(repo)?;
    marks.retain(|m| m.key() != key);
    write_marks(repo, &marks)
}

/// A commit's undo record, between being written and the commit being made.
pub(crate) struct PendingCommitUndo {
    key: BatchKey,
    moved_ref: String,
}

/// Record the staged index as a snapshot *before* the commit is created, so
/// undoing the commit can put the staging area back exactly as it was.
///
/// `index_tree` is the tree the commit is about to be made from —
/// `workdir::commit` writes the whole index, so it is precisely "the staged
/// files" and nothing else. `moved_ref` is the ref the commit will move: a
/// branch, or [`HEAD_REF`] on a detached HEAD. `parent` is where that ref
/// points right now, or `None` on an unborn branch (the repository's first
/// commit), which is how [`restore_commit`] later knows to return the branch
/// to unborn rather than to some parent it never had.
///
/// The record ref points at the tree itself, so the tree and every blob under
/// it stay reachable on their own account — not merely as a by-product of the
/// commit that is about to be made and may later be removed.
pub(crate) fn record_commit_snapshot(
    repo: &Repository,
    moved_ref: &str,
    index_tree: &git2::Tree,
    parent: Option<&git2::Commit>,
) -> AdgitterResult<PendingCommitUndo> {
    let (ms, seq) = crate::mutate::next_batch_key();
    let parent_seg = match parent {
        Some(c) => c.id().to_string(),
        None => UNBORN.to_string(),
    };
    let name = format!("{COMMIT_UNDO_PREFIX}{ms}-{seq}/{parent_seg}/{moved_ref}");
    repo.reference(
        &name,
        index_tree.id(),
        true,
        "adgitter undo: staged index snapshot",
    )?;
    Ok(PendingCommitUndo {
        key: (ms, seq),
        moved_ref: moved_ref.to_string(),
    })
}

/// Seal a commit's record once the commit exists: `new_tip` is where the app
/// left the branch, and is what a later Undo checks against.
pub(crate) fn seal_commit(
    repo: &Repository,
    pending: &PendingCommitUndo,
    new_tip: Oid,
) -> AdgitterResult<()> {
    mark_left(
        repo,
        pending.key,
        COMMIT_OP,
        &[(pending.moved_ref.clone(), new_tip.to_string())],
    )
}

/// Undo a commit from its snapshot: take the commit out of the branch's
/// history and stage the snapshot's content again.
///
/// Deliberately NOT the forced ref-restore the other ops use. That path
/// hard-resets the working tree whenever the restored ref is checked out,
/// which here would delete the committed content from disk — the one thing an
/// undo must never do. Instead:
///
/// * the branch moves back to the snapshot's parent, or is deleted when the
///   snapshot has none (undoing a repository's first commit returns the branch
///   to unborn, with the content still staged), or — when the commit was made
///   on a detached HEAD — HEAD itself moves back to the parent and stays
///   detached, leaving every branch exactly where it was;
/// * the index is rewritten from the snapshot tree;
/// * the working tree is left strictly alone, so anything the user edited
///   after committing keeps its newer bytes on disk.
pub(crate) fn restore_commit(repo: &Repository, rec: &CommitUndo) -> AdgitterResult<Backup> {
    // Resolve the staged tree BEFORE anything moves, so a record whose objects
    // somehow went missing fails with the repository untouched.
    let tree = repo.find_tree(rec.tree)?;
    let restore = rec.restore();

    match restore {
        Restore::Branch(parent) => {
            repo.reference(
                &rec.original_ref,
                parent,
                true,
                "adgitter undo: commit (branch restored)",
            )?;
        }
        Restore::Detached(parent) => {
            // `set_head_detached` rather than writing a ref called `HEAD`: it
            // is the call that is *defined* to leave HEAD direct, so the undo
            // cannot accidentally re-attach, and it touches neither the index
            // nor the working tree — the staging rewrite below stays the only
            // content change, exactly as on the branch path. Whatever branch
            // the user detached from is not named here and does not move.
            repo.set_head_detached(parent)?;
        }
        Restore::Unborn => {
            // Back to unborn. `repo.head()` fails outright on an unborn HEAD,
            // so nothing here may go through it; deleting the branch ref while
            // HEAD stays symbolic to it is exactly the unborn state.
            if let Ok(mut r) = repo.find_reference(&rec.original_ref) {
                r.delete()?;
            }
        }
    }

    // Stage the snapshot: write the index from its tree and nothing else. No
    // checkout, no reset — the working tree is not ours to rewind.
    let mut index = repo.index()?;
    index.read_tree(&tree)?;
    index.write()?;

    if let Ok(mut r) = repo.find_reference(&rec.record_ref) {
        r.delete()?;
    }

    Ok(Backup {
        backup_ref: rec.record_ref.clone(),
        op: COMMIT_OP.to_string(),
        original_ref: rec.original_ref.clone(),
        target: restore.target(),
        created_ms: rec.key.0,
        seq: rec.key.1,
    })
}

/// Delete commit-undo records older than `max_age_ms`, and every left-mark
/// whose record is gone. Returns the number of commit records removed, so
/// `expire_backups` can add it to its own tally.
///
/// Left-marks are metadata, not records: they are cleaned up whenever nothing
/// refers to them any more, and are not counted.
pub(crate) fn expire(repo: &Repository, now_ms: u64, max_age_ms: u64) -> AdgitterResult<usize> {
    let mut removed = 0usize;
    for rec in commit_records(repo)? {
        if rec.key.0 + max_age_ms >= now_ms {
            continue;
        }
        if let Ok(mut r) = repo.find_reference(&rec.record_ref) {
            r.delete()?;
            removed += 1;
        }
    }

    // Any mark whose record no longer exists is dead weight; dropping it also
    // releases the object it was anchoring.
    let live: Vec<BatchKey> = list_backups(repo)?
        .iter()
        .map(|b| (b.created_ms, b.seq))
        .chain(commit_records(repo)?.iter().map(|c| c.key))
        .collect();
    let mut marks = left_marks(repo)?;
    marks.retain(|m| live.contains(&m.key()));
    write_marks(repo, &marks)?;
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mutate::{list_backups, undo_last};
    use crate::workdir;
    use git2::{Repository, Signature};
    use std::path::Path;

    fn init_repo(dir: &Path) -> Repository {
        let repo = Repository::init(dir).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Tester").unwrap();
        cfg.set_str("user.email", "t@example.com").unwrap();
        repo
    }

    fn write(dir: &Path, name: &str, content: &str) {
        std::fs::write(dir.join(name), content).unwrap();
    }

    /// Commit `name`/`content` the way the app does: stage, then commit.
    fn app_commit(p: &Path, name: &str, content: &str, msg: &str) -> String {
        write(p, name, content);
        workdir::stage(p.to_path_buf(), vec![name.to_string()]).unwrap();
        workdir::commit(p.to_path_buf(), msg.into(), false).unwrap()
    }

    /// A commit made WITHOUT going through the app — what a terminal `git
    /// commit` or another git tool does: it records no undo state of any kind.
    fn outside_commit(repo: &Repository, name: &str, content: &str) -> git2::Oid {
        let p = repo.workdir().unwrap().to_path_buf();
        write(&p, name, content);
        let sig = Signature::now("Outsider", "o@example.com").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new(name)).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let parent = repo.head().unwrap().peel_to_commit().unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "outside", &tree, &[&parent])
            .unwrap()
    }

    /// The staged paths, with the exact blob bytes the index holds for each —
    /// `status` alone only says "staged", which cannot tell a correct restore
    /// from one that staged the wrong content.
    fn staged_blobs(repo: &Repository) -> Vec<(String, Vec<u8>)> {
        let mut index = repo.index().unwrap();
        // Every op opens its own repository handle and writes the index file;
        // this handle's in-memory copy would otherwise be whatever it last
        // read, which silently turns these assertions into no-ops.
        index.read(true).unwrap();
        let mut out: Vec<(String, Vec<u8>)> = index
            .iter()
            .map(|e| {
                let path = String::from_utf8(e.path.clone()).unwrap();
                let blob = repo.find_blob(e.id).unwrap();
                (path, blob.content().to_vec())
            })
            .collect();
        out.sort();
        out
    }

    fn head_branch(repo: &Repository) -> String {
        repo.find_reference("HEAD")
            .unwrap()
            .symbolic_target()
            .unwrap()
            .to_string()
    }

    // ---------------------------------------------------------------------
    // Part 1 — only in-app changes are undoable
    // ---------------------------------------------------------------------

    /// THE assertion for part 1: a commit made outside the app moves the
    /// branch off where ADGitter left it, and that makes Undo unavailable
    /// rather than silently rewinding over the outside work.
    #[test]
    fn an_externally_moved_ref_makes_undo_unavailable() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);

        app_commit(p, "a.txt", "1", "first");
        app_commit(p, "b.txt", "2", "second");

        // In-app work is undoable.
        let before = undo_state(p.to_path_buf()).unwrap();
        assert!(before.available, "in-app commit is undoable: {before:?}");
        assert_eq!(before.op.as_deref(), Some("commit"));
        assert_eq!(before.reason, None);

        // Now history moves underneath us, with no record of its own.
        let outside = outside_commit(&repo, "outside.txt", "from the terminal");

        let after = undo_state(p.to_path_buf()).unwrap();
        assert!(
            !after.available,
            "history moved outside the app — Undo must not be offered: {after:?}"
        );
        assert_eq!(after.reason, Some(UndoBlockedReason::ExternalChange));

        // And the action itself refuses, so the button and the behaviour agree.
        assert!(
            undo_last(p.to_path_buf()).unwrap().is_none(),
            "undo_last refuses an externally-moved ref"
        );
        assert_eq!(
            repo.head().unwrap().peel_to_commit().unwrap().id(),
            outside,
            "the outside commit is still the branch tip — nothing was overwritten"
        );
    }

    /// Unavailable is not permanent: the next in-app change records a fresh
    /// position and re-arms Undo, for that new action only.
    #[test]
    fn the_next_in_app_change_re_arms_undo() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);

        app_commit(p, "a.txt", "1", "first");
        outside_commit(&repo, "outside.txt", "x");
        assert!(!undo_state(p.to_path_buf()).unwrap().available);

        // A fresh in-app commit opens a new record with a new mark.
        let new_tip = app_commit(p, "c.txt", "3", "third");
        let state = undo_state(p.to_path_buf()).unwrap();
        assert!(
            state.available,
            "re-armed by the next in-app change: {state:?}"
        );
        assert_eq!(state.op.as_deref(), Some("commit"));

        // And it undoes the NEW action, not the stale one.
        let undone = undo_last(p.to_path_buf()).unwrap().expect("undone");
        assert_eq!(undone.op, "commit");
        assert_ne!(
            repo.head()
                .unwrap()
                .peel_to_commit()
                .unwrap()
                .id()
                .to_string(),
            new_tip,
            "the new commit left the branch"
        );
    }

    /// An op whose ref is deleted on purpose (`delete-branch`) records that
    /// absence, so a still-absent ref reads as the app's own doing and stays
    /// undoable — the `gone` mark must not be mistaken for an outside change.
    #[test]
    fn a_deliberately_deleted_ref_stays_undoable() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        app_commit(p, "a.txt", "1", "first");
        let tip = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("doomed", &tip, false).unwrap();

        crate::branch::delete_branch(p.to_path_buf(), "doomed".into()).unwrap();

        let state = undo_state(p.to_path_buf()).unwrap();
        assert!(state.available, "a deleted branch is undoable: {state:?}");
        assert_eq!(state.op.as_deref(), Some("delete-branch"));

        undo_last(p.to_path_buf()).unwrap().expect("undone");
        assert!(
            repo.find_reference("refs/heads/doomed").is_ok(),
            "the branch is back"
        );
    }

    /// If something re-creates a ref the app deliberately removed, that is
    /// still an outside change and the undo is off.
    #[test]
    fn re_creating_a_deleted_ref_outside_blocks_undo() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        app_commit(p, "a.txt", "1", "first");
        let tip = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("doomed", &tip, false).unwrap();
        crate::branch::delete_branch(p.to_path_buf(), "doomed".into()).unwrap();

        // Somebody else puts it back, somewhere else.
        repo.reference("refs/heads/doomed", tip.id(), false, "outside")
            .unwrap();

        let state = undo_state(p.to_path_buf()).unwrap();
        assert!(!state.available, "{state:?}");
        assert_eq!(state.reason, Some(UndoBlockedReason::ExternalChange));
    }

    /// Multi-ref stance: a batch is undone as one unit, so ONE moved ref in it
    /// makes the whole batch unavailable. Restoring the matching subset would
    /// leave history half-rewritten.
    #[test]
    fn one_moved_ref_blocks_the_whole_batch() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        app_commit(p, "a.txt", "1", "first");
        let c1 = repo.head().unwrap().peel_to_commit().unwrap().id();
        app_commit(p, "b.txt", "2", "second");
        let c2 = repo.head().unwrap().peel_to_commit().unwrap().id();
        let branch = head_branch(&repo);
        repo.branch("side", &repo.find_commit(c1).unwrap(), false)
            .unwrap();

        // Two refs moved by one logical action, folded into one batch — the
        // shape `remap.rs` produces when a rewrite re-bases descendant
        // branches alongside the branch the op was aimed at.
        let primary = crate::mutate::create_backup(&repo, "rebase", &branch).unwrap();
        crate::mutate::add_to_batch(&repo, &primary, "rebase", "refs/heads/side").unwrap();
        assert_eq!(
            primary.target,
            c2.to_string(),
            "restore point for the branch"
        );

        // The "op" moves both refs to a new tip.
        let c3 = outside_commit(&repo, "c.txt", "3"); // moves `branch` to c3
        repo.find_reference("refs/heads/side")
            .unwrap()
            .set_target(c3, "batch move")
            .unwrap();
        seal(&repo, &primary).unwrap();
        assert!(
            undo_state(p.to_path_buf()).unwrap().available,
            "both refs are where the app left them"
        );

        // Only the SECONDARY ref moves afterwards, outside the app.
        repo.find_reference("refs/heads/side")
            .unwrap()
            .set_target(c2, "outside")
            .unwrap();

        let state = undo_state(p.to_path_buf()).unwrap();
        assert!(
            !state.available,
            "one moved ref disarms the whole batch: {state:?}"
        );
        assert_eq!(state.reason, Some(UndoBlockedReason::ExternalChange));
        assert!(undo_last(p.to_path_buf()).unwrap().is_none());
        assert_eq!(
            repo.find_reference(&branch).unwrap().target().unwrap(),
            c3,
            "the ref that DID still match was not restored to {c2} either — all or nothing"
        );
    }

    /// A batch with no mark at all cannot be shown to be this app's work, so
    /// it is refused. This is what a record written before this mechanism
    /// existed looks like.
    #[test]
    fn an_unsealed_record_is_not_undoable() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        app_commit(p, "a.txt", "1", "first");
        let branch = head_branch(&repo);

        // A backup with no left-mark beside it.
        crate::mutate::create_backup(&repo, "reset", &branch).unwrap();

        let state = undo_state(p.to_path_buf()).unwrap();
        assert!(!state.available, "{state:?}");
        assert_eq!(state.reason, Some(UndoBlockedReason::ExternalChange));
    }

    /// Nothing recorded at all is the ordinary empty state, not a warning.
    #[test]
    fn a_fresh_repo_reports_nothing_to_undo() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let _repo = init_repo(p);
        let state = undo_state(p.to_path_buf()).unwrap();
        assert!(!state.available);
        assert_eq!(state.reason, Some(UndoBlockedReason::Nothing));
        assert_eq!(state.op, None);
    }

    // ---------------------------------------------------------------------
    // Part 2 — a commit is undone from its staged snapshot
    // ---------------------------------------------------------------------

    /// THE assertion for part 2: undoing a commit takes it out of the branch
    /// and stages exactly what was staged when Commit was pressed — byte for
    /// byte — while leaving the working tree alone.
    #[test]
    fn undoing_a_commit_restores_the_recorded_staging_exactly() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);

        app_commit(p, "base.txt", "base", "base");
        let parent = repo.head().unwrap().peel_to_commit().unwrap().id();

        // Stage two files and commit them — this is the state Undo must restore.
        write(p, "one.txt", "staged-one");
        write(p, "two.txt", "staged-two");
        workdir::stage(p.to_path_buf(), vec!["one.txt".into(), "two.txt".into()]).unwrap();
        let staged_at_commit = staged_blobs(&repo);
        let sha = workdir::commit(p.to_path_buf(), "two files".into(), false).unwrap();

        // The user keeps editing one of them AFTER committing. Those bytes are
        // only on disk and undo must not roll them back.
        write(p, "one.txt", "edited-after-the-commit");

        // …and the INDEX drifts too: they stage that newer edit and add an
        // unrelated file. Without this the test would prove nothing — a plain
        // commit leaves the index already holding what it committed, so a
        // restore that did nothing at all would look identical. The snapshot
        // only earns its keep when the index has moved since.
        write(p, "extra.txt", "staged after the commit");
        workdir::stage(p.to_path_buf(), vec!["one.txt".into(), "extra.txt".into()]).unwrap();
        assert_ne!(
            staged_blobs(&repo),
            staged_at_commit,
            "the index really has drifted before the undo"
        );

        let undone = undo_last(p.to_path_buf()).unwrap().expect("undone");
        assert_eq!(undone.op, "commit");

        // 1. The commit is no longer in the branch's history.
        assert_eq!(
            repo.head().unwrap().peel_to_commit().unwrap().id(),
            parent,
            "the branch is back at the pre-commit tip"
        );
        let mut walk = repo.revwalk().unwrap();
        walk.push_head().unwrap();
        assert!(
            !walk.map(|o| o.unwrap().to_string()).any(|o| o == sha),
            "the undone commit is not reachable from the branch"
        );

        // 2. The files are staged again, byte-identical to commit time — and
        //    nothing the index picked up afterwards survives.
        assert_eq!(
            staged_blobs(&repo),
            staged_at_commit,
            "the index holds exactly the bytes that were staged when Commit was pressed"
        );

        // 3. The working tree was NOT clobbered.
        assert_eq!(
            std::fs::read_to_string(p.join("one.txt")).unwrap(),
            "edited-after-the-commit",
            "a file edited after committing keeps its newer bytes on disk"
        );
        assert_eq!(
            std::fs::read_to_string(p.join("two.txt")).unwrap(),
            "staged-two"
        );
    }

    /// Undoing the FIRST commit in a repository returns the branch to unborn,
    /// with the content still staged. `repo.head()` fails outright on an
    /// unborn HEAD, so nothing on this path may route through it.
    #[test]
    fn undoing_the_initial_commit_returns_the_branch_to_unborn() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);

        write(p, "first.txt", "the very first content");
        workdir::stage(p.to_path_buf(), vec!["first.txt".into()]).unwrap();
        let staged_at_commit = staged_blobs(&repo);
        let branch = head_branch(&repo);
        workdir::commit(p.to_path_buf(), "initial".into(), false).unwrap();
        assert!(repo.head().is_ok(), "born after the initial commit");

        let undone = undo_last(p.to_path_buf()).unwrap().expect("undone");
        assert_eq!(undone.op, "commit");

        assert!(
            repo.find_reference(&branch).is_err(),
            "the branch ref is gone — back to unborn"
        );
        assert!(repo.head().is_err(), "an unborn HEAD does not resolve");
        assert_eq!(
            head_branch(&repo),
            branch,
            "HEAD still points symbolically at the same unborn branch"
        );
        assert_eq!(
            staged_blobs(&repo),
            staged_at_commit,
            "the content is staged, ready to commit again"
        );
        assert_eq!(
            std::fs::read_to_string(p.join("first.txt")).unwrap(),
            "the very first content",
            "and still on disk"
        );
    }

    /// A commit made on a DETACHED HEAD is the third shape of the same
    /// decision: there is no branch, HEAD itself is the ref that moved, and
    /// undoing it moves HEAD back to the parent **and leaves it detached**.
    /// Re-attaching would silently put the user on a branch they had left.
    #[test]
    fn undoing_a_detached_head_commit_moves_head_back_and_stays_detached() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);

        let detach_at = app_commit(p, "base.txt", "base", "base");
        app_commit(p, "later.txt", "later", "later");
        let branch = head_branch(&repo);
        let branch_tip = repo.find_reference(&branch).unwrap().target().unwrap();

        // Check out a commit the way the app does — HEAD goes detached.
        crate::branch::checkout(p.to_path_buf(), detach_at.clone()).unwrap();
        assert!(
            repo.find_reference(HEAD_REF)
                .unwrap()
                .symbolic_target()
                .is_none(),
            "the premise: HEAD is detached before the commit"
        );

        write(p, "det.txt", "committed while detached");
        workdir::stage(p.to_path_buf(), vec!["det.txt".into()]).unwrap();
        let staged_at_commit = staged_blobs(&repo);
        let sha = workdir::commit(p.to_path_buf(), "on a detached head".into(), false).unwrap();

        // Drift the index afterwards, so a restore that did nothing at all
        // could not pass by accident.
        write(p, "extra.txt", "staged after the commit");
        workdir::stage(p.to_path_buf(), vec!["extra.txt".into()]).unwrap();
        assert_ne!(staged_blobs(&repo), staged_at_commit, "the index drifted");

        let state = undo_state(p.to_path_buf()).unwrap();
        assert!(
            state.available,
            "a detached-HEAD commit is undoable: {state:?}"
        );
        assert_eq!(
            state.op.as_deref(),
            Some("commit"),
            "and what Undo offers is that commit, not some older op"
        );

        let undone = undo_last(p.to_path_buf()).unwrap().expect("undone");
        assert_eq!(undone.op, "commit");
        assert_eq!(undone.original_ref, HEAD_REF);

        let head = repo.find_reference(HEAD_REF).unwrap();
        assert!(
            head.symbolic_target().is_none(),
            "HEAD is still detached — the undo did not attach it to a branch"
        );
        assert_eq!(
            head.target().unwrap().to_string(),
            detach_at,
            "HEAD is back at the commit's parent"
        );
        assert_ne!(head.target().unwrap().to_string(), sha);
        assert_eq!(
            repo.find_reference(&branch).unwrap().target().unwrap(),
            branch_tip,
            "the branch abandoned at detach time has not moved"
        );
        assert_eq!(
            staged_blobs(&repo),
            staged_at_commit,
            "the snapshot is staged again, byte for byte"
        );
        assert_eq!(
            std::fs::read_to_string(p.join("det.txt")).unwrap(),
            "committed while detached",
            "and the working tree was left alone"
        );
    }

    /// The point of recording the detached case at all: Undo must reverse what
    /// the user just did. With no record, `undo_last` fell through to the
    /// newest record it *did* have — an older, unrelated operation — and
    /// reversed that instead. The older record must survive this Undo and be
    /// reachable by the next one.
    #[test]
    fn a_detached_head_commit_does_not_consume_an_older_record() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);

        let detach_at = app_commit(p, "a.txt", "1", "first");
        let branch = head_branch(&repo);
        let branch_name = branch.rsplit('/').next().unwrap().to_string();

        // An older in-app operation with a record of its own: a merge.
        crate::branch::create_branch(p.to_path_buf(), "side".into(), "HEAD".into()).unwrap();
        crate::branch::checkout(p.to_path_buf(), "side".into()).unwrap();
        app_commit(p, "side.txt", "s", "side work");
        crate::branch::checkout(p.to_path_buf(), branch_name).unwrap();
        app_commit(p, "b.txt", "2", "second");
        let pre_merge_tip = repo.find_reference(&branch).unwrap().target().unwrap();
        crate::history::merge(p.to_path_buf(), "side".into()).unwrap();
        let merge_tip = repo.find_reference(&branch).unwrap().target().unwrap();
        assert_ne!(
            merge_tip, pre_merge_tip,
            "the merge really moved the branch"
        );

        // Now detach and commit.
        crate::branch::checkout(p.to_path_buf(), detach_at.clone()).unwrap();
        app_commit(p, "det.txt", "detached", "on a detached head");

        // First Undo: the detached commit, and nothing else.
        let first = undo_last(p.to_path_buf()).unwrap().expect("undone");
        assert_eq!(first.op, "commit", "Undo reversed the commit just made");
        assert_eq!(
            repo.find_reference(&branch).unwrap().target().unwrap(),
            merge_tip,
            "the merge was NOT undone — the branch still holds it"
        );
        assert!(
            list_backups(&repo)
                .iter()
                .flatten()
                .any(|b| b.op == "merge"),
            "the merge's record was not consumed"
        );

        // Second Undo: now the older record's turn.
        let second = undo_last(p.to_path_buf()).unwrap().expect("undone");
        assert_eq!(second.op, "merge", "the older record is still reachable");
        assert_eq!(
            repo.find_reference(&branch).unwrap().target().unwrap(),
            pre_merge_tip,
            "and undoing it puts the branch back where the merge found it"
        );
    }

    /// The staged tree is anchored by the record ref in its own right, not
    /// merely as a by-product of the commit. Once that commit leaves the
    /// branch the ref is the ONLY thing keeping the tree reachable — which is
    /// exactly the window in which gc would otherwise eat it.
    #[test]
    fn the_snapshot_tree_is_anchored_independently_of_the_commit() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        app_commit(p, "base.txt", "base", "base");
        let parent = repo.head().unwrap().peel_to_commit().unwrap().id();

        write(p, "staged.txt", "snapshot content");
        workdir::stage(p.to_path_buf(), vec!["staged.txt".into()]).unwrap();
        workdir::commit(p.to_path_buf(), "c".into(), false).unwrap();

        let rec = commit_records(&repo).unwrap().pop().expect("a record");
        let tree = rec.tree;
        assert_eq!(rec.parent, Some(parent), "the restore point is recorded");

        // Take the commit out of the branch WITHOUT consuming the record, the
        // way an unrelated reset would.
        repo.reference(&rec.original_ref, parent, true, "move away")
            .unwrap();

        // Nothing reachable from any commit holds the tree any more …
        let mut walk = repo.revwalk().unwrap();
        walk.push_head().unwrap();
        let reachable_trees: Vec<String> = walk
            .map(|o| repo.find_commit(o.unwrap()).unwrap().tree_id().to_string())
            .collect();
        assert!(
            !reachable_trees.contains(&tree.to_string()),
            "no commit in the branch holds the snapshot tree"
        );

        // … but the record ref does, so the staged content is still there.
        assert_eq!(
            repo.find_reference(&rec.record_ref).unwrap().target(),
            Some(tree),
            "the record ref points straight at the tree, anchoring it"
        );
        let anchored = repo.find_tree(tree).unwrap();
        let entry = anchored.get_name("staged.txt").expect("the staged path");
        let blob = repo.find_blob(entry.id()).unwrap();
        assert_eq!(blob.content(), b"snapshot content");
    }

    /// A commit's undo record must not litter the commit graph. The snapshot
    /// is anchored as a TREE precisely because `list_commits` walks `refs/*`
    /// and a snapshot commit would show up as a duplicate of every commit.
    #[test]
    fn a_commit_record_adds_no_commit_to_the_graph() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let _repo = init_repo(p);

        app_commit(p, "a.txt", "1", "first");
        app_commit(p, "b.txt", "2", "second");

        let page = crate::list_commits(p.to_path_buf(), None).unwrap();
        assert_eq!(
            page.commits.len(),
            2,
            "exactly the user's two commits: {:?}",
            page.commits.iter().map(|c| &c.subject).collect::<Vec<_>>()
        );
    }

    /// Commit records stay out of `list_backups`, which is public API that
    /// other callers read as "the backups the ops wrote". They still order
    /// against backup batches, because both are keyed on the same clock.
    #[test]
    fn commit_records_are_not_backups_but_still_order_against_them() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        app_commit(p, "a.txt", "1", "first");
        let branch = head_branch(&repo);

        assert!(
            list_backups(&repo).unwrap().is_empty(),
            "a commit writes no backup ref"
        );
        assert_eq!(commit_records(&repo).unwrap().len(), 1);

        // An older backup batch, then a newer commit: the commit must win.
        let backup = crate::mutate::create_backup(&repo, "reset", &branch).unwrap();
        seal(&repo, &backup).unwrap();
        app_commit(p, "b.txt", "2", "second");

        let state = undo_state(p.to_path_buf()).unwrap();
        assert_eq!(
            state.op.as_deref(),
            Some("commit"),
            "the newest action is the commit, not the older reset"
        );
    }

    /// Consuming a record clears its left-marks too, so the next Undo reads
    /// the batch below it rather than a stale mark.
    #[test]
    fn undo_consumes_the_record_and_its_marks() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        app_commit(p, "a.txt", "1", "first");
        app_commit(p, "b.txt", "2", "second");

        assert_eq!(left_marks(&repo).unwrap().len(), 2, "one mark per commit");
        undo_last(p.to_path_buf()).unwrap().expect("undone");
        assert_eq!(
            left_marks(&repo).unwrap().len(),
            1,
            "the consumed record's mark is gone"
        );
        assert_eq!(commit_records(&repo).unwrap().len(), 1);
    }

    /// A paused conflict resolution has not landed, so there is nothing
    /// finished to reverse and the reason says so rather than claiming an
    /// outside change.
    #[test]
    fn a_paused_op_reports_paused_not_external() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        app_commit(p, "a.txt", "1", "first");

        // Drive a real merge conflict: two branches touching the same path.
        let branch = head_branch(&repo);
        let base = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("other", &base, false).unwrap();
        app_commit(p, "clash.txt", "ours", "ours");
        crate::branch::checkout(p.to_path_buf(), "other".into()).unwrap();
        app_commit(p, "clash.txt", "theirs", "theirs");
        crate::branch::checkout(
            p.to_path_buf(),
            branch.strip_prefix("refs/heads/").unwrap().into(),
        )
        .unwrap();

        let res = crate::history::merge(p.to_path_buf(), "other".into()).unwrap();
        assert!(
            matches!(res, crate::resolve::HistoryOpResult::Conflict { .. }),
            "the merge paused on a conflict: {res:?}"
        );

        let state = undo_state(p.to_path_buf()).unwrap();
        assert!(!state.available, "{state:?}");
        assert_eq!(state.reason, Some(UndoBlockedReason::Paused));
    }
}
