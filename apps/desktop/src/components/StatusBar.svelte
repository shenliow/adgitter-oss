<!-- Dark bottom status bar: provider · branch · ahead/behind · signed-in account status. -->
<script lang="ts">
  import { t } from '../lib/i18n/index.svelte';
  import Icon from '../lib/icons/Icon.svelte';
  import type { AuthStatus } from '../lib/auth.svelte';
  import { projectConfigLoadFailure } from '../lib/projectConfig.svelte';
  import { remoteProviderLabel } from '../lib/gitHosts';
  let {
    branch = null,
    ahead = 0,
    behind = 0,
    email = undefined,
    status = 'signed-out',
    remoteUrl = null,
  }: {
    branch?: string | null;
    ahead?: number;
    behind?: number;
    email?: string;
    status?: AuthStatus;
    /** The repo's effective remote, used to name its git provider. */
    remoteUrl?: string | null;
  } = $props();

  // Leftmost slot: which git provider this repo is hosted on. Text, not an
  // icon — the sprite board (lib/icons/windows.ts) has no provider glyphs.
  // `null` (no repo / no remote / hostless remote) renders nothing rather
  // than a placeholder, so the bar never claims a host it does not have.
  const provider = $derived(remoteProviderLabel(remoteUrl));

  // A repo whose adgitter.config.json could not be read is running on
  // DEFAULT settings, and stays that way until the file is fixed or replaced.
  // When the file could not even be copied aside, saves are refused outright
  // (`writesBlocked`) and the hint says so — a user who dismissed this and
  // then changed a setting gets it raised again by the refused write.
  // That is a standing condition, not an event, so it belongs here rather than
  // in a toast that fades: the bar is the one surface visible for as long as
  // the repo is open. Read straight from the store (no prop) so no change to
  // App.svelte is needed to wire it up.
  const configFailure = $derived(projectConfigLoadFailure());

  const accountText = $derived(
    status === 'signed-in'
      ? (email ?? '—')
      : status === 'signing-in'
        ? t('account.signingIn')
        : t('status.signedOut'),
  );
</script>

<footer class="status">
  <div class="left">
    {#if provider}
      <span class="provider" data-provider title={provider}>{provider}</span>
    {/if}
    {#if branch}
      <span class="branch"
        ><span class="b-ico" aria-hidden="true"
          ><Icon name="branch" size={11} /></span
        >{branch}</span
      >
      <span class="counts">
        <span title={t('status.ahead')}
          ><Icon name="push" size={10} />{ahead}</span
        >
        <span title={t('status.behind')}
          ><Icon name="pull" size={10} />{behind}</span
        >
      </span>
    {/if}
    {#if configFailure}
      <span
        class="config-warning"
        role="alert"
        data-config-unreadable
        title={configFailure.writesBlocked
          ? t('status.configUnsavableHint')
          : t('status.configUnreadableHint', {
              file: configFailure.backupFile ?? 'adgitter.config.json',
            })}
      >
        <!-- Plain glyph, not <Icon>: the sprite board has no warning icon and
             App.svelte's remote-warning strip uses the same "⚠". -->
        <span aria-hidden="true">⚠</span>{t('status.configUnreadable')}
      </span>
    {/if}
  </div>
  <div class="right">{accountText}</div>
</footer>

<style>
  .status {
    height: 22px;
    flex: 0 0 auto;
    background: var(--statusbar-bg);
    color: var(--statusbar-fg);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    font-size: 11px;
  }
  .left {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .provider {
    opacity: 0.85;
    /* A self-hosted host can be long; keep it from pushing the branch out. */
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .branch {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .counts {
    display: inline-flex;
    gap: 10px;
    color: #d2d2d2;
  }
  .right {
    color: #cfcfcf;
  }
  .config-warning {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: #fca5a5;
  }
</style>
