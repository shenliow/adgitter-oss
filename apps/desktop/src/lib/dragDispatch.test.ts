import { describe, it, expect } from "vitest";
import {
  resolveDrag,
  affordanceFor,
  chooseTargetBranch,
  resolveMergeDrop,
  modsOf,
  mergeMods,
  NO_MODS,
  type DragSource,
  type DropTarget,
  type Modifiers,
} from "./dragDispatch";

const mods = (over: Partial<Modifiers> = {}): Modifiers => ({
  ...NO_MODS,
  ...over,
});

const otherBranch: DragSource = {
  kind: "branch",
  name: "feature",
  current: false,
};
const currentBranchTarget: DropTarget = {
  kind: "branch",
  name: "main",
  current: true,
};
const otherBranchTarget: DropTarget = {
  kind: "branch",
  name: "feature",
  current: false,
};
const commitTarget: DropTarget = { kind: "commit", sha: "c1", short: "c1abc" };

describe("resolveDrag — branch label (merge / rebase)", () => {
  it("plain drag of a branch onto the current branch = merge into current", () => {
    expect(resolveDrag(otherBranch, currentBranchTarget, NO_MODS)).toEqual({
      op: "merge",
      source: "feature",
    });
  });

  it("Shift drag of a branch onto the current branch = rebase current onto it", () => {
    expect(
      resolveDrag(otherBranch, currentBranchTarget, mods({ shift: true })),
    ).toEqual({ op: "rebase", onto: "feature" });
  });

  it("refuses dragging onto a non-current branch", () => {
    expect(resolveDrag(otherBranch, otherBranchTarget, NO_MODS)).toBeNull();
  });

  it("refuses dragging the current branch itself", () => {
    const cur: DragSource = { kind: "branch", name: "main", current: true };
    expect(resolveDrag(cur, currentBranchTarget, NO_MODS)).toBeNull();
  });

  it("refuses a self drop (same branch name)", () => {
    const self: DropTarget = { kind: "branch", name: "feature", current: true };
    expect(resolveDrag(otherBranch, self, NO_MODS)).toBeNull();
  });

  it("refuses dropping a branch on a commit node", () => {
    expect(resolveDrag(otherBranch, commitTarget, NO_MODS)).toBeNull();
  });
});

// "Drag HEAD" = drag the checked-out branch's own chip. WHAT is being
// checked out is never in question (only one branch is ever being dragged);
// only WHERE it lands can be ambiguous, exactly like a branch-mode commits
// drag landing on a multi-branch commit (see the `chooseTargetBranch` tests
// below and the "branch mode" describe block above).
describe("resolveDrag — dragging the checked-out branch's own chip (checkout)", () => {
  const cur: DragSource = { kind: "branch", name: "main", current: true };

  it("dropped on a branch label: checks out that branch directly, unambiguous, no candidates", () => {
    expect(resolveDrag(cur, otherBranchTarget, NO_MODS)).toEqual({
      op: "checkout",
      branch: "feature",
    });
  });

  it("dropped on its own chip (self drop): no-op", () => {
    expect(resolveDrag(cur, currentBranchTarget, NO_MODS)).toBeNull();
  });

  it("dropped on a commit with exactly one local branch: checks it out directly, no candidates", () => {
    const target: DropTarget = {
      kind: "commit",
      sha: "t1",
      short: "t1abc",
      branches: ["feature"],
    };
    expect(resolveDrag(cur, target, NO_MODS)).toEqual({
      op: "checkout",
      branch: "feature",
    });
  });

  it("dropped on a commit with SEVERAL local branches: carries every candidate for the confirm gate to ask", () => {
    const target: DropTarget = {
      kind: "commit",
      sha: "t1",
      short: "t1abc",
      branches: ["feature", "wip"],
    };
    expect(resolveDrag(cur, target, NO_MODS)).toEqual({
      op: "checkout",
      branch: "feature",
      candidates: ["feature", "wip"],
    });
  });

  it("dropped on a commit with no local branch: nothing to check out to, so no gesture", () => {
    expect(resolveDrag(cur, commitTarget, NO_MODS)).toBeNull();
  });

  it("dropped on the commit HEAD's own branch already sits on (self, via the commit): no-op", () => {
    const target: DropTarget = {
      kind: "commit",
      sha: "t1",
      short: "t1abc",
      branches: ["main"],
    };
    expect(resolveDrag(cur, target, NO_MODS)).toBeNull();
  });

  it("modifiers don't change a checkout drag (unlike merge/rebase's plain-vs-Shift split)", () => {
    expect(resolveDrag(cur, otherBranchTarget, mods({ shift: true }))).toEqual({
      op: "checkout",
      branch: "feature",
    });
  });
});

