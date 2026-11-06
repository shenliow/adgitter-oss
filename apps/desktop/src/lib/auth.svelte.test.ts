import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./ipc", () => ({
  openExternalUrl: vi.fn(async () => {}),
  getDeviceId: vi.fn(async () => "device-abc"),
  issueLicense: vi.fn(async () => ({
    status: "active",
    plan: "advance",
    error: null,
    expiresMs: null,
  })),
  // RFC 8252 loopback redirect. The default `awaitLoopbackAuth` never
  // settles, which is exactly what "the user is off in the browser" looks like:
  // `startSignIn` parks at `signing-in` and the tests that care about the
  // round-trip resolve it themselves via `deferLoopbackCallback`.
  startLoopbackAuth: vi.fn(async () => ({
    redirectUrl: "http://127.0.0.1:47821/bridge?state=nonce-1",
    state: "nonce-1",
    port: 47821,
  })),
  awaitLoopbackAuth: vi.fn(() => new Promise<never>(() => {})),
  cancelLoopbackAuth: vi.fn(async () => {}),
  // Local credential destruction (sign-out). Defaults to a clean wipe.
  destroyLocalCredentials: vi.fn(async () => ({ tokenRemains: false })),
  // Offline, local Ed25519 verification of the persisted license — the only
  // call session restore makes. Defaults to "nothing stored".
  verifyLicense: vi.fn(async () => ({
    status: "invalid",
    plan: null,
    error: "no license token",
    expiresMs: null,
    features: [],
    ownedThemes: [],
    email: null,
  })),
  // The real server round-trip `refreshAccountProfile` makes. Defaults to a
  // rejection ("no network") so a test has to opt in to a successful renew —
  // the offline/no-op path must be what every *other* test observes.
  renewLicense: vi.fn(async () => {
    throw new Error("offline");
  }),
}));

// The payment-return re-check is exercised in `checkoutReturn.svelte.test.ts`;
// here we only care that deep-link *routing* reaches it (and never reaches it
// for the other two link shapes).
vi.mock("./checkoutReturn.svelte", () => ({
  handleCheckoutReturn: vi.fn(async () => ({ status: "pending" })),
}));

import {
  openExternalUrl,
  issueLicense,
  getDeviceId,
  startLoopbackAuth,
  awaitLoopbackAuth,
  cancelLoopbackAuth,
  destroyLocalCredentials,
  verifyLicense,
  renewLicense,
} from "./ipc";
import type { LicenseStatusDto, LoopbackAuthResult } from "./ipc";
import { handleCheckoutReturn } from "./checkoutReturn.svelte";
// The REAL prompt module (not mocked): these tests drive it the way the dialog
// does, so "eviction only ever follows a confirmation" is checked end to end
// through the code that actually runs.
import {
  seatPromptOpen,
  confirmSeatPrompt,
  cancelSeatPrompt,
  resetSeatPromptForTest,
} from "./deviceSeat.svelte";
import { loadAccountProfile, saveAccountProfile } from "./accountProfile";
import {
  clerkConfigured,
  clerkFrontendApi,
  clerkSignInUrl,
  startSignIn,
  signOut,
  signOutLeftCredentials,
  signInMock,
  authState,
  handleCallback,
  getPendingCallback,
  completeSignIn,
  requestedIssueId,
  clearRequestedIssue,
  getPendingCheckoutReturn,
  waitForSignIn,
  receiveDeepLink,
  restoreSession,
  refreshAccountProfile,
  REDIRECT_URL,
} from "./auth.svelte";
// The real entitlement store (its only dependency, `verifyLicense`, is mocked
// above): sign-out has to actually clear it, so asserting against a stub would
// prove nothing.
import { getPlan, hasFeature, ownedThemes, setPlan } from "./license.svelte";

// pk for frontend API host "discrete-ibex-7.clerk.accounts.dev"
const DEV_KEY = "pk_test_ZGlzY3JldGUtaWJleC03LmNsZXJrLmFjY291bnRzLmRldiQ";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

/** A `verify_license` DTO of the given status, with a plan when it is valid. */
function licenseDto(
  status: LicenseStatusDto["status"],
  plan: string | null = status === "invalid" ? null : "advance",
  profile: Partial<
    Pick<LicenseStatusDto, "email" | "name" | "avatarUrl" | "username">
  > = {},
): LicenseStatusDto {
  const valid = status !== "invalid";
  return {
    status,
    plan,
    error: status === "invalid" ? "expired" : null,
    expiresMs: status === "invalid" ? null : 9999999999999,
    features: [],
    ownedThemes: [],
    email: valid ? "ada@example.com" : null,
    name: null,
    avatarUrl: null,
    username: null,
    ...(valid ? profile : {}),
  };
}

/**
 * The loopback redirect Rust hands back in these tests. It points at the
 * **bridge** page, not a bare callback: the portal's redirect cannot carry a
 * session JWT, so the page has to fetch one and post it back.
 */
const LOOPBACK_REDIRECT = "http://127.0.0.1:47821/bridge?state=nonce-1";

/**
 * Arm `awaitLoopbackAuth` with a promise the test settles by hand, so the
 * browser round-trip can be driven step by step.
 */
function deferLoopbackCallback(): (result: LoopbackAuthResult) => void {
  let settle!: (result: LoopbackAuthResult) => void;
  const pending = new Promise<LoopbackAuthResult>((r) => (settle = r));
  mocked(awaitLoopbackAuth).mockReturnValueOnce(pending);
  return settle;
}

/** A callback that arrived and carried `params`. */
const received = (params: Record<string, string>): LoopbackAuthResult => ({
  params,
  timedOut: false,
  cancelled: false,
});

beforeEach(() => {
  mocked(openExternalUrl).mockClear();
  mocked(issueLicense).mockClear();
  mocked(getDeviceId).mockClear();
  mocked(getDeviceId).mockResolvedValue("device-abc");
  mocked(handleCheckoutReturn).mockClear();
  mocked(startLoopbackAuth).mockClear();
  mocked(startLoopbackAuth).mockResolvedValue({
    redirectUrl: LOOPBACK_REDIRECT,
    state: "nonce-1",
    port: 47821,
  });
  mocked(awaitLoopbackAuth).mockClear();
  mocked(awaitLoopbackAuth).mockReturnValue(new Promise<never>(() => {}));
  mocked(cancelLoopbackAuth).mockClear();
  mocked(verifyLicense).mockClear();
  mocked(verifyLicense).mockResolvedValue(licenseDto("invalid"));
  mocked(renewLicense).mockClear();
  mocked(renewLicense).mockRejectedValue(new Error("offline"));
  mocked(destroyLocalCredentials).mockClear();
  mocked(destroyLocalCredentials).mockResolvedValue({ tokenRemains: false });
  // The device-limit prompt is module state: a dialog left open by one case
  // would make the next case's `askToEvictOldestDevice` decline immediately.
  resetSeatPromptForTest();
  void signOut();
});
afterEach(() => vi.unstubAllEnvs());

