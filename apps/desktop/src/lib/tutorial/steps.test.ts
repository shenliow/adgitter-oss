import { describe, it, expect } from "vitest";

import { catalogs, en } from "../i18n/messages";
import {
  STEPS,
  TOTAL_STEPS,
  branchSel,
  commitSel,
  fileSel,
  findOnBranch,
  firstParentLine,
  isMainRef,
  mainLineShas,
  newCtx,
  resolveRef,
  subjectOf,
  type TutorialStep,
  stepsWithoutTracker,
} from "./steps";
import type { TutorialAction, TutorialEvent, TutorialRepoView } from "./types";
import {
  REPO,
  commit,
  initialView,
  makeWorld,
  patch,
  seededView,
  type World,
} from "./testWorld";

const byId = (id: string): TutorialStep => {
  const s = STEPS.find((x) => x.id === id);
  if (!s) throw new Error(`no step ${id}`);
  return s;
};

/** seeded demo, then merged + rebased + feature/theme checked out. */
function midView(): TutorialRepoView {
  const v = seededView();
  return {
    ...v,
    head: "feature/theme",
    commits: [
      commit("T2r", "Add theme switch", ["T1r"]),
      commit("T1r", "Add drak theme", ["M"]),
      commit("M", "Merge feature/login", ["C5", "L2"]),
      ...v.commits,
    ],
    branches: { ...v.branches, main: "M", "feature/theme": "T2r" },
  };
}

// main's first-parent line through the starter history, newest first.
const STARTER_LINE = ["S3", "SM", "S2", "S1", "C1"];

describe("step script — structure", () => {
  it("has 24 contiguous top-level steps with the spec's sub-steps", () => {
    expect(TOTAL_STEPS).toBe(24);
    const ns = [...new Set(STEPS.map((s) => s.n))];
    expect(ns).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    expect(Math.max(...STEPS.map((s) => s.n))).toBe(TOTAL_STEPS);

    const sub = (n: number) => STEPS.filter((s) => s.n === n).map((s) => s.sub);
    for (const n of [7, 10, 13, 14, 17, 23]) expect(sub(n)).toEqual(["a", "b"]);
    expect(STEPS.filter((s) => s.n === 4)).toHaveLength(5); // the tour
    for (const n of [1, 2, 3, 5, 6, 8, 9, 11, 12, 15, 16]) {
      expect(sub(n)).toEqual([undefined]);
    }
  });

  it("is ordered by number and ids are unique", () => {
    const ns = STEPS.map((s) => s.n);
    expect(ns).toEqual([...ns].sort((a, b) => a - b));
    const ids = STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has the right info / action split", () => {
    const info = STEPS.filter((s) => s.mode === "info").map((s) => s.id);
    expect(info).toEqual([
      "welcome",
      "choose",
      "create-demo",
      "tour-graph",
      "tour-commit",
      "tour-branch",
      "tour-head",
      "tour-handle",
      "seed-history",
      "log-intro",
      "log-sim",
      "finish",
    ]);
    expect(STEPS.filter((s) => s.mode === "action")).toHaveLength(
      STEPS.length - info.length,
    );
  });

  it("every copy key exists in the en and zh-Hant catalogs", () => {
    const zh = catalogs["zh-Hant"] as Record<string, string>;
    const enc = en as Record<string, string>;
    const keys = new Set<string>(["tutorial.hint.info", "tutorial.hint.busy"]);
    for (const s of STEPS) {
      keys.add(s.titleKey);
      keys.add(s.bodyKey);
      if (s.hintKey) keys.add(s.hintKey);
      if (s.primaryLabelKey) keys.add(s.primaryLabelKey);
    }
    for (const k of keys) {
      expect(k.startsWith("tutorial."), k).toBe(true);
      expect(enc[k], `en ${k}`).toBeTruthy();
      expect(zh[k], `zh-Hant ${k}`).toBeTruthy();
    }
    // …and the catalogs carry nothing the script does not use.
    const all = Object.keys(enc).filter((k) => k.startsWith("tutorial."));
    expect(all.sort()).toEqual([...keys].sort());
  });

  it("every action step has its own hint, and allowKeys only where a dialog is part of it", () => {
    for (const s of STEPS) {
      if (s.mode === "action") {
        expect(s.hintKey, s.id).toBeTruthy();
        expect(s.hintKey, s.id).not.toBe("tutorial.hint.info");
      }
    }
    for (const id of [
      "merge-drag",
      "rebase",
      "cherry-pick",
      "reset",
      "purge",
      "force-push",
    ])
      expect(byId(id).allowKeys, id).toEqual(["Enter", "Escape"]);
    expect(byId("select-commit").allowKeys).toBeUndefined();
    expect(byId("log-on").allowKeys).toBeUndefined();
  });

  it("the setups that touch the demo are on the steps the spec names", () => {
    const withSetup = STEPS.filter((s) => s.setup).map((s) => s.id);
    expect(withSetup).toEqual([
      "create-demo",
      "first-commit",
      "seed-history",
      "add-file",
      "log-sim",
    ]);
    expect(byId("create-demo").setupOnPrimary).toBe(true);
    expect(STEPS.filter((s) => s.setupOnPrimary)).toHaveLength(1);
  });
});

