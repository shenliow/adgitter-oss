/**
 * Guided tutorial — real-browser smoke of the App wiring.
 *
 * jsdom cannot hit-test, so the one thing the App harness cannot prove lives
 * here: the spotlight overlay really swallows a click OUTSIDE its holes (the
 * app underneath never sees it) and lets one INSIDE a hole through. Also
 * covers the first-launch welcome and the start of the real flow on the
 * bridge's demo repo (create → tour → first commit → seeded history).
 *
 * The walkthrough tests play all 24 steps on the bridge's real-git demo at a
 * common laptop size (1280×800) and a small window (1024×700). Before every
 * action step they assert that each of the step's holes (the overlay's live
 * `data-tutorial-targets`) is on screen and hit-testable at its centre — a
 * target scrolled under the status bar or out of the graph is a dead end
 * for the user (the "can't see `experiment` at the cherry-pick" report).
 * Clicks are real (Playwright refuses a click the overlay intercepts); the
 * merge-handle drag is a real pointer drag; the rebase, cherry-pick and
 * crown-reset are REAL native HTML5 drags with the modifier key held on the
 * keyboard, so hit-testing through the holes is exercised end to end.
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installBridge, type Bridge } from "./bridge";

let root: string;
let bridge: Bridge;

test.beforeEach(async ({ page }) => {
  root = mkdtempSync(join(tmpdir(), "adgitter-e2e-tutsmoke-"));
  bridge = await installBridge(page, join(root, "no-fixture"), {
    tutorialBaseDir: join(root, "tutorial"),
  });
  await page.addInitScript(() => {
    (window as unknown as { __E2E_STORE_SEED__: unknown }).__E2E_STORE_SEED__ =
      {
        "recents.json": { projects: [] },
        // A first launch: the tutorial has never run.
        "settings.json": { settings: {} },
      };
  });
});

test.afterEach(() => {
  bridge.dispose();
  rmSync(root, { recursive: true, force: true });
});

/** The topmost element at the target's centre (or `dx` px from its left
 *  edge) — what a real click there hits. */
async function hitAt(page: Page, selector: string, dx?: number) {
  const box = await page.locator(selector).first().boundingBox();
  expect(box, selector).not.toBeNull();
  const x = box!.x + (dx ?? box!.width / 2);
  const y = box!.y + box!.height / 2;
  const hit = await page.evaluate(
    ([px, py]) => {
      const el = document.elementFromPoint(px, py);
      return {
        overlay: !!el?.closest("[data-tutorial-overlay]"),
        tag: el?.tagName ?? null,
      };
    },
    [x, y] as const,
  );
  return { x, y, ...hit };
}

const coachTitle = (page: Page) =>
  page.locator("[data-tutorial-overlay] .card .title");

