import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync, type ComponentProps } from "svelte";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import SearchBox from "./SearchBox.svelte";
import type { Commit, RefList } from "../lib/ipc";

function commit(sha: string, subject: string, author = "Ada"): Commit {
  return {
    sha,
    short_sha: sha.slice(0, 7),
    author_name: author,
    author_email: "a@x.com",
    timestamp: 1700000000,
    subject,
    body: "",
    parents: [],
  };
}

const commits = [
  commit("a".repeat(40), "feat: add search"),
  commit("b".repeat(40), "fix: crash"),
];
const refs: RefList = {
  head: { branch: "main", target: "a".repeat(40), detached: false },
  branches: [{ name: "search-ui", kind: "branch", target: "b".repeat(40) }],
  remotes: [],
  tags: [],
};

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
});

function render(over: Partial<ComponentProps<typeof SearchBox>> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(SearchBox, {
    target: host,
    props: { commits, refs, onSelect: () => {}, ...over },
  });
  flushSync();
  return host;
}

function type(h: HTMLDivElement, value: string) {
  const inp = h.querySelector("input") as HTMLInputElement;
  inp.focus();
  inp.value = value;
  inp.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
  return inp;
}

describe("SearchBox", () => {
  it("shows no dropdown until something is typed", () => {
    const h = render();
    expect(h.querySelector(".results")).toBeNull();
  });

  it("lists matching results as you type", () => {
    const h = type(render(), "search");
    void h;
    const results = host.querySelectorAll(".result");
    // matches the commit subject "feat: add search" + branch "search-ui"
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it("selecting a result fires onSelect with the sha and clears the query", () => {
    const onSelect = vi.fn();
    const h = render({ onSelect });
    type(h, "crash");
    const first = h.querySelector(".result") as HTMLButtonElement;
    first.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    flushSync();
    expect(onSelect).toHaveBeenCalledWith("b".repeat(40));
    expect((h.querySelector("input") as HTMLInputElement).value).toBe("");
  });

  it("keyboard ↓ + Enter selects a result", () => {
    const onSelect = vi.fn();
    const h = render({ onSelect });
    const inp = type(h, "a"); // broad match
    inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    flushSync();
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("shows a no-matches message", () => {
    const h = render();
    type(h, "zzzzzz");
    expect(h.querySelector(".empty")?.textContent).toBe("No matches");
  });

  it("Escape clears the query", () => {
    const h = render();
    const inp = type(h, "search");
    inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    flushSync();
    expect((h.querySelector("input") as HTMLInputElement).value).toBe("");
  });
});

// --- the scope picker -------------------------------------------------------

const trigger = (h: HTMLDivElement) =>
  h.querySelector(".scope") as HTMLButtonElement;
const menu = (h: HTMLDivElement) => h.querySelector(".scope-menu");
const options = (h: HTMLDivElement) =>
  [...h.querySelectorAll(".scope-option")] as HTMLButtonElement[];

function press(el: Element, key: string) {
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  flushSync();
}

function openMenu(h: HTMLDivElement) {
  trigger(h).click();
  flushSync();
}

/** Pick a scope by its visible label. */
function pick(h: HTMLDivElement, label: string) {
  openMenu(h);
  const opt = options(h).find((o) => o.textContent?.trim() === label);
  if (!opt) throw new Error(`no scope option "${label}"`);
  opt.click();
  flushSync();
}

describe("SearchBox — scope picker", () => {
  it("starts on 'this project' with the menu closed", () => {
    const h = render();
    expect(trigger(h).textContent).toContain("this project");
    expect(trigger(h).getAttribute("aria-expanded")).toBe("false");
    expect(menu(h)).toBeNull();
  });

  it("opens and closes the menu, tracking aria-expanded", () => {
    const h = render();
    openMenu(h);
    expect(menu(h)).not.toBeNull();
    expect(trigger(h).getAttribute("aria-expanded")).toBe("true");
    expect(trigger(h).getAttribute("aria-controls")).toBe("search-scope-menu");
    trigger(h).click();
    flushSync();
    expect(menu(h)).toBeNull();
  });

  it("lists all eight scopes as options, marking the current one selected", () => {
    const h = render();
    openMenu(h);
    expect(options(h).map((o) => o.textContent?.trim())).toEqual([
      "this project",
      "Commits",
      "Message",
      "Author",
      "Hash",
      "Time",
      "Branch",
      "Tag",
    ]);
    const selected = options(h).filter(
      (o) => o.getAttribute("aria-selected") === "true",
    );
    expect(selected.map((o) => o.textContent?.trim())).toEqual([
      "this project",
    ]);
  });

  it("relabels the pill and the placeholder once a scope is picked", () => {
    const h = render();
    pick(h, "Author");
    expect(trigger(h).textContent).toContain("Author");
    const inp = h.querySelector("input") as HTMLInputElement;
    expect(inp.placeholder).toBe("Search by author name or email…");
    // The accessible name follows the placeholder, not a stale generic label.
    expect(inp.getAttribute("aria-label")).toBe(
      "Search by author name or email…",
    );
  });

  it("narrows the results to the chosen field", () => {
    const h = render();
    // "search" matches a commit subject and the branch "search-ui" in `all`…
    type(h, "search");
    expect(h.querySelectorAll(".result").length).toBeGreaterThanOrEqual(2);
    // …but only the branch once the scope is Branch.
    pick(h, "Branch");
    type(h, "search");
    const labels = [...h.querySelectorAll(".result .label")].map((n) =>
      n.textContent?.trim(),
    );
    expect(labels).toEqual(["search-ui"]);
  });

  it("re-runs the current query when the scope changes under it", () => {
    const h = render();
    type(h, "search");
    expect(h.querySelectorAll(".result").length).toBeGreaterThanOrEqual(2);
    // Same query, narrower scope → the branch match drops out and only the
    // commit subject survives.
    pick(h, "Message");
    (h.querySelector("input") as HTMLInputElement).focus();
    flushSync();
    const labels = [...h.querySelectorAll(".result .label")].map((n) =>
      n.textContent?.trim(),
    );
    expect(labels).toEqual(["feat: add search"]);
  });

  it("shows no matches when the query belongs to another field", () => {
    const h = render();
    pick(h, "Hash");
    type(h, "Ada"); // an author name — never a hash
    expect(h.querySelector(".empty")?.textContent).toBe("No matches");
  });

  it("opens with ArrowDown from the trigger and focuses the current scope", () => {
    const h = render();
    trigger(h).focus();
    press(trigger(h), "ArrowDown");
    expect(menu(h)).not.toBeNull();
    expect(document.activeElement).toBe(options(h)[0]); // "this project"
  });

  it("moves focus with ArrowDown/ArrowUp and wraps around", () => {
    const h = render();
    openMenu(h);
    const opts = options(h);
    press(opts[0], "ArrowDown");
    expect(document.activeElement).toBe(options(h)[1]);
    press(options(h)[1], "ArrowUp");
    expect(document.activeElement).toBe(options(h)[0]);
    press(options(h)[0], "ArrowUp"); // wraps to the end
    expect(document.activeElement).toBe(options(h)[7]);
  });

  it("Home and End jump to the first and last scope", () => {
    const h = render();
    openMenu(h);
    press(options(h)[0], "End");
    expect(document.activeElement).toBe(options(h)[7]);
    press(options(h)[7], "Home");
    expect(document.activeElement).toBe(options(h)[0]);
  });

  it("Enter on a focused option selects it (native button activation)", () => {
    const h = render();
    trigger(h).focus();
    press(trigger(h), "ArrowDown");
    press(options(h)[0], "ArrowDown");
    press(options(h)[1], "ArrowDown"); // → "Message"
    (document.activeElement as HTMLButtonElement).click();
    flushSync();
    expect(trigger(h).textContent).toContain("Message");
    expect(menu(h)).toBeNull();
  });

  it("Escape closes the menu, keeps the scope and returns focus to the pill", () => {
    const h = render();
    pick(h, "Author");
    openMenu(h);
    press(options(h)[1], "Escape");
    expect(menu(h)).toBeNull();
    expect(trigger(h).textContent).toContain("Author"); // unchanged
    expect(document.activeElement).toBe(trigger(h));
  });

  it("Escape inside the menu does not clear the query", () => {
    const h = render();
    type(h, "search");
    openMenu(h);
    press(options(h)[0], "Escape");
    expect((h.querySelector("input") as HTMLInputElement).value).toBe("search");
  });

  it("leaves the input's own keys alone — ↓/Enter still pick a result", () => {
    const onSelect = vi.fn();
    const h = render({ onSelect });
    pick(h, "Message");
    const inp = type(h, "crash");
    press(inp, "ArrowDown");
    press(inp, "Enter");
    expect(onSelect).toHaveBeenCalledWith("b".repeat(40));
  });

  it("picking a scope hands focus back to the input", () => {
    const h = render();
    pick(h, "Tag");
    expect(document.activeElement).toBe(h.querySelector("input"));
  });

  it("closes the menu when focus leaves the pill entirely", () => {
    const h = render();
    openMenu(h);
    const inp = h.querySelector("input") as HTMLInputElement;
    options(h)[0].dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: inp }),
    );
    flushSync();
    expect(menu(h)).toBeNull();
  });

  describe("dropdown text colour (white-on-white regression)", () => {
    // jsdom in this project's vitest setup never injects the component's
    // scoped <style> tag into the document (confirmed empirically — no
    // <style> element exists after mount here, matching the note in
    // MetroGraph.theme.test.ts that jsdom doesn't resolve Svelte's injected
    // scoped stylesheet), so getComputedStyle can't tell us anything: it
    // can't even see these rules, reverted or not. Instead we assert
    // directly on the emitted CSS source of the two dropdown containers,
    // `.scope-menu` and `.results`. Both sit on `--panel-bg` (white) inside
    // `TopBar`, whose `.bar` sets `color: var(--topbar-fg)` (near-white) —
    // without their own `color` declaration their text inherits the top
    // bar's near-white foreground and renders white-on-white. This
    // genuinely fails if the `color: var(--fg)` rule is reverted (see the
    // revert evidence in the task report) and is unaffected by whatever
    // jsdom does or doesn't resolve for computed style.
    const css = readFileSync(join(__dirname, "SearchBox.svelte"), "utf-8");

    function ruleBodyFor(selector: string): string {
      const idx = css.indexOf(`  ${selector} {`);
      expect(idx, `selector ${selector} not found in <style>`).toBeGreaterThan(
        -1,
      );
      const close = css.indexOf("}", idx);
      return css.slice(idx, close);
    }

    it(".scope-menu declares its own foreground colour", () => {
      expect(ruleBodyFor(".scope-menu")).toMatch(/color:\s*var\(--fg\)/);
    });

    it(".results declares its own foreground colour", () => {
      expect(ruleBodyFor(".results")).toMatch(/color:\s*var\(--fg\)/);
    });
  });
});
