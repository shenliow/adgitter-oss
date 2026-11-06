/**
 * Lazy sign-in checkout.
 *
 * Core features never ask for an account — Clerk bills by MAU, so an account
 * per free user would burn the quota on people who will never pay. Identity is
 * therefore demanded at exactly one moment: the click that starts a purchase.
 *
 * That makes the "not signed in" case the *normal* first-purchase path, not an
 * error, so this helper handles it end-to-end and the user still only clicks
 * once:
 *
 *   createCheckout → NOT_SIGNED_IN → startSignIn → wait → createCheckout again
 *
 * The retry is what "automatic continuation" means: after the browser round
 * trip the original purchase resumes by itself. Every other ending (sign-in
 * cancelled, timed out, refused, unavailable, checkout rejected) resolves to a distinct
 * {@link CheckoutResult} with its own message — this function never rejects and
 * never hangs, so a caller can always drop its loading state and say what
 * happened.
 *
 * {@link startSubscriptionPortal} rides the *same* round trip for the other
 * half of the account menu's button: at the top tier there is nothing left to
 * buy, so the button opens Polar's customer portal instead (cancel, change
 * payment method, invoices). It is the same shape of operation — "resolve a
 * hosted URL that needs an identity, then open it" — so it shares
 * {@link openWithLazySignIn} rather than duplicating the sign-in dance, and
 * inherits the guarantee that a cancelled sign-in can never leave a button
 * stuck. Portal URLs carry a session token, so they are opened and discarded,
 * never logged.
 */
import {
  authState,
  clerkConfigured,
  startSignIn,
  waitForSignIn,
} from "./auth.svelte";
import {
  createCheckout,
  createCustomerPortal,
  isAdgitterError,
  openExternalUrl,
} from "./ipc";
import { describeError } from "./errorReport";
import type { MessageKey } from "./i18n/messages";
import type { Plan } from "./license.svelte";

/** What a purchase can be for: a subscription tier or a one-time theme. */
export type CheckoutKind = "plan" | "theme";

export type CheckoutResult =
  /** The hosted page was created and opened in the system browser. */
  | { status: "opened"; url: string }
  /** Sign-in was needed but did not complete (user cancelled / gave up). */
  | { status: "cancelled"; reason: "cancelled" | "timeout" }
  /** Sign-in was attempted and refused (offline, rejected JWT, invalid license). */
  | { status: "signin-failed" }
  /** Sign-in was needed but couldn't be started (Clerk unconfigured, no browser). */
  | { status: "signin-unavailable" }
  /**
   * Portal only: the account has no subscription to manage. A specific,
   * expected outcome — not a fault — so it is neither `failed` (which would
   * say "unavailable right now" about a working server) nor logged as an
   * error.
   */
  | { status: "no-subscription" }
  /** The operation itself failed (Polar not provisioned, network, rejected). */
  | { status: "failed"; error: unknown };

/**
 * The paid tiers in ascending order. `free` is not in the list: it is the
 * absence of a purchase, never something to upgrade *to*.
 */
const PAID_TIERS = ["basic", "advance", "enterprise"] as const;

/**
 * The tier an "Upgrade" from `plan` should buy — the next one **above** the
 * user's current tier, or `null` on `enterprise` where there is nothing above.
 *
 * Shared so a surface cannot accidentally offer someone the tier they already
 * hold. (`PlanPanel.svelte` still hardcodes `'advance'` and therefore does
 * exactly that to an `advance` subscriber; see the note in `UserMenu.svelte`.)
 */
export function nextPlanAbove(plan: Plan): Plan | null {
  const i = PAID_TIERS.indexOf(plan as (typeof PAID_TIERS)[number]);
  // `free` isn't in the list (i === -1), and its next tier is the first paid
  // one; otherwise step one along, falling off the end at `enterprise`.
  return PAID_TIERS[i + 1] ?? null;
}

/**
 * The one error the flow recovers from rather than reports. Matched on the
 * backend's stable `code` — never on message text, which is free-form and
 * localizable.
 */
export function isNotSignedIn(e: unknown): boolean {
  return isAdgitterError(e) && e.code === "NOT_SIGNED_IN";
}

/**
 * Resolve a hosted URL and open it in the system browser.
 *
 * `resolve` is the one thing that differs between a purchase and a portal
 * session. Its result may be a credential (a portal URL carries a session
 * token), so it is passed straight to the browser and never logged.
 */
async function resolveAndOpen(
  resolve: () => Promise<string>,
): Promise<CheckoutResult> {
  const url = await resolve();
  await openExternalUrl(url);
  return { status: "opened", url };
}

/**
 * Sign in if this app isn't yet, joining a sign-in already in flight. `null`
 * once signed in; otherwise the {@link CheckoutResult} that says why not.
 * Shared by every account action that needs an identity first — a purchase,
 * the portal, and starting the free trial. Never rejects, never hangs.
 */
