/**
 * Pure geometry for the tutorial overlay: the even-odd spotlight path and
 * the coach-card placement. No DOM, no Svelte — everything here is unit-testable
 * with plain numbers. See `TutorialOverlay.svelte` for how it is driven.
 */

/** An axis-aligned rectangle in viewport (CSS px) coordinates. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

/** Round to 2 decimals so path strings are stable and short. */
function n(v: number): string {
  return String(Math.round(v * 100) / 100);
}

function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/** Clip `r` to the viewport; `null` when nothing of it is visible. */
function clip(r: Rect, viewport: Size): Rect | null {
  const x = Math.max(0, r.x);
  const y = Math.max(0, r.y);
  const right = Math.min(viewport.w, r.x + r.w);
  const bottom = Math.min(viewport.h, r.y + r.h);
  if (right <= x || bottom <= y) return null;
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * Turn raw target rects into the holes actually cut into the overlay:
 * padded by `pad`, clipped to the viewport (an off-screen target yields no
 * hole), then merged wherever two holes overlap.
 *
 * The merge is load-bearing: the spotlight is ONE `evenodd` path, so a region
 * covered by two overlapping hole sub-paths would count twice and come out
 * *filled* — i.e. dimmed and input-blocked — right where the user must click
 * (think a commit row inside the graph surface, both listed as targets). A
 * contained hole is dropped; partially overlapping holes become their bounding
 * box. The first rect's position in the list is preserved (the coach card
 * anchors on `holes[0]`).
 */
export function prepareHoles(
  rects: readonly Rect[],
  viewport: Size,
  pad: number,
): Rect[] {
  const holes: Rect[] = [];
  for (const r of rects) {
    const c = clip(
      { x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad },
      viewport,
    );
    if (c) holes.push(c);
  }
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < holes.length; i++) {
      for (let j = i + 1; j < holes.length; j++) {
        if (contains(holes[i], holes[j])) {
          holes.splice(j, 1);
        } else if (contains(holes[j], holes[i])) {
          holes[i] = holes[j];
          holes.splice(j, 1);
        } else if (intersects(holes[i], holes[j])) {
          holes[i] = union(holes[i], holes[j]);
          holes.splice(j, 1);
        } else {
          continue;
        }
        merged = true;
        break outer;
      }
    }
  }
  return holes;
}

/** One closed rounded-rectangle sub-path (corner radius clamped to fit). */
export function roundedRectPath(r: Rect, radius: number): string {
  const rad = Math.max(0, Math.min(radius, r.w / 2, r.h / 2));
  const { x, y, w, h } = r;
  const arc = `A${n(rad)} ${n(rad)} 0 0 1`;
  return (
    `M${n(x + rad)} ${n(y)}` +
    `H${n(x + w - rad)}${arc} ${n(x + w)} ${n(y + rad)}` +
    `V${n(y + h - rad)}${arc} ${n(x + w - rad)} ${n(y + h)}` +
    `H${n(x + rad)}${arc} ${n(x)} ${n(y + h - rad)}` +
    `V${n(y + rad)}${arc} ${n(x + rad)} ${n(y)}Z`
  );
}

/**
 * The spotlight path: the full-viewport rectangle plus one rounded-rect
 * sub-path per hole. Filled with `fill-rule="evenodd"`, every hole is punched
 * out of the dim layer and, with `pointer-events: fill` on the path, passes
 * input through to the page beneath (verified in the plan's spike).
 */
export function holePath(
  rects: readonly Rect[],
  viewport: Size,
  pad: number,
  radius: number,
): string {
  const outer = `M0 0H${n(viewport.w)}V${n(viewport.h)}H0Z`;
  return (
    outer +
    prepareHoles(rects, viewport, pad)
      .map((h) => roundedRectPath(h, radius))
      .join("")
  );
}

/** The hole outlines alone (for the non-interactive highlight ring). */
export function ringPath(
  rects: readonly Rect[],
  viewport: Size,
  pad: number,
  radius: number,
): string {
  return prepareHoles(rects, viewport, pad)
    .map((h) => roundedRectPath(h, radius))
    .join("");
}

export type CardSide = "right" | "left" | "below" | "above" | "center";

