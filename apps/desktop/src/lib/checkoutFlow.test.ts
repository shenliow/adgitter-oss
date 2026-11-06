/**
 * Lazy sign-in checkout.
 *
 * Driven through the real `ipc` + `auth` modules with only the Tauri `invoke`
 * boundary faked, so what's asserted is the observable behaviour a user gets —
 * which native commands ran, in what order, and what the flow reports back —
 * rather than which internal helper called which.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
  startCheckout,
  startSubscriptionPortal,
  checkoutNotice,
  nextPlanAbove,
} from "./checkoutFlow";
import { signOut } from "./auth.svelte";
import type { LoopbackAuthResult } from "./ipc";

// pk for frontend API host "discrete-ibex-7.clerk.accounts.dev".
const DEV_KEY = "pk_test_ZGlzY3JldGUtaWJleC03LmNsZXJrLmFjY291bnRzLmRldiQ";
const CHECKOUT_URL = "https://checkout.polar.sh/co_1";
/**
 * A customer-portal URL. It embeds a `customer_session_token` that grants
 * billing management, so the flow opens it and discards it — never logs it.
 */
const PORTAL_URL =
  "https://sandbox.polar.sh/org/portal?customer_session_token=tok_secret";

/** The tagged error shape the Rust side serializes for a missing license. */
const notSignedIn = { code: "NOT_SIGNED_IN", message: "not signed in" };
/** …and for an account with no Polar customer on record (`/portal` → 404). */
const noSubscription = {
  code: "NO_SUBSCRIPTION",
  message: "no subscription found for this account",
};

/** The RFC 8252 loopback redirect Rust mints for a sign-in. */
const LOOPBACK_REDIRECT = "http://127.0.0.1:47821/callback?state=nonce-1";

/** Commands invoked so far, in order. */
function commands(): string[] {
  return invoke.mock.calls.map((c) => c[0] as string);
}

/**
 * Resolver for the loopback listener the app is currently waiting on — set
 * while `await_loopback_auth` is in flight, so a test can play the browser's
 * part. Null when no sign-in is parked.
 */
let settleCallback: ((result: LoopbackAuthResult) => void) | null = null;

/**
 * Install a fake backend, with the three loopback sign-in commands
 * (`loopback_auth.rs`) always answered the way Rust answers them and everything
 * else delegated to `handler`.
 *
 * Sign-in no longer round-trips through the `adgitter://` scheme — Clerk's
 * Account Portal refuses a custom-scheme `redirect_url` — so these flow tests
 * drive the real path: bind a loopback port, open the portal, wait for the
 * verified callback. (The scheme itself is still live for the payment return
 * and issue links; that routing is covered in `auth.svelte.test.ts`.)
 */
function backend(handler: (cmd: string) => unknown) {
  invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "start_loopback_auth") {
      return { redirectUrl: LOOPBACK_REDIRECT, state: "nonce-1", port: 47821 };
    }
    if (cmd === "await_loopback_auth") {
      return new Promise<LoopbackAuthResult>((r) => {
        settleCallback = r;
      });
    }
    if (cmd === "cancel_loopback_auth") {
      settleCallback?.({ params: {}, timedOut: false, cancelled: true });
      settleCallback = null;
      return undefined;
    }
    return handler(cmd);
  });
}

/**
 * Behave like a backend with no license: the first `create_checkout` is
 * rejected, every later one succeeds (as it would once a license is stored).
 */
function backendNeedingSignIn() {
  let checkouts = 0;
  backend((cmd) => {
    if (cmd === "create_checkout") {
      if (++checkouts === 1) throw notSignedIn;
      return CHECKOUT_URL;
    }
    if (cmd === "get_device_id") return "device-abc";
    if (cmd === "issue_license")
      return {
        status: "active",
        plan: "advance",
        error: null,
        expiresMs: null,
      };
    return undefined; // open_external_url
  });
}

/**
 * The browser round-trip: the loopback listener reports a callback whose
 * `state` it has already verified, exactly as Rust does at runtime.
 */
async function finishSignIn(
  result: LoopbackAuthResult = {
    params: { __clerk_db_jwt: "jwt-1" },
    timedOut: false,
    cancelled: false,
  },
) {
  await vi.waitFor(() => expect(settleCallback).not.toBeNull());
  settleCallback!(result);
  settleCallback = null;
}

