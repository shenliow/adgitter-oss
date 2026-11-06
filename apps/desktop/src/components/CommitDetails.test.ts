import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount, flushSync, type ComponentProps } from "svelte";
import CommitDetails from "./CommitDetails.svelte";
import type { Commit, FileChange } from "../lib/ipc";
import fs from "node:fs";
import path from "node:path";

// `openPath` is the only IPC call CommitDetails makes directly (mirrors
// FilesPanel's own "open in default editor" affordance) — `purgePath` is
// NOT called from here; the panel only requests a purge via `onPurgeFile`,
// and the caller (App.svelte) makes the actual IPC call.
const openPath = vi.fn<(r: string, p: string) => Promise<void>>(() =>
  Promise.resolve(),
);
const fileHistory = vi.fn<(r: string, p: string) => Promise<Commit[]>>(() =>
  Promise.resolve([]),
);

vi.mock("../lib/ipc", () => ({
  fileHistory: (r: string, p: string) => fileHistory(r, p),
  errorText: (e: unknown) => String(e),
  openPath: (r: string, p: string) => openPath(r, p),
}));

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

beforeEach(() => {
  openPath.mockClear().mockResolvedValue(undefined);
  fileHistory.mockClear().mockResolvedValue([]);
});

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
  // jsdom has no Clipboard API by default; remove any per-test stub so it
  // doesn't leak into the next test.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (navigator as any).clipboard;
});

const commit: Commit = {
  sha: "abc123def456",
  short_sha: "abc123d",
  author_name: "Ada Lovelace",
  author_email: "ada@example.com",
  timestamp: 1_700_000_000,
  subject: "subject",
  body: "body",
  parents: [],
};

function render(
  props: Partial<ComponentProps<typeof CommitDetails>> = {},
): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(CommitDetails, { target: host, props: { commit, ...props } });
  flushSync();
  return host;
}

function editButton(h: HTMLDivElement): HTMLButtonElement | null {
  return h.querySelector(".edit");
}
function subjectButton(h: HTMLDivElement): HTMLButtonElement | null {
  return h.querySelector(".subject-edit");
}
function textarea(h: HTMLDivElement): HTMLTextAreaElement | null {
  return h.querySelector("textarea.edit-textarea");
}
function saveButton(h: HTMLDivElement): HTMLButtonElement {
  return h.querySelector(".edit-actions .primary") as HTMLButtonElement;
}
function branchButton(h: HTMLDivElement): HTMLButtonElement | null {
  return h.querySelector(".branch-btn");
}
function hashButton(h: HTMLDivElement): HTMLButtonElement | null {
  return h.querySelector(".hash-btn");
}

async function settle() {
  flushSync();
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
}

