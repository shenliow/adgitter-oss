//! Descendant-branch remap: after a history-rewriting op
//! (reword / drop / rebase / purge) replays a range of commits onto new
//! oids, any OTHER local branch that forked from — or merged in — a commit
//! in that range is left pointing at the now-orphaned OLD commits (they
//! render as ghosts in the graph). [`remap_descendants`] tries to re-base
//! every such branch onto the corresponding NEW commits too, so the whole
//! operation looks like only the user's targeted commit changed even though
//! every hash after it differs.
//!
//! This is deliberately **best-effort**: a branch whose replay would
//! conflict is left exactly where it was (today's behaviour) and reported in
//! [`RemapOutcome::skipped`] rather than silently orphaned OR force-applied
//! with a bogus resolution.
//!
//! # What is (and isn't) touched
//! - Only LOCAL branches are candidates. Tags are left untouched — a tag
//!   pins a specific snapshot on purpose; moving it out from under the user
//!   would betray that. Remote-tracking refs are left untouched — they
//!   mirror the server's view of a branch, and only a fetch/push should ever
//!   change them.
//! - `refs/adgitter/*` (backup refs) are skipped: they aren't branches and
//!   remapping them would corrupt the very undo mechanism this module relies
//!   on.
//! - The branch the primary op itself already moved (`exclude_ref`) is
//!   skipped — it has no "old" self left to remap.
//!
//! # Merge-commit limitation
//! A non-merge commit is replayed exactly like `rebase.rs`'s cherry-pick
//! core: its diff against its OLD first parent is re-applied onto the
//! (already-mapped) NEW parent, so a conflict is possible and is reported as
//! `skipped` rather than guessed at. A MERGE commit carries no single
//! "diff" to replay, so instead it is re-created with every parent mapped
//! through the (growing) rewrite map and its ORIGINAL tree preserved
//! unchanged — exactly `purge.rs`'s `rewrite` pattern. This can never
//! conflict, but it also means a merge's recorded resolution is carried
//! forward as-is even if one of its parents' content changed upstream (e.g. a
//! purge stripped a file the merge itself still lists) — the merge's own
//! tree is not recomputed. Document this rather than silently "fixing" a
//! resolution nobody asked to redo.

use std::collections::{HashMap, VecDeque};

use git2::{BranchType, Commit, Oid, Repository, Sort};

use crate::error::AdgitterResult;
use crate::history::signature;
use crate::mutate::{add_to_batch, Backup};

/// Result of a best-effort descendant-branch remap: which local branches
/// were successfully re-based onto the rewrite, and which were left
/// untouched because their replay would have conflicted (or hit an internal
/// error). Serialized camelCase for IPC.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemapOutcome {
    /// Local branches (full ref names, e.g. `refs/heads/feature`) that were
    /// re-based onto the new commits.
    pub remapped: Vec<String>,
    /// Local branches left exactly where they were, because replaying their
    /// extra commits onto the rewrite conflicted (or hit an internal error).
    /// Never silent — the caller reports these to the user by name.
    pub skipped: Vec<String>,
}

/// Alias used by the public history-op entry points (`reword`, `rebase`,
/// `rebase_onto`, `rebase_branch`, `drop_commit`, `purge_path`) — same shape,
/// named for the call site rather than the engine.
pub type HistoryOpOutcome = RemapOutcome;