describe("clerk config", () => {
  it("is not configured without a key", () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "");
    expect(clerkConfigured()).toBe(false);
    expect(clerkFrontendApi()).toBeNull();
    expect(clerkSignInUrl(LOOPBACK_REDIRECT)).toBeNull();
  });

  it("rejects a malformed key", () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "not-a-clerk-key");
    expect(clerkConfigured()).toBe(false);
  });

  it("is configured and decodes the frontend API host from a pk_test key", () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", DEV_KEY);
    expect(clerkConfigured()).toBe(true);
    expect(clerkFrontendApi()).toBe("discrete-ibex-7.clerk.accounts.dev");
  });

  it("derives the hosted Account Portal sign-in url around the given redirect", () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", DEV_KEY);
    const url = new URL(clerkSignInUrl(LOOPBACK_REDIRECT)!);
    expect(url.origin).toBe("https://discrete-ibex-7.accounts.dev");
    expect(url.pathname).toBe("/sign-in");
    expect(url.searchParams.get("redirect_url")).toBe(LOOPBACK_REDIRECT);
  });

  // The bug this flow exists to fix: the Account Portal silently ignores a
  // custom-scheme `redirect_url` and strands the user on the web page. The
  // scheme is still a live deep link for the *other* two shapes, so the
  // constant stays — it just must never reach Clerk again.
  it("never sends the custom scheme to Clerk as a redirect", async () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", DEV_KEY);
    await startSignIn();
    const sent = new URL(mocked(openExternalUrl).mock.calls[0][0] as string);
    const redirect = sent.searchParams.get("redirect_url")!;
    expect(redirect).not.toBe(REDIRECT_URL);
    expect(redirect.startsWith("http://127.0.0.1:")).toBe(true);
  });
});

describe("issue deep-link routing", () => {
  beforeEach(() => clearRequestedIssue());
  afterEach(() => clearRequestedIssue());

  it("captures the issue id from adgitter://issue/<id>", () => {
    expect(handleCallback("adgitter://issue/142")).toBe(true);
    expect(requestedIssueId()).toBe("142");
  });

  it("decodes a provider-scoped id", () => {
    expect(handleCallback("adgitter://issue/mock:1")).toBe(true);
    expect(requestedIssueId()).toBe("mock:1");
  });

  it("clears once consumed", () => {
    handleCallback("adgitter://issue/9");
    expect(requestedIssueId()).toBe("9");
    clearRequestedIssue();
    expect(requestedIssueId()).toBeNull();
  });

  it("does not treat the OAuth callback as an issue link", () => {
    expect(handleCallback("adgitter://callback?token=abc")).toBe(true);
    expect(requestedIssueId()).toBeNull();
  });

  it("ignores an empty issue id", () => {
    expect(handleCallback("adgitter://issue/")).toBe(false);
    expect(requestedIssueId()).toBeNull();
  });
});

describe("signInMock (dev mock API)", () => {
  it("forces a signed-in state with default and overridden fields", () => {
    signInMock();
    expect(authState().status).toBe("signed-in");
    expect(authState().user?.name).toBe("Dev User");
    expect(authState().user?.email).toBe("dev@adgitter.local");

    signInMock({ name: "Ada", email: "ada@x.dev", plan: "enterprise" });
    expect(authState().user).toMatchObject({
      name: "Ada",
      email: "ada@x.dev",
      plan: "enterprise",
    });
  });
});

// The app used to boot `signed-out` no matter how recently you had signed in:
// the license was written to the keychain and never read back. These pin the
// read-back — including the cases where a bad license must NOT look like one.
describe("restoreSession (startup)", () => {
  it("restores a signed-in session from an active license", async () => {
    mocked(verifyLicense).mockResolvedValue(licenseDto("active", "advance"));
    await expect(restoreSession()).resolves.toBe(true);
    expect(authState().status).toBe("signed-in");
    expect(authState().user?.plan).toBe("advance");
  });

  // An expired card is a billing problem, not a reason to log someone out.
  it("restores inside the grace window too", async () => {
    mocked(verifyLicense).mockResolvedValue(licenseDto("grace", "basic"));
    await expect(restoreSession()).resolves.toBe(true);
    expect(authState().status).toBe("signed-in");
    expect(authState().user?.plan).toBe("basic");
  });

  // Expired past grace, malformed, wrong signing key, bound to another
  // device — the backend folds every one of them into `invalid`, and none of
  // them may look like a session.
  it("stays signed out for an invalid, expired or foreign-device license", async () => {
    mocked(verifyLicense).mockResolvedValue(licenseDto("invalid"));
    await expect(restoreSession()).resolves.toBe(false);
    expect(authState().status).toBe("signed-out");
    expect(authState().user).toBeUndefined();
  });

  // Device binding is only re-checked if we ask for it: `verify_license`
  // defaults to a device-agnostic check, under which a `license.json` lifted
  // from another machine verifies perfectly.
  it("asks for the device binding to be re-checked", async () => {
    await restoreSession();
    expect(verifyLicense).toHaveBeenCalledWith(undefined, { pinDevice: true });
  });

  // The core of the design: the license is an Ed25519 blob checked against a
  // baked-in public key, so a launch with no network restores exactly as an
  // online one does. Any HTTP on this path is the bug.
  it("restores with no network at all", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    mocked(verifyLicense).mockResolvedValue(licenseDto("active", "advance"));
    await expect(restoreSession()).resolves.toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    // …and the *only* backend call was the local verification.
    expect(verifyLicense).toHaveBeenCalledTimes(1);
    expect(issueLicense).not.toHaveBeenCalled();
    expect(startLoopbackAuth).not.toHaveBeenCalled();
    expect(openExternalUrl).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  // No Tauri backend (tests, SSR, a broken store) must not throw out of boot.
  it("stays signed out and never throws when verification fails", async () => {
    mocked(verifyLicense).mockRejectedValue(new Error("no backend"));
    await expect(restoreSession()).resolves.toBe(false);
    expect(authState().status).toBe("signed-out");
  });

  // Restore is fire-and-forget on the startup path, so it can land after a
  // user has already started (or finished) a real sign-in. It must not reach
  // in behind either one.
  it("does not disturb a sign-in already in flight", async () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", DEV_KEY);
    await startSignIn();
    expect(authState().status).toBe("signing-in");
    mocked(verifyLicense).mockResolvedValue(licenseDto("active", "advance"));
    await restoreSession();
    expect(authState().status).toBe("signing-in");
    expect(verifyLicense).not.toHaveBeenCalled();
  });

  it("does not clobber a session that signed in mid-verification", async () => {
    let release!: (dto: LicenseStatusDto) => void;
    mocked(verifyLicense).mockReturnValue(
      new Promise<LicenseStatusDto>((r) => (release = r)),
    );
    const pending = restoreSession();
    signInMock({ name: "Ada", plan: "enterprise" });
    release(licenseDto("active", "advance"));
    await pending;
    expect(authState().user?.name).toBe("Ada");
    expect(authState().user?.plan).toBe("enterprise");
  });

  // The license carries a Clerk `subject` and a signed `email`
  // claim, but still no display name. So a restored session reports the real
  // address and leaves the name blank; a plausible-looking invented name (or a
  // raw `user_2…` id dressed up as one) would be worse than an honest dash.
  it("restores the real account email but invents no name", async () => {
    mocked(verifyLicense).mockResolvedValue(licenseDto("active", "advance"));
    await restoreSession();
    expect(authState().user?.email).toBe("ada@example.com");
    expect(authState().user?.name).toBeUndefined();
  });

  // A licence minted before the `email` claim existed carries none. It must
  // still restore the session (old tokens stay valid) — the panel just falls
  // back to its dash rather than showing something made up.
  it("restores a pre-email licence with no address at all", async () => {
    mocked(verifyLicense).mockResolvedValue({
      ...licenseDto("active", "advance"),
      email: null,
    });
    await restoreSession();
    expect(authState().status).toBe("signed-in");
    expect(authState().user?.email).toBeUndefined();
  });
});

