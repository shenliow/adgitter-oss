<!--
  Friendly crash window. Shown on an uncaught frontend error instead of
  a raw stack; the crash auto-reports (consent-gated, upstream) and the user can
  reload (state is restored from persisted settings/recents) or dismiss.
-->
<script lang="ts">
  import { t } from '../lib/i18n/index.svelte';

  let {
    reported = false,
    onReload,
    onDismiss,
  }: {
    /** Whether a diagnostic report was sent (consented). */
    reported?: boolean;
    onReload: () => void;
    onDismiss: () => void;
  } = $props();
</script>

<div class="overlay">
  <div class="dialog" role="alertdialog" aria-label={t('crash.title')}>
    <div class="icon" aria-hidden="true">⚠</div>
    <h2>{t('crash.title')}</h2>
    <p class="body">{t('crash.body')}</p>
    {#if reported}<p class="reported">{t('crash.reported')}</p>{/if}
    <div class="actions">
      <button class="ghost" onclick={onDismiss}>{t('crash.dismiss')}</button>
      <button class="primary" onclick={onReload}>{t('crash.reload')}</button>
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
    background: rgba(0, 0, 0, 0.45);
  }
  .dialog {
    width: 360px;
    max-width: calc(100vw - 32px);
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    box-shadow: var(--panel-shadow);
    padding: 22px;
    text-align: center;
  }
  .icon {
    font-size: 32px;
    color: var(--lane-7);
  }
  h2 {
    margin: 10px 0 6px;
    font-size: 16px;
    color: var(--fg);
  }
  .body {
    margin: 0 0 8px;
    font-size: 13px;
    color: var(--fg-soft);
    line-height: 1.4;
  }
  .reported {
    margin: 0 0 12px;
    font-size: 11px;
    color: var(--fg-muted);
  }
  .actions {
    display: flex;
    justify-content: center;
    gap: 10px;
    margin-top: 12px;
  }
  .actions button {
    height: 32px;
    padding: 0 18px;
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
</style>
