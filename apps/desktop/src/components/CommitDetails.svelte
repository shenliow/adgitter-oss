<!--
  Right slide-over: selected commit details (mockup: commit details).
  Header + description + filtered changed-file tree + footer (branch/hash/date).
-->
<script lang="ts">
  import type { Commit, FileChange, RepoStatus, StatusEntry } from '../lib/ipc';
  import { fileHistory, errorText, openPath, repoStatus } from '../lib/ipc';
  import { buildFileTree, type TreeNode } from '../lib/fileTree';
  import { fullTimestamp } from '../lib/format';
  import Avatar from './Avatar.svelte';
  import FileTree from './FileTree.svelte';
  import ConfirmRewrite from './ConfirmRewrite.svelte';
  import ResizeHandle from './ResizeHandle.svelte';
  import { loadPanelWidth, savePanelWidth } from '../lib/panelWidth';
  import { t } from '../lib/i18n/index.svelte';
  import Icon from '../lib/icons/Icon.svelte';
  import {
    defaultTokenClient,
    copyToClipboard,
    type TokenClient,
    type TokenMeta,
  } from '../lib/integrations/tokens';
  import { PROVIDER_KEY } from '../lib/integrations/labels';
  import {
    providerClient,
    isMrProvider,
    type MrProvider,
    type ProviderRef,
  } from '../lib/integrations/providers';
  import {
    AuthError,
    notConfiguredTransport,
    type Transport,
  } from '../lib/http/transport';
  import type { IconName } from '../lib/icons/windows';
  import type { TutorialAction } from '../lib/tutorial/types';

  let {
    commit,
    files = [],
    filesLoading = false,
    filesError = null,
    branch = null,
    repoPath = null,
    gitConfigured = false,
    onClose = () => {},
    onOpenDiff,
    onSelectCommit,
    onReword,
    onPurgeFile,
    onAddFile,
    tokenClient = defaultTokenClient,
    providerTransport = notConfiguredTransport,
    linkedIssue = null,
    onOpenIssue,
    guard,
  }: {
    commit: Commit;
    files?: FileChange[];
    filesLoading?: boolean;
    filesError?: string | null;
    branch?: string | null;
    /** Open repo — enables the per-file history action. */
    repoPath?: string | null;
    /** The repo's remote is an HTTPS (PAT-capable) target.
     *  When true, the "add a GitHub/GitLab token" nag is suppressed — git is
     *  already configured, so nagging to add one is misleading. */
    gitConfigured?: boolean;
    onClose?: () => void;
    /** Click a changed file (or its diff icon) → open its diff for this commit. */
    onOpenDiff?: (path: string) => void;
    /** Jump the graph to a commit chosen from a file's history. */
    onSelectCommit?: (sha: string) => void;
    /**
     * Reword the displayed commit inline. When absent, no edit affordance is
     * shown at all — this keeps the panel read-only by default.
     */
    onReword?: (message: string) => Promise<void>;
    /**
     * Purge a file from this commit's tree and every descendant up to the
     * branch tip — DESTRUCTIVE (a large edit: rewrites this commit and all of
     * its descendants). The confirm gate (ConfirmRewrite) lives right here in
     * the panel; this callback only runs once the user has confirmed, and the
     * actual mutating IPC call lives with the caller (mirrors onReword: the
     * caller performs the git-core call + refreshes the graph). When absent,
     * no purge icon is shown at all.
     */
    onPurgeFile?: (sha: string, path: string) => Promise<void>;
    /**
     * Write a working-tree file's current content into this commit's tree
     * and replay every descendant up to the branch tip — a large edit (a
     * mass rewrite of this commit and all of its descendants), same class of
     * operation as purge, just adding rather than erasing. The confirm gate
     * (ConfirmRewrite) lives right here in the panel; this callback only
     * runs once the user has confirmed and picked a file from the working-
     * tree picker, and the actual mutating IPC call lives with the caller
     * (mirrors onPurgeFile). When absent, no add-file affordance is shown at
     * all.
     */
    onAddFile?: (sha: string, path: string) => Promise<void>;
    /** Token source — used to gate + auth Create MR/Issue (injectable). */
    tokenClient?: TokenClient;
    /** Transport the provider client sends over. */
    providerTransport?: Transport;
    /** The issue linked to this commit's branch (issue-auto-branch feature),
     *  looked up by the caller from the per-repo config (mirrors
     *  `IssueBranchLink`). `null`/absent → no linked-issue row is rendered at
     *  all, and the "Create Issue" row (gated on `mrTokens`) takes its place. */
    linkedIssue?: {
      title: string;
      issueNumber: number;
      provider: string;
    } | null;
    /** Click the linked-issue row → open + select that issue. */
    onOpenIssue?: () => void;
    /** Guided tutorial: asked BEFORE an edit/rewrite starts (`reword` when the
     *  message editor opens, `purge` before its confirm, `addFile` once a file
     *  is picked) and before the panel's side doors (`other:details:…`).
     *  `false` means "swallow it". Absent ⇒ always allowed. */
    guard?: (a: TutorialAction) => boolean;
  } = $props();

  /** Tutorial gate: with no `guard` prop everything is allowed. */
  function allowed(a: TutorialAction): boolean {
    return guard ? guard(a) : true;
  }

  // Drag-to-resize width; persisted so it survives reselecting a commit.
  let width = $state(loadPanelWidth('details', 350));

  let filter = $state('');
  const filtered = $derived(
    filter.trim()
      ? files.filter((f) =>
          f.path.toLowerCase().includes(filter.trim().toLowerCase()),
        )
      : files,
  );
  const tree = $derived(buildFileTree(filtered) as TreeNode[]);

  // ── Inline reword ───────────────────────────────────────
  // Only offered when the parent wires `onReword`; edit mode swaps the
  // subject + body display for a single textarea seeded with the full
  // message, mirroring the context-menu reword dialog's message field.
  let editing = $state(false);
  let draftMessage = $state('');
  let saving = $state(false);
  let editError = $state<string | null>(null);
  const saveDisabled = $derived(saving || draftMessage.trim().length === 0);

  // A new selection (different commit) should never leave a stale edit open.
  $effect(() => {
    void commit.sha;
    editing = false;
    draftMessage = '';
    editError = null;
    saving = false;
    copiedField = null;
    clearTimeout(copyResetTimer);
    purgeTarget = null;
    purgeError = null;
    purgeBusy = false;
    fileActionError = null;
    addFilePickerOpen = false;
    addFileCandidates = [];
    addFileTarget = null;
    addFileError = null;
    addFileBusy = false;
  });

  function startEdit() {
    if (!onReword) return;
    if (!allowed({ kind: 'reword', sha: commit.sha })) return;
    draftMessage = commit.subject + (commit.body ? '\n\n' + commit.body : '');
    editError = null;
    editing = true;
  }

  function cancelEdit() {
    editing = false;
    editError = null;
  }

  async function saveEdit() {
    if (!onReword || saveDisabled) return;
    saving = true;
    editError = null;
    try {
      await onReword(draftMessage);
      editing = false;
    } catch (e) {
      editError = errorText(e);
    } finally {
      saving = false;
    }
  }

  function onEditKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void saveEdit();
    }
  }

  // ── Copy branch / hash (footer, click-to-copy) ─────────────────────────────
  // The hash button copies the FULL sha (the value people paste into git
  // commands) even though only the short sha is displayed.
  let copiedField = $state<'branch' | 'hash' | null>(null);
  let copyResetTimer: ReturnType<typeof setTimeout> | undefined;

  function flashCopied(field: 'branch' | 'hash') {
    copiedField = field;
    clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => {
      copiedField = null;
    }, 1500);
  }

  async function copyBranch() {
    if (!branch) return;
    if (await copyToClipboard(branch)) flashCopied('branch');
  }

  async function copyHash() {
    if (await copyToClipboard(commit.sha)) flashCopied('hash');
  }

  // ── Per-file history ────────────────────────────────────────────
  // A small popover listing the commits that changed a file; picking one jumps
  // the graph. Only offered when a repo path + a jump handler are wired.
  let historyPath = $state<string | null>(null);
  let historyCommits = $state<Commit[]>([]);
  let historyLoading = $state(false);

  async function openHistory(path: string) {
    if (!repoPath) return;
    if (!allowed({ kind: 'other', name: 'details:history' })) return;
    historyPath = path;
    historyLoading = true;
    historyCommits = [];
    try {
      historyCommits = await fileHistory(repoPath, path);
    } catch {
      historyCommits = [];
    } finally {
      historyLoading = false;
    }
  }
  function closeHistory() {
    historyPath = null;
    historyCommits = [];
  }
  function pickHistory(sha: string) {
    onSelectCommit?.(sha);
    closeHistory();
  }

  // ── Open in default editor (mirrors FilesPanel's Changes-panel affordance) ──
  // Read-only, so unlike the mutating actions below it needs no confirmation
  // and no graph refresh — just hand the path to the OS and surface failure.
  let fileActionError = $state<string | null>(null);

  async function openFile(path: string) {
    if (!repoPath) return;
    if (!allowed({ kind: 'other', name: 'details:open-file' })) return;
    fileActionError = null;
    try {
      await openPath(repoPath, path);
    } catch (e) {
      fileActionError = errorText(e);
    }
  }

  // ── Purge this file from history (destructive) ──────────────────────────────
  // The confirm gate (ConfirmRewrite, same component every other history-
  // rewriting op uses) lives here so the warning — and the fact that it's
  // gated at all — is unit-testable; the actual purge_path IPC call is made
  // by the caller via `onPurgeFile` (mirrors onReword), which also owns the
  // undo/refresh/notice bookkeeping once it resolves.
  let purgeTarget = $state<string | null>(null);
  let purgeBusy = $state(false);
  let purgeError = $state<string | null>(null);

  function requestPurge(path: string) {
    if (!onPurgeFile) return;
    if (!allowed({ kind: 'purge', sha: commit.sha, path })) return;
    purgeTarget = path;
    purgeError = null;
  }

  function cancelPurge() {
    purgeTarget = null;
    purgeError = null;
  }

  async function confirmPurge() {
    if (!purgeTarget || !onPurgeFile) return;
    purgeBusy = true;
    purgeError = null;
    try {
      await onPurgeFile(commit.sha, purgeTarget);
      purgeTarget = null;
    } catch (e) {
      purgeError = errorText(e);
    } finally {
      purgeBusy = false;
    }
  }

  // ── Add a working-tree file into this commit (destructive) ──────────────────
  // Mirrors the purge flow above in reverse: pick a changed working-tree file
  // from a small popover (mirrors the per-file history popover's structure),
  // then gate behind the same ConfirmRewrite mass-edit warning. The actual
  // add_file_to_commit IPC call is made by the caller via `onAddFile`.
  let addFilePickerOpen = $state(false);
  let addFileCandidates = $state<StatusEntry[]>([]);
  let addFileLoading = $state(false);
  let addFileTarget = $state<string | null>(null);
  let addFileBusy = $state(false);
  let addFileError = $state<string | null>(null);

  /** staged ∪ changed ∪ untracked, deduped by path, minus deletions (their
   * content can't be read to write into the historic tree). */
  function collectAddFileCandidates(status: RepoStatus): StatusEntry[] {
    const seen = new Map<string, StatusEntry>();
    for (const group of [status.staged, status.changed, status.untracked]) {
      for (const entry of group) {
        if (entry.status === 'deleted') continue;
        if (!seen.has(entry.path)) seen.set(entry.path, entry);
      }
    }
    return [...seen.values()];
  }

  async function openAddFilePicker() {
    if (!repoPath || !onAddFile) return;
    addFilePickerOpen = true;
    addFileLoading = true;
    addFileCandidates = [];
    try {
      addFileCandidates = collectAddFileCandidates(await repoStatus(repoPath));
    } catch {
      addFileCandidates = [];
    } finally {
      addFileLoading = false;
    }
  }

  function closeAddFilePicker() {
    addFilePickerOpen = false;
    addFileCandidates = [];
  }

  function pickAddFile(path: string) {
    if (!allowed({ kind: 'addFile', sha: commit.sha, path })) return;
    addFilePickerOpen = false;
    addFileCandidates = [];
    addFileTarget = path;
    addFileError = null;
  }

  function cancelAddFile() {
    addFileTarget = null;
    addFileError = null;
  }

  async function confirmAddFile() {
    if (!addFileTarget || !onAddFile) return;
    addFileBusy = true;
    addFileError = null;
    try {
      await onAddFile(commit.sha, addFileTarget);
      addFileTarget = null;
    } catch (e) {
      addFileError = errorText(e);
    } finally {
      addFileBusy = false;
    }
  }

  // ── Create MR / Issue ─────────────────────────────────────
  // Only GitHub/GitLab tokens can open a merge request or issue.
  let mrTokens = $state<TokenMeta[]>([]);
  $effect(() => {
    let alive = true;
    tokenClient
      .list()
      .then((all) => {
        if (alive) mrTokens = all.filter((tok) => isMrProvider(tok.provider));
      })
      .catch(() => {
        if (alive) mrTokens = [];
      });
    return () => {
      alive = false;
    };
  });

  type ComposeKind = 'mr' | 'issue';
  let compose = $state<ComposeKind | null>(null);
  let composeTitle = $state('');
  let composeTarget = $state('main');
  let selectedTokenId = $state('');
  let submitting = $state(false);
  let result = $state<ProviderRef | null>(null);
  let actionError = $state<string | null>(null);

  const selectedToken = $derived(
    mrTokens.find((tok) => tok.id === selectedTokenId) ?? mrTokens[0],
  );

  function openCompose(kind: ComposeKind) {
    if (!allowed({ kind: 'other', name: `details:compose-${kind}` })) return;
    compose = kind;
    composeTitle = commit.subject || '';
    composeTarget = 'main';
    selectedTokenId = mrTokens[0]?.id ?? '';
    result = null;
    actionError = null;
  }

  function closeCompose() {
    compose = null;
    submitting = false;
  }

  async function submitCompose() {
    const tok = selectedToken;
    const kind = compose;
    if (!tok || !kind || !composeTitle.trim() || submitting) return;
    submitting = true;
    actionError = null;
    result = null;
    try {
      // TODO: the live call routes the token-bearing request through
      // the license server (which holds the decrypted secret); here the token id stands
      // in and the transport is not-configured in dev/CI.
      const client = providerClient(
        tok.provider as MrProvider,
        tok.id,
        providerTransport,
      );
      result =
        kind === 'mr'
          ? await client.createMergeRequest({
              title: composeTitle.trim(),
              sourceBranch: branch ?? commit.short_sha,
              targetBranch: composeTarget.trim() || 'main',
              body: commit.body,
            })
          : await client.createIssue({
              title: composeTitle.trim(),
              body: commit.body,
            });
    } catch (e) {
      actionError =
        e instanceof AuthError
          ? t('integration.authError')
          : t('integration.failed');
    } finally {
      submitting = false;
    }
  }

  // ── Provider icon (placeholder pending brand artwork) ──────────────────────
  // The sprite has no per-provider brand icons yet (Jira/Asana/GitHub/GitLab
  // logos) — every IssueProviderKind deliberately maps to the same generic
  // glyph below. Routing icon selection through this one function (instead of
  // hardcoding `<Icon name="issues">` at each call site) means the future swap
  // to real brand glyphs is a one-line edit here instead of a hunt through the
  // template; call sites already have the provider kind in scope.
  function providerIconName(_kind: string): IconName {
    return 'issues';
  }