describe("sign-in flow", () => {
  it("opens the system browser and parks at signing-in", async () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", DEV_KEY);
    await startSignIn();
    expect(openExternalUrl).toHaveBeenCalledWith(
      clerkSignInUrl(LOOPBACK_REDIRECT),
    );
    expect(authState().status).toBe("signing-in");
  });

  it("is a no-op when Clerk is not configured", async () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "");
    await startSignIn();
    expect(openExternalUrl).not.toHaveBeenCalled();
    // Nothing was started, so no port was bound either.
    expect(startLoopbackAuth).not.toHaveBeenCalled();
    expect(authState().status).toBe("signed-out");
  });

  it("falls back to signed-out if the browser fails to open", async () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", DEV_KEY);
    (openExternalUrl as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("no browser"),
    );
    await startSignIn();
    expect(authState().status).toBe("signed-out");
    // …and the loopback port is handed straight back rather than leaked.
    expect(cancelLoopbackAuth).toHaveBeenCalled();
  });
});

// The redirect mechanism itself (RFC 8252). Rust owns the listener and the
// `state` check; these cover the frontend's half of the contract.
describe("loopback sign-in redirect (RFC 8252)", () => {
  beforeEach(() => vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", DEV_KEY));

  it("asks Rust for a loopback redirect and hands it to Clerk verbatim", async () => {
    await startSignIn();

    expect(startLoopbackAuth).toHaveBeenCalledOnce();
    const sent = new URL(mocked(openExternalUrl).mock.calls[0][0] as string);
    expect(sent.origin).toBe("https://discrete-ibex-7.accounts.dev");
    // Verbatim, `?state=` and all — dropping the nonce would make the callback
    // unverifiable and Rust would refuse it.
    expect(sent.searchParams.get("redirect_url")).toBe(LOOPBACK_REDIRECT);
    expect(new URL(LOOPBACK_REDIRECT).hostname).toBe("127.0.0.1");
    expect(new URL(LOOPBACK_REDIRECT).searchParams.get("state")).toBe(
      "nonce-1",
    );
  });

  // Rust builds the bridge page and needs the instance's Frontend API host to
  // do it; the publishable key is the (public, already-bundled) thing that
  // encodes it. Passing it here is what keeps Rust from growing a second,
  // divergent copy of the env plumbing.
  it("hands Rust the publishable key so it can build the bridge page", async () => {
    await startSignIn();
    expect(startLoopbackAuth).toHaveBeenCalledWith(DEV_KEY);
  });

  it("takes a verified bridge token all the way to signed-in", async () => {
    const settle = deferLoopbackCallback();
    const pending = waitForSignIn();
    await startSignIn();
    expect(authState().status).toBe("signing-in");

    settle(received({ token: "jwt-loopback" }));

    expect(await pending).toBe("signed-in");
    expect(issueLicense).toHaveBeenCalledWith(
      "jwt-loopback",
      "device-abc",
      false,
    );
    expect(authState().user?.plan).toBe("advance");
    expect(getPendingCallback()).toBeNull();
  });

  // `__clerk_db_jwt` is Clerk's dev-browser *handshake* token, not a session
  // JWT: it is 31 characters with no dots, and `/license/issue` rejects it at
  // the JWKS check. It used to be first in `JWT_PARAMS`, which is exactly why
  // sign-in failed. Put it back in front and this must go red.
  it("prefers the bridge's session token over Clerk's handshake token", async () => {
    const settle = deferLoopbackCallback();
    const pending = waitForSignIn();
    await startSignIn();
    settle(
      received({ __clerk_db_jwt: "dvb_notajwt", token: "real.session.jwt" }),
    );

    expect(await pending).toBe("signed-in");
    expect(issueLicense).toHaveBeenCalledWith(
      "real.session.jwt",
      "device-abc",
      false,
    );
  });

  it("reports a timeout when the user never comes back", async () => {
    const settle = deferLoopbackCallback();
    const pending = waitForSignIn();
    await startSignIn();
    settle({ params: {}, timedOut: true, cancelled: false });

    expect(await pending).toBe("timeout");
    expect(authState().status).toBe("signed-out");
    expect(issueLicense).not.toHaveBeenCalled();
  });

  it("reports a cancellation when the listener was torn down", async () => {
    const settle = deferLoopbackCallback();
    const pending = waitForSignIn();
    await startSignIn();
    settle({ params: {}, timedOut: false, cancelled: true });

    expect(await pending).toBe("cancelled");
    expect(authState().status).toBe("signed-out");
    expect(issueLicense).not.toHaveBeenCalled();
  });

  it("reports the portal's own error as a cancellation", async () => {
    const settle = deferLoopbackCallback();
    const pending = waitForSignIn();
    await startSignIn();
    settle(received({ error: "access_denied" }));

    expect(await pending).toBe("cancelled");
    expect(getPendingCallback()).toBeNull();
    expect(issueLicense).not.toHaveBeenCalled();
  });

  // The bridge page reaching Clerk and finding nothing is not the user backing
  // out — they signed in and came back. Telling them "you cancelled" would be
  // untrue, and would hide a real breakage.
  it.each(["clerk_unavailable", "no_session", "no_token", "bridge_failed"])(
    "reports the bridge's own %s as a failure, not a cancellation",
    async (code) => {
      const settle = deferLoopbackCallback();
      const pending = waitForSignIn();
      await startSignIn();
      settle(received({ error: code }));

      expect(await pending).toBe("failed");
      expect(getPendingCallback()).toBeNull();
      expect(issueLicense).not.toHaveBeenCalled();
    },
  );

  // Every candidate port occupied: a real, reportable failure, and nothing may
  // be left waiting on a sign-in that never started.
  it("settles signed-out when no loopback port can be bound", async () => {
    mocked(startLoopbackAuth).mockRejectedValueOnce({
      code: "INTERNAL_ERROR",
      message: "sign-in needs a free local port but every candidate is in use",
    });
    const pending = waitForSignIn();
    await startSignIn();

    expect(await pending).toBe("failed");
    expect(openExternalUrl).not.toHaveBeenCalled();
    expect(authState().status).toBe("signed-out");
  });

  it("settles signed-out when the listener itself fails", async () => {
    mocked(awaitLoopbackAuth).mockRejectedValueOnce(new Error("no sign-in"));
    const pending = waitForSignIn();
    await startSignIn();

    expect(await pending).toBe("failed");
  });

  // A callback that lands after the user is already in must not knock them out
  // — the same replay guard `handleCallback` applies to a deep link.
  it("ignores a late callback once the sign-in already succeeded", async () => {
    const settle = deferLoopbackCallback();
    await startSignIn();
    signInMock({ plan: "enterprise" });

    settle(received({ token: "late-jwt" }));
    await Promise.resolve();
    await Promise.resolve();

    expect(authState().status).toBe("signed-in");
    expect(authState().user?.plan).toBe("enterprise");
    expect(issueLicense).not.toHaveBeenCalled();
  });

  // Signing out mid-flight must free the port, not leave it bound for minutes.
  it("releases the loopback port on sign-out", async () => {
    await startSignIn();
    mocked(cancelLoopbackAuth).mockClear();
    signOut();
    expect(cancelLoopbackAuth).toHaveBeenCalledOnce();
  });

  // Sign-in must keep working with no Tauri backend at all (tests, SSR): a
  // rejecting `cancelLoopbackAuth` must not turn sign-out into an unhandled
  // rejection.
  it("survives a backend that cannot cancel", async () => {
    mocked(cancelLoopbackAuth).mockRejectedValueOnce(new Error("no backend"));
    await expect(signOut()).resolves.toBeUndefined();
    expect(authState().status).toBe("signed-out");
  });
});

// ── Sign-out destroys the credentials, not just the view (2026-08-18) ────────
//
// The bug: sign-out reset `view` and nothing else, so the licence token stayed
// in the keychain. The app said "signed out" while paid features stayed
// unlocked and — the serious half — `git-core`'s fallback identity kept
// authoring commits as the signed-out account. Rust owns the destruction; what
// these pin is that this layer always *asks* for it and never makes the local
// sign-out contingent on the answer.

describe("sign-out destroys local credentials (2026-08-18)", () => {
  it("asks Rust to destroy the persisted licence and commit identity", async () => {
    signInMock({ email: "ada@example.com", plan: "advance" });
    // `beforeEach` signs out to reset state, which legitimately calls this too.
    mocked(destroyLocalCredentials).mockClear();

    await signOut();

    expect(destroyLocalCredentials).toHaveBeenCalledOnce();
    expect(authState().status).toBe("signed-out");
  });

  it("drops the cached entitlement so paid features re-lock immediately", async () => {
    // The frontend gate (`hasFeature`) reads this cache; leaving it populated
    // would keep every paid affordance lit until the next refresh, and Rust
    // would then refuse the click.
    setPlan("enterprise");
    await signOut();

    expect(getPlan()).toBe("free");
    expect(hasFeature("MultiWindow")).toBe(false);
    expect(ownedThemes()).toEqual([]);
  });

  // The acceptance condition that matters most operationally: the wipe is
  // local, so nothing about the network can stand between a user and signing
  // out. A backend that is missing, hung, or rejecting must still leave a
  // signed-out app.
  it("completes locally even when the backend call fails", async () => {
    mocked(destroyLocalCredentials).mockRejectedValueOnce(
      new Error("server unreachable"),
    );
    signInMock({ email: "ada@example.com", plan: "advance" });

    await expect(signOut()).resolves.toBeUndefined();
    expect(authState().status).toBe("signed-out");
    expect(getPlan()).toBe("free");
  });

  // A wipe that could not remove the token leaves paid features unlocked until
  // a restart. That is reported, not swallowed — the panel says so.
  it("reports a licence that survived the wipe", async () => {
    mocked(destroyLocalCredentials).mockResolvedValueOnce({
      tokenRemains: true,
    });
    await signOut();
    expect(signOutLeftCredentials()).toBe(true);

    // …and the flag does not stick around past a later clean sign-out.
    await signOut();
    expect(signOutLeftCredentials()).toBe(false);
  });

  it("reports nothing left behind after a clean wipe", async () => {
    await signOut();
    expect(signOutLeftCredentials()).toBe(false);
  });
});

describe("deep-link callback", () => {
  it("ignores non-adgitter and malformed urls", () => {
    expect(handleCallback("https://example.com/x")).toBe(false);
    expect(handleCallback("not a url")).toBe(false);
    expect(getPendingCallback()).toBeNull();
  });

  it("captures handshake params and holds at signing-in", () => {
    const ok = handleCallback("adgitter://callback?__clerk_handshake=abc123");
    expect(ok).toBe(true);
    expect(getPendingCallback()).toEqual({ __clerk_handshake: "abc123" });
    expect(authState().status).toBe("signing-in");
  });

  it("drops to signed-out on an error callback", () => {
    handleCallback("adgitter://callback?__clerk_handshake=abc123");
    const ok = handleCallback("adgitter://callback?error=access_denied");
    expect(ok).toBe(true);
    expect(getPendingCallback()).toBeNull();
    expect(authState().status).toBe("signed-out");
  });

  it("startSignIn clears a stale pending callback", async () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", DEV_KEY);
    handleCallback("adgitter://callback?__clerk_handshake=abc123");
    expect(getPendingCallback()).not.toBeNull();
    await startSignIn();
    expect(getPendingCallback()).toBeNull();
  });
});

