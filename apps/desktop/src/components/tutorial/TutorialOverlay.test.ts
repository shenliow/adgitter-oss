import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount, flushSync, tick, type ComponentProps } from "svelte";
import TutorialOverlay from "./TutorialOverlay.svelte";
import TutorialOverlayTestHost from "./TutorialOverlayTestHost.svelte";
import type { TutorialPresentation } from "../../lib/tutorial/types";

type Props = ComponentProps<typeof TutorialOverlay>;

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;
let page: HTMLDivElement; // stands in for the app underneath the overlay

// ── a controllable requestAnimationFrame ─────────────────────────────────────
let rafQueue = new Map<number, FrameRequestCallback>();
let rafId = 0;
const cancelRaf = vi.fn((id: number) => {
  rafQueue.delete(id);
});
/** Run the callbacks queued so far (one animation frame). */
function frame() {
  const cbs = [...rafQueue.values()];
  rafQueue.clear();
  for (const cb of cbs) cb(0);
  flushSync();
}

beforeEach(() => {
  rafQueue = new Map();
  rafId = 0;
  cancelRaf.mockClear();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.set(++rafId, cb);
    return rafId;
  });
  vi.stubGlobal("cancelAnimationFrame", cancelRaf);
  page = document.createElement("div");
  document.body.appendChild(page);
});

afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  host?.remove();
  page.remove();
  vi.unstubAllGlobals();
});

function pres(over: Partial<TutorialPresentation> = {}): TutorialPresentation {
  return {
    id: "merge-drag",
    index: 8,
    total: 24,
    titleKey: "tutorialUi.exit", // any real key: its English text is asserted
    bodyKey: "tutorialUi.working",
    mode: "action",
    targets: [],
    busy: false,
    blocked: false,
    canGoBack: false,
    ...over,
  };
}

function render(over: Partial<Props> = {}): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  const props: Props = {
    presentation: pres(),
    onNext: () => {},
    onBack: () => {},
    onRetry: () => {},
    onExit: () => {},
    ...over,
  };
  app = mount(TutorialOverlay, { target: host, props });
  flushSync();
  return host;
}

/** Add `<div data-tutorial=id>` to the fake page with a stubbed layout box. */
function target(
  id: string,
  box: { x: number; y: number; w: number; h: number } | null,
  tag = "div",
): HTMLElement {
  const el = document.createElement(tag);
  el.setAttribute("data-tutorial", id);
  el.getBoundingClientRect = () =>
    ({
      x: box?.x ?? 0,
      y: box?.y ?? 0,
      left: box?.x ?? 0,
      top: box?.y ?? 0,
      width: box?.w ?? 0,
      height: box?.h ?? 0,
      right: (box?.x ?? 0) + (box?.w ?? 0),
      bottom: (box?.y ?? 0) + (box?.h ?? 0),
      toJSON: () => ({}),
    }) as DOMRect;
  page.appendChild(el);
  return el;
}

const sel = (id: string) => `[data-tutorial="${id}"]`;
const dim = (h: HTMLElement) => h.querySelector("path.dim") as SVGPathElement;
const subpaths = (h: HTMLElement) =>
  (dim(h).getAttribute("d")!.match(/Z/g) ?? []).length;
const btn = (h: HTMLElement, cls: string) =>
  h.querySelector(`button.${cls}`) as HTMLButtonElement | null;

