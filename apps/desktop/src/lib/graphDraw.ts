/**
 * Pixel drawing for a lane graph — pure, no DOM.
 *
 * `lanes.ts` decides WHERE things go: it reduces a commit DAG to lane/row
 * assignments and the parent-child `LaneEdge`s between them, as data with no
 * notion of pixels. This module decides HOW those edges are DRAWN: given a
 * caller-supplied lane→x and row→y mapping, it turns a `LaneEdge` into the
 * actual thick, rounded-corner rail path used wherever a lane graph is
 * rendered.
 *
 * It exists so more than one renderer can draw from the exact same rail
 * geometry instead of re-implementing it. `MetroGraph.svelte` (the real
 * graph) and `GraphThemePreview.svelte` (the personalize-settings preview)
 * both call `edgePath` — the preview only supplies a different (pane-scaled)
 * row/lane pitch, never a different drawing rule. That keeps the preview an
 * honest sample of what the real graph draws, rather than a hand-drawn
 * look-alike.
 */
import type { LaneEdge } from "./lanes";
import {
  junctionRole,
  type GraphThemePack,
  type JunctionRole,
} from "./graphTheme";

/** Default radius of the rounded turn in an edge's rail — mirrors
 *  MetroGraph's own metro/transit aesthetic constant. Callers with a
 *  tighter pitch (e.g. the settings preview) may override it per call via
 *  `geom.corner`. */
export const CORNER = 14;

/** Stroke width of a branch rail, in px. Kept here beside `CORNER` and
 *  `NODE_R` so the metro geometry a graph draws with is one set of numbers in
 *  one place; only `GraphRails.svelte` strokes with it today. */
export const RAIL_W = 7;
/** Radius of a commit node's circle, in px. Genuinely shared: `GraphRails`
 *  draws the circle, while `MetroGraph` sizes its own hit areas, merge handles
 *  and drag connectors against it. */
export const NODE_R = 12;
/** Default row pitch in px — the vertical distance between two commits.
 *  Overridable per theme via `GraphThemePack.geometry.rowH`; MetroGraph's
 *  `.row` CSS carries the same number as its `--graph-row-h` fallback. */
export const ROW_H = 56;
/** Default lane pitch in px — the horizontal distance between two branches.
 *  Overridable per theme via `GraphThemePack.geometry.laneW`. */
export const LANE_W = 30;

// --- Theme geometry (`GraphThemePack.geometry`) ------------------------------
//
// A theme declares the sprite scale and the row/lane pitch SEPARATELY rather
// than as one factor, because they are not the same kind of number: the sprite
// scale is the size of the art, the pitch is how far apart the art is placed,
// and pixel-art packs need to move the two independently (hero's `commit.png`
// is a 128px source that wants to be drawn big, while its row pitch only has
// to open up far enough for those sprites to clear each other). What couples
// them is a single inequality — a node mark must fit inside its pitch — and
// that is exactly what `maxSpriteScale` below expresses.

/** Floor on a theme's `rowH`. The row's message column stacks a 13px subject
 *  over an 11px author line at line-height 1.25, i.e. 30px — the same
 *  measurement MetroGraph's text-scale ceiling is derived from. A shorter row
 *  clips its own text no matter what the graph draws over it. */
export const MIN_ROW_H = 30;
/** Floor on a theme's `laneW`. A rail is `RAIL_W` wide inside a 1px-per-side
 *  casing rim (`RAIL_W + 2`), and that rim is the only thing keeping two
 *  same-coloured rails in adjacent lanes from fusing into one blob — below
 *  this pitch it has nothing left to separate. */
export const MIN_LANE_W = RAIL_W + 2;
/** Floor on `spriteScale`, and not an aesthetic one: a commit node's hit area
 *  is `NODE_R * spriteScale + 8` (MetroGraph's `hitR`) and WCAG 2.5.8 puts the
 *  minimum pointer target at 24×24 CSS px, i.e. a radius of 12. Solving
 *  `12 * s + 8 >= 12` gives `s >= 1/3`. */
export const MIN_SPRITE_SCALE = 1 / 3;

/**
 * Ceiling on `spriteScale` for a given pitch. A node mark is
 * `2 * NODE_R * spriteScale` across, so once that exceeds the SMALLER of the
 * two pitches the nodes of neighbouring rows (or lanes) touch. Expressed as a
 * relation between the two knobs rather than a fixed number, because that is
 * the only thing genuinely constraining them: at `spriteScale: 2` a node is
 * 56px, exactly the whole of the default 56px row pitch, which is precisely
 * why the `hero` pack raises `rowH`/`laneW` alongside its scale.
 *
 * Note the floors above are chosen so this range is never empty: the tightest
 * legal pitch is `MIN_LANE_W` (9), giving `9 / 24 = 0.375`, still above
 * `MIN_SPRITE_SCALE`.
 */
