/**
 * Edge auto-scroll for drag gestures: while a drag is in flight and the
 * pointer sits near an edge of the scroll container, the container scrolls in
 * that direction so off-screen commits, branch chips and nodes become
 * reachable without letting go.
 *
 * Why this is a self-driven loop rather than "scroll a step per dragover":
 * `dragover` (and `pointermove`) only fire while the pointer MOVES. A user who
 * pushes into the edge zone and then holds still — which is exactly what you do
 * when you want the view to keep travelling — stops generating events, so an
 * event-driven implementation stalls after one step. The loop below is
 * therefore driven by `requestAnimationFrame` from the LAST KNOWN pointer
 * position: events only update that position and arm/disarm the loop.
 *
 * Scroll deltas are always applied RELATIVELY (`scrollLeft += step`) and never
 * toward a remembered absolute target, so a user who wheels/trackpad-scrolls
 * mid-drag is not fought: their scroll lands, and the next frame continues from
 * wherever they left the view.
 *
 * A leaked rAF loop would keep scrolling the graph after the drag is over, so
 * every stop path funnels through the single `stop()` below: pointer out of the
 * zone or out of the container (computed per frame, not trusted from
 * `dragleave`'s unreliable `relatedTarget`), nothing left to scroll on either
 * axis, the window-level `drop`/`dragend` that ends every HTML5 drag session
 * (including an Escape cancel), the caller's own gesture teardown, and
 * component unmount.
 */

/** Depth of the edge-sensitive band, in px. 64px is a shade over one graph row
 *  (56px): comfortably hittable mid-drag without turning a meaningful slice of
 *  the graph into a region you cannot hover a drop target in. Narrowed on a
 *  small viewport (see `zoneFor`) so the two opposing bands can never meet. */
export const EDGE_ZONE_PX = 64;

/** Speed at the very edge of the container, px/sec. 1200px/s crosses a
 *  1000px-tall viewport in under a second — fast enough to reach a distant
 *  branch tip, slow enough to stop on the row you wanted. */
export const MAX_SPEED_PX_S = 1200;

/** Constant speed used under `prefers-reduced-motion: reduce`. See
 *  `reducedMotion` in the options: the scroll is NOT disabled there (that
 *  would make off-screen drop targets unreachable, the opposite of an
 *  accessibility win) — it is slowed to a steady, non-accelerating crawl. */
export const REDUCED_SPEED_PX_S = 400;

/** Upper bound on the per-frame timestep. Without it, a frame delayed by a
 *  background tab or a long layout would translate its whole wall-clock gap
 *  into one huge jump. */
export const MAX_FRAME_MS = 50;

/** The parts of a scroll container this loop touches. `HTMLElement` satisfies
 *  it structurally; tests pass a plain object with no layout engine needed. */
