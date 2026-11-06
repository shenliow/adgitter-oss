<!--
  Asks once, on every tier, whether crash and error reports may go to Sentry.
  Its own question, never bundled with the ad consent (GDPR Art. 7(2)),
  and non-blocking: ignoring it leaves reporting off. Changeable later under
  Settings → Privacy.
-->
<script lang="ts">
  import { t } from '../lib/i18n/index.svelte';

  let {
    onAllow,
    onDeny,
  }: {
    onAllow: () => void;
    onDeny: () => void;
  } = $props();
</script>

<div class="crash-consent" role="region" aria-label={t('crashConsent.label')}>
  <p class="msg">{t('crashConsent.message')}</p>
  <div class="actions">
    <button class="ghost" onclick={onDeny}>{t('crashConsent.deny')}</button>
    <button class="primary" onclick={onAllow}>{t('crashConsent.allow')}</button>
  </div>
</div>

<style>
  .crash-consent {
    position: fixed;
    right: 16px;
    bottom: 40px;
    z-index: 30;
    width: 320px;
    max-width: calc(100vw - 32px);
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: 10px;
    box-shadow: var(--panel-shadow);
    padding: 12px 14px;
  }
  .msg {
    margin: 0 0 10px;
    font-size: 12px;
    color: var(--fg-soft);
    line-height: 1.45;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .actions button {
    height: 28px;
    padding: 0 14px;
    border-radius: 7px;
    border: 0;
    font: inherit;
    font-size: 12px;
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
</style>
