<!--
  Clone-from-remote dialog (Welcome → "Clone from remote"): a Remote URL and a
  "Clone recursively" checkbox. Confirm hands both to the parent, which asks
  for the destination folder with the native picker and starts the clone right
  away; the dialog stays up showing transfer progress until it finishes.
  Public https repos clone anonymously; ssh:// / git@ URLs use the system's
  SSH agent/keys.
-->
<script lang="ts">
  import { t } from '../lib/i18n/index.svelte';

  let {
    busy = false,
    progress = null,
    onConfirm,
    onCancel,
  }: {
    busy?: boolean;
    progress?: { received: number; total: number } | null;
    onConfirm: (args: { url: string; recursive: boolean }) => void;
    onCancel: () => void;
  } = $props();

  let url = $state('');
  let recursive = $state(false);

  const ready = $derived(url.trim().length > 0 && !busy);

  function confirm() {
    if (ready) onConfirm({ url: url.trim(), recursive });
  }

  const pct = $derived(
    progress && progress.total > 0
      ? Math.round((progress.received / progress.total) * 100)
      : null,
  );
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape' && !busy) onCancel();
  }}
/>

<div class="overlay">
  <button
    class="scrim"
    aria-label={t('common.cancel')}
    onclick={() => {
      if (!busy) onCancel();
    }}
  ></button>
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-label={t('clone.title')}
  >
    <div class="field">
      <label for="cl-url">{t('clone.gitUrl')}</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        id="cl-url"
        autofocus
        bind:value={url}
        disabled={busy}
        placeholder="https://github.com/user/repo.git"
        onkeydown={(e) => {
          if (e.key === 'Enter') confirm();
        }}
      />
    </div>

    <label class="check">
      <input
        id="cl-recursive"
        type="checkbox"
        bind:checked={recursive}
        disabled={busy}
      />
      <span>{t('clone.recursive')}</span>
    </label>

    {#if busy}
      <div class="progress" aria-live="polite">
        <div class="track">
          <div class="bar" style="width:{pct ?? 5}%"></div>
        </div>
        <span class="pctlabel"
          >{pct !== null
            ? `${t('clone.cloning')} ${pct}%`
            : t('clone.cloning')}</span
        >
      </div>
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
  .field input {
    height: 30px;
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    padding: 0 10px;
    font: inherit;
    font-size: 13px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 14px;
    font-size: 13px;
    color: var(--fg);
    cursor: pointer;
    user-select: none;
  }
  .check input {
    margin: 0;
    accent-color: var(--select-ring);
  }
  .progress {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
  }
  .track {
    height: 6px;
    background: var(--row-hover);
    border-radius: 999px;
    overflow: hidden;
  }
  .bar {
    height: 100%;
    background: var(--select-ring);
    transition: width 0.15s;
  }
  .pctlabel {
    font-size: 11px;
    color: var(--fg-soft);
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
