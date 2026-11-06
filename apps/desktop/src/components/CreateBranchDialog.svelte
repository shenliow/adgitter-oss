<!--
  Create-branch popup: name a new branch starting at a given commit or branch
  tip (opened from the commit / branch context menus). Enter submits, Escape
  cancels; a backend failure shows inline and keeps the dialog open.
-->
<script lang="ts">
  import { errorText } from '../lib/ipc';
  import { t } from '../lib/i18n/index.svelte';

  let {
    from,
    onCreate,
    onCancel,
  }: {
    /** Human label for the starting point (branch name or short sha). */
    from: string;
    /** Create the branch; reject to keep the dialog open with the error. */
    onCreate: (name: string) => Promise<void>;
    onCancel: () => void;
  } = $props();

  let name = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  const disabled = $derived(busy || name.trim().length === 0);

  async function submit() {
    if (disabled) return;
    busy = true;
    error = null;
    try {
      await onCreate(name.trim());
    } catch (e) {
      error = errorText(e);
    } finally {
      busy = false;
    }
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
    aria-label={t('createBranch.title')}
  >
    <div class="field">
      <span class="lbl">{t('createBranch.from')}</span>
      <span class="val">{from}</span>
    </div>
    <label class="name">
      <span class="lbl">{t('createBranch.name')}</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        autofocus
        bind:value={name}
        disabled={busy}
        placeholder={t('createBranch.placeholder')}
        onkeydown={(e) => {
          if (e.key === 'Enter') void submit();
        }}
      />
    </label>
    {#if error}<p class="err" role="alert">{error}</p>{/if}
    <div class="actions">
      <span class="spacer"></span>
      <button class="ghost" onclick={onCancel} disabled={busy}
        >{t('common.cancel')}</button
      >
      <button class="primary" onclick={submit} {disabled}
        >{t('common.create')}</button
      >
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
    width: 264px;
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    box-shadow: var(--panel-shadow);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 13px;
  }
  .lbl {
    color: var(--fg-soft);
  }
  .val {
    font-weight: 600;
    color: var(--fg);
    font-family: var(--mono);
    font-size: 12px;
  }
  .name {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
  }
  .name input {
    height: 28px;
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    padding: 0 8px;
    font: inherit;
    font-size: 12px;
    outline: none;
    background: var(--panel-bg);
    color: var(--fg);
  }
  .name input:focus-visible {
    border-color: var(--select-ring);
  }
  .err {
    margin: 0;
    font-size: 11px;
    color: var(--lane-7);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .spacer {
    flex: 1;
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
  .actions button:disabled {
    opacity: 0.5;
    cursor: default;
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
