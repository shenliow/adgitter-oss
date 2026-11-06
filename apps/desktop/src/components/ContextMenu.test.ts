import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync, type ComponentProps } from "svelte";
import ContextMenu from "./ContextMenu.svelte";
import { placeMenu, placeSubmenu } from "../lib/menuPlacement";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
});

function render(props: ComponentProps<typeof ContextMenu>): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(ContextMenu, { target: host, props });
  flushSync();
  return host;
}

describe("ContextMenu", () => {
  it("renders items and a separator", () => {
    const h = render({
      x: 10,
      y: 20,
      onClose: () => {},
      items: [
        { label: "Revert" },
        { label: "---" },
        { label: "Drop", danger: true },
      ],
    });
    const buttons = [...h.querySelectorAll('[role="menuitem"]')];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual([
      "Revert",
      "Drop",
    ]);
    expect(h.querySelector('[role="separator"]')).not.toBeNull();
  });

  it("fires the item's onSelect and then closes", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const h = render({
      x: 0,
      y: 0,
      onClose,
      items: [{ label: "Revert", onSelect }],
    });
    (h.querySelector('[role="menuitem"]') as HTMLButtonElement).click();
    flushSync();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("does not fire onSelect for a disabled item", () => {
    const onSelect = vi.fn();
    const h = render({
      x: 0,
      y: 0,
      onClose: () => {},
      items: [{ label: "Reset", disabled: true, onSelect }],
    });
    const btn = h.querySelector('[role="menuitem"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    btn.click();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("closes on Escape and on backdrop click", () => {
    const onClose = vi.fn();
    const h = render({ x: 0, y: 0, onClose, items: [{ label: "Revert" }] });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    (h.querySelector(".backdrop") as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("renders a submenu indicator on a parent item, not on a plain one", () => {
    const h = render({
      x: 0,
      y: 0,
      onClose: () => {},
      items: [
        { label: "Plain" },
        {
          label: "Merge X into…",
          children: [{ label: "main" }, { label: "dev" }],
        },
      ],
    });
    const buttons = [...h.querySelectorAll('[role="menuitem"]')];
    // The submenu isn't open yet, so only the two top-level items render.
    expect(buttons).toHaveLength(2);
    expect(buttons[0].querySelector(".submenu-indicator")).toBeNull();
    expect(buttons[1].querySelector(".submenu-indicator")).not.toBeNull();
    expect(buttons[1].getAttribute("aria-haspopup")).toBe("menu");
    expect(buttons[1].getAttribute("aria-expanded")).toBe("false");
  });

  it("opens a submenu on hover and lists its children", () => {
    const h = render({
      x: 0,
      y: 0,
      onClose: () => {},
      items: [
        {
          label: "Merge X into…",
          children: [{ label: "main" }, { label: "dev" }],
        },
      ],
    });
    const parent = h.querySelector('[role="menuitem"]') as HTMLButtonElement;
    parent.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    flushSync();
    expect(parent.getAttribute("aria-expanded")).toBe("true");
    const childLabels = [
      ...h.querySelectorAll('.submenu [role="menuitem"]'),
    ].map((b) => b.textContent?.trim());
    expect(childLabels).toEqual(["main", "dev"]);
  });

  it("clicking a parent toggles its submenu and ignores its own onSelect", () => {
    const onSelect = vi.fn();
    const h = render({
      x: 0,
      y: 0,
      onClose: () => {},
      items: [{ label: "Parent", onSelect, children: [{ label: "Child" }] }],
    });
    const parent = h.querySelector('[role="menuitem"]') as HTMLButtonElement;

    parent.click();
    flushSync();
    expect(onSelect).not.toHaveBeenCalled();
    expect(h.querySelector(".submenu")).not.toBeNull();

    parent.click();
    flushSync();
    expect(h.querySelector(".submenu")).toBeNull();
  });

  it("selecting a submenu child fires its onSelect and closes the whole menu", () => {
    const onClose = vi.fn();
    const childSelect = vi.fn();
    const parentSelect = vi.fn();
    const h = render({
      x: 0,
      y: 0,
      onClose,
      items: [
        {
          label: "Parent",
          onSelect: parentSelect,
          children: [{ label: "Child", onSelect: childSelect }],
        },
      ],
    });
    const parent = h.querySelector('[role="menuitem"]') as HTMLButtonElement;
    parent.click();
    flushSync();
    const child = h.querySelector(
      '.submenu [role="menuitem"]',
    ) as HTMLButtonElement;
    child.click();
    flushSync();
    expect(childSelect).toHaveBeenCalledOnce();
    expect(parentSelect).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("a disabled parent never opens its submenu", () => {
    const h = render({
      x: 0,
      y: 0,
      onClose: () => {},
      items: [
        { label: "Parent", disabled: true, children: [{ label: "Child" }] },
      ],
    });
    const parent = h.querySelector('[role="menuitem"]') as HTMLButtonElement;
    expect(parent.disabled).toBe(true);

    parent.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    flushSync();
    expect(h.querySelector(".submenu")).toBeNull();

    parent.click();
    flushSync();
    expect(h.querySelector(".submenu")).toBeNull();
  });

  it("moving the pointer to a sibling item closes the open submenu", () => {
    const h = render({
      x: 0,
      y: 0,
      onClose: () => {},
      items: [{ label: "A", children: [{ label: "A1" }] }, { label: "B" }],
    });
    const [a, b] = [
      ...h.querySelectorAll('[role="menuitem"]'),
    ] as HTMLButtonElement[];

    a.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    flushSync();
    expect(h.querySelector(".submenu")).not.toBeNull();

    b.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    flushSync();
    expect(h.querySelector(".submenu")).toBeNull();
  });

  it("Escape closes the whole menu even while a submenu is open", () => {
    const onClose = vi.fn();
    const h = render({
      x: 0,
      y: 0,
      onClose,
      items: [{ label: "Parent", children: [{ label: "Child" }] }],
    });
    const parent = h.querySelector('[role="menuitem"]') as HTMLButtonElement;
    parent.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    flushSync();
    expect(h.querySelector(".submenu")).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("ContextMenu viewport clamping", () => {
  const viewport = { width: 1000, height: 800 };

  function rectMock(overrides: Partial<DOMRect> = {}): DOMRect {
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
      ...overrides,
    } as DOMRect;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("clamps the top-level menu when it would overflow the right/bottom edges", () => {
    vi.stubGlobal("innerWidth", viewport.width);
    vi.stubGlobal("innerHeight", viewport.height);
    const topMenuRect = rectMock({ width: 200, height: 150 });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this.classList.contains("submenu")) return rectMock();
        if (this.classList.contains("menu")) return topMenuRect;
        return rectMock();
      },
    );

    const h = render({
      x: 950,
      y: 750,
      onClose: () => {},
      items: [{ label: "Revert" }],
    });

    const expected = placeMenu(
      { x: 950, y: 750, width: 0, height: 0 },
      { width: topMenuRect.width, height: topMenuRect.height },
      viewport,
    );
    const menu = h.querySelector("ul.menu") as HTMLElement;
    expect(menu.style.left).toBe(`${expected.x}px`);
    expect(menu.style.top).toBe(`${expected.y}px`);
    // Sanity: the raw click point genuinely overflows both edges.
    expect(expected.x).not.toBe(950);
    expect(expected.y).not.toBe(750);
  });

  it("does not move the top-level menu when it already fits (regression check)", () => {
    vi.stubGlobal("innerWidth", viewport.width);
    vi.stubGlobal("innerHeight", viewport.height);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this.classList.contains("menu"))
          return rectMock({ width: 150, height: 100 });
        return rectMock();
      },
    );

    const h = render({
      x: 100,
      y: 100,
      onClose: () => {},
      items: [{ label: "Revert" }],
    });

    const menu = h.querySelector("ul.menu") as HTMLElement;
    expect(menu.style.left).toBe("100px");
    expect(menu.style.top).toBe("100px");
  });

  it("flips the submenu to the left of the parent item when it would overflow the right edge", () => {
    vi.stubGlobal("innerWidth", viewport.width);
    vi.stubGlobal("innerHeight", viewport.height);
    const parentRect = rectMock({ x: 850, y: 300, width: 184, height: 30 });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this.classList.contains("submenu")) {
          return rectMock({ width: 150, height: 100 });
        }
        if (this.tagName === "LI" && this.classList.contains("item")) {
          return parentRect;
        }
        if (this.classList.contains("menu")) {
          return rectMock({ width: 150, height: 100 });
        }
        return rectMock();
      },
    );

    const h = render({
      x: 100,
      y: 100,
      onClose: () => {},
      items: [
        {
          label: "Merge X into…",
          children: [{ label: "main" }, { label: "dev" }],
        },
      ],
    });
    const parent = h.querySelector('[role="menuitem"]') as HTMLButtonElement;
    parent.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    flushSync();

    const expected = placeSubmenu(
      parentRect,
      { width: 150, height: 100 },
      viewport,
      { gap: 4 },
    );
    const submenu = h.querySelector(".submenu") as HTMLElement;
    expect(submenu.style.left).toBe(`${expected.x}px`);
    expect(submenu.style.top).toBe(`${expected.y}px`);
    // Sanity: flips left of the parent instead of opening to its right.
    expect(expected.x).toBeLessThan(parentRect.x);
  });
});