describe("step script — setups call the host as the plan says", () => {
  async function run(id: string, w: World, seed = true) {
    const ctx = newCtx();
    ctx.repoPath = REPO;
    if (seed) w.view = seededView();
    await byId(id).setup!(w.host, ctx);
    return ctx;
  }

  it("step 3 creates then opens the demo and remembers it", async () => {
    const w = makeWorld();
    const ctx = newCtx();
    await byId("create-demo").setup!(w.host, ctx);
    expect(w.calls).toEqual(["createDemo", `openRepo:${REPO}`]);
    expect(ctx).toMatchObject({ repoPath: REPO, opened: true });
    expect(ctx.remotePath).toContain("origin.git");
  });

  it("step 5 remembers the seeded files and then only allows staging those", async () => {
    const w = makeWorld();
    const ctx = await run("first-commit", w);
    expect(ctx.seededFiles).toEqual([
      "src/app.js",
      "src/style.css",
      "docs/notes.md",
    ]);
    const s = byId("first-commit");
    const ok = (a: TutorialAction) => s.allows(a, w.view, ctx);
    expect(ok({ kind: "stage", paths: ["docs/notes.md", "src/app.js"] })).toBe(
      true,
    );
    expect(ok({ kind: "stage", paths: ["secrets.env"] })).toBe(false);
  });

  it("steps 6, 15 and 20 seed history / write the template / simulate 3 log commits", async () => {
    const w = makeWorld();
    await run("seed-history", w, false);
    await run("add-file", w);
    await run("log-sim", w);
    expect(w.calls).toEqual([
      `seedHistory:${REPO}`,
      `writeFile:${REPO}:secrets.example.env`,
      `simulateLog:${REPO}:adgitter-log:3`,
    ]);
  });
});

