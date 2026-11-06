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

test.describe("checkout a remote branch", () => {
  test("creates a real local branch tracking the remote, checked out, with upstream set", async ({
    page,
    repo,
  }) => {
    await page.getByTitle("Branches & tags").click();
    const remoteRow = page.locator(".row.remote", {
      has: page.locator(".name-btn", {
        hasText: `origin/${repo.remoteOnlyBranch}`,
      }),
    });
    await remoteRow.locator(".name-btn").dblclick();

    const dialog = page.locator('.dialog[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".name-input")).toHaveValue(
      repo.remoteOnlyBranch,
    );

    await dialog.getByRole("button", { name: "Create & checkout" }).click();
    await expect(dialog).toBeHidden();

    // Real git: the local branch exists, HEAD points at it, and its upstream
    // is origin/<remoteOnlyBranch> — not merely a UI-level success toast.
    await expect
      .poll(() =>
        gitOrNull(repo.dir, [
          "rev-parse",
          "--verify",
          `refs/heads/${repo.remoteOnlyBranch}`,
        ]),
      )
      .not.toBeNull();
    await expect
      .poll(() => gitOrNull(repo.dir, ["symbolic-ref", "--short", "HEAD"]))
      .toBe(repo.remoteOnlyBranch);
    await expect
      .poll(() =>
        gitOrNull(repo.dir, [
          "rev-parse",
          "--abbrev-ref",
          `${repo.remoteOnlyBranch}@{upstream}`,
        ]),
      )
      .toBe(`origin/${repo.remoteOnlyBranch}`);
  });

  test("detached checkout leaves HEAD unattached to any branch", async ({
    page,
    repo,
  }) => {
    await page.getByTitle("Branches & tags").click();
    const remoteRow = page.locator(".row.remote", {
      has: page.locator(".name-btn", {
        hasText: `origin/${repo.remoteOnlyBranch}`,
      }),
    });
    await remoteRow.locator(".name-btn").dblclick();

    const dialog = page.locator('.dialog[role="dialog"]');
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Checkout detached" }).click();
    await expect(dialog).toBeHidden();

    await expect
      .poll(() => gitOrNull(repo.dir, ["symbolic-ref", "-q", "HEAD"]))
      .toBeNull();
  });
});
