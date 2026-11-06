<!--
  A filter-as-you-type MULTI-select (WAI-ARIA 1.2 *combobox* pattern, the
  `aria-multiselectable="true"` listbox variant).

  Why this is a sibling of `SearchableSelect`, not a `multiple` prop on it
  (issue multi-select epic — Project/Assignee, "provider supports it"):
  `SearchableSelect`'s own module doc already draws this line once for
  SearchBox's scope menu, and the same reasoning applies again here, one
  level up. A single-select combobox CLOSES on pick (the input's text becomes
  the chosen label) and has exactly one derived `selected`; a multi-select
  combobox must stay OPEN across repeated picks, renders a chips row that a
  single value has no room for, the input's text is ALWAYS just the filter
  (never a chosen label — there is no one label to show), and every option's
  `aria-selected` reflects *membership in a set*, not equality with one
  value. That is a different interaction contract end to end, not a cosmetic
  variant — folding it into `SearchableSelect` via a `multiple: boolean` prop
  would give that component the same "two personalities" shape its own doc
  warns against, and would change `value`'s type (`string` → `string[]`) for
  every existing single-select call site (Assignee/Milestone on every
  provider) for a capability only two fields on two providers use.

  What is NOT forked: the filter predicate. Both components import and call
  the same `filterOptions` (exported from `SearchableSelect.svelte`'s module
  script) — "what counts as a match" is not part of the interaction
  difference above, and letting it drift would be the exact kind of bug this
  guidance elsewhere in the codebase warns against.

  Keyboard: ↓/↑ move (opening the list if closed), Home/End jump, Enter
  TOGGLES the highlighted option (add if absent, remove if present) WITHOUT
  closing — a multi-pick UI that closed after one choice would make picking
  three values three separate opens. Esc closes (keeping the current
  selection), Tab closes and moves on. Clicking an option keeps focus in the
  input, same as `SearchableSelect`. A chip's own remove button is a plain
  button — mirrors the Labels field's existing chip/removal UI in
  `IssuePanel.svelte`, which this component's visual precedent is.
-->
<script lang="ts">
  import Icon from '../lib/icons/Icon.svelte';
  import { filterOptions, type SelectOption } from './SearchableSelect.svelte';

  let {
    options = [],
    value = [],
    onChange,
    placeholder = '',
    label = '',
    emptyText = '',
    removeLabel = '',
    id = 'multi-searchable-select',
    testId,
  }: {
    options?: SelectOption[];
    /** The currently selected options' values, in the order chips render. */
    value?: string[];
    /** Fired with the FULL new selection (add, remove, or chip-removal alike). */
    onChange: (value: string[]) => void;
    /** Shown in the filter input when nothing has been typed. */
    placeholder?: string;
    /** Accessible name for the combobox. */
    label?: string;
    /** Shown in place of the list when the filter matches nothing. */
    emptyText?: string;
    /** Accessible name template for a chip's remove button (e.g. "Remove {name}"). */
    removeLabel?: string;
    /** Unique id root — the listbox and option ids are derived from it. */
    id?: string;
    /** `data-testid` on the input, for e2e locators. */
    testId?: string;
  } = $props();

  let open = $state(false);
  let query = $state('');
  let active = $state(0);
  let inputEl: HTMLInputElement | undefined = $state();
  let wrapEl: HTMLDivElement | undefined = $state();
  let optionEls: (HTMLButtonElement | undefined)[] = $state([]);

  const selectedSet = $derived(new Set(value));
  const chips = $derived(
    value.map((v) => ({
      value: v,
      label: options.find((o) => o.value === v)?.label ?? v,
    })),
  );

  const filtered = $derived.by(() => filterOptions(options, query));

  const listId = $derived(`${id}-listbox`);
  const optionId = (i: number) => `${id}-option-${i}`;

  function openList() {
    if (open) return;
    open = true;
    query = '';
    active = 0;
  }

  /** Close, discarding the filter text — the selection is untouched. */
  function closeList() {
    open = false;
    query = '';
  }

  function toggle(option: SelectOption) {
    const next = selectedSet.has(option.value)
      ? value.filter((v) => v !== option.value)
      : [...value, option.value];
    onChange(next);
    // Multi-pick stays open (see the module doc above); the filter text is
    // cleared so the next keystroke starts a fresh search rather than
    // narrowing on what was just picked. Refocus the input — a mousedown
    // pick never moved focus off it (see `onmousedown`'s `preventDefault`
    // below), but a future keyboard-only caller of `toggle` must land back
    // there too.
    query = '';
    active = 0;
    inputEl?.focus();
  }

  function removeChip(v: string) {
    onChange(value.filter((x) => x !== v));
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
        if (option) toggle(option);
        break;
      }
      case 'Backspace':
        // A chip-style convenience: Backspace on an EMPTY filter removes the
        // last-added chip, mirroring how Labels' own input works today.
        if (!query && value.length) {
          e.preventDefault();
          removeChip(value[value.length - 1]);
        }
        break;
      case 'Escape':
        if (!open) return;
        e.preventDefault();
        e.stopPropagation();
        closeList();
        break;
      case 'Tab':
        closeList();
        break;
    }
  }

  function onFocusOut(e: FocusEvent) {
    const next = e.relatedTarget as Node | null;
    if (!next || !wrapEl?.contains(next)) closeList();
  }

  $effect(() => {
    if (!open) return;
    optionEls[active]?.scrollIntoView?.({ block: 'nearest' });
  });
