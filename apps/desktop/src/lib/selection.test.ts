import { describe, it, expect } from "vitest";
import {
  emptySelection,
  single,
  applyClick,
  applyMarquee,
  ancestry,
  firstParentSegment,
  branchSegment,
  selectedInOrder,
  isSelected,
  contiguousRange,
  type Selection,
  type ClickMods,
} from "./selection";

// Newest-first on-screen order.
const order = ["c5", "c4", "c3", "c2", "c1"];
const NO: ClickMods = { shift: false, meta: false, ctrl: false };
const shas = (s: Selection) => [...s.shas].sort();

describe("applyClick", () => {
  it("plain click selects just that commit and sets the anchor", () => {
    const s = applyClick(emptySelection(), "c3", order, NO);
    expect(shas(s)).toEqual(["c3"]);
    expect(s.anchor).toBe("c3");
  });

  it("plain click replaces a prior selection", () => {
    const s = applyClick(single("c1"), "c4", order, NO);
    expect(shas(s)).toEqual(["c4"]);
  });

  it("⌘/Ctrl click toggles a commit into the set", () => {
    const s1 = applyClick(single("c1"), "c3", order, { ...NO, meta: true });
    expect(shas(s1)).toEqual(["c1", "c3"]);
    const s2 = applyClick(s1, "c1", order, { ...NO, ctrl: true });
    expect(shas(s2)).toEqual(["c3"]);
  });

  it("Shift click selects the inclusive range from the anchor", () => {
    const base = applyClick(emptySelection(), "c4", order, NO);
    const ranged = applyClick(base, "c2", order, { ...NO, shift: true });
    expect(shas(ranged)).toEqual(["c2", "c3", "c4"]);
    expect(ranged.anchor).toBe("c4"); // anchor stays put for re-extension
  });

  it("Shift range works upward (anchor below target)", () => {
    const base = applyClick(emptySelection(), "c2", order, NO);
    const ranged = applyClick(base, "c5", order, { ...NO, shift: true });
    expect(shas(ranged)).toEqual(["c2", "c3", "c4", "c5"]);
  });

  it("Shift click with no anchor falls back to a single select", () => {
    const s = applyClick(emptySelection(), "c3", order, { ...NO, shift: true });
    expect(shas(s)).toEqual(["c3"]);
  });
});

describe("applyMarquee", () => {
  it("replaces the selection with the swept range", () => {
    const s = applyMarquee(single("c1"), ["c4", "c3"], NO);
    expect(shas(s)).toEqual(["c3", "c4"]);
  });

  it("Shift marquee adds the swept range to the selection", () => {
    const s = applyMarquee(single("c1"), ["c4", "c3"], { ...NO, shift: true });
    expect(shas(s)).toEqual(["c1", "c3", "c4"]);
  });

  it("⌘/Ctrl marquee toggles the swept range against the selection", () => {
    // None of the swept shas were selected → they get added.
    const added = applyMarquee(single("c1"), ["c4", "c3"], {
      ...NO,
      meta: true,
    });
    expect(shas(added)).toEqual(["c1", "c3", "c4"]);
    // A swept sha that WAS selected is toggled back out (c3 removed, c4 added).
    const base: Selection = { shas: new Set(["c1", "c3"]), anchor: "c1" };
    const toggled = applyMarquee(base, ["c3", "c4"], { ...NO, ctrl: true });
    expect(shas(toggled)).toEqual(["c1", "c4"]);
  });

  it("an empty sweep leaves the selection untouched", () => {
    const prev = single("c2");
    expect(applyMarquee(prev, [], NO)).toBe(prev);
  });
});

describe("ancestry", () => {
  // c1←c2←c3 (main tip c3); f1,f2 branch off c2 (feature tip f2).
  const graph = [
    { sha: "c3", parents: ["c2"] },
    { sha: "f2", parents: ["f1"] },
    { sha: "f1", parents: ["c2"] },
    { sha: "c2", parents: ["c1"] },
    { sha: "c1", parents: [] },
  ];

  it("returns the tip and all its ancestors", () => {
    expect([...ancestry("c3", graph)].sort()).toEqual(["c1", "c2", "c3"]);
    expect([...ancestry("f2", graph)].sort()).toEqual(["c1", "c2", "f1", "f2"]);
  });

  it("ignores shas beyond the loaded set and an absent tip", () => {
    const partial = [{ sha: "c3", parents: ["c2"] }]; // c2 not loaded
    expect([...ancestry("c3", partial)]).toEqual(["c3"]);
    expect(ancestry("nope", graph).size).toBe(0);
  });
});

