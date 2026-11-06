//! Branch & tag operations.
//!
//! Branch/tag create/rename/delete and checkout. Most are additive or ref-only
//! changes that take the global mutation lock for serialization but
//! need no backup. Branch *deletion* snapshots the ref first so it is undoable
//! (US3 invariant). Deleting the checked-out branch is refused.

use std::path::PathBuf;

use git2::{build::CheckoutBuilder, BranchType, Commit, Repository};
use serde::Serialize;

use crate::error::{AdgitterError, AdgitterResult};
use crate::git::open_repo;
use crate::mutate::{create_backup, lock_mutations};

fn resolve_commit<'r>(repo: &'r Repository, rev: &str) -> AdgitterResult<Commit<'r>> {
    let obj = repo.revparse_single(rev)?;
    Ok(obj.peel_to_commit()?)
}

/// Create local branch `name` pointing at `from` (a ref name or sha).
pub fn create_branch(repo_path: PathBuf, name: String, from: String) -> AdgitterResult<()> {
    let _lock = lock_mutations();
    let repo = open_repo(&repo_path)?;
    let commit = resolve_commit(&repo, &from)?;
    repo.branch(&name, &commit, false)?;
    Ok(())
}

/// Rename local branch `old` → `new`.
pub fn rename_branch(repo_path: PathBuf, old: String, new: String) -> AdgitterResult<()> {
    let _lock = lock_mutations();
    let repo = open_repo(&repo_path)?;
    let mut branch = repo.find_branch(&old, BranchType::Local)?;
    branch.rename(&new, false)?;
    Ok(())
}

/// Set (or clear, with `None`) a local branch's upstream tracking ref — the
/// "properties" branch edit. `upstream` is a remote-tracking
/// branch's shorthand (e.g. "origin/main"); `None` removes the
/// branch.<name>.remote / .merge config so the branch tracks nothing.
pub fn set_upstream(
    repo_path: PathBuf,
    branch: String,
    upstream: Option<String>,
) -> AdgitterResult<()> {
    let _lock = lock_mutations();
    let repo = open_repo(&repo_path)?;
    let mut b = repo.find_branch(&branch, BranchType::Local)?;
    b.set_upstream(upstream.as_deref())?;
    Ok(())
}

/// The shorthand of a local branch's upstream (e.g. "origin/main"), or `None`
/// when it tracks nothing — seeds the branch-properties dialog.
pub fn branch_upstream(repo_path: PathBuf, branch: String) -> AdgitterResult<Option<String>> {
    let repo = open_repo(&repo_path)?;
    let b = repo.find_branch(&branch, BranchType::Local)?;
    // Bind to a `let` so the borrowed upstream `Branch` drops before `repo`.
    let up = match b.upstream() {
        Ok(u) => u.name().ok().flatten().map(str::to_string),
        Err(_) => None,
    };
    Ok(up)
}

/// Delete a local branch. Refuses to delete the currently checked-out branch.
pub fn delete_branch(repo_path: PathBuf, name: String) -> AdgitterResult<()> {
    let _lock = lock_mutations();
    let repo = open_repo(&repo_path)?;
    let mut branch = repo.find_branch(&name, BranchType::Local)?;
    if branch.is_head() {
        return Err(AdgitterError::Internal(
            "cannot delete the currently checked-out branch".into(),
        ));
    }
    // Snapshot the ref before removing it so `undo` can recreate it.
    let full = branch
        .get()
        .name()
        .ok_or_else(|| AdgitterError::Internal("invalid branch name".into()))?
        .to_string();
    let backup = create_backup(&repo, "delete-branch", &full)?;
    branch.delete()?;
    crate::undo::seal(&repo, &backup)?;
    Ok(())
}

/// What, if anything, to say about the two tips once the branch is checked out.
///
/// "The commits differ" is three different situations wearing one name, and
/// only one of them has "pull?" as a sensible question — so the classification
/// names them separately instead of handing the UI a bare ahead/behind pair to
/// re-interpret:
///
/// - [`SyncPrompt::None`] — identical tips. Nothing to ask, nothing to say.
/// - [`SyncPrompt::OfferPull`] — local is *strictly behind*: a pull is a plain
///   fast-forward that only adds the upstream's commits. This is the one case
///   that earns a prompt, and it is what the user's "if the progress differs,
///   ask whether to pull" is actually about.
/// - [`SyncPrompt::LocalAhead`] — local is *strictly ahead*: there is nothing
///   upstream to pull, so offering a pull would be a question with no effect.
///   The UI states the fact (push when ready) and asks nothing.
/// - [`SyncPrompt::Diverged`] — both sides moved. A pull here is a *merge*,
///   which creates a commit the user did not ask for while they were only
///   trying to check a branch out. The UI warns with the figures and leaves
///   the integration to the deliberate Pull/Merge/Rebase affordances.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncPrompt {
    None,
    OfferPull,
    LocalAhead,
    Diverged,
}

