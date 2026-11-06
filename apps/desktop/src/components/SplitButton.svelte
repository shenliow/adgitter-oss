<!--
  Reusable split / menu button. A primary label + caret; clicking opens
  a small menu of options, each dispatching its own handler. Used for the
  lifecycle action bar's `Start ▾` and `Done ▾` menus. Closes on select, Escape,
  or an outside click.

  When `onClick` is supplied the trigger becomes a TRUE split button (E2
  gesture-ops force-push toolbar): the label segment is its own button that
  fires `onClick` as the default action, and a separate caret segment opens
  the menu. `onClick` is optional and defaults to absent, so every existing
  caller (the lifecycle bar's `Start ▾`/`Done ▾`) keeps today's behaviour
  byte-for-byte — the whole trigger just opens the menu.
-->
<script lang="ts">
  import { placeMenu } from '../lib/menuPlacement';
  import Icon from '../lib/icons/Icon.svelte';
  import Spinner from './Spinner.svelte';
  import type { IconName } from '../lib/icons/windows';

  interface Option {
    label: string;
    onSelect: () => void;
    danger?: boolean;
    /** Guided-tutorial target id (`data-tutorial`) for this menu item. */
    tutorialId?: string;
  }

  let {
    label,
    icon,
    options,
    disabled = false,
    busy = false,
    primary = false,
    onClick,
    badge,
    title,
    menuLabel = 'More options',
    tutorialId,
    menuTutorialId,
    canOpen,
  }: {
    label: string;
    /** When set, the label segment shows this icon instead of the text label. */
    icon?: IconName;
    options: Option[];
    disabled?: boolean;
    /**
     * This button's own action is in flight: the label segment shows a
     * {@link Spinner} in place of its icon/label and reports `aria-busy`.
     * Purely presentational — callers still pass `disabled` themselves, since
     * "busy" and "not clickable" are not always the same thing.
     */
    busy?: boolean;
    /** Render the trigger as the accent/primary action. */
    primary?: boolean;
    /**
     * True split-button mode: the label segment fires this as its own default
     * action and a separate caret segment opens the menu. Omit for today's
     * whole-trigger-opens-the-menu behaviour (e.g. the lifecycle bar).
     */
    onClick?: () => void;
    /** Optional small count badge rendered after the label (e.g. an ahead-count). */
    badge?: number | string;
    /** Native tooltip for the label segment (or the whole trigger when `onClick` is absent). */
    title?: string;
    /** Accessible name for the caret-only segment when `onClick` is set. */
    menuLabel?: string;
    /** Guided-tutorial target id (`data-tutorial`) for the label segment (or
     *  the whole trigger when `onClick` is absent). */
    tutorialId?: string;
    /** Guided-tutorial target id for the caret segment (split mode only). */
    menuTutorialId?: string;
    /** Asked before the menu opens; `false` keeps it shut (guided tutorial).
     *  Absent ⇒ the menu always opens. */
    canOpen?: () => boolean;
  } = $props();

  const hasBadge = $derived(
    badge !== undefined && badge !== null && badge !== '',
  );

  let open = $state(false);
  let root = $state<HTMLDivElement | null>(null);
  let menuEl = $state<HTMLDivElement | null>(null);
  // Viewport-clamped position for the `.menu` dropdown, recomputed each time
  // it opens (see the placement $effect below). Defaults to the anchor's
  // below-left corner so there's no visible jump when it already fits.
  let pos = $state({ x: 0, y: 0, minWidth: 0 });

  function toggle() {
    if (disabled) return;
    if (!open && canOpen && !canOpen()) return;
    open = !open;
  }

  function choose(opt: Option) {
    open = false;
    opt.onSelect();
  }

  function clickPrimary() {
    if (disabled) return;
    onClick?.();
  }

  // Close on an outside pointerdown, Escape, or a resize/scroll while the
  // menu is open. Repositioning on resize/scroll would need continuous
  // re-measurement of both the anchor and menu; closing is the simpler,
  // still-correct choice and matches how the outside-click handling already
  // treats "the world moved" as "dismiss".
  $effect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (root && !root.contains(e.target as Node)) open = false;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') open = false;
    }
    function onDismiss() {
      open = false;
    }
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onDismiss);
    window.addEventListener('scroll', onDismiss, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onDismiss);
      window.removeEventListener('scroll', onDismiss, true);
    };
  });

  // Clamp the dropdown to the viewport once it's mounted and measurable.
  // Runs after the `.menu` div exists in the DOM (Svelte flushes the `{#if
  // open}` block before this effect re-runs), so `menuEl`'s rect is already
  // accurate.
  $effect(() => {
    if (!open || !root || !menuEl) return;
    const anchor = root.getBoundingClientRect();
    const size = menuEl.getBoundingClientRect();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const { x, y } = placeMenu(
      anchor,
      { width: size.width, height: size.height },
      viewport,
      { gap: 4 },
    );
    pos = { x, y, minWidth: anchor.width };
  });