beforeEach(() => {
  // Abandon (never settle) any listener a previous test left parked: settling
  // it would resolve that test's sign-in on a microtask inside *this* one.
  settleCallback = null;
  // Sign out first, then wipe the call log — `signOut` releases the loopback
  // port via `cancel_loopback_auth`, and that housekeeping call must not show
  // up in the `commands()` assertions below.
  signOut();
  invoke.mockReset();
  vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", DEV_KEY);
});
afterEach(() => vi.unstubAllEnvs());

describe("startCheckout — already signed in", () => {
  it("opens the hosted checkout without touching sign-in", async () => {
    backend((cmd) => (cmd === "create_checkout" ? CHECKOUT_URL : undefined));

    const result = await startCheckout("plan", "advance");

    expect(result).toEqual({ status: "opened", url: CHECKOUT_URL });
    expect(invoke).toHaveBeenCalledWith("create_checkout", {
      kind: "plan",
      id: "advance",
    });
    expect(invoke).toHaveBeenCalledWith("open_external_url", {
      url: CHECKOUT_URL,
    });
    expect(checkoutNotice(result)).toBeNull();
  });
});

describe("startCheckout — signed out (lazy sign-in)", () => {
  it("signs in and resumes the same purchase, with no second click", async () => {
    backendNeedingSignIn();

    const pending = startCheckout("theme", "aurora");
    // The browser is now at the Clerk portal; nothing else has happened yet.
    await vi.waitFor(() =>
      expect(
        invoke.mock.calls.some(
          (c) =>
            c[0] === "open_external_url" &&
            String(c[1].url).includes("/sign-in"),
        ),
      ).toBe(true),
    );

    await finishSignIn();
    const result = await pending;

    expect(result).toEqual({ status: "opened", url: CHECKOUT_URL });
    // The retried checkout is for the very same product the user clicked.
    const checkouts = invoke.mock.calls.filter(
      (c) => c[0] === "create_checkout",
    );
    expect(checkouts).toHaveLength(2);
    expect(checkouts[1][1]).toEqual({ kind: "theme", id: "aurora" });
    expect(invoke).toHaveBeenCalledWith("open_external_url", {
      url: CHECKOUT_URL,
    });
  });

  it("reports a cancelled sign-in and buys nothing", async () => {
    backendNeedingSignIn();

    const pending = startCheckout("theme", "aurora");
    await vi.waitFor(() => expect(commands()).toContain("open_external_url"));
    // The portal bounced back with an error (user cancelled / denied).
    await finishSignIn({
      params: { error: "access_denied" },
      timedOut: false,
      cancelled: false,
    });
    const result = await pending;

    expect(result).toEqual({ status: "cancelled", reason: "cancelled" });
    expect(checkoutNotice(result)).toBe("checkout.signInCancelled");
    expect(commands().filter((c) => c === "create_checkout")).toHaveLength(1);
  });

  it("gives up with a timeout instead of waiting forever", async () => {
    backendNeedingSignIn();

    const result = await startCheckout("plan", "advance", { timeoutMs: 1 });

    expect(result).toEqual({ status: "cancelled", reason: "timeout" });
    expect(checkoutNotice(result)).toBe("checkout.signInTimedOut");
    expect(commands().filter((c) => c === "create_checkout")).toHaveLength(1);
  });

  it("stops waiting when the caller aborts", async () => {
    backendNeedingSignIn();
    const ac = new AbortController();

    const pending = startCheckout("plan", "advance", { signal: ac.signal });
    await vi.waitFor(() => expect(commands()).toContain("open_external_url"));
    ac.abort();

    expect(await pending).toEqual({ status: "cancelled", reason: "cancelled" });
  });

  // A sign-in that comes back and fails must settle the parked purchase right
  // then — and say what actually happened. The service refused the sign-in; the
  // user did not cancel it, so `signin-failed` (not `cancelled`) is what the UI
  // is told. That it isn't `timeout` is the proof it settled promptly: the wait
  // is given a whole second here and doesn't use it.
  it("fails fast when the license service rejects the returning jwt", async () => {
    backend((cmd) => {
      if (cmd === "create_checkout") throw notSignedIn;
      if (cmd === "get_device_id") return "device-abc";
      if (cmd === "issue_license")
        return {
          status: "invalid",
          plan: null,
          error: "expired jwt",
          expiresMs: null,
        };
      return undefined;
    });

    const pending = startCheckout("plan", "advance", { timeoutMs: 1000 });
    await vi.waitFor(() => expect(commands()).toContain("open_external_url"));
    await finishSignIn({
      params: { token: "stale" },
      timedOut: false,
      cancelled: false,
    });
    const result = await pending;

    expect(result).toEqual({ status: "signin-failed" });
    // …and the user is told the truth about it, not "you cancelled".
    expect(checkoutNotice(result)).toBe("checkout.signInFailed");
    expect(commands().filter((c) => c === "create_checkout")).toHaveLength(1);
  });

  it("fails fast when this install has no usable device id", async () => {
    backend((cmd) => {
      if (cmd === "create_checkout") throw notSignedIn;
      if (cmd === "get_device_id")
        throw {
          code: "INTERNAL_ERROR",
          message: "could not persist device id",
        };
      return undefined;
    });

    const pending = startCheckout("plan", "advance", { timeoutMs: 1000 });
    await vi.waitFor(() => expect(commands()).toContain("open_external_url"));
    await finishSignIn({
      params: { token: "jwt-1" },
      timedOut: false,
      cancelled: false,
    });
    const result = await pending;

    expect(result).toEqual({ status: "signin-failed" });
    expect(checkoutNotice(result)).toBe("checkout.signInFailed");
    expect(commands()).not.toContain("issue_license");
  });

  it("says sign-in is unavailable when Clerk isn't configured", async () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "");
    backendNeedingSignIn();

    const result = await startCheckout("theme", "aurora");

    expect(result).toEqual({ status: "signin-unavailable" });
    expect(checkoutNotice(result)).toBe("checkout.signInUnavailable");
    // No browser was opened and no second checkout was attempted.
    expect(commands()).toEqual(["create_checkout"]);
  });
});

