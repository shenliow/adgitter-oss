/**
 * The free tier is ad-supported: "ads or pay" (decision 2026-11-04).
 *
 * On first launch a free user either accepts the ad strip or moves to a paid
 * plan. That is still a real, separate consent — an explicit button, never
 * "using the app means you agree" — because the ad is Carbon's script, which
 * receives the user's IP and browser details (GDPR Art. 4(11)/7, ePrivacy
 * Art. 5(3)). What changes is that refusing isn't a free, ad-less option.
 *
 * Korea is the exception: PIPA §16③ forbids refusing a service because the
 * user won't give data it doesn't strictly need, so there "decline and keep
 * using it free" stays. The region is read from the OS languages, which is a
 * proxy — it can over-include (a Korean speaker abroad gets the extra button),
 * which is the safe direction.
 */
import type { AdConsent } from "./settings";
import type { Plan } from "./license.svelte";

/** Whether refusing ads must still leave the free tier usable here. */
export function mayDeclineAds(
  languages: readonly string[] = globalThis.navigator?.languages ?? [],
): boolean {
  return languages.some((tag) => {
    const [lang, ...rest] = tag.split(/[-_]/);
    return (
      lang.toLowerCase() === "ko" ||
      rest.some((part) => part.toUpperCase() === "KR")
    );
  });
}

/**
 * Whether the gate must be up: a free user who hasn't accepted ads (and, where
 * declining is allowed, hasn't declined). Waits for the entitlement to be read
 * so a paying user never sees it flash at startup.
 */
export function adGateOpen(o: {
  ready: boolean;
  plan: Plan;
  consent: AdConsent;
  mayDecline: boolean;
}): boolean {
  if (!o.ready || o.plan !== "free") return false;
  if (o.consent === "granted") return false;
  return !(o.consent === "declined" && o.mayDecline);
}
