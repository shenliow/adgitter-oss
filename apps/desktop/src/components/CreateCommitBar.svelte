<!--
  Commit the staged index. Mounted in the Files panel footer; the HEAD
  "+" affordance can surface it too in a later refinement.
-->
<script lang="ts">
  import { createCommit, errorText, gitIdentityStatus } from '../lib/ipc';
  import type { IdentityStatus } from '../lib/ipc';
  import { t } from '../lib/i18n/index.svelte';
  import type { TutorialAction } from '../lib/tutorial/types';

  let {
    repoPath,
    stagedCount = 0,
    onCommitted = () => {},
    guard,
    beforeCommit,
  }: {
    repoPath: string;
    stagedCount?: number;
    onCommitted?: (sha: string) => void;
    /** Guided tutorial: asked BEFORE the commit runs (`commit`). `false` means
     *  "swallow it". Absent ⇒ always allowed. */
    guard?: (a: TutorialAction) => boolean;
    /** Auto-pull gate: awaited AFTER `guard` and BEFORE anything is staged or
     *  committed. `false` means the commit is abandoned — the gate has already
     *  told the user why, so nothing is shown inline. Absent ⇒ no gate. */
    beforeCommit?: () => Promise<boolean>;
  } = $props();

  let message = $state('');
  let committing = $state(false);
  let error = $state<string | null>(null);

  // Which identity this commit would carry. A configured `user.email`
  // always wins and needs no comment; when git has none and the ADGitter
  // account address is standing in, the user is told *before* they commit —
  // silently authoring as a different address is exactly what the revised
  // decision forbids, since the author is permanent and mirrored everywhere.
  let identity = $state<IdentityStatus | null>(null);

  $effect(() => {
    const path = repoPath;
    let stale = false;
    // Re-read per repo: `user.email` is per-repo, so the answer changes with it.
    // A failure here must not block committing — the notice just stays hidden.
    void gitIdentityStatus(path)
      .then((s) => {
        if (!stale) identity = s;
      })
      .catch(() => {
        if (!stale) identity = null;
      });
    return () => {
      stale = true;
    };
  });

  const usingAccountEmail = $derived(
    identity?.source === 'account' && !!identity.email,
  );

  const canCommit = $derived(
    !!message.trim() && stagedCount > 0 && !committing,
  );

  async function commit() {
    if (!canCommit) return;
    if (guard && !guard({ kind: 'commit' })) return;
    committing = true;
    error = null;
    try {
      if (beforeCommit && !(await beforeCommit())) return;
      const sha = await createCommit(repoPath, message);
      message = '';
      onCommitted(sha);
    } catch (e) {
      error = errorText(e);
    } finally {
      committing = false;
    }
  }
</script>

<div class="commit" data-tutorial="commit-bar">
  {#if error}<div class="err" role="alert">{error}</div>{/if}
  {#if usingAccountEmail}
    <p class="identity" data-testid="account-identity-notice">
      {t('commit.usingAccountEmail', { email: identity?.email ?? '' })}
      <span class="how">{t('commit.usingAccountEmailHow')}</span>
    </p>
  {/if}
  <textarea
    bind:value={message}
    placeholder={t('commit.message')}
    rows="2"
    aria-label={t('commit.message')}
  ></textarea>
  <button class="btn" disabled={!canCommit} onclick={commit}>
    {committing
      ? t('commit.creating')
      : stagedCount > 0
        ? t('commit.commitStaged', { count: stagedCount })
        : t('commit.nothingStaged')}
  </button>
</div>

<style>
  .commit {
    border-top: 1px solid var(--panel-border);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .err {
    font-size: 11px;
    color: var(--lane-7);
  }
  .identity {
    margin: 0;
    font-size: 11px;
    line-height: 1.4;
    color: var(--fg-muted);
  }
  .identity .how {
    display: block;
    opacity: 0.85;
  }
  textarea {
    resize: vertical;
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    padding: 8px 10px;
    font: inherit;
    font-size: 12px;
    outline: none;
  }
  .btn {
    border: 0;
    background: var(--select-ring);
    color: #fff;
    height: 30px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
