<!-- Dark top bar: repo name · search · settings + user (mockup: main screen). -->
<script lang="ts">
  import { t } from '../lib/i18n/index.svelte';
  import type { Commit, RefList } from '../lib/ipc';
  import type { SearchIssue } from '../lib/search';
  import SearchBox from './SearchBox.svelte';
  import Icon from '../lib/icons/Icon.svelte';
  let {
    repoName = null,
    commits = [],
    refs = null,
    issues = [],
    onSearchSelect = () => {},
    onSearchSelectIssue = () => {},
    onSettings = () => {},
    onUser = () => {},
    onBack = () => {},
  }: {
    repoName?: string | null;
    commits?: Commit[];
    refs?: RefList | null;
    /** Bound-tracker issues for the `assignee` search scope. */
    issues?: SearchIssue[];
    onSearchSelect?: (sha: string) => void;
    onSearchSelectIssue?: (issueId: string) => void;
    onSettings?: () => void;
    onUser?: () => void;
    /** Return to the entry screen to pick another repository. */
    onBack?: () => void;
  } = $props();
</script>

<header class="topbar">
  <div class="left">
    <button
      class="back-repo"
      title={t('topbar.back')}
      aria-label={t('topbar.back')}
      onclick={onBack}
    >
      <span class="back-glyph" aria-hidden="true"
        ><Icon name="back" size={15} /></span
      >
      <span class="repo">{repoName ?? t('topbar.repoFallback')}</span>
    </button>
  </div>

  <SearchBox
    {commits}
    {refs}
    {issues}
    onSelect={onSearchSelect}
    onSelectIssue={onSearchSelectIssue}
  />

  <div class="actions">
    <button
      class="icon-btn gear"
      data-tutorial="topbar-settings"
      title={t('topbar.settings')}
      onclick={onSettings}><Icon name="settings" size={15} /></button
    >
    <button class="icon-btn avatar" title={t('topbar.account')} onclick={onUser}
      ><span class="dot"></span></button
    >
  </div>
</header>

<style>
  .topbar {
    height: 38px;
    flex: 0 0 auto;
    background: var(--topbar-bg);
    color: var(--topbar-fg);
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    padding: 0 12px;
    gap: 12px;
    -webkit-app-region: drag;
  }
  .left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .back-repo {
    -webkit-app-region: no-drag;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    max-width: 100%;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    padding: 2px 10px 2px 2px;
    border-radius: 15px;
    cursor: pointer;
  }
  .back-repo:hover {
    background: rgba(255, 255, 255, 0.12);
  }
  .back-repo:hover .back-glyph {
    background: #ececec;
  }
  .back-repo:focus-visible {
    outline: 2px solid var(--select-ring, #7a5fb0);
    outline-offset: 2px;
  }
  .back-glyph {
    flex: 0 0 auto;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: #d7d7d7;
    color: #444;
    font-size: 16px;
    line-height: 1;
    display: grid;
    place-items: center;
  }
  .repo {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 13px;
    font-weight: 500;
    padding-left: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .actions {
    -webkit-app-region: no-drag;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }
  .icon-btn {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 0;
    cursor: pointer;
    display: grid;
    place-items: center;
    font-size: 14px;
  }
  .gear {
    background: #d7d7d7;
    color: #444;
  }
  .avatar {
    background: #c9b8e8;
    padding: 0;
  }
  .avatar .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #7a5fb0;
    display: block;
  }
</style>
