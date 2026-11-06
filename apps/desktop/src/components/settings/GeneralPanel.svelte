<!-- General behaviour policies. Edits the draft slice in place. -->
<script lang="ts">
  import {
    AUTO_PULL_SECONDS_MAX,
    AUTO_PULL_SECONDS_MIN,
    clampAutoPullSeconds,
  } from '../../lib/autoPull';
  import type { GeneralSettings } from '../../lib/settings';
  import type { GitIdentity } from '../../lib/accountProfile';
  import { t } from '../../lib/i18n/index.svelte';
  import { openExternalUrl } from '../../lib/ipc';
  import { remoteTokenPageFor } from '../../lib/remoteTokenPage';
  // `repoOpen` gates the repo-specific Remote & authentication section:
  // a remote URL / token only mean anything for an open repo, so
  // on the Welcome screen (no repo) those fields are disabled and shown blank.
  let {
    value = $bindable(),
    repoOpen = true,
    detectedRemote = null,
    gitEmail = $bindable({
      global: '',
      project: '',
      globalName: '',
      projectName: '',
      useProject: false,
      useAccount: false,
    }),
    accountIdentity = null,
  }: {
    value: GeneralSettings;
    /** Git identity draft (owned by SettingsModal; not part of Settings JSON). */
    gitEmail?: {
      global: string;
      project: string;
      globalName?: string;
      projectName?: string;
      useProject: boolean;
      useAccount?: boolean;
    };
    /** The signed-in account's identity as a git author, or `null` when the
     *  account cannot supply one (signed out, or no email on the profile) —
     *  see `accountGitIdentity`. `null` makes the "use account identity"
     *  toggle unavailable, with a reason shown, rather than letting the user
     *  arm a toggle whose save would write nothing. */
    accountIdentity?: GitIdentity | null;
    repoOpen?: boolean;
    /** The repo's detected `.git` origin (sanitized), or null. When set, a hint
     *  explains that filling the URL overrides it and leaving it empty uses the
     *  origin via an SSH key. */
    detectedRemote?: string | null;
  } = $props();

  // Which remote the user is actually about to authenticate against: same
  // precedence as `general.remoteOverrideHint` above — a non-blank typed URL
  // overrides the repo's detected `.git` origin, an empty one falls back to
  // it. Reusing that precedence here (rather than picking independently)
  // keeps the token-page link pointed at the same host the hint is talking
  // about.
  const effectiveRemote = $derived(
    value.remoteUrl.trim() ? value.remoteUrl : (detectedRemote ?? undefined),
  );
  // `null` (unknown/self-hosted host, or no repo open) hides the link below
  // rather than guessing — see remoteTokenPage.ts's doc comment.
  const tokenPageUrl = $derived(
    repoOpen ? remoteTokenPageFor(effectiveRemote) : null,
  );

  const emailScopeProject = $derived(repoOpen && gitEmail.useProject);
  function toggleProjectEmail(checked: boolean) {
    gitEmail.useProject = checked;
    if (checked) {
      if (!gitEmail.project.trim()) gitEmail.project = gitEmail.global;
      if (!gitEmail.projectName?.trim())
        gitEmail.projectName = gitEmail.globalName ?? '';
    }
  }

  // ── "Use signed-in account identity" ──────────────────────────────────────
  // A second, independent control alongside `useProject`. When on it takes
  // over the *display* (the account name/email, both fields disabled) and the
  // save targets the PROJECT level — so it needs an open repo for exactly the
  // reason `emailScopeProject` does, and is guarded the same way rather than
  // trusting the draft flag alone (a repo can close under a checked box).
  const accountToggleAvailable = $derived(repoOpen && !!accountIdentity);
  const useAccountIdentity = $derived(
    accountToggleAvailable && !!gitEmail.useAccount,
  );

  // The value each field shows. Account identity wins over the scope switch.
  const shownName = $derived(
    useAccountIdentity
      ? (accountIdentity?.name ?? '')
      : emailScopeProject
        ? (gitEmail.projectName ?? '')
        : (gitEmail.globalName ?? ''),
  );
  const shownEmail = $derived(
    useAccountIdentity
      ? (accountIdentity?.email ?? '')
      : emailScopeProject
        ? gitEmail.project
        : gitEmail.global,
  );

  // The placeholder answers one question — "what gets used if I leave this
  // blank?" — by naming the next level down the resolution chain that git
  // actually consults at commit time:
  //
  //   account display (writes project) → project → global → account fallback
  //
  // So: account toggle on ⇒ the project value; project scope ⇒ the global
  // value; global scope ⇒ the account address `identity.rs` registers via
  // `set_fallback_identity`, which is what git falls back to when no
  // `user.email` is configured anywhere. One rule, three readings of it — not
  // three special cases. Note the fallback level is shown even when the
  // toggle is unavailable (no repo): availability gates *writing* the account
  // identity, not the fact that git-core would still substitute it.
  const fallbackName = $derived(
    useAccountIdentity
      ? (gitEmail.projectName ?? '')
      : emailScopeProject
        ? (gitEmail.globalName ?? '')
        : (accountIdentity?.name ?? ''),
  );
  const fallbackEmail = $derived(
    useAccountIdentity
      ? gitEmail.project
      : emailScopeProject
        ? gitEmail.global
        : (accountIdentity?.email ?? ''),
  );

  // The hover hint only earns its place when the substitution would really
  // happen — i.e. the field is blank and the placeholder names a real value.
  const nameHint = $derived(
    !shownName.trim() && fallbackName.trim()
      ? t('general.identityFallbackHint')
      : undefined,
  );
  const emailHint = $derived(
    !shownEmail.trim() && fallbackEmail.trim()
      ? t('general.identityFallbackHint')
      : undefined,
  );
