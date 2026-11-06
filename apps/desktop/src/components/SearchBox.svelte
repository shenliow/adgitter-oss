<!--
  Top-bar repository search. Filters the loaded commits + refs as you type
  and shows a results dropdown; selecting a result jumps the graph to that
  commit. Keyboard: ↑/↓ move, Enter selects, Esc closes/clears.

  The leading pill opens a scope menu that narrows the search to one field
  (message / author / hash / time / branch / tag), with "this project" — every
  field at once — as the default.
-->
<script lang="ts">
  import type { Commit, RefList } from '../lib/ipc';
  import {
    searchRepo,
    SEARCH_SCOPES,
    type SearchResult,
    type SearchIssue,
    type SearchScope,
  } from '../lib/search';
  import { t } from '../lib/i18n/index.svelte';
  import Icon from '../lib/icons/Icon.svelte';

  let {
    commits = [],
    refs = null,
    issues = [],
    onSelect,
    onSelectIssue,
  }: {
    commits?: Commit[];
    refs?: RefList | null;
    /** Bound-tracker issues for the `assignee` scope; [] when none. */
    issues?: SearchIssue[];
    onSelect: (sha: string) => void;
    /** Open an issue result in the panel. */
    onSelectIssue?: (issueId: string) => void;
  } = $props();

  let query = $state('');
  let open = $state(false);
  let active = $state(0);

  /**
   * The scope lives in component state only — it is not remembered across
   * app restarts, and deliberately so. A scope is part of one question ("who
   * wrote this?"), not a standing preference: a narrow scope silently restored
   * days later turns the next unrelated search into an empty dropdown, which
   * reads as a broken search box rather than as a filter still being applied.
   * Every session therefore starts on "this project".
   */
  let scope = $state<SearchScope>('all');
  let scopeOpen = $state(false);
  /** Roving-focus cursor into SEARCH_SCOPES while the menu is open. */
  let scopeActive = $state(0);
  let scopeWrap: HTMLDivElement | undefined = $state();
  let scopeBtn: HTMLButtonElement | undefined = $state();
  let inputEl: HTMLInputElement | undefined = $state();
  let optionEls: (HTMLButtonElement | undefined)[] = $state([]);

  const results = $derived(searchRepo(query, commits, refs, issues, 20, scope));
  const show = $derived(open && query.trim().length > 0);

  /** Menu label for a scope. `all` reuses the pill's existing wording. */
  function scopeLabel(s: SearchScope): string {
    switch (s) {
      case 'commits':
        return t('search.scope.commits');
      case 'message':
        return t('search.scope.message');
      case 'author':
        return t('search.scope.author');
      case 'hash':
        return t('search.scope.hash');
      case 'time':
        return t('search.scope.time');
      case 'branch':
        return t('search.scope.branch');
      case 'tag':
        return t('search.scope.tag');
      default:
        return t('topbar.searchScope');
    }
  }

  /** Tell the user what the input is searching now that the scope narrowed. */
  function scopePlaceholder(s: SearchScope): string {
    switch (s) {
      case 'commits':
        return t('search.placeholder.commits');
      case 'message':
        return t('search.placeholder.message');
      case 'author':
        return t('search.placeholder.author');
      case 'hash':
        return t('search.placeholder.hash');
      case 'time':
        return t('search.placeholder.time');
      case 'branch':
        return t('search.placeholder.branch');
      case 'tag':
        return t('search.placeholder.tag');
      default:
        return t('search.placeholder');
    }
  }

  const placeholder = $derived(scopePlaceholder(scope));

  function openScopeMenu() {
    const i = SEARCH_SCOPES.indexOf(scope);
    scopeActive = i < 0 ? 0 : i;
    scopeOpen = true;
  }

  function closeScopeMenu(returnFocus = false) {
    scopeOpen = false;
    if (returnFocus) scopeBtn?.focus();
  }

  function pickScope(s: SearchScope) {
    scope = s;
    scopeOpen = false;
    // Hand focus back to the input: picking a scope is the prelude to typing.
    inputEl?.focus();
  }

  /** Keys on the trigger. Enter/Space stay native (they click the button). */
  function onScopeKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!scopeOpen) openScopeMenu();
    } else if (e.key === 'Escape' && scopeOpen) {
      e.preventDefault();
      closeScopeMenu();
    }
  }

  /** Keys inside the menu. Enter/Space are the option buttons' own click. */
  function onScopeMenuKey(e: KeyboardEvent) {
    const n = SEARCH_SCOPES.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      scopeActive = (scopeActive + 1) % n;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      scopeActive = (scopeActive - 1 + n) % n;
    } else if (e.key === 'Home') {
      e.preventDefault();
      scopeActive = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      scopeActive = n - 1;
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeScopeMenu(true);
    } else if (e.key === 'Tab') {
      closeScopeMenu();
    }
  }

  /** Close when focus leaves the pill + menu entirely (click-away included). */
  function onScopeFocusOut(e: FocusEvent) {
    const next = e.relatedTarget as Node | null;
    if (!next || !scopeWrap?.contains(next)) scopeOpen = false;
  }

  // Roving focus: whichever option the cursor is on owns the keyboard. Effects
  // run after the DOM update, so the bindings are in place on the first open.
  $effect(() => {
    if (!scopeOpen) return;
    optionEls[scopeActive]?.focus();
  });

  function choose(r: SearchResult) {
    if (r.kind === 'issue' && r.issueId) onSelectIssue?.(r.issueId);
    else onSelect(r.sha);
    query = '';
    open = false;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      query = '';
      open = false;
      return;
    }
    if (!show || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      active = (active + 1) % results.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active - 1 + results.length) % results.length;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[active];
      if (r) choose(r);
    }
  }

  // Reset the active row whenever the result set changes.
  $effect(() => {
    void results;
    active = 0;
  });
