/**
 * Clerk identity.
 *
 * Front-end *initialization only*: this module knows the publishable key, can
 * tell whether Clerk is configured, and can kick off sign-in by opening the
 * **system browser** at Clerk's hosted Account Portal (PKCE), per the desktop
 * design (D2.17) — we never embed Clerk's login in the WebView.
 *
 * The browser comes back over an **RFC 8252 loopback redirect** —
 * `http://127.0.0.1:<port>/bridge` — served by Rust (`loopback_auth.rs`), not
 * over the `adgitter://` scheme. Clerk's hosted Account Portal only redirects to
 * http(s) origins: it silently drops a custom-scheme `redirect_url`, which left
 * users stranded on the web page after logging in. Loopback is what every other
 * desktop OAuth client does, and it has the side benefit that sign-in now works
 * under `pnpm dev` — no packaged `.app` (and no OS scheme registration) needed.
 *
 * The redirect lands on a **bridge page** rather than a bare callback, because
 * the portal's redirect does not — and cannot — carry a session JWT: the only
 * parameter it sets is `__clerk_db_jwt`, Clerk's dev-browser handshake token.
 * The session lives in a cookie on the Clerk domain, so a page that has loaded
 * Clerk JS has to ask for it (`session.getToken()`) and POST it back to the
 * loopback server. Rust owns that page; this module only supplies the
 * publishable key it needs.
 *
 * That POST now carries a best-effort **display profile** alongside the
 * session token — `name`, `email`, `avatar`, `username`, each present only
 * when the bridge's Clerk JS actually had it (see {@link completeSignIn} for
 * the exact precedence against the licence's own claims). It is untrusted,
 * loopback-supplied display data, never a credential: {@link completeSignIn}
 * folds it into the signed-in `AuthUser` and persists it via
 * `accountProfile.ts` so it survives a restart even though
 * {@link restoreSession} itself runs offline from the licence alone.
 *
 * **The display profile also re-syncs from Clerk on every fresh license.**
 * the license server re-pins `name`/`avatarUrl`/`username` from the `users` row
 * into every issued/renewed license, the same way it has always re-pinned
 * `email` — see `license::License`'s doc comments. Every call site
 * here that receives a fresh license (`completeSignIn`, `restoreSession`)
 * merges that license-carried profile over the locally cached one via
 * `accountProfile.ts`'s `mergeLicenseProfile` and re-persists the result, so
 * a Clerk-side edit reaches the account panel the next time a license is
 * issued or renewed — see {@link restoreSession} for exactly when that is.
 *
 * The `adgitter://` scheme is **still live and unchanged** for the other two
 * deep links — `adgitter://checkout-complete` (post-payment return) and
 * `adgitter://issue/<id>` — and {@link handleCallback} still accepts an
 * `adgitter://callback` for compatibility with an already-installed build.
 *
 * `waitForSignIn` is the awaitable half of the round-trip: it settles on the
 * next status transition (or a timeout/abort), which is what lets a deferred
 * sign-in resume the action that triggered it — see `checkoutFlow.ts`.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  clearAccountProfile,
  loadAccountProfile,
  mergeLicenseProfile,
  saveAccountProfile,
  sanitizeAvatarUrl,
  sanitizeDisplayField,
} from "./accountProfile";
import { handleCheckoutReturn } from "./checkoutReturn.svelte";
import { withSeatEvictionPrompt } from "./deviceSeat.svelte";
import {
  awaitLoopbackAuth,
  cancelLoopbackAuth,
  destroyLocalCredentials,
  getDeviceId,
  issueLicense,
  openExternalUrl,
  renewLicense,
  startLoopbackAuth,
  verifyLicense,
} from "./ipc";
import { refreshEntitlement, resetEntitlement } from "./license.svelte";

/**
 * The legacy custom-scheme redirect.
 *
 * No longer sent to Clerk (the Account Portal will not bounce to a custom
 * scheme — that is the bug this module's loopback flow fixes), but
 * {@link handleCallback} still routes it: an already-installed build, or a
 * bookmarked portal URL, can still deliver one, and honouring it costs nothing.
 */
export const REDIRECT_URL = "adgitter://callback";

/** Read lazily so tests (and HMR) can stub `import.meta.env`. */
function publishableKey(): string | undefined {
  const k = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
  return k && k.length > 0 ? k : undefined;
}

/** True when a well-formed Clerk publishable key is present. */
export function clerkConfigured(): boolean {
  const k = publishableKey();
  return !!k && /^pk_(test|live)_/.test(k);
}

/**
 * The raw Clerk publishable key, when {@link clerkConfigured}. Exposed
 * (unlike the private `publishableKey` above) for callers that have to hand
 * the key itself to Rust — {@link startSignIn} and the account panel's
 * `clerkPortalCapabilities` probe — as opposed to {@link clerkFrontendApi},
 * which only exposes the *decoded host*. Public by design (see
 * `startSignIn`'s comment on the same key): it already ships in this bundle,
 * so there is nothing sensitive gained by keeping it module-private.
 */
