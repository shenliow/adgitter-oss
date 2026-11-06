<!--
  Welcome launcher: shown when no repository is active. Greets the
  user, lists recent projects as avatars (initial + name, removable), and offers
  a New/Open tile. Has its own slim header (logo + gear + user) distinct from the
  repo workspace TopBar.
-->
<script lang="ts">
  import type { RecentProject } from '../lib/recents';
  import { t } from '../lib/i18n/index.svelte';
  import Icon from '../lib/icons/Icon.svelte';
  import logoUrl from '../lib/icons/logo.png';

  let {
    userName = null,
    recents = [],
    onOpenRecent,
    onRemoveRecent,
    onNewOpen,
    onSettings = () => {},
    onUser = () => {},
  }: {
    userName?: string | null;
    recents?: RecentProject[];
    onOpenRecent: (r: RecentProject) => void;
    onRemoveRecent: (path: string) => void;
    onNewOpen: () => void;
    onSettings?: () => void;
    onUser?: () => void;
  } = $props();

  function initial(name: string): string {
    return (name.trim()[0] ?? '?').toUpperCase();
  }

  const greeting = $derived(
    userName
      ? t('welcome.greetingName', { name: userName })
      : t('welcome.greeting'),
  );
</script>

<div class="welcome">
  <header class="bar">
    <div class="brand">
      <img class="logo" src={logoUrl} alt="" aria-hidden="true" />
      <span class="name">ADGitter</span>
    </div>
    <div class="tools">
      <button
        class="icon"
        title={t('topbar.settings')}
        aria-label={t('topbar.settings')}
        onclick={onSettings}><Icon name="settings" size={18} /></button
      >
      <button
        class="icon"
        title={t('topbar.account')}
        aria-label={t('topbar.account')}
        onclick={onUser}><Icon name="account" size={18} /></button
      >
    </div>
  </header>

  <main class="stage">
    <h1>{greeting}</h1>

    <div class="tiles">
      {#each recents as r (r.path)}
        <div class="tile">
          <button class="avatar" title={r.path} onclick={() => onOpenRecent(r)}>
            {initial(r.name)}
          </button>
          <button
            class="remove"
            title={t('welcome.removeRecent')}
            aria-label={t('welcome.removeRecent')}
            onclick={() => onRemoveRecent(r.path)}
            ><Icon name="close" size={11} /></button
          >
          <span class="label">{r.name}</span>
        </div>
      {/each}

      <div class="tile">
        <button
          class="avatar new"
          title={t('welcome.newOpen')}
          onclick={onNewOpen}>+</button
        >
        <span class="label">{t('welcome.newOpen')}</span>
      </div>
    </div>
  </main>
</div>

<style>
  .welcome {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--workspace-bg);
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 16px;
    font-weight: 600;
    color: var(--fg);
  }
  .logo {
    width: 26px;
    height: 26px;
    display: block;
  }
  .tools {
    display: flex;
    gap: 8px;
  }
  .icon {
    width: 30px;
    height: 30px;
    border-radius: 999px;
    border: 1px solid var(--panel-border);
    background: var(--panel-bg);
    cursor: pointer;
    font-size: 14px;
  }
  .stage {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-top: 18vh;
  }
  h1 {
    font-size: 34px;
    font-weight: 600;
    color: var(--fg);
    margin: 0 0 40px;
  }
  .tiles {
    display: flex;
    gap: 28px;
    align-items: flex-start;
  }
  .tile {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    width: 110px;
  }
  .avatar {
    width: 96px;
    height: 96px;
    border-radius: 999px;
    border: 0;
    background: var(--row-hover);
    color: var(--fg);
    font-size: 42px;
    font-weight: 600;
    cursor: pointer;
    display: grid;
    place-items: center;
  }
  .avatar:hover {
    filter: brightness(0.96);
  }
  .avatar.new {
    background: transparent;
    border: 2px dashed var(--panel-border);
    color: var(--fg-soft);
  }
  .remove {
    position: absolute;
    top: -4px;
    right: 18px;
    width: 22px;
    height: 22px;
    border-radius: 999px;
    border: 1px solid var(--panel-border);
    background: var(--panel-bg);
    color: var(--fg-soft);
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    opacity: 0;
    transition: opacity 0.12s;
  }
  .tile:hover .remove {
    opacity: 1;
  }
  .label {
    font-size: 13px;
    color: var(--fg);
    max-width: 110px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
