/**
 * Defensive JSON accessors shared by the provider adapters. Provider
 * responses are `unknown`; these coerce known-shaped fields without trusting the
 * payload, so a malformed field degrades to a default rather than throwing.
 */

/** Narrow an unknown value to a plain record (never null). */
export function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

/** Read a string field (default `""`). */
export function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/** Read a finite number field (default `0`). */
export function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Read an array field (default `[]`). */
export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Parse an ISO/RFC timestamp string to epoch-ms (default `now`). */
export function epochMs(v: unknown, now = Date.now()): number {
  const s = str(v);
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? now : t;
}
