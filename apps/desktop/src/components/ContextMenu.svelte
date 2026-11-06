<!--
  Generic right-click context menu. Positioned at (x, y); closes
  on Escape, click-away, or after an item fires. `items` is a flat list; use a
  label of '---' for a separator.

  An item with `children` renders as a submenu parent: a "▸" indicator, and
  hovering/focusing/clicking it opens a flyout listing its children to the
  right of the item. Only one submenu is open at a time; hovering/focusing a
  sibling item closes it. A disabled parent never opens. Parents ignore their
  own onSelect — selecting a child fires that child's onSelect and closes the
  whole menu, same as a top-level item.
-->
<script lang="ts">
  import { placeMenu, placeSubmenu } from '../lib/menuPlacement';
  import { t } from '../lib/i18n/index.svelte';
  import Icon from '../lib/icons/Icon.svelte';

  export interface MenuItem {
    label: string;
    danger?: boolean;
    disabled?: boolean;
    onSelect?: () => void;
    children?: MenuItem[];
  }

  let {
    x,
    y,
    items,
    onClose,
  }: {
    x: number;
    y: number;
    items: MenuItem[];
    onClose: () => void;
  } = $props();

  // Index of the top-level item whose submenu is currently open, if any.
  let openSubmenu = $state<number | null>(null);

  let menuEl = $state<HTMLUListElement | null>(null);
  // Viewport-clamped position for the top-level menu. The placement $effect
  // below runs on mount (before the browser paints) and corrects this to the
  // caller-supplied point, or a clamped one if that would overflow — so this
  // initial value is never actually visible.
  let pos = $state({ x: 0, y: 0 });

  let itemEls = $state<(HTMLLIElement | null)[]>([]);
  let submenuEl = $state<HTMLUListElement | null>(null);
  let submenuPos = $state({ x: 0, y: 0 });

  function choose(it: MenuItem) {
    if (it.disabled) return;
    onClose();
    it.onSelect?.();
  }

  /** Top-level click: a parent toggles its submenu instead of firing onSelect. */
  function clickItem(i: number, it: MenuItem) {
    if (it.children?.length) {
      if (it.disabled) return;
      openSubmenu = openSubmenu === i ? null : i;
    } else {
      choose(it);
    }
  }

  /** Hover/focus into a top-level item: open its submenu (if it has one and
   *  isn't disabled), or close whichever submenu was open otherwise — this is
   *  what makes moving to a childless sibling close a previously-open flyout. */
  function enterItem(i: number, it: MenuItem) {
    openSubmenu = it.children?.length && !it.disabled ? i : null;
  }

  // Clamp the top-level menu to the viewport once it's mounted and
  // measurable. `x`/`y` are the caller's requested anchor point (e.g. the
  // right-click coordinates); this only nudges the menu when it would
  // otherwise run off screen.
  $effect(() => {
    if (!menuEl) return;
    const rect = menuEl.getBoundingClientRect();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    pos = placeMenu(
      { x, y, width: 0, height: 0 },
      { width: rect.width, height: rect.height },
      viewport,
    );
  });

  // Clamp the submenu flyout to the viewport, relative to whichever
  // top-level item currently has it open.
  $effect(() => {
    if (openSubmenu === null) return;
    const parentEl = itemEls[openSubmenu];
    if (!parentEl || !submenuEl) return;
    const parentRect = parentEl.getBoundingClientRect();
    const subRect = submenuEl.getBoundingClientRect();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    submenuPos = placeSubmenu(
      parentRect,
      { width: subRect.width, height: subRect.height },
      viewport,
      { gap: 4 },
    );
  });

  // Close on resize/scroll while the menu is open. Repositioning would need
  // continuous re-measurement of the menu (and any open submenu); closing is
  // the simpler, still-correct choice — consistent with the backdrop click
  // already treating "interaction elsewhere" as dismissal.
  $effect(() => {
    function onDismiss() {
      onClose();
    }
    window.addEventListener('resize', onDismiss);
    window.addEventListener('scroll', onDismiss, true);
    return () => {
      window.removeEventListener('resize', onDismiss);
      window.removeEventListener('scroll', onDismiss, true);
    };
  });
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape') onClose();
  }}
/>

<button
  class="backdrop"
  aria-label={t('menu.dismiss')}
  onclick={onClose}
  oncontextmenu={(e) => {
    e.preventDefault();
    onClose();
  }}
></button>

<ul
  class="menu"
  bind:this={menuEl}
  style="left:{pos.x}px; top:{pos.y}px"
  role="menu"
>
  {#each items as it, i (i)}
    {#if it.label === '---'}
      <li class="sep" role="separator"></li>
    {:else}
      <li class="item" role="none" bind:this={itemEls[i]}>
        <button
          role="menuitem"
          class:danger={it.danger}
          disabled={it.disabled}
          aria-haspopup={it.children?.length ? 'menu' : undefined}
          aria-expanded={it.children?.length ? openSubmenu === i : undefined}
          onclick={() => clickItem(i, it)}
          onmouseenter={() => enterItem(i, it)}
          onfocus={() => enterItem(i, it)}
        >
          <span>{it.label}</span>
          {#if it.children?.length}
            <span class="submenu-indicator" aria-hidden="true"
              ><Icon name="caretRight" size={10} /></span
            >
          {/if}
        </button>
        {#if it.children?.length && openSubmenu === i}
          <ul
            class="menu submenu"
            bind:this={submenuEl}
            style="left:{submenuPos.x}px; top:{submenuPos.y}px"
            role="menu"
          >
            {#each it.children as child, ci (ci)}
              {#if child.label === '---'}
                <li class="sep" role="separator"></li>
              {:else}
                <li role="none">
                  <button
                    role="menuitem"
                    class:danger={child.danger}
                    disabled={child.disabled}
                    onclick={() => choose(child)}
                  >
                    {child.label}
                  </button>
                </li>
              {/if}
            {/each}
          </ul>
        {/if}
      </li>
    {/if}
  {/each}
</ul>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 30;
    background: transparent;
    border: 0;
    padding: 0;
    cursor: default;
  }
  .menu {
    position: fixed;
    z-index: 31;
    margin: 0;
    padding: 4px;
    min-width: 184px;
    list-style: none;
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    box-shadow: var(--panel-shadow);
    font-size: 13px;
  }
  .item {
    position: relative;
  }
  .menu button[role='menuitem'] {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    text-align: left;
    padding: 6px 10px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--fg);
    cursor: pointer;
    font: inherit;
  }
  .menu button[role='menuitem']:hover:not(:disabled) {
    background: var(--row-hover);
  }
  .menu button.danger {
    color: #b91c1c;
  }
  .menu button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .submenu-indicator {
    opacity: 0.6;
  }
  .sep {
    height: 1px;
    margin: 4px 2px;
    background: var(--panel-border);
  }
  /* Flyout: opens to the right of the parent item, top-aligned with it,
     flipping to the left / shifting up when that would run off screen
     (left/top are computed by menuPlacement.ts and set inline above). A
     long branch list must not run off screen either — cap the height and
     scroll inside. */
  .submenu {
    max-height: min(320px, 60vh);
    overflow-y: auto;
  }
</style>