test("first launch: welcome tour, then the overlay blocks outside its holes and passes inside", async ({
  page,
}) => {
  await page.goto("/");
  const tour = page.getByRole("dialog", { name: "Welcome to ADGitter" });
  await expect(tour).toBeVisible();
  await tour.getByRole("button", { name: "Next" }).click();
  await tour.locator("button.choice.start").click();
  await expect(tour).toBeHidden();

  // Step 3: a centred card with no hole — the whole app is blocked.
  await expect(coachTitle(page)).toHaveText("Create a practice repository");

  // Keyboard only: the card owns focus from the start and Tab / Shift+Tab
  // cycle through its controls without ever reaching the Welcome screen behind.
  const primary = page.locator("[data-tutorial-overlay] .btn-primary");
  const exit = page.locator("[data-tutorial-overlay] .btn-exit");
  await expect(primary).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(exit).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(primary).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(exit).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(primary).toBeFocused();
  // A stray click on the dimmed app neither acts nor takes focus away.
  await page.mouse.click(8, 8);
  await expect(primary).toBeFocused();
  const newRepo = await hitAt(page, ".avatar.new");
  expect(newRepo.overlay).toBe(true);
  await page.mouse.click(newRepo.x, newRepo.y);
  await expect(page.getByRole("dialog", { name: /open|create/i })).toHaveCount(
    0,
  );

  // Create the demo (real git through the bridge) and land on the tour.
  await page.locator("[data-tutorial-overlay] .btn-primary").click();
  await expect(coachTitle(page)).toHaveText("Reading the graph", {
    timeout: 15_000,
  });
  await expect(page.locator("button.row").first()).toBeVisible();

  // The graph is the hole now: a row inside it is hit directly, while the
  // toolbar outside it is covered by the overlay.
  // The graph is the hole now: a commit row inside it is hit directly (its
  // left edge — the coach card may sit over the middle), while the top bar
  // outside it is covered by the overlay, and a click there goes nowhere.
  expect((await hitAt(page, "button.row", 30)).overlay).toBe(false);
  const gear = await hitAt(page, '[data-tutorial="topbar-settings"]');
  expect(gear.overlay).toBe(true);
  await page.mouse.click(gear.x, gear.y);
  await expect(page.locator('[data-tutorial="settings-modal"]')).toHaveCount(0);

  for (let i = 0; i < 5; i++)
    await page.locator("[data-tutorial-overlay] .btn-next").click();
  await expect(coachTitle(page)).toHaveText("Make your first commit");

  // Step 5: Files is a hole, Push is not.
  const push = await hitAt(page, '[data-tutorial="toolbar-push"]');
  expect(push.overlay).toBe(true);
  await page.mouse.click(push.x, push.y);
  await page.waitForTimeout(300);
  await expect(page.locator(".toast")).toHaveCount(0);

  const files = await hitAt(page, '[data-tutorial="toolbar-files"]');
  expect(files.overlay).toBe(false);
  await page.mouse.click(files.x, files.y);
  const panel = page.locator('[data-tutorial="files-panel"]');
  await expect(panel).toBeVisible();

  // Stage every seeded file and make the first commit — for real.
  const stage = panel.getByRole("button", { name: "+", exact: true });
  await expect(stage.first()).toBeVisible();
  while ((await stage.count()) > 0) {
    await stage.first().click();
    await page.waitForTimeout(150);
  }
  const bar = page.locator('[data-tutorial="commit-bar"]');
  await bar.locator("textarea").fill("My first commit");
  await bar.locator("button.btn").click();

  // Committed ⇒ step 6 seeds the demo history (branches appear in the graph).
  await expect(coachTitle(page)).toHaveText("A busier history", {
    timeout: 15_000,
  });
  await expect(
    page.locator('[data-tutorial-branch="feature/login"]'),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.locator('[data-tutorial-branch="feature/theme"]'),
  ).toBeVisible();

  // Exit (confirmed) cleans up: back on Welcome, with the first-use intro.
  await page.locator("[data-tutorial-overlay] .btn-exit").click();
  await page.locator("[data-tutorial-overlay] .btn-exit-confirm").click();
  await expect(page.locator("[data-tutorial-overlay]")).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Getting started" }),
  ).toBeVisible();
});

// ── the whole script ─────────────────────────────────────────────────────

function demoRepo(): string {
  const base = join(root, "tutorial");
  const d = readdirSync(base).find((n) => n.startsWith("demo-"))!;
  return join(base, d, "repo");
}
function git(args: string[]): string {
  return execFileSync("git", ["-C", demoRepo(), ...args], {
    encoding: "utf8",
  }).trim();
}
/** sha of the commit with `subject` reachable from `branch` (nearest). */
function onBranch(branch: string, subject: string): string {
  const out = git(["log", "--format=%H %s", branch]);
  for (const line of out.split("\n")) {
    const i = line.indexOf(" ");
    if (line.slice(i + 1) === subject) return line.slice(0, i);
  }
  throw new Error(`${subject} not on ${branch}`);
}

/** The coach card shows `text`, and every hole of that step is reachable. */
async function expectStep(page: Page, text: string, anyCommit = false) {
  await expect(coachTitle(page)).toHaveText(text, { timeout: 15_000 });
  await expectTargetsReachable(page, anyCommit);
}
async function next(page: Page) {
  await page.locator("[data-tutorial-overlay] .btn-next").click();
}
/** A real click (Playwright refuses if the overlay intercepts it). */
async function hit(l: Locator, opts: Parameters<Locator["click"]>[0] = {}) {
  await l.click({ timeout: 12000, ...opts });
}
const row = (page: Page, sha: string) =>
  page.locator(`button.row[data-tutorial-commit="${sha}"]`);
const node = (page: Page, sha: string) =>
  page.locator(`.node-handle[data-tutorial-commit="${sha}"]`);
const chip = (page: Page, name: string) =>
  page.locator(`[data-tutorial-branch="${name}"]`);
const confirmRewrite = (page: Page) =>
  page.locator('[data-tutorial="confirm-rewrite"] button.primary');

