<!--
  First-run choice for the free tier: accept the ad strip, or move to a paid
  plan (lib/adGate.ts has the why). Blocking — there is no scrim to click away
  and no Escape — because "free" means "free with ads". Where declining must
  still leave the app usable (`mayDecline`), a third button says so.

  The consent itself stays an explicit button press; nothing here treats
  having installed or opened the app as agreement.
-->
<script lang="ts">
  import { t, getLocale } from '../lib/i18n/index.svelte';
  import type { MessageKey } from '../lib/i18n/messages';
  import {
    startCheckout,
    checkoutNotice,
    signInFirst,
  } from '../lib/checkoutFlow';
  import { refreshEntitlement } from '../lib/license.svelte';
  import { authState } from '../lib/auth.svelte';
  import { openExternalUrl } from '../lib/ipc';

  let {
    mayDecline = false,
    onAccept,
    onDecline,
  }: {
    mayDecline?: boolean;
    onAccept: () => void;
    onDecline: () => void;
  } = $props();

  let busy = $state(false);
  let notice = $state<MessageKey | null>(null);
  const signedIn = $derived(authState().status === 'signed-in');

  /** The website's language for this UI locale. */
  const SITE_LANG: Record<string, string> = {
    'zh-Hant': 'zh-tw',
    'zh-Hans': 'zh-cn',
  };
  function openPrivacy() {
    const lang = SITE_LANG[getLocale()] ?? getLocale();
    void openExternalUrl(`https://anotherdream.tw/${lang}/privacy/`).catch(
      () => {},
    );
  }

  async function run(action: () => Promise<MessageKey | null>) {
    notice = null;
    busy = true;
    try {
      notice = await action();
    } finally {
      busy = false;
    }
  }
  // The gate closes by itself once the plan isn't Free any more — after the
  // purchase lands, or after signing into an account that already pays.
  const buy = () =>
    run(async () => checkoutNotice(await startCheckout('plan', 'basic')));
  const signIn = () =>
    run(async () => {
      const r = await signInFirst({});
      if (r) return checkoutNotice(r);
      await refreshEntitlement();
      return null;
    });
</script>

<div class="overlay">
  <div class="scrim"></div>
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="ad-gate-title"
  >
    <p class="title" id="ad-gate-title">{t('adGate.title')}</p>
    <p class="body">{t('adGate.body')}</p>
    <p class="body">
      {t('adGate.data')}
      <button class="link" onclick={openPrivacy}>{t('adGate.privacy')}</button>
    </p>
    {#if notice}<p class="notice">{t(notice)}</p>{/if}
    <div class="actions">
      {#if !signedIn}
        <button class="ghost" onclick={signIn} disabled={busy}
          >{t('adGate.signIn')}</button
        >
      {/if}
      <button class="ghost" onclick={buy} disabled={busy}
        >{t('adGate.buy')}</button
      >
      {#if mayDecline}
        <button class="ghost" onclick={onDecline} disabled={busy}
          >{t('adGate.decline')}</button
        >
      {/if}
      <button class="primary" onclick={onAccept} disabled={busy}
        >{t('adGate.accept')}</button
      >
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .scrim {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
  }
  .dialog {
    position: relative;
    z-index: 1;
    width: 440px;
    max-width: calc(100vw - 32px);
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    box-shadow: var(--panel-shadow);
    padding: 20px;
  }
  .title {
    margin: 0 0 10px;
    font-size: 15px;
    font-weight: 600;
    color: var(--fg);
  }
  .body {
    margin: 0 0 10px;
    font-size: 12px;
    color: var(--fg-soft);
    line-height: 1.5;
  }
  .notice {
    margin: 0 0 10px;
    font-size: 11px;
    color: var(--fg-muted);
  }
  .link {
    border: 0;
    padding: 0;
    background: none;
    color: var(--select-ring);
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 6px;
  }
  .actions button {
    height: 30px;
    padding: 0 14px;
    border-radius: 8px;
    border: 0;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .ghost {
    background: var(--row-hover);
    color: var(--fg);
  }
  .primary {
    background: var(--select-ring);
    color: #fff;
  }
  .actions button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
