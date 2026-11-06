<!-- Shown when loaded history exceeds the per-load cap. -->
<script lang="ts">
  import Icon from '../lib/icons/Icon.svelte';
  let { shown }: { shown: number } = $props();
</script>

<div class="notice" role="status">
  <span aria-hidden="true"><Icon name="moreHorizontal" size={14} /></span>
  Showing the first {shown.toLocaleString()} commits — history truncated.
</div>

<style>
  .notice {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 16px;
    font-size: 11px;
    color: var(--fg-soft);
    background: rgba(255, 255, 255, 0.85);
    border-bottom: 1px solid var(--panel-border);
    backdrop-filter: blur(2px);
  }
</style>
