<!--
  Bottom ad strip. Renders only on the free tier of a build that has Carbon
  codes (lib/ads/config.ts) — without them there is no strip at all. The ad
  runs in a sandboxed iframe via the AdProvider abstraction and is disposed
  instantly on upgrade or unmount (no leftover iframe/script). The consent is
  asked by AdGate, not here; until it is granted (or where declining is
  allowed and the user declined) the strip stays blank.

  The frame has an opaque origin, so it can't follow the app's theme or
  language on its own: both are resolved here and handed to the provider, and
  the frame is rebuilt when either changes.
-->
<script lang="ts">
  import { getPlan } from '../lib/license.svelte';
  import { t, getLocale } from '../lib/i18n/index.svelte';
  import { CarbonAdsProvider } from '../lib/ads/CarbonAdsProvider';
  import { carbonConfig, adsConfigured } from '../lib/ads/config';
  import { adColors, type AdColors } from '../lib/ads/adLook';
  import type { AdProvider } from '../lib/ads/AdProvider';
  import type { AdConsent } from '../lib/settings';

  let {
    consent = 'unset',
    onRemoveAds,
  }: {
    consent?: AdConsent;
    /** Take the user to the paid plans. Absent ⇒ no "Remove ads" button. */
    onRemoveAds?: () => void;
  } = $props();

  let strip = $state<HTMLElement | null>(null);
  let slot = $state<HTMLDivElement | null>(null);
  let provider: AdProvider | null = null;

  // Fixed for the build: no codes, no strip.
  const config = carbonConfig();
  const available = adsConfigured();

  /** The strip exists: an ad build, on the free tier. */
  const shown = $derived(available && getPlan() === 'free');
  const showAd = $derived(shown && consent === 'granted');

  // The strip's resolved colours and font. `applyTheme` restyles the app by
  // rewriting `:root`'s inline style, so that is what to watch; `theme` only
  // changes identity when a value really differs, because every change costs
  // a fresh frame — and with it a fresh ad request.
  type Theme = AdColors & { font: string };
  let theme = $state.raw<Theme | null>(null);
  $effect(() => {
    if (!strip) return;
    const el = strip;
    let seen = '';
    const read = () => {
      const style = getComputedStyle(el);
      const next = {
        ...adColors(style.backgroundColor),
        font: style.fontFamily,
      };
      const key = JSON.stringify(next);
      if (key === seen) return;
      seen = key;
      theme = next;
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
    return () => observer.disconnect();
  });

  // Mount the provider only while showing an ad; dispose on any change away
  // (upgrade, decline, unmount). The cleanup guarantees no leftover iframe.
  $effect(() => {
    if (!showAd || !slot || !theme) {
      provider?.dispose();
      provider = null;
      return;
    }
    const target = slot;
    const look = {
      ...theme,
      fallback: t('ad.fallback'),
      title: t('ad.label'),
      lang: getLocale(),
    };
    const p = new CarbonAdsProvider(config);
    provider = p;
    void p.load().then(() => {
      if (provider === p) p.render(target, look);
    });
    return () => {
      p.dispose();
      if (provider === p) provider = null;
    };
  });
</script>

{#if shown}
  <aside
    class="ad"
    bind:this={strip}
    aria-label={showAd ? t('ad.label') : undefined}
    aria-hidden={showAd ? undefined : 'true'}
    style:--ad-text={theme?.text}
    style:--ad-muted={theme?.muted}
  >
    <div class="slot" bind:this={slot}></div>
    {#if showAd && onRemoveAds}
      <button class="remove" onclick={onRemoveAds}>{t('ad.remove')}</button>
    {/if}
  </aside>
{/if}

<style>
  .ad {
    position: relative;
    flex: 0 0 auto;
    height: 96px;
    background: var(--ad-bg);
    overflow: hidden;
    user-select: none;
  }
  .slot {
    width: 100%;
    height: 100%;
  }
  .slot :global(iframe.ad-frame) {
    width: 100%;
    height: 100%;
    border: 0;
    display: block;
  }
  /* Sits over the frame's corner: the frame keeps that margin clear. */
  .remove {
    position: absolute;
    top: 8px;
    right: 10px;
    height: 22px;
    padding: 0 9px;
    border: 1px solid transparent;
    border-radius: 11px;
    background: none;
    color: var(--ad-muted, var(--fg-muted));
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }
  .remove:hover,
  .remove:focus-visible {
    color: var(--ad-text, var(--fg));
    border-color: currentColor;
  }
</style>
