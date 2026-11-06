/**
 * Cherry-pick (operation 4 of the drag-and-drop rules).
 *
 * The doc describes a "cherry-pick to > [target branch]" context-menu
 * submenu; the shipped app's commit context menu instead has a single
 * top-level "Cherry-pick onto {current branch}" item (no target picker —
 * cherry-pick always lands on whichever branch is checked out). Both this
 * REQUIRED menu path and the Alt-drag gesture path
 * (`src/lib/dragDispatch.ts`'s `commits` source + Alt onto the current
 * branch chip) are covered below; both call the same real `cherry_pick` IPC
 * (`e2e/bridge.ts`'s `cherryPick()`, a real `git cherry-pick`).
 */
import { execFileSync } from "node:child_process";
import { test, expect } from "./helpers";
import { html5Drag } from "./dnd";

function git(dir: string, args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
}

test.describe("cherry-pick", () => {
  test("right-click a commit → Cherry-pick onto main applies it for real", async ({
    page,
    repo,
  }) => {
    const subject = repo.topicCommits[0].subject;
    const short = git(repo.dir, [
      "rev-parse",
      "--short",
      repo.topicCommits[0].sha,
    ]);
    // Right-click the commit's NODE HANDLE, not its row: the handle overlays
    // the row (z-index 2) around the commit circle, so a row-center click can
    // land on the handle and be reported as intercepted — the handle carries
    // the identical oncontextmenu → commit menu anyway.
    await page.locator(`.node-handle[aria-label*="${short}"]`).click({
      button: "right",
    });

    const menu = page.locator('ul.menu[role="menu"]').first();
    await menu.getByRole("menuitem", { name: "Cherry-pick onto main" }).click();

    const dialog = page.locator('.dialog[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-label", "Cherry-pick commit");
    await dialog
      .getByRole("button", { name: "Cherry-pick", exact: true })
      .click();
    await expect(dialog).toBeHidden();

    await expect
      .poll(() => git(repo.dir, ["log", "--format=%s", "main"]))
      .toContain(subject);
  });

  test("Alt-dragging a commit node onto the current branch chip cherry-picks it", async ({
    page,
    repo,
  }) => {
    const subject = repo.topicCommits[0].subject;
    const short = git(repo.dir, [
      "rev-parse",
      "--short",
      repo.topicCommits[0].sha,
    ]);
    const nodeHandle = page.locator(`.node-handle[aria-label*="${short}"]`);
    const mainChip = page.locator('.chip-branch[title^="main "]');

    await html5Drag(page, nodeHandle, mainChip, { alt: true });

    const dialog = page.locator('.dialog[role="dialog"]');
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: "Cherry-pick", exact: true })
      .click();
    await expect(dialog).toBeHidden();

    await expect
      .poll(() => git(repo.dir, ["log", "--format=%s", "main"]))
      .toContain(subject);
  });
});