impl SyncPrompt {
    /// `ahead`/`behind` are the local branch's counts relative to the remote
    /// branch (`ahead` = commits only the local side has).
    fn classify(ahead: usize, behind: usize) -> Self {
        match (ahead, behind) {
            (0, 0) => Self::None,
            (0, _) => Self::OfferPull,
            (_, 0) => Self::LocalAhead,
            _ => Self::Diverged,
        }
    }
}

/// What a "check out this remote branch" gesture should actually do.
///
/// Decided in **one** pass over the repo by [`inspect_remote_checkout`] rather
/// than by the frontend firing several probes and assembling the answer: the
/// repo can change between probes, and the rule would end up written twice, in
/// two languages. An enum (not a bag of optional booleans) so the caller has
/// to handle every row — an unclassified situation cannot silently fall
/// through to "fine, carry on".
///
/// Serializes with a `case` discriminant for the frontend's tagged union.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "case", rename_all = "camelCase")]
pub enum RemoteCheckoutPlan {
    /// No local branch of that name. Ask whether to create one, then go
    /// through [`checkout_remote_branch`] — the common path, unchanged.
    #[serde(rename_all = "camelCase")]
    CreateLocal { suggested_local: String },

    /// A local branch exists and already tracks exactly this remote branch:
    /// just check it out, no question asked. `sync` says what (if anything) to
    /// raise afterwards.
    #[serde(rename_all = "camelCase")]
    Checkout {
        local_name: String,
        ahead: usize,
        behind: usize,
        sync: SyncPrompt,
    },

    /// A local branch exists but tracks nothing. Ask whether to adopt this
    /// remote branch as its upstream (see
    /// [`adopt_remote_upstream_and_checkout`]); `sync` is the *second* step,
    /// evaluated against the prospective upstream.
    #[serde(rename_all = "camelCase")]
    AdoptUpstream {
        local_name: String,
        ahead: usize,
        behind: usize,
        sync: SyncPrompt,
    },
}

