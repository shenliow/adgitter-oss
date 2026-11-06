<!--
  Branch-disambiguation dialog for a "drag HEAD" checkout (E2 gesture-ops,
  graph drag layer): dragging the checked-out branch's own chip onto a
  commit that carries several local branches can't silently pick one (chip
  display order is an implementation detail, not a user choice) — this lists
  every candidate, in the same display order the graph shows them, and lets
  the user pick. Cancel performs no checkout at all, matching
  `CheckoutRemoteDialog`'s Cancel.
-->
<script lang="ts">
  import { t } from '../lib/i18n/index.svelte';

  let {
    branches,
    onPick,
    onCancel,
  }: {
    branches: string[];
    onPick: (name: string) => void;
    onCancel: () => void;
  } = $props();
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
    aria-label={t('checkoutChoice.title')}
  >
    <h2>{t('checkoutChoice.title')}</h2>
    <p class="body">{t('checkoutChoice.body')}</p>

    <div class="branch-list">
      {#each branches as name (name)}
        <button class="branch-row" onclick={() => onPick(name)}>
          {name}
        </button>
      {/each}
    </div>

    <div class="actions">
      <button class="ghost" onclick={onCancel}>{t('common.cancel')}</button>
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
  .branch-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 240px;
    overflow-y: auto;
    margin-bottom: 14px;
  }
  .branch-row {
    height: 34px;
    padding: 0 12px;
    border-radius: 8px;
    border: 1px solid var(--panel-border);
    background: var(--row-hover);
    color: var(--fg);
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }
  .branch-row:hover,
  .branch-row:focus-visible {
    border-color: var(--select-ring);
    outline: none;
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
</style>