/// After a successful rewrite that produced `rewritten` (old commit oid ->
/// new commit oid, covering the whole replayed/rewritten range), re-base
/// every OTHER local branch whose tip descends from (or IS) one of those old
/// commits onto the new chain, best-effort. `exclude_ref` is the branch the
/// primary op already moved itself (skipped — nothing to remap there).
/// `op`/`primary_backup` extend the SAME backup batch the primary op already
/// opened, so a single undo restores every ref this call moves too.
///
/// Never returns an `Err`: a hard internal error while processing one branch
/// just adds that branch to `skipped` (and never leaves its ref partially
/// moved — see [`remap_one_branch`]'s "build first, move once" discipline)
/// rather than poisoning the primary op, which has already succeeded by the
/// time this runs.
pub(crate) fn remap_descendants(
    repo: &Repository,
    rewritten: &HashMap<Oid, Oid>,
    exclude_ref: &str,
    op: &str,
    primary_backup: &Backup,
) -> RemapOutcome {
    let mut outcome = RemapOutcome::default();
    if rewritten.is_empty() {
        return outcome;
    }

    let candidates = match collect_local_branches(repo, exclude_ref) {
        Ok(c) => c,
        Err(_) => return outcome, // can't enumerate branches — nothing to report by name
    };

    let needing: Vec<(String, Oid)> = candidates
        .into_iter()
        .filter(|(_, tip)| needs_remap(repo, rewritten, *tip))
        .collect();
    if needing.is_empty() {
        return outcome;
    }

    // Ancestors before descendants, so a branch forking off another
    // NOT-YET-remapped candidate (chained forks) is processed after its
    // "parent" branch has already extended the shared map.
    let order = topo_order(repo, &needing);

    let mut map = rewritten.clone();
    for idx in order {
        let (refname, tip) = &needing[idx];
        match remap_one_branch(repo, &map, *tip) {
            Ok(BranchOutcome::Remapped(new_tip, pairs)) => {
                match move_ref_in_batch(repo, primary_backup, op, refname, new_tip) {
                    Ok(()) => {
                        for (old, new) in pairs {
                            map.insert(old, new);
                        }
                        map.insert(*tip, new_tip);
                        outcome.remapped.push(refname.clone());
                    }
                    Err(_) => outcome.skipped.push(refname.clone()),
                }
            }
            Ok(BranchOutcome::Conflict) | Err(_) => outcome.skipped.push(refname.clone()),
        }
    }

    outcome.remapped.sort();
    outcome.skipped.sort();
    outcome
}

/// Every local branch except `exclude_ref` and `refs/adgitter/*`, as
/// (full ref name, tip oid).
fn collect_local_branches(
    repo: &Repository,
    exclude_ref: &str,
) -> AdgitterResult<Vec<(String, Oid)>> {
    let mut out = Vec::new();
    for b in repo.branches(Some(BranchType::Local))? {
        let (branch, _) = b?;
        let Some(refname) = branch.get().name() else {
            continue;
        };
        if refname == exclude_ref || refname.starts_with("refs/adgitter/") {
            continue;
        }
        let Some(tip) = branch.get().target() else {
            continue;
        };
        out.push((refname.to_string(), tip));
    }
    Ok(out)
}

/// A branch needs remapping when its tip is a descendant of (or literally
/// is) some OLD commit in `rewritten`, and isn't already sitting on one of
/// the NEW commits (nothing to do there).
fn needs_remap(repo: &Repository, rewritten: &HashMap<Oid, Oid>, tip: Oid) -> bool {
    if rewritten.values().any(|&new| new == tip) {
        return false;
    }
    rewritten
        .keys()
        .any(|&old| old == tip || repo.graph_descendant_of(tip, old).unwrap_or(false))
}

/// Topological order (indices into `branches`) such that a branch whose tip
/// is an ancestor of another candidate's tip is processed first — chained
/// forks (B forks after the rewrite, C forks off B) must remap B before C so
/// C's replay can look up B's already-extended mapping. Falls back to
/// appending any branch a cycle would otherwise strand (ancestry is a
/// partial order, so this should not happen in practice).
fn topo_order(repo: &Repository, branches: &[(String, Oid)]) -> Vec<usize> {
    let n = branches.len();
    let mut edges: Vec<Vec<usize>> = vec![Vec::new(); n];
    let mut indegree = vec![0usize; n];
    for i in 0..n {
        for j in 0..n {
            if i == j {
                continue;
            }
            let (oi, oj) = (branches[i].1, branches[j].1);
            if oi != oj && repo.graph_descendant_of(oj, oi).unwrap_or(false) {
                // i is an ancestor of j: i must be processed first.
                edges[i].push(j);
                indegree[j] += 1;
            }
        }
    }

    let mut queue: VecDeque<usize> = (0..n).filter(|&i| indegree[i] == 0).collect();
    let mut order = Vec::with_capacity(n);
    while let Some(i) = queue.pop_front() {
        order.push(i);
        for &j in &edges[i] {
            indegree[j] -= 1;
            if indegree[j] == 0 {
                queue.push_back(j);
            }
        }
    }
    if order.len() < n {
        for i in 0..n {
            if !order.contains(&i) {
                order.push(i);
            }
        }
    }
    order
}