export function clerkPublishableKey(): string | undefined {
  return clerkConfigured() ? publishableKey() : undefined;
}

/**
 * The Clerk Frontend API host encoded in the publishable key. The key is
 * `pk_(test|live)_<base64("<host>$")>`, e.g. decoding to
 * `discrete-ibex-7.clerk.accounts.dev`.
 */
export function clerkFrontendApi(): string | null {
  const k = publishableKey();
  if (!k || !clerkConfigured()) return null;
  const b64 = k.replace(/^pk_(test|live)_/, "");
  try {
    return atob(b64).replace(/\$+$/, "") || null;
  } catch {
    return null;
  }
}

/**
 * Hosted Account Portal sign-in URL (system-browser flow). For dev instances
 * the portal host drops the `clerk.` sub-label of the Frontend API host
 * (`x.clerk.accounts.dev` → `x.accounts.dev`); production custom domains will
 * be revisited when the prod instance is provisioned.
 *
 * `redirect` is **required and must be an http(s) URL** — the Account Portal
 * ignores a custom-scheme redirect and strands the user on the web page, so
 * there is deliberately no default here. {@link startSignIn} passes the
 * loopback URL minted by Rust.
 */
export function clerkSignInUrl(redirect: string): string | null {
  const fapi = clerkFrontendApi();
  if (!fapi) return null;
  const portalHost = fapi.replace(".clerk.", ".");
  const url = new URL(`https://${portalHost}/sign-in`);
  url.searchParams.set("redirect_url", redirect);
  return url.toString();
}

export type AuthStatus = "signed-out" | "signing-in" | "signed-in";

export interface AuthUser {
  name?: string;
  email?: string;
  plan?: string;
  /**
   * Avatar image URL, sourced from the Clerk profile the sign-in bridge
   * returns ({@link completeSignIn}) or restored from the locally persisted
   * copy ({@link restoreSession}). Always `https://` when present — an
   * absent or non-`https://` value is dropped rather than carried, since this
   * eventually reaches an `<img src>` (see `accountProfile.ts`).
   */
  avatarUrl?: string;
  /**
   * Clerk username, same provenance as {@link avatarUrl}. Used as the
   * display-name fallback when Clerk has no full name for the user, and
   * shown as its own row in the account panel when present.
   */
  username?: string;
}

interface AuthView {
  status: AuthStatus;
  user?: AuthUser;
}

let view = $state<AuthView>({ status: "signed-out" });

/**
 * Status-transition subscribers. `authState()` is enough for rendering, but the
 * lazy-sign-in checkout flow needs to *await* a transition (sign in, then
 * resume the purchase) from plain module code where a `$effect` isn't
 * available — so every write to `view` goes through {@link setView}, which
 * notifies these.
 */
const statusListeners = new Set<(status: AuthStatus) => void>();

function setView(next: AuthView): void {
  view = next;
  // Copy first: a listener may unsubscribe itself while we iterate.
  for (const listener of [...statusListeners]) listener(next.status);
}

/** Subscribe to auth-status transitions. Returns an unsubscribe function. */
export function onAuthStatus(fn: (status: AuthStatus) => void): () => void {
  statusListeners.add(fn);
  return () => {
    statusListeners.delete(fn);
  };
}

/**
 * How a {@link waitForSignIn} wait ended.
 *
 * `cancelled` and `failed` both land on `signed-out`, but they are different
 * things to tell a user: `cancelled` is *their* doing (they dismissed the
 * portal, signed out, or the caller aborted), while `failed` means the sign-in
 * was refused or couldn't complete (offline, rejected JWT, invalid license).
 * Reporting the latter as "you cancelled" is simply untrue.
 */
export type SignInOutcome = "signed-in" | "cancelled" | "timeout" | "failed";

/**
 * Why the last transition to `signed-out` happened, so {@link waitForSignIn}
 * can tell a refusal from a cancellation. The status itself can't carry this:
 * every outcome is the same state.
 *
 * `timeout` is the loopback listener giving up (the user opened the portal and
 * never came back) — distinct from the caller-side timer in
 * {@link waitForSignIn}, but the same thing to report.
 */
let signedOutCause: "cancelled" | "failed" | "timeout" = "cancelled";

/** Move to `signed-out`, remembering why. */
function setSignedOut(cause: "cancelled" | "failed" | "timeout"): void {
  signedOutCause = cause;
  setView({ status: "signed-out" });
}

