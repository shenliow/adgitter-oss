/**
 * Whether this build serves ads at all.
 *
 * Ads exist only once Carbon has accepted ADGitter and issued its serve and
 * placement codes (`VITE_CARBON_SERVE` / `VITE_CARBON_PLACEMENT`, see
 * `.env.example`). Without both, the build shows no ad strip and asks no ad
 * consent: the consent text names Carbon and what Carbon receives, and asking
 * for that while no Carbon code can ever load would misdescribe the app. The
 * free tier is then simply free.
 *
 * Read at call time, not import time, so tests can stub the environment.
 */
import type { CarbonConfig } from "./CarbonAdsProvider";

/** The Carbon codes baked into this build; either may be absent. */
export function carbonConfig(): CarbonConfig {
  return {
    serve:
      (import.meta.env.VITE_CARBON_SERVE as string | undefined) || undefined,
    placement:
      (import.meta.env.VITE_CARBON_PLACEMENT as string | undefined) ||
      undefined,
  };
}

/** True when this build has both Carbon codes and so can show real ads. */
export function adsConfigured(): boolean {
  const { serve, placement } = carbonConfig();
  return Boolean(serve && placement);
}
