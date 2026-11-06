import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import BranchesPanel from "./BranchesPanel.svelte";
import { t } from "../lib/i18n/index.svelte";
import type { RefList } from "../lib/ipc";
import fs from "node:fs";
import path from "node:path";

const checkout = vi.fn<(r: string, n: string) => Promise<void>>(() =>
  Promise.resolve(),
);
const createBranch = vi.fn<(r: string, n: string, f: string) => Promise<void>>(
  () => Promise.resolve(),
);
const renameBranch = vi.fn<
  (r: string, from: string, to: string) => Promise<void>
>(() => Promise.resolve());
const deleteBranch = vi.fn<(r: string, n: string) => Promise<void>>(() =>
  Promise.resolve(),
);
const createTag = vi.fn<
  (r: string, n: string, target: string) => Promise<void>
>(() => Promise.resolve());
const deleteTag = vi.fn<(r: string, n: string) => Promise<void>>(() =>
  Promise.resolve(),
);

vi.mock("../lib/ipc", () => ({
  checkout: (r: string, n: string) => checkout(r, n),
  createBranch: (r: string, n: string, f: string) => createBranch(r, n, f),
  renameBranch: (r: string, from: string, to: string) =>
    renameBranch(r, from, to),
  deleteBranch: (r: string, n: string) => deleteBranch(r, n),
  createTag: (r: string, n: string, target: string) => createTag(r, n, target),
  deleteTag: (r: string, n: string) => deleteTag(r, n),
  errorText: (e: unknown) =>
    e && typeof e === "object" && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e),
}));

// main (current, has an upstream) · feature-x (no upstream) · an issue-linked
// branch · a remote and a tag (never eligible for row actions/cloud icon).
const refs: RefList = {
  head: { branch: "main", target: "c3", detached: false },
  branches: [
    { name: "main", kind: "branch", target: "c3", has_upstream: true },
    {
      name: "feature-x",
      kind: "branch",
      target: "c2",
      has_upstream: false,
    },
    {
      name: "feat/login-form-#142",
      kind: "branch",
      target: "c1",
      has_upstream: true,
    },
  ],
  remotes: [{ name: "origin/main", kind: "remote", target: "c3" }],
  tags: [{ name: "v1", kind: "tag", target: "c3" }],
};

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

