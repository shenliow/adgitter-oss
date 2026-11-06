/**
 * Pure viewport-clamping geometry for floating menus (dropdowns, context
 * menus, and their submenus). Kept free of any DOM access so it is
 * unit-testable without a browser: components measure their own anchor/menu
 * rects (via `getBoundingClientRect`) and the viewport, then hand the plain
 * numbers to these functions to get back a position that is guaranteed to
 * stay fully on screen.
 *
 * Two flavors, matching the two shapes of floating menu in this app:
 *  - `placeMenu`: anchored below an element (SplitButton's dropdown) or at a
 *    raw point (ContextMenu's top-level menu, anchored at the click point
 *    with a zero-size rect). Horizontally it starts flush with the anchor's
 *    left edge and shifts left just enough to stay on screen. Vertically it
 *    opens below the anchor, flipping to open above it if there's no room
 *    below (and clamping as a last resort in a viewport too small for
 *    either).
 *  - `placeSubmenu`: anchored beside a parent menu item (ContextMenu's
 *    flyout). Opens to the right by default, flipping to the left if it
 *    would run off the right edge. Vertically it top-aligns with the parent
 *    item, shifting up if it would run off the bottom.
 */

/** A rect in viewport (client) coordinates — a subset of DOMRect. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Minimum distance a menu must keep from every viewport edge. */
export const DEFAULT_MARGIN = 4;

/** Clamp `value` (the start of a `size`-long span) so the span stays fully
 *  within `[margin, viewportSize - margin]`. If the span is bigger than the
 *  viewport allows, it's pinned to `margin` rather than going negative. */
function clampAxis(
  value: number,
  size: number,
  viewportSize: number,
  margin: number,
): number {
  const max = Math.max(margin, viewportSize - margin - size);
  return Math.min(Math.max(value, margin), max);
}

export interface PlaceMenuOptions {
  /** Gap between the anchor and the menu when it fits below/above it. */
  gap?: number;
  /** Minimum distance from every viewport edge. */
  margin?: number;
}

/**
 * Place a menu that defaults to opening below-left of `anchor` (a real
 * element rect, or a zero-size rect at a point for a context menu).
 */
export function placeMenu(
  anchor: Rect,
  menu: Size,
  viewport: Size,
  opts: PlaceMenuOptions = {},
): Point {
  const gap = opts.gap ?? 0;
  const margin = opts.margin ?? DEFAULT_MARGIN;

  const x = clampAxis(anchor.x, menu.width, viewport.width, margin);

  const below = anchor.y + anchor.height + gap;
  let y: number;
  if (below + menu.height > viewport.height - margin) {
    const above = anchor.y - menu.height - gap;
    y =
      above >= margin
        ? above
        : clampAxis(below, menu.height, viewport.height, margin);
  } else {
    y = below;
  }

  return { x, y: Math.max(y, margin) };
}

export interface PlaceSubmenuOptions {
  /** Gap between the parent item and the submenu. */
  gap?: number;
  /** Minimum distance from every viewport edge. */
  margin?: number;
}

/**
 * Place a submenu flyout beside `parent` (a parent menu item's rect).
 * Defaults to opening to the right, flipping to the left when it wouldn't
 * fit; top-aligns with the parent, shifting up when it wouldn't fit below.
 */
export function placeSubmenu(
  parent: Rect,
  submenu: Size,
  viewport: Size,
  opts: PlaceSubmenuOptions = {},
): Point {
  const gap = opts.gap ?? 4;
  const margin = opts.margin ?? DEFAULT_MARGIN;

  const right = parent.x + parent.width + gap;
  let x: number;
  if (right + submenu.width > viewport.width - margin) {
    const left = parent.x - submenu.width - gap;
    x = left >= margin ? left : margin;
  } else {
    x = right;
  }

  const y = clampAxis(parent.y, submenu.height, viewport.height, margin);

  return { x, y };
}
