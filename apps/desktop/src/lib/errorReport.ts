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
import { ProviderError } from "./http/transport";

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

/**
 * Codes for failures the user's own situation explains — a missing or rejected
 * access token, no permission, no network, a lock file, a refused operation,
 * a licence state, a content conflict. The app shows them with a hint the user
 * can act on; a crash report would only be noise (and would bury the real
 * faults under it). `GIT_ERROR` / `IO_ERROR` / `INTERNAL_ERROR` and any code
 * not listed here stay reportable: unknown means "look at it".
 *
 * Keep in step with `AdgitterError::code` (crates/git-core/src/error.rs).
 */
export const EXPECTED_CODES: ReadonlySet<string> = new Set([
  // the user's input / repository state
  "REPO_NOT_FOUND",
  "INVALID_PATH",
  "INVALID_OPERATION",
  "INVALID_NAME",
  "ALREADY_EXISTS",
  "UNCOMMITTED_CHANGES",
  "LOCKED",
  "CONFLICT",
  "MERGE_COMMIT_IN_RANGE",
  "REMOTE_UPSTREAM_MISMATCH",
  // remote: credentials, permissions, reachability
  "AUTH_REQUIRED",
  "AUTH_FAILED",
  "PERMISSION_DENIED",
  "REMOTE_NOT_FOUND",
  "NETWORK_ERROR",
  "PUSH_REJECTED",
  // local file system
  "FILE_ACCESS_DENIED",
  "FILE_NOT_FOUND",
  "DISK_FULL",
  // licence / account
  "FEATURE_LOCKED",
  "LICENSE_DEVICE_MISMATCH",
  "LICENSE_EXPIRED",
  "NOT_SIGNED_IN",
  "NO_SUBSCRIPTION",
  "DEVICE_SEAT_LIMIT",
  // theme store
  "THEME_NOT_OWNED",
  "THEME_NOT_FOUND",
  "THEME_UNAVAILABLE",
]);

/**
 * Backstop for a generic code whose text is plainly a connectivity failure.
 * The shell's own HTTP calls now tag that as `NETWORK_ERROR` themselves
 * (`http_error` in src-tauri/src/commands.rs); this catches what a backend
 * from before that change — or a call site added without it — still wraps as
 * `INTERNAL_ERROR` ("… request failed: error sending request …").
 */
const NETWORK_TEXT =
  /error sending request|dns error|failed to lookup address|could not resolve|failed to resolve|connection (?:refused|reset|closed|aborted)|timed out|network is unreachable|no route to host|could not reach|failed to fetch|networkerror/i;

/** A generic-coded failure whose message says the network is down. */
export function isNetworkFailure(e: unknown): boolean {
  if (isAdgitterError(e)) {
    return (
      (e.code === "INTERNAL_ERROR" || e.code === "GIT_ERROR") &&
      NETWORK_TEXT.test(String(e.message ?? ""))
    );
  }
  // `fetch` rejects with a bare TypeError when offline.
  return e instanceof TypeError && NETWORK_TEXT.test(e.message);
}

/**
 * Whether `e` is an *expected* failure — one to explain to the user, never to
 * file as a crash report. See {@link EXPECTED_CODES}.
 */
export function isExpectedError(e: unknown): boolean {
  // Issue-tracker / provider HTTP refusals (bad token, 404, rate limit, a
  // remote edit race, the provider's own 5xx) are the provider's answer, not
  // our fault. A 4xx "validation" refusal may be a request we built wrong, so
  // that one is still reported.
  if (e instanceof ProviderError) return e.kind !== "validation";
  if (isAdgitterError(e) && EXPECTED_CODES.has(e.code)) return true;
  return isNetworkFailure(e);
}

/** Both halves of a diagnostic report for a thrown value. */
export function errorReport(e: unknown): { code: string; message: string } {
  return { code: errorCode(e), message: describeError(e) };
}
