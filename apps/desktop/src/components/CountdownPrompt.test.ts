/**
 * The non-modal countdown prompt in isolation.
 *
 * Fake timers throughout — never a real wait. Nothing here reads computed CSS
 * (jsdom does not resolve Svelte's scoped styles); the fade is observed via
 * the `.leaving` class the component toggles, which is exactly why that fade
 * is CSS and not a Svelte `transition:` (see the component's note).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, unmount, flushSync, type ComponentProps } from "svelte";
import CountdownPrompt from "./CountdownPrompt.svelte";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
  vi.useRealTimers();
});

function render(over: Partial<ComponentProps<typeof CountdownPrompt>> = {}): {
  h: HTMLDivElement;
  onYes: ReturnType<typeof vi.fn>;
  onSkip: ReturnType<typeof vi.fn>;
  onCancel: ReturnType<typeof vi.fn>;
} {
  const onYes = vi.fn();
  const onSkip = vi.fn();
  const onCancel = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(CountdownPrompt, {
    target: host,
    props: {
      message: "Pull first?",
      seconds: 5,
      yesLabel: "Pull",
      skipLabel: "Not now",
      cancelLabel: "Cancel",
      onYes,
      onSkip,
      onCancel,
      ...over,
    },
  });
  flushSync();
  return { h: host, onYes, onSkip, onCancel };
}

const prompt = (h: HTMLElement) =>
  h.querySelector<HTMLElement>('[data-testid="autopull-countdown"]')!;
const btn = (h: HTMLElement, which: string) =>
  h.querySelector<HTMLButtonElement>(`[data-testid="autopull-${which}"]`)!;

function advance(ms: number) {
  vi.advanceTimersByTime(ms);
  flushSync();
}

describe("CountdownPrompt", () => {
  it("shows the message and all three action labels", () => {
    const { h } = render();
    expect(prompt(h).querySelector("strong")?.textContent).toBe("Pull first?");
    expect(btn(h, "yes").textContent?.trim()).toBe("Pull");
    expect(btn(h, "skip").textContent?.trim()).toBe("Not now");
    expect(btn(h, "cancel").textContent?.trim()).toBe("Cancel");
  });

  it("is non-modal: a status region with no scrim and no aria-modal", () => {
    const { h } = render();
    expect(prompt(h).getAttribute("role")).toBe("status");
    expect(prompt(h).getAttribute("aria-live")).toBe("polite");
    expect(prompt(h).getAttribute("aria-modal")).toBeNull();
    expect(h.querySelector(".scrim")).toBeNull();
    expect(h.querySelector(".overlay")).toBeNull();
  });

  it("selects yes by itself once the countdown expires", () => {
    const { h, onYes, onSkip, onCancel } = render({ seconds: 5 });
    advance(4999);
    expect(onYes).not.toHaveBeenCalled();
    // The fade begins at `duration`, and the answer lands after it.
    advance(1);
    expect(prompt(h).classList.contains("leaving")).toBe(true);
    expect(onYes).not.toHaveBeenCalled();
    advance(300);
    expect(onYes).toHaveBeenCalledOnce();
    expect(onSkip).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("honours the configured length rather than a fixed one", () => {
    const { onYes } = render({ seconds: 30 });
    advance(5_500);
    expect(onYes).not.toHaveBeenCalled();
    advance(25_000);
    expect(onYes).toHaveBeenCalledOnce();
  });

  it("reports Skip or Cancel clicked during the countdown, and only once", () => {
    for (const which of ["skip", "cancel"] as const) {
      const { h, onYes, onSkip, onCancel } = render();
      advance(1000);
      btn(h, which).click();
      flushSync();
      const chosen = which === "skip" ? onSkip : onCancel;
      expect(chosen).toHaveBeenCalledOnce();
      // The pending expiry must not answer on top of the user's choice.
      advance(10_000);
      expect(onYes).not.toHaveBeenCalled();
      expect(chosen).toHaveBeenCalledOnce();
      unmount(app);
      app = undefined;
      host.remove();
    }
  });

  it("does not double-answer when Yes is clicked and then expires", () => {
    const { h, onYes } = render();
    btn(h, "yes").click();
    flushSync();
    advance(10_000);
    expect(onYes).toHaveBeenCalledOnce();
  });

  it("drops the pending answer on unmount", () => {
    const { onYes } = render();
    unmount(app);
    app = undefined;
    advance(10_000);
    expect(onYes).not.toHaveBeenCalled();
  });

  it("renders a countdown bar whose animation matches the duration", () => {
    const { h } = render({ seconds: 7 });
    const bar = prompt(h).querySelector<HTMLElement>(".bar")!;
    // The attribute, not the computed style — jsdom resolves neither the
    // scoped rule nor the keyframes.
    expect(bar.style.animationDuration).toBe("7000ms");
    expect(bar.getAttribute("aria-hidden")).toBe("true");
  });
});
