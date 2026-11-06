import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";

vi.mock("../lib/ipc", () => ({
  renewLicense: vi.fn(),
  verifyLicense: vi.fn(async () => ({
    status: "active",
    plan: "free",
    error: null,
    expiresMs: null,
    features: ["ApplyTheme"],
    ownedThemes: [],
  })),
  isAdgitterError: (e: unknown) =>
    typeof e === "object" && e !== null && "code" in e,
}));

import { renewLicense } from "../lib/ipc";
import {
  clearCheckoutReturn,
  handleCheckoutReturn,
} from "../lib/checkoutReturn.svelte";
import CheckoutReturnNotice from "./CheckoutReturnNotice.svelte";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const verified = (over: Record<string, unknown> = {}) => ({
  status: "active",
  plan: "free",
  error: null,
  expiresMs: null,
  features: ["ApplyTheme"],
  ownedThemes: [],
  ...over,
});

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(CheckoutReturnNotice, { target: host });
  flushSync();
  return host;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearCheckoutReturn();
});

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
});

describe("CheckoutReturnNotice", () => {
  it("shows nothing until a payment return happens", () => {
    const h = render();
    expect(h.querySelector("[data-checkout-return]")).toBeNull();
  });

  it("announces the unlock once the server confirms it", async () => {
    mocked(renewLicense).mockResolvedValue(
      verified({ ownedThemes: ["synthwave"] }),
    );
    const h = render();

    await handleCheckoutReturn({ delays: [0], wait: async () => {} });
    flushSync();

    expect(
      h
        .querySelector("[data-checkout-return]")
        ?.getAttribute("data-checkout-return"),
    ).toBe("unlocked");
    expect(h.textContent).toContain("Purchase complete");
    expect(h.textContent).toContain("ready to apply");
  });

  it("says the purchase is still processing — and offers another check", async () => {
    // Webhook still in flight: the entitlement came back unchanged.
    mocked(renewLicense).mockResolvedValue(verified());
    const h = render();

    await handleCheckoutReturn({ delays: [0], wait: async () => {} });
    flushSync();

    expect(h.textContent).toContain("hasn't arrived yet");
    expect(h.textContent).not.toContain("Purchase complete");
    const retry = h.querySelector(
      "[data-checkout-return-retry]",
    ) as HTMLButtonElement;
    expect(retry).not.toBeNull();

    mocked(renewLicense).mockResolvedValue(verified({ plan: "advance" }));
    retry.click();
    await vi.waitFor(() => {
      flushSync();
      expect(h.textContent).toContain("Purchase complete");
    });
  });
});