describe("completeSignIn", () => {
  it("returns false when there is no pending callback", async () => {
    expect(await completeSignIn("dev-1")).toBe(false);
    expect(issueLicense).not.toHaveBeenCalled();
  });

  it("settles signed-out without a session jwt param", async () => {
    handleCallback("adgitter://callback?__clerk_handshake=abc123");
    expect(await completeSignIn("dev-1")).toBe(false);
    // Un-provisioned handshake: never fabricate a JWT — but don't leave the
    // app waiting on a sign-in that can't complete either.
    expect(issueLicense).not.toHaveBeenCalled();
    expect(authState().status).toBe("signed-out");
    // The params stay readable for diagnostics.
    expect(getPendingCallback()).not.toBeNull();
  });

  it("exchanges a session jwt and signs in on a valid license", async () => {
    handleCallback("adgitter://callback?__clerk_db_jwt=jwt-xyz");
    const ok = await completeSignIn("dev-1");
    expect(ok).toBe(true);
    expect(issueLicense).toHaveBeenCalledWith("jwt-xyz", "dev-1", false);
    expect(authState().status).toBe("signed-in");
    expect(authState().user?.plan).toBe("advance");
    expect(getPendingCallback()).toBeNull();
  });

  it("accepts the `token` param name too", async () => {
    handleCallback("adgitter://callback?token=jwt-2");
    expect(await completeSignIn("dev-1")).toBe(true);
    expect(issueLicense).toHaveBeenCalledWith("jwt-2", "dev-1", false);
  });

  it("settles signed-out on an invalid license", async () => {
    mocked(issueLicense).mockResolvedValueOnce({
      status: "invalid",
      plan: null,
      error: "device mismatch",
      expiresMs: null,
    });
    handleCallback("adgitter://callback?session=jwt-3");
    expect(await completeSignIn("dev-1")).toBe(false);
    expect(authState().status).toBe("signed-out");
  });

  it("settles signed-out (non-fatal) when the exchange throws", async () => {
    mocked(issueLicense).mockRejectedValueOnce(new Error("network"));
    handleCallback("adgitter://callback?token=jwt-4");
    expect(await completeSignIn("dev-1")).toBe(false);
    expect(authState().status).toBe("signed-out");
  });

  // The device id is this install's identity: the license is bound to it and
  // the plan's seats are counted by it, so it comes from Rust, not the page.
  it("binds the license to this install's device id by default", async () => {
    handleCallback("adgitter://callback?token=jwt-5");
    expect(await completeSignIn()).toBe(true);
    expect(issueLicense).toHaveBeenCalledWith("jwt-5", "device-abc", false);
    expect(authState().status).toBe("signed-in");
  });

  // ── Device-seat cap ────────────────────────────────────────────────────
  //
  // A full account refuses the sign-in with `DEVICE_SEAT_LIMIT`, having
  // changed nothing. The prompt is what turns that into a retry, and the
  // retry only ever happens after an explicit OK.

  it("offers the eviction prompt and signs in once the user confirms", async () => {
    mocked(issueLicense).mockRejectedValueOnce({
      code: "DEVICE_SEAT_LIMIT",
      message: "full",
    });
    handleCallback("adgitter://callback?token=jwt-seat-1");
    const pending = completeSignIn("dev-1");

    await vi.waitFor(() => expect(seatPromptOpen()).toBe(true));
    // Refused once, with eviction OFF, and not retried yet.
    expect(issueLicense).toHaveBeenCalledTimes(1);
    expect(issueLicense).toHaveBeenLastCalledWith("jwt-seat-1", "dev-1", false);

    confirmSeatPrompt();
    expect(await pending).toBe(true);
    expect(issueLicense).toHaveBeenLastCalledWith("jwt-seat-1", "dev-1", true);
    expect(authState().status).toBe("signed-in");
  });

  it("evicts nothing and settles signed-out when the user declines", async () => {
    mocked(issueLicense).mockRejectedValueOnce({
      code: "DEVICE_SEAT_LIMIT",
      message: "full",
    });
    handleCallback("adgitter://callback?token=jwt-seat-2");
    const pending = completeSignIn("dev-1");

    await vi.waitFor(() => expect(seatPromptOpen()).toBe(true));
    cancelSeatPrompt();

    expect(await pending).toBe(false);
    expect(issueLicense).toHaveBeenCalledTimes(1);
    expect(issueLicense).not.toHaveBeenCalledWith("jwt-seat-2", "dev-1", true);
    // Settled, not parked at `signing-in`: the account really is full, and
    // anything awaiting this sign-in must stop waiting.
    expect(authState().status).toBe("signed-out");
  });

  it("settles signed-out when the device id can't be obtained", async () => {
    mocked(getDeviceId).mockRejectedValueOnce(
      new Error("could not persist device id"),
    );
    handleCallback("adgitter://callback?token=jwt-6");
    expect(await completeSignIn()).toBe(false);
    expect(issueLicense).not.toHaveBeenCalled();
    expect(authState().status).toBe("signed-out");
  });
});

