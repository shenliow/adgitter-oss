import { describe, it, expect } from "vitest";
import { discardedByReset, type ParentedCommit } from "./resetPreview";

const c = (sha: string, ...parents: string[]): ParentedCommit => ({
  sha,
  parents,
});

// A linear page, newest-first (the order MetroGraph renders).
//   c4 → c3 → c2 → c1
const linear = [c("c4", "c3"), c("c3", "c2"), c("c2", "c1"), c("c1")];

describe("discardedByReset", () => {
  it("discards every commit between HEAD and the target, target included", () => {
    expect(discardedByReset(linear, "c4", "c2")).toEqual(new Set(["c4", "c3"]));
  });

  it("discards nothing when the target IS HEAD", () => {
    expect(discardedByReset(linear, "c4", "c4")).toEqual(new Set());
  });

  it("discards nothing when the target is a descendant of HEAD (a reset forward)", () => {
    expect(discardedByReset(linear, "c2", "c4")).toEqual(new Set());
  });

  it("resetting to the root discards all but the root", () => {
    expect(discardedByReset(linear, "c4", "c1")).toEqual(
      new Set(["c4", "c3", "c2"]),
    );
  });

  it("keeps the shared history when the target is on a divergent branch", () => {
    //        c3 (HEAD)   s2 (side)
    //         |           |
    //        c2          s1
    //          \        /
    //            base  ↙
    const diverged = [
      c("c3", "c2"),
      c("s2", "s1"),
      c("c2", "base"),
      c("s1", "base"),
      c("base"),
    ];
    // Only HEAD's own side of the fork leaves the branch; `base` is shared.
    expect(discardedByReset(diverged, "c3", "s2")).toEqual(
      new Set(["c3", "c2"]),
    );
  });

  it("keeps both parents' history when HEAD is a merge whose target is one side", () => {
    //  m (HEAD, parents a1 + b1) → a1 → base, b1 → base
    const merged = [
      c("m", "a1", "b1"),
      c("a1", "base"),
      c("b1", "base"),
      c("base"),
    ];
    expect(discardedByReset(merged, "m", "a1")).toEqual(new Set(["m", "b1"]));
  });

  it("previews only the loaded prefix when HEAD's history runs off the page", () => {
    // c1's parent "c0" is not loaded; the walk stops there rather than
    // inventing commits.
    const page = [c("c3", "c2"), c("c2", "c1"), c("c1", "c0")];
    expect(discardedByReset(page, "c3", "c1")).toEqual(new Set(["c3", "c2"]));
  });

  it("stays silent when the target itself is off the page", () => {
    // Nothing can be said about which of HEAD's ancestors an unloaded target
    // keeps, so preview nothing rather than ghosting the whole page.
    expect(discardedByReset(linear, "c4", "zz")).toEqual(new Set());
  });

  it("stays silent when HEAD is off the page, or either end is missing", () => {
    expect(discardedByReset(linear, "zz", "c2")).toEqual(new Set());
    expect(discardedByReset(linear, null, "c2")).toEqual(new Set());
    expect(discardedByReset(linear, "c4", null)).toEqual(new Set());
  });

  it("is unaffected by a cycle-shaped page (never loops forever)", () => {
    const weird = [c("a", "b"), c("b", "a")];
    expect(discardedByReset(weird, "a", "b")).toEqual(new Set());
  });
});
