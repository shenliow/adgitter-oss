//! Structure-preserving cherry-pick of an arbitrary commit selection.
//!
//! The selection is treated as a set, never as a click-order list. Each
//! selected commit is replayed after everything it descends from within the
//! selection (topological order, ties broken oldest-author-time first, then
//! input position), and the selection's own shape is rebuilt on the target:
//!
//! * every parent edge of a selected commit is re-pointed at the replay of the
//!   *nearest selected ancestor* along that edge, or at the target tip when the
//!   edge reaches no selected commit;
//! * a merge whose parent edges still land on ≥2 distinct, mutually unrelated
//!   new parents is re-created as a merge of those parents (the rewritten
//!   parents are merged again, like `git rebase --rebase-merges`);
//! * a merge whose edges collapse onto one new parent becomes an ordinary
//!   commit carrying the merge's changes relative to that edge's parent
//!   (`git cherry-pick -m <n>`).
//!
//! A selection with several independent tips (lines no selected merge joins)
//! cannot all end on one branch, so the lines are stacked: each later line
//! (ordered by its tip's author time) is rooted on the previous line's
//! replayed tip instead of on the target tip — every edge leaving the line
//! lands there — keeping each line's own shape. The last replayed commit is
//! therefore a descendant of every other one and becomes the branch tip.
//!
//! All new commits are written to the object database without touching HEAD;
//! the branch only moves (with a safe checkout) once every commit replayed, so
//! a conflict leaves the repository exactly as it was.

use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap, HashSet};

use git2::{build::CheckoutBuilder, Commit, Oid, Repository};

use crate::error::{AdgitterError, AdgitterResult};

/// Where a replayed commit's parent edge points.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum NewParent {
    /// The replay of this selected commit.
    Picked(Oid),
    /// The commit the selection is rooted on (target tip, or the previous
    /// line's tip for a stacked independent line).
    Base,
}

/// One commit of the plan, in replay order.
#[derive(Debug, Clone)]
pub(crate) struct PlanStep {
    pub commit: Oid,
    /// One entry per original parent edge, in the original parent order.
    pub parents: Vec<NewParent>,
    /// What `NewParent::Base` resolves to: `None` = the target tip, `Some(s)` =
    /// the replay of selected tip `s` (a stacked independent line).
    pub base: Option<Oid>,
}

/// The selection's nearest selected ancestor along `parent`, or `None` when
/// that edge reaches no selected commit. When several unrelated selected
/// commits are equally near, the one latest in `rank` wins.
fn nearest_selected(
    repo: &Repository,
    parent: Oid,
    selected: &[Oid],
    rank: &HashMap<Oid, (i64, usize)>,
) -> AdgitterResult<Option<Oid>> {
    let mut reach = Vec::new();
    for &s in selected {
        if s == parent || repo.graph_descendant_of(parent, s)? {
            reach.push(s);
        }
    }
    // Keep only the maximal ones (not an ancestor of another reachable one).
    let mut best: Option<Oid> = None;
    for &a in &reach {
        let mut dominated = false;
        for &b in &reach {
            if a != b && repo.graph_descendant_of(b, a)? {
                dominated = true;
                break;
            }
        }
        if !dominated && best.is_none_or(|cur| rank[&a] > rank[&cur]) {
            best = Some(a);
        }
    }
    Ok(best)
}

