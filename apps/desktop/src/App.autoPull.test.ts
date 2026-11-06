/**
 * The auto-pull gate in front of create-branch / push / commit.
 *
 * Behaviour, not markup: each test drives a real action through the real
 * App.svelte and asserts on the IPC calls that did or did not happen, plus
 * the toast text. Per the repo's standing note, jsdom's `getComputedStyle`
 * does not resolve Svelte's scoped styles, so nothing here reads computed CSS
 * — only attributes, `disabled`, `data-testid` and text. The countdown is
 * driven with fake timers, never a real wait.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanupApp,
  commitRow,
  errorToast,
  ipc,
  menuItem,
  mountApp,
  noticeToast,
  recentsApi,
  REPO_PATH,
  rewriteGate,
  rightClick,
  settle,
  SHA1,
  toolbarButton,
} from "./test/appHarness";
import { t } from "./lib/i18n/index.svelte";
import { AUTO_PULL_SECONDS_DEFAULT } from "./lib/autoPull";
import type { AutoPullAction, AutoPullMode } from "./lib/autoPull";

afterEach(() => {
  cleanupApp();
  vi.useRealTimers();
});

// --- prompt accessors ------------------------------------------------------

/** The blocking `warn` dialog, or null. Identified by its title text. */
function warnDialog(
  h: HTMLElement,
  action: AutoPullAction,
): HTMLElement | null {
  const want = t("autoPull.title", { before: t(beforeKey(action)) });
  return (
    [...h.querySelectorAll<HTMLElement>('.dialog[role="dialog"]')].find(
      (d) => d.querySelector(".title")?.textContent?.trim() === want,
    ) ?? null
  );
}

function beforeKey(
  action: AutoPullAction,
):
  | "general.beforeCreateBranch"
  | "general.beforePush"
  | "general.beforeCommit" {
  return action === "push"
    ? "general.beforePush"
    : action === "commit"
      ? "general.beforeCommit"
      : "general.beforeCreateBranch";
}

/** Yes / Skip / Cancel on the blocking dialog, by label (not by position). */
function warnButton(dialog: HTMLElement, label: string): HTMLButtonElement {
  const b = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(
    (el) => el.textContent?.trim() === label,
  );
  if (!b) throw new Error(`no dialog button labelled ${label}`);
  return b;
}

function countdown(h: HTMLElement): HTMLElement | null {
  return h.querySelector<HTMLElement>('[data-testid="autopull-countdown"]');
}

function countdownButton(h: HTMLElement, which: string): HTMLButtonElement {
  const b = h.querySelector<HTMLButtonElement>(
    `[data-testid="autopull-${which}"]`,
  );
  if (!b) throw new Error(`countdown prompt has no ${which} button`);
  return b;
}

/** Let the countdown expire (fade phase included) and settle the fallout. */
async function expireCountdown(seconds = AUTO_PULL_SECONDS_DEFAULT) {
  vi.advanceTimersByTime(seconds * 1000 + 500);
  await settle();
}

// --- action drivers --------------------------------------------------------

const COMMIT_MESSAGE = "gated commit";
const BRANCH_NAME = "gated-branch";

async function mount(
  mode: AutoPullMode,
  action: AutoPullAction,
  extra: Record<string, unknown> = {},
) {
  return await mountApp({
    settings: {
      general: {
        autoPull: mode,
        // Only the action under test is enabled, so a stray gate on another
        // action can never be mistaken for this one.
        autoPullBefore: {
          createBranch: action === "createBranch",
          push: action === "push",
          commit: action === "commit",
        },
        ...((extra.general as object) ?? {}),
      },
    },
    ...extra,
  });
}

