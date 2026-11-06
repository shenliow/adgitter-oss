import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import type { Commit, RefList } from "../lib/ipc";

// Same mock as MetroGraph.gestures.test.ts: a drag starts the WKWebView
// modifier poll, which would otherwise reach for a real Tauri bridge.
const pollNativeModifiers = vi.hoisted(() => vi.fn());
vi.mock("../lib/ipc", () => ({ pollNativeModifiers }));

import MetroGraph from "./MetroGraph.svelte";

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

const refs: RefList = {
  head: { branch: "main", target: "c3", detached: false },
  branches: [
    { name: "main", kind: "branch", target: "c3" },
    { name: "feature", kind: "branch", target: "c2" },
  ],
  remotes: [],
  tags: [],
};

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

/** Hand-cranked animation frames: the component takes `requestAnimationFrame`
 *  from the global, and the whole point of the loop is that it advances with no
 *  further input events, so the test has to own the clock. */
let frame: ((t: number) => void) | null;
let clockMs = 0;

function flushFrames(n = 1, ms = 16) {
  for (let i = 0; i < n; i++) {
    const cb = frame;
    if (!cb) return i;
    frame = null;
    clockMs += ms;
    cb(clockMs);
  }
  return n;
}

beforeEach(() => {
  pollNativeModifiers.mockReset();
  pollNativeModifiers.mockResolvedValue(null);
  frame = null;
  clockMs = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
    frame = cb;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    frame = null;
  });
});

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function render(props: Record<string, unknown>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(MetroGraph, { target: host, props });
  flushSync();
  return host;
}

/** jsdom has no layout: every rect is zero, `clientWidth`/`scrollWidth` are 0
 *  and scroll writes are dropped. Give the real `.scroller` element a viewport
 *  (1000x800 at the origin), overflow to scroll into, and clamping
 *  scrollLeft/scrollTop accessors, so the component's own loop can drive it. */