describe("resolveDrag — commit selection (cherry-pick)", () => {
  const sel: DragSource = { kind: "commits", shas: ["a", "b"] };

  it("Alt drag onto the current branch = cherry-pick those commits", () => {
    expect(resolveDrag(sel, currentBranchTarget, mods({ alt: true }))).toEqual({
      op: "cherryPick",
      commits: ["a", "b"],
    });
  });

  it("requires the Alt modifier", () => {
    expect(resolveDrag(sel, currentBranchTarget, NO_MODS)).toBeNull();
  });

  it("requires a current-branch target", () => {
    expect(resolveDrag(sel, otherBranchTarget, mods({ alt: true }))).toBeNull();
  });

  it("refuses an empty selection", () => {
    const empty: DragSource = { kind: "commits", shas: [] };
    expect(
      resolveDrag(empty, currentBranchTarget, mods({ alt: true })),
    ).toBeNull();
  });
});

describe("resolveDrag — commits onto a commit (rebase / cherry-pick-new-branch)", () => {
  const branchSel: DragSource = {
    kind: "commits",
    shas: ["c2", "c1"],
    branch: "feature",
  };
  const individualSel: DragSource = { kind: "commits", shas: ["c2", "c1"] };
  const target: DropTarget = { kind: "commit", sha: "t1", short: "t1abc" };

  it("branch mode: a PLAIN drag rebases the branch onto the target commit (no Shift needed)", () => {
    expect(resolveDrag(branchSel, target, NO_MODS)).toEqual({
      op: "rebaseBranch",
      branch: "feature",
      onto: "t1",
      short: "t1abc",
    });
  });

  it("branch mode: Shift behaves identically to a plain drag", () => {
    expect(resolveDrag(branchSel, target, mods({ shift: true }))).toEqual({
      op: "rebaseBranch",
      branch: "feature",
      onto: "t1",
      short: "t1abc",
    });
  });

  it("branch mode: Alt opts out of the rebase (falls through to the cherry-pick rule, null on a commit target)", () => {
    expect(resolveDrag(branchSel, target, mods({ alt: true }))).toBeNull();
  });

  it("individual mode (no branch on the source): Shift cherry-picks onto a new branch, oldest-first", () => {
    expect(resolveDrag(individualSel, target, mods({ shift: true }))).toEqual({
      op: "cherryPickNewBranch",
      shas: ["c2", "c1"],
      target: "t1",
      short: "t1abc",
    });
  });

  it("individual mode: a PLAIN commit-onto-commit drag stays illegal (still requires Shift)", () => {
    expect(resolveDrag(individualSel, target, NO_MODS)).toBeNull();
  });

  it("refuses when the target sits inside the dragged selection (also covers the branch's own tip)", () => {
    const self: DropTarget = { kind: "commit", sha: "c1", short: "c1abc" };
    expect(resolveDrag(branchSel, self, NO_MODS)).toBeNull();
    expect(resolveDrag(branchSel, self, mods({ shift: true }))).toBeNull();
    expect(resolveDrag(individualSel, self, mods({ shift: true }))).toBeNull();
  });

  it("refuses an empty selection regardless of modifiers", () => {
    const empty: DragSource = { kind: "commits", shas: [] };
    expect(resolveDrag(empty, target, NO_MODS)).toBeNull();
    expect(resolveDrag(empty, target, mods({ shift: true }))).toBeNull();
  });

  it("branch mode: a target commit with ONE local branch takes it silently — no candidates, no prompt (plain and Shift alike)", () => {
    const targetWithBranches: DropTarget = {
      kind: "commit",
      sha: "t1",
      short: "t1abc",
      branches: ["main"],
    };
    const expected = {
      op: "rebaseBranch",
      branch: "feature",
      onto: "main",
      short: "main",
    };
    expect(resolveDrag(branchSel, targetWithBranches, NO_MODS)).toEqual(
      expected,
    );
    expect(
      resolveDrag(branchSel, targetWithBranches, mods({ shift: true })),
    ).toEqual(expected);
  });

  it("branch mode: a target commit with SEVERAL local branches still defaults to the first but carries the candidates for the confirm gate", () => {
    const targetWithBranches: DropTarget = {
      kind: "commit",
      sha: "t1",
      short: "t1abc",
      branches: ["main", "dev"],
    };
    const expected = {
      op: "rebaseBranch",
      branch: "feature",
      onto: "main",
      short: "main",
      candidates: ["main", "dev"],
    };
    expect(resolveDrag(branchSel, targetWithBranches, NO_MODS)).toEqual(
      expected,
    );
    expect(
      resolveDrag(branchSel, targetWithBranches, mods({ shift: true })),
    ).toEqual(expected);
  });

  it("branch mode: a target commit with no branches still falls back to the sha (unchanged)", () => {
    expect(resolveDrag(branchSel, target, mods({ shift: true }))).toEqual({
      op: "rebaseBranch",
      branch: "feature",
      onto: "t1",
      short: "t1abc",
    });
  });

  it("individual mode: a target commit with branches still cherry-picks onto the sha, not the branch", () => {
    const targetWithBranches: DropTarget = {
      kind: "commit",
      sha: "t1",
      short: "t1abc",
      branches: ["main"],
    };
    expect(
      resolveDrag(individualSel, targetWithBranches, mods({ shift: true })),
    ).toEqual({
      op: "cherryPickNewBranch",
      shas: ["c2", "c1"],
      target: "t1",
      short: "t1abc",
    });
  });

  it("a branch-mode source Alt-dropped on the current branch chip still cherry-picks (Alt opts out of the rebase)", () => {
    expect(
      resolveDrag(branchSel, currentBranchTarget, mods({ alt: true })),
    ).toEqual({ op: "cherryPick", commits: ["c2", "c1"] });
    expect(
      resolveDrag(
        branchSel,
        currentBranchTarget,
        mods({ alt: true, shift: true }),
      ),
    ).toEqual({ op: "cherryPick", commits: ["c2", "c1"] });
  });
});