</script>

<div class="search">
  <div
    class="scope-wrap"
    bind:this={scopeWrap}
    onfocusout={onScopeFocusOut}
    role="presentation"
  >
    <button
      class="scope"
      bind:this={scopeBtn}
      title={t('search.scopeLabel')}
      aria-label={t('search.scopeLabel')}
      aria-haspopup="listbox"
      aria-expanded={scopeOpen}
      aria-controls="search-scope-menu"
      onclick={() => (scopeOpen ? closeScopeMenu() : openScopeMenu())}
      onkeydown={onScopeKey}
    >
      <span class="caret"><Icon name="chevronDown" size={12} /></span>
      <span>{scopeLabel(scope)}</span>
    </button>

    {#if scopeOpen}
      <div
        class="scope-menu"
        id="search-scope-menu"
        role="listbox"
        aria-label={t('search.scopeLabel')}
        tabindex="-1"
        onkeydown={onScopeMenuKey}
      >
        {#each SEARCH_SCOPES as s, i (s)}
          <button
            class="scope-option"
            class:selected={s === scope}
            bind:this={optionEls[i]}
            role="option"
            aria-selected={s === scope}
            tabindex={i === scopeActive ? 0 : -1}
            onclick={() => pickScope(s)}
          >
            {scopeLabel(s)}
          </button>
        {/each}
      </div>
    {/if}
  </div>
  <input
    type="text"
    bind:this={inputEl}
    aria-label={placeholder}
    {placeholder}
    bind:value={query}
    onfocus={() => (open = true)}
    oninput={() => (open = true)}
    onkeydown={onKey}
    onblur={() => setTimeout(() => (open = false), 120)}
  />
  <span class="search-icon" aria-hidden="true"
    ><Icon name="search" size={14} /></span
  >

  {#if show}
    <div class="results" role="listbox">
      {#if results.length === 0}
        <div class="empty">{t('search.noResults')}</div>
      {:else}
        {#each results as r, i (r.kind + r.sha + (r.issueId ?? '') + r.label)}
          <button
            class="result"
            class:active={i === active}
            role="option"
            aria-selected={i === active}
            onmousedown={(e) => {
              e.preventDefault();
              choose(r);
            }}
            onmouseenter={() => (active = i)}
          >
            <span class="badge {r.kind}">{r.kind[0].toUpperCase()}</span>
            <span class="label">{r.label}</span>
            <span class="detail">{r.detail}</span>
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .search {
    position: relative;
    flex: 1;
    max-width: 520px;
    display: flex;
    align-items: center;
    background: var(--pill-bg);
    border-radius: 999px;
    height: 28px;
    padding: 0 10px;
  }
  .scope {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    border: 0;
    background: transparent;
    font: inherit;
    font-size: 12px;
    color: var(--fg-soft);
    cursor: pointer;
    white-space: nowrap;
  }
  .caret {
    font-size: 10px;
  }
  .scope-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
  }
  .scope-menu {
    position: absolute;
    top: 26px;
    left: -6px;
    min-width: 150px;
    background: var(--panel-bg);
    color: var(--fg);
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    box-shadow: var(--panel-shadow);
    z-index: 26;
    padding: 4px;
  }
  .scope-option {
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
  }
  .scope-option:hover,
  .scope-option:focus-visible {
    background: var(--row-selected);
  }
  .scope-option.selected {
    font-weight: 600;
  }
  input {
    flex: 1;
    border: 0;
    background: transparent;
    outline: none;
    font: inherit;
    font-size: 12px;
    padding: 0 8px;
    min-width: 0;
  }
  .search-icon {
    color: #999;
  }
  .results {
    position: absolute;
    top: 34px;
    left: 0;
    right: 0;
    max-height: 320px;
    overflow-y: auto;
    background: var(--panel-bg);
    color: var(--fg);
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    box-shadow: var(--panel-shadow);
    z-index: 25;
    padding: 4px;
  }
  .empty {
    padding: 10px;
    font-size: 12px;
    color: var(--fg-muted);
    text-align: center;
  }
  .result {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    border: 0;
    background: transparent;
    text-align: left;
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
  }
  .result.active {
    background: var(--row-selected);
  }
  .badge {
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    border-radius: 4px;
    font-size: 9px;
    font-weight: 700;
    font-family: var(--mono);
    color: #fff;
  }
  .badge.commit {
    background: var(--lane-4);
  }
  .badge.branch {
    background: var(--lane-0);
  }
  .badge.tag {
    background: var(--lane-3);
  }
  .badge.issue {
    background: var(--lane-6);
  }
  .label {
    flex: 1;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .detail {
    flex: 0 0 auto;
    font-size: 11px;
    color: var(--fg-muted);
    font-family: var(--mono);
  }
</style>
