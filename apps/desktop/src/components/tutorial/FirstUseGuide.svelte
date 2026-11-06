<!--
  First-use guide: four pages shown once per machine after the
  tutorial (or "use directly"): (1) start with a repository, (2) connect a
  remote, (3) personal access tokens by provider — git hosts, then issue
  trackers when the build has them — each with required scopes, creation steps and an "open token
  page" button, (4) all set.

  Token pages open in the system browser through `openExternalUrl` — never an
  <a href>, which would navigate the WebView itself. URLs come from
  ./firstUseProviders.ts (and the issue tracker), which derive them from the
  same helpers Settings uses. Pure presentation otherwise: closing is the `onClose` callback.
-->
<script lang="ts">
  import { t } from '../../lib/i18n/index.svelte';
  import { openExternalUrl } from '../../lib/ipc';
  import Icon from '../../lib/icons/Icon.svelte';
  import { pro } from '../../lib/pro';
  import { gitTokenProviders, type TokenProvider } from './firstUseProviders';

  let { onClose }: { onClose: () => void } = $props();

  const PAGES = 4;
  let page = $state(1);
  let tab = $state<'git' | 'issues'>('git');

  const gitProviders = gitTokenProviders();
  // Only a build with the issue tracker has trackers to explain.
  const issueProviders = pro?.issueTokenProviders() ?? [];
  const providers = $derived(tab === 'git' ? gitProviders : issueProviders);

  /** Steps are stored as one "\n"-separated string per provider. */
  function stepsOf(p: TokenProvider): string[] {
    return t(p.stepsKey)
      .split('\n')
      .filter((s) => s.trim());
  }

  function openPage(url: string) {
    // Fire-and-forget: a failed shell-open must not break the guide.
    void Promise.resolve(openExternalUrl(url)).catch(() => {});
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape') onClose();
  }}
/>