// The bridge now hands back a best-effort Clerk display profile alongside the
// token (name/email/avatar/username), and it has to be reconciled with the
// licence's own claims, persisted so it survives an offline restart, and
// cleared again at sign-out. See accountProfile.ts and the precedence
// comment in `completeSignIn`.
describe("display profile from the sign-in bridge (account-profile completion)", () => {
  it("lands a full display profile on the view and persists it", async () => {
    handleCallback(
      "adgitter://callback?token=jwt-p1&name=Ada%20Lovelace&avatar=https%3A%2F%2Fexample.com%2Fada.png&username=ada",
    );
    expect(await completeSignIn("dev-1")).toBe(true);
    expect(authState().user).toMatchObject({
      name: "Ada Lovelace",
      avatarUrl: "https://example.com/ada.png",
      username: "ada",
    });
    // Persisted so `restoreSession` can rehydrate it after an offline restart
    // — the licence itself never carries any of this.
    expect(loadAccountProfile()).toMatchObject({
      name: "Ada Lovelace",
      avatarUrl: "https://example.com/ada.png",
      username: "ada",
    });
  });

  it("falls back to the bridge's username for the display name when Clerk has no full name", async () => {
    handleCallback("adgitter://callback?token=jwt-p2&username=ada");
    expect(await completeSignIn("dev-1")).toBe(true);
    expect(authState().user?.name).toBe("ada");
  });

  // The licence's `status.email` is a server-signed claim and is what
  // `git-core` defaults commit authorship to — a loopback-supplied address
  // must never be able to win that over it.
  it("the licence's email wins over the bridge's when both are present", async () => {
    mocked(issueLicense).mockResolvedValueOnce({
      status: "active",
      plan: "advance",
      error: null,
      expiresMs: null,
      email: "licence@example.com",
    });
    handleCallback("adgitter://callback?token=jwt-p3&email=bridge@example.com");
    expect(await completeSignIn("dev-1")).toBe(true);
    expect(authState().user?.email).toBe("licence@example.com");
  });

  // Only reached for a licence minted before the email claim existed.
  it("falls back to the bridge's email when the licence carries none", async () => {
    handleCallback("adgitter://callback?token=jwt-p4&email=bridge@example.com");
    expect(await completeSignIn("dev-1")).toBe(true);
    expect(authState().user?.email).toBe("bridge@example.com");
  });

  // E-clerk-profile-sync: the licence's re-pinned name/avatarUrl/username
  // follow the same precedence as email — a loopback-supplied value must
  // never be able to win over the server-signed claim.
  it("the licence's name/avatarUrl/username win over the bridge's when both are present", async () => {
    mocked(issueLicense).mockResolvedValueOnce({
      status: "active",
      plan: "advance",
      error: null,
      expiresMs: null,
      email: null,
      name: "Licence Name",
      avatarUrl: "https://example.com/licence.png",
      username: "licence_user",
    });
    handleCallback(
      "adgitter://callback?token=jwt-p6&name=Bridge%20Name&avatar=https%3A%2F%2Fexample.com%2Fbridge.png&username=bridge_user",
    );
    expect(await completeSignIn("dev-1")).toBe(true);
    expect(authState().user).toMatchObject({
      name: "Licence Name",
      avatarUrl: "https://example.com/licence.png",
      username: "licence_user",
    });
  });

  // A stored/received `javascript:`/`http://` avatar must never reach an
  // `<img src>` — see accountProfile.ts's `sanitizeAvatarUrl`.
  it("rejects a non-https avatar url", async () => {
    handleCallback(
      "adgitter://callback?token=jwt-p5&avatar=http%3A%2F%2Fexample.com%2Fada.png",
    );
    expect(await completeSignIn("dev-1")).toBe(true);
    expect(authState().user?.avatarUrl).toBeUndefined();
    expect(loadAccountProfile()?.avatarUrl).toBeUndefined();
  });

  it("restoreSession re-hydrates name/avatar/username from the persisted profile", async () => {
    saveAccountProfile({
      name: "Ada",
      avatarUrl: "https://example.com/a.png",
      username: "ada",
    });
    mocked(verifyLicense).mockResolvedValue(licenseDto("active", "advance"));
    await expect(restoreSession()).resolves.toBe(true);
    expect(authState().user).toMatchObject({
      name: "Ada",
      avatarUrl: "https://example.com/a.png",
      username: "ada",
      // The licence's own email claim, from `licenseDto`, still wins.
      email: "ada@example.com",
    });
  });

  // E-clerk-profile-sync: the server re-pins name/avatarUrl/username into
  // every issued/renewed license the same way it always has for email — a
  // Clerk-side edit must reach a restored session, not just a fresh sign-in.
  it("restoreSession prefers the licence's re-pinned profile over a stale cached copy", async () => {
    saveAccountProfile({
      name: "Old Name",
      avatarUrl: "https://example.com/old.png",
      username: "old_user",
    });
    mocked(verifyLicense).mockResolvedValue(
      licenseDto("active", "advance", {
        name: "New Name",
        avatarUrl: "https://example.com/new.png",
        username: "new_user",
      }),
    );
    await expect(restoreSession()).resolves.toBe(true);
    expect(authState().user).toMatchObject({
      name: "New Name",
      avatarUrl: "https://example.com/new.png",
      username: "new_user",
    });
    // And the merged result is re-persisted, so the next (offline) restart
    // also sees the update without another licence round-trip.
    expect(loadAccountProfile()).toMatchObject({
      name: "New Name",
      avatarUrl: "https://example.com/new.png",
      username: "new_user",
    });
  });

  // A licence minted before these claims existed carries no name/avatar/
  // username at all — that absence must not erase what the cache remembers.
  it("restoreSession falls back to the cached profile when the licence carries no profile claims", async () => {
    saveAccountProfile({
      name: "Ada",
      avatarUrl: "https://example.com/a.png",
      username: "ada",
    });
    mocked(verifyLicense).mockResolvedValue(licenseDto("active", "advance"));
    await expect(restoreSession()).resolves.toBe(true);
    expect(authState().user).toMatchObject({
      name: "Ada",
      avatarUrl: "https://example.com/a.png",
      username: "ada",
    });
  });

  it("signOut clears the persisted display profile", async () => {
    saveAccountProfile({ name: "Ada", avatarUrl: "https://example.com/a.png" });
    expect(loadAccountProfile()).not.toBeNull();
    await signOut();
    expect(loadAccountProfile()).toBeNull();
  });
});

