import { test, expect } from "./helpers";

// The branch chip's context menu opens a "Properties…" dialog that
// can set the branch's upstream, and the choice round-trips through git.
test("branch Properties dialog sets an upstream that persists", async ({
  page,
}) => {
  const chip = page.locator(".chip-branch", { hasText: "feature-x" }).first();

  // Open Properties, choose an upstream, confirm.
  await chip.click({ button: "right" });
  await page.getByText("Properties…", { exact: true }).click();
  const dialog = page.locator('[aria-label="Edit branch"]');
  await dialog.waitFor();
  await dialog.locator("select.up-input").selectOption("origin/main");
  await dialog.locator("button.primary").click();
  await dialog.waitFor({ state: "hidden" });

  // Re-open Properties: the select is now seeded with the persisted upstream.
  await page
    .locator(".chip-branch", { hasText: "feature-x" })
    .first()
    .click({ button: "right" });
  await page.getByText("Properties…", { exact: true }).click();
  await dialog.waitFor();
  await expect(dialog.locator("select.up-input")).toHaveValue("origin/main");
});
