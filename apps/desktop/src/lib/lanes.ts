/**
 * Lane assignment for a commit DAG — pure data, no DOM.
 *
 * Single newest-to-oldest pass (the approach `git log --graph` uses):
 *
 *   active[i] = the sha lane i is waiting for, or null when free
 *
 *   for each commit C (newest first):
 *     expecting = lanes already waiting for C (its children)
 *     myLane = expecting[0] if any (others merge away), else a fresh lane
 *     first parent continues myLane; extra parents fork new lanes
 *
 * The renderer reads this layout and decides how to draw it, which keeps the
 * algorithm independently unit-testable.
 */
import type { Commit } from "./ipc";

export interface LaneAssignment {
  /** 0-based column index. */
  lane: number;
  /** Stable colour slot, fixed when the lane was first opened. */
  colorIndex: number;
}

export interface LaneEdge {
  childSha: string;
  parentSha: string;
  childRow: number;
  parentRow: number;
  childLane: number;
  parentLane: number;
  /** True iff this is the child's first parent (mainline edge). */
  isFirstParent: boolean;
  colorIndex: number;
}

export interface GraphLayout {
  assignments: Map<string, LaneAssignment>;
  edges: LaneEdge[];
  /** Highest lane index used. */
  maxLane: number;
}

export function assignLanes(
  commits: Commit[],
  headSha?: string | null,
): GraphLayout {
  const assignments = new Map<string, LaneAssignment>();
  const active: (string | null)[] = [];
  const laneColor: number[] = [];
  let nextColor = 0;

  function takeLane(): number {
    const free = active.indexOf(null);
    if (free !== -1) return free;
    active.push(null);
    laneColor.push(nextColor++);
    return active.length - 1;
  }

  for (const c of commits) {
    const expecting: number[] = [];
    for (let j = 0; j < active.length; j++) {
      if (active[j] === c.sha) expecting.push(j);
    }

    let myLane: number;
    if (expecting.length > 0) {
      myLane = expecting[0];
      for (let k = 1; k < expecting.length; k++) active[expecting[k]] = null;
    } else {
      myLane = takeLane();
    }

    assignments.set(c.sha, { lane: myLane, colorIndex: laneColor[myLane] });

    if (c.parents.length === 0) {
      active[myLane] = null;
    } else {
      active[myLane] = c.parents[0];
      for (let k = 1; k < c.parents.length; k++) {
        active[takeLane()] = c.parents[k];
      }
    }
  }

  const rowBySha = new Map<string, number>();
  commits.forEach((c, i) => rowBySha.set(c.sha, i));

  const edges: LaneEdge[] = [];
  for (let i = 0; i < commits.length; i++) {
    const c = commits[i];
    const ca = assignments.get(c.sha);
    if (!ca) continue;
    for (let pi = 0; pi < c.parents.length; pi++) {
      const parentSha = c.parents[pi];
      const parentRow = rowBySha.get(parentSha);
      const parentAssign = assignments.get(parentSha);
      if (parentRow === undefined || !parentAssign) continue;
      edges.push({
        childSha: c.sha,
        parentSha,
        childRow: i,
        parentRow,
        childLane: ca.lane,
        parentLane: parentAssign.lane,
        isFirstParent: pi === 0,
        // Mainline keeps the child's colour; merge edges adopt the parent's.
        colorIndex: pi === 0 ? ca.colorIndex : parentAssign.colorIndex,
      });
    }
  }

  let maxLane = 0;
  for (const a of assignments.values()) if (a.lane > maxLane) maxLane = a.lane;

  // The HEAD branch always renders in the rightmost lane (lane 0 — see
  // laneX() in MetroGraph, which decreases with lane index). Re-number lanes
  // so HEAD's lane becomes 0, inserting it at the front and shifting the
  // lanes that used to sit to its right (lower indices) up by one; lanes
  // that were already to its left (higher indices) keep their number, so
  // every other lane's relative order is preserved.
  if (headSha != null) {
    const headLane = assignments.get(headSha)?.lane;
    if (headLane != null && headLane !== 0) {
      const order: number[] = [headLane];
      for (let l = 0; l <= maxLane; l++) if (l !== headLane) order.push(l);
      const remap = new Map<number, number>();
      order.forEach((oldLane, newLane) => remap.set(oldLane, newLane));

      for (const a of assignments.values())
        a.lane = remap.get(a.lane) ?? a.lane;
      for (const e of edges) {
        e.childLane = remap.get(e.childLane) ?? e.childLane;
        e.parentLane = remap.get(e.parentLane) ?? e.parentLane;
      }
    }
  }

  return { assignments, edges, maxLane };
}

/** Number of distinct lane colours in the theme palette (--lane-0..7). */
export const LANE_COLORS = 8;

/** Resolved hex of each lane slot (mirrors app.css `--lane-0..7`). Used where a
 * concrete colour is needed (e.g. seeding the branch ColorPicker). */
export const LANE_HEX = [
  "#27ae60",
  "#ec4f9c",
  "#c46a1b",
  "#7c6cf0",
  "#3a86ff",
  "#f2b134",
  "#16a3a3",
  "#e0533d",
] as const;

/** CSS custom-property name for a colour slot. */
export function laneColorVar(colorIndex: number): string {
  return `var(--lane-${colorIndex % LANE_COLORS})`;
}
