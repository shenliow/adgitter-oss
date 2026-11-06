import { describe, it, expect, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import MetroGraph from "./MetroGraph.svelte";
import type { Commit, RefList } from "../lib/ipc";
import {
  registerRemoteGraphThemePack,
  __resetRemoteGraphThemePacks,
} from "../lib/graphTheme";

/**
 * The one prop `GraphRails` takes as a FUNCTION rather than as data:
 * `laneColor`. Everything the rails layer paints — rails, corners, junction
 * tints, node circles — gets its colour through it, and it resolves state
 * only MetroGraph has (the per-branch `branchColors` override, mapped
 * onto lane colour indices via `refs`).
 *
 * Pinned because the obvious "shrink the prop surface" move is to replace it
 * with a precomputed lane palette, and that breaks silently: the branch CHIPS
 * deliberately bypass `laneColor` (they read the override directly), so every
 * existing override test would stay green while every rail and node quietly
 * fell back to the default `--lane-N` palette.
 */

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

// Same shape as the theme suite's fixture: a merge DAG, so the graph has more
// than one lane colour and an override can be shown NOT to leak onto the other.
const commits = [
  commit("m", ["c3", "c2"]),
  commit("c3", ["c1"]),
  commit("c2", ["c1"]),
  commit("c1", []),
];

const refs: RefList = {
  head: { branch: "main", target: "m", detached: false },
  branches: [{ name: "main", kind: "branch", target: "m" }],
  remotes: [],
  tags: [],
};

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

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

const OVERRIDE = "#123456";

function nodeFills(h: HTMLElement): string[] {
  return [...h.querySelectorAll("g.nodes circle.node")].map(
    (c) => c.getAttribute("fill") ?? "",
  );
}

function railStrokes(h: HTMLElement): string[] {
  return [...h.querySelectorAll("g.edges path")].map(
    (p) => p.getAttribute("stroke") ?? "",
  );
}

describe("GraphRails' laneColor prop contract", () => {
  it("resolves a per-branch colour override for the nodes it draws", () => {
    const h = render({ commits, refs, branchColors: { main: OVERRIDE } });
    const fills = nodeFills(h);
    // main's lane is recoloured...
    expect(fills).toContain(OVERRIDE);
    // ...and the fork's lane still comes from the default palette, so this is
    // the override path and not a blanket recolour.
    expect(fills.some((f) => f.startsWith("var(--lane-"))).toBe(true);
  });

  it("resolves the same override for the rails it draws", () => {
    const h = render({ commits, refs, branchColors: { main: OVERRIDE } });
    expect(railStrokes(h)).toContain(OVERRIDE);
  });

  it("falls back to the lane palette with no override", () => {
    const h = render({ commits, refs });
    expect(nodeFills(h).every((f) => f.startsWith("var(--lane-"))).toBe(true);
    expect(railStrokes(h)).not.toContain(OVERRIDE);
  });
});

/**
 * The other prop the rails layer must be HANDED rather than derive itself:
 * `geom`. GraphRails could perfectly well call `resolveGraphGeometry(gtheme)`
 * on its own — and that is the trap. MetroGraph positions `.row`, the crown,
 * the merge handles and the "+" hit area on the same numbers, so two
 * independent resolutions are two things to drift apart; one resolution passed
 * down cannot.
 */
describe("GraphRails' geom prop contract", () => {
  afterEach(() => __resetRemoteGraphThemePacks());

  /** Every stroke-width the edges layer paints a rail with. */
  function railWidths(h: HTMLElement): number[] {
    return [...h.querySelectorAll("g.edges path")].map((p) =>
      parseFloat(p.getAttribute("stroke-width")!),
    );
  }

  it("strokes rails at RAIL_W, and its casing 2px wider, by default", () => {
    const widths = new Set(railWidths(render({ commits, refs })));
    // The coloured rail plus its fixed 1px-per-side casing rim.
    expect([...widths].sort((a, b) => a - b)).toEqual([7, 9]);
  });

  it("scales the rail with the theme's spriteScale, rim weight unchanged", () => {
    registerRemoteGraphThemePack({
      id: "rails-geom-test",
      name: "Rails Geom Test",
      geometry: { spriteScale: 2, rowH: 84, laneW: 60 },
    });
    const widths = new Set(
      railWidths(render({ commits, refs, graphTheme: "rails-geom-test" })),
    );
    // A branch line is one of the marks the scale is about — but the casing is
    // still the same 1px-per-side rim it was designed as, not 2px.
    expect([...widths].sort((a, b) => a - b)).toEqual([14, 16]);
  });

  it("turns corners on the scaled radius the rails layer decomposes from", () => {
    // `edgeSegments` takes its corner radius from `edgeMapping.corner`, which
    // follows the scale. A decomposition on the unscaled default would leave a
    // gap between a straight run and the corner tile that joins it.
    registerRemoteGraphThemePack({
      id: "rails-corner-test",
      name: "Rails Corner Test",
      geometry: { spriteScale: 2, rowH: 84, laneW: 60 },
    });
    const h = render({ commits, refs, graphTheme: "rails-corner-test" });
    // The merge edge turns; `edgePath`'s Q control point is the elbow and the
    // radius is min(CORNER*2, dx/2, dy/2) = min(28, 30, 42) = 28.
    const turning = [...h.querySelectorAll("g.edges path")]
      .map((p) => p.getAttribute("d") ?? "")
      .filter((d) => d.includes("Q"));
    expect(turning.length).toBeGreaterThan(0);
    for (const d of turning) {
      const [, ex, ey, cx, cy] = d.match(
        /Q(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/,
      )!;
      // The run resumes exactly the radius away from the elbow.
      const dist = Math.hypot(+cx - +ex, +cy - +ey);
      expect(dist).toBeCloseTo(28, 5);
    }
  });
});
