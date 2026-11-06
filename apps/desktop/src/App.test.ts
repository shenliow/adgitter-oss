/**
 * App-level regression coverage for the destructive flows App.svelte owns:
 * force push, purge-file-from-history, branch rename+colour (the flow whose
 * bug — colour overrides written before a rename that could fail — motivated
 * this harness), the shared pending-op confirm gate (merge/rebase/reset/
 * cherry-pick/drop all route through `runPending`), and undo. Every
 * assertion checks the actual IPC call + its arguments, not merely that a
 * spy fired — a "was it called" test would have passed right through the
 * colour-override bug this suite guards against.
 *
 * See `./test/appHarness` for the mocking + mount machinery.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { flushSync } from "svelte";
import { t } from "./lib/i18n/index.svelte";
import type { Commit, RefList } from "./lib/ipc";
import {
  mountApp,
  cleanupApp,
  settle,
  ipc,
  rewriteGate,
  toolbarButton,
  commitRow,
  branchChip,
  rightClick,
  menuItem,
  errorToast,
  noticeToast,
  windowApi,
  defaultCommits,
  defaultRefs,
  defaultRepoStatus,
  makeCommit,
  REPO_PATH,
  SHA1,
  SHA2,
  SHA3,
} from "./test/appHarness";

// Pin graph-theme ownership instead of inheriting it from the environment.
// `VITE_STORE_MOCK` lives in a gitignored `.env`: it reads `false` in a normal
// checkout (real entitlement → nothing owned) but is UNSET inside a
// `git worktree`, where `MOCK_STORE` defaults to true and demo-owns
// `synthwave`. Anything asserting on Apply-vs-Buy has to say which it wants.
vi.mock("./lib/themes/storeOwnership.svelte", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./lib/themes/storeOwnership.svelte")>();
  return {
    ...actual,
    MOCK_STORE: false,
    ownsStoreTheme: (id: string) => id === "default" || id === "synthwave",
  };
});

afterEach(() => cleanupApp());

describe("App — force push (toolbar Push ▾ menu)", () => {
  it("does not call push until confirmed, then pushes with force: true and the right args", async () => {
    const h = await mountApp();

    const caret = h.querySelector<HTMLButtonElement>(".caret-segment");
    expect(caret).not.toBeNull();
    caret!.click();
    flushSync();

    const forceItem = h.querySelector<HTMLButtonElement>(".menu .item");
    expect(forceItem?.textContent).toContain("Force push");
    forceItem!.click();
    flushSync();

    const gate = rewriteGate(h);
    expect(gate.dialog).not.toBeNull();
    expect(gate.title).toBe(t("op.forcePush.title"));
    expect(ipc.push).not.toHaveBeenCalled();

    gate.confirm();
    await settle();

    expect(ipc.push).toHaveBeenCalledWith(
      REPO_PATH,
      "origin",
      { kind: "none" },
      true,
      null, // no Settings URL override (uses the named origin remote)
    );
    expect(rewriteGate(h).dialog).toBeNull();
    expect(noticeToast(h)).toBe(t("notice.forcePushed"));
  });

  it("cancelling the confirmation never calls push", async () => {
    const h = await mountApp();

    h.querySelector<HTMLButtonElement>(".caret-segment")!.click();
    flushSync();
    h.querySelector<HTMLButtonElement>(".menu .item")!.click();
    flushSync();

    rewriteGate(h).cancel();
    flushSync();

    expect(ipc.push).not.toHaveBeenCalled();
    expect(rewriteGate(h).dialog).toBeNull();
  });

  it("pushes with the host-specific PAT username inferred from the remote URL", async () => {
    // remoteUrl is still seeded from global settings on a repo's first open
    // (see loadRepo's per-slice seed), but accessToken is repo-level secret
    // storage now and is NEVER seeded from global — it must be pre-seeded
    // via `repoAccessToken` (repoSecrets.ts), not `settings.general`.
    const h = await mountApp({
      settings: {
        general: { remoteUrl: "https://gitlab.com/u/r.git" },
      },
      repoAccessToken: "glpat-tok",
    });

    toolbarButton(h, t("toolbar.push"))!.click();
    await settle();

    expect(ipc.push).toHaveBeenCalledWith(
      REPO_PATH,
      "origin",
      { kind: "password", username: "oauth2", password: "glpat-tok" },
      false,
      // No `.git` origin detected, so the configured Settings URL is the target.
      "https://gitlab.com/u/r.git",
    );
  });

  it("blocks push + warns when a token is set on a non-HTTPS remote (a PAT needs HTTPS)", async () => {
    const h = await mountApp({
      settings: { general: { remoteUrl: "git@custom.example:u/r.git" } },
      repoAccessToken: "ghp_tok",
    });

    // The one hard error: a token can't authenticate ssh/git and would leak
    // over http, so sync is disabled and the warning bar is shown.
    expect(h.querySelector(".remote-warning")).not.toBeNull();
    const push = toolbarButton(h, t("toolbar.push"));
    expect(push?.disabled).toBe(true);
    push?.click();
    await settle();
    expect(ipc.push).not.toHaveBeenCalled();
  });

  it.each(["git@gitlab.com:u/r.git", "ssh://git@gitlab.com/u/r.git"])(
    "uses the detected SSH origin with PAT through HTTPS: %s",
    async (remoteUrl) => {
      const h = await mountApp({ remoteUrl, repoAccessToken: "test-pat" });
      expect(h.querySelector(".remote-warning")).toBeNull();
      toolbarButton(h, t("toolbar.push"))!.click();
      await settle();
      expect(ipc.push).toHaveBeenCalledWith(
        REPO_PATH,
        "origin",
        { kind: "password", username: "oauth2", password: "test-pat" },
        false,
        null, // Backend converts the named remote and preserves its push URL.
      );
    },
  );

  it("does not block or warn for an SSH remote with no token (ssh-key auth)", async () => {
    const h = await mountApp({
      // Blank PAT (no repoAccessToken) → ssh-key auth is allowed for ssh remotes.
      settings: { general: { remoteUrl: "git@github.com:u/r.git" } },
    });

    expect(h.querySelector(".remote-warning")).toBeNull();
  });

  it("keeps a user-configured Settings remote URL — opening a repo whose origin differs never clobbers it", async () => {
    // The repo's .git origin is ssh, but the user saved an https URL and uses a
    // PAT. Opening must NOT overwrite the Settings URL back to the ssh origin —
    // that would make it ssh + PAT = blocked and break PAT updates.
    const h = await mountApp({
      remoteUrl: "git@github.com:u/r.git", // .git origin (ssh)
      projectConfig: JSON.stringify({
        general: { remoteUrl: "https://github.com/u/r.git" },
      }),
      repoAccessToken: "ghp_tok",
    });

    // Settings URL wins (config URL > repo URL) → still https + PAT → not blocked.
    expect(h.querySelector(".remote-warning")).toBeNull();
    toolbarButton(h, t("toolbar.push"))!.click();
    await settle();
    // …and the push actually targets the https Settings URL (part 2), not the
    // ssh origin — so the PAT is really used to update.
    expect(ipc.push).toHaveBeenCalledWith(
      REPO_PATH,
      "origin",
      { kind: "password", username: "x-access-token", password: "ghp_tok" },
      false,
      "https://github.com/u/r.git",
    );
  });

  it("dry run short-circuits the confirmed force push: no IPC call at all", async () => {
    const h = await mountApp({ settings: { general: { dryRun: true } } });

    h.querySelector<HTMLButtonElement>(".caret-segment")!.click();
    flushSync();
    h.querySelector<HTMLButtonElement>(".menu .item")!.click();
    flushSync();

    rewriteGate(h).confirm();
    await settle();

    expect(ipc.push).not.toHaveBeenCalled();
    expect(rewriteGate(h).dialog).toBeNull();
  });
});

describe("App — purge file from history (CommitDetails)", () => {
  it("gates purge behind confirmation, then purges with the selected commit's sha + path", async () => {
    const h = await mountApp();

    commitRow(h, "Add feature X")!.click(); // selects the sha3-tip commit
    await settle();

    expect(toolbarButton(h, "Undo")!.disabled).toBe(true);

    const purgeBtn = h.querySelector<HTMLButtonElement>("button.act.purge");
    expect(purgeBtn).not.toBeNull();
    purgeBtn!.click();
    flushSync();

    const gate = rewriteGate(h);
    expect(gate.dialog).not.toBeNull();
    expect(gate.body).toContain("src/app.ts");
    expect(ipc.purgePath).not.toHaveBeenCalled();

    const before = ipc.listCommits.mock.calls.length;
    gate.confirm();
    await settle();

    expect(ipc.purgePath).toHaveBeenCalledWith(
      REPO_PATH,
      "c3".repeat(20),
      "src/app.ts",
    );
    // Successful purge sets the undo affordance and refreshes the graph.
    expect(toolbarButton(h, "Undo")!.disabled).toBe(false);
    expect(ipc.listCommits.mock.calls.length).toBeGreaterThan(before);
  });

  it("re-points the details panel at the rewritten commit, not its ghost", async () => {
    // Regression: a rewrite does not delete the original. A `refs/adgitter/`
    // backup keeps it reachable, so `list_commits` keeps returning it with its
    // OLD sha and `ghost: true`. `preserveSelection` is sha-keyed, so it used
    // to "preserve" that ghost — and the panel stayed on the pre-purge tree,
    // still listing the file the user had just removed.
    const h = await mountApp();
    commitRow(h, "Add feature X")!.click(); // selects SHA3
    await settle();

    // What the graph looks like after the purge: SHA3 orphaned into a ghost,
    // and a new sha carrying the identity a tree-only rewrite preserves
    // (same author, author-time, subject and body).
    const REWRITTEN = "d4".repeat(20);
    const ghosted: Commit = {
      ...makeCommit(SHA3, "Add feature X", [SHA1]),
      ghost: true,
    };
    const rewritten = makeCommit(REWRITTEN, "Add feature X", [SHA1]);
    ipc.listCommits.mockResolvedValue({
      commits: [rewritten, ghosted, ...defaultCommits().slice(1)],
      truncated: false,
      limit: 1000,
    });

    h.querySelector<HTMLButtonElement>("button.act.purge")!.click();
    flushSync();
    rewriteGate(h).confirm();
    await settle();

    // The panel must have reloaded the REWRITTEN commit's files. Before the
    // fix this stayed on SHA3 (the ghost), so the purged file never left.
    const loaded = ipc.listCommitFiles.mock.calls.map((c) => c[1]);
    expect(loaded.at(-1)).toBe(REWRITTEN);
    expect(loaded.at(-1)).not.toBe(SHA3);
  });

  it("leaves the ghost twin unselected even when it is listed first", async () => {
    // The orphan is an exact identity twin of its replacement, so a `find`
    // that does not discount ghosts would match whichever comes first.
    const h = await mountApp();
    commitRow(h, "Add feature X")!.click();
    await settle();

    const REWRITTEN = "d4".repeat(20);
    const ghosted: Commit = {
      ...makeCommit(SHA3, "Add feature X", [SHA1]),
      ghost: true,
    };
    ipc.listCommits.mockResolvedValue({
      // Ghost FIRST — the ordering that defeats an unfiltered `find`.
      commits: [
        ghosted,
        makeCommit(REWRITTEN, "Add feature X", [SHA1]),
        ...defaultCommits().slice(1),
      ],
      truncated: false,
      limit: 1000,
    });

    h.querySelector<HTMLButtonElement>("button.act.purge")!.click();
    flushSync();
    rewriteGate(h).confirm();
    await settle();

    expect(ipc.listCommitFiles.mock.calls.map((c) => c[1]).at(-1)).toBe(
      REWRITTEN,
    );
  });

  it("cancelling the purge confirmation never calls purgePath", async () => {
    const h = await mountApp();
    commitRow(h, "Add feature X")!.click();
    await settle();

    h.querySelector<HTMLButtonElement>("button.act.purge")!.click();
    flushSync();

    rewriteGate(h).cancel();
    flushSync();

    expect(ipc.purgePath).not.toHaveBeenCalled();
  });
});

describe("App — add file to commit (CommitDetails)", () => {
  /** Open the details panel for the tip commit and open the add-file picker. */
  async function openPicker(h: HTMLElement): Promise<void> {
    commitRow(h, "Add feature X")!.click(); // selects the sha3-tip commit
    await settle();
    const addBtn = h.querySelector<HTMLButtonElement>("button.act.add-file");
    expect(addBtn).not.toBeNull();
    addBtn!.click();
    await settle(); // openAddFilePicker awaits repoStatus
  }

  /** The picker row whose path label is exactly `path`. */
  function pickerItem(h: HTMLElement, path: string): HTMLButtonElement | null {
    return (
      [...h.querySelectorAll<HTMLButtonElement>(".addfile-item")].find(
        (b) => b.querySelector(".addfile-path")?.textContent === path,
      ) ?? null
    );
  }

  it("gates the add behind confirmation, then calls addFileToCommit with the selected commit's sha + path", async () => {
    const h = await mountApp();
    await openPicker(h);

    // Picking a file closes the picker and opens the ConfirmRewrite gate.
    pickerItem(h, "src/util.ts")!.click();
    flushSync();
    expect(h.querySelector(".addfile-pop")).toBeNull();

    const gate = rewriteGate(h);
    expect(gate.dialog).not.toBeNull();
    expect(gate.title).toBe(t("op.addFile.title"));
    expect(gate.body).toContain("src/util.ts");
    expect(ipc.addFileToCommit).not.toHaveBeenCalled();

    const before = ipc.listCommits.mock.calls.length;
    gate.confirm();
    await settle();

    expect(ipc.addFileToCommit).toHaveBeenCalledWith(
      REPO_PATH,
      "c3".repeat(20),
      "src/util.ts",
    );
    // Successful add sets the undo affordance and refreshes the graph.
    expect(toolbarButton(h, "Undo")!.disabled).toBe(false);
    expect(ipc.listCommits.mock.calls.length).toBeGreaterThan(before);
  });

  it("cancelling the confirmation never calls addFileToCommit", async () => {
    const h = await mountApp();
    await openPicker(h);

    pickerItem(h, "src/util.ts")!.click();
    flushSync();

    rewriteGate(h).cancel();
    flushSync();

    expect(ipc.addFileToCommit).not.toHaveBeenCalled();
  });

  it("lists staged/changed/untracked files but excludes deleted ones", async () => {
    const h = await mountApp();
    await openPicker(h);

    // defaultRepoStatus: changed src/util.ts (modified), untracked README.md
    // (new), staged src/old.ts (deleted — unreadable, so never offered).
    expect(pickerItem(h, "src/util.ts")).not.toBeNull();
    expect(pickerItem(h, "README.md")).not.toBeNull();
    expect(pickerItem(h, "src/old.ts")).toBeNull();
  });
});

