import { test, expect } from "./helpers";

test.describe("settings", () => {
  test("has no Webhooks or Hooks tab (both deferred features removed)", async ({
    page,
  }) => {
    await page.getByTitle("Settings").click();
    const modal = page.locator('.modal[role="dialog"]');
    await expect(modal).toBeVisible();

    // Sanity sentinel: the tab strip itself renders.
    await expect(
      modal.locator(".tabs button", { hasText: "General" }),
    ).toBeVisible();
    // 'Hooks' is a substring of 'Webhooks', so one count covers both removals.
    await expect(
      modal.locator(".tabs button", { hasText: "Hooks" }),
    ).toHaveCount(0);
  });

  test("General → hide ghosts removes the ghost commit's row from the graph", async ({
    page,
  }) => {
    const ghostRow = () => page.locator(".subject.ghost");
    await expect(ghostRow()).toBeVisible();

    await page.getByTitle("Settings").click();
    const modal = page.locator('.modal[role="dialog"]');
    await modal
      .locator(".field", { hasText: "Hide unreferenced commits" })
      .locator('input[type="checkbox"]')
      .check();
    await modal.getByRole("button", { name: "OK", exact: true }).click();
    await expect(modal).toBeHidden();

    await expect(ghostRow()).toHaveCount(0);
  });

  test("Personalize → applying the free Midnight theme recolours the graph", async ({
    page,
  }) => {
    const scroller = page.locator(".scroller");
    await page.getByTitle("Settings").click();
    const modal = page.locator('.modal[role="dialog"]');
    await modal.locator(".tabs button", { hasText: "Personalize" }).click();
    // Free themes are always owned → the row offers Apply, never Buy.
    await modal
      .locator(".gt-row", { hasText: "Midnight" })
      .getByRole("button", { name: "Apply" })
      .click();
    await modal.getByRole("button", { name: "OK", exact: true }).click();
    await expect(modal).toBeHidden();

    await expect(scroller).toHaveCSS("background-color", "rgb(17, 24, 39)");
  });

  test("main-screen Log Anytime toggle flips the Enable setting", async ({
    page,
  }) => {
    const btn = page.locator(".toolbar .log-anytime");
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "true");

    // The Log Anytime settings panel reflects the toolbar toggle.
    await page.getByTitle("Settings").click();
    const modal = page.locator('.modal[role="dialog"]');
    await modal.locator(".tabs button", { hasText: "Log Anytime" }).click();
    await expect(
      modal
        .locator("label.row", { hasText: "Enable Log Anytime" })
        .locator('input[type="checkbox"]'),
    ).toBeChecked();
  });
});
