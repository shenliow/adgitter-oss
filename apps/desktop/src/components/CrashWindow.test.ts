import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync, type ComponentProps } from "svelte";
import CrashWindow from "./CrashWindow.svelte";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
});

function render(over: Partial<ComponentProps<typeof CrashWindow>> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(CrashWindow, {
    target: host,
    props: { onReload: () => {}, onDismiss: () => {}, ...over },
  });
  flushSync();
  return host;
}

describe("CrashWindow", () => {
  it("shows a friendly title + body (not a raw stack)", () => {
    const h = render();
    expect(h.querySelector("h2")?.textContent).toBe("Something went wrong");
    expect(h.textContent).toContain("safe on disk");
  });

  it("notes the report only when one was sent", () => {
    expect(render({ reported: false }).querySelector(".reported")).toBeNull();
    unmount(app);
    host.remove();
    expect(
      render({ reported: true }).querySelector(".reported"),
    ).not.toBeNull();
  });

  it("fires reload and dismiss", () => {
    const onReload = vi.fn();
    const onDismiss = vi.fn();
    const h = render({ onReload, onDismiss });
    (h.querySelector(".primary") as HTMLButtonElement).click();
    (h.querySelector(".ghost") as HTMLButtonElement).click();
    expect(onReload).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
