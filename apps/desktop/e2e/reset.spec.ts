/**
 * Reset (operation 8 of the drag-and-drop rules): drag the HEAD crown onto an
 * older commit.
 *
 * DEVIATION from the doc/task's assumed flow, found in `App.svelte`'s
 * `onGesture` (the `'reset'` case): a drag-driven reset runs IMMEDIATELY —
 * "the drop itself is the confirmation" (its own comment) — no
 * ConfirmRewrite dialog, unlike every other gesture. Only the RIGHT-CLICK
 * commit-menu reset entries ("Reset branch here (mixed/hard)") go through
 * the confirm gate. Both tests below therefore poll the real git state
 * straight after the drop, with no dialog to wait on first.
 *
 * To make "mixed keeps the working tree, resets the index" vs. "hard resets
 * both" observably different, each test stages a real modification to
 * `file.txt` before dragging — untracked files (like the fixture's
 * permanent `uncommittedFile`) are unaffected by ANY reset mode, so they
 * can't distinguish mixed from hard.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./helpers";
import { html5Drag } from "./dnd";

function git(dir: string, args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
}

/** Like `git`, but only trailing whitespace stripped — porcelain status
 *  lines are column-positional (` M` unstaged vs `M ` staged), so a full
 *  trim would destroy exactly the bit under test. */
function gitRaw(dir: string, args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
  }).trimEnd();
}

function stageModification(dir: string): void {
  writeFileSync(join(dir, "file.txt"), "staged local edit\n");
  git(dir, ["add", "file.txt"]);
}

test.describe("reset", () => {
  test("plain-dragging the HEAD crown onto an older commit does a MIXED reset", async ({
    page,
    repo,
  }) => {
    stageModification(repo.dir);
    const target = repo.mainCommits[2];
    const short = git(repo.dir, ["rev-parse", "--short", target.sha]);

    const crown = page.locator(".crown");
    const targetNode = page.locator(`.node-handle[aria-label*="${short}"]`);
    await html5Drag(page, crown, targetNode);

    // No confirm dialog for the drag path — poll straight for the outcome.
    await expect
      .poll(() => git(repo.dir, ["rev-parse", "HEAD"]))
      .toBe(target.sha);

    // Mixed: the index now matches `target` (nothing staged), but the
    // working tree still holds our edit — an unstaged modification (` M`:
    // empty index column, M in the worktree column).
    const porcelain = gitRaw(repo.dir, [
      "status",
      "--porcelain",
      "--",
      "file.txt",
    ]);
    expect(porcelain).toBe(" M file.txt");
  });

  test("shift-dragging the HEAD crown onto an older commit does a HARD reset", async ({
    page,
    repo,
  }) => {
    stageModification(repo.dir);
    const target = repo.mainCommits[2];
    const short = git(repo.dir, ["rev-parse", "--short", target.sha]);

    const crown = page.locator(".crown");
    const targetNode = page.locator(`.node-handle[aria-label*="${short}"]`);
    await html5Drag(page, crown, targetNode, { shift: true });

    await expect
      .poll(() => git(repo.dir, ["rev-parse", "HEAD"]))
      .toBe(target.sha);

    // Hard: both the index AND the working tree match `target` — our staged
    // edit is discarded entirely, nothing left to report for this path.
    const porcelain = gitRaw(repo.dir, [
      "status",
      "--porcelain",
      "--",
      "file.txt",
    ]);
    expect(porcelain).toBe("");
  });
});
