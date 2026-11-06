<!--
  Plan panel. Read-only comparison matrix of Free/Basic/Advance/
  Enterprise, highlighting the current plan from the
  entitlement store. Upgrade creates a Polar checkout server-side and opens the
  hosted URL in the system browser. "Refresh entitlement" re-verifies the license
  so a plan change unlocks without a restart (the instant-unlock path).

  The free trial (granted by the license server) is offered here too: 14 days of
  Advance, no card, once per computer and per account. The server decides who
  may start one; this panel only asks it and renders the answer.

  Upgrade is the moment we finally need an identity (lazy sign-in), so it goes through `startCheckout`, which signs the user in and then
  resumes this same checkout by itself — one click, even when signed out.
-->
<script lang="ts">
  import {
    getPlan,
    refreshEntitlement,
    deviceLimit,
    onTrial,
    trialEndsMs,
  } from '../../lib/license.svelte';
  import type { Plan } from '../../lib/license.svelte';
  import {
    startCheckout,
    startSubscriptionPortal,
    nextPlanAbove,
    checkoutNotice,
    isNotSignedIn,
    signInFirst,
  } from '../../lib/checkoutFlow';
  import { trialStatus, startTrial, type TrialStatusDto } from '../../lib/ipc';
  import { authState } from '../../lib/auth.svelte';
  import { t, getLocale } from '../../lib/i18n/index.svelte';
  import Icon from '../../lib/icons/Icon.svelte';
  import type { MessageKey } from '../../lib/i18n/messages';
  import CheckoutReturnNotice from '../CheckoutReturnNotice.svelte';

  const PLANS: readonly Plan[] = ['free', 'basic', 'advance', 'enterprise'];
  const PLAN_LABEL: Record<Plan, MessageKey> = {
    free: 'plan.free',
    basic: 'plan.basic',
    advance: 'plan.advance',
    enterprise: 'plan.enterprise',
  };

  const current = $derived(getPlan());
  const trialing = $derived(onTrial());

  // Shown in the "no team seats" cells. Free, Basic and Advance have none —
  // all three, uniformly, which is what the server's `seats_for` now says.
  const NONE = '–';

  /**
   * Team seats included with Enterprise. Mirrors the license server's
   * `db::entitlement::seats_for` (`Plan::Enterprise => Some(5)`), which is the
   * authority; this is display text. Extra seats beyond these five are a
   * purchasable add-on — hence `plan.seatsAddOn` rather than a bare number —
   * but the *purchase* is not provisioned yet (it needs a Polar product id).
   */
  const ENTERPRISE_SEATS = 5;

  // A cell is a boolean (✓/✗) or literal display text (counts, seat text).
  type Cell = boolean | string;
  const rows = $derived<{ label: MessageKey; cells: Cell[] }[]>([
    { label: 'plan.feat.noAd', cells: [false, true, true, true] },
    { label: 'plan.feat.applyTheme', cells: [true, true, true, true] },
    { label: 'plan.feat.logBackground', cells: [false, false, true, true] },
    { label: 'plan.feat.tickets', cells: [false, true, true, true] },
    // Concurrent signed-in devices (1 / 2 / 3 / 3). Read from `deviceLimit()`
    // rather than written out here, so this row cannot drift from the number
    // the Devices panel shows — and `deviceLimit()` is itself checked against
    // the server's `device_limit_for` by `license.svelte.test.ts`. One table,
    // three readers.
    {
      label: 'plan.feat.devices',
      cells: PLANS.map((p) => String(deviceLimit(p))),
    },
    // Team seats: Enterprise only, and finite. This row used to read
    // `['–', '–', '3', 'Unlimited']`, which was wrong twice over — Advance has
    // no team seats, and no tier is unlimited.
    {
      label: 'plan.feat.seats',
      cells: [
        NONE,
        NONE,
        NONE,
        t('plan.seatsAddOn', { seats: ENTERPRISE_SEATS }),
      ],
    },
  ]);

  let refreshing = $state(false);
  // Whatever the last Upgrade attempt has to say (null = nothing to say).
  let upgradeNotice = $state<MessageKey | null>(null);
  // True while the checkout — including any sign-in round trip — is in flight,
  // so the button can never be left spinning silently.
  let upgrading = $state(false);

  // The tier this panel's button sells, or `null` once there is nothing left to
  // sell. This used to be a hardcoded `'advance'`, which charged an `advance`
  // subscriber for the plan they already had and left the button live at
  // enterprise with nowhere to go. `nextPlanAbove` is the same ladder the
  // account menu climbs, shared from `checkoutFlow` so the two can never
  // disagree about what "upgrade" means.
  // On a trial the thing to buy is the plan being tried, not the one above it.
  const nextUp = $derived<Plan | null>(
    trialing ? current : nextPlanAbove(current),
  );
  const maxed = $derived(nextUp === null);

  // Below the top tier this opens a Polar checkout for the NEXT tier, created
  // server-side from the licence; at the top it opens Polar's customer portal
  // instead, where a subscriber cancels, changes their payment method or reads
  // invoices. Signed out, both run sign-in first and then retry by themselves,
  // so the user only clicks once. Neither rejects — every ending comes back as
  // a notice — and nothing here renders the resolved URL: a portal URL carries
  // a session token in its query string.
  async function accountAction() {
    upgradeNotice = null;
    upgrading = true;
    try {
      upgradeNotice = checkoutNotice(
        nextUp
          ? await startCheckout('plan', nextUp)
          : await startSubscriptionPortal(),
      );
    } finally {
      upgrading = false;
    }
  }
  // ── Free trial ──
  // The server's answer for this account on this computer; null until asked,
  // and while signed out (the offer is then shown, and sign-in comes first).
  let trial = $state<TrialStatusDto | null>(null);
  let trialBusy = $state(false);
  let trialNotice = $state<MessageKey | null>(null);
  const signedIn = $derived(authState().status === 'signed-in');

  const fmtDate = (ms: number) =>
    new Date(ms).toLocaleDateString(getLocale(), {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  // Shown before the server has answered (signed out): the same numbers the
  // server sends, so the offer reads the same either way.
  const trialDays = $derived(trial?.days ?? 14);
  const trialPlanName = $derived(t('plan.advance'));
  const trialEnd = $derived(trial?.endsMs ?? trialEndsMs());
  const showOffer = $derived(
    current === 'free' && (trial === null || trial.state === 'available'),
  );

  async function loadTrial() {
    try {
      trial = await trialStatus();
    } catch {
      // Signed out or offline: keep the offer up; starting will sort it out.
      trial = null;
    }
  }
  $effect(() => {
    if (signedIn) void loadTrial();
    else trial = null;
  });

  async function beginTrial() {
    trialNotice = null;
    trialBusy = true;
    try {
      try {
        trial = await trialStatus();
      } catch (e) {
        if (!isNotSignedIn(e)) throw e;
        const notSignedIn = await signInFirst({});
        if (notSignedIn) {
          trialNotice = checkoutNotice(notSignedIn);
          return;
        }
        trial = await trialStatus();
      }
      if (trial.state === 'available') {
        try {
          await startTrial();
        } catch {
          // Refused or failed — the status below says which.
        }
        await refreshEntitlement();
        trial = await trialStatus();
        if (trial.state === 'available') trialNotice = 'trial.failed';
      }
    } catch {
      trialNotice = 'trial.failed';
    } finally {
      trialBusy = false;
    }
  }

  async function refresh() {
    refreshing = true;
    try {
      await refreshEntitlement();
    } finally {
      refreshing = false;
    }
  }
</script>

<div class="panel">
  <!-- Post-payment return: the upgrade the user just came back from. -->
  <CheckoutReturnNotice />
  <table class="matrix">
    <thead>
      <tr>
        <th class="feat">{t('plan.feature')}</th>
        {#each PLANS as p (p)}
          <th class="plan-col" class:current={p === current}>
            {t(PLAN_LABEL[p])}
            {#if p === current}<span class="badge"
                >{trialing ? t('trial.badge') : t('plan.currentBadge')}</span
              >{/if}
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each rows as row (row.label)}
        <tr>
          <td class="feat">{t(row.label)}</td>
          {#each row.cells as cell, i (i)}
            <td class:current={PLANS[i] === current}>
              {#if typeof cell === 'boolean'}
                <span class:yes={cell} class:no={!cell}
                  >{#if cell}<Icon name="check" size={12} />{:else}<Icon
                      name="close"
                      size={12}
                    />{/if}</span
                >
              {:else}
                {cell}
              {/if}
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>

  {#if trialing && trialEnd}
    <p class="trial-line">
      {t('trial.active', { plan: trialPlanName, date: fmtDate(trialEnd) })}
    </p>
  {:else if showOffer}
    <div class="trial">
      <div class="trial-text">
        <strong
          >{t('trial.offer', { plan: trialPlanName, days: trialDays })}</strong
        >
        <span class="trial-note">{t('trial.note')}</span>
      </div>
      <button class="btn" onclick={beginTrial} disabled={trialBusy}>
        {trialBusy ? t('trial.starting') : t('trial.start')}
      </button>
    </div>
    {#if trialNotice}<p class="trial-line trial-note">{t(trialNotice)}</p>{/if}
  {:else if current === 'free' && trial?.state === 'used'}
    <p class="trial-line trial-note">
      {trialEnd && trialEnd < Date.now()
        ? t('trial.ended', { plan: trialPlanName, date: fmtDate(trialEnd) })
        : t('trial.used')}
    </p>
  {/if}

  <div class="actions">
    <button class="btn refresh" onclick={refresh} disabled={refreshing}
      >{t('plan.refresh')}</button
    >
    <div class="upgrade-wrap">
      <!-- One button, two jobs: it sells the next tier until there is none, and
           then becomes the way into the subscription itself. Enabled at every
           tier — a top-tier subscriber still needs somewhere to cancel. -->
      <button class="btn upgrade" onclick={accountAction} disabled={upgrading}>
        {upgrading
          ? t('checkout.signingIn')
          : maxed
            ? t('user.manageSubscription')
            : trialing
              ? t('trial.buy', { plan: t(PLAN_LABEL[current]) })
              : t('plan.upgrade')}
      </button>
      {#if upgradeNotice}
        <span class="hint">{t(upgradeNotice)}</span>
      {/if}
    </div>
  </div>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .matrix {
    border-collapse: collapse;
    width: 100%;
    font-size: 12px;
  }
  .matrix th,
  .matrix td {
    border: 1px solid var(--panel-border);
    padding: 5px 8px;
    text-align: center;
  }
  .matrix th.feat,
  .matrix td.feat {
    text-align: left;
    color: var(--fg);
  }
  .matrix td.feat {
    color: var(--fg-soft);
  }
  .plan-col {
    color: var(--fg-muted);
  }
  .plan-col.current,
  td.current {
    background: var(--row-hover);
  }
  .plan-col.current {
    color: var(--fg);
    font-weight: 600;
  }
  .badge {
    display: block;
    font-size: 9px;
    font-weight: 500;
    color: var(--select-ring);
  }
  .yes {
    color: var(--lane-0);
  }
  .no {
    color: var(--fg-muted);
  }
  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .upgrade-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .hint {
    font-size: 11px;
    color: var(--fg-muted);
  }
  .trial {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--panel-border);
    border-radius: 8px;
  }
  .trial-text {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 12px;
  }
  .trial-line {
    margin: 0;
    font-size: 12px;
  }
  .trial-note {
    font-size: 11px;
    color: var(--fg-muted);
  }
  .btn {
    border: 0;
    background: var(--select-ring);
    color: #fff;
    padding: 7px 16px;
    border-radius: 7px;
    font-size: 13px;
    cursor: pointer;
  }
  .btn.refresh {
    background: var(--row-hover);
    color: var(--fg);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