// The fetch half of the Clerk-account-changed sync: `restoreSession` and
// `completeSignIn` only ever see whatever license is already on disk;
// `refreshAccountProfile` is what actually asks the server (`renew_license`)
// so a Clerk-side edit reaches a long-lived signed-in session.
describe("refreshAccountProfile (Clerk-edit sync)", () => {
  it("is a no-op when signed out", async () => {
    await expect(refreshAccountProfile()).resolves.toBe(false);
    expect(renewLicense).not.toHaveBeenCalled();
  });

  // ── The startup device-seat ping ────────────────────────────────────────
  //
  // This renew IS the registration the startup flow performs: the server
  // bumps this device's `last_seen` as part of the seat check. So the cap is
  // enforced here, and the prompt has to be reachable from here.

  it("pings the server with eviction off — registration, not a swap", async () => {
    mocked(verifyLicense).mockResolvedValue(licenseDto("active", "advance"));
    await restoreSession();
    mocked(renewLicense).mockResolvedValueOnce(licenseDto("active", "advance"));

    await refreshAccountProfile();

    expect(renewLicense).toHaveBeenLastCalledWith(false);
  });

  it("prompts on a seat refusal and retries once the user confirms", async () => {
    mocked(verifyLicense).mockResolvedValue(licenseDto("active", "advance"));
    await restoreSession();
    mocked(renewLicense).mockRejectedValueOnce({
      code: "DEVICE_SEAT_LIMIT",
      message: "full",
    });
    mocked(renewLicense).mockResolvedValueOnce(licenseDto("active", "advance"));

    const pending = refreshAccountProfile();
    await vi.waitFor(() => expect(seatPromptOpen()).toBe(true));
    expect(renewLicense).toHaveBeenCalledTimes(1);
    expect(renewLicense).toHaveBeenLastCalledWith(false);

    confirmSeatPrompt();
    await expect(pending).resolves.toBe(true);
    expect(renewLicense).toHaveBeenLastCalledWith(true);
  });

  // Offline-first again: a declined prompt is just another silent failure. The
  // cached licence keeps working and the cap is re-checked next time.
  it("evicts nothing, and says nothing, when the user declines", async () => {
    mocked(verifyLicense).mockResolvedValue(licenseDto("active", "advance"));
    await restoreSession();
    saveAccountProfile({ name: "Ada" });
    const before = authState();
    mocked(renewLicense).mockRejectedValueOnce({
      code: "DEVICE_SEAT_LIMIT",
      message: "full",
    });

    const pending = refreshAccountProfile();
    await vi.waitFor(() => expect(seatPromptOpen()).toBe(true));
    cancelSeatPrompt();

    await expect(pending).resolves.toBe(false);
    expect(renewLicense).toHaveBeenCalledTimes(1);
    expect(renewLicense).not.toHaveBeenCalledWith(true);
    expect(authState()).toBe(before);
    expect(authState().status).toBe("signed-in");
    expect(loadAccountProfile()).toMatchObject({ name: "Ada" });
  });

  // The offline launch, which is the common case the prompt must never
  // hijack: no network is NOT a seat refusal, so nothing is asked and nothing
  // is shown. The app simply carries on from the cached licence.
  it("shows no prompt at all when the ping is merely unavailable", async () => {
    mocked(verifyLicense).mockResolvedValue(licenseDto("active", "advance"));
    await restoreSession();
    for (const failure of [
      new Error("offline"),
      { code: "INTERNAL_ERROR", message: "license renew failed" },
      { code: "NOT_SIGNED_IN", message: "nothing to renew" },
    ]) {
      mocked(renewLicense).mockRejectedValueOnce(failure);
      await expect(refreshAccountProfile()).resolves.toBe(false);
      expect(seatPromptOpen()).toBe(false);
      expect(authState().status).toBe("signed-in");
    }
  });

  // Non-negotiable: offline, server-down, or a rejected renew must
  // leave the existing session and cached profile exactly as they were — no
  // error, no sign-out, no profile loss.
  it("silently leaves the session and cached profile untouched when the renew fails", async () => {
    mocked(verifyLicense).mockResolvedValue(licenseDto("active", "advance"));
    await restoreSession();
    saveAccountProfile({ name: "Ada", avatarUrl: "https://example.com/a.png" });
    const before = authState();
    mocked(renewLicense).mockRejectedValueOnce(new Error("offline"));

    await expect(refreshAccountProfile()).resolves.toBe(false);

    expect(authState()).toBe(before);
    expect(authState().status).toBe("signed-in");
    expect(loadAccountProfile()).toMatchObject({
      name: "Ada",
      avatarUrl: "https://example.com/a.png",
    });
  });

  // `refreshAccountProfile` fires on the Account panel's own mount, and Sign
  // out lives on that same panel — so "the user signs out while the refresh is
  // still in flight" is an ordinary sequence, not a theoretical race. Landing
  // afterwards would re-save a profile `clearAccountProfile` just dropped and
  // flip the view back to signed-in.
  it("does not resurrect the session when a sign-out lands mid-refresh", async () => {
    mocked(verifyLicense).mockResolvedValue(licenseDto("active", "advance"));
    await restoreSession();
    saveAccountProfile({ name: "Ada" });
    mocked(renewLicense).mockResolvedValueOnce(
      licenseDto("active", "advance", { name: "New Name" }),
    );
    // The entitlement refresh re-verifies the licence; sign out exactly then.
    mocked(verifyLicense).mockImplementationOnce(async () => {
      await signOut();
      return licenseDto("active", "advance");
    });

    await expect(refreshAccountProfile()).resolves.toBe(false);

    expect(authState().status).toBe("signed-out");
    expect(loadAccountProfile()).toBeNull();
  });

  it("merges a Clerk-side profile edit over the cached copy and persists it", async () => {
    mocked(verifyLicense).mockResolvedValue(licenseDto("active", "advance"));
    await restoreSession();
    saveAccountProfile({ name: "Old Name", username: "old_user" });
    mocked(renewLicense).mockResolvedValueOnce(
      licenseDto("active", "advance", {
        name: "New Name",
        username: "new_user",
      }),
    );

    await expect(refreshAccountProfile()).resolves.toBe(true);

    expect(authState().user).toMatchObject({
      name: "New Name",
      username: "new_user",
    });
    expect(loadAccountProfile()).toMatchObject({
      name: "New Name",
      username: "new_user",
    });
  });

  // A renew that resolves (rather than rejects) but comes back `invalid`
  // carries no license-side profile and must not be read as "downgrade to
  // free" — the still-valid plan the session already had must survive.
  it("never downgrades the plan when the renewed license comes back invalid", async () => {
    mocked(verifyLicense).mockResolvedValue(licenseDto("active", "advance"));
    await restoreSession();
    mocked(renewLicense).mockResolvedValueOnce(licenseDto("invalid"));

    await expect(refreshAccountProfile()).resolves.toBe(false);

    expect(authState().user?.plan).toBe("advance");
  });

  // A plan upgraded on the web must not be silently dropped just because
  // this refresh was prompted by a stale display profile.
  it("keeps the entitlement store's plan and features in sync with the renewed license", async () => {
    mocked(verifyLicense).mockResolvedValue(licenseDto("active", "advance"));
    await restoreSession();
    // Entitlement (`license.svelte.ts`) is a separate store from the auth
    // view and is only ever populated by `refreshEntitlement` — seed it here
    // to the *pre*-refresh tier so the assertion below actually exercises the
    // sync rather than starting from the right answer by coincidence.
    setPlan("basic");
    expect(getPlan()).toBe("basic");
    mocked(renewLicense).mockResolvedValueOnce({
      ...licenseDto("active", "advance"),
      features: ["NoAd"],
    });
    // `refreshEntitlement` re-derives via its own `verify_license` call,
    // reading whatever Rust just persisted from the renew above.
    mocked(verifyLicense).mockResolvedValueOnce({
      ...licenseDto("active", "advance"),
      features: ["NoAd"],
    });

    await expect(refreshAccountProfile()).resolves.toBe(true);

    expect(getPlan()).toBe("advance");
    expect(hasFeature("NoAd")).toBe(true);
  });

  // Same guard `restoreSession` already has: a state change across the await
  // (here, a sign-out landing mid-request) must not be clobbered by a refresh
  // that started before it.
  it("does not resurrect a session that signed out mid-refresh", async () => {
    mocked(verifyLicense).mockResolvedValue(licenseDto("active", "advance"));
    await restoreSession();
    let release!: (dto: LicenseStatusDto) => void;
    mocked(renewLicense).mockReturnValueOnce(
      new Promise<LicenseStatusDto>((r) => (release = r)),
    );

    const pending = refreshAccountProfile();
    await signOut();
    release(licenseDto("active", "advance", { name: "Should Not Apply" }));

    await expect(pending).resolves.toBe(false);
    expect(authState().status).toBe("signed-out");
  });
});

