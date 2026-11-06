import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mount, unmount, flushSync, type ComponentProps } from "svelte";
import WelcomeTour from "./WelcomeTour.svelte";
import { setLocale } from "../../lib/i18n/index.svelte";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

beforeEach(() => setLocale("en"));
afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
  setLocale("en");
});

function render(
  props: Partial<ComponentProps<typeof WelcomeTour>> = {},
): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(WelcomeTour, {
    target: host,
    props: { onStart: () => {}, onUseDirectly: () => {}, ...props },
  });
  flushSync();
  return host;
}

const q = (h: HTMLElement, sel: string) => h.querySelector(sel) as HTMLElement;
const click = (el: HTMLElement) => {
  el.click();
  flushSync();
};

describe("WelcomeTour", () => {
  it("is a modal dialog above the tutorial overlay", () => {
    const h = render();
    const dlg = q(h, '[role="dialog"]');
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    expect(dlg.getAttribute("aria-label")).toBe("Welcome to ADGitter");
  });

  it("page 1 greets and lists the seven highlights", () => {
    const h = render();
    expect(q(h, ".title").textContent).toBe("Welcome to ADGitter");
    const cards = [...h.querySelectorAll(".card")];
    expect(cards).toHaveLength(7);
    const text = cards.map((c) => c.textContent).join("|");
    for (const topic of [
      "graph you can touch",
      "merge, rebase, cherry-pick",
      "undo",
      "History surgery",
      "Log Anytime",
      "Themes",
      "Issue tracker",
    ])
      expect(text).toContain(topic);
  });

  it("every highlight card has an icon", () => {
    const h = render();
    for (const c of h.querySelectorAll(".card"))
      expect(c.querySelector("svg.icon")).not.toBeNull();
  });

  it("starts on page 1: Next, no Back, no choices yet", () => {
    const h = render();
    expect(q(h, "button.next")).not.toBeNull();
    expect(q(h, "button.back")).toBeNull();
    expect(h.querySelector(".choice")).toBeNull();
  });

  it("Next goes to the choice page; Back returns to the highlights", () => {
    const h = render();
    click(q(h, "button.next"));
    expect(q(h, ".title").textContent).toBe("How would you like to start?");
    expect(h.querySelectorAll(".choice")).toHaveLength(2);
    expect(h.querySelector(".card")).toBeNull();
    expect(q(h, "button.next")).toBeNull(); // last page
    click(q(h, "button.back"));
    expect(q(h, ".title").textContent).toBe("Welcome to ADGitter");
    expect(h.querySelectorAll(".card")).toHaveLength(7);
  });

  it("marks the current page in the dots", () => {
    const h = render();
    const on = () =>
      [...h.querySelectorAll(".dot")].map((d) => d.classList.contains("on"));
    expect(on()).toEqual([true, false]);
    expect(q(h, ".dots").getAttribute("aria-label")).toBe("Page 1 of 2");
    click(q(h, "button.next"));
    expect(on()).toEqual([false, true]);
    expect(q(h, ".dots").getAttribute("aria-label")).toBe("Page 2 of 2");
  });

  it("'Start the interactive tutorial' calls onStart only", () => {
    const onStart = vi.fn();
    const onUseDirectly = vi.fn();
    const h = render({ onStart, onUseDirectly });
    click(q(h, "button.next"));
    expect(q(h, ".choice.start").textContent).toContain(
      "Start the interactive tutorial",
    );
    click(q(h, ".choice.start"));
    expect(onStart).toHaveBeenCalledOnce();
    expect(onUseDirectly).not.toHaveBeenCalled();
  });

  it("'Use ADGitter directly' calls onUseDirectly only", () => {
    const onStart = vi.fn();
    const onUseDirectly = vi.fn();
    const h = render({ onStart, onUseDirectly });
    click(q(h, "button.next"));
    expect(q(h, ".choice.direct").textContent).toContain(
      "Use ADGitter directly",
    );
    click(q(h, ".choice.direct"));
    expect(onUseDirectly).toHaveBeenCalledOnce();
    expect(onStart).not.toHaveBeenCalled();
  });

  it("cannot be dismissed by Escape or a click outside (a choice is required)", () => {
    const onStart = vi.fn();
    const onUseDirectly = vi.fn();
    const h = render({ onStart, onUseDirectly });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    click(q(h, ".scrim"));
    expect(onStart).not.toHaveBeenCalled();
    expect(onUseDirectly).not.toHaveBeenCalled();
    expect(q(h, '[role="dialog"]')).not.toBeNull();
  });

  it("renders in Traditional Chinese", () => {
    setLocale("zh-Hant");
    const h = render();
    expect(q(h, ".title").textContent).toBe("歡迎使用 ADGitter");
    click(q(h, "button.next"));
    expect(q(h, ".choice.start").textContent).toContain("開始互動式教學");
    expect(q(h, ".choice.direct").textContent).toContain("直接使用 ADGitter");
  });
});
