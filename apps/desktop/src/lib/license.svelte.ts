/**
 * Entitlement store.
 *
 * A single reactive `plan` that gates paid features (ads on free, No-AD/themes/
 * background Log-Anytime/etc. on paid). The plan is driven by a
 * verified Ed25519 license via {@link refreshEntitlement} (run on startup),
 * replacing the pure stub; it still defaults to `free` with no/invalid license.
 * Downstream epics read `getPlan()`/`isFree()` and pick up real entitlement
 * automatically. It also tracks the per-feature entitlement list so
 * callers can gate on a specific capability via {@link hasFeature} (e.g.
 * `hasFeature("NoAd")`) rather than plan tier alone. `setPlan` remains the
 * single reactive entry point for the plan.
 */
import { verifyLicense } from "./ipc";
import { effectiveDevPlan, syncDevPlanToBackend } from "./devPlan.svelte";

export type Plan = "free" | "basic" | "advance" | "enterprise";

let plan = $state<Plan>("free");
let features = $state<string[]>([]);
let ownedThemesList = $state<string[]>([]);
let trialEnds = $state<number | null>(null);
let ready = $state(false);

/**
 * Whether the entitlement has been read at least once this session. Until it
 * has, `plan` is the free default rather than an answer, so anything that acts
 * on "this user is free" — the ad gate — waits for this first.
 */
export function entitlementReady(): boolean {
  return ready;
}
let trialTimer: ReturnType<typeof setTimeout> | null = null;

export function getPlan(): Plan {
  return plan;
}

/** True for the free tier (ads shown, paid features locked). */
export function isFree(): boolean {
  return plan === "free";
}

/** Set the active plan. The single reactive entry point for entitlement. */
export function setPlan(next: Plan): void {
  plan = next;
}

/**
 * Drop every cached entitlement back to the free tier — plan, features, and
 * owned themes.
 *
 * Called by sign-out, which has just destroyed the license token the cache was
 * derived from. It does **not** go through {@link refreshEntitlement}: that
 * needs an IPC round-trip (so it cannot be relied on in tests/SSR, and a
 * failure there would leave the stale paid state in place) and its dev
 * `VITE_DEV_PLAN` override would re-grant the tier a sign-out just revoked.
 *
 * Owned themes go too. They are a purchase, but the *proof* of the purchase is
 * the license, so a signed-out app cannot know about them — a bought theme
 * shows as buyable again until the user signs back in, which is the accepted
 * consequence of the 2026-08-18 decision rather than a lost purchase. Nothing
 * downstream breaks: `ownsTheme` simply answers false, an already-applied theme
 * keeps rendering from its cached pack, and the store shows Buy instead of
 * Apply.
 */
export function resetEntitlement(): void {
  plan = "free";
  features = [];
  ownedThemesList = [];
  setTrialEnds(null);
}

/**
 * When the licence's free trial ends or ended (Unix ms), or null when it isn't
 * a trial. Reactive.
 */
export function trialEndsMs(): number | null {
  return trialEnds;
}

/** Whether the current plan is a running free trial rather than a purchase. */
export function onTrial(now = Date.now()): boolean {
  return trialEnds !== null && now <= trialEnds && plan !== "free";
}

/**
 * Record the trial end, and re-read the entitlement the moment it passes so
 * the app drops to Free on time without a restart. The native gate needs no
 * timer — `license::verify` checks the end on every call — so this only keeps
 * the UI in step with it.
 */
function setTrialEnds(ms: number | null): void {
  trialEnds = ms;
  if (trialTimer) clearTimeout(trialTimer);
  trialTimer = null;
  const wait = ms === null ? -1 : ms - Date.now() + 1000;
  // setTimeout overflows past ~24.8 days; a trial is shorter, and a later
  // refresh (startup, renew) reschedules anyway.
  if (wait > 0 && wait < 2 ** 31 - 1) {
    trialTimer = setTimeout(() => void refreshEntitlement(), wait);
  }
}

/**
 * Whether the verified license grants `feature` (a canonical feature string
 * like "NoAd"). Reactive: reads the cached feature list populated by
 * {@link refreshEntitlement}. Free/invalid licenses carry no features.
 */
export function hasFeature(feature: string): boolean {
  return features.includes(feature);
}

/** The verified entitlement feature list (empty for free/invalid). */
export function getFeatures(): string[] {
  return features;
}