function key(
  k: string,
  on: EventTarget = document.body,
  type: "keydown" | "keyup" = "keydown",
) {
  const e = new KeyboardEvent(type, {
    key: k,
    bubbles: true,
    cancelable: true,
  });
  on.dispatchEvent(e);
  return e;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("TutorialOverlay — spotlight", () => {
  it("is a fixed full-viewport layer at z-index 55 with a pass-through svg", () => {
    const h = render();
    const root = h.querySelector(".tutorial-overlay") as HTMLElement;
    expect(root).not.toBeNull();
    const svg = h.querySelector("svg.spot") as SVGElement;
    expect(svg.getAttribute("style")).toContain("pointer-events:none");
    // the dim layer is the only interactive surface (input outside holes lands here)
    const path = dim(h);
    expect(path.getAttribute("fill-rule")).toBe("evenodd");
    expect(path.getAttribute("style")).toContain("pointer-events:fill");
    // the ring is purely decorative
    const ring = h.querySelector("path.ring") as SVGPathElement;
    expect(ring.getAttribute("style")).toContain("pointer-events:none");
  });

  it("with no targets blocks everything: just the outer rectangle", () => {
    const h = render();
    expect(subpaths(h)).toBe(1);
    expect(dim(h).getAttribute("d")).toBe(
      `M0 0H${window.innerWidth}V${window.innerHeight}H0Z`,
    );
  });

  it("cuts one hole per present target", () => {
    target("a", { x: 100, y: 100, w: 120, h: 40 });
    target("b", { x: 400, y: 300, w: 80, h: 80 });
    target("c", { x: 700, y: 500, w: 60, h: 30 });
    const h = render({
      presentation: pres({ targets: [sel("a"), sel("b"), sel("c")] }),
    });
    expect(subpaths(h)).toBe(1 + 3);
  });

  it("skips targets that are missing or have an empty box", () => {
    target("a", { x: 100, y: 100, w: 120, h: 40 });
    target("hidden", null); // zero-size box (display:none / not laid out)
    const h = render({
      presentation: pres({
        targets: [sel("a"), sel("hidden"), sel("not-in-the-dom")],
      }),
    });
    expect(subpaths(h)).toBe(1 + 1);
  });

  it("makes a hole for every element a selector matches", () => {
    target("row", { x: 50, y: 50, w: 100, h: 20 });
    target("row", { x: 50, y: 200, w: 100, h: 20 });
    const h = render({ presentation: pres({ targets: [sel("row")] }) });
    expect(subpaths(h)).toBe(1 + 2);
  });

  it("pads the target by 6px", () => {
    target("a", { x: 100, y: 100, w: 120, h: 40 });
    const h = render({ presentation: pres({ targets: [sel("a")] }) });
    // padded box is x 94..226, y 94..146 → its top edge starts at x=102 (r=8)
    expect(dim(h).getAttribute("d")).toContain("M102 94H218");
  });

  it("draws a highlight ring along the same holes", () => {
    target("a", { x: 100, y: 100, w: 120, h: 40 });
    const h = render({ presentation: pres({ targets: [sel("a")] }) });
    const ring = h.querySelector("path.ring") as SVGPathElement;
    expect((ring.getAttribute("d")!.match(/Z/g) ?? []).length).toBe(1);
  });

  it("resolves selectors under `root` when one is given", () => {
    const inner = document.createElement("section");
    document.body.appendChild(inner);
    const el = document.createElement("div");
    el.setAttribute("data-tutorial", "scoped");
    el.getBoundingClientRect = () =>
      ({ left: 10, top: 10, width: 50, height: 50 }) as DOMRect;
    inner.appendChild(el);
    target("scoped", { x: 300, y: 300, w: 50, h: 50 }); // outside `root`
    const h = render({
      root: inner,
      presentation: pres({ targets: [sel("scoped")] }),
    });
    expect(subpaths(h)).toBe(1 + 1);
    expect(dim(h).getAttribute("d")).toContain("M12 4H"); // x 4..66 → 4+8
    inner.remove();
  });

  it("tracks the target every animation frame", () => {
    const el = target("a", { x: 100, y: 100, w: 120, h: 40 });
    const h = render({ presentation: pres({ targets: [sel("a")] }) });
    const before = dim(h).getAttribute("d");
    el.getBoundingClientRect = () =>
      ({ left: 300, top: 200, width: 120, height: 40 }) as DOMRect;
    expect(dim(h).getAttribute("d")).toBe(before); // nothing until a frame
    frame();
    expect(dim(h).getAttribute("d")).not.toBe(before);
    expect(dim(h).getAttribute("d")).toContain("M302 194H");
  });

  it("picks up a target that appears later (e.g. a dialog opening)", () => {
    const h = render({ presentation: pres({ targets: [sel("late")] }) });
    expect(subpaths(h)).toBe(1);
    target("late", { x: 200, y: 200, w: 100, h: 100 });
    frame();
    expect(subpaths(h)).toBe(1 + 1);
  });

  it("keeps requesting frames while mounted and cancels on destroy", () => {
    render();
    expect(rafQueue.size).toBe(1);
    frame();
    expect(rafQueue.size).toBe(1); // re-armed
    const pending = [...rafQueue.keys()][0];
    unmount(app);
    app = undefined;
    expect(cancelRaf).toHaveBeenCalledWith(pending);
    expect(rafQueue.size).toBe(0);
  });
});

describe("TutorialOverlay — keyboard guard", () => {
  it("swallows a non-allowed key before any bubble-phase listener sees it", () => {
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    render();
    const e = key("z");
    expect(e.defaultPrevented).toBe(true);
    expect(seen).not.toHaveBeenCalled();
    window.removeEventListener("keydown", seen);
  });

  it("blocks shortcuts that combine a modifier with an ordinary key", () => {
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    render();
    const e = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(seen).not.toHaveBeenCalled();
    window.removeEventListener("keydown", seen);
  });

  it("also swallows the matching keyup", () => {
    const seen = vi.fn();
    window.addEventListener("keyup", seen);
    render();
    key("z", document.body, "keyup");
    expect(seen).not.toHaveBeenCalled();
    window.removeEventListener("keyup", seen);
  });

  it.each(["Shift", "Alt", "Meta", "Control"])(
    "lets the %s modifier through",
    (m) => {
      const seen = vi.fn();
      window.addEventListener("keydown", seen);
      render();
      const e = key(m);
      expect(e.defaultPrevented).toBe(false);
      expect(seen).toHaveBeenCalledTimes(1);
      window.removeEventListener("keydown", seen);
    },
  );

  it("lets the step's allowKeys through, and only those", () => {
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    const wrap = target("graph", { x: 0, y: 0, w: 500, h: 500 });
    const row = document.createElement("div");
    wrap.appendChild(row);
    render({
      presentation: pres({
        targets: [sel("graph")],
        allowKeys: ["Enter", "Escape"],
      }),
    });
    expect(key("Enter", row).defaultPrevented).toBe(false);
    expect(key("Escape", row).defaultPrevented).toBe(false);
    expect(seen).toHaveBeenCalledTimes(2);
    expect(key("Delete", row).defaultPrevented).toBe(true);
    expect(seen).toHaveBeenCalledTimes(2);
    window.removeEventListener("keydown", seen);
  });

  it("lets typing into an input inside a hole through", () => {
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    const wrap = target("commit-bar", { x: 50, y: 600, w: 400, h: 60 });
    const input = document.createElement("input");
    wrap.appendChild(input);
    render({ presentation: pres({ targets: [sel("commit-bar")] }) });
    const e = key("a", input);
    expect(e.defaultPrevented).toBe(false);
    expect(seen).toHaveBeenCalledTimes(1);
    // ...and a textarea / contenteditable likewise
    const ta = document.createElement("textarea");
    wrap.appendChild(ta);
    expect(key("b", ta).defaultPrevented).toBe(false);
    const ce = document.createElement("div");
    ce.setAttribute("contenteditable", "true");
    wrap.appendChild(ce);
    expect(key("c", ce).defaultPrevented).toBe(false);
    window.removeEventListener("keydown", seen);
  });

  it("blocks typing into an input that is NOT inside a hole", () => {
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    target("commit-bar", { x: 50, y: 600, w: 400, h: 60 });
    const stray = document.createElement("input");
    page.appendChild(stray);
    render({ presentation: pres({ targets: [sel("commit-bar")] }) });
    const e = key("a", stray);
    expect(e.defaultPrevented).toBe(true);
    expect(seen).not.toHaveBeenCalled();
    window.removeEventListener("keydown", seen);
  });

  it("blocks ordinary keys pressed on a non-field element inside a hole", () => {
    const wrap = target("graph", { x: 0, y: 0, w: 500, h: 500 });
    const row = document.createElement("div");
    wrap.appendChild(row);
    render({ presentation: pres({ targets: [sel("graph")] }) });
    expect(key("Delete", row).defaultPrevented).toBe(true);
  });

  it("does not let a card control's Enter/Space reach the app's shortcuts", () => {
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    const h = render({ presentation: pres({ mode: "info" }) });
    const next = btn(h, "btn-next")!;
    // the browser default (activating the button) must still run…
    expect(key("Enter", next).defaultPrevented).toBe(false);
    expect(key(" ", next).defaultPrevented).toBe(false);
    // …but the app never sees the key
    expect(seen).not.toHaveBeenCalled();
    // any other key on the card is blocked outright
    expect(key("Delete", next).defaultPrevented).toBe(true);
    window.removeEventListener("keydown", seen);
  });

  it("lets the step's allowKeys through only inside a hole, a dialog hole or the card", () => {
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    const wrap = target("graph", { x: 0, y: 0, w: 500, h: 500 });
    const row = document.createElement("div");
    wrap.appendChild(row);
    const dialog = target("confirm-dialog", { x: 100, y: 100, w: 300, h: 150 });
    const ok = document.createElement("button");
    dialog.appendChild(ok);
    const stray = document.createElement("button");
    page.appendChild(stray);
    const h = render({
      presentation: pres({
        targets: [sel("graph"), sel("confirm-dialog")],
        allowKeys: ["Enter", "Escape"],
      }),
    });
    const card = h.querySelector(".card") as HTMLElement;
    // inside a hole, and inside a dialog that is itself a hole target
    expect(key("Escape", row).defaultPrevented).toBe(false);
    expect(key("Enter", ok).defaultPrevented).toBe(false);
    expect(key("Escape", card).defaultPrevented).toBe(false);
    expect(seen).toHaveBeenCalledTimes(3);
    // …but not when focus sits elsewhere: the page body or a stray control
    for (const outside of [document.body, stray, page]) {
      expect(key("Enter", outside).defaultPrevented).toBe(true);
      expect(key("Escape", outside).defaultPrevented).toBe(true);
    }
    expect(seen).toHaveBeenCalledTimes(3);
    window.removeEventListener("keydown", seen);
  });

  it("keeps a card button's Enter/Space away from the app even when Enter is allowed", () => {
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    const h = render({
      presentation: pres({ allowKeys: ["Enter", "Escape"] }),
    });
    const exit = btn(h, "btn-exit")!;
    // the confirm dialog behind the card confirms on a window-level Enter
    expect(key("Enter", exit).defaultPrevented).toBe(false);
    expect(key(" ", exit).defaultPrevented).toBe(false);
    expect(seen).not.toHaveBeenCalled();
    window.removeEventListener("keydown", seen);
  });

  it("lets Enter/Space press a button inside a hole, hiding the key from the app", () => {
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    const wrap = target("toolbar-push", { x: 0, y: 0, w: 80, h: 30 });
    const push = document.createElement("button");
    wrap.appendChild(push);
    const row = document.createElement("div");
    wrap.appendChild(row);
    render({ presentation: pres({ targets: [sel("toolbar-push")] }) });
    expect(key("Enter", push).defaultPrevented).toBe(false);
    expect(key(" ", push).defaultPrevented).toBe(false);
    expect(seen).not.toHaveBeenCalled();
    // a non-button inside the hole, or any other key, stays blocked
    expect(key("Enter", row).defaultPrevented).toBe(true);
    expect(key("Delete", push).defaultPrevented).toBe(true);
    window.removeEventListener("keydown", seen);
  });

  it("stops guarding once the overlay is destroyed", () => {
    render();
    unmount(app);
    app = undefined;
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    const e = key("z");
    expect(e.defaultPrevented).toBe(false);
    expect(seen).toHaveBeenCalledTimes(1);
    window.removeEventListener("keydown", seen);
  });
});

describe("TutorialOverlay — Tab stays inside the spotlight", () => {
  /** A page with a control outside every hole and two inside one. */
  function scene() {
    const before = document.createElement("button");
    before.textContent = "before";
    page.appendChild(before);
    const wrap = target("commit-bar", { x: 50, y: 600, w: 400, h: 60 });
    const input = document.createElement("input");
    const commit = document.createElement("button");
    wrap.append(input, commit);
    const after = document.createElement("button");
    after.textContent = "after";
    page.appendChild(after);
    return { before, wrap, input, commit, after };
  }
  const tab = (from: Element | null, shift = false) => {
    const e = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: shift,
      bubbles: true,
      cancelable: true,
    });
    (from ?? document.body).dispatchEvent(e);
    return e;
  };

  it("takes over Tab: the browser's own focus move never runs", () => {
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    const { input } = scene();
    render({ presentation: pres({ targets: [sel("commit-bar")] }) });
    input.focus();
    expect(tab(input).defaultPrevented).toBe(true);
    expect(seen).not.toHaveBeenCalled();
    window.removeEventListener("keydown", seen);
  });

  it("cycles hole controls then the card's, wrapping, and never visits the page outside", () => {
    const { before, input, commit, after } = scene();
    const h = render({
      presentation: pres({ targets: [sel("commit-bar")] }),
    });
    const exit = btn(h, "btn-exit")!;
    // document order: the hole's controls (page) come before the card
    input.focus();
    const visited: Element[] = [];
    for (let i = 0; i < 5; i++) {
      tab(document.activeElement);
      visited.push(document.activeElement!);
    }
    expect(visited).toEqual([commit, exit, input, commit, exit]);
    expect(visited).not.toContain(before);
    expect(visited).not.toContain(after);
  });

  it("Shift+Tab goes the other way and wraps from the first control to the last", () => {
    const { input, commit } = scene();
    const h = render({
      presentation: pres({ targets: [sel("commit-bar")] }),
    });
    const exit = btn(h, "btn-exit")!;
    input.focus();
    tab(input, true);
    expect(document.activeElement).toBe(exit);
    tab(exit, true);
    expect(document.activeElement).toBe(commit);
    tab(commit, true);
    expect(document.activeElement).toBe(input);
  });

  it("from outside (page body or a stray control) Tab enters at the first control, Shift+Tab at the last", () => {
    const { before, input } = scene();
    const h = render({
      presentation: pres({ targets: [sel("commit-bar")] }),
    });
    const exit = btn(h, "btn-exit")!;
    tab(document.body);
    expect(document.activeElement).toBe(input);
    before.focus();
    tab(before);
    expect(document.activeElement).toBe(input);
    before.focus();
    tab(before, true);
    expect(document.activeElement).toBe(exit);
    document.body.focus();
    tab(document.body, true);
    expect(document.activeElement).toBe(exit);
  });

  it("skips disabled, hidden and tabindex=-1 controls", () => {
    const { wrap, input, commit } = scene();
    const dead = document.createElement("button");
    dead.disabled = true;
    const hidden = document.createElement("button");
    hidden.style.display = "none";
    const inHiddenBox = document.createElement("div");
    inHiddenBox.style.display = "none";
    inHiddenBox.appendChild(document.createElement("button"));
    const skip = document.createElement("button");
    skip.setAttribute("tabindex", "-1");
    const invisible = document.createElement("button");
    invisible.style.visibility = "hidden";
    wrap.append(dead, hidden, inHiddenBox, skip, invisible);
    render({ presentation: pres({ targets: [sel("commit-bar")] }) });
    input.focus();
    tab(input);
    expect(document.activeElement).toBe(commit);
  });

  it("treats a hole target that is itself focusable as a stop", () => {
    const own = target("settings-ok", { x: 0, y: 0, w: 60, h: 30 }, "button");
    const h = render({ presentation: pres({ targets: [sel("settings-ok")] }) });
    tab(document.body);
    expect(document.activeElement).toBe(own);
    tab(own);
    expect(document.activeElement).toBe(btn(h, "btn-exit"));
  });

  it("follows the engine: a new step's holes replace the old stops", async () => {
    const a = target("a", { x: 0, y: 0, w: 50, h: 50 }, "button");
    const b = target("b", { x: 100, y: 0, w: 50, h: 50 }, "button");
    host = document.createElement("div");
    document.body.appendChild(host);
    app = mount(TutorialOverlayTestHost, {
      target: host,
      props: { initial: pres({ targets: [sel("a")] }) },
    });
    flushSync();
    const exit = btn(host, "btn-exit")!;
    tab(document.body);
    expect(document.activeElement).toBe(a);
    app.setPresentation(pres({ id: "two", index: 9, targets: [sel("b")] }));
    flushSync();
    await tick();
    // focus was inside the old hole, not the new one ⇒ moved to the card
    expect(document.activeElement).toBe(exit);
    tab(exit);
    expect(document.activeElement).toBe(b);
  });

  it("only Tab keydowns move focus (the keyup is swallowed too)", () => {
    const seen = vi.fn();
    window.addEventListener("keyup", seen);
    const { input, commit } = scene();
    render({ presentation: pres({ targets: [sel("commit-bar")] }) });
    input.focus();
    const up = key("Tab", input, "keyup");
    expect(up.defaultPrevented).toBe(true);
    expect(seen).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    expect(commit).not.toBe(document.activeElement);
    window.removeEventListener("keyup", seen);
  });
});