// The plan panel's Upgrade and the theme store's Buy have independent busy
// flags, so a user can have both parked on sign-in at once. They must share the
// one sign-in: a second `startSignIn` would clear the pending callback and open
// a second browser tab, and if it landed between the deep link arriving and its
// exchange, *neither* purchase would ever resume.
describe("startCheckout — a second entry point joins the sign-in in flight", () => {
  /** The `open_external_url` calls that pointed at the Clerk portal. */
  function portalOpens(): unknown[] {
    return invoke.mock.calls.filter(
      (c) =>
        c[0] === "open_external_url" && String(c[1].url).includes("/sign-in"),
    );
  }

  /**
   * A backend that rejects every checkout until a license has been issued —
   * unlike `backendNeedingSignIn`, which only rejects the first one, so a
   * *second* signed-out entry point is rejected too, as it would be at runtime.
   */
  function backendRejectingUntilLicensed(): { license: () => void } {
    let licensed = false;
    backend((cmd) => {
      if (cmd === "create_checkout") {
        if (!licensed) throw notSignedIn;
        return CHECKOUT_URL;
      }
      if (cmd === "get_device_id") return "device-abc";
      if (cmd === "issue_license") {
        licensed = true;
        return {
          status: "active",
          plan: "advance",
          error: null,
          expiresMs: null,
        };
      }
      return undefined;
    });
    return {
      license: () => {
        licensed = true;
      },
    };
  }

  it("both purchases resume from one sign-in, with one browser tab", async () => {
    backendRejectingUntilLicensed();
    // The first entry point (plan panel) parks on sign-in…
    const first = startCheckout("plan", "advance", { timeoutMs: 2000 });
    await vi.waitFor(() => expect(portalOpens()).toHaveLength(1));

    // …then the theme store starts one too, while that sign-in is still open.
    const second = startCheckout("theme", "aurora", { timeoutMs: 2000 });
    await vi.waitFor(() =>
      expect(
        invoke.mock.calls.filter((c) => c[0] === "create_checkout"),
      ).toHaveLength(2),
    );
    expect(portalOpens()).toHaveLength(1);

    // One round trip settles both, each resuming its own product.
    await finishSignIn();

    expect(await first).toEqual({ status: "opened", url: CHECKOUT_URL });
    expect(await second).toEqual({ status: "opened", url: CHECKOUT_URL });
    const products = invoke.mock.calls
      .filter((c) => c[0] === "create_checkout")
      .map((c) => c[1]);
    expect(products).toHaveLength(4); // two rejected attempts, two resumed
    expect(products.slice(2)).toEqual(
      expect.arrayContaining([
        { kind: "plan", id: "advance" },
        { kind: "theme", id: "aurora" },
      ]),
    );
    // Exactly one sign-in, one browser tab, one license exchange.
    expect(portalOpens()).toHaveLength(1);
    expect(commands().filter((c) => c === "issue_license")).toHaveLength(1);
  });

  it("does not discard the callback the first sign-in is about to exchange", async () => {
    // The exact interleaving that used to deadlock both waiters: the callback
    // has arrived and its exchange is in flight when the second entry point
    // reaches its sign-in decision. If that second call restarted sign-in it
    // would null the pending params out from under the exchange.
    let releaseExchange = () => {};
    const exchanging = new Promise<void>((r) => {
      releaseExchange = r;
    });
    let licensed = false;
    backend(async (cmd) => {
      if (cmd === "create_checkout") {
        if (!licensed) throw notSignedIn;
        return CHECKOUT_URL;
      }
      if (cmd === "get_device_id") return "device-abc";
      if (cmd === "issue_license") {
        await exchanging; // hold the exchange open across the second entry point
        licensed = true;
        return {
          status: "active",
          plan: "advance",
          error: null,
          expiresMs: null,
        };
      }
      return undefined;
    });

    const first = startCheckout("plan", "advance", { timeoutMs: 2000 });
    await vi.waitFor(() => expect(portalOpens()).toHaveLength(1));
    await finishSignIn();
    await vi.waitFor(() => expect(commands()).toContain("issue_license"));

    // Second entry point arrives mid-exchange.
    const second = startCheckout("theme", "aurora", { timeoutMs: 2000 });
    await vi.waitFor(() =>
      expect(
        invoke.mock.calls.filter((c) => c[0] === "create_checkout"),
      ).toHaveLength(2),
    );

    releaseExchange();

    expect(await first).toEqual({ status: "opened", url: CHECKOUT_URL });
    expect(await second).toEqual({ status: "opened", url: CHECKOUT_URL });
    expect(portalOpens()).toHaveLength(1);
  });
});

