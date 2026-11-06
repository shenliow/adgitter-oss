<!--
  Theme Store. Lists the purchasable catalog with a live per-theme
  preview (the pack's CSS vars applied locally to a small sample, without
  committing the global theme). Owned themes (via `lib/themes/storeOwnership`'s
  `ownsStoreTheme` — the single ownership authority also used by
  `PersonalizePanel`, so the two screens can't disagree) show Apply; unowned
  show Buy $X. Apply writes the theme id into the draft `personalize` slice —
  the Settings modal live-applies it and persists on OK, so an owned theme
  survives restart. Ownership is independent of the plan: a
  free plan can still Apply an owned theme; only Buy is gated.

  Buy runs `buyStoreTheme`: real mode creates a one-time Polar checkout
  server-side for *that* theme id (the same protected `create_checkout` path
  the plan upgrade uses — it is authenticated by the persisted license, so a
  purchase is always tied to a real account) and opens the hosted URL in the
  system browser. Buying is also the first moment we need an identity at all
  (lazy sign-in): signed out, the shared checkout flow
  runs sign-in and then resumes this same purchase by itself, so the user only
  clicks Buy once. After returning, Refresh re-verifies ownership so a
  completed purchase unlocks without a restart. Mock mode grants instantly
  instead, with no network call at all.

  Polar product ids are per-deployment env vars, so the catalog reports a
  `purchasable` flag per theme; a theme this deployment cannot charge for shows
  a disabled Buy with the reason, instead of a button that fails after the user
  has already decided to pay. Mock mode ignores the flag — see `canBuy`.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { PersonalizeSettings } from '../lib/settings';
  import { resolveThemePack } from '../lib/theme';
  import { checkoutNotice } from '../lib/checkoutFlow';
  import { t } from '../lib/i18n/index.svelte';
  import type { MessageKey } from '../lib/i18n/messages';
  import CheckoutReturnNotice from './CheckoutReturnNotice.svelte';
  import {
    MOCK_STORE,
    ownsStoreTheme,
    buyStoreTheme,
    refreshOwnership,
  } from '../lib/themes/storeOwnership.svelte';
  import {
    loadCatalog,
    storeListings,
    ensureThemePack,
    ThemeLoadError,
    type StoreListing,
  } from '../lib/themes/remote.svelte';

  let {
    value = $bindable(),
  }: {
    value: PersonalizeSettings;
  } = $props();

  let refreshing = $state(false);
  // The theme whose purchase is in flight (sign-in round trip included), and
  // whatever the last attempt had to say — both scoped to one theme so a
  // failure names the item it belongs to.
  let buying = $state<string | null>(null);
  // The theme whose pack is being fetched, so Apply can't be double-clicked
  // while a download is in flight.
  let applying = $state<string | null>(null);
  let notice = $state<{ id: string; key: MessageKey } | null>(null);

  // The catalog is remote: fetch once on open so a theme added
  // server-side shows up without an app release. The command is cache-first
  // with a 24 h TTL, so this is cheap and works offline. `onMount` rather than
  // `$effect` deliberately — the fetch writes the very state the listing reads,
  // which in an effect is a re-entrant update loop, and "once, on open" is the
  // actual intent anyway.
  onMount(() => {
    void loadCatalog();
  });

  const listings = $derived(storeListings());

  /**
   * Inline CSS-var string for a preview pane.
   *
   * A built-in resolves to its real pack, so the preview is exactly what
   * `applyTheme` will set. A remote theme deliberately only exposes swatches
   * until it is bought — the full pack is behind the license — so its preview
   * is built from those instead. Selling from a subset is the accepted cost of
   * gating the pack.
   */
  function previewStyle(item: StoreListing): string {
    if (item.builtIn) {
      return Object.entries(resolveThemePack(item.id).vars)
        .map(([k, v]) => `--${k}: ${v}`)
        .join('; ');
    }
    const [bg, workspace, ring, fg, panel] = item.swatches;
    return [
      bg && `--topbar-bg: ${bg}`,
      workspace && `--workspace-bg: ${workspace}`,
      ring && `--select-ring: ${ring}`,
      fg && `--fg: ${fg}`,
      panel && `--panel-bg: ${panel}`,
    ]
      .filter(Boolean)
      .join('; ');
  }

  /**
   * Apply an owned theme. The pack has to be in hand *before* the selection
   * changes: an owned theme that is neither built-in nor cached, with no
   * network, must say so and leave the current theme exactly as it was rather
   * than switching to a half-resolved one.
   */
  async function apply(item: StoreListing) {
    notice = null;
    applying = item.id;
    try {
      await ensureThemePack(item.id, item.kind);
      // Only now — the modal live-applies this and persists on OK.
      if (item.kind === 'graph') value.graphTheme = item.id;
      else value.theme = item.id;
    } catch (err) {
      notice =
        err instanceof ThemeLoadError
          ? { id: item.id, key: err.messageKey }
          : { id: item.id, key: 'themeStore.error.offline' };
    } finally {
      applying = null;
    }
  }

  /**
   * Buy `id` through the shared entitlement module, so this store and
   * `PersonalizePanel` can never disagree about what got bought. Mock: grants
   * instantly (ownership is reactive → the row flips to Apply) and has
   * nothing to report — same as `PersonalizePanel`'s handling. Real: runs the
   * shared lazy sign-in checkout.
   */
  async function buy(id: string) {
    notice = null;
    buying = id;
    try {
      const result = await buyStoreTheme(id);
      const key = result.status === 'granted' ? null : checkoutNotice(result);
      notice = key ? { id, key } : null;
    } finally {
      buying = null;
    }
  }

  /** Re-verify purchases *and* re-pull the catalog, bypassing its TTL. */
  async function refresh() {
    refreshing = true;
    try {
      await Promise.all([refreshOwnership(), loadCatalog(true)]);
    } finally {
      refreshing = false;
    }
  }

  /**
   * Whether Buy should be live for this row.
   *
   * The server tells us whether *its* deployment has a Polar product for the
   * theme; without one the checkout is guaranteed to fail, so offering the
   * button would only spend the user's decision to buy on a generic error.
   *
   * Mock mode is exempt on purpose. `VITE_STORE_MOCK` is the dev/demo path,
   * and a dev box typically points at a server with no Polar configuration at
   * all — so honouring `purchasable` there would grey out the entire shop and
   * break the very flow mock mode exists to let people work on. This is safe
   * *because* `buy()` now goes through `buyStoreTheme`, which never reaches
   * Polar while `MOCK_STORE` is on — it grants ownership locally instead. The
   * button being enabled no longer implies a checkout that is guaranteed to
   * fail.
   */
  function canBuy(item: StoreListing): boolean {
    return MOCK_STORE || item.purchasable;
  }

  function isApplied(item: StoreListing): boolean {
    return item.kind === 'graph'
      ? value.graphTheme === item.id
      : value.theme === item.id;
  }
</script>

<div class="store">
  <div class="head">
    <p class="lede">{t('themeStore.lede')}</p>
    <button class="btn refresh" onclick={refresh} disabled={refreshing}
      >{t('themeStore.refresh')}</button
    >
  </div>

  <!-- Post-payment return: the purchase the user just came back from. -->
  <CheckoutReturnNotice />

  <ul class="list">
    {#each listings as th (th.id)}
      {@const owned = ownsStoreTheme(th.id)}
      {@const applied = isApplied(th)}
      <li class="item" class:active={applied}>
        <div class="preview" style={previewStyle(th)} data-theme={th.id}>
          <div class="pv-panel">
            <span class="pv-row title">{th.name}</span>
            <span class="pv-row sub">{t('themeStore.previewSubject')}</span>
            <span class="pv-node"></span>
          </div>
        </div>
        <div class="meta">
          <span class="name">{th.name}</span>
          <span class="price">${th.priceUsd.toFixed(2)}</span>
        </div>
        {#if owned}
          <button
            class="btn apply"
            onclick={() => apply(th)}
            disabled={applied || applying !== null}
          >
            {#if applying === th.id}
              {t('themeStore.downloading')}
            {:else if applied}
              {t('themeStore.applied')}
            {:else}
              {t('themeStore.apply')}
            {/if}
          </button>
        {:else if canBuy(th)}
          <button
            class="btn buy"
            onclick={() => buy(th.id)}
            disabled={buying !== null}
          >
            {buying === th.id
              ? t('checkout.signingIn')
              : t('themeStore.buy', { price: th.priceUsd.toFixed(2) })}
          </button>
        {:else}
          <!-- Disabled: this deployment has no product to charge for. The
               reason is spelled out below rather than in a `title`, which a
               disabled button never shows. -->
          <button class="btn buy" data-unavailable={th.id} disabled>
            {t('themeStore.notForSale')}
          </button>
          <span class="hint unavailable">{t('themeStore.notForSale.hint')}</span
          >
        {/if}
        {#if notice?.id === th.id}
          <span class="hint notice" data-theme-notice={th.id}
            >{t(notice.key)}</span
          >
        {/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .store {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .lede {
    margin: 0;
    font-size: 12px;
    color: var(--fg-muted);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .item {
    display: grid;
    grid-template-columns: 96px 1fr auto;
    align-items: center;
    gap: 12px;
    padding: 8px;
    border: 1px solid var(--panel-border);
    border-radius: 8px;
  }
  .item.active {
    border-color: var(--select-ring);
  }
  .preview {
    height: 56px;
    border-radius: 6px;
    background: var(--workspace-bg);
    padding: 6px;
    overflow: hidden;
  }
  .pv-panel {
    height: 100%;
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: 4px;
    padding: 4px 6px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    position: relative;
  }
  .pv-row {
    font-size: 9px;
  }
  .pv-row.title {
    color: var(--fg);
    font-weight: 600;
  }
  .pv-row.sub {
    color: var(--fg-soft);
  }
  .pv-node {
    position: absolute;
    right: 6px;
    top: 6px;
    width: 9px;
    height: 9px;
    border-radius: 999px;
    background: var(--select-ring);
  }
  .meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .name {
    font-size: 13px;
    color: var(--fg);
  }
  .price {
    font-size: 11px;
    color: var(--fg-muted);
  }
  .hint {
    font-size: 11px;
    color: var(--fg-muted);
  }
  /* The per-theme outcome message sits on its own row under that theme's
     columns, so it can't squeeze the preview/meta/button layout. */
  .notice,
  .unavailable {
    grid-column: 1 / -1;
  }
  .btn {
    border: 0;
    background: var(--select-ring);
    color: #fff;
    padding: 6px 14px;
    border-radius: 7px;
    font-size: 12px;
    cursor: pointer;
  }
  .btn.refresh,
  .btn.apply {
    background: var(--row-hover);
    color: var(--fg);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
