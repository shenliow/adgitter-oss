<!--
  Account panel (portal-capability probe fix). A
  *display/action* panel (no settings slice): it reads the reactive auth store
  and drives sign-in/out plus "manage on website" buttons that open Clerk's
  hosted Account Portal in the system browser (login/account management never
  live inside the WebView).

  Name, avatar and username come from the Clerk profile the sign-in bridge
  returns at sign-in, persisted locally so they survive a restart even though
  session restore itself runs offline (see auth.svelte.ts / accountProfile.ts)
  — hence the `—` fallbacks below are for genuinely unknown values, not
  placeholders. Email stays the license's own signed claim: it is what
  git-core defaults commit authorship to, so the panel says plainly that it is
  only a default and that a configured `user.email` always wins — anything
  less would let a user assume ADGitter had quietly re-authored their commits.

  The manage-section buttons used to be five unconditional entries that all
  opened the same guessed `/user` URL, regardless of what this Clerk instance
  actually has turned on — which is how a user could click "Two-factor auth"
  and land on a portal page that doesn't exist (this instance has no second
  factor configured, and no organizations either). `clerkPortalCapabilities`
  probes the real instance once per sign-in.

  For MFA the fix is a deep link, not a gate: "Two-factor auth" is always
  shown and always opens Clerk's Security tab (`<userProfileUrl>/security` —
  Clerk's Account Portal has no standalone `/mfa` page) rather than the
  generic Account tab, so the button now lands somewhere that can actually
  turn 2FA on. The probe still does useful work here: when it confirms this
  instance has no second factor configured yet, the button's tooltip says so,
  so a click that lands on a Security tab with no 2FA option isn't a mystery.
  "Password & security" is deep-linked the same way, since password lives on
  that tab too. Organization stays capability-gated — `manageItems` below.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import ConfirmDialog from '../ConfirmDialog.svelte';
  import {
    authState,
    startSignIn,
    signOut,
    signOutLeftCredentials,
    clerkFrontendApi,
    clerkConfigured,
    clerkPublishableKey,
    refreshAccountProfile,
  } from '../../lib/auth.svelte';
  import {
    openExternalUrl,
    clerkPortalCapabilities,
    type ClerkPortalCapabilities,
  } from '../../lib/ipc';
  import { t } from '../../lib/i18n/index.svelte';
  import type { MessageKey } from '../../lib/i18n/messages';

  // Named `account`, not `state`: a local called `state` makes every later
  // `$state(...)` in this component parse as a store subscription on it
  // (`$store` syntax), which svelte-check rejects with a baffling "cannot use
  // 'state' as a store" pointing at the rune rather than at the name.
  const account = $derived(authState());
  const signedIn = $derived(account.status === 'signed-in');
  const signingIn = $derived(account.status === 'signing-in');
  // `startSignIn` returns immediately and silently when Clerk has no
  // publishable key, so a button that ignores this looks perfectly usable and
  // does nothing at all when clicked. `UserMenu` already disables + explains;
  // this panel did not, which is how an empty key in `.env.development` showed
  // up as "the button does nothing" rather than as a configuration problem.
  const configured = $derived(clerkConfigured());

  // Opening this tab is exactly the moment a user who complained about a
  // stale name/avatar/username is looking at them — refresh from the server
  // once per mount so a Clerk-side edit shows up without a sign-out. Fire-
  // and-forget: `refreshAccountProfile` is a no-op unless already signed in,
  // and any failure (offline, server down) is silent by design,
  // so this never blocks the panel or shows an error.
  onMount(() => {
    void refreshAccountProfile();
  });

  // Fallback Account Portal user URL: the same string-munge sign-in has
  // always used (`x.clerk.accounts.dev` → `x.accounts.dev`). This is what
  // renders while `clerkPortalCapabilities` is pending or has failed — Clerk's
  // own `userProfileUrl` (below) is preferred once known, since a guess can't
  // account for a custom-domain instance the way Clerk's own answer can.
  const fallbackPortalUrl = $derived.by(() => {
    const fapi = clerkFrontendApi();
    return fapi ? `https://${fapi.replace('.clerk.', '.')}/user` : null;
  });

  // What this Clerk instance's Account Portal actually offers, probed once
  // per sign-in rather than assumed. `null` covers both "haven't asked yet"
  // and "the ask failed" (offline, unreachable, malformed key) — either way
  // `manageItems` below fails open to the always-safe subset rather than ever
  // rendering an empty manage list.
  let capabilities = $state<ClerkPortalCapabilities | null>(null);

  $effect(() => {
    if (!signedIn || !configured) {
      capabilities = null;
      return;
    }
    const key = clerkPublishableKey();
    if (!key) return;
    let cancelled = false;
    clerkPortalCapabilities(key)
      .then((caps) => {
        if (!cancelled) capabilities = caps;
      })
      .catch(() => {
        // Offline / unreachable / malformed key. `capabilities` stays null,
        // which is already the "show the safe fallback set" state below —
        // not worth surfacing as an error for what is, at worst, a couple of
        // manage buttons pointing at a slightly-guessed URL.
      });
    return () => {
      cancelled = true;
    };
  });

  const userProfileUrl = $derived(
    capabilities?.userProfileUrl ?? fallbackPortalUrl,
  );

  // Clerk's Security tab (password + two-factor) — deliberately a
  // trailing-slash strip + string concat, NOT `new URL(userProfileUrl,
  // '/security')` or similar relative resolution: a base of
  // `https://x.dev/user` would resolve a relative `security` to
  // `https://x.dev/security` (dropping the `/user` prefix Clerk's path
  // routing needs), landing on a page that doesn't exist. Don't "improve"
  // this into `new URL(...)`.
  const securityUrl = $derived(
    userProfileUrl ? `${userProfileUrl.replace(/\/+$/, '')}/security` : null,
  );

  interface ManageItem {
    id: string;
    label: MessageKey;
    href: string | null;
    title?: MessageKey;
  }

  // `account`/`password`/`mfa` are always offered — every Clerk instance has
  // a user profile, and MFA is a deep link into the Security tab rather than
  // something that needs to exist yet (see the header comment). Only
  // `organization` stays gated on Clerk confirming this instance actually
  // has it enabled. `payment` is gone permanently: Polar is the merchant of
  // record for billing, so Clerk never has a payment-methods page
  // here — that button could not have worked for any account, ever. Manage a
  // subscription from the pricing/checkout flow instead; the `account.payment`
  // i18n key stays translated in every locale in case a future Clerk billing
  // integration wants it, it just isn't referenced here — don't "restore"
  // this entry without that integration.
  const manageItems = $derived.by((): ManageItem[] => {
    // `capabilities` is `null` for both "haven't asked yet" and "the ask
    // failed" — only an affirmative `false` (the probe returned and this
    // instance genuinely has no second factor set up) earns the tooltip.
    const mfaTitle: MessageKey | undefined =
      capabilities?.mfaEnabled === false
        ? 'account.mfaNotConfigured'
        : undefined;
    const items: ManageItem[] = [
      { id: 'account', label: 'account.manageAccount', href: userProfileUrl },
      { id: 'password', label: 'account.password', href: securityUrl },
      {
        id: 'mfa',
        label: 'account.mfa',
        href: securityUrl,
        title: mfaTitle,
      },
    ];
    if (capabilities?.organizationsEnabled) {
      items.push({
        id: 'organization',
        label: 'account.organization',
        href: capabilities.organizationProfileUrl ?? userProfileUrl,
      });
    }
    return items;
  });

  async function openManage(href: string | null) {
    if (href) await openExternalUrl(href);
  }

  // Avatar fallback: same rule as UserMenu's — an absent avatarUrl, or one
  // that fails to load, falls back to the plain placeholder rather than a
  // broken-image glyph. Reset on every URL change so a stale failure doesn't
  // stick to whichever user signs in next.
  let avatarFailed = $state(false);
  $effect(() => {
    account.user?.avatarUrl;
    avatarFailed = false;
  });
  const showAvatarImg = $derived(!!account.user?.avatarUrl && !avatarFailed);

  // ── Sign-out confirmation (2026-08-18 decision) ──────────────────────────
  //
  // Signing out destroys this device's licence, so it is confirmed rather than
  // instant: the user is told what they lose and what it costs to get back —
  // notably that signing back in needs a network, because sign-in is verified
  // online. Offline that stops being a footnote and becomes the headline (there
  // is no way back into the account right now), so the body text changes.
  //
  // `navigator.onLine` only reports whether the machine has a network
  // interface, not whether our API is reachable — it can say "online" behind a
  // captive portal. That is fine here: it only chooses which true statement to
  // lead with, and both bodies say the same thing about needing a connection.
  // Nothing is gated on it, and no probe request is made — sign-out must not
  // touch the network at all.
  let confirming = $state(false);
  let offline = $state(false);

  function askSignOut() {
    offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    confirming = true;
  }

  async function confirmSignOut() {
    confirming = false;
    await signOut();
  }

  // Cancelling mid-sign-in is not the same act: there is no session yet, so
  // there is nothing to destroy and nothing to warn about. It releases the
  // loopback port and goes straight through.
  const wipeIncomplete = $derived(signOutLeftCredentials());