describe("startCheckout — other failures", () => {
  it("reports a rejected checkout without trying to sign in", async () => {
    invoke.mockRejectedValue({
      code: "INTERNAL_ERROR",
      message: "checkout rejected (503)",
    });

    const result = await startCheckout("plan", "advance");

    expect(result.status).toBe("failed");
    expect(checkoutNotice(result)).toBe("checkout.unavailable");
    expect(commands()).toEqual(["create_checkout"]);
  });

  it("reports a failure that happens after signing in", async () => {
    let checkouts = 0;
    backend((cmd) => {
      if (cmd === "create_checkout") {
        throw ++checkouts === 1
          ? notSignedIn
          : { code: "INTERNAL_ERROR", message: "polar down" };
      }
      if (cmd === "get_device_id") return "device-abc";
      if (cmd === "issue_license")
        return {
          status: "active",
          plan: "advance",
          error: null,
          expiresMs: null,
        };
      return undefined;
    });

    const pending = startCheckout("plan", "advance");
    await vi.waitFor(() => expect(commands()).toContain("open_external_url"));
    await finishSignIn();
    const result = await pending;

    expect(result.status).toBe("failed");
    expect(checkoutNotice(result)).toBe("checkout.unavailable");
  });
});

// ── Which tier an "Upgrade" buys ───────────────────────────────────────────

describe("nextPlanAbove", () => {
  // The defect this exists to prevent: a single generic "Upgrade" button that
  // charges someone for the tier they are already on. `PlanPanel.svelte` still
  // hardcodes `'advance'` and therefore still does exactly that to an
  // `advance` subscriber — reported, not fixed here.
  it("steps one tier up, and never sells the current tier back", () => {
    expect(nextPlanAbove("free")).toBe("basic");
    expect(nextPlanAbove("basic")).toBe("advance");
    expect(nextPlanAbove("advance")).toBe("enterprise");
    for (const p of ["free", "basic", "advance"] as const) {
      expect(nextPlanAbove(p)).not.toBe(p);
    }
  });

  // `null` is what makes the account menu swap to the portal, so it is the
  // top tier's defining property, not an error case.
  it("has nothing above enterprise", () => {
    expect(nextPlanAbove("enterprise")).toBeNull();
  });
});

// ── The customer portal (E-subscription-portal) ────────────────────────────
//
// The other half of the account menu's button. It is the same operation shape
// as a purchase — "resolve a hosted URL that needs an identity, then open it" —
// so it shares the lazy sign-in round trip rather than duplicating it, and
// these tests pin that it really does behave identically.

