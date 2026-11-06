import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync, type ComponentProps } from "svelte";
import Toolbar from "./Toolbar.svelte";
import fs from "node:fs";
import path from "node:path";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
});

function render(props: ComponentProps<typeof Toolbar> = {}): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(Toolbar, { target: host, props });
  flushSync();
  return host;
}

const btn = (h: HTMLDivElement, title: string) =>
  h.querySelector(`button[title="${title}"]`) as HTMLButtonElement;

describe("Toolbar push/pull", () => {
  it("disables push/pull when sync is unavailable", () => {
    const h = render({ syncDisabled: true });
    expect(btn(h, "Push").disabled).toBe(true);
    expect(btn(h, "Pull").disabled).toBe(true);
  });

  it("fires onPush / onPull when enabled", () => {
    const onPush = vi.fn();
    const onPull = vi.fn();
    const h = render({ syncDisabled: false, onPush, onPull });
    btn(h, "Push").click();
    btn(h, "Pull").click();
    expect(onPush).toHaveBeenCalledOnce();
    expect(onPull).toHaveBeenCalledOnce();
  });

  it("shows ahead/behind badges", () => {
    const h = render({ ahead: 3, behind: 2 });
    expect(btn(h, "Push").textContent).toContain("3");
    expect(btn(h, "Pull").textContent).toContain("2");
  });

  // Push's busy feedback is a Spinner swapped in for the icon (previously the
  // literal "…" character). jsdom cannot resolve Svelte's scoped styles, so
  // these assert on the element/attributes, never on computed CSS or on the
  // animation actually running.
  it("disables Push while its op is busy, and swaps its icon for a spinner", () => {
    const h = render({ pushBusy: true });
    const push = btn(h, "Push");
    expect(push.disabled).toBe(true);
    expect(push.getAttribute("aria-busy")).toBe("true");
    expect(push.querySelector('[data-testid="spinner"]')).not.toBeNull();
    // The spinner replaces the icon rather than joining it.
    expect(push.querySelector("svg.icon")).toBeNull();
  });

  it("returns Push to its icon, enabled and not busy, once the op is over", () => {
    const h = render({ pushBusy: false });
    const push = btn(h, "Push");
    expect(push.disabled).toBe(false);
    expect(push.hasAttribute("aria-busy")).toBe(false);
    expect(push.querySelector('[data-testid="spinner"]')).toBeNull();
    expect(push.querySelector("svg.icon")).not.toBeNull();
  });
});

describe("Toolbar Push split button — Force push", () => {
  it("Push is a split button whose caret reveals a danger-flagged Force push option", () => {
    const h = render({ syncDisabled: false });
    // The menu is closed by default; only the caret segment opens it.
    expect(h.querySelector(".menu")).toBeNull();
    (h.querySelector(".caret-segment") as HTMLButtonElement).click();
    flushSync();
    const item = h.querySelector(".menu .item") as HTMLButtonElement;
    expect(item).not.toBeNull();
    expect(item.textContent).toContain("Force push");
    expect(item.classList.contains("danger")).toBe(true);
  });

  it("clicking the main segment still fires onPush, not onForcePush", () => {
    const onPush = vi.fn();
    const onForcePush = vi.fn();
    const h = render({ syncDisabled: false, onPush, onForcePush });
    btn(h, "Push").click();
    flushSync();
    expect(onPush).toHaveBeenCalledOnce();
    expect(onForcePush).not.toHaveBeenCalled();
  });

  it("choosing Force push from the menu fires onForcePush, not onPush", () => {
    const onPush = vi.fn();
    const onForcePush = vi.fn();
    const h = render({ syncDisabled: false, onPush, onForcePush });
    (h.querySelector(".caret-segment") as HTMLButtonElement).click();
    flushSync();
    (h.querySelector(".menu .item") as HTMLButtonElement).click();
    flushSync();
    expect(onForcePush).toHaveBeenCalledOnce();
    expect(onPush).not.toHaveBeenCalled();
  });
});

