import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync, type ComponentProps } from "svelte";
import ResizeHandle from "./ResizeHandle.svelte";
import { PANEL_MAX_WIDTH, PANEL_MIN_WIDTH } from "../lib/panelWidth";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
});

function render(props: ComponentProps<typeof ResizeHandle>): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(ResizeHandle, { target: host, props });
  flushSync();
  return host;
}

function grip(h: HTMLDivElement): HTMLElement {
  return h.querySelector(".grip") as HTMLElement;
}

function valuenow(h: HTMLDivElement): number {
  return Number(grip(h).getAttribute("aria-valuenow"));
}

// jsdom has no PointerEvent; a MouseEvent carries clientX and dispatches under
// the pointer* names our listeners use (same trick as MetroGraph.gestures.test).
function firePointer(el: EventTarget, type: string, clientX: number) {
  el.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX }),
  );
  flushSync();
}

describe("ResizeHandle", () => {
  it("renders a labelled vertical separator reflecting the width", () => {
    const h = render({ side: "right", width: 320, label: "Resize panel" });
    const g = grip(h);
    expect(g.getAttribute("role")).toBe("separator");
    expect(g.getAttribute("aria-orientation")).toBe("vertical");
    expect(g.getAttribute("aria-label")).toBe("Resize panel");
    expect(g.classList.contains("grip-right")).toBe(true);
    expect(valuenow(h)).toBe(320);
  });

  it("a right-edge drag to the right widens the panel", () => {
    const h = render({ side: "right", width: 300, label: "r" });
    firePointer(grip(h), "pointerdown", 100);
    firePointer(window, "pointermove", 160); // +60px
    expect(valuenow(h)).toBe(360);
  });

  it("a left-edge drag to the left widens the panel", () => {
    const h = render({ side: "left", width: 300, label: "r" });
    firePointer(grip(h), "pointerdown", 100);
    firePointer(window, "pointermove", 60); // −40px on the left edge → wider
    expect(valuenow(h)).toBe(340);
  });

  it("clamps to the max width during a drag", () => {
    const h = render({ side: "right", width: 700, label: "r" });
    firePointer(grip(h), "pointerdown", 0);
    firePointer(window, "pointermove", 1000);
    expect(valuenow(h)).toBe(PANEL_MAX_WIDTH);
  });

  it("clamps to the min width during a drag", () => {
    const h = render({ side: "right", width: 260, label: "r" });
    firePointer(grip(h), "pointerdown", 500);
    firePointer(window, "pointermove", 0);
    expect(valuenow(h)).toBe(PANEL_MIN_WIDTH);
  });

  it("commits the final width on pointerup", () => {
    const onCommit = vi.fn();
    const h = render({ side: "right", width: 300, label: "r", onCommit });
    firePointer(grip(h), "pointerdown", 100);
    firePointer(window, "pointermove", 140);
    firePointer(window, "pointerup", 140);
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith(340);
  });

  it("stops tracking after pointerup", () => {
    const h = render({ side: "right", width: 300, label: "r" });
    firePointer(grip(h), "pointerdown", 100);
    firePointer(window, "pointermove", 140);
    firePointer(window, "pointerup", 140);
    // A stray move once the drag ended must not keep resizing.
    firePointer(window, "pointermove", 400);
    expect(valuenow(h)).toBe(340);
  });

  it("nudges with the arrow keys and commits", () => {
    const onCommit = vi.fn();
    const h = render({ side: "right", width: 320, label: "r", onCommit });
    grip(h).dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    flushSync();
    expect(valuenow(h)).toBe(336);
    expect(onCommit).toHaveBeenLastCalledWith(336);
  });
});
