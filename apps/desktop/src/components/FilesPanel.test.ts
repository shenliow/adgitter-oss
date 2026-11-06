import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import FilesPanel from "./FilesPanel.svelte";
import fs from "node:fs";
import path from "node:path";

const repoStatus = vi.fn<(r: string) => Promise<unknown>>();
const stagePaths = vi.fn<(r: string, p: string[]) => Promise<void>>(() =>
  Promise.resolve(),
);
const unstagePaths = vi.fn<(r: string, p: string[]) => Promise<void>>(() =>
  Promise.resolve(),
);
const discardPaths = vi.fn<(r: string, p: string[]) => Promise<void>>(() =>
  Promise.resolve(),
);
const createCommit = vi.fn<(r: string, m: string) => Promise<string>>(() =>
  Promise.resolve("newsha"),
);
const openPath = vi.fn<(r: string, p: string) => Promise<void>>(() =>
  Promise.resolve(),
);

vi.mock("../lib/ipc", () => ({
  repoStatus: (r: string) => repoStatus(r),
  stagePaths: (r: string, p: string[]) => stagePaths(r, p),
  unstagePaths: (r: string, p: string[]) => unstagePaths(r, p),
  discardPaths: (r: string, p: string[]) => discardPaths(r, p),
  createCommit: (r: string, m: string) => createCommit(r, m),
  gitIdentityStatus: async () => ({
    source: "git" as const,
    name: "Tester",
    email: "t@example.com",
  }),
  openPath: (r: string, p: string) => openPath(r, p),
  errorText: (e: unknown) => String(e),
}));

// Nested working-tree status: "changed" has a two-level tree (src/ >
// nested/ > b.ts, plus src/a.ts directly), "untracked" has one nested file,
// "ignored" has one nested file. "staged" and "conflicted" are empty so
// their sections are hidden, keeping section ordering unambiguous:
// [changed, untracked, ignored].
const status = {
  staged: [],
  changed: [
    { path: "src/a.ts", status: "modified", old_path: null },
    { path: "src/nested/b.ts", status: "modified", old_path: null },
  ],
  untracked: [{ path: "src/new.ts", status: "new", old_path: null }],
  ignored: [{ path: "dist/out.js", status: "ignored", old_path: null }],
  conflicted: [],
};

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

beforeEach(() => {
  repoStatus.mockReset().mockResolvedValue(status);
  stagePaths.mockClear();
  unstagePaths.mockClear();
  discardPaths.mockClear();
  createCommit.mockClear();
  openPath.mockClear().mockResolvedValue(undefined);
});
afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
});

async function settle() {
  flushSync();
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
}

function render(props: Record<string, unknown> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(FilesPanel, {
    target: host,
    props: { repoPath: "/r", ...props },
  });
  return host;
}

function sections() {
  return [...host.querySelectorAll<HTMLElement>("section")];
}
function headerToggle(section: HTMLElement) {
  return section.querySelector<HTMLButtonElement>("h3 .hdr-toggle")!;
}
function dirButtons(section: HTMLElement) {
  return [...section.querySelectorAll<HTMLButtonElement>("button.dir")];
}
function fnames(section: HTMLElement) {
  return [...section.querySelectorAll<HTMLElement>(".fname")];
}