/// The configured upstream of `branch` as a remote-tracking shorthand, read
/// from config rather than by resolving the ref.
///
/// Deliberately not `branch.upstream()`: that fails when the upstream ref is
/// gone (a deleted remote branch), which would make a branch wired to someone
/// else's remote look like a branch that tracks nothing — and we would then
/// quietly re-point it. Reading the config sees what the user configured.
fn configured_upstream(
    repo: &Repository,
    branch: &git2::Branch<'_>,
) -> AdgitterResult<Option<String>> {
    let refname = branch
        .get()
        .name()
        .ok_or_else(|| AdgitterError::Internal("invalid branch name".into()))?;
    match repo.branch_upstream_name(refname) {
        Ok(buf) => Ok(buf
            .as_str()
            .map(|s| s.strip_prefix("refs/remotes/").unwrap_or(s).to_string())),
        Err(e) if e.code() == git2::ErrorCode::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Classify "the user wants to check out remote branch `remote_name`", so the
/// UI can ask the one question that fits (or none at all).
///
/// `local_name` is the local branch the gesture would use — the suggested,
/// remote-prefix-stripped name for a fresh checkout, or the name the user
/// typed. Read-only: takes no mutation lock and changes nothing.
///
/// Errors when `remote_name` is not a remote-tracking branch, and with
/// [`AdgitterError::RemoteUpstreamMismatch`] for the one unresolvable row —
/// a local branch of that name already tracking a different remote branch.
pub fn inspect_remote_checkout(
    repo_path: PathBuf,
    remote_name: String,
    local_name: String,
) -> AdgitterResult<RemoteCheckoutPlan> {
    let repo = open_repo(&repo_path)?;
    let remote_oid = repo
        .find_branch(&remote_name, BranchType::Remote)
        .map_err(|_| AdgitterError::Internal(format!("unknown remote branch: {remote_name}")))?
        .get()
        .peel_to_commit()?
        .id();

    let Ok(local) = repo.find_branch(&local_name, BranchType::Local) else {
        return Ok(RemoteCheckoutPlan::CreateLocal {
            suggested_local: local_name,
        });
    };
    let local_oid = local.get().peel_to_commit()?.id();
    let upstream = configured_upstream(&repo, &local)?;

    // Counts for this specific pair — `remote::ahead_behind` answers only for
    // the *current* branch's upstream, which is neither of these refs.
    let (ahead, behind) = repo.graph_ahead_behind(local_oid, remote_oid)?;
    let sync = SyncPrompt::classify(ahead, behind);

    match upstream {
        None => Ok(RemoteCheckoutPlan::AdoptUpstream {
            local_name,
            ahead,
            behind,
            sync,
        }),
        Some(up) if up == remote_name => Ok(RemoteCheckoutPlan::Checkout {
            local_name,
            ahead,
            behind,
            sync,
        }),
        Some(other) => Err(AdgitterError::RemoteUpstreamMismatch {
            branch: local_name,
            tracking: other,
            requested: remote_name,
        }),
    }
}

/// Check out the existing local branch `local_name` and point its upstream at
/// `remote_name` — the [`RemoteCheckoutPlan::AdoptUpstream`] row, step one of
/// its two-step flow (the optional pull is step two, and is the caller's).
///
/// Re-classifies first, so a repo that changed between the inspect and the
/// user's answer cannot slip past the rule: a branch that has meanwhile
/// acquired a *different* upstream still errors, and one that has vanished
/// errors instead of being created behind the user's back.
///
/// Checks out **before** wiring the upstream, on purpose: the checkout is the
/// step that can refuse (conflicting uncommitted changes — [`checkout`]'s
/// contract), and doing it first means such a refusal leaves the repo, config
/// included, exactly as it was rather than stranding a config edit the user
/// cannot see.
///
/// The accepted cost of that order: if the checkout succeeds and the (very
/// unlikely) `set_upstream` then fails, the caller sees an error with the branch
/// already checked out and still tracking nothing. That residual state is
/// chosen, not overlooked — a stranded checkout is visible in the UI and is
/// fixed by re-running the same gesture, whereas the reverse order's residue is
/// an invisible config edit on a branch the user never switched to.
pub fn adopt_remote_upstream_and_checkout(
    repo_path: PathBuf,
    remote_name: String,
    local_name: String,
) -> AdgitterResult<()> {
    match inspect_remote_checkout(repo_path.clone(), remote_name.clone(), local_name.clone())? {
        // Already tracking it is fine (idempotent re-run); tracking something
        // else has already returned `RemoteUpstreamMismatch` above.
        RemoteCheckoutPlan::AdoptUpstream { .. } | RemoteCheckoutPlan::Checkout { .. } => {}
        RemoteCheckoutPlan::CreateLocal { .. } => {
            return Err(AdgitterError::Internal(format!(
                "no local branch named '{local_name}' to adopt an upstream for"
            )))
        }
    }
    checkout(repo_path.clone(), local_name.clone())?;
    set_upstream(repo_path, local_name, Some(remote_name))
}

/// Create a local branch at a remote branch's tip, set its upstream to that
/// remote branch, and check it out (the panel/graph "checkout remote" flow).
///
/// Errors when `remote_name` does not resolve to a remote-tracking branch, or
/// when a local branch named `local_name` already exists (never silently
/// clobbers an existing branch). The branch-creation + upstream-wiring steps
/// take the mutation lock and release it before delegating to [`checkout`],
/// which takes the same (non-reentrant) lock itself — holding it across that
/// call would deadlock.
pub fn checkout_remote_branch(
    repo_path: PathBuf,
    remote_name: String,
    local_name: String,
) -> AdgitterResult<()> {
    {
        let _lock = lock_mutations();
        let repo = open_repo(&repo_path)?;
        let remote_branch = repo
            .find_branch(&remote_name, BranchType::Remote)
            .map_err(|_| {
                AdgitterError::Internal(format!("unknown remote branch: {remote_name}"))
            })?;
        if repo.find_branch(&local_name, BranchType::Local).is_ok() {
            return Err(AdgitterError::Internal(format!(
                "a local branch named '{local_name}' already exists"
            )));
        }
        let commit = remote_branch.get().peel_to_commit()?;
        let mut local = repo.branch(&local_name, &commit, false)?;
        local.set_upstream(Some(&remote_name))?;
    }
    checkout(repo_path, local_name)
}

/// Check out a branch or commit: update the working tree and move HEAD. HEAD is
/// attached when `target` names a local branch, otherwise detached. A safe
/// checkout refuses to overwrite conflicting uncommitted changes.
pub fn checkout(repo_path: PathBuf, target: String) -> AdgitterResult<()> {
    let _lock = lock_mutations();
    let repo = open_repo(&repo_path)?;
    let commit = resolve_commit(&repo, &target)?;

    let mut co = CheckoutBuilder::new();
    co.safe();
    repo.checkout_tree(commit.as_object(), Some(&mut co))?;

    match repo.find_branch(&target, BranchType::Local) {
        Ok(branch) => {
            let name = branch
                .get()
                .name()
                .ok_or_else(|| AdgitterError::Internal("invalid branch name".into()))?
                .to_string();
            repo.set_head(&name)?;
        }
        Err(_) => repo.set_head_detached(commit.id())?,
    }
    Ok(())
}

/// Create a tag at `target`. Annotated when `message` is non-empty, else
/// lightweight.
pub fn create_tag(
    repo_path: PathBuf,
    name: String,
    target: String,
    message: Option<String>,
) -> AdgitterResult<()> {
    let _lock = lock_mutations();
    let repo = open_repo(&repo_path)?;
    let obj = repo.revparse_single(&target)?;
    match message {
        Some(msg) if !msg.trim().is_empty() => {
            // An annotated tag carries a tagger identity, so it follows the same
            // rule as a commit: git's `user.email` wins, account address only as
            // a fallback.
            let sig = crate::identity::signature_for(&repo)?;
            repo.tag(&name, &obj, &sig, &msg, false)?;
        }
        _ => {
            repo.tag_lightweight(&name, &obj, false)?;
        }
    }
    Ok(())
}

/// Delete a tag by short name.
pub fn delete_tag(repo_path: PathBuf, name: String) -> AdgitterResult<()> {
    let _lock = lock_mutations();
    let repo = open_repo(&repo_path)?;
    repo.tag_delete(&name)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::Repository;
    use std::path::Path;

    fn init_repo(dir: &Path) -> Repository {
        let repo = Repository::init(dir).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Tester").unwrap();
        cfg.set_str("user.email", "t@example.com").unwrap();
        repo
    }

    /// Commit via the crate's own working-tree ops, returning the new sha.
    fn commit(dir: &Path, name: &str, content: &str) -> String {
        std::fs::write(dir.join(name), content).unwrap();
        crate::workdir::stage(dir.to_path_buf(), vec![name.to_string()]).unwrap();
        crate::workdir::commit(dir.to_path_buf(), format!("add {name}"), false).unwrap()
    }

    fn head_branch(repo: &Repository) -> String {
        repo.head().unwrap().shorthand().unwrap().to_string()
    }

    #[test]
    fn create_rename_delete_branch() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "a.txt", "1");

        create_branch(p.into(), "feature".into(), "HEAD".into()).unwrap();
        assert!(repo.find_branch("feature", BranchType::Local).is_ok());

        rename_branch(p.into(), "feature".into(), "feat2".into()).unwrap();
        assert!(repo.find_branch("feature", BranchType::Local).is_err());
        assert!(repo.find_branch("feat2", BranchType::Local).is_ok());

        delete_branch(p.into(), "feat2".into()).unwrap();
        assert!(repo.find_branch("feat2", BranchType::Local).is_err());
    }

    #[test]
    fn delete_branch_is_undoable() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "a.txt", "1");

        create_branch(p.into(), "feature".into(), "HEAD".into()).unwrap();
        let target = repo
            .find_branch("feature", BranchType::Local)
            .unwrap()
            .get()
            .target()
            .unwrap();

        delete_branch(p.into(), "feature".into()).unwrap();
        assert!(repo.find_branch("feature", BranchType::Local).is_err());

        // A backup was recorded; undo recreates the ref at its old target.
        let restored = crate::mutate::undo_last(p.into()).unwrap().unwrap();
        assert_eq!(restored.op, "delete-branch");
        let again = repo.find_branch("feature", BranchType::Local).unwrap();
        assert_eq!(again.get().target().unwrap(), target);
    }

    #[test]
    fn delete_current_branch_is_refused() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "a.txt", "1");
        let current = head_branch(&repo);
        assert!(matches!(
            delete_branch(p.into(), current),
            Err(AdgitterError::Internal(_))
        ));
    }

    #[test]
    fn checkout_attaches_head_to_branch() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "a.txt", "1");
        let start = head_branch(&repo);

        create_branch(p.into(), "other".into(), "HEAD".into()).unwrap();
        checkout(p.into(), "other".into()).unwrap();
        assert_eq!(head_branch(&repo), "other");
        assert!(!repo.head_detached().unwrap());

        checkout(p.into(), start.clone()).unwrap();
        assert_eq!(head_branch(&repo), start);
    }

    #[test]
    fn checkout_refuses_to_clobber_conflicting_changes() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "a.txt", "main\n");
        let main = head_branch(&repo);

        create_branch(p.into(), "other".into(), "HEAD".into()).unwrap();
        checkout(p.into(), "other".into()).unwrap();
        commit(p, "a.txt", "other\n"); // other diverges on a.txt
        checkout(p.into(), main.clone()).unwrap();

        // Uncommitted local edit to the same file that the target would change.
        std::fs::write(p.join("a.txt"), "dirty\n").unwrap();
        let err = checkout(p.into(), "other".into());
        assert!(
            err.is_err(),
            "safe checkout must refuse to overwrite changes"
        );
        // Still on main, local edit preserved.
        assert_eq!(head_branch(&repo), main);
        assert_eq!(std::fs::read_to_string(p.join("a.txt")).unwrap(), "dirty\n");
    }

    #[test]
    fn checkout_remote_branch_creates_tracks_and_checks_out() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "a.txt", "1");
        let tip = repo.head().unwrap().target().unwrap();

        // `set_upstream` needs a configured remote to resolve the refspec
        // against; the URL is never dialed in this test.
        repo.remote("origin", "https://example.invalid/origin.git")
            .unwrap();
        repo.reference("refs/remotes/origin/feature", tip, false, "test")
            .unwrap();

        checkout_remote_branch(p.into(), "origin/feature".into(), "feature".into()).unwrap();

        let local = repo.find_branch("feature", BranchType::Local).unwrap();
        assert_eq!(local.get().target().unwrap(), tip);
        assert_eq!(head_branch(&repo), "feature");
        assert!(!repo.head_detached().unwrap());
        assert!(
            local.upstream().is_ok(),
            "the new local branch tracks the remote"
        );
    }

    // ── The remote-checkout matrix ─────────────────────────────────────────
    //
    // One fixture shape for all of it: a repo with `origin` configured (never
    // dialed), a base commit, and `refs/heads/feature` / `refs/remotes/
    // origin/feature` moved by hand to whatever pair of tips the row needs.

    /// Repo with `origin` configured and one commit; returns (repo, base oid).
    fn repo_with_origin(dir: &Path) -> (Repository, git2::Oid) {
        let repo = init_repo(dir);
        commit(dir, "a.txt", "base\n");
        repo.remote("origin", "https://example.invalid/origin.git")
            .unwrap();
        let base = repo.head().unwrap().target().unwrap();
        (repo, base)
    }

    /// Commit `content` to `file` on top of `parent`, updating **no** ref and
    /// leaving HEAD and the working tree alone — this is how the tests fork
    /// two tips off one base without checking anything out.
    fn commit_onto(repo: &Repository, parent: git2::Oid, file: &str, content: &str) -> git2::Oid {
        let parent = repo.find_commit(parent).unwrap();
        let mut tb = repo.treebuilder(Some(&parent.tree().unwrap())).unwrap();
        let blob = repo.blob(content.as_bytes()).unwrap();
        tb.insert(file, blob, 0o100644).unwrap();
        let tree = repo.find_tree(tb.write().unwrap()).unwrap();
        let sig = repo.signature().unwrap();
        repo.commit(None, &sig, &sig, &format!("edit {file}"), &tree, &[&parent])
            .unwrap()
    }

    fn point(repo: &Repository, refname: &str, oid: git2::Oid) {
        repo.reference(refname, oid, true, "test").unwrap();
    }

    /// Row 1: nothing local by that name — the common create-and-track path,
    /// which still gets today's "create a local branch?" question.
    #[test]
    fn inspect_with_no_local_branch_asks_to_create_one() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let (repo, base) = repo_with_origin(p);
        point(&repo, "refs/remotes/origin/feature", base);

        let plan =
            inspect_remote_checkout(p.into(), "origin/feature".into(), "feature".into()).unwrap();
        assert_eq!(
            plan,
            RemoteCheckoutPlan::CreateLocal {
                suggested_local: "feature".into()
            }
        );
    }

    /// Row 2 — the whole point of classifying: tracking this remote branch and
    /// sitting on the same commit means there is nothing to ask about.
    #[test]
    fn inspect_tracking_the_same_commit_asks_nothing() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let (repo, base) = repo_with_origin(p);
        point(&repo, "refs/heads/feature", base);
        point(&repo, "refs/remotes/origin/feature", base);
        set_upstream(p.into(), "feature".into(), Some("origin/feature".into())).unwrap();

        let plan =
            inspect_remote_checkout(p.into(), "origin/feature".into(), "feature".into()).unwrap();
        assert_eq!(
            plan,
            RemoteCheckoutPlan::Checkout {
                local_name: "feature".into(),
                ahead: 0,
                behind: 0,
                sync: SyncPrompt::None,
            }
        );
    }

    /// Row 3a: strictly behind — a pull is a plain fast-forward, so this is
    /// the one shape of "the commits differ" that offers one.
    #[test]
    fn inspect_tracking_but_behind_offers_a_pull() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let (repo, base) = repo_with_origin(p);
        let remote_tip = commit_onto(&repo, base, "a.txt", "remote\n");
        point(&repo, "refs/heads/feature", base);
        point(&repo, "refs/remotes/origin/feature", remote_tip);
        set_upstream(p.into(), "feature".into(), Some("origin/feature".into())).unwrap();

        let plan =
            inspect_remote_checkout(p.into(), "origin/feature".into(), "feature".into()).unwrap();
        assert_eq!(
            plan,
            RemoteCheckoutPlan::Checkout {
                local_name: "feature".into(),
                ahead: 0,
                behind: 1,
                sync: SyncPrompt::OfferPull,
            }
        );
    }

    /// Row 3b: strictly ahead — there is nothing upstream to pull, so asking
    /// "pull to sync?" would be a question with no possible effect.
    #[test]
    fn inspect_tracking_but_ahead_does_not_offer_a_pointless_pull() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let (repo, base) = repo_with_origin(p);
        let local_tip = commit_onto(&repo, base, "a.txt", "local\n");
        point(&repo, "refs/heads/feature", local_tip);
        point(&repo, "refs/remotes/origin/feature", base);
        set_upstream(p.into(), "feature".into(), Some("origin/feature".into())).unwrap();

        let plan =
            inspect_remote_checkout(p.into(), "origin/feature".into(), "feature".into()).unwrap();
        assert_eq!(
            plan,
            RemoteCheckoutPlan::Checkout {
                local_name: "feature".into(),
                ahead: 1,
                behind: 0,
                sync: SyncPrompt::LocalAhead,
            }
        );
    }

    /// Row 3c: diverged — a pull here is a *merge*, which would land a commit
    /// the user never asked for while they were only checking a branch out.
    #[test]
    fn inspect_tracking_but_diverged_warns_instead_of_offering_a_merge() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let (repo, base) = repo_with_origin(p);
        let local_tip = commit_onto(&repo, base, "a.txt", "local\n");
        let remote_tip = commit_onto(&repo, base, "a.txt", "remote\n");
        point(&repo, "refs/heads/feature", local_tip);
        point(&repo, "refs/remotes/origin/feature", remote_tip);
        set_upstream(p.into(), "feature".into(), Some("origin/feature".into())).unwrap();

        let plan =
            inspect_remote_checkout(p.into(), "origin/feature".into(), "feature".into()).unwrap();
        assert_eq!(
            plan,
            RemoteCheckoutPlan::Checkout {
                local_name: "feature".into(),
                ahead: 1,
                behind: 1,
                sync: SyncPrompt::Diverged,
            }
        );
    }

    /// Row 4: no upstream at all — ask to adopt this one, and carry the
    /// second step's figures in the same answer.
    #[test]
    fn inspect_with_no_upstream_asks_to_adopt_this_one_and_carries_the_counts() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let (repo, base) = repo_with_origin(p);
        let remote_tip = commit_onto(&repo, base, "a.txt", "remote\n");
        point(&repo, "refs/heads/feature", base);
        point(&repo, "refs/remotes/origin/feature", remote_tip);
        assert_eq!(branch_upstream(p.into(), "feature".into()).unwrap(), None);

        let plan =
            inspect_remote_checkout(p.into(), "origin/feature".into(), "feature".into()).unwrap();
        assert_eq!(
            plan,
            RemoteCheckoutPlan::AdoptUpstream {
                local_name: "feature".into(),
                ahead: 0,
                behind: 1,
                sync: SyncPrompt::OfferPull,
            }
        );
    }

    /// Row 5 — the only unresolvable row. It must name the branch, what it
    /// actually tracks and what was asked for, and must not be the generic
    /// `Internal` the old code produced.
    #[test]
    fn inspect_with_a_different_upstream_is_the_only_error() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let (repo, base) = repo_with_origin(p);
        repo.remote("fork", "https://example.invalid/fork.git")
            .unwrap();
        point(&repo, "refs/heads/feature", base);
        point(&repo, "refs/remotes/origin/feature", base);
        point(&repo, "refs/remotes/fork/feature", base);
        set_upstream(p.into(), "feature".into(), Some("fork/feature".into())).unwrap();

        let err = inspect_remote_checkout(p.into(), "origin/feature".into(), "feature".into())
            .unwrap_err();
        match &err {
            AdgitterError::RemoteUpstreamMismatch {
                branch,
                tracking,
                requested,
            } => {
                assert_eq!(branch, "feature");
                assert_eq!(tracking, "fork/feature");
                assert_eq!(requested, "origin/feature");
            }
            other => panic!("expected a RemoteUpstreamMismatch, got {other:?}"),
        }
        assert_eq!(err.code(), "REMOTE_UPSTREAM_MISMATCH");
    }

    /// A configured-but-deleted upstream is still a *conflicting* upstream —
    /// resolving the ref would fail and make it look like "tracks nothing",
    /// and we would then silently re-point the user's branch.
    #[test]
    fn inspect_treats_a_vanished_foreign_upstream_as_a_mismatch_not_as_unset() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let (repo, base) = repo_with_origin(p);
        repo.remote("fork", "https://example.invalid/fork.git")
            .unwrap();
        point(&repo, "refs/heads/feature", base);
        point(&repo, "refs/remotes/origin/feature", base);
        point(&repo, "refs/remotes/fork/feature", base);
        set_upstream(p.into(), "feature".into(), Some("fork/feature".into())).unwrap();
        // The remote branch goes away, the config does not.
        repo.find_reference("refs/remotes/fork/feature")
            .unwrap()
            .delete()
            .unwrap();

        assert!(matches!(
            inspect_remote_checkout(p.into(), "origin/feature".into(), "feature".into()),
            Err(AdgitterError::RemoteUpstreamMismatch { .. })
        ));
    }

    #[test]
    fn inspect_rejects_an_unknown_remote_branch() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        repo_with_origin(p);

        assert!(inspect_remote_checkout(p.into(), "origin/nope".into(), "nope".into()).is_err());
    }

    /// Step one of the two-step flow: the upstream is wired and the branch is
    /// checked out. Cancelling step two (the pull) is exactly "stop here", so
    /// this is also the assertion that a cancelled second step leaves the
    /// first applied — the local tip has not moved toward the remote.
    #[test]
    fn adopting_an_upstream_checks_out_and_leaves_step_one_applied() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let (repo, base) = repo_with_origin(p);
        let remote_tip = commit_onto(&repo, base, "b.txt", "remote\n");
        point(&repo, "refs/heads/feature", base);
        point(&repo, "refs/remotes/origin/feature", remote_tip);

        adopt_remote_upstream_and_checkout(p.into(), "origin/feature".into(), "feature".into())
            .unwrap();

        assert_eq!(head_branch(&repo), "feature");
        assert!(!repo.head_detached().unwrap());
        assert_eq!(
            branch_upstream(p.into(), "feature".into()).unwrap(),
            Some("origin/feature".to_string()),
            "step one must stick"
        );
        // No pull happened: the local tip is still the pre-adopt commit.
        assert_eq!(
            repo.find_branch("feature", BranchType::Local)
                .unwrap()
                .get()
                .target()
                .unwrap(),
            base
        );
    }

    /// Adopting re-classifies, so the mismatch row stays refused even if the
    /// branch acquired its foreign upstream after the UI asked.
    #[test]
    fn adopting_refuses_a_branch_that_tracks_a_different_remote() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let (repo, base) = repo_with_origin(p);
        repo.remote("fork", "https://example.invalid/fork.git")
            .unwrap();
        point(&repo, "refs/heads/feature", base);
        point(&repo, "refs/remotes/origin/feature", base);
        point(&repo, "refs/remotes/fork/feature", base);
        set_upstream(p.into(), "feature".into(), Some("fork/feature".into())).unwrap();
        let start = head_branch(&repo);

        assert!(matches!(
            adopt_remote_upstream_and_checkout(p.into(), "origin/feature".into(), "feature".into()),
            Err(AdgitterError::RemoteUpstreamMismatch { .. })
        ));
        assert_eq!(head_branch(&repo), start);
        assert_eq!(
            branch_upstream(p.into(), "feature".into()).unwrap(),
            Some("fork/feature".to_string()),
            "the existing upstream must not be re-pointed"
        );
    }

    /// `checkout`'s refuse-to-clobber contract still holds — and because the
    /// checkout runs *before* the config write, a refusal leaves no stranded
    /// upstream behind.
    #[test]
    fn adopting_refuses_a_dirty_tree_and_strands_no_upstream() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let (repo, base) = repo_with_origin(p);
        let feature_tip = commit_onto(&repo, base, "a.txt", "feature\n");
        point(&repo, "refs/heads/feature", feature_tip);
        point(&repo, "refs/remotes/origin/feature", feature_tip);
        let start = head_branch(&repo);

        // Uncommitted edit to the very file the checkout would rewrite.
        std::fs::write(p.join("a.txt"), "dirty\n").unwrap();

        assert!(
            adopt_remote_upstream_and_checkout(p.into(), "origin/feature".into(), "feature".into())
                .is_err(),
            "a safe checkout must still refuse to overwrite local changes"
        );
        assert_eq!(head_branch(&repo), start);
        assert_eq!(std::fs::read_to_string(p.join("a.txt")).unwrap(), "dirty\n");
        assert_eq!(
            branch_upstream(p.into(), "feature".into()).unwrap(),
            None,
            "a refused checkout must not leave a config edit behind"
        );
    }

    #[test]
    fn adopting_a_branch_that_does_not_exist_is_refused_not_created() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let (repo, base) = repo_with_origin(p);
        point(&repo, "refs/remotes/origin/feature", base);

        assert!(matches!(
            adopt_remote_upstream_and_checkout(p.into(), "origin/feature".into(), "feature".into()),
            Err(AdgitterError::Internal(_))
        ));
        assert!(repo.find_branch("feature", BranchType::Local).is_err());
    }

    /// The `case` tag and the `sync` strings are the frontend's discriminants,
    /// so their wire spelling is part of the contract.
    #[test]
    fn the_plan_serializes_with_a_case_tag_the_frontend_can_match_on() {
        let json = serde_json::to_value(RemoteCheckoutPlan::Checkout {
            local_name: "feature".into(),
            ahead: 2,
            behind: 3,
            sync: SyncPrompt::Diverged,
        })
        .unwrap();
        assert_eq!(json["case"], "checkout");
        assert_eq!(json["localName"], "feature");
        assert_eq!(json["ahead"], 2);
        assert_eq!(json["behind"], 3);
        assert_eq!(json["sync"], "diverged");

        let create = serde_json::to_value(RemoteCheckoutPlan::CreateLocal {
            suggested_local: "feature".into(),
        })
        .unwrap();
        assert_eq!(create["case"], "createLocal");
        assert_eq!(create["suggestedLocal"], "feature");

        let adopt = serde_json::to_value(RemoteCheckoutPlan::AdoptUpstream {
            local_name: "feature".into(),
            ahead: 0,
            behind: 0,
            sync: SyncPrompt::None,
        })
        .unwrap();
        assert_eq!(adopt["case"], "adoptUpstream");
        assert_eq!(adopt["sync"], "none");

        assert_eq!(
            serde_json::to_value(SyncPrompt::OfferPull).unwrap(),
            "offerPull"
        );
        assert_eq!(
            serde_json::to_value(SyncPrompt::LocalAhead).unwrap(),
            "localAhead"
        );
    }

    #[test]
    fn set_and_read_and_clear_a_branch_upstream() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "a.txt", "1");
        let tip = repo.head().unwrap().target().unwrap();

        repo.remote("origin", "https://example.invalid/origin.git")
            .unwrap();
        repo.reference("refs/remotes/origin/main", tip, false, "test")
            .unwrap();
        create_branch(p.into(), "feature".into(), "HEAD".into()).unwrap();

        // No upstream yet.
        assert_eq!(branch_upstream(p.into(), "feature".into()).unwrap(), None);

        // Set it → reads back as the remote-tracking shorthand.
        set_upstream(p.into(), "feature".into(), Some("origin/main".into())).unwrap();
        assert_eq!(
            branch_upstream(p.into(), "feature".into()).unwrap(),
            Some("origin/main".to_string())
        );

        // Clear it → back to None.
        set_upstream(p.into(), "feature".into(), None).unwrap();
        assert_eq!(branch_upstream(p.into(), "feature".into()).unwrap(), None);
    }

    #[test]
    fn checkout_remote_branch_rejects_existing_local_name() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "a.txt", "1");
        let tip = repo.head().unwrap().target().unwrap();

        repo.remote("origin", "https://example.invalid/origin.git")
            .unwrap();
        repo.reference("refs/remotes/origin/feature", tip, false, "test")
            .unwrap();
        create_branch(p.into(), "feature".into(), "HEAD".into()).unwrap();

        let start = head_branch(&repo);
        let err = checkout_remote_branch(p.into(), "origin/feature".into(), "feature".into());
        assert!(err.is_err(), "must refuse to clobber an existing branch");
        // Nothing moved: HEAD is unchanged, and `feature` still points at the
        // original create_branch target rather than being reset to the
        // remote's tip.
        assert_eq!(head_branch(&repo), start);
    }

    #[test]
    fn checkout_remote_branch_rejects_unknown_remote() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        init_repo(p);
        commit(p, "a.txt", "1");

        let err = checkout_remote_branch(p.into(), "origin/nope".into(), "nope".into());
        assert!(err.is_err());
    }

    #[test]
    fn create_and_delete_tag() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "a.txt", "1");

        create_tag(p.into(), "v1.0".into(), "HEAD".into(), None).unwrap();
        assert!(repo.find_reference("refs/tags/v1.0").is_ok());

        create_tag(
            p.into(),
            "v1.1".into(),
            "HEAD".into(),
            Some("release 1.1".into()),
        )
        .unwrap();
        assert!(repo.find_reference("refs/tags/v1.1").is_ok());

        delete_tag(p.into(), "v1.0".into()).unwrap();
        assert!(repo.find_reference("refs/tags/v1.0").is_err());
    }
}