beforeEach(() => {
  checkout.mockClear().mockResolvedValue(undefined);
  createBranch.mockClear().mockResolvedValue(undefined);
  renameBranch.mockClear().mockResolvedValue(undefined);
  deleteBranch.mockClear().mockResolvedValue(undefined);
  createTag.mockClear().mockResolvedValue(undefined);
  deleteTag.mockClear().mockResolvedValue(undefined);
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
  app = mount(BranchesPanel, {
    target: host,
    props: { refs, repoPath: "/r", ...props },
  });
  flushSync();
  return host;
}

/** What the issue tracker would say: only the `-#142` branch is linked. */
const linkedIssue = (branch: string) =>
  branch === "feat/login-form-#142" ? 142 : null;

/** The row div for a local branch, found via its checkout button's text. */
function branchRow(name: string): HTMLElement {
  const btn = [...host.querySelectorAll<HTMLButtonElement>(".name-btn")].find(
    (b) => b.textContent?.trim().startsWith(name),
  );
  if (!btn) throw new Error(`no row for branch "${name}"`);
  return btn.closest(".row") as HTMLElement;
}

function actionButton(row: HTMLElement, title: string): HTMLButtonElement {
  const btn = [...row.querySelectorAll<HTMLButtonElement>(".acts button")].find(
    (b) => b.title === title,
  );
  if (!btn) throw new Error(`no action button titled "${title}"`);
  return btn;
}

function findActionButton(
  row: HTMLElement,
  title: string,
): HTMLButtonElement | undefined {
  return [...row.querySelectorAll<HTMLButtonElement>(".acts button")].find(
    (b) => b.title === title,
  );
}

function dialogButton(label: string): HTMLButtonElement {
  const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
  const btn = [...dialog.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!btn) throw new Error(`no dialog button labeled "${label}"`);
  return btn;
}

function typeAndKey(input: HTMLInputElement, value: string, key: string) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
  input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

describe("BranchesPanel row actions", () => {
  it("renders the delete/add-tag/edit/fork icons as real, focusable buttons", () => {
    render();
    const row = branchRow("feature-x");
    for (const title of [
      "Delete",
      t("branchesPanel.addTag"),
      t("branchesPanel.edit"),
      t("branchesPanel.fork"),
    ]) {
      const btn = actionButton(row, title);
      expect(btn.tagName).toBe("BUTTON");
      expect(btn.tabIndex).not.toBe(-1);
    }
  });

  it("renders icons in order: delete, add-tag, edit, fork, go-to-issue", () => {
    render({ linkedIssue });
    const row = branchRow("feat/login-form-#142");
    const titles = [
      ...row.querySelectorAll<HTMLButtonElement>(".acts button"),
    ].map((b) => b.title);
    expect(titles).toEqual([
      "Delete",
      t("branchesPanel.addTag"),
      t("branchesPanel.edit"),
      t("branchesPanel.fork"),
      t("branchesPanel.goToIssue"),
    ]);
  });

  it("disables Delete for the current branch, and it deletes a non-current one", async () => {
    render();
    expect(
      actionButton(branchRow("main"), "Cannot delete the current branch")
        .disabled,
    ).toBe(true);

    actionButton(branchRow("feature-x"), "Delete").click();
    await settle();
    expect(deleteBranch).toHaveBeenCalledWith("/r", "feature-x");
  });

  it("surfaces a backend failure through the panel's error banner", async () => {
    deleteBranch.mockRejectedValueOnce({ code: "GIT_ERROR", message: "boom" });
    render();
    actionButton(branchRow("feature-x"), "Delete").click();
    await settle();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("boom");
  });

  // --- cloud-offline (no-upstream) indicator --------------------------------

  it("shows the cloud-off indicator only for a local branch with no upstream", () => {
    render();
    expect(branchRow("main").querySelector(".cloud-off")).toBeNull();
    const icon = branchRow("feature-x").querySelector(".cloud-off");
    expect(icon).toBeTruthy();
    expect(icon?.getAttribute("title")).toBe(t("branchesPanel.noUpstream"));
    expect(icon?.getAttribute("aria-label")).toBe(
      t("branchesPanel.noUpstream"),
    );
    // The icon suffixes the branch name — inside the name button, after the
    // name text — rather than floating elsewhere in the row.
    const nameBtn = branchRow("feature-x").querySelector(".name-btn");
    expect(icon?.parentElement).toBe(nameBtn);
    expect(nameBtn?.textContent).toContain("feature-x");
    expect(nameBtn?.lastElementChild).toBe(icon); // the cloud-off icon suffixes it
  });

  it("never shows the cloud-off indicator on remotes or tags", () => {
    render();
    // Only feature-x lacks an upstream; remotes/tags never render the icon.
    expect(host.querySelectorAll(".cloud-off").length).toBe(1);
  });

  // --- Add tag here -----------------------------------------------------------

  it("Add tag here: the inline input creates a tag at that branch's tip", async () => {
    render();
    actionButton(branchRow("feature-x"), t("branchesPanel.addTag")).click();
    await settle();
    const row = branchRow("feature-x");
    const input =
      row.nextElementSibling?.querySelector<HTMLInputElement>("input");
    expect(input).toBeTruthy();
    typeAndKey(input!, "v2", "Enter");
    await settle();
    expect(createTag).toHaveBeenCalledWith("/r", "v2", "c2");
    // Closes after a successful create.
    expect(
      branchRow("feature-x").nextElementSibling?.querySelector("input"),
    ).toBeFalsy();
  });

  // --- Edit (shared BranchEditDialog: name + color) --------------------------

  it("Edit opens the shared dialog; Confirm applies the color and renames", async () => {
    const onSetBranchColor = vi.fn();
    render({ onSetBranchColor });
    actionButton(branchRow("feature-x"), t("branchesPanel.edit")).click();
    await settle();
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    const nameInput =
      dialog!.querySelector<HTMLInputElement>("input.name-input")!;
    expect(nameInput.value).toBe("feature-x");
    nameInput.value = "feature-y";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    dialogButton("Confirm").click();
    await settle();
    expect(onSetBranchColor).toHaveBeenCalledWith(
      "feature-y",
      expect.any(String),
    );
    expect(renameBranch).toHaveBeenCalledWith("/r", "feature-x", "feature-y");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("Edit Confirm with an unchanged name only applies the color (no rename)", async () => {
    const onSetBranchColor = vi.fn();
    render({ onSetBranchColor });
    actionButton(branchRow("main"), t("branchesPanel.edit")).click();
    await settle();
    dialogButton("Confirm").click();
    await settle();
    expect(onSetBranchColor).toHaveBeenCalledWith("main", expect.any(String));
    expect(renameBranch).not.toHaveBeenCalled();
  });

  it("Edit Reset calls onResetBranchColor and closes the dialog", async () => {
    const onResetBranchColor = vi.fn();
    render({ onResetBranchColor });
    actionButton(branchRow("main"), t("branchesPanel.edit")).click();
    await settle();
    dialogButton("Reset").click();
    await settle();
    expect(onResetBranchColor).toHaveBeenCalledWith("main");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  // --- Fork here (inline create-branch, section B) ----------------------------

  it("fork input is absent until the fork icon is clicked", () => {
    render();
    expect(host.querySelectorAll(".inline-row").length).toBe(0);
  });

  it("fork input appears directly below the correct row", async () => {
    render();
    actionButton(branchRow("feature-x"), t("branchesPanel.fork")).click();
    await settle();
    const sibling = branchRow("feature-x").nextElementSibling;
    expect(sibling?.classList.contains("inline-row")).toBe(true);
    expect(sibling?.querySelector("input")).toBeTruthy();
    // main's row isn't followed by an inline input.
    expect(branchRow("main").nextElementSibling?.classList).not.toContain(
      "inline-row",
    );
  });

  it("fork Enter creates a branch from that row's branch tip", async () => {
    const onBranchCreated = vi.fn();
    render({ onBranchCreated });
    actionButton(branchRow("feature-x"), t("branchesPanel.fork")).click();
    await settle();
    const input =
      branchRow(
        "feature-x",
      ).nextElementSibling!.querySelector<HTMLInputElement>("input")!;
    typeAndKey(input, "feature-x-2", "Enter");
    await settle();
    expect(createBranch).toHaveBeenCalledWith("/r", "feature-x-2", "c2");
    expect(onBranchCreated).toHaveBeenCalledWith("feature-x-2");
    // Closes after a successful create.
    expect(
      branchRow("feature-x").nextElementSibling?.classList.contains(
        "inline-row",
      ),
    ).not.toBe(true);
  });

  it("fork Escape closes without creating", async () => {
    render();
    actionButton(branchRow("feature-x"), t("branchesPanel.fork")).click();
    await settle();
    const input =
      branchRow(
        "feature-x",
      ).nextElementSibling!.querySelector<HTMLInputElement>("input")!;
    typeAndKey(input, "abandoned", "Escape");
    await settle();
    expect(createBranch).not.toHaveBeenCalled();
    expect(
      branchRow("feature-x").nextElementSibling?.classList.contains(
        "inline-row",
      ),
    ).not.toBe(true);
  });

  it("opening the fork input on a second row closes the first", async () => {
    render();
    actionButton(branchRow("main"), t("branchesPanel.fork")).click();
    await settle();
    expect(
      branchRow("main").nextElementSibling?.classList.contains("inline-row"),
    ).toBe(true);

    actionButton(branchRow("feature-x"), t("branchesPanel.fork")).click();
    await settle();
    expect(
      branchRow("main").nextElementSibling?.classList.contains("inline-row"),
    ).not.toBe(true);
    expect(
      branchRow("feature-x").nextElementSibling?.classList.contains(
        "inline-row",
      ),
    ).toBe(true);
  });

  it("empty fork name does not submit and leaves the input open", async () => {
    render();
    actionButton(branchRow("feature-x"), t("branchesPanel.fork")).click();
    await settle();
    const input =
      branchRow(
        "feature-x",
      ).nextElementSibling!.querySelector<HTMLInputElement>("input")!;
    typeAndKey(input, "   ", "Enter");
    await settle();
    expect(createBranch).not.toHaveBeenCalled();
    expect(
      branchRow("feature-x").nextElementSibling?.classList.contains(
        "inline-row",
      ),
    ).toBe(true);
  });

  // --- Go to linked issue ------------------------------------------------------

  it('renders "go to linked issue" only for a branch the tracker links', () => {
    render({ linkedIssue });
    expect(
      findActionButton(branchRow("main"), t("branchesPanel.goToIssue")),
    ).toBeUndefined();
    expect(
      findActionButton(
        branchRow("feat/login-form-#142"),
        t("branchesPanel.goToIssue"),
      ),
    ).toBeTruthy();
  });

  it("go-to-issue calls onGoToIssue with the linked issue number", () => {
    const onGoToIssue = vi.fn();
    render({ onGoToIssue, linkedIssue });
    actionButton(
      branchRow("feat/login-form-#142"),
      t("branchesPanel.goToIssue"),
    ).click();
    expect(onGoToIssue).toHaveBeenCalledWith(142);
  });

  it("shows no go-to-issue icon without an issue tracker", () => {
    render();
    expect(
      findActionButton(
        branchRow("feat/login-form-#142"),
        t("branchesPanel.goToIssue"),
      ),
    ).toBeUndefined();
  });

  // --- Local rows: single-click selects, double-click checks out ------------

  it("a single click on a local branch row's name calls onBranchSelect and does NOT checkout", () => {
    const onBranchSelect = vi.fn();
    render({ onBranchSelect });
    const nameBtn = branchRow("feature-x").querySelector(
      ".name-btn",
    ) as HTMLButtonElement;
    nameBtn.click();
    expect(onBranchSelect).toHaveBeenCalledWith({
      name: "feature-x",
      current: false,
    });
    expect(checkout).not.toHaveBeenCalled();
  });

  it("a single click on the current local branch row reports current: true and does NOT checkout", () => {
    const onBranchSelect = vi.fn();
    render({ onBranchSelect });
    const nameBtn = branchRow("main").querySelector(
      ".name-btn",
    ) as HTMLButtonElement;
    nameBtn.click();
    expect(onBranchSelect).toHaveBeenCalledWith({
      name: "main",
      current: true,
    });
    expect(checkout).not.toHaveBeenCalled();
  });

  it("a double click on a local branch row's name checks it out", async () => {
    render();
    const nameBtn = branchRow("feature-x").querySelector(
      ".name-btn",
    ) as HTMLButtonElement;
    nameBtn.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await settle();
    expect(checkout).toHaveBeenCalledWith("/r", "feature-x");
  });

  it("marks the row matching `selectedBranch` with the selected class", () => {
    render({ selectedBranch: "feature-x" });
    expect(branchRow("feature-x").classList.contains("selected")).toBe(true);
    expect(branchRow("main").classList.contains("selected")).toBe(false);
  });

  // --- Remote rows: checkout always routes through the confirm dialog -------

  /** The `.row.remote` for `name`, found via its name button's text. */
  function remoteRow(name: string): HTMLElement {
    const btn = [...host.querySelectorAll<HTMLButtonElement>(".name-btn")].find(
      (b) => b.textContent?.trim() === name,
    );
    if (!btn) throw new Error(`no remote row for "${name}"`);
    return btn.closest(".row") as HTMLElement;
  }

  it("double-click on a remote row's name fires onCheckoutRemote with the remote name", () => {
    const onCheckoutRemote = vi.fn();
    render({ onCheckoutRemote });
    const nameBtn = remoteRow("origin/main").querySelector(
      ".name-btn",
    ) as HTMLButtonElement;
    nameBtn.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(onCheckoutRemote).toHaveBeenCalledWith("origin/main");
  });

  it("a single click on a remote row's name does NOT fire onCheckoutRemote", () => {
    const onCheckoutRemote = vi.fn();
    render({ onCheckoutRemote });
    const nameBtn = remoteRow("origin/main").querySelector(
      ".name-btn",
    ) as HTMLButtonElement;
    nameBtn.click();
    expect(onCheckoutRemote).not.toHaveBeenCalled();
    expect(checkout).not.toHaveBeenCalled();
  });

  it("right-click on a remote row opens a menu whose single item fires onCheckoutRemote", () => {
    const onCheckoutRemote = vi.fn();
    render({ onCheckoutRemote });
    const nameBtn = remoteRow("origin/main").querySelector(
      ".name-btn",
    ) as HTMLButtonElement;
    nameBtn.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }),
    );
    flushSync();
    const item = [
      ...host.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]'),
    ].find((b) => b.textContent?.trim() === t("menu.checkoutRemote"));
    expect(item).toBeTruthy();
    item!.click();
    expect(onCheckoutRemote).toHaveBeenCalledWith("origin/main");
  });
});

/** A section header toggle button ("Branches" / "Tags"), like the Changes panel. */
function sectionToggle(label: string): HTMLButtonElement {
  const btn = [...host.querySelectorAll<HTMLButtonElement>(".hdr-toggle")].find(
    (b) => b.textContent?.trim().includes(label),
  );
  if (!btn) throw new Error(`no section toggle "${label}"`);
  return btn;
}

describe("collapsible sections (like the Changes panel)", () => {
  it("collapsing Branches hides its rows + flips the chevron; expanding restores them", () => {
    render();
    expect(host.querySelectorAll(".name-btn").length).toBeGreaterThan(0);
    const toggle = sectionToggle("Branches");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.querySelector(".chev")?.textContent?.trim()).toBe("▾");

    toggle.click();
    flushSync();
    // Every local + remote branch row (its name button) is gone while collapsed.
    expect(host.querySelectorAll(".name-btn").length).toBe(0);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.querySelector(".chev")?.textContent?.trim()).toBe("▸");

    toggle.click();
    flushSync();
    expect(host.querySelectorAll(".name-btn").length).toBeGreaterThan(0);
    expect(toggle.querySelector(".chev")?.textContent?.trim()).toBe("▾");
  });

  it("collapses Tags independently of Branches", () => {
    render();
    const hasTag = () =>
      [...host.querySelectorAll(".name")].some(
        (n) => n.textContent?.trim() === "v1",
      );
    expect(hasTag()).toBe(true);

    sectionToggle("Tags").click();
    flushSync();
    expect(hasTag()).toBe(false);
    // Branches stay visible — the two sections collapse independently.
    expect(host.querySelectorAll(".name-btn").length).toBeGreaterThan(0);
  });
});

describe("BranchesPanel reserves the floating-toolbar band", () => {
  // jsdom's getComputedStyle does not resolve Svelte's injected scoped
  // stylesheet in this test environment (see MetroGraph.theme.test.ts), so
  // this is a source-text assertion (same idiom as StatusBar.test.ts) that
  // `.panel` reserves `var(--float-btn-band)` at its top, rather than a
  // computed-style assertion that would be meaningless here.
  it("`.panel`'s padding-top reserves var(--float-btn-band)", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "BranchesPanel.svelte"),
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
