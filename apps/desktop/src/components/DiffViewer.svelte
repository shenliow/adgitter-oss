<!--
  Side-by-side file diff overlay.

  Renders a `FileDiff` (commit-file or working-tree) as two aligned panes:
  deletions on the left, additions on the right, context on both. The parent
  loads the diff via `diffFile`/`diffWorktree` and passes it in. Lines are
  syntax-highlighted with Shiki, loaded lazily; until the highlighter
  resolves (or if the language is unknown/binary) lines render as plain text.
-->
<script lang="ts">
  import type { FileDiff, DiffHunk, DiffLine } from '../lib/ipc';
  import { highlightFileDiff, type Token } from '../lib/free/highlight';
  import { t } from '../lib/i18n/index.svelte';
  import Icon from '../lib/icons/Icon.svelte';

  let {
    title,
    subtitle = '',
    diff = null,
    loading = false,
    error = null,
    onClose,
  }: {
    title: string;
    subtitle?: string;
    diff?: FileDiff | null;
    loading?: boolean;
    error?: string | null;
    onClose: () => void;
  } = $props();

  // DiffLine → highlighted tokens, filled in asynchronously once Shiki loads.
  // Empty/absent ⇒ render the line's plain text.
  let hi = $state<Map<DiffLine, Token[]> | null>(null);

  $effect(() => {
    const d = diff;
    const path = title;
    hi = null;
    if (!d || d.binary || d.hunks.length === 0) return;
    let cancelled = false;
    highlightFileDiff(d, path).then((map) => {
      if (!cancelled && map.size > 0) hi = map;
    });
    return () => {
      cancelled = true;
    };
  });

  interface Row {
    left: DiffLine | null;
    right: DiffLine | null;
  }

  /** Pair a hunk's lines into aligned left(old)/right(new) rows. */
  function splitHunk(hunk: DiffHunk): Row[] {
    const rows: Row[] = [];
    const ls = hunk.lines;
    let i = 0;
    while (i < ls.length) {
      const l = ls[i];
      if (l.origin === ' ' || (l.origin !== '+' && l.origin !== '-')) {
        rows.push({ left: l, right: l });
        i++;
        continue;
      }
      const dels: DiffLine[] = [];
      const adds: DiffLine[] = [];
      while (i < ls.length && ls[i].origin === '-') dels.push(ls[i++]);
      while (i < ls.length && ls[i].origin === '+') adds.push(ls[i++]);
      const m = Math.max(dels.length, adds.length);
      for (let k = 0; k < m; k++)
        rows.push({ left: dels[k] ?? null, right: adds[k] ?? null });
    }
    return rows;
  }

  const hunks = $derived(
    (diff?.hunks ?? []).map((h) => ({ header: h.header, rows: splitHunk(h) })),
  );

  function text(l: DiffLine | null): string {
    return l ? l.content.replace(/\n$/, '') : '';
  }
  function cls(l: DiffLine | null, side: 'left' | 'right'): string {
    if (!l) return 'blank';
    if (l.origin === '-') return 'del';
    if (l.origin === '+') return 'add';
    return side; // context
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={onKey} />

{#snippet body(line: DiffLine | null)}
  {#if line && hi?.get(line)?.length}
    {#each hi.get(line) ?? [] as tok, ti (ti)}<span style={tok.style}
        >{tok.content}</span
      >{/each}
  {:else}{text(line)}{/if}
{/snippet}

<button class="backdrop" aria-label={t('diff.close')} onclick={onClose}
></button>
<div
  class="viewer"
  role="dialog"
  aria-modal="true"
  aria-label={t('diff.title')}
>
  <header class="head">
    <div class="title">
      <span class="path">{title}</span>
      {#if subtitle}<span class="sub">{subtitle}</span>{/if}
    </div>
    <button class="close" title={t('common.close')} onclick={onClose}
      ><Icon name="close" size={14} /></button
    >
  </header>

  <div class="body">
    {#if loading}
      <p class="msg">{t('diff.loading')}</p>
    {:else if error}
      <p class="msg err">{error}</p>
    {:else if !diff}
      <p class="msg">{t('diff.none')}</p>
    {:else if diff.binary}
      <p class="msg">{t('diff.binary')}</p>
    {:else if hunks.length === 0}
      <p class="msg">{t('diff.noChanges')}</p>
    {:else}
      <div class="diff" role="table">
        {#each hunks as h (h.header)}
          <div class="hunk-head" role="row">{h.header.replace(/\n$/, '')}</div>
          {#each h.rows as r, i (i)}
            <div class="row" role="row">
              <span class="ln">{r.left?.old_lineno ?? ''}</span>
              <span class="cell {cls(r.left, 'left')}"
                >{@render body(r.left)}</span
              >
              <span class="ln">{r.right?.new_lineno ?? ''}</span>
              <span class="cell {cls(r.right, 'right')}"
                >{@render body(r.right)}</span
              >
            </div>
          {/each}
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    border: 0;
    padding: 0;
    z-index: 30;
    cursor: default;
  }
  .viewer {
    position: fixed;
    top: 5vh;
    left: 50%;
    transform: translateX(-50%);
    width: min(1100px, 92vw);
    height: 88vh;
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: 10px;
    box-shadow: var(--panel-shadow);
    z-index: 31;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--panel-border);
  }
  .title {
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .path {
    font-family: var(--mono);
    font-size: 13px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    font-size: 11px;
    color: var(--fg-muted);
    flex: 0 0 auto;
  }
  .close {
    border: 0;
    background: transparent;
    font-size: 20px;
    color: #888;
    cursor: pointer;
    line-height: 1;
  }
  .body {
    flex: 1;
    overflow: auto;
    background: var(--workspace-bg);
  }
  .msg {
    font-size: 13px;
    color: var(--fg-muted);
    padding: 24px;
    text-align: center;
  }
  .msg.err {
    color: var(--lane-7);
  }
  .diff {
    font-family: var(--mono);
    font-size: 12px;
    line-height: 1.5;
    min-width: 100%;
  }
  .hunk-head {
    background: var(--row-hover);
    color: var(--fg-muted);
    padding: 2px 10px;
    white-space: pre;
    border-top: 1px solid var(--panel-border);
    border-bottom: 1px solid var(--panel-border);
  }
  .row {
    display: grid;
    grid-template-columns: 48px 1fr 48px 1fr;
  }
  .ln {
    text-align: right;
    padding: 0 8px;
    color: var(--fg-muted);
    user-select: none;
    background: var(--panel-bg);
    border-right: 1px solid var(--panel-border);
  }
  .cell {
    padding: 0 10px;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
    border-right: 1px solid var(--panel-border);
  }
  .cell.blank {
    background: repeating-linear-gradient(
      45deg,
      transparent,
      transparent 6px,
      rgba(127, 127, 127, 0.06) 6px,
      rgba(127, 127, 127, 0.06) 12px
    );
  }
  .cell.add {
    background: rgba(34, 197, 94, 0.16);
  }
  .cell.del {
    background: rgba(239, 68, 68, 0.16);
  }
</style>
