import { describe, it, expect } from "vitest";
import { assignLanes, laneColorVar } from "./lanes";
import type { Commit } from "./ipc";

function c(sha: string, parents: string[] = []): Commit {
  return {
    sha,
    short_sha: sha.slice(0, 7),
    author_name: "T",
    author_email: "t@e.com",
    timestamp: 0,
    subject: sha,
    body: "",
    parents,
  };
}

describe("assignLanes", () => {
  it("keeps a linear history in a single lane", () => {
    const commits = [c("c", ["b"]), c("b", ["a"]), c("a", [])];
    const { assignments, maxLane } = assignLanes(commits);
    expect(maxLane).toBe(0);
    expect(assignments.get("c")?.lane).toBe(0);
    expect(assignments.get("a")?.lane).toBe(0);
  });

  it("forks a second lane for a branch", () => {
    //   c (main) → a ; d (feature) → a
    const commits = [c("c", ["a"]), c("d", ["a"]), c("a", [])];
    const { maxLane } = assignLanes(commits);
    expect(maxLane).toBeGreaterThanOrEqual(1);
  });

  it("classifies first-parent vs merge edges", () => {
    // m is a merge of a and b
    const commits = [c("m", ["a", "b"]), c("a", []), c("b", [])];
    const { edges } = assignLanes(commits);
    const first = edges.find((e) => e.childSha === "m" && e.parentSha === "a");
    const merge = edges.find((e) => e.childSha === "m" && e.parentSha === "b");
    expect(first?.isFirstParent).toBe(true);
    expect(merge?.isFirstParent).toBe(false);
  });

  it("handles multiple roots", () => {
    const commits = [c("a", []), c("b", [])];
    const { assignments } = assignLanes(commits);
    expect(assignments.size).toBe(2);
  });

  it("laneColorVar cycles within the palette", () => {
    expect(laneColorVar(0)).toBe("var(--lane-0)");
    expect(laneColorVar(8)).toBe("var(--lane-0)");
    expect(laneColorVar(10)).toBe("var(--lane-2)");
  });
});

describe("assignLanes HEAD-lane-rightmost remap", () => {
  // d (main tip) → a ; c (older branch tip) → a. Newest-first, so d claims
  // lane 0 and c forks lane 1 before both converge on a's lane 0.
  const forkCommits = [c("d", ["a"]), c("c", ["a"]), c("a", [])];

  it("moves HEAD's lane to the rightmost slot (0) when it isn't already", () => {
    const { assignments } = assignLanes(forkCommits, "c");
    expect(assignments.get("c")?.lane).toBe(0);
    expect(assignments.get("d")?.lane).toBe(1);
  });

  it("is a no-op when HEAD's lane is already rightmost", () => {
    const before = assignLanes(forkCommits);
    const after = assignLanes(forkCommits, "d");
    expect(after.assignments.get("d")?.lane).toBe(0);
    expect(after.assignments.get("c")?.lane).toBe(
      before.assignments.get("c")?.lane,
    );
  });

  it("leaves lanes untouched when headSha is absent from the commits", () => {
    const withoutHead = assignLanes(forkCommits);
    const withMissingHead = assignLanes(forkCommits, "does-not-exist");
    expect(withMissingHead.assignments.get("d")?.lane).toBe(
      withoutHead.assignments.get("d")?.lane,
    );
    expect(withMissingHead.assignments.get("c")?.lane).toBe(
      withoutHead.assignments.get("c")?.lane,
    );
  });

  it("leaves lanes untouched when headSha is null/undefined", () => {
    const base = assignLanes(forkCommits);
    const nullHead = assignLanes(forkCommits, null);
    expect(nullHead.assignments.get("d")?.lane).toBe(
      base.assignments.get("d")?.lane,
    );
  });

  it("preserves the relative order of other lanes when remapping", () => {
    // Three tips forking from a shared root: e, f, g (HEAD) land on lanes
    // 0, 1, 2 respectively before the remap.
    const commits = [c("e", ["r"]), c("f", ["r"]), c("g", ["r"]), c("r", [])];
    const before = assignLanes(commits);
    expect(before.assignments.get("e")?.lane).toBe(0);
    expect(before.assignments.get("f")?.lane).toBe(1);
    expect(before.assignments.get("g")?.lane).toBe(2);

    const after = assignLanes(commits, "g");
    expect(after.assignments.get("g")?.lane).toBe(0); // HEAD → rightmost
    expect(after.assignments.get("e")?.lane).toBe(1); // shifted to make room
    expect(after.assignments.get("f")?.lane).toBe(2); // shifted to make room
    // The shared root keeps the (remapped) lane of whichever lane it closed.
    expect(after.assignments.get("r")?.lane).toBe(1);
  });

  it("keeps edge lane numbers consistent with the remapped assignments", () => {
    const { assignments, edges } = assignLanes(forkCommits, "c");
    for (const e of edges) {
      expect(e.childLane).toBe(assignments.get(e.childSha)?.lane);
      expect(e.parentLane).toBe(assignments.get(e.parentSha)?.lane);
    }
  });
});
