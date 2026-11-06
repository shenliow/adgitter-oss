/**
 * Branch-head merge drag: dragging the affordance dot from one branch head
 * onto another asks for `git checkout <target> && git merge <source>`.
 *
 * Either endpoint can carry several local branches, and neither side may be
 * picked by chip display order behind the user's back — the graph hands both
 * candidate lists up and the confirm gate asks (see resolveMergeDrop).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import type { Commit, RefList } from "../lib/ipc";

const pollNativeModifiers = vi.hoisted(() => vi.fn());
vi.mock("../lib/ipc", () => ({ pollNativeModifiers }));

import MetroGraph from "./MetroGraph.svelte";
import {
  registerRemoteGraphThemePack,
  __resetRemoteGraphThemePacks,
} from "../lib/graphTheme";

function commit(sha: string, parents: string[] = []): Commit {
  return {
    sha,
    short_sha: sha.slice(0, 7),
    author_name: "Tester",
    author_email: "t@example.com",
    timestamp: 1700000000,
    subject: `subject ${sha}`,
    body: "",
    parents,
  };
}

const commits = [commit("c3", ["c2"]), commit("c2", ["c1"]), commit("c1", [])];

/** `heads` maps sha → the local branches pointing at it, display order. */
function refsWith(heads: Record<string, string[]>): RefList {
  return {
    head: { branch: "main", target: "c3", detached: false },
    branches: Object.entries(heads).flatMap(([target, names]) =>
      names.map((name) => ({ name, kind: "branch" as const, target })),
    ),
    remotes: [],
    tags: [],
  };
}

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

beforeEach(() => {
  pollNativeModifiers.mockReset();
  pollNativeModifiers.mockResolvedValue(null);
});

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
});

function render(props: Record<string, unknown>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(MetroGraph, { target: host, props });
  flushSync();
  return host;
}

// jsdom has no layout, so the content's bounding rect is all-zero and client
// coords map straight to the content-local coords the graph computes; each
// node handle is positioned at its own centre, so its inline left/top *is*
// the hit point for that node.
function handleOf(h: HTMLDivElement, sha: string): HTMLDivElement {
  const i = commits.findIndex((c) => c.sha === sha);
  const el = [...h.querySelectorAll<HTMLDivElement>(".node-handle")][i];
  if (!el) throw new Error(`no node handle for ${sha}`);
  return el;
}

