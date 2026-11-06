<!--
  Settings modal: real left-nav routing over a draft copy of Settings.
  General / Shortcut / Personalize are implemented; the rest are stubbed to
  their owning epics. Personalize previews live: the draft's personalize is
  reported upward via `onPersonalizePreview`, and App.svelte makes it the
  effective personalize while the modal is open — so the CSS-variable theme
  AND the graph theme (a MetroGraph prop, not a CSS variable) both preview.
  Cancel simply closes; the app drops the override on every close route, which
  is what reverts the preview. OK is blocked while there are keymap conflicts.

  Repo-level settings: General / Personalize / Themes / Log Anytime are
  per-repo (like the Issue Panel tab already was) — when `repoPath` is set,
  their draft is seeded from the project-config props (+ `repoAccessToken`
  for the token field) instead of global `settings`, and Save routes them to
  `onSaveProjectSettings` instead of `onSave`. Shortcut/Account/Plan/Devices
  always stay global. See `projectConfig.svelte.ts` and `repoSecrets.ts`.
-->
<script lang="ts">
  import type {
    Settings,
    PersonalizeSettings,
    LogAnytimeSettings,
  } from '../lib/settings';
  import type { ProjectGeneralSettings } from '../lib/projectConfig.svelte';
  import type { TutorialAction, TutorialEvent } from '../lib/tutorial/types';
  import { effectiveKeymap, conflicts } from '../lib/keymap';
  import { t } from '../lib/i18n/index.svelte';
  import { getGitEmail, setGitEmail, setGitName } from '../lib/ipc';
  import {
    accountGitIdentity,
    loadAccountProfile,
  } from '../lib/accountProfile';
  import type { MessageKey } from '../lib/i18n/messages';
  import GeneralPanel from './settings/GeneralPanel.svelte';
  import ShortcutPanel from './settings/ShortcutPanel.svelte';
  import PersonalizePanel from './settings/PersonalizePanel.svelte';
  import LogAnytimePanel from './settings/LogAnytimePanel.svelte';
  import AccountPanel from './settings/AccountPanel.svelte';
  import PrivacyPanel from './settings/PrivacyPanel.svelte';
  import PlanPanel from './settings/PlanPanel.svelte';
  import DevicesList from './settings/DevicesList.svelte';
  import { pro } from '../lib/pro';
  import ThemeStore from './ThemeStore.svelte';

  /** The four tabs whose draft/save is repo-scoped when a repo is open. */
  const REPO_SCOPED_TABS = [
    'General',
    'Personalize',
    'Themes',
    'Log Anytime',
  ] as const;

  let {
    settings,
    onSave,
    onClose,
    repoPath = null,
    detectedRemote = null,
    onIssueBindingChanged,
    projectGeneral = null,
    projectPersonalize = null,
    projectLogAnytime = null,
    repoAccessToken = '',
    onSaveProjectSettings,
    onPersonalizePreview,
    initialTab = null,
    guard,
    onTutorialEvent,
  }: {
    settings: Settings;
    onSave: (s: Settings) => void;
    onClose: () => void;
    /** Open repo, threaded to the Log Anytime panel's "Compact now" action
     *  and gating whether the four REPO_SCOPED_TABS draft/save per-repo. */
    repoPath?: string | null;
    /** The open repo's detected `.git` origin URL (sanitized), or null. Shown
     *  in General as a hint: an empty URL field uses this origin (SSH key), a
     *  filled one overrides it. */
    detectedRemote?: string | null;
    /** Issue Panel tab bound/re-scoped/unbound a provider (the issue
     *  tracker's own binding, opaque here). */
    onIssueBindingChanged?: (binding: unknown) => void;
    /** The open repo's general-settings override (minus `accessToken`), or
     *  `null` if unseeded — App.svelte always seeds this before a repo
     *  finishes loading, so `null` here is just a defensive fallback. */
    projectGeneral?: ProjectGeneralSettings | null;
    /** The open repo's personalize override, or `null` if unseeded. */
    projectPersonalize?: PersonalizeSettings | null;
    /** The open repo's Log Anytime override, or `null` if unseeded. */
    projectLogAnytime?: LogAnytimeSettings | null;
    /** The open repo's stored access token (from `repoSecrets.ts`), or `""`
     *  if it has none yet — never seeded from the global token, so a fresh
     *  repo always starts blank (same precedent as the Issue Panel tab's
     *  provider binding, which also comes back token-less on reload). */
    repoAccessToken?: string;
    /** Save the four REPO_SCOPED_TABS' draft to the open repo (project
     *  config + repoSecrets for the token) instead of global settings. Fired
     *  in place of (never in addition to, for those four slices) `onSave`
     *  when `repoPath` is set. */
    onSaveProjectSettings?: (v: {
      general: ProjectGeneralSettings;
      accessToken: string;
      personalize: PersonalizeSettings;
      logAnytime: LogAnytimeSettings;
    }) => void;
    /** Report the draft's personalize upward on every change, so the app can
     *  preview ALL of it live — including `graphTheme`, which the graph takes
     *  as a prop rather than a CSS variable and so could never be previewed
     *  from in here. One-way: the modal never reads anything back from the
     *  app's preview. The app clears its own override when the modal
     *  unmounts (any close route), so there is nothing to un-report here. */
    onPersonalizePreview?: (p: PersonalizeSettings) => void;
    /** Tab to land on when the modal mounts, or `null` for the default
     *  ('General'). The modal only ever mounts under an `{#if showSettings}`
     *  in App.svelte, so it remounts fresh on every open — a plain seed of
     *  `active` is enough, no reactive re-sync needed. */
    initialTab?: (typeof tabs)[number] | null;
    /** Guided tutorial: asked BEFORE a tab switch, a theme apply, OK or any
     *  close route (`settingsTab` / `applyTheme` / `saveSettings` /
     *  `closeSettings`). `false` means "swallow it". Absent ⇒ always allowed. */
    guard?: (a: TutorialAction) => boolean;
    /** Guided tutorial: reports what HAS happened (`settingsTabOpened`,
     *  `settingsSaved`). Absent ⇒ nothing is reported. */
    onTutorialEvent?: (e: TutorialEvent) => void;
  } = $props();

  const tabs = [
    'General',
    'Shortcut',
    'Account',
    'Personalize',
    'Themes',
    'Plan',
    'Log Anytime',
    'Issue Panel',
    'Privacy',
    'Devices',
  ] as const;
  const TAB_KEY: Record<(typeof tabs)[number], MessageKey> = {
    General: 'settings.general',
    Shortcut: 'settings.shortcut',
    Account: 'settings.account',
    Personalize: 'settings.personalize',
    Themes: 'settings.themes',
    Plan: 'settings.plan',
    'Log Anytime': 'settings.logAnytime',
    'Issue Panel': 'settings.issuePanel',
    Privacy: 'settings.privacy',
    Devices: 'settings.devices',
  };
  // Tabs temporarily hidden from the nav (the tab, its TAB_KEY entry, and its
  // body block are kept intact so un-hiding is a one-line change: drop the id
  // from this set). Device management is hidden for now (device binding is not
  // yet surfaced to users). 'Themes' (the old CSS-theme store) is folded into
  // Personalize, which is now itself the graph-theme store + picker.
  // A build without the issue tracker has no 'Issue Panel' to configure.
  const HIDDEN_TABS: readonly (typeof tabs)[number][] = [
    'Devices',
    'Themes',
    ...(pro ? [] : (['Issue Panel'] as const)),
  ];
  const visibleTabs = tabs.filter((tab) => !HIDDEN_TABS.includes(tab));

  // The modal only ever mounts under App.svelte's `{#if showSettings}`, so
  // it remounts fresh on every open — seeding once from `initialTab` (never
  // tracking later prop changes) is intentional, same idiom as `draft` below.
  // svelte-ignore state_referenced_locally
  let active = $state<(typeof tabs)[number]>(initialTab ?? 'General');

  // Edit a deep copy; the live app keeps its saved settings until OK. The
  // modal is remounted on each open, so seeding from the initial prop is
  // intentional (not meant to track later changes).
  // svelte-ignore state_referenced_locally
  let draft = $state<Settings>(structuredClone($state.snapshot(settings)));

  // Repo-level override: when a repo is open, the four REPO_SCOPED_TABS draft
  // from the project-config props instead of global `settings` — General's
  // accessToken specifically comes from `repoAccessToken` (repoSecrets), NOT
  // global settings, since a repo's token is never seeded from the global one
  // (see the `repoAccessToken` prop doc). Falls back to global whenever a
  // slice hasn't been seeded yet (defensive; App.svelte always seeds before
  // a repo finishes loading). Plain mutation of the already-declared `draft`
  // state (not a new `$state()` initializer), run once at mount — same
  // "seeded once, not meant to track later changes" intent as the block
  // above, just applied to a nested slice instead of the whole object.
  // svelte-ignore state_referenced_locally
  if (repoPath) {
    // svelte-ignore state_referenced_locally
    draft.general = {
      ...(projectGeneral ?? settings.general),
      accessToken: repoAccessToken,
    };
    // svelte-ignore state_referenced_locally
    draft.personalize = { ...(projectPersonalize ?? settings.personalize) };
    // svelte-ignore state_referenced_locally
    draft.logAnytime = { ...(projectLogAnytime ?? settings.logAnytime) };
  }

  // What the modal opened with — `settingsSaved.themeChanged` compares the
  // draft against this. Read after the repo-scoped override above, so a repo's
  // own personalize (not the global one) is the baseline when a repo is open.
  const openedTheme = {
    theme: draft.personalize.theme,
    graphTheme: draft.personalize.graphTheme,
  };

  /** Tutorial gate: with no `guard` prop everything is allowed. */
  function allowed(a: TutorialAction): boolean {
    return guard ? guard(a) : true;
  }

  function switchTab(tab: (typeof tabs)[number]) {
    if (!allowed({ kind: 'settingsTab', tab })) return;
    active = tab;
    onTutorialEvent?.({ kind: 'settingsTabOpened', tab });
  }

  // Live preview: report the draft's personalize upward as it changes. The
  // app makes it the effective personalize while the modal is open, which
  // both re-applies the CSS-variable theme (App.svelte's own `applyTheme`
  // effect) AND re-renders the graph with the drafted `graphTheme` prop — the
  // one part of personalize a local `applyTheme` here could never reach.
  // Strictly outbound; nothing flows back into `draft`.
  $effect(() => {
    onPersonalizePreview?.($state.snapshot(draft.personalize));
  });

  // Git identity lives in git config, not the Settings JSON, so
  // it has its own draft + save path. `loaded` is what git reported at mount.
  let gitEmail = $state({
    global: '',
    project: '',
    globalName: '',
    projectName: '',
    useProject: false,
    useAccount: false,
  });
  // The signed-in account's git-author identity, read once at mount from the
  // locally cached *display* profile (never a credential — see
  // accountProfile.ts). `null` ⇒ the panel's account toggle is unavailable.
  const accountIdentity = accountGitIdentity(loadAccountProfile());
  let gitEmailLoaded = {
    global: '',
    project: '',
    globalName: '',
    projectName: '',
    hasProject: false,
    hasProjectName: false,
  };
  // svelte-ignore state_referenced_locally
  const emailRepoPath = repoPath ?? null;
  getGitEmail(emailRepoPath)
    .catch(() => ({
      global: null,
      project: null,
      globalName: null,
      projectName: null,
    }))
    .then((cfg) => {
      const g = cfg?.global ?? '';
      const p = cfg?.project ?? null;
      const gn = cfg?.globalName ?? '';
      const pn = cfg?.projectName ?? null;
      gitEmailLoaded = {
        global: g,
        project: p ?? '',
        globalName: gn,
        projectName: pn ?? '',
        hasProject: p !== null,
        hasProjectName: pn !== null,
      };
      gitEmail = {
        global: g,
        project: p ?? '',
        globalName: gn,
        projectName: pn ?? '',
        useProject: (p !== null || pn !== null) && !!emailRepoPath,
        // Never pre-armed: the account toggle *overwrites* the project
        // identity on save, so it only ever turns on by the user asking.
        useAccount: false,
      };
    });

  // One identity write, isolated. `log and carry on` has to survive a
  // SYNCHRONOUS throw as well as a rejection: a per-call `.catch(log)` only
  // catches the latter, so a `user.name` write that threw outright used to
  // abort the whole function and silently cancel the `user.email` write
  // queued after it. try/catch around the call makes each write independent,
  // which is what "log and carry on" was always meant to mean.
  //
  // The logged value is the error only — never the address. `user.email` is
  // PII and `git_email.rs`'s module doc keeps it out of logs and error
  // strings; that promise is only worth anything if this side honours it too.
  async function writeIdentity(run: () => Promise<void>) {
    try {
      await run();
    } catch (e) {
      console.error('git identity save failed', e);
    }
  }

  async function saveGitEmail() {
    const cur = $state.snapshot(gitEmail);
    const l = gitEmailLoaded;
    // A global edit made before switching to project scope still counts.
    if (cur.globalName.trim() !== l.globalName) {
      await writeIdentity(() =>
        setGitName('global', emailRepoPath, cur.globalName.trim() || null),
      );
    }
    if (cur.global.trim() !== l.global) {
      await writeIdentity(() =>
        setGitEmail('global', emailRepoPath, cur.global.trim() || null),
      );
    }
    // "Use signed-in account identity" wins over the scope switch and always
    // OVERWRITES the project level — unconditionally, not only when it
    // differs from what was loaded: the point of the toggle is that the
    // repo ends up carrying the account identity, so a project value that
    // happens to equal it must still be written rather than assumed.
    if (cur.useAccount && accountIdentity && emailRepoPath) {
      await writeIdentity(() =>
        setGitName('project', emailRepoPath, accountIdentity.name),
      );
      await writeIdentity(() =>
        setGitEmail('project', emailRepoPath, accountIdentity.email),
      );
      return;
    }
    if (cur.useProject && emailRepoPath) {
      if (!l.hasProjectName || cur.projectName.trim() !== l.projectName) {
        await writeIdentity(() =>
          setGitName('project', emailRepoPath, cur.projectName.trim() || null),
        );
      }
      if (!l.hasProject || cur.project.trim() !== l.project) {
        await writeIdentity(() =>
          setGitEmail('project', emailRepoPath, cur.project.trim() || null),
        );
      }
      return;
    }
    if (l.hasProjectName && emailRepoPath) {
      await writeIdentity(() => setGitName('project', emailRepoPath, null));
    }
    if (l.hasProject && emailRepoPath) {
      await writeIdentity(() => setGitEmail('project', emailRepoPath, null));
    }
  }

  const hasConflict = $derived(
    conflicts(effectiveKeymap(draft.keymap)).length > 0,
  );

  function cancel() {
    if (!allowed({ kind: 'closeSettings' })) return;
    // No local revert needed: closing unmounts this modal, and the app drops
    // its preview override on close — the effective personalize falls back to
    // the saved repo/global value and is re-applied there.
    onClose();
  }
  function save() {
    if (hasConflict) return;
    if (!allowed({ kind: 'saveSettings' })) return;
    void saveGitEmail();
    const snapshot = $state.snapshot(draft) as Settings;
    if (repoPath) {
      // The four REPO_SCOPED_TABS are repo-scoped: route them to the repo
      // (project config + repoSecrets) instead of global settings. The
      // access token is split off here and NEVER included in the object
      // passed to `onSave` below — that object round-trips through
      // `saveSettings` → `write_project_config`'s sibling, the global
      // `settings.json` writer, which is a fine place for the global token
      // but must never see the repo one under a different key.
      const { accessToken, ...generalRest } = snapshot.general;
      onSaveProjectSettings?.({
        general: generalRest,
        accessToken,
        personalize: snapshot.personalize,
        logAnytime: snapshot.logAnytime,
      });
      // Keymap (Shortcut) and any other global-only field still saves
      // globally — but WITHOUT the repo-scoped edits, so this save can never
      // clobber the global general/personalize/logAnytime with per-repo
      // values (those three slices are put back exactly as they were).
      onSave({
        ...snapshot,
        general: settings.general,
        personalize: settings.personalize,
        logAnytime: settings.logAnytime,
      });
    } else {
      onSave(snapshot);
    }
    onClose();
    onTutorialEvent?.({
      kind: 'settingsSaved',
      themeChanged:
        snapshot.personalize.theme !== openedTheme.theme ||
        snapshot.personalize.graphTheme !== openedTheme.graphTheme,
    });
  }
