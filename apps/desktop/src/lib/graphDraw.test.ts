import { describe, it, expect } from "vitest";
import {
  CORNER,
  LANE_W,
  MIN_LANE_W,
  MIN_ROW_H,
  MIN_SPRITE_SCALE,
  NODE_R,
  RAIL_W,
  ROW_H,
  edgePath,
  laneJunctions,
  maxSpriteScale,
  resolveGraphGeometry,
} from "./graphDraw";
import { resolveGraphThemePack, type GraphThemePack } from "./graphTheme";
import type { LaneEdge } from "./lanes";

function edge(overrides: Partial<LaneEdge> = {}): LaneEdge {
  return {
    childSha: "child",
    parentSha: "parent",
    childRow: 0,
    parentRow: 1,
    childLane: 0,
    parentLane: 0,
    isFirstParent: true,
    colorIndex: 0,
    ...overrides,
  };
}

// A simple 1:1 pixel mapping — lane*10, row*20 — so path numbers are easy to
// hand-check.
const geom = { laneX: (l: number) => l * 10, rowY: (r: number) => r * 20 };

describe("edgePath", () => {
  it("draws a straight vertical line when the edge stays in one lane", () => {
    const e = edge({ childLane: 2, parentLane: 2, childRow: 0, parentRow: 3 });
    expect(edgePath(e, geom)).toBe("M20 0 L20 60");
  });

  it("draws a first-parent turn with the corner at the parent's row", () => {
    // child lane 0 (x=0,y=0) -> parent lane 2 (x=20,y=40), first-parent.
    const e = edge({
      childLane: 0,
      parentLane: 2,
      childRow: 0,
      parentRow: 2,
      isFirstParent: true,
    });
    // r = min(CORNER=14, |20-0|/2=10, |40-0|/2=20) = 10
    expect(edgePath(e, geom)).toBe("M0 0 V30 Q0 40 10 40 H20");
  });

  it("draws a non-first-parent (merge) turn with the corner at the child's row", () => {
    // child lane 0 (x=0,y=0) -> parent lane 2 (x=20,y=40), merge edge.
    const e = edge({
      childLane: 0,
      parentLane: 2,
      childRow: 0,
      parentRow: 2,
      isFirstParent: false,
    });
    // r = min(CORNER=14, 10, 20) = 10
    expect(edgePath(e, geom)).toBe("M0 0 H10 Q20 0 20 10 V40");
  });

  it("draws the turn going the other horizontal direction when the parent lane is to the left", () => {
    const e = edge({
      childLane: 3,
      parentLane: 1,
      childRow: 0,
      parentRow: 2,
      isFirstParent: true,
    });
    // x1=30,y1=0, x2=10,y2=40; r = min(14, 10, 20) = 10; sx = -1
    expect(edgePath(e, geom)).toBe("M30 0 V30 Q30 40 20 40 H10");
  });

  it("clamps the corner radius when lanes/rows sit close together", () => {
    // Tight geometry: half the lane gap (2.5) and half the row gap (5) are
    // both well under the default CORNER (14), so the clamp — not the
    // constant — determines the radius.
    const tightGeom = {
      laneX: (l: number) => l * 5,
      rowY: (r: number) => r * 10,
    };
    const e = edge({
      childLane: 0,
      parentLane: 1,
      childRow: 0,
      parentRow: 1,
      isFirstParent: true,
    });
    // x1=0,y1=0,x2=5,y2=10; r = min(14, 2.5, 5) = 2.5
    expect(edgePath(e, tightGeom)).toBe("M0 0 V7.5 Q0 10 2.5 10 H5");
  });

  it("honours a caller-supplied corner override smaller than the default", () => {
    const e = edge({
      childLane: 0,
      parentLane: 2,
      childRow: 0,
      parentRow: 2,
      isFirstParent: true,
    });
    // r = min(override=3, 10, 20) = 3
    expect(edgePath(e, { ...geom, corner: 3 })).toBe("M0 0 V37 Q0 40 3 40 H20");
  });

  it("exports the default corner radius used when no override is given", () => {
    expect(CORNER).toBe(14);
  });
});

