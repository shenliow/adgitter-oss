<!--
  Left slide-over: working-tree status + staging + commit (mockup: changed files
  panel). Wires the working-tree backend (repo_status / stage / unstage / discard /
  create_commit).
-->
<script lang="ts">
  import {
    repoStatus,
    stagePaths,
    unstagePaths,
    discardPaths,
    openPath,
    errorText,
    type RepoStatus,
    type StatusEntry,
  } from '../lib/ipc';
  import CreateCommitBar from './CreateCommitBar.svelte';
  import FilesPanelTree from './FilesPanelTree.svelte';
  import ResizeHandle from './ResizeHandle.svelte';
  import { loadPanelWidth, savePanelWidth } from '../lib/panelWidth';
  import { buildTree } from '../lib/fileTree';
  import { t } from '../lib/i18n/index.svelte';
  import Icon from '../lib/icons/Icon.svelte';
  import type { MessageKey } from '../lib/i18n/messages';
  import type { TutorialAction } from '../lib/tutorial/types';

  let {
    repoPath = null,
    reloadKey = 0,
    onClose = () => {},
    onMutated = () => {},
    onCommitted = () => {},
    onOpenDiff,
    onStatus = () => {},
    closing = false,
    guard,
    beforeCommit,
  }: {
    repoPath?: string | null;
    reloadKey?: number;
    onClose?: () => void;
    /** Called after an action that changes history (commit/discard). */
    onMutated?: () => void;
    /** Called with the new sha after a successful commit. */
    onCommitted?: (sha: string) => void;
    /** Click a file name → open its working-tree diff. */
    onOpenDiff?: (path: string) => void;
    /** Called with the fresh RepoStatus after every successful load —
     *  including the reload each stage/unstage action performs. App.svelte
     *  uses it in resolve mode to keep the banner's Continue enablement
     *  (`conflicted.length === 0`) live without polling itself while the
     *  panel is open. */
    onStatus?: (status: RepoStatus) => void;
    /** True while the parent is holding this panel mounted purely so its
     *  slide-out can play (lib/panelSlide.svelte.ts). Drives `data-slide`. */
    closing?: boolean;
    /** Guided tutorial: asked BEFORE a stage (`stage`), a discard / open-in-OS
     *  (`other:files:…`) or a commit (`commit`, via the commit bar). `false`
     *  means "swallow it". Absent ⇒ always allowed. */
    guard?: (a: TutorialAction) => boolean;
    /** Auto-pull gate: awaited AFTER `guard` and BEFORE anything is staged or
     *  committed. `false` means the commit is abandoned — the gate has already
     *  told the user why, so nothing is shown inline. Absent ⇒ no gate. */
    beforeCommit?: () => Promise<boolean>;
  } = $props();

  /** Tutorial gate: with no `guard` prop everything is allowed. */
  function allowed(a: TutorialAction): boolean {
    return guard ? guard(a) : true;
  }

  let status = $state<RepoStatus | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let busy = $state(false);
  // Drag-to-resize width; persisted so it survives toggling the panel.
  let width = $state(loadPanelWidth('files', 320));

  async function load() {
    if (!repoPath) {
      status = null;
      return;
    }
    loading = true;
    error = null;
    try {
      status = await repoStatus(repoPath);
      onStatus(status);
    } catch (e) {
      error = errorText(e);
      status = null;
    } finally {
      loading = false;
    }
  }

  // Reload when the repo changes, or when the parent bumps reloadKey (e.g. an
  // on-disk change caught by the auto-refresh).
  $effect(() => {
    void repoPath;
    void reloadKey;
    void load();
  });

  /** Hand the file to the OS default application. Read-only: no reload needed. */
  async function openFile(path: string) {
    if (!repoPath) return;
    if (!allowed({ kind: 'other', name: 'files:open-file' })) return;
    error = null;
    try {
      await openPath(repoPath, path);
    } catch (e) {
      error = errorText(e);
    }
  }

  type Action = (p: string, paths: string[]) => Promise<void>;
  async function act(fn: Action, path: string, graphAffecting = false) {
    if (!repoPath || busy) return;
    busy = true;
    error = null;
    try {
      await fn(repoPath, [path]);
      await load();
      if (graphAffecting) onMutated();
    } catch (e) {
      error = errorText(e);
    } finally {
      busy = false;
    }
  }

  const groups = $derived(
    status
      ? ([
          // Conflicted first: while resolving a paused merge/rebase these are
          // the only rows that matter — staging one records its resolution
          // (the backend collapses the conflict stages on add), which is also
          // why its action is plain 'stage'. No discard here: throwing away a
          // half-resolved file mid-op is Abort's job, not a per-file gesture.
          {
            id: 'conflicted',
            label: 'files.conflicted',
            items: status.conflicted ?? [],
            action: 'stage',
          },
          {
            id: 'staged',
            label: 'files.staged',
            items: status.staged,
            action: 'unstage',
          },
          {
            id: 'changed',
            label: 'files.changed',
            items: status.changed,
            action: 'stage',
          },
          {
            id: 'untracked',
            label: 'files.untracked',
            items: status.untracked,
            action: 'stage',
          },
          {
            id: 'ignored',
            label: 'files.ignored',
            items: status.ignored,
            action: null,
          },
        ] as const satisfies readonly {
          id: string;
          label: MessageKey;
          items: StatusEntry[];
          action: 'stage' | 'unstage' | null;
        }[])
      : [],
  );

  const isClean = $derived(
    !!status &&
      (status.conflicted ?? []).length === 0 &&
      status.staged.length === 0 &&
      status.changed.length === 0 &&
      status.untracked.length === 0,
  );

  // Collapsible tree state (in-memory only, no persistence). "ignored" starts
  // collapsed — it's noise; the other groups (incl. "conflicted", which must
  // never hide by default — it gates the resolve banner's Continue) start
  // expanded.
  let collapsedGroups = $state<Set<string>>(new Set(['ignored']));
  let collapsedDirs = $state<Set<string>>(new Set());

  function toggleGroup(id: string) {
    const next = new Set(collapsedGroups);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsedGroups = next;
  }

  function toggleDir(key: string) {
    const next = new Set(collapsedDirs);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    collapsedDirs = next;
  }
