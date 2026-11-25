/**
 * Which new commit circle flies out of which existing one.
 *
 * Commits and merges grow out of the circle that was current; rebases and
 * cherry-picks out of each commit's own source — paired by the author / author
 * time / subject that git copies onto a replayed commit.
 */
import { describe, it, expect } from "vitest";
import type { Commit } from "./ipc";
import {
  planFlights,
  MAX_FLIGHTS,
  type GraphAnimationHint,
} from "./graphAnimation";

let clock = 1_700_000_000;
function c(
  sha: string,
  parents: string[] = [],
  over: Partial<Commit> = {},
): Commit {
  return {
    sha,
    short_sha: sha.slice(0, 7),
    author_name: "Tester",
    author_email: "t@example.com",
    timestamp: clock++,
    subject: `subject ${sha}`,
    body: "",
    parents,
    ...over,
  };
}
/** A replay of `src` (rebase / cherry-pick): new sha and parent, same identity. */
function replay(sha: string, src: Commit, parent: string): Commit {
  return { ...src, sha, short_sha: sha, parents: [parent] };
}
function hint(over: Partial<GraphAnimationHint>): GraphAnimationHint {
  return { seq: 1, mode: "head", headBefore: null, ...over };
}

describe("planFlights — commit and merge grow out of the current circle", () => {
  it("a commit flies out of the commit it was made on", () => {
    const a = c("a");
    const b = c("b", ["a"]);
    const before = [b, a];
    const n = c("n", ["b"]);
    expect(
      planFlights(before, [n, b, a], hint({ mode: "head", headBefore: "b" })),
    ).toEqual([{ sha: "n", from: "b" }]);
  });

  it("a merge commit flies out of its first parent (the branch merged into)", () => {
    const base = c("base");
    const main = c("main", ["base"]);
    const feat = c("feat", ["base"]);
    const before = [feat, main, base];
    const m = c("m", ["main", "feat"]);
    expect(
      planFlights(
        before,
        [m, feat, main, base],
        hint({ mode: "head", headBefore: "main" }),
      ),
    ).toEqual([{ sha: "m", from: "main" }]);
  });

  it("a commit already on screen when armed still flies (the watcher raced it)", () => {
    const a = c("a");
    const n = c("n", ["a"]);
    // `before` already contains the new commit — `created` says it is new.
    expect(
      planFlights(
        [n, a],
        [n, a],
        hint({ mode: "head", headBefore: "n", created: ["n"] }),
      ),
    ).toEqual([{ sha: "n", from: "a" }]);
  });
});

describe("planFlights — rebase and cherry-pick come out of their sources", () => {
  it("each rebased commit flies out of the original it replays, oldest first", () => {
    const base = c("base");
    const main = c("main", ["base"]);
    const f1 = c("f1", ["base"]);
    const f2 = c("f2", ["f1"]);
    const before = [f2, f1, main, base];
    const r1 = replay("r1", f1, "main");
    const r2 = replay("r2", f2, "r1");
    // The originals stay on screen as ghosts.
    const after = [
      r2,
      r1,
      { ...f2, ghost: true },
      { ...f1, ghost: true },
      main,
      base,
    ];
    expect(
      planFlights(before, after, hint({ mode: "sources", headBefore: "f2" })),
    ).toEqual([
      { sha: "r1", from: "f1" },
      { sha: "r2", from: "f2" },
    ]);
  });

  it("works when the originals are gone from the graph (ghosts hidden)", () => {
    const base = c("base");
    const f1 = c("f1", ["base"]);
    const main = c("main", ["base"]);
    const r1 = replay("r1", f1, "main");
    expect(
      planFlights(
        [f1, main, base],
        [r1, main, base],
        hint({ mode: "sources", headBefore: "f1" }),
      ),
    ).toEqual([{ sha: "r1", from: "f1" }]);
  });

  it("cherry-picked copies fly out of the picked commits", () => {
    const base = c("base");
    const p1 = c("p1", ["base"]);
    const p2 = c("p2", ["p1"]);
    const main = c("main", ["base"]);
    const before = [main, p2, p1, base];
    const x1 = replay("x1", p1, "main");
    const x2 = replay("x2", p2, "x1");
    expect(
      planFlights(
        before,
        [x2, x1, main, p2, p1, base],
        hint({ mode: "sources", headBefore: "main", sources: ["p1", "p2"] }),
      ),
    ).toEqual([
      { sha: "x1", from: "p1" },
      { sha: "x2", from: "p2" },
    ]);
  });

  it("a reworded commit (new subject) is still paired by author and time", () => {
    const a = c("a");
    const b = c("b", ["a"]);
    const b2 = { ...b, sha: "b2", subject: "a better message" };
    expect(
      planFlights([b, a], [b2, a], hint({ mode: "sources", headBefore: "b" })),
    ).toEqual([{ sha: "b2", from: "b" }]);
  });

  it("falls back to the listed sources in order, then to HEAD", () => {
    const a = c("a");
    const s1 = c("s1", ["a"]);
    const before = [s1, a];
    // Nothing shares an identity with the sources (e.g. a squash's new commit).
    const n1 = c("n1", ["a"]);
    const n2 = c("n2", ["n1"]);
    expect(
      planFlights(
        before,
        [n2, n1, s1, a],
        hint({ mode: "sources", headBefore: "a", sources: ["s1"] }),
      ),
    ).toEqual([
      { sha: "n1", from: "s1" },
      { sha: "n2", from: "a" },
    ]);
  });

  it("does not pair two new commits with the same source", () => {
    const a = c("a");
    const dupe = replay("d1", a, "a");
    const dupe2 = replay("d2", a, "d1");
    const flights = planFlights(
      [a],
      [dupe2, dupe, a],
      hint({ mode: "sources", headBefore: "a" }),
    );
    // The first copy takes `a` by identity; the second can only fall back to
    // HEAD, which is `a` too — but it must not have been taken "by identity".
    expect(flights.map((f) => f.sha)).toEqual(["d1", "d2"]);
    expect(flights.every((f) => f.from === "a")).toBe(true);
  });
});

describe("planFlights — what does not animate", () => {
  it("nothing new: no flights", () => {
    const a = c("a");
    expect(
      planFlights([a], [a], hint({ mode: "head", headBefore: "a" })),
    ).toEqual([]);
  });

  it("a new ghost (only reachable via a backup ref) does not fly", () => {
    const a = c("a");
    const g = c("g", ["a"], { ghost: true });
    expect(
      planFlights([a], [g, a], hint({ mode: "head", headBefore: "a" })),
    ).toEqual([]);
  });

  it("no source on screen: the commit simply appears", () => {
    const n = c("n", ["missing"]);
    expect(
      planFlights([], [n], hint({ mode: "head", headBefore: null })),
    ).toEqual([]);
  });

  it(`caps a huge rewrite at the newest ${MAX_FLIGHTS} commits`, () => {
    const a = c("a");
    const fresh: Commit[] = [];
    let parent = "a";
    for (let i = 0; i < MAX_FLIGHTS + 10; i++) {
      const n = c(`n${i}`, [parent]);
      fresh.unshift(n);
      parent = n.sha;
    }
    const flights = planFlights(
      [a],
      [...fresh, a],
      hint({ mode: "head", headBefore: "a" }),
    );
    expect(flights).toHaveLength(MAX_FLIGHTS);
    expect(flights.at(-1)!.sha).toBe(`n${MAX_FLIGHTS + 9}`);
  });
});