/** Start the action. Returns once the gate has had a chance to appear. */
async function start(h: HTMLElement, action: AutoPullAction) {
  if (action === "push") {
    toolbarButton(h, t("toolbar.push"))!.click();
    await settle();
    return;
  }
  if (action === "createBranch") {
    rightClick(commitRow(h, "Fix bug Y")!);
    await settle();
    menuItem(h, t("menu.createBranchHere"))!.click();
    await settle();
    const dialog = h.querySelector<HTMLElement>(
      `[role="dialog"][aria-label=${JSON.stringify(t("createBranch.title"))}]`,
    )!;
    const input = dialog.querySelector("input")!;
    input.value = BRANCH_NAME;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    [...dialog.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => b.textContent?.trim() === t("common.create"))!
      .click();
    await settle();
    return;
  }
  // commit: open the Files panel, type a message, click the commit bar button
  toolbarButton(h, t("toolbar.files"))!.click();
  await settle();
  const bar = h.querySelector<HTMLElement>('[data-tutorial="commit-bar"]')!;
  const textarea = bar.querySelector("textarea")!;
  textarea.value = COMMIT_MESSAGE;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
  bar.querySelector<HTMLButtonElement>("button.btn")!.click();
  await settle();
}

/** Did the action itself reach the backend? */
function ran(action: AutoPullAction): boolean {
  if (action === "push") return ipc.push.mock.calls.length > 0;
  if (action === "createBranch") return ipc.createBranch.mock.calls.length > 0;
  return ipc.createCommit.mock.calls.length > 0;
}

const ACTIONS: AutoPullAction[] = ["createBranch", "push", "commit"];

// --- the mode × action matrix ---------------------------------------------

describe("auto-pull gate — mode × action matrix", () => {
  for (const action of ACTIONS) {
    it(`off: ${action} runs with no pull and no prompt`, async () => {
      const h = await mount("off", action);
      await start(h, action);
      expect(ipc.pull).not.toHaveBeenCalled();
      expect(warnDialog(h, action)).toBeNull();
      expect(countdown(h)).toBeNull();
      expect(ran(action)).toBe(true);
    });

    it(`always: ${action} pulls first, with no prompt`, async () => {
      const h = await mount("always", action);
      await start(h, action);
      expect(ipc.pull).toHaveBeenCalledTimes(1);
      expect(warnDialog(h, action)).toBeNull();
      expect(countdown(h)).toBeNull();
      expect(ran(action)).toBe(true);
    });

    it(`warn: ${action} waits on a blocking prompt, then Yes pulls and acts`, async () => {
      const h = await mount("warn", action);
      await start(h, action);
      const dialog = warnDialog(h, action);
      expect(dialog).not.toBeNull();
      // The action is PENDING — neither the pull nor the action has run.
      expect(ipc.pull).not.toHaveBeenCalled();
      expect(ran(action)).toBe(false);
      warnButton(dialog!, t("remotePull.confirm")).click();
      await settle();
      expect(ipc.pull).toHaveBeenCalledTimes(1);
      expect(ran(action)).toBe(true);
      expect(warnDialog(h, action)).toBeNull();
    });

    it(`notify: ${action} waits on a non-modal prompt, which auto-selects Yes`, async () => {
      vi.useFakeTimers();
      const h = await mount("notify", action);
      await start(h, action);
      expect(countdown(h)).not.toBeNull();
      // Non-modal, but the action still waits for the answer.
      expect(ipc.pull).not.toHaveBeenCalled();
      expect(ran(action)).toBe(false);
      await expireCountdown();
      expect(ipc.pull).toHaveBeenCalledTimes(1);
      expect(ran(action)).toBe(true);
      expect(countdown(h)).toBeNull();
      // Expiry selects Yes, which is NEITHER of the two answers that get an
      // acknowledgement. A "skipped" or "cancelled" toast here would tell the
      // user the opposite of what just happened.
      expect(noticeToast(h)).not.toBe(t("autoPull.skipped"));
      expect(noticeToast(h)).not.toBe(t("autoPull.cancelled"));
    });

    it(`${action} is not gated when its own checkbox is off`, async () => {
      const h = await mountApp({
        settings: {
          general: {
            autoPull: "warn",
            autoPullBefore: {
              createBranch: false,
              push: false,
              commit: false,
            },
          },
        },
      });
      await start(h, action);
      expect(ipc.pull).not.toHaveBeenCalled();
      expect(warnDialog(h, action)).toBeNull();
      expect(ran(action)).toBe(true);
    });
  }
});