export interface CardPlacement {
  /** Top-left corner of the card, in viewport px. */
  left: number;
  top: number;
  side: CardSide;
  /** True only when no position clear of every hole fit in the viewport. */
  overlaps: boolean;
}

export interface PlaceOptions {
  /** Space between the hole and the card. Default 14. */
  gap?: number;
  /** Minimum distance kept from the viewport edge. Default 12. */
  margin?: number;
  /**
   * The individual (padded, UNMERGED) target rects. Merging drops a target
   * that sits inside a bigger one (the Settings OK button inside the Settings
   * modal), so when the card has to overlap something, the least-bad spot is
   * scored by how much of EACH target it covers (fraction of its area) rather
   * than by raw area — covering a sliver of a big panel beats covering a
   * whole button. Absent ⇒ the holes themselves are scored that way.
   */
  targets?: readonly Rect[];
  /**
   * Things the card must not hide even though they sit inside a hole: the
   * step's small targets and the chips / nodes / crown inside a graph-sized
   * hole. Only consulted when no spot clears every hole (a hole as big as the
   * graph): the card then docks where it covers the smallest share of these
   * — a bottom corner over empty graph space when there is one — instead of
   * sitting on the first rows' branch chips.
   */
  avoid?: readonly Rect[];
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(v, Math.max(lo, hi)));

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Where the coach card goes. With no hole it is centred. Otherwise it sits
 * beside the FIRST hole — preferring right, then left, below, above — aligned
 * to the hole along the other axis and clamped into the viewport. A side is
 * only taken if the card fits there AND clears every hole (so the card never
 * covers something the user has to touch). If no side works it falls back to a
 * viewport corner that clears all holes, and as a last resort to the spot with
 * the least overlap (`overlaps: true`).
 *
 * `holes` are the already-padded holes from {@link prepareHoles}.
 */
export function placeCard(
  holes: readonly Rect[],
  card: Size,
  viewport: Size,
  opts: PlaceOptions = {},
): CardPlacement {
  const gap = opts.gap ?? 14;
  const margin = opts.margin ?? 12;
  const maxX = viewport.w - card.w - margin;
  const maxY = viewport.h - card.h - margin;

  if (holes.length === 0) {
    return {
      left: clamp((viewport.w - card.w) / 2, margin, maxX),
      top: clamp((viewport.h - card.h) / 2, margin, maxY),
      side: "center",
      overlaps: false,
    };
  }

  const anchor = holes[0];
  const at = (left: number, top: number): Rect => ({
    x: left,
    y: top,
    w: card.w,
    h: card.h,
  });
  const clear = (r: Rect) => holes.every((h) => !intersects(r, h));
  const inside = (r: Rect) =>
    r.x >= margin - 0.5 &&
    r.y >= margin - 0.5 &&
    r.x + r.w <= viewport.w - margin + 0.5 &&
    r.y + r.h <= viewport.h - margin + 0.5;

  const candidates: { side: CardSide; left: number; top: number }[] = [
    {
      side: "right",
      left: anchor.x + anchor.w + gap,
      top: clamp(anchor.y, margin, maxY),
    },
    {
      side: "left",
      left: anchor.x - gap - card.w,
      top: clamp(anchor.y, margin, maxY),
    },
    {
      side: "below",
      left: clamp(anchor.x + anchor.w / 2 - card.w / 2, margin, maxX),
      top: anchor.y + anchor.h + gap,
    },
    {
      side: "above",
      left: clamp(anchor.x + anchor.w / 2 - card.w / 2, margin, maxX),
      top: anchor.y - gap - card.h,
    },
  ];
  for (const c of candidates) {
    const r = at(c.left, c.top);
    if (inside(r) && clear(r)) return { ...c, overlaps: false };
  }

  // Fallback 1: a viewport corner clear of every hole.
  const corners: { side: CardSide; left: number; top: number }[] = [
    { side: "right", left: maxX, top: maxY },
    { side: "left", left: margin, top: maxY },
    { side: "right", left: maxX, top: margin },
    { side: "left", left: margin, top: margin },
  ];
  for (const c of corners) {
    if (clear(at(c.left, c.top))) return { ...c, overlaps: false };
  }

  // Fallback 2: the least-bad spot. Docking spots (bottom first: a graph's
  // newest rows and their chips are at the top) join the candidates, and
  // `avoid` — what must stay readable inside a big hole — is scored first.
  const avoid = opts.avoid ?? [];
  const docks: { side: CardSide; left: number; top: number }[] = avoid.length
    ? [
        { side: "right", left: maxX, top: maxY },
        { side: "below", left: (viewport.w - card.w) / 2, top: maxY },
        { side: "left", left: margin, top: maxY },
        { side: "right", left: maxX, top: margin },
        { side: "left", left: margin, top: margin },
      ]
    : [];
  // (the least-bad spot — the smallest share of the targets it
  // covers (each target counts by the FRACTION of it covered, so a whole
  // small button outweighs a sliver of a large panel), raw overlap area
  // breaking ties.
  const scored = opts.targets?.length ? opts.targets : holes;
  const fraction = (r: Rect) =>
    scored.reduce((s, h) => s + overlapArea(r, h) / Math.max(1, h.w * h.h), 0);
  const hidden = (r: Rect) =>
    avoid.reduce((s, h) => s + overlapArea(r, h) / Math.max(1, h.w * h.h), 0);
  let best = corners[0];
  let bestHidden = Infinity;
  let bestScore = Infinity;
  let bestArea = Infinity;
  for (const c of [...docks, ...candidates, ...corners]) {
    const r = at(clamp(c.left, margin, maxX), clamp(c.top, margin, maxY));
    const hid = hidden(r);
    const score = fraction(r);
    const area = holes.reduce((s, h) => s + overlapArea(r, h), 0);
    const eps = 1e-9;
    if (
      hid < bestHidden - eps ||
      // With an avoid list, equal spots keep their order (docks first).
      (avoid.length === 0 &&
        Math.abs(hid - bestHidden) <= eps &&
        (score < bestScore - eps ||
          (Math.abs(score - bestScore) <= eps && area < bestArea)))
    ) {
      bestHidden = hid;
      bestScore = score;
      bestArea = area;
      best = { ...c, left: r.x, top: r.y };
    }
  }
  return { ...best, overlaps: true };
}

