// Persisted account *display* profile (Clerk profile from the loopback
// sign-in bridge; see the module doc in auth.svelte.ts). `completeSignIn`
// only ever sees this data once, at the moment a sign-in completes, but
// `restoreSession` runs on every launch from the signed licence alone — and
// must work fully **offline** (that is the whole point of the licence design). Without somewhere to put the name/avatar/username between
// launches, they would vanish the instant the app restarted, which is worse
// than never showing them at all. This module is that somewhere.
//
// Modelled on panelWidth.ts: localStorage, webview-local, per-machine, and
// every access wrapped in try/catch so a locked/absent/quota-full store never
// throws — losing your remembered name is an annoyance, not a bug worth a
// crash over.
//
// This is **display data, not a credential**. It never gates a feature and
// is never sent anywhere; the licence token that *does* gate features lives
// in the OS keychain (via `destroyLocalCredentials`/`verifyLicense` in
// ipc.ts), not here, precisely because that one cannot be allowed to sit in a
// plain webview-readable store. A stale or tampered name/avatar is merely
// ugly; a stale or tampered licence would be a security bug.

/** A best-effort, locally cached copy of the signed-in user's display identity. */
export interface AccountProfile {
  name?: string;
  email?: string;
  avatarUrl?: string;
  username?: string;
}

const KEY = "adgitter.account.profile";

// Mirrors the caps the Rust bridge already applies to the params it hands
// `completeSignIn` (see auth.svelte.ts) — kept here too because this store
// does not trust that cap to have been applied to whatever is actually on
// disk (see {@link loadAccountProfile}).
const MAX_FIELD_LEN = 256;
const MAX_AVATAR_LEN = 512;

/**
 * Sanitize one untrusted display string: not-a-string → absent, trim, empty
 * → absent, cap at `maxLen`. Shared by the read path below and by
 * `completeSignIn`, which runs the exact same rule on the bridge params
 * before they ever reach here — so a value looks identical whether it is
 * being seen for the first time or reloaded from storage.
 */
export function sanitizeDisplayField(
  v: unknown,
  maxLen = MAX_FIELD_LEN,
): string | undefined {
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed ? trimmed.slice(0, maxLen) : undefined;
}

/**
 * Sanitize an avatar URL: only an `https://` URL survives. This is the one
 * field here with a real injection consequence rather than just a display
 * nicety — {@link AccountProfile.avatarUrl} eventually reaches an `<img
 * src>`, and a `javascript:`/`data:`/plain-`http://` value must never get
 * that far, whether it arrived fresh from the bridge or was read back out of
 * a store anything with webview access could have edited.
 */
export function sanitizeAvatarUrl(v: unknown): string | undefined {
  const s = sanitizeDisplayField(v, MAX_AVATAR_LEN);
  return s && s.startsWith("https://") ? s : undefined;
}

/**
 * Read the persisted profile, re-validating every field rather than trusting
 * what is on disk.
 *
 * The validation lives here — on the *read* side — and not only at
 * {@link saveAccountProfile} time, because the store is a plain per-machine
 * localStorage entry: it can be edited by anything with webview access (dev
 * tools, a rogue extension, a hand-edited profile in another install sharing
 * the same user-data dir), and its shape may also simply predate a later,
 * stricter version of this module. Trusting "we only ever wrote valid data"
 * would make every one of those a live bug instead of a no-op.
 *
 * Malformed JSON, a non-object, or a value that sanitizes to nothing in every
 * field all return `null` rather than an empty-ish object — there is no
 * meaningful difference between "nothing was stored" and "what was stored is
 * junk", and callers already treat `null` as "no profile".
 */
export function loadAccountProfile(): AccountProfile | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as Record<string, unknown>;
    const profile: AccountProfile = {
      name: sanitizeDisplayField(p.name),
      email: sanitizeDisplayField(p.email),
      avatarUrl: sanitizeAvatarUrl(p.avatarUrl),
      username: sanitizeDisplayField(p.username),
    };
    const hasAny = Object.values(profile).some((v) => v !== undefined);
    return hasAny ? profile : null;
  } catch {
    // Corrupt JSON, or a `localStorage` access that throws outright (private
    // mode in some browsers) — either way, there is no profile to report.
    return null;
  }
}

