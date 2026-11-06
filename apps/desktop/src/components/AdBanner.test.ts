import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount, unmount, flushSync, type ComponentProps } from "svelte";
import AdBanner from "./AdBanner.svelte";
import { setPlan } from "../lib/license.svelte";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

beforeEach(() => setPlan("free"));
afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
  setPlan("free");
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
