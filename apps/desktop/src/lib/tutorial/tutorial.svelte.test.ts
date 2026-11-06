import { describe, it, expect, vi, afterEach } from "vitest";

import { STEPS, TOTAL_STEPS, type TutorialStep } from "./steps";
import { BLOCKED_MS, createTutorial } from "./tutorial.svelte";
import type { TutorialAction, TutorialEvent } from "./types";
import {
  REPO,
  afterFirstCommit,
  commit,
  makeWorld,
  patch,
  seededView,
  type World,
} from "./testWorld";

const NAV: TutorialAction = { kind: "other", name: "tutorial-nav" };

function fakeTimers() {
  let nextId = 1;
  const q = new Map<number, { fn: () => void; ms: number }>();
  return {
    setTimer: (fn: () => void, ms: number) => {
      const id = nextId++;
      q.set(id, { fn, ms });
      return id;
    },
    clearTimer: (h: unknown) => void q.delete(h as number),
    delays: () => [...q.values()].map((x) => x.ms),
    fire() {
      const items = [...q.values()];
      q.clear();
      for (const x of items) x.fn();
    },
  };
}

function setup(over: { firstUseShown?: boolean; steps?: TutorialStep[] } = {}) {
  const w = makeWorld();
  w.firstUseShown = over.firstUseShown ?? false;
  const timers = fakeTimers();
  const t = createTutorial(w.host, over.steps ?? STEPS, {
    firstUseShown: () => w.firstUseShown,
    ...timers,
  });
  return { w, t, timers };
}

type T = ReturnType<typeof setup>["t"];

/** Walk the info steps from the current one until `id` is current. */
async function toStep(t: T, id: string) {
  for (let guard = 0; guard < 60 && t.presentation?.id !== id; guard++) {
    await t.next();
    await t.whenIdle();
  }
  expect(t.presentation?.id).toBe(id);
}

// ── A whole run of the script ────────────────────────────────────────────────
type Row = [sha: string, subject: string, parents: string[]];

/** Add commits to the view and point `feature/theme` at `tip`. `where:
 *  "back"` appends them AFTER the old chain — the adversarial order for any
 *  "first commit with this subject" lookup; reachability must still win. */
const rewrite = (
  w: World,
  rows: Row[],
  tip: string,
  where: "front" | "back" = "back",
) => {
  const added = rows.map(([sha, subject, parents]) =>
    commit(sha, subject, parents),
  );
  w.view = patch(w.view!, {
    commits:
      where === "front"
        ? [...added, ...w.view!.commits]
        : [...w.view!.commits, ...added],
    branches: { ...w.view!.branches, "feature/theme": tip },
  });
};

/** feature/theme's history rewritten from "Add config" up (purge / add-file
 *  rewrite C3 and every descendant, merge included): C3x … T2x. */
const chain = (x: string): Row[] => [
  [`C3${x}`, "Add config", ["C2"]],
  [`C4${x}`, "Add helpers", [`C3${x}`]],
  [`C5${x}`, "Update docs", [`C4${x}`]],
  [`L1${x}`, "Add login form", [`C4${x}`]],
  [`L2${x}`, "Validate login", [`L1${x}`]],
  [`M${x}`, "Merge feature/login", [`C5${x}`, `L2${x}`]],
  [`T1${x}`, "Add drak theme", [`M${x}`]],
  [`T2${x}`, "Add theme switch", [`T1${x}`]],
];

interface Entry {
  id: string;
  /** Info steps: how the tutorial moves on (default: next). */
  info?: true;
  /** Host calls the step's entry setup is expected to have made. */
  setupCalls?: string[];
  ok?: TutorialAction[];
  bad?: TutorialAction[];
  /** Events that must NOT advance the step. */
  wrong?: TutorialEvent[];
  /** Mimic the real operation on the demo repo. */
  mutate?: (w: World) => void;
  event?: TutorialEvent;
}

const sel = (sha: string, additive = false): TutorialAction => ({
  kind: "select",
  sha,
  additive,
});
const gestureReset = (
  target: string,
  extra: Record<string, unknown> = {},
): TutorialAction => ({
  kind: "gesture",
  op: { op: "reset", target, short: target, mode: "mixed", ...extra },
});
const drop = (source: string, target: string): TutorialAction => ({
  kind: "mergeDrag",
  drop: { source, target, sourceCandidates: [], targetCandidates: [] },
});
const rebaseDrag = (branch: string, onto: string): TutorialAction => ({
  kind: "gesture",
  op: { op: "rebaseBranch", branch, onto, short: onto },
});
const cherry = (...commits: string[]): TutorialAction => ({
  kind: "gesture",
  op: { op: "cherryPick", commits },
});
const pushed = (
  force: boolean,
  ok: boolean,
  rejected = !ok,
): TutorialEvent => ({ kind: "pushed", force, ok, rejected });

