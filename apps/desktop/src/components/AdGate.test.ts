import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";

const { flow, auth, ipc } = vi.hoisted(() => ({
  flow: {
    startCheckout: vi.fn(async () => ({ status: "opened", url: "x" })),
    signInFirst: vi.fn(async (): Promise<unknown> => null),
    checkoutNotice: vi.fn(() => null),
  },
  auth: { status: "signed-out" },
  ipc: { openExternalUrl: vi.fn(async () => {}) },
}));
vi.mock("../lib/checkoutFlow", () => flow);
vi.mock("../lib/auth.svelte", () => ({
  authState: () => ({ status: auth.status }),
}));
vi.mock("../lib/ipc", () => ipc);
vi.mock("../lib/license.svelte", () => ({
  refreshEntitlement: vi.fn(async () => {}),
}));

import AdGate from "./AdGate.svelte";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;
afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  vi.clearAllMocks();
  auth.status = "signed-out";
});

function render(props: Record<string, unknown> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(AdGate, {
    target: host,
    props: { onAccept: () => {}, onDecline: () => {}, ...props },
  });
  flushSync();
  return host;
}
const buttons = (h: HTMLElement) =>
  [...h.querySelectorAll(".actions button")].map((b) => b.textContent?.trim());
const click = (h: HTMLElement, label: string) =>
  [...h.querySelectorAll<HTMLButtonElement>(".actions button")]
    .find((b) => b.textContent?.trim() === label)!
    .click();

describe("AdGate", () => {
  it("offers ads or pay, and no free decline by default", () => {
    const h = render();
    expect(h.textContent).toContain("ad-supported");
    expect(h.textContent).toContain("Carbon Ads");
    expect(buttons(h)).toEqual([
      "Already paid? Sign in",
      "Switch to a paid plan",
      "Accept ads and keep using it free",
    ]);
  });

  it("is not dismissable: no scrim button, Escape does nothing", () => {
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    const h = render({ onAccept, onDecline });
    expect(h.querySelector("button.scrim")).toBeNull();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onAccept).not.toHaveBeenCalled();
    expect(onDecline).not.toHaveBeenCalled();
  });

  it("accept records the consent", () => {
    const onAccept = vi.fn();
    const h = render({ onAccept });
    click(h, "Accept ads and keep using it free");
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("paid plan opens a checkout", () => {
    const h = render();
    click(h, "Switch to a paid plan");
    expect(flow.startCheckout).toHaveBeenCalledWith("plan", "basic");
  });

  it("hides sign-in when already signed in", () => {
    auth.status = "signed-in";
    expect(buttons(render())).not.toContain("Already paid? Sign in");
  });

  it("offers declining only where it must stay free", () => {
    const onDecline = vi.fn();
    const h = render({ mayDecline: true, onDecline });
    click(h, "Don't accept ads");
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it("links the privacy policy on the website", () => {
    const h = render();
    h.querySelector<HTMLButtonElement>("button.link")!.click();
    expect(ipc.openExternalUrl).toHaveBeenCalledWith(
      "https://anotherdream.tw/en/privacy/",
    );
  });
});
