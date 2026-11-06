<!--
  Persistent, non-dismissable "resolving conflicts" bar (E2 gesture-ops
  conflict resolution). Shown while a merge/rebase/squash/reword sits paused
  on a conflict: names the op/branch/commit, and offers Continue — disabled
  until every conflicted file is staged (the parent derives
  `continueDisabled` from the live RepoStatus) — and Abort, which the parent
  gates behind a ConfirmDialog before `abort_op` ever reaches IPC.
-->
<script lang="ts">
  import { t } from '../lib/i18n/index.svelte';

  let {
    op,
    branch,
    sha,
    continueDisabled = false,
    busy = false,
    onContinue = () => {},
    onAbort = () => {},
  }: {
    /** The paused op ("merge" | "rebase" | "squash" | "reword"). */
    op: string;
    /** The branch the op is running on. */
    branch: string;
    /** The commit that was being applied when the conflict hit. */
    sha: string;
    /** True while the repo status still lists conflicted paths. */
    continueDisabled?: boolean;
    /** A continue/abort IPC call is in flight. */
    busy?: boolean;
    onContinue?: () => void;
    onAbort?: () => void;
  } = $props();
</script>

<div class="resolve-banner" role="status">
  <span class="text">
    {t('resolve.banner', { op, branch, short: sha.slice(0, 7) })}
  </span>
  <button
    class="continue"
    disabled={continueDisabled || busy}
    title={continueDisabled
      ? t('resolve.stageAllFirst')
      : t('resolve.continue')}
    onclick={onContinue}
  >
    {busy ? '…' : t('resolve.continue')}
  </button>
  <button class="abort" disabled={busy} onclick={onAbort}>
    {t('resolve.abort')}
  </button>
</div>

<style>
  .resolve-banner {
    position: absolute;
    top: 48px;
    left: 50%;
    transform: translateX(-50%);
    /* Above the files panel (z-index: 6); the graph's own lock overlay is
     * trapped inside MetroGraph's stacking context so it can't reach here. */
    z-index: 7;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    max-width: calc(100% - 32px);
    font-size: 12px;
    color: var(--fg);
    background: var(--panel-bg);
    border: 1px solid var(--lane-7);
    border-radius: 10px;
    box-shadow: var(--panel-shadow);
  }
  .text {
    color: var(--fg-soft);
  }
  button {
    height: 26px;
    padding: 0 12px;
    border: 0;
    border-radius: 7px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    flex: 0 0 auto;
  }
  .continue {
    background: var(--select-ring);
    color: #fff;
  }
  .abort {
    background: var(--lane-7);
    color: #fff;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
