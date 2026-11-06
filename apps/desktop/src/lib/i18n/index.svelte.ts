/**
 * i18n runtime. A single reactive active-locale `$state`; `t()` reads it,
 * so any template expression calling `t(...)` (or a locale-aware formatter)
 * re-renders when the locale changes. Missing keys fall back to `en`.
 */
import {
  en,
  catalogs,
  isLocale,
  type Locale,
  type MessageKey,
} from "./messages";

let current = $state<Locale>("en");

export function getLocale(): Locale {
  return current;
}

/** Set the active locale (ignores unknown locales). */
export function setLocale(locale: string): void {
  if (isLocale(locale)) current = locale;
}

function interpolate(
  s: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) =>
    k in params ? String(params[k]) : `{${k}}`,
  );
}

/** Translate `key` for the active locale, interpolating `{param}` placeholders. */
export function t(
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const msg = catalogs[current][key] ?? en[key] ?? key;
  return interpolate(msg, params);
}