/** Selectors a step lists before the element exists: a dialog / menu /
 *  panel / handle that the step's own action opens. Everything else a step
 *  lists must already be on screen when the step starts. */
const OPENED_LATER = [
  '[data-tutorial="confirm-dialog"]',
  '[data-tutorial="confirm-rewrite"]',
  '[data-tutorial="create-commit-dialog"]',
  '[data-tutorial="files-panel"]',
  '[data-tutorial="commit-bar"]',
  '[data-tutorial="merge-handle"]',
  '[data-tutorial="push-force-item"]',
  '[data-tutorial="settings-tab-Personalize"]',
  '[data-tutorial="settings-panel-Personalize"]',
  '[data-tutorial="settings-ok"]',
  '[data-tutorial="settings-cancel"]',
];

/** Where each of the current step's holes stands: for every selector, is
 *  some element matching it inside the viewport with its centre (or, for a
 *  big panel the coach card may partly cover, one of a few inner points) hit
 *  by that same target rather than the overlay, a toolbar or the status bar. */
async function targetReport(page: Page) {
  return page.evaluate((later) => {
    const ov = document.querySelector("[data-tutorial-overlay]");
    const sels = JSON.parse(
      ov?.getAttribute("data-tutorial-targets") ?? "[]",
    ) as string[];
    const report = sels.map((sel) => {
      const els = Array.from(document.querySelectorAll(sel));
      let ok = false;
      let why = els.length ? "" : "missing";
      for (const el of els) {
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) {
          why ||= "empty box";
          continue;
        }
        // The centre; a wide / tall target may also be hit further along
        // that axis (the coach card can sit over a row's middle) — but
        // never off its centre line on a short axis, so a row half under
        // the status bar still fails.
        const fx = b.width > 200 ? [0.5, 0.15, 0.85] : [0.5];
        const fy = b.height > 200 ? [0.5, 0.15, 0.85] : [0.5];
        const pts = fx.flatMap((x) => fy.map((y) => [x, y] as const));
        for (const [ax, ay] of pts) {
          const x = b.left + b.width * ax;
          const y = b.top + b.height * ay;
          if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) {
            why = `centre (${Math.round(x)},${Math.round(y)}) off screen`;
            continue;
          }
          const hit = document.elementFromPoint(x, y);
          if (hit?.closest(sel)) {
            ok = true;
            break;
          }
          why = `(${Math.round(x)},${Math.round(y)}) hits ${hit?.tagName}.${hit?.getAttribute("class") ?? ""}`;
        }
        if (ok) break;
      }
      return {
        sel,
        ok,
        why,
        optional: els.length === 0 && later.includes(sel),
      };
    });
    // A step that spotlights the whole graph is about what is IN it: the
    // coach card must not sit on any chip / node / crown on screen.
    if (sels.includes('[data-tutorial="graph"]')) {
      const card = ov!.querySelector(".card")!.getBoundingClientRect();
      const marks = document.querySelectorAll(
        '[data-tutorial-branch], div[data-tutorial-commit], [data-tutorial="head-crown"]',
      );
      for (const m of marks) {
        const b = m.getBoundingClientRect();
        if (b.width === 0 || b.bottom <= 0 || b.top >= innerHeight) continue;
        const covered =
          b.left < card.right &&
          card.left < b.right &&
          b.top < card.bottom &&
          card.top < b.bottom;
        if (covered)
          report.push({
            sel: m.getAttribute("data-tutorial-branch") ?? m.className,
            ok: false,
            why: "covered by the coach card",
            optional: false,
          });
      }
    }
    return report;
  }, OPENED_LATER);
}

/** Every required hole of the current step is visible and reachable
 *  (polled: the overlay may still be scrolling it into view). */
async function expectTargetsReachable(
  page: Page,
  /** Commit holes that are ALTERNATIVES (the reset step accepts any older
   *  commit on main): one of them on screen is enough. */
  anyCommit = false,
) {
  const step = await coachTitle(page).textContent();
  await expect
    .poll(
      async () => {
        let report = await targetReport(page);
        if (anyCommit) {
          const commit = (r: { sel: string }) =>
            r.sel.startsWith("[data-tutorial-commit=");
          const someOk = report.some((r) => commit(r) && r.ok);
          if (someOk) report = report.filter((r) => !commit(r));
        }
        return report
          .filter((r) => !r.ok && !r.optional)
          .map((r) => `${r.sel}: ${r.why}`);
      },
      { message: `unreachable holes at "${step}"`, timeout: 4000 },
    )
    .toEqual([]);
}

