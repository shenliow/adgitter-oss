/**
 * Guided tutorial — App integration: the startup trigger, the
 * use-directly path, the tutorial gate at App's choke points, the Log Anytime
 * timer suppression and replay. The engine and its real step script run;
 * only the IPC is mocked (see test/appHarness.ts).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appExports,
  branchChip,
  defaultRefs,
  cleanupApp,
  commitRow,
  ipc,
  menuItem,
  mountApp,
  recentsApi,
  rewriteGate,
  rightClick,
  settingsApi,
  settle,
  toolbarButton,
} from "./test/appHarness";
import { t } from "./lib/i18n/index.svelte";
import type { MessageKey } from "./lib/i18n/messages";

afterEach(() => {
  cleanupApp();
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

const DEMO_REPO = "/tutorial/demo-1/repo";

const tt = (key: string) => t(key as MessageKey);
const welcomeTour = () =>
  document.querySelector<HTMLElement>(
    `[role="dialog"][aria-label="${t("welcomeTour.title")}"]`,
  );
const overlay = () =>
  document.querySelector<HTMLElement>("[data-tutorial-overlay]");
const coachTitle = () =>
  overlay()?.querySelector(".card .title")?.textContent?.trim() ?? null;
const coachHint = () =>
  overlay()?.querySelector(".card .hint")?.textContent?.trim() ?? null;
const firstUseGuide = () =>
  document.querySelector<HTMLElement>(
    `[role="dialog"][aria-label="${t("firstUse.title")}"]`,
  );
const byTextIn = (root: ParentNode, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === text,
  ) ?? null;

async function click(el: Element | null) {
  expect(el).not.toBeNull();
  (el as HTMLElement).click();
  await settle();
}

/** A macrotask turn, for flows that chain several awaited mock promises. */
async function settleAll() {
  await new Promise((r) => setTimeout(r, 0));
  await settle();
}

describe("tutorial startup trigger", () => {
  it("greets a first launch in the main window with the welcome tour", async () => {
    await mountApp({
      settings: { tutorial: { completed: false } },
      openRepo: false,
    });
    expect(welcomeTour()).not.toBeNull();
    // The tour is steps 1–2: no spotlight overlay underneath it yet.
    expect(overlay()).toBeNull();
  });

  it("stays quiet once the tutorial was completed", async () => {
    await mountApp();
    expect(welcomeTour()).toBeNull();
    expect(overlay()).toBeNull();
  });

  it("stays quiet in a secondary window", async () => {
    await mountApp({
      settings: { tutorial: { completed: false } },
      openRepo: false,
      windowLabel: "repo-2",
    });
    expect(welcomeTour()).toBeNull();
  });

  it("stays quiet in a window opened with ?repo=", async () => {
    window.history.replaceState(null, "", "/?repo=%2Frepo");
    await mountApp({
      settings: { tutorial: { completed: false } },
      openRepo: false,
    });
    expect(welcomeTour()).toBeNull();
    // …and that window opened its repo as usual.
    expect(ipc.listCommits).toHaveBeenCalledWith("/repo", 1000);
  });

  it("does not let the Welcome screen open a repo behind the tour", async () => {
    const host = await mountApp({
      settings: { tutorial: { completed: false } },
      openRepo: false,
    });
    const avatar = [
      ...host.querySelectorAll<HTMLButtonElement>(".avatar"),
    ].find((b) => !b.classList.contains("new"));
    await click(avatar ?? null);
    expect(ipc.listCommits).not.toHaveBeenCalled();
  });
});

describe("use directly", () => {
  it("marks the tutorial completed and shows the first-use intro once", async () => {
    await mountApp({
      settings: { tutorial: { completed: false, firstUseShown: false } },
      openRepo: false,
    });
    const tour = welcomeTour()!;
    await click(byTextIn(tour, t("welcomeTour.next")));
    await click(
      [...tour.querySelectorAll<HTMLButtonElement>("button.choice.direct")][0],
    );
    await settleAll();

    expect(welcomeTour()).toBeNull();
    expect(settingsApi.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        tutorial: { completed: true, firstUseShown: true },
      }),
    );
    expect(firstUseGuide()).not.toBeNull();

    await click(
      firstUseGuide()!.querySelector<HTMLButtonElement>(
        `button[aria-label="${t("firstUse.close")}"]`,
      ),
    );
    expect(firstUseGuide()).toBeNull();
    // The demo was never created on this path.
    expect(ipc.tutorialDemoCreate).not.toHaveBeenCalled();
  });

  it("skips the intro when it has already been shown on this machine", async () => {
    await mountApp({
      settings: { tutorial: { completed: false, firstUseShown: true } },
      openRepo: false,
    });
    const tour = welcomeTour()!;
    await click(byTextIn(tour, t("welcomeTour.next")));
    await click(tour.querySelector("button.choice.direct"));
    await settleAll();
    expect(welcomeTour()).toBeNull();
    expect(firstUseGuide()).toBeNull();
    expect(settingsApi.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        tutorial: { completed: true, firstUseShown: true },
      }),
    );
  });
});

