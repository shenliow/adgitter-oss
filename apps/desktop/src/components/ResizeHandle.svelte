<!--
  Drag-to-resize grip for a dockable overlay panel. Sits along the
  panel's inner edge (the one facing the graph) and drives the panel's width via
  a two-way `width` binding: a left-docked panel puts it on its right edge
  (`side="right"`, drag right = wider); a right-docked panel on its left edge
  (`side="left"`, drag left = wider).

  The host panel owns the width `$state` (and persists it — see panelWidth.ts);
  this component only mutates it within [min, max]. Pointer capture keeps the
  drag alive over the graph, and Arrow keys give a keyboard-accessible nudge
  (role="separator").
-->
<script lang="ts">
  import {
    PANEL_MIN_WIDTH,
    PANEL_MAX_WIDTH,
    clampWidth,
  } from '../lib/panelWidth';

  let {
    side,
    width = $bindable(0),
    label,
    min = PANEL_MIN_WIDTH,
    max = PANEL_MAX_WIDTH,
    onCommit,
  }: {
    /** Which edge of the panel this grip sits on. */
    side: 'left' | 'right';
    /** The panel's width in px (two-way). */
    width: number;
    /** Accessible label (e.g. t('panel.resize')). */
    label: string;
    min?: number;
    max?: number;
    /** Called with the final width when a drag / key nudge settles (persist). */
    onCommit?: (width: number) => void;
  } = $props();

  // A drag on the RIGHT edge grows the panel as the pointer moves right (+dx);
  // a drag on the LEFT edge grows it as the pointer moves left (−dx).
  const dir = $derived(side === 'right' ? 1 : -1);
  let dragging = $state(false);

  function clamp(w: number): number {
    return Math.min(max, Math.max(min, clampWidth(w)));
  }

  function onpointerdown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = width;
    dragging = true;
    const grip = e.currentTarget as HTMLElement;
    // Optional: absent in jsdom (tests) and on mouse-emulated events.
    grip.setPointerCapture?.(e.pointerId);
    // Keep the resize cursor and kill text selection window-wide for the drag.
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onmove = (ev: PointerEvent) => {
      width = clamp(startW + dir * (ev.clientX - startX));
    };
    const onup = () => {
      dragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', onmove);
      window.removeEventListener('pointerup', onup);
      onCommit?.(width);
    };
    window.addEventListener('pointermove', onmove);
    window.addEventListener('pointerup', onup);
  }

  function onkeydown(e: KeyboardEvent) {
    const step = e.shiftKey ? 40 : 16;
    if (e.key === 'ArrowRight') {
      width = clamp(width + dir * step);
    } else if (e.key === 'ArrowLeft') {
      width = clamp(width - dir * step);
    } else {
      return;
    }
    e.preventDefault();
    onCommit?.(width);
  }
</script>

<!-- A focusable resize separator IS interactive (WAI-ARIA "Window Splitter"
     pattern: role=separator + aria-valuenow + tabindex); Svelte's a11y
     heuristic doesn't model that, so silence its two false positives. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="grip grip-{side}"
  class:dragging
  role="separator"
  aria-orientation="vertical"
  aria-label={label}
  aria-valuenow={Math.round(width)}
  aria-valuemin={min}
  aria-valuemax={max}
  tabindex="0"
  title={label}
  {onpointerdown}
  {onkeydown}
></div>

<style>
  .grip {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 10px;
    z-index: 7;
    cursor: col-resize;
    touch-action: none;
    /* transparent hit area; the visible line lives in ::after */
  }
  .grip-right {
    right: -5px;
  }
  .grip-left {
    left: -5px;
  }
  .grip::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: transparent;
    transition: background 0.12s;
  }
  .grip-right::after {
    right: 5px;
  }
  .grip-left::after {
    left: 5px;
  }
  .grip:hover::after,
  .grip:focus-visible::after,
  .grip.dragging::after {
    background: var(--select-ring);
  }
  .grip:focus-visible {
    outline: none;
  }
</style>