/**
 * One-time purchased theme ids from the verified license. Reactive: reads
 * the cache populated by {@link refreshEntitlement}. **Independent of the plan**
 * — a downgrade to `free` does not clear owned themes, since the server
 * keeps `owned_themes` on the token regardless of tier.
 */
export function ownedThemes(): string[] {
  return ownedThemesList;
}

/** Whether the current license owns `id` (a purchasable theme's catalog id). */
export function ownsTheme(id: string): boolean {
  return ownedThemesList.includes(id);
}

/**
 * Concurrent signed-in device (seat) cap per plan: **free 1, basic 2, advance 3,
 * enterprise 3.**
 *
 * **Display only. The server is the authority** and the only enforcer: it
 * rejects an over-cap registration with `SEAT_LIMIT` whatever this table says,
 * and the licence it signs carries its own `device_limit`. Nothing here gates
 * anything — the Devices panel uses it for "N of M devices" and the plan matrix
 * to draw a column.
 *
 * Even so it must not drift from the server's table, because a wrong number
 * here tells a user they have room they do not have (or hides room they do),
 * and they find out at a failed sign-in. The server keeps its own copy, and a
 * test reads **that source** and fails if the two tables disagree — so a
 * change on either side that is not mirrored is a red test rather than a
 * support ticket. If you edit the numbers below, edit them
 * there too (or rather: edit them there, and let the test tell you to come
 * back here).
 */
export function deviceLimit(p: Plan = plan): number {
  switch (p) {
    case "free":
      return 1;
    case "basic":
      return 2;
    case "advance":
    case "enterprise":
      return 3;
  }
}

const PLANS: readonly Plan[] = ["free", "basic", "advance", "enterprise"];

/**
 * Feature strings granted by a plan tier — mirrors the server's
 * `derive_features`. Used only by the dev
 * override below; real entitlement carries the server-authored list.
 */
export function featuresForPlan(p: Plan): string[] {
  const f: string[] = [];
  if (p !== "free") f.push("NoAd");
  f.push("ApplyTheme"); // applying custom themes is free on every tier
  if (p !== "free") f.push("TicketsPriority");
  if (p !== "free") f.push("MultiWindow");
  if (p === "advance" || p === "enterprise")
    f.push(
      "LogAnytimeBackground",
      "LogAnytimeSquash",
      "TeamSeats",
      "IssueTracker",
    );
  return f;
}

/**
 * DEV-ONLY entitlement override: the account menu's runtime choice if one has
 * been made, otherwise the **repo-root** `.env.development` `VITE_DEV_PLAN`.
 * Lets a developer run the app at any tier without a signed license — it is what
 * unlocks the Issue panel in dev. Strictly inert outside dev:
 * `import.meta.env.DEV` is false in `vite build`, and `.env.development` is not
 * loaded by production or test runs.
 *
 * The precedence rule and the reason the runtime half is gated harder than the
 * compile-time half live in {@link module:./devPlan.svelte}. In short: a stored
 * runtime choice wins (including "no override — use the real licence", which
 * beats a baked `VITE_DEV_PLAN`), and with nothing stored the baked value
 * applies exactly as it always has. The gate is checked here **and** inside
 * `effectiveDevPlan`, and the native half is guarded separately by
 * `#[cfg(debug_assertions)]`, so no single mistake opens both.
 *
 * **This is the UI half of one switch, not the whole of it.** The same variable,
 * from the same file, is baked into the Rust build (`src-tauri/build.rs` →
 * `dev_unlock.rs`) and unlocks the native `require_feature` gates too, so paid
 * IPC actually runs. Keeping it to a single name in a single file is deliberate:
 * with two switches, setting only one gives either a lit-up button the backend
 * refuses, or a working backend behind a greyed-out button. Note the native half
 * is baked at COMPILE time — changing the value needs a Rust rebuild, not just
 * an HMR reload.
 *
 * It grants capabilities only. No licence is fabricated and no account identity
 * is granted, so `account_email` stays empty and git commits keep using git's
 * own `user.email`. Owned themes are likewise not fabricated — and, since
 * 2026-09-23, not destroyed either: they keep coming from the real licence via
 * {@link licensedThemes}.
 *
 * The repo root is the ONLY place env files are read from (`vite.config.ts` sets
 * `envDir: '../../'`); one dropped in `apps/desktop/` is silently ignored and
 * every var comes back `undefined`.
 */
function devPlanOverride(): Plan | null {
  if (!import.meta.env.DEV) return null;
  return effectiveDevPlan();
}