</script>

<aside
  class="panel"
  data-panel="files"
  data-tutorial="files-panel"
  data-slide={closing ? 'out' : 'in'}
  style="width:{width}px"
>
  <ResizeHandle
    side="right"
    bind:width
    label={t('panel.resize')}
    onCommit={(w) => savePanelWidth('files', w)}
  />
  <div class="hdr">
    <div class="hdr-left">
      <strong>{t('files.title')}</strong>
    </div>
    <button class="close" title={t('common.close')} onclick={onClose}
      ><Icon name="close" size={14} /></button
    >
  </div>

  <div class="scroll">
    {#if loading && !status}
      <p class="msg">{t('files.loading')}</p>
    {:else if error}
      <p class="msg err">{error}</p>
    {:else if status}
      {#each groups as g (g.id)}
        {#if g.items.length}
          {@const groupCollapsed = collapsedGroups.has(g.id)}
          <section>
            <h3 class:warn={g.id === 'conflicted'}>
              <button
                class="hdr-toggle"
                aria-expanded={!groupCollapsed}
                onclick={() => toggleGroup(g.id)}
              >
                <span class="chev" aria-hidden="true"
                  >{groupCollapsed ? '▸' : '▾'}</span
                >
                {t(g.label)}
              </button>
              <span class="count">{g.items.length}</span>
            </h3>
            {#if !groupCollapsed}
              <FilesPanelTree
                nodes={buildTree(g.items)}
                groupId={g.id}
                {collapsedDirs}
                onToggleDir={toggleDir}
                onOpenDiff={g.id !== 'ignored' ? onOpenDiff : undefined}
                onOpenFile={(p) => void openFile(p)}
                onStage={g.action === 'stage'
                  ? (p) => {
                      if (allowed({ kind: 'stage', paths: [p] }))
                        void act(stagePaths, p);
                    }
                  : undefined}
                onUnstage={g.action === 'unstage'
                  ? (p) => act(unstagePaths, p)
                  : undefined}
                onDiscard={g.id === 'changed'
                  ? (p) => {
                      if (allowed({ kind: 'other', name: 'files:discard' }))
                        void act(discardPaths, p, true);
                    }
                  : undefined}
              />
            {/if}
          </section>
        {/if}
      {/each}
      {#if isClean}
        <p class="msg">{t('files.clean')}</p>
      {/if}
    {/if}
  </div>

  {#if repoPath}
    <CreateCommitBar
      {repoPath}
      {guard}
      {beforeCommit}
      stagedCount={status?.staged.length ?? 0}
      onCommitted={(sha) => {
        void load();
        onMutated();
        onCommitted(sha);
      }}
    />
  {/if}
</aside>

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
     Toast.svelte. `backwards`/`forwards` instead of `both` so no transform is
     left standing on the panel once it has arrived. */
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
  .hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 14px 14px 10px;
    font-size: 13px;
  }
  .hdr-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .hdr-left strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .close {
    border: 0;
    background: transparent;
    font-size: 18px;
    color: #888;
    cursor: pointer;
    line-height: 1;
    flex: 0 0 auto;
  }
  .scroll {
    overflow-y: auto;
    padding: 0 8px;
    flex: 1;
  }
  section {
    border-top: 1px solid var(--panel-border);
    padding: 6px 4px;
  }
  h3 {
    margin: 4px 6px 6px;
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
  /* Conflicted section header: warning accent (same red as the '!' status
   * badge and the other destructive/error accents — see --lane-7 usage). */
  h3.warn {
    color: var(--lane-7);
  }
  h3.warn .count {
    color: #fff;
    background: var(--lane-7);
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
  .msg {
    font-size: 12px;
    color: var(--fg-muted);
    padding: 10px;
  }
  .msg.err {
    color: var(--lane-7);
  }
</style>