/** Default patience for a browser round-trip before we stop waiting (10 min). */
export const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Resolve once the pending sign-in settles — the awaitable half of
 * {@link startSignIn}, used by the checkout flow to resume a purchase the
 * moment the user is signed in.
 *
 * Resolves `"signed-in"` on success (immediately if already signed in),
 * `"cancelled"` when the user backed out (callback carried an `error`, the user
 * signed out, or `signal` aborted), `"failed"` when the sign-in was refused or
 * couldn't complete (offline, rejected JWT, invalid license) and `"timeout"`
 * after `timeoutMs`. It never rejects and never hangs, so a caller can always
 * clear its loading state and say something specific.
 */
export function waitForSignIn(
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<SignInOutcome> {
  if (view.status === "signed-in") return Promise.resolve("signed-in");
  if (opts.signal?.aborted) return Promise.resolve("cancelled");
  return new Promise<SignInOutcome>((resolve) => {
    let done = false;
    const settle = (outcome: SignInOutcome) => {
      if (done) return;
      done = true;
      unsubscribe();
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve(outcome);
    };
    const onAbort = () => settle("cancelled");
    const timer = setTimeout(
      () => settle("timeout"),
      opts.timeoutMs ?? SIGN_IN_TIMEOUT_MS,
    );
    const unsubscribe = onAuthStatus((status) => {
      if (status === "signed-in") settle("signed-in");
      else if (status === "signed-out") settle(signedOutCause);
    });
    opts.signal?.addEventListener("abort", onAbort);
  });
}

/**
 * Params captured from the most recent `adgitter://` callback, awaiting the
 * backend token exchange (the license server). Null until a callback arrives.
 */
let pendingCallback: Record<string, string> | null = null;

/**
 * Issue id captured from an `adgitter://issue/<id>` deep link,
 * reactive so the app can open + select that issue (and its bound branch). Null
 * until such a link arrives; the consumer clears it via
 * {@link clearRequestedIssue}.
 */
let requestedIssue = $state<string | null>(null);

/** Reactive auth state for components (`authState().status`). */
export function authState(): AuthView {
  return view;
}

/** Params from the last OAuth callback, to be exchanged once the backend exists. */
export function getPendingCallback(): Record<string, string> | null {
  return pendingCallback;
}

/** The issue id requested by an `adgitter://issue/<id>` deep link, or null. */
export function requestedIssueId(): string | null {
  return requestedIssue;
}

/** Clear the pending issue request once the app has opened/selected it. */
export function clearRequestedIssue(): void {
  requestedIssue = null;
}

/**
 * Whether the last routed deep link was a `checkout-complete` return, so
 * {@link receiveDeepLink} knows to kick off the (async) licence re-check.
 * Consumed exactly once — like {@link pendingCallback}, this keeps
 * {@link handleCallback} pure and synchronous.
 */
let pendingCheckoutReturn = false;

/** Whether a `checkout-complete` deep link is awaiting its licence re-check. */
export function getPendingCheckoutReturn(): boolean {
  return pendingCheckoutReturn;
}

/**
 * Handle a deep-link callback URL. Returns whether the URL was one of ours.
 *
 * Three shapes are recognized (all under the `adgitter://` scheme):
 *  - `adgitter://callback?…` — the OAuth handshake: an `error` param drops
 *    back to signed-out; otherwise the params are captured for the (pending)
 *    backend exchange.
 *  - `adgitter://issue/<id>` — an issue deep link: the id is captured
 *    reactively so the app opens + selects that issue.
 *  - `adgitter://checkout-complete` — Polar's post-payment redirect: flagged for
 *    a server-side licence re-check. **Nothing in this URL is trusted** — see
 *    `checkoutReturn.svelte.ts`; any web page can fire it, so it grants nothing
 *    on its own and its query string is not read at all.
 *
 * Pure and synchronous so it is unit-testable without the deep-link plugin.
 */
export function handleCallback(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "adgitter:") return false;
  // Reflects the URL being routed *now*: a link of any other shape must not
  // inherit a payment return that a previous one flagged.
  pendingCheckoutReturn = false;
  // `adgitter://issue/<id>` → route to the issue panel.
  if (url.host === "issue") {
    const id = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    if (id) {
      requestedIssue = id;
      return true;
    }
    return false;
  }
  // `adgitter://checkout-complete` → re-check the licence with the server. The
  // auth state is deliberately untouched: this is not a sign-in, and a payment
  // return must never move a signed-in user to `signing-in`.
  if (url.host === "checkout-complete") {
    pendingCheckoutReturn = true;
    return true;
  }
  // An already-completed sign-in must not be re-opened by a stale callback.
  // The launch URL can legitimately arrive twice — `initDeepLinks` reads it via
  // `getCurrent()` *and* the OS may re-deliver it through `onOpenUrl` — and
  // replaying it would knock a signed-in user back to `signing-in`, then to
  // `signed-out` when the by-then-expired JWT is rejected. Guarding on the
  // *state* rather than deduping the URL string covers every replay source (and
  // any other stale callback), and costs nothing legitimate: a deliberate
  // re-sign-in goes through `startSignIn`, which leaves `signing-in` first.
  if (view.status === "signed-in") {
    console.info("[auth] ignoring auth callback: already signed in");
    return true;
  }
  const params = Object.fromEntries(url.searchParams.entries());
  if (params.error) {
    pendingCallback = null;
    // The portal bounced us back with an explicit error — in practice the user
    // declining/dismissing it. Their doing, not a service refusal.
    setSignedOut("cancelled");
    return true;
  }
  // Callback received. Stash the params and hold at signing-in; the exchange
  // for a signed license is the caller's next step ({@link receiveDeepLink}
  // does it immediately — `handleCallback` itself stays pure and synchronous so
  // routing can be tested without the network).
  pendingCallback = params;
  setView({ status: "signing-in" });
  return true;
}

