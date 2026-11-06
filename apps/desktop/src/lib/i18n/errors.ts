/**
 * Localized error text. Maps an `AdgitterError.code` to a localized
 * category, appending the backend's detail; unknown values stringify. The
 * backend stays language-agnostic (codes + raw detail) — see error.rs.
 */
import { isAdgitterError } from "../ipc";
import { t } from "./index.svelte";
import type { MessageKey } from "./messages";

export function localizedError(e: unknown): string {
  if (isAdgitterError(e)) {
    // A conflict names the offending commit instead of echoing the raw
    // backend detail — the short sha is the only thing a user needs to act on.
    if (e.code === "CONFLICT" && e.sha) {
      return t("error.conflict", { short: e.sha.slice(0, 7) });
    }
    // Licence failures the user can act on: the localized string is already a
    // complete instruction ("sign in again" / "renew"), so appending the
    // backend's untranslated restatement of the same fact only makes it worse.
    if (e.code === "LICENSE_DEVICE_MISMATCH" || e.code === "LICENSE_EXPIRED") {
      return t(`error.${e.code}`);
    }
    const category = t(`error.${e.code}` as MessageKey);
    return e.message ? `${category}: ${e.message}` : category;
  }
  return String(e);
}
