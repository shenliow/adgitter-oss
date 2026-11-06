<!--
  Clone-remote dialog: Project Label, Git URL, target Location (+browse),
  and an optional personal access token. Git hosts no longer accept account
  passwords over HTTPS (GitHub since 2021; Bitbucket retired app passwords in
  2026), so the only secret this dialog asks for is a PAT — the matching Basic-
  auth username is inferred from the URL's host (see lib/gitHosts). Left empty,
  public https repos clone anonymously and ssh:// / git@ URLs use the system's
  SSH agent/keys. Shows transfer progress while cloning.
-->
<script lang="ts">
  import type { CloneAuth } from '../lib/ipc';
  import { patUsernameFor } from '../lib/gitHosts';
  import { t } from '../lib/i18n/index.svelte';

  let {
    busy = false,
    progress = null,
    onBrowse,
    onClone,
    onCancel,
  }: {
    busy?: boolean;
    progress?: { received: number; total: number } | null;
    onBrowse: () => Promise<string | null>;
    onClone: (args: {
      url: string;
      dest: string;
      label: string;
      auth: CloneAuth;
    }) => void;
    onCancel: () => void;
  } = $props();

  let label = $state('');
  let url = $state('');
  let dest = $state('');
  let pat = $state('');

  const ready = $derived(
    url.trim().length > 0 && dest.trim().length > 0 && !busy,
  );

  /** Recents display name: the label, else the repo name from the URL. */
  function repoName(u: string): string {
    const tail = u.trim().replace(/\/+$/, '').split(/[/\\]/).pop() ?? '';
    return tail.replace(/\.git$/, '') || 'repository';
  }

  function buildAuth(): CloneAuth {
    const token = pat.trim();
    if (!token) return { kind: 'none' };
    return { kind: 'password', username: patUsernameFor(url), password: token };
  }

  async function browse() {
    const picked = await onBrowse();
    if (picked) dest = picked;
  }

  function clone() {
    if (!ready) return;
    onClone({
      url: url.trim(),
      dest: dest.trim(),
      label: label.trim() || repoName(url),
      auth: buildAuth(),
    });
  }

  const pct = $derived(
    progress && progress.total > 0
      ? Math.round((progress.received / progress.total) * 100)
      : null,
  );
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape' && !busy) onCancel();
  }}
/>

<div class="overlay">
  <button class="scrim" aria-label={t('common.cancel')} onclick={onCancel}
  ></button>
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-label={t('clone.title')}
  >
    <div class="field">
      <label for="cl-label">{t('clone.projectLabel')}</label>
      <input
        id="cl-label"
        bind:value={label}
        placeholder={t('clone.projectPlaceholder')}
      />
    </div>

    <div class="field">
      <label for="cl-url">{t('clone.gitUrl')}</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        id="cl-url"
        autofocus
        bind:value={url}
        placeholder="https://github.com/user/repo.git"
      />
    </div>

    <div class="field">
      <label for="cl-dest">{t('clone.location')}</label>
      <div class="row">
        <input
          id="cl-dest"
          bind:value={dest}
          placeholder={t('clone.locationPlaceholder')}
        />
        <button
          class="browse"
          onclick={browse}
          disabled={busy}
          title={t('common.browse')}>…</button
        >
      </div>
    </div>

    <div class="field">
      <label for="cl-pat">{t('clone.pat')}</label>
      <input
        id="cl-pat"
        type="password"
        bind:value={pat}
        placeholder="ghp_… / glpat-… / ATATT…"
      />
      <p class="hint">{t('clone.patHint')}</p>
    </div>

    {#if busy}
      <div class="progress" aria-live="polite">
        <div class="track">
          <div class="bar" style="width:{pct ?? 5}%"></div>
        </div>
        <span class="pctlabel"
          >{pct !== null
            ? `${t('clone.cloning')} ${pct}%`
            : t('clone.cloning')}</span
        >
      </div>
    {/if}

    <div class="actions">
      <button class="ghost" onclick={onCancel} disabled={busy}
        >{t('common.cancel')}</button
      >
      <button class="primary" onclick={clone} disabled={!ready}>
        {busy ? '…' : t('common.create')}
      </button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .scrim {
    position: absolute;
    inset: 0;
    border: 0;
    padding: 0;
    background: rgba(0, 0, 0, 0.32);
    cursor: default;
  }
  .dialog {
    position: relative;
    z-index: 1;
    width: 440px;
    max-width: calc(100vw - 32px);
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    box-shadow: var(--panel-shadow);
    padding: 18px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 12px;
  }
  .field label {
    font-size: 12px;
    color: var(--fg-soft);
  }
  input {
    height: 30px;
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    padding: 0 10px;
    font: inherit;
    font-size: 13px;
  }
  .row {
    display: flex;
    gap: 6px;
  }
  .row input {
    flex: 1;
  }
  .browse {
    width: 34px;
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    background: var(--row-hover);
    cursor: pointer;
    font-size: 14px;
  }
  .hint {
    margin: 2px 0 0;
    font-size: 11px;
    color: var(--fg-muted);
  }
  .progress {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
  }
  .track {
    height: 6px;
    background: var(--row-hover);
    border-radius: 999px;
    overflow: hidden;
  }
  .bar {
    height: 100%;
    background: var(--select-ring);
    transition: width 0.15s;
  }
  .pctlabel {
    font-size: 11px;
    color: var(--fg-soft);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .actions button {
    height: 30px;
    padding: 0 16px;
    border-radius: 8px;
    border: 0;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .ghost {
    background: var(--row-hover);
    color: var(--fg);
  }
  .primary {
    background: var(--select-ring);
    color: #fff;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