describe("resolveDrag — branch mode directly onto a branch chip (forced rebase target)", () => {
  const branchSel: DragSource = {
    kind: "commits",
    shas: ["c2", "c1"],
    branch: "feature",
  };
  const individualSel: DragSource = { kind: "commits", shas: ["c2", "c1"] };

  it("a PLAIN drop onto another branch's chip forces that branch as the rebase target (no Shift needed)", () => {
    // branchSel's `branch` is "feature"; drop it on "main"'s chip.
    expect(resolveDrag(branchSel, currentBranchTarget, NO_MODS)).toEqual({
      op: "rebaseBranch",
      branch: "feature",
      onto: "main",
      short: "main",
    });
  });

  it("Shift-drop behaves identically to the plain drop", () => {
    expect(
      resolveDrag(branchSel, currentBranchTarget, mods({ shift: true })),
    ).toEqual({
      op: "rebaseBranch",
      branch: "feature",
      onto: "main",
      short: "main",
    });
  });

  it("refuses a self drop (dropping the branch being dragged onto its own chip)", () => {
    const self: DropTarget = {
      kind: "branch",
      name: "feature",
      current: false,
    };
    expect(resolveDrag(branchSel, self, NO_MODS)).toBeNull();
    expect(resolveDrag(branchSel, self, mods({ shift: true }))).toBeNull();
  });

  it("individual mode: a drop onto a branch chip has no meaning (null), plain or Shift", () => {
    expect(resolveDrag(individualSel, otherBranchTarget, NO_MODS)).toBeNull();
    expect(
      resolveDrag(individualSel, otherBranchTarget, mods({ shift: true })),
    ).toBeNull();
  });
});