const SCRIPT: Entry[] = [
  { id: "welcome", info: true },
  { id: "choose", info: true },
  {
    id: "create-demo",
    info: true,
  },
  { id: "tour-graph", info: true },
  { id: "tour-commit", info: true },
  { id: "tour-branch", info: true },
  { id: "tour-head", info: true },
  { id: "tour-handle", info: true },
  {
    id: "first-commit",
    setupCalls: [`seedFiles:${REPO}`],
    ok: [
      { kind: "openFiles" },
      { kind: "stage", paths: ["src/app.js"] },
      { kind: "commit" },
      { kind: "other", name: "create-commit" },
    ],
    bad: [
      sel("C1"),
      { kind: "stage", paths: ["README.md"] },
      { kind: "push" },
      { kind: "other", name: "contextmenu" },
      { kind: "checkout", target: "main" },
    ],
    wrong: [
      { kind: "selected", shas: ["C1"] },
      pushed(false, true),
      { kind: "refreshed" },
    ],
    mutate: (w) => (w.view = afterFirstCommit(w.view!)),
    event: { kind: "committed", sha: "C2" },
  },
  { id: "seed-history", info: true, setupCalls: [`seedHistory:${REPO}`] },
  {
    id: "select-commit",
    ok: [sel("C3"), { kind: "clearSelection" }],
    bad: [sel("C3", true), { kind: "marquee" }, drop("feature/login", "main")],
    wrong: [
      { kind: "selected", shas: [] },
      { kind: "selected", shas: ["C1", "C2"] },
    ],
    event: { kind: "selected", shas: ["C3"] },
  },
  {
    id: "select-many",
    ok: [{ kind: "marquee" }, sel("C4", true), { kind: "clearSelection" }],
    bad: [{ kind: "branchSelect", name: "main" }, { kind: "undo" }],
    wrong: [{ kind: "selected", shas: ["C3"] }],
    event: { kind: "selected", shas: ["C3", "C4"] },
  },
  {
    id: "merge-drag",
    ok: [drop("feature/login", "main")],
    bad: [
      drop("feature/theme", "main"),
      drop("main", "feature/login"),
      drop("feature/login", "experiment"),
      { kind: "gesture", op: { op: "merge", source: "feature/login" } },
      { kind: "marquee" },
    ],
    wrong: [
      { kind: "merged", source: "feature/theme", target: "main" },
      { kind: "merged", source: "feature/login", target: "experiment" },
    ],
    mutate: (w) => {
      w.view = patch(w.view!, {
        commits: [
          commit("M", "Merge feature/login", ["C5", "L2"]),
          ...w.view!.commits,
        ],
        branches: { ...w.view!.branches, main: "M" },
      });
    },
    event: { kind: "merged", source: "feature/login", target: "main" },
  },
  {
    id: "branch-select",
    ok: [{ kind: "branchSelect", name: "feature/theme" }],
    bad: [
      { kind: "branchSelect", name: "main" },
      { kind: "branchSelect", name: "feature/login" },
      sel("C3"),
    ],
    wrong: [{ kind: "branchSelected", name: "main" }],
    event: { kind: "branchSelected", name: "feature/theme" },
  },
  {
    id: "rebase",
    ok: [
      rebaseDrag("feature/theme", "main"),
      rebaseDrag("feature/theme", "M"),
      { kind: "branchSelect", name: "feature/theme" },
    ],
    bad: [
      rebaseDrag("feature/login", "main"),
      rebaseDrag("feature/theme", "experiment"),
      rebaseDrag("feature/theme", "C3"),
      cherry("E1"),
      { kind: "gesture", op: { op: "rebase", onto: "feature/theme" } },
      { kind: "branchSelect", name: "main" },
    ],
    wrong: [{ kind: "rebased", branch: "feature/login", onto: "main" }],
    mutate: (w) =>
      rewrite(
        w,
        [
          ["T2r", "Add theme switch", ["T1r"]],
          ["T1r", "Add drak theme", ["M"]],
        ],
        "T2r",
        "front",
      ),
    event: { kind: "rebased", branch: "feature/theme", onto: "main" },
  },
  {
    id: "cherry-pick",
    ok: [sel("E1"), { kind: "clearSelection" }, cherry("E1")],
    bad: [
      sel("E2"),
      sel("E1", true),
      cherry("E2"),
      cherry("E1", "E2"),
      { kind: "marquee" },
      {
        kind: "gesture",
        op: {
          op: "cherryPickNewBranch",
          shas: ["E1"],
          target: "C2",
          short: "C2",
        },
      },
    ],
    wrong: [{ kind: "cherryPicked", commits: [], onto: "main" }],
    mutate: (w) => {
      w.view = patch(w.view!, {
        commits: [
          commit("E1c", "Try faster render", ["M"]),
          ...w.view!.commits,
        ],
        branches: { ...w.view!.branches, main: "E1c" },
      });
    },
    event: { kind: "cherryPicked", commits: ["E1"], onto: "main" },
  },
  {
    id: "undo",
    ok: [{ kind: "undo" }],
    bad: [{ kind: "push" }, sel("C3"), gestureReset("C4")],
    wrong: [{ kind: "reset", target: "C4", mode: "mixed" }],
    mutate: (w) => {
      w.view = patch(w.view!, {
        commits: w.view!.commits.filter((x) => x.sha !== "E1c"),
        branches: { ...w.view!.branches, main: "M" },
      });
    },
    event: { kind: "undone" },
  },
  {
    id: "reset",
    ok: [
      gestureReset("C4"),
      gestureReset("C5"),
      gestureReset("C1", { mode: "hard" }),
      gestureReset("C2", { commitSha: "C2", candidates: ["main", "C2"] }),
    ],
    bad: [
      gestureReset("M"), // the tip itself
      gestureReset("feature/login"), // L2: a side-branch commit
      gestureReset("L1"),
      gestureReset("E1"),
      gestureReset("T2r"),
      gestureReset("L2"), // reachable only through the merged side branch
      gestureReset("zzz"), // not in the repo
      { kind: "gesture", op: { op: "checkout", branch: "feature/theme" } },
    ],
    wrong: [{ kind: "undone" }],
    mutate: (w) => {
      w.view = patch(w.view!, {
        branches: { ...w.view!.branches, main: "C4" },
      });
    },
    event: { kind: "reset", target: "C4", mode: "mixed" },
  },
  {
    id: "undo-reset",
    ok: [{ kind: "undo" }],
    bad: [gestureReset("C3"), { kind: "push" }],
    wrong: [{ kind: "reset", target: "C3", mode: "soft" }],
    mutate: (w) => {
      w.view = patch(w.view!, {
        branches: { ...w.view!.branches, main: "M" },
      });
    },
    event: { kind: "undone" },
  },
  {
    id: "checkout",
    ok: [{ kind: "checkout", target: "feature/theme" }],
    bad: [
      { kind: "checkout", target: "main" },
      { kind: "checkout", target: "T2r" }, // sha ⇒ would detach HEAD
      { kind: "checkout", target: "experiment" },
    ],
    wrong: [
      { kind: "checkedOut", target: "main" },
      { kind: "checkedOut", target: "T2r" },
    ],
    mutate: (w) => (w.view = patch(w.view!, { head: "feature/theme" })),
    event: { kind: "checkedOut", target: "feature/theme" },
  },
  {
    id: "open-detail",
    ok: [
      sel("C3"),
      { kind: "openDetail", sha: "C3" },
      { kind: "clearSelection" },
    ],
    bad: [
      sel("C4"),
      { kind: "openDetail", sha: "C4" },
      sel("C3", true),
      { kind: "marquee" },
      { kind: "purge", sha: "C3", path: "secrets.env" },
    ],
    wrong: [
      { kind: "selected", shas: ["C4"] },
      { kind: "selected", shas: ["C3", "C4"] },
      { kind: "detailOpened", sha: "C4" },
    ],
    event: { kind: "selected", shas: ["C3"] },
  },
  {
    id: "purge",
    ok: [
      { kind: "purge", sha: "C3", path: "secrets.env" },
      sel("C3"),
      { kind: "openDetail", sha: "C3" },
    ],
    bad: [
      { kind: "purge", sha: "C3", path: "config.json" },
      { kind: "purge", sha: "C4", path: "secrets.env" },
      { kind: "addFile", sha: "C3", path: "secrets.example.env" },
      sel("C4"),
      { kind: "clearSelection" },
    ],
    wrong: [{ kind: "purged", sha: "C3", path: "config.json" }],
    mutate: (w) => rewrite(w, chain("p"), "T2p"),
    event: { kind: "purged", sha: "C3p", path: "secrets.env" },
  },
  {
    id: "add-file",
    setupCalls: [`writeFile:${REPO}:secrets.example.env`],
    ok: [
      { kind: "addFile", sha: "C3p", path: "secrets.example.env" },
      sel("C3p"),
      { kind: "openDetail", sha: "C3p" },
    ],
    bad: [
      { kind: "addFile", sha: "C3", path: "secrets.example.env" }, // main's original
      { kind: "addFile", sha: "C3p", path: "secrets.env" },
      { kind: "purge", sha: "C3p", path: "secrets.env" },
      sel("C4p"),
    ],
    wrong: [{ kind: "fileAdded", sha: "C3p", path: "other.txt" }],
    mutate: (w) => rewrite(w, chain("q"), "T2q"),
    event: { kind: "fileAdded", sha: "C3q", path: "secrets.example.env" },
  },
  {
    id: "reword",
    ok: [
      { kind: "reword", sha: "T1q" },
      sel("T1q"),
      { kind: "openDetail", sha: "T1q" },
    ],
    bad: [
      { kind: "reword", sha: "T1" }, // stale old chains stay visible
      { kind: "reword", sha: "T1r" },
      { kind: "reword", sha: "T1p" },
      { kind: "reword", sha: "T2q" },
      { kind: "reword", sha: "C3q" },
      { kind: "purge", sha: "C3q", path: "secrets.env" },
    ],
    wrong: [
      { kind: "reworded", sha: "T1w", message: "Add drak theme" },
      { kind: "reworded", sha: "T1w", message: "   " },
      { kind: "reworded", sha: "T1w", message: "Add drak theme\n\nbody" },
    ],
    mutate: (w) =>
      rewrite(
        w,
        [
          ["T1w", "Add dark theme", ["Mq"]],
          ["T2w", "Add theme switch", ["T1w"]],
        ],
        "T2w",
      ),
    event: { kind: "reworded", sha: "T1w", message: "Add dark theme" },
  },
  {
    id: "push-rejected",
    ok: [{ kind: "push" }],
    bad: [
      { kind: "forcePush" },
      { kind: "other", name: "push-menu" },
      { kind: "logAnytimeToggle", enabled: true },
    ],
    wrong: [pushed(false, true), pushed(true, false), pushed(true, true)],
    event: pushed(false, false),
  },
  {
    id: "force-push",
    ok: [{ kind: "forcePush" }, { kind: "other", name: "push-menu" }],
    bad: [{ kind: "push" }, { kind: "openSettings" }],
    wrong: [pushed(true, false), pushed(false, false), pushed(false, true)],
    event: pushed(true, true, false),
  },
  { id: "log-intro", info: true },
  {
    id: "log-on",
    ok: [{ kind: "logAnytimeToggle", enabled: true }],
    bad: [{ kind: "logAnytimeToggle", enabled: false }, { kind: "push" }],
    wrong: [{ kind: "logAnytimeToggled", enabled: false }],
    event: { kind: "logAnytimeToggled", enabled: true },
  },
  {
    id: "log-sim",
    info: true,
    setupCalls: [`simulateLog:${REPO}:adgitter-log:3`],
  },
  {
    id: "log-off",
    ok: [{ kind: "logAnytimeToggle", enabled: false }],
    bad: [{ kind: "logAnytimeToggle", enabled: true }],
    wrong: [{ kind: "logAnytimeToggled", enabled: true }],
    event: { kind: "logAnytimeToggled", enabled: false },
  },
  {
    id: "theme",
    ok: [
      { kind: "openSettings" },
      { kind: "settingsTab", tab: "Personalize" },
      { kind: "applyTheme", id: "synthwave" },
      { kind: "saveSettings" },
      { kind: "closeSettings" },
    ],
    bad: [
      { kind: "settingsTab", tab: "General" },
      { kind: "push" },
      { kind: "openIssues" },
    ],
    wrong: [
      { kind: "settingsSaved", themeChanged: false },
      { kind: "settingsTabOpened", tab: "Personalize" },
    ],
    event: { kind: "settingsSaved", themeChanged: true },
  },
  {
    id: "issue-branch",
    ok: [{ kind: "openIssues" }, { kind: "issueBranch", issueId: "I-1" }],
    bad: [
      { kind: "issueStatus", issueId: "I-1", status: "done" },
      { kind: "openSettings" },
    ],
    wrong: [{ kind: "issueStatusChanged", issueId: "I-1", status: "done" }],
    event: { kind: "issueBranchCreated", issueId: "I-1", branch: "i-1-demo" },
  },
  {
    id: "issue-status",
    ok: [
      { kind: "openIssues" },
      { kind: "issueStatus", issueId: "I-1", status: "in_progress" },
    ],
    bad: [{ kind: "issueBranch", issueId: "I-2" }],
    wrong: [{ kind: "issueBranchCreated", issueId: "I-2", branch: "x" }],
    event: {
      kind: "issueStatusChanged",
      issueId: "I-1",
      status: "in_progress",
    },
  },
  { id: "finish", info: true },
];

