import { describe, it, expect } from "vitest";
import { placeMenu, placeSubmenu, DEFAULT_MARGIN } from "./menuPlacement";

const viewport = { width: 1000, height: 800 };

describe("placeMenu", () => {
  it("fits: opens flush with the anchor's left edge, just below it", () => {
    const anchor = { x: 100, y: 50, width: 80, height: 30 };
    const menu = { width: 120, height: 80 };
    const pos = placeMenu(anchor, menu, viewport, { gap: 4 });
    expect(pos).toEqual({ x: 100, y: 84 });
  });

  it("fits at a raw point anchor (context menu), no gap", () => {
    const anchor = { x: 200, y: 150, width: 0, height: 0 };
    const menu = { width: 184, height: 120 };
    const pos = placeMenu(anchor, menu, viewport);
    expect(pos).toEqual({ x: 200, y: 150 });
  });

  it("right-edge overflow: shifts left to stay on screen", () => {
    const anchor = { x: 950, y: 50, width: 80, height: 30 };
    const menu = { width: 200, height: 80 };
    const pos = placeMenu(anchor, menu, viewport, { gap: 4 });
    // Right edge must land exactly at viewport.width - margin.
    expect(pos.x + menu.width).toBe(viewport.width - DEFAULT_MARGIN);
    expect(pos.x).toBeLessThan(950);
    expect(pos.y).toBe(84);
  });

  it("bottom-edge overflow: flips to open above the anchor", () => {
    const anchor = { x: 100, y: 700, width: 80, height: 30 };
    const menu = { width: 120, height: 150 };
    const pos = placeMenu(anchor, menu, viewport, { gap: 4 });
    // Opens above: bottom of menu sits `gap` above the anchor's top.
    expect(pos.y).toBe(anchor.y - menu.height - 4);
    expect(pos.y + menu.height).toBeLessThanOrEqual(
      viewport.height - DEFAULT_MARGIN,
    );
    expect(pos.x).toBe(100);
  });

  it("overflows both right and bottom at once", () => {
    const anchor = { x: 950, y: 750, width: 80, height: 30 };
    const menu = { width: 200, height: 150 };
    const pos = placeMenu(anchor, menu, viewport, { gap: 4 });
    expect(pos.x + menu.width).toBe(viewport.width - DEFAULT_MARGIN);
    expect(pos.y).toBe(anchor.y - menu.height - 4);
  });

  it("tiny viewport: menu bigger than viewport clamps to the margin, never negative", () => {
    const tiny = { width: 100, height: 100 };
    const anchor = { x: 10, y: 10, width: 20, height: 20 };
    const menu = { width: 300, height: 300 };
    const pos = placeMenu(anchor, menu, tiny, { gap: 4 });
    expect(pos.x).toBe(DEFAULT_MARGIN);
    expect(pos.y).toBe(DEFAULT_MARGIN);
    expect(pos.x).toBeGreaterThanOrEqual(0);
    expect(pos.y).toBeGreaterThanOrEqual(0);
  });

  it("respects a custom margin", () => {
    const anchor = { x: 950, y: 50, width: 80, height: 30 };
    const menu = { width: 200, height: 80 };
    const pos = placeMenu(anchor, menu, viewport, { gap: 4, margin: 10 });
    expect(pos.x + menu.width).toBe(viewport.width - 10);
  });
});

describe("placeSubmenu", () => {
  it("fits: opens to the right of the parent, top-aligned", () => {
    const parent = { x: 300, y: 200, width: 184, height: 30 };
    const submenu = { width: 150, height: 100 };
    const pos = placeSubmenu(parent, submenu, viewport, { gap: 4 });
    expect(pos).toEqual({ x: 300 + 184 + 4, y: 200 });
  });

  it("right-edge overflow: flips to open on the left of the parent", () => {
    const parent = { x: 900, y: 200, width: 184, height: 30 };
    const submenu = { width: 150, height: 100 };
    const pos = placeSubmenu(parent, submenu, viewport, { gap: 4 });
    expect(pos.x).toBe(parent.x - submenu.width - 4);
    expect(pos.x + submenu.width).toBeLessThanOrEqual(parent.x);
  });

  it("bottom-edge overflow: shifts up to stay on screen", () => {
    const parent = { x: 300, y: 750, width: 184, height: 30 };
    const submenu = { width: 150, height: 200 };
    const pos = placeSubmenu(parent, submenu, viewport, { gap: 4 });
    expect(pos.y + submenu.height).toBe(viewport.height - DEFAULT_MARGIN);
    expect(pos.y).toBeLessThan(parent.y);
  });

  it("overflows both right and bottom at once", () => {
    const parent = { x: 900, y: 750, width: 184, height: 30 };
    const submenu = { width: 150, height: 200 };
    const pos = placeSubmenu(parent, submenu, viewport, { gap: 4 });
    expect(pos.x).toBe(parent.x - submenu.width - 4);
    expect(pos.y + submenu.height).toBe(viewport.height - DEFAULT_MARGIN);
  });

  it("tiny viewport / parent near the left edge: clamps to the margin instead of going negative", () => {
    const tiny = { width: 200, height: 200 };
    const parent = { x: 10, y: 10, width: 184, height: 30 };
    const submenu = { width: 150, height: 100 };
    const pos = placeSubmenu(parent, submenu, tiny, { gap: 4 });
    // Neither the right (10+184+4+150=348) nor the left (10-150-4=-144) fit,
    // so it must clamp to the margin rather than go negative.
    expect(pos.x).toBe(DEFAULT_MARGIN);
    expect(pos.x).toBeGreaterThanOrEqual(0);
  });
});