export function maxSpriteScale(rowH: number, laneW: number): number {
  return Math.min(rowH, laneW) / (2 * NODE_R);
}

/** The resolved, bounds-checked geometry a graph draws with. */
export interface GraphGeometry {
  /** Row pitch in px. */
  rowH: number;
  /** Lane pitch in px. */
  laneW: number;
  /** Multiplier on every drawn sprite size (1 = as authored). */
  spriteScale: number;
  /** `NODE_R * spriteScale` — the node mark AND the hit areas/handles it
   *  sizes. Scaled because a doubled sprite whose hit area stayed at the
   *  default radius would only be clickable near its middle. */
  nodeR: number;
  /** `RAIL_W * spriteScale` — a branch line is one of the marks the scale is
   *  about, and the stroked fallbacks have to keep the same weight as the
   *  tiled runs beside them, which scale as plain assets. */
  railW: number;
  /** `CORNER * spriteScale` — the turn radius decides where a run stops and
   *  the corner tile takes over, so it has to hold its proportion to that
   *  tile's (scaled) half-size: larger and a gap opens between run and tile,
   *  much smaller and the tile's own arc no longer meets the run it joins. */
  corner: number;
}

/**
 * A pitch/scale a theme may override.
 *
 * Policy is **clamp, not ignore** — the same choice `text.sizeScale` already
 * makes in this seam. A graph pack is data that can arrive over the network
 * from an author who cannot test against every pitch, and
 * dropping the whole declaration would throw away the look the user paid for;
 * clamping still renders the theme's intent, just at the nearest geometry the
 * fixed row/label columns can absorb.
 *
 * A non-finite or non-positive value is the one case that is NOT clamped: a
 * multiplier of `-2` or a pitch of `0` carries no recoverable intent, so it is
 * treated as absent and falls back to the app default — the same graceful
 * degradation `resolveGraphThemePack` gives a stale theme id.
 */
