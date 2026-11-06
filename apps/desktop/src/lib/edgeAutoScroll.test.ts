import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createEdgeAutoScroll,
  axisVelocity,
  zoneFor,
  EDGE_ZONE_PX,
  MAX_SPEED_PX_S,
  REDUCED_SPEED_PX_S,
  MAX_FRAME_MS,
  type ScrollSurface,
} from "./edgeAutoScroll";

/** A scroll container with no layout engine: the rect is declared, and
 *  scrollLeft/scrollTop clamp the way a real element's do. jsdom gives every
 *  element a zero rect and ignores scroll writes, so the loop is driven against
 *  this instead (it only ever touches the `ScrollSurface` members). */
function surface(
  opts: Partial<{
    left: number;
    top: number;
    width: number;
    height: number;
    scrollWidth: number;
    scrollHeight: number;
    scrollLeft: number;
    scrollTop: number;
  }> = {},
) {
  const width = opts.width ?? 1000;
  const height = opts.height ?? 800;
  const left = opts.left ?? 0;
  const top = opts.top ?? 0;
  const maxX = (opts.scrollWidth ?? 3000) - width;
  const maxY = (opts.scrollHeight ?? 4000) - height;
  let sl = opts.scrollLeft ?? 500;
  let st = opts.scrollTop ?? 500;
  return {
    get scrollLeft() {
      return sl;
    },
    set scrollLeft(v: number) {
      sl = Math.max(0, Math.min(v, maxX));
    },
    get scrollTop() {
      return st;
    },
    set scrollTop(v: number) {
      st = Math.max(0, Math.min(v, maxY));
    },
    scrollWidth: opts.scrollWidth ?? 3000,
    scrollHeight: opts.scrollHeight ?? 4000,
    clientWidth: width,
    clientHeight: height,
    getBoundingClientRect: () => ({
      left,
      top,
      right: left + width,
      bottom: top + height,
    }),
  } satisfies ScrollSurface;
}

/** Hand-cranked rAF: `flush(n)` runs n frames, each 16ms after the last. The
 *  loop must be driven without any further pointer events for the stall bug to
 *  be testable at all. */
function clock() {
  let t = 0;
  let pending: ((t: number) => void) | null = null;
  let nextHandle = 1;
  let cancelled = 0;
  return {
    raf: (cb: (t: number) => void) => {
      pending = cb;
      return nextHandle++;
    },
    cancel: () => {
      pending = null;
      cancelled++;
    },
    get cancels() {
      return cancelled;
    },
    /** Advance `frames` animation frames of `ms` each. */
    flush(frames = 1, ms = 16) {
      for (let i = 0; i < frames; i++) {
        const cb = pending;
        if (!cb) return i;
        pending = null;
        t += ms;
        cb(t);
      }
      return frames;
    },
    get queued() {
      return pending !== null;
    },
  };
}

function make(
  opts: {
    reduced?: boolean;
    onStep?: (x: number, y: number) => void;
  } = {},
) {
  const c = clock();
  const loop = createEdgeAutoScroll({
    raf: c.raf,
    cancel: c.cancel,
    reducedMotion: () => opts.reduced ?? false,
    onStep: opts.onStep,
  });
  return { loop, c };
}

describe("zoneFor / axisVelocity", () => {
  it("uses the full zone on a normal viewport", () => {
    expect(zoneFor(800)).toBe(EDGE_ZONE_PX);
  });

  it("narrows the zone on a tiny viewport so the two bands stay disjoint", () => {
    expect(zoneFor(120)).toBe(30);
    expect(zoneFor(0)).toBe(0);
    // A point at the midpoint of a small axis belongs to neither band.
    expect(axisVelocity(60, 60, 120, false)).toBe(0);
  });

  it("is still outside the zone in the middle of the container", () => {
    expect(axisVelocity(400, 400, 800, false)).toBe(0);
  });

  it("scrolls toward the start edge near the start, end edge near the end", () => {
    expect(axisVelocity(10, 790, 800, false)).toBeLessThan(0);
    expect(axisVelocity(790, 10, 800, false)).toBeGreaterThan(0);
  });

  it("ramps quadratically: deeper into the zone is strictly faster", () => {
    const shallow = Math.abs(axisVelocity(60, 740, 800, false));
    const mid = Math.abs(axisVelocity(32, 768, 800, false));
    const deep = Math.abs(axisVelocity(2, 798, 800, false));
    expect(shallow).toBeLessThan(mid);
    expect(mid).toBeLessThan(deep);
    // Quadratic, not linear: half-depth is a quarter of the speed.
    expect(mid).toBeCloseTo(MAX_SPEED_PX_S * 0.25, 5);
    expect(deep).toBeLessThanOrEqual(MAX_SPEED_PX_S);
  });

  it("caps at the max speed when the pointer is past the edge", () => {
    expect(axisVelocity(-50, 850, 800, false)).toBe(-MAX_SPEED_PX_S);
  });

  it("under reduced motion holds one constant, slower speed at any depth", () => {
    expect(axisVelocity(60, 740, 800, true)).toBe(-REDUCED_SPEED_PX_S);
    expect(axisVelocity(1, 799, 800, true)).toBe(-REDUCED_SPEED_PX_S);
    expect(REDUCED_SPEED_PX_S).toBeLessThan(MAX_SPEED_PX_S);
    // Still functional: reduced motion slows the scroll, it never disables it
    // (that would leave off-screen drop targets unreachable).
    expect(axisVelocity(1, 799, 800, true)).not.toBe(0);
  });
});

