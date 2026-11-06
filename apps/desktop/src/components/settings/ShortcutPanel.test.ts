import { describe, it, expect, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import ShortcutPanel from "./ShortcutPanel.svelte";
import { setLocale } from "../../lib/i18n/index.svelte";
import { KEY_ACTIONS } from "../../lib/keymap";
import { catalogs } from "../../lib/i18n/messages";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
  setLocale("en");
});

function render(value: Record<string, string>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(ShortcutPanel, { target: host, props: { value } });
  flushSync();
  return host;
}

function comboButton(h: HTMLElement, label: string): HTMLButtonElement {
  const row = [...h.querySelectorAll(".row")].find(
    (r) => r.querySelector(".label")?.textContent === label,
  )!;
  return row.querySelector(".combo") as HTMLButtonElement;
}

describe("ShortcutPanel", () => {
  it("renders each action's effective binding", () => {
    const h = render({});
    expect(comboButton(h, "Pull").textContent?.trim()).toBe("Mod+L");
    expect(comboButton(h, "Push").textContent?.trim()).toBe("Mod+P");
  });

  it("rebinds an action: click to capture, then press a combo", () => {
    const value: Record<string, string> = {};
    const h = render(value);
    const btn = comboButton(h, "Pull");
    btn.click();
    flushSync(); // now capturing
    btn.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "j",
        metaKey: true,
        bubbles: true,
      }),
    );
    flushSync();
    // The override is written into the draft (a plain object here doesn't drive
    // the component's derived re-render — SettingsModal supplies reactive state).
    expect(value.pull).toBe("Mod+J");
  });

  it("flags a conflict and shows the warning when two actions share a combo", () => {
    // Rebind Pull onto Push's default (Mod+P) → they collide.
    const h = render({ pull: "Mod+P" });
    expect(h.querySelector(".warn")).not.toBeNull();
    expect(h.querySelectorAll(".combo.conflict").length).toBeGreaterThanOrEqual(
      2,
    );
  });

  // The eight action names lived on KEY_ACTIONS.label as English literals, so
  // this whole panel stayed English in all seven other languages no matter what
  // the user picked. They now resolve through the catalog.
  it("shows the action names in the active locale, not English", () => {
    setLocale("zh-Hant");
    const h = render({});
    const labels = [...h.querySelectorAll(".label")].map((n) =>
      n.textContent?.trim(),
    );

    expect(labels).toEqual(
      KEY_ACTIONS.map((a) => catalogs["zh-Hant"][a.labelKey]),
    );
    // Neither the old English literals nor an unresolved catalog key.
    expect(labels).not.toContain("Switch Hand Tool");
    expect(labels).not.toContain("Show Setting Panel");
    for (const l of labels) expect(l).not.toMatch(/^shortcut\.action\./);
  });

  it("restore defaults clears every override", () => {
    const value: Record<string, string> = { pull: "Mod+X", push: "Mod+Y" };
    const h = render(value);
    (h.querySelector(".restore") as HTMLButtonElement).click();
    flushSync();
    expect(Object.keys(value)).toHaveLength(0);
  });

  // WKWebView (Tauri's macOS webview) does not focus a <button> on click the
  // way Chromium does, so a handler bound to the button's own `onkeydown`
  // never receives the keystroke once capture mode is entered — clicking
  // just relabels the cell to "press keys" and every subsequent keypress
  // goes to document.body instead. Capture must therefore work from a
  // `window`-level listener, independent of DOM focus. This is the
  // regression test: it dispatches on `window`, never touching the button,
  // and fails against the old button-bound `onkeydown` handler.
  it("records an override from a keydown dispatched on window, not just the button", () => {
    const value: Record<string, string> = {};
    const h = render(value);
    const btn = comboButton(h, "Pull");
    btn.click();
    flushSync(); // now capturing — never dispatch on `btn` itself below
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "j", metaKey: true }),
    );
    flushSync();
    expect(value.pull).toBe("Mod+J");
  });

  it("Escape cancels capture without recording an override", () => {
    const value: Record<string, string> = {};
    const h = render(value);
    comboButton(h, "Pull").click();
    flushSync();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    flushSync();
    expect(value.pull).toBeUndefined();
    // Capture ended — label falls back to the (unchanged) effective combo,
    // not the "press keys" placeholder.
    expect(comboButton(h, "Pull").classList.contains("capturing")).toBe(false);
    expect(comboButton(h, "Pull").textContent?.trim()).toBe("Mod+L");
  });

  it("a bare modifier keypress keeps capture mode open", () => {
    const value: Record<string, string> = {};
    const h = render(value);
    const btn = comboButton(h, "Pull");
    btn.click();
    flushSync();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Meta", metaKey: true }),
    );
    flushSync();
    expect(value.pull).toBeUndefined();
    expect(btn.classList.contains("capturing")).toBe(true);
    // Still listening: a real combo right after completes the capture.
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "j", metaKey: true }),
    );
    flushSync();
    expect(value.pull).toBe("Mod+J");
  });

  it("re-pressing the action's default combo clears the override rather than storing it", () => {
    const value: Record<string, string> = { pull: "Mod+X" };
    const h = render(value);
    comboButton(h, "Pull").click();
    flushSync();
    // Pull's default is Mod+L (see KEY_ACTIONS).
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "l", metaKey: true }),
    );
    flushSync();
    expect(value.pull).toBeUndefined();
    expect("pull" in value).toBe(false);
  });

  it("leaving capture mode removes the window listener — a later keydown does nothing", () => {
    const value: Record<string, string> = {};
    const host = render(value);
    comboButton(host, "Pull").click();
    flushSync();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    flushSync(); // capture ended, effect cleanup should have removed the listener
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "j", metaKey: true }),
    );
    flushSync();
    expect(value.pull).toBeUndefined();
  });

  it("a click outside the row being captured cancels capture and unbinds the listener", () => {
    const value: Record<string, string> = {};
    const h = render(value);
    comboButton(h, "Pull").click();
    flushSync();
    expect(comboButton(h, "Pull").classList.contains("capturing")).toBe(true);
    // jsdom in this workspace has no PointerEvent constructor; a plain
    // MouseEvent typed "pointerdown" dispatches to the same listeners since
    // addEventListener matches by the event-type string, not the class.
    document.body.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true }),
    );
    flushSync();
    expect(comboButton(h, "Pull").classList.contains("capturing")).toBe(false);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "j", metaKey: true }),
    );
    flushSync();
    expect(value.pull).toBeUndefined();
  });
});