describe("chooseTargetBranch — multi-target disambiguation", () => {
  it("no local branch at the target: nothing to choose (the caller keeps its commit-as-target behaviour)", () => {
    expect(chooseTargetBranch([])).toEqual({ branch: null, candidates: [] });
    expect(chooseTargetBranch(undefined)).toEqual({
      branch: null,
      candidates: [],
    });
    expect(chooseTargetBranch(null)).toEqual({ branch: null, candidates: [] });
  });

  it("exactly one local branch: unambiguous, so no candidate list is surfaced", () => {
    expect(chooseTargetBranch(["main"])).toEqual({
      branch: "main",
      candidates: [],
    });
  });

  it("two or more: defaults to the first in display order but surfaces every candidate", () => {
    expect(chooseTargetBranch(["main", "dev"])).toEqual({
      branch: "main",
      candidates: ["main", "dev"],
    });
    expect(chooseTargetBranch(["a", "b", "c"])).toEqual({
      branch: "a",
      candidates: ["a", "b", "c"],
    });
  });

  it("copies the candidate list (callers must not be able to mutate the graph's array)", () => {
    const input = ["main", "dev"];
    const out = chooseTargetBranch(input);
    out.candidates.push("sneaky");
    expect(input).toEqual(["main", "dev"]);
  });
});

describe("resolveDrag — ops that are never branch-ambiguous", () => {
  const many: DropTarget = {
    kind: "commit",
    sha: "t1",
    short: "t1abc",
    branches: ["main", "dev"],
  };

  it("cherry-pick onto a new branch targets the COMMIT, so several branches there change nothing", () => {
    const individualSel: DragSource = { kind: "commits", shas: ["c2", "c1"] };
    expect(resolveDrag(individualSel, many, mods({ shift: true }))).toEqual({
      op: "cherryPickNewBranch",
      shas: ["c2", "c1"],
      target: "t1",
      short: "t1abc",
    });
  });

  it("merge/rebase from a branch label name both ends explicitly", () => {
    expect(resolveDrag(otherBranch, currentBranchTarget, NO_MODS)).toEqual({
      op: "merge",
      source: "feature",
    });
    expect(
      resolveDrag(otherBranch, currentBranchTarget, mods({ shift: true })),
    ).toEqual({ op: "rebase", onto: "feature" });
  });
});