// The step that closes the login loop: a returning `adgitter://` URL is routed
// AND exchanged, with no further prompting.
describe("receiveDeepLink", () => {
  it("takes a returning callback all the way to signed-in", async () => {
    await startSignIn();
    await receiveDeepLink("adgitter://callback?__clerk_db_jwt=jwt-7");

    expect(issueLicense).toHaveBeenCalledWith("jwt-7", "device-abc", false);
    expect(authState().status).toBe("signed-in");
    expect(authState().user?.plan).toBe("advance");
    expect(getPendingCallback()).toBeNull();
  });

  it("settles signed-out when the license service rejects the jwt", async () => {
    mocked(issueLicense).mockResolvedValueOnce({
      status: "invalid",
      plan: null,
      error: "expired jwt",
      expiresMs: null,
    });
    await startSignIn();
    await receiveDeepLink("adgitter://callback?token=stale");

    expect(authState().status).toBe("signed-out");
  });

  it("leaves an issue deep link alone (no license exchange)", async () => {
    await receiveDeepLink("adgitter://issue/142");

    expect(requestedIssueId()).toBe("142");
    expect(issueLicense).not.toHaveBeenCalled();
  });

  it("ignores a url that isn't ours", async () => {
    await receiveDeepLink("https://example.com/callback?token=x");
    expect(issueLicense).not.toHaveBeenCalled();
    expect(authState().status).toBe("signed-out");
  });

  it("routes a payment return to the licence re-check", async () => {
    await receiveDeepLink("adgitter://checkout-complete");

    expect(handleCheckoutReturn).toHaveBeenCalledTimes(1);
    // Not a sign-in: no exchange, no state change, nothing left pending.
    expect(issueLicense).not.toHaveBeenCalled();
    expect(getPendingCallback()).toBeNull();
    expect(getPendingCheckoutReturn()).toBe(false);
  });

  it("never re-checks the licence for the other two link shapes", async () => {
    await startSignIn();
    await receiveDeepLink("adgitter://callback?__clerk_db_jwt=jwt-7");
    await receiveDeepLink("adgitter://issue/142");
    await receiveDeepLink("https://example.com/checkout-complete");

    expect(handleCheckoutReturn).not.toHaveBeenCalled();
  });
});