describe("tutorial engine — full playthrough", () => {
  it("the test script covers every step, in order", () => {
    expect(SCRIPT.map((e) => e.id)).toEqual(STEPS.map((s) => s.id));
  });

  it("advances through all 24 steps on each step's done event", async () => {
    const { w, t, timers } = setup();
    await t.start();
    expect(t.active).toBe(true);

    for (let i = 0; i < SCRIPT.length; i++) {
      const e = SCRIPT[i];
      const step = STEPS[i];
      const p = t.presentation!;
      expect(p.id, `step ${i}`).toBe(e.id);
      expect(p.index).toBe(step.n);
      expect(p.total).toBe(TOTAL_STEPS);
      expect(p.mode).toBe(step.mode);
      expect(p.busy).toBe(false);
      expect(t.error).toBeNull();
      for (const call of e.setupCalls ?? [])
        expect(w.calls, `${e.id} setup`).toContain(call);

      if (e.info) {
        expect(p.mode).toBe("info");
        // An info step lets nothing through but its own navigation …
        expect(t.allows(sel("C1"))).toBe(false);
        expect(t.allows({ kind: "push" })).toBe(false);
        expect(t.allows(NAV)).toBe(true);
        timers.fire();
        // … and notify never completes it.
        t.notify({ kind: "undone" });
        expect(t.presentation?.id).toBe(e.id);
        if (e.id === "finish") break;
        await t.next();
        await t.whenIdle();
        continue;
      }

      // Action step: wrong kinds / wrong targets are refused with a hint …
      for (const a of e.bad ?? []) {
        expect(t.allows(a), `${e.id} must refuse ${JSON.stringify(a)}`).toBe(
          false,
        );
        expect(t.blocked).toBe(true);
        timers.fire();
        expect(t.blocked).toBe(false);
      }
      // … the right ones pass without raising the hint …
      for (const a of e.ok ?? []) {
        expect(t.allows(a), `${e.id} must allow ${JSON.stringify(a)}`).toBe(
          true,
        );
        expect(t.blocked).toBe(false);
      }
      // … navigation always passes …
      expect(t.allows(NAV)).toBe(true);
      // … and events that are not this step's outcome never advance it.
      for (const ev of e.wrong ?? []) {
        t.notify(ev);
        expect(
          t.presentation?.id,
          `${e.id} ignores ${JSON.stringify(ev)}`,
        ).toBe(e.id);
      }
      e.mutate?.(w);
      t.notify(e.event!);
      await t.whenIdle();
      expect(t.presentation?.id, `${e.id} advanced`).toBe(SCRIPT[i + 1].id);
    }

    // Step 3 really created and opened the demo.
    expect(w.calls.slice(0, 2)).toEqual(["createDemo", `openRepo:${REPO}`]);

    // Last step: finish().
    expect(t.presentation?.id).toBe("finish");
    expect(t.presentation?.primaryLabelKey).toBe("tutorial.finish.primary");
    await t.next();
    await t.whenIdle();
    expect(t.active).toBe(false);
    expect(t.presentation).toBeNull();
    expect(w.flags).toEqual([{ completed: true, firstUseShown: true }]);
    expect(w.count("showFirstUse")).toBe(1);
    expect(w.count("closeRepo")).toBe(1);
    expect(w.calls).toContain(`removeDemo:${REPO}`);
    // Order: flags, then the demo is closed and removed, then the intro.
    const tail = w.calls.slice(-3);
    expect(tail).toEqual(["closeRepo", `removeDemo:${REPO}`, "showFirstUse"]);
  });
});