/**
 * Subscribe to `adgitter://` deep links (and process any cold-start launch URL),
 * routing each to {@link receiveDeepLink} — which both routes the URL and
 * finishes the license exchange, closing the login loop. Safe to call once on
 * startup; failures are swallowed so a missing plugin never breaks boot.
 */
export async function initDeepLinks(): Promise<void> {
  // Multi-window (paid, `MultiWindow`): with N windows open, every one of
  // them would otherwise register a deep-link handler and each would process
  // the same incoming `adgitter://` URL — double-handling the OAuth callback
  // (racing/duplicating the token exchange) and issue links (opening the
  // issue in every window). Only the `main` window owns deep links; secondary
  // repo windows (booted with `?repo=`) skip registration entirely.
  if (getCurrentWindow().label !== "main") return;
  try {
    const { onOpenUrl, getCurrent } =
      await import("@tauri-apps/plugin-deep-link");
    const launched = await getCurrent();
    launched?.forEach((url) => void receiveDeepLink(url));
    await onOpenUrl((urls) => urls.forEach((url) => void receiveDeepLink(url)));
  } catch {
    // No deep-link plugin (e.g. tests/SSR) — sign-in still opens the browser,
    // the callback just won't round-trip in this context.
  }
}

/**
 * Begin sign-in (RFC 8252 loopback):
 *
 *  1. ask Rust to bind `http://127.0.0.1:<port>/bridge` and mint a `state`
 *     nonce ({@link startLoopbackAuth});
 *  2. build the Account Portal URL around that redirect and open the **system
 *     browser** at it;
 *  3. park at `signing-in` and let the listener finish the job in the
 *     background ({@link finishLoopbackSignIn}).
 *
 * Resolves as soon as the browser is open — the contract callers rely on
 * (`checkoutFlow` starts the sign-in, then awaits {@link waitForSignIn}); it
 * deliberately does **not** await the round-trip.
 *
 * No-op (stays signed-out) when Clerk is not configured. Every failure before
 * the browser opens settles at `signed-out` so nothing waits on a sign-in that
 * cannot happen, and the loopback port is released rather than leaked.
 */
export async function startSignIn(): Promise<void> {
  const key = publishableKey();
  if (!clerkConfigured() || !key) return;
  pendingCallback = null;
  signedOutCause = "cancelled";
  setView({ status: "signing-in" });

  let started: Awaited<ReturnType<typeof startLoopbackAuth>>;
  try {
    // The publishable key is public by design (it already ships in this
    // bundle); Rust needs it to build the bridge page and derive the only
    // script origin that page's CSP will allow.
    started = await startLoopbackAuth(key);
  } catch (e) {
    // Typically every candidate port is occupied. Not the user's doing.
    console.error("[auth] could not start the sign-in listener:", e);
    setSignedOut("failed");
    return;
  }

  const url = clerkSignInUrl(started.redirectUrl);
  if (!url) {
    void cancelLoopbackAuth();
    setSignedOut("failed");
    return;
  }

  try {
    await openExternalUrl(url);
  } catch {
    // Browser failed to open — drop back so the entry point stays usable, and
    // hand the port back. Not the user's choice, so anything waiting hears
    // "failed", not "cancelled".
    void cancelLoopbackAuth();
    setSignedOut("failed");
    return;
  }

  // Fire-and-forget: the listener resolves minutes later, and `waitForSignIn`
  // is how callers observe it.
  void finishLoopbackSignIn();
}

/**
 * Await the loopback callback and turn it into a license.
 *
 * Rust has already verified the `state` nonce, so `params` is a callback that
 * really came from the sign-in *this* app started — but nothing beyond that is
 * assumed: the params go through the same {@link completeSignIn} exchange the
 * deep-link path uses, and entitlement still comes only from a signature the
 * client verifies offline.
 *
 * **`params` carries the session token; it is never logged.**
 */
