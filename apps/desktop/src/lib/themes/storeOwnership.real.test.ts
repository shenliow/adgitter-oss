/**
 * Theme-store purchases with the *real* backend (`VITE_STORE_MOCK=false`).
 *
 * Regression cover for the crash: Buy used to call `createCheckout` bare, so a
 * signed-out click (the everyday case in dev — macOS only registers the
 * `adgitter://` scheme for a packaged .app, so sign-in can't complete there)
 * rejected with `NOT_SIGNED_IN` and, with nobody catching it, became an
 * unhandled rejection that replaced the window with the crash screen.
 *
 * Driven through the real `checkoutFlow` + `ipc` with only the Tauri `invoke`
 * boundary faked, so this asserts the behaviour a user gets rather than which
 * helper called which. The module is imported dynamically because
 * `MOCK_STORE` is read once at module scope.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const CHECKOUT_URL = "https://checkout.polar.sh/co_1";
/** The tagged error shape Rust serializes when there is no license on disk. */
const notSignedIn = { code: "NOT_SIGNED_IN", message: "not signed in" };

async function realStore() {
  vi.resetModules();
  vi.stubEnv("VITE_STORE_MOCK", "false");
  return import("./storeOwnership.svelte");
}

function commands(): string[] {
  return invoke.mock.calls.map((c) => c[0] as string);
}

/**
 * The licence traffic only, with the dev-plan sync filtered out.
 *
 * `refreshEntitlement` pushes the effective dev plan override to the native
 * feature gate before it reads entitlement (see `lib/devPlan.svelte.ts`), so in
 * a dev build — which is what Vitest is — a `set_dev_plan` call sits between
 * the renew and the verify. That is a debug-only side effect and it is not what
 * these tests are about: the property here is that a fresh licence is fetched
 * from the server *before* entitlement is re-read, because the purchase whose
 * deep link never arrived exists only server-side. Filtering keeps that
 * assertion exact rather than loosening it to `toContain`.
 */
function licenceCommands(): string[] {
  return commands().filter((c) => c !== "set_dev_plan");
}

beforeEach(() => {
  invoke.mockReset();
  // No Clerk key: sign-in cannot even be started, which is exactly the dev
  // configuration the crash was reported from.
  vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("buyStoreTheme (real backend)", () => {
  it("uses the real backend when VITE_STORE_MOCK=false", async () => {
    const { MOCK_STORE } = await realStore();
    expect(MOCK_STORE).toBe(false);
  });

  it("reports 'sign-in unavailable' instead of crashing when signed out", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "create_checkout") throw notSignedIn;
      return undefined;
    });
    const { buyStoreTheme } = await realStore();

    // The assertion that matters: it *resolves*. Before the fix this rejected
    // with the raw `{code, message}` and nothing caught it.
    const result = await buyStoreTheme("blueprint");

    expect(result).toEqual({ status: "signin-unavailable" });
    // And it says so immediately — no waiting out the sign-in timeout.
    expect(commands()).toEqual(["create_checkout"]);
  });

  it("opens the hosted checkout when the backend has a license", async () => {
    invoke.mockImplementation(async (cmd: string) =>
      cmd === "create_checkout" ? CHECKOUT_URL : undefined,
    );
    const { buyStoreTheme } = await realStore();

    const result = await buyStoreTheme("blueprint");

    expect(result).toEqual({ status: "opened", url: CHECKOUT_URL });
    expect(commands()).toEqual(["create_checkout", "open_external_url"]);
  });

  it("reports a failed checkout instead of rejecting", async () => {
    invoke.mockImplementation(async () => {
      throw { code: "INTERNAL_ERROR", message: "polar not provisioned" };
    });
    const { buyStoreTheme } = await realStore();

    const result = await buyStoreTheme("blueprint");

    expect(result.status).toBe("failed");
  });

  it("never rejects, whatever the backend throws", async () => {
    for (const thrown of [
      notSignedIn,
      new Error("network down"),
      "plain string",
      { weird: true },
    ]) {
      invoke.mockImplementation(async () => {
        throw thrown;
      });
      const { buyStoreTheme } = await realStore();
      await expect(buyStoreTheme("blueprint")).resolves.toBeDefined();
    }
  });
});

describe("refreshOwnership (real backend)", () => {
  it("asks the server for a fresh licence before re-reading entitlement", async () => {
    // The purchase whose deep link never arrived exists only server-side, so
    // the offline verify can never see it on its own — renew has to come first.
    invoke.mockResolvedValue({ status: "active", plan: "basic" });
    const { refreshOwnership } = await realStore();

    await refreshOwnership();

    expect(licenceCommands()).toEqual(["renew_license", "verify_license"]);
    // The dev-plan sync really does run here, and runs before the verify — so
    // the filter above is hiding a known call, not papering over a missing one.
    expect(commands()).toEqual([
      "renew_license",
      "set_dev_plan",
      "verify_license",
    ]);
  });

  it("still re-reads entitlement, and does not reject, when the renew fails", async () => {
    // Offline / server down / rejected renew: silent and non-fatal,
    // falling back to whatever token is already on disk.
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "renew_license")
        throw { code: "INTERNAL_ERROR", message: "network down" };
      return { status: "active", plan: "basic" };
    });
    const { refreshOwnership } = await realStore();

    await expect(refreshOwnership()).resolves.toBeUndefined();

    expect(licenceCommands()).toEqual(["renew_license", "verify_license"]);
  });
});