describe("TutorialOverlay — keyboard focus", () => {
  it("focuses the primary button first", async () => {
    const h = render({
      presentation: pres({ mode: "info", canGoBack: true }),
      onPrimary: () => {},
      primaryLabelKey: "tutorialUi.continue",
    });
    await tick();
    expect(document.activeElement).toBe(btn(h, "btn-primary"));
  });

  it("falls back to Next, then to Exit", async () => {
    const h = render({ presentation: pres({ mode: "info" }) });
    await tick();
    expect(document.activeElement).toBe(btn(h, "btn-next"));
    unmount(app);
    host.remove();
    const h2 = render({ presentation: pres({ mode: "action" }) });
    await tick();
    expect(document.activeElement).toBe(btn(h2, "btn-exit"));
  });

  it("skips a disabled primary button (setup running) and lands on Exit", async () => {
    const h = render({
      presentation: pres({ mode: "action", busy: true }),
      onPrimary: () => {},
    });
    await tick();
    expect(btn(h, "btn-primary")!.disabled).toBe(true);
    expect(document.activeElement).toBe(btn(h, "btn-exit"));
  });

  it("does not steal focus from a field inside a hole", async () => {
    const wrap = target("commit-bar", { x: 50, y: 600, w: 400, h: 60 });
    const input = document.createElement("input");
    wrap.appendChild(input);
    input.focus();
    render({
      presentation: pres({ mode: "info", targets: [sel("commit-bar")] }),
    });
    await tick();
    expect(document.activeElement).toBe(input);
  });

  it("moves focus to the card when focus was elsewhere on the page", async () => {
    const stray = document.createElement("button");
    page.appendChild(stray);
    stray.focus();
    const h = render({ presentation: pres({ mode: "info" }) });
    await tick();
    expect(document.activeElement).toBe(btn(h, "btn-next"));
  });

  function mountHost(initial: TutorialPresentation) {
    host = document.createElement("div");
    document.body.appendChild(host);
    app = mount(TutorialOverlayTestHost, { target: host, props: { initial } });
    flushSync();
    return host;
  }

  it("re-aims on every new step, and leaves the field alone when the user is typing", async () => {
    const wrap = target("commit-bar", { x: 50, y: 600, w: 400, h: 60 });
    const input = document.createElement("input");
    wrap.appendChild(input);
    const h = mountHost(pres({ mode: "action" }));
    await tick();
    expect(document.activeElement).toBe(btn(h, "btn-exit"));
    // the next step is an info step: focus follows to its Next button
    app.setPresentation(pres({ id: "tour", index: 9, mode: "info" }));
    flushSync();
    await tick();
    expect(document.activeElement).toBe(btn(h, "btn-next"));
    // the step after has the commit bar as its hole and the user is typing in it
    input.focus();
    app.setPresentation(
      pres({
        id: "commit",
        index: 10,
        mode: "action",
        targets: [sel("commit-bar")],
      }),
    );
    flushSync();
    await tick();
    expect(document.activeElement).toBe(input);
  });

  it("moves to the real buttons once a busy step finishes its setup", async () => {
    const h = mountHost(pres({ mode: "info", busy: true }));
    await tick();
    expect(document.activeElement).toBe(btn(h, "btn-exit")); // Next disabled
    app.setPresentation(pres({ mode: "info", busy: false }));
    flushSync();
    await tick();
    expect(document.activeElement).toBe(btn(h, "btn-next"));
  });

  it("does not yank focus when a setup ends while the user is on another card control", async () => {
    const h = mountHost(pres({ mode: "info", busy: true, canGoBack: true }));
    await tick();
    const back = btn(h, "btn-back")!;
    back.disabled = false;
    back.focus();
    app.setPresentation(pres({ mode: "info", busy: false, canGoBack: true }));
    flushSync();
    await tick();
    expect(document.activeElement).toBe(back);
  });

  it("puts focus on the safe choice in the exit prompt and back on the card afterwards", async () => {
    const h = render({ presentation: pres({ mode: "info" }) });
    await tick();
    btn(h, "btn-exit")!.click();
    flushSync();
    expect(document.activeElement).toBe(btn(h, "btn-exit-cancel"));
    btn(h, "btn-exit-cancel")!.click();
    flushSync();
    await tick();
    expect(document.activeElement).toBe(btn(h, "btn-next"));
  });

  it("Escape closing the exit prompt also returns focus to the card", async () => {
    const h = render({ presentation: pres({ mode: "info" }) });
    await tick();
    btn(h, "btn-exit")!.click();
    flushSync();
    key("Escape", document.activeElement!);
    flushSync();
    await tick();
    expect(h.querySelector(".confirm")).toBeNull();
    expect(document.activeElement).toBe(btn(h, "btn-next"));
  });

  it("a click on the dimmed area does not pull focus off the card", async () => {
    const h = render({ presentation: pres({ mode: "info" }) });
    await tick();
    const next = btn(h, "btn-next")!;
    expect(document.activeElement).toBe(next);
    // mousedown's default action is what moves focus to the clicked thing
    const down = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    dim(h).dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(next);
  });

  it("does nothing after the overlay is destroyed", async () => {
    const stray = document.createElement("button");
    page.appendChild(stray);
    render({ presentation: pres({ mode: "info" }) });
    unmount(app);
    app = undefined;
    stray.focus();
    await tick();
    expect(document.activeElement).toBe(stray);
  });
});