// --- the three outcomes of the blocking prompt ----------------------------

describe("auto-pull gate — warn outcomes", () => {
  it("Skip runs the action without pulling, and says it skipped", async () => {
    // A commit reports nothing of its own on success, so the gate's own
    // acknowledgement is what is left standing in the single `notice` slot.
    const h = await mount("warn", "commit");
    await start(h, "commit");
    warnButton(warnDialog(h, "commit")!, t("remotePull.skip")).click();
    await settle();
    expect(ipc.pull).not.toHaveBeenCalled();
    // Skip used to pass SILENTLY. It now says so — and the action still runs.
    expect(ipc.createCommit).toHaveBeenCalledTimes(1);
    expect(noticeToast(h)).toBe(t("autoPull.skipped"));
  });

  it("Skip says so for the whole push it let through, then yields to the push's own notice", async () => {
    const h = await mount("warn", "push");
    // AFTER mount: `mountApp()` resets every mock. Holding the push open is
    // what makes the gate's notice readable — `notice` is a single slot, and
    // `notice.pushed` takes it the moment the push lands.
    let finishPush = () => {};
    ipc.push.mockImplementation(
      () => new Promise<void>((resolve) => (finishPush = () => resolve())),
    );
    await start(h, "push");
    warnButton(warnDialog(h, "push")!, t("remotePull.skip")).click();
    await settle();

    expect(ipc.pull).not.toHaveBeenCalled();
    expect(ipc.push).toHaveBeenCalledTimes(1);
    expect(noticeToast(h)).toBe(t("autoPull.skipped"));

    finishPush();
    await settle();
    expect(noticeToast(h)).toBe(t("notice.pushed"));
  });

  it("Cancel abandons the action entirely and says so", async () => {
    const h = await mount("warn", "push");
    await start(h, "push");
    warnButton(warnDialog(h, "push")!, t("common.cancel")).click();
    await settle();
    expect(ipc.pull).not.toHaveBeenCalled();
    expect(ipc.push).not.toHaveBeenCalled();
    expect(noticeToast(h)).toBe(t("autoPull.cancelled"));
    expect(warnDialog(h, "push")).toBeNull();
  });

  it("Cancel abandons a commit, leaving the index untouched", async () => {
    const h = await mount("warn", "commit");
    await start(h, "commit");
    warnButton(warnDialog(h, "commit")!, t("common.cancel")).click();
    await settle();
    expect(ipc.createCommit).not.toHaveBeenCalled();
    expect(ipc.pull).not.toHaveBeenCalled();
  });

  it("Cancel abandons a create-branch", async () => {
    const h = await mount("warn", "createBranch");
    await start(h, "createBranch");
    warnButton(warnDialog(h, "createBranch")!, t("common.cancel")).click();
    await settle();
    expect(ipc.createBranch).not.toHaveBeenCalled();
    expect(ipc.pull).not.toHaveBeenCalled();
  });

  it("offers exactly three outcomes, and leaves two-outcome dialogs alone", async () => {
    const h = await mount("warn", "push");
    await start(h, "push");
    const labels = [
      ...warnDialog(h, "push")!.querySelectorAll<HTMLButtonElement>("button"),
    ].map((b) => b.textContent?.trim());
    expect(labels).toEqual([
      t("common.cancel"),
      t("remotePull.skip"),
      t("remotePull.confirm"),
    ]);
  });
});

// --- the countdown prompt -------------------------------------------------