// ── inactive ─────────────────────────────────────────────────────────────────
describe("tutorial engine — inactive", () => {
  it("allows everything, has no presentation, ignores notify", () => {
    const { t } = setup();
    expect(t.active).toBe(false);
    expect(t.presentation).toBeNull();
    expect(t.allows({ kind: "push" })).toBe(true);
    expect(t.allows(sel("x"))).toBe(true);
    expect(t.allows({ kind: "other", name: "anything" })).toBe(true);
    expect(t.blocked).toBe(false);
    t.notify({ kind: "undone" });
    expect(t.active).toBe(false);
  });

  it("allows everything again once the tutorial ended", async () => {
    const { t } = setup();
    await t.start();
    expect(t.allows({ kind: "push" })).toBe(false);
    await t.exit();
    expect(t.allows({ kind: "push" })).toBe(true);
    expect(t.blocked).toBe(false);
  });
});

// ── gate: info / busy / blocked flag ─────────────────────────────────────────
describe("tutorial engine — gate", () => {
  it("info steps allow only tutorial-nav; a refusal flashes `blocked` for 2.5s", async () => {
    const { t, timers } = setup();
    await t.start();
    expect(t.presentation?.mode).toBe("info");
    expect(t.presentation?.hintKey).toBe("tutorial.hint.info");

    expect(t.allows({ kind: "push" })).toBe(false);
    expect(t.blocked).toBe(true);
    expect(t.presentation?.blocked).toBe(true);
    expect(timers.delays()).toEqual([BLOCKED_MS]);
    expect(BLOCKED_MS).toBe(2500);

    timers.fire();
    expect(t.blocked).toBe(false);
    expect(t.presentation?.blocked).toBe(false);

    expect(t.allows(NAV)).toBe(true);
    expect(t.blocked).toBe(false);
  });

  it("a second refusal restarts the flash instead of stacking timers", async () => {
    const { t, timers } = setup();
    await t.start();
    t.allows({ kind: "push" });
    t.allows({ kind: "undo" });
    expect(timers.delays()).toEqual([BLOCKED_MS]);
    timers.fire();
    expect(t.blocked).toBe(false);
  });

  it("works with the real timers too (default setTimeout)", async () => {
    const w = makeWorld();
    const t = createTutorial(w.host);
    await t.start();
    t.allows({ kind: "push" });
    expect(t.blocked).toBe(true);
    await t.exit();
    expect(t.blocked).toBe(false); // leaving clears the flash and its timer
  });

  it("is `busy` while a setup runs: everything but nav is refused, notify is ignored", async () => {
    const { w, t } = setup();
    await t.start();
    await toStep(t, "tour-handle");
    w.hold.seedFiles = true;
    const going = t.next(); // enters first-commit → seedFiles runs
    expect(t.presentation?.id).toBe("first-commit");
    expect(t.busy).toBe(true);
    expect(t.presentation?.busy).toBe(true);
    expect(t.presentation?.hintKey).toBe("tutorial.hint.busy");
    // The step would allow `openFiles` — but not while busy.
    expect(t.allows({ kind: "openFiles" })).toBe(false);
    expect(t.allows(NAV)).toBe(true);
    t.notify({ kind: "committed", sha: "C2" });
    expect(t.presentation?.id).toBe("first-commit");
    w.release.seedFiles();
    await going;
    expect(t.busy).toBe(false);
    expect(t.allows({ kind: "openFiles" })).toBe(true);
    // The aborted notify did not count: the step is still waiting.
    expect(t.presentation?.id).toBe("first-commit");
  });

  it("action steps ignore next(); info steps ignore back() across a side effect", async () => {
    const { t } = setup();
    await t.start();
    await toStep(t, "first-commit");
    const before = t.index;
    await t.next();
    expect(t.index).toBe(before);
    t.back();
    expect(t.index).toBe(before);
  });
});