describe("App — branch edit (confirmBranchEdit)", () => {
  it("renames the branch and MOVES the colour override (old key gone, exactly one entry)", async () => {
    // No per-repo config file exists yet (ipc.readProjectConfig → null by
    // harness default), so the non-empty GLOBAL settings.branchColors
    // one-time-seeds the project config on load (App.svelte's loadRepo).
    const h = await mountApp({
      settings: { branchColors: { feature: "#111111" } },
    });

    rightClick(branchChip(h, "feature")!);
    flushSync();
    menuItem(h, t("menu.branchProps"))!.click();
    await settle();

    const dialog = h.querySelector<HTMLElement>('[aria-label="Edit branch"]');
    expect(dialog).not.toBeNull();

    const nameInput = dialog!.querySelector<HTMLInputElement>(".name-input")!;
    nameInput.value = "feature-renamed";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();

    dialog!.querySelector<HTMLButtonElement>(".primary")!.click();
    await settle();

    expect(ipc.renameBranch).toHaveBeenCalledWith(
      REPO_PATH,
      "feature",
      "feature-renamed",
    );
    expect(ipc.writeProjectConfig).toHaveBeenCalled();
    const [savedPath, savedBody] = ipc.writeProjectConfig.mock.calls.at(-1)!;
    expect(savedPath).toBe(REPO_PATH);
    const saved = JSON.parse(savedBody as string) as {
      branchColors: Record<string, string>;
    };
    expect(saved.branchColors).toEqual({ "feature-renamed": "#111111" });
  });

  it("a failed rename leaves the branch name and the whole colour map untouched, and surfaces the error", async () => {
    const h = await mountApp({
      settings: { branchColors: { feature: "#111111" } },
    });
    // Set the rejection AFTER mountApp (which resets every mock as part of
    // seeding a fresh app) so it actually takes effect on the next call.
    ipc.renameBranch.mockRejectedValueOnce({
      code: "GIT_ERROR",
      message: "boom",
    });

    rightClick(branchChip(h, "feature")!);
    flushSync();
    menuItem(h, t("menu.branchProps"))!.click();
    await settle();

    const dialog = h.querySelector<HTMLElement>('[aria-label="Edit branch"]')!;
    const nameInput = dialog.querySelector<HTMLInputElement>(".name-input")!;
    nameInput.value = "feature-renamed";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    dialog.querySelector<HTMLButtonElement>(".primary")!.click();
    await settle();

    expect(ipc.renameBranch).toHaveBeenCalledTimes(1);
    expect(ipc.writeProjectConfig).not.toHaveBeenCalled();
    expect(errorToast(h)).toContain("boom");
    // The dialog is left open (editingBranch is untouched on failure) rather
    // than silently discarding the user's edit.
    expect(h.querySelector('[aria-label="Edit branch"]')).not.toBeNull();
    // refresh() never ran: the branch chip still reads the OLD name.
    expect(branchChip(h, "feature")).not.toBeNull();
    expect(branchChip(h, "feature-renamed")).toBeNull();
  });

  it("confirming with an unchanged name only applies the colour and never calls renameBranch", async () => {
    const h = await mountApp();

    rightClick(branchChip(h, "feature")!);
    flushSync();
    menuItem(h, t("menu.branchProps"))!.click();
    await settle();

    const dialog = h.querySelector<HTMLElement>('[aria-label="Edit branch"]')!;
    dialog.querySelector<HTMLButtonElement>(".primary")!.click();
    await settle();

    expect(ipc.renameBranch).not.toHaveBeenCalled();
    expect(ipc.writeProjectConfig).toHaveBeenCalled();
    const [, savedBody] = ipc.writeProjectConfig.mock.calls.at(-1)!;
    const saved = JSON.parse(savedBody as string) as {
      branchColors: Record<string, string>;
    };
    expect(saved.branchColors.feature).toBeTruthy();
    expect(saved.branchColors["feature-renamed"]).toBeUndefined();
  });
});