describe("createEdgeAutoScroll", () => {
  let el: ReturnType<typeof surface>;

  beforeEach(() => {
    el = surface();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing while the pointer is away from the edges", () => {
    const { loop, c } = make();
    loop.update(el, 500, 400);
    expect(loop.running).toBe(false);
    expect(c.queued).toBe(false);
    expect(el.scrollTop).toBe(500);
  });

  it("keeps scrolling with NO further pointer events once armed", () => {
    const { loop, c } = make();
    loop.update(el, 500, 790); // deep in the bottom band
    expect(loop.running).toBe(true);
    // The first frame only establishes the rAF timebase (see `lastT`); motion
    // starts with the second.
    const after1 = (c.flush(2), el.scrollTop);
    expect(after1).toBeGreaterThan(500);
    // The whole point: the pointer is now stationary, so no dragover fires.
    c.flush(10);
    expect(el.scrollTop).toBeGreaterThan(after1);
    expect(loop.running).toBe(true);
  });

  it("scrolls faster nearer the edge over the same number of frames", () => {
    const shallow = surface();
    const deep = surface();
    const a = make();
    a.loop.update(shallow, 500, 800 - 60); // just inside the band
    a.c.flush(6);
    const b = make();
    b.loop.update(deep, 500, 799); // pinned to the edge
    b.c.flush(6);
    expect(deep.scrollTop - 500).toBeGreaterThan(shallow.scrollTop - 500);
  });

  it("scrolls on both axes, including diagonally in a corner", () => {
    const { loop, c } = make();
    loop.update(el, 999, 799); // bottom-right corner
    c.flush(5);
    expect(el.scrollLeft).toBeGreaterThan(500);
    expect(el.scrollTop).toBeGreaterThan(500);
    const right = surface();
    const r = make();
    r.loop.update(right, 999, 400); // right edge only
    r.c.flush(5);
    expect(right.scrollLeft).toBeGreaterThan(500);
    expect(right.scrollTop).toBe(500);
  });

  it("scrolls backwards toward the start edges too", () => {
    const { loop, c } = make();
    loop.update(el, 1, 1); // top-left corner
    c.flush(5);
    expect(el.scrollLeft).toBeLessThan(500);
    expect(el.scrollTop).toBeLessThan(500);
  });

  it("does not scroll, or even arm, when the axis is already at its limit", () => {
    const atTop = surface({ scrollTop: 0, scrollLeft: 0 });
    const { loop, c } = make();
    loop.update(atTop, 1, 1); // pushing further up/left — nowhere to go
    expect(loop.running).toBe(false);
    c.flush(5);
    expect(atTop.scrollTop).toBe(0);
    expect(atTop.scrollLeft).toBe(0);
  });

  it("does not scroll when the content fits entirely in the viewport", () => {
    const small = surface({
      scrollWidth: 1000,
      scrollHeight: 800,
      scrollLeft: 0,
      scrollTop: 0,
    });
    const { loop } = make();
    loop.update(small, 999, 799);
    expect(loop.running).toBe(false);
  });

  it("still scrolls the axis that CAN move when the other is exhausted", () => {
    const el2 = surface({ scrollTop: 0 });
    const { loop, c } = make();
    loop.update(el2, 999, 1); // top edge exhausted, right edge free
    c.flush(4);
    expect(el2.scrollTop).toBe(0);
    expect(el2.scrollLeft).toBeGreaterThan(500);
  });

  it("stops when a later position leaves the zone", () => {
    const { loop, c } = make();
    loop.update(el, 500, 790);
    c.flush(2);
    const reached = el.scrollTop;
    loop.update(el, 500, 400); // back to the middle
    expect(loop.running).toBe(false);
    c.flush(5);
    expect(el.scrollTop).toBe(reached);
  });

  it("stops when the position falls outside the container entirely", () => {
    const { loop, c } = make();
    loop.update(el, 500, 790);
    c.flush(2);
    loop.update(el, 500, 900); // below the scroller (e.g. a real dragleave)
    expect(loop.running).toBe(false);
    const reached = el.scrollTop;
    c.flush(5);
    expect(el.scrollTop).toBe(reached);
  });

  it("stops itself the frame after the pointer is teleported out of bounds", () => {
    // Belt-and-braces for the frame-side guard: arm, then move the element
    // out from under the (unchanged) pointer.
    const moving = surface({ top: 0 });
    const { loop, c } = make();
    loop.update(moving, 500, 790);
    expect(loop.running).toBe(true);
    vi.spyOn(moving, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 1000,
      bottom: 200,
    });
    c.flush(1);
    expect(loop.running).toBe(false);
  });

  it("stop() is idempotent and cancels the pending frame", () => {
    const { loop, c } = make();
    loop.update(el, 500, 790);
    loop.stop();
    loop.stop();
    expect(loop.running).toBe(false);
    expect(c.queued).toBe(false);
    const reached = el.scrollTop;
    c.flush(5);
    expect(el.scrollTop).toBe(reached);
  });

  it("stops on a null container (the scroller is gone)", () => {
    const { loop } = make();
    loop.update(el, 500, 790);
    loop.update(null, 500, 790);
    expect(loop.running).toBe(false);
  });

  it("stops on a window-level drop, and on dragend", () => {
    for (const type of ["drop", "dragend"]) {
      const fresh = surface();
      const { loop, c } = make();
      loop.update(fresh, 500, 790);
      expect(loop.running).toBe(true);
      window.dispatchEvent(new Event(type));
      expect(loop.running).toBe(false);
      const reached = fresh.scrollTop;
      c.flush(5);
      expect(fresh.scrollTop).toBe(reached);
    }
  });

  it("unsubscribes its window listeners once stopped", () => {
    const { loop, c } = make();
    loop.update(el, 500, 790);
    loop.stop();
    // A later drop must not reach a torn-down loop, nor revive it.
    window.dispatchEvent(new Event("drop"));
    expect(loop.running).toBe(false);
    expect(c.queued).toBe(false);
  });

  it("composes with the user's own scrolling instead of fighting it", () => {
    const { loop, c } = make();
    loop.update(el, 500, 790);
    c.flush(2);
    const auto = el.scrollTop;
    el.scrollTop = auto + 900; // the user wheels mid-drag
    c.flush(2);
    // The loop resumed from where the wheel left the view (it never snaps back
    // to a remembered target), so the wheel's 900px is still there.
    expect(el.scrollTop).toBeGreaterThan(auto + 900);
  });

  it("clamps a long-delayed frame instead of jumping its whole wall-clock gap", () => {
    const { loop, c } = make();
    loop.update(el, 500, 799); // max speed
    c.flush(1); // baseline frame
    c.flush(1, 5000); // then a 5s stall (background tab, long layout)
    expect(el.scrollTop - 500).toBeLessThanOrEqual(
      (MAX_SPEED_PX_S * MAX_FRAME_MS) / 1000 + 1,
    );
  });

  it("accumulates sub-pixel speed rather than truncating it away", () => {
    const { loop, c } = make();
    // Shallow depth: ~1px per 16ms frame, which Math.trunc would zero out on
    // its own. 40 frames must still have moved the view.
    loop.update(el, 500, 800 - 58);
    c.flush(40);
    expect(el.scrollTop).toBeGreaterThan(500);
  });

  it("reports the live pointer position to onStep on each moving frame", () => {
    const steps: [number, number][] = [];
    const { loop, c } = make({ onStep: (x, y) => steps.push([x, y]) });
    loop.update(el, 480, 790);
    c.flush(4);
    expect(steps.length).toBeGreaterThan(0);
    expect(steps[0]).toEqual([480, 790]);
  });

  it("does not call onStep when there is nothing to scroll", () => {
    const onStep = vi.fn();
    const { loop, c } = make({ onStep });
    loop.update(el, 500, 400);
    c.flush(3);
    expect(onStep).not.toHaveBeenCalled();
  });

  it("moves less under reduced motion at the same depth and duration", () => {
    const normalEl = surface();
    const reducedEl = surface();
    const n = make();
    n.loop.update(normalEl, 500, 799);
    n.c.flush(6);
    const r = make({ reduced: true });
    r.loop.update(reducedEl, 500, 799);
    r.c.flush(6);
    expect(reducedEl.scrollTop).toBeGreaterThan(500); // still reachable
    expect(reducedEl.scrollTop).toBeLessThan(normalEl.scrollTop);
  });
});