describe("auto-pull gate — notify countdown", () => {
  it("Skip during the countdown acts without pulling, says so, and stops the timer", async () => {
    vi.useFakeTimers();
    const h = await mount("notify", "commit");
    await start(h, "commit");
    countdownButton(h, "skip").click();
    await settle();
    // Same acknowledgement as the blocking dialog's Skip: both widgets report
    // through one decision switch, so neither can drift from the other.
    expect(noticeToast(h)).toBe(t("autoPull.skipped"));
    expect(ipc.createCommit).toHaveBeenCalledTimes(1);
    expect(ipc.pull).not.toHaveBeenCalled();
    // The expiry must not also fire Yes after the prompt is gone.
    await expireCountdown();
    expect(ipc.pull).not.toHaveBeenCalled();
    expect(ipc.createCommit).toHaveBeenCalledTimes(1);
  });

  it("Skip during the countdown acts without pulling, and stops the timer", async () => {
    vi.useFakeTimers();
    const h = await mount("notify", "push");
    await start(h, "push");
    countdownButton(h, "skip").click();
    await settle();
    expect(ipc.push).toHaveBeenCalledTimes(1);
    expect(ipc.pull).not.toHaveBeenCalled();
    // The expiry must not also fire Yes after the prompt is gone.
    await expireCountdown();
    expect(ipc.pull).not.toHaveBeenCalled();
    expect(ipc.push).toHaveBeenCalledTimes(1);
  });

  it("Cancel during the countdown abandons the action, says so, and stops the timer", async () => {
    vi.useFakeTimers();
    const h = await mount("notify", "push");
    await start(h, "push");
    countdownButton(h, "cancel").click();
    await settle();
    expect(noticeToast(h)).toBe(t("autoPull.cancelled"));
    expect(ipc.push).not.toHaveBeenCalled();
    expect(ipc.pull).not.toHaveBeenCalled();
    await expireCountdown();
    expect(ipc.pull).not.toHaveBeenCalled();
    expect(ipc.push).not.toHaveBeenCalled();
  });

  it("Yes clicked before the countdown ends pulls once, not twice", async () => {
    vi.useFakeTimers();
    const h = await mount("notify", "push");
    await start(h, "push");
    countdownButton(h, "yes").click();
    await settle();
    await expireCountdown();
    expect(ipc.pull).toHaveBeenCalledTimes(1);
    expect(ipc.push).toHaveBeenCalledTimes(1);
  });

  it("honours the configured response time rather than the default", async () => {
    vi.useFakeTimers();
    const h = await mountApp({
      settings: {
        general: {
          autoPull: "notify",
          autoPullSeconds: 20,
          autoPullBefore: { createBranch: false, push: true, commit: false },
        },
      },
    });
    await start(h, "push");
    // Still counting at the 5s default…
    vi.advanceTimersByTime(6000);
    await settle();
    expect(ipc.pull).not.toHaveBeenCalled();
    expect(countdown(h)).not.toBeNull();
    // …and answered once its own 20s have passed.
    vi.advanceTimersByTime(15000);
    await settle();
    expect(ipc.pull).toHaveBeenCalledTimes(1);
    expect(ipc.push).toHaveBeenCalledTimes(1);
  });

  it("is non-modal: no scrim and no aria-modal", async () => {
    vi.useFakeTimers();
    const h = await mount("notify", "push");
    await start(h, "push");
    const prompt = countdown(h)!;
    expect(prompt.getAttribute("aria-modal")).toBeNull();
    expect(prompt.getAttribute("role")).toBe("status");
    expect(prompt.querySelector(".scrim")).toBeNull();
    // The toolbar behind it is still live, not covered by an overlay.
    expect(toolbarButton(h, t("toolbar.pull"))).not.toBeNull();
  });
});

// --- failure and conflict -------------------------------------------------

