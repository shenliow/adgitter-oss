/**
 * Merge (operation 3) and Rebase (operation 2) of the drag-and-drop rules.
 *
 * MetroGraph's gesture grammar (`src/lib/dragDispatch.ts`) expresses both as
 * "drag a non-current branch chip onto the CURRENT branch's chip": plain
 * drag → merge that branch into current; Shift-drag → rebase CURRENT onto
 * the dragged branch (see the module doc comment there — "Shift → rebase
 * current onto that branch", not the other way around). The fixture's
 * `topic` branch (diverged from `main` at `mainCommits[3]`, 2 commits of its
 * own on a path `main` never touches) is real merge/rebase material with no
 * conflict risk (verified: dropping/rebasing across genuinely disjoint paths
 * never conflicts — only same-path full-file-rewrite chains do, see
 * `fixtures/repo.ts`'s `dropTarget` doc comment).
 *
 * Every assertion below reads the outcome back with the real `git` CLI.
 */
import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { test, expect } from "./helpers";
import { html5Drag } from "./dnd";

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

function branchChip(page: Page, name: string) {
  return page.locator(`.chip-branch[title^="${name} "]`);
}

test.describe("merge", () => {
  test("plain-dragging topic onto main merges it in (a real merge commit)", async ({
    page,
    repo,
  }) => {
    expect(git(repo.dir, ["symbolic-ref", "--short", "HEAD"])).toBe("main");

    await html5Drag(
      page,
      branchChip(page, repo.topicBranch),
      branchChip(page, "main"),
    );

    const dialog = page.locator('.dialog[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-label", "Merge branch");
    await dialog.getByRole("button", { name: "Merge", exact: true }).click();
    await expect(dialog).toBeHidden();

    // A real merge commit: main's tip now has 2 parents, one of them topic's
    // (the divergence was real — not fast-forwardable — so this must be a
    // true merge, not a no-op).
    await expect
      .poll(() => git(repo.dir, ["log", "--merges", "--oneline", "main"]))
      .not.toBe("");
    const parents = git(repo.dir, [
      "rev-list",
      "--parents",
      "-1",
      "main",
    ]).split(" ");
    expect(parents.length).toBe(3); // sha + 2 parents
    const topicTip = git(repo.dir, ["rev-parse", repo.topicBranch]);
    expect(parents).toContain(topicTip);
  });

  test("right-click branch → Merge {branch} into… → main merges it in the same way", async ({
    page,
    repo,
  }) => {
    const chip = branchChip(page, repo.topicBranch);
    await chip.click({ button: "right" });

    // HOVER (don't click) the submenu parent: ContextMenu opens the flyout
    // on mouseenter, and Playwright's click always hovers first — so a click
    // would immediately TOGGLE the just-hover-opened submenu closed again
    // (clickItem's `openSubmenu === i ? null : i`).
    const menu = page.locator('ul.menu[role="menu"]').first();
    await menu
      .getByRole("menuitem", { name: `Merge ${repo.topicBranch} into…` })
      .hover();
    const submenu = page.locator("ul.menu.submenu");
    await submenu.getByRole("menuitem", { name: "main (current)" }).click();

    const dialog = page.locator('.dialog[role="dialog"]');
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Merge", exact: true }).click();
    await expect(dialog).toBeHidden();

    await expect
      .poll(() => git(repo.dir, ["log", "--merges", "--oneline", "main"]))
      .not.toBe("");
  });
});

test.describe("rebase", () => {
  test("shift-dragging topic onto main rebases main onto topic (linear ancestry)", async ({
    page,
    repo,
  }) => {
    await html5Drag(
      page,
      branchChip(page, repo.topicBranch),
      branchChip(page, "main"),
      { shift: true },
    );

    const dialog = page.locator('.dialog[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-label", "Rebase branch");
    await dialog.getByRole("button", { name: "Rebase", exact: true }).click();
    await expect(dialog).toBeHidden();

    // Rebase (not merge): history is now linear — topic is a strict ancestor
    // of main's new tip, and there are no merge commits anywhere.
    await expect
      .poll(() =>
        gitOrNull(repo.dir, [
          "merge-base",
          "--is-ancestor",
          repo.topicBranch,
          "main",
        ]),
      )
      .not.toBeNull();
    expect(git(repo.dir, ["log", "--merges", "--oneline"])).toBe("");
    // Both topic commits' subjects are now reachable from main.
    const subjects = git(repo.dir, ["log", "--format=%s", "main"]);
    for (const c of repo.topicCommits) {
      expect(subjects).toContain(c.subject);
    }
  });

  test("shift-dragging a branch-selected commit onto another branch's chip forces that branch as the rebase target", async ({
    page,
    repo,
  }) => {
    // Select `topic` as a unit (click its chip) so the drag carries branch
    // mode (`source.branch` set — see dragDispatch.ts), then grab its own
    // tip commit's node handle and Shift-drop it directly on `main`'s chip:
    // the forced-branch-target path (MetroGraph.svelte + dragDispatch.ts),
    // distinct from dropping on `main`'s chip via a branch-label drag (the
    // test above), which rebases the CURRENT branch onto the dragged one —
    // here it's "rebase topic onto main" instead.
    await branchChip(page, repo.topicBranch).click();

    const topicTipShort = git(repo.dir, [
      "rev-parse",
      "--short",
      repo.topicCommits[1].sha,
    ]);
    const topicTipHandle = page.locator(
      `.node-handle[aria-label*="${topicTipShort}"]`,
    );

    await html5Drag(page, topicTipHandle, branchChip(page, "main"), {
      shift: true,
    });

    const dialog = page.locator('.dialog[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-label", "Rebase branch");
    await dialog.getByRole("button", { name: "Rebase", exact: true }).click();
    await expect(dialog).toBeHidden();

    // Rebase (not merge), and `main` (not `topic`) is now the ancestor: the
    // opposite direction from the branch-label rebase test above.
    await expect
      .poll(() =>
        gitOrNull(repo.dir, [
          "merge-base",
          "--is-ancestor",
          "main",
          repo.topicBranch,
        ]),
      )
      .not.toBeNull();
    expect(git(repo.dir, ["log", "--merges", "--oneline"])).toBe("");
    const subjects = git(repo.dir, ["log", "--format=%s", repo.topicBranch]);
    for (const c of repo.topicCommits) {
      expect(subjects).toContain(c.subject);
    }
  });

  test("PLAIN-dragging a branch-selected commit onto another branch's chip rebases too (no Shift needed)", async ({
    page,
    repo,
  }) => {
    // Identical gesture to the Shift test above but with NO modifiers held:
    // a branch-as-a-unit drag is always a rebase (only Alt opts out into
    // cherry-pick) — see dragDispatch.ts's grammar doc.
    await branchChip(page, repo.topicBranch).click();

    const topicTipShort = git(repo.dir, [
      "rev-parse",
      "--short",
      repo.topicCommits[1].sha,
    ]);
    const topicTipHandle = page.locator(
      `.node-handle[aria-label*="${topicTipShort}"]`,
    );

    await html5Drag(page, topicTipHandle, branchChip(page, "main"));

    const dialog = page.locator('.dialog[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-label", "Rebase branch");
    await dialog.getByRole("button", { name: "Rebase", exact: true }).click();
    await expect(dialog).toBeHidden();

    await expect
      .poll(() =>
        gitOrNull(repo.dir, [
          "merge-base",
          "--is-ancestor",
          "main",
          repo.topicBranch,
        ]),
      )
      .not.toBeNull();
    expect(git(repo.dir, ["log", "--merges", "--oneline"])).toBe("");
  });
});
