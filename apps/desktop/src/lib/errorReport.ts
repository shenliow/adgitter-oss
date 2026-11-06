/**
 * Turning a thrown value into something a diagnostic report can use.
 *
 * The global `error` / `unhandledrejection` handlers used to do `String(e)`,
 * which is exactly wrong for the values this app throws most: IPC rejects with
 * a plain `{code, message}` object, and `String({...})` is `"[object Object]"`.
 * The one piece of information worth having — *which* failure it was — was the
 * piece being destroyed, so every crash report looked identical.
 *
 * So: one describer, used by every reporting path, that gets a meaningful
 * string out of an `AdgitterError`, an `Error`, a string, or an arbitrary
 * object (JSON, never `[object Object]`), and an `errorCode` that prefers the
 * tagged `code` so Sentry aggregates by actual cause instead of lumping
 * everything under `UI_ERROR`.
 *
 * PII: the output is free text that flows into `report()`, which scrubs emails
 * and paths (`lib/telemetry.ts`, mirroring `crates/telemetry::scrub`). This
 * module adds no scrubbing of its own — it must not, or the two
 * implementations would drift — but it does cap the length so a serialized
 * object can't smuggle an unbounded payload past a scrubber tuned for
 * sentence-sized messages.
 */
import { isAdgitterError } from "./ipc";

/** Fallback fingerprint for anything without a tagged `code`. */
export const UI_ERROR = "UI_ERROR";

/** Longest message we will report; anything past this is truncated. */
const MAX_MESSAGE = 500;

function truncate(s: string): string {
  return s.length <= MAX_MESSAGE ? s : `${s.slice(0, MAX_MESSAGE)}…`;
}

/** Best-effort JSON for a non-Error object; `null` when it can't be encoded. */
function jsonish(value: object): string | null {
  try {
    const seen = new WeakSet<object>();
    const json = JSON.stringify(value, (_k, v) => {
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return "[circular]";
        seen.add(v);
      }
      return typeof v === "bigint" ? String(v) : v;
    });
    // `undefined` (e.g. a function) and the empty object are no better than
    // "[object Object]" — let the caller fall through to key names.
    return json == null || json === "{}" ? null : json;
  } catch {
    return null;
  }
}

/**
 * A human-meaningful description of any thrown value.
 *
 * Guaranteed never to return `"[object Object]"`: an object that JSON can't
 * usefully encode is described by its constructor name and keys instead.
 */
export function describeError(e: unknown): string {
  if (isAdgitterError(e)) {
    const message = String(e.message ?? "").trim();
    return truncate(message ? `${e.code}: ${message}` : e.code);
  }
  if (e instanceof Error) {
    return truncate(e.message?.trim() || e.name || "Error");
  }
  if (typeof e === "string") return truncate(e.trim() || "(empty string)");
  if (e === null) return "null";
  if (e === undefined) return "undefined";
  if (typeof e === "object") {
    const json = jsonish(e);
    if (json) return truncate(json);
    const name = e.constructor?.name ?? "Object";
    const keys = Object.keys(e);
    return truncate(keys.length ? `${name} {${keys.join(", ")}}` : name);
  }
  return truncate(String(e));
}

/** The aggregation fingerprint for a thrown value — its tagged code, if any. */
export function errorCode(e: unknown): string {
  return isAdgitterError(e) ? e.code : UI_ERROR;
}

/** Both halves of a diagnostic report for a thrown value. */
export function errorReport(e: unknown): { code: string; message: string } {
  return { code: errorCode(e), message: describeError(e) };
}