describe("resolveDrag — HEAD crown (reset)", () => {
  const head: DragSource = { kind: "head", sha: "tip" };

  it("plain drag onto a commit = mixed reset", () => {
    expect(resolveDrag(head, commitTarget, NO_MODS)).toEqual({
      op: "reset",
      target: "c1",
      short: "c1abc",
      mode: "mixed",
    });
  });

  it("Shift drag onto a commit = hard reset", () => {
    expect(resolveDrag(head, commitTarget, mods({ shift: true }))).toEqual({
      op: "reset",
      target: "c1",
      short: "c1abc",
      mode: "hard",
    });
  });

  it("Cmd (meta) drag onto a commit = soft reset", () => {
    expect(resolveDrag(head, commitTarget, mods({ meta: true }))).toEqual({
      op: "reset",
      target: "c1",
      short: "c1abc",
      mode: "soft",
    });
  });

  it("Ctrl drag onto a commit = soft reset", () => {
    expect(resolveDrag(head, commitTarget, mods({ ctrl: true }))).toEqual({
      op: "reset",
      target: "c1",
      short: "c1abc",
      mode: "soft",
    });
  });

  it("Shift + Cmd drag onto a commit = hard reset (Shift takes precedence)", () => {
    expect(
      resolveDrag(head, commitTarget, mods({ shift: true, meta: true })),
    ).toEqual({
      op: "reset",
      target: "c1",
      short: "c1abc",
      mode: "hard",
    });
  });

  it("refuses resetting to the commit HEAD already points at", () => {
    const same: DropTarget = { kind: "commit", sha: "tip", short: "tipabc" };
    expect(resolveDrag(head, same, NO_MODS)).toBeNull();
  });

  it("dropped on a branch label: resolves to a reset targeting that branch — unambiguous by construction (exactly one branch named), never a prompt", () => {
    expect(resolveDrag(head, otherBranchTarget, NO_MODS)).toEqual({
      op: "reset",
      target: "feature",
      short: "feature",
      mode: "mixed",
    });
  });

  it("dropped on a branch label with Shift/Cmd: the modifier still selects hard/soft on the branch-label path", () => {
    expect(resolveDrag(head, otherBranchTarget, mods({ shift: true }))).toEqual(
      {
        op: "reset",
        target: "feature",
        short: "feature",
        mode: "hard",
      },
    );
    expect(resolveDrag(head, otherBranchTarget, mods({ meta: true }))).toEqual({
      op: "reset",
      target: "feature",
      short: "feature",
      mode: "soft",
    });
  });

  it("dropped on the current branch's own label: a no-op — HEAD is already there", () => {
    expect(resolveDrag(head, currentBranchTarget, NO_MODS)).toBeNull();
  });

  it("dropped on a commit with exactly one local branch: defaults the target to that branch — no candidates, no prompt", () => {
    const oneBranch: DropTarget = {
      kind: "commit",
      sha: "t1",
      short: "t1abc",
      branches: ["main"],
    };
    expect(resolveDrag(head, oneBranch, NO_MODS)).toEqual({
      op: "reset",
      target: "main",
      short: "main",
      mode: "mixed",
    });
  });

  it("dropped on a commit with no local branch: falls back to the bare sha, unchanged", () => {
    expect(resolveDrag(head, commitTarget, NO_MODS)).toEqual({
      op: "reset",
      target: "c1",
      short: "c1abc",
      mode: "mixed",
    });
  });

  it("dropped on a commit with SEVERAL local branches: candidates ride along, listing every branch AND the commit itself, for the confirm gate to ask", () => {
    const several: DropTarget = {
      kind: "commit",
      sha: "t1",
      short: "t1abc",
      branches: ["main", "dev"],
    };
    expect(resolveDrag(head, several, NO_MODS)).toEqual({
      op: "reset",
      target: "t1",
      short: "t1abc",
      mode: "mixed",
      candidates: ["main", "dev", "t1abc"],
      commitSha: "t1",
    });
  });

  it("dropped on a several-branch commit with Shift/Cmd: the modifier still selects hard/soft on the ambiguous path", () => {
    const several: DropTarget = {
      kind: "commit",
      sha: "t1",
      short: "t1abc",
      branches: ["main", "dev"],
    };
    expect(resolveDrag(head, several, mods({ shift: true }))).toEqual({
      op: "reset",
      target: "t1",
      short: "t1abc",
      mode: "hard",
      candidates: ["main", "dev", "t1abc"],
      commitSha: "t1",
    });
    expect(resolveDrag(head, several, mods({ meta: true }))).toEqual({
      op: "reset",
      target: "t1",
      short: "t1abc",
      mode: "soft",
      candidates: ["main", "dev", "t1abc"],
      commitSha: "t1",
    });
  });
});

describe("resolveDrag — changed files (commit)", () => {
  const files: DragSource = { kind: "files" };

  it("drag onto the current branch = commit", () => {
    expect(resolveDrag(files, currentBranchTarget, NO_MODS)).toEqual({
      op: "commit",
    });
  });

  it("requires a current-branch target", () => {
    expect(resolveDrag(files, otherBranchTarget, NO_MODS)).toBeNull();
    expect(resolveDrag(files, commitTarget, NO_MODS)).toBeNull();
  });
});

describe("resolveDrag — no target", () => {
  it("returns null when dropped on empty space", () => {
    expect(resolveDrag(otherBranch, null, NO_MODS)).toBeNull();
  });
});

