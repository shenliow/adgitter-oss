/**
 * Post-purchase return trip (`adgitter://checkout-complete`).
 *
 * Polar sends the system browser to `POLAR_SUCCESS_URL` once payment is done;
 * the backend sets that to `adgitter://checkout-complete`, which brings the
 * desktop back to the foreground (launching it if it was closed — the cold-start
 * URL goes through the same `receiveDeepLink` path). This module turns that
 * arrival into an actual unlock, so a bought theme is applicable without a
 * restart (009-theme-store US2).
 *
 * ## The deep link is NOT a proof of purchase
 *
 * `adgitter://…` is a public URL scheme: any web page — or any local process —
 * can fire it, and nothing in it is signed. It is treated here as a *hint to go
 * ask the server*, nothing more. No entitlement, theme, plan or feature is ever
 * derived from the URL: the only thing that grants anything is a license token
 * re-issued and Ed25519-signed by the license server, verified offline by Rust
 * against the embedded public key before it is persisted. Query parameters are
 * deliberately not read at all — not even for display — so there is no path by
 * which a crafted URL can influence what the user is told they own. A malicious
 * page firing this link achieves exactly one thing: a licence re-check that
 * returns the same entitlement the user already had.
 *
 * ## The webhook race
 *
 * Polar redirects the browser as soon as payment succeeds; the `order.paid`
 * webhook that writes the entitlement row is a *separate* delivery and often
 * lands afterwards. Renewing once on arrival would therefore usually re-issue
 * the pre-purchase entitlement and leave the theme locked while the UI claims
 * success — a race that almost never reproduces locally and shows up
 * intermittently in production. So we poll, with backoff, for a bounded window
 * ({@link RETRY_DELAYS_MS}, ~60s total) and only report success when the
 * re-issued licence actually carries something new. On timeout we say so
 * honestly: the purchase is probably still processing, nothing is lost, and it
 * will unlock on the next check (or restart).
 */
import {
  loadAccountProfile,
  mergeLicenseProfile,
  saveAccountProfile,
} from "./accountProfile";
import { renewLicense, isAdgitterError, type LicenseStatusDto } from "./ipc";
import {
  getFeatures,
  getPlan,
  ownedThemes,
  refreshEntitlement,
} from "./license.svelte";

/**
 * Delay *before* each renewal attempt, in ms. First attempt is immediate (the
 * webhook may well have beaten the browser); the rest back off so a slow
 * confirmation is still caught without hammering the API. Eight attempts over
 * ~60s: long enough for a normally-late webhook, short enough that the user
 * isn't watching a spinner forever.
 */
export const RETRY_DELAYS_MS: readonly number[] = [
  0, 1_500, 3_000, 5_000, 8_000, 12_000, 15_000, 15_000,
];

/** The entitlement facts a purchase can change. */
export interface EntitlementSnapshot {
  plan: string;
  ownedThemes: string[];
  features: string[];
}

/** Snapshot the entitlement currently in effect. */
export function currentEntitlement(): EntitlementSnapshot {
  return {
    plan: getPlan(),
    ownedThemes: [...ownedThemes()],
    features: [...getFeatures()],
  };
}

/** The snapshot carried by a *verified* licence DTO (invalid ⇒ nothing). */
function snapshotOf(dto: LicenseStatusDto): EntitlementSnapshot {
  const valid = dto.status === "active" || dto.status === "grace";
  return {
    plan: valid ? (dto.plan ?? "free") : "free",
    ownedThemes: valid ? (dto.ownedThemes ?? []) : [],
    features: valid ? (dto.features ?? []) : [],
  };
}

/**
 * Whether `after` grants something `before` did not — a newly owned theme, a
 * new feature, or a different plan. Purely additive checks: a *loss* (refund,
 * downgrade landing at the same moment) is not "your purchase completed".
 */
export function grantsSomethingNew(
  before: EntitlementSnapshot,
  after: EntitlementSnapshot,
): boolean {
  if (after.ownedThemes.some((id) => !before.ownedThemes.includes(id)))
    return true;
  if (after.features.some((f) => !before.features.includes(f))) return true;
  return after.plan !== before.plan && after.plan !== "free";
}

/** Theme ids present in `after` but not in `before`. */
export function newlyOwnedThemes(
  before: EntitlementSnapshot,
  after: EntitlementSnapshot,
): string[] {
  return after.ownedThemes.filter((id) => !before.ownedThemes.includes(id));
}

