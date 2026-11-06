/**
 * Remove branch (operation 6) and Remove commit (operation 7) of the
 * drag-and-drop rules.
 *
 * Remove-branch has only ONE gesture in the shipped app: select a branch
 * label (click) + Delete. `App.svelte`'s `branchMenu()` has no "Remove
 * branch" context-menu item (checked — only `checkout` /
 * `mergeIntoParent` / `rebaseOntoParent` / `createBranchFrom` / `editColor`
 * exist there), so the doc's "right-click → remove branch" path does not
 * exist to test; the Delete-key gesture below is the only one that does.
 *
 * Remove-commit DOES have both: the same select+Delete gesture, and a
 * "Drop this commit" context-menu item — both covered below, against the
 * fixture's `dropTarget`/`afterDrop` commit pair (the only two commits in
 * this repo whose drop-and-replay is conflict-free — see
 * `fixtures/repo.ts`'s doc comment on `dropTarget`).
 */
import { execFileSync } from "node:child_process";
import { test, expect } from "./helpers";

function git(dir: string, args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
}

function gitOrNull(dir: string, args: string[]): string | null {
  try {
    return git(dir, args);
  } catch {
    return null;
  }
}

test.describe("remove branch", () => {
  test("select a branch chip + Delete removes it for real (only gesture available)", async ({
    page,
    repo,
  }) => {
    expect(
      gitOrNull(repo.dir, [
        "rev-parse",
        "--verify",
        `refs/heads/${repo.disposableBranch}`,
      ]),
    ).not.toBeNull();

    const chip = page.locator(
      `.chip-branch[title^="${repo.disposableBranch} "]`,
    );
    await chip.click();
    await page.keyboard.press("Delete");

    const dialog = page.locator('.dialog[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-label", "Remove branch");
    await dialog
      .getByRole("button", { name: "Remove branch", exact: true })
      .click();
    await expect(dialog).toBeHidden();

    await expect
      .poll(() =>
        gitOrNull(repo.dir, [
          "rev-parse",
          "--verify",
          `refs/heads/${repo.disposableBranch}`,
        ]),
      )
      .toBeNull();
  });
});

test.describe("remove commit", () => {
  test("select a commit + Delete drops it, replaying its descendant", async ({
    page,
    repo,
  }) => {
    const row = page.locator("button.row", {
      hasText: repo.dropTarget.subject,
    });
    await row.click();
    await page.keyboard.press("Delete");

    const dialog = page.locator('.dialog[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-label", "Drop commit");
    await dialog.getByRole("button", { name: "Drop", exact: true }).click();
    await expect(dialog).toBeHidden();

    await expect
      .poll(() => git(repo.dir, ["log", "--format=%s", "main"]))
      .not.toContain(repo.dropTarget.subject);
    // Its descendant survives, replayed onto the dropped commit's parent.
    expect(git(repo.dir, ["log", "--format=%s", "main"])).toContain(
      repo.afterDrop.subject,
    );
  });

  test("right-click a commit → Drop this commit removes it the same way", async ({
    page,
    repo,
  }) => {
    const row = page.locator("button.row", {
      hasText: repo.dropTarget.subject,
    });
    await row.click({ button: "right" });

    const menu = page.locator('ul.menu[role="menu"]').first();
    await menu.getByRole("menuitem", { name: "Drop this commit" }).click();

    const dialog = page.locator('.dialog[role="dialog"]');
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Drop", exact: true }).click();
    await expect(dialog).toBeHidden();

    await expect
      .poll(() => git(repo.dir, ["log", "--format=%s", "main"]))
      .not.toContain(repo.dropTarget.subject);
    expect(git(repo.dir, ["log", "--format=%s", "main"])).toContain(
      repo.afterDrop.subject,
    );
  });
});