function bounded(
  value: number | undefined,
  min: number,
  fallback: number,
): number {
  if (value == null || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(min, value);
}

/**
 * Resolve `pack.geometry` into the numbers a renderer draws with.
 *
 * A pack that declares no `geometry` resolves to exactly the app defaults, so
 * `default`/`blueprint`/`synthwave` render unchanged.
 *
 * Resolution order matters and is deliberate: the two pitches are resolved
 * FIRST, against floors that depend only on the text/rail columns, and the
 * sprite scale is then clamped against the resolved pitch. The reverse order
 * would be circular (the pitch floor depends on the node size, which depends
 * on the scale), and this direction is also the less surprising one — a theme
 * that states a pitch stated it on purpose, so the sprites are fitted into the
 * pitch rather than the pitch being grown to fit the sprites.
 *
 * An ABSENT `spriteScale` is never clamped down by a tight pitch: leaving it
 * out means "don't touch the sprites", and silently shrinking them because of
 * a separate pitch choice would be a surprise, not a guard.
 */
export function resolveGraphGeometry(pack: GraphThemePack): GraphGeometry {
  const g = pack.geometry;
  const rowH = bounded(g?.rowH, MIN_ROW_H, ROW_H);
  const laneW = bounded(g?.laneW, MIN_LANE_W, LANE_W);
  const raw = g?.spriteScale;
  const spriteScale =
    raw == null || !Number.isFinite(raw) || raw <= 0
      ? 1
      : Math.min(maxSpriteScale(rowH, laneW), Math.max(MIN_SPRITE_SCALE, raw));
  return {
    rowH,
    laneW,
    spriteScale,
    nodeR: NODE_R * spriteScale,
    railW: RAIL_W * spriteScale,
    corner: CORNER * spriteScale,
  };
}

export interface EdgeGeomMapping {
  /** Lane index → x pixel. */
  laneX: (lane: number) => number;
  /** Row index → y pixel. */
  rowY: (row: number) => number;
  /** Corner radius override (defaults to `CORNER`). */
  corner?: number;
}

/** Thick orthogonal rail with one rounded corner: a straight vertical line
 *  when the edge stays within one lane, else an L-turn. The turn sits at the
 *  PARENT's row for a first-parent (mainline) edge, or at the CHILD's row
 *  for a merge (non-first-parent) edge — see `LaneEdge.isFirstParent` — so a
 *  mainline rail drops straight down before curving into its parent's lane,
 *  while a merge rail curves out of the child's lane immediately before
 *  dropping into the parent (the branch being merged in). */
export function edgePath(e: LaneEdge, geom: EdgeGeomMapping): string {
  const corner = geom.corner ?? CORNER;
  const x1 = geom.laneX(e.childLane);
  const y1 = geom.rowY(e.childRow);
  const x2 = geom.laneX(e.parentLane);
  const y2 = geom.rowY(e.parentRow);
  if (x1 === x2) return `M${x1} ${y1} L${x1} ${y2}`;
  const r = Math.min(corner, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2);
  const sx = x2 > x1 ? 1 : -1;
  if (e.isFirstParent) {
    return `M${x1} ${y1} V${y2 - r} Q${x1} ${y2} ${x1 + sx * r} ${y2} H${x2}`;
  }
  return `M${x1} ${y1} H${x2 - sx * r} Q${x2} ${y1} ${x2} ${y1 + r} V${y2}`;
}

// --- 3-way T-junctions -------------------------------------------------

/** A point where a through-lane (N+S) and a branching edge (fork away from,
 *  or merge into, that lane) meet — the theme role a 3-way tile draws there.
 */
export interface LaneJunction {
  lane: number;
  row: number;
  x: number;
  y: number;
  role: Extract<
    JunctionRole,
    "forkLeft" | "forkRight" | "mergeLeft" | "mergeRight"
  >;
}

/** Whether some OTHER edge touches `lane`/`row` at one of ITS OWN endpoints
 *  in that same lane — i.e. whether `lane` genuinely continues through this
 *  row (from above, below, or both), rather than this point being the dead
 *  end of a single L-shaped edge. */
function laneTouchesRow(
  edges: LaneEdge[],
  exclude: LaneEdge,
  lane: number,
  row: number,
): boolean {
  return edges.some(
    (f) =>
      f !== exclude &&
      ((f.childLane === lane && f.childRow === row) ||
        (f.parentLane === lane && f.parentRow === row)),
  );
}

/**
 * Find every 3-way T-junction in a lane layout: a point where a lane's
 * through-run (N+S) coexists with a branching edge attaching from the side.
 *
 * Both cases resolve to the SAME lane/row as one of the branching edge's own
 * endpoints — never a free-floating point — which is why a T-junction is
 * always exactly a commit node's position (see `edges`' doc comment on
 * `GraphThemePack` for what that means for a theme's tile visibility):
 *
 *  - **fork**: edge `e` is a first-parent edge whose child sits on a
 *    DIFFERENT lane than its parent (`e.childLane !== e.parentLane`).
 *    `edgeSegments` draws `e`'s elbow in the child's own lane column, but
 *    the elbow's horizontal leg lands exactly on the PARENT's node — so the
 *    junction sits at (`e.parentLane`, `e.parentRow`), and it is a real
 *    T only when that lane truly continues past the parent (checked via
 *    `laneTouchesRow`), i.e. the parent has its own further history in the
 *    same lane. The side is which way the forked-off branch's own lane sits
 *    relative to the through-lane.
 *  - **merge**: edge `e` is a NON-first-parent (merge) edge. Its elbow's
 *    horizontal leg starts exactly at the CHILD's node (the merge commit
 *    itself), so the junction sits at (`e.childLane`, `e.childRow`) — real
 *    only when the merge commit's own lane continues past it too. The side
 *    is which way the merged-in branch's lane sits relative to the
 *    through-lane.
 *
 * Two edges landing on the exact same (lane, row) with different senses
 * (e.g. an octopus merge whose extra parents branch off both sides) is not
 * modelled — the first match wins per point; there is only one tile slot per
 * node.
 */
export function laneJunctions(
  edges: LaneEdge[],
  mapping: EdgeGeomMapping,
): LaneJunction[] {
  const seen = new Map<string, LaneJunction>();
  for (const e of edges) {
    if (e.childLane === e.parentLane) continue; // straight edge, no elbow.

    const lane = e.isFirstParent ? e.parentLane : e.childLane;
    const row = e.isFirstParent ? e.parentRow : e.childRow;
    if (!laneTouchesRow(edges, e, lane, row)) continue;

    const otherLane = e.isFirstParent ? e.childLane : e.parentLane;
    const sense = e.isFirstParent ? "fork" : "merge";
    const dirSet = otherLane < lane ? "NSW" : "NSE";
    const role = junctionRole(dirSet, sense) as LaneJunction["role"];

    const key = `${lane},${row}`;
    if (!seen.has(key)) {
      seen.set(key, {
        lane,
        row,
        x: mapping.laneX(lane),
        y: mapping.rowY(row),
        role,
      });
    }
  }
  return [...seen.values()];
}