</script>

<div class="mss" bind:this={wrapEl} onfocusout={onFocusOut} role="presentation">
  <div class="mss-chips">
    {#each chips as chip (chip.value)}
      <span class="mss-chip">
        {chip.label}
        <button
          type="button"
          class="mss-chipx"
          title={removeLabel
            ? removeLabel.replace('{name}', chip.label)
            : chip.label}
          onclick={() => removeChip(chip.value)}
          ><Icon name="close" size={10} /></button
        >
      </span>
    {/each}
    <!-- svelte-ignore a11y_role_has_required_aria_props -->
    <input
      bind:this={inputEl}
      type="text"
      role="combobox"
      class="mss-input"
      data-testid={testId}
      aria-label={label}
      aria-expanded={open}
      aria-controls={listId}
      aria-autocomplete="list"
      aria-activedescendant={open && filtered.length
        ? optionId(active)
        : undefined}
      autocomplete="off"
      placeholder={chips.length ? '' : placeholder}
      value={query}
      oninput={onInput}
      onkeydown={onKey}
      onfocus={openList}
      onmousedown={openList}
    />
  </div>

  {#if open}
    <div
      class="mss-list"
      id={listId}
      role="listbox"
      aria-multiselectable="true"
      aria-label={label}
    >
      {#if filtered.length === 0}
        <div class="mss-empty">{emptyText}</div>
      {:else}
        {#each filtered as o, i (o.value)}
          <button
            type="button"
            class="mss-option"
            class:active={i === active}
            class:selected={selectedSet.has(o.value)}
            bind:this={optionEls[i]}
            id={optionId(i)}
            role="option"
            aria-selected={selectedSet.has(o.value)}
            tabindex="-1"
            onmousedown={(e) => {
              e.preventDefault();
              toggle(o);
            }}
            onmouseenter={() => (active = i)}
          >
            <span class="mss-check" aria-hidden="true"
              >{selectedSet.has(o.value) ? '✓' : ''}</span
            >
            {o.label}
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .mss {
    position: relative;
    display: flex;
    flex-direction: column;
  }
  .mss-chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    min-height: 30px;
    border: 1px solid var(--panel-border);
    border-radius: 7px;
    padding: 3px 6px;
    background: var(--panel-bg);
    box-sizing: border-box;
  }
  .mss-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--row-selected);
    border-radius: 999px;
    padding: 2px 6px 2px 8px;
    font-size: 12px;
    white-space: nowrap;
  }
  .mss-chipx {
    display: inline-flex;
    align-items: center;
    border: 0;
    background: transparent;
    cursor: pointer;
    color: inherit;
    padding: 2px;
  }
  .mss-input {
    flex: 1;
    min-width: 60px;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--fg);
    font-size: 13px;
  }
  .mss-list {
    position: absolute;
    top: 100%;
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
    margin-top: 2px;
  }
  .mss-empty {
    padding: 10px;
    font-size: 12px;
    color: var(--fg-muted);
    text-align: center;
  }
  .mss-option {
    display: flex;
    align-items: center;
    gap: 6px;
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
  .mss-check {
    display: inline-block;
    width: 12px;
    flex: none;
  }
  .mss-option.active {
    background: var(--row-selected);
  }
  .mss-option.selected {
    font-weight: 600;
  }
</style>