/**
 * Persist the display profile (best-effort; a storage failure is non-fatal —
 * the live view already has the data this launch, it just won't survive a
 * restart). Writes nothing — and clears any previously stored profile —
 * when every field is empty, so a profile that has regressed to "nothing
 * known" doesn't leave stale fields behind for {@link loadAccountProfile} to
 * resurrect later.
 *
 * Deliberately does *not* validate here (that's {@link loadAccountProfile}'s
 * job, run every time the data is read back) — this just decides what to
 * write, not whether it's trustworthy.
 */
export function saveAccountProfile(p: AccountProfile): void {
  try {
    const entries = Object.entries(p).filter(
      ([, v]) => typeof v === "string" && v.trim() !== "",
    );
    if (entries.length === 0) {
      localStorage.removeItem(KEY);
      return;
    }
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* private mode / quota — the profile simply won't survive a restart */
  }
}

/** Drop the persisted profile (sign-out; best-effort, never throws). */
export function clearAccountProfile(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* private mode / quota — nothing to clean up if nothing was written */
  }
}

/** A name/email pair usable as a git author. */
export interface GitIdentity {
  name: string;
  email: string;
}

/**
 * The account profile expressed as a git author identity, or `null` when the
 * account cannot supply one (signed out, or a profile with no email).
 *
 * This mirrors `FallbackIdentity::from_account_email` in
 * `crates/git-core/src/identity.rs` deliberately, rule for rule: the email is
 * the irreducible part (git cannot author a commit without one), a missing
 * display name is derived from the local part (`ada@example.com` → `ada`)
 * rather than invented, and anything that would corrupt a commit header
 * (`<`, `>`, newlines) or lacks a local/domain part yields `null`. Keeping the
 * two in step means the identity the Settings panel offers to write is exactly
 * the one git-core would otherwise have substituted at commit time — the UI
 * never promises an identity the backend would reject.
 *
 * `null` is the signal callers use to make the "use account identity" toggle
 * unavailable: arming a toggle that would write nothing is worse than not
 * offering it.
 */
export function accountGitIdentity(
  p: AccountProfile | null,
): GitIdentity | null {
  const email = p?.email?.trim();
  if (!email) return null;
  const at = email.indexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  const name = p?.name?.trim() || email.slice(0, at);
  if ([name, email].some((s) => /[<>\n\r\0]/.test(s))) return null;
  return { name, email };
}

/**
 * The subset of a license DTO that carries a display profile (a structural
 * subset of `LicenseStatusDto` from `ipc.ts` — not imported directly, so this
 * module stays free of a dependency on the IPC layer).
 */
export interface LicenseProfileClaims {
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  username?: string | null;
}

/**
 * Merge a license-carried display profile over a locally cached one
 * (E-clerk-profile-sync). This is how a Clerk-side name/avatar/username edit
 * reaches the account panel: the server re-pins these claims from the
 * database into every issued/renewed license (mirroring `email`'s
 * contract — see `license::License`'s doc comments), and every call site that
 * receives a fresh license runs its result through here before persisting.
 *
 * **A `null`/absent license field never clobbers a cached value.** A license
 * minted before these claims existed (or a user whose Clerk profile still has
 * nothing set) must not erase a name/avatar/username the app already
 * remembers locally — that would trade a real value for nothing. Only a
 * present, non-empty license field wins.
 *
 * `avatarUrl` is always re-sanitized (https-only) here regardless of source —
 * the license is Ed25519-signed, but that is not itself an exemption from the
 * rule that a display string never reaches an `<img src>` unchecked (see
 * {@link sanitizeAvatarUrl}).
 */
export function mergeLicenseProfile(
  license: LicenseProfileClaims,
  cached: AccountProfile | null,
): AccountProfile {
  return {
    name: sanitizeDisplayField(license.name ?? undefined) ?? cached?.name,
    email: sanitizeDisplayField(license.email ?? undefined) ?? cached?.email,
    avatarUrl:
      sanitizeAvatarUrl(license.avatarUrl ?? undefined) ?? cached?.avatarUrl,
    username:
      sanitizeDisplayField(license.username ?? undefined) ?? cached?.username,
  };
}
