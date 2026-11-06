//! # Gesture-operation state matrix
//!
//! An exhaustive, table-driven sweep of every history/working-tree operation
//! ADGitter exposes as a drag gesture, across every combination of the four
//! repository-state dimensions that can change its outcome. One `#[test]` per
//! combination, so a failure names the exact combination in `cargo test`
//! output.
//!
//! This is an **integration** test (`tests/`, not an in-crate `#[cfg(test)]`
//! module) on purpose: it may only reach for `git-core`'s public API, which
//! forces every assertion to be about externally observable behaviour — ref
//! positions, DAG topology, working-tree contents, backup/undo — rather than
//! about internal helpers. The per-module `#[cfg(test)]` suites keep their
//! job of pinning internals (lock discipline, exact error strings, orphan
//! backup cleanup after a conflict); this file deliberately does not.
//!
//! ## 1. What each "method" maps to in this codebase
//!
//! The six methods in the original request are natural-language names. Their
//! actual entry points, and why:
//!
//! | Method        | API                                             | Evidence |
//! |---------------|-------------------------------------------------|----------|
//! | merge         | `git_core::merge(repo, source)`                 | Only merge entry point in `lib.rs`; merges `source` INTO the checked-out branch. |
//! | rebase        | `git_core::rebase_branch(repo, branch, onto)`   | The gesture-level wrapper (`dragDispatch.ts` emits `rebaseBranch`); it delegates to `rebase::rebase_onto` -> `rebase::execute` and adds the autostash/checkout dance, so it covers both the "already on the branch" and "on another branch" cases through one call. |
//! | cherry-pick   | `git_core::cherry_pick(repo, commits)`          | Only cherry-pick entry point; applies each commit onto the checked-out branch. |
//! | reword        | `git_core::reword(repo, sha, message)` — TWO code paths | `history::reword` amends in place when `sha == HEAD`, otherwise replays through the rebase engine (`rebase::pick_steps` + `rebase::execute`). Both paths are exercised: `RewordTip` targets `from`'s tip, `RewordOlder` targets the commit below it. |
//! | add file      | `git_core::add_file_to_commit(repo, sha, path)` | `inject.rs` — "I forgot to commit this file back then, add it retroactively": takes the CURRENT working tree's content of `path` and writes it into `sha`'s tree and every descendant up to the tip. This — not `workdir::stage`+`commit` — is the commit-targeted "add file" gesture, because the matrix's `commit:` dimension only makes sense for an op that takes a commit. |
//! | remove file   | `git_core::purge_path(repo, sha, path)`         | `purge.rs`, documented as the exact inverse of `inject.rs`; same `(sha, path)` shape. |
//!
//! `reword` is therefore split into two method rows, matching its two
//! documented code paths, which is why the grid below has 7 method rows
//! rather than 6.
//!
//! ## 2. The four state dimensions
//!
//! Fixture (built fresh per case, in a `TempDir`):
//!
//! ```text
//!                    t1  (main.txt)              <- branch `target`
//!                   /
//!   c0 (base.txt) -+--  f1 (feat.txt) -- f2 (feat2.txt)   <- branch `from`
//!                   \
//!                    o1  (other.txt)             <- branch `other`
//! ```
//!
//! * **`current branch: From | Target | Other`** — which branch is checked out
//!   when the operation runs. `From` is the gesture's source branch, `Target`
//!   its destination, `Other` an unrelated third branch. Asserted invariant
//!   across every case: an operation must leave you on the branch you started
//!   on (`@symbolic` never changes), even when it internally checks another
//!   branch out (`rebase_branch`).
//!
//! * **`work directory: Clean | Dirty`** — `Dirty` modifies `base.txt` in the
//!   working tree without staging it. `base.txt` is committed in the ROOT
//!   commit and never touched again, so it is byte-identical on all three
//!   branches: the dirty change can therefore never *conflict* with a branch
//!   switch. That isolates the operation's own handling of uncommitted work
//!   from checkout-safety, which is already covered by
//!   `branch.rs::checkout_refuses_to_clobber_conflicting_changes` and is
//!   deliberately not re-tested here. In every case the assertion is the
//!   same: **the dirty edit must still be there afterwards**, whether the
//!   operation succeeded or failed.
//!   (For `AddFile` the injected file `inject.txt` is created untracked in
//!   both `Clean` and `Dirty` variants — the operation is defined in terms of
//!   working-tree content, so it cannot run without it. `Dirty` there means
//!   "and there is also an unrelated uncommitted edit".)
//!
//! * **`commit: Referenced | Unreferenced`** — whether an ADDITIONAL branch
//!   (`marker`) points at the commit the operation acts on, beyond the branch
//!   the gesture itself is expressed against. This is the dimension that
//!   drives `remap.rs`: rewriting a commit that another branch sits on must
//!   carry that branch over to the rewritten chain (and say so in
//!   `RemapOutcome::remapped`) rather than leaving it pointing at an
//!   orphaned commit. The commit `marker` sits on is the one that method
//!   operates on: `f2` for merge/cherry-pick/reword-tip, `f1` for
//!   rebase/reword-older/add-file/remove-file.
//!
//! * **`branch: Merged | Open`** — whether `from` has already been merged into
//!   `target` (an extra merge commit on `target`) before the operation runs.
//!   `Merged` is the important boundary: it makes `from`'s commits reachable
//!   from `target`, which flips several operations from "rejected, not on
//!   this branch" to "allowed, and now rewriting a range that contains a
//!   merge commit".
//!
//! ## 3. Combination count
//!
//! 7 method rows x 3 heads x 2 work-dir states x 2 commit-ref states x
//! 2 branch states = **168 cases, all 168 implemented**.
//!
//! **No combination is excluded.** Every one is constructible and executable,
//! so none is skipped. What does vary is how much a dimension discriminates;
//! the degenerate (constructible, executable, but behaviourally inert)
//! sub-grids are listed here explicitly rather than dropped:
//!
//! | Combination | Why it is degenerate (kept anyway) |
//! |-------------|------------------------------------|
//! | `Merge` x `head=From` (8 cases) | `merge` is defined as "merge `source` INTO HEAD", so with HEAD on `from` the gesture "merge from into target" cannot be expressed at all; what actually runs is `merge from into from` = always up-to-date. `branch` and `commit` make no difference. Kept because "does a no-op merge stay a true no-op (no ref moved, no orphan undo entry)" is worth pinning. |
//! | `Merge` x `head=Other` (8 cases) | Also not the gesture: it merges `from` into `other`. `branch` makes no difference (`other` never contains `from`). Kept to pin that merging elsewhere leaves `target` and `marker` alone. |
//! | `Merge` x `commit=Referenced` (all) | Merge never rewrites, so `marker` can never need remapping; the assertion degenerates to "marker must not move". Kept for exactly that. |
//! | `CherryPick` x `commit=Referenced` (all) | Same reason — cherry-pick appends, never rewrites. |
//! | `Rebase` x `branch=Merged` (12 cases) | Once `from` is merged, `merge_base(target, from) == from`, so there is nothing to replay: `from` is fast-forwarded onto `target`'s tip and the rewrite map is empty, which also makes `commit=Referenced` inert (nothing to remap). Kept: "rebasing an already-merged branch must not invent commits" is a real boundary. |
//! | `AddFile`/`RemoveFile` x `head in {Target(Open), Other}` (20 cases) | `sha` is not an ancestor of the current branch tip, so the op is rejected before any dimension other than `work directory` can matter. Kept: the whole point is asserting it is rejected *cleanly* (typed error, repo byte-identical, no orphan backup) and that a dirty tree survives the rejection. |
//!
//! ## 4. What every case asserts
//!
//! Regardless of expectation: the operation returns (never panics); the
//! checked-out branch is unchanged; no paused-conflict state is left on disk;
//! `status()` still works; and a `Dirty` working tree still holds its edit.
//!
//! On a rejection: every non-backup ref is byte-identical to before, and NO
//! backup ref is left behind (a failed op must not pollute the undo stack).
//!
//! On success: the exact set of refs that moved is asserted (so an op that
//! quietly drags an uninvolved branch along fails), the resulting DAG
//! topology/content is asserted per method, a backup ref for that op exists,
//! `RemapOutcome::remapped` names exactly the branches that were carried
//! over, and one `undo_last` restores the complete ref snapshot.
//!
//! ## 5. The three product bugs this matrix caught (all fixed)
//!
//! 48 of the 168 cases were `#[ignore]`d when this file landed: they asserted
//! the CORRECT behaviour against an implementation that did something else.
//! All 168 now run. The expectations below are unchanged from the day they
//! were written — the product moved, not the oracle.
//!
//! * **BUG-1 (26 cases) — a rewriting op run on the checked-out branch
//!   destroyed uncommitted work.** `rebase::execute` (and `inject`/`purge`)
//!   finish with `CheckoutBuilder::force()` + `checkout_head`, which overwrote
//!   unstaged edits; `rebase_branch` autostashed only when it had to switch
//!   branches, so the same gesture was safe with `head=Target|Other` and
//!   destructive with `head=From`. Fixed by factoring that autostash out
//!   (`autostash.rs`) and running it around every same-branch rewrite —
//!   tracked changes only, so `AddFile`'s untracked input survives.
//! * **BUG-2 (20 cases) — `reword` on a commit that is not on the checked-out
//!   branch silently rewrote the checked-out branch instead.**
//!   `history::reword` builds its plan as `pick_steps(sha^, HEAD)`; when `sha`
//!   is not an ancestor of HEAD that range does not contain `sha`, so the
//!   engine replayed HEAD's own commits onto `sha`'s parent, re-parenting the
//!   current branch onto an unrelated branch and reporting success without
//!   having reworded anything. Fixed by requiring `sha` to be an ancestor of
//!   HEAD and refusing otherwise — the precondition `purge`/`inject` already
//!   enforced.
//! * **BUG-3 (4 cases) — a failed rebase-engine op still destroyed
//!   uncommitted work.** `rebase::execute`'s error path calls `abort_to`, a
//!   hard reset. Rewording across a merge commit the op correctly failed, but
//!   wiped the working tree on the way out. Fixed by BUG-1's autostash, which
//!   restores on the error path too; the failure itself is now the typed
//!   `MERGE_COMMIT_IN_RANGE` rather than libgit2's raw "mainline branch is not
//!   specified" text.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use git2::{Oid, Repository};