</script>

<div class="panel">
  <label class="field">
    <span>{t('general.autoPull')}</span>
    <select bind:value={value.autoPull}>
      <option value="off">{t('general.off')}</option>
      <option value="warn">{t('general.warning')}</option>
      <option value="notify">{t('general.notify')}</option>
      <option value="always">{t('general.always')}</option>
    </select>
  </label>
  <div class="checks" class:disabled={value.autoPull === 'off'}>
    <label
      ><input
        type="checkbox"
        bind:checked={value.autoPullBefore.createBranch}
        disabled={value.autoPull === 'off'}
      />
      {t('general.beforeCreateBranch')}</label
    >
    <label
      ><input
        type="checkbox"
        bind:checked={value.autoPullBefore.push}
        disabled={value.autoPull === 'off'}
      />
      {t('general.beforePush')}</label
    >
    <label
      ><input
        type="checkbox"
        bind:checked={value.autoPullBefore.commit}
        disabled={value.autoPull === 'off'}
      />
      {t('general.beforeCommit')}</label
    >
  </div>
  <!-- The countdown length only exists for `notify`; the other three modes
       have no countdown to configure, so the sub-option is not rendered at
       all rather than rendered disabled. -->
  {#if value.autoPull === 'notify'}
    <label class="field">
      <span>{t('general.autoPullSeconds')}</span>
      <span class="inline">
        <input
          type="number"
          min={AUTO_PULL_SECONDS_MIN}
          max={AUTO_PULL_SECONDS_MAX}
          data-testid="autopull-seconds"
          bind:value={value.autoPullSeconds}
          onchange={() =>
            (value.autoPullSeconds = clampAutoPullSeconds(
              value.autoPullSeconds,
            ))}
        />
        {t('general.seconds')}
      </span>
    </label>
  {/if}

  <label class="field">
    <span>{t('general.unstaged')}</span>
    <select bind:value={value.unstaged}>
      <option value="off">{t('general.off')}</option>
      <option value="warn">{t('general.warning')}</option>
    </select>
  </label>

  <label class="field">
    <span>{t('general.undoRedo')}</span>
    <span class="inline">
      <input type="number" min="0" max="999" bind:value={value.undoRedo} />
      {t('general.times')}
    </span>
  </label>

  <label class="field">
    <span>{t('general.git')}</span>
    <span class="inline">
      <input type="checkbox" bind:checked={value.dryRun} />
      {t('general.dryRun')}
    </span>
  </label>

  <label class="field">
    <span>{t('general.hideGhosts')}</span>
    <input type="checkbox" bind:checked={value.hideGhosts} />
  </label>
  <p class="hint">{t('general.hideGhostsHint')}</p>

  <div class="section">
    <span class="section-title">{t('general.gitIdentity')}</span>
    <label class="field">
      <span>{t('general.gitName')}</span>
      <input
        class="text"
        type="text"
        data-field="git-name"
        autocomplete="off"
        disabled={useAccountIdentity}
        placeholder={fallbackName}
        title={nameHint}
        value={shownName}
        oninput={(e) => {
          if (emailScopeProject) gitEmail.projectName = e.currentTarget.value;
          else gitEmail.globalName = e.currentTarget.value;
        }}
      />
    </label>
    <label class="field">
      <span>{t('general.gitEmail')}</span>
      <input
        class="text"
        type="email"
        data-field="git-email"
        autocomplete="off"
        disabled={useAccountIdentity}
        placeholder={fallbackEmail}
        title={emailHint}
        value={shownEmail}
        oninput={(e) => {
          if (emailScopeProject) gitEmail.project = e.currentTarget.value;
          else gitEmail.global = e.currentTarget.value;
        }}
      />
    </label>
    <label class="field">
      <span>{t('general.useProjectEmail')}</span>
      <input
        type="checkbox"
        data-field="git-email-project"
        disabled={!repoOpen}
        checked={emailScopeProject}
        onchange={(e) => toggleProjectEmail(e.currentTarget.checked)}
      />
    </label>
    <label class="field">
      <span>{t('general.useAccountIdentity')}</span>
      <input
        type="checkbox"
        data-field="git-identity-account"
        disabled={!accountToggleAvailable}
        checked={useAccountIdentity}
        onchange={(e) => (gitEmail.useAccount = e.currentTarget.checked)}
      />
    </label>
    {#if repoOpen && !accountIdentity}
      <!-- Signed out, or a profile with no email: the toggle is disabled AND
           says why. A no-repo toggle needs no reason line — the whole
           project-scope row is already disabled for the same reason, which
           the user can see. -->
      <p class="hint" data-field="git-identity-account-reason">
        {t('general.accountIdentityNoAccount')}
      </p>
    {/if}
    <p class="hint">
      {useAccountIdentity
        ? t('general.accountIdentityHint')
        : emailScopeProject
          ? t('general.gitEmailHintProject')
          : t('general.gitEmailHintGlobal')}
    </p>
  </div>

  <div class="section" class:disabled={!repoOpen}>
    <span class="section-title">{t('general.remoteHeading')}</span>
    <label class="field">
      <span>{t('general.remoteUrl')}</span>
      <!-- Controlled (value + oninput) rather than bind:value so the field can
           render BLANK while disabled on the Welcome screen without wiping the
           underlying draft/global value. -->
      <input
        class="text"
        type="text"
        data-field="remote-url"
        placeholder="https://github.com/you/repo.git"
        disabled={!repoOpen}
        value={repoOpen ? value.remoteUrl : ''}
        oninput={(e) => (value.remoteUrl = e.currentTarget.value)}
      />
    </label>
    {#if repoOpen && detectedRemote}
      <p class="hint">
        {t('general.remoteOverrideHint', { url: detectedRemote })}
      </p>
    {/if}
    <label class="field">
      <span>{t('general.accessToken')}</span>
      <input
        class="text"
        type="password"
        autocomplete="off"
        placeholder="ghp_…"
        disabled={!repoOpen}
        value={repoOpen ? value.accessToken : ''}
        oninput={(e) => (value.accessToken = e.currentTarget.value)}
      />
    </label>
    <p class="hint">
      {repoOpen ? t('general.authHint') : t('general.remoteNoRepo')}
    </p>
    {#if tokenPageUrl}
      <!-- A <button> calling openExternalUrl, never an <a href>: an anchor
           would navigate the Tauri WebView itself away from the app instead
           of opening the system browser (same reasoning as AccountPanel's
           "manage on website" links). -->
      <button
        class="link"
        type="button"
        data-action="open-token-page"
        onclick={() => openExternalUrl(tokenPageUrl)}
      >
        {t('general.openTokenPage')}
      </button>
    {/if}
  </div>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 13px;
    gap: 12px;
  }
  .field select,
  .field input[type='number'] {
    height: 28px;
  }
  .field select {
    width: 220px;
  }
  .field input[type='number'] {
    width: 70px;
  }
  .inline {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--fg-soft);
  }
  .checks {
    display: flex;
    gap: 16px;
    font-size: 12px;
    color: var(--fg-soft);
    margin-top: -4px;
  }
  .checks.disabled {
    opacity: 0.5;
  }
  .section {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-top: 12px;
    border-top: 1px solid var(--panel-border);
  }
  /* Welcome screen (no repo): the repo-specific remote fields are dimmed +
     disabled. */
  .section.disabled .section-title,
  .section.disabled .field {
    opacity: 0.5;
  }
  .section-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--fg);
  }
  .field input.text {
    width: 260px;
    height: 28px;
    font: inherit;
    font-size: 12px;
  }
  .hint {
    margin: 0;
    font-size: 11px;
    color: var(--fg-muted);
  }
  /* Matches AccountPanel's "manage on website" link buttons. */
  .link {
    align-self: flex-start;
    border: 1px solid var(--panel-border);
    background: var(--row-hover);
    color: var(--fg);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
  }
</style>
