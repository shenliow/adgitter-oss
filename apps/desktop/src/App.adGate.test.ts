/**
 * Free tier = ads or pay (lib/adGate.ts), at the App level: the gate covers a
 * fresh free user once the entitlement is read, accepting it persists the ad
 * consent alone, and crash reports are asked separately.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setPlan } from "./lib/license.svelte";
import { mountApp, cleanupApp, settle, settingsApi } from "./test/appHarness";

// An ad build unless a test says otherwise (lib/ads/config.ts).
beforeEach(() => {
  vi.stubEnv("VITE_CARBON_SERVE", "TEST");
  vi.stubEnv("VITE_CARBON_PLACEMENT", "adgitter");
});
afterEach(() => {
  cleanupApp();
  setPlan("free");
  vi.unstubAllEnvs();
});

const gate = (h: HTMLElement) =>
  h.ownerDocument.querySelector('[aria-labelledby="ad-gate-title"]');

describe("ad gate", () => {
  it("covers a fresh free user and records only the ad consent", async () => {
    const h = await mountApp({
      settings: { adConsent: "unset" },
      entitlementReady: true,
    });
    await settle();
    expect(gate(h)).not.toBeNull();

    [...h.ownerDocument.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => b.textContent?.includes("Accept ads"))!
      .click();
    await settle();
    expect(gate(h)).toBeNull();
    const saved = settingsApi.saveSettings.mock.calls.at(-1)![0];
    expect(saved.adConsent).toBe("granted");
    expect(saved.crashReports).toBe("declined"); // untouched
  });

  it("never asks in a build without Carbon codes, and shows no strip", async () => {
    vi.stubEnv("VITE_CARBON_SERVE", "");
    vi.stubEnv("VITE_CARBON_PLACEMENT", "");
    const h = await mountApp({
      settings: { adConsent: "unset" },
      entitlementReady: true,
    });
    await settle();
    expect(gate(h)).toBeNull();
    expect(h.ownerDocument.querySelector(".ad")).toBeNull();
    // Nothing was decided on the user's behalf either.
    const calls = settingsApi.saveSettings.mock.calls;
    expect(calls.every(([s]) => s.adConsent === "unset")).toBe(true);
  });

  it("stays shut until the entitlement is read", async () => {
    const h = await mountApp({ settings: { adConsent: "unset" } });
    await settle();
    expect(gate(h)).toBeNull();
  });

  it("never shows on a paid plan", async () => {
    setPlan("basic");
    const h = await mountApp({
      settings: { adConsent: "unset" },
      entitlementReady: true,
    });
    await settle();
    expect(gate(h)).toBeNull();
  });

  it("asks about crash reports on its own when unanswered", async () => {
    const h = await mountApp({
      settings: { adConsent: "granted", crashReports: "unset" },
    });
    await settle();
    expect(gate(h)).toBeNull();
    expect(h.ownerDocument.querySelector(".crash-consent")).not.toBeNull();
  });
});
