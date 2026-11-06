import { test, expect } from "./helpers";
import { execFileSync } from "node:child_process";

/**
 * Remote-auth gating. With a blank PAT the app authenticates by SSH key
 * (ssh-agent / a default key on the Rust side), so an SSH remote is NOT blocked
 * — the only blocking case is a PAT set on a non-HTTPS URL (covered by a unit
 * test, since it needs a token typed into Settings). The fixture's own origin
 * is a `file://` bare repo — legitimately auth-free — so opening it must not
 * warn either.
 */
async function reopen(page: import("@playwright/test").Page) {
  await page.goto("/");
  const avatar = page.locator(".avatar:not(.new)").first();
  await avatar.waitFor({ state: "visible" });
  await avatar.click();
  await page.locator("button.row").first().waitFor({ state: "visible" });
}

test("file:// origin (the fixture default) does not warn or block sync", async ({
  page,
}) => {
  await expect(page.locator(".remote-warning")).toHaveCount(0);
});

test("an SSH remote with a blank PAT is NOT blocked (ssh-key auth)", async ({
  page,
  repo,
}) => {
  execFileSync("git", [
    "-C",
    repo.dir,
    "remote",
    "set-url",
    "origin",
    "git@github.com:you/repo.git",
  ]);
  await reopen(page);
  // No token → ssh-key auth is attempted; the remote is not blocked, so no
  // warning bar (the previous "SSH always blocks" behaviour is gone).
  await expect(page.locator(".remote-warning")).toHaveCount(0);
});

test("an HTTPS remote clears the warning", async ({ page, repo }) => {
  execFileSync("git", [
    "-C",
    repo.dir,
    "remote",
    "set-url",
    "origin",
    "https://github.com/you/repo.git",
  ]);
  await reopen(page);
  await expect(page.locator(".remote-warning")).toHaveCount(0);
});