/** Stub the (jsdom-absent) async Clipboard API for one test. */
function stubClipboard(outcome: "resolve" | "reject" = "resolve") {
  const writeText = vi.fn(() =>
    outcome === "resolve"
      ? Promise.resolve()
      : Promise.reject(new Error("clipboard denied")),
  );
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

describe("CommitDetails inline reword", () => {
  it("shows no edit affordance when onReword is absent", () => {
    const h = render();
    expect(editButton(h)).toBeNull();
    expect(subjectButton(h)).toBeNull();
    expect(textarea(h)).toBeNull();
    // Plain, unclickable subject text — same as before this feature existed.
    expect(h.querySelector(".subject")?.textContent?.trim()).toBe("subject");
  });

  it("enters edit mode with the textarea prefilled from subject + body", () => {
    const onReword = vi.fn(() => Promise.resolve());
    const h = render({ onReword });

    editButton(h)!.click();
    flushSync();

    const ta = textarea(h);
    expect(ta).not.toBeNull();
    expect(ta!.value).toBe("subject\n\nbody");
  });

  it("also enters edit mode by clicking the subject text", () => {
    const onReword = vi.fn(() => Promise.resolve());
    const h = render({ onReword });

    subjectButton(h)!.click();
    flushSync();

    expect(textarea(h)).not.toBeNull();
  });

  it("saves the edited text via onReword and exits edit mode", async () => {
    const onReword = vi.fn(() => Promise.resolve());
    const h = render({ onReword });

    editButton(h)!.click();
    flushSync();
    const ta = textarea(h)!;
    ta.value = "new subject\n\nnew body";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();

    saveButton(h).click();
    await settle();

    expect(onReword).toHaveBeenCalledWith("new subject\n\nnew body");
    expect(textarea(h)).toBeNull();
    expect(editButton(h)).not.toBeNull();
  });

  it("cancels on Escape without calling onReword", () => {
    const onReword = vi.fn(() => Promise.resolve());
    const h = render({ onReword });

    editButton(h)!.click();
    flushSync();
    const ta = textarea(h)!;
    ta.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    flushSync();

    expect(onReword).not.toHaveBeenCalled();
    expect(textarea(h)).toBeNull();
    expect(editButton(h)).not.toBeNull();
  });

  it("shows an inline error and stays in edit mode when onReword rejects", async () => {
    const onReword = vi.fn(() => Promise.reject(new Error("boom")));
    const h = render({ onReword });

    editButton(h)!.click();
    flushSync();
    saveButton(h).click();
    await settle();

    expect(onReword).toHaveBeenCalledOnce();
    expect(textarea(h)).not.toBeNull(); // still editing
    const err = h.querySelector(".edit-body .msg.err");
    expect(err?.textContent).toContain("boom");
  });
});

describe("CommitDetails footer click-to-copy", () => {
  it("copies the FULL sha (not the short one) when the hash is clicked", async () => {
    const writeText = stubClipboard();
    const h = render({ branch: "main" });

    hashButton(h)!.click();
    await settle();
    await settle();

    expect(writeText).toHaveBeenCalledWith(commit.sha);
    expect(writeText).not.toHaveBeenCalledWith(commit.short_sha);
  });

  it("copies the branch name when the branch is clicked", async () => {
    const writeText = stubClipboard();
    const h = render({ branch: "feature/copy-commit-meta" });

    branchButton(h)!.click();
    await settle();
    await settle();

    expect(writeText).toHaveBeenCalledWith("feature/copy-commit-meta");
  });

  it("does not render a branch button (or make the — placeholder clickable) when there is no branch", () => {
    const h = render({ branch: null });

    expect(branchButton(h)).toBeNull();
    expect(h.querySelector(".branch")?.textContent).toContain("—");
    // No focusable/interactive element hiding inside the placeholder.
    expect(h.querySelector(".branch button")).toBeNull();
  });

  it("shows a transient 'copied' confirmation after a successful hash copy", async () => {
    stubClipboard();
    const h = render({ branch: "main" });

    hashButton(h)!.click();
    await settle();
    await settle();

    expect(hashButton(h)!.textContent).toContain("Copied");
  });

  it("does not show 'copied' when the clipboard write rejects", async () => {
    stubClipboard("reject");
    const h = render({ branch: "main" });

    hashButton(h)!.click();
    await settle();
    await settle();

    expect(hashButton(h)!.textContent).not.toContain("Copied");
    expect(hashButton(h)!.textContent).toContain(commit.short_sha);
  });

  it("does not show 'copied' on the branch button when its clipboard write rejects", async () => {
    stubClipboard("reject");
    const h = render({ branch: "main" });

    branchButton(h)!.click();
    await settle();
    await settle();

    expect(branchButton(h)!.textContent).not.toContain("Copied");
    expect(branchButton(h)!.textContent).toContain("main");
  });
});

describe("CommitDetails — file-row icon actions (commit-file-actions)", () => {
  const files: FileChange[] = [
    {
      path: "src/app.ts",
      status: "modified",
      old_path: null,
      insertions: 3,
      deletions: 1,
    },
  ];

  function diffButton(h: HTMLDivElement) {
    return h.querySelector<HTMLButtonElement>("button.act.diff");
  }
  function openFileButton(h: HTMLDivElement) {
    return h.querySelector<HTMLButtonElement>("button.act.openfile");
  }
  function purgeButton(h: HTMLDivElement) {
    return h.querySelector<HTMLButtonElement>("button.act.purge");
  }
  function confirmDialog(h: HTMLDivElement) {
    return h.querySelector('[role="dialog"]');
  }

  it("renders a keyboard-reachable diff icon and calls onOpenDiff with the path", () => {
    const onOpenDiff = vi.fn();
    const h = render({ files, onOpenDiff });
    const btn = diffButton(h);
    expect(btn).not.toBeNull();
    expect(btn!.tagName).toBe("BUTTON");
    expect(btn!.getAttribute("aria-label")).toBeTruthy();
    btn!.click();
    expect(onOpenDiff).toHaveBeenCalledWith("src/app.ts");
  });

  it("clicking the file name still opens the diff (unchanged behaviour)", () => {
    const onOpenDiff = vi.fn();
    const h = render({ files, onOpenDiff });
    h.querySelector<HTMLButtonElement>("button.file.clickable")!.click();
    expect(onOpenDiff).toHaveBeenCalledWith("src/app.ts");
  });

  it("renders a keyboard-reachable open icon that calls openPath with the repo-relative path, and does not open the diff", async () => {
    const onOpenDiff = vi.fn();
    const h = render({ files, onOpenDiff, repoPath: "/repo" });
    const btn = openFileButton(h);
    expect(btn).not.toBeNull();
    expect(btn!.tagName).toBe("BUTTON");
    expect(btn!.getAttribute("aria-label")).toBeTruthy();

    btn!.click();
    await settle();

    expect(openPath).toHaveBeenCalledWith("/repo", "src/app.ts");
    expect(onOpenDiff).not.toHaveBeenCalled();
  });

  it("omits the open icon when there is no repoPath", () => {
    const h = render({ files, onOpenDiff: () => {} });
    expect(openFileButton(h)).toBeNull();
  });

  it("omits the purge icon when onPurgeFile is not wired", () => {
    const h = render({ files, repoPath: "/repo" });
    expect(purgeButton(h)).toBeNull();
  });

  it("purge is keyboard-reachable, routes through confirmation, and the ipc-backed callback fires only after confirming (with the commit sha + path)", async () => {
    const onPurgeFile = vi.fn<(sha: string, path: string) => Promise<void>>(
      () => Promise.resolve(),
    );
    const h = render({ files, repoPath: "/repo", onPurgeFile });

    const btn = purgeButton(h);
    expect(btn).not.toBeNull();
    expect(btn!.tagName).toBe("BUTTON");
    expect(btn!.getAttribute("aria-label")).toBeTruthy();

    btn!.click();
    flushSync();

    // The confirm dialog is now up — the callback must not have fired yet.
    expect(confirmDialog(h)).not.toBeNull();
    expect(onPurgeFile).not.toHaveBeenCalled();

    const confirmBtn = h.querySelector<HTMLButtonElement>(".primary");
    expect(confirmBtn).not.toBeNull();
    confirmBtn!.click();
    await settle();

    expect(onPurgeFile).toHaveBeenCalledWith(commit.sha, "src/app.ts");
    // Dialog closes once the confirmed purge resolves.
    expect(confirmDialog(h)).toBeNull();
  });

  it("cancelling the purge confirmation never calls onPurgeFile", () => {
    const onPurgeFile = vi.fn(() => Promise.resolve());
    const h = render({ files, repoPath: "/repo", onPurgeFile });

    purgeButton(h)!.click();
    flushSync();
    expect(confirmDialog(h)).not.toBeNull();

    const cancelBtn = h.querySelector<HTMLButtonElement>(".ghost");
    expect(cancelBtn).not.toBeNull();
    cancelBtn!.click();
    flushSync();

    expect(onPurgeFile).not.toHaveBeenCalled();
    expect(confirmDialog(h)).toBeNull();
  });

  it("shows the file name and warns about descendant commits in the purge confirmation body", () => {
    const h = render({
      files,
      repoPath: "/repo",
      onPurgeFile: () => Promise.resolve(),
    });

    purgeButton(h)!.click();
    flushSync();

    const body = confirmDialog(h)!.textContent ?? "";
    expect(body).toContain("src/app.ts");
    expect(body).toMatch(/every commit after it/i);
  });
});

describe("CommitDetails integration nag", () => {
  // A token client with no MR tokens — the "add a token" hint's trigger.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const noTokens = { list: () => Promise.resolve([]) } as any;

  it("nags to add a GitHub/GitLab token when git isn't configured", async () => {
    const h = render({ tokenClient: noTokens });
    await settle();
    expect(h.querySelector(".actions .hint")).not.toBeNull();
  });

  it("suppresses the nag once the repo has an HTTPS remote (git configured)", async () => {
    const h = render({ tokenClient: noTokens, gitConfigured: true });
    await settle();
    expect(h.querySelector(".actions .hint")).toBeNull();
  });
});

describe("CommitDetails — linked-issue action row (details-issue-link)", () => {
  // A token client with no MR tokens — used to prove the linked-issue link
  // does NOT depend on a GitHub/GitLab token (it only selects an already-
  // known issue locally; nothing here calls a provider API).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const noTokens = { list: () => Promise.resolve([]) } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oneGithubToken = {
    list: () =>
      Promise.resolve([
        {
          id: "tok-1",
          name: "gh",
          provider: "github",
          scopes: [],
          webhookUrl: "",
          createdAtMs: 0,
          lastUsedAtMs: null,
        },
      ]),
  } as any;

  const linkedIssue = {
    title: "Fix the thing",
    issueNumber: 42,
    provider: "github",
  };

  function issueLinkRow(h: HTMLDivElement) {
    return h.querySelector<HTMLButtonElement>(".action-row.issue-link");
  }
  function issueCreateRow(h: HTMLDivElement) {
    return h.querySelector<HTMLButtonElement>(".action-row.issue-create");
  }

  it("renders the linked issue as a link and calls onOpenIssue when clicked", async () => {
    const onOpenIssue = vi.fn();
    const h = render({
      tokenClient: oneGithubToken,
      linkedIssue,
      onOpenIssue,
    });
    await settle();

    const row = issueLinkRow(h);
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain("42");
    expect(row!.textContent).toContain("Fix the thing");

    row!.click();
    expect(onOpenIssue).toHaveBeenCalledOnce();
  });

  it("renders the linked issue link even with no MR tokens configured (gating: navigating to a known issue needs no token)", async () => {
    const onOpenIssue = vi.fn();
    const h = render({
      tokenClient: noTokens,
      linkedIssue,
      onOpenIssue,
    });
    await settle();

    const row = issueLinkRow(h);
    expect(row).not.toBeNull();
    row!.click();
    expect(onOpenIssue).toHaveBeenCalledOnce();
    // And the create-issue row must NOT also render alongside it.
    expect(issueCreateRow(h)).toBeNull();
  });

  it("unlinked + tokens configured: shows 'Create Issue' and opens the compose flow", async () => {
    const h = render({ tokenClient: oneGithubToken, linkedIssue: null });
    await settle();

    expect(issueLinkRow(h)).toBeNull();
    const row = issueCreateRow(h);
    expect(row).not.toBeNull();

    row!.click();
    await settle();

    expect(h.querySelector(".compose-head")?.textContent).toContain(
      "New issue",
    );
  });

  it("unlinked + no tokens: shows neither the issue link nor a create-issue row", async () => {
    const h = render({ tokenClient: noTokens, linkedIssue: null });
    await settle();

    expect(issueLinkRow(h)).toBeNull();
    expect(issueCreateRow(h)).toBeNull();
  });

  it("never renders a second, duplicate issue affordance in the footer", async () => {
    const h = render({
      tokenClient: oneGithubToken,
      linkedIssue,
      onOpenIssue: () => {},
    });
    await settle();

    // The old footer chip class is gone entirely — the linked issue now
    // appears exactly once, in .actions.
    expect(h.querySelector(".issue-chip")).toBeNull();
    expect(h.querySelectorAll(".action-row.issue-link")).toHaveLength(1);
  });
});

describe("CommitDetails reserves the floating-toolbar band", () => {
  // jsdom's getComputedStyle does not resolve Svelte's injected scoped
  // stylesheet in this test environment (see MetroGraph.theme.test.ts), so
  // this is a source-text assertion (same idiom as StatusBar.test.ts) that
  // `.panel` reserves `var(--float-btn-band)` at its top, rather than a
  // computed-style assertion that would be meaningless here.
  it("`.panel`'s padding-top reserves var(--float-btn-band)", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "CommitDetails.svelte"),
      "utf-8",
    );
    const styleMatch = src.match(/<style>([\s\S]*)<\/style>/);
    expect(styleMatch).not.toBeNull();
    const panelRuleMatch = styleMatch![1].match(/\.panel\s*{([^}]*)}/);
    expect(panelRuleMatch).not.toBeNull();
    expect(panelRuleMatch![1]).toMatch(
      /padding-top:\s*var\(--float-btn-band\)\s*;/,
    );
  });
});