describe("startSubscriptionPortal", () => {
  /** Every URL handed to the system browser so far. */
  function openedUrls(): string[] {
    return invoke.mock.calls
      .filter((c) => c[0] === "open_external_url")
      .map((c) => String(c[1].url));
  }

  it("opens the portal with no arguments at all, when already signed in", async () => {
    backend((cmd) =>
      cmd === "create_customer_portal" ? PORTAL_URL : undefined,
    );

    const result = await startSubscriptionPortal();

    expect(result).toEqual({ status: "opened", url: PORTAL_URL });
    // No customer id, email or user id: the server derives the customer from
    // the verified licence subject, so there is nothing for this page to pass
    // and nothing it could get wrong.
    const calls = invoke.mock.calls.filter(
      (c) => c[0] === "create_customer_portal",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].slice(1)).toEqual([]); // invoked with no payload whatsoever
    expect(invoke).toHaveBeenCalledWith("open_external_url", {
      url: PORTAL_URL,
    });
    // Success says nothing — the browser opening is the feedback.
    expect(checkoutNotice(result)).toBeNull();
  });

  it("signs in and resumes the same portal request, with no second click", async () => {
    let attempts = 0;
    backend((cmd) => {
      if (cmd === "create_customer_portal") {
        if (++attempts === 1) throw notSignedIn;
        return PORTAL_URL;
      }
      if (cmd === "get_device_id") return "device-abc";
      if (cmd === "issue_license")
        return {
          status: "active",
          plan: "enterprise",
          error: null,
          expiresMs: null,
        };
      return undefined;
    });

    const pending = startSubscriptionPortal();
    await vi.waitFor(() =>
      expect(
        invoke.mock.calls.some(
          (c) =>
            c[0] === "open_external_url" &&
            String(c[1].url).includes("/sign-in"),
        ),
      ).toBe(true),
    );
    await finishSignIn();

    expect(await pending).toEqual({ status: "opened", url: PORTAL_URL });
    expect(
      invoke.mock.calls.filter((c) => c[0] === "create_customer_portal"),
    ).toHaveLength(2);
  });

  /**
   * A non-subscriber gets its own outcome and its own sentence. Collapsing it
   * into `failed` would tell a working server's user "the portal isn't
   * available right now", which is both false and unactionable.
   */
  it("reports no-subscription as its own outcome, not a failure", async () => {
    backend((cmd) => {
      if (cmd === "create_customer_portal") throw noSubscription;
      return undefined;
    });

    const result = await startSubscriptionPortal();

    expect(result).toEqual({ status: "no-subscription" });
    expect(checkoutNotice(result)).toBe("portal.noSubscription");
    // Nothing was opened, and no sign-in was attempted — a sign-in round trip
    // cannot conjure a subscription.
    expect(commands()).toEqual(["create_customer_portal"]);
  });

  /** A non-subscriber is the normal state of most users, not a fault to log. */
  it("does not log no-subscription as an error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    backend((cmd) => {
      if (cmd === "create_customer_portal") throw noSubscription;
      return undefined;
    });

    await startSubscriptionPortal();

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("reports a cancelled sign-in and opens no portal", async () => {
    backend((cmd) => {
      if (cmd === "create_customer_portal") throw notSignedIn;
      return undefined;
    });

    const pending = startSubscriptionPortal();
    await vi.waitFor(() => expect(commands()).toContain("open_external_url"));
    await finishSignIn({
      params: { error: "access_denied" },
      timedOut: false,
      cancelled: false,
    });
    const result = await pending;

    expect(result).toEqual({ status: "cancelled", reason: "cancelled" });
    expect(checkoutNotice(result)).toBe("checkout.signInCancelled");
    // The sign-in page was opened; the billing portal never was.
    expect(openedUrls()).not.toContain(PORTAL_URL);
    expect(openedUrls().some((u) => u.includes("/sign-in"))).toBe(true);
  });

  it("gives up with a timeout instead of waiting forever", async () => {
    backend((cmd) => {
      if (cmd === "create_customer_portal") throw notSignedIn;
      return undefined;
    });

    const result = await startSubscriptionPortal({ timeoutMs: 1 });

    expect(result).toEqual({ status: "cancelled", reason: "timeout" });
    expect(checkoutNotice(result)).toBe("checkout.signInTimedOut");
  });

  it("reports a genuine failure without trying to sign in", async () => {
    invoke.mockRejectedValue({
      code: "INTERNAL_ERROR",
      message: "portal rejected (503): NOT_CONFIGURED",
    });

    const result = await startSubscriptionPortal();

    expect(result.status).toBe("failed");
    expect(checkoutNotice(result)).toBe("checkout.unavailable");
    expect(commands()).toEqual(["create_customer_portal"]);
  });
});
