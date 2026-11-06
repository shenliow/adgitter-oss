/**
 * The "signed-in device limit exceeded" prompt and the confirmed-eviction
 * retry behind it.
 *
 * ## The rule this module exists to keep
 *
 * **The server is the only authority on seats.** It owns the per-plan cap
 * (`device_limit_for`), it decides which device is oldest, and it performs the
 * swap in one transaction. Nothing here is an enforcement point: this module
 * only turns the server's `DEVICE_SEAT_LIMIT` refusal into a question, and the
 * user's answer into one boolean on the retry.
 *
 * In particular the desktop never names a victim. There is no device id in
 * either direction — the wire field is `evictOldestDevice: true` and nothing
 * more — so the worst a confirmed retry can do is cost this account its own
 * least-recently-used seat. A client-chosen id would have let any caller evict
 * any device it liked.
 *
 * ## Eviction only ever follows a confirmation
 *
 * {@link withSeatEvictionPrompt} runs the call with `evictOldest: false`
 * first — the plain registration, which a full account refuses while changing
 * nothing — and reaches the `true` retry **only** after
 * {@link askToEvictOldestDevice} has resolved `true`, which only
 * {@link confirmSeatPrompt} does, which only the dialog's OK button calls.
 * Every other ending (decline, dismiss, a second concurrent prompt) re-throws
 * the original refusal, so the caller's existing failure path runs unchanged.
 *
 * ## It must never block or fail a launch
 *
 * The startup seat ping is `renewLicense`, which is fired and forgotten
 * (`verify_license` is offline, only `renew_license` is networked).
 * No network, a sleeping server, an HTTP error — none of them reach this
 * module at all, because none of them is a `DEVICE_SEAT_LIMIT`: they are
 * swallowed by the caller and the app carries on from its cached licence
 * exactly as before, with the cap enforced at the next ping that lands. The
 * prompt appears only when the server has actually answered "you are full".
 */
import type { AdgitterError } from "./ipc";

/**
 * Whether `e` is the server's device-seat refusal.
 *
 * Structural, and deliberately **not** routed through `isAdgitterError` from
 * `./ipc`: this module is imported by the auth/licence paths that several test
 * files mock `./ipc` for, and a runtime import would make it depend on what
 * each of those mocks happens to re-export. The `AdgitterError` import above
 * is type-only and erased.
 */
export function isSeatLimitError(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const code = (e as Partial<AdgitterError>).code;
  return code === "DEVICE_SEAT_LIMIT";
}

/** Whether the device-limit dialog is currently on screen. */
let open = $state(false);

/**
 * Resolver for the question currently on screen. Held outside `$state` on
 * purpose — it is a continuation, not rendered data, and putting a function in
 * reactive state only invites a stale copy being called.
 */
let answer: ((confirmed: boolean) => void) | null = null;

/** Reactive: whether to render the device-limit dialog. */
export function seatPromptOpen(): boolean {
  return open;
}

/**
 * Ask the user whether to sign the account's oldest device out and take its
 * seat. Resolves `true` only on an explicit OK.
 *
 * A prompt already on screen resolves this one `false` rather than stacking a
 * second dialog or replacing the first: two seat refusals in flight at once
 * (sign-in racing the startup ping) must not produce two evictions, and the
 * declined caller simply reports its original failure.
 */
export function askToEvictOldestDevice(): Promise<boolean> {
  if (open) return Promise.resolve(false);
  open = true;
  return new Promise<boolean>((resolve) => {
    answer = resolve;
  });
}

/** The dialog's OK button: the user accepts losing their oldest device. */
export function confirmSeatPrompt(): void {
  settle(true);
}

/** The dialog's Cancel button, its scrim, and Escape. */
export function cancelSeatPrompt(): void {
  settle(false);
}

function settle(confirmed: boolean): void {
  const resolve = answer;
  answer = null;
  open = false;
  // Guard the double-click / Enter-then-click case: a settled promise cannot
  // be re-resolved, but calling through a stale resolver would be a bug worth
  // not having.
  resolve?.(confirmed);
}

/**
 * Run a licence call that registers this device, offering the eviction prompt
 * if — and only if — the server refuses it for want of a seat.
 *
 * `call` receives the confirmation flag to pass on the wire. It is invoked at
 * most twice: once with `false`, and once with `true` after an explicit OK.
 *
 * Any other failure, and a declined prompt, re-throw the original error so the
 * caller's existing handling is untouched.
 */
export async function withSeatEvictionPrompt<T>(
  call: (evictOldest: boolean) => Promise<T>,
): Promise<T> {
  try {
    return await call(false);
  } catch (e) {
    if (!isSeatLimitError(e)) throw e;
    if (!(await askToEvictOldestDevice())) throw e;
    return await call(true);
  }
}

/**
 * Reset the prompt. **Tests only** — a module-level `$state` survives between
 * cases in the same file, and a prompt left open would make the next
 * {@link askToEvictOldestDevice} resolve `false` for no visible reason.
 */
export function resetSeatPromptForTest(): void {
  answer = null;
  open = false;
}
