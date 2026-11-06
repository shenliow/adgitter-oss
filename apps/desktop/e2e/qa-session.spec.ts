// QA pass: end-to-end smokes for this session's features that were
// otherwise only unit/screenshot-verified — the auto-dismissing toast (#23),
// the locale switcher now that every locale is translated (#27), and the
// Welcome-screen repo-scope settings gating (#21).
import { test, expect } from "./helpers";

test("a notice toast shows a countdown bar and auto-dismisses (#23)", async ({
  page,
}) => {
  await page.getByTitle("Pull").click();
  const toast = page.locator(".toast.notice");
  await expect(toast).toBeVisible();
  // The shrinking countdown bar is present while it's up…
  await expect(toast.locator(".bar")).toHaveCount(1);
  // …and it clears itself once the countdown + fade elapse.
  await expect(toast).toBeHidden({ timeout: 6000 });
});

test("switching locale re-renders the UI in that language (#27)", async ({
  page,
}) => {
  await page.locator(".icon-btn.avatar").click();
  const select = page.locator("select").first();
  await select.waitFor({ state: "visible" });

  // The logout item carries an arrow glyph ("➜ …"), so match on a substring.
  await select.selectOption("ja");
  await expect(page.getByText("ログアウト")).toBeVisible();

  await select.selectOption("de");
  await expect(page.getByText("Abmelden")).toBeVisible();

  // Back to the source language.
  await select.selectOption("en");
  await expect(page.getByText("Log out")).toBeVisible();
});

test("Welcome-screen General settings disable the repo-only remote fields (#21)", async ({
  page,
}) => {
  await page.locator(".back-repo").click(); // leave the repo → Welcome
  await page.locator('button[aria-label="Settings"]').click();
  await page.getByRole("button", { name: "General" }).first().click();

  const remote = page.locator(
    'input[placeholder="https://github.com/you/repo.git"]',
  );
  await expect(remote).toBeDisabled();
  await expect(remote).toHaveValue("");

  // Log Anytime is likewise repo-bound: on Welcome the whole page is disabled
  // and a notice explains why (aligned with the General Remote section).
  await page.getByRole("button", { name: "Log Anytime" }).first().click();
  await expect(page.locator(".norepo")).toBeVisible();
  await expect(
    page.locator(".controls input[type=checkbox]").first(),
  ).toBeDisabled();
});
