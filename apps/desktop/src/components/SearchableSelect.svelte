<!--
  A filter-as-you-type single-select (WAI-ARIA 1.2 *combobox* pattern).

  Why this is a second dropdown and not a reuse of SearchBox's scope menu:
  the two are different ARIA patterns, not two skins of one widget. The scope
  menu is a `button` + `listbox` popup over a fixed 8-item enum, and it moves
  DOM focus onto each option (roving focus) — correct there, because there is
  nothing to type into. A filterable picker must keep focus in a text input
  while the highlight moves, which is `aria-activedescendant` and a `combobox`
  role: different trigger element, different focus model, different keyboard
  contract. Folding both into one component means a `searchable` flag that
  swaps the root element and the ARIA roles — a component with two
  personalities, and a refactor that puts SearchBox's existing behaviour and
  tests at risk for no gain.

  What this file *does* avoid is a third **bespoke inline** dropdown: it is a
  shared component, so the next filterable picker reuses it rather than
  hand-rolling one in a panel.

  Keyboard: ↓/↑ move (opening the list if closed), Home/End jump, Enter picks
  the highlighted option, Esc closes (keeping the current selection), Tab
  closes and moves on. Clicking an option keeps focus in the input.
-->
<script lang="ts" module>
  /** One pickable row. `value` is what `onSelect` reports; `label` is both
   *  what is shown and what the filter matches against. */
  export interface SelectOption {
    value: string;
    label: string;
  }

  /**
   * Case-insensitive substring match on the label — a project/assignee
   * picker's users think in names, not ids, and a prefix-only match would
   * hide "Acme / Website" when they type "website".
   *
   * Exported so {@link ../components/MultiSearchableSelect.svelte
   * MultiSearchableSelect} (issue multi-select epic) shares this exact
   * predicate rather than forking its own copy — the two components differ
   * in selection/close/ARIA-role model (see the module doc above for why
   * that split is real), but "what counts as a match" is not part of that
   * difference and must not drift between them.
   */
  export function filterOptions(
    options: readonly SelectOption[],
    query: string,
  ): SelectOption[] {
    const q = query.trim().toLowerCase();
    if (!q) return [...options];
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }
</script>

<script lang="ts">
  let {
    options = [],
    value = '',
    onSelect,
    placeholder = '',
    label = '',
    emptyText = '',
    id = 'searchable-select',
    testId,
  }: {
    options?: SelectOption[];
    /** The currently selected option's value, or '' for none. */
    value?: string;
    onSelect: (value: string) => void;
    /** Shown when nothing is selected and the field is empty. */
    placeholder?: string;
    /** Accessible name for the combobox. */
    label?: string;
    /** Shown in place of the list when the filter matches nothing. */
    emptyText?: string;
    /** Unique id root — the listbox and option ids are derived from it. */
    id?: string;
    /** `data-testid` on the input, for e2e locators (e.g. the Issue panel's
     *  assignee/milestone pickers, which reuse the same test ids their plain
     *  `<input>` fallback used). */
    testId?: string;
  } = $props();

  let open = $state(false);
  let query = $state('');
  /** Index into `filtered` of the highlighted option (aria-activedescendant). */
  let active = $state(0);
  let inputEl: HTMLInputElement | undefined = $state();
  let wrapEl: HTMLDivElement | undefined = $state();
  let optionEls: (HTMLButtonElement | undefined)[] = $state([]);

  const selected = $derived(options.find((o) => o.value === value) ?? null);

  const filtered = $derived.by(() => filterOptions(options, query));

  const listId = $derived(`${id}-listbox`);
  const optionId = (i: number) => `${id}-option-${i}`;

  /**
   * The input's text. While the list is open it is the filter the user is
   * typing; while closed it is the chosen option's label. Controlled rather
   * than `bind:value` so closing always snaps back to the real selection and
   * a half-typed filter can never be mistaken for one.
   */
  const display = $derived(open ? query : (selected?.label ?? ''));

  function openList() {
    if (open) return;
    open = true;
    query = '';
    const i = filtered.findIndex((o) => o.value === value);
    active = i < 0 ? 0 : i;
  }

  /** Close, discarding the filter text. The selection is untouched — Esc
   *  means "stop filtering", never "unset what I picked". */
  function closeList() {
    open = false;
    query = '';
  }

  function pick(option: SelectOption) {
    onSelect(option.value);
    closeList();
    inputEl?.focus();
  }

  function onInput(e: Event & { currentTarget: HTMLInputElement }) {
    query = e.currentTarget.value;
    open = true;
    active = 0;
  }

  function onKey(e: KeyboardEvent) {
    const n = filtered.length;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) return openList();
        if (n) active = (active + 1) % n;
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!open) return openList();
        if (n) active = (active - 1 + n) % n;
        break;
      case 'Home':
        if (!open) return;
        e.preventDefault();
        active = 0;
        break;
      case 'End':
        if (!open) return;
        e.preventDefault();
        active = n ? n - 1 : 0;
        break;
      case 'Enter': {
        if (!open) return;
        e.preventDefault();
        const option = filtered[active];
        if (option) pick(option);
        break;
      }
      case 'Escape':
        if (!open) return;
        // Stop the key here: an open picker inside a modal must swallow Esc,
        // or one keypress closes the whole Settings dialog as well.
        e.preventDefault();
        e.stopPropagation();
        closeList();
        break;
      case 'Tab':
        closeList();
        break;
    }
  }

  /** Close when focus leaves the input *and* the list (click-away included). */
  function onFocusOut(e: FocusEvent) {
    const next = e.relatedTarget as Node | null;
    if (!next || !wrapEl?.contains(next)) closeList();
  }

  // Keep the highlighted option in view while arrowing through a long list —
  // a picker built for "hundreds of projects" is useless if the highlight
  // walks off-screen. Focus itself stays in the input (that is the point of
  // aria-activedescendant), so this only scrolls.
  // Optional-called: scrollIntoView is absent in jsdom, and a missing scroll
  // must not take the picker's keyboard handling down with it.
  $effect(() => {
    if (!open) return;
    optionEls[active]?.scrollIntoView?.({ block: 'nearest' });
  });