describe("TutorialOverlay — context menu", () => {
  function ctx(on: EventTarget) {
    const e = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    on.dispatchEvent(e);
    return e;
  }

  it("is blocked outside the holes", () => {
    const seen = vi.fn();
    window.addEventListener("contextmenu", seen);
    target("a", { x: 100, y: 100, w: 50, h: 50 });
    render({ presentation: pres({ targets: [sel("a")] }) });
    const e = ctx(document.body);
    expect(e.defaultPrevented).toBe(true);
    expect(seen).not.toHaveBeenCalled();
    window.removeEventListener("contextmenu", seen);
  });

  it("is blocked on the overlay itself (the dim layer)", () => {
    const h = render();
    expect(ctx(dim(h)).defaultPrevented).toBe(true);
  });

  it("passes inside a hole target", () => {
    const seen = vi.fn();
    window.addEventListener("contextmenu", seen);
    const wrap = target("graph", { x: 0, y: 0, w: 500, h: 500 });
    const row = document.createElement("div");
    wrap.appendChild(row);
    render({ presentation: pres({ targets: [sel("graph")] }) });
    const e = ctx(row);
    expect(e.defaultPrevented).toBe(false);
    expect(seen).toHaveBeenCalledTimes(1);
    window.removeEventListener("contextmenu", seen);
  });
});