describe("App — pending-op confirm gate (runPending: merge/rebase/reset/cherry-pick/drop)", () => {
  it("drop: the IPC call does not fire until confirmed, and cancelling fires nothing", async () => {
    const h = await mountApp();
    const row = commitRow(h, "Fix bug Y")!; // sha2

    rightClick(row);
    flushSync();
    menuItem(h, t("menu.drop"))!.click();
    flushSync();

    const gate = rewriteGate(h);
    expect(gate.dialog).not.toBeNull();
    expect(ipc.dropCommit).not.toHaveBeenCalled();

    gate.cancel();
    flushSync();
    expect(ipc.dropCommit).not.toHaveBeenCalled();
    expect(rewriteGate(h).dialog).toBeNull();

    // Re-open and this time accept — the same gate, now confirmed.
    rightClick(commitRow(h, "Fix bug Y")!);
    flushSync();
    menuItem(h, t("menu.drop"))!.click();
    flushSync();
    rewriteGate(h).confirm();
    await settle();

    expect(ipc.dropCommit).toHaveBeenCalledWith(REPO_PATH, SHA2);
    expect(toolbarButton(h, "Undo")!.disabled).toBe(false);
  });

  it("reset (hard): confirms with the target sha and mode", async () => {
    const h = await mountApp();
    rightClick(commitRow(h, "Initial commit")!); // sha1
    flushSync();
    menuItem(h, t("menu.resetHard"))!.click();
    flushSync();

    expect(ipc.reset).not.toHaveBeenCalled();
    rewriteGate(h).confirm();
    await settle();

    expect(ipc.reset).toHaveBeenCalledWith(REPO_PATH, SHA1, "hard");
  });

  it("cherry-pick onto the current branch: confirms with the selected sha list", async () => {
    const h = await mountApp();
    rightClick(commitRow(h, "Fix bug Y")!); // sha2
    flushSync();
    menuItem(h, t("menu.cherryPickOnto", { branch: "main" }))!.click();
    flushSync();

    expect(ipc.cherryPick).not.toHaveBeenCalled();
    rewriteGate(h).confirm();
    await settle();

    expect(ipc.cherryPick).toHaveBeenCalledWith(REPO_PATH, [SHA2]);
  });

  it("rebase a non-current branch: confirms via one rebaseBranch call, never checking out itself", async () => {
    // Fixture has exactly two branches: "main" (current) and "feature" (not
    // checked out). Right-clicking the CURRENT branch chip's "Rebase onto
    // main…" submenu offers the only other branch ("feature") as the one to
    // rebase — selecting it queues `pending = { kind: 'rebaseBranch', branch:
    // 'feature', onto: 'main' }`, exactly the non-current-branch case the
    // backend's `rebase_branch` now owns end-to-end (stash/checkout/
    // rebase/checkout-back/pop), so the frontend must never call `checkout`
    // itself around it anymore.
    const h = await mountApp();

    rightClick(branchChip(h, "main")!);
    flushSync();
    menuItem(h, t("menu.rebaseOntoParent", { branch: "main" }))!.click();
    flushSync();
    menuItem(h, "feature")!.click();
    flushSync();

    const gate = rewriteGate(h);
    expect(gate.dialog).not.toBeNull();
    expect(ipc.rebaseBranch).not.toHaveBeenCalled();

    gate.confirm();
    await settle();

    expect(ipc.rebaseBranch).toHaveBeenCalledTimes(1);
    expect(ipc.rebaseBranch).toHaveBeenCalledWith(REPO_PATH, "feature", "main");
    expect(ipc.checkout).not.toHaveBeenCalled();
  });

  it("a CONFLICT-coded rejection renders the friendly conflict message, not a raw internal error", async () => {
    // cherry_pick keeps the old contract (rejects with a CONFLICT-coded
    // error) — the merge/rebase family now resolves a tagged conflict result
    // instead (see the resolve-mode suite below).
    const h = await mountApp();
    const conflictSha = "abcdef1234567890abcdef1234567890abcdef12";
    ipc.cherryPick.mockRejectedValueOnce({
      code: "CONFLICT",
      message: `conflict applying ${conflictSha} — resolve manually or undo`,
      sha: conflictSha,
    });

    rightClick(commitRow(h, "Fix bug Y")!);
    flushSync();
    menuItem(h, t("menu.cherryPickOnto", { branch: "main" }))!.click();
    flushSync();

    rewriteGate(h).confirm();
    await settle();

    expect(errorToast(h)).toBe(
      t("error.conflict", { short: conflictSha.slice(0, 7) }),
    );
    expect(errorToast(h)).not.toContain("INTERNAL_ERROR");
  });
});

/** Dispatch a click carrying modifier keys (jsdom's `.click()` can't). */
function modClick(el: Element, mods: Partial<MouseEventInit> = {}): void {
  el.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true, ...mods }),
  );
}

describe("App — squash a contiguous range (commit menu)", () => {
  // A straight first-parent line SHA1 (root) ← SHA2 ← SHA3 (main tip) — the
  // default fixture instead has SHA2/SHA3 as sibling branches off SHA1, which
  // is never a contiguous range, so squash tests need their own history.
  // "feature" still resolves (it targets SHA2, now an ancestor of main
  // instead of a fork — an ordinary "behind" branch).
  function linearCommits(): Commit[] {
    return [
      makeCommit(SHA3, "Add feature X", [SHA2]),
      makeCommit(SHA2, "Fix bug Y", [SHA1]),
      makeCommit(SHA1, "Initial commit", []),
    ];
  }

  it("offers Squash for a contiguous 2-commit selection and confirms with the oldest-first range + typed message", async () => {
    const h = await mountApp({ commits: linearCommits() });

    modClick(commitRow(h, "Add feature X")!); // selects SHA3, sets anchor
    flushSync();
    modClick(commitRow(h, "Fix bug Y")!, { shiftKey: true }); // range → {SHA3, SHA2}
    flushSync();

    rightClick(commitRow(h, "Add feature X")!);
    flushSync();
    const item = menuItem(h, t("menu.squash"));
    expect(item).not.toBeNull();
    item!.click();
    flushSync();

    const gate = rewriteGate(h);
    expect(gate.dialog).not.toBeNull();
    expect(gate.title).toBe(t("op.squash.title"));
    expect(ipc.squashRange).not.toHaveBeenCalled();

    const textarea = h.querySelector<HTMLTextAreaElement>(
      ".dialog textarea.message",
    )!;
    expect(textarea).not.toBeNull();
    textarea.value = "Combined message";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();

    gate.confirm();
    await settle();

    expect(ipc.squashRange).toHaveBeenCalledWith(
      REPO_PATH,
      [SHA2, SHA3],
      "Combined message",
    );
    expect(toolbarButton(h, "Undo")!.disabled).toBe(false);
  });

  it("cancelling the gate never calls squashRange", async () => {
    const h = await mountApp({ commits: linearCommits() });

    modClick(commitRow(h, "Add feature X")!);
    flushSync();
    modClick(commitRow(h, "Fix bug Y")!, { shiftKey: true });
    flushSync();

    rightClick(commitRow(h, "Add feature X")!);
    flushSync();
    menuItem(h, t("menu.squash"))!.click();
    flushSync();

    rewriteGate(h).cancel();
    flushSync();

    expect(ipc.squashRange).not.toHaveBeenCalled();
    expect(rewriteGate(h).dialog).toBeNull();
  });

  it("the menu item is absent when the selection isn't a contiguous range", async () => {
    // Default fixture: SHA3 and SHA2 are sibling branches off SHA1, not a
    // first-parent chain of each other.
    const h = await mountApp();

    modClick(commitRow(h, "Add feature X")!);
    flushSync();
    modClick(commitRow(h, "Fix bug Y")!, { ctrlKey: true });
    flushSync();

    rightClick(commitRow(h, "Add feature X")!);
    flushSync();
    expect(menuItem(h, t("menu.squash"))).toBeNull();
  });

  it("the menu item is absent when right-clicking a commit outside the current selection", async () => {
    const h = await mountApp({ commits: linearCommits() });

    // A valid contiguous range is selected...
    modClick(commitRow(h, "Add feature X")!);
    flushSync();
    modClick(commitRow(h, "Fix bug Y")!, { shiftKey: true });
    flushSync();

    // ...but the right-click lands on a commit NOT in it (right-click never
    // mutates the selection itself).
    rightClick(commitRow(h, "Initial commit")!);
    flushSync();
    expect(menuItem(h, t("menu.squash"))).toBeNull();
  });
});

describe("App — undo (doUndo)", () => {
  it("calls undo and refreshes", async () => {
    const h = await mountApp();

    // Flip the undo affordance on via a successful drop first.
    rightClick(commitRow(h, "Fix bug Y")!);
    flushSync();
    menuItem(h, t("menu.drop"))!.click();
    flushSync();
    rewriteGate(h).confirm();
    await settle();
    expect(toolbarButton(h, "Undo")!.disabled).toBe(false);

    const before = ipc.listCommits.mock.calls.length;
    ipc.undo.mockResolvedValueOnce({
      backup_ref: "refs/adgitter/backup/1",
      op: "drop",
      original_ref: "refs/heads/main",
      target: SHA2,
      created_ms: 1,
      seq: 1,
    });

    toolbarButton(h, "Undo")!.click();
    await settle();

    expect(ipc.undo).toHaveBeenCalledWith(REPO_PATH);
    expect(ipc.listCommits.mock.calls.length).toBeGreaterThan(before);
    expect(noticeToast(h)).toBe(t("notice.undid", { op: "drop" }));
  });

  it("shows 'nothing to undo' and disables the button again when undo resolves null", async () => {
    const h = await mountApp();
    rightClick(commitRow(h, "Fix bug Y")!);
    flushSync();
    menuItem(h, t("menu.drop"))!.click();
    flushSync();
    rewriteGate(h).confirm();
    await settle();

    ipc.undo.mockResolvedValueOnce(null);
    toolbarButton(h, "Undo")!.click();
    await settle();

    expect(noticeToast(h)).toBe(t("notice.nothingToUndo"));
    expect(toolbarButton(h, "Undo")!.disabled).toBe(true);
  });
});