/// Outcome of replaying ONE branch's extra commits.
enum BranchOutcome {
    /// New tip oid, plus every (old, new) commit pair created along the way
    /// (not just the tip) — folded into the shared map so a later, chained
    /// fork off one of this branch's own commits resolves correctly.
    Remapped(Oid, Vec<(Oid, Oid)>),
    /// A non-merge commit's replay hit a real conflict — left untouched.
    Conflict,
}

/// Resolve `oid` through `local` (this branch's own new commits so far),
/// falling back to the shared `map`, else unchanged (an ancestor outside the
/// rewritten range entirely — e.g. a side branch that predates the rewrite).
fn resolve(oid: Oid, local: &HashMap<Oid, Oid>, map: &HashMap<Oid, Oid>) -> Oid {
    local
        .get(&oid)
        .or_else(|| map.get(&oid))
        .copied()
        .unwrap_or(oid)
}

/// Replay `tip`'s commits that sit strictly on top of `map`'s old keys (the
/// primary rewrite plus every already-remapped branch this pass has folded
/// in), oldest-first:
/// - non-merge commits are cherry-picked (diff replay) onto their mapped
///   parent, exactly like `rebase.rs`'s `replay` — a conflict there is
///   reported, never silently resolved;
/// - merge commits are re-created with every parent mapped through `map`
///   and their ORIGINAL tree preserved (see the module doc's "merge-commit
///   limitation").
///
/// Builds every new commit as a detached, loose object first — nothing is
/// written to a ref here — so a conflict (or any error) leaves the
/// repository exactly as it was; the caller only moves the branch ref once
/// this returns a full success.
fn remap_one_branch(
    repo: &Repository,
    map: &HashMap<Oid, Oid>,
    tip: Oid,
) -> AdgitterResult<BranchOutcome> {
    let mut walk = repo.revwalk()?;
    walk.push(tip)?;
    for &old in map.keys() {
        // `hide` is a no-op when `old` isn't actually an ancestor of `tip`.
        let _ = walk.hide(old);
    }
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::REVERSE)?;
    let mut commits = Vec::new();
    for oid in walk {
        commits.push(oid?);
    }

    if commits.is_empty() {
        // `tip` itself is already one of the rewritten keys (e.g. a branch
        // marker sitting exactly on the reworded/dropped/purged commit with
        // nothing after it) — just follow it to its replacement.
        let new_tip = map.get(&tip).copied().unwrap_or(tip);
        return Ok(BranchOutcome::Remapped(new_tip, Vec::new()));
    }

    let committer = signature(repo)?;
    let mut local: HashMap<Oid, Oid> = HashMap::new();

    for oid in &commits {
        let commit = repo.find_commit(*oid)?;
        // The walk above reaches everything behind `tip` that isn't hidden by
        // an old key — including side-branch lines merged in below the
        // rewrite, whose commits are NOT descendants of any rewritten commit.
        // A commit none of whose parents resolves differently sits on such an
        // untouched line: keep it byte-identical (skip re-creation entirely)
        // instead of replaying it into a same-content twin with a fresh
        // committer timestamp — a pure identity churn that would also break
        // the "side branch stays put" guarantee.
        // (A root commit has no parents, so `all` is vacuously true and it is
        // rightly skipped — a root can never descend from a rewritten commit.)
        let untouched = commit.parent_ids().all(|p| resolve(p, &local, map) == p);
        if untouched {
            continue;
        }
        let new_oid = if commit.parent_count() <= 1 {
            match commit.parent(0) {
                Ok(parent) => {
                    let mapped_parent_id = resolve(parent.id(), &local, map);
                    let mapped_parent = repo.find_commit(mapped_parent_id)?;
                    let mut index = repo.cherrypick_commit(&commit, &mapped_parent, 0, None)?;
                    if index.has_conflicts() {
                        return Ok(BranchOutcome::Conflict);
                    }
                    let tree = repo.find_tree(index.write_tree_to(repo)?)?;
                    repo.commit(
                        None,
                        &commit.author(),
                        &committer,
                        commit.message().unwrap_or(""),
                        &tree,
                        &[&mapped_parent],
                    )?
                }
                // A root commit reachable here means this branch shares no
                // rewritten ancestor after all (shouldn't happen given the
                // `needs_remap` gate) — keep it byte-identical rather than
                // guess.
                Err(_) => *oid,
            }
        } else {
            let parent_commits: Vec<Commit> = commit
                .parent_ids()
                .map(|p| repo.find_commit(resolve(p, &local, map)))
                .collect::<Result<_, _>>()?;
            let parent_refs: Vec<&Commit> = parent_commits.iter().collect();
            repo.commit(
                None,
                &commit.author(),
                &committer,
                commit.message().unwrap_or(""),
                &commit.tree()?,
                &parent_refs,
            )?
        };
        local.insert(*oid, new_oid);
    }

    // The tip is topologically last and — per the `needs_remap` gate — has a
    // rewritten ancestor, so it is normally in `local`; resolve() keeps this
    // robust if a future gate change ever lets an untouched tip through.
    let last = *commits.last().expect("checked non-empty above");
    let new_tip = resolve(last, &local, map);
    Ok(BranchOutcome::Remapped(
        new_tip,
        local.into_iter().collect(),
    ))
}

