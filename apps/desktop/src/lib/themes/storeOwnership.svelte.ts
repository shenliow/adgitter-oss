/**
 * Theme-store entitlement (mock-first).
 *
 * The single ownership + purchase authority for the unified theme store
 * (`ThemeStore.svelte`, kind `"app"` and `"graph"` listings alike) and the
 * graph-theme picker (`PersonalizePanel.svelte`). Both screens call the same
 * functions here so they can never disagree about whether a given id is
 * owned:
 *
 *   • A pack with no `priceUsd` is a free built-in (`default`) — always owned.
 *   • A priced item is owned once purchased.
 *
 * Two backends, selected by the `VITE_STORE_MOCK` env flag (repo-root env,
 * `vite.config.ts` `envDir: '../../'`):
 *
 *   • MOCK (default — Polar isn't provisioned yet): ownership lives in a local
 *     reactive list persisted to `localStorage`; `buyStoreTheme` grants
 *     instantly. This lets the whole buy → own → apply flow be developed and
 *     demoed with no backend, and — critically — never makes a real network
 *     call, so a dev box with no Polar configuration still has a working shop.
 *   • REAL (`VITE_STORE_MOCK=false`): defers to the verified-license
 *     `ownsTheme` and opens the Polar one-time checkout in the browser.
 *     Flip the flag once Polar is live — no code change.
 *
 * This module used to be graph-theme-only (`graphStore.svelte.ts`), back when
 * the CSS-theme store and the graph-theme store were two separate systems with
 * two separate ownership models. They were later unified into one store
 * (`ThemeStore.svelte`, `remote.svelte.ts`'s `storeListings()`), but the CSS
 * side kept calling the real license directly instead of through here — so
 * mock mode had a purchase button that still reached Polar. This module is now
 * the thing that unified store replaces that old split with: one ownership
 * predicate and one purchase path for both kinds.
 */
import { graphThemes, type GraphThemePack } from "../graphTheme";
import { ownsTheme, refreshEntitlement } from "../license.svelte";
import { startCheckout, type CheckoutResult } from "../checkoutFlow";
import { renewLicense } from "../ipc";

/** Mock is the default; set `VITE_STORE_MOCK=false` to use real entitlement. */
export const MOCK_STORE = import.meta.env.VITE_STORE_MOCK !== "false";

/**
 * Ids that are free built-ins (no price) → owned unconditionally.
 *
 * Only the graph themes are scanned: the CSS catalog (`lib/themes/catalog.ts`)
 * declares `priceUsd: number` as required on every entry, so it can never
 * contribute a free id. If that ever changes, add `catalog()` here too — do
 * NOT fall back to "unknown id → owned"; an id this module has never heard of
 * must read as unowned, not free.
 */
function isFreeId(id: string): boolean {
  return graphThemes().some((t) => t.id === id && t.priceUsd == null);
}

// Historical name — an existing dev/demo install has ownership stored under
// this key from when the module was graph-theme-only. Keep it as-is; renaming
// it would silently wipe that install's purchases.
const LS_KEY = "adgitter.mockOwnedGraphThemes";

// Mock demo seed (first run only): pre-own the flagship paid theme so the
// "owned → apply" path has something to show out of the box, while blueprint
// stays purchasable to demo the buy path. Ignored once the user has any stored
// list (so a mock "reset" to empty sticks).
const DEMO_OWNED = MOCK_STORE ? ["synthwave"] : [];

function loadBought(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw == null) return [...DEMO_OWNED];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [...DEMO_OWNED];
  }
}

// Reactive: mock-bought item ids (both kinds). Seeded from localStorage so a
// demo purchase survives reload; UIs reading `ownsStoreTheme` update when this
// changes.
let bought = $state<string[]>(loadBought());

/** Whether `id` may be applied (free built-in, or owned via the active backend). */
export function ownsStoreTheme(id: string): boolean {
  if (isFreeId(id)) return true;
  return MOCK_STORE ? bought.includes(id) : ownsTheme(id);
}