/**
 * The Issue panel on REAL provider data.
 *
 * The load-bearing property here is a negative one: there is no mock fallback
 * any more. ADGitter stores no issues of its own, so a repo with no tracker
 * bound — or one whose credential cannot be read — has genuinely nothing to
 * show, and the panel's job collapses to naming the fix. Before this, every
 * one of these cases silently rendered two fabricated seed issues, which is
 * why the "truly unbound" path had only pure-function coverage.
 */
describe("App — hide unreferenced (ghost) commits (settings.general.hideGhosts)", () => {
  const GHOST_SHA = "d4".repeat(20);

  // Same shape as appHarness's `makeCommit`, plus `ghost: true` — a commit no
  // branch/tag/HEAD points to, kept reachable only by an expiring
  // `refs/adgitter/` backup ref after a history rewrite.
  function ghostCommit(): Commit {
    return {
      sha: GHOST_SHA,
      short_sha: GHOST_SHA.slice(0, 7),
      author_name: "Ada Lovelace",
      author_email: "ada@example.com",
      timestamp: 1_700_000_000,
      subject: "Ghost commit",
      body: "",
      parents: [SHA1],
      ghost: true,
    };
  }

  function commitsWithGhost(): Commit[] {
    return [...defaultCommits(), ghostCommit()];
  }

  it("renders the ghost commit's row by default (hideGhosts off)", async () => {
    const h = await mountApp({ commits: commitsWithGhost() });

    expect(commitRow(h, "Ghost commit")).not.toBeNull();
  });

  it("hides the ghost commit's row when hideGhosts is enabled, keeping live rows", async () => {
    const h = await mountApp({
      commits: commitsWithGhost(),
      settings: { general: { hideGhosts: true } },
    });

    expect(commitRow(h, "Ghost commit")).toBeNull();
    expect(commitRow(h, "Add feature X")).not.toBeNull();
  });
});

describe("App — checkout remote branch (graph chip double-click / context menu)", () => {
  function refsWithRemote(): RefList {
    return {
      ...defaultRefs(),
      remotes: [{ name: "origin/feature", kind: "remote", target: SHA2 }],
    };
  }

  // MetroGraph's `branchChip` test helper only queries `.chip-branch` (local
  // branch labels) — remote chips render as `.chip-remote`, so query that
  // directly rather than extending the shared helper for one call site.
  function remoteChip(h: HTMLElement, name: string): HTMLElement | null {
    return (
      [...h.querySelectorAll<HTMLElement>(".chip-remote")].find((el) =>
        el.textContent?.trim().startsWith(name),
      ) ?? null
    );
  }

  const dialogEl = (h: HTMLElement) =>
    h.querySelector<HTMLElement>(`[aria-label="${t("remoteCheckout.title")}"]`);

  it("a single click on the remote chip never checks anything out (no direct path)", async () => {
    const h = await mountApp({ refs: refsWithRemote() });
    const chip = remoteChip(h, "origin/feature");
    expect(chip).not.toBeNull();

    chip!.click();
    await settle();

    expect(ipc.inspectRemoteCheckout).not.toHaveBeenCalled();
    expect(ipc.checkoutRemoteBranch).not.toHaveBeenCalled();
    expect(ipc.checkout).not.toHaveBeenCalled();
    expect(dialogEl(h)).toBeNull();
  });

  it("double-click opens the confirm dialog prefilled with the remote-prefix-stripped name; primary creates + tracks + checks out", async () => {
    const h = await mountApp({ refs: refsWithRemote() });
    const chip = remoteChip(h, "origin/feature")!;
    chip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await settle();

    const dialog = dialogEl(h);
    expect(dialog).not.toBeNull();
    expect(ipc.checkoutRemoteBranch).not.toHaveBeenCalled();

    const input = dialog!.querySelector<HTMLInputElement>("#rc-name")!;
    expect(input.value).toBe("feature");

    dialog!.querySelector<HTMLButtonElement>(".primary")!.click();
    await settle();

    expect(ipc.checkoutRemoteBranch).toHaveBeenCalledWith(
      REPO_PATH,
      "origin/feature",
      "feature",
    );
    expect(noticeToast(h)).toBe(
      t("notice.remoteCheckedOut", { branch: "feature" }),
    );
    expect(dialogEl(h)).toBeNull();
  });

  it("double-click, edit the name, then primary creates the local branch under the edited name", async () => {
    const h = await mountApp({ refs: refsWithRemote() });
    const chip = remoteChip(h, "origin/feature")!;
    chip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await settle();

    const dialog = dialogEl(h)!;
    const input = dialog.querySelector<HTMLInputElement>("#rc-name")!;
    input.value = "my-feature";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();

    dialog.querySelector<HTMLButtonElement>(".primary")!.click();
    await settle();

    expect(ipc.checkoutRemoteBranch).toHaveBeenCalledWith(
      REPO_PATH,
      "origin/feature",
      "my-feature",
    );
  });

  it("the secondary (detached) action calls checkout(repoPath, remoteName), never checkoutRemoteBranch", async () => {
    const h = await mountApp({ refs: refsWithRemote() });
    const chip = remoteChip(h, "origin/feature")!;
    chip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await settle();

    const dialog = dialogEl(h)!;
    // Actions render Cancel, then Checkout detached, both `.ghost`.
    const ghosts = [...dialog.querySelectorAll<HTMLButtonElement>(".ghost")];
    expect(ghosts.length).toBe(2);
    ghosts[1].click();
    await settle();

    expect(ipc.checkout).toHaveBeenCalledWith(REPO_PATH, "origin/feature");
    expect(ipc.checkoutRemoteBranch).not.toHaveBeenCalled();
    expect(noticeToast(h)).toBe(
      t("notice.detachedCheckedOut", { name: "origin/feature" }),
    );
    expect(dialogEl(h)).toBeNull();
  });

  it("Cancel closes the dialog and fires no IPC call at all", async () => {
    const h = await mountApp({ refs: refsWithRemote() });
    const chip = remoteChip(h, "origin/feature")!;
    chip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await settle();

    const dialog = dialogEl(h)!;
    dialog.querySelector<HTMLButtonElement>(".ghost")!.click(); // Cancel is first
    flushSync();

    expect(ipc.checkoutRemoteBranch).not.toHaveBeenCalled();
    expect(ipc.checkout).not.toHaveBeenCalled();
    expect(dialogEl(h)).toBeNull();
  });

  it("right-clicking the remote chip opens a context menu whose item opens the same confirm dialog", async () => {
    const h = await mountApp({ refs: refsWithRemote() });
    const chip = remoteChip(h, "origin/feature")!;
    rightClick(chip);
    flushSync();

    const item = menuItem(h, t("menu.checkoutRemote"));
    expect(item).not.toBeNull();
    item!.click();
    await settle();

    expect(dialogEl(h)).not.toBeNull();
    expect(ipc.checkoutRemoteBranch).not.toHaveBeenCalled();
  });
});

