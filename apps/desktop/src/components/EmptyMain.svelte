<!--
  Centre-stage empty states:
   - no-repo  → open a repository (entry, mockup: welcome - open or create)
   - empty-repo → "Create your first Branch" (mockup: empty screen; the create
     action is a later phase, so it's a disabled placeholder here)
-->
<script lang="ts">
  import { t } from '../lib/i18n/index.svelte';
  let {
    mode = 'no-repo',
    onOpen = () => {},
  }: { mode?: 'no-repo' | 'empty-repo'; onOpen?: () => void } = $props();
</script>

<div class="stage">
  {#if mode === 'no-repo'}
    <button class="pill primary" onclick={onOpen}>{t('empty.openRepo')}</button>
    <p class="hint">{t('empty.openHint')}</p>
  {:else}
    <button class="pill" disabled>{t('empty.firstBranch')}</button>
  {/if}
</div>

<style>
  .stage {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
  }
  .pill {
    border: 0;
    background: #bdbdbd;
    color: #2b2b2b;
    font-size: 18px;
    padding: 16px 40px;
    border-radius: 999px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
    cursor: pointer;
  }
  .pill.primary {
    background: #b0b0b0;
  }
  .pill:hover:not(:disabled) {
    background: #aaa;
  }
  .pill:disabled {
    cursor: default;
    opacity: 0.85;
  }
  .hint {
    font-size: 12px;
    color: var(--fg-muted);
  }
</style>
