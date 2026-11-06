<!--
  Open-or-create launcher dialog: pick a target folder (typed or
  browsed). On confirm the parent probes the path and routes to an open or a
  create confirm. A "Clone a remote instead" link switches to the clone flow.
-->
<script lang="ts">
  import { t } from '../lib/i18n/index.svelte';
  let {
    busy = false,
    onBrowse,
    onConfirm,
    onCancel,
    onClone,
  }: {
    busy?: boolean;
    /** Open the native folder picker; resolves to a path or null if cancelled. */
    onBrowse: () => Promise<string | null>;
    onConfirm: (path: string) => void;
    onCancel: () => void;
    /** Optional: switch to the clone-remote dialog. */
    onClone?: () => void;
  } = $props();

  let path = $state('');
  const ready = $derived(path.trim().length > 0 && !busy);

  async function browse() {
    const picked = await onBrowse();
    if (picked) path = picked;
  }

  function confirm() {
    if (ready) onConfirm(path.trim());
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape') onCancel();
  }}
/>

<div class="overlay">
  <button class="scrim" aria-label={t('common.cancel')} onclick={onCancel}
  ></button>
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-label={t('openCreate.title')}
  >
    <p class="title">{t('openCreate.prompt')}</p>

    <div class="field">
      <label for="oc-path">{t('openCreate.targetLocation')}</label>
      <div class="row">
        <!-- svelte-ignore a11y_autofocus -->
        <input
          id="oc-path"
          autofocus
          bind:value={path}
          placeholder={t('openCreate.pathPlaceholder')}
          onkeydown={(e) => {
            if (e.key === 'Enter') confirm();
          }}
        />
        <button
          class="browse"
          onclick={browse}
          disabled={busy}
          title={t('common.browse')}>…</button
        >
      </div>
    </div>

    {#if onClone}
      <button class="link" onclick={onClone}>{t('openCreate.cloneLink')}</button
      >
    {/if}

    <div class="actions">
      <button class="ghost" onclick={onCancel} disabled={busy}
        >{t('common.cancel')}</button
      >
      <button class="primary" onclick={confirm} disabled={!ready}>
        {busy ? '…' : t('common.confirm')}
      </button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .scrim {
    position: absolute;
    inset: 0;
    border: 0;
    padding: 0;
    background: rgba(0, 0, 0, 0.32);
    cursor: default;
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
    padding: 18px;
  }
  .title {
    margin: 0 0 14px;
    font-size: 13px;
    color: var(--fg);
    line-height: 1.4;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 12px;
  }
  .field label {
    font-size: 12px;
    color: var(--fg-soft);
  }
  .row {
    display: flex;
    gap: 6px;
  }
  .row input {
    flex: 1;
    height: 30px;
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    padding: 0 10px;
    font: inherit;
    font-size: 13px;
  }
  .browse {
    width: 34px;
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    background: var(--row-hover);
    cursor: pointer;
    font-size: 14px;
  }
  .link {
    border: 0;
    background: transparent;
    color: var(--select-ring);
    font: inherit;
    font-size: 12px;
    padding: 0;
    margin: 0 0 14px;
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .actions button {
    height: 30px;
    padding: 0 16px;
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
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