describe("start → create demo → first steps (real UI)", () => {
  it("creates and opens the demo without adding it to recents, then gates the commit step", async () => {
    await mountApp({
      settings: { tutorial: { completed: false } },
      openRepo: false,
    });
    const tour = welcomeTour()!;
    await click(byTextIn(tour, t("welcomeTour.next")));
    await click(tour.querySelector("button.choice.start"));
    expect(coachTitle()).toBe(tt("tutorial.createDemo.title"));
    // The "Create demo" primary replaces Next on this step.
    expect(overlay()!.querySelector(".btn-next")).toBeNull();

    ipc.listCommits.mockClear();
    await click(overlay()!.querySelector(".btn-primary"));
    await settleAll();
    expect(ipc.tutorialDemoCreate).toHaveBeenCalledOnce();
    expect(ipc.listCommits).toHaveBeenCalledWith(DEMO_REPO, 1000);
    expect(recentsApi.addRecent).not.toHaveBeenCalled();
    expect(coachTitle()).toBe(tt("tutorial.tourGraph.title"));

    // Step 4 is a five-spot tour of info cards.
    for (let i = 0; i < 5; i++)
      await click(overlay()!.querySelector(".btn-next"));
    await settleAll();
    expect(coachTitle()).toBe(tt("tutorial.firstCommit.title"));
    expect(ipc.tutorialDemoSeedFiles).toHaveBeenCalledWith(DEMO_REPO);

    // Off-script: undo/push are refused before any IPC.
    const host = document.body;
    await click(toolbarButton(host, t("toolbar.push")));
    expect(ipc.push).not.toHaveBeenCalled();
    expect(coachHint()).toBe(tt("tutorial.firstCommit.hint"));

    // On-script: open Files, stage a seeded file, commit.
    ipc.repoStatus.mockResolvedValue({
      staged: [],
      changed: [],
      untracked: [
        { path: "src/app.js", status: "new", old_path: null },
        { path: "notes/other.txt", status: "new", old_path: null },
      ],
      ignored: [],
      conflicted: [],
    });
    await click(host.querySelector('[data-tutorial="toolbar-files"]'));
    await settleAll();
    const panel = host.querySelector('[data-tutorial="files-panel"]')!;
    expect(panel).not.toBeNull();
    const stageButtons = [
      ...panel.querySelectorAll<HTMLButtonElement>("button"),
    ].filter((b) => b.textContent?.trim() === "+");
    expect(stageButtons).toHaveLength(2);
    // "notes/other.txt" is not one of the seeded files: refused.
    const rowPath = (b: HTMLElement) => b.closest(".file")?.textContent ?? "";
    const other = stageButtons.find((b) => rowPath(b).includes("other.txt"));
    const seeded = stageButtons.find((b) => rowPath(b).includes("app.js"));
    await click(other ?? null);
    expect(ipc.stagePaths).not.toHaveBeenCalled();
    await click(seeded ?? null);
    expect(ipc.stagePaths).toHaveBeenCalledWith(DEMO_REPO, ["src/app.js"]);

    ipc.repoStatus.mockResolvedValue({
      staged: [{ path: "src/app.js", status: "new", old_path: null }],
      changed: [],
      untracked: [],
      ignored: [],
      conflicted: [],
    });
    await click(host.querySelector('[data-tutorial="toolbar-files"]'));
    await click(host.querySelector('[data-tutorial="toolbar-files"]'));
    await settleAll();
    const bar = host.querySelector('[data-tutorial="commit-bar"]')!;
    const textarea = bar.querySelector("textarea")!;
    textarea.value = "My first commit";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    await click(bar.querySelector("button.btn"));
    await settleAll();
    expect(ipc.createCommit).toHaveBeenCalledWith(DEMO_REPO, "My first commit");
    // Committed ⇒ step 6, whose setup seeds the history.
    expect(ipc.tutorialDemoSeedHistory).toHaveBeenCalledWith(DEMO_REPO);
    expect(coachTitle()).toBe(tt("tutorial.seedHistory.title"));
  });
});