async function finishLoopbackSignIn(): Promise<void> {
  let result: Awaited<ReturnType<typeof awaitLoopbackAuth>>;
  try {
    result = await awaitLoopbackAuth();
  } catch (e) {
    console.error("[auth] the sign-in listener failed:", e);
    setSignedOut("failed");
    return;
  }

  // The user walked away, or another sign-in superseded this one. Either way
  // this attempt is over; say which, so the UI does not claim a failure.
  if (result.timedOut) return setSignedOut("timeout");
  if (result.cancelled) return setSignedOut("cancelled");

  // A completed sign-in must not be re-opened by a late callback — the same
  // guard `handleCallback` applies to a replayed deep link.
  if (view.status === "signed-in") return;

  if (result.params.error) {
    pendingCallback = null;
    // The bridge page's own codes mean the round-trip broke *after* the user
    // did their part (Clerk JS never loaded, no session behind the handshake,
    // `getToken()` came back empty) — reporting that as "you cancelled" is
    // simply untrue. Anything else is the portal bouncing back with an error,
    // in practice the user declining: their doing, not a service refusal.
    setSignedOut(
      BRIDGE_FAILURES.has(result.params.error) ? "failed" : "cancelled",
    );
    return;
  }

  pendingCallback = result.params;
  setView({ status: "signing-in" });
  await completeSignIn();
}

/**
 * `error` codes minted by the Rust bridge page itself (as opposed to Clerk's
 * own `error=access_denied` and friends). These are failures, not
 * cancellations — see {@link finishLoopbackSignIn}. Kept in sync with
 * `BRIDGE_HTML` in `loopback_auth.rs`.
 */
const BRIDGE_FAILURES = new Set([
  "clerk_unavailable",
  "no_session",
  "no_token",
  "bridge_failed",
]);

/**
 * Clerk session-JWT param names accepted from a callback, in priority order
 * (first present wins).
 *
 * `token` is what the bridge posts back and is deliberately **first**.
 * `__clerk_db_jwt` is *not* a session JWT — it is Clerk's dev-browser handshake
 * token, and it used to win this race, which is precisely why sign-in failed
 * with a JWKS rejection at `/license/issue`. It stays at the end only so a
 * legacy `adgitter://callback?__clerk_db_jwt=…` from an already-installed build
 * still routes; nothing in the current flow produces it. Never fabricate a JWT
 * when none is present.
 */
const JWT_PARAMS = ["token", "session", "__clerk_db_jwt"] as const;

/**
 * Finish the login→unlock loop for a captured callback. Reads the
 * pending callback params, extracts a Clerk session JWT (first of
 * {@link JWT_PARAMS} present), and exchanges it via {@link issueLicense} for a
 * device-bound verified license. On a non-`invalid` status: sets `signed-in`
 * with the plan, clears the pending callback, and returns true.
 *
 * `deviceId` defaults to this install's persisted id ({@link getDeviceId}) —
 * callers pass one only in tests.
 *
 * Every ending here is a *failure* rather than a cancellation — the user did
 * their part and came back; it was the exchange that was refused — so the
 * signed-out cause is recorded as such and `waitForSignIn` reports `"failed"`.
 *
 * **Every failure ends at `signed-out`, not `signing-in`.** A sign-in that can
 * never complete (no JWT in the callback, no device id, a rejected or invalid
 * license) must settle: anything waiting on it — `waitForSignIn`, and through it
 * a purchase parked in `checkoutFlow` — would otherwise sit on the 10-minute
 * timeout, and the account panel's spinner would never stop. The un-exchangeable
 * callback params are kept for diagnostics; a rejected exchange clears them.
 */
