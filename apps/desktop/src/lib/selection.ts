/**
 * Commit-selection model (shared with US4 diff multi-select).
 *
 * Pure reducers over a selection `Set<string>` of commit shas plus an `anchor`
 * for Shift-range extension. Kept side-effect-free so the click/keyboard
 * grammar is unit-testable independently of the SVG graph. `order` is the
 * commits in their on-screen order (newest-first), used to resolve ranges.
 */

export interface Selection {
  /** Selected commit shas. */
  shas: Set<string>;
  /** The pivot for Shift-range extension (last single click/toggle). */
  anchor: string | null;
}

export interface ClickMods {
  shift: boolean;
  meta: boolean;
  ctrl: boolean;
}

export function emptySelection(): Selection {
  return { shas: new Set(), anchor: null };
}

export function single(sha: string): Selection {
  return { shas: new Set([sha]), anchor: sha };
}

function rangeBetween(order: string[], a: string, b: string): string[] {
  const i = order.indexOf(a);
  const j = order.indexOf(b);
  if (i < 0 || j < 0) return [b];
  const [lo, hi] = i <= j ? [i, j] : [j, i];
  return order.slice(lo, hi + 1);
}

/**
 * Apply a click on `sha` with modifiers, returning the next selection.
 * - plain          → select only `sha` (anchor = sha)
 * - ⌘/Ctrl-click   → toggle `sha` in/out of the set (anchor = sha)
 * - Shift-click    → select the range anchor..sha (anchor unchanged)
 */
export function applyClick(
  prev: Selection,
  sha: string,
  order: string[],
  mods: ClickMods,
): Selection {
  if (mods.shift && prev.anchor) {
    return {
      shas: new Set(rangeBetween(order, prev.anchor, sha)),
      anchor: prev.anchor,
    };
  }
  if (mods.meta || mods.ctrl) {
    const shas = new Set(prev.shas);
    if (shas.has(sha)) shas.delete(sha);
    else shas.add(sha);
    return { shas, anchor: sha };
  }
  return single(sha);
}

/**
 * Apply a rubber-band (marquee) sweep enclosing `range` (swept shas in screen
 * order), returning the next selection. `prev` should be the selection snapshot
 * from the sweep's *start* so a live drag stays reversible as the box grows and
 * shrinks:
 * - plain          → replace the selection with the swept range
 * - Shift          → add the swept range to the base selection
 * - ⌘/Ctrl         → toggle each swept sha in/out of the base selection
 */
export function applyMarquee(
  prev: Selection,
  range: string[],
  mods: ClickMods,
): Selection {
  if (range.length === 0) return prev;
  if (mods.meta || mods.ctrl) {
    const shas = new Set(prev.shas);
    for (const s of range) {
      if (shas.has(s)) shas.delete(s);
      else shas.add(s);
    }
    return { shas, anchor: range[range.length - 1] };
  }
  if (mods.shift) {
    const shas = new Set(prev.shas);
    for (const s of range) shas.add(s);
    return { shas, anchor: prev.anchor ?? range[range.length - 1] };
  }
  return { shas: new Set(range), anchor: range[range.length - 1] };
}

/** Minimal commit shape for ancestry walks (the `Commit` DTO satisfies it). */
export interface CommitNode {
  sha: string;
  parents: string[];
}

/**
 * Every commit reachable from `tip` (its full ancestry) within `commits` —
 * i.e. all the commits on a branch. Walks `parents`; ignores shas not present
 * in the loaded set (e.g. beyond the history limit). Returns an empty set when
 * `tip` itself isn't loaded.
 */
export function ancestry(tip: string, commits: CommitNode[]): Set<string> {
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  const out = new Set<string>();
  const stack = [tip];
  while (stack.length) {
    const sha = stack.pop()!;
    if (out.has(sha) || !bySha.has(sha)) continue;
    out.add(sha);
    for (const p of bySha.get(sha)!.parents) stack.push(p);
  }
  return out;
}

/**
 * First-parent (HEAD^1) walk from `tip`, collecting shas until `stop` returns
 * true for a commit (that commit is excluded) or the chain leaves the loaded
 * set. Follows only `parents[0]` at each step, so merged-in side branches are
 * not included.
 */
export function firstParentSegment(
  tip: string,
  commits: CommitNode[],
  stop: (sha: string) => boolean,
): string[] {
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  const out: string[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = tip;
  while (cur && bySha.has(cur) && !seen.has(cur) && !stop(cur)) {
    seen.add(cur);
    out.push(cur);
    cur = bySha.get(cur)!.parents[0];
  }
  return out;
}

/**
 * When the selected commits form a contiguous first-parent range on one
 * branch, returns their shas **oldest-first** (ready for a squash op).
 * Otherwise returns `null`.
 *
 * Requires: at least 2 selected shas; every selected sha is loaded in
 * `commits` and has exactly one parent (excludes merge commits and the
 * root, neither of which can be squashed this way); and walking
 * first-parent from the newest selected commit passes through exactly the
 * selected set with no gaps before reaching the oldest.
 *
 * "Newest" is taken as the first selected sha encountered in `commits`,
 * which is rendered newest-first.
 */
export function contiguousRange(
  sel: Selection,
  commits: CommitNode[],
): string[] | null {
  if (sel.shas.size < 2) return null;
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  for (const sha of sel.shas) {
    const node = bySha.get(sha);
    if (!node || node.parents.length !== 1) return null;
  }
  const newest = commits.find((c) => sel.shas.has(c.sha));
  if (!newest) return null;

  const chain: string[] = [];
  let cur: string | undefined = newest.sha;
  while (cur && sel.shas.has(cur) && !chain.includes(cur)) {
    chain.push(cur);
    cur = bySha.get(cur)!.parents[0];
  }
  if (chain.length !== sel.shas.size) return null;
  return chain.reverse();
}

/** Number of loaded children per commit (across all parent edges). */
function childCounts(commits: CommitNode[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of commits)
    for (const p of c.parents) m.set(p, (m.get(p) ?? 0) + 1);
  return m;
}

/**
 * The commits of the branch tipped by `tip`, selected along first-parent down
 * to (but excluding) the **fork parent** — i.e. the commits unique to the branch
 * relative to `headTarget` (the checked-out line): `headTarget..tip` restricted
 * to first-parent. This stops at `merge-base(tip, HEAD)` rather than walking the
 * whole shared history.
 *
 * Fallback (branch already contained in HEAD — the current branch, or a merged
 * one, or when there is no HEAD): walk first-parent to the previous fork/merge
 * point (a commit with ≥2 loaded children).
 */
export function branchSegment(
  tip: string,
  commits: CommitNode[],
  headTarget: string | null,
): string[] {
  if (headTarget && headTarget !== tip) {
    const base = ancestry(headTarget, commits);
    const seg = firstParentSegment(tip, commits, (s) => base.has(s));
    if (seg.length > 0) return seg;
  }
  const kids = childCounts(commits);
  return firstParentSegment(
    tip,
    commits,
    (s) => s !== tip && (kids.get(s) ?? 0) >= 2,
  );
}

export function isSelected(sel: Selection, sha: string): boolean {
  return sel.shas.has(sha);
}

/** Selected shas in on-screen `order`. */
export function selectedInOrder(sel: Selection, order: string[]): string[] {
  return order.filter((s) => sel.shas.has(s));
}