describe("TutorialOverlay — coach card", () => {
  it("shows the counter, title and body", () => {
    const h = render({
      presentation: pres({
        index: 8,
        total: 24,
        titleKey: "tutorialUi.exit",
        bodyKey: "tutorialUi.working",
      }),
    });
    const card = h.querySelector(".card") as HTMLElement;
    expect(card.getAttribute("role")).toBe("dialog");
    expect(card.querySelector(".counter")!.textContent).toBe("8 / 24");
    expect(card.querySelector(".title")!.textContent).toBe("Exit tutorial");
    expect(card.querySelector(".body")!.textContent).toContain("Working…");
    expect(card.querySelector(".body")!.getAttribute("aria-live")).toBe(
      "polite",
    );
    const bar = card.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute("aria-valuenow")).toBe("8");
    expect(bar.getAttribute("aria-valuemax")).toBe("24");
  });

  it("is centred when there are no targets or placement is 'center'", () => {
    expect((render().querySelector(".card") as HTMLElement).dataset.side).toBe(
      "center",
    );
    unmount(app);
    host.remove();
    target("a", { x: 100, y: 100, w: 50, h: 50 });
    const h = render({
      presentation: pres({ targets: [sel("a")], placement: "center" }),
    });
    expect((h.querySelector(".card") as HTMLElement).dataset.side).toBe(
      "center",
    );
  });

  it("sits beside the first hole and never over it", () => {
    target("a", { x: 100, y: 200, w: 120, h: 60 });
    const h = render({ presentation: pres({ targets: [sel("a")] }) });
    const card = h.querySelector(".card") as HTMLElement;
    expect(card.dataset.side).toBe("right");
    const left = parseFloat(card.style.left);
    expect(left).toBeGreaterThanOrEqual(100 + 120 + 6); // clear of the padded hole
  });

  it("shows the default hint when blocked, or the step's own hintKey", () => {
    let h = render({ presentation: pres({ blocked: true }) });
    expect(h.querySelector(".hint")!.textContent).toContain(
      "Only the highlighted area is active",
    );
    unmount(app);
    host.remove();
    h = render({
      presentation: pres({ blocked: true, hintKey: "tutorialUi.working" }),
    });
    expect(h.querySelector(".hint")!.textContent).toBe("Working…");
    unmount(app);
    host.remove();
    h = render({ presentation: pres({ blocked: false }) });
    expect(h.querySelector(".hint")).toBeNull();
  });

  it("shows a spinner and disables navigation while busy", () => {
    const h = render({
      presentation: pres({ busy: true, mode: "info", canGoBack: true }),
      onPrimary: () => {},
    });
    expect(h.querySelector(".spinner")).not.toBeNull();
    expect(btn(h, "btn-next")!.disabled).toBe(true);
    expect(btn(h, "btn-back")!.disabled).toBe(true);
    expect(btn(h, "btn-primary")!.disabled).toBe(true);
    // leaving is still possible
    expect(btn(h, "btn-exit")!.disabled).toBe(false);
  });

  it("Back is only offered when the step can go back", () => {
    expect(btn(render(), "btn-back")).toBeNull();
    unmount(app);
    host.remove();
    expect(
      btn(render({ presentation: pres({ canGoBack: true }) }), "btn-back"),
    ).not.toBeNull();
  });

  it("Next is only offered on info steps", () => {
    expect(btn(render(), "btn-next")).toBeNull();
    unmount(app);
    host.remove();
    expect(
      btn(render({ presentation: pres({ mode: "info" }) }), "btn-next"),
    ).not.toBeNull();
  });

  it("fires onNext / onBack / onPrimary", () => {
    const onNext = vi.fn();
    const onBack = vi.fn();
    const onPrimary = vi.fn();
    const h = render({
      presentation: pres({ mode: "info", canGoBack: true }),
      onNext,
      onBack,
      onPrimary,
      primaryLabelKey: "common.create",
    });
    expect(btn(h, "btn-primary")!.textContent!.trim()).toBe("Create");
    btn(h, "btn-next")!.click();
    btn(h, "btn-back")!.click();
    btn(h, "btn-primary")!.click();
    expect(onNext).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
    expect(onPrimary).toHaveBeenCalledOnce();
  });

  it("has no primary button unless onPrimary is given; default label is Continue", () => {
    expect(btn(render(), "btn-primary")).toBeNull();
    unmount(app);
    host.remove();
    const h = render({ onPrimary: () => {} });
    expect(btn(h, "btn-primary")!.textContent!.trim()).toBe("Continue");
  });

  it("shows an error with Retry, holds Next, and Retry fires onRetry", () => {
    const onRetry = vi.fn();
    const onNext = vi.fn();
    const h = render({
      presentation: pres({ mode: "info" }),
      error: "Could not create the demo repository",
      onRetry,
      onNext,
    });
    expect(h.querySelector(".error")!.textContent).toBe(
      "Could not create the demo repository",
    );
    expect(btn(h, "btn-next")!.disabled).toBe(true);
    btn(h, "btn-retry")!.click();
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onNext).not.toHaveBeenCalled();
  });

  it("shows no Retry without an error", () => {
    const h = render();
    expect(btn(h, "btn-retry")).toBeNull();
    expect(h.querySelector(".error")).toBeNull();
  });
});