describe("the tutorial gate at App's choke points", () => {
  /** Enable Undo the ordinary way (revert a commit) before the tutorial. */
  async function enableUndo(host: HTMLElement) {
    rightClick(commitRow(host, "Fix bug Y")!);
    await settle();
    await click(menuItem(host, t("menu.revert")));
    rewriteGate(host).confirm();
    await settleAll();
    expect(ipc.revert).toHaveBeenCalledOnce();
  }

  it("refuses undo, push, shortcuts, menus and Delete while step 8 waits for the merge drag", async () => {
    // Demo-shaped refs: feature/login's tip ("Fix bug Y") is one of step 8's
    // spotlight holes, so a right-click there passes the overlay and only
    // App's own gate can stop it.
    const refs = defaultRefs();
    refs.branches[1].name = "feature/login";
    const host = await mountApp({ refs });
    await enableUndo(host);
    // Select a commit beforehand so Delete would otherwise ask to drop it.
    await click(commitRow(host, "Fix bug Y"));
    await appExports().startTutorial("merge-drag");
    await settle();
    expect(coachTitle()).toBe(tt("tutorial.mergeDrag.title"));

    await click(toolbarButton(host, t("toolbar.undo")));
    expect(ipc.undo).not.toHaveBeenCalled();
    expect(coachHint()).toBe(tt("tutorial.mergeDrag.hint"));

    await click(toolbarButton(host, t("toolbar.push")));
    expect(ipc.push).not.toHaveBeenCalled();

    // Mod+P is the push shortcut.
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
    );
    await settle();
    expect(ipc.push).not.toHaveBeenCalled();
    expect(rewriteGate(host).dialog).toBeNull();

    // A context menu on a commit — even one inside a spotlight hole — and on a
    // branch chip never opens.
    const loginRow = commitRow(host, "Fix bug Y")!;
    rightClick(loginRow);
    rightClick(branchChip(host, "feature/login")!);
    await settle();
    expect(host.querySelector('[role="menu"]')).toBeNull();
    // (Contrast: before the tutorial the very same right-click opened a menu —
    // see `enableUndo`.)

    // Neither does a plain selection, or the Files panel.
    await click(commitRow(host, "Initial commit"));
    expect(
      commitRow(host, "Initial commit")!.classList.contains("selected"),
    ).toBe(false);
    await click(host.querySelector('[data-tutorial="toolbar-files"]'));
    expect(host.querySelector('[data-tutorial="files-panel"]')).toBeNull();
    expect(coachTitle()).toBe(tt("tutorial.mergeDrag.title"));
  });

  it("lets the step's own operation through and advances on its outcome", async () => {
    const host = await mountApp();
    await enableUndo(host);
    await appExports().startTutorial("undo");
    await settle();
    expect(coachTitle()).toBe(tt("tutorial.undo.title"));

    ipc.undo.mockResolvedValue({ op: "revert" });
    await click(toolbarButton(host, t("toolbar.undo")));
    await settleAll();
    expect(ipc.undo).toHaveBeenCalledOnce();
    expect(coachTitle()).toBe(tt("tutorial.reset.title"));
  });

  it("push is rejected (advances on the failure), then force push through its menu and confirm", async () => {
    const host = await mountApp();
    await appExports().startTutorial("push-rejected");
    await settle();

    // The push menu is not this step's business yet.
    await click(host.querySelector('[data-tutorial="toolbar-push-menu"]'));
    expect(host.querySelector('[data-tutorial="push-force-item"]')).toBeNull();

    ipc.push.mockRejectedValueOnce({
      code: "GIT_ERROR",
      message: "cannot push non-fastforwardable reference",
    });
    await click(host.querySelector('[data-tutorial="toolbar-push"]'));
    await settleAll();
    expect(ipc.push).toHaveBeenCalledWith(
      "/repo",
      "origin",
      { kind: "none" },
      false,
      null,
    );
    expect(coachTitle()).toBe(tt("tutorial.forcePush.title"));

    await click(host.querySelector('[data-tutorial="toolbar-push-menu"]'));
    await click(host.querySelector('[data-tutorial="push-force-item"]'));
    const gate = document.querySelector('[data-tutorial="confirm-rewrite"]');
    expect(gate).not.toBeNull();
    rewriteGate(host).confirm();
    await settleAll();
    expect(ipc.push).toHaveBeenLastCalledWith(
      "/repo",
      "origin",
      { kind: "none" },
      true,
      null,
    );
    expect(coachTitle()).toBe(tt("tutorial.logIntro.title"));
  });
});

