/**
 * Shared per-test setup: a fresh fixture repo + the git bridge + a Welcome
 * screen that's already navigated into the fixture repo's graph.
 *
 * Every spec imports `test`/`expect` from here instead of `@playwright/test`
 * directly, so each test gets:
 *  - `repo` — a freshly generated fixture repository in its own tmp dir
 *    (tests are free to mutate it; nothing is shared across tests).
 *  - `page` — already pointed at `/` with the bridge installed, the recents
 *    store seeded with the fixture repo, and the Welcome screen's avatar
 *    clicked (i.e. the graph is open and visible) by the time the test body
 *    runs.
 */
import { test as base, expect, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeFixtureRepo, type FixtureRepo } from "./fixtures/repo";
import { installBridge } from "./bridge";

interface Fixtures {
  repo: FixtureRepo;
}

export const test = base.extend<Fixtures>({
  repo: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), "adgitter-e2e-"));
    const repo = makeFixtureRepo(dir);
    await use(repo);
    rmSync(dir, { recursive: true, force: true });
    rmSync(repo.bareDir, { recursive: true, force: true });
  },

  // Override the built-in `page` fixture: install the bridge + seed the
  // store BEFORE any app script runs, then drive the same "open a recent
  // project" path a real user follows.
  page: async ({ page, repo }, use) => {
    const bridge = await installBridge(page, repo.dir);
    await page.addInitScript(
      (storeSeed) => {
        (
          window as unknown as { __E2E_STORE_SEED__: unknown }
        ).__E2E_STORE_SEED__ = storeSeed;
      },
      {
        "recents.json": {
          projects: [
            { path: repo.dir, name: "fixture", lastOpened: Date.now() },
          ],
        },
        // `mergeSettings` in src/lib/settings.ts fills in every other field's
        // default; seeding explicitly documents that the settings load path
        // is exercised (not skipped) for every e2e run. The guided tutorial
        // is marked done — a returning user — so its first-launch
        // welcome never covers the app in specs that aren't about it.
        "settings.json": {
          settings: { tutorial: { completed: true, firstUseShown: true } },
        },
      },
    );

    await page.goto("/");
    await openFixtureRepo(page);
    await use(page);
    // Removes the temp dir the tutorial_demo_* commands lazily create (if any).
    bridge.dispose();
  },
});

export { expect };

/** Click the Welcome screen's (only) recent-project avatar and wait for the
 *  graph to render — mirrors `openRecent()` → `loadRepo()` in App.svelte. */
async function openFixtureRepo(page: Page): Promise<void> {
  const avatar = page.locator(".avatar:not(.new)").first();
  await avatar.waitFor({ state: "visible" });
  await avatar.click();
  await page.locator("button.row").first().waitFor({ state: "visible" });
}
