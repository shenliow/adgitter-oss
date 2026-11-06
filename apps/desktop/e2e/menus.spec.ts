import { test, expect } from "./helpers";

test.describe("context menu viewport clamping", () => {
  // A small viewport makes clamping unavoidable: the default 1280×800 config
  // viewport has enough room that a right-click near a row's right edge
  // might never need to flip — shrinking it forces both axes to clamp.
  test.use({ viewport: { width: 480, height: 420 } });

  test("right-clicking a commit row near the bottom-right corner keeps the menu fully on screen", async ({
    page,
  }) => {
    const lastRow = page.locator("button.row").last();
    await lastRow.scrollIntoViewIfNeeded();
    const box = await lastRow.boundingBox();
    if (!box) throw new Error("commit row has no bounding box");

    // Near the row's bottom-right corner — as close to the viewport's
    // bottom-right as the rendered graph gets. Locator.click (rather than a
    // raw page.mouse.click at pre-computed coordinates) re-checks
    // actionability/stability right before clicking, which matters here:
    // `scrollIntoViewIfNeeded` above can still be settling when a plain
    // mouse.click fires at stale coordinates and misses the row entirely.
    await lastRow.click({
      button: "right",
      position: { x: box.width - 25, y: box.height - 10 },
    });

    const menu = page.locator('ul.menu[role="menu"]').first();
    await expect(menu).toBeVisible();
    const menuBox = await menu.boundingBox();
    if (!menuBox) throw new Error("context menu has no bounding box");

    const viewport = page.viewportSize();
    if (!viewport) throw new Error("no viewport size");

    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    expect(menuBox.y).toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width);
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height);
  });
});