describe("Log Anytime while the tutorial runs", () => {
  it("suppresses the real snapshot timer, and re-arms it once the tutorial ends", async () => {
    vi.useFakeTimers();
    await mountApp({
      settings: { logAnytime: { enabled: true, intervalMin: 1 } },
    });
    await appExports().startTutorial("log-intro");
    await settle();
    vi.advanceTimersByTime(3 * 60_000);
    await settle();
    expect(ipc.logCommit).not.toHaveBeenCalled();

    // Exit (confirmed) — the repo was not the tutorial's, so it stays open.
    await click(overlay()!.querySelector(".btn-exit"));
    await click(overlay()!.querySelector(".btn-exit-confirm"));
    await settle();
    expect(overlay()).toBeNull();
    vi.advanceTimersByTime(60_000);
    await settle();
    expect(ipc.logCommit).toHaveBeenCalledWith("/repo", "adgitter-log");
  });

  it("the toolbar toggle is the step's operation (on, then off)", async () => {
    const host = await mountApp();
    await appExports().startTutorial("log-on");
    await settle();
    const toggle = host.querySelector<HTMLButtonElement>(
      '[data-tutorial="toolbar-log-anytime"]',
    )!;
    await click(toggle);
    await settleAll();
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    // log-on ⇒ log-sim, whose setup simulates the snapshots.
    expect(ipc.tutorialDemoSimulateLog).toHaveBeenCalledWith(
      "",
      "adgitter-log",
      3,
    );
    expect(coachTitle()).toBe(tt("tutorial.logSim.title"));
  });
});

describe("replay from the user menu", () => {
  it("closes the open repo and restarts at the demo step; the Issue panel previews on the demo", async () => {
    const host = await mountApp();
    recentsApi.addRecent.mockClear(); // the mount itself opened a recent
    await click(host.querySelector(".icon-btn.avatar"));
    await click(byTextIn(document.body, t("user.replayTutorial")));
    // Back on the Welcome screen, with the create-demo card up.
    expect(host.querySelector(".shell")).toBeNull();
    expect(coachTitle()).toBe(tt("tutorial.createDemo.title"));
    await click(overlay()!.querySelector(".btn-primary"));
    await settleAll();
    expect(ipc.tutorialDemoCreate).toHaveBeenCalledOnce();
    expect(recentsApi.addRecent).not.toHaveBeenCalled();
  });
});

describe("step 22: Settings opens on Personalize only", () => {
  const panel = (id: string) =>
    document.querySelector(`[data-tutorial="settings-panel-${id}"]`);

  it("lands on the Personalize panel, with no General panel (git email) behind it", async () => {
    const host = await mountApp();
    await appExports().startTutorial("theme");
    await settle();
    await click(host.querySelector('[data-tutorial="topbar-settings"]'));
    expect(panel("Personalize")).not.toBeNull();
    expect(panel("General")).toBeNull();
    expect(document.querySelector('[data-field="git-email"]')).toBeNull();
    // the other tabs are refused (the overlay also keeps the pointer out)
    await click(
      document.querySelector('[data-tutorial="settings-tab-General"]'),
    );
    expect(panel("General")).toBeNull();
    expect(panel("Personalize")).not.toBeNull();
  });

  it("every spotlight target of the step exists in the real modal", async () => {
    const host = await mountApp();
    await appExports().startTutorial("theme");
    await settle();
    await click(host.querySelector('[data-tutorial="topbar-settings"]'));
    for (const id of [
      "settings-panel-Personalize",
      "settings-tab-Personalize",
      "settings-ok",
      "settings-cancel",
    ])
      expect(
        document.querySelector(`[data-tutorial="${id}"]`),
        id,
      ).not.toBeNull();
  });

  it("Settings outside the tutorial still opens on General", async () => {
    const host = await mountApp();
    await click(host.querySelector('[data-tutorial="topbar-settings"]'));
    expect(panel("General")).not.toBeNull();
    expect(panel("Personalize")).toBeNull();
  });
});