/** A real native HTML5 drag (Chromium starts one from mouse input) from
 *  `source` to the centre of `target`, with `key` held on the keyboard the
 *  whole time — the way a user does an Alt-drag. `grabY` is where in the
 *  source's height to press: a branch tip's merge dot perches on the node's
 *  top half, so a node is grabbed below its centre (a press on the dot is a
 *  merge drag, not a rebase / cherry-pick). */
/** `l`'s box once it has stopped moving (the overlay may be smooth-scrolling
 *  the graph to reveal it). */
async function settledBox(l: Locator) {
  let prev = await l.boundingBox();
  for (let i = 0; i < 40; i++) {
    await l.page().waitForTimeout(50);
    const cur = await l.boundingBox();
    if (prev && cur && prev.x === cur.x && prev.y === cur.y) return cur;
    prev = cur;
  }
  return prev!;
}

async function realDrag(
  page: Page,
  source: Locator,
  target: Locator,
  key?: "Alt" | "Shift",
  grabY = 0.5,
) {
  const s = await settledBox(source);
  const x0 = s.x + s.width / 2;
  const y0 = s.y + s.height * grabY;
  if (key) await page.keyboard.down(key);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 8, y0 + 8, { steps: 4 });
  // Re-read: the drag may have scrolled the target.
  const t = (await target.boundingBox())!;
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 12 });
  await page.mouse.up();
  if (key) await page.keyboard.up(key);
}

for (const [w, h] of [
  [1280, 800],
  [1024, 700],
] as const)
  test(`walkthrough at ${w}×${h}: every hole is reachable and all 24 steps reach the first-use intro`, async ({
    page,
  }) => {
    await walkthrough(page, w, h);
  });