/// Build the replay plan for `selected` (deduplicated, any order).
pub(crate) fn plan(repo: &Repository, selected: &[Oid]) -> AdgitterResult<Vec<PlanStep>> {
    let mut uniq = Vec::new();
    let mut seen = HashSet::new();
    for &s in selected {
        if seen.insert(s) {
            uniq.push(s);
        }
    }
    let mut rank = HashMap::new();
    for (i, &s) in uniq.iter().enumerate() {
        let c = repo.find_commit(s)?;
        rank.insert(s, (c.author().when().seconds(), i));
    }

    // Induced parent edges.
    let mut edges: HashMap<Oid, Vec<NewParent>> = HashMap::new();
    for &s in &uniq {
        let c = repo.find_commit(s)?;
        // A parentless (root) commit is rooted on the base like any other.
        let mut ps = if c.parent_count() == 0 {
            vec![NewParent::Base]
        } else {
            Vec::new()
        };
        for p in c.parent_ids() {
            ps.push(match nearest_selected(repo, p, &uniq, &rank)? {
                Some(a) => NewParent::Picked(a),
                None => NewParent::Base,
            });
        }
        edges.insert(s, ps);
    }

    // Tips = selected commits no other selected commit points at.
    let mut has_child = HashSet::new();
    for ps in edges.values() {
        for p in ps {
            if let NewParent::Picked(a) = p {
                has_child.insert(*a);
            }
        }
    }
    let mut tips: Vec<Oid> = uniq
        .iter()
        .copied()
        .filter(|s| !has_child.contains(s))
        .collect();
    tips.sort_by_key(|t| rank[t]);

    // Line membership: each later tip's not-yet-covered ancestry is rooted on
    // the previous tip (stacking), the first line on the target tip.
    let mut base_of: HashMap<Oid, Option<Oid>> = HashMap::new();
    let mut prev_tip: Option<Oid> = None;
    for &tip in &tips {
        let mut stack = vec![tip];
        while let Some(n) = stack.pop() {
            if base_of.contains_key(&n) {
                continue;
            }
            base_of.insert(n, prev_tip);
            for p in &edges[&n] {
                if let NewParent::Picked(a) = p {
                    stack.push(*a);
                }
            }
        }
        prev_tip = Some(tip);
    }
    // In a stacked line, an edge into an earlier line (or to the base) now
    // lands on the previous line's tip, which already contains every earlier
    // line — the line is rebased onto it with its own shape intact.
    for (&n, ps) in edges.iter_mut() {
        let line = base_of[&n];
        if line.is_none() {
            continue;
        }
        for p in ps.iter_mut() {
            if let NewParent::Picked(a) = *p {
                if base_of[&a] != line {
                    *p = NewParent::Base;
                }
            }
        }
    }

    // Kahn's topological sort over picked edges + stacking edges, ready set
    // ordered oldest author time first, then input position.
    let deps = |n: Oid| -> Vec<Oid> {
        let mut d: Vec<Oid> = edges[&n]
            .iter()
            .filter_map(|p| match p {
                NewParent::Picked(a) => Some(*a),
                NewParent::Base => None,
            })
            .collect();
        if edges[&n].contains(&NewParent::Base) {
            if let Some(Some(b)) = base_of.get(&n) {
                d.push(*b);
            }
        }
        d.sort();
        d.dedup();
        d
    };
    let mut indeg: HashMap<Oid, usize> = HashMap::new();
    let mut children: HashMap<Oid, Vec<Oid>> = HashMap::new();
    for &n in &uniq {
        let d = deps(n);
        indeg.insert(n, d.len());
        for a in d {
            children.entry(a).or_default().push(n);
        }
    }
    let mut ready: BinaryHeap<Reverse<((i64, usize), Oid)>> = uniq
        .iter()
        .filter(|n| indeg[n] == 0)
        .map(|&n| Reverse((rank[&n], n)))
        .collect();
    let mut out = Vec::with_capacity(uniq.len());
    while let Some(Reverse((_, n))) = ready.pop() {
        out.push(PlanStep {
            commit: n,
            parents: edges[&n].clone(),
            base: base_of.get(&n).copied().flatten(),
        });
        for &c in children.get(&n).map(Vec::as_slice).unwrap_or(&[]) {
            let e = indeg.get_mut(&c).unwrap();
            *e -= 1;
            if *e == 0 {
                ready.push(Reverse((rank[&c], c)));
            }
        }
    }
    if out.len() != uniq.len() {
        return Err(AdgitterError::Internal(
            "cherry-pick selection has a cycle".into(),
        ));
    }
    Ok(out)
}