describe("laneJunctions", () => {
  // A small synthetic layout: a base branch running straight down lane 1
  // (rows 0→1→2→3→4→5→6), with a fork away to the right at row 1, a fork
  // away to the left at row 2, a merge in from the right at row 3, and a
  // merge in from the left at row 5 — one instance of every 3-way role.
  const baseRuns: LaneEdge[] = [
    edge({ childLane: 1, parentLane: 1, childRow: 0, parentRow: 1 }),
    edge({ childLane: 1, parentLane: 1, childRow: 1, parentRow: 2 }),
    edge({ childLane: 1, parentLane: 1, childRow: 2, parentRow: 3 }),
    edge({ childLane: 1, parentLane: 1, childRow: 3, parentRow: 4 }),
    edge({ childLane: 1, parentLane: 1, childRow: 4, parentRow: 5 }),
    edge({ childLane: 1, parentLane: 1, childRow: 5, parentRow: 6 }),
  ];

  it("finds a fork point (a new branch's first-parent edge landing on a through-lane) — side = childLane vs. the through-lane", () => {
    // New branch tip at lane 2 (right of the base lane 1), first-parent edge
    // down into the base at (lane 1, row 1) — the base continues past row 1
    // via `baseRuns`, so this is a real fork, not a dead-end turn.
    const forkRight = edge({
      childLane: 2,
      parentLane: 1,
      childRow: 0,
      parentRow: 1,
      isFirstParent: true,
    });
    const junctions = laneJunctions([...baseRuns, forkRight], geom);
    expect(junctions).toContainEqual({
      lane: 1,
      row: 1,
      x: geom.laneX(1),
      y: geom.rowY(1),
      role: "forkRight",
    });
  });

  it("finds a fork point on the other side (new branch to the left) as forkLeft", () => {
    const forkLeft = edge({
      childLane: 0,
      parentLane: 1,
      childRow: 1,
      parentRow: 2,
      isFirstParent: true,
    });
    const junctions = laneJunctions([...baseRuns, forkLeft], geom);
    expect(junctions).toContainEqual({
      lane: 1,
      row: 2,
      x: geom.laneX(1),
      y: geom.rowY(2),
      role: "forkLeft",
    });
  });

  it("finds a merge point (a merge edge's OTHER parent joining a through-lane) — side = parentLane vs. the through-lane", () => {
    // The merge commit itself sits on the through-lane (lane 1, row 3); its
    // second parent lives on lane 2 (to the right) — a merge-in from the
    // right, so mergeRight.
    const mergeRight = edge({
      childLane: 1,
      parentLane: 2,
      childRow: 3,
      parentRow: 4,
      isFirstParent: false,
    });
    const junctions = laneJunctions([...baseRuns, mergeRight], geom);
    expect(junctions).toContainEqual({
      lane: 1,
      row: 3,
      x: geom.laneX(1),
      y: geom.rowY(3),
      role: "mergeRight",
    });
  });

  it("finds a merge point on the other side (second parent to the left) as mergeLeft", () => {
    const mergeLeft = edge({
      childLane: 1,
      parentLane: 0,
      childRow: 5,
      parentRow: 6,
      isFirstParent: false,
    });
    const junctions = laneJunctions([...baseRuns, mergeLeft], geom);
    expect(junctions).toContainEqual({
      lane: 1,
      row: 5,
      x: geom.laneX(1),
      y: geom.rowY(5),
      role: "mergeLeft",
    });
  });

  it("a straight edge (same lane both ends) never produces a junction", () => {
    expect(laneJunctions(baseRuns, geom)).toEqual([]);
  });

  it("an L-turn with no continuing through-lane is NOT a junction — it's just a dead-end turn", () => {
    // A lone first-parent turn onto an otherwise-empty lane 5: nothing else
    // touches (lane 5, row 1), so this is an ordinary corner, not a T.
    const lone = edge({
      childLane: 6,
      parentLane: 5,
      childRow: 0,
      parentRow: 1,
      isFirstParent: true,
    });
    expect(laneJunctions([lone], geom)).toEqual([]);
  });

  it("finds all four roles at once in the full synthetic layout, one per point", () => {
    const forkRight = edge({
      childLane: 2,
      parentLane: 1,
      childRow: 0,
      parentRow: 1,
      isFirstParent: true,
    });
    const forkLeft = edge({
      childLane: 0,
      parentLane: 1,
      childRow: 1,
      parentRow: 2,
      isFirstParent: true,
    });
    const mergeRight = edge({
      childLane: 1,
      parentLane: 2,
      childRow: 3,
      parentRow: 4,
      isFirstParent: false,
    });
    const mergeLeft = edge({
      childLane: 1,
      parentLane: 0,
      childRow: 5,
      parentRow: 6,
      isFirstParent: false,
    });
    const junctions = laneJunctions(
      [...baseRuns, forkRight, forkLeft, mergeRight, mergeLeft],
      geom,
    );
    const roles = junctions.map((j) => j.role).sort();
    expect(roles).toEqual(
      ["forkLeft", "forkRight", "mergeLeft", "mergeRight"].sort(),
    );
  });
});

