<!--
  Log Anytime settings. Enable a timed working-tree
  snapshot to a dedicated branch. A build with the paid partition adds its
  section (background execution, compaction) below. All edits the draft slice
  in place.
-->
<script lang="ts">
  import type { LogAnytimeSettings } from '../../lib/settings';
  import { t } from '../../lib/i18n/index.svelte';
  import { pro } from '../../lib/pro';

  let {
    value = $bindable(),
    repoPath = null,
  }: { value: LogAnytimeSettings; repoPath?: string | null } = $props();

  // Log Anytime is inherently repo-bound: the branch/enable target a *specific*
  // repo's working tree, so — like General's Remote section (#21) and the Issue
  // Panel — the whole page is disabled and shown blank-of-purpose on the Welcome
  // screen (no repo). Even the paid background execution must be set up with a
  // repo open the first time.
  const repoOpen = $derived(!!repoPath);

  const INTERVALS = [15, 30, 60, 120, 240];
</script>

<div class="panel">
  {#if !repoOpen}
    <p class="norepo">{t('logAnytime.noRepo')}</p>
  {/if}

  <div class="controls" class:disabled={!repoOpen}>
    <label class="row">
      <input
        type="checkbox"
        bind:checked={value.enabled}
        disabled={!repoOpen}
      />
      <span>{t('logAnytime.enable')}</span>
    </label>
    <p class="desc">{t('logAnytime.desc')}</p>

    <label class="field" class:disabled={!value.enabled}>
      <span>{t('logAnytime.branch')}</span>
      <input bind:value={value.branch} disabled={!repoOpen || !value.enabled} />
    </label>

    <label class="field" class:disabled={!value.enabled}>
      <span>{t('logAnytime.interval')}</span>
      <span class="inline">
        <select
          bind:value={value.intervalMin}
          disabled={!repoOpen || !value.enabled}
        >
          {#each INTERVALS as m (m)}<option value={m}>{m}</option>{/each}
        </select>
        {t('logAnytime.minutes')}
      </span>
    </label>

    <label class="row" class:disabled={!value.enabled}>
      <input
        type="checkbox"
        bind:checked={value.autoPush}
        disabled={!repoOpen || !value.enabled}
      />
      <span>{t('logAnytime.autoPush')}</span>
    </label>

    <!-- Paid: background / compaction (Advance+), when the build has it. -->
    {#if pro}
      <pro.LogAnytimePaid bind:value {repoPath} />
    {/if}
  </div>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .controls {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  /* Welcome screen (no repo): the whole repo-bound page is dimmed + disabled,
     mirroring General's Remote section (#21). The .norepo hint sits outside
     this wrapper so it stays at full strength. */
  .controls.disabled {
    opacity: 0.5;
  }
  .norepo {
    margin: 0;
    font-size: 12px;
    color: var(--fg-muted);
    line-height: 1.4;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .row.disabled {
    opacity: 0.5;
  }
  .desc {
    margin: 0;
    font-size: 12px;
    color: var(--fg-muted);
    line-height: 1.4;
  }
  .field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 13px;
    gap: 12px;
  }
  .field.disabled {
    opacity: 0.5;
  }
  .field input,
  .field select {
    height: 28px;
  }
  .field input {
    width: 200px;
  }
  .inline {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--fg-soft);
  }
</style>