/** How a poll ended. `pending` = bounded wait elapsed with no change. */
export type PollOutcome =
  | { status: "unlocked"; after: EntitlementSnapshot; newThemes: string[] }
  | { status: "pending" }
  | { status: "signin-needed" };

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Re-issue the licence repeatedly until it grants something new, or the retry
 * budget runs out. Never throws: a failing renewal (offline, server hiccup) is
 * just another attempt spent, because the entitlement may still be on its way.
 *
 * Dependencies are injectable so the backoff can be tested without real time.
 */
export async function pollForNewEntitlement(opts: {
  before: EntitlementSnapshot;
  renew?: () => Promise<LicenseStatusDto>;
  wait?: (ms: number) => Promise<void>;
  delays?: readonly number[];
  signal?: AbortSignal;
}): Promise<PollOutcome> {
  const renew = opts.renew ?? renewLicense;
  const wait = opts.wait ?? sleep;
  const delays = opts.delays ?? RETRY_DELAYS_MS;

  for (const delay of delays) {
    if (opts.signal?.aborted) return { status: "pending" };
    if (delay > 0) await wait(delay);
    if (opts.signal?.aborted) return { status: "pending" };
    try {
      const dto = await renew();
      // Every successful renewal carries a freshly re-pinned display profile
      // (E-clerk-profile-sync) — merge it over the cached copy and persist,
      // the same as `restoreSession` does, so a Clerk-side edit observed
      // during this poll reaches the account panel without waiting for a
      // later sign-in.
      saveAccountProfile(mergeLicenseProfile(dto, loadAccountProfile()));
      const after = snapshotOf(dto);
      if (grantsSomethingNew(opts.before, after)) {
        return {
          status: "unlocked",
          after,
          newThemes: newlyOwnedThemes(opts.before, after),
        };
      }
    } catch (err) {
      // Nothing to renew: no amount of waiting produces a licence, and the
      // user needs different advice than "still processing".
      if (isAdgitterError(err) && err.code === "NOT_SIGNED_IN") {
        return { status: "signin-needed" };
      }
      // Anything else (offline, 5xx, rejected) — keep trying within budget.
    }
  }
  return { status: "pending" };
}

/** UI-visible state of the return trip. */
export type CheckoutReturnState =
  /** No purchase return in flight. */
  | { status: "idle" }
  /** Deep link arrived; waiting on the server to confirm the purchase. */
  | { status: "processing" }
  /** A re-issued licence granted something new. */
  | { status: "unlocked"; newThemes: string[] }
  /** The wait elapsed without confirmation — honest "still processing". */
  | { status: "pending" }
  /** There is no licence to renew; the user has to sign in first. */
  | { status: "signin-needed" };

let state = $state<CheckoutReturnState>({ status: "idle" });

/** Reactive return-trip state for components. */
export function checkoutReturnState(): CheckoutReturnState {
  return state;
}

/** Dismiss the notice (or reset between tests). */
export function clearCheckoutReturn(): void {
  state = { status: "idle" };
}

/** True while a check is in flight, so a second trigger can join it. */
let inFlight: Promise<CheckoutReturnState> | null = null;

/**
 * Handle a `checkout-complete` arrival: hold "processing", poll the server for
 * a licence that grants something new, refresh the entitlement store on success
 * and settle on a state the UI can explain.
 *
 * Takes no URL argument on purpose — there is nothing in the deep link this
 * function is allowed to believe (see the module header). Re-entrant calls join
 * the in-flight check rather than starting a second poll (the OS can deliver
 * the launch URL twice: `getCurrent()` *and* `onOpenUrl`).
 */
export function handleCheckoutReturn(
  opts: {
    delays?: readonly number[];
    wait?: (ms: number) => Promise<void>;
  } = {},
): Promise<CheckoutReturnState> {
  if (inFlight) return inFlight;
  state = { status: "processing" };
  const before = currentEntitlement();
  inFlight = (async () => {
    try {
      const outcome = await pollForNewEntitlement({ before, ...opts });
      if (outcome.status === "unlocked") {
        // Re-read through the normal path so every consumer of the entitlement
        // store (theme store, feature gates) sees the unlock at once.
        await refreshEntitlement();
        state = { status: "unlocked", newThemes: outcome.newThemes };
      } else {
        state = { status: outcome.status };
      }
      return state;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Run the check again — the "Check again" affordance on a pending notice. */
export function retryCheckoutReturn(): Promise<CheckoutReturnState> {
  return handleCheckoutReturn();
}