/**
 * The owned themes recorded in the real license, or `[]` when there is no
 * usable one. Only the `VITE_DEV_PLAN` path calls this; the normal path reads
 * the same field out of the verification it already performs.
 *
 * The override grants *capabilities* — a tier and its features — so a developer
 * can run any entitlement without a signed license. A purchase is not a
 * capability: it is a fact recorded in the licence, and blanking the list here
 * made the override **revoke** something the user had actually bought. That
 * broke the one flow the override had no business touching:
 * `handleCheckoutReturn` re-reads entitlement through
 * {@link refreshEntitlement} the moment a payment lands, so in dev the freshly
 * re-issued licence was read and then immediately discarded — the theme store
 * stayed on Buy no matter how many times the theme was paid for, with nothing
 * on screen to say why.
 *
 * Failure stays silent and empty: the override exists so a machine with no
 * license (or one bound to another device) can still run dev, and that machine
 * simply owns no themes. It must never turn into a startup error.
 *
 * `pinDevice` matches the non-override path — it is an offline signature +
 * device-binding check, so it costs nothing and keeps `ownsTheme` answering
 * exactly what the native `require_feature` guard would.
 */
async function licensedThemes(): Promise<string[]> {
  try {
    const status = await verifyLicense(undefined, { pinDevice: true });
    const valid = status.status === "active" || status.status === "grace";
    return valid ? (status.ownedThemes ?? []) : [];
  } catch {
    return [];
  }
}

/**
 * Refresh the entitlement from a verified license. Calls the backend
 * `verify_license` (which reads the persisted token), maps `active`/`grace` to
 * the licensed plan and its features, and anything else to `free` with no
 * features. Non-fatal: any failure leaves the plan at `free`. Run on app
 * startup.
 *
 * **Device-bound (`pinDevice`).** This list is what {@link hasFeature} answers
 * from, and {@link hasFeature} is what decides whether a paid affordance is
 * enabled. The native guard (`require_feature`) checks the licence's device
 * binding, so an unpinned read here would light up buttons that the backend
 * then refuses with `LICENSE_DEVICE_MISMATCH` — a lit button that fails on
 * click. Pinning keeps the two answers identical, and matches
 * `restoreSession`, which already refuses a licence from another machine (so a
 * user in this state is shown signed-out, with signing in as the way back).
 *
 * In dev, a plan override (see {@link devPlanOverride}) short-circuits to that
 * tier's plan + features so the UI can be developed at any entitlement. Owned
 * themes are exempt from the short-circuit and still come from the real licence
 * ({@link licensedThemes}), so a dev build can complete a real purchase.
 *
 * **This is also where the two halves of the dev override are kept in step.**
 * The native gate's state is per-process while the developer's choice is
 * persisted in the webview, so it has to be re-applied on every launch — and a
 * missed re-apply is not a cosmetic bug: the UI would hide a feature the backend
 * still performs, or light up one it refuses. Pushing it from here covers app
 * startup, the switcher itself, and the post-checkout refresh through a single
 * seam, and it happens **before** the tier is read so both sides settle on the
 * same answer. A no-op outside dev.
 */
async function readEntitlement(): Promise<void> {
  await syncDevPlanToBackend();
  const dev = devPlanOverride();
  if (dev) {
    setPlan(dev);
    features = featuresForPlan(dev);
    setTrialEnds(null);
    // Owned themes are NOT part of what the override fabricates — see
    // {@link licensedThemes}.
    ownedThemesList = await licensedThemes();
    return;
  }
  try {
    const status = await verifyLicense(undefined, { pinDevice: true });
    const valid = status.status === "active" || status.status === "grace";
    const nextPlan = valid && status.plan ? status.plan : "free";
    setPlan(
      (PLANS as readonly string[]).includes(nextPlan)
        ? (nextPlan as Plan)
        : "free",
    );
    features = valid ? (status.features ?? []) : [];
    ownedThemesList = valid ? (status.ownedThemes ?? []) : [];
    setTrialEnds(valid ? (status.trialEndsMs ?? null) : null);
  } catch {
    setPlan("free");
    features = [];
    ownedThemesList = [];
    setTrialEnds(null);
  }
}

/**
 * {@link readEntitlement} (documented above), and then — however it went —
 * mark the entitlement as read for {@link entitlementReady}.
 */
export async function refreshEntitlement(): Promise<void> {
  try {
    await readEntitlement();
  } finally {
    ready = true;
  }
}