<div class="overlay">
  <button class="scrim" aria-label={t('firstUse.close')} onclick={onClose}
  ></button>
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-label={t('firstUse.title')}
  >
    <header class="top">
      <span class="kicker">{t('firstUse.title')}</span>
      <button
        class="x"
        title={t('firstUse.close')}
        aria-label={t('firstUse.close')}
        onclick={onClose}><Icon name="close" size={12} /></button
      >
    </header>

    <div class="content">
      {#if page === 1}
        <h1 class="title">{t('firstUse.repo.title')}</h1>
        <p class="lead">{t('firstUse.repo.intro')}</p>
        <div class="block">
          <p class="block-title">{t('firstUse.repo.createTitle')}</p>
          <p class="block-body">{t('firstUse.repo.createBody')}</p>
        </div>
        <div class="block">
          <p class="block-title">{t('firstUse.repo.openTitle')}</p>
          <p class="block-body">{t('firstUse.repo.openBody')}</p>
        </div>
      {:else if page === 2}
        <h1 class="title">{t('firstUse.remote.title')}</h1>
        <p class="lead">{t('firstUse.remote.intro')}</p>
        <div class="block">
          <p class="block-title">{t('firstUse.remote.cloneTitle')}</p>
          <p class="block-body">{t('firstUse.remote.cloneBody')}</p>
        </div>
        <div class="block">
          <p class="block-title">{t('firstUse.remote.settingsTitle')}</p>
          <p class="block-body">{t('firstUse.remote.settingsBody')}</p>
          <p class="note">{t('firstUse.remote.sshHint')}</p>
        </div>
      {:else if page === 3}
        <h1 class="title">{t('firstUse.tokens.title')}</h1>
        <p class="lead">{t('firstUse.tokens.intro')}</p>
        <p class="lead">{t('firstUse.tokens.where')}</p>
        <p class="note">{t('firstUse.tokens.safety')}</p>

        {#if issueProviders.length}
          <div class="tabs" role="tablist">
            <button
              class="tab tab-git"
              role="tab"
              aria-selected={tab === 'git'}
              class:on={tab === 'git'}
              onclick={() => (tab = 'git')}
              >{t('firstUse.tokens.tabGit')}</button
            >
            <button
              class="tab tab-issues"
              role="tab"
              aria-selected={tab === 'issues'}
              class:on={tab === 'issues'}
              onclick={() => (tab = 'issues')}
              >{t('firstUse.tokens.tabIssues')}</button
            >
          </div>
        {/if}

        <div role="tabpanel">
          <ul class="providers">
            {#each providers as p (p.id)}
              <li class="provider" data-provider={p.id}>
                <div class="p-head">
                  <span class="p-name">{p.name}</span>
                  {#if p.url}
                    {@const url = p.url}
                    <button
                      class="btn open"
                      aria-label="{t('firstUse.tokens.openPage')} ({p.name})"
                      onclick={() => openPage(url)}
                    >
                      <Icon name="external" size={12} />
                      {t('firstUse.tokens.openPage')}
                    </button>
                  {/if}
                </div>
                <p class="p-label">{t('firstUse.tokens.scopes')}</p>
                <p class="p-scopes">{t(p.scopesKey)}</p>
                <p class="p-label">{t('firstUse.tokens.steps')}</p>
                <ol class="p-steps">
                  {#each stepsOf(p) as step, i (i)}
                    <li>{step}</li>
                  {/each}
                </ol>
              </li>
            {/each}
          </ul>
        </div>
      {:else}
        <h1 class="title">{t('firstUse.done.title')}</h1>
        <p class="lead">{t('firstUse.done.body')}</p>
      {/if}
    </div>

    <footer class="foot">
      <span
        class="dots"
        role="img"
        aria-label={t('firstUse.pageLabel', { page, total: PAGES })}
      >
        {#each Array.from({ length: PAGES }, (_, i) => i + 1) as p (p)}
          <span class="dot" class:on={p === page}></span>
        {/each}
      </span>
      <span class="spacer"></span>
      {#if page > 1}
        <button class="btn back" onclick={() => (page = page - 1)}
          >{t('firstUse.back')}</button
        >
      {/if}
      {#if page < PAGES}
        <button class="btn primary next" onclick={() => (page = page + 1)}
          >{t('firstUse.next')}</button
        >
      {:else}
        <button class="btn primary finish" onclick={onClose}
          >{t('firstUse.close')}</button
        >
      {/if}
    </footer>
  </div>
</div>

<style>
  /* Same layer as the welcome tour; both sit above the tutorial overlay. */
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 56;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .scrim {
    position: absolute;
    inset: 0;
    border: 0;
    padding: 0;
    background: rgba(0, 0, 0, 0.4);
    cursor: default;
  }
  .dialog {
    position: relative;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    width: 640px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 32px);
    background: var(--panel-bg);
    color: var(--fg);
    border: 1px solid var(--panel-border);
    border-radius: 14px;
    box-shadow: var(--panel-shadow);
  }
  .top {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px 0 24px;
  }
  .kicker {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--fg-muted);
  }
  .x {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--fg-muted);
    cursor: pointer;
  }
  .x:hover {
    background: var(--row-hover);
    color: var(--fg);
  }
  .content {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 6px 24px 8px;
  }
  .title {
    margin: 4px 0 8px;
    font-size: 19px;
    font-weight: 700;
    line-height: 1.3;
  }
  .lead {
    margin: 0 0 10px;
    font-size: 13px;
    line-height: 1.55;
    color: var(--fg-soft);
  }
  .note {
    margin: 0 0 10px;
    padding: 7px 10px;
    border-radius: 8px;
    background: var(--row-selected);
    font-size: 12px;
    line-height: 1.5;
    color: var(--fg);
  }
  .block {
    margin: 0 0 10px;
    padding: 10px 12px;
    border: 1px solid var(--panel-border);
    border-radius: 10px;
    background: var(--row-hover);
  }
  .block-title {
    margin: 0 0 3px;
    font-size: 13px;
    font-weight: 600;
  }
  .block-body {
    margin: 0 0 6px;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--fg-soft);
  }
  .block .note {
    margin: 0;
  }
  .tabs {
    display: flex;
    gap: 4px;
    margin: 4px 0 10px;
    border-bottom: 1px solid var(--panel-border);
  }
  .tab {
    padding: 7px 12px;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--fg-muted);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .tab.on {
    color: var(--fg);
    border-bottom-color: var(--select-ring);
    font-weight: 600;
  }
  .providers {
    list-style: none;
    margin: 0 0 6px;
    padding: 0;
    display: grid;
    gap: 10px;
  }
  .provider {
    padding: 10px 12px;
    border: 1px solid var(--panel-border);
    border-radius: 10px;
  }
  .p-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 6px;
  }
  .p-name {
    font-size: 14px;
    font-weight: 600;
  }
  .p-label {
    margin: 6px 0 2px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--fg-muted);
  }
  .p-scopes {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .p-steps {
    margin: 0;
    padding-left: 18px;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--fg-soft);
  }
  .foot {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 24px 16px;
  }
  .spacer {
    flex: 1 1 auto;
  }
  .dots {
    display: inline-flex;
    gap: 6px;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--fg-subtle);
  }
  .dot.on {
    background: var(--select-ring);
  }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 16px;
    border: 0;
    border-radius: 8px;
    background: var(--row-hover);
    color: var(--fg);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .btn.open {
    height: 26px;
    padding: 0 10px;
    font-size: 12px;
  }
  .btn.primary {
    background: var(--select-ring);
    color: #fff;
  }
  .btn:focus-visible,
  .tab:focus-visible,
  .x:focus-visible {
    outline: 2px solid var(--select-ring);
    outline-offset: 2px;
  }
</style>
