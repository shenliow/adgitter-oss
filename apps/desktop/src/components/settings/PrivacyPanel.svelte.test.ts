import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";

const lic = vi.hoisted(() => ({ plan: "free" }));
vi.mock("../../lib/license.svelte", () => ({ getPlan: () => lic.plan }));

import PrivacyPanel from "./PrivacyPanel.svelte";
import type { AdConsent, CrashConsent } from "../../lib/settings";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;
// An ad build unless a test says otherwise (lib/ads/config.ts).
beforeEach(() => {
  vi.stubEnv("VITE_CARBON_SERVE", "TEST");
  vi.stubEnv("VITE_CARBON_PLACEMENT", "adgitter");
});
afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  lic.plan = "free";
  vi.unstubAllEnvs();
});

function render(state: { adConsent: AdConsent; crashReports: CrashConsent }) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const props = $state(state);
  app = mount(PrivacyPanel, { target: host, props });
  flushSync();
  return { h: host, props };
}

describe("PrivacyPanel", () => {
  it("toggles crash reports on its own", () => {
    const { h, props } = render({
      adConsent: "granted",
      crashReports: "unset",
    });
    const box = h.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    expect(box.checked).toBe(false);
    box.click();
    flushSync();
    expect(props.crashReports).toBe("granted");
    expect(props.adConsent).toBe("granted");
    box.click();
    flushSync();
    expect(props.crashReports).toBe("declined");
  });

  it("lets a free user withdraw ad consent, saying what follows", () => {
    const { h, props } = render({
      adConsent: "granted",
      crashReports: "unset",
    });
    expect(h.textContent).toContain("switch to a paid plan");
    h.querySelector<HTMLButtonElement>(".btn")!.click();
    flushSync();
    expect(props.adConsent).toBe("declined");
  });

  it("has no ad row at all in a build without ads", () => {
    vi.stubEnv("VITE_CARBON_SERVE", "");
    const { h, props } = render({
      adConsent: "granted",
      crashReports: "unset",
    });
    expect(h.querySelector(".ads")).toBeNull();
    expect(h.querySelector(".btn")).toBeNull();
    expect(h.textContent).not.toContain("Carbon");
    // Crash reports are unaffected.
    expect(h.querySelector("input[type=checkbox]")).not.toBeNull();
    expect(props.adConsent).toBe("granted");
  });

  it("has nothing to withdraw on a paid plan", () => {
    lic.plan = "basic";
    const { h } = render({ adConsent: "granted", crashReports: "unset" });
    expect(h.querySelector(".btn")).toBeNull();
    expect(h.textContent).toContain("Paid plans show no ads");
  });
});
