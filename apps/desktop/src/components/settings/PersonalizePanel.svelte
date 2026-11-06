<!--
  Personalize (merged). One page that is both the graph-theme
  store and the picker: a list of theme rows
  (thumbnail · name/version · author · description · price · action) on the left,
  a live preview of the selected row on the right. An owned theme's action is
  Apply (staged into the draft, live on modal OK); a purchasable one's is Buy $X
  (mock store grants instantly — see lib/themes/storeOwnership — or opens the
  Polar checkout in real mode). No "Purchased" badge: ownership is conveyed by
  Buy vs Apply. The only other kept customization is font + text size.
-->
<script lang="ts">
  import type { PersonalizeSettings } from '../../lib/settings';
  import {
    graphThemes,
    resolveGraphThemePack,
    type GraphThemePack,
  } from '../../lib/graphTheme';
  import {
    ownsStoreTheme,
    canPurchase,
    buyStoreTheme,
    refreshOwnership,
    MOCK_STORE,
  } from '../../lib/themes/storeOwnership.svelte';
  import GraphThemePreview from './GraphThemePreview.svelte';
  import { checkoutNotice } from '../../lib/checkoutFlow';
  import { t } from '../../lib/i18n/index.svelte';
  import type { MessageKey } from '../../lib/i18n/messages';
  import type { TutorialAction } from '../../lib/tutorial/types';

  let {
    value = $bindable(),
    guard,
  }: {
    value: PersonalizeSettings;
    /** Guided tutorial: asked BEFORE a theme is applied (`applyTheme`) or
     *  bought (`other: theme-buy`). `false` means "swallow it". Absent ⇒
     *  always allowed. */
    guard?: (a: TutorialAction) => boolean;
  } = $props();

  // Selecting a row previews it (right pane) without committing; the row's own
  // Apply writes it into the draft (persisted on modal OK). Purchasable themes
  // preview too — Buy then Apply.
  let stagedGraphTheme = $state(value.graphTheme);
  const stagedPack = $derived(resolveGraphThemePack(stagedGraphTheme));
  const stagedOwned = $derived(ownsStoreTheme(stagedPack.id));

  const DEFAULT_LANES = [
    'var(--lane-0)',
    'var(--lane-1)',
    'var(--lane-2)',
    'var(--lane-3)',
    'var(--lane-4)',
  ];
  function railColor(gt: GraphThemePack): string {
    return (gt.lanes ?? DEFAULT_LANES)[0];
  }

  function stage(id: string) {
    stagedGraphTheme = id;
  }
  function apply(id: string) {
    if (guard && !guard({ kind: 'applyTheme', id })) return;
    value.graphTheme = id;
    stagedGraphTheme = id;
  }
  // Whatever the last purchase attempt has to say (null = nothing to say), and
  // the row it belongs to. Reuses the shared `checkout.*` wording so this panel
  // explains a sign-in round trip exactly like the plan panel and theme store.
  let notice = $state<{ id: string; key: MessageKey } | null>(null);
  // The row whose purchase is in flight — a real checkout can wait on a whole
  // browser sign-in, so the button must not look idle meanwhile.
  let buying = $state<string | null>(null);

  /**
   * Buy `id`. Every ending is rendered, none is thrown: `buyStoreTheme` resolves
   * for all of them, and the belt-and-braces `catch` means even a bug in it
   * can't become an unhandled rejection — which is what used to replace the
   * whole window with the crash screen when a signed-out user clicked Buy.
   */
  async function buy(id: string) {
    if (guard && !guard({ kind: 'other', name: 'theme-buy' })) return;
    stagedGraphTheme = id;
    notice = null;
    buying = id;
    try {
      const result = await buyStoreTheme(id);
      // Mock grants instantly (ownership is reactive → the button flips to
      // Apply) and has nothing to report.
      const key = result.status === 'granted' ? null : checkoutNotice(result);
      notice = key ? { id, key } : null;
    } catch {
      notice = { id, key: 'checkout.unavailable' };
    } finally {
      buying = null;
    }
  }

  /** Re-verify purchases. Real mode hits the network, so it can fail — say so
   *  rather than letting the rejection escape. */
  async function refresh(id: string) {
    notice = null;
    try {
      await refreshOwnership();
    } catch {
      notice = { id, key: 'checkout.unavailable' };
    }
  }
</script>

