<!--
  Recursive collapsible file/folder tree for the Changes panel (FilesPanel.svelte).
  Generalized over StatusEntry (working-tree status), with collapsible directory
  rows — unlike FileTree.svelte (committed FileChange, non-collapsible dirs).
-->
<script lang="ts">
  import type { TreeNode } from '../lib/fileTree';
  import type { StatusEntry, WorkStatus } from '../lib/ipc';
  import { t } from '../lib/i18n/index.svelte';
  import Icon from '../lib/icons/Icon.svelte';
  import Self from './FilesPanelTree.svelte';

  let {
    nodes,
    depth = 0,
    groupId,
    pathPrefix = '',
    collapsedDirs,
    onToggleDir,
    onOpenDiff,
    onOpenFile,
    onStage,
    onUnstage,
    onDiscard,
  }: {
    nodes: TreeNode<StatusEntry>[];
    depth?: number;
    /** Group id ('conflicted' | 'staged' | 'changed' | 'untracked' | 'ignored'), used as the collapse-key prefix. */
    groupId: string;
    /** Accumulated directory path so far, used to build a stable collapse key. */
    pathPrefix?: string;
    collapsedDirs: Set<string>;
    onToggleDir: (key: string) => void;
    /** Click a file leaf → open its diff. Omitted (e.g. for ignored) → leaves are static. */
    onOpenDiff?: (path: string) => void;
    /** Open the file in the OS default application. */
    onOpenFile?: (path: string) => void;
    onStage?: (path: string) => void;
    onUnstage?: (path: string) => void;
    onDiscard?: (path: string) => void;
  } = $props();

  function glyph(s: WorkStatus): string {
    switch (s) {
      case 'new':
        return 'A';
      case 'deleted':
        return 'D';
      case 'renamed':
        return 'R';
      case 'typechange':
        return 'T';
      case 'ignored':
        return 'I';
      case 'conflicted':
        return '!';
      default:
        return 'M';
    }
  }

  function entryTitle(f: StatusEntry): string {
    return f.old_path ? `${f.old_path} → ${f.path}` : f.path;
  }
</script>

{#each nodes as n (n.type + n.name)}
  {#if n.type === 'dir'}
    {@const dirKey = `${groupId}/${pathPrefix}${n.name}`}
    {@const collapsed = collapsedDirs.has(dirKey)}
    <button
      class="dir"
      style="padding-left:{depth * 14 + 6}px"
      title={pathPrefix + n.name}
      aria-expanded={!collapsed}
      onclick={() => onToggleDir(dirKey)}
    >
      <span class="chev" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
      <span class="fold" aria-hidden="true">🗀</span>{n.name}
    </button>
    {#if !collapsed}
      <Self
        nodes={n.children}
        depth={depth + 1}
        {groupId}
        pathPrefix={`${pathPrefix}${n.name}/`}
        {collapsedDirs}
        {onToggleDir}
        {onOpenDiff}
        {onOpenFile}
        {onStage}
        {onUnstage}
        {onDiscard}
      />
    {/if}
  {:else}
    <div class="file" style="padding-left:{depth * 14 + 22}px">
      <span class="status s-{n.change.status}">{glyph(n.change.status)}</span>
      {#if onOpenDiff}
        <button
          class="fname link"
          title={entryTitle(n.change)}
          onclick={() => onOpenDiff?.(n.change.path)}>{n.name}</button
        >
      {:else}
        <span class="fname" title={entryTitle(n.change)}>{n.name}</span>
      {/if}
      <span class="acts">
        {#if onOpenFile && n.change.status !== 'deleted'}
          <button
            title={t('files.openFile')}
            aria-label={t('files.openFile')}
            onclick={() => onOpenFile?.(n.change.path)}
            ><Icon name="external" size={13} /></button
          >
        {/if}
        {#if onStage}
          <button
            title={t('files.stage')}
            onclick={() => onStage?.(n.change.path)}>+</button
          >
        {/if}
        {#if onUnstage}
          <button
            title={t('files.unstage')}
            onclick={() => onUnstage?.(n.change.path)}
            ><Icon name="minus" size={14} /></button
          >
        {/if}
        {#if onDiscard}
          <button
            title={t('files.discard')}
            onclick={() => onDiscard?.(n.change.path)}
            ><Icon name="close" size={13} /></button
          >
        {/if}
      </span>
    </div>
  {/if}
{/each}

<style>
  .dir {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    font-size: 12px;
    color: var(--fg-soft);
    padding: 4px 8px 4px 6px;
    border: 0;
    background: transparent;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    border-radius: 5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dir:hover {
    background: var(--row-hover);
  }
  .dir:focus-visible {
    outline: 2px solid var(--select-ring);
    outline-offset: -2px;
  }
  .chev {
    flex: 0 0 auto;
    width: 10px;
    display: inline-block;
  }
  .fold {
    flex: 0 0 auto;
  }
  .file {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    padding: 3px 8px;
    border-radius: 5px;
  }
  .file:hover {
    background: var(--row-hover);
  }
  .fname {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .fname.link {
    border: 0;
    background: transparent;
    font: inherit;
    color: inherit;
    text-align: left;
    padding: 0;
    cursor: pointer;
  }
  .fname.link:hover {
    text-decoration: underline;
  }
  .fname.link:focus-visible {
    outline: 2px solid var(--select-ring);
    outline-offset: 1px;
  }
  .status {
    width: 15px;
    height: 15px;
    display: grid;
    place-items: center;
    border-radius: 4px;
    color: #fff;
    font-size: 9px;
    font-weight: 700;
    font-family: var(--mono);
    flex: 0 0 auto;
  }
  .s-new {
    background: var(--lane-0);
  }
  .s-deleted {
    background: var(--lane-7);
  }
  .s-modified {
    background: var(--lane-5);
  }
  .s-renamed {
    background: var(--lane-3);
  }
  .s-typechange {
    background: var(--lane-6);
  }
  .s-ignored {
    background: var(--fg-muted);
  }
  .s-conflicted {
    background: var(--lane-7);
  }
  .acts {
    display: flex;
    gap: 2px;
    opacity: 0;
  }
  .file:hover .acts {
    opacity: 1;
  }
  .acts button {
    border: 0;
    background: transparent;
    cursor: pointer;
    font-size: 13px;
    color: var(--fg-soft);
    width: 18px;
    height: 18px;
    border-radius: 4px;
  }
  .acts button:hover {
    background: var(--panel-border);
  }
</style>