async function walkthrough(page: Page, w: number, h: number) {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: w, height: h });
  await page.goto("/");
  const tour = page.getByRole("dialog", { name: "Welcome to ADGitter" });
  await tour.getByRole("button", { name: "Next" }).click();
  await tour.locator("button.choice.start").click();
  await expectStep(page, "Create a practice repository");
  await page.locator("[data-tutorial-overlay] .btn-primary").click();
  await expectStep(page, "Reading the graph");
  // The tour: every stop's spotlight is on screen and uncovered.
  for (let i = 0; i < 5; i++) {
    const before = await coachTitle(page).textContent();
    await next(page);
    await expect(coachTitle(page)).not.toHaveText(before!);
    await expectTargetsReachable(page);
  }

  await expectStep(page, "Make your first commit");
  await hit(page.locator('[data-tutorial="toolbar-files"]'));
  const panel = page.locator('[data-tutorial="files-panel"]');
  const stage = panel.getByRole("button", { name: "+", exact: true });
  await expect(stage.first()).toBeVisible();
  while ((await stage.count()) > 0) {
    await hit(stage.first());
    await page.waitForTimeout(150);
  }
  const bar = page.locator('[data-tutorial="commit-bar"]');
  await bar.locator("textarea").fill("My first commit");
  await hit(bar.locator("button.btn"));

  await expectStep(page, "A busier history");
  await expect(chip(page, "feature/login")).toBeVisible();
  // The files panel close button sits inside the graph hole geometrically.
  await hit(panel.locator("button.close"));
  await next(page);

  // 7a / 7b
  const initial = onBranch("main", "Initial commit");
  const helpers = onBranch("main", "Add helpers");
  await expectStep(page, "Select a commit");
  // Whole-graph steps: the coach card docks over a row's empty left end
  // (never over a node or chip), so press the commit's node.
  await hit(node(page, initial));
  await expectStep(page, "Select several commits");
  await hit(node(page, helpers), { modifiers: ["ControlOrMeta"] });

  // 8 merge drag via the handle circle
  await expectStep(page, "Merge by dragging");
  const loginTip = git(["rev-parse", "feature/login"]);
  const mainTip = git(["rev-parse", "main"]);
  const lb = (await node(page, loginTip).boundingBox())!;
  await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2);
  const handle = page.locator('[data-tutorial="merge-handle"]');
  await expect(handle).toBeVisible();
  const hb = (await handle.boundingBox())!;
  const tb = (await node(page, mainTip).boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await hit(confirmRewrite(page));

  // 9 branch select
  await expectStep(page, "Select a branch");
  await hit(chip(page, "feature/theme"));

  // 10a rebase
  await expectStep(page, "Rebase a branch");
  const themeTip = git(["rev-parse", "feature/theme"]);
  await realDrag(page, node(page, themeTip), chip(page, "main"), "Shift", 0.8);
  await hit(confirmRewrite(page));

  // 10b cherry-pick
  await expectStep(page, "Cherry-pick a commit");
  const e1 = onBranch("experiment", "Try faster render");
  await hit(row(page, e1), { position: { x: 30, y: 20 } });
  await realDrag(page, node(page, e1), chip(page, "main"), "Alt", 0.8);
  await hit(confirmRewrite(page));

  // 11 undo
  await expectStep(page, "Undo the last operation");
  await hit(page.locator('[data-tutorial="toolbar-undo"]'));

  // 12 reset with the crown
  await expectStep(page, "Reset with the HEAD crown", true);
  const c4 = onBranch("main", "Add helpers");
  await realDrag(
    page,
    page.locator('[data-tutorial="head-crown"]'),
    node(page, c4),
  );

  // 13a undo, 13b checkout
  await expectStep(page, "Undo the reset");
  await hit(page.locator('[data-tutorial="toolbar-undo"]'));
  await expectStep(page, "Check out a branch");
  await chip(page, "feature/theme").dblclick({ timeout: 4000 });

  // 14a open details, 14b purge
  await expectStep(page, "Open commit details");
  const addConfig = onBranch("feature/theme", "Add config");
  await hit(row(page, addConfig), { position: { x: 30, y: 20 } });
  await expectStep(page, "Purge a file from history");
  const secretRow = page.locator('[data-tutorial-file="secrets.env"]');
  await secretRow.hover();
  await hit(secretRow.locator('[data-tutorial="detail-purge"]'));
  await hit(confirmRewrite(page));

  // 15 add file
  await expectStep(page, "Add a file to a past commit");
  const addConfig2 = onBranch("feature/theme", "Add config");
  const details = page.locator('[data-tutorial="commit-details"]');
  const shown = await details.locator(".hash-btn").getAttribute("title");
  if (!shown?.includes(addConfig2))
    await hit(row(page, addConfig2), { position: { x: 30, y: 20 } });
  await hit(page.locator('[data-tutorial="detail-add-file"]'));
  await hit(page.locator(".addfile-item", { hasText: "secrets.example.env" }));
  await hit(confirmRewrite(page));

  // 16 reword
  await expectStep(page, "Fix a commit message");
  const typo = onBranch("feature/theme", "Add drak theme");
  await hit(row(page, typo), { position: { x: 30, y: 20 } });
  await hit(page.locator('[data-tutorial="detail-reword"]'));
  await page.locator(".edit-textarea").fill("Add dark theme");
  await hit(details.locator(".edit-actions .primary"));

  // 17a / 17b
  await expectStep(page, "Push your work");
  await hit(page.locator('[data-tutorial="toolbar-push"]'));
  await expectStep(page, "Force push");
  await hit(page.locator('[data-tutorial="toolbar-push-menu"]'));
  await hit(page.locator('[data-tutorial="push-force-item"]'));
  await hit(confirmRewrite(page));

  // 18–21 Log Anytime
  await expectStep(page, "Log Anytime");
  await next(page);
  await hit(page.locator('[data-tutorial="toolbar-log-anytime"]'));
  await expectStep(page, "Snapshots appear");
  await expect(chip(page, "adgitter-log")).toBeVisible();
  await next(page);
  await hit(page.locator('[data-tutorial="toolbar-log-anytime"]'));

  // 22 theme
  await expectStep(page, "Pick a theme");
  await hit(page.locator('[data-tutorial="topbar-settings"]'));
  // Settings opens straight on Personalize; General (git email) is not shown.
  await expect(
    page.locator('[data-tutorial="settings-panel-Personalize"]'),
  ).toBeVisible();
  await expect(page.locator('[data-field="git-email"]')).toHaveCount(0);
  await hit(page.locator('[data-tutorial="theme-apply"]').first());
  await hit(page.locator('[data-tutorial="settings-ok"]'));

  // finish
  await page.locator("[data-tutorial-overlay] .btn-primary").click();
  await expect(page.locator("[data-tutorial-overlay]")).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Getting started" }),
  ).toBeVisible();
}
