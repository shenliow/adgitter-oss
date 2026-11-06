<!--
  User popover. The identity shown here is real, not placeholder content:
  name/avatarUrl/username come from the Clerk profile the sign-in bridge
  returns at sign-in and are persisted locally so they survive a restart (see
  auth.svelte.ts / accountProfile.ts); email is the signed license's own
  claim. Account/billing management itself still happens in Clerk's hosted
  portal (see AccountPanel), not in this popover.
-->
<script lang="ts">
  import { LOCALES } from '../lib/i18n/messages';
  import { t } from '../lib/i18n/index.svelte';
  import Icon from '../lib/icons/Icon.svelte';
  import type { AuthStatus, AuthUser } from '../lib/auth.svelte';
  import {
    getPlan,
    refreshEntitlement,
    type Plan,
  } from '../lib/license.svelte';
  import {
    startCheckout,
    startSubscriptionPortal,
    checkoutNotice,
    nextPlanAbove,
  } from '../lib/checkoutFlow';
  import {
    DEV_PLAN_CHOICES,
    REAL_LICENCE,
    devPlanSelection,
    setDevPlanChoice,
    type DevPlanChoice,
  } from '../lib/devPlan.svelte';
  import type { MessageKey } from '../lib/i18n/messages';

  let {
    locale = 'en',
    onLocale = () => {},
    onClose = () => {},
    status = 'signed-out',
    user = undefined,
    configured = false,
    onSignIn = () => {},
    onSignOut = () => {},
    onReplayTutorial,
  }: {
    locale?: string;
    onLocale?: (locale: string) => void;
    onClose?: () => void;
    status?: AuthStatus;
    user?: AuthUser;
    configured?: boolean;
    onSignIn?: () => void;
    onSignOut?: () => void;
    /** "Watch the guided tour again". Absent ⇒ the item is not shown. */
    onReplayTutorial?: () => void;
  } = $props();

  const signedIn = $derived(status === 'signed-in');

  // The avatar <img> can fail to load after it's already rendered (an
  // expired/dead URL, a network hiccup) — a broken-image glyph in a 40px
  // circle reads as a bug, not "no avatar", so a load failure falls back to
  // the same gradient placeholder as an absent avatarUrl. Reset on every URL
  // change so a stale failure doesn't stick to whichever user signs in next.
  let avatarFailed = $state(false);
  $effect(() => {
    user?.avatarUrl;
    avatarFailed = false;
  });
  const showAvatarImg = $derived(!!user?.avatarUrl && !avatarFailed);

  // Bold line: best display name available, falling through to the email as
  // a last resort. The line under it is the email specifically — the user's
  // actual sign-in address, and the headline requirement of this change — but
  // only when it isn't already the thing shown in bold; otherwise the same
  // address would render twice.
  const displayName = $derived(
    user?.name ?? user?.username ?? user?.email ?? '',
  );
  const showEmailLine = $derived(!!user?.email && user.email !== displayName);

  // Plan comes from the entitlement store, not a prop: `AuthUser.plan` is a
  // loose display string off the license DTO, while `getPlan()` is the app's
  // single reactive source of entitlement truth (the same call AdBanner and
  // DevicesList make from inside their own components). Reading it here means
  // the star follows a `refreshEntitlement()` / post-checkout upgrade without
  // App.svelte having to re-plumb a prop. Identity and locale stay props —
  // those really are App's to own.
  const plan = $derived<Plan>(getPlan());
  const PLAN_LABEL: Record<Plan, MessageKey> = {
    free: 'plan.free',
    basic: 'plan.basic',
    advance: 'plan.advance',
    enterprise: 'plan.enterprise',
  };
  // Free wears no star at all (FR: only paid tiers are marked). Signed out
  // there is no plan to speak of, so nothing renders either — but those two
  // states are never confusable, since signed-out shows "Not signed in" where
  // the name goes.
  const paid = $derived(signedIn && plan !== 'free');
  const planTitle = $derived(
    t('user.planCurrent', { plan: t(PLAN_LABEL[plan]) }),
  );

  // ── The account button: upgrade below the top tier, manage at it ──────────
  //
  // Enterprise is the top tier, so there is nothing left to sell. The button
  // does not go inert there (it used to, and an inert control is a dead end for
  // the one user who is definitely paying us) — it switches job and opens
  // Polar's customer portal, where a subscriber cancels, changes their payment
  // method and reads invoices. Enabled in both states; only the label, the
  // tooltip and the icon change.
  //
  // `nextUp` is the tier an upgrade actually buys: the next one **above** the
  // current plan, never a hardcoded tier. A single generic "Upgrade" button
  // that charges an `advance` subscriber for `advance` again is the defect
  // `Settings → Plan` still has (`PlanPanel.svelte` hardcodes
  // `startCheckout('plan', 'advance')` and is not disabled at enterprise
  // either); `nextPlanAbove` is shared from `checkoutFlow` so that panel can
  // adopt it. `null` only at enterprise, which is exactly where the portal
  // takes over — so the two branches are the same condition read two ways.
  const nextUp = $derived<Plan | null>(nextPlanAbove(plan));
  const maxed = $derived(nextUp === null);

  // Whatever the last click has to say (null = nothing to say — on success the
  // browser opening *is* the feedback, per `checkoutNotice`).
  let accountNotice = $state<MessageKey | null>(null);
  // True while a checkout or a portal session — including any sign-in round
  // trip — is in flight. `startCheckout`/`startSubscriptionPortal` never reject
  // and never hang, and the `finally` is unconditional, so a cancelled sign-in
  // (or a timeout, or a refusal) always releases the button rather than
  // leaving it stuck mid-spin.
  let busy = $state(false);

  /**
   * Buy the next tier up, or manage the existing subscription at the top.
   *
   * Both paths go through the shared lazy sign-in flow, so a signed-out user
   * still only clicks once: sign in, then the original action resumes by
   * itself. Nothing here logs or renders the resolved URL — a portal URL
   * carries a session token that grants billing management.
   */
  async function accountAction() {
    accountNotice = null;
    busy = true;
    try {
      const result = nextUp
        ? await startCheckout('plan', nextUp)
        : await startSubscriptionPortal();
      accountNotice = checkoutNotice(result);
    } finally {
      busy = false;
    }
  }

  // ── DEV-ONLY plan switcher ────────────────────────────────────────────────
  //
  // Here rather than in Settings on purpose: the tier star, the plan label and
  // the upgrade button's disabled state are all in this popover, so a change
  // is visible in the same glance that made it — the shortest feedback loop
  // the app has for entitlement work.
  //
  // `import.meta.env.DEV` is a literal Vite replaces with `false` in
  // `vite build`, so this block is dead code the bundler drops. It is not the
  // only defence: `setDevPlanChoice` re-checks the same flag, and the native
  // command it eventually reaches is `#[cfg(debug_assertions)]` and therefore
  // absent from a release binary. See `lib/devPlan.svelte.ts`.
  const isDev = import.meta.env.DEV;
  const devPlan = $derived<DevPlanChoice>(devPlanSelection());
  // Untranslated, and deliberately: the options are the literal `Plan` values
  // (and the literal `VITE_DEV_PLAN` values), which is what a developer wants
  // to read. Product surfaces get translated; a debug tool reading like one
  // would be the bug.
  const DEV_PLAN_OPTION: Record<DevPlanChoice, string> = {
    real: 'no override — real licence',
    free: 'free',
    basic: 'basic',
    advance: 'advance',
    enterprise: 'enterprise',
  };

  // Refresh through the entitlement store rather than poking the plan: that is
  // the one path that also re-derives the feature list AND pushes the tier to
  // the native gate, so the UI can never end up showing a tier the backend is
  // not honouring. It leaves owned themes alone — the override grants
  // capabilities, never purchases.
  function chooseDevPlan(next: string): void {
    setDevPlanChoice(next as DevPlanChoice);
    void refreshEntitlement();
  }
