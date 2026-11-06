<!-- Recursive nested file/folder list for the commit-details panel. -->
<script lang="ts">
  import type { TreeNode } from '../lib/fileTree';
  import type { FileStatus } from '../lib/ipc';
  import { t } from '../lib/i18n/index.svelte';
  import Icon from '../lib/icons/Icon.svelte';
  import Self from './FileTree.svelte';
  let {
    nodes = [],
    depth = 0,
    onOpen,
    onOpenFile,
    onHistory,
    onPurge,
  }: {
    nodes?: TreeNode[];
    depth?: number;
    /** Click a file leaf (or its diff icon) → open its diff. When omitted, leaves are static. */
    onOpen?: (path: string) => void;
    /** Open the file in the OS default application. When omitted, no icon is shown. */
    onOpenFile?: (path: string) => void;
    /** Show a per-file history action. When omitted, none is shown. */
    onHistory?: (path: string) => void;
    /** Remove this file from this commit and every commit after it (destructive, confirmed by the caller). When omitted, no icon is shown. */
    onPurge?: (path: string) => void;
  } = $props();

  function glyph(s: FileStatus): string {
    switch (s) {
      case 'added':
        return 'A';
      case 'deleted':
        return 'D';
      case 'renamed':
        return 'R';
      case 'copied':
        return 'C';
      case 'typechange':
        return 'T';
      default:
        return 'M';
    }
  }
</script>

{#each nodes as n (n.type + n.name)}
  {#if n.type === 'dir'}
    <div class="dir" style="padding-left:{depth * 14 + 6}px">
      <span class="fold" aria-hidden="true">🗀</span>{n.name}
    </div>
    <Self
      nodes={n.children}
      depth={depth + 1}
      {onOpen}
      {onOpenFile}
      {onHistory}
      {onPurge}
    />
  {:else}
    {#snippet leaf()}
      <span class="status s-{n.change.status}">{glyph(n.change.status)}</span>
      <span class="fname">{n.name}</span>
      <span class="lines">
        {#if n.change.insertions > 0}<span class="add"
            >+{n.change.insertions}</span
          >{/if}
        {#if n.change.deletions > 0}<span class="del"
            >−{n.change.deletions}</span
          >{/if}
      </span>
    {/snippet}
    {@const tip = n.change.old_path
      ? `${n.change.old_path} → ${n.change.path}`
      : n.change.path}
    <div
      class="file-row"
      data-tutorial-file={n.change.path}
      style="padding-left:{depth * 14 + 22}px"
    >
      {#if onOpen}
        <button
          class="file clickable"
          title={tip}
          onclick={() => onOpen?.(n.change.path)}
        >
          {@render leaf()}
        </button>
      {:else}
        <div class="file" title={tip}>
          {@render leaf()}
        </div>
      {/if}
      <span class="acts">
        {#if onOpen}
          <button
            class="act diff"
            title={t('commitDetails.viewDiff')}
            aria-label={t('commitDetails.viewDiff')}
            onclick={(e) => {
              e.stopPropagation();
              onOpen?.(n.change.path);
            }}
          >
            Δ
          </button>
        {/if}
        {#if onOpenFile}
          <button
            class="act openfile"
            title={t('files.openFile')}
            aria-label={t('files.openFile')}
            onclick={(e) => {
              e.stopPropagation();
              onOpenFile?.(n.change.path);
            }}
          >
            <Icon name="external" size={13} />
          </button>
        {/if}
        {#if onHistory}
          <button
            class="act hist"
            title={t('commitDetails.history')}
            aria-label={t('commitDetails.history')}
            onclick={(e) => {
              e.stopPropagation();
              onHistory?.(n.change.path);
            }}
          >
            <Icon name="history" size={13} />
          </button>
        {/if}
        {#if onPurge}
          <button
            class="act purge"
            data-tutorial="detail-purge"
            title={t('commitDetails.purgeFile')}
            aria-label={t('commitDetails.purgeFile')}
            onclick={(e) => {
              e.stopPropagation();
              onPurge?.(n.change.path);
            }}
          >
            <Icon name="trash" size={13} />
          </button>
        {/if}
      </span>
    </div>
  {/if}
{/each}

<style>
  .dir {
    font-size: 12px;
    color: var(--fg-soft);
    padding: 4px 8px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .file-row {
    display: flex;
    align-items: center;
  }
  .file-row:hover {
    background: var(--row-hover);
    border-radius: 5px;
  }
  .file {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    padding: 3px 8px;
    border-radius: 5px;
    /* reset for the clickable <button> variant; harmless on the <div> */
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font-family: inherit;
    text-align: left;
  }
  .acts {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 2px;
    opacity: 0;
  }
  .file-row:hover .acts,
  .acts:focus-within {
    opacity: 1;
  }
  .act {
    flex: 0 0 auto;
    border: 0;
    background: transparent;
    color: var(--fg-soft);
    cursor: pointer;
    font-size: 13px;
    padding: 2px 6px;
    border-radius: 5px;
  }
  .act:hover {
    color: var(--fg);
    background: var(--panel-border);
  }
  .act:focus-visible {
    opacity: 1;
    outline: 2px solid var(--select-ring);
    outline-offset: 1px;
  }
  .act.purge:hover {
    color: var(--lane-7);
  }
  .file.clickable {
    cursor: pointer;
  }
  .file.clickable:focus-visible {
    outline: 2px solid var(--select-ring);
    outline-offset: -2px;
  }
  .fname {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  .s-added {
    background: var(--lane-0);
  }
  .s-deleted {
    background: var(--lane-7);
  }
  .s-modified {
    background: var(--lane-5);
  }
  .s-renamed,
  .s-copied {
    background: var(--lane-3);
  }
  .s-typechange {
    background: var(--lane-6);
  }
  .lines {
    display: flex;
    gap: 6px;
    font-family: var(--mono);
    font-size: 10px;
  }
  .add {
    color: var(--lane-0);
  }
  .del {
    color: var(--lane-7);
  }
</style>
