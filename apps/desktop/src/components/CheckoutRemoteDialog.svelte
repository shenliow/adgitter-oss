<!--
  Confirm-remote-checkout dialog: double-clicking or
  right-clicking a remote branch (Branches panel row or graph chip) never
  checks it out directly — it always routes through here first. Primary
  action creates a local branch (prefilled, editable name) that tracks the
  remote branch and checks it out; the secondary action checks out the
  remote's tip directly (detached HEAD); Cancel does nothing.
-->
<script lang="ts">
  import { t } from '../lib/i18n/index.svelte';

  let {
    remoteName,
    suggestedLocal,
    busy = false,
    onCreate,
    onDetached,
    onCancel,
  }: {
    remoteName: string;
    suggestedLocal: string;
    busy?: boolean;
    onCreate: (localName: string) => void;
    onDetached: () => void;
    onCancel: () => void;
  } = $props();

  // Freshly mounted per remote branch — seeding from the initial prop (not
  // meant to track later prop changes) is intentional.
  // svelte-ignore state_referenced_locally
  let localName = $state(suggestedLocal);

  const ready = $derived(localName.trim().length > 0 && !busy);

  function create() {
    if (!ready) return;
    onCreate(localName.trim());
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape' && !busy) onCancel();
  }}
/>

<div class="overlay">
  <button class="scrim" aria-label={t('common.cancel')} onclick={onCancel}
  ></button>
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-label={t('remoteCheckout.title')}
  >
    <h2>{t('remoteCheckout.title')}</h2>
    <p class="body">{t('remoteCheckout.body', { name: remoteName })}</p>

    <div class="field">
      <label for="rc-name">{t('remoteCheckout.localName')}</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        id="rc-name"
        class="name-input"
        autofocus
        bind:value={localName}
        disabled={busy}
        onkeydown={(e) => {
          if (e.key === 'Enter') create();
        }}
      />
    </div>

    <div class="actions">
      <button class="ghost" onclick={onCancel} disabled={busy}
        >{t('common.cancel')}</button
      >
      <button class="ghost" onclick={onDetached} disabled={busy}
        >{t('remoteCheckout.detached')}</button
      >
      <button class="primary" onclick={create} disabled={!ready}>
        {busy ? '…' : t('remoteCheckout.create')}
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
    width: 400px;
    max-width: calc(100vw - 32px);
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    box-shadow: var(--panel-shadow);
    padding: 18px;
  }
  h2 {
    margin: 0 0 8px;
    font-size: 15px;
    color: var(--fg);
  }
  .body {
    margin: 0 0 14px;
    font-size: 13px;
    color: var(--fg-soft);
    line-height: 1.4;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 14px;
  }
  .field label {
    font-size: 12px;
    color: var(--fg-soft);
  }
  input {
    height: 30px;
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    padding: 0 10px;
    font: inherit;
    font-size: 13px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
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
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
