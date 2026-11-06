/**
 * Checkout (operation 5 of the drag-and-drop rules): double-click a branch label in
 * the graph, single-click a branch row in the Branches panel (a second,
 * independent checkout surface — `BranchesPanel.svelte`'s `.name-btn` checks
 * out on a single click, unlike the graph chip's double-click), and the
 * commit context menu's "this commit (detached)" entry. All three route
 * through the same real `checkout` IPC call (`e2e/bridge.ts`'s `checkout()`,
 * a real `git checkout`) — every assertion below reads `HEAD` back with the
 * system `git` CLI, not a UI toast.
 */
import { execFileSync } from "node:child_process";
import { test, expect } from "./helpers";

function currentBranch(dir: string): string {
  return execFileSync("git", ["-C", dir, "symbolic-ref", "--short", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

function gitOrNull(dir: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

test.describe("checkout", () => {
  test("double-clicking a branch chip in the graph checks it out for real", async ({
    page,
    repo,
  }) => {
    expect(currentBranch(repo.dir)).toBe("main");

    const chip = page.locator(`.chip-branch[title^="${repo.topicBranch} "]`);
    await chip.dblclick();

    await expect.poll(() => currentBranch(repo.dir)).toBe(repo.topicBranch);
  });

  test("double-clicking a branch row in the Branches panel checks it out for real", async ({
    page,
    repo,
  }) => {
    expect(currentBranch(repo.dir)).toBe("main");

    await page.getByTitle("Branches & tags").click();
    // Single click only selects; checkout is a double-click (see BranchesPanel).
    await page
      .locator(".row .name-btn", { hasText: repo.noUpstreamBranch })
      .dblclick();

    await expect
      .poll(() => currentBranch(repo.dir))
      .toBe(repo.noUpstreamBranch);
  });

  test("right-click a commit → Checkout → this commit (detached) leaves HEAD unattached", async ({
    page,
    repo,
  }) => {
    // The menu (and the node handle's aria-label) shows the SAME abbreviated
    // sha the app itself renders (`short_sha`, git's `%h` — auto-abbrev
    // length, not a hardcoded 7).
    const short = execFileSync(
      "git",
      ["-C", repo.dir, "rev-parse", "--short", repo.mainCommits[2].sha],
      { encoding: "utf8" },
    ).trim();

    // Right-click the commit's NODE HANDLE, not its row: the handle overlays
    // the row (z-index 2) around the commit circle, so a row-center click can
    // land on the handle and be reported as intercepted — the handle carries
    // the identical oncontextmenu → commit menu anyway.
    await page.locator(`.node-handle[aria-label*="${short}"]`).click({
      button: "right",
    });

    // HOVER (don't click) the submenu parent: ContextMenu opens the flyout
    // on mouseenter, and Playwright's click always hovers first — so a click
    // would immediately TOGGLE the just-hover-opened submenu closed again
    // (clickItem's `openSubmenu === i ? null : i`).
    const menu = page.locator('ul.menu[role="menu"]').first();
    await menu.getByRole("menuitem", { name: "Checkout" }).hover();

    const submenu = page.locator("ul.menu.submenu");
    await submenu
      .getByRole("menuitem", { name: `This commit (${short}, detached)` })
      .click();

    await expect
      .poll(() => gitOrNull(repo.dir, ["symbolic-ref", "-q", "HEAD"]))
      .toBeNull();
    await expect
      .poll(() => gitOrNull(repo.dir, ["rev-parse", "HEAD"]))
      .toBe(repo.mainCommits[2].sha);
  });
});