</script>

<div class="panel">
  {#if signedIn}
    <div class="identity">
      <div class="avatar">
        {#if showAvatarImg}
          <img
            src={account.user?.avatarUrl}
            alt=""
            referrerpolicy="no-referrer"
            loading="lazy"
            onerror={() => (avatarFailed = true)}
          />
        {/if}
      </div>
      <div class="fields">
        <div class="field">
          <span class="k">{t('account.name')}</span>
          <span class="v">{account.user?.name ?? '—'}</span>
        </div>
        <div class="field">
          <span class="k">{t('account.email')}</span>
          <span class="v">{account.user?.email ?? '—'}</span>
        </div>
        {#if account.user?.username}
          <div class="field">
            <span class="k">{t('account.username')}</span>
            <span class="v">{account.user?.username}</span>
          </div>
        {/if}
      </div>
    </div>

    {#if account.user?.email}
      <p class="hint">{t('account.emailCommitDefault')}</p>
    {/if}

    <p class="hint">{t('account.manageHint')}</p>
    <div class="manage">
      {#each manageItems as m (m.id)}
        <button
          class="link"
          onclick={() => openManage(m.href)}
          disabled={!m.href}
          title={m.title ? t(m.title) : ''}>{t(m.label)}</button
        >
      {/each}
    </div>

    <div class="actions">
      <button class="btn ghost" onclick={askSignOut}
        >{t('account.signOut')}</button
      >
    </div>
  {:else}
    <p class="hint">{t('account.signedOut')}</p>
    <!-- The wipe did not finish: the session is gone but the licence is still
         on disk, so paid features may stay unlocked until a restart. Said out
         loud rather than presented as a clean sign-out. -->
    {#if wipeIncomplete}
      <p class="hint warn" role="alert">{t('account.signOutIncomplete')}</p>
    {/if}
    <div class="actions">
      <button
        class="btn"
        onclick={startSignIn}
        disabled={signingIn || !configured}
        title={configured ? '' : t('user.signInUnavailable')}
      >
        {signingIn ? t('account.signingIn') : t('account.signIn')}
      </button>
      <!-- Without this the entry point is unusable for the whole five-minute
           listener deadline: `signOut` (which releases the loopback port) is
           only rendered in the signed-in branch, so closing the browser tab
           left the disabled button and no way back. -->
      {#if signingIn}
        <button class="btn ghost" onclick={signOut}
          >{t('account.cancelSignIn')}</button
        >
      {/if}
    </div>
    {#if signingIn}
      <p class="hint">{t('account.signingInHint')}</p>
    {/if}
  {/if}
</div>

{#if confirming}
  <ConfirmDialog
    title={t('account.signOutConfirm.title')}
    body={offline
      ? t('account.signOutConfirm.bodyOffline')
      : t('account.signOutConfirm.body')}
    confirmLabel={t('account.signOut')}
    cancelLabel={t('common.cancel')}
    onConfirm={confirmSignOut}
    onCancel={() => (confirming = false)}
  />
{/if}

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .identity {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
  .avatar {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: linear-gradient(135deg, #c9b8e8, #8a6fc0);
    flex: 0 0 auto;
    overflow: hidden;
  }
  .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .fields {
    /* A two-column grid, not `justify-content: space-between` flex rows:
       "space-between" pushes each value hard right independently of the
       others, so values never line up with each other. The grid's label
       column auto-sizes to the widest label across every row, which is what
       keeps values left-aligned and mutually aligned regardless of locale —
       "Benutzername"/"Nom d'utilisateur" are far wider than "名稱", and a
       fixed label-column width would break one language or the other. */
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 8px 12px;
    align-items: center;
    flex: 1;
    min-width: 0;
  }
  .field {
    /* `display: contents` un-wraps this row so its two `<span>` children
       become direct grid items of `.fields`, landing in its two columns.
       (A `display: contents` element renders no box of its own, so `.field`
       itself can't carry `font-size` — it lands on the `<span>`s below.) */
    display: contents;
  }
  .field .k {
    color: var(--fg-muted);
    font-size: 13px;
  }
  .field .v {
    color: var(--fg);
    font-weight: 600;
    font-size: 13px;
    justify-self: start;
  }
  .hint {
    margin: 0;
    font-size: 12px;
    color: var(--fg-muted);
    line-height: 1.4;
  }
  .hint.warn {
    color: var(--fg);
    border-left: 2px solid var(--select-ring);
    padding-left: 8px;
  }
  .manage {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .link {
    border: 1px solid var(--panel-border);
    background: var(--row-hover);
    color: var(--fg);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
  }
  .link:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .actions {
    display: flex;
    justify-content: flex-start;
    gap: 10px;
  }
  .btn {
    border: 0;
    background: var(--select-ring);
    color: #fff;
    padding: 7px 18px;
    border-radius: 7px;
    font-size: 13px;
    cursor: pointer;
  }
  .btn.ghost {
    background: var(--row-hover);
    color: var(--fg);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
