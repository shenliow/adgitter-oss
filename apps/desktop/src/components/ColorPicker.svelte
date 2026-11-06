<!--
  HSV color picker: saturation/value square + hue slider + hex input.
  Two-way binds a `#rrggbb` value. h/s/v are the source of truth; the hex value
  is derived and pushed to the bound prop.
-->
<script lang="ts">
  import {
    hexToHsv,
    hsvToHex,
    isValidHex,
    hsvToRgb,
    rgbToHex,
  } from '../lib/color';
  import { t } from '../lib/i18n/index.svelte';

  let { value = $bindable('#3a86ff') }: { value?: string } = $props();

  const seed = hexToHsv(value) ?? { h: 210, s: 1, v: 1 };
  // Seeded once from the initial value; the dialog is remounted per use.
  // svelte-ignore state_referenced_locally
  let h = $state(seed.h);
  // svelte-ignore state_referenced_locally
  let s = $state(seed.s);
  // svelte-ignore state_referenced_locally
  let v = $state(seed.v);

  const hex = $derived(hsvToHex({ h, s, v }));
  $effect(() => {
    value = hex;
  });

  // Pure hue color for the square background.
  const hueHex = $derived(rgbToHex(hsvToRgb({ h, s: 1, v: 1 })));

  const clamp = (n: number) => Math.min(1, Math.max(0, n));

  function pickSV(e: PointerEvent) {
    if (e.buttons === 0 && e.type === 'pointermove') return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    s = clamp((e.clientX - r.left) / r.width);
    v = clamp(1 - (e.clientY - r.top) / r.height);
  }

  function onHex(e: Event) {
    const t = (e.target as HTMLInputElement).value;
    if (isValidHex(t)) {
      const c = hexToHsv(t)!;
      h = c.h;
      s = c.s;
      v = c.v;
    }
  }
</script>

<div class="picker">
  <div
    class="sv"
    style="background:
      linear-gradient(to top, #000, transparent),
      linear-gradient(to right, #fff, {hueHex})"
    role="slider"
    aria-label={t('colorPicker.sv')}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(s * 100)}
    aria-valuetext={hex}
    tabindex="0"
    onpointerdown={pickSV}
    onpointermove={pickSV}
  >
    <span
      class="thumb"
      style="left:{s * 100}%; top:{(1 - v) * 100}%; background:{hex}"
    ></span>
  </div>

  <input
    class="hue"
    type="range"
    min="0"
    max="360"
    value={h}
    aria-label={t('colorPicker.hue')}
    oninput={(e) => (h = +e.currentTarget.value)}
  />

  <div class="hexrow">
    <span class="swatch" style="background:{hex}"></span>
    <input
      class="hex"
      value={hex}
      aria-label={t('colorPicker.hex')}
      spellcheck="false"
      oninput={onHex}
    />
  </div>
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 220px;
  }
  .sv {
    position: relative;
    height: 140px;
    border-radius: 6px;
    cursor: crosshair;
    touch-action: none;
  }
  .thumb {
    position: absolute;
    width: 12px;
    height: 12px;
    border-radius: 999px;
    border: 2px solid #fff;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
    transform: translate(-50%, -50%);
  }
  .hue {
    width: 100%;
    height: 14px;
    -webkit-appearance: none;
    appearance: none;
    border-radius: 999px;
    background: linear-gradient(
      to right,
      #f00 0%,
      #ff0 17%,
      #0f0 33%,
      #0ff 50%,
      #00f 67%,
      #f0f 83%,
      #f00 100%
    );
  }
  .hexrow {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .swatch {
    width: 24px;
    height: 24px;
    border-radius: 6px;
    border: 1px solid var(--panel-border);
  }
  .hex {
    flex: 1;
    height: 28px;
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    padding: 0 8px;
    font-family: var(--mono);
    font-size: 12px;
  }
</style>