describe("App — checkout remote branch: the situation decides the question", () => {
  function refsWithRemote(): RefList {
    return {
      ...defaultRefs(),
      remotes: [{ name: "origin/feature", kind: "remote", target: SHA2 }],
    };
  }

  function remoteChip(h: HTMLElement, name: string): HTMLElement | null {
    return (
      [...h.querySelectorAll<HTMLElement>(".chip-remote")].find((el) =>
        el.textContent?.trim().startsWith(name),
      ) ?? null
    );
  }

  const dialogByLabel = (h: HTMLElement, label: string) =>
    h.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  const createDialog = (h: HTMLElement) =>
    dialogByLabel(h, t("remoteCheckout.title"));
  const adoptDialog = (h: HTMLElement) =>
    dialogByLabel(h, t("remoteAdopt.title"));
  const pullDialog = (h: HTMLElement) =>
    dialogByLabel(h, t("remotePull.title"));

  /** None of the three prompts is on screen. */
  function noPrompt(h: HTMLElement): boolean {
    return (
      createDialog(h) === null &&
      adoptDialog(h) === null &&
      pullDialog(h) === null
    );
  }

  /**
   * Mount, then install the row of the matrix this test is about (`mountApp`
   * re-seeds every ipc mock with its default, so the override has to come
   * after it), then double-click the remote chip.
   *
   * `row` is the backend's classification; `null` keeps the harness default,
   * which is the "no local branch" row.
   */
  async function openRemote(
    row: Record<string, unknown> | null = null,
    before: () => void = () => {},
  ): Promise<HTMLElement> {
    const h = await mountApp({ refs: refsWithRemote() });
    if (row)
      ipc.inspectRemoteCheckout.mockResolvedValue({
        localName: "feature",
        ahead: 0,
        behind: 0,
        ...row,
      });
    before();
    remoteChip(h, "origin/feature")!.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true }),
    );
    await settle();
    return h;
  }

  it("inspects the situation before prompting anything", async () => {
    await openRemote();

    expect(ipc.inspectRemoteCheckout).toHaveBeenCalledWith(
      REPO_PATH,
      "origin/feature",
      "feature",
    );
  });

  // Row 2 — the whole point of classifying first.
  it("checks out with NO prompt when the local branch tracks it at the same commit", async () => {
    const h = await openRemote({ case: "checkout", sync: "none" });

    expect(noPrompt(h)).toBe(true);
    expect(ipc.checkout).toHaveBeenCalledWith(REPO_PATH, "feature");
    expect(ipc.checkoutRemoteBranch).not.toHaveBeenCalled();
    expect(ipc.pull).not.toHaveBeenCalled();
    expect(noticeToast(h)).toBe(
      t("notice.remoteInSync", { branch: "feature", remote: "origin/feature" }),
    );
  });

  // Row 3a — behind: the one shape of "they differ" that offers a pull.
  it("behind: checks out, then asks whether to pull; confirming pulls the branch's own remote", async () => {
    const h = await openRemote({
      case: "checkout",
      behind: 2,
      sync: "offerPull",
    });

    expect(ipc.checkout).toHaveBeenCalledWith(REPO_PATH, "feature");
    expect(pullDialog(h)).not.toBeNull();
    expect(ipc.pull).not.toHaveBeenCalled();

    pullDialog(h)!.querySelector<HTMLButtonElement>(".primary")!.click();
    await settle();

    expect(ipc.pull.mock.calls[0][0]).toBe(REPO_PATH);
    expect(ipc.pull.mock.calls[0][1]).toBe("origin");
    expect(noticeToast(h)).toBe(t("notice.pulled"));
    expect(noPrompt(h)).toBe(true);
  });

  it("behind: declining the pull keeps the checkout and says the branch is still behind", async () => {
    const h = await openRemote({
      case: "checkout",
      behind: 2,
      sync: "offerPull",
    });

    // Cancel is the first `.ghost` in ConfirmDialog's actions.
    pullDialog(h)!.querySelector<HTMLButtonElement>(".ghost")!.click();
    await settle();

    expect(ipc.pull).not.toHaveBeenCalled();
    expect(ipc.checkout).toHaveBeenCalledWith(REPO_PATH, "feature");
    expect(noticeToast(h)).toBe(
      t("notice.remotePullSkipped", {
        branch: "feature",
        remote: "origin/feature",
        behind: 2,
      }),
    );
    expect(noPrompt(h)).toBe(true);
  });

  // Row 3b — ahead: a pull could do nothing, so it is not offered.
  it("ahead: checks out and says there is nothing to pull, without asking", async () => {
    const h = await openRemote({
      case: "checkout",
      ahead: 3,
      sync: "localAhead",
    });

    expect(ipc.checkout).toHaveBeenCalledWith(REPO_PATH, "feature");
    expect(noPrompt(h)).toBe(true);
    expect(ipc.pull).not.toHaveBeenCalled();
    expect(noticeToast(h)).toBe(
      t("notice.remoteLocalAhead", {
        branch: "feature",
        remote: "origin/feature",
        ahead: 3,
      }),
    );
  });

  // Row 3c — diverged: a pull would merge, which nobody asked for.
  it("diverged: checks out and warns with both figures, without offering a merge", async () => {
    const h = await openRemote({
      case: "checkout",
      ahead: 1,
      behind: 4,
      sync: "diverged",
    });

    expect(ipc.checkout).toHaveBeenCalledWith(REPO_PATH, "feature");
    expect(noPrompt(h)).toBe(true);
    expect(ipc.pull).not.toHaveBeenCalled();
    expect(noticeToast(h)).toBe(
      t("notice.remoteDiverged", {
        branch: "feature",
        remote: "origin/feature",
        ahead: 1,
        behind: 4,
      }),
    );
  });

  // Row 4 — no upstream: a two-step flow.
  it("no upstream: asks to adopt it, and cancelling that does nothing at all", async () => {
    const h = await openRemote({
      case: "adoptUpstream",
      behind: 1,
      sync: "offerPull",
    });

    expect(adoptDialog(h)).not.toBeNull();
    expect(ipc.adoptRemoteUpstreamAndCheckout).not.toHaveBeenCalled();

    adoptDialog(h)!.querySelector<HTMLButtonElement>(".ghost")!.click();
    await settle();

    expect(noPrompt(h)).toBe(true);
    expect(ipc.adoptRemoteUpstreamAndCheckout).not.toHaveBeenCalled();
    expect(ipc.checkout).not.toHaveBeenCalled();
    expect(ipc.pull).not.toHaveBeenCalled();
  });

  it("no upstream: confirming sets the upstream + checks out, then asks about the divergence", async () => {
    const h = await openRemote({
      case: "adoptUpstream",
      behind: 1,
      sync: "offerPull",
    });

    adoptDialog(h)!.querySelector<HTMLButtonElement>(".primary")!.click();
    await settle();

    expect(ipc.adoptRemoteUpstreamAndCheckout).toHaveBeenCalledWith(
      REPO_PATH,
      "origin/feature",
      "feature",
    );
    expect(adoptDialog(h)).toBeNull();
    expect(pullDialog(h)).not.toBeNull();
  });

  it("no upstream: cancelling step two leaves step one applied, and says so", async () => {
    const h = await openRemote({
      case: "adoptUpstream",
      behind: 1,
      sync: "offerPull",
    });
    adoptDialog(h)!.querySelector<HTMLButtonElement>(".primary")!.click();
    await settle();

    pullDialog(h)!.querySelector<HTMLButtonElement>(".ghost")!.click();
    await settle();

    expect(ipc.pull).not.toHaveBeenCalled();
    expect(ipc.adoptRemoteUpstreamAndCheckout).toHaveBeenCalledTimes(1);
    expect(noPrompt(h)).toBe(true);
    const said = noticeToast(h) ?? "";
    expect(said).toContain(
      t("notice.remoteUpstreamSet", {
        branch: "feature",
        remote: "origin/feature",
      }),
    );
    expect(said).toContain(
      t("notice.remotePullSkipped", {
        branch: "feature",
        remote: "origin/feature",
        behind: 1,
      }),
    );
  });

  it("no upstream, already level: adopts, checks out and asks nothing further", async () => {
    const h = await openRemote({ case: "adoptUpstream", sync: "none" });
    adoptDialog(h)!.querySelector<HTMLButtonElement>(".primary")!.click();
    await settle();

    expect(noPrompt(h)).toBe(true);
    expect(ipc.pull).not.toHaveBeenCalled();
    expect(noticeToast(h)).toBe(
      t("notice.remoteUpstreamSet", {
        branch: "feature",
        remote: "origin/feature",
      }),
    );
  });

  // Row 5 — the only error.
  it("a local branch tracking a different remote shows the backend's error and prompts nothing", async () => {
    const h = await openRemote(null, () =>
      ipc.inspectRemoteCheckout.mockRejectedValue({
        code: "REMOTE_UPSTREAM_MISMATCH",
        message:
          "local branch 'feature' already tracks 'upstream/feature', not 'origin/feature'",
      }),
    );

    expect(noPrompt(h)).toBe(true);
    expect(ipc.checkout).not.toHaveBeenCalled();
    expect(ipc.checkoutRemoteBranch).not.toHaveBeenCalled();
    expect(ipc.adoptRemoteUpstreamAndCheckout).not.toHaveBeenCalled();
    const shown = errorToast(h) ?? "";
    expect(shown).toContain(t("error.REMOTE_UPSTREAM_MISMATCH"));
    expect(shown).toContain("upstream/feature");
  });

  // The configured PAT belongs to origin. A pull of any other remote would
  // either go out unauthenticated or hand that token to another host, so the
  // divergence is reported and no pull is offered.
  async function openForkRemote(row: Record<string, unknown>) {
    const h = await mountApp({
      refs: {
        ...defaultRefs(),
        remotes: [{ name: "fork/feature", kind: "remote", target: SHA2 }],
      },
    });
    ipc.inspectRemoteCheckout.mockResolvedValue({
      localName: "feature",
      ahead: 0,
      behind: 0,
      ...row,
    });
    remoteChip(h, "fork/feature")!.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true }),
    );
    await settle();
    return h;
  }

  it("behind on a remote other than origin: checks out, offers NO pull, says it was skipped", async () => {
    const h = await openForkRemote({
      case: "checkout",
      behind: 2,
      sync: "offerPull",
    });

    expect(ipc.checkout).toHaveBeenCalledWith(REPO_PATH, "feature");
    expect(pullDialog(h)).toBeNull();
    expect(noPrompt(h)).toBe(true);
    expect(noticeToast(h)).toBe(
      t("notice.remotePullSkipped", {
        branch: "feature",
        remote: "fork/feature",
        behind: 2,
      }),
    );
  });

  // This one guards the *call site*, not the prompt: it clicks Pull if a prompt
  // somehow appeared, so it still holds if `afterRemoteCheckout` ever regresses.
  // `remoteAuth()` carries origin's PAT, so a `pull` of any other remote would
  // disclose it over HTTP Basic.
  it("never passes a non-origin remote to pull — origin's PAT must not reach another host", async () => {
    const h = await openForkRemote({
      case: "checkout",
      behind: 2,
      sync: "offerPull",
    });

    pullDialog(h)?.querySelector<HTMLButtonElement>(".primary")?.click();
    await settle();

    expect(ipc.pull.mock.calls.filter((c) => c[1] !== "origin")).toEqual([]);
    expect(ipc.pull).not.toHaveBeenCalled();
  });

  it("non-origin remote, adopt row: step one still runs, step two is never offered", async () => {
    const h = await openForkRemote({
      case: "adoptUpstream",
      behind: 2,
      sync: "offerPull",
    });
    adoptDialog(h)!.querySelector<HTMLButtonElement>(".primary")!.click();
    await settle();

    expect(ipc.adoptRemoteUpstreamAndCheckout).toHaveBeenCalledWith(
      REPO_PATH,
      "fork/feature",
      "feature",
    );
    expect(pullDialog(h)).toBeNull();
    expect(ipc.pull).not.toHaveBeenCalled();
  });

  // The dialog's name is editable, so the typed name gets classified too —
  // otherwise editing it to an existing branch reproduces exactly the generic
  // "already exists" failure this whole flow replaces.
  it("editing the name to a branch that already tracks the remote checks out instead of failing", async () => {
    const h = await openRemote();
    const dialog = createDialog(h)!;
    const input = dialog.querySelector<HTMLInputElement>("#rc-name")!;
    input.value = "existing";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();

    ipc.inspectRemoteCheckout.mockResolvedValue({
      case: "checkout",
      localName: "existing",
      ahead: 0,
      behind: 0,
      sync: "none",
    });
    dialog.querySelector<HTMLButtonElement>(".primary")!.click();
    await settle();

    expect(ipc.inspectRemoteCheckout).toHaveBeenLastCalledWith(
      REPO_PATH,
      "origin/feature",
      "existing",
    );
    expect(ipc.checkoutRemoteBranch).not.toHaveBeenCalled();
    expect(ipc.checkout).toHaveBeenCalledWith(REPO_PATH, "existing");
    expect(noPrompt(h)).toBe(true);
  });

  // A refused checkout must not be dressed up as success.
  it("a checkout refused by uncommitted changes surfaces the error and pulls nothing", async () => {
    const h = await openRemote(
      { case: "checkout", behind: 2, sync: "offerPull" },
      () =>
        ipc.checkout.mockRejectedValue({
          code: "GIT_ERROR",
          message: "1 conflict prevents checkout",
        }),
    );

    expect(errorToast(h)).toContain("conflict prevents checkout");
    expect(pullDialog(h)).toBeNull();
    expect(ipc.pull).not.toHaveBeenCalled();
  });
});

