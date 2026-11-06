/**
 * Locale-aware date/time formatting. Functions read the active locale
 * via `getLocale()` so any template using them re-renders on a language switch,
 * and `Intl` handles per-locale date/number rendering.
 */
import { getLocale } from "./i18n/index.svelte";
import { t } from "./i18n/index.svelte";

/** Short relative time used in commit rows, e.g. "2h ago" (localized). */
export function relativeTime(tsSeconds: number): string {
  const diffSec = Date.now() / 1000 - tsSeconds;
  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: "auto" });
  if (diffSec < 60) return rtf.format(0, "second");
  if (diffSec < 3600) return rtf.format(-Math.floor(diffSec / 60), "minute");
  if (diffSec < 86400) return rtf.format(-Math.floor(diffSec / 3600), "hour");
  if (diffSec < 86400 * 30)
    return rtf.format(-Math.floor(diffSec / 86400), "day");
  return new Date(tsSeconds * 1000).toLocaleDateString(getLocale());
}

function hhmm(d: Date): string {
  return d.toLocaleTimeString(getLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/**
 * Time-axis label matching the mockups: "Today 14:32", "Yesterday 11:06",
 * else a localized month/day + time.
 */
export function axisTime(tsSeconds: number): string {
  const d = new Date(tsSeconds * 1000);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (sameDay(d, now)) return `${t("time.today")} ${hhmm(d)}`;
  if (sameDay(d, yesterday)) return `${t("time.yesterday")} ${hhmm(d)}`;

  const md = d.toLocaleDateString(getLocale(), {
    month: "2-digit",
    day: "2-digit",
  });
  return `${md} ${hhmm(d)}`;
}

/** Full absolute timestamp for the commit-details footer (localized). */
export function fullTimestamp(tsSeconds: number): string {
  return new Date(tsSeconds * 1000).toLocaleString(getLocale(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Two-letter initials for avatar fallback. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}
