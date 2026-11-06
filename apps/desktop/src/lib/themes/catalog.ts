/**
 * Theme Store catalog.
 *
 * The purchasable themes offered by the store. Each entry wraps a
 * {@link ThemePack} (same CSS-variable format the theme engine applies) plus a
 * one-time price and a store-facing display name. Ownership is tracked
 * server-side (`entitlement.owned_themes`) and surfaced via the entitlement
 * store's `ownsTheme(id)`; this module is the pure catalog of what's for sale.
 *
 * The `id` is the stable purchase key: it is what the Polar checkout records in
 * `metadata.theme_id`, what the license carries in `owned_themes`, and what gets
 * persisted in `PersonalizeSettings.theme` once applied — so it must never
 * collide with a built-in `THEMES` id.
 *
 * The packs themselves are the paid partition's (`pro/themes/catalog.ts`).
 */
import type { ThemePack } from "../theme";
import { pro } from "../pro";

/** A purchasable theme: catalog metadata + the pack the engine applies. */
export interface CatalogTheme {
  /** Stable purchase/apply key (also the Polar `metadata.theme_id`). */
  id: string;
  /** Store-facing display name. */
  name: string;
  /** One-time price in USD (mockup pricing until 2.18). */
  priceUsd: number;
  /** The CSS-variable pack applied through the theme engine. */
  pack: ThemePack;
}

/**
 * The purchasable themes this build ships (the store's own, when the build has
 * them — `lib/pro.ts`). A function so the paid list is read only once every
 * module has loaded.
 */
export function catalog(): CatalogTheme[] {
  return pro?.cssThemes ?? [];
}

/** Look up a catalog theme by its purchase/apply id. */
export function catalogTheme(id: string): CatalogTheme | undefined {
  return catalog().find((c) => c.id === id);
}