// ── navigation on info steps ─────────────────────────────────────────────────
describe("tutorial engine — next / back / start", () => {
  it("starts at the welcome step; Back only exists between plain info steps", async () => {
    const { t } = setup();
    await t.start();
    expect(t.presentation?.id).toBe("welcome");
    expect(t.presentation?.canGoBack).toBe(false);

    await t.next();
    expect(t.presentation?.id).toBe("choose");
    expect(t.presentation?.canGoBack).toBe(true);

    t.back();
    expect(t.presentation?.id).toBe("welcome");
    await t.next();
    await t.next();
    expect(t.presentation?.id).toBe("create-demo");
    expect(t.presentation?.canGoBack).toBe(true); // → choose (no side effect yet)
    t.back();
    expect(t.presentation?.id).toBe("choose");
  });

  it("the tour steps share one number and can go back among themselves, but not past the demo creation", async () => {
    const { t } = setup();
    await t.start();
    await toStep(t, "tour-graph");
    expect(t.presentation?.index).toBe(4);
    expect(t.presentation?.canGoBack).toBe(false); // previous step created the demo
    await t.next();
    expect(t.presentation?.id).toBe("tour-commit");
    expect(t.presentation?.index).toBe(4);
    expect(t.presentation?.canGoBack).toBe(true);
    t.back();
    expect(t.presentation?.id).toBe("tour-graph");
    t.back(); // refused
    expect(t.presentation?.id).toBe("tour-graph");
  });

  it("start('create-demo') (replay) begins at step 3 and cannot go back to the welcome", async () => {
    const { t } = setup();
    await t.start("create-demo");
    expect(t.presentation?.id).toBe("create-demo");
    expect(t.presentation?.index).toBe(3);
    expect(t.presentation?.canGoBack).toBe(false);
    t.back();
    expect(t.presentation?.id).toBe("create-demo");
  });

  it("an unknown start id falls back to the welcome step", async () => {
    const { t } = setup();
    await t.start("nope");
    expect(t.presentation?.id).toBe("welcome");
  });

  it("start() restarts cleanly: remembered values and errors are reset", async () => {
    const { w, t } = setup();
    await t.start();
    await toStep(t, "tour-graph");
    await t.start();
    expect(t.presentation?.id).toBe("welcome");
    expect(t.error).toBeNull();
    await toStep(t, "tour-graph");
    // The restarted run created a second demo instead of reusing a stale ctx.
    expect(w.count("createDemo")).toBe(2);
  });

  it("the primary button of step 3 creates the demo, opens it and advances", async () => {
    const { w, t } = setup();
    await t.start("create-demo");
    const p = t.presentation!;
    expect(p.primaryLabelKey).toBe("tutorial.createDemo.primary");
    expect(p.placement).toBe("center");
    expect(p.targets).toEqual([]);

    w.hold.createDemo = true;
    const going = t.primary();
    expect(t.busy).toBe(true);
    expect(t.presentation?.id).toBe("create-demo"); // not advanced yet
    expect(t.allows({ kind: "other", name: "whatever" })).toBe(false);
    // A second press while busy does nothing.
    void t.primary();
    w.release.createDemo();
    await going;
    await t.whenIdle();
    expect(t.presentation?.id).toBe("tour-graph");
    expect(w.calls).toEqual(["createDemo", `openRepo:${REPO}`]);
    expect(t.presentation?.targets).toEqual(['[data-tutorial="graph"]']);
  });

  it("next() on step 3 behaves like the primary button", async () => {
    const { w, t } = setup();
    await t.start("create-demo");
    await t.next();
    await t.whenIdle();
    expect(t.presentation?.id).toBe("tour-graph");
    expect(w.calls).toEqual(["createDemo", `openRepo:${REPO}`]);
  });

  it("primary() on an ordinary info step is Next", async () => {
    const { t } = setup();
    await t.start();
    await t.primary();
    expect(t.presentation?.id).toBe("choose");
  });
});

