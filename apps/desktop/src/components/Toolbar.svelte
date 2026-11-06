<!--
  Floating toolbar over the graph area: left = branches / files panel toggles;
  centre = push / pull / log-anytime; right = issues panel toggle, then undo.

  Issues lives in `.right` (not `.left`, next to branches/files) because the
  issue panel itself opens flush against the right edge of the window — the
  toggle sits next to where its panel appears. It comes before undo so undo
  keeps its long-standing spot as the outermost, rightmost button.

  The toolbar is a permanent floating overlay: `.toolbar`'s z-index (8) sits
  above every docked panel's (6), so these buttons stay reachable without
  closing a panel first — no more per-panel duplicate copies. Each docked
  panel reserves `var(--float-btn-band)` of padding-top (see app.css) so its
  own header renders below this band instead of underneath it. `.toolbar`
  keeps `pointer-events: none` outside its `.left`/`.center`/`.right`
  clusters, so clicks in the empty band between them still reach the panel
  underneath.

  Push is a split button: the icon segment pushes normally
  (unchanged default action); its caret opens a menu with the advanced,
  destructive "Force push" option. `onPush`/`onForcePush` are separate
  handlers — App.svelte routes the latter through an explicit confirm dialog
  before it ever reaches IPC.
-->
<script lang="ts">
  import { t } from '../lib/i18n/index.svelte';
  import Icon from '../lib/icons/Icon.svelte';
  import SplitButton from './SplitButton.svelte';
  let {
    activePanel = null,
    onToggleBranches = () => {},
    onToggleFiles = () => {},
    onUndo = () => {},
    canUndo = false,
    undoHint = undefined,
    undoBusy = false,
    onPush = () => {},
    onForcePush = () => {},
    onPull = () => {},
    pushBusy = false,
    pullBusy = false,
    /** No upstream / no repo → push & pull are unavailable. */
    syncDisabled = false,
    ahead = 0,
    behind = 0,
    onToggleIssues = () => {},
    issuesActive = false,
    /** Free tier: the issue panel is Advance+ — show the affordance locked. */
    issuesLocked = false,
    /** Log Anytime auto-snapshot on/off — a main-screen toggle mirroring
     *  the settings panel's "Enable Log Anytime". */
    logAnytimeEnabled = false,
    onToggleLogAnytime = () => {},
    canOpenPushMenu,
  }: {
    activePanel?: 'branches' | 'files' | null;
    onToggleBranches?: () => void;
    onToggleFiles?: () => void;
    onUndo?: () => void;
    canUndo?: boolean;
    /**
     * Why Undo is unavailable, shown instead of the plain label. A disabled
     * control with no explanation is worse than the bug it is guarding
     * against, so the one case the user cannot infer from the screen — the
     * repo was changed outside ADGitter — says so here.
     */
    undoHint?: string;
    undoBusy?: boolean;
    onPush?: () => void;
    /** Opens the advanced, destructive force-push confirmation (owned by App.svelte). */
    onForcePush?: () => void;
    onPull?: () => void;
    pushBusy?: boolean;
    pullBusy?: boolean;
    syncDisabled?: boolean;
    ahead?: number;
    behind?: number;
    onToggleIssues?: () => void;
    issuesActive?: boolean;
    issuesLocked?: boolean;
    logAnytimeEnabled?: boolean;
    onToggleLogAnytime?: () => void;
    /** Asked before the Push ▾ menu opens (guided tutorial). Absent ⇒ always. */
    canOpenPushMenu?: () => boolean;
  } = $props();
</script>

<!-- `data-tutorial-chrome`: floats over the graph's top rows, so the guided
     tutorial never scrolls a target under it. -->