// Polar's `POLAR_SUCCESS_URL`. Any web page can navigate to this scheme, so
// routing it must be inert on its own: it flags "go ask the server" and nothing
// else. What the server then says is `checkoutReturn.svelte.ts`'s business.
describe("checkout-complete deep link (payment return)", () => {
  it("is recognised and flagged for a licence re-check", () => {
    expect(handleCallback("adgitter://checkout-complete")).toBe(true);
    expect(getPendingCheckoutReturn()).toBe(true);
  });

  it("leaves a signed-in session exactly as it was", () => {
    signInMock({ plan: "free" });
    handleCallback("adgitter://checkout-complete");

    expect(authState().status).toBe("signed-in");
    expect(authState().user?.plan).toBe("free");
  });

  it("cannot sign anyone in, whatever it carries", () => {
    // A hostile page dressing the link up as an auth callback: the params are
    // not read, so nothing is captured for an exchange and the user stays out.
    expect(
      handleCallback(
        "adgitter://checkout-complete?__clerk_db_jwt=forged&plan=enterprise&theme=synthwave",
      ),
    ).toBe(true);
    expect(getPendingCallback()).toBeNull();
    expect(authState().status).toBe("signed-out");
  });
});

// The awaitable half of the sign-in round-trip: what lets a deferred sign-in
// resume the action that triggered it (see checkoutFlow).
describe("waitForSignIn", () => {
  it("resolves immediately when already signed in", async () => {
    signInMock();
    expect(await waitForSignIn()).toBe("signed-in");
  });

  it("resolves once the callback round-trip completes", async () => {
    const pending = waitForSignIn();
    await startSignIn();
    handleCallback("adgitter://callback?__clerk_db_jwt=jwt-9");
    await completeSignIn("dev-1");
    expect(await pending).toBe("signed-in");
  });

  it("reports cancellation when the portal comes back with an error", async () => {
    const pending = waitForSignIn();
    await startSignIn();
    handleCallback("adgitter://callback?error=access_denied");
    expect(await pending).toBe("cancelled");
  });

  it("reports cancellation when the caller aborts", async () => {
    const ac = new AbortController();
    const pending = waitForSignIn({ signal: ac.signal });
    await startSignIn();
    ac.abort();
    expect(await pending).toBe("cancelled");
  });

  it("times out instead of waiting forever", async () => {
    const pending = waitForSignIn({ timeoutMs: 1 });
    await startSignIn();
    expect(await pending).toBe("timeout");
  });

  // "Cancelled" and "failed" both end at signed-out, but only one of them is
  // the user's doing — telling someone they cancelled a sign-in the service
  // actually refused is simply wrong.
  it("distinguishes a refused sign-in from a cancelled one", async () => {
    mocked(issueLicense).mockResolvedValueOnce({
      status: "invalid",
      plan: null,
      error: "expired jwt",
      expiresMs: null,
    });
    const pending = waitForSignIn();
    await startSignIn();
    await receiveDeepLink("adgitter://callback?token=stale");
    expect(await pending).toBe("failed");
  });

  it("reports a failure when the exchange can't reach the service", async () => {
    mocked(issueLicense).mockRejectedValueOnce(new Error("offline"));
    const pending = waitForSignIn();
    await startSignIn();
    await receiveDeepLink("adgitter://callback?token=jwt-off");
    expect(await pending).toBe("failed");
  });

  it("reports a failure when the callback carries no session jwt", async () => {
    const pending = waitForSignIn();
    await startSignIn();
    await receiveDeepLink("adgitter://callback?__clerk_handshake=abc123");
    expect(await pending).toBe("failed");
  });

  // A fresh attempt must not inherit the previous one's verdict.
  it("a later cancellation after an earlier failure still reads as cancelled", async () => {
    mocked(issueLicense).mockRejectedValueOnce(new Error("offline"));
    await startSignIn();
    await receiveDeepLink("adgitter://callback?token=jwt-off");

    const pending = waitForSignIn();
    await startSignIn();
    handleCallback("adgitter://callback?error=access_denied");
    expect(await pending).toBe("cancelled");
  });

  it("reads a deliberate sign-out as cancelled, not failed", async () => {
    mocked(issueLicense).mockRejectedValueOnce(new Error("offline"));
    await startSignIn();
    await receiveDeepLink("adgitter://callback?token=jwt-off");

    const pending = waitForSignIn();
    await startSignIn();
    signOut();
    expect(await pending).toBe("cancelled");
  });
});

// Only *sign-in* moved to loopback. The `adgitter://` scheme is still
// registered and still carries the post-payment return and issue links, both of
// which are known-working in a packaged build — a regression there would be
// invisible until someone actually paid.
describe("the adgitter:// scheme survives the loopback migration", () => {
  it("still routes a payment return to the licence re-check", async () => {
    await receiveDeepLink("adgitter://checkout-complete");
    expect(handleCheckoutReturn).toHaveBeenCalledTimes(1);
    // Never a sign-in, and never a loopback listener.
    expect(startLoopbackAuth).not.toHaveBeenCalled();
    expect(issueLicense).not.toHaveBeenCalled();
  });

  it("still routes an issue deep link", async () => {
    await receiveDeepLink("adgitter://issue/mock:42");
    expect(requestedIssueId()).toBe("mock:42");
    expect(startLoopbackAuth).not.toHaveBeenCalled();
    clearRequestedIssue();
  });

  // Kept for an already-installed build whose browser still holds the old
  // portal URL: an arriving `adgitter://callback` must still complete.
  it("still completes a legacy custom-scheme auth callback", async () => {
    await receiveDeepLink(`${REDIRECT_URL}?__clerk_db_jwt=legacy-jwt`);
    expect(issueLicense).toHaveBeenCalledWith(
      "legacy-jwt",
      "device-abc",
      false,
    );
    expect(authState().status).toBe("signed-in");
  });
});

// A launch URL can be handed to the app twice — `initDeepLinks` reads it via
// `getCurrent()` and the OS may also deliver it through `onOpenUrl`. Replaying
// it must not undo a sign-in that already succeeded.
describe("replayed auth callbacks", () => {
  it("ignores a callback that arrives after the sign-in already succeeded", async () => {
    const url = "adgitter://callback?__clerk_db_jwt=jwt-launch";
    await startSignIn();
    await receiveDeepLink(url);
    expect(authState().status).toBe("signed-in");
    expect(issueLicense).toHaveBeenCalledTimes(1);

    // The same launch URL, delivered a second time.
    await receiveDeepLink(url);

    expect(authState().status).toBe("signed-in");
    expect(authState().user?.plan).toBe("advance");
    // No second exchange, and nothing left pending to exchange later.
    expect(issueLicense).toHaveBeenCalledTimes(1);
    expect(getPendingCallback()).toBeNull();
  });

  it("ignores a stale error callback once signed in", async () => {
    signInMock();
    expect(handleCallback("adgitter://callback?error=access_denied")).toBe(
      true,
    );
    expect(authState().status).toBe("signed-in");
  });

  // The guard is about *auth* callbacks only — issue deep links still route.
  it("still routes an issue deep link while signed in", async () => {
    signInMock();
    await receiveDeepLink("adgitter://issue/77");
    expect(requestedIssueId()).toBe("77");
    clearRequestedIssue();
  });
});
