import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mount, unmount, flushSync, type ComponentProps } from "svelte";
import Toast from "./Toast.svelte";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
  vi.useRealTimers();
});

function render(
  props: Partial<ComponentProps<typeof Toast>> & { message: string },
) {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(Toast, { target: host, props });
  flushSync();
  return host;
}

const toast = (h: HTMLElement) => h.querySelector(".toast")!;

describe("Toast", () => {
  it("renders a countdown bar for a notice", () => {
    const h = render({ message: "Saved", onDismiss: () => {} });
    expect(toast(h).classList.contains("notice")).toBe(true);
    expect(h.querySelector(".bar")).not.toBeNull();
    expect(toast(h).textContent).toContain("Saved");
  });

  it("fades out then auto-dismisses after `duration` (+ fade)", () => {
    const onDismiss = vi.fn();
    const h = render({ message: "Pulled", duration: 1000, onDismiss });

    // Before the countdown elapses: still visible, not yet leaving/dismissed.
    vi.advanceTimersByTime(999);
    flushSync();
    expect(toast(h).classList.contains("leaving")).toBe(false);
    expect(onDismiss).not.toHaveBeenCalled();

    // At `duration`: the fade begins (leaving), but not yet removed.
    vi.advanceTimersByTime(1);
    flushSync();
    expect(toast(h).classList.contains("leaving")).toBe(true);
    expect(onDismiss).not.toHaveBeenCalled();

    // After the fade window: onDismiss fires so the parent removes it.
    vi.advanceTimersByTime(220);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("an error (duration 0) never auto-dismisses and has no countdown bar", () => {
    const onDismiss = vi.fn();
    const h = render({
      message: "Boom",
      kind: "error",
      duration: 0,
      onDismiss,
    });
    expect(toast(h).getAttribute("role")).toBe("alert");
    expect(h.querySelector(".bar")).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("the dismiss button fires onDismiss immediately", () => {
    const onDismiss = vi.fn();
    const h = render({ message: "Saved", onDismiss });
    h.querySelector<HTMLButtonElement>(".toast button")!.click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