describe("FilesPanel tree view", () => {
  it("renders nested paths as directory rows and file leaves (name only)", async () => {
    render();
    await settle();

    const changed = sections()[0];
    const dirs = dirButtons(changed);
    expect(dirs.map((d) => d.textContent?.trim())).toEqual([
      expect.stringContaining("src"),
      expect.stringContaining("nested"),
    ]);

    const names = fnames(changed).map((f) => f.textContent?.trim());
    expect(names).toEqual(["b.ts", "a.ts"]);
    // Leaves show the name only — the full path lives in `title`.
    const aRow = fnames(changed).find((f) => f.textContent?.trim() === "a.ts")!;
    expect(aRow.title).toBe("src/a.ts");
  });

  it("collapses and re-expands a directory's children on chevron click", async () => {
    render();
    await settle();

    let changed = sections()[0];
    expect(dirButtons(changed)).toHaveLength(2); // src, nested
    expect(fnames(changed)).toHaveLength(2); // a.ts, b.ts

    const srcBtn = dirButtons(changed)[0];
    expect(srcBtn.getAttribute("aria-expanded")).toBe("true");
    srcBtn.click();
    flushSync();

    changed = sections()[0];
    expect(dirButtons(changed)[0].getAttribute("aria-expanded")).toBe("false");
    expect(dirButtons(changed)).toHaveLength(1); // "nested" hidden along with its file
    expect(fnames(changed)).toHaveLength(0); // a.ts and b.ts both hidden

    dirButtons(changed)[0].click(); // re-expand "src"
    flushSync();

    changed = sections()[0];
    expect(dirButtons(changed)).toHaveLength(2);
    expect(fnames(changed)).toHaveLength(2);
  });

  it("collapses the whole group when its header is toggled", async () => {
    render();
    await settle();

    let changed = sections()[0];
    expect(headerToggle(changed).getAttribute("aria-expanded")).toBe("true");
    expect(fnames(changed).length).toBeGreaterThan(0);

    headerToggle(changed).click();
    flushSync();

    changed = sections()[0];
    expect(headerToggle(changed).getAttribute("aria-expanded")).toBe("false");
    expect(dirButtons(changed)).toHaveLength(0);
    expect(fnames(changed)).toHaveLength(0);

    headerToggle(changed).click(); // toggle back open
    flushSync();
    changed = sections()[0];
    expect(fnames(changed).length).toBeGreaterThan(0);
  });

  it("starts the ignored group collapsed", async () => {
    render();
    await settle();

    const ignored = sections()[2];
    expect(headerToggle(ignored).getAttribute("aria-expanded")).toBe("false");
    expect(fnames(ignored)).toHaveLength(0);

    headerToggle(ignored).click();
    flushSync();
    const ignoredAfter = sections()[2];
    expect(fnames(ignoredAfter).map((f) => f.textContent?.trim())).toEqual([
      "out.js",
    ]);
  });

  it("stages a leaf with its full path", async () => {
    render();
    await settle();

    const untracked = sections()[1];
    // Target the stage glyph explicitly: the row's action strip holds several
    // buttons, so "the first one" is not a stable way to name it.
    const stageBtn = untracked.querySelector<HTMLButtonElement>(
      '.acts button[title="Stage"]',
    )!;
    stageBtn.click();
    await settle();

    expect(stagePaths).toHaveBeenCalledWith("/r", ["src/new.ts"]);
  });

  it("opens the diff for a leaf's full path on name click", async () => {
    const onOpenDiff = vi.fn();
    render({ onOpenDiff });
    await settle();

    const changed = sections()[0];
    const aBtn = changed.querySelector<HTMLButtonElement>("button.fname.link")!;
    // First fname.link in DOM order is "b.ts" (dirs-before-files puts
    // "nested" before "a.ts", and "nested" resolves to b.ts first).
    expect(aBtn.textContent?.trim()).toBe("b.ts");
    aBtn.click();
    await settle();
    expect(onOpenDiff).toHaveBeenCalledWith("src/nested/b.ts");
  });
});