</script>

<div class="split" bind:this={root}>
  {#if onClick}
    <button
      class="trigger label-segment"
      class:primary
      data-tutorial={tutorialId}
      {disabled}
      {title}
      aria-busy={busy || undefined}
      onclick={clickPrimary}
    >
      {#if busy}<Spinner />{:else if icon}<Icon
          name={icon}
          size={16}
        />{:else}{label}{/if}{#if hasBadge}<span class="badge">{badge}</span
        >{/if}
    </button>
    <button
      class="trigger caret-segment"
      class:primary
      data-tutorial={menuTutorialId}
      {disabled}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={menuLabel}
      onclick={toggle}
    >
      <span class="caret" aria-hidden="true"
        ><Icon name="chevronDown" size={10} /></span
      >
    </button>
  {:else}
    <button
      class="trigger"
      class:primary
      data-tutorial={tutorialId}
      {disabled}
      {title}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-busy={busy || undefined}
      onclick={toggle}
    >
      {#if busy}<Spinner />{:else if icon}<Icon
          name={icon}
          size={16}
        />{:else}{label}{/if}{#if hasBadge}<span class="badge">{badge}</span
        >{/if}<span class="caret" aria-hidden="true"
        ><Icon name="chevronDown" size={10} /></span
      >
    </button>
  {/if}
  {#if open}
    <div
      class="menu"
      role="menu"
      bind:this={menuEl}
      style="left:{pos.x}px; top:{pos.y}px; min-width:{pos.minWidth}px"
    >
      {#each options as opt (opt.label)}
        <button
          class="item"
          class:danger={opt.danger}
          data-tutorial={opt.tutorialId}
          role="menuitem"
          onclick={() => choose(opt)}
        >
          {opt.label}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .split {
    position: relative;
    display: inline-flex;
  }
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 12px;
    border: 1px solid var(--panel-border);
    border-radius: 7px;
    background: var(--panel-bg);
    color: var(--fg-soft);
    font-size: 13px;
    cursor: pointer;
  }
  .trigger.primary {
    border-color: transparent;
    background: var(--select-ring);
    color: #fff;
  }
  .trigger:disabled {
    opacity: 0.5;
    cursor: default;
  }
  /* True split mode (onClick set): two adjoined segments sharing one pill. */
  .trigger.label-segment {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
    border-right: 0;
  }
  .trigger.caret-segment {
    padding: 0 8px;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
  .trigger.primary.label-segment {
    border-right: 1px solid rgba(255, 255, 255, 0.35);
  }
  .caret {
    font-size: 10px;
    opacity: 0.8;
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
  .trigger.primary .badge {
    background: rgba(255, 255, 255, 0.35);
  }
  .menu {
    /* left/top/min-width are set inline (viewport-clamped, see
       menuPlacement.ts) so the dropdown never runs off screen. */
    position: fixed;
    white-space: nowrap;
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    box-shadow: var(--panel-shadow);
    padding: 4px;
    z-index: 20;
    display: flex;
    flex-direction: column;
  }
  .item {
    text-align: left;
    border: 0;
    background: transparent;
    color: var(--fg-soft);
    font-size: 13px;
    padding: 7px 10px;
    border-radius: 6px;
    cursor: pointer;
  }
  .item:hover {
    background: var(--row-hover);
  }
  .item.danger {
    color: var(--lane-7);
  }
</style>