describe("auto-pull gate — a pull that does not leave a clean tree", () => {
  it("abandons the action when the pull fails, naming which pull it was", async () => {
    const h = await mount("always", "push");
    // After mount: mountApp() resets every mock, so a pre-mount override on
    // `pull` would be wiped before the gate ever calls it.
    ipc.pull.mockRejectedValueOnce(new Error("remote hung up"));
    await start(h, "push");
    expect(ipc.pull).toHaveBeenCalledTimes(1);
    expect(ipc.push).not.toHaveBeenCalled();
    const shown = errorToast(h) ?? "";
    expect(shown).toContain(t("general.beforePush"));
    expect(shown).toContain("remote hung up");
  });

  it("abandons a commit when the pull fails", async () => {
    const h = await mount("always", "commit");
    // After mount: mountApp() resets every mock, so a pre-mount override on
    // `pull` would be wiped before the gate ever calls it.
    ipc.pull.mockRejectedValueOnce(new Error("remote hung up"));
    await start(h, "commit");
    expect(ipc.createCommit).not.toHaveBeenCalled();
    expect(errorToast(h) ?? "").toContain(t("general.beforeCommit"));
  });

  it("abandons the action and enters resolve mode when the pull conflicts", async () => {
    // `pull` resolves, but the repo is left mid-merge: the existing paused-op
    // probe is what the gate re-reads, the same call `loadRepo` makes.
    const h = await mount("always", "push");
    ipc.conflictState.mockResolvedValue({
      op: "merge",
      branch: "main",
      sha: SHA1,
    });
    await start(h, "push");
    expect(ipc.push).not.toHaveBeenCalled();
    expect(noticeToast(h)).toBe(
      t("autoPull.conflicted", { before: t("general.beforePush") }),
    );
    // Routed into the EXISTING mid-resolve surface, not a second one.
    expect(h.querySelector(".resolve-banner")).not.toBeNull();
  });
});

// --- interactions ---------------------------------------------------------

describe("auto-pull gate — interactions", () => {
  it("does not prompt in dry-run mode, and keeps the dry-run notices", async () => {
    const h = await mount("warn", "push", { general: { dryRun: true } });
    await start(h, "push");
    expect(warnDialog(h, "push")).toBeNull();
    expect(ipc.pull).not.toHaveBeenCalled();
    expect(ipc.push).not.toHaveBeenCalled();
    expect(noticeToast(h)).toBe(t("notice.dryRunPush"));
  });

  it("never prompts unconditionally-skippably: a stale behind:0 still asks", async () => {
    // The cached ahead/behind is deliberately NOT consulted (refreshSync runs
    // in only a handful of places, so `behind` can be arbitrarily stale).
    const h = await mountApp({
      settings: {
        general: {
          autoPull: "warn",
          autoPullBefore: { createBranch: false, push: true, commit: false },
        },
      },
      aheadBehind: { ahead: 0, behind: 0, upstream: "origin/main" },
    });
    await start(h, "push");
    expect(warnDialog(h, "push")).not.toBeNull();
  });

  it("does not stack two prompts: the second action is abandoned with a notice", async () => {
    const h = await mountApp({
      settings: {
        general: {
          autoPull: "warn",
          autoPullBefore: { createBranch: false, push: true, commit: true },
        },
      },
    });
    await start(h, "push");
    expect(warnDialog(h, "push")).not.toBeNull();
    // A commit asked for while the push gate is still up.
    await start(h, "commit");
    expect(noticeToast(h)).toBe(t("autoPull.pending"));
    expect(ipc.createCommit).not.toHaveBeenCalled();
    // Exactly one prompt, and it is still the push one.
    expect(h.querySelectorAll(`.dialog[role="dialog"] .title`).length).toBe(1);
    expect(warnDialog(h, "push")).not.toBeNull();
    // Answering it still works.
    warnButton(warnDialog(h, "push")!, t("remotePull.confirm")).click();
    await settle();
    expect(ipc.push).toHaveBeenCalledTimes(1);
  });

  it("leaves force push with its own single confirmation", async () => {
    const h = await mountApp({
      settings: {
        general: {
          autoPull: "warn",
          autoPullBefore: { createBranch: false, push: true, commit: false },
        },
      },
    });
    h.querySelector<HTMLButtonElement>(".caret-segment")!.click();
    await settle();
    h.querySelector<HTMLButtonElement>(".menu .item")!.click();
    await settle();
    // The force-push gate, and no auto-pull prompt behind or in front of it.
    expect(warnDialog(h, "push")).toBeNull();
    const gate = rewriteGate(h);
    expect(gate.title).toBe(t("op.forcePush.title"));
    gate.confirm();
    await settle();
    expect(ipc.pull).not.toHaveBeenCalled();
    expect(ipc.push).toHaveBeenCalledWith(
      REPO_PATH,
      "origin",
      expect.anything(),
      true,
      null,
    );
  });

  it("does not gate while mid-resolve, where a pull is impossible", async () => {
    const h = await mountApp({
      settings: {
        general: {
          autoPull: "always",
          autoPullBefore: { createBranch: false, push: false, commit: true },
        },
      },
      conflictState: { op: "merge", branch: "main", sha: SHA1 },
    });
    await start(h, "commit");
    expect(ipc.pull).not.toHaveBeenCalled();
    expect(ipc.createCommit).toHaveBeenCalledTimes(1);
  });
});