describe("open in default editor", () => {
  /** The open-file glyph in a row's hover actions. */
  function openButtons(section: HTMLElement) {
    return [
      ...section.querySelectorAll<HTMLButtonElement>(
        '.acts button[aria-label="Open in default editor"]',
      ),
    ];
  }

  it("opens the clicked file with its repo-relative path", async () => {
    render();
    await settle();
    const changed = sections()[0];

    // Dirs sort before files, so the first leaf in DOM order is src/nested/b.ts
    // — the deepest one, which proves the full repo-relative path (not just the
    // leaf name) is what reaches the backend.
    openButtons(changed)[0].click();
    await settle();

    expect(openPath).toHaveBeenCalledWith("/r", "src/nested/b.ts");
  });

  it("does not open the diff when the icon is clicked", async () => {
    const onOpenDiff = vi.fn();
    render({ onOpenDiff });
    await settle();

    openButtons(sections()[0])[0].click();
    await settle();

    expect(openPath).toHaveBeenCalledOnce();
    expect(onOpenDiff).not.toHaveBeenCalled();
  });

  it("surfaces a failed open instead of swallowing it", async () => {
    openPath.mockRejectedValueOnce(new Error("file not found: src/a.ts"));
    render();
    await settle();

    openButtons(sections()[0])[0].click();
    await settle();

    expect(host.querySelector(".msg.err")?.textContent).toContain(
      "file not found",
    );
  });

  it("offers no open icon for a deleted file (nothing left on disk)", async () => {
    repoStatus.mockResolvedValue({
      ...status,
      changed: [{ path: "src/gone.ts", status: "deleted", old_path: null }],
    });
    render();
    await settle();

    expect(openButtons(sections()[0])).toHaveLength(0);
  });
});

describe("conflicted section (resolve mode)", () => {
  const conflictedStatus = {
    ...status,
    conflicted: [
      { path: "src/clash.ts", status: "conflicted", old_path: null },
    ],
  };

  it("renders FIRST with a warning-accented header, expanded, stage + open but no unstage/discard", async () => {
    repoStatus.mockResolvedValue(conflictedStatus);
    render();
    await settle();

    const first = sections()[0];
    expect(first.textContent).toContain("Conflicted");
    expect(first.querySelector("h3")?.classList.contains("warn")).toBe(true);
    // Never collapsed by default — its rows gate the resolve banner's
    // Continue, so they must be visible immediately.
    expect(headerToggle(first).getAttribute("aria-expanded")).toBe("true");
    expect(fnames(first).map((f) => f.textContent?.trim())).toEqual([
      "clash.ts",
    ]);
    expect(first.querySelector('.acts button[title="Stage"]')).not.toBeNull();
    expect(
      first.querySelector('.acts button[aria-label="Open in default editor"]'),
    ).not.toBeNull();
    expect(first.querySelector('.acts button[title="Unstage"]')).toBeNull();
    expect(
      first.querySelector('.acts button[title="Discard changes"]'),
    ).toBeNull();
  });

  it("stages a conflicted leaf with its full path and reports the fresh status via onStatus", async () => {
    const onStatus = vi.fn();
    repoStatus.mockResolvedValue(conflictedStatus);
    render({ onStatus });
    await settle();
    expect(onStatus).toHaveBeenLastCalledWith(conflictedStatus);

    // The reload after staging reports the conflict gone (staged instead).
    const after = {
      ...status,
      staged: [{ path: "src/clash.ts", status: "modified", old_path: null }],
    };
    repoStatus.mockResolvedValue(after);
    sections()[0]
      .querySelector<HTMLButtonElement>('.acts button[title="Stage"]')!
      .click();
    // Stage → reload → onStatus is one async hop deeper than a bare stage
    // click, so give the act()→load() chain a second settle to resolve.
    await settle();
    await settle();

    expect(stagePaths).toHaveBeenCalledWith("/r", ["src/clash.ts"]);
    expect(onStatus).toHaveBeenLastCalledWith(after);
  });
});

describe("FilesPanel reserves the floating-toolbar band", () => {
  // jsdom's getComputedStyle does not resolve Svelte's injected scoped
  // stylesheet in this test environment (see MetroGraph.theme.test.ts), so
  // this is a source-text assertion (same idiom as StatusBar.test.ts) that
  // `.panel` reserves `var(--float-btn-band)` at its top, rather than a
  // computed-style assertion that would be meaningless here.
  it("`.panel`'s padding-top reserves var(--float-btn-band)", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "FilesPanel.svelte"),
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