/**
 * Whether `pack` has a price and is not yet owned (→ show a Buy button).
 *
 * Kept graph-pack-shaped rather than generalised to `(id, priceUsd)`: its only
 * caller is `PersonalizePanel.svelte`, which only ever deals in
 * `GraphThemePack`s, and `ThemeStore.svelte` (which also lists CSS-catalog
 * items) computes the same thing inline as `!owned && item.priceUsd != null`
 * rather than through this helper. Generalising the signature would move the
 * one real caller further from the type it actually has for no shared use.
 */
export function isPurchasable(pack: GraphThemePack): boolean {
  return pack.priceUsd != null && !ownsStoreTheme(pack.id);
}

/** Whether the store can take a purchase (mock grants instantly; real creates a
 *  Polar checkout server-side). Always available — a misconfigured/ signed-out
 *  real checkout surfaces as a non-`opened` {@link StorePurchase}. */
export function canPurchase(): boolean {
  return true;
}

/**
 * The outcome of {@link buyStoreTheme}: the mock backend grants ownership on
 * the spot (there is no checkout to report on), the real one forwards whatever
 * the shared checkout flow concluded.
 */
export type StorePurchase = { status: "granted" } | CheckoutResult;

/**
 * Purchase `id`. Mock: grant + persist instantly — no network call is made, so
 * this never reaches Polar. Real: run the shared lazy sign-in checkout
 * (`lib/checkoutFlow`), which signs the user in when there is no license yet
 * and then resumes this same purchase — ownership lands after Polar's webhook
 * re-issues the license, surfaced via {@link refreshOwnership}.
 *
 * Never rejects: every real-mode ending (opened, sign-in cancelled/timed out/
 * unavailable/failed, checkout failed) comes back as a {@link StorePurchase}
 * the caller can render. That is deliberate — this used to call `createCheckout`
 * bare, and a signed-out click became an unhandled rejection that took the
 * whole window down with the crash screen.
 */
export async function buyStoreTheme(id: string): Promise<StorePurchase> {
  if (MOCK_STORE) {
    if (!bought.includes(id)) {
      bought = [...bought, id];
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(bought));
      } catch {
        // localStorage unavailable (private mode / SSR) — ownership stays
        // for this session only; not fatal.
      }
    }
    return { status: "granted" };
  }
  return startCheckout("theme", id);
}

/**
 * Re-verify ownership after a purchase. Mock: reload the persisted list (lets
 * another window's purchase show up). Real: ask the server for a fresh license
 * and then re-read the entitlement it persisted.
 *
 * The server round-trip is the whole point of the real branch. `refreshEntitlement`
 * alone is an *offline* check — it verifies the signature and device binding of
 * the token already on disk — so a purchase the server has already recorded can
 * never land through it. The only thing that normally brings a post-purchase
 * license down is the `adgitter://checkout-complete` deep link, and that link is
 * not guaranteed to arrive: macOS only registers the scheme for a packaged .app
 * (so under `tauri dev` it never fires at all), and in production the user can
 * close the tab or the browser can refuse the hand-off. Without a renew here,
 * such a purchase is money spent with no way back — and this Refresh button,
 * which the store presents as "re-check my purchases", is the user's only way
 * back. So it renews first, then re-reads.
 *
 * Renew failures are completely silent and non-fatal (the same
 * offline-first stance as `auth.svelte.ts`'s `refreshAccountProfile`): being
 * offline, a down server, or a renew the server rejects must leave the session
 * exactly as it was and must not throw out of a button handler. The entitlement
 * re-read runs either way — after a failed renew it simply re-reads the token
 * already on disk, which is precisely the old behaviour.
 *
 * `refreshEntitlement` itself deliberately stays offline: it runs on boot and on
 * every window focus, so making *it* network-bound would hammer the API. A
 * deliberate button press is the right place for a round-trip.
 */
export async function refreshOwnership(): Promise<void> {
  if (MOCK_STORE) {
    bought = loadBought();
    return;
  }
  try {
    await renewLicense();
  } catch {
    // Offline, server down, or a rejected renew — stay silent and fall
    // through to the offline re-read below.
  }
  await refreshEntitlement();
}

/** TEST-ONLY: reset the mock ownership list (both memory + storage). */
export function __resetMockOwnership(): void {
  bought = [];
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}
