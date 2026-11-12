import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, unmount, flushSync, type ComponentProps } from "svelte";
import AdBanner from "./AdBanner.svelte";
import { setPlan } from "../lib/license.svelte";
import { setLocale } from "../lib/i18n/index.svelte";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

beforeEach(() => setPlan("free"));
afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
  setPlan("free");
  setLocale("en");
  document.documentElement.removeAttribute("style");
});

function render(over: Partial<ComponentProps<typeof AdBanner>> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(AdBanner, {
    target: host,
    props: { consent: "granted", ...over },
  });
  flushSync();
  return host;
}

/** Let the async load().then(render) microtask settle, then flush DOM. */
async function settle() {
  await new Promise((r) => setTimeout(r, 0));
  flushSync();
}

describe("AdBanner", () => {
  it("mounts a sandboxed ad iframe on free + granted consent", async () => {
    const h = render({ consent: "granted" });
    await settle();
    const iframe = h.querySelector("iframe.ad-frame") as HTMLIFrameElement;
    expect(iframe).not.toBeNull();
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-same-origin");
  });

  // The consent is asked by AdGate now; undecided is just no ad.
  it("loads no ad while consent is unset", async () => {
    const h = render({ consent: "unset" });
    await settle();
    expect(h.querySelector(".ad")).not.toBeNull();
    expect(h.querySelector("iframe")).toBeNull();
  });

  it("renders a blank strip (no ad, no notice) when declined", async () => {
    const h = render({ consent: "declined" });
    await settle();
    expect(h.querySelector(".ad")).not.toBeNull();
    expect(h.querySelector(".consent")).toBeNull();
    expect(h.querySelector("iframe")).toBeNull();
  });

  it("renders nothing on a paid plan", async () => {
    setPlan("advance");
    const h = render({ consent: "granted" });
    await settle();
    expect(h.querySelector(".ad")).toBeNull();
    expect(h.querySelector("iframe")).toBeNull();
  });

  it("hands the frame its message in the app's language", async () => {
    const h = render();
    await settle();
    const first = h.querySelector("iframe") as HTMLIFrameElement;
    expect(first.srcdoc).toContain("Switch to a paid plan to remove it.");
    expect(first.title).toBe("Advertisement");

    setLocale("zh-Hant");
    await settle();
    const next = h.querySelector("iframe") as HTMLIFrameElement;
    expect(next.srcdoc).toContain("改用付費方案即可移除");
    expect(next.title).toBe("廣告");
    expect(h.querySelectorAll("iframe")).toHaveLength(1);
  });

  // A rebuilt frame is a fresh ad request, so only a real change may cost one.
  it("rebuilds the frame when the strip is re-themed, not on other restyles", async () => {
    const h = render();
    await settle();
    const first = h.querySelector("iframe") as HTMLIFrameElement;
    expect(first.srcdoc).toContain("color:#2b2b2b");

    // What `applyTheme` does on every settings change: rewrite :root's style.
    document.documentElement.style.setProperty("--row-line", "#333336");
    await settle();
    expect(h.querySelector("iframe")).toBe(first);

    // jsdom doesn't resolve `var(--ad-bg)`, so re-theme the strip directly.
    (h.querySelector(".ad") as HTMLElement).style.backgroundColor = "#232838";
    document.documentElement.style.setProperty("--ad-bg", "#232838");
    await settle();
    const next = h.querySelector("iframe") as HTMLIFrameElement;
    expect(next).not.toBe(first);
    expect(next.srcdoc).toContain("background:rgb(35, 40, 56)");
    expect(next.srcdoc).toContain("color:#ededee");
    expect(h.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("offers a way out of ads only alongside an ad", async () => {
    const onRemoveAds = vi.fn();
    const h = render({ consent: "granted", onRemoveAds });
    await settle();
    const button = h.querySelector("button.remove") as HTMLButtonElement;
    expect(button.textContent).toBe("Remove ads");
    button.click();
    expect(onRemoveAds).toHaveBeenCalledOnce();
    unmount(app);
    host.remove();

    // Declined (where that's allowed) is a blank strip: nothing to remove.
    const blank = render({ consent: "declined", onRemoveAds });
    await settle();
    expect(blank.querySelector("button.remove")).toBeNull();
    unmount(app);
    host.remove();

    // No handler, no button.
    const bare = render({ consent: "granted" });
    await settle();
    expect(bare.querySelector("button.remove")).toBeNull();
  });

  it("disposes the ad immediately on upgrade", async () => {
    const h = render({ consent: "granted" });
    await settle();
    expect(h.querySelector("iframe")).not.toBeNull();
    setPlan("basic");
    flushSync();
    expect(h.querySelector(".ad")).toBeNull();
    expect(h.querySelector("iframe")).toBeNull();
  });
});