describe("branchSegment (first-parent to fork)", () => {
  // feat = M-A-B-C ; bug_fix forks at B → M-A-B-F-G ; main = M-D-E.
  const graph = [
    { sha: "C", parents: ["B"] },
    { sha: "G", parents: ["F"] },
    { sha: "F", parents: ["B"] },
    { sha: "B", parents: ["A"] },
    { sha: "A", parents: ["M"] },
    { sha: "E", parents: ["D"] },
    { sha: "D", parents: ["M"] },
    { sha: "M", parents: [] },
  ];

  it("selects a feature branch down to its fork with HEAD (not shared history)", () => {
    // On main (E), click feat (C): first-parent C→B→A, stop at fork M.
    expect(branchSegment("C", graph, "E")).toEqual(["C", "B", "A"]);
  });

  it("follows first-parent only — a branch that forked OFF is included, not its side", () => {
    // Click bug_fix (G) from main: G→F→B→A down to fork M (F is bug_fix's own).
    expect(branchSegment("G", graph, "E")).toEqual(["G", "F", "B", "A"]);
  });

  it("falls back to the previous fork/merge point for the current branch", () => {
    // Click main (E) while on main: E→D, stop at M (which has ≥2 children).
    expect(branchSegment("E", graph, "E")).toEqual(["E", "D"]);
  });

  it("firstParentSegment ignores second parents and unloaded shas", () => {
    // Merge commit X with parents [E, C]: first-parent stays on E's line.
    const withMerge = [{ sha: "X", parents: ["E", "C"] }, ...graph];
    expect(firstParentSegment("X", withMerge, () => false)).toEqual([
      "X",
      "E",
      "D",
      "M",
    ]);
  });
});

describe("contiguousRange", () => {
  // Linear history c1 (root) ← c2 ← c3 ← c4 ← c5, newest-first as rendered.
  const linear = [
    { sha: "c5", parents: ["c4"] },
    { sha: "c4", parents: ["c3"] },
    { sha: "c3", parents: ["c2"] },
    { sha: "c2", parents: ["c1"] },
    { sha: "c1", parents: [] },
  ];

  it("returns a contiguous selection oldest-first", () => {
    const sel: Selection = { shas: new Set(["c4", "c3", "c2"]), anchor: null };
    expect(contiguousRange(sel, linear)).toEqual(["c2", "c3", "c4"]);
  });

  it("returns null when the range has a gap", () => {
    const sel: Selection = { shas: new Set(["c4", "c2"]), anchor: null };
    expect(contiguousRange(sel, linear)).toBeNull();
  });

  it("returns null when a merge commit is inside the range", () => {
    const withMerge = [
      { sha: "m", parents: ["c4", "c3"] }, // merge: two parents
      ...linear,
    ];
    const sel: Selection = { shas: new Set(["m", "c4"]), anchor: null };
    expect(contiguousRange(sel, withMerge)).toBeNull();
  });

  it("returns null when the range includes the root commit", () => {
    const sel: Selection = { shas: new Set(["c2", "c1"]), anchor: null };
    expect(contiguousRange(sel, linear)).toBeNull();
  });

  it("returns null for a single-commit selection", () => {
    const sel: Selection = { shas: new Set(["c3"]), anchor: null };
    expect(contiguousRange(sel, linear)).toBeNull();
  });

  it("works regardless of the Set's insertion order", () => {
    const a: Selection = { shas: new Set(["c2", "c3", "c4"]), anchor: null };
    const b: Selection = { shas: new Set(["c4", "c2", "c3"]), anchor: null };
    expect(contiguousRange(a, linear)).toEqual(["c2", "c3", "c4"]);
    expect(contiguousRange(b, linear)).toEqual(["c2", "c3", "c4"]);
  });
});

describe("helpers", () => {
  it("isSelected reflects membership", () => {
    const s = single("c2");
    expect(isSelected(s, "c2")).toBe(true);
    expect(isSelected(s, "c3")).toBe(false);
  });

  it("selectedInOrder returns selected shas in screen order", () => {
    const s = applyMarquee(emptySelection(), ["c2", "c5", "c3"], NO);
    expect(selectedInOrder(s, order)).toEqual(["c5", "c3", "c2"]);
  });
});
