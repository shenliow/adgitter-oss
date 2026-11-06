<!--
  Bottom ad strip. Renders only on the free tier; the ad runs in a
  sandboxed iframe via the AdProvider abstraction and is disposed instantly on
  upgrade or unmount (no leftover iframe/script). The consent is asked by
  AdGate, not here; until it is granted (or where declining is allowed and the
  user declined, or offline) the strip stays blank.
-->
<script lang="ts">
  import { getPlan } from '../lib/license.svelte';
  import { CarbonAdsProvider } from '../lib/ads/CarbonAdsProvider';
  import type { AdProvider } from '../lib/ads/AdProvider';
  import type { AdConsent } from '../lib/settings';

  let {
    consent = 'unset',
  }: {
    consent?: AdConsent;
  } = $props();

  let slot = $state<HTMLDivElement | null>(null);
  let provider: AdProvider | null = null;

  // Carbon serve/placement codes from the environment. Both present →
  // the provider embeds the live carbon.js; absent → a tasteful stub renders so
  // the lifecycle stays wired without a network call (dev / pre-acceptance).
  const carbonConfig = {
    serve:
      (import.meta.env.VITE_CARBON_SERVE as string | undefined) || undefined,
    placement:
      (import.meta.env.VITE_CARBON_PLACEMENT as string | undefined) ||
      undefined,
  };

  const free = $derived(getPlan() === 'free');
  const showAd = $derived(free && consent === 'granted');

  // Mount the provider only while showing an ad; dispose on any change away
  // (upgrade, decline, unmount). The cleanup guarantees no leftover iframe.
  $effect(() => {
    if (!showAd || !slot) {
      provider?.dispose();
      provider = null;
      return;
    }
    const p = new CarbonAdsProvider(carbonConfig);
    provider = p;
    void p.load().then(() => {
      if (provider === p && slot) p.render(slot);
    });
    return () => {
      p.dispose();
      if (provider === p) provider = null;
    };
  });
</script>

{#if free}
  <div class="ad">
    <div class="slot" bind:this={slot}></div>
  </div>
{/if}

<style>
  .ad {
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
</style>
