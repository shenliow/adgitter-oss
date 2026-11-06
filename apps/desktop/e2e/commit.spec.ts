/**
 * Commit (operation 1 of the drag-and-drop rules).
 *
 * Covered gestures:
 *  - 1b — the "+" circle above HEAD → checkbox file dialog → message →
 *    confirm (`CreateCommitDialog.svelte`; note the shipped dialog combines
 *    the doc's two steps — file checkboxes AND the message box live in ONE
 *    dialog, there is no second message-only dialog).
 *  - The Changes-panel path: stage a file with its row's "+" action, type a
 *    message in the panel's commit bar, commit (`FilesPanel.svelte` +
 *    `CreateCommitBar.svelte`).
 *
 * NOT covered, with reasons (verified against the app source — changing app
 * code is out of scope for this suite):
 *  - 1a (drag a file from the Changes panel onto a branch chip): the panel
 *    has NO drag source — no `draggable` element exists anywhere in
 *    `FilesPanel.svelte`/`FilesPanelTree.svelte`. `dragDispatch.ts` defines
 *    a `files` DragSource kind and MetroGraph's chips would accept it, but
 *    nothing in the app ever STARTS such a drag; and even the resolved op is
 *    a redirect, not a commit — `App.svelte`'s `onGesture` `'commit'` case
 *    just opens the Files panel with a notice.
 *  - 1c (right-click a branch chip → commit): `App.svelte`'s `branchMenu()`
 *    has no commit item (only checkout / merge-into / rebase-onto /
 *    create-branch-from / edit-color).
 */
import { execFileSync } from "node:child_process";
import { test, expect } from "./helpers";

function git(dir: string, args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
}

test.describe("commit", () => {
  test("the '+' circle above HEAD: tick the untracked file, type a message, commit", async ({
    page,
    repo,
  }) => {
    // The fixture leaves an untracked file in the working tree.
    expect(git(repo.dir, ["status", "--porcelain"])).toBe(
      `?? ${repo.uncommittedFile}`,
    );

    await page.locator("button.new-commit").click();

    const dialog = page.locator('.modal[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-label", "New commit");

    // Untracked → unchecked by default; tick it.
    const row = dialog.locator("label.row", { hasText: repo.uncommittedFile });
    const checkbox = row.locator('input[type="checkbox"]');
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();

    const message = "Add scratch notes via plus-circle dialog";
    await dialog.getByRole("textbox", { name: "Commit message" }).fill(message);
    await dialog.getByRole("button", { name: "Commit 1", exact: true }).click();
    await expect(dialog).toBeHidden();

    // Real git outcome: the commit exists with our message, the file is
    // tracked in it, and the working tree is clean again.
    await expect
      .poll(() => git(repo.dir, ["log", "-1", "--format=%s"]))
      .toBe(message);
    expect(
      git(repo.dir, ["show", "--name-only", "--format=", "HEAD"]),
    ).toContain(repo.uncommittedFile);
    expect(git(repo.dir, ["status", "--porcelain"])).toBe("");
  });

  test("the Changes panel: stage the untracked file, type a message, commit", async ({
    page,
    repo,
  }) => {
    await page.getByTitle("Changed files").click();

    const panel = page.locator("aside.panel");
    await expect(panel).toBeVisible();

    // The untracked file's row → its "+" (Stage) hover action.
    const fileRow = panel.locator(".file", { hasText: repo.uncommittedFile });
    await fileRow.hover();
    await fileRow.getByTitle("Stage").click();

    // Once staged, the commit bar unlocks ("Commit 1 staged").
    const message = "Add scratch notes via the Changes panel";
    await panel.getByRole("textbox", { name: "Commit message" }).fill(message);
    const commitBtn = panel.getByRole("button", { name: "Commit 1 staged" });
    await expect(commitBtn).toBeEnabled();
    await commitBtn.click();

    await expect
      .poll(() => git(repo.dir, ["log", "-1", "--format=%s"]))
      .toBe(message);
    expect(git(repo.dir, ["status", "--porcelain"])).toBe("");
  });
});