export interface ScrollSurface {
  scrollLeft: number;
  scrollTop: number;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  getBoundingClientRect(): {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
}

/** Effective zone depth for an axis of `size` px. Capped at a quarter of the
 *  axis so the near and far bands stay disjoint (they would otherwise overlap
 *  below 128px and make the midpoint scroll both ways). */
export function zoneFor(size: number): number {
  return Math.max(0, Math.min(EDGE_ZONE_PX, size / 4));
}

/**
 * Signed velocity (px/sec) for one axis: negative toward the start edge,
 * positive toward the end edge, 0 when the pointer is outside both bands.
 *
 * `near`/`far` are the pointer's distances to the two edges. The magnitude
 * ramps QUADRATICALLY with how deep into the band the pointer is — ~0 at the
 * boundary (so brushing the band does not yank the view), full speed only when
 * pinned against the edge. A linear ramp makes the shallow end feel like a
 * constant drift; a quadratic one keeps a wide, controllable slow region and
 * puts the fast region where the user is unambiguously asking for it.
 */
export function axisVelocity(
  near: number,
  far: number,
  size: number,
  reduced: boolean,
): number {
  const zone = zoneFor(size);
  if (zone <= 0) return 0;
  let dir = 0;
  let depth = 0;
  if (near < zone) {
    dir = -1;
    depth = (zone - Math.max(near, 0)) / zone;
  } else if (far < zone) {
    dir = 1;
    depth = (zone - Math.max(far, 0)) / zone;
  }
  if (dir === 0) return 0;
  const ramp = Math.min(depth, 1);
  return dir * (reduced ? REDUCED_SPEED_PX_S : MAX_SPEED_PX_S * ramp * ramp);
}

export interface EdgeAutoScrollOptions {
  /** Called after each frame that actually moved the view, with the pointer
   *  position the loop is running from. The content has scrolled under a
   *  stationary pointer, so anything the caller derived from that pointer
   *  (content-local coordinates, hit-tested drop targets, a tooltip position)
   *  is now stale and must be recomputed. */
  onStep?: (clientX: number, clientY: number) => void;
  /** Injectable for tests; defaults to the globals. */
  raf?: (cb: (t: number) => void) => number;
  cancel?: (handle: number) => void;
  /** Read once per loop start. Defaults to the media query. */
  reducedMotion?: () => boolean;
}

export interface EdgeAutoScroll {
  /** Feed a live drag position. Arms the loop when the pointer is in an edge
   *  band with somewhere to scroll, and stops it otherwise — including when
   *  the point falls outside `el` entirely, or `el` is null. */
  update(el: ScrollSurface | null, clientX: number, clientY: number): void;
  /** Idempotent teardown. Safe to call from several exit paths at once. */
  stop(): void;
  readonly running: boolean;
}

export function createEdgeAutoScroll(
  opts: EdgeAutoScrollOptions = {},
): EdgeAutoScroll {
  const raf = opts.raf ?? ((cb) => globalThis.requestAnimationFrame(cb));
  const cancel = opts.cancel ?? ((h) => globalThis.cancelAnimationFrame(h));
  const isReduced =
    opts.reducedMotion ??
    (() =>
      globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ??
      false);

  let surface: ScrollSurface | null = null;
  let px = 0;
  let py = 0;
  let handle: number | null = null;
  // Timestamp of the previous frame, NaN before the first. The frame clock is
  // rAF's own timebase, which is NOT `Date.now()`'s epoch — rather than assume
  // a shared origin, the first frame just establishes the baseline and moves
  // nothing (one 16ms frame, imperceptible, and immune to that mismatch).
  let lastT = Number.NaN;
  let reduced = false;
  // Sub-pixel carry, so a slow ramp still moves instead of truncating to 0
  // every frame. Reset with the loop.
  let carryX = 0;
  let carryY = 0;

  /** Current velocities, with axes that have nothing left to scroll zeroed —
   *  a container already at its limit must not report motion it cannot make
   *  (that is what lets a pointer parked at an exhausted edge stop the loop). */
  function velocities(el: ScrollSurface): { vx: number; vy: number } {
    const r = el.getBoundingClientRect();
    let vx = axisVelocity(px - r.left, r.right - px, r.right - r.left, reduced);
    let vy = axisVelocity(py - r.top, r.bottom - py, r.bottom - r.top, reduced);
    const maxX = el.scrollWidth - el.clientWidth;
    const maxY = el.scrollHeight - el.clientHeight;
    if ((vx < 0 && el.scrollLeft <= 0) || (vx > 0 && el.scrollLeft >= maxX))
      vx = 0;
    if ((vy < 0 && el.scrollTop <= 0) || (vy > 0 && el.scrollTop >= maxY))
      vy = 0;
    return { vx, vy };
  }

  function inside(el: ScrollSurface): boolean {
    const r = el.getBoundingClientRect();
    return px >= r.left && px <= r.right && py >= r.top && py <= r.bottom;
  }

  function stop() {
    if (handle !== null) cancel(handle);
    handle = null;
    surface = null;
    carryX = 0;
    carryY = 0;
    detach();
  }

  /** `drop`/`dragend` reach the window for every HTML5 drag session, Escape
   *  cancels included. Belt-and-braces alongside the caller's own teardown:
   *  a drag whose source node is re-rendered away mid-flight can lose its own
   *  `dragend`, and a loop that outlives its drag is the worst outcome here. */
  const endListener = () => stop();
  let attached = false;
  function attach() {
    if (attached || typeof globalThis.addEventListener !== "function") return;
    attached = true;
    globalThis.addEventListener("drop", endListener, true);
    globalThis.addEventListener("dragend", endListener, true);
  }
  function detach() {
    if (!attached) return;
    attached = false;
    globalThis.removeEventListener("drop", endListener, true);
    globalThis.removeEventListener("dragend", endListener, true);
  }

  function frame(t: number) {
    handle = null;
    const el = surface;
    if (!el) return;
    const dt = Number.isFinite(lastT)
      ? Math.min(Math.max(t - lastT, 0), MAX_FRAME_MS) / 1000
      : 0;
    lastT = t;
    if (!inside(el)) return stop();
    const { vx, vy } = velocities(el);
    if (vx === 0 && vy === 0) return stop();
    carryX += vx * dt;
    carryY += vy * dt;
    const stepX = Math.trunc(carryX);
    const stepY = Math.trunc(carryY);
    carryX -= stepX;
    carryY -= stepY;
    if (stepX !== 0) el.scrollLeft += stepX;
    if (stepY !== 0) el.scrollTop += stepY;
    if (stepX !== 0 || stepY !== 0) opts.onStep?.(px, py);
    handle = raf(frame);
  }

  return {
    update(el, clientX, clientY) {
      if (!el) return stop();
      px = clientX;
      py = clientY;
      const wasRunning = handle !== null;
      // Read the preference at arm time, not per frame: one matchMedia call
      // per gesture instead of one per frame.
      if (!wasRunning) reduced = isReduced();
      if (!inside(el)) return stop();
      const { vx, vy } = velocities(el);
      if (vx === 0 && vy === 0) return stop();
      surface = el;
      if (wasRunning) return;
      lastT = Number.NaN;
      carryX = 0;
      carryY = 0;
      attach();
      handle = raf(frame);
    },
    stop,
    get running() {
      return handle !== null;
    },
  };
}