export async function signInFirst(opts: {
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<CheckoutResult | null> {
  if (authState().status !== "signed-in") {
    // A sign-in may already be in flight from another entry point (the plan
    // panel's Upgrade and the theme store's Buy have independent busy flags, so
    // both can be mid-purchase at once). Join it instead of starting a second
    // one: `startSignIn` unconditionally drops `pendingCallback`, and doing that
    // between the deep-link arriving and its token exchange would leave
    // `completeSignIn` with nothing to exchange — it returns false without
    // touching the status, so *both* waiters would then sit out the full
    // 10-minute timeout. Sharing the one sign-in also spares the user a second
    // browser tab.
    if (authState().status !== "signing-in") {
      if (!clerkConfigured()) return { status: "signin-unavailable" };
      await startSignIn();
      // `startSignIn` falls back to signed-out when the browser refused to
      // open; there is nothing to wait for in that case.
      if (authState().status === "signed-out") {
        return { status: "signin-unavailable" };
      }
    }
    const outcome = await waitForSignIn(opts);
    if (outcome === "failed") return { status: "signin-failed" };
    if (outcome !== "signed-in") {
      return { status: "cancelled", reason: outcome };
    }
  }

  return null;
}

/**
 * Run `resolve` → open, signing in first if that turns out to be necessary.
 *
 * The lazy sign-in round trip lives here once, so the account menu's "Manage
 * subscription" behaves identically to a purchase: one click signed out, and
 * every other ending resolves to its own {@link CheckoutResult} rather than
 * leaving a caller's loading flag spinning. Never rejects, never hangs.
 */
async function openWithLazySignIn(
  resolve: () => Promise<string>,
  opts: { signal?: AbortSignal; timeoutMs?: number },
): Promise<CheckoutResult> {
  try {
    return await resolveAndOpen(resolve);
  } catch (error) {
    if (!isNotSignedIn(error)) return failure(error);
  }

  // No license yet — the expected first-purchase path. Get an identity, then
  // resume the very same checkout without a second click.
  const notSignedIn = await signInFirst(opts);
  if (notSignedIn) return notSignedIn;

  try {
    return await resolveAndOpen(resolve);
  } catch (error) {
    return failure(error);
  }
}

/**
 * Start a purchase, signing in first if that turns out to be necessary.
 *
 * `signal` lets the caller abandon the wait (e.g. the panel closed); the
 * sign-in wait also self-limits via `timeoutMs` (see `SIGN_IN_TIMEOUT_MS`).
 */
export async function startCheckout(
  kind: CheckoutKind,
  id: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<CheckoutResult> {
  return openWithLazySignIn(() => createCheckout(kind, id), opts);
}

/**
 * Open Polar's customer portal for the signed-in subscriber — cancel, change
 * payment method, invoices.
 *
 * Takes no identifier of any kind: the server derives the customer from the
 * verified licence subject, so there is nothing for this page to pass and
 * nothing it could get wrong.
 *
 * Shares the exact sign-in round trip a purchase uses, so this works signed
 * out too — and an account with nothing to manage resolves to
 * `no-subscription`, not a generic failure.
 */
export async function startSubscriptionPortal(
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<CheckoutResult> {
  return openWithLazySignIn(() => createCustomerPortal(), opts);
}

/**
 * A failed checkout, with the reason written to the console on the way past.
 *
 * The backend already says exactly what went wrong — "checkout request failed:
 * <transport error>", "checkout rejected (401): …" — and every one of those
 * distinguishes causes a user-facing message never can (unreachable API vs
 * expired licence vs unmapped product). Until this, `startCheckout` captured
 * that string in `error` and no caller ever read it, so a real purchase
 * attempt surfaced only "checkout isn't available right now" and diagnosing it
 * meant guessing. Logged rather than shown: the wording is for whoever is
 * reading a terminal, not for the buyer.
 */
function failure(error: unknown): CheckoutResult {
  // "You have no subscription" is an answer, not a fault. It gets its own
  // outcome (and its own sentence) and is deliberately NOT written to the
  // console: logging it as an error would bury real failures under the normal
  // state of every user who has never paid.
  if (isAdgitterError(error) && error.code === "NO_SUBSCRIPTION") {
    return { status: "no-subscription" };
  }
  console.error("[checkout] failed:", describeError(error));
  return { status: "failed", error };
}

/**
 * The message a UI should show for a finished checkout — `null` when it opened
 * and there is nothing to say. Shared so the plan panel and the theme store
 * explain the same outcome the same way.
 */
export function checkoutNotice(result: CheckoutResult): MessageKey | null {
  switch (result.status) {
    case "opened":
      return null;
    case "cancelled":
      return result.reason === "timeout"
        ? "checkout.signInTimedOut"
        : "checkout.signInCancelled";
    case "signin-failed":
      return "checkout.signInFailed";
    case "signin-unavailable":
      return "checkout.signInUnavailable";
    case "no-subscription":
      return "portal.noSubscription";
    case "failed":
      return "checkout.unavailable";
  }
}