describe("view helpers", () => {
  it("findOnBranch resolves by reachability, not list order, among duplicate subjects", () => {
    // Old "Add config" (C3, still on main) is listed BEFORE the rewritten one.
    const v = patch(midView(), {
      commits: [
        ...midView().commits,
        commit("C3p", "Add config", ["C2"]),
        commit("T1p", "Add drak theme", ["C3p"]),
        commit("T2p", "Add theme switch", ["T1p"]),
      ],
      branches: { ...midView().branches, "feature/theme": "T2p" },
    });
    expect(findOnBranch(v, "feature/theme", "Add config")).toBe("C3p");
    expect(findOnBranch(v, "main", "Add config")).toBe("C3");
    expect(findOnBranch(v, "feature/theme", "Add drak theme")).toBe("T1p");
    expect(findOnBranch(v, "feature/theme", "Try faster render")).toBe(
      undefined,
    );
    expect(findOnBranch(v, "experiment", "Try faster render")).toBe("E1");
    // Unknown branch / no view.
    expect(findOnBranch(v, "nope", "Add config")).toBeUndefined();
    expect(findOnBranch(v, null, "Add config")).toBeUndefined();
    expect(findOnBranch(null, "main", "Add config")).toBeUndefined();
  });

  it("findOnBranch follows second parents of a merge and survives cycles / missing parents", () => {
    const v = midView();
    // L1 is only reachable through M's second parent.
    expect(findOnBranch(v, "main", "Add login form")).toBe("L1");
    const broken = patch(v, {
      commits: [commit("A", "x", ["B"]), commit("B", "y", ["A", "ghost"])],
      branches: { main: "A" },
    });
    expect(findOnBranch(broken, "main", "nothing")).toBeUndefined();
    expect(findOnBranch(broken, "main", "y")).toBe("B");
  });

  it("firstParentLine / mainLineShas follow first parents only", () => {
    const v = midView();
    expect(firstParentLine(v, "main")).toEqual([
      "M",
      "C5",
      "C4",
      "C3",
      "C2",
      ...STARTER_LINE,
    ]);
    expect(mainLineShas(v)).toEqual(["C5", "C4", "C3", "C2", ...STARTER_LINE]);
    // Before the merge main is just C5…C1; the L-branch never appears.
    expect(mainLineShas(seededView())).toEqual([
      "C4",
      "C3",
      "C2",
      ...STARTER_LINE,
    ]);
    // The starter history's merged side branch (docs/intro) is never on it.
    expect(mainLineShas(v)).not.toContain("D1");
    expect(mainLineShas(v)).not.toContain("D2");
    expect(firstParentLine(v, "nope")).toEqual([]);
    expect(mainLineShas(null)).toEqual([]);
  });

  it("resolveRef: branch name, refs/heads/…, full sha and sha prefix", () => {
    const v = patch(seededView(), {
      commits: [
        commit("abcdef1234", "A", []),
        commit("abd0000000", "B", []),
        ...seededView().commits,
      ],
    });
    expect(resolveRef(v, "main")).toBe("C5");
    expect(resolveRef(v, "refs/heads/feature/login")).toBe("L2");
    expect(resolveRef(v, "C3")).toBe("C3");
    expect(resolveRef(v, "abcd")).toBe("abcdef1234");
    expect(resolveRef(v, "abd0")).toBe("abd0000000");
    expect(resolveRef(v, "ab")).toBeUndefined(); // too short for a prefix
    expect(resolveRef(v, "nope")).toBeUndefined();
    expect(resolveRef(v, "")).toBeUndefined();
    expect(resolveRef(null, "main")).toBeUndefined();
  });

  it("isMainRef accepts main by name or tip sha only", () => {
    const v = midView();
    expect(isMainRef("main", v)).toBe(true);
    expect(isMainRef("refs/heads/main", v)).toBe(true);
    expect(isMainRef("M", v)).toBe(true);
    expect(isMainRef("C5", v)).toBe(false);
    expect(isMainRef("feature/theme", v)).toBe(false);
    expect(isMainRef(undefined, v)).toBe(false);
    expect(isMainRef("main", null)).toBe(true);
    expect(isMainRef("M", null)).toBe(false);
  });

  it("subjectOf and the selector builders", () => {
    expect(subjectOf(seededView(), "C3")).toBe("Add config");
    expect(subjectOf(seededView(), "zz")).toBeUndefined();
    expect(subjectOf(null, "C3")).toBeUndefined();
    expect(commitSel("abc")).toBe('[data-tutorial-commit="abc"]');
    expect(branchSel("feature/theme")).toBe(
      '[data-tutorial-branch="feature/theme"]',
    );
    expect(fileSel("secrets.env")).toBe('[data-tutorial-file="secrets.env"]');
    // quotes / backslashes cannot break out of the attribute value
    expect(branchSel('a"b\\c')).toBe('[data-tutorial-branch="a\\"b\\\\c"]');
  });
});