describe("affordanceFor", () => {
  it("merge/rebase show a dashed circle", () => {
    expect(affordanceFor({ op: "merge", source: "x" })).toBe("dashed");
    expect(affordanceFor({ op: "rebase", onto: "x" })).toBe("dashed");
  });
  it("cherry-pick/commit show a (+)", () => {
    expect(affordanceFor({ op: "cherryPick", commits: ["a"] })).toBe("plus");
    expect(affordanceFor({ op: "commit" })).toBe("plus");
  });
  it("rebaseBranch shows a dashed circle; cherryPickNewBranch shows a (+)", () => {
    expect(
      affordanceFor({ op: "rebaseBranch", branch: "x", onto: "y", short: "y" }),
    ).toBe("dashed");
    expect(
      affordanceFor({
        op: "cherryPickNewBranch",
        shas: ["a"],
        target: "t",
        short: "t",
      }),
    ).toBe("plus");
  });
  it("checkout (drag HEAD) shows a dashed circle, like merge/rebase", () => {
    expect(affordanceFor({ op: "checkout", branch: "x" })).toBe("dashed");
    expect(
      affordanceFor({ op: "checkout", branch: "x", candidates: ["x", "y"] }),
    ).toBe("dashed");
  });
  it("reset has no add/merge affordance", () => {
    expect(
      affordanceFor({ op: "reset", target: "x", short: "x", mode: "mixed" }),
    ).toBeNull();
  });
  it("null op has no affordance", () => {
    expect(affordanceFor(null)).toBeNull();
  });
});

describe("modsOf", () => {
  it("reads modifier flags off an event", () => {
    expect(
      modsOf({ shiftKey: true, altKey: false, metaKey: true, ctrlKey: false }),
    ).toEqual({ shift: true, alt: false, meta: true, ctrl: false });
  });
});

describe("mergeMods (WKWebView keyboard-tracker union)", () => {
  it("takes the union of the two snapshots", () => {
    expect(mergeMods(mods({ shift: true }), mods({ alt: true }))).toEqual(
      mods({ shift: true, alt: true }),
    );
  });

  it("either side alone is enough (event flags OR tracked keyboard)", () => {
    expect(mergeMods(NO_MODS, mods({ meta: true }))).toEqual(
      mods({ meta: true }),
    );
    expect(mergeMods(mods({ ctrl: true }), NO_MODS)).toEqual(
      mods({ ctrl: true }),
    );
    expect(mergeMods(NO_MODS, NO_MODS)).toEqual(NO_MODS);
  });
});

describe("resolveMergeDrop — both ends of a branch-head merge drag", () => {
  it("one branch at each end: unambiguous, so neither side surfaces candidates", () => {
    expect(resolveMergeDrop(["feature"], ["main"])).toEqual({
      source: "feature",
      target: "main",
      sourceCandidates: [],
      targetCandidates: [],
    });
  });

  it("an end with no local branch cannot merge (nothing to name, nothing to advance)", () => {
    expect(resolveMergeDrop([], ["main"])).toBeNull();
    expect(resolveMergeDrop(["feature"], [])).toBeNull();
    expect(resolveMergeDrop(undefined, null)).toBeNull();
  });

  it("only the source is ambiguous: candidates on the source side alone", () => {
    expect(resolveMergeDrop(["feature", "wip"], ["main"])).toEqual({
      source: "feature",
      target: "main",
      sourceCandidates: ["feature", "wip"],
      targetCandidates: [],
    });
  });

  it("only the target is ambiguous: candidates on the target side alone", () => {
    expect(resolveMergeDrop(["feature"], ["main", "release"])).toEqual({
      source: "feature",
      target: "main",
      sourceCandidates: [],
      targetCandidates: ["main", "release"],
    });
  });

  it("both ends ambiguous: each side defaults to its first, and both lists are surfaced", () => {
    expect(resolveMergeDrop(["feature", "wip"], ["main", "release"])).toEqual({
      source: "feature",
      target: "main",
      sourceCandidates: ["feature", "wip"],
      targetCandidates: ["main", "release"],
    });
  });

  it("dropped back onto the origin commit: identical candidate sets are not a merge", () => {
    // Both ends resolve to the same commit, so any pair of names would be an
    // already-up-to-date no-op — refuse the whole drop rather than prompt.
    expect(resolveMergeDrop(["feature", "wip"], ["feature", "wip"])).toBeNull();
    expect(resolveMergeDrop(["main"], ["main"])).toBeNull();
  });
});