// ── keeping targets on screen ───────────────────────────────────────────────

/** The part of one axis a scroll needs: `[start, end)` in viewport px. */
interface Span {
  a: number;
  b: number;
}

/**
 * How far to scroll ONE axis so the targets' spans show inside `view`.
 * Targets come in priority order (the step's first target first — the drag
 * source). The first is always kept; each later one joins only while the
 * union still fits, so a source and its drop target are shown together when
 * the view is big enough, and the source alone otherwise. `margin` keeps a
 * little air around the union (shrunk when the union barely fits). Positive
 * means "scroll forward" (content moves up / left).
 */
function axisDelta(spans: Span[], view: Span, margin: number): number {
  if (spans.length === 0) return 0;
  const size = view.b - view.a;
  let u = { ...spans[0] };
  for (const s of spans.slice(1)) {
    const c = { a: Math.min(u.a, s.a), b: Math.max(u.b, s.b) };
    if (c.b - c.a <= size) u = c;
  }
  const len = u.b - u.a;
  if (len > size) {
    // Even the source alone overflows: show its start.
    return u.a >= view.a && u.a <= view.a + size / 2 ? 0 : u.a - view.a;
  }
  const m = Math.min(margin, (size - len) / 2);
  if (u.a < view.a + m) return u.a - (view.a + m);
  if (u.b > view.b - m) return u.b - (view.b - m);
  return 0;
}

/**
 * The scroll (dx, dy) that brings `targets` (viewport rects, priority order)
 * into `view` — the visible box of the container that scrolls them. Each axis
 * is solved on its own: a commit row spans the graph's full width, which must
 * not stop a branch chip beside it from being brought in vertically.
 */
export function revealDelta(
  targets: Rect[],
  view: Rect,
  margin = 12,
): { dx: number; dy: number } {
  return {
    dx: axisDelta(
      targets.map((r) => ({ a: r.x, b: r.x + r.w })),
      { a: view.x, b: view.x + view.w },
      margin,
    ),
    dy: axisDelta(
      targets.map((r) => ({ a: r.y, b: r.y + r.h })),
      { a: view.y, b: view.y + view.h },
      margin,
    ),
  };
}