describe("TutorialOverlay — exit", () => {
  it("asks first: Exit opens a confirm, nothing is called yet", () => {
    const onExit = vi.fn();
    const h = render({ onExit });
    btn(h, "btn-exit")!.click();
    flushSync();
    expect(onExit).not.toHaveBeenCalled();
    expect(h.querySelector(".confirm")).not.toBeNull();
    expect(h.querySelector(".confirm-title")!.textContent).toBe(
      "Exit the tutorial?",
    );
  });

  it("only the confirm button calls onExit", () => {
    const onExit = vi.fn();
    const h = render({ onExit });
    btn(h, "btn-exit")!.click();
    flushSync();
    btn(h, "btn-exit-confirm")!.click();
    expect(onExit).toHaveBeenCalledOnce();
  });

  it("Keep going dismisses the confirm without exiting", () => {
    const onExit = vi.fn();
    const h = render({ onExit });
    btn(h, "btn-exit")!.click();
    flushSync();
    btn(h, "btn-exit-cancel")!.click();
    flushSync();
    expect(onExit).not.toHaveBeenCalled();
    expect(h.querySelector(".confirm")).toBeNull();
    expect(btn(h, "btn-exit")).not.toBeNull();
  });

  it("Escape closes the confirm (and does not reach the app)", () => {
    const onExit = vi.fn();
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    const h = render({ onExit });
    btn(h, "btn-exit")!.click();
    flushSync();
    const e = key("Escape");
    flushSync();
    expect(e.defaultPrevented).toBe(true);
    expect(seen).not.toHaveBeenCalled();
    expect(h.querySelector(".confirm")).toBeNull();
    expect(onExit).not.toHaveBeenCalled();
    window.removeEventListener("keydown", seen);
  });

  it("a new step starts without a stale confirm", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    app = mount(TutorialOverlayTestHost, {
      target: host,
      props: { initial: pres() },
    });
    flushSync();
    btn(host, "btn-exit")!.click();
    flushSync();
    expect(host.querySelector(".confirm")).not.toBeNull();
    app.setPresentation(pres({ id: "next-step", index: 9 }));
    flushSync();
    expect(host.querySelector(".confirm")).toBeNull();
  });

  it("follows the engine: a new step's targets replace the old holes at once", () => {
    target("a", { x: 100, y: 100, w: 50, h: 50 });
    target("b", { x: 300, y: 300, w: 50, h: 50 });
    target("c", { x: 500, y: 500, w: 50, h: 50 });
    host = document.createElement("div");
    document.body.appendChild(host);
    app = mount(TutorialOverlayTestHost, {
      target: host,
      props: { initial: pres({ targets: [sel("a")] }) },
    });
    flushSync();
    expect(subpaths(host)).toBe(1 + 1);
    app.setPresentation(pres({ id: "two", targets: [sel("b"), sel("c")] }));
    flushSync();
    expect(subpaths(host)).toBe(1 + 2); // no animation frame needed
  });
});