function centreOf(el: HTMLElement): { x: number; y: number } {
  return { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
}

function firePointer(
  el: EventTarget,
  type: "pointerenter" | "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
) {
  const ev = new MouseEvent(type, {
    bubbles: type !== "pointerenter",
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(ev, "pointerId", { value: 1 });
  el.dispatchEvent(ev);
}

/** Press the merge dot on `fromSha`'s node and drop it on `toSha`'s. */
function mergeDrag(h: HTMLDivElement, fromSha: string, toSha: string) {
  const from = handleOf(h, fromSha);
  const to = centreOf(handleOf(h, toSha));
  // The dot only mounts while its node is hovered.
  firePointer(from, "pointerenter", 0, 0);
  flushSync();
  const dot = h.querySelector(".merge-handle");
  if (!dot) throw new Error(`no merge dot on ${fromSha}`);
  firePointer(dot, "pointerdown", 0, 0);
  firePointer(window, "pointermove", to.x, to.y);
  firePointer(window, "pointerup", to.x, to.y);
  flushSync();
}

/** Press `fromSha`'s merge dot and move the pointer to `(base.x + dx, base.y
 *  + dy)` — `base` is `fromSha`'s own node centre — WITHOUT releasing, so the
 *  live connector renders mid-drag (not yet locked onto any drop target).
 *  Offsetting from the source's own centre (rather than an absolute point)
 *  guarantees a non-zero delta on both axes regardless of where the graph
 *  laid that lane out, so the rendered path always has both a horizontal and
 *  a vertical run to assert on. Caller must release the drag afterwards
 *  (`firePointer(window, "pointerup", ...)`) so it doesn't leak into the
 *  next test. */
function beginMergeDragTo(
  h: HTMLDivElement,
  fromSha: string,
  dx: number,
  dy: number,
): { x: number; y: number } {
  const from = handleOf(h, fromSha);
  const base = centreOf(from);
  const to = { x: base.x + dx, y: base.y + dy };
  firePointer(from, "pointerenter", 0, 0);
  flushSync();
  const dot = h.querySelector(".merge-handle");
  if (!dot) throw new Error(`no merge dot on ${fromSha}`);
  firePointer(dot, "pointerdown", 0, 0);
  firePointer(window, "pointermove", to.x, to.y);
  flushSync();
  return to;
}

describe("MetroGraph branch-head merge drag", () => {
  it("one branch at each end: merges without asking anything", () => {
    const onBranchMerge = vi.fn();
    const h = render({
      commits,
      refs: refsWith({ c3: ["main"], c2: ["feature"] }),
      onBranchMerge,
    });
    mergeDrag(h, "c2", "c3");
    expect(onBranchMerge.mock.calls).toEqual([
      [
        {
          source: "feature",
          target: "main",
          sourceCandidates: [],
          targetCandidates: [],
        },
      ],
    ]);
  });

  it("several branches at the drag's origin: every source candidate is surfaced", () => {
    const onBranchMerge = vi.fn();
    const h = render({
      commits,
      refs: refsWith({ c3: ["main"], c2: ["feature", "wip"] }),
      onBranchMerge,
    });
    mergeDrag(h, "c2", "c3");
    expect(onBranchMerge.mock.calls).toEqual([
      [
        {
          source: "feature",
          target: "main",
          sourceCandidates: ["feature", "wip"],
          targetCandidates: [],
        },
      ],
    ]);
  });

  it("several branches at both ends: both candidate lists ride along", () => {
    const onBranchMerge = vi.fn();
    const h = render({
      commits,
      refs: refsWith({ c3: ["main", "release"], c2: ["feature", "wip"] }),
      onBranchMerge,
    });
    mergeDrag(h, "c2", "c3");
    expect(onBranchMerge.mock.calls).toEqual([
      [
        {
          source: "feature",
          target: "main",
          sourceCandidates: ["feature", "wip"],
          targetCandidates: ["main", "release"],
        },
      ],
    ]);
  });

  it("dropped back on its own node: no merge, even with several branches to pick from", () => {
    const onBranchMerge = vi.fn();
    const h = render({
      commits,
      refs: refsWith({ c3: ["main"], c2: ["feature", "wip"] }),
      onBranchMerge,
    });
    mergeDrag(h, "c2", "c2");
    expect(onBranchMerge).not.toHaveBeenCalled();
  });

  it("dropped on a commit with no branch head: nothing to advance, so no merge", () => {
    const onBranchMerge = vi.fn();
    const h = render({
      commits,
      refs: refsWith({ c3: ["main"], c2: ["feature"] }),
      onBranchMerge,
    });
    mergeDrag(h, "c2", "c1");
    expect(onBranchMerge).not.toHaveBeenCalled();
  });
});

describe("MetroGraph branch-head merge drag — connector casing + routing", () => {
  it("casings the live connector — same path, 2px wider, themed-bg coloured, just like a rail", () => {
    const h = render({
      commits,
      refs: refsWith({ c3: ["main"], c2: ["feature"] }),
    });
    const to = beginMergeDragTo(h, "c2", 220, -90);

    const casing = h.querySelector('path[class="merge-drag-casing"]');
    const line = h.querySelector('path[class="merge-drag-line"]');
    expect(casing).not.toBeNull();
    expect(line).not.toBeNull();
    // Same geometry as the coloured line, casing drawn first (underneath).
    expect(casing!.getAttribute("d")).toBe(line!.getAttribute("d"));
    const casingW = Number(casing!.getAttribute("stroke-width"));
    const railW = Number(line!.getAttribute("stroke-width"));
    expect(casingW).toBe(railW + 2);
    // Themed-bg expression, never a literal colour — mirrors the edges'
    // own casing (see MetroGraph.theme.test.ts).
    expect(casing!.getAttribute("stroke")).toBe("var(--workspace-bg)");
    expect(line!.getAttribute("stroke")).not.toBe("var(--workspace-bg)");

    firePointer(window, "pointerup", to.x, to.y);
    flushSync();
  });

  it("routes orthogonally — a horizontal run before a vertical one, never a single diagonal", () => {
    const h = render({
      commits,
      refs: refsWith({ c3: ["main"], c2: ["feature"] }),
    });
    const to = beginMergeDragTo(h, "c2", 220, -90);

    const line = h.querySelector('path[class="merge-drag-line"]')!;
    const d = line.getAttribute("d")!;
    // No single-segment diagonal `L` straight to the cursor...
    expect(d).not.toMatch(/^M[-\d.\s]+L[-\d.\s]+$/);
    // ...instead a horizontal run (H), then the rounded corner (Q), then a
    // vertical run (V) into the cursor — H strictly before V.
    const hIndex = d.indexOf("H");
    const vIndex = d.indexOf("V");
    expect(hIndex).toBeGreaterThan(-1);
    expect(vIndex).toBeGreaterThan(-1);
    expect(hIndex).toBeLessThan(vIndex);

    firePointer(window, "pointerup", to.x, to.y);
    flushSync();
  });

  it("routes horizontally toward whichever side the cursor is on (left vs right)", () => {
    const h = render({
      commits,
      refs: refsWith({ c3: ["main"], c2: ["feature"] }),
    });
    const base = centreOf(handleOf(h, "c2"));

    const right = beginMergeDragTo(h, "c2", 220, -90);
    const dRight = h
      .querySelector('path[class="merge-drag-line"]')!
      .getAttribute("d")!;
    firePointer(window, "pointerup", right.x, right.y);
    flushSync();

    const left = beginMergeDragTo(h, "c2", -220, -90);
    const dLeft = h
      .querySelector('path[class="merge-drag-line"]')!
      .getAttribute("d")!;
    firePointer(window, "pointerup", left.x, left.y);
    flushSync();

    // "M{x1} {y1} H{...}": the H endpoint sits on the cursor's side of x1 —
    // greater than x1 when the cursor is to the right, less when it's left.
    const hEndOf = (d: string) => Number(d.match(/H([-\d.]+)/)![1]);
    expect(hEndOf(dRight)).toBeGreaterThan(base.x);
    expect(hEndOf(dLeft)).toBeLessThan(base.x);
  });
});

/**
 * The node HIT radius follows the theme's `spriteScale`.
 *
 * This is the coupling that would rot silently: `hitR` is `NODE_R * spriteScale
 * + 8`, and if the sprite doubled while the hit radius stayed at the default's
 * 20px, a 56px commit sprite would only accept a drop near its middle — the art
 * would look right and the gesture would just quietly stop working over most of
 * it. Nothing else in the suite would notice.
 *
 * Both cases drop 26px below the target's own rendered centre: outside the
 * default 20px radius, inside the 32px one a 2x theme resolves to.
 */
describe("MetroGraph merge-drop hit radius follows the sprite scale", () => {
  /** Drop `fromSha`'s merge dot `dy` px below `toSha`'s node centre. */
  function dropNear(
    h: HTMLDivElement,
    fromSha: string,
    toSha: string,
    dy: number,
  ) {
    const from = handleOf(h, fromSha);
    const target = centreOf(handleOf(h, toSha));
    firePointer(from, "pointerenter", 0, 0);
    flushSync();
    const dot = h.querySelector(".merge-handle");
    if (!dot) throw new Error(`no merge dot on ${fromSha}`);
    firePointer(dot, "pointerdown", 0, 0);
    firePointer(window, "pointermove", target.x, target.y + dy);
    firePointer(window, "pointerup", target.x, target.y + dy);
    flushSync();
  }

  afterEach(() => __resetRemoteGraphThemePacks());

  it("26px off-centre misses at the default scale", () => {
    const onBranchMerge = vi.fn();
    const h = render({
      commits,
      refs: refsWith({ c3: ["main"], c2: ["feature"] }),
      onBranchMerge,
    });
    dropNear(h, "c2", "c3", 26);
    expect(onBranchMerge).not.toHaveBeenCalled();
  });

  it("the same 26px lands once the theme draws its sprites at 2x", () => {
    registerRemoteGraphThemePack({
      id: "hit-scale-test",
      name: "Hit Scale Test",
      geometry: { spriteScale: 2, rowH: 84, laneW: 60 },
    });
    const onBranchMerge = vi.fn();
    const h = render({
      commits,
      refs: refsWith({ c3: ["main"], c2: ["feature"] }),
      graphTheme: "hit-scale-test",
      onBranchMerge,
    });
    dropNear(h, "c2", "c3", 26);
    expect(onBranchMerge.mock.calls).toEqual([
      [
        {
          source: "feature",
          target: "main",
          sourceCandidates: [],
          targetCandidates: [],
        },
      ],
    ]);
  });
});