describe("App — history rewrite descendant remap notice", () => {
  it("names the branches a rewrite could not re-base automatically", async () => {
    const h = await mountApp();
    ipc.reword.mockResolvedValue({
      status: "completed",
      outcome: {
        remapped: ["refs/heads/b"],
        skipped: ["refs/heads/c", "refs/heads/d"],
      },
    });

    rightClick(commitRow(h, "Fix bug Y")!);
    flushSync();
    menuItem(h, t("menu.reword"))!.click();
    flushSync();
    rewriteGate(h).confirm();
    await settle();

    expect(ipc.reword).toHaveBeenCalledTimes(1);
    // Full refs are shortened to bare branch names in the notice.
    expect(noticeToast(h)).toBe(t("notice.remapSkipped", { branches: "c, d" }));
  });

  it("stays quiet when every descendant branch remapped cleanly", async () => {
    const h = await mountApp();

    rightClick(commitRow(h, "Fix bug Y")!);
    flushSync();
    menuItem(h, t("menu.reword"))!.click();
    flushSync();
    rewriteGate(h).confirm();
    await settle();

    expect(ipc.reword).toHaveBeenCalledTimes(1);
    expect(noticeToast(h)).toBeNull();
  });
});

// jsdom lacks DataTransfer, so dispatch MouseEvents (they carry the modifier
// flags resolveDrag reads) with a minimal dataTransfer attached — same shim
// as MetroGraph.gestures.test.ts.
function fireDrag(
  el: Element,
  type: "dragstart" | "dragover" | "drop" | "dragend",
  mods: Partial<MouseEventInit> = {},
) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, ...mods });
  Object.defineProperty(ev, "dataTransfer", {
    value: {
      effectAllowed: "",
      dropEffect: "",
      _d: {} as Record<string, string>,
      setData(k: string, v: string) {
        this._d[k] = v;
      },
      getData(k: string) {
        return this._d[k] ?? "";
      },
    },
  });
  el.dispatchEvent(ev);
  return ev;
}

describe("App — conflict resolution mode", () => {
  const CONFLICT = { op: "merge", branch: "main", sha: SHA2 };

  /** Default status + one unmerged path (the resolve-mode fixture). */
  function conflictedStatus() {
    return {
      ...defaultRepoStatus(),
      conflicted: [
        {
          path: "src/conflict.ts",
          status: "conflicted" as const,
          old_path: null,
        },
      ],
    };
  }

  /** Merge `feature` into the current branch (`main`) via the branch menu,
   *  confirming the gate — the op call the conflict mocks then intercept. */
  async function startMerge(h: HTMLElement): Promise<void> {
    rightClick(branchChip(h, "feature")!);
    flushSync();
    menuItem(h, t("menu.mergeIntoParent", { branch: "feature" }))!.click();
    flushSync();
    menuItem(h, t("menu.branchCurrent", { branch: "main" }))!.click();
    flushSync();
    rewriteGate(h).confirm();
    await settle();
  }

  const banner = (h: HTMLElement) =>
    h.querySelector<HTMLElement>(".resolve-banner");
  const continueBtn = (h: HTMLElement) =>
    h.querySelector<HTMLButtonElement>(".resolve-banner .continue");
  const abortBtn = (h: HTMLElement) =>
    h.querySelector<HTMLButtonElement>(".resolve-banner .abort");

  it("a merge that conflicts enters resolve mode: banner, files panel on the conflicted section, locked graph, no error toast", async () => {
    const h = await mountApp();
    ipc.merge.mockResolvedValue({ status: "conflict", state: CONFLICT });
    ipc.repoStatus.mockResolvedValue(conflictedStatus());

    await startMerge(h);

    expect(ipc.merge).toHaveBeenCalledWith(REPO_PATH, "feature");
    // Banner names the conflicted commit.
    expect(banner(h)).not.toBeNull();
    expect(banner(h)!.textContent).toContain(SHA2.slice(0, 7));
    // The files panel auto-expanded, showing the conflicted section FIRST
    // with its warning-accented header and the unmerged file.
    const sections = [...h.querySelectorAll<HTMLElement>(".panel section")];
    expect(sections.length).toBeGreaterThan(0);
    expect(sections[0].querySelector("h3")?.classList.contains("warn")).toBe(
      true,
    );
    expect(sections[0].textContent).toContain(t("files.conflicted"));
    expect(sections[0].textContent).toContain("conflict.ts");
    // The graph is locked under a pointer-capturing overlay.
    expect(h.querySelector(".graph-locked")).not.toBeNull();
    // A conflict is a mode, not a failure — no error toast.
    expect(errorToast(h)).toBeNull();
    // Undo is disabled while resolving (the paused op hasn't landed).
    expect(toolbarButton(h, t("toolbar.undo"))!.disabled).toBe(true);
  });

  it("Continue stays disabled until every conflicted path is staged, then continues and exits the mode", async () => {
    const h = await mountApp();
    ipc.merge.mockResolvedValue({ status: "conflict", state: CONFLICT });
    ipc.repoStatus.mockResolvedValue(conflictedStatus());

    await startMerge(h);

    expect(continueBtn(h)!.disabled).toBe(true);
    expect(continueBtn(h)!.title).toBe(t("resolve.stageAllFirst"));

    // Stage the conflicted file via its + action; the fresh status now has
    // no conflicted paths, so Continue enables.
    ipc.repoStatus.mockResolvedValue(defaultRepoStatus());
    const stageBtn = h.querySelector<HTMLButtonElement>(
      `.acts button[title=${JSON.stringify(t("files.stage"))}]`,
    );
    expect(stageBtn).not.toBeNull();
    stageBtn!.click();
    await settle();

    expect(ipc.stagePaths).toHaveBeenCalledWith(REPO_PATH, ["src/conflict.ts"]);
    expect(continueBtn(h)!.disabled).toBe(false);
    expect(ipc.continueOp).not.toHaveBeenCalled();

    continueBtn(h)!.click();
    await settle();

    expect(ipc.continueOp).toHaveBeenCalledWith(REPO_PATH);
    // Completed: mode exits, undo re-arms, success notice shows.
    expect(banner(h)).toBeNull();
    expect(h.querySelector(".graph-locked")).toBeNull();
    expect(noticeToast(h)).toBe(t("notice.resolved", { op: "merge" }));
    expect(toolbarButton(h, t("toolbar.undo"))!.disabled).toBe(false);
  });

  it("a continue that re-conflicts stays in the mode, showing the NEW sha", async () => {
    const h = await mountApp();
    ipc.merge.mockResolvedValue({ status: "conflict", state: CONFLICT });
    // Every conflicted path already staged — Continue enables right away.
    await startMerge(h);
    await settle();
    expect(continueBtn(h)!.disabled).toBe(false);

    ipc.continueOp.mockResolvedValue({
      status: "conflict",
      state: { op: "merge", branch: "main", sha: SHA3 },
    });
    continueBtn(h)!.click();
    await settle();

    expect(banner(h)).not.toBeNull();
    expect(banner(h)!.textContent).toContain(SHA3.slice(0, 7));
    expect(h.querySelector(".graph-locked")).not.toBeNull();
    expect(noticeToast(h)).toBeNull();
    expect(errorToast(h)).toBeNull();
  });

  it("Abort: gated behind a confirm dialog, then abortOp restores and exits the mode", async () => {
    const h = await mountApp();
    ipc.merge.mockResolvedValue({ status: "conflict", state: CONFLICT });
    ipc.repoStatus.mockResolvedValue(conflictedStatus());

    await startMerge(h);

    abortBtn(h)!.click();
    flushSync();
    expect(ipc.abortOp).not.toHaveBeenCalled();
    const dialog = h.querySelector<HTMLElement>(
      `[aria-label=${JSON.stringify(t("resolve.abortConfirm.title"))}]`,
    );
    expect(dialog).not.toBeNull();

    dialog!.querySelector<HTMLButtonElement>(".primary")!.click();
    await settle();

    expect(ipc.abortOp).toHaveBeenCalledWith(REPO_PATH);
    expect(banner(h)).toBeNull();
    expect(h.querySelector(".graph-locked")).toBeNull();
    expect(noticeToast(h)).toBe(t("notice.opAborted"));
  });

  it("re-enters resolve mode on repo load when a paused op survives on disk (app restart)", async () => {
    const h = await mountApp({
      conflictState: { op: "rebase", branch: "feature", sha: SHA1 },
    });

    expect(banner(h)).not.toBeNull();
    expect(banner(h)!.textContent).toContain(SHA1.slice(0, 7));
    expect(h.querySelector(".graph-locked")).not.toBeNull();
    // The files panel opened on load too.
    expect(h.querySelector(".panel")).not.toBeNull();
  });

  it("graph gestures are ignored while resolving — no pending confirm ever opens", async () => {
    const h = await mountApp({
      conflictState: { op: "merge", branch: "main", sha: SHA2 },
    });
    expect(banner(h)).not.toBeNull();

    // Attempt the merge gesture: drag feature's chip onto main's.
    fireDrag(branchChip(h, "feature")!, "dragstart");
    fireDrag(branchChip(h, "main")!, "dragover");
    fireDrag(branchChip(h, "main")!, "drop");
    flushSync();

    expect(rewriteGate(h).dialog).toBeNull();
    expect(ipc.merge).not.toHaveBeenCalled();
  });
});

