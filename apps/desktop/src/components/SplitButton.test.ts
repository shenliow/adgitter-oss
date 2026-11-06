import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync, type ComponentProps } from "svelte";
import SplitButton from "./SplitButton.svelte";
import { placeMenu } from "../lib/menuPlacement";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
});

function render(over: Partial<ComponentProps<typeof SplitButton>> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(SplitButton, {
    target: host,
    props: {
      label: "Start",
      options: [{ label: "Go", onSelect: () => {} }],
      ...over,
    },
  });
  flushSync();
  return host;
}

describe("SplitButton", () => {
  it("renders the label and is closed by default", () => {
    const h = render();
    expect(h.querySelector(".trigger")?.textContent).toContain("Start");
    expect(h.querySelector(".menu")).toBeNull();
  });

  it("opens the menu with all options on click", () => {
    const h = render({
      options: [
        { label: "New Branch & Go", onSelect: () => {} },
        { label: "Just Go", onSelect: () => {} },
      ],
    });
    (h.querySelector(".trigger") as HTMLButtonElement).click();
    flushSync();
    const items = h.querySelectorAll(".menu .item");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("New Branch & Go");
  });

  it("dispatches the chosen option's handler and closes", () => {
    const first = vi.fn();
    const second = vi.fn();
    const h = render({
      options: [
        { label: "New Branch & Go", onSelect: first },
        { label: "Just Go", onSelect: second },
      ],
    });
    (h.querySelector(".trigger") as HTMLButtonElement).click();
    flushSync();
    (h.querySelectorAll(".menu .item")[1] as HTMLButtonElement).click();
    flushSync();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(h.querySelector(".menu")).toBeNull();
  });

  it("does not open when disabled", () => {
    const h = render({ disabled: true });
    (h.querySelector(".trigger") as HTMLButtonElement).click();
    flushSync();
    expect(h.querySelector(".menu")).toBeNull();
  });
});

describe("SplitButton primary-action mode (onClick)", () => {
  it("without onClick, the whole trigger still opens the menu (unchanged default)", () => {
    const h = render();
    expect(h.querySelectorAll(".trigger")).toHaveLength(1);
    expect(h.querySelector(".label-segment")).toBeNull();
    expect(h.querySelector(".caret-segment")).toBeNull();
  });

  it("with onClick, renders two segments: a label action and a caret menu toggle", () => {
    const onClick = vi.fn();
    const h = render({ onClick });
    const label = h.querySelector(".label-segment") as HTMLButtonElement;
    const caret = h.querySelector(".caret-segment") as HTMLButtonElement;
    expect(label).not.toBeNull();
    expect(caret).not.toBeNull();
    expect(h.querySelector(".menu")).toBeNull();

    label.click();
    flushSync();
    expect(onClick).toHaveBeenCalledTimes(1);
    // Clicking the label segment must not open the menu.
    expect(h.querySelector(".menu")).toBeNull();

    caret.click();
    flushSync();
    expect(h.querySelector(".menu")).not.toBeNull();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disables both segments and blocks both actions when disabled", () => {
    const onClick = vi.fn();
    const h = render({ onClick, disabled: true });
    const label = h.querySelector(".label-segment") as HTMLButtonElement;
    const caret = h.querySelector(".caret-segment") as HTMLButtonElement;
    expect(label.disabled).toBe(true);
    expect(caret.disabled).toBe(true);
    label.click();
    caret.click();
    flushSync();
    expect(onClick).not.toHaveBeenCalled();
    expect(h.querySelector(".menu")).toBeNull();
  });

  it("renders an optional badge next to the label", () => {
    const h = render({ onClick: () => {}, badge: 3 });
    expect(h.querySelector(".label-segment .badge")?.textContent).toBe("3");
  });
});

describe("SplitButton viewport clamping (menu placement)", () => {
  const viewport = { width: 1000, height: 800 };
  const anchorRect = {
    x: 900,
    y: 700,
    width: 80,
    height: 30,
    top: 700,
    left: 900,
    right: 980,
    bottom: 730,
    toJSON() {
      return this;
    },
  } as DOMRect;
  const menuRect = {
    x: 0,
    y: 0,
    width: 200,
    height: 150,
    top: 0,
    left: 0,
    right: 200,
    bottom: 150,
    toJSON() {
      return this;
    },
  } as DOMRect;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clamps the dropdown into the viewport when the trigger sits near the bottom-right edge", () => {
    vi.stubGlobal("innerWidth", viewport.width);
    vi.stubGlobal("innerHeight", viewport.height);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this.classList.contains("split")) return anchorRect;
        if (this.classList.contains("menu")) return menuRect;
        return {
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          toJSON() {
            return this;
          },
        } as DOMRect;
      },
    );

    const h = render();
    (h.querySelector(".trigger") as HTMLButtonElement).click();
    flushSync();

    const expected = placeMenu(
      anchorRect,
      { width: menuRect.width, height: menuRect.height },
      viewport,
      { gap: 4 },
    );
    const menu = h.querySelector(".menu") as HTMLElement;
    expect(menu.style.left).toBe(`${expected.x}px`);
    expect(menu.style.top).toBe(`${expected.y}px`);
    // Sanity: this anchor genuinely overflows both edges, so the clamped
    // position must differ from the naive below-left placement.
    expect(expected.x).not.toBe(anchorRect.x);
    expect(expected.y).not.toBe(anchorRect.y + anchorRect.height + 4);

    vi.unstubAllGlobals();
  });
});