describe("leaving the tutorial", () => {
  async function exitFromDemo() {
    await mountApp({
      settings: { tutorial: { completed: false, firstUseShown: true } },
      openRepo: false,
    });
    const tour = welcomeTour()!;
    await click(byTextIn(tour, t("welcomeTour.next")));
    await click(tour.querySelector("button.choice.start"));
    await click(overlay()!.querySelector(".btn-primary"));
    await settleAll();
    expect(ipc.tutorialDemoCreate).toHaveBeenCalledOnce();
  }

  it("waits for the repo watcher to stop before deleting the demo directory", async () => {
    await exitFromDemo();
    let stopped: () => void = () => {};
    ipc.stopRepoWatch.mockImplementation(
      () => new Promise<void>((resolve) => (stopped = resolve)),
    );
    await click(overlay()!.querySelector(".btn-exit"));
    await click(overlay()!.querySelector(".btn-exit-confirm"));
    await settleAll();
    expect(ipc.stopRepoWatch).toHaveBeenCalled();
    // the watcher has not stopped yet: the directory must still be there
    expect(ipc.tutorialDemoRemove).not.toHaveBeenCalled();
    stopped();
    await settleAll();
    expect(ipc.tutorialDemoRemove).toHaveBeenCalledWith(DEMO_REPO);
  });

  it("a failing watcher stop does not keep the demo from being removed", async () => {
    await exitFromDemo();
    ipc.stopRepoWatch.mockRejectedValue(new Error("gone"));
    await click(overlay()!.querySelector(".btn-exit"));
    await click(overlay()!.querySelector(".btn-exit-confirm"));
    await settleAll();
    expect(ipc.tutorialDemoRemove).toHaveBeenCalledWith(DEMO_REPO);
  });

  it("logs, instead of hiding, a demo removal that failed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await exitFromDemo();
    ipc.tutorialDemoRemove.mockRejectedValue(new Error("in use"));
    await click(overlay()!.querySelector(".btn-exit"));
    await click(overlay()!.querySelector(".btn-exit-confirm"));
    await settleAll();
    expect(warn).toHaveBeenCalledWith(
      "tutorial: removing the demo failed",
      DEMO_REPO,
      "in use",
    );
    warn.mockRestore();
  });

  it("closing a repo the ordinary way is unchanged: fire-and-forget watcher stop", async () => {
    const host = await mountApp();
    ipc.stopRepoWatch.mockImplementation(() => new Promise<void>(() => {}));
    await click(host.querySelector("button.back-repo"));
    // never resolves, yet the Welcome screen is already up
    expect(host.querySelector(".shell")).toBeNull();
  });
});

describe("spotlight targets exist in the real DOM", () => {
  it("every static step target and the per-commit / branch / file anchors render", async () => {
    const host = await mountApp();
    const has = (sel: string) => document.querySelector(sel) !== null;
    for (const id of [
      "graph",
      "head-crown",
      "create-commit",
      "toolbar-files",
      "toolbar-undo",
      "toolbar-push",
      "toolbar-push-menu",
      "toolbar-log-anytime",
      "toolbar-issues",
      "topbar-settings",
    ])
      expect(has(`[data-tutorial="${id}"]`), id).toBe(true);
    for (const c of ["a1", "b2", "c3"])
      expect(has(`[data-tutorial-commit="${c.repeat(20)}"]`)).toBe(true);
    expect(has('[data-tutorial-branch="main"]')).toBe(true);
    expect(has('[data-tutorial-branch="feature"]')).toBe(true);

    await click(host.querySelector('[data-tutorial="toolbar-push-menu"]'));
    expect(has('[data-tutorial="push-force-item"]')).toBe(true);
    await click(host.querySelector('[data-tutorial="push-force-item"]'));
    expect(has('[data-tutorial="confirm-rewrite"]')).toBe(true);
    rewriteGate(host).cancel();
    await settle();

    await click(host.querySelector('[data-tutorial="toolbar-files"]'));
    await settleAll();
    expect(has('[data-tutorial="files-panel"]')).toBe(true);
    expect(has('[data-tutorial="commit-bar"]')).toBe(true);

    await click(host.querySelector('[data-tutorial="create-commit"]'));
    expect(has('[data-tutorial="create-commit-dialog"]')).toBe(true);
    await click(byTextIn(document.body, t("common.cancel")));

    await click(commitRow(host, "Fix bug Y"));
    await settleAll();
    expect(has('[data-tutorial="commit-details"]')).toBe(true);
    expect(has('[data-tutorial="detail-reword"]')).toBe(true);
    expect(has('[data-tutorial="detail-add-file"]')).toBe(true);
    const fileRow = document.querySelector('[data-tutorial-file="src/app.ts"]');
    expect(fileRow).not.toBeNull();
    expect(
      fileRow!.querySelector('[data-tutorial="detail-purge"]'),
    ).not.toBeNull();

    await click(host.querySelector('[data-tutorial="topbar-settings"]'));
    expect(has('[data-tutorial="settings-modal"]')).toBe(true);
    expect(has('[data-tutorial="settings-tab-Personalize"]')).toBe(true);
    expect(has('[data-tutorial="settings-ok"]')).toBe(true);
  });
});