function fitScroller(h: HTMLDivElement) {
  const el = h.querySelector(".scroller") as HTMLDivElement;
  let sl = 500;
  let st = 500;
  Object.defineProperties(el, {
    clientWidth: { configurable: true, get: () => 1000 },
    clientHeight: { configurable: true, get: () => 800 },
    scrollWidth: { configurable: true, get: () => 3000 },
    scrollHeight: { configurable: true, get: () => 4000 },
    scrollLeft: {
      configurable: true,
      get: () => sl,
      set: (v: number) => {
        sl = Math.max(0, Math.min(v, 2000));
      },
    },
    scrollTop: {
      configurable: true,
      get: () => st,
      set: (v: number) => {
        st = Math.max(0, Math.min(v, 3200));
      },
    },
  });
  const rect = (left: number, top: number, w: number, hgt: number) =>
    ({
      left,
      top,
      right: left + w,
      bottom: top + hgt,
      width: w,
      height: hgt,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue(rect(0, 0, 1000, 800));
  // Real layout slides the content up/left as the scroller scrolls; jsdom would
  // keep reporting a zero rect, which would hide any staleness in the
  // coordinates the component derives from a stationary pointer.
  const content = el.querySelector(".content") as HTMLDivElement;
  vi.spyOn(content, "getBoundingClientRect").mockImplementation(() =>
    rect(-sl, -st, 3000, 4000),
  );
  return el;
}

// jsdom lacks DataTransfer; same minimal stand-in the gesture tests dispatch.
function fireDrag(
  el: Element,
  type:
    | "dragstart"
    | "dragenter"
    | "dragover"
    | "dragleave"
    | "drop"
    | "dragend",
  init: Partial<MouseEventInit> = {},
) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(ev, "dataTransfer", {
    value: {
      effectAllowed: "",
      dropEffect: "",
      _d: {} as Record<string, string>,
      setData(k: string, v: string) {
        this._d[k] = v;
      },
      getData(k: string) {
        return this._d[k] ?? "";
      },
    },
  });
  el.dispatchEvent(ev);
  return ev;
}

function handles(h: HTMLDivElement): HTMLDivElement[] {
  return [...h.querySelectorAll<HTMLDivElement>(".node-handle")];
}

function firePointer(
  el: EventTarget,
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
) {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(ev, "pointerId", { value: 1 });
  el.dispatchEvent(ev);
  return ev;
}

describe("MetroGraph drag edge auto-scroll", () => {
  it("does not scroll while the drag stays away from the edges", () => {
    const h = render({ commits, refs });
    const scroller = fitScroller(h);
    fireDrag(handles(h)[0], "dragstart");
    fireDrag(scroller, "dragover", { clientX: 500, clientY: 400 });
    flushFrames(5);
    expect(scroller.scrollTop).toBe(500);
  });

  it("scrolls on a commit drag, and keeps going with no further events", () => {
    const h = render({ commits, refs });
    const scroller = fitScroller(h);
    fireDrag(handles(h)[0], "dragstart");
    fireDrag(scroller, "dragover", { clientX: 500, clientY: 795 });
    // The first frame only establishes the rAF timebase; motion starts on the
    // second (see `lastT` in lib/edgeAutoScroll).
    flushFrames(2);
    const first = scroller.scrollTop;
    expect(first).toBeGreaterThan(500);
    // The stall bug: `dragover` only fires while the pointer MOVES, so a user
    // holding at the edge sends nothing more. The loop must advance anyway.
    flushFrames(8);
    expect(scroller.scrollTop).toBeGreaterThan(first);
  });

  it("scrolls on a HEAD-crown drag as well as a commit drag", () => {
    const h = render({ commits, refs });
    const scroller = fitScroller(h);
    fireDrag(h.querySelector(".crown")!, "dragstart");
    fireDrag(scroller, "dragover", { clientX: 500, clientY: 795 });
    flushFrames(4);
    expect(scroller.scrollTop).toBeGreaterThan(500);
  });

  it("scrolls horizontally too, so off-screen lanes are reachable", () => {
    const h = render({ commits, refs });
    const scroller = fitScroller(h);
    fireDrag(handles(h)[0], "dragstart");
    fireDrag(scroller, "dragover", { clientX: 996, clientY: 400 });
    flushFrames(4);
    expect(scroller.scrollLeft).toBeGreaterThan(500);
    expect(scroller.scrollTop).toBe(500);
  });

  it("goes faster the deeper into the edge zone the pointer is", () => {
    const shallow = render({ commits, refs });
    const a = fitScroller(shallow);
    fireDrag(handles(shallow)[0], "dragstart");
    fireDrag(a, "dragover", { clientX: 500, clientY: 800 - 60 });
    flushFrames(6);
    const shallowTravel = a.scrollTop - 500;
    unmount(app);
    host.remove();

    const deep = render({ commits, refs });
    const b = fitScroller(deep);
    fireDrag(handles(deep)[0], "dragstart");
    fireDrag(b, "dragover", { clientX: 500, clientY: 799 });
    flushFrames(6);
    expect(b.scrollTop - 500).toBeGreaterThan(shallowTravel);
  });

  it("stops once the pointer moves back out of the zone", () => {
    const h = render({ commits, refs });
    const scroller = fitScroller(h);
    fireDrag(handles(h)[0], "dragstart");
    fireDrag(scroller, "dragover", { clientX: 500, clientY: 795 });
    flushFrames(2);
    fireDrag(scroller, "dragover", { clientX: 500, clientY: 400 });
    const reached = scroller.scrollTop;
    flushFrames(5);
    expect(scroller.scrollTop).toBe(reached);
  });

  it("keeps scrolling through a dragleave bubbled from a child node", () => {
    const h = render({ commits, refs });
    const scroller = fitScroller(h);
    fireDrag(handles(h)[0], "dragstart");
    fireDrag(scroller, "dragover", { clientX: 500, clientY: 795 });
    flushFrames(1);
    const reached = scroller.scrollTop;
    // Crossing from one node to the next fires dragleave, which bubbles to the
    // scroller — its coordinates are still inside, so this is NOT an exit.
    fireDrag(handles(h)[1], "dragleave", { clientX: 500, clientY: 795 });
    flushFrames(3);
    expect(scroller.scrollTop).toBeGreaterThan(reached);
  });

  it("keeps scrolling while the pointer crosses hit-area boundaries", () => {
    // While the view travels under a parked pointer, rows slide past it and
    // the engine keeps firing enter/leave pairs — including SAME-key ones,
    // where the pointer only moved between a `.row` and the `.node-handle`
    // over it. Every one of those leaves is fed to `autoScroll.update` by
    // `graphDragLeave`, so a burst of them must not be mistaken for an exit.
    const h = render({ commits, refs });
    const scroller = fitScroller(h);
    fireDrag(handles(h)[0], "dragstart");
    fireDrag(scroller, "dragover", { clientX: 500, clientY: 795 });
    flushFrames(1);
    const reached = scroller.scrollTop;
    for (let i = 0; i < 4; i++) {
      // enter the handle, leave the row under it, and back — all at the same
      // parked coordinates, which are still well inside the scroller.
      fireDrag(handles(h)[1], "dragenter", { clientX: 500, clientY: 795 });
      fireDrag(h.querySelectorAll("button.row")[1], "dragleave", {
        clientX: 500,
        clientY: 795,
      });
      fireDrag(h.querySelectorAll("button.row")[1], "dragenter", {
        clientX: 500,
        clientY: 795,
      });
      fireDrag(handles(h)[1], "dragleave", { clientX: 500, clientY: 795 });
    }
    flushFrames(3);
    expect(scroller.scrollTop).toBeGreaterThan(reached);
  });

  it("stops when the cursor really leaves the scroller", () => {
    const h = render({ commits, refs });
    const scroller = fitScroller(h);
    fireDrag(handles(h)[0], "dragstart");
    fireDrag(scroller, "dragover", { clientX: 500, clientY: 795 });
    flushFrames(2);
    fireDrag(scroller, "dragleave", { clientX: 500, clientY: 900 });
    const reached = scroller.scrollTop;
    flushFrames(5);
    expect(scroller.scrollTop).toBe(reached);
  });

  it("stops on drop", () => {
    const h = render({ commits, refs });
    const scroller = fitScroller(h);
    fireDrag(handles(h)[0], "dragstart");
    fireDrag(scroller, "dragover", { clientX: 500, clientY: 795 });
    flushFrames(2);
    fireDrag(handles(h)[2], "drop");
    const reached = scroller.scrollTop;
    flushFrames(5);
    expect(scroller.scrollTop).toBe(reached);
  });

  it("stops on dragend, including a cancelled drag", () => {
    const h = render({ commits, refs });
    const scroller = fitScroller(h);
    fireDrag(handles(h)[0], "dragstart");
    fireDrag(scroller, "dragover", { clientX: 500, clientY: 795 });
    flushFrames(2);
    // A cancelled drag (Escape / drop on nothing) still ends with dragend.
    fireDrag(handles(h)[0], "dragend");
    const reached = scroller.scrollTop;
    flushFrames(5);
    expect(scroller.scrollTop).toBe(reached);
  });

  it("does not scroll for a drag we never started (e.g. a file from Finder)", () => {
    const h = render({ commits, refs });
    const scroller = fitScroller(h);
    fireDrag(scroller, "dragover", { clientX: 500, clientY: 795 });
    flushFrames(5);
    expect(scroller.scrollTop).toBe(500);
  });

  it("stops on unmount rather than scrolling a detached node", () => {
    const h = render({ commits, refs });
    const scroller = fitScroller(h);
    fireDrag(handles(h)[0], "dragstart");
    fireDrag(scroller, "dragover", { clientX: 500, clientY: 795 });
    flushFrames(2);
    const reached = scroller.scrollTop;
    unmount(app);
    app = undefined;
    flushFrames(5);
    expect(scroller.scrollTop).toBe(reached);
  });

  it("does not scroll past the end of the content", () => {
    const h = render({ commits, refs });
    const scroller = fitScroller(h);
    scroller.scrollTop = 3200; // already at the bottom
    fireDrag(handles(h)[0], "dragstart");
    fireDrag(scroller, "dragover", { clientX: 500, clientY: 795 });
    flushFrames(5);
    expect(scroller.scrollTop).toBe(3200);
  });

  /** The merge affordance dot only exists while its branch-head node is
   *  hovered, so reveal it the way the user does. */
  function mergeHandle(h: HTMLDivElement): HTMLDivElement {
    handles(h)[0].dispatchEvent(new MouseEvent("pointerenter"));
    flushSync();
    const dot = h.querySelector<HTMLDivElement>(".merge-handle");
    if (!dot) throw new Error("no merge handle on the branch head");
    return dot;
  }

  it("scrolls for the pointer-based branch-head merge drag too", () => {
    const h = render({ commits, refs });
    const scroller = fitScroller(h);
    firePointer(mergeHandle(h), "pointerdown", 100, 200);
    firePointer(window, "pointermove", 500, 795);
    flushFrames(4);
    expect(scroller.scrollTop).toBeGreaterThan(500);
  });

  it("stops the loop when the merge drag is released", () => {
    const h = render({ commits, refs });
    const scroller = fitScroller(h);
    firePointer(mergeHandle(h), "pointerdown", 100, 200);
    firePointer(window, "pointermove", 500, 795);
    flushFrames(2);
    firePointer(window, "pointerup", 500, 795);
    const reached = scroller.scrollTop;
    flushFrames(5);
    expect(scroller.scrollTop).toBe(reached);
  });

  it("re-aims the merge drag as the view scrolls under a still pointer", () => {
    const h = render({ commits, refs });
    const scroller = fitScroller(h);
    firePointer(mergeHandle(h), "pointerdown", 100, 200);
    firePointer(window, "pointermove", 500, 795);
    flushSync();
    const before = h.querySelector(".merge-drag-line")?.getAttribute("d");
    expect(before).toBeTruthy();
    flushFrames(4);
    flushSync();
    // The content moved under a stationary pointer, so the connector's
    // content-local endpoint must have been recomputed.
    expect(scroller.scrollTop).toBeGreaterThan(500);
    expect(h.querySelector(".merge-drag-line")?.getAttribute("d")).not.toBe(
      before,
    );
  });
});