export async function completeSignIn(deviceId?: string): Promise<boolean> {
  const params = pendingCallback;
  if (!params) return false; // nothing was started — leave the state alone
  const jwt = JWT_PARAMS.map((k) => params[k]).find((v) => !!v);
  if (!jwt) {
    // No session JWT — do NOT fabricate one. Nothing more is coming for this
    // callback, so stop waiting on it.
    setSignedOut("failed");
    return false;
  }
  try {
    const device = deviceId ?? (await getDeviceId());
    // A full account is the one refusal here with a way through: the server
    // answers `DEVICE_SEAT_LIMIT` having changed nothing, the user is asked
    // whether to sign their oldest device out, and only an explicit OK retries
    // with `evictOldest`. Declining re-throws, so the `catch` below settles
    // this sign-in at `signed-out` exactly as any other rejection does — the
    // account really is full, and leaving the user at `signing-in` would park
    // `waitForSignIn` (and any purchase behind it) on its 10-minute timeout.
    const status = await withSeatEvictionPrompt((evictOldest) =>
      issueLicense(jwt, device, evictOldest),
    );
    if (status.status === "invalid") {
      pendingCallback = null;
      setSignedOut("failed");
      return false;
    }
    // Build the display identity from both sources, re-validating the
    // bridge's half exactly as `accountProfile.ts` would on a later read —
    // `params` arrived over a plain loopback HTTP POST, so it is untrusted
    // display data no matter how much the Rust side already sanitized it.
    //
    // Every field follows the same precedence as `email` always has: the
    // **licence's** re-pinned claim wins over the bridge's `params` copy. The
    // licence's claims are read from the database at issue time (the same
    // contract `email` has always had — see `license::License`'s doc
    // comments), while `params` arrived over a plain loopback HTTP POST that
    // anything on this machine could in principle have sent. `params` only
    // fills in a field the licence carries none of at all (a licence minted
    // before these claims existed) — `mergeLicenseProfile` implements exactly
    // that rule.
    const bridgeProfile = {
      name:
        sanitizeDisplayField(params.name) ??
        sanitizeDisplayField(params.username),
      email: sanitizeDisplayField(params.email),
      avatarUrl: sanitizeAvatarUrl(params.avatar),
      username: sanitizeDisplayField(params.username),
    };
    const merged = mergeLicenseProfile(status, bridgeProfile);

    // Persist the *display* fields (never the licence/plan) so they survive
    // an offline restart — `restoreSession` reads them back and has no other
    // source for a name or avatar. `email` is included too even though the
    // licence usually already carries it: it is the only copy for the
    // older-licence fallback case, and without it a restored session would show
    // the dash again until the next real sign-in.
    saveAccountProfile(merged);

    setView({
      status: "signed-in",
      user: {
        plan: status.plan ?? undefined,
        email: merged.email,
        name: merged.name,
        avatarUrl: merged.avatarUrl,
        username: merged.username,
      },
    });
    pendingCallback = null;
    return true;
  } catch {
    // No device id, or the issue call failed (offline / rejected JWT).
    pendingCallback = null;
    setSignedOut("failed");
    return false;
  }
}

/**
 * Restore a previous session at startup from the persisted license.
 *
 * Signing in writes a device-bound, Ed25519-signed license to the OS keychain,
 * but nothing ever read it back: the store booted at `signed-out` every launch,
 * so a user who had signed in was told they had not — while `create_checkout`,
 * which reads the stored token directly and never looks at this store, kept
 * working. Only the UI was lying. This is the read-back.
 *
 * **Offline by construction.** The only call is `verify_license`, which checks
 * an Ed25519 signature against the public key compiled into the binary — the
 * whole point of the signed-license design. There is no network on
 * this path, so a launch with the machine disconnected restores exactly as one
 * online does. It must stay that way: adding a server round-trip here would
 * make sign-in state depend on connectivity.
 *
 * Restores **only** on `active` or `grace`. Expired past the grace window,
 * malformed, signed by the wrong key, or bound to a different device all leave
 * the state at `signed-out`: a broken license must never look like a session.
 * Device binding is re-checked here (`pinDevice`) precisely because a license
 * file copied from another machine would otherwise pass.
 *
 * The restored user carries **the plan and profile from the license**, merged
 * over {@link loadAccountProfile}'s locally cached copy via
 * `mergeLicenseProfile`: for `email`/`name`/`avatarUrl`/`username` alike, a
 * present, non-empty claim on the license wins; a `None`/absent claim (a
 * license minted before that field existed, or Clerk genuinely having nothing
 * set) falls back to whatever the last sign-in persisted locally, and never
 * erases it. The merged result is re-saved via `saveAccountProfile`, so a
 * Clerk-side profile edit already reflected in the *stored* license (from a
 * prior `completeSignIn`, {@link refreshAccountProfile}, or the checkout-return
 * poll) is picked up here and survives the *next* restart too.
 *
 * **This function itself is not a round-trip.** `verify_license` is a purely
 * local Ed25519 check against the token already on disk (see above) — it
 * cannot observe a change made on the Clerk side after that token was minted.
 * {@link refreshAccountProfile} is what adds a real server round-trip (via
 * `renew_license`), fired in the background after a successful restore and
 * again whenever the account panel is opened, so a Clerk-side edit reaches a
 * long-lived signed-in session without requiring a fresh sign-in. A profile
 * with nothing usable in it anywhere (never signed in on this device,
 * `clearAccountProfile` ran at the last sign-out, and a pre-profile-claims
 * license) simply contributes nothing, and the old dashes return.
 *
 * Never throws and never blocks boot: callers `void` it, and any failure is
 * simply "stay signed out".
 *
 * Returns whether a session was restored.
 */