<div class="toolbar" data-tutorial-chrome>
  <div class="left">
    <button
      class="round"
      class:active={activePanel === 'branches'}
      title={t('toolbar.branches')}
      onclick={onToggleBranches}><Icon name="branch" size={16} /></button
    >
    <button
      class="round"
      class:active={activePanel === 'files'}
      data-tutorial="toolbar-files"
      title={t('toolbar.files')}
      onclick={onToggleFiles}><Icon name="files" size={16} /></button
    >
  </div>

  <div class="center">
    <SplitButton
      label=""
      icon="push"
      busy={pushBusy}
      title={t('toolbar.push')}
      disabled={syncDisabled || pushBusy}
      onClick={onPush}
      badge={ahead > 0 ? ahead : undefined}
      menuLabel={t('toolbar.pushOptions')}
      tutorialId="toolbar-push"
      menuTutorialId="toolbar-push-menu"
      canOpen={canOpenPushMenu}
      options={[
        {
          label: t('toolbar.forcePush'),
          danger: true,
          onSelect: onForcePush,
          tutorialId: 'push-force-item',
        },
      ]}
    />
    <button
      class="round"
      title={t('toolbar.pull')}
      disabled={syncDisabled || pullBusy}
      onclick={onPull}
      >{#if pullBusy}…{:else}<Icon
          name="pull"
          size={16}
        />{/if}{#if behind > 0}<span class="badge">{behind}</span>{/if}</button
    >
    <button
      class="round log-anytime"
      class:active={logAnytimeEnabled}
      class:recording={logAnytimeEnabled}
      data-tutorial="toolbar-log-anytime"
      title={t('toolbar.logAnytime')}
      aria-pressed={logAnytimeEnabled}
      onclick={onToggleLogAnytime}
      ><Icon name="logAnytime" size={16} /><span
        class="recording-dot"
        aria-hidden="true"
      ></span></button
    >
  </div>

  <div class="right">
    <button
      class="round"
      class:active={issuesActive}
      class:locked={issuesLocked}
      data-testid="toolbar-issues"
      data-tutorial="toolbar-issues"
      title={issuesLocked ? t('issue.lockedUpsell') : t('toolbar.issues')}
      onclick={onToggleIssues}
      ><Icon name="issues" size={16} />{#if issuesLocked}<span
          class="lock"
          aria-hidden="true"><Icon name="lock" size={11} /></span
        >{/if}</button
    >
    <button
      class="round"
      data-tutorial="toolbar-undo"
      title={!canUndo && undoHint ? undoHint : t('toolbar.undo')}
      disabled={!canUndo || undoBusy}
      onclick={onUndo}><Icon name="undo" size={16} /></button
    >
  </div>
</div>

<style>
  .toolbar {
    position: absolute;
    top: 10px;
    left: 0;
    right: 0;
    display: flex;
    justify-content: center;
    pointer-events: none;
    z-index: 8;
  }
  .left {
    position: absolute;
    left: 14px;
    display: flex;
    gap: 8px;
    pointer-events: auto;
  }
  .center {
    display: flex;
    gap: 6px;
    pointer-events: auto;
  }
  .right {
    position: absolute;
    right: 14px;
    display: flex;
    gap: 8px;
    pointer-events: auto;
  }
  .round {
    height: 30px;
    min-width: 34px;
    padding: 0 9px;
    border: 0;
    border-radius: 8px;
    background: #bdbdbd;
    color: #3a3a3a;
    font-size: 14px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .round:hover:not(:disabled) {
    background: #b0b0b0;
  }
  .round.active {
    background: #9c9c9c;
    color: #fff;
  }
  .round:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .recording-dot {
    flex: 0 0 6px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #e53935;
    box-shadow: 0 0 0 1px currentColor;
  }
  .log-anytime.recording .recording-dot {
    animation: recording-pulse 1s ease-in-out infinite;
  }
  @keyframes recording-pulse {
    50% {
      opacity: 0.2;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .log-anytime.recording .recording-dot {
      animation: none;
    }
  }
  .badge {
    margin-left: 4px;
    font-size: 10px;
    font-weight: 700;
    background: var(--select-ring);
    color: #fff;
    border-radius: 999px;
    padding: 0 5px;
    line-height: 16px;
  }
  .round.locked {
    opacity: 0.7;
  }
  .lock {
    margin-left: 2px;
    font-size: 9px;
  }
  /* Match the Push split button to the toolbar's round icon-pill look. */
  .center :global(.split .trigger) {
    height: 30px;
    min-width: 34px;
    padding: 0 9px;
    border: 0;
    background: #bdbdbd;
    color: #3a3a3a;
    font-size: 14px;
  }
  .center :global(.split .trigger:hover:not(:disabled)) {
    background: #b0b0b0;
  }
  .center :global(.split .trigger:disabled) {
    opacity: 0.55;
    cursor: default;
  }
  .center :global(.split .caret-segment) {
    min-width: 0;
    padding: 0 6px;
    border-left: 1px solid rgba(0, 0, 0, 0.18);
  }
</style>