/**
 * `GraphThemePack.geometry` resolution.
 *
 * The regression bar is the first test: a pack that declares no `geometry` has
 * to resolve to exactly the numbers the graph was hardcoded to, because
 * `default`/`blueprint`/`synthwave` all go through here.
 */
describe("resolveGraphGeometry", () => {
  function pack(geometry?: GraphThemePack["geometry"]): GraphThemePack {
    return { id: "geom-test", name: "Geom Test", geometry };
  }

  it("a pack with no geometry block resolves to the app defaults", () => {
    expect(resolveGraphGeometry(pack())).toEqual({
      rowH: ROW_H,
      laneW: LANE_W,
      spriteScale: 1,
      nodeR: NODE_R,
      railW: RAIL_W,
      corner: CORNER,
    });
  });

  it.each(["default", "blueprint", "synthwave"])(
    "%s declares no geometry and so is unaffected",
    (id) => {
      expect(resolveGraphThemePack(id).geometry).toBeUndefined();
      expect(resolveGraphGeometry(resolveGraphThemePack(id))).toEqual(
        resolveGraphGeometry(pack()),
      );
    },
  );

  it("spriteScale multiplies the node, rail and corner marks", () => {
    const g = resolveGraphGeometry(
      pack({ spriteScale: 2, rowH: 84, laneW: 60 }),
    );
    expect(g.spriteScale).toBe(2);
    expect(g.nodeR).toBe(NODE_R * 2);
    expect(g.railW).toBe(RAIL_W * 2);
    expect(g.corner).toBe(CORNER * 2);
  });

  it("rowH and laneW pass through independently of the sprite scale", () => {
    const g = resolveGraphGeometry(pack({ rowH: 84, laneW: 60 }));
    expect(g.rowH).toBe(84);
    expect(g.laneW).toBe(60);
    // Two separate knobs: a pitch alone never touches the sprites.
    expect(g.spriteScale).toBe(1);
    expect(g.nodeR).toBe(NODE_R);
  });

  it("clamps spriteScale to the pitch that has to hold the node", () => {
    // 2x on the DEFAULT pitch would make a 56px node in a 30px lane. The
    // ceiling is the smaller pitch over the node diameter: 30 / 24 = 1.25.
    expect(maxSpriteScale(ROW_H, LANE_W)).toBe(1.25);
    expect(resolveGraphGeometry(pack({ spriteScale: 2 })).spriteScale).toBe(
      1.25,
    );
    // Raising only the ROW pitch does not help: the lane is still the binding
    // constraint, which is why hero raises both.
    expect(
      resolveGraphGeometry(pack({ spriteScale: 2, rowH: 84 })).spriteScale,
    ).toBe(1.25);
  });

  it("clamps spriteScale up to the WCAG minimum hit target", () => {
    const g = resolveGraphGeometry(pack({ spriteScale: 0.01 }));
    expect(g.spriteScale).toBe(MIN_SPRITE_SCALE);
    // The floor exists so `hitR` (NODE_R * scale + 8) keeps a 24x24 target.
    expect(g.nodeR + 8).toBeGreaterThanOrEqual(12);
  });

  it("the floors are chosen so the clamp range is never empty", () => {
    expect(maxSpriteScale(MIN_ROW_H, MIN_LANE_W)).toBeGreaterThan(
      MIN_SPRITE_SCALE,
    );
    const g = resolveGraphGeometry(pack({ spriteScale: 5, rowH: 1, laneW: 1 }));
    expect(g.rowH).toBe(MIN_ROW_H);
    expect(g.laneW).toBe(MIN_LANE_W);
    expect(g.spriteScale).toBeGreaterThanOrEqual(MIN_SPRITE_SCALE);
    expect(g.spriteScale).toBeLessThanOrEqual(
      maxSpriteScale(MIN_ROW_H, MIN_LANE_W),
    );
  });

  it("clamps a pitch below its floor rather than dropping it", () => {
    // 20px cannot hold the 13px + 11px message stack at line-height 1.25.
    expect(resolveGraphGeometry(pack({ rowH: 20 })).rowH).toBe(MIN_ROW_H);
    // Below RAIL_W + 2 the casing rim has nothing left to separate.
    expect(resolveGraphGeometry(pack({ laneW: 3 })).laneW).toBe(MIN_LANE_W);
  });

  it.each([
    ["zero", 0],
    ["negative", -2],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("treats a %s value as absent, not as something to clamp", (_label, v) => {
    expect(
      resolveGraphGeometry(pack({ spriteScale: v, rowH: v, laneW: v })),
    ).toEqual(resolveGraphGeometry(pack()));
  });
});