export async function restoreSession(): Promise<boolean> {
  // A sign-in already in flight (or a dev mock) owns the state; a startup
  // restore must not reach in behind it.
  if (view.status !== "signed-out") return view.status === "signed-in";
  let status: Awaited<ReturnType<typeof verifyLicense>>;
  try {
    status = await verifyLicense(undefined, { pinDevice: true });
  } catch {
    // No backend (tests/SSR) or an unreadable store — stay signed out.
    return false;
  }
  if (status.status !== "active" && status.status !== "grace") return false;
  // Re-check after the await: verification is fast but not instantaneous, and
  // a real sign-in that landed meanwhile must not be clobbered by this one.
  if (view.status !== "signed-out") return view.status === "signed-in";
  // Merge the license's re-pinned profile claims over the locally cached
  // copy — a present license value wins, an absent/None one falls back to
  // what the last sign-in persisted (see `mergeLicenseProfile`) — then
  // re-persist so a Clerk-side edit observed here also survives the next
  // restart.
  const merged = mergeLicenseProfile(status, loadAccountProfile());
  saveAccountProfile(merged);
  setView({
    status: "signed-in",
    user: {
      plan: status.plan ?? undefined,
      email: merged.email,
      name: merged.name,
      avatarUrl: merged.avatarUrl,
      username: merged.username,
    },
  });
  return true;
}

/**
 * Best-effort refresh of the signed-in account's display profile and
 * entitlement from the server — the fetch half of "sync Settings → Account
 * when the Clerk account changes" ({@link restoreSession} covers only the
 * webhook-fed half, from whatever license is already on disk).
 *
 * Calls `renew_license` (the same re-issue-from-current-entitlement call the
 * checkout-return poll uses — see `checkoutReturn.svelte.ts`), which re-pins
 * `name`/`avatarUrl`/`username`/`email` from Clerk into a fresh license the
 * same way `completeSignIn`/`restoreSession` do. On a valid (`active`/`grace`)
 * result: the license-carried profile is merged over the cached copy via
 * `mergeLicenseProfile` (present license field wins, absent falls back —
 * never erases), persisted, and `refreshEntitlement()` is run so
 * `license.svelte.ts`'s plan/features/ownedThemes stay in lock-step with the
 * same freshly-renewed (and, on the Rust side, freshly-persisted) token —
 * a plan upgraded on the web must not be silently dropped here even though
 * only the *display* profile is what prompted this refresh.
 *
 * **This is also the device-seat ping.** `renew_license` re-runs the server's
 * seat check, which bumps this install's `last_seen` — so fired once after a
 * successful restore, it is "register the device UUID and its last-login time
 * with the server" with no second scheduler and no extra round trip. The one
 * case it surfaces anything is a full account (`DEVICE_SEAT_LIMIT`), which
 * raises the device-limit prompt; see `deviceSeat.svelte.ts`.
 *
 * **Offline-first: every failure is completely silent.** No
 * network, a down server, or a renew the server rejects all leave the
 * existing signed-in session and its cached profile exactly as they were —
 * no error surfaced, no sign-out, no profile clear. An `invalid` result (the
 * server responded, but the re-verified token failed — the one case
 * `renewLicense` can resolve rather than reject) is treated the same way: it
 * carries no license-side profile fields worth merging, and its `plan` must
 * not overwrite a still-valid one.
 *
 * No-op unless the view is currently `signed-in`, and re-checks that after the
 * await, the same way {@link restoreSession} does — a sign-out (or a sign-in
 * racing in) mid-request must not have this resurrect or clobber a different
 * session.
 *
 * Returns whether the refresh actually applied, so callers/tests can tell a
 * real update from a silent no-op.
 */
export async function refreshAccountProfile(): Promise<boolean> {
  if (view.status !== "signed-in") return false;
  let dto: Awaited<ReturnType<typeof renewLicense>>;
  try {
    dto = await withSeatEvictionPrompt((evictOldest) =>
      renewLicense(evictOldest),
    );
  } catch {
    // Offline, server down, or a rejected renew: stay silent,
    // leave the session and cached profile untouched. A declined device-limit
    // prompt lands here too and is treated identically: the cached licence
    // keeps working, and the cap is re-checked at the next ping that lands.
    return false;
  }
  if (dto.status !== "active" && dto.status !== "grace") {
    // The server answered, but the re-verified token did not come back
    // valid. Nothing here is trustworthy enough to merge or apply.
    return false;
  }
  // Keep the entitlement store (plan/features/ownedThemes) consistent with
  // the license this refresh just renewed and Rust just persisted.
  await refreshEntitlement();
  // Re-check after BOTH awaits, not just the renew: this refresh fires on
  // the Account panel's own mount, and that panel is where Sign out lives —
  // so "user signs out while the refresh is still in flight" is an ordinary
  // sequence, not a theoretical race. Landing after it would both re-save a
  // profile `clearAccountProfile` just dropped and flip the view back to
  // signed-in.
  if (view.status !== "signed-in") return false;
  const merged = mergeLicenseProfile(dto, loadAccountProfile());
  saveAccountProfile(merged);
  setView({
    status: "signed-in",
    user: {
      plan: dto.plan ?? undefined,
      email: merged.email,
      name: merged.name,
      avatarUrl: merged.avatarUrl,
      username: merged.username,
    },
  });
  return true;
}