// --- the repo changing under a pending prompt -----------------------------

/** The TopBar's "back to repositories" button, i.e. close this repo. */
function closeRepoButton(h: HTMLElement): HTMLButtonElement {
  const b = h.querySelector<HTMLButtonElement>(
    `button[aria-label=${JSON.stringify(t("topbar.back"))}]`,
  );
  if (!b) throw new Error("no close-repo button");
  return b;
}

/** A recent-project avatar on the Welcome screen, found by its repo path. */
function recentAvatar(h: HTMLElement, path: string): HTMLButtonElement {
  const b = h.querySelector<HTMLButtonElement>(
    `.avatar[title=${JSON.stringify(path)}]`,
  );
  if (!b) throw new Error(`no recent avatar for ${path}`);
  return b;
}

/** The create-branch dialog, or null. It is NOT repo-scoped markup — it
 *  outlives a repo close, which is why a gate that never settles leaves it
 *  stranded on the Welcome screen with a permanently disabled Create. */
function createBranchDialog(h: HTMLElement): HTMLElement | null {
  return h.querySelector<HTMLElement>(
    `[role="dialog"][aria-label=${JSON.stringify(t("createBranch.title"))}]`,
  );
}

const OTHER_REPO = "/other-repo";

const TWO_RECENTS = [
  { path: REPO_PATH, name: "repo", lastOpened: 2 },
  { path: OTHER_REPO, name: "other", lastOpened: 1 },
];

/**
 * Mount with TWO recent projects and open the first one by hand.
 *
 * `mountApp` opens its repo for us, but opening re-reads the recents list
 * from `addRecent`'s reply — whose harness default is `[]`, which would empty
 * the Welcome screen the moment the first repo is opened. So mount without
 * opening, pin `addRecent`'s reply, then click the avatar ourselves: these
 * tests have to close a repo and pick another, which is their whole point.
 */
async function mountTwoRepos(
  general: Record<string, unknown>,
): Promise<HTMLElement> {
  const h = await mountApp({
    settings: { general },
    recents: TWO_RECENTS,
    openRepo: false,
  });
  recentsApi.addRecent.mockResolvedValue(TWO_RECENTS);
  recentAvatar(h, REPO_PATH).click();
  await settle();
  return h;
}