// ── setup errors ─────────────────────────────────────────────────────────────
describe("tutorial engine — setup failure and retry", () => {
  it("a failed demo creation shows the error, keeps the step and retries", async () => {
    const { w, t } = setup();
    await t.start("create-demo");
    w.fail.createDemo = new Error("disk full");
    await t.primary();
    expect(t.error).toBe("disk full");
    expect(t.busy).toBe(false);
    expect(t.presentation?.id).toBe("create-demo");
    expect(t.presentation?.error).toBe("disk full");
    // While errored only navigation passes; Next does not skip the step.
    expect(t.allows({ kind: "push" })).toBe(false);
    expect(t.allows(NAV)).toBe(true);
    await t.next();
    expect(t.presentation?.id).toBe("create-demo");

    await t.retry();
    await t.whenIdle();
    expect(t.error).toBeNull();
    expect(t.presentation?.id).toBe("tour-graph");
    expect(w.count("createDemo")).toBe(2);
  });

  it("a failed openRepo is retried without creating a second demo", async () => {
    const { w, t } = setup();
    await t.start("create-demo");
    w.fail.openRepo = "cannot open";
    await t.primary();
    expect(t.error).toBe("cannot open");
    await t.retry();
    await t.whenIdle();
    expect(t.presentation?.id).toBe("tour-graph");
    expect(w.count("createDemo")).toBe(1);
    expect(w.count("openRepo")).toBe(2);
  });

  it("errors from objects with a message (IPC errors) are surfaced", async () => {
    const { w, t } = setup();
    await t.start("create-demo");
    w.fail.createDemo = { code: "INTERNAL", message: "no space left" };
    await t.primary();
    expect(t.error).toBe("no space left");
  });

  it("a failing entry setup (seedFiles) keeps the action step blocked until retried", async () => {
    const { w, t } = setup();
    await t.start();
    await toStep(t, "tour-handle");
    w.fail.seedFiles = new Error("boom");
    await t.next();
    await t.whenIdle();
    expect(t.presentation?.id).toBe("first-commit");
    expect(t.error).toBe("boom");
    expect(t.allows({ kind: "openFiles" })).toBe(false);
    t.notify({ kind: "committed", sha: "C2" }); // ignored while errored
    expect(t.presentation?.id).toBe("first-commit");

    await t.retry();
    expect(t.error).toBeNull();
    expect(t.allows({ kind: "openFiles" })).toBe(true);
    expect(t.allows({ kind: "stage", paths: ["src/app.js"] })).toBe(true);
  });

  it("a failing auto step (seedHistory) cannot be skipped with Next", async () => {
    const { w, t } = setup();
    await t.start();
    await toStep(t, "first-commit");
    t.notify({ kind: "committed", sha: "C2" });
    await t.whenIdle();
    expect(t.presentation?.id).toBe("seed-history");
    // seed-history ran fine here; now simulate failure by re-entering it.
    w.fail.seedHistory = new Error("git failed");
    await t.start("seed-history");
    expect(t.error).toBe("git failed");
    await t.next();
    expect(t.presentation?.id).toBe("seed-history");
    await t.retry();
    await t.next();
    expect(t.presentation?.id).toBe("select-commit");
  });

  it("retry() without an error is a no-op", async () => {
    const { w, t } = setup();
    await t.start("create-demo");
    await t.retry();
    expect(w.calls).toEqual([]);
  });
});

