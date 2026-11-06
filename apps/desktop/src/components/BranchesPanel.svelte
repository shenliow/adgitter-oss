<!--
  Left slide-over: Branches & Tags (mockup: branches panel). Local branches are
  editable: click to check out; row actions delete/tag/edit/fork/go-to-
  issue (see below). Remote branches stay read-only (remote management needs E1
  auth). Tags are created (at HEAD) or deleted.

  Row actions (left→right): Delete (existing, unchanged) · Add tag here (new
  tag at this branch's tip) · Edit (opens the shared BranchEditDialog — name +
  color, same dialog the graph's branch chips use) · Fork here (inline
  create-branch input, see below) · Go to linked issue (only when the issue
  tracker links the branch to an issue).

  "Fork here" is an inline input rendered as a sibling row directly below the
  forked-from branch — not a dialog, not the panel's old always-visible
  "New Branch" box (removed: this per-row fork is its replacement). At most one
  such inline input (fork or add-tag) is open at a time within its own kind.
-->
<script lang="ts">
  import {
    checkout,
    createBranch,
    renameBranch,
    deleteBranch,
    createTag,
    deleteTag,
    errorText,
    type RefList,
  } from '../lib/ipc';
  import type { TutorialAction, TutorialEvent } from '../lib/tutorial/types';
  import { LANE_HEX } from '../lib/lanes';
  import { t } from '../lib/i18n/index.svelte';
  import Icon from '../lib/icons/Icon.svelte';
  import BranchEditDialog from './BranchEditDialog.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import ResizeHandle from './ResizeHandle.svelte';
  import { loadPanelWidth, savePanelWidth } from '../lib/panelWidth';

  // Drag-to-resize width; persisted so it survives toggling the panel.
  let width = $state(loadPanelWidth('branches', 320));

  /** Mirrors `ContextMenu`'s exported `MenuItem` shape (kept local, same
   *  convention App.svelte uses, rather than importing a type out of a
   *  `.svelte` file). */
  interface MenuItem {
    label: string;
    danger?: boolean;
    disabled?: boolean;
    onSelect?: () => void;
    children?: MenuItem[];
  }

  let {
    refs = null,
    colorBySha = new Map(),
    repoPath = null,
    branchColors = {},
    linkedIssue = () => null,
    selectedBranch = null,
    onClose = () => {},
    onMutated = () => {},
    onBranchCreated = () => {},
    onSetBranchColor = () => {},
    onResetBranchColor = () => {},
    onGoToIssue = () => {},
    onCheckoutRemote = () => {},
    onBranchSelect = () => {},
    closing = false,
    guard,
    onTutorialEvent,
  }: {
    refs?: RefList | null;
    colorBySha?: Map<string, number>;
    repoPath?: string | null;
    /** branch name → hex lane-color override, seeds the Edit dialog. */
    branchColors?: Record<string, string>;
    /** The issue a branch is linked to, if any (the issue tracker decides). */
    linkedIssue?: (branch: string) => number | null;
    /** Name of the branch currently selected (highlighted) in the graph, if
     *  any — mirrors the graph chip's `.label-selected` treatment on the
     *  matching local row. */
    selectedBranch?: string | null;
    onClose?: () => void;
    /** Called after a mutating ref op so the parent can refresh. */
    onMutated?: () => void;
    /** Called with the new branch name after a successful create. */
    onBranchCreated?: (name: string) => void;
    /** Apply a per-branch color override (Edit dialog Confirm). */
    onSetBranchColor?: (name: string, hex: string) => void;
    /** Clear a per-branch color override (Edit dialog Reset). */
    onResetBranchColor?: (name: string) => void;
    /** Open + select the linked issue by number (Go-to-issue row action). */
    onGoToIssue?: (issueNumber: number) => void;
    /** Double-click / context-menu "Checkout…" on a remote row → request the
     *  checkout-remote confirm dialog (single click on a remote row stays a
     *  no-op — remote checkout always goes through that dialog). */
    onCheckoutRemote?: (name: string) => void;
    /** Single-click a local branch row → select + highlight it (same as the
     *  graph's branch-chip single click), without checking it out. */
    onBranchSelect?: (b: { name: string; current: boolean }) => void;
    /** True while the parent is holding this panel mounted purely so its
     *  slide-out can play (lib/panelSlide.svelte.ts). Drives `data-slide`. */
    closing?: boolean;
    /** Guided tutorial: asked BEFORE every ref mutation (`checkout`, or
     *  `other:branches:<op>`) and before the edit dialog / remote menu open.
     *  `false` means "swallow it". Absent ⇒ always allowed. */
    guard?: (a: TutorialAction) => boolean;
    /** Guided tutorial: reports `checkedOut` after a row checkout succeeded. */
    onTutorialEvent?: (e: TutorialEvent) => void;
  } = $props();

  /** Tutorial gate: with no `guard` prop everything is allowed. */
  function allowed(a: TutorialAction): boolean {
    return guard ? guard(a) : true;
  }
  const branchesOp = (op: string): TutorialAction => ({
    kind: 'other',
    name: `branches:${op}`,
  });

  /** Right-click context menu open on a remote row, if any. */
  let remoteMenu = $state<{ name: string; x: number; y: number } | null>(null);

  let filter = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let newTag = $state('');

  /** Row "Edit" action: the branch currently open in the shared dialog. */
  let dialogBranch = $state<string | null>(null);

  /** Row "Fork here" action (B): at most one inline create-branch input open. */
  let forkFrom = $state<string | null>(null);
  let forkName = $state('');

  /** Row "Add tag here" action: at most one inline create-tag input open. */
  let tagFrom = $state<string | null>(null);
  let tagRowName = $state('');

  function color(sha: string): string {
    return `var(--lane-${(colorBySha.get(sha) ?? 0) % 8})`;
  }
  /** Default lane hex for a commit (seeds the Edit dialog with no override). */
  function defaultHex(target: string): string {
    const ci = colorBySha.get(target) ?? 0;
    return LANE_HEX[ci % LANE_HEX.length];
  }
  const q = $derived(filter.trim().toLowerCase());
  const localBranches = $derived(
    (refs?.branches ?? []).filter((b) => b.name.toLowerCase().includes(q)),
  );
  const remotes = $derived(
    (refs?.remotes ?? []).filter((b) => b.name.toLowerCase().includes(q)),
  );
  const tags = $derived(
    (refs?.tags ?? []).filter((tag) => tag.name.toLowerCase().includes(q)),
  );

  // Collapsible sections, like the Changes panel: a set of collapsed section
  // ids ('branches' / 'tags'); both start expanded.
  let collapsed = $state<Set<string>>(new Set());
  const branchesCollapsed = $derived(collapsed.has('branches'));
  const tagsCollapsed = $derived(collapsed.has('tags'));
  function toggleSection(id: string) {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsed = next;
  }

  async function run(fn: () => Promise<void>, action: TutorialAction) {
    if (!repoPath || busy) return;
    if (!allowed(action)) return;
    busy = true;
    error = null;
    try {
      await fn();
      onMutated();
    } catch (e) {
      error = errorText(e);
    } finally {
      busy = false;
    }
  }

  function doCheckout(name: string) {
    if (name === refs?.head.branch) return;
    void run(
      async () => {
        await checkout(repoPath!, name);
        onTutorialEvent?.({ kind: 'checkedOut', target: name });
      },
      { kind: 'checkout', target: name },
    );
  }
  function doDelete(name: string) {
    void run(() => deleteBranch(repoPath!, name), branchesOp('delete'));
  }

  // --- Edit (name + color, shared with the graph's branch chips) -----------
  function openEdit(name: string) {
    if (!allowed(branchesOp('edit'))) return;
    dialogBranch = name;
  }
  function dialogInitialHex(name: string): string {
    const target = localBranches.find((b) => b.name === name)?.target;
    return branchColors[name] ?? (target ? defaultHex(target) : '#3a86ff');
  }
  function confirmEdit(name: string, hex: string) {
    const from = dialogBranch;
    dialogBranch = null;
    if (!from) return;
    onSetBranchColor(name || from, hex);
    if (name && name !== from)
      void run(() => renameBranch(repoPath!, from, name), branchesOp('rename'));
  }
  function resetEdit() {
    if (dialogBranch) onResetBranchColor(dialogBranch);
    dialogBranch = null;
  }

  // --- Add tag here ----------------------------------------------------------
  function toggleTag(name: string) {
    tagFrom = tagFrom === name ? null : name;
    tagRowName = '';
  }
  function cancelTag() {
    tagFrom = null;
    tagRowName = '';
  }
  function commitTag(target: string) {
    const from = tagFrom;
    const name = tagRowName.trim();
    if (!from || !name) return;
    void run(async () => {
      await createTag(repoPath!, name, target);
      tagFrom = null;
      tagRowName = '';
    }, branchesOp('tag'));
  }

  // --- Fork here (inline create-branch, section B) --------------------------
  function toggleFork(name: string) {
    forkFrom = forkFrom === name ? null : name;
    forkName = '';
  }
  function cancelFork() {
    forkFrom = null;
    forkName = '';
  }
  function commitFork(target: string) {
    const from = forkFrom;
    const name = forkName.trim();
    if (!from || !name) return;
    void run(async () => {
      await createBranch(repoPath!, name, target);
      onBranchCreated(name); // emit only after a successful create
      forkFrom = null;
      forkName = '';
    }, branchesOp('fork'));
  }

  function addTag() {
    const name = newTag.trim();
    if (!name) return;
    newTag = '';
    void run(() => createTag(repoPath!, name, 'HEAD'), branchesOp('tag'));
  }

  // --- Remote row: double-click / right-click "Checkout…" -------------------
  // Single click on a remote row stays a no-op — remote checkout always
  // routes through the App-level confirm dialog (never a direct checkout).
  function openRemoteMenu(name: string, x: number, y: number) {
    if (!allowed({ kind: 'other', name: 'contextmenu' })) return;
    remoteMenu = { name, x, y };
  }
  function remoteMenuItems(name: string): MenuItem[] {
    return [
      {
        label: t('menu.checkoutRemote'),
        onSelect: () => onCheckoutRemote(name),
      },
    ];
  }
