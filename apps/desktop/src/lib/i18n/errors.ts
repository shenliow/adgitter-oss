/**
 * Localized error text. Maps an `AdgitterError.code` to a localized
 * category, appending the backend's detail; unknown values stringify. The
 * backend stays language-agnostic (codes + raw detail) — see error.rs.
 */
import { isAdgitterError } from "../ipc";
import { ProviderError } from "../http/transport";
import { isNetworkFailure } from "../errorReport";
import { t } from "./index.svelte";
import type { MessageKey } from "./messages";

/**
 * Codes whose localized string is already the complete instruction ("add an
 * access token in Settings → …", "renew", "free some space"). Appending the
 * backend's untranslated restatement of the same fact ("git error:
 * authentication required") would only make it worse.
 */
const SELF_CONTAINED = new Set([
  "LICENSE_DEVICE_MISMATCH",
  "LICENSE_EXPIRED",
  "AUTH_REQUIRED",
  "AUTH_FAILED",
  "DISK_FULL",
]);

export function localizedError(e: unknown): string {
  if (isAdgitterError(e)) {
    // A conflict names the offending commit instead of echoing the raw
    // backend detail — the short sha is the only thing a user needs to act on.
    if (e.code === "CONFLICT" && e.sha) {
      return t("error.conflict", { short: e.sha.slice(0, 7) });
    }
    if (SELF_CONTAINED.has(e.code)) {
      return t(`error.${e.code}` as MessageKey);
    }
    // A generic code that is plainly "offline" (the shell's HTTP calls wrap a
    // failed request as INTERNAL_ERROR) reads as the network hint, not as
    // "Something went wrong".
    const code = isNetworkFailure(e) ? "NETWORK_ERROR" : e.code;
    const category = t(`error.${code}` as MessageKey);
    return e.message ? `${category}: ${e.message}` : category;
  }
  // Issue-tracker refusals with something for the user to do.
  if (e instanceof ProviderError) {
    if (e.kind === "auth") return t("error.TRACKER_AUTH");
    if (e.kind === "rate_limit") return t("error.TRACKER_RATE_LIMIT");
  }
  if (isNetworkFailure(e)) return t("error.NETWORK_ERROR");
  return String(e);
}
