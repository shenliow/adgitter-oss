<!--
  Post-payment feedback strip (`adgitter://checkout-complete`).

  Renders whatever `checkoutReturn.svelte.ts` currently knows about the return
  trip: "processing" while the licence is being re-checked against the server,
  a completion message once a re-issued licence actually grants something new,
  and an honest "still processing" (with a Check again action) when the payment
  confirmation hasn't reached the server within the retry budget.

  It reports only what a *verified, server-signed* licence said — the deep link
  itself grants nothing and its contents are never displayed.

  Shown in both purchase surfaces (theme store, plan panel) so the user sees the
  outcome wherever they came back to.
-->
<script lang="ts">
  import {
    checkoutReturnState,
    clearCheckoutReturn,
    retryCheckoutReturn,
  } from '../lib/checkoutReturn.svelte';
  import { t } from '../lib/i18n/index.svelte';

  const state = $derived(checkoutReturnState());
</script>

{#if state.status !== 'idle'}
  <div class="return-notice" data-checkout-return={state.status} role="status">
    <span class="text">
      {#if state.status === 'processing'}
        {t('checkoutReturn.processing')}
      {:else if state.status === 'unlocked'}
        {state.newThemes.length > 0
          ? t('checkoutReturn.unlockedTheme')
          : t('checkoutReturn.unlocked')}
      {:else if state.status === 'pending'}
        {t('checkoutReturn.pending')}
      {:else}
        {t('checkoutReturn.signInNeeded')}
      {/if}
    </span>
    {#if state.status === 'pending'}
      <button
        class="btn"
        data-checkout-return-retry
        onclick={() => void retryCheckoutReturn()}
        >{t('checkoutReturn.checkAgain')}</button
      >
    {/if}
    {#if state.status !== 'processing'}
      <button class="btn" onclick={clearCheckoutReturn}
        >{t('common.dismiss')}</button
      >
    {/if}
  </div>
{/if}

<style>
  .return-notice {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    background: var(--panel-bg);
    font-size: 12px;
  }
  .text {
    flex: 1;
  }
</style>