</script>

<div class="backdrop" onclick={cancel} role="presentation"></div>
<div
  class="modal"
  role="dialog"
  aria-label={t('topbar.settings')}
  data-tutorial="settings-modal"
>
  <nav class="tabs">
    {#each visibleTabs as tab (tab)}
      <button
        class:active={tab === active}
        data-tutorial="settings-tab-{tab}"
        onclick={() => switchTab(tab)}>{t(TAB_KEY[tab])}</button
      >
    {/each}
  </nav>

  <div class="content">
    <h2>{t(TAB_KEY[active])}</h2>
    <div class="body" data-tutorial="settings-panel-{active}">
      {#if (REPO_SCOPED_TABS as readonly string[]).includes(active)}
        <p class="scope-hint">
          {repoPath
            ? t('settings.scopeRepo')
            : t('settings.scopeGlobalFallback')}
        </p>
      {/if}
      {#if active === 'General'}
        <GeneralPanel
          bind:value={draft.general}
          repoOpen={!!repoPath}
          {detectedRemote}
          bind:gitEmail
          {accountIdentity}
        />
      {:else if active === 'Shortcut'}
        <ShortcutPanel bind:value={draft.keymap} />
      {:else if active === 'Personalize'}
        <PersonalizePanel bind:value={draft.personalize} {guard} />
      {:else if active === 'Themes'}
        <ThemeStore bind:value={draft.personalize} />
      {:else if active === 'Log Anytime'}
        <LogAnytimePanel bind:value={draft.logAnytime} {repoPath} />
      {:else if active === 'Account'}
        <AccountPanel />
      {:else if active === 'Plan'}
        <PlanPanel />
      {:else if active === 'Issue Panel' && pro}
        <pro.IssueSettingsPanel
          {repoPath}
          onBindingChanged={onIssueBindingChanged}
        />
      {:else if active === 'Privacy'}
        <PrivacyPanel
          bind:adConsent={draft.adConsent}
          bind:crashReports={draft.crashReports}
        />
      {:else if active === 'Devices'}
        <DevicesList />
      {/if}
    </div>

    <div class="actions">
      <button class="btn ghost" data-tutorial="settings-cancel" onclick={cancel}
        >{t('common.cancel')}</button
      >
      <button
        class="btn"
        data-tutorial="settings-ok"
        onclick={save}
        disabled={hasConflict}>{t('common.ok')}</button
      >
    </div>
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
    /* Dynamic: at least 75% of the viewport so option panels don't overflow;
       the .body scrolls if a panel is still taller. */
    width: 75vw;
    height: 75vh;
    background: var(--panel-bg);
    border-radius: 12px;
    box-shadow: var(--panel-shadow);
    display: grid;
    grid-template-columns: 150px 1fr;
    overflow: hidden;
    z-index: 30;
  }
  .tabs {
    background: var(--row-hover);
    border-right: 1px solid var(--panel-border);
    display: flex;
    flex-direction: column;
    padding: 12px 8px;
    gap: 2px;
  }
  .tabs button {
    text-align: left;
    border: 0;
    background: transparent;
    padding: 7px 10px;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
    color: var(--fg-soft);
  }
  .tabs button.active {
    background: var(--panel-bg);
    font-weight: 600;
    color: var(--fg);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }
  .content {
    padding: 18px 22px;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  h2 {
    margin: 0 0 14px;
    font-size: 14px;
  }
  .scope-hint {
    /* No negative top margin: the .body clips its overflow, so a negative
       margin pushed this hint's top above the clip edge and truncated it. */
    margin: 0 0 14px;
    font-size: 11px;
    color: var(--fg-muted);
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    /* A hair of top padding so the first line never sits flush on the clip. */
    padding-top: 2px;
  }
  .actions {
    margin-top: 14px;
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }
  .btn {
    border: 0;
    background: var(--select-ring);
    color: #fff;
    padding: 7px 18px;
    border-radius: 7px;
    font-size: 13px;
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
