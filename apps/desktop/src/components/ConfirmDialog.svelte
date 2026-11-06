<!--
  Generic yes/no confirm dialog. Used by the Welcome flow for the
  "contains a repo — Open?" and "no git project — Create?" prompts, but is
  intentionally content-agnostic so other flows can reuse it.

  OPTIONAL THIRD OUTCOME: pass `onSkip` (+ `skipLabel`) and a middle button
  appears, for prompts whose answer is yes / not-this-time / abandon rather
  than yes / no (the auto-pull gate). Without `onSkip` the markup, the button
  count and the key handling are byte-for-byte what they were, so the existing
  two-outcome callers are untouched. The button ORDER keeps this dialog's
  convention — dismissive left, primary right — rather than reading
  left-to-right as "Yes, Skip, Cancel".
-->
<script lang="ts">
  import { t } from '../lib/i18n/index.svelte';

  let {
    title,
    body = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    skipLabel = '',
    busy = false,
    onConfirm,
    onCancel,
    onSkip,
  }: {
    title: string;
    body?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    /** Label for the optional third button; only read when `onSkip` is set. */
    skipLabel?: string;
    busy?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    /** Supply to turn this into a three-outcome dialog (see the note above). */
    onSkip?: () => void;
  } = $props();
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape') onCancel();
    else if (e.key === 'Enter' && !busy) onConfirm();
  }}
/>

<div class="overlay">
  <button class="scrim" aria-label={t('common.cancel')} onclick={onCancel}
  ></button>
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-label={title}
    data-tutorial="confirm-dialog"
  >
    <p class="title">{title}</p>
    {#if body}<p class="body">{body}</p>{/if}
    <div class="actions">
      <button class="ghost" onclick={onCancel} disabled={busy}
        >{cancelLabel}</button
      >
      {#if onSkip}
        <button class="ghost" onclick={onSkip} disabled={busy}
          >{skipLabel}</button
        >
      {/if}
      <button class="primary" onclick={onConfirm} disabled={busy}>
        {busy ? '…' : confirmLabel}
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
    width: 360px;
    max-width: calc(100vw - 32px);
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    box-shadow: var(--panel-shadow);
    padding: 18px;
  }
  .title {
    margin: 0 0 10px;
    font-size: 14px;
    font-weight: 600;
    color: var(--fg);
    line-height: 1.4;
  }
  .body {
    margin: 0 0 14px;
    font-size: 12px;
    color: var(--fg-soft);
    line-height: 1.4;
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
  .actions button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