/// Tree for `pick` replayed on `onto`, applying its changes relative to its
/// parent number `mainline` (1-based; 0 for a non-merge / root commit).
fn replay_tree(
    repo: &Repository,
    pick: &Commit<'_>,
    onto: &Commit<'_>,
    mainline: u32,
) -> AdgitterResult<git2::Index> {
    if pick.parent_count() == 0 {
        let empty = repo.find_tree(repo.treebuilder(None)?.write()?)?;
        return Ok(repo.merge_trees(&empty, &onto.tree()?, &pick.tree()?, None)?);
    }
    Ok(repo.cherrypick_commit(pick, onto, mainline, None)?)
}

/// Tree for a re-created merge of `parents` (≥2, original edge order).
fn remerge_tree(repo: &Repository, parents: &[Commit<'_>]) -> AdgitterResult<git2::Index> {
    let first = &parents[0];
    let mut acc_tree = first.tree()?;
    let mut last = None;
    for other in &parents[1..] {
        let base = repo.merge_base(first.id(), other.id())?;
        let base_tree = repo.find_commit(base)?.tree()?;
        let idx = repo.merge_trees(&base_tree, &acc_tree, &other.tree()?, None)?;
        if idx.has_conflicts() {
            return Ok(idx);
        }
        let mut idx = idx;
        acc_tree = repo.find_tree(idx.write_tree_to(repo)?)?;
        last = Some(idx);
    }
    Ok(last.expect("at least two parents"))
}

/// Replay the plan on top of `onto`; returns the new tip. Writes objects only
/// — no ref or working-tree change. On a conflict returns `Conflict` naming
/// the original commit.
pub(crate) fn replay(
    repo: &Repository,
    steps: &[PlanStep],
    onto: Oid,
    committer: &git2::Signature<'_>,
) -> AdgitterResult<Oid> {
    let mut new_of: HashMap<Oid, Oid> = HashMap::new();
    let mut last = onto;
    for step in steps {
        let pick = repo.find_commit(step.commit)?;
        let base = match step.base {
            Some(prev_tip) => new_of[&prev_tip],
            None => onto,
        };
        // Resolve every edge, then drop duplicates and any parent that is an
        // ancestor of another (merging an ancestor is a no-op).
        let resolved: Vec<(usize, Oid)> = step
            .parents
            .iter()
            .enumerate()
            .map(|(i, p)| {
                (
                    i,
                    match p {
                        NewParent::Picked(a) => new_of[a],
                        NewParent::Base => base,
                    },
                )
            })
            .collect();
        let mut kept: Vec<(usize, Oid)> = Vec::new();
        for &(i, oid) in &resolved {
            if kept.iter().any(|&(_, k)| k == oid) {
                continue;
            }
            let mut redundant = false;
            for &(_, other) in &resolved {
                if other != oid && repo.graph_descendant_of(other, oid)? {
                    redundant = true;
                    break;
                }
            }
            if !redundant {
                kept.push((i, oid));
            }
        }
        if kept.is_empty() {
            kept.push((0, base));
        }

        let parents: Vec<Commit<'_>> = kept
            .iter()
            .map(|&(_, oid)| repo.find_commit(oid))
            .collect::<Result<_, _>>()?;
        let mut index = if parents.len() >= 2 {
            remerge_tree(repo, &parents)?
        } else {
            let mainline = if pick.parent_count() > 1 {
                kept[0].0 as u32 + 1
            } else {
                0
            };
            replay_tree(repo, &pick, &parents[0], mainline)?
        };
        if index.has_conflicts() {
            return Err(AdgitterError::Conflict {
                sha: pick.id().to_string(),
            });
        }
        let tree = repo.find_tree(index.write_tree_to(repo)?)?;
        let parent_refs: Vec<&Commit<'_>> = parents.iter().collect();
        let new = repo.commit(
            None,
            &pick.author(),
            committer,
            pick.message().unwrap_or("cherry-pick"),
            &tree,
            &parent_refs,
        )?;
        new_of.insert(step.commit, new);
        last = new;
    }
    Ok(last)
}

/// Move `branch` (checked out, at `old`) to `new`, safely updating the working
/// tree so uncommitted edits to untouched files survive.
pub(crate) fn advance_checked_out(
    repo: &Repository,
    branch: &str,
    old: Oid,
    new: Oid,
) -> AdgitterResult<()> {
    let tree = repo.find_commit(new)?.tree()?;
    let mut co = CheckoutBuilder::new();
    co.safe();
    repo.checkout_tree(tree.as_object(), Some(&mut co))?;
    repo.reference_matching(branch, new, true, old, &format!("cherry-pick: {new}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use git2::{Repository, Signature, Time};
    use std::path::Path;

    use crate::error::AdgitterError;

    fn init(dir: &Path) -> Repository {
        let repo = Repository::init(dir).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Tester").unwrap();
        cfg.set_str("user.email", "t@example.com").unwrap();
        repo
    }

    /// Commit (off-HEAD, on no ref) `files` added to `parents[0]`'s tree —
    /// or, for a merge, onto the union given by `files` — at author time `t`.
    fn mk(
        repo: &Repository,
        parents: &[git2::Oid],
        files: &[(&str, &str)],
        msg: &str,
        t: i64,
    ) -> git2::Oid {
        let mut tb = match parents.first() {
            Some(p) => repo
                .treebuilder(Some(&repo.find_commit(*p).unwrap().tree().unwrap()))
                .unwrap(),
            None => repo.treebuilder(None).unwrap(),
        };
        // A merge carries over the second parent's files too.
        for p in parents.iter().skip(1) {
            let tree = repo.find_commit(*p).unwrap().tree().unwrap();
            for e in tree.iter() {
                tb.insert(e.name().unwrap(), e.id(), e.filemode()).unwrap();
            }
        }
        for (name, content) in files {
            let blob = repo.blob(content.as_bytes()).unwrap();
            tb.insert(name, blob, 0o100644).unwrap();
        }
        let tree = repo.find_tree(tb.write().unwrap()).unwrap();
        let sig = Signature::new("A", "a@x", &Time::new(t, 0)).unwrap();
        let ps: Vec<_> = parents
            .iter()
            .map(|p| repo.find_commit(*p).unwrap())
            .collect();
        let pr: Vec<_> = ps.iter().collect();
        repo.commit(None, &sig, &sig, msg, &tree, &pr).unwrap()
    }

    /// Point `main` at `at`, check it out (forced) and return the repo path.
    fn checkout_main(repo: &Repository, at: git2::Oid) {
        repo.reference("refs/heads/main", at, true, "t").unwrap();
        repo.set_head("refs/heads/main").unwrap();
        let mut co = git2::build::CheckoutBuilder::new();
        co.force();
        repo.checkout_head(Some(&mut co)).unwrap();
    }

    fn pick(dir: &Path, shas: &[git2::Oid]) -> crate::error::AdgitterResult<()> {
        crate::cherry_pick(
            dir.to_path_buf(),
            shas.iter().map(|s| s.to_string()).collect(),
        )
    }

    fn head(repo: &Repository) -> git2::Commit<'_> {
        repo.head().unwrap().peel_to_commit().unwrap()
    }

    fn summary(c: &git2::Commit<'_>) -> String {
        c.summary().unwrap().to_string()
    }

    /// base ← target (main) ; base ← c1 ← … source history.
    struct Fx {
        _dir: tempfile::TempDir,
        repo: Repository,
        target: git2::Oid,
    }

    fn fixture() -> (Fx, git2::Oid) {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = init(dir.path());
        let base = mk(&repo, &[], &[("base.txt", "b")], "base", 100);
        let target = mk(&repo, &[base], &[("t.txt", "t")], "target", 150);
        checkout_main(&repo, target);
        (
            Fx {
                _dir: dir,
                repo,
                target,
            },
            base,
        )
    }

    #[test]
    fn click_order_is_ignored_history_order_is_used() {
        let (fx, base) = fixture();
        let r = &fx.repo;
        let c1 = mk(r, &[base], &[("1", "1")], "c1", 200);
        let c2 = mk(r, &[c1], &[("2", "2")], "c2", 300);
        let c3 = mk(r, &[c2], &[("3", "3")], "c3", 400);
        let c4 = mk(r, &[c3], &[("4", "4")], "c4", 500);

        pick(r.workdir().unwrap(), &[c1, c4, c3, c2]).unwrap();

        let mut cur = head(r);
        let mut seen = vec![];
        while cur.id() != fx.target {
            assert_eq!(cur.parent_count(), 1);
            seen.push(summary(&cur));
            cur = cur.parent(0).unwrap();
        }
        assert_eq!(seen, ["c4", "c3", "c2", "c1"]);
        assert!(r.workdir().unwrap().join("4").exists());
    }

    #[test]
    fn a_selected_merge_is_rebuilt_as_a_merge() {
        let (fx, base) = fixture();
        let r = &fx.repo;
        // c1 (main line) and s2 (side) both fork from base; m3 merges s2
        // into c1; c4 follows the merge.
        let c1 = mk(r, &[base], &[("1", "1")], "c1", 200);
        let s2 = mk(r, &[base], &[("2", "2")], "s2", 300);
        let m3 = mk(r, &[c1, s2], &[], "m3", 400);
        let c4 = mk(r, &[m3], &[("4", "4")], "c4", 500);

        pick(r.workdir().unwrap(), &[c1, c4, m3, s2]).unwrap();

        let tip = head(r);
        assert_eq!(summary(&tip), "c4");
        let m = tip.parent(0).unwrap();
        assert_eq!(summary(&m), "m3");
        assert_eq!(m.parent_count(), 2, "merge structure restored");
        let (p1, p2) = (m.parent(0).unwrap(), m.parent(1).unwrap());
        assert_eq!((summary(&p1).as_str(), summary(&p2).as_str()), ("c1", "s2"));
        assert_eq!(p1.parent_id(0).unwrap(), fx.target);
        assert_eq!(p2.parent_id(0).unwrap(), fx.target);
        for f in ["t.txt", "1", "2", "4"] {
            assert!(r.workdir().unwrap().join(f).exists(), "{f}");
        }
    }

    #[test]
    fn a_merge_with_an_unselected_side_becomes_a_plain_commit() {
        let (fx, base) = fixture();
        let r = &fx.repo;
        let c1 = mk(r, &[base], &[("1", "1")], "c1", 200);
        let s2 = mk(r, &[base], &[("2", "2")], "s2", 300);
        let m3 = mk(r, &[c1, s2], &[], "m3", 400);

        pick(r.workdir().unwrap(), &[m3, c1]).unwrap();

        let tip = head(r);
        assert_eq!(summary(&tip), "m3");
        assert_eq!(tip.parent_count(), 1);
        assert_eq!(summary(&tip.parent(0).unwrap()), "c1");
        // The merge's changes (the side's file) come along, like `-m 1`.
        assert!(r.workdir().unwrap().join("2").exists());
    }

    #[test]
    fn independent_lines_are_stacked_in_time_order_keeping_their_shape() {
        let (fx, base) = fixture();
        let r = &fx.repo;
        let a1 = mk(r, &[base], &[("a1", "x")], "a1", 200);
        let b1 = mk(r, &[base], &[("b1", "x")], "b1", 250);
        let a2 = mk(r, &[a1], &[("a2", "x")], "a2", 300);
        let b2 = mk(r, &[b1], &[("b2", "x")], "b2", 350);

        pick(r.workdir().unwrap(), &[b2, a1, b1, a2]).unwrap();

        let mut cur = head(r);
        let mut seen = vec![];
        while cur.id() != fx.target {
            seen.push(summary(&cur));
            cur = cur.parent(0).unwrap();
        }
        assert_eq!(seen, ["b2", "b1", "a2", "a1"]);
    }

    #[test]
    fn a_conflict_changes_nothing() {
        let (fx, base) = fixture();
        let r = &fx.repo;
        let ok = mk(r, &[base], &[("ok", "x")], "ok", 200);
        let clash = mk(r, &[ok], &[("t.txt", "different")], "clash", 300);

        let err = pick(r.workdir().unwrap(), &[ok, clash]).unwrap_err();
        assert!(matches!(err, AdgitterError::Conflict { ref sha } if *sha == clash.to_string()));
        assert_eq!(head(r).id(), fx.target);
        assert!(!r.workdir().unwrap().join("ok").exists());
        assert!(crate::mutate::list_backups(r).unwrap().is_empty());
    }
}