</script>

<div class="ss" bind:this={wrapEl} onfocusout={onFocusOut} role="presentation">
  <!-- svelte-ignore a11y_role_has_required_aria_props -->
  <input
    bind:this={inputEl}
    type="text"
    role="combobox"
    class="ss-input"
    data-testid={testId}
    aria-label={label}
    aria-expanded={open}
    aria-controls={listId}
    aria-autocomplete="list"
    aria-activedescendant={open && filtered.length
      ? optionId(active)
      : undefined}
    autocomplete="off"
    placeholder={selected && !open ? selected.label : placeholder}
    value={display}
    oninput={onInput}
    onkeydown={onKey}
    onmousedown={openList}
  />

  {#if open}
    <div class="ss-list" id={listId} role="listbox" aria-label={label}>
      {#if filtered.length === 0}
        <div class="ss-empty">{emptyText}</div>
      {:else}
        {#each filtered as o, i (o.value)}
          <button
            type="button"
            class="ss-option"
            class:active={i === active}
            class:selected={o.value === value}
            bind:this={optionEls[i]}
            id={optionId(i)}
            role="option"
            aria-selected={o.value === value}
            tabindex="-1"
            onmousedown={(e) => {
              // Keep focus in the input: a click that blurs it would fire
              // onFocusOut and close the list before the pick lands.
              e.preventDefault();
              pick(o);
            }}
            onmouseenter={() => (active = i)}
          >
            {o.label}
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .ss {
    position: relative;
    display: flex;
    flex-direction: column;
  }
  .ss-input {
    height: 30px;
    border: 1px solid var(--panel-border);
    border-radius: 7px;
    padding: 0 10px;
    font-size: 13px;
    background: var(--panel-bg);
    color: var(--fg);
    width: 100%;
    box-sizing: border-box;
  }
  .ss-list {
    position: absolute;
    top: 34px;
    left: 0;
    right: 0;
    max-height: 240px;
    overflow-y: auto;
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    box-shadow: var(--panel-shadow);
    z-index: 30;
    padding: 4px;
  }
  .ss-empty {
    padding: 10px;
    font-size: 12px;
    color: var(--fg-muted);
    text-align: center;
  }
  .ss-option {
    display: block;
    width: 100%;
    border: 0;
    background: transparent;
    text-align: left;
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    color: inherit;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ss-option.active {
    background: var(--row-selected);
  }
  .ss-option.selected {
    font-weight: 600;
  }
</style>