</script>

<div class="backdrop" onclick={onClose} role="presentation"></div>
<div class="menu" role="menu">
  <div class="head">
    <div class="avatar">
      {#if showAvatarImg}
        <img
          src={user?.avatarUrl}
          alt=""
          referrerpolicy="no-referrer"
          loading="lazy"
          onerror={() => (avatarFailed = true)}
        />
      {/if}
    </div>
    <div class="who">
      {#if signedIn}
        <strong>{displayName}</strong>
        <span>{showEmailLine ? user?.email : ''}</span>
      {:else}
        <strong>{t('user.signedOut')}</strong>
      {/if}
    </div>
    {#if paid}
      <!-- Not decoration: role="img" + aria-label carry the plan name to a
           screen reader, so the tier is not hover-only information. -->
      <span
        class="star plan-{plan}"
        role="img"
        aria-label={planTitle}
        title={planTitle}>★</span
      >
    {/if}
  </div>

  <select
    class="lang"
    aria-label={t('user.language')}
    value={locale}
    onchange={(e) => onLocale(e.currentTarget.value)}
  >
    {#each LOCALES as l (l.code)}
      <option value={l.code}>{l.name}</option>
    {/each}
  </select>

  {#if onReplayTutorial}
    <button class="btn ghost replay" onclick={onReplayTutorial}
      ><Icon name="refresh" size={13} /> {t('user.replayTutorial')}</button
    >
  {/if}

  {#if isDev}
    <!-- Marked, not blended in: a control that silently grants paid tiers must
         never be mistakable for a product feature by whoever is looking at a
         screenshot. Hence the DEV banner, the warning colour and the dashed
         border. It grants capabilities only — no licence, no identity, and no
         purchased themes. -->
    <div class="devplan">
      <span class="devtag">DEV ONLY</span>
      <label class="devlabel" for="dev-plan-override">plan override</label>
      <select
        id="dev-plan-override"
        class="devselect"
        title="Development tool — overrides the effective plan for this app and
the native feature gates. Grants capabilities, never purchases: owned themes
still come from the real licence. Not present in a release build."
        value={devPlan}
        onchange={(e) => chooseDevPlan(e.currentTarget.value)}
      >
        {#each DEV_PLAN_CHOICES as c (c)}
          <option value={c}>{DEV_PLAN_OPTION[c]}</option>
        {/each}
      </select>
      {#if devPlan !== REAL_LICENCE}
        <span class="devwarn">paid features unlocked without a licence</span>
      {/if}
    </div>
  {/if}

  <div class="actions">
    {#if signedIn}
      <!-- Live at every tier. Below the top one it starts a real Polar checkout
           for the next tier up; at the top it opens Polar's customer portal,
           enabled — the previous version went inert here, which left a paying
           subscriber with no way to cancel or fix a card from the app at all.
           The two states are visibly different (label, icon, tooltip) so it is
           obvious the button now does something.

           Below enterprise the title doubles as the plan tooltip for a free
           user, who has no star to hover. `disabled` is only ever the in-flight
           guard now, never a tier ceiling. -->
      <button
        class="btn"
        class:manage={maxed}
        disabled={busy}
        onclick={accountAction}
        title={maxed ? t('user.manageSubscriptionTitle') : planTitle}
        >{#if busy}{t('checkout.signingIn')}{:else}<Icon
            name={maxed ? 'external' : 'edit'}
            size={13}
          />
          {maxed
            ? t('user.manageSubscription')
            : t('user.upgrade')}{/if}</button
      >
      <button class="btn ghost" onclick={onSignOut}
        ><Icon name="logout" size={14} /> {t('user.logout')}</button
      >
    {:else}
      <button
        class="btn primary"
        onclick={onSignIn}
        disabled={!configured || status === 'signing-in'}
        title={configured ? '' : t('user.signInUnavailable')}
      >
        {status === 'signing-in' ? t('user.signingIn') : t('user.signIn')}
      </button>
    {/if}
  </div>

  {#if accountNotice}
    <!-- Only ever rendered for an outcome that needs words. A successful
         checkout or portal session says nothing here (`checkoutNotice` returns
         null) because the browser opening is the feedback — and the URL itself
         must never reach the DOM, since a portal URL is a credential. -->
    <p class="notice">{t(accountNotice)}</p>
  {/if}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 19;
  }
  .menu {
    position: absolute;
    top: 40px;
    right: 8px;
    width: 250px;
    background: var(--panel-bg);
    border-radius: 10px;
    box-shadow: var(--panel-shadow);
    border: 1px solid var(--panel-border);
    padding: 14px;
    z-index: 20;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
    border-bottom: 1px solid var(--panel-border);
    padding-bottom: 12px;
  }
  .avatar {
    width: 40px;
    height: 40px;
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
  .who {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .who strong {
    font-size: 13px;
  }
  .who span {
    font-size: 11px;
    color: var(--fg-muted);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* Tier colours come from the `--plan-*` tokens in app.css, never inline. */
  .star {
    font-size: 18px;
    line-height: 1;
    flex: 0 0 auto;
  }
  .star.plan-basic {
    color: var(--plan-basic);
  }
  .star.plan-advance {
    color: var(--plan-advance);
  }
  .star.plan-enterprise {
    color: var(--plan-enterprise);
  }
  .lang {
    width: 100%;
    height: 30px;
    border: 1px solid var(--panel-border);
    border-radius: 7px;
    padding: 0 10px;
    font-size: 12px;
    margin-bottom: 12px;
  }
  /* DEV-ONLY switcher. Styled to look like a tool bolted onto the app, not
     part of it — dashed amber border, monospace, uppercase tag. */
  .devplan {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-bottom: 12px;
    padding: 7px 8px;
    border: 1px dashed #c08a2e;
    border-radius: 7px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 10px;
  }
  .devtag {
    background: #c08a2e;
    color: #fff;
    border-radius: 4px;
    padding: 1px 5px;
    font-weight: 700;
    letter-spacing: 0.5px;
  }
  .devlabel {
    color: var(--fg-muted);
  }
  .devselect {
    flex: 1 1 100%;
    height: 26px;
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    padding: 0 6px;
    font-family: inherit;
    font-size: 11px;
  }
  .devwarn {
    flex: 1 1 100%;
    color: #c08a2e;
  }
  .actions {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }
  .btn {
    border: 0;
    background: var(--row-hover);
    border-radius: 7px;
    padding: 7px 12px;
    font-size: 12px;
    cursor: pointer;
  }
  .btn.ghost {
    background: transparent;
  }
  .btn.replay {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    margin: 0 0 10px;
    text-align: left;
    color: inherit;
  }
  .btn.replay:hover {
    background: var(--row-hover);
  }
  .btn.primary {
    flex: 1;
    background: var(--accent, #8a6fc0);
    color: #fff;
  }
  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  /* Top tier: the button manages a subscription rather than selling one, so it
     reads as the tier's own colour instead of a neutral action. The visible
     difference from the old inert state is the point — this is now clickable. */
  .btn.manage {
    border: 1px solid var(--plan-enterprise);
    color: var(--plan-enterprise);
    background: transparent;
  }
  /* Outcome line under the actions. Wraps rather than truncates: a 250px
     popover has no room for one line, and a half-shown explanation is worse
     than none. */
  .notice {
    margin: 10px 0 0;
    font-size: 11px;
    line-height: 1.45;
    color: var(--fg-muted);
  }
</style>