describe("App — branch-head merge drag, ambiguous at both ends", () => {
  // Both endpoints carry two branches, so neither the branch being merged in
  // nor the branch being advanced may be taken from chip display order.
  function ambiguousRefs(): RefList {
    return {
      head: { branch: "main", target: SHA3, detached: false },
      branches: [
        { name: "main", kind: "branch", target: SHA3 },
        { name: "release", kind: "branch", target: SHA3 },
        { name: "feature", kind: "branch", target: SHA2 },
        { name: "wip", kind: "branch", target: SHA2 },
      ],
      remotes: [],
      tags: [],
    };
  }

  function firePointer(
    el: EventTarget,
    type: "pointerenter" | "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ) {
    const ev = new MouseEvent(type, {
      bubbles: type !== "pointerenter",
      cancelable: true,
      button: 0,
      clientX: x,
      clientY: y,
    });
    Object.defineProperty(ev, "pointerId", { value: 1 });
    el.dispatchEvent(ev);
  }

  /** Drag the merge dot from the node at row `from` onto the node at row `to`
   *  (rows are newest-first). jsdom has no layout, so each node handle's
   *  inline left/top is exactly the hit point the graph tests against. */
  function mergeDrag(h: HTMLElement, from: number, to: number) {
    const handles = [...h.querySelectorAll<HTMLDivElement>(".node-handle")];
    const dest = handles[to];
    firePointer(handles[from], "pointerenter", 0, 0);
    flushSync();
    const dot = h.querySelector(".merge-handle")!;
    firePointer(dot, "pointerdown", 0, 0);
    firePointer(
      window,
      "pointermove",
      parseFloat(dest.style.left),
      parseFloat(dest.style.top),
    );
    firePointer(
      window,
      "pointerup",
      parseFloat(dest.style.left),
      parseFloat(dest.style.top),
    );
    flushSync();
  }

  it("asks for both ends, then merges the picked source into the picked target", async () => {
    const h = await mountApp({ refs: ambiguousRefs() });
    mergeDrag(h, 1, 0); // SHA2's head → SHA3's head

    const dialog = rewriteGate(h).dialog!;
    expect(dialog).not.toBeNull();
    const groups = [...dialog.querySelectorAll("fieldset.choices")];
    expect(groups.map((g) => g.querySelector("legend")?.textContent)).toEqual([
      t("confirmRewrite.chooseSourceBranch"),
      t("confirmRewrite.chooseBranch"),
    ]);
    expect(
      groups.map((g) =>
        [...g.querySelectorAll<HTMLInputElement>("input")].map((r) => r.value),
      ),
    ).toEqual([
      ["feature", "wip"],
      ["main", "release"],
    ]);

    // Pick the non-default on both sides.
    groups[0].querySelectorAll<HTMLInputElement>("input")[1].click();
    groups[1].querySelectorAll<HTMLInputElement>("input")[1].click();
    flushSync();
    // The body copy tracks the picks (single source of truth: `pending`).
    expect(rewriteGate(h).body).toContain("wip");
    expect(rewriteGate(h).body).toContain("release");

    expect(ipc.merge).not.toHaveBeenCalled();
    rewriteGate(h).confirm();
    await settle();

    // "release" is not the checked-out branch, so it gets checked out first.
    expect(ipc.checkout).toHaveBeenCalledWith(REPO_PATH, "release");
    expect(ipc.merge).toHaveBeenCalledWith(REPO_PATH, "wip");
  });

  it("confirming without touching the radios keeps the previous defaults", async () => {
    const h = await mountApp({ refs: ambiguousRefs() });
    mergeDrag(h, 1, 0);

    // Both ends open pre-picked at their display-order first, so the gate is
    // enabled from the start (an *unanswered* group blocks it — covered in
    // ConfirmRewrite.test.ts) and the old behaviour is what runs.
    expect(
      rewriteGate(h).dialog!.querySelector<HTMLButtonElement>(".primary")!
        .disabled,
    ).toBe(false);
    rewriteGate(h).confirm();
    await settle();
    expect(ipc.checkout).not.toHaveBeenCalled(); // "main" is already current
    expect(ipc.merge).toHaveBeenCalledWith(REPO_PATH, "feature");
  });
});

describe("App — multi-window upsell (single-instance relaunch, free tier)", () => {
  it("surfaces window.lockedUpsell as a notice toast when the backend emits multi-window-upsell", async () => {
    const h = await mountApp();

    const call = windowApi.listen.mock.calls.find(
      ([event]) => event === "multi-window-upsell",
    );
    expect(call).toBeDefined();
    const handler = call?.[1] as (e: { payload: unknown }) => void;

    expect(noticeToast(h)).toBeNull();
    handler({ payload: { code: "FEATURE_LOCKED" } });
    flushSync();

    expect(noticeToast(h)).toBe(t("window.lockedUpsell"));
  });

  // The refusal is no longer only about tier: the entitlement gate is
  // device-bound, so this same event now also reaches a paying user on a
  // reinstalled machine, and one whose licence lapsed. Selling them a plan
  // they already bought is the failure this guards against.
  it("tells a user on the wrong device to sign in again, not to buy a plan", async () => {
    const h = await mountApp();
    const handler = windowApi.listen.mock.calls.find(
      ([event]) => event === "multi-window-upsell",
    )?.[1] as (e: { payload: unknown }) => void;

    handler({ payload: { code: "LICENSE_DEVICE_MISMATCH" } });
    flushSync();

    expect(noticeToast(h)).toBe(t("error.LICENSE_DEVICE_MISMATCH"));
    expect(noticeToast(h)).not.toBe(t("window.lockedUpsell"));
  });

  it("tells a user with a lapsed licence to renew, not to upgrade", async () => {
    const h = await mountApp();
    const handler = windowApi.listen.mock.calls.find(
      ([event]) => event === "multi-window-upsell",
    )?.[1] as (e: { payload: unknown }) => void;

    handler({ payload: { code: "LICENSE_EXPIRED" } });
    flushSync();

    expect(noticeToast(h)).toBe(t("error.LICENSE_EXPIRED"));
    expect(noticeToast(h)).not.toBe(t("window.lockedUpsell"));
  });

  // An older backend (or any future refusal with no code) must still say
  // something rather than render "undefined".
  it("falls back to the upsell when the event carries no reason", async () => {
    const h = await mountApp();
    const handler = windowApi.listen.mock.calls.find(
      ([event]) => event === "multi-window-upsell",
    )?.[1] as (e: { payload: unknown }) => void;

    handler({ payload: undefined });
    flushSync();

    expect(noticeToast(h)).toBe(t("window.lockedUpsell"));
  });
});

/**
 * The panel's four-step default-content chain, driven by an explicitly
 * injected provider.
 *
 * These cases used to ride on the MockIssueProvider's seed data, which meant
 * they passed whether or not anything was bound. Now each mount states its own
 * world — a bound GitHub tracker, a PAT in the keychain, and the JSON that
 * tracker returns — so the fixtures are the real wire format and the chain is
 * exercised over the same live path the app uses.
 */