describe("step rules that need more than the playthrough", () => {
  const ctx = newCtx();
  const allowed = (id: string, a: TutorialAction, v = midView()) =>
    byId(id).allows(a, v, ctx);
  const done = (id: string, e: TutorialEvent, v = midView()) =>
    byId(id).done(e, v, ctx);
  const rebase = (branch: string, onto: string): TutorialAction => ({
    kind: "gesture",
    op: { op: "rebaseBranch", branch, onto, short: onto },
  });

  it("10a accepts main by name or by tip sha (the post-merge tip), nothing else", () => {
    const v = seededView();
    const merged = patch(v, { branches: { ...v.branches, main: "M" } });
    for (const onto of ["main", "refs/heads/main"])
      expect(allowed("rebase", rebase("feature/theme", onto), merged)).toBe(
        true,
      );
    expect(allowed("rebase", rebase("feature/theme", "M"), merged)).toBe(true);
    // C5 was main's tip before the merge — no longer.
    expect(allowed("rebase", rebase("feature/theme", "C5"), merged)).toBe(
      false,
    );
  });

  it("10a accepts a dropped-on-commit rebase whose `onto` is main's tip commit, even with candidates", () => {
    const v = midView();
    const a: TutorialAction = {
      kind: "gesture",
      op: {
        op: "rebaseBranch",
        branch: "feature/theme",
        onto: "M",
        short: "M",
        candidates: ["main", "other"],
      },
    };
    expect(allowed("rebase", a, v)).toBe(true);
  });

  it("10b completes for a cherry-pick onto main by name, by tip, or because HEAD is main", () => {
    const v = midView();
    const ev = (onto: string): TutorialEvent => ({
      kind: "cherryPicked",
      commits: ["x"],
      onto,
    });
    expect(done("cherry-pick", ev("main"), v)).toBe(true);
    expect(done("cherry-pick", ev("M"), v)).toBe(true);
    expect(done("cherry-pick", ev("???"), patch(v, { head: "main" }))).toBe(
      true,
    );
    expect(done("cherry-pick", ev("???"), v)).toBe(false);
  });

  it("10b resolves the cherry-pick source from experiment's history, not a copy on main", () => {
    const v = patch(midView(), {
      commits: [
        commit("E1c", "Try faster render", ["M"]),
        ...midView().commits,
      ],
      branches: { ...midView().branches, main: "E1c" },
    });
    const pick = (sha: string): TutorialAction => ({
      kind: "gesture",
      op: { op: "cherryPick", commits: [sha] },
    });
    expect(allowed("cherry-pick", pick("E1"), v)).toBe(true);
    expect(allowed("cherry-pick", pick("E1c"), v)).toBe(false);
  });

  it("12 accepts a branch name, a sha, or the commitSha of an ambiguous drop", () => {
    const v = midView();
    const reset = (
      target: string,
      extra: Record<string, unknown> = {},
    ): TutorialAction => ({
      kind: "gesture",
      op: { op: "reset", target, short: target, mode: "soft", ...extra },
    });
    expect(allowed("reset", reset("C4"), v)).toBe(true);
    expect(allowed("reset", reset("C3", { mode: "hard" }), v)).toBe(true);
    expect(allowed("reset", reset("C3"), v)).toBe(true);
    // an ambiguous drop on C2: `target` is the sha, `commitSha` too
    expect(
      allowed(
        "reset",
        reset("C2", { commitSha: "C2", candidates: ["a", "b"] }),
      ),
    ).toBe(true);
    // a drop on L2 resolves to a side-branch commit even via its branch name
    expect(allowed("reset", reset("feature/login"), v)).toBe(false);
    // main's own tip (a no-op reset) and the stale pre-merge tip, via `main`
    expect(allowed("reset", reset("main"), v)).toBe(false);
  });

  it("12's spotlight lists exactly main's first-parent ancestors", () => {
    const targets = byId("reset").targets(midView(), ctx);
    expect(targets).toContain('[data-tutorial="head-crown"]');
    for (const sha of ["C5", "C4", "C3", "C2", ...STARTER_LINE])
      expect(targets).toContain(commitSel(sha));
    for (const sha of ["D1", "D2", "M", "L1", "L2", "E1", "T2r"])
      expect(targets).not.toContain(commitSel(sha));
  });

  it("13b only takes the branch name — a sha would detach HEAD", () => {
    expect(
      allowed("checkout", { kind: "checkout", target: "feature/theme" }),
    ).toBe(true);
    expect(allowed("checkout", { kind: "checkout", target: "T2r" })).toBe(
      false,
    );
  });

  it("14a completes on detailOpened OR on a single selection of that sha", () => {
    const v = midView();
    expect(done("open-detail", { kind: "detailOpened", sha: "C3" }, v)).toBe(
      true,
    );
    expect(done("open-detail", { kind: "selected", shas: ["C3"] }, v)).toBe(
      true,
    );
    expect(done("open-detail", { kind: "detailOpened", sha: "C4" }, v)).toBe(
      false,
    );
    expect(
      done("open-detail", { kind: "selected", shas: ["C3", "C4"] }, v),
    ).toBe(false);
    expect(done("open-detail", { kind: "selected", shas: [] }, v)).toBe(false);
  });

  it("14a–16 resolve their commit on feature/theme even when a same-subject original is listed first", () => {
    const v = patch(midView(), {
      commits: [
        ...midView().commits,
        commit("C3p", "Add config", ["C2"]),
        commit("T1p", "Add drak theme", ["C3p"]),
        commit("T2p", "Add theme switch", ["T1p"]),
      ],
      branches: { ...midView().branches, "feature/theme": "T2p" },
    });
    // Step 14: the purge target is the rewritten commit, not main's original
    // (which the list reaches first).
    expect(
      allowed("purge", { kind: "purge", sha: "C3p", path: "secrets.env" }, v),
    ).toBe(true);
    expect(
      allowed("purge", { kind: "purge", sha: "C3", path: "secrets.env" }, v),
    ).toBe(false);
    expect(byId("open-detail").targets(v, ctx)).toEqual([commitSel("C3p")]);
    expect(allowed("reword", { kind: "reword", sha: "T1p" }, v)).toBe(true);
    expect(allowed("reword", { kind: "reword", sha: "T1r" }, v)).toBe(false);
    expect(allowed("reword", { kind: "reword", sha: "T1" }, v)).toBe(false);
  });

  it("steps that need a commit refuse (rather than guess) when it cannot be resolved", () => {
    const empty = patch(seededView(), { commits: [], branches: {} });
    for (const [id, a] of [
      ["purge", { kind: "purge", sha: "C3", path: "secrets.env" }],
      ["add-file", { kind: "addFile", sha: "C3", path: "secrets.example.env" }],
      ["reword", { kind: "reword", sha: "T1" }],
      ["open-detail", { kind: "openDetail", sha: "C3" }],
    ] as const)
      expect(byId(id).allows(a, empty, ctx), id).toBe(false);
    expect(byId("purge").allows({ kind: "undo" }, null, ctx)).toBe(false);
    // …and their spotlight falls back to a safe default instead of throwing.
    expect(byId("open-detail").targets(null, ctx)).toEqual([
      '[data-tutorial="graph"]',
    ]);
    expect(byId("merge-drag").targets(null, ctx)).toContain(
      '[data-tutorial="merge-handle"]',
    );
    expect(byId("tour-commit").targets(null, ctx)).toEqual([
      '[data-tutorial="graph"]',
    ]);
  });

  it("the graph tour points at the starter history's commit and chips", () => {
    const v = initialView();
    expect(byId("tour-commit").targets(v, ctx)).toEqual([commitSel("S2")]);
    expect(byId("tour-branch").targets(v, ctx)).toEqual([
      branchSel("main"),
      branchSel("docs/intro"),
    ]);
    // A view without the starter commit falls back to the whole graph.
    expect(byId("tour-commit").targets(patch(v, { commits: [] }), ctx)).toEqual(
      ['[data-tutorial="graph"]'],
    );
  });

  it("16 needs a changed, non-empty subject", () => {
    const e = (message: string): TutorialEvent => ({
      kind: "reworded",
      sha: "x",
      message,
    });
    expect(done("reword", e("Add dark theme"))).toBe(true);
    expect(done("reword", e("  Add dark theme  \n\nwhy"))).toBe(true);
    expect(done("reword", e("Add drak theme"))).toBe(false);
    expect(done("reword", e(" Add drak theme\nmore"))).toBe(false);
    expect(done("reword", e(""))).toBe(false);
  });

  it("17a completes on any failed non-force push, whatever `rejected` says; 17b needs force + ok", () => {
    const p = (
      force: boolean,
      ok: boolean,
      rejected: boolean,
    ): TutorialEvent => ({
      kind: "pushed",
      force,
      ok,
      rejected,
    });
    expect(done("push-rejected", p(false, false, true))).toBe(true);
    expect(done("push-rejected", p(false, false, false))).toBe(true);
    expect(done("push-rejected", p(false, true, false))).toBe(false);
    expect(done("push-rejected", p(true, false, true))).toBe(false);
    expect(done("force-push", p(true, true, false))).toBe(true);
    expect(done("force-push", p(true, false, true))).toBe(false);
    expect(done("force-push", p(true, false, false))).toBe(false);
    expect(done("force-push", p(false, true, false))).toBe(false);
  });

  it("22 needs the theme to have changed; the tab check ignores case", () => {
    expect(done("theme", { kind: "settingsSaved", themeChanged: true })).toBe(
      true,
    );
    expect(done("theme", { kind: "settingsSaved", themeChanged: false })).toBe(
      false,
    );
    expect(allowed("theme", { kind: "settingsTab", tab: "personalize" })).toBe(
      true,
    );
    expect(allowed("theme", { kind: "settingsTab", tab: "Themes" })).toBe(
      false,
    );
  });

  it("22 spotlights only the Personalize panel, its tab, OK and Cancel — not the whole Settings modal", () => {
    const targets = byId("theme").targets(midView(), ctx);
    expect(targets).toEqual([
      '[data-tutorial="topbar-settings"]',
      '[data-tutorial="settings-tab-Personalize"]',
      '[data-tutorial="settings-panel-Personalize"]',
      '[data-tutorial="settings-ok"]',
      '[data-tutorial="settings-cancel"]',
    ]);
    // the modal root (and with it General's git-email field and every other
    // tab) is not a hole, and neither is any other tab's button or panel
    expect(targets).not.toContain('[data-tutorial="settings-modal"]');
    expect(targets.filter((s) => /settings-tab-/.test(s))).toEqual([
      '[data-tutorial="settings-tab-Personalize"]',
    ]);
    expect(targets.filter((s) => /settings-panel-/.test(s))).toEqual([
      '[data-tutorial="settings-panel-Personalize"]',
    ]);
  });

  it("22 refuses every Settings tab but Personalize, and anything else the modal could do", () => {
    for (const tab of [
      "General",
      "Shortcut",
      "Account",
      "Themes",
      "Plan",
      "Log Anytime",
      "Issue Panel",
      "Devices",
      "",
    ])
      expect(allowed("theme", { kind: "settingsTab", tab }), tab).toBe(false);
    expect(allowed("theme", { kind: "settingsTab", tab: "Personalize" })).toBe(
      true,
    );
    // the flow itself, and Cancel (never trap the user in the modal)
    for (const kind of [
      "openSettings",
      "saveSettings",
      "closeSettings",
    ] as const)
      expect(allowed("theme", { kind }), kind).toBe(true);
    expect(allowed("theme", { kind: "applyTheme", id: "dark" })).toBe(true);
    // buying a theme is not part of the lesson
    expect(allowed("theme", { kind: "other", name: "theme-buy" })).toBe(false);
  });

  it("selection steps: 7b allows several, 7a does not; select needs a plain click in 10b/14a", () => {
    const sel = (sha: string, additive: boolean): TutorialAction => ({
      kind: "select",
      sha,
      additive,
    });
    expect(allowed("select-many", sel("C3", true))).toBe(true);
    expect(allowed("select-commit", sel("C3", true))).toBe(false);
    expect(allowed("select-commit", { kind: "marquee" })).toBe(false);
    expect(allowed("select-many", { kind: "marquee" })).toBe(true);
    for (const id of [
      "select-commit",
      "select-many",
      "cherry-pick",
      "open-detail",
    ])
      expect(allowed(id, { kind: "clearSelection" }), id).toBe(true);
    for (const id of ["purge", "add-file", "reword"])
      expect(allowed(id, { kind: "clearSelection" }), id).toBe(false);
  });

  it("info steps never complete from events", () => {
    for (const s of STEPS.filter((x) => x.mode === "info")) {
      expect(s.done({ kind: "undone" }, midView(), ctx), s.id).toBe(false);
      expect(s.allows({ kind: "undo" }, midView(), ctx), s.id).toBe(false);
    }
  });

  it("every step's targets are plain data-tutorial selectors", () => {
    for (const s of STEPS) {
      for (const sel of s.targets(midView(), ctx))
        expect(sel, s.id).toMatch(/^\[data-tutorial(-[a-z]+)?="[^"]+"\]$/);
    }
  });
});

describe("step script — without the issue tracker", () => {
  it("drops 23a/23b and renumbers what follows, keeping the count contiguous", () => {
    const steps = stepsWithoutTracker();
    expect(
      steps.some((s) => s.id === "issue-branch" || s.id === "issue-status"),
    ).toBe(false);
    const ns = [...new Set(steps.map((s) => s.n))];
    expect(ns).toEqual(Array.from({ length: 23 }, (_, i) => i + 1));
    expect(steps.find((s) => s.id === "finish")?.n).toBe(23);
  });

  it("leaves the full script untouched", () => {
    expect(STEPS.find((s) => s.id === "finish")?.n).toBe(24);
  });
});