describe("auto-pull gate — the repo changes while a prompt is pending", () => {
  it("closing the repo cancels the pending prompt and frees the gate", async () => {
    const h = await mountTwoRepos({
      autoPull: "warn",
      autoPullBefore: { createBranch: false, push: true, commit: false },
    });
    await start(h, "push");
    expect(warnDialog(h, "push")).not.toBeNull();

    closeRepoButton(h).click();
    await settle();

    // The prompt goes with the repo it was about, and the user is told the
    // action was abandoned — not skipped, not confirmed.
    expect(warnDialog(h, "push")).toBeNull();
    expect(noticeToast(h)).toBe(t("autoPull.cancelled"));
    expect(ipc.pull).not.toHaveBeenCalled();
    expect(ipc.push).not.toHaveBeenCalled();

    // Re-open the same repo: the gate is not jammed. A new push gets its own
    // prompt (rather than being abandoned with `autoPull.pending`) and runs.
    recentAvatar(h, REPO_PATH).click();
    await settle();
    await start(h, "push");
    const again = warnDialog(h, "push");
    expect(again).not.toBeNull();
    warnButton(again!, t("remotePull.confirm")).click();
    await settle();
    expect(ipc.pull).toHaveBeenCalledTimes(1);
    expect(ipc.push).toHaveBeenCalledTimes(1);
  });

  it("closing the repo releases the create-branch dialog's mid-submit state", async () => {
    const h = await mount("warn", "createBranch");
    await start(h, "createBranch");
    // Mid-submit: the gate is up and the dialog is waiting on it with its
    // Create button disabled.
    expect(warnDialog(h, "createBranch")).not.toBeNull();
    const submitting = createBranchDialog(h)!;
    expect(
      [...submitting.querySelectorAll<HTMLButtonElement>("button")].find(
        (b) => b.textContent?.trim() === t("common.create"),
      )!.disabled,
    ).toBe(true);

    closeRepoButton(h).click();
    await settle();

    // Both surfaces are gone — nothing is left stranded with a dead button.
    expect(warnDialog(h, "createBranch")).toBeNull();
    expect(createBranchDialog(h)).toBeNull();
    expect(ipc.createBranch).not.toHaveBeenCalled();
    expect(ipc.pull).not.toHaveBeenCalled();
  });

  it("switching repositories during a countdown never pulls the new repository", async () => {
    vi.useFakeTimers();
    const h = await mountTwoRepos({
      autoPull: "notify",
      autoPullBefore: { createBranch: false, push: true, commit: false },
    });
    await start(h, "push");
    expect(countdown(h)).not.toBeNull();

    // Close, then open a DIFFERENT repo — an ordinary thing to do inside a
    // five-second countdown.
    closeRepoButton(h).click();
    await settle();
    recentAvatar(h, OTHER_REPO).click();
    await settle();

    // The prompt was about the old repo, so it is gone; and letting the
    // timer run out must not pull the repo the user just switched to.
    expect(countdown(h)).toBeNull();
    await expireCountdown();
    expect(ipc.pull).not.toHaveBeenCalled();
    expect(ipc.push).not.toHaveBeenCalled();
  });
});

// --- the create-branch dialog's two exits ---------------------------------

describe("auto-pull gate — abandoned action vs submit failure", () => {
  it("a cancelled gate closes the create-branch dialog", async () => {
    const h = await mount("warn", "createBranch");
    await start(h, "createBranch");
    warnButton(warnDialog(h, "createBranch")!, t("common.cancel")).click();
    await settle();
    expect(ipc.createBranch).not.toHaveBeenCalled();
    // The action was abandoned, so the form goes with it: the gate's own
    // toast is the whole explanation, and a form left sitting there with
    // nothing said would read as a dead Create button.
    expect(createBranchDialog(h)).toBeNull();
    expect(noticeToast(h)).toBe(t("autoPull.cancelled"));
  });

  it("a genuine submit failure keeps the create-branch dialog open with its inline error", async () => {
    const h = await mount("warn", "createBranch");
    // After mount: mountApp() resets every mock, so a pre-mount override on
    // `createBranch` would be wiped before the dialog ever calls it.
    ipc.createBranch.mockRejectedValueOnce(new Error("branch exists"));
    await start(h, "createBranch");
    // Skip the pull, so the gate passes and the real submit is what fails.
    warnButton(warnDialog(h, "createBranch")!, t("remotePull.skip")).click();
    await settle();
    expect(ipc.createBranch).toHaveBeenCalledTimes(1);
    const dialog = createBranchDialog(h);
    expect(dialog).not.toBeNull();
    expect(dialog!.querySelector('p.err[role="alert"]')?.textContent).toContain(
      "branch exists",
    );
  });
});
