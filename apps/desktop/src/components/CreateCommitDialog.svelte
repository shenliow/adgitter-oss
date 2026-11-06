<!--
  Create-commit modal, opened from the HEAD "+" affordance. Lists the working
  tree's stageable files (staged ones pre-checked) + a message box, reconciles
  the index to exactly the checked files, then commits. Reuses the working-tree
  backend (repo_status / stage / unstage / create_commit).
-->
<script lang="ts">
  import {
    repoStatus,
    stagePaths,
    unstagePaths,
    createCommit,
    errorText,
    type RepoStatus,
    type StatusEntry,
    type WorkStatus,
  } from '../lib/ipc';
  import { t } from '../lib/i18n/index.svelte';
  import type { TutorialAction } from '../lib/tutorial/types';

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
      default:
        return 'M';
    }
  }

  let {
    repoPath,
    reloadKey = 0,
    onClose = () => {},
    onCommitted = () => {},
    onMutated = () => {},
    guard,
    beforeCommit,
  }: {
    repoPath: string;
    reloadKey?: number;
    onClose?: () => void;
    onCommitted?: (sha: string) => void;
    onMutated?: () => void;
    /** Guided tutorial: asked BEFORE the index is reconciled (`stage` with the
     *  paths about to be staged) and before the commit (`commit`). `false`
     *  means "swallow it". Absent ⇒ always allowed. */
    guard?: (a: TutorialAction) => boolean;
    /** Auto-pull gate: awaited AFTER `guard` and BEFORE anything is staged or
     *  committed. `false` means the commit is abandoned — the gate has already
     *  told the user why, so nothing is shown inline. Absent ⇒ no gate. */
    beforeCommit?: () => Promise<boolean>;
  } = $props();

  let status = $state<RepoStatus | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let message = $state('');
  let committing = $state(false);
  let checked = $state<Record<string, boolean>>({});

  /** Stageable rows from a status snapshot: staged first, then changed +
   *  untracked (deduped by path). Pure so `load()` can also use it to diff
   *  the previous snapshot against a fresh one when reloading. */
  function rowsFor(
    s: RepoStatus | null,
  ): { entry: StatusEntry; staged: boolean }[] {
    if (!s) return [];
    const seen = new Set<string>();
    const out: { entry: StatusEntry; staged: boolean }[] = [];
    for (const e of s.staged) {
      out.push({ entry: e, staged: true });
      seen.add(e.path);
    }
    for (const e of [...s.changed, ...s.untracked]) {
      if (!seen.has(e.path)) {
        out.push({ entry: e, staged: false });
        seen.add(e.path);
      }
    }
    return out;
  }

  // Stageable rows: staged (pre-checked) first, then changed + untracked.
  const rows = $derived(rowsFor(status));

  const selectedCount = $derived(
    rows.filter((r) => checked[r.entry.path]).length,
  );
  const canCommit = $derived(
    !!message.trim() && selectedCount > 0 && !committing,
  );

  async function load() {
    loading = true;
    error = null;
    try {
      const s = await repoStatus(repoPath);
      // Diff against the previous snapshot (if any) so a reload preserves the
      // user's checkbox choices: a path that was already listed keeps its
      // prior checked state; a path appearing for the first time defaults to
      // checked iff it's staged (same as the very first load). Paths that
      // disappeared are simply dropped by not carrying them forward.
      const previousPaths = new Set(rowsFor(status).map((r) => r.entry.path));
      const previousChecked = checked;
      const c: Record<string, boolean> = {};
      for (const r of rowsFor(s)) {
        c[r.entry.path] = previousPaths.has(r.entry.path)
          ? (previousChecked[r.entry.path] ?? false)
          : r.staged;
      }
      status = s;
      checked = c;
    } catch (e) {
      error = errorText(e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void reloadKey;
    void load();
  });

  async function commit() {
    if (!canCommit) return;
    committing = true;
    error = null;
    try {
      // Reconcile the index to exactly the checked set, then commit it.
      const toStage = rows
        .filter((r) => checked[r.entry.path] && !r.staged)
        .map((r) => r.entry.path);
      const toUnstage = rows
        .filter((r) => !checked[r.entry.path] && r.staged)
        .map((r) => r.entry.path);
      if (
        guard &&
        ((toStage.length && !guard({ kind: 'stage', paths: toStage })) ||
          !guard({ kind: 'commit' }))
      )
        return;
      // Pull BEFORE the index is reconciled, not between staging and the
      // commit: a gate that abandons must leave the index exactly as the user
      // left it.
      if (beforeCommit && !(await beforeCommit())) return;
      if (toUnstage.length) await unstagePaths(repoPath, toUnstage);
      if (toStage.length) await stagePaths(repoPath, toStage);
      const sha = await createCommit(repoPath, message);
      onCommitted(sha);
      onMutated();
      onClose();
    } catch (e) {
      error = errorText(e);
    } finally {
      committing = false;
    }
  }
</script>

<div class="backdrop" onclick={onClose} role="presentation"></div>
<div
  class="modal"
  role="dialog"
  aria-modal="true"
  aria-label={t('commit.title')}
  data-tutorial="create-commit-dialog"
>
  <h2>{t('commit.title')}</h2>

  {#if error}<div class="err" role="alert">{error}</div>{/if}

  <div class="files">
    {#if loading}
      <p class="muted">{t('files.loading')}</p>
    {:else if rows.length === 0}
      <p class="muted">{t('files.clean')}</p>
    {:else}
      {#each rows as row (row.entry.path)}
        <label class="row">
          <input type="checkbox" bind:checked={checked[row.entry.path]} />
          <span class="status s-{row.entry.status}"
            >{glyph(row.entry.status)}</span
          >
          <span class="path">{row.entry.path}</span>
          {#if row.staged}<span class="tag">{t('files.staged')}</span>{/if}
        </label>
      {/each}
    {/if}
  </div>

  <textarea
    bind:value={message}
    placeholder={t('commit.message')}
    rows="3"
    aria-label={t('commit.message')}
  ></textarea>

  <div class="actions">
    <button class="btn ghost" onclick={onClose}>{t('common.cancel')}</button>
    <button class="btn" disabled={!canCommit} onclick={commit}>
      {committing
        ? t('commit.creating')
        : t('commit.create', { n: String(selectedCount) })}
    </button>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 29;
  }
  .modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(560px, 90vw);
    max-height: 80vh;
    background: var(--panel-bg);
    border-radius: 12px;
    box-shadow: var(--panel-shadow);
    z-index: 30;
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  h2 {
    margin: 0;
    font-size: 15px;
  }
  .err {
    font-size: 12px;
    color: var(--lane-7);
  }
  .files {
    flex: 1;
    min-height: 80px;
    overflow-y: auto;
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .muted {
    margin: 6px;
    font-size: 12px;
    color: var(--fg-muted);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
  }
  .row:hover {
    background: var(--row-hover);
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
  .path {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg);
  }
  .tag {
    flex: 0 0 auto;
    font-size: 10px;
    color: var(--fg-muted);
  }
  /* The panel colour, like every other text field in the app
     (CreateBranchDialog, CreateCommitBar): --workspace-bg is the grey of the
     graph surface behind the dialog, and a grey field on a white panel reads
     as disabled. The focus ring replaces the suppressed outline — same
     convention, so the field looks editable and shows where the caret is. */
  textarea {
    resize: vertical;
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    padding: 8px 10px;
    font: inherit;
    font-size: 12px;
    outline: none;
    background: var(--panel-bg);
    color: var(--fg);
  }
  textarea:focus-visible {
    border-color: var(--select-ring);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }
  .btn {
    border: 0;
    background: var(--select-ring);
    color: #fff;
    height: 30px;
    padding: 0 16px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .btn.ghost {
    background: var(--row-hover);
    color: var(--fg);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