use git_core::{AdgitterResult, HistoryOpResult, RemapOutcome};

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Method {
    Merge,
    Rebase,
    CherryPick,
    RewordTip,
    RewordOlder,
    AddFile,
    RemoveFile,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Head {
    From,
    Target,
    Other,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Wd {
    Clean,
    Dirty,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CommitRef {
    Referenced,
    Unreferenced,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BranchState {
    Merged,
    Open,
}

const FROM: &str = "refs/heads/from";
const TARGET: &str = "refs/heads/target";
const OTHER: &str = "refs/heads/other";
const MARKER: &str = "refs/heads/marker";

/// The unstaged edit a `Dirty` case makes to `base.txt`. Every case asserts it
/// is still on disk afterwards.
const DIRTY_CONTENT: &str = "dirty edit that must survive\n";
const INJECT_PATH: &str = "inject.txt";
const PURGE_PATH: &str = "feat.txt";
/// The file `f2` adds — i.e. the content a cherry-pick of `f2` must deliver.
const PICKED_PATH: &str = "feat2.txt";
const NEW_MESSAGE: &str = "reworded by the matrix";

// ---------------------------------------------------------------------------
// Expectations
// ---------------------------------------------------------------------------

#[derive(Debug, PartialEq, Eq)]
enum Kind {
    /// Ok, and the repository is byte-identical: no ref moved, no backup left.
    NoOp,
    /// Ok; the checked-out branch gained one merge commit whose parents are
    /// the previous tip and `from`'s tip.
    MergeCommit,
    /// Ok; the checked-out branch gained exactly one ordinary commit on top of
    /// the previous tip, carrying the picked commit's message.
    AppendOne,
    /// Ok; `branch` was rewritten onto a brand-new chain by history op `op`.
    Rewrite {
        branch: &'static str,
        op: &'static str,
    },
    /// Ok; `from` was fast-forwarded straight onto `target`'s tip, with no
    /// commit rewritten (so nothing to remap).
    FastForward,
    /// Err; a typed, recoverable failure that leaves the repository untouched.
    Rejected,
}

struct Expectation {
    kind: Kind,
    /// Full ref names expected to point somewhere new afterwards.
    moved: Vec<&'static str>,
    /// Branches expected in `RemapOutcome::remapped`.
    remapped: Vec<&'static str>,
}

/// The oracle: what SHOULD happen for a combination, derived from the
/// documented semantics of each op — not transcribed from what the code
/// currently does. Where the two once disagreed, the product was fixed, not
/// this table — the three disagreements are recorded in the module docs
/// (BUG-1..3).
fn expectation(m: Method, h: Head, cref: CommitRef, b: BranchState) -> Expectation {
    let head_branch = match h {
        Head::From => FROM,
        Head::Target => TARGET,
        Head::Other => OTHER,
    };
    let marker = |v: &mut Vec<&'static str>| {
        if cref == CommitRef::Referenced {
            v.push(MARKER);
        }
    };
    // A rewrite of `f1`/`f2` also drags `target` along once `from` is merged
    // into it, because `target`'s tip then descends from the rewritten range.
    let merged_target = |v: &mut Vec<&'static str>| {
        if b == BranchState::Merged {
            v.push(TARGET);
        }
    };

    match m {
        // `merge` merges INTO HEAD. With HEAD on `from` that is a self-merge
        // (always up-to-date); with `from` already merged into `target` it is
        // likewise up-to-date. Otherwise a real merge commit lands on HEAD.
        Method::Merge => match (h, b) {
            (Head::From, _) | (Head::Target, BranchState::Merged) => Expectation {
                kind: Kind::NoOp,
                moved: vec![],
                remapped: vec![],
            },
            _ => Expectation {
                kind: Kind::MergeCommit,
                moved: vec![head_branch],
                remapped: vec![],
            },
        },

        // `rebase_branch("from", "target")` moves `from` no matter which
        // branch is checked out. Already-merged means nothing left to replay.
        Method::Rebase => match b {
            BranchState::Merged => Expectation {
                kind: Kind::FastForward,
                moved: vec![FROM],
                remapped: vec![],
            },
            BranchState::Open => {
                let mut moved = vec![FROM];
                let mut remapped = vec![];
                marker(&mut moved);
                marker(&mut remapped);
                Expectation {
                    kind: Kind::Rewrite {
                        branch: FROM,
                        op: "rebase",
                    },
                    moved,
                    remapped,
                }
            }
        },

        // Cherry-pick always appends to HEAD's branch and rewrites nothing.
        Method::CherryPick => Expectation {
            kind: Kind::AppendOne,
            moved: vec![head_branch],
            remapped: vec![],
        },

        // Reword rewrites the branch the commit lives on. `f1`/`f2` live on
        // `from`, so this is only well-defined with `from` checked out;
        // anywhere else the commit is not on the current branch (or, once
        // merged, is only reachable across a merge commit the replay engine
        // cannot cross) and the op must refuse without touching anything.
        Method::RewordTip | Method::RewordOlder => match h {
            Head::From => {
                let mut moved = vec![FROM];
                let mut remapped = vec![];
                marker(&mut moved);
                merged_target(&mut moved);
                marker(&mut remapped);
                merged_target(&mut remapped);
                remapped.sort_unstable();
                Expectation {
                    kind: Kind::Rewrite {
                        branch: FROM,
                        op: "reword",
                    },
                    moved,
                    remapped,
                }
            }
            _ => Expectation {
                kind: Kind::Rejected,
                moved: vec![],
                remapped: vec![],
            },
        },

        // add-file / remove-file rewrite `sha`..tip of the CHECKED-OUT branch,
        // so they need `f1` to be an ancestor of HEAD: true on `from`, true on
        // `target` only once merged, never on `other`.
        Method::AddFile | Method::RemoveFile => {
            let op = if m == Method::AddFile {
                "add-file"
            } else {
                "purge-path"
            };
            match (h, b) {
                (Head::From, _) => {
                    let mut moved = vec![FROM];
                    let mut remapped = vec![];
                    marker(&mut moved);
                    merged_target(&mut moved);
                    marker(&mut remapped);
                    merged_target(&mut remapped);
                    remapped.sort_unstable();
                    Expectation {
                        kind: Kind::Rewrite { branch: FROM, op },
                        moved,
                        remapped,
                    }
                }
                (Head::Target, BranchState::Merged) => {
                    let mut moved = vec![TARGET, FROM];
                    let mut remapped = vec![FROM];
                    marker(&mut moved);
                    marker(&mut remapped);
                    remapped.sort_unstable();
                    Expectation {
                        kind: Kind::Rewrite { branch: TARGET, op },
                        moved,
                        remapped,
                    }
                }
                _ => Expectation {
                    kind: Kind::Rejected,
                    moved: vec![],
                    remapped: vec![],
                },
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

struct Fixture {
    _dir: tempfile::TempDir,
    repo: Repository,
    path: PathBuf,
    f1: String,
    f2: String,
}

fn commit_file(dir: &Path, name: &str, content: &str) -> String {
    std::fs::write(dir.join(name), content).unwrap();
    git_core::stage(dir.to_path_buf(), vec![name.to_string()]).unwrap();
    git_core::commit(dir.to_path_buf(), format!("add {name}"), false).unwrap()
}

/// Drop the backup refs the fixture's own setup merge created, so a case's
/// backup assertions only ever see what the operation under test produced.
fn clear_backups(repo: &Repository) {
    let names: Vec<String> = repo
        .references()
        .unwrap()
        .filter_map(|r| r.ok())
        .filter_map(|r| r.name().map(str::to_string))
        .filter(|n| n.starts_with("refs/adgitter/backup/"))
        .collect();
    for n in names {
        if let Ok(mut r) = repo.find_reference(&n) {
            r.delete().unwrap();
        }
    }
}

fn build(m: Method, h: Head, wd: Wd, cref: CommitRef, b: BranchState) -> Fixture {
    let dir = tempfile::TempDir::new().unwrap();
    let p = dir.path().to_path_buf();
    let repo = Repository::init(&p).unwrap();
    {
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Tester").unwrap();
        cfg.set_str("user.email", "t@example.com").unwrap();
    }
    commit_file(&p, "base.txt", "base\n");

    for name in ["target", "from", "other"] {
        git_core::create_branch(p.clone(), name.into(), "HEAD".into()).unwrap();
    }

    git_core::checkout(p.clone(), "target".into()).unwrap();
    commit_file(&p, "main.txt", "m\n");

    git_core::checkout(p.clone(), "from".into()).unwrap();
    let f1 = commit_file(&p, PURGE_PATH, "v1\n");
    let f2 = commit_file(&p, PICKED_PATH, "v2\n");

    git_core::checkout(p.clone(), "other".into()).unwrap();
    commit_file(&p, "other.txt", "o\n");

    if b == BranchState::Merged {
        git_core::checkout(p.clone(), "target".into()).unwrap();
        git_core::merge(p.clone(), "from".into()).unwrap();
    }

    if cref == CommitRef::Referenced {
        let at = match m {
            Method::Merge | Method::CherryPick | Method::RewordTip => f2.clone(),
            _ => f1.clone(),
        };
        git_core::create_branch(p.clone(), "marker".into(), at).unwrap();
    }

    git_core::checkout(
        p.clone(),
        match h {
            Head::From => "from",
            Head::Target => "target",
            Head::Other => "other",
        }
        .into(),
    )
    .unwrap();

    if m == Method::AddFile {
        std::fs::write(p.join(INJECT_PATH), "injected\n").unwrap();
    }
    if wd == Wd::Dirty {
        std::fs::write(p.join("base.txt"), DIRTY_CONTENT).unwrap();
    }

    clear_backups(&repo);
    Fixture {
        _dir: dir,
        repo,
        path: p,
        f1,
        f2,
    }
}

// ---------------------------------------------------------------------------
// Observation helpers
// ---------------------------------------------------------------------------

/// Every non-backup ref plus the checked-out branch name and its tip.
fn snapshot(repo: &Repository) -> BTreeMap<String, String> {
    let mut m = BTreeMap::new();
    for r in repo.references().unwrap() {
        let r = r.unwrap();
        let name = r.name().unwrap_or_default().to_string();
        if name.starts_with("refs/adgitter/backup/") {
            continue;
        }
        if let Some(oid) = r.target() {
            m.insert(name, oid.to_string());
        }
    }
    let head = repo.head().unwrap();
    m.insert("@symbolic".into(), head.name().unwrap().to_string());
    m.insert(
        "@tip".into(),
        head.peel_to_commit().unwrap().id().to_string(),
    );
    m
}

/// Branch refs that point somewhere new (`@tip`/`@symbolic` excluded — those
/// are asserted separately), sorted.
fn moved_refs(before: &BTreeMap<String, String>, after: &BTreeMap<String, String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for (k, v) in after {
        if k.starts_with('@') {
            continue;
        }
        match before.get(k) {
            Some(old) if old == v => {}
            _ => out.push(k.clone()),
        }
    }
    for k in before.keys() {
        if !k.starts_with('@') && !after.contains_key(k) {
            out.push(format!("deleted:{k}"));
        }
    }
    out.sort();
    out
}

/// Commits reachable from `tip`, as (subject, tree oid).
fn history(repo: &Repository, tip: Oid) -> Vec<(String, Oid)> {
    let mut walk = repo.revwalk().unwrap();
    walk.push(tip).unwrap();
    walk.map(|o| {
        let c = repo.find_commit(o.unwrap()).unwrap();
        (c.summary().unwrap_or("").to_string(), c.tree_id())
    })
    .collect()
}

fn tree_has(repo: &Repository, tree: Oid, path: &str) -> bool {
    repo.find_tree(tree)
        .unwrap()
        .get_path(Path::new(path))
        .is_ok()
}

/// Normalized result of the operation under test.
enum Act {
    Ok(RemapOutcome),
    Conflict,
    Err(String),
}

fn act(m: Method, fx: &Fixture) -> Act {
    fn hor(r: AdgitterResult<HistoryOpResult>) -> Act {
        match r {
            Ok(HistoryOpResult::Completed { outcome }) => Act::Ok(outcome),
            Ok(HistoryOpResult::Conflict { .. }) => Act::Conflict,
            Err(e) => Act::Err(format!("[{}] {e}", e.code())),
        }
    }
    let p = fx.path.clone();
    match m {
        Method::Merge => hor(git_core::merge(p, "from".into())),
        Method::Rebase => hor(git_core::rebase_branch(p, "from".into(), "target".into())),
        Method::CherryPick => match git_core::cherry_pick(p, vec![fx.f2.clone()]) {
            Ok(()) => Act::Ok(RemapOutcome::default()),
            Err(e) => Act::Err(format!("[{}] {e}", e.code())),
        },
        Method::RewordTip => hor(git_core::reword(p, fx.f2.clone(), NEW_MESSAGE.into())),
        Method::RewordOlder => hor(git_core::reword(p, fx.f1.clone(), NEW_MESSAGE.into())),
        Method::AddFile => match git_core::add_file_to_commit(p, fx.f1.clone(), INJECT_PATH.into())
        {
            Ok(o) => Act::Ok(o),
            Err(e) => Act::Err(format!("[{}] {e}", e.code())),
        },
        Method::RemoveFile => match git_core::purge_path(p, fx.f1.clone(), PURGE_PATH.into()) {
            Ok(o) => Act::Ok(o),
            Err(e) => Act::Err(format!("[{}] {e}", e.code())),
        },
    }
}

// ---------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------

fn run(m: Method, h: Head, wd: Wd, cref: CommitRef, b: BranchState) {
    let case = format!("{m:?} / head={h:?} / {wd:?} / {cref:?} / {b:?}");
    let exp = expectation(m, h, cref, b);
    let fx = build(m, h, wd, cref, b);
    let repo = &fx.repo;
    let p = &fx.path;

    let before = snapshot(repo);
    let pre_tip = Oid::from_str(&before["@tip"]).unwrap();
    let f2_summary = repo
        .find_commit(Oid::from_str(&fx.f2).unwrap())
        .unwrap()
        .summary()
        .unwrap()
        .to_string();

    let result = act(m, &fx);
    let after = snapshot(repo);

    // ---- invariants that hold for every single case -----------------------

    assert!(
        !matches!(result, Act::Conflict),
        "{case}: no combination in this fixture has conflicting content, so an \
         op must never pause"
    );
    assert!(
        git_core::conflict_state(p.clone()).unwrap().is_none(),
        "{case}: left a paused-conflict state on disk"
    );
    git_core::status(p.clone())
        .unwrap_or_else(|e| panic!("{case}: repository unreadable afterwards: {e}"));
    assert_eq!(
        before["@symbolic"], after["@symbolic"],
        "{case}: the operation left a different branch checked out"
    );
    if wd == Wd::Dirty {
        assert_eq!(
            std::fs::read_to_string(p.join("base.txt")).unwrap_or_default(),
            DIRTY_CONTENT,
            "{case}: the uncommitted edit to base.txt was destroyed"
        );
    }

    let backups = git_core::list_backups(repo).unwrap();

    // ---- rejection: nothing may have changed at all ------------------------

    if exp.kind == Kind::Rejected {
        let err = match &result {
            Act::Err(e) => e.clone(),
            Act::Ok(o) => panic!("{case}: expected a clean rejection, got Ok({o:?})"),
            Act::Conflict => unreachable!(),
        };
        assert!(
            !err.contains("panic"),
            "{case}: rejection must be a typed error, got {err}"
        );
        assert_eq!(before, after, "{case}: a rejected op moved refs ({err})");
        assert!(
            backups.is_empty(),
            "{case}: a rejected op left an orphan backup on the undo stack: {:?}",
            backups.iter().map(|x| &x.backup_ref).collect::<Vec<_>>()
        );
        // `undo_last` is destructive — it would consume the fixture's own
        // commit record as a side effect, since `workdir::commit` now writes
        // one. Use the non-destructive `undo_state` query instead, and allow
        // only a commit record (fixture scaffolding): any other op leaving
        // something undoable is still the bug this assertion exists to catch.
        let state = git_core::undo_state(p.clone()).unwrap();
        assert!(
            !state.available || state.op.as_deref() == Some("commit"),
            "{case}: a rejected op left something undoable: {state:?}"
        );
        return;
    }

    // ---- success: exact ref movement ---------------------------------------

    let outcome = match &result {
        Act::Ok(o) => o,
        Act::Err(e) => panic!("{case}: expected {:?}, got error {e}", exp.kind),
        Act::Conflict => unreachable!(),
    };

    let mut want_moved: Vec<String> = exp.moved.iter().map(|s| s.to_string()).collect();
    want_moved.sort();
    assert_eq!(
        moved_refs(&before, &after),
        want_moved,
        "{case}: wrong set of refs moved"
    );
    let head_moved = want_moved.contains(&before["@symbolic"]);
    assert_eq!(
        after["@tip"] != before["@tip"],
        head_moved,
        "{case}: HEAD's tip moved iff the checked-out branch moved"
    );

    let mut want_remapped: Vec<String> = exp.remapped.iter().map(|s| s.to_string()).collect();
    want_remapped.sort();
    let mut got_remapped = outcome.remapped.clone();
    got_remapped.sort();
    assert_eq!(
        got_remapped, want_remapped,
        "{case}: RemapOutcome::remapped is wrong"
    );
    assert!(
        outcome.skipped.is_empty(),
        "{case}: no branch should have been skipped, got {:?}",
        outcome.skipped
    );
    if cref == CommitRef::Referenced && !want_moved.iter().any(|r| r == MARKER) {
        assert_eq!(
            before[MARKER], after[MARKER],
            "{case}: an op that does not rewrite must leave `marker` alone"
        );
    }

    // ---- success: per-method topology / content ----------------------------

    let new_tip = Oid::from_str(&after["@tip"]).unwrap();
    match exp.kind {
        Kind::NoOp => {
            assert_eq!(before, after, "{case}: a no-op changed the repository");
            assert!(
                backups.is_empty(),
                "{case}: a no-op left an undo entry behind"
            );
            // Same reasoning as the rejection branch above: the fixture's own
            // commits now carry undo records, so probe with the
            // non-destructive `undo_state` and allow only a commit record.
            let state = git_core::undo_state(p.clone()).unwrap();
            assert!(
                !state.available || state.op.as_deref() == Some("commit"),
                "{case}: a no-op left an undo entry behind: {state:?}"
            );
            return;
        }
        Kind::MergeCommit => {
            let c = repo.find_commit(new_tip).unwrap();
            assert_eq!(
                c.parent_count(),
                2,
                "{case}: merge commit needs two parents"
            );
            assert_eq!(c.parent_id(0).unwrap(), pre_tip, "{case}: first parent");
            assert_eq!(
                c.parent_id(1).unwrap().to_string(),
                fx.f2,
                "{case}: second parent is `from`'s tip"
            );
        }
        Kind::AppendOne => {
            let c = repo.find_commit(new_tip).unwrap();
            assert_eq!(
                c.parent_count(),
                1,
                "{case}: cherry-pick appends one commit"
            );
            assert_eq!(c.parent_id(0).unwrap(), pre_tip, "{case}: on the old tip");
            assert_eq!(
                c.summary().unwrap(),
                f2_summary,
                "{case}: keeps the picked commit's message"
            );
            // The pick must actually deliver its content — both into the new
            // commit and out to the working tree.
            assert!(
                tree_has(repo, c.tree_id(), PICKED_PATH),
                "{case}: `{PICKED_PATH}` is missing from the cherry-picked commit"
            );
            assert!(
                p.join(PICKED_PATH).exists(),
                "{case}: `{PICKED_PATH}` was not checked out into the working tree"
            );
        }
        Kind::FastForward => {
            assert_eq!(
                after[FROM], after[TARGET],
                "{case}: an already-merged branch rebases to exactly the target tip"
            );
            assert_eq!(
                before[TARGET], after[TARGET],
                "{case}: rebasing `from` must not move `target`"
            );
        }
        Kind::Rewrite { branch, .. } => {
            let tip = Oid::from_str(&after[branch]).unwrap();
            let old_tip = Oid::from_str(&before[branch]).unwrap();
            assert_ne!(tip, old_tip, "{case}: {branch} should have been rewritten");
            let hist = history(repo, tip);
            match m {
                Method::Rebase => {
                    let target_tip = Oid::from_str(&after[TARGET]).unwrap();
                    assert!(
                        repo.graph_descendant_of(tip, target_tip).unwrap(),
                        "{case}: `from` must now sit on top of `target`"
                    );
                }
                Method::RewordTip | Method::RewordOlder => {
                    let old = if m == Method::RewordTip {
                        "add feat2.txt"
                    } else {
                        "add feat.txt"
                    };
                    assert!(
                        hist.iter().any(|(s, _)| s == NEW_MESSAGE),
                        "{case}: the new message is not in the rewritten history"
                    );
                    assert!(
                        !hist.iter().any(|(s, _)| s == old),
                        "{case}: the old message `{old}` is still reachable"
                    );
                }
                Method::AddFile => {
                    assert!(
                        tree_has(repo, repo.find_commit(tip).unwrap().tree_id(), INJECT_PATH),
                        "{case}: the injected file is missing from the new tip"
                    );
                    let with = hist
                        .iter()
                        .filter(|(_, t)| tree_has(repo, *t, INJECT_PATH))
                        .count();
                    assert!(
                        with >= 2,
                        "{case}: the file must be injected into `sha` AND its descendants, \
                         only {with} commit(s) carry it"
                    );
                }
                Method::RemoveFile => {
                    assert!(
                        !hist.iter().any(|(_, t)| tree_has(repo, *t, PURGE_PATH)),
                        "{case}: `{PURGE_PATH}` is still present somewhere in history"
                    );
                }
                Method::Merge | Method::CherryPick => unreachable!(),
            }
        }
        Kind::Rejected => unreachable!(),
    }

    // ---- success: backup + undo round-trip ---------------------------------

    let op = match exp.kind {
        Kind::MergeCommit => "merge",
        Kind::AppendOne => "cherry-pick",
        Kind::FastForward => "rebase",
        Kind::Rewrite { op, .. } => op,
        _ => unreachable!(),
    };
    assert!(
        backups.iter().any(|x| x.op == op),
        "{case}: no `{op}` backup ref was written, so the op is not undoable \
         (got {:?})",
        backups.iter().map(|x| &x.op).collect::<Vec<_>>()
    );
    let restored = git_core::undo_last(p.clone())
        .unwrap()
        .unwrap_or_else(|| panic!("{case}: nothing to undo"));
    assert_eq!(restored.op, op, "{case}: undid the wrong operation");
    assert_eq!(
        snapshot(repo),
        before,
        "{case}: one undo must restore the complete pre-op ref state"
    );
}

// -------------------------------------------------------------------------
// The 168 cases. One `#[test]` each so a failure names its combination.
// None is `#[ignore]`d: the 48 that were (BUG-1..3 in the module docs) now
// pass against the fixed implementation, and a new gap must be fixed rather
// than parked here.
// -------------------------------------------------------------------------

// ---- Merge -------------------------------------------------------------

#[test]
fn merge_head_from_clean_referenced_merged() {
    run(
        Method::Merge,
        Head::From,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn merge_head_from_clean_referenced_open() {
    run(
        Method::Merge,
        Head::From,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn merge_head_from_clean_unreferenced_merged() {
    run(
        Method::Merge,
        Head::From,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn merge_head_from_clean_unreferenced_open() {
    run(
        Method::Merge,
        Head::From,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn merge_head_from_dirty_referenced_merged() {
    run(
        Method::Merge,
        Head::From,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn merge_head_from_dirty_referenced_open() {
    run(
        Method::Merge,
        Head::From,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn merge_head_from_dirty_unreferenced_merged() {
    run(
        Method::Merge,
        Head::From,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn merge_head_from_dirty_unreferenced_open() {
    run(
        Method::Merge,
        Head::From,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn merge_head_target_clean_referenced_merged() {
    run(
        Method::Merge,
        Head::Target,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn merge_head_target_clean_referenced_open() {
    run(
        Method::Merge,
        Head::Target,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn merge_head_target_clean_unreferenced_merged() {
    run(
        Method::Merge,
        Head::Target,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn merge_head_target_clean_unreferenced_open() {
    run(
        Method::Merge,
        Head::Target,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn merge_head_target_dirty_referenced_merged() {
    run(
        Method::Merge,
        Head::Target,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn merge_head_target_dirty_referenced_open() {
    run(
        Method::Merge,
        Head::Target,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn merge_head_target_dirty_unreferenced_merged() {
    run(
        Method::Merge,
        Head::Target,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn merge_head_target_dirty_unreferenced_open() {
    run(
        Method::Merge,
        Head::Target,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn merge_head_other_clean_referenced_merged() {
    run(
        Method::Merge,
        Head::Other,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn merge_head_other_clean_referenced_open() {
    run(
        Method::Merge,
        Head::Other,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn merge_head_other_clean_unreferenced_merged() {
    run(
        Method::Merge,
        Head::Other,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn merge_head_other_clean_unreferenced_open() {
    run(
        Method::Merge,
        Head::Other,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn merge_head_other_dirty_referenced_merged() {
    run(
        Method::Merge,
        Head::Other,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn merge_head_other_dirty_referenced_open() {
    run(
        Method::Merge,
        Head::Other,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn merge_head_other_dirty_unreferenced_merged() {
    run(
        Method::Merge,
        Head::Other,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn merge_head_other_dirty_unreferenced_open() {
    run(
        Method::Merge,
        Head::Other,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

// ---- Rebase ------------------------------------------------------------

#[test]
fn rebase_head_from_clean_referenced_merged() {
    run(
        Method::Rebase,
        Head::From,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn rebase_head_from_clean_referenced_open() {
    run(
        Method::Rebase,
        Head::From,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn rebase_head_from_clean_unreferenced_merged() {
    run(
        Method::Rebase,
        Head::From,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn rebase_head_from_clean_unreferenced_open() {
    run(
        Method::Rebase,
        Head::From,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn rebase_head_from_dirty_referenced_merged() {
    run(
        Method::Rebase,
        Head::From,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn rebase_head_from_dirty_referenced_open() {
    run(
        Method::Rebase,
        Head::From,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn rebase_head_from_dirty_unreferenced_merged() {
    run(
        Method::Rebase,
        Head::From,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn rebase_head_from_dirty_unreferenced_open() {
    run(
        Method::Rebase,
        Head::From,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn rebase_head_target_clean_referenced_merged() {
    run(
        Method::Rebase,
        Head::Target,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn rebase_head_target_clean_referenced_open() {
    run(
        Method::Rebase,
        Head::Target,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn rebase_head_target_clean_unreferenced_merged() {
    run(
        Method::Rebase,
        Head::Target,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn rebase_head_target_clean_unreferenced_open() {
    run(
        Method::Rebase,
        Head::Target,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn rebase_head_target_dirty_referenced_merged() {
    run(
        Method::Rebase,
        Head::Target,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn rebase_head_target_dirty_referenced_open() {
    run(
        Method::Rebase,
        Head::Target,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn rebase_head_target_dirty_unreferenced_merged() {
    run(
        Method::Rebase,
        Head::Target,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn rebase_head_target_dirty_unreferenced_open() {
    run(
        Method::Rebase,
        Head::Target,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn rebase_head_other_clean_referenced_merged() {
    run(
        Method::Rebase,
        Head::Other,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn rebase_head_other_clean_referenced_open() {
    run(
        Method::Rebase,
        Head::Other,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn rebase_head_other_clean_unreferenced_merged() {
    run(
        Method::Rebase,
        Head::Other,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn rebase_head_other_clean_unreferenced_open() {
    run(
        Method::Rebase,
        Head::Other,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn rebase_head_other_dirty_referenced_merged() {
    run(
        Method::Rebase,
        Head::Other,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn rebase_head_other_dirty_referenced_open() {
    run(
        Method::Rebase,
        Head::Other,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn rebase_head_other_dirty_unreferenced_merged() {
    run(
        Method::Rebase,
        Head::Other,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn rebase_head_other_dirty_unreferenced_open() {
    run(
        Method::Rebase,
        Head::Other,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

// ---- CherryPick --------------------------------------------------------

#[test]
fn cherry_pick_head_from_clean_referenced_merged() {
    run(
        Method::CherryPick,
        Head::From,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn cherry_pick_head_from_clean_referenced_open() {
    run(
        Method::CherryPick,
        Head::From,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn cherry_pick_head_from_clean_unreferenced_merged() {
    run(
        Method::CherryPick,
        Head::From,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn cherry_pick_head_from_clean_unreferenced_open() {
    run(
        Method::CherryPick,
        Head::From,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn cherry_pick_head_from_dirty_referenced_merged() {
    run(
        Method::CherryPick,
        Head::From,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn cherry_pick_head_from_dirty_referenced_open() {
    run(
        Method::CherryPick,
        Head::From,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn cherry_pick_head_from_dirty_unreferenced_merged() {
    run(
        Method::CherryPick,
        Head::From,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn cherry_pick_head_from_dirty_unreferenced_open() {
    run(
        Method::CherryPick,
        Head::From,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn cherry_pick_head_target_clean_referenced_merged() {
    run(
        Method::CherryPick,
        Head::Target,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn cherry_pick_head_target_clean_referenced_open() {
    run(
        Method::CherryPick,
        Head::Target,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn cherry_pick_head_target_clean_unreferenced_merged() {
    run(
        Method::CherryPick,
        Head::Target,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn cherry_pick_head_target_clean_unreferenced_open() {
    run(
        Method::CherryPick,
        Head::Target,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn cherry_pick_head_target_dirty_referenced_merged() {
    run(
        Method::CherryPick,
        Head::Target,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn cherry_pick_head_target_dirty_referenced_open() {
    run(
        Method::CherryPick,
        Head::Target,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn cherry_pick_head_target_dirty_unreferenced_merged() {
    run(
        Method::CherryPick,
        Head::Target,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn cherry_pick_head_target_dirty_unreferenced_open() {
    run(
        Method::CherryPick,
        Head::Target,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn cherry_pick_head_other_clean_referenced_merged() {
    run(
        Method::CherryPick,
        Head::Other,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn cherry_pick_head_other_clean_referenced_open() {
    run(
        Method::CherryPick,
        Head::Other,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn cherry_pick_head_other_clean_unreferenced_merged() {
    run(
        Method::CherryPick,
        Head::Other,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn cherry_pick_head_other_clean_unreferenced_open() {
    run(
        Method::CherryPick,
        Head::Other,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn cherry_pick_head_other_dirty_referenced_merged() {
    run(
        Method::CherryPick,
        Head::Other,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn cherry_pick_head_other_dirty_referenced_open() {
    run(
        Method::CherryPick,
        Head::Other,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn cherry_pick_head_other_dirty_unreferenced_merged() {
    run(
        Method::CherryPick,
        Head::Other,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn cherry_pick_head_other_dirty_unreferenced_open() {
    run(
        Method::CherryPick,
        Head::Other,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

// ---- RewordTip ---------------------------------------------------------

#[test]
fn reword_tip_head_from_clean_referenced_merged() {
    run(
        Method::RewordTip,
        Head::From,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn reword_tip_head_from_clean_referenced_open() {
    run(
        Method::RewordTip,
        Head::From,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn reword_tip_head_from_clean_unreferenced_merged() {
    run(
        Method::RewordTip,
        Head::From,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn reword_tip_head_from_clean_unreferenced_open() {
    run(
        Method::RewordTip,
        Head::From,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn reword_tip_head_from_dirty_referenced_merged() {
    run(
        Method::RewordTip,
        Head::From,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn reword_tip_head_from_dirty_referenced_open() {
    run(
        Method::RewordTip,
        Head::From,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn reword_tip_head_from_dirty_unreferenced_merged() {
    run(
        Method::RewordTip,
        Head::From,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn reword_tip_head_from_dirty_unreferenced_open() {
    run(
        Method::RewordTip,
        Head::From,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn reword_tip_head_target_clean_referenced_merged() {
    run(
        Method::RewordTip,
        Head::Target,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn reword_tip_head_target_clean_referenced_open() {
    run(
        Method::RewordTip,
        Head::Target,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn reword_tip_head_target_clean_unreferenced_merged() {
    run(
        Method::RewordTip,
        Head::Target,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn reword_tip_head_target_clean_unreferenced_open() {
    run(
        Method::RewordTip,
        Head::Target,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn reword_tip_head_target_dirty_referenced_merged() {
    run(
        Method::RewordTip,
        Head::Target,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn reword_tip_head_target_dirty_referenced_open() {
    run(
        Method::RewordTip,
        Head::Target,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn reword_tip_head_target_dirty_unreferenced_merged() {
    run(
        Method::RewordTip,
        Head::Target,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn reword_tip_head_target_dirty_unreferenced_open() {
    run(
        Method::RewordTip,
        Head::Target,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn reword_tip_head_other_clean_referenced_merged() {
    run(
        Method::RewordTip,
        Head::Other,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn reword_tip_head_other_clean_referenced_open() {
    run(
        Method::RewordTip,
        Head::Other,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn reword_tip_head_other_clean_unreferenced_merged() {
    run(
        Method::RewordTip,
        Head::Other,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn reword_tip_head_other_clean_unreferenced_open() {
    run(
        Method::RewordTip,
        Head::Other,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn reword_tip_head_other_dirty_referenced_merged() {
    run(
        Method::RewordTip,
        Head::Other,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn reword_tip_head_other_dirty_referenced_open() {
    run(
        Method::RewordTip,
        Head::Other,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn reword_tip_head_other_dirty_unreferenced_merged() {
    run(
        Method::RewordTip,
        Head::Other,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn reword_tip_head_other_dirty_unreferenced_open() {
    run(
        Method::RewordTip,
        Head::Other,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

// ---- RewordOlder -------------------------------------------------------

#[test]
fn reword_older_head_from_clean_referenced_merged() {
    run(
        Method::RewordOlder,
        Head::From,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn reword_older_head_from_clean_referenced_open() {
    run(
        Method::RewordOlder,
        Head::From,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn reword_older_head_from_clean_unreferenced_merged() {
    run(
        Method::RewordOlder,
        Head::From,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn reword_older_head_from_clean_unreferenced_open() {
    run(
        Method::RewordOlder,
        Head::From,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn reword_older_head_from_dirty_referenced_merged() {
    run(
        Method::RewordOlder,
        Head::From,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn reword_older_head_from_dirty_referenced_open() {
    run(
        Method::RewordOlder,
        Head::From,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn reword_older_head_from_dirty_unreferenced_merged() {
    run(
        Method::RewordOlder,
        Head::From,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn reword_older_head_from_dirty_unreferenced_open() {
    run(
        Method::RewordOlder,
        Head::From,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn reword_older_head_target_clean_referenced_merged() {
    run(
        Method::RewordOlder,
        Head::Target,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn reword_older_head_target_clean_referenced_open() {
    run(
        Method::RewordOlder,
        Head::Target,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn reword_older_head_target_clean_unreferenced_merged() {
    run(
        Method::RewordOlder,
        Head::Target,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn reword_older_head_target_clean_unreferenced_open() {
    run(
        Method::RewordOlder,
        Head::Target,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn reword_older_head_target_dirty_referenced_merged() {
    run(
        Method::RewordOlder,
        Head::Target,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn reword_older_head_target_dirty_referenced_open() {
    run(
        Method::RewordOlder,
        Head::Target,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn reword_older_head_target_dirty_unreferenced_merged() {
    run(
        Method::RewordOlder,
        Head::Target,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn reword_older_head_target_dirty_unreferenced_open() {
    run(
        Method::RewordOlder,
        Head::Target,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn reword_older_head_other_clean_referenced_merged() {
    run(
        Method::RewordOlder,
        Head::Other,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn reword_older_head_other_clean_referenced_open() {
    run(
        Method::RewordOlder,
        Head::Other,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn reword_older_head_other_clean_unreferenced_merged() {
    run(
        Method::RewordOlder,
        Head::Other,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn reword_older_head_other_clean_unreferenced_open() {
    run(
        Method::RewordOlder,
        Head::Other,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn reword_older_head_other_dirty_referenced_merged() {
    run(
        Method::RewordOlder,
        Head::Other,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn reword_older_head_other_dirty_referenced_open() {
    run(
        Method::RewordOlder,
        Head::Other,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn reword_older_head_other_dirty_unreferenced_merged() {
    run(
        Method::RewordOlder,
        Head::Other,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn reword_older_head_other_dirty_unreferenced_open() {
    run(
        Method::RewordOlder,
        Head::Other,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

// ---- AddFile -----------------------------------------------------------

#[test]
fn add_file_head_from_clean_referenced_merged() {
    run(
        Method::AddFile,
        Head::From,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn add_file_head_from_clean_referenced_open() {
    run(
        Method::AddFile,
        Head::From,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn add_file_head_from_clean_unreferenced_merged() {
    run(
        Method::AddFile,
        Head::From,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn add_file_head_from_clean_unreferenced_open() {
    run(
        Method::AddFile,
        Head::From,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn add_file_head_from_dirty_referenced_merged() {
    run(
        Method::AddFile,
        Head::From,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn add_file_head_from_dirty_referenced_open() {
    run(
        Method::AddFile,
        Head::From,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn add_file_head_from_dirty_unreferenced_merged() {
    run(
        Method::AddFile,
        Head::From,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn add_file_head_from_dirty_unreferenced_open() {
    run(
        Method::AddFile,
        Head::From,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn add_file_head_target_clean_referenced_merged() {
    run(
        Method::AddFile,
        Head::Target,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn add_file_head_target_clean_referenced_open() {
    run(
        Method::AddFile,
        Head::Target,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn add_file_head_target_clean_unreferenced_merged() {
    run(
        Method::AddFile,
        Head::Target,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn add_file_head_target_clean_unreferenced_open() {
    run(
        Method::AddFile,
        Head::Target,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn add_file_head_target_dirty_referenced_merged() {
    run(
        Method::AddFile,
        Head::Target,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn add_file_head_target_dirty_referenced_open() {
    run(
        Method::AddFile,
        Head::Target,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn add_file_head_target_dirty_unreferenced_merged() {
    run(
        Method::AddFile,
        Head::Target,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn add_file_head_target_dirty_unreferenced_open() {
    run(
        Method::AddFile,
        Head::Target,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn add_file_head_other_clean_referenced_merged() {
    run(
        Method::AddFile,
        Head::Other,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn add_file_head_other_clean_referenced_open() {
    run(
        Method::AddFile,
        Head::Other,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn add_file_head_other_clean_unreferenced_merged() {
    run(
        Method::AddFile,
        Head::Other,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn add_file_head_other_clean_unreferenced_open() {
    run(
        Method::AddFile,
        Head::Other,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn add_file_head_other_dirty_referenced_merged() {
    run(
        Method::AddFile,
        Head::Other,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn add_file_head_other_dirty_referenced_open() {
    run(
        Method::AddFile,
        Head::Other,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn add_file_head_other_dirty_unreferenced_merged() {
    run(
        Method::AddFile,
        Head::Other,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn add_file_head_other_dirty_unreferenced_open() {
    run(
        Method::AddFile,
        Head::Other,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

// ---- RemoveFile --------------------------------------------------------

#[test]
fn remove_file_head_from_clean_referenced_merged() {
    run(
        Method::RemoveFile,
        Head::From,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn remove_file_head_from_clean_referenced_open() {
    run(
        Method::RemoveFile,
        Head::From,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn remove_file_head_from_clean_unreferenced_merged() {
    run(
        Method::RemoveFile,
        Head::From,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn remove_file_head_from_clean_unreferenced_open() {
    run(
        Method::RemoveFile,
        Head::From,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn remove_file_head_from_dirty_referenced_merged() {
    run(
        Method::RemoveFile,
        Head::From,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn remove_file_head_from_dirty_referenced_open() {
    run(
        Method::RemoveFile,
        Head::From,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn remove_file_head_from_dirty_unreferenced_merged() {
    run(
        Method::RemoveFile,
        Head::From,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn remove_file_head_from_dirty_unreferenced_open() {
    run(
        Method::RemoveFile,
        Head::From,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn remove_file_head_target_clean_referenced_merged() {
    run(
        Method::RemoveFile,
        Head::Target,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn remove_file_head_target_clean_referenced_open() {
    run(
        Method::RemoveFile,
        Head::Target,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn remove_file_head_target_clean_unreferenced_merged() {
    run(
        Method::RemoveFile,
        Head::Target,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn remove_file_head_target_clean_unreferenced_open() {
    run(
        Method::RemoveFile,
        Head::Target,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn remove_file_head_target_dirty_referenced_merged() {
    run(
        Method::RemoveFile,
        Head::Target,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn remove_file_head_target_dirty_referenced_open() {
    run(
        Method::RemoveFile,
        Head::Target,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn remove_file_head_target_dirty_unreferenced_merged() {
    run(
        Method::RemoveFile,
        Head::Target,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn remove_file_head_target_dirty_unreferenced_open() {
    run(
        Method::RemoveFile,
        Head::Target,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn remove_file_head_other_clean_referenced_merged() {
    run(
        Method::RemoveFile,
        Head::Other,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn remove_file_head_other_clean_referenced_open() {
    run(
        Method::RemoveFile,
        Head::Other,
        Wd::Clean,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn remove_file_head_other_clean_unreferenced_merged() {
    run(
        Method::RemoveFile,
        Head::Other,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn remove_file_head_other_clean_unreferenced_open() {
    run(
        Method::RemoveFile,
        Head::Other,
        Wd::Clean,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}

#[test]
fn remove_file_head_other_dirty_referenced_merged() {
    run(
        Method::RemoveFile,
        Head::Other,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Merged,
    );
}

#[test]
fn remove_file_head_other_dirty_referenced_open() {
    run(
        Method::RemoveFile,
        Head::Other,
        Wd::Dirty,
        CommitRef::Referenced,
        BranchState::Open,
    );
}

#[test]
fn remove_file_head_other_dirty_unreferenced_merged() {
    run(
        Method::RemoveFile,
        Head::Other,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Merged,
    );
}

#[test]
fn remove_file_head_other_dirty_unreferenced_open() {
    run(
        Method::RemoveFile,
        Head::Other,
        Wd::Dirty,
        CommitRef::Unreferenced,
        BranchState::Open,
    );
}
