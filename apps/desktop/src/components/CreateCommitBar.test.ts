import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync, type ComponentProps } from "svelte";
import CreateCommitBar from "./CreateCommitBar.svelte";
import type { IdentityStatus } from "../lib/ipc";
import { t, setLocale } from "../lib/i18n/index.svelte";

const { createCommitMock, gitIdentityStatusMock } = vi.hoisted(() => ({
  createCommitMock: vi.fn(async () => "c".repeat(40)),
  // The common case: git has its own `user.email`, so the account fallback
  // never enters the picture and the bar shows no identity notice.
  // Typed explicitly: inference from this default would narrow `source` to
  // "git" and forbid the fallback cases the tests below actually exercise.
  gitIdentityStatusMock: vi.fn<(repoPath: string) => Promise<IdentityStatus>>(
    async () => ({
      source: "git",
      name: "Ada Lovelace",
      email: "ada@employer.example",
    }),
  ),
}));

vi.mock("../lib/ipc", () => ({
  createCommit: createCommitMock,
  gitIdentityStatus: gitIdentityStatusMock,
  errorText: (e: unknown) => String(e),
}));

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
  createCommitMock.mockClear();
  gitIdentityStatusMock.mockClear();
});

function render(props: ComponentProps<typeof CreateCommitBar>): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(CreateCommitBar, { target: host, props });
  flushSync();
  return host;
}

describe("CreateCommitBar", () => {
  it("disables commit when nothing is staged", () => {
    const h = render({ repoPath: "/r", stagedCount: 0, onCommitted: () => {} });
    const btn = h.querySelector("button")!;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain("Nothing staged");
  });

  it("disables commit with staged changes but an empty message", () => {
    const h = render({ repoPath: "/r", stagedCount: 2, onCommitted: () => {} });
    expect(h.querySelector("button")!.disabled).toBe(true);
  });

  it("commits the staged index and reports the new sha", async () => {
    const onCommitted = vi.fn();
    const h = render({ repoPath: "/r", stagedCount: 2, onCommitted });

    const textarea = h.querySelector("textarea")!;
    textarea.value = "feat: x";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();

    const btn = h.querySelector("button")!;
    expect(btn.disabled).toBe(false);
    btn.click();

    // Wait for the full async chain (createCommit → onCommitted) to settle.
    await vi.waitFor(() => expect(onCommitted).toHaveBeenCalled());
    expect(createCommitMock).toHaveBeenCalledWith("/r", "feat: x");
    expect(onCommitted).toHaveBeenCalledWith("c".repeat(40));
  });
});

// ── Localized button label ────────────────────────────────────────────────────
//
// All three states of the button were hard-coded English until they went
// through the catalog. The middle one carries the staged count, so it is the
// one that can silently break: an interpolation mistake leaves the literal
// "{count}" on screen, which no "is it translated?" check would notice.

describe("CreateCommitBar — button label is localized", () => {
  afterEach(() => setLocale("en"));

  it("interpolates the staged count, for any count", () => {
    for (const n of [1, 2, 7, 42]) {
      const h = render({ repoPath: "/r", stagedCount: n, onCommitted() {} });
      expect(h.querySelector("button")!.textContent).toContain(
        `Commit ${n} staged`,
      );
      unmount(app);
      h.remove();
      app = undefined;
    }
  });

  it("leaves no literal placeholder behind", () => {
    const h = render({ repoPath: "/r", stagedCount: 3, onCommitted() {} });
    expect(h.querySelector("button")!.textContent).not.toContain("{count}");
  });

  it("translates all three states — no English leaks into zh-Hant", () => {
    setLocale("zh-Hant");

    const empty = render({ repoPath: "/r", stagedCount: 0, onCommitted() {} });
    expect(empty.querySelector("button")!.textContent).toContain(
      t("commit.nothingStaged"),
    );
    expect(empty.querySelector("button")!.textContent).not.toContain(
      "Nothing staged",
    );
    unmount(app);
    empty.remove();
    app = undefined;

    const staged = render({ repoPath: "/r", stagedCount: 5, onCommitted() {} });
    const label = staged.querySelector("button")!.textContent ?? "";
    expect(label).toContain("5");
    expect(label).not.toContain("Commit 5 staged");
    expect(label).toBe(t("commit.commitStaged", { count: 5 }));
  });
});

// ── Commit identity notice ────────────────────────────────────────────
//
// The account email is a *default*, never an override. When it stands in for a
// missing `user.email` the user has to be told **before** committing — the
// author of a commit is permanent and mirrored everywhere, so a silent
// substitution is not a recoverable surprise.

const notice = (h: HTMLElement) =>
  h.querySelector('[data-testid="account-identity-notice"]');

describe("CreateCommitBar — commit identity", () => {
  it("says nothing when git has its own user.email", async () => {
    const h = render({ repoPath: "/r", stagedCount: 1, onCommitted: () => {} });
    await vi.waitFor(() => expect(gitIdentityStatusMock).toHaveBeenCalled());
    flushSync();
    expect(notice(h)).toBeNull();
  });

  it("names the account address it is about to author as", async () => {
    gitIdentityStatusMock.mockResolvedValueOnce({
      source: "account",
      name: "newcomer",
      email: "newcomer@adgitter.app",
    });
    const h = render({ repoPath: "/r", stagedCount: 1, onCommitted: () => {} });

    await vi.waitFor(() => expect(notice(h)).not.toBeNull());
    const text = notice(h)!.textContent ?? "";
    // The address itself must be visible — "we picked something for you" is
    // not disclosure.
    expect(text).toContain("newcomer@adgitter.app");
    // …and so must the way out of it.
    expect(text).toContain("user.email");
  });

  it("asks per repo, because user.email is per repo", async () => {
    render({ repoPath: "/one", stagedCount: 1, onCommitted: () => {} });
    await vi.waitFor(() =>
      expect(gitIdentityStatusMock).toHaveBeenCalledWith("/one"),
    );
  });

  it("shows nothing when neither identity exists — the commit's own error says it", async () => {
    gitIdentityStatusMock.mockResolvedValueOnce({
      source: "none",
      name: null,
      email: null,
    });
    const h = render({ repoPath: "/r", stagedCount: 1, onCommitted: () => {} });
    await vi.waitFor(() => expect(gitIdentityStatusMock).toHaveBeenCalled());
    flushSync();
    expect(notice(h)).toBeNull();
  });

  it("stays committable when the identity probe fails", async () => {
    gitIdentityStatusMock.mockRejectedValueOnce(new Error("boom"));
    const h = render({ repoPath: "/r", stagedCount: 2, onCommitted: () => {} });
    const textarea = h.querySelector("textarea")!;
    textarea.value = "feat: x";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    await vi.waitFor(() => expect(gitIdentityStatusMock).toHaveBeenCalled());
    flushSync();
    expect(notice(h)).toBeNull();
    expect(h.querySelector("button")!.disabled).toBe(false);
  });
});