// `handTool` + the `switchHandTool` keymap dispatch both live in App.svelte
// (MetroGraph only ever receives `handTool` as a read-only prop), so the
// momentary-press behavior is exercised here rather than in one of
// MetroGraph's own test files.
describe("App — momentary hand tool (Space, graph drag/pointer layer)", () => {
  /** MetroGraph's scroll content grows a `.hand` class while `handTool` is
   *  on (grab cursor + pan-on-drag) — the only DOM signal of the prop. */
  function handActive(h: HTMLElement): boolean {
    return !!h.querySelector(".content.hand");
  }

  function spaceKey(
    type: "keydown" | "keyup",
    opts: Partial<KeyboardEventInit> = {},
  ): KeyboardEvent {
    return new KeyboardEvent(type, {
      key: " ",
      bubbles: true,
      cancelable: true,
      ...opts,
    });
  }

  it("Space down engages the hand tool; Space up restores the select tool", async () => {
    const h = await mountApp();
    expect(handActive(h)).toBe(false);

    window.dispatchEvent(spaceKey("keydown"));
    flushSync();
    expect(handActive(h)).toBe(true);

    window.dispatchEvent(spaceKey("keyup"));
    flushSync();
    expect(handActive(h)).toBe(false);
  });

  it("key-repeat keydowns never thrash it on and off while the key stays held", async () => {
    const h = await mountApp();

    window.dispatchEvent(spaceKey("keydown"));
    flushSync();
    expect(handActive(h)).toBe(true);

    // The browser fires a repeated `keydown` (repeat: true) for as long as a
    // key stays physically down — none of these may re-toggle the tool; the
    // old toggle-on-every-keydown implementation would have flipped it back
    // off on the very first one.
    for (let i = 0; i < 5; i++) {
      window.dispatchEvent(spaceKey("keydown", { repeat: true }));
      flushSync();
      expect(handActive(h)).toBe(true);
    }

    window.dispatchEvent(spaceKey("keyup"));
    flushSync();
    expect(handActive(h)).toBe(false);
  });

  it("losing window focus while held restores the select tool (no keyup ever arrives)", async () => {
    const h = await mountApp();

    window.dispatchEvent(spaceKey("keydown"));
    flushSync();
    expect(handActive(h)).toBe(true);

    window.dispatchEvent(new Event("blur"));
    flushSync();
    expect(handActive(h)).toBe(false);
  });

  it("never engages while typing in an editable field (matches the Delete-key inEditable guard)", async () => {
    const h = await mountApp();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    input.dispatchEvent(spaceKey("keydown"));
    flushSync();
    expect(handActive(h)).toBe(false);

    input.remove();
  });
});

describe("App — drag HEAD (the checked-out branch's own chip) to check out", () => {
  /** `defaultRefs()` plus a second local branch ("wip") also pointing at
   *  SHA2 — the same commit `feature` already points at — so a drop there
   *  is genuinely ambiguous. */
  function refsWithAmbiguousCommit(): RefList {
    const base = defaultRefs();
    return {
      ...base,
      branches: [
        ...base.branches,
        {
          name: "wip",
          kind: "branch",
          target: SHA2,
          created_ms: 1000,
          has_upstream: false,
        },
      ],
    };
  }

  const choiceDialog = (h: HTMLElement) =>
    h.querySelector<HTMLElement>(
      `[aria-label=${JSON.stringify(t("checkoutChoice.title"))}]`,
    );

  it("dropped on a branch label: checks it out directly, no dialog at all", async () => {
    const h = await mountApp();

    fireDrag(branchChip(h, "main")!, "dragstart");
    fireDrag(branchChip(h, "feature")!, "dragover");
    fireDrag(branchChip(h, "feature")!, "drop");
    await settle();

    expect(choiceDialog(h)).toBeNull();
    expect(ipc.checkout).toHaveBeenCalledWith(REPO_PATH, "feature");
  });

  it("dropped on a commit with several local branches: opens the chooser and checks out nothing until picked", async () => {
    const h = await mountApp({ refs: refsWithAmbiguousCommit() });

    fireDrag(branchChip(h, "main")!, "dragstart");
    fireDrag(commitRow(h, "Fix bug Y")!, "dragover"); // SHA2: feature + wip
    fireDrag(commitRow(h, "Fix bug Y")!, "drop");
    flushSync();

    const dialog = choiceDialog(h);
    expect(dialog).not.toBeNull();
    expect(ipc.checkout).not.toHaveBeenCalled();

    const rowsEl = [
      ...dialog!.querySelectorAll<HTMLButtonElement>(".branch-row"),
    ];
    expect(rowsEl.map((b) => b.textContent?.trim())).toEqual([
      "feature",
      "wip",
    ]);

    rowsEl[1].click(); // pick "wip"
    await settle();

    expect(ipc.checkout).toHaveBeenCalledWith(REPO_PATH, "wip");
    expect(choiceDialog(h)).toBeNull();
  });

  it("Cancel closes the chooser and checks out nothing", async () => {
    const h = await mountApp({ refs: refsWithAmbiguousCommit() });

    fireDrag(branchChip(h, "main")!, "dragstart");
    fireDrag(commitRow(h, "Fix bug Y")!, "dragover");
    fireDrag(commitRow(h, "Fix bug Y")!, "drop");
    flushSync();

    choiceDialog(h)!.querySelector<HTMLButtonElement>(".ghost")!.click();
    flushSync();

    expect(choiceDialog(h)).toBeNull();
    expect(ipc.checkout).not.toHaveBeenCalled();
  });
});

function openSettings(h: HTMLElement): void {
  h.querySelector<HTMLButtonElement>(".icon-btn.gear")!.click();
  flushSync();
}

function settingsTab(h: HTMLElement, name: string): void {
  [...h.querySelectorAll<HTMLButtonElement>(".tabs button")]
    .find((b) => b.textContent?.trim() === name)!
    .click();
  flushSync();
}

function modalButton(h: HTMLElement, label: string): HTMLButtonElement {
  return [
    ...h.querySelectorAll<HTMLButtonElement>(".modal .actions .btn"),
  ].find((b) => b.textContent?.trim() === label)!;
}

/** Whether MetroGraph is currently rendering a themed pack: the decoration
 *  layers and the themed surface background only exist for a pack that ships
 *  them (the `default` pack renders none — see MetroGraph.theme.test.ts). */
function graphIsThemed(h: HTMLElement): boolean {
  return h.querySelector(".decor-under") !== null;
}

describe("App — Settings personalize live preview (graph theme)", () => {
  it("with a repo open, the preview follows the repo-scoped personalize, not the global one", async () => {
    // Global says themed, the open repo says default → the repo wins, both
    // before the modal opens and in the draft the modal previews from.
    const h = await mountApp({
      settings: { personalize: { graphTheme: "synthwave" } },
      projectConfig: JSON.stringify({ personalize: { graphTheme: "default" } }),
    });
    expect(graphIsThemed(h)).toBe(false);

    openSettings(h);
    settingsTab(h, "Personalize");
    // Opening alone must not swap the graph to the GLOBAL personalize.
    expect(graphIsThemed(h)).toBe(false);

    modalButton(h, "Cancel").click();
    await settle();
    expect(graphIsThemed(h)).toBe(false);
  });
});

describe("App — Undo only reverses this app's own changes", () => {
  /** The Undo button by its stable tutorial anchor: its `title` carries the
   *  blocked-reason, so it cannot double as the selector here. */
  const undoBtn = (h: HTMLElement) =>
    h.querySelector<HTMLButtonElement>('[data-tutorial="toolbar-undo"]')!;

  /** Arm Undo the way a user would: run a real in-app op. */
  async function armUndo(h: HTMLElement) {
    rightClick(commitRow(h, "Fix bug Y")!);
    flushSync();
    menuItem(h, t("menu.drop"))!.click();
    flushSync();
    rewriteGate(h).confirm();
    await settle();
    expect(undoBtn(h).disabled).toBe(false);
  }

  it("stops offering Undo, and says why, once history moved outside the app", async () => {
    const h = await mountApp();
    await armUndo(h);
    expect(undoBtn(h).title).toBe(t("toolbar.undo"));

    // Something else moved history; the backend is the one that decides.
    ipc.undoState.mockResolvedValue({
      available: false,
      op: null,
      reason: "external_change",
    });
    window.dispatchEvent(new Event("focus"));
    await settle();

    expect(ipc.undoState).toHaveBeenCalledWith(REPO_PATH);
    expect(undoBtn(h).disabled).toBe(true);
    expect(undoBtn(h).title).toBe(t("toolbar.undoBlockedExternal"));
  });

  it("names the real reason when Undo declines, instead of 'nothing to undo'", async () => {
    const h = await mountApp();
    await armUndo(h);

    // The button is still armed from the op that ran, but history moved since:
    // the backend declines, and the reason is not "nothing to undo".
    ipc.undo.mockResolvedValueOnce(null);
    ipc.undoState.mockResolvedValue({
      available: false,
      op: null,
      reason: "external_change",
    });

    undoBtn(h).click();
    await settle();

    expect(ipc.undo).toHaveBeenCalledWith(REPO_PATH);
    expect(noticeToast(h)).toBe(t("toolbar.undoBlockedExternal"));
    expect(undoBtn(h).disabled).toBe(true);
  });

  it("stays unavailable until the next in-app change re-arms it", async () => {
    const h = await mountApp();
    ipc.undoState.mockResolvedValue({
      available: false,
      op: null,
      reason: "external_change",
    });
    window.dispatchEvent(new Event("focus"));
    await settle();
    expect(undoBtn(h).disabled).toBe(true);
    expect(undoBtn(h).title).toBe(t("toolbar.undoBlockedExternal"));

    // A fresh in-app op records a new position, which re-arms Undo for it.
    await armUndo(h);
    expect(undoBtn(h).title).toBe(t("toolbar.undo"));
  });
});
