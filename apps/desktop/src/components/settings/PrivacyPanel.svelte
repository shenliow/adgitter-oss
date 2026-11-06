<!--
  Settings → Privacy: the two consents, each changeable on its own, as the
  Privacy Policy promises ("you can withdraw at any time in the app's
  settings"). Edits the draft like every other tab; saved with OK.
-->
<script lang="ts">
  import type { AdConsent, CrashConsent } from '../../lib/settings';
  import { getPlan } from '../../lib/license.svelte';
  import { mayDeclineAds } from '../../lib/adGate';
  import { t } from '../../lib/i18n/index.svelte';

  let {
    adConsent = $bindable(),
    crashReports = $bindable(),
  }: {
    adConsent: AdConsent;
    crashReports: CrashConsent;
  } = $props();

  const free = $derived(getPlan() === 'free');
  const canDecline = mayDeclineAds();
</script>

<div class="panel">
  <label class="row">
    <input
      type="checkbox"
      checked={crashReports === 'granted'}
      onchange={(e) =>
        (crashReports = e.currentTarget.checked ? 'granted' : 'declined')}
    />
    <span>
      <span class="name">{t('privacy.crashReports')}</span>
      <span class="hint">{t('privacy.crashReportsHint')}</span>
    </span>
  </label>

  <div class="row ads">
    <span>
      <span class="name">{t('privacy.ads')}</span>
      <span class="hint">
        {#if !free}
          {t('privacy.adsPaid')}
        {:else if adConsent === 'granted'}
          {canDecline
            ? t('privacy.adsWithdrawFree')
            : t('privacy.adsWithdrawPay')}
        {:else}
          {t('privacy.adsNotGiven')}
        {/if}
      </span>
    </span>
    {#if free && adConsent === 'granted'}
      <button class="btn" onclick={() => (adConsent = 'declined')}
        >{t('privacy.adsWithdraw')}</button
      >
    {/if}
  </div>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    font-size: 13px;
  }
  .row.ads {
    justify-content: space-between;
    align-items: center;
  }
  .name {
    display: block;
    color: var(--fg);
  }
  .hint {
    display: block;
    margin-top: 2px;
    font-size: 11px;
    color: var(--fg-muted);
    line-height: 1.4;
  }
  .btn {
    flex: 0 0 auto;
    border: 0;
    background: var(--row-hover);
    color: var(--fg);
    padding: 6px 14px;
    border-radius: 7px;
    font-size: 12px;
    cursor: pointer;
  }
</style>