</script>

<aside class="panel" data-tutorial="commit-details" style="width:{width}px">
  <ResizeHandle
    side="left"
    bind:width
    label={t('panel.resize')}
    onCommit={(w) => savePanelWidth('details', w)}
  />
  <header class="head">
    <Avatar name={commit.author_name} email={commit.author_email} size={36} />
    <div class="title">
      {#if editing}
        <!-- subject + body are shown as a single textarea below while editing -->
      {:else if onReword}
        <button type="button" class="subject subject-edit" onclick={startEdit}>
          {commit.subject || '(no message)'}
        </button>
      {:else}
        <div class="subject">{commit.subject || '(no message)'}</div>
      {/if}
      <div class="email">
        {#if commit.author_name}{commit.author_name}{' '}{/if}{commit.author_email}
      </div>
    </div>
    {#if onReword && !editing}
      <button
        class="edit"
        data-tutorial="detail-reword"
        title={t('commitDetails.editMessage')}
        aria-label={t('commitDetails.editMessage')}
        onclick={startEdit}
      >
        <Icon name="edit" size={14} />
      </button>
    {/if}
    <button class="close" title={t('common.close')} onclick={onClose}
      ><Icon name="close" size={14} /></button
    >
  </header>

  {#if editing}
    <div class="edit-body">
      <!-- svelte-ignore a11y_autofocus -->
      <textarea
        class="edit-textarea"
        autofocus
        disabled={saving}
        bind:value={draftMessage}
        onkeydown={onEditKeydown}
      ></textarea>
      {#if editError}<p class="msg err">{editError}</p>{/if}
      <div class="edit-actions">
        <button class="ghost" onclick={cancelEdit} disabled={saving}
          >{t('common.cancel')}</button
        >
        <button class="primary" onclick={saveEdit} disabled={saveDisabled}>
          {saving ? '…' : t('commitDetails.save')}
        </button>
      </div>
    </div>
  {:else if commit.body}
    <p class="body">{commit.body}</p>
  {/if}

  <div class="actions">
    {#if mrTokens.length > 0}
      <button
        type="button"
        class="action-row mr-create"
        onclick={() => openCompose('mr')}
      >
        <Icon name="merge" size={14} />
        <span class="action-label">{t('integration.createMr')}</span>
      </button>
    {/if}

    <!--
      Issue row — two mutually exclusive states:
      - Branch already linked to an issue: this only SELECTS that issue in
        the local panel (onOpenIssue) — no network call — so it must render
        whenever `linkedIssue` is set, independently of `mrTokens` (a
        GitHub/GitLab PAT). Gating it on that token would hide "go to issue"
        for repos that never configured one, even though nothing here talks
        to a provider API.
      - Branch not linked: offering to CREATE a new issue DOES call a
        provider API, so this half keeps the original `mrTokens` gate.
    -->
    {#if linkedIssue}
      <button type="button" class="action-row issue-link" onclick={onOpenIssue}>
        <Icon name={providerIconName(linkedIssue.provider)} size={14} />
        <span class="action-label" title={t('commitDetails.linkedIssue')}>
          {linkedIssue.issueNumber != null
            ? `#${linkedIssue.issueNumber} ${linkedIssue.title}`
            : linkedIssue.title}
        </span>
      </button>
    {:else if mrTokens.length > 0}
      <button
        type="button"
        class="action-row issue-create"
        onclick={() => openCompose('issue')}
      >
        <Icon name={providerIconName(mrTokens[0].provider)} size={14} />
        <span class="action-label">{t('integration.createIssue')}</span>
      </button>
    {/if}

    {#if mrTokens.length === 0 && !gitConfigured}
      <!-- Only nag when git ISN'T configured: once the repo has an
           HTTPS remote, the hint is misleading, so it's suppressed. Shown
           regardless of `linkedIssue` — even once the linked issue's own
           link is visible above, a missing token still blocks BOTH create
           actions (MR always; Issue whenever the branch isn't linked yet). -->
      <p class="hint">{t('integration.noToken')}</p>
    {/if}
  </div>

  {#if compose}
    <div class="compose" role="dialog" aria-modal="true">
      <div class="compose-head">
        {compose === 'mr'
          ? t('integration.composeMr')
          : t('integration.composeIssue')}
      </div>
      {#if result}
        <p class="ok">
          {t('integration.created')}
          <a href={result.url} target="_blank" rel="noreferrer">{result.url}</a>
        </p>
        <div class="compose-foot">
          <button class="ghost" onclick={closeCompose}
            >{t('common.close')}</button
          >
        </div>
      {:else}
        <label class="fld">
          <span>{t('integration.titleField')}</span>
          <input bind:value={composeTitle} />
        </label>
        <label class="fld">
          <span>{t('integration.target')}</span>
          <select bind:value={selectedTokenId}>
            {#each mrTokens as tok (tok.id)}
              <option value={tok.id}
                >{t(PROVIDER_KEY[tok.provider])} · {tok.name}</option
              >
            {/each}
          </select>
        </label>
        {#if compose === 'mr'}
          <label class="fld">
            <span>{t('integration.targetBranch')}</span>
            <input bind:value={composeTarget} />
          </label>
        {/if}
        {#if actionError}<p class="err" role="alert">{actionError}</p>{/if}
        <div class="compose-foot">
          <button class="ghost" onclick={closeCompose}
            >{t('common.cancel')}</button
          >
          <button
            class="primary"
            disabled={submitting || !composeTitle.trim()}
            onclick={submitCompose}
          >
            {submitting ? t('integration.creating') : t('common.create')}
          </button>
        </div>
      {/if}
    </div>
  {/if}

  <div class="files-head">
    <div class="filter">
      <input placeholder={t('commitDetails.filter')} bind:value={filter} />
      <span class="ico" aria-hidden="true"
        ><Icon name="search" size={14} /></span
      >
    </div>
    {#if repoPath && onAddFile}
      <button
        type="button"
        class="act add-file"
        data-tutorial="detail-add-file"
        title={t('commitDetails.addFile')}
        aria-label={t('commitDetails.addFile')}
        onclick={openAddFilePicker}
      >
        {t('commitDetails.addFile')}
      </button>
    {/if}
  </div>

  <div class="files">
    {#if filesLoading}
      <p class="msg">{t('commitDetails.loading')}</p>
    {:else if filesError}
      <p class="msg err">{filesError}</p>
    {:else if filtered.length === 0}
      <p class="msg">{t('commitDetails.noChanges')}</p>
    {:else}
      <FileTree
        nodes={tree}
        onOpen={onOpenDiff}
        onOpenFile={repoPath ? openFile : undefined}
        onHistory={repoPath && onSelectCommit ? openHistory : undefined}
        onPurge={repoPath && onPurgeFile ? requestPurge : undefined}
      />
    {/if}
    {#if fileActionError}<p class="msg err">{fileActionError}</p>{/if}
  </div>

  {#if purgeTarget}
    <ConfirmRewrite
      title={t('op.purgeFile.title')}
      body={t('op.purgeFile.body', {
        path: purgeTarget,
        subject: commit.subject || commit.short_sha,
      })}
      confirmLabel={t('op.purgeFile.confirm')}
      danger={true}
      busy={purgeBusy}
      error={purgeError}
      onConfirm={confirmPurge}
      onCancel={cancelPurge}
    />
  {/if}

  {#if addFilePickerOpen}
    <div
      class="addfile-pop"
      role="dialog"
      aria-label={t('commitDetails.addFilePickerTitle')}
    >
      <div class="addfile-head">
        <span class="addfile-title"
          >{t('commitDetails.addFilePickerTitle')}</span
        >
        <button
          class="addfile-close"
          aria-label={t('common.close')}
          onclick={closeAddFilePicker}><Icon name="close" size={12} /></button
        >
      </div>
      <div class="addfile-body">
        {#if addFileLoading}
          <p class="msg">{t('commitDetails.loading')}</p>
        {:else if addFileCandidates.length === 0}
          <p class="msg">{t('commitDetails.addFileEmpty')}</p>
        {:else}
          {#each addFileCandidates as entry (entry.path)}
            <button
              class="addfile-item"
              onclick={() => pickAddFile(entry.path)}
            >
              <span class="addfile-path">{entry.path}</span>
              <span class="addfile-status">{entry.status}</span>
            </button>
          {/each}
        {/if}
      </div>
    </div>
    <div
      class="addfile-backdrop"
      onclick={closeAddFilePicker}
      role="presentation"
    ></div>
  {/if}

  {#if addFileTarget}
    <ConfirmRewrite
      title={t('op.addFile.title')}
      body={t('op.addFile.body', {
        path: addFileTarget,
        subject: commit.subject || commit.short_sha,
      })}
      confirmLabel={t('op.addFile.confirm')}
      danger={true}
      busy={addFileBusy}
      error={addFileError}
      onConfirm={confirmAddFile}
      onCancel={cancelAddFile}
    />
  {/if}

  {#if historyPath}
    <div class="hist-pop" role="dialog" aria-label={t('commitDetails.history')}>
      <div class="hist-head">
        <span class="hist-title" title={historyPath}>{historyPath}</span>
        <button
          class="hist-close"
          aria-label={t('common.close')}
          onclick={closeHistory}><Icon name="close" size={12} /></button
        >
      </div>
      <div class="hist-body">
        {#if historyLoading}
          <p class="msg">{t('commitDetails.loading')}</p>
        {:else if historyCommits.length === 0}
          <p class="msg">{t('commitDetails.historyEmpty')}</p>
        {:else}
          {#each historyCommits as h (h.sha)}
            <button class="hist-item" onclick={() => pickHistory(h.sha)}>
              <span class="hist-subj">{h.subject || h.short_sha}</span>
              <span class="hist-meta">
                <code>{h.short_sha}</code>
                <span class="date">{fullTimestamp(h.timestamp)}</span>
              </span>
            </button>
          {/each}
        {/if}
      </div>
    </div>
    <div class="hist-backdrop" onclick={closeHistory} role="presentation"></div>
  {/if}

  <footer class="foot">
    <div class="branch">
      <span aria-hidden="true"><Icon name="branch" size={13} /></span>
      {#if branch}
        <button
          type="button"
          class="copy-btn branch-btn"
          title={t('commitDetails.copyBranch', { branch })}
          aria-label={t('commitDetails.copyBranch', { branch })}
          onclick={copyBranch}
        >
          {copiedField === 'branch' ? t('commitDetails.copied') : branch}
        </button>
      {:else}
        <span>—</span>
      {/if}
    </div>
    <div class="meta">
      <!-- The linked-issue affordance lives in the .actions area now (see
           above) rather than here — showing it twice (once as a footer
           chip, once as an action row) would duplicate the same navigation
           in two places; the footer stays branch / hash / date only. -->
      <button
        type="button"
        class="copy-btn hash-btn"
        title={t('commitDetails.copyHash', { sha: commit.sha })}
        aria-label={t('commitDetails.copyHash', { sha: commit.sha })}
        onclick={copyHash}
      >
        <code
          >{copiedField === 'hash'
            ? t('commitDetails.copied')
            : commit.short_sha}</code
        >
      </button>
      <span class="date">{fullTimestamp(commit.timestamp)}</span>
    </div>
    <span class="sr-only" aria-live="polite"
      >{copiedField ? t('commitDetails.copied') : ''}</span
    >
  </footer>
</aside>

<style>
  .actions {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--panel-border);
  }
  /* Glyph + underlined text link (mockup: commit details — edit), not the
     boxed buttons this used to be — Create MergeRequest / Create Issue /
     the linked-issue link all read as one set of these. */
  .action-row {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    border: 0;
    background: transparent;
    padding: 0;
    color: var(--select-ring);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .action-row .action-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .action-row:hover .action-label {
    color: var(--fg);
  }
  .action-row:focus-visible {
    outline: 2px solid var(--select-ring);
    outline-offset: 2px;
    border-radius: 4px;
  }
  /* Still used by the unrelated "add file" affordance below (.act.add-file)
     — a boxed button, not one of the glyph+link .action-rows above. */
  .act {
    flex: 1;
    min-width: 120px;
    border: 1px solid var(--panel-border);
    background: var(--panel-bg);
    color: var(--fg-soft);
    height: 28px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .act:hover {
    background: var(--row-hover);
  }
  .hint {
    margin: 0;
    font-size: 11px;
    color: var(--fg-muted);
    line-height: 1.5;
  }
  .compose {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--panel-border);
    background: var(--row-hover);
  }
  .compose-head {
    font-size: 12px;
    font-weight: 600;
  }
  .fld {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 11px;
    color: var(--fg-muted);
  }
  .fld input,
  .fld select {
    height: 28px;
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    padding: 0 8px;
    font: inherit;
    font-size: 12px;
    outline: none;
    background: var(--panel-bg);
    color: var(--fg-soft);
  }
  .compose-foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 2px;
  }
  .compose-foot .ghost {
    border: 1px solid var(--panel-border);
    background: transparent;
    color: var(--fg-soft);
    height: 28px;
    padding: 0 12px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
  }
  .compose-foot .primary {
    border: 0;
    background: var(--select-ring);
    color: #fff;
    height: 28px;
    padding: 0 14px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .compose-foot .primary:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .ok {
    margin: 0;
    font-size: 12px;
    color: var(--fg-soft);
    word-break: break-all;
  }
  .ok a {
    color: var(--select-ring);
  }
  .err {
    margin: 0;
    font-size: 11px;
    color: var(--lane-7);
  }
  .panel {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 350px;
    background: var(--panel-bg);
    border-left: 1px solid var(--panel-border);
    box-shadow: var(--panel-shadow);
    display: flex;
    flex-direction: column;
    z-index: 6;
    /* Reserve the floating Toolbar's band so its issues/undo buttons overlay
       empty space instead of this panel's own header. */
    padding-top: var(--float-btn-band);
  }
  .head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 16px 14px 12px;
    border-bottom: 1px solid var(--panel-border);
  }
  .title {
    flex: 1;
    min-width: 0;
  }
  .subject {
    font-size: 13px;
    font-weight: 600;
    line-height: 1.3;
  }
  .subject-edit {
    display: block;
    width: 100%;
    border: 0;
    background: transparent;
    padding: 0;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .subject-edit:hover {
    text-decoration: underline;
  }
  .subject-edit:focus-visible {
    outline: 2px solid var(--select-ring);
    outline-offset: 1px;
  }
  .email {
    font-size: 11px;
    color: var(--fg-muted);
    text-align: right;
    margin-top: 4px;
  }
  .edit {
    border: 0;
    background: transparent;
    font-size: 14px;
    color: var(--fg-soft);
    cursor: pointer;
    line-height: 1;
    padding: 2px;
    flex: 0 0 auto;
  }
  .edit:hover {
    color: var(--fg);
  }
  .close {
    border: 0;
    background: transparent;
    font-size: 18px;
    color: #888;
    cursor: pointer;
    line-height: 1;
  }
  .body {
    margin: 0;
    padding: 12px 16px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--fg-soft);
    white-space: pre-wrap;
    word-break: break-word;
    border-bottom: 1px solid var(--panel-border);
    max-height: 160px;
    overflow-y: auto;
  }
  .edit-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--panel-border);
  }
  .edit-textarea {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    min-height: 90px;
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    padding: 8px;
    font: inherit;
    font-size: 12px;
    background: var(--panel-bg);
    color: var(--fg);
  }
  .edit-textarea:disabled {
    opacity: 0.6;
  }
  .edit-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .edit-actions .ghost {
    border: 1px solid var(--panel-border);
    background: transparent;
    color: var(--fg-soft);
    height: 28px;
    padding: 0 12px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
  }
  .edit-actions .primary {
    border: 0;
    background: var(--select-ring);
    color: #fff;
    height: 28px;
    padding: 0 14px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .edit-actions button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .files-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px 8px;
  }
  .files-head .filter {
    flex: 1;
    min-width: 0;
    padding: 0;
  }
  .add-file {
    flex: 0 0 auto;
    min-width: 0;
    padding: 0 12px;
    white-space: nowrap;
  }
  .filter {
    position: relative;
    /* Flex, so the box the icon centres against is exactly the input's 30px.
       As a plain block it would be a line box wrapping an inline-block input,
       i.e. 30px plus a few px of descender slack, and `top: 50%` would sit
       the icon visibly low. */
    display: flex;
    align-items: center;
  }
  .filter input {
    width: 100%;
    /* The input is a flex item now, and an <input>'s automatic minimum size
       comes from its `size` attribute (~20 characters), not from `width`.
       Without this it refuses to shrink past ~170px and overflows the dock
       once the panel is dragged narrow. */
    min-width: 0;
    height: 30px;
    border: 1px solid var(--panel-border);
    border-radius: 999px;
    padding: 0 32px 0 14px;
    font-size: 12px;
    outline: none;
  }
  /* Centred, not baseline-nudged. This used to hold the text glyph `⌕`, and
     `right: 26px; top: 18px` were tuned to that character's metrics — its
     advance width and baseline. The icon swap replaced it with a 14px <Icon>
     box, for which those offsets mean something else entirely: a 14px box at
     `top: 18px` runs to y=32 inside a 30px-tall input, so the magnifier hung
     out the bottom of the search field. Centre it instead of re-tuning a
     magic number, and size the gutter off the input's own 32px right padding
     ((32 - 14) / 2 = 9px) so the two stay in step. */
  .filter .ico {
    position: absolute;
    right: 9px;
    top: 50%;
    transform: translateY(-50%);
    /* Kills the inline line-box slack around the svg, so the span is exactly
       the icon's 14px and the centring is honest. */
    display: inline-flex;
    /* Themed, not a hardcoded grey: #999 is invisible-ish on some dark
       surfaces and ignores a theme switch. */
    color: var(--fg-muted);
  }
  .files {
    flex: 1;
    overflow-y: auto;
    padding: 0 10px 10px;
  }
  .msg {
    font-size: 12px;
    color: var(--fg-muted);
    padding: 8px;
  }
  .msg.err {
    color: var(--lane-7);
  }
  .foot {
    border-top: 1px solid var(--panel-border);
    padding: 10px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    color: var(--fg-soft);
  }
  .branch {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .meta code {
    font-family: var(--mono);
    background: var(--row-hover);
    padding: 2px 6px;
    border-radius: 4px;
  }
  .date {
    color: var(--fg-muted);
  }
  .copy-btn {
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    padding: 1px 4px;
    margin: -1px -4px;
    border-radius: 4px;
    cursor: pointer;
  }
  .copy-btn:hover {
    background: var(--row-hover);
    text-decoration: underline;
  }
  .hash-btn:hover code {
    background: var(--panel-border);
  }
  .copy-btn:focus-visible {
    outline: 2px solid var(--select-ring);
    outline-offset: 1px;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* Per-file history popover */
  .hist-backdrop {
    position: fixed;
    inset: 0;
    z-index: 44;
  }
  .hist-pop {
    position: absolute;
    right: 16px;
    bottom: 64px;
    width: 300px;
    max-height: 50%;
    display: flex;
    flex-direction: column;
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: 10px;
    box-shadow: var(--panel-shadow);
    z-index: 45;
    overflow: hidden;
  }
  .hist-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--panel-border);
  }
  .hist-title {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
  }
  .hist-close {
    flex: 0 0 auto;
    border: 0;
    background: transparent;
    color: var(--fg-soft);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
  }
  .hist-body {
    overflow-y: auto;
    padding: 4px;
  }
  .hist-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    text-align: left;
    border: 0;
    background: transparent;
    color: inherit;
    font-family: inherit;
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
  }
  .hist-item:hover {
    background: var(--row-hover);
  }
  .hist-subj {
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hist-meta {
    display: flex;
    gap: 8px;
    font-size: 10px;
    color: var(--fg-muted);
    font-family: var(--mono);
  }

  /* Add-file-from-working-tree picker popover (mirrors .hist-*) */
  .addfile-backdrop {
    position: fixed;
    inset: 0;
    z-index: 44;
  }
  .addfile-pop {
    position: absolute;
    right: 16px;
    bottom: 64px;
    width: 300px;
    max-height: 50%;
    display: flex;
    flex-direction: column;
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: 10px;
    box-shadow: var(--panel-shadow);
    z-index: 45;
    overflow: hidden;
  }
  .addfile-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--panel-border);
  }
  .addfile-title {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .addfile-close {
    flex: 0 0 auto;
    border: 0;
    background: transparent;
    color: var(--fg-soft);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
  }
  .addfile-body {
    overflow-y: auto;
    padding: 4px;
  }
  .addfile-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    text-align: left;
    border: 0;
    background: transparent;
    color: inherit;
    font-family: inherit;
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
  }
  .addfile-item:hover {
    background: var(--row-hover);
  }
  .addfile-path {
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .addfile-status {
    flex: 0 0 auto;
    font-size: 10px;
    color: var(--fg-muted);
    font-family: var(--mono);
  }
</style>