/**
 * Handle one incoming `adgitter://` URL end-to-end: route it
 * ({@link handleCallback}), and when it was an OAuth callback carrying params,
 * immediately exchange them for a license ({@link completeSignIn}); when it was
 * a payment return, re-check the licence with the server
 * ({@link handleCheckoutReturn}).
 *
 * This is the step that closes the login loop — without it a returning user
 * would sit at `signing-in` forever. Never throws: `completeSignIn` already
 * folds every failure into `signed-out`, and the checkout re-check folds every
 * failure into its own reported state.
 */
export async function receiveDeepLink(rawUrl: string): Promise<void> {
  if (!handleCallback(rawUrl)) return;
  if (pendingCheckoutReturn) {
    pendingCheckoutReturn = false;
    // Fire-and-forget: the poll runs for up to ~60s and its progress is shown
    // reactively, so the deep-link handler must not block on it.
    void handleCheckoutReturn();
    return;
  }
  // Only an OAuth callback leaves params pending (an `adgitter://issue/<id>`
  // link and an `error=` callback both leave it null).
  if (getPendingCallback()) await completeSignIn();
}

/**
 * Whether the last sign-out left a licence token behind (a locked or failing
 * keychain, an unwritable store file). Sticky until the next sign-out, and read
 * by the account panel to warn rather than present a half sign-out as a clean
 * one — the app is signed out either way, but paid features may stay unlocked
 * until the next launch.
 */
let signOutLeftToken = $state(false);

/** See {@link signOutLeftToken}. */
export function signOutLeftCredentials(): boolean {
  return signOutLeftToken;
}

/**
 * Sign out on this device: drop the session view **and destroy the credentials
 * behind it** (2026-08-18 decision).
 *
 * Previously this reset the view alone, which produced the worst possible
 * state: the UI said "signed out" while the licence token sat in the keychain,
 * so paid features stayed unlocked and — the serious half — commits carried on
 * being authored with the signed-out account's email, permanently, into git
 * history. {@link destroyLocalCredentials} removes both persisted token copies
 * and clears that commit identity in Rust; {@link resetEntitlement} drops the
 * cached plan/features/owned-themes the token had granted; and
 * {@link clearAccountProfile} drops the locally persisted display profile
 * (name/avatar/username) for the same reason as the rest of this function —
 * leaving the previous user's name and face in localStorage for whoever signs
 * in next on this device is exactly the half-sign-out this rewrite exists to
 * end.
 *
 * **Never blocked by the network, and never throws.** Signing out offline is
 * explicitly supported: signing *in* has always required online verification,
 * so "no network, no way back in until there is one" is a consequence of that,
 * not a defect — the account panel says so before the user confirms. There is
 * no seat-release call for the same reason (and no endpoint for one): if the
 * server is unreachable, the local sign-out still completes.
 *
 * Ordering is deliberate. The local view and entitlement are cleared *first*,
 * synchronously, because they cannot fail and the user asked for them; the
 * credential wipe is awaited afterwards. A hung or missing backend (tests, SSR)
 * therefore still leaves a fully signed-out app rather than a button that does
 * nothing.
 *
 * Also tears down any loopback listener still waiting for a callback: signing
 * out mid-sign-in must not leave a port bound (nor leave a stale callback able
 * to land afterwards).
 */
export async function signOut(): Promise<void> {
  pendingCallback = null;
  void cancelLoopbackAuth().catch(() => {});
  signOutLeftToken = false;
  // Deliberate — anything waiting on a sign-in hears "cancelled", not "failed".
  setSignedOut("cancelled");
  resetEntitlement();
  clearAccountProfile();
  try {
    const report = await destroyLocalCredentials();
    signOutLeftToken = report.tokenRemains;
  } catch {
    // No Tauri backend (tests, SSR). The session is already gone locally;
    // there is nothing further this layer can do, and it must not throw.
  }
}

/**
 * DEV-ONLY: force a signed-in state with a mock user, so the account/UI can be
 * developed without a real Clerk backend. Driven by `VITE_MOCK_API` (see
 * App startup); never called in production.
 */
export function signInMock(user: AuthUser = {}): void {
  setView({
    status: "signed-in",
    user: {
      name: user.name ?? "Dev User",
      email: user.email ?? "dev@adgitter.local",
      plan: user.plan,
      // Unlike name/email, there's no meaningful synthetic default for
      // either of these — a fake https URL would just 404, and a made-up
      // username is no more useful than none. A caller who wants to see the
      // avatar/username UI passes them explicitly; otherwise the mock renders
      // exactly like a real account that has neither (gradient placeholder,
      // no Username row) — the same "absent, not faked" rule the rest of
      // this module follows.
      avatarUrl: user.avatarUrl,
      username: user.username,
    },
  });
}