<div class="panel">
  <div class="left">
    <div class="controls">
      <label class="field">
        <span>{t('personalize.font')}</span>
        <select bind:value={value.font}>
          <option value="system">{t('personalize.fontSystem')}</option>
          <option value="sans">{t('personalize.fontSans')}</option>
          <option value="mono">{t('personalize.fontMono')}</option>
        </select>
      </label>
      <label class="field">
        <span>{t('personalize.textSize')}</span>
        <select bind:value={value.textSize}>
          <option value="small">{t('personalize.small')}</option>
          <option value="medium">{t('personalize.medium')}</option>
          <option value="large">{t('personalize.large')}</option>
        </select>
      </label>
    </div>

    <span class="gt-label">{t('personalize.graphTheme')}</span>
    <div
      class="gt-list"
      role="radiogroup"
      aria-label={t('personalize.graphTheme')}
    >
      {#each graphThemes() as gt (gt.id)}
        {@const applied = value.graphTheme === gt.id}
        {@const owned = ownsStoreTheme(gt.id)}
        <div
          class="gt-row"
          class:staged={stagedGraphTheme === gt.id}
          role="radio"
          aria-checked={stagedGraphTheme === gt.id}
          tabindex="0"
          onclick={() => stage(gt.id)}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              stage(gt.id);
            }
          }}
        >
          <span
            class="gt-thumb"
            style="background:{gt.background ?? 'var(--workspace-bg)'}"
          >
            <span class="gt-thumb-rail" style="background:{railColor(gt)}"
            ></span>
            {#if gt.node}
              <img class="gt-thumb-node" src={gt.node.normal.url} alt="" />
            {:else}
              <span
                class="gt-thumb-node plain"
                style="background:{railColor(gt)}"
              ></span>
            {/if}
            {#if gt.head}
              <img class="gt-thumb-head" src={gt.head.url} alt="" />
            {/if}
          </span>

          <span class="gt-info">
            <span class="gt-titleline">
              <span class="gt-name">{gt.name}</span>
              {#if gt.version}
                <span class="gt-ver">v{gt.version}</span>
              {/if}
            </span>
            {#if gt.author}
              <span class="gt-author"
                >{t('personalize.author')}: {gt.author}</span
              >
            {/if}
            <!-- A built-in pack ships a catalog key and is translated; a remote
                 pack only has raw `description` text and is shown verbatim. -->
            {#if gt.descriptionKey}
              <span class="gt-desc">{t(gt.descriptionKey)}</span>
            {:else if gt.description}
              <span class="gt-desc">{gt.description}</span>
            {/if}
          </span>

          <span class="gt-side">
            <span class="gt-side-meta">
              {#if gt.priceUsd != null && !owned}
                <span class="gt-price">${gt.priceUsd.toFixed(2)}</span>
              {/if}
              {#if gt.date}
                <span class="gt-date">{gt.date}</span>
              {/if}
            </span>
            <span class="gt-side-action">
              {#if applied}
                <span class="gt-action inuse">{t('personalize.inUse')}</span>
              {:else if owned}
                <button
                  type="button"
                  class="gt-action apply"
                  data-tutorial="theme-apply"
                  data-tutorial-theme={gt.id}
                  onclick={(e) => {
                    e.stopPropagation();
                    apply(gt.id);
                  }}
                >
                  {t('personalize.apply')}
                </button>
              {:else}
                <button
                  type="button"
                  class="gt-action buy"
                  disabled={!canPurchase() || buying !== null}
                  onclick={(e) => {
                    e.stopPropagation();
                    void buy(gt.id);
                  }}
                >
                  {t('personalize.buy')}
                </button>
                {#if !MOCK_STORE}
                  <button
                    type="button"
                    class="gt-action refresh"
                    onclick={(e) => {
                      e.stopPropagation();
                      void refresh(gt.id);
                    }}
                  >
                    {t('personalize.refreshPurchase')}
                  </button>
                {/if}
              {/if}
            </span>
            <!-- The outcome of this row's last Buy: a sign-in round trip that
                 was cancelled/unavailable is the everyday case, not a crash. -->
            {#if notice?.id === gt.id}
              <span class="gt-notice" role="status" data-gt-notice={gt.id}
                >{t(notice.key)}</span
              >
            {/if}
          </span>
        </div>
      {/each}
    </div>
  </div>

  <div class="preview" aria-label={t('personalize.preview')}>
    <span class="pv-title">{t('personalize.preview')}</span>
    <GraphThemePreview theme={stagedPack} />
    <div class="pv-caption">
      <span class="pv-name">{stagedPack.name}</span>
      {#if stagedOwned}
        <span class="pv-owned">{t('personalize.owned')}</span>
      {:else if stagedPack.priceUsd != null}
        <span class="pv-price">${stagedPack.priceUsd.toFixed(2)}</span>
      {/if}
    </div>
  </div>
</div>

<style>
  .panel {
    display: grid;
    grid-template-columns: 1fr 180px;
    gap: 18px;
    align-items: stretch;
    height: 100%;
    min-height: 0;
  }
  .left {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
  }
  .controls {
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
  }
  .field {
    display: flex;
    align-items: center;
    font-size: 13px;
    gap: 10px;
  }
  .field select {
    width: 130px;
    height: 28px;
  }
  .gt-label {
    font-size: 13px;
    color: var(--fg);
  }

  /* --- Graph-theme store rows --- */
  .gt-list {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    overflow: hidden;
  }
  .gt-row {
    display: grid;
    grid-template-columns: 52px 1fr auto;
    gap: 12px;
    align-items: center;
    padding: 10px;
    cursor: pointer;
    text-align: left;
    border-bottom: 1px solid var(--panel-border);
    transition: background 0.12s;
  }
  .gt-row:last-child {
    border-bottom: 0;
  }
  .gt-row:hover {
    background: var(--row-hover);
  }
  .gt-row.staged {
    background: var(--row-hover);
    box-shadow: inset 3px 0 0 var(--select-ring);
  }
  .gt-row:focus-visible {
    outline: 2px solid var(--select-ring);
    outline-offset: -2px;
  }

  .gt-thumb {
    position: relative;
    width: 52px;
    height: 52px;
    border-radius: 6px;
    overflow: hidden;
  }
  .gt-thumb-rail {
    position: absolute;
    left: 50%;
    top: 6px;
    bottom: 6px;
    width: 5px;
    transform: translateX(-50%);
    border-radius: 2px;
  }
  .gt-thumb-node {
    position: absolute;
    left: 50%;
    top: 55%;
    width: 22px;
    height: 22px;
    transform: translate(-50%, -50%);
    object-fit: contain;
  }
  .gt-thumb-node.plain {
    border-radius: 999px;
    border: 2px solid #fff;
  }
  .gt-thumb-head {
    position: absolute;
    left: 50%;
    top: 5px;
    width: 16px;
    height: 14px;
    transform: translateX(-50%);
    object-fit: contain;
  }

  .gt-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .gt-titleline {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .gt-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--fg);
  }
  .gt-ver {
    font-size: 10px;
    color: #fff;
    background: var(--select-ring);
    border-radius: 4px;
    padding: 1px 5px;
    font-variant-numeric: tabular-nums;
  }
  .gt-author {
    font-size: 11px;
    color: var(--fg-muted);
  }
  .gt-desc {
    font-size: 12px;
    color: var(--fg-soft);
    line-height: 1.35;
  }

  .gt-side {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    justify-content: space-between;
    gap: 8px;
    white-space: nowrap;
    height: 100%;
  }
  .gt-side-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }
  .gt-side-action {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
  }
  .gt-price {
    font-size: 13px;
    font-weight: 600;
    color: var(--fg);
    font-variant-numeric: tabular-nums;
  }
  .gt-date {
    font-size: 10px;
    color: var(--fg-muted);
    font-variant-numeric: tabular-nums;
  }
  .gt-action {
    border-radius: 7px;
    padding: 6px 16px;
    font-size: 12px;
  }
  button.gt-action {
    cursor: pointer;
    border: 1px solid var(--select-ring);
    background: var(--select-ring);
    color: #fff;
  }
  button.gt-action.apply {
    background: var(--row-hover);
    color: var(--fg);
    border-color: var(--panel-border);
  }
  button.gt-action.refresh {
    background: none;
    color: var(--fg-muted);
    border-color: var(--panel-border);
    padding: 4px 10px;
  }
  button.gt-action:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .gt-notice {
    font-size: 11px;
    color: var(--fg-muted);
    max-width: 220px;
    white-space: normal;
    text-align: right;
  }
  .gt-action.inuse {
    color: var(--select-ring);
    font-weight: 600;
    padding: 6px 8px;
  }

  /* --- Live preview pane --- */
  .preview {
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: 100%;
    min-height: 0;
  }
  .pv-title {
    font-size: 10px;
    color: var(--fg-muted);
  }
  .pv-caption {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 6px;
  }
  .pv-name {
    font-size: 12px;
    color: var(--fg);
  }
  .pv-owned {
    font-size: 10px;
    color: var(--select-ring);
  }
  .pv-price {
    font-size: 10px;
    color: var(--fg-muted);
    font-variant-numeric: tabular-nums;
  }
</style>