// ── leaving ──────────────────────────────────────────────────────────────────
describe("tutorial engine — exit / finish / use directly", () => {
  it("exit() mid-tutorial saves the flags, closes + removes the demo, shows the intro once", async () => {
    const { w, t } = setup();
    await t.start();
    await toStep(t, "tour-head");
    await t.exit();
    expect(t.active).toBe(false);
    expect(w.flags).toEqual([{ completed: true, firstUseShown: true }]);
    expect(w.calls.slice(-3)).toEqual([
      "closeRepo",
      `removeDemo:${REPO}`,
      "showFirstUse",
    ]);
    expect(w.count("showFirstUse")).toBe(1);
  });

  it("a second exit()/finish() is a no-op", async () => {
    const { w, t } = setup();
    await t.start();
    await toStep(t, "tour-graph");
    const a = t.exit();
    const b = t.finish();
    await Promise.all([a, b]);
    await t.exit();
    expect(w.flags).toHaveLength(1);
    expect(w.count("showFirstUse")).toBe(1);
    expect(w.count("closeRepo")).toBe(1);
    expect(w.count("removeDemo")).toBe(1);
  });

  it("does not show the first-use intro again when it was shown before", async () => {
    const { w, t } = setup({ firstUseShown: true });
    await t.start("create-demo");
    await t.primary();
    await t.exit();
    expect(w.flags).toEqual([{ completed: true }]);
    expect(w.count("showFirstUse")).toBe(0);
    expect(w.count("closeRepo")).toBe(1);
  });

  it("exiting before a demo exists leaves the user's own repo alone", async () => {
    const { w, t } = setup();
    await t.start("create-demo");
    await t.exit();
    expect(w.count("closeRepo")).toBe(0);
    expect(w.count("removeDemo")).toBe(0);
    expect(w.flags).toEqual([{ completed: true, firstUseShown: true }]);
    expect(w.count("showFirstUse")).toBe(1);
  });

  it("chooseUseDirectly() at step 2 marks completed and shows the intro", async () => {
    const { w, t } = setup();
    await t.start();
    await t.next();
    expect(t.presentation?.id).toBe("choose");
    await t.chooseUseDirectly();
    expect(t.active).toBe(false);
    expect(w.flags).toEqual([{ completed: true, firstUseShown: true }]);
    expect(w.count("showFirstUse")).toBe(1);
    expect(w.count("closeRepo")).toBe(0);
    expect(w.count("removeDemo")).toBe(0);
    expect(w.count("createDemo")).toBe(0);
  });

  it("finish() from the last step behaves like exit", async () => {
    const { w, t } = setup();
    await t.start();
    await t.finish();
    expect(w.flags).toEqual([{ completed: true, firstUseShown: true }]);
    expect(w.count("showFirstUse")).toBe(1);
  });

  it("still shows the intro when saving the flag or removing the demo fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { w, t } = setup();
    await t.start("create-demo");
    await t.primary();
    w.fail.saveFlags = new Error("store locked");
    w.fail.closeRepo = new Error("busy");
    w.fail.removeDemo = new Error("in use");
    await t.exit();
    expect(w.count("showFirstUse")).toBe(1);
    expect(w.calls).toContain(`removeDemo:${REPO}`);
    expect(t.active).toBe(false);
    warn.mockRestore();
  });

  it("logs a failed demo removal (path and reason, nothing else) instead of swallowing it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { w, t } = setup();
    await t.start("create-demo");
    await t.primary();
    w.fail.removeDemo = new Error("directory is in use");
    await t.exit();
    const removal = warn.mock.calls.find((c) =>
      String(c[0]).includes("removing the demo"),
    );
    expect(removal).toEqual([
      "tutorial: removing the demo failed",
      REPO,
      "directory is in use",
    ]);
    // the run still ended cleanly
    expect(w.count("showFirstUse")).toBe(1);
    warn.mockRestore();
  });

  it("logs a failed close of the demo repo too, and still removes the demo", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { w, t } = setup();
    await t.start("create-demo");
    await t.primary();
    w.fail.closeRepo = new Error("busy");
    await t.exit();
    expect(
      warn.mock.calls.some((c) => String(c[0]).includes("closing the demo")),
    ).toBe(true);
    expect(w.calls).toContain(`removeDemo:${REPO}`);
    warn.mockRestore();
  });

  it("stays quiet when cleanup succeeds", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { t } = setup();
    await t.start("create-demo");
    await t.primary();
    await t.exit();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("exit during an in-flight demo creation waits for it and removes what it made", async () => {
    const { w, t } = setup();
    await t.start("create-demo");
    w.hold.openRepo = true;
    void t.primary(); // createDemo done, openRepo held
    await Promise.resolve();
    await Promise.resolve();
    expect(w.calls).toContain("createDemo");
    const leaving = t.exit();
    expect(t.active).toBe(false);
    w.release.openRepo();
    await leaving;
    await t.whenIdle();
    // The late setup must not advance a tutorial that already ended.
    expect(t.presentation).toBeNull();
    expect(w.calls).toContain(`removeDemo:${REPO}`);
    expect(w.count("closeRepo")).toBe(1);
    expect(w.count("showFirstUse")).toBe(1);
  });
});