describe("Toolbar issues toggle (panel-chrome: moved to .right)", () => {
  it("lives in .right, alongside undo, and keeps its testid", () => {
    const h = render();
    const right = h.querySelector(".right") as HTMLElement;
    const issuesBtn = right.querySelector('[data-testid="toolbar-issues"]');
    expect(issuesBtn).not.toBeNull();
    // Not in .left anymore.
    const left = h.querySelector(".left") as HTMLElement;
    expect(left.querySelector('[data-testid="toolbar-issues"]')).toBeNull();
  });

  it("shows the lock badge when issuesLocked and fires onToggleIssues", () => {
    const onToggleIssues = vi.fn();
    const h = render({ issuesLocked: true, onToggleIssues });
    const issuesBtn = h.querySelector<HTMLButtonElement>(
      '[data-testid="toolbar-issues"]',
    )!;
    expect(issuesBtn.querySelector(".lock")).not.toBeNull();
    issuesBtn.click();
    expect(onToggleIssues).toHaveBeenCalledOnce();
  });

  it("marks the issues button active when issuesActive is true", () => {
    const h = render({ issuesActive: true });
    const issuesBtn = h.querySelector<HTMLButtonElement>(
      '[data-testid="toolbar-issues"]',
    )!;
    expect(issuesBtn.classList.contains("active")).toBe(true);
  });
});

describe("Toolbar floating stacking (docked panels no longer cover it)", () => {
  // jsdom's getComputedStyle does not resolve Svelte's injected scoped
  // stylesheet in this test environment (see MetroGraph.theme.test.ts for
  // the same caveat), so the z-index raise is asserted on the component's
  // own source text — same idiom as StatusBar.test.ts's source-content
  // check — rather than a DOM computed-style assertion that would pass for
  // the wrong reason (or not at all).
  it("`.toolbar`'s z-index (8) is declared above every docked panel's (6)", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "Toolbar.svelte"),
      "utf-8",
    );
    const styleMatch = src.match(/<style>([\s\S]*)<\/style>/);
    expect(styleMatch).not.toBeNull();
    const toolbarRuleMatch = styleMatch![1].match(/\.toolbar\s*{([^}]*)}/);
    expect(toolbarRuleMatch).not.toBeNull();
    expect(toolbarRuleMatch![1]).toMatch(/z-index:\s*8\s*;/);
  });

  it("the toolbar stays pointer-events: none outside its clusters, so clicks in the empty band still reach the panel underneath", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "Toolbar.svelte"),
      "utf-8",
    );
    const styleMatch = src.match(/<style>([\s\S]*)<\/style>/)!;
    const toolbarRuleMatch = styleMatch[1].match(/\.toolbar\s*{([^}]*)}/)!;
    expect(toolbarRuleMatch[1]).toMatch(/pointer-events:\s*none\s*;/);
  });
});

describe("Toolbar undo button is icon-only", () => {
  it("shows no visible label but keeps an accessible name, and still fires", () => {
    const onUndo = vi.fn();
    const h = render({ canUndo: true, onUndo });
    const undo = btn(h, "Undo");
    expect(undo).not.toBeNull();
    // Icon only: the <svg> is the button's whole content, no text node.
    expect(undo.textContent?.trim()).toBe("");
    expect(undo.querySelector("svg")).not.toBeNull();
    // The icon is decorative (aria-hidden), so `title` is what names the
    // button — the same way the branches / files / pull buttons are named.
    expect(undo.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(undo.getAttribute("title")).toBe("Undo");
    undo.click();
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it("stays disabled when there is nothing to undo", () => {
    expect(btn(render({ canUndo: false }), "Undo").disabled).toBe(true);
  });

  it("stays disabled while an undo is in flight", () => {
    expect(
      btn(render({ canUndo: true, undoBusy: true }), "Undo").disabled,
    ).toBe(true);
  });

  it("is the same size as its icon-only neighbours in .right", () => {
    const h = render();
    const right = h.querySelector(".right") as HTMLElement;
    const classes = [...right.querySelectorAll("button")].map(
      (b) => b.className,
    );
    // No label-specific class: undo is a plain `.round` pill like the rest.
    expect(classes.every((c) => c.split(" ").includes("round"))).toBe(true);
  });
});

describe("Toolbar Log Anytime toggle (tutorial anchor)", () => {
  const logBtn = (h: HTMLDivElement) =>
    h.querySelector<HTMLButtonElement>("button.log-anytime")!;

  it("carries the data-tutorial anchor in both states", () => {
    for (const logAnytimeEnabled of [true, false]) {
      const h = render({ logAnytimeEnabled });
      expect(logBtn(h).getAttribute("data-tutorial")).toBe(
        "toolbar-log-anytime",
      );
      unmount(app);
      h.remove();
      app = undefined;
    }
  });
});