/// Snapshot `refname`'s CURRENT (pre-move) target into `primary_backup`'s
/// batch, then move it to `new_tip`. If the ref move itself fails after the
/// backup was taken (rare), the just-made backup is deleted so the branch is
/// left exactly as it was — no orphan backup, no partially-applied remap.
fn move_ref_in_batch(
    repo: &Repository,
    primary_backup: &Backup,
    op: &str,
    refname: &str,
    new_tip: Oid,
) -> AdgitterResult<()> {
    let backup = add_to_batch(repo, primary_backup, op, refname)?;
    let mut r = repo.find_reference(refname)?;
    if let Err(e) = r.set_target(new_tip, &format!("adgitter: {op} descendant remap")) {
        if let Ok(mut br) = repo.find_reference(&backup.backup_ref) {
            let _ = br.delete();
        }
        return Err(e.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::branch::{checkout, create_branch};
    use crate::history::reword;
    use crate::mutate::undo_last;
    use crate::purge::purge_path;
    use crate::rebase::drop_commit;
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

    fn tip(repo: &Repository, branch: &str) -> Oid {
        repo.find_branch(branch, BranchType::Local)
            .unwrap()
            .get()
            .target()
            .unwrap()
    }

    fn tree_of(repo: &Repository, oid: Oid) -> git2::Oid {
        repo.find_commit(oid).unwrap().tree_id()
    }

    fn subjects_from(repo: &Repository, oid: Oid) -> Vec<String> {
        let mut walk = repo.revwalk().unwrap();
        walk.push(oid).unwrap();
        walk.map(|o| {
            repo.find_commit(o.unwrap())
                .unwrap()
                .summary()
                .unwrap()
                .to_string()
        })
        .collect()
    }

    /// main: base -> X -> d1; feature forks at d1 with one extra commit.
    /// Rewording X must carry feature over: same subjects, same TREES
    /// (reword changes no content), new hashes, no orphan reference.
    #[test]
    fn reword_remaps_a_branch_forked_after_the_target() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "base.txt", "0");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();
        let x = commit(p, "x.txt", "x");
        commit(p, "d1.txt", "d");

        create_branch(p.into(), "feature".into(), "HEAD".into()).unwrap();
        checkout(p.into(), "feature".into()).unwrap();
        commit(p, "f1.txt", "f");
        let old_feature_tip = tip(&repo, "feature");
        let old_feature_tree = tree_of(&repo, old_feature_tip);

        checkout(p.into(), main.clone()).unwrap();
        let outcome = reword(p.into(), x, "renamed X".into())
            .unwrap()
            .unwrap_completed();

        assert_eq!(outcome.remapped, vec!["refs/heads/feature".to_string()]);
        assert!(outcome.skipped.is_empty());

        let new_feature_tip = tip(&repo, "feature");
        assert_ne!(new_feature_tip, old_feature_tip, "hash must change");
        // Content untouched: the tip TREE is byte-identical.
        assert_eq!(tree_of(&repo, new_feature_tip), old_feature_tree);
        // The reworded message is in feature's ancestry; subjects preserved.
        let subs = subjects_from(&repo, new_feature_tip);
        assert!(subs.contains(&"renamed X".to_string()), "{subs:?}");
        assert!(subs.contains(&"add f1.txt".to_string()));
    }

    /// feature (forked after X) contains a MERGE of a side branch that
    /// predates X's rewrite: the merge is re-created with mapped parents and
    /// its ORIGINAL tree preserved; the pre-rewrite side branch is untouched.
    #[test]
    fn reword_recreates_a_downstream_merge_with_mapped_parents() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "base.txt", "0");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();

        // side forks BEFORE X — its commits must never be rewritten.
        create_branch(p.into(), "side".into(), "HEAD".into()).unwrap();
        checkout(p.into(), "side".into()).unwrap();
        commit(p, "s1.txt", "s");
        let side_tip_before = tip(&repo, "side");

        checkout(p.into(), main.clone()).unwrap();
        let x = commit(p, "x.txt", "x");

        // feature forks after X and merges side in.
        create_branch(p.into(), "feature".into(), "HEAD".into()).unwrap();
        checkout(p.into(), "feature".into()).unwrap();
        crate::history::merge(p.into(), "side".into()).unwrap();
        let old_merge_tip = tip(&repo, "feature");
        let old_merge_tree = tree_of(&repo, old_merge_tip);
        assert_eq!(
            repo.find_commit(old_merge_tip).unwrap().parent_count(),
            2,
            "fixture must end in a real merge"
        );

        checkout(p.into(), main.clone()).unwrap();
        let outcome = reword(p.into(), x, "renamed X".into())
            .unwrap()
            .unwrap_completed();
        assert_eq!(outcome.remapped, vec!["refs/heads/feature".to_string()]);

        let new_merge = repo.find_commit(tip(&repo, "feature")).unwrap();
        assert_eq!(new_merge.parent_count(), 2, "merge shape preserved");
        assert_eq!(new_merge.tree_id(), old_merge_tree, "resolution preserved");
        // Second parent still the UNTOUCHED side tip (predates the rewrite).
        assert_eq!(new_merge.parent_id(1).unwrap(), side_tip_before);
        assert_eq!(tip(&repo, "side"), side_tip_before);
        // First parent chain reaches the reworded X.
        let subs = subjects_from(&repo, new_merge.id());
        assert!(subs.contains(&"renamed X".to_string()), "{subs:?}");
    }

    /// Dropping X replays the fork WITHOUT X's content (diff replay, not
    /// tree preservation): x.txt is gone from the remapped branch's tip.
    #[test]
    fn drop_replays_a_downstream_fork_without_the_dropped_content() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "base.txt", "0");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();
        let x = commit(p, "x.txt", "x");
        commit(p, "d1.txt", "d");

        create_branch(p.into(), "feature".into(), "HEAD".into()).unwrap();
        checkout(p.into(), "feature".into()).unwrap();
        commit(p, "f1.txt", "f");

        checkout(p.into(), main.clone()).unwrap();
        let outcome = drop_commit(p.into(), x).unwrap().unwrap_completed();
        assert_eq!(outcome.remapped, vec!["refs/heads/feature".to_string()]);

        let new_tip = repo
            .find_commit(tip(&repo, "feature"))
            .unwrap()
            .tree()
            .unwrap();
        assert!(new_tip.get_path(Path::new("x.txt")).is_err(), "x purged");
        assert!(new_tip.get_path(Path::new("f1.txt")).is_ok(), "f1 kept");
    }

    /// A fork whose replay CONFLICTS with the drop stays exactly where it
    /// was and is reported by name; the primary op still applies.
    #[test]
    fn conflicting_fork_is_skipped_and_left_untouched() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "base.txt", "0");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();
        let x = commit(p, "shared.txt", "from x");
        commit(p, "d1.txt", "d");

        // feature edits the very lines X introduced — replay must conflict.
        create_branch(p.into(), "feature".into(), "HEAD".into()).unwrap();
        checkout(p.into(), "feature".into()).unwrap();
        commit(p, "shared.txt", "feature edit of x's lines");
        let old_feature_tip = tip(&repo, "feature");

        checkout(p.into(), main.clone()).unwrap();
        let outcome = drop_commit(p.into(), x).unwrap().unwrap_completed();

        assert_eq!(outcome.skipped, vec!["refs/heads/feature".to_string()]);
        assert!(outcome.remapped.is_empty());
        assert_eq!(tip(&repo, "feature"), old_feature_tip, "left untouched");
        // Primary op still applied: shared.txt gone from main's tip.
        let main_tree = repo.find_commit(tip(&repo, &main)).unwrap().tree().unwrap();
        assert!(main_tree.get_path(Path::new("shared.txt")).is_err());
    }

    /// Chained forks: C forks off B's own extra commit; both must remap and
    /// C's new chain must run through B's NEW commit.
    #[test]
    fn chained_forks_remap_through_the_shared_map() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "base.txt", "0");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();
        let x = commit(p, "x.txt", "x");

        create_branch(p.into(), "b".into(), "HEAD".into()).unwrap();
        checkout(p.into(), "b".into()).unwrap();
        commit(p, "b1.txt", "b");
        create_branch(p.into(), "c".into(), "HEAD".into()).unwrap();
        checkout(p.into(), "c".into()).unwrap();
        commit(p, "c1.txt", "c");

        checkout(p.into(), main.clone()).unwrap();
        let outcome = reword(p.into(), x, "renamed X".into())
            .unwrap()
            .unwrap_completed();
        assert_eq!(
            outcome.remapped,
            vec!["refs/heads/b".to_string(), "refs/heads/c".to_string()]
        );

        let b_tip = tip(&repo, "b");
        let c_tip = tip(&repo, "c");
        // C's parent IS b's new tip (fork point preserved on the new chain).
        assert_eq!(
            repo.find_commit(c_tip).unwrap().parent_id(0).unwrap(),
            b_tip
        );
        assert!(subjects_from(&repo, c_tip).contains(&"renamed X".to_string()));
    }

    /// Purging a file at X strips it from a downstream fork too (the fork's
    /// replayed commits sit on a base that no longer has the file).
    #[test]
    fn purge_carries_a_downstream_fork_onto_the_stripped_chain() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "base.txt", "0");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();
        let x = commit(p, "secret.txt", "s3cr3t");
        commit(p, "d1.txt", "d");

        create_branch(p.into(), "feature".into(), "HEAD".into()).unwrap();
        checkout(p.into(), "feature".into()).unwrap();
        commit(p, "f1.txt", "f");

        checkout(p.into(), main.clone()).unwrap();
        let outcome = purge_path(p.into(), x, "secret.txt".into()).unwrap();
        assert_eq!(outcome.remapped, vec!["refs/heads/feature".to_string()]);

        // The secret is absent from EVERY commit of the remapped fork.
        let mut walk = repo.revwalk().unwrap();
        walk.push(tip(&repo, "feature")).unwrap();
        for oid in walk {
            let c = repo.find_commit(oid.unwrap()).unwrap();
            assert!(
                c.tree().unwrap().get_path(Path::new("secret.txt")).is_err(),
                "secret leaked in {}",
                c.id()
            );
        }
    }

    /// One undo restores the WHOLE batch: the op's own branch AND every
    /// remapped descendant go back to their pre-op tips together.
    #[test]
    fn undo_restores_every_remapped_ref_as_one_unit() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "base.txt", "0");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();
        let x = commit(p, "x.txt", "x");

        create_branch(p.into(), "feature".into(), "HEAD".into()).unwrap();
        checkout(p.into(), "feature".into()).unwrap();
        commit(p, "f1.txt", "f");
        let old_feature_tip = tip(&repo, "feature");

        checkout(p.into(), main.clone()).unwrap();
        let old_main_tip = tip(&repo, &main);
        let outcome = reword(p.into(), x, "renamed X".into())
            .unwrap()
            .unwrap_completed();
        assert_eq!(outcome.remapped.len(), 1);
        assert_ne!(tip(&repo, "feature"), old_feature_tip);

        undo_last(p.into()).unwrap().expect("something to undo");

        assert_eq!(tip(&repo, &main), old_main_tip, "main restored");
        assert_eq!(tip(&repo, "feature"), old_feature_tip, "fork restored");
    }
}