// ── leaving races ────────────────────────────────────────────────────────────
describe("tutorial engine — a run ending while another starts", () => {
  afterEach(() => vi.restoreAllMocks());

  /** Every demo gets its own path, so the tests can tell the runs apart. */
  function numberedDemos(w: World) {
    const made: string[] = [];
    const create = w.host.createDemo;
    w.host.createDemo = async () => {
      const r = await create();
      const n = made.length + 1;
      made.push(`${REPO}-${n}`);
      return { repoPath: `${REPO}-${n}`, remotePath: `${r.remotePath}-${n}` };
    };
    return made;
  }
  const settle = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  it("exit() then an immediate start() never closes or deletes the new run's demo", async () => {
    const { w, t } = setup();
    const made = numberedDemos(w);
    await t.start("create-demo");
    await t.primary();
    expect(made).toHaveLength(1);

    w.hold.closeRepo = true; // the first run's cleanup is slow
    const leaving = t.exit();
    await settle();
    const restarted = t.start("create-demo");
    await settle();
    // the new run waits for the old cleanup: nothing of it is visible yet
    expect(t.active).toBe(false);
    expect(w.count("createDemo")).toBe(1);

    w.release.closeRepo();
    await leaving;
    await restarted;
    expect(t.active).toBe(true);
    await t.primary(); // the new run creates and opens its own demo
    await t.whenIdle();

    expect(w.calls.filter((c) => c.startsWith("removeDemo"))).toEqual([
      `removeDemo:${made[0]}`,
    ]);
    expect(w.count("closeRepo")).toBe(1);
    // the order matters: the old demo is gone before the new one exists
    const at = (c: string) => w.calls.indexOf(c);
    expect(at(`removeDemo:${made[0]}`)).toBeLessThan(
      w.calls.lastIndexOf("createDemo"),
    );
    expect(w.calls).toContain(`openRepo:${made[1]}`);
    expect(t.presentation?.id).toBe("tour-graph");

    // and the new run's own exit cleans up exactly its demo
    await t.exit();
    expect(w.calls.filter((c) => c.startsWith("removeDemo"))).toEqual([
      `removeDemo:${made[0]}`,
      `removeDemo:${made[1]}`,
    ]);
    expect(w.count("closeRepo")).toBe(2);
  });

  it("exit() during setup then an immediate start() still removes the old demo (no leak) and spares the new one", async () => {
    const { w, t } = setup();
    const made = numberedDemos(w);
    await t.start("create-demo");
    w.hold.openRepo = true;
    void t.primary(); // createDemo done, openRepo held
    await settle();
    expect(made).toHaveLength(1);

    const leaving = t.exit();
    const restarted = t.start("create-demo");
    w.release.openRepo();
    await leaving;
    await restarted;
    await t.primary();
    await t.whenIdle();

    expect(w.calls.filter((c) => c.startsWith("removeDemo"))).toEqual([
      `removeDemo:${made[0]}`,
    ]);
    // the old run's repo was opened (openRepo was already running) → closed once,
    // before the new demo was opened
    expect(w.count("closeRepo")).toBe(1);
    expect(w.calls.indexOf("closeRepo")).toBeLessThan(
      w.calls.indexOf(`openRepo:${made[1]}`),
    );
    expect(t.presentation?.id).toBe("tour-graph");
    expect(t.active).toBe(true);
  });

  it("a start() waits for the cleanup, but the first start of a session does not wait at all", async () => {
    const { w, t } = setup();
    const p = t.start();
    expect(t.active).toBe(true); // synchronous: nothing to wait for
    await p;
    expect(w.calls).toEqual([]);
  });

  it("two quick start()s after an exit begin exactly one run", async () => {
    const { w, t } = setup();
    await t.start("create-demo");
    await t.primary();
    w.hold.removeDemo = true;
    const leaving = t.exit();
    await settle();
    const a = t.start("create-demo");
    const b = t.start("create-demo");
    w.release.removeDemo();
    await Promise.all([leaving, a, b]);
    expect(t.active).toBe(true);
    expect(t.presentation?.id).toBe("create-demo");
    expect(w.count("createDemo")).toBe(1); // nothing ran twice
  });

  it("exit() during demo creation never opens the demo and removes what was made", async () => {
    const { w, t } = setup();
    await t.start("create-demo");
    w.hold.createDemo = true;
    const going = t.primary();
    expect(t.busy).toBe(true);
    const leaving = t.exit();
    expect(t.active).toBe(false);
    w.release.createDemo();
    await going;
    await leaving;
    await t.whenIdle();
    expect(w.count("openRepo")).toBe(0); // never flashed in the user's window
    expect(w.count("closeRepo")).toBe(0); // nothing was opened to close
    expect(w.calls).toContain(`removeDemo:${REPO}`);
    expect(t.presentation).toBeNull();
    expect(w.count("showFirstUse")).toBe(1);
  });

  it("a run replaced mid-setup (start() while active) does not open its late demo", async () => {
    const { w, t } = setup();
    await t.start("create-demo");
    w.hold.createDemo = true;
    const going = t.primary();
    await settle();
    const restarted = t.start("create-demo"); // active: no cleanup to wait for
    w.release.createDemo();
    await going;
    await restarted;
    expect(w.count("openRepo")).toBe(0);
    expect(t.presentation?.id).toBe("create-demo");
    expect(t.busy).toBe(false);
  });

  it("onEnd runs once, synchronously, however the run ends", async () => {
    for (const end of ["exit", "finish", "chooseUseDirectly"] as const) {
      const w = makeWorld();
      const onEnd = vi.fn();
      const t = createTutorial(w.host, STEPS, {
        firstUseShown: () => true,
        onEnd,
      });
      await t.start();
      expect(onEnd).not.toHaveBeenCalled();
      const p = t[end]();
      expect(onEnd, end).toHaveBeenCalledTimes(1); // before any await
      expect(t.active).toBe(false);
      await p;
      await t[end](); // a second call is a no-op
      expect(onEnd, end).toHaveBeenCalledTimes(1);
    }
  });

  it("onEnd also runs when the last step finishes the run", async () => {
    const w = makeWorld();
    const onEnd = vi.fn();
    const only = STEPS.filter((s) => s.id === "finish");
    const t = createTutorial(w.host, only, {
      firstUseShown: () => true,
      onEnd,
    });
    await t.start();
    await t.next();
    await t.whenIdle();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

// ── presentation ─────────────────────────────────────────────────────────────
describe("tutorial engine — presentation", () => {
  it("re-resolves targets from feature/theme's history after the repo changes and notify() is called", async () => {
    const w = makeWorld();
    w.view = patch(seededView(), { head: "feature/theme" });
    const t = createTutorial(
      w.host,
      STEPS.filter((s) => s.id === "open-detail"),
    );
    await t.start();
    // "Add config" reachable from feature/theme's tip.
    expect(t.presentation?.targets).toEqual(['[data-tutorial-commit="C3"]']);
    // A purge rewrote it: the new commit sits AFTER the old one in the list
    // (newest-first would put it before) — reachability still picks it.
    w.view = patch(w.view!, {
      commits: [...w.view!.commits, commit("C3x", "Add config", ["C2"])],
      branches: { ...w.view!.branches, "feature/theme": "C3x" },
    });
    t.notify({ kind: "refreshed" });
    expect(t.presentation?.targets).toEqual(['[data-tutorial-commit="C3x"]']);
  });

  it("reports allowKeys, hint and a centred card when a step has no targets", async () => {
    const { t } = setup();
    await t.start();
    expect(t.presentation?.placement).toBe("center");
    expect(t.presentation?.titleKey).toBe("tutorial.welcome.title");
    expect(t.presentation?.bodyKey).toBe("tutorial.welcome.body");
    expect(t.presentation?.total).toBe(24);
  });

  it("exposes the confirm-dialog keys on steps that open a confirm", async () => {
    // Run just one action step through a custom script.
    const w2 = makeWorld();
    w2.view = seededView();
    const t2 = createTutorial(
      w2.host,
      STEPS.filter((s) => s.id === "merge-drag"),
    );
    await t2.start();
    expect(t2.presentation?.allowKeys).toEqual(["Enter", "Escape"]);
    expect(t2.presentation?.targets).toContain(
      '[data-tutorial="merge-handle"]',
    );
    expect(t2.presentation?.targets).toContain(
      '[data-tutorial-branch="feature/login"]',
    );
    expect(t2.presentation?.targets).toContain(
      '[data-tutorial="confirm-dialog"]',
    );
  });

  it("a one-step custom script finishes when its last info step is next()ed", async () => {
    const w = makeWorld();
    const t = createTutorial(
      w.host,
      STEPS.filter((s) => s.id === "welcome"),
    );
    await t.start();
    expect(t.presentation?.index).toBe(1);
    await t.next();
    expect(t.active).toBe(false);
    expect(w.count("showFirstUse")).toBe(1);
  });
});