</script>

<aside
  class="panel"
  data-panel="branches"
  data-slide={closing ? 'out' : 'in'}
  style="width:{width}px"
>
  <ResizeHandle
    side="right"
    bind:width
    label={t('panel.resize')}
    onCommit={(w) => savePanelWidth('branches', w)}
  />
  <div class="filter">
    <input placeholder={t('branchesPanel.filter')} bind:value={filter} />
    <span class="ico" aria-hidden="true"><Icon name="search" size={14} /></span>
    <button class="close" title={t('common.close')} onclick={onClose}
      ><Icon name="close" size={14} /></button
    >
  </div>

  {#if error}<div class="err" role="alert">{error}</div>{/if}

  <div class="scroll">
    <section>
      <h3>
        <button
          class="hdr-toggle"
          aria-expanded={!branchesCollapsed}
          onclick={() => toggleSection('branches')}
        >
          <span class="chev" aria-hidden="true"
            >{branchesCollapsed ? '▸' : '▾'}</span
          >
          {t('branchesPanel.branchesHeading')}
        </button>
        <span class="count">{localBranches.length + remotes.length}</span>
      </h3>
      {#if !branchesCollapsed}
        {#each localBranches as b (b.name)}
          {@const current = b.name === refs?.head.branch}
          {@const issueNumber = linkedIssue(b.name)}
          <div
            class="row"
            class:current
            class:selected={selectedBranch === b.name}
          >
            <span class="swatch" style="background:{color(b.target)}"></span>
            <button
              class="name name-btn"
              title={t('branchesPanel.localHint', { name: b.name })}
              onclick={() => onBranchSelect({ name: b.name, current })}
              ondblclick={() => doCheckout(b.name)}
            >
              {b.name}{#if current}<span class="star">✶</span
                >{/if}{#if b.has_upstream === false}<span
                  class="cloud-off"
                  role="img"
                  title={t('branchesPanel.noUpstream')}
                  aria-label={t('branchesPanel.noUpstream')}
                  ><Icon name="cloudOff" size={13} /></span
                >{/if}
            </button>
            <span class="acts">
              <button
                title={current
                  ? t('branchesPanel.cannotDeleteCurrent')
                  : t('branchesPanel.delete')}
                disabled={current || busy}
                onclick={() => doDelete(b.name)}
                ><Icon name="trash" size={15} /></button
              >
              <button
                title={t('branchesPanel.addTag')}
                onclick={() => toggleTag(b.name)}
                ><Icon name="tag" size={15} /></button
              >
              <button
                title={t('branchesPanel.edit')}
                onclick={() => openEdit(b.name)}
                ><Icon name="edit" size={15} /></button
              >
              <button
                title={t('branchesPanel.fork')}
                onclick={() => toggleFork(b.name)}
                ><Icon name="fork" size={15} /></button
              >
              {#if issueNumber != null}
                <button
                  title={t('branchesPanel.goToIssue')}
                  onclick={() => onGoToIssue(issueNumber)}
                  ><Icon name="link" size={15} /></button
                >
              {/if}
            </span>
          </div>
          {#if tagFrom === b.name}
            <div class="row inline-row">
              <!-- svelte-ignore a11y_autofocus -->
              <input
                class="edit"
                placeholder={t('branchesPanel.addTagPlaceholder')}
                aria-label={t('branchesPanel.addTagPlaceholder')}
                bind:value={tagRowName}
                disabled={busy}
                autofocus
                onkeydown={(e) => {
                  if (e.key === 'Enter') commitTag(b.target);
                  else if (e.key === 'Escape') cancelTag();
                }}
                onblur={cancelTag}
              />
            </div>
          {/if}
          {#if forkFrom === b.name}
            <div class="row inline-row">
              <!-- svelte-ignore a11y_autofocus -->
              <input
                class="edit"
                placeholder={t('branchesPanel.forkPlaceholder')}
                aria-label={t('branchesPanel.forkPlaceholder')}
                bind:value={forkName}
                disabled={busy}
                autofocus
                onkeydown={(e) => {
                  if (e.key === 'Enter') commitFork(b.target);
                  else if (e.key === 'Escape') cancelFork();
                }}
                onblur={cancelFork}
              />
            </div>
          {/if}
        {/each}
        {#each remotes as b (b.name)}
          <div class="row remote">
            <span class="swatch" style="background:{color(b.target)}"></span>
            <button
              class="name name-btn"
              title={t('branchesPanel.remoteHint', { name: b.name })}
              ondblclick={() => onCheckoutRemote(b.name)}
              oncontextmenu={(e) => {
                e.preventDefault();
                openRemoteMenu(b.name, e.clientX, e.clientY);
              }}
            >
              {b.name}
            </button>
            <span class="tag-remote">{t('branchesPanel.remoteTag')}</span>
          </div>
        {/each}
      {/if}
    </section>

    <section>
      <h3>
        <button
          class="hdr-toggle"
          aria-expanded={!tagsCollapsed}
          onclick={() => toggleSection('tags')}
        >
          <span class="chev" aria-hidden="true"
            >{tagsCollapsed ? '▸' : '▾'}</span
          >
          {t('branchesPanel.tagsHeading')}
        </button>
        <span class="count">{tags.length}</span>
      </h3>
      {#if !tagsCollapsed}
        {#each tags as tag (tag.name)}
          <div class="row">
            <span class="swatch" style="background:{color(tag.target)}"></span>
            <span class="name">{tag.name}</span>
            <span class="acts">
              <button
                title={t('branchesPanel.deleteTag')}
                disabled={busy}
                onclick={() =>
                  void run(
                    () => deleteTag(repoPath!, tag.name),
                    branchesOp('delete-tag'),
                  )}><Icon name="trash" size={14} /></button
              >
            </span>
          </div>
        {/each}
        <div class="new">
          <input
            placeholder={t('branchesPanel.newTagPlaceholder')}
            bind:value={newTag}
            disabled={busy}
            onkeydown={(e) => e.key === 'Enter' && addTag()}
          />
        </div>
      {/if}
    </section>
  </div>
</aside>

{#if dialogBranch}
  <BranchEditDialog
    branch={dialogBranch}
    initial={dialogInitialHex(dialogBranch)}
    onConfirm={confirmEdit}
    onReset={resetEdit}
    onCancel={() => (dialogBranch = null)}
  />
{/if}
{#if remoteMenu}
  <ContextMenu
    x={remoteMenu.x}
    y={remoteMenu.y}
    items={remoteMenuItems(remoteMenu.name)}
    onClose={() => (remoteMenu = null)}
  />
{/if}

<style>
  .panel {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    width: 320px;
    background: var(--panel-bg);
    border-right: 1px solid var(--panel-border);
    box-shadow: var(--panel-shadow);
    display: flex;
    flex-direction: column;
    z-index: 6;
    /* Reserve the floating Toolbar's band so its branches/files buttons
       overlay empty space instead of this panel's own header. */
    padding-top: var(--float-btn-band);
  }
  /* Slide-over motion: in on mount, out while the parent holds the panel
     mounted for the exit (see lib/panelSlide.svelte.ts). A class-driven CSS
     animation rather than a Svelte `transition:` — see the note in
     Toast.svelte. `backwards`/`forwards` instead of `both`: a transform left
     standing on the panel would make it the containing block for its
     `position: fixed` children (ContextMenu, BranchEditDialog). */
  .panel[data-slide='in'] {
    animation: panel-slide-in-left var(--panel-slide-ms) var(--panel-slide-ease)
      backwards;
  }
  .panel[data-slide='out'] {
    animation: panel-slide-out-left var(--panel-slide-ms)
      var(--panel-slide-ease) forwards;
  }
  @media (prefers-reduced-motion: reduce) {
    .panel[data-slide] {
      animation: none;
    }
  }
  .filter {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 14px 12px 10px;
  }
  .filter input {
    flex: 1;
    min-width: 0;
    height: 30px;
    border: 1px solid var(--panel-border);
    border-radius: 999px;
    padding: 0 32px 0 14px;
    font-size: 12px;
    outline: none;
  }
  .filter .ico {
    position: absolute;
    right: 52px;
    color: #999;
  }
  .close {
    border: 0;
    background: transparent;
    font-size: 18px;
    color: #888;
    cursor: pointer;
    line-height: 1;
  }
  .err {
    margin: 0 12px 8px;
    font-size: 11px;
    color: var(--lane-7);
  }
  .scroll {
    overflow-y: auto;
    padding: 0 8px 16px;
  }
  section {
    border-top: 1px solid var(--panel-border);
    padding: 8px 4px;
  }
  h3 {
    margin: 4px 6px 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--fg-soft);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .hdr-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    border: 0;
    background: transparent;
    font: inherit;
    font-weight: inherit;
    color: inherit;
    padding: 2px 4px;
    margin: -2px -4px;
    cursor: pointer;
    border-radius: 4px;
  }
  .hdr-toggle:hover {
    background: var(--row-hover);
  }
  .hdr-toggle:focus-visible {
    outline: 2px solid var(--select-ring);
    outline-offset: 1px;
  }
  .chev {
    width: 10px;
    display: inline-block;
  }
  .count {
    font-size: 10px;
    color: var(--fg-muted);
    background: var(--row-hover);
    border-radius: 999px;
    padding: 0 6px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border-radius: 6px;
    font-size: 13px;
  }
  .row:hover {
    background: var(--row-hover);
  }
  .row.current .name {
    font-weight: 600;
  }
  .row.selected {
    box-shadow:
      0 0 0 2px var(--panel-bg),
      0 0 0 3px var(--select-ring);
  }
  .row.remote {
    padding-left: 18px;
  }
  .row.inline-row {
    padding-left: 19px;
  }
  .swatch {
    width: 11px;
    height: 11px;
    border-radius: 3px;
    flex: 0 0 auto;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
  }
  .name-btn {
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
    padding: 0;
  }
  .star {
    margin-left: 5px;
    font-size: 10px;
    color: var(--select-ring);
  }
  .cloud-off {
    /* Sits inline right after the branch name (inside the name button). */
    position: relative;
    display: inline-block;
    margin-left: 5px;
    font-size: 11px;
    line-height: 1;
    color: var(--fg-muted);
  }
  .cloud-off::after {
    content: '';
    position: absolute;
    left: -1px;
    right: -1px;
    top: 50%;
    height: 1px;
    background: currentColor;
    transform: rotate(-45deg);
  }
  .edit {
    flex: 1;
    height: 22px;
    border: 1px solid var(--select-ring);
    border-radius: 5px;
    padding: 0 8px;
    font: inherit;
    font-size: 12px;
    outline: none;
  }
  .tag-remote {
    margin-left: auto;
    font-size: 10px;
    color: var(--fg-muted);
    background: var(--row-hover);
    padding: 1px 6px;
    border-radius: 999px;
  }
  .acts {
    display: flex;
    gap: 2px;
    flex: 0 0 auto;
    opacity: 0;
  }
  .row:hover .acts,
  .row:focus-within .acts {
    opacity: 1;
  }
  .acts button {
    border: 0;
    background: transparent;
    cursor: pointer;
    font-size: 12px;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    flex: 0 0 auto;
  }
  .acts button:hover:not(:disabled) {
    background: var(--panel-border);
  }
  .acts button:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .new input {
    width: 100%;
    margin: 4px 6px;
    height: 28px;
    border: 1px dashed var(--panel-border);
    border-radius: 6px;
    padding: 0 10px;
    font-size: 12px;
    background: transparent;
    color: var(--fg);
  }
</style>
