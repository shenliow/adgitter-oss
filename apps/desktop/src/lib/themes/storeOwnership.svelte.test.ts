/**
 * Theme-store ownership with the *mock* backend.
 *
 * The env is pinned rather than inherited. Vitest runs through the Vite
 * config, so it loads the repo-root `.env` — and a developer who sets
 * `VITE_STORE_MOCK=false` there to exercise real checkout against a deployed
 * API used to silently fail these tests with "expected false to be true",
 * which points at nothing. `storeOwnership.real.test.ts` pins the other direction
 * for the same reason.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { resolveGraphThemePack } from "../graphTheme";

// The Tauri boundary is faked so mock mode's "never touches the network"
// promise is an assertion rather than a claim — `refreshOwnership` gained a
// real-mode licence renew, and mock mode must stay entirely local.
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

vi.stubEnv("VITE_STORE_MOCK", "true");
const {
  MOCK_STORE,
  ownsStoreTheme,
  isPurchasable,
  canPurchase,
  buyStoreTheme,
  refreshOwnership,
  __resetMockOwnership,
} = await import("./storeOwnership.svelte");

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("storeOwnership (mock ownership)", () => {
  beforeEach(() => {
    invoke.mockReset();
    __resetMockOwnership();
  });

  it("defaults to the mock backend under test", () => {
    expect(MOCK_STORE).toBe(true);
    // Mock can always take payment (no checkout URL needed).
    expect(canPurchase()).toBe(true);
  });

  it("free built-ins (no price) are always owned and never purchasable", () => {
    const def = resolveGraphThemePack("default");
    expect(def.priceUsd).toBeUndefined();
    expect(ownsStoreTheme("default")).toBe(true);
    expect(ownsStoreTheme("midnight")).toBe(true);
    expect(isPurchasable(def)).toBe(false);
  });

  it("grants locally — no checkout, and the grant is persisted", async () => {
    // Mock mode must stay exactly as it was after the real path moved onto the
    // shared checkout flow: instant ownership, nothing sent anywhere.
    const result = await buyStoreTheme("blueprint");

    expect(result).toEqual({ status: "granted" });
    expect(ownsStoreTheme("blueprint")).toBe(true);
    expect(
      JSON.parse(localStorage.getItem("adgitter.mockOwnedGraphThemes") ?? "[]"),
    ).toContain("blueprint");
  });

  it("refreshes from local storage alone — no licence renew, no network", async () => {
    // Real mode renews the licence here to recover a purchase whose deep link
    // never arrived. Mock mode has no server to recover from, and a dev box
    // with no Polar configuration must keep a working shop.
    localStorage.setItem(
      "adgitter.mockOwnedGraphThemes",
      JSON.stringify(["blueprint"]),
    );

    await refreshOwnership();

    expect(ownsStoreTheme("blueprint")).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });
});
