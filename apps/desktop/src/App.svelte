<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { open } from '@tauri-apps/plugin-dialog';
  import { getCurrentWindow } from '@tauri-apps/api/window';

  import {
    listCommits,
    listRefs,
    listCommitFiles,
    startRepoWatch,
    stopRepoWatch,
    ping,
    revert,
    cherryPick,
    reset,
    reword,
    dropCommit,
    squashRange,
    purgePath,
    addFileToCommit,
    type HistoryOpOutcome,
    type HistoryOpResult,
    type ResolveState,
    conflictState,
    continueOp,
    abortOp,
    repoStatus,
    undo,
    undoState,
    expireBackups,
    checkout,
    checkoutRemoteBranch,
    inspectRemoteCheckout,
    adoptRemoteUpstreamAndCheckout,
    createBranch,
    renameBranch,
    setUpstream,
    branchUpstream,
    merge,
    rebaseOnto,
    rebaseBranch,
    deleteBranch,
    diffFile,
    diffWorktree,
    probePath,
    initRepository,
    cloneRepository,
    onCloneProgress,
    aheadBehind,
    remoteUrl,
    pull,
    push,
    logCommit,
    pushBranch,
    tutorialDemoCreate,
    tutorialDemoSeedFiles,
    tutorialDemoSeedHistory,
    tutorialDemoWriteFile,
    tutorialDemoSimulateLog,
    tutorialDemoRemove,
    initCrashReporting,
    reportEvent,
    type Commit,
    type RefList,
    type FileChange,
    type FileDiff,
    type ResetMode,
    type CloneAuth,
    type CloneProgress,
    type AheadBehind,
    type RemoteCheckoutPlan,
    type SyncPrompt,
    type UndoBlockedReason,
  } from './lib/ipc';
  import {
    listRecents,
    addRecent,
    removeRecent,
    type RecentProject,
  } from './lib/recents';
  import {
    loadSettings,
    saveSettings,
    onSettingsChanged,
    DEFAULT_SETTINGS,
    type Settings,
    type GeneralSettings,
    type PersonalizeSettings,
    type LogAnytimeSettings,
  } from './lib/settings';
  import {
    patUsernameFor,
    cloneDestination,
    sanitizeRemoteUrl,
    isHttpsRemote,
    resolveRemoteAuth,
    patRemoteUrl,
  } from './lib/gitHosts';
  import {
    loadProjectConfig,
    resetProjectConfig,
    projectConfigExists,
    projectBranchColors,
    seedProjectBranchColors,
    setProjectBranchColor,
    resetProjectBranchColor,
    moveProjectBranchColor,
    issueBranchLinks,
    projectGeneral,
    projectPersonalize,
    projectLogAnytime,
    seedProjectGeneral,
    seedProjectPersonalize,
    seedProjectLogAnytime,
    setProjectGeneral,
    setProjectPersonalize,
    setProjectLogAnytime,
    type ProjectGeneralSettings,
  } from './lib/projectConfig.svelte';
  import { loadRepoAccessToken, setRepoAccessToken } from './lib/repoSecrets';
  import { applyTheme } from './lib/theme';
  import {
    autoPullBeforeLabelKey,
    autoPullPlan,
    type AutoPullAction,
    type AutoPullDecision,
  } from './lib/autoPull';
  import { effectiveKeymap, dispatchKey } from './lib/keymap';
  import { setLocale, t } from './lib/i18n/index.svelte';
  import { localizedError } from './lib/i18n/errors';
  import { configureTelemetry, report, type Transport } from './lib/telemetry';
  import { errorReport } from './lib/errorReport';
  import {
    refreshEntitlement,
    hasFeature,
    getPlan,
    entitlementReady,
  } from './lib/license.svelte';
  import {
    authState,
    clerkConfigured,
    startSignIn,
    signOut,
    signInMock,
    initDeepLinks,
    restoreSession,
    refreshAccountProfile,
    completeSignIn,
    getPendingCallback,
  } from './lib/auth.svelte';
  import {
    createRefreshScheduler,
    subscribeRepoChanged,
    createFocusGate,
    preserveSelection,
  } from './lib/repoWatch';
  import { assignLanes, LANE_HEX } from './lib/lanes';
  import { trackClosing } from './lib/panelSlide.svelte';
  import { emitOutbound } from './lib/integrations/outbound';
  import {
    emptySelection,
    single,
    applyClick,
    applyMarquee,
    branchSegment,
    contiguousRange,
    type Selection,
    type ClickMods,
  } from './lib/selection';
  import type { DragOp, MergeDrop } from './lib/dragDispatch';
  import { createTutorial } from './lib/tutorial/tutorial.svelte';
  import { stepsWithoutTracker } from './lib/tutorial/steps';
  import type {
    TutorialAction,
    TutorialEvent,
    TutorialHost,
    TutorialRepoView,
  } from './lib/tutorial/types';

  import TopBar from './components/TopBar.svelte';
  import Toolbar from './components/Toolbar.svelte';
  import Toast from './components/Toast.svelte';
  import MetroGraph from './components/MetroGraph.svelte';
  import IconDefs from './lib/icons/IconDefs.svelte';
  import EmptyMain from './components/EmptyMain.svelte';
  import TruncationNotice from './components/TruncationNotice.svelte';
  import BranchesPanel from './components/BranchesPanel.svelte';
  import FilesPanel from './components/FilesPanel.svelte';
  import CommitDetails from './components/CommitDetails.svelte';
  import CreateCommitDialog from './components/CreateCommitDialog.svelte';
  import ContextMenu from './components/ContextMenu.svelte';
  import ConfirmRewrite, {
    type ChoiceGroup,
  } from './components/ConfirmRewrite.svelte';
  import ConfirmDialog from './components/ConfirmDialog.svelte';
  import {
    seatPromptOpen,
    confirmSeatPrompt,
    cancelSeatPrompt,
  } from './lib/deviceSeat.svelte';
  import ResolveBanner from './components/ResolveBanner.svelte';
  import DiffViewer from './components/DiffViewer.svelte';
  import CrashWindow from './components/CrashWindow.svelte';
  import AdGate from './components/AdGate.svelte';
  import CrashConsentNotice from './components/CrashConsentNotice.svelte';
  import { adGateOpen, mayDeclineAds } from './lib/adGate';
  import Welcome from './components/Welcome.svelte';
  import CloneDialog from './components/CloneDialog.svelte';
  import BranchEditDialog from './components/BranchEditDialog.svelte';
  import CountdownPrompt from './components/CountdownPrompt.svelte';
  import CreateBranchDialog from './components/CreateBranchDialog.svelte';
  import CheckoutRemoteDialog from './components/CheckoutRemoteDialog.svelte';
  import CheckoutBranchDialog from './components/CheckoutBranchDialog.svelte';
  import AdBanner from './components/AdBanner.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import UserMenu from './components/UserMenu.svelte';
  import SettingsModal from './components/SettingsModal.svelte';
  import TutorialOverlay from './components/tutorial/TutorialOverlay.svelte';
  import WelcomeTour from './components/tutorial/WelcomeTour.svelte';
  import FirstUseGuide from './components/tutorial/FirstUseGuide.svelte';
  import { pro, type IssueSurfaceApi } from './lib/pro';
  import type { SearchIssue } from './lib/search';

  const COMMIT_LIMIT = 1000;

  let repoPath = $state<string | null>(null);
  let repoName = $state<string | null>(null);
  // The opened repo's origin remote URL (sanitized of any embedded PAT),
  // detected on load, or null when the repo has no origin. This is
  // the priority-3 fallback target: the classification below prefers the
  // Settings URL and drops back to this detected repo URL when it is blank.
  let remoteDetected = $state<string | null>(null);
  let commits = $state<Commit[]>([]);
  let refs = $state<RefList | null>(null);
  let selected = $state<Commit | null>(null);
  // Multi-select set for gesture sources (cherry-pick a range); the details
  // panel still follows the single most-recent plain click via `selected`.
  let selection = $state<Selection>(emptySelection());
  // A branch label selected "as a unit" (the Delete-key remove-branch source).
  let selectedBranch = $state<{
    name: string;
    current: boolean;
    remote?: boolean;
  } | null>(null);
  let selectedFiles = $state<FileChange[]>([]);
  let filesLoading = $state(false);
  let filesError = $state<string | null>(null);
  let truncated = $state(false);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let ipcOk = $state(false);

  let activePanel = $state<'branches' | 'files' | null>(null);
  /** The left-docked panel (if any) that has just been closed and is still
   *  mounted so its slide-out can play. See lib/panelSlide.svelte.ts —
   *  class-driven CSS, not a Svelte `transition:`. */
  const panelClosing = trackClosing(() => activePanel);
  /** The HEAD "+" create-commit modal. */
  let showCreateCommit = $state(false);
  let showUser = $state(false);
  let showSettings = $state(false);
  type SettingsTab = 'Issue Panel' | 'Personalize';
  /** Tab SettingsModal should land on for the next open, or `null` for its
   *  default ('General'). Reset at every entry point except the issue panel's
   *  "Settings → Issue Panel" link, so a prior issue-link open never leaks
   *  into an unrelated later open (e.g. from the TopBar). Mid-tutorial every
   *  open lands on Personalize (see `openSettings`). */
  let settingsInitialTab = $state<SettingsTab | null>(null);
  /**
   * Live personalize preview while the Settings modal is open: the modal
   * reports its draft's `personalize` up here on every change, and
   * `effectivePersonalize` below prefers it over the saved value, so the WHOLE
   * of personalize previews — including `graphTheme`, which reaches the graph
   * as a prop (not as a CSS variable) and therefore never saw the modal's own
   * `applyTheme` preview.
   *
   * Strictly one-way (modal draft → here → the app); nothing here is ever fed
   * back into the modal's draft, so there is no preview/draft loop.
   *
   * `null` means "no modal-driven preview" — cleared by the effect below on
   * EVERY close route (Cancel, OK, backdrop, the keyboard toggle, or any other
   * unmount), so a preview can never get stuck pinning a stale theme.
   */
  let previewPersonalize = $state<PersonalizeSettings | null>(null);
  $effect(() => {
    if (!showSettings) previewPersonalize = null;
  });
  /** Hand-tool (pan) mode, MOMENTARILY held by the `switchHandTool` shortcut
   *  (default Space): press → hand tool; release → back to whatever tool was
   *  active before the press. While on, the graph shows a grab cursor and a
   *  left-drag pans it. */
  let handTool = $state(false);
  /** Whether a `switchHandTool` press is currently being held (set on its
   *  keydown, cleared on the matching keyup or a window blur) — guards
   *  against a stray keyup/blur restoring a tool that was never overridden. */
  let handToolHeld = false;
  /** `handTool`'s value from just before the held press started, restored
   *  verbatim on release — never assume "false": the shortcut can be
   *  rebound, and a future tool could already be active when it's pressed. */
  let handToolBefore = false;
  /** The physical key (`KeyboardEvent.key`) that started the current held
   *  press. Matched on keyup rather than re-checking the full combo, since
   *  releasing a modifier first (e.g. letting go of Shift before the letter
   *  in a "Shift+P" rebind) must not end the hold early — only releasing
   *  THIS key does, mirroring how held shortcuts behave elsewhere (Figma,
   *  Photoshop's space-pan). */
  let handToolHeldKey: string | null = null;

  /**
   * Strip the secret field before a `GeneralSettings` value crosses into
   * per-repo territory (seeding `projectConfig`, or the clone write-back
   * below) — `accessToken` must never reach `adgitter.config.json`. Doing
   * this explicitly (rather than relying on `ProjectGeneralSettings`'s
   * `Omit` type alone) closes the loophole where a plain object spread of a
   * `GeneralSettings` value still structurally carries the field at runtime
   * even though the destination variable's TS type says it doesn't.
   */
  function withoutAccessToken(g: GeneralSettings): ProjectGeneralSettings {
    const { accessToken: _accessToken, ...rest } = g;
    return rest;
  }

  // --- Settings & personalization --------------------------------------
  let settings = $state<Settings>(DEFAULT_SETTINGS);
  // The open repo's stored access token (repoSecrets.ts) — loaded async in
  // `loadRepo`, cleared in `closeRepo`. Never seeded from the global token
  // (see repoSecrets.ts's `loadRepoAccessToken` doc): a fresh repo starts
  // blank, same precedent as the issue-tracker binding coming back
  // 'disconnected' on reload.
  let repoAccessToken = $state('');

  // --- Effective per-repo/global values (repo-level settings) ---------------
  // General/Personalize/Log-Anytime (and the access token) moved from
  // app-global to per-repo storage, following the Issue Panel tab's existing
  // pattern: a repo open → the project-config slice (seeded from global on
  // first open, see `loadRepo`); no repo open → the global `settings` value.
  // Every consumer below reads through these instead of `settings.general` /
  // `settings.personalize` / `settings.logAnytime` directly, so closing a
  // repo falls back to global and switching repos switches settings
  // automatically.
  const effectiveGeneral = $derived(
    repoPath
      ? (projectGeneral() ?? withoutAccessToken(settings.general))
      : settings.general,
  );
  // The Settings modal's live draft wins while it is open (see
  // `previewPersonalize`); otherwise the saved repo/global value does.
  const effectivePersonalize = $derived(
    previewPersonalize ??
      (repoPath
        ? (projectPersonalize() ?? settings.personalize)
        : settings.personalize),
  );
  const effectiveLogAnytime = $derived(
    repoPath
      ? (projectLogAnytime() ?? settings.logAnytime)
      : settings.logAnytime,
  );
  const effectiveAccessToken = $derived(
    repoPath ? repoAccessToken : settings.general.accessToken,
  );

  // Remote-auth gating. The effective remote for classification follows the
  // fallback priority: the Settings URL wins, else the detected .git origin
  // (priority: config URL > repo URL). Given whether a PAT is set, the auth
  // mode is resolved. Public-host SSH URLs use HTTPS when a PAT is set.
  // Other non-HTTPS targets require an explicit HTTPS URL
  // (a token is useless over ssh/git and would leak over plain http, so it is
  // refused; clearing the token drops back to SSH-key / anonymous auth, which
  // every scheme is allowed to use). An HTTPS remote is still "git configured"
  // — the state that suppresses the commit-panel "add a token" nag (#25).
  const effectiveRemoteUrl = $derived(
    (effectiveGeneral.remoteUrl?.trim() || remoteDetected || '').trim(),
  );
  const remoteHasPat = $derived(effectiveAccessToken.trim().length > 0);
  const remoteAuthMode = $derived(
    resolveRemoteAuth(effectiveRemoteUrl, remoteHasPat),
  );
  const remoteBlocked = $derived(remoteAuthMode === 'pat-needs-https');
  const gitConfigured = $derived(
    effectiveRemoteUrl.length > 0 &&
      (isHttpsRemote(effectiveRemoteUrl) || remoteAuthMode === 'https-pat'),
  );

  // Apply theme/color/text-size live whenever the effective personalize
  // changes (incl. on load, repo switch, or repo close).
  $effect(() => {
    applyTheme(effectivePersonalize);
  });

  // --- Auth: close the login→unlock loop ----------------------------
  // Once a deep-link callback lands (auth → signing-in with pending params),
  // exchange the Clerk session JWT for a signed license and refresh entitlement.
  // Non-fatal (try/catch, free-tier default) exactly like the surrounding sign-in
  // code; leaves state at signing-in if the handshake JWT isn't provisioned yet.
  $effect(() => {
    if (authState().status !== 'signing-in') return;
    if (!getPendingCallback()) return;
    void (async () => {
      try {
        const ok = await completeSignIn(settings.installId);
        if (ok) void refreshEntitlement();
      } catch (e) {
        console.error('completeSignIn failed', e);
      }
    })();
  });

  // --- Telemetry & crash reporting -------------------------------------
  // Frontend errors are forwarded to the backend, which sends them to the same
  // Sentry project (consent-gated there too).
  const tauriTransport: Transport = {
    async send(p) {
      await reportEvent(p.errorCode, p.message);
    },
  };
  // Telemetry sends only on granted consent; reconfigure live as it changes and
  // arm/disarm the backend Sentry client to match.
  $effect(() => {
    const granted = settings.crashReports === 'granted';
    configureTelemetry({ consent: granted });
    void initCrashReporting(granted).catch(() => {});
  });
  let crash = $state<{ reported: boolean } | null>(null);

  // Free tier = ads or pay (lib/adGate.ts). Waits for settings and the
  // entitlement so neither a paying user nor a returning one sees it flash.
  let settingsReady = $state(false);
  const canDeclineAds = mayDeclineAds();
  const showAdGate = $derived(
    settingsReady &&
      adGateOpen({
        ready: entitlementReady(),
        plan: getPlan(),
        consent: settings.adConsent,
        mayDecline: canDeclineAds,
      }),
  );

  // --- Guided tutorial -------------------------------------------------
  // The engine (lib/tutorial) decides what may run and when a step is done; App
  // is its host (demo repo IPC + this window's repo state) and asks it before
  // every user operation (`tutAllows`) and reports what happened
  // (`tutNotify`). While no tutorial runs `allows` is always true, so none of
  // the guards below change production behaviour.

  /** The demo repository the running tutorial created, or null. Scopes the
   *  Issue panel's preview mode and keeps the demo out of recents. */
  let tutorialDemoPath = $state<string | null>(null);
  /** The first-use intro (US4) is showing. */
  let showFirstUseGuide = $state(false);
  /** Only the main window greets / runs the tutorial (multi-window). */
  let isMainWindow = $state(false);

  /** What the engine reasons about: the open repo's commits (with parents),
   *  local branch tips, tags and HEAD. Derived, so it is rebuilt only when the
   *  graph data actually changes. */
  const tutorialView = $derived.by((): TutorialRepoView | null => {
    if (!repoPath || !refs) return null;
    const branches: Record<string, string> = {};
    for (const b of refs.branches) branches[b.name] = b.target;
    const tags: Record<string, string> = {};
    for (const tg of refs.tags) tags[tg.name] = tg.target;
    return {
      repoPath,
      head: refs.head.branch ?? null,
      commits: commits.map((c) => ({
        sha: c.sha,
        subject: c.subject,
        parents: c.parents,
      })),
      branches,
      tags,
    };
  });

  /** Run a demo IPC call, turning a tagged backend error into the localized
   *  text the coach card shows next to Retry. */
  async function tutorialIpc<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      throw new Error(localizedError(e));
    }
  }

  const tutorialHost: TutorialHost = {
    async createDemo() {
      const made = await tutorialIpc(() => tutorialDemoCreate());
      tutorialDemoPath = made.repoPath;
      return made;
    },
    async seedFiles(path) {
      const files = await tutorialIpc(() => tutorialDemoSeedFiles(path));
      filesReload += 1;
      return files;
    },
    async seedHistory(path) {
      await tutorialIpc(() => tutorialDemoSeedHistory(path));
      await refresh();
    },
    async writeFile(path, file, content) {
      await tutorialIpc(() => tutorialDemoWriteFile(path, file, content));
      filesReload += 1;
    },
    async simulateLog(path, branch, count) {
      const shas = await tutorialIpc(() =>
        tutorialDemoSimulateLog(path, branch, count),
      );
      await refresh();
      return shas;
    },
    removeDemo: (path) => tutorialDemoRemove(path),
    async openRepo(path) {
      issueSurface?.reset();
      await loadRepo(path);
      if (repoPath !== path) {
        // loadRepo already turned the failure into the error toast; the coach
        // card shows it instead (with Retry), so don't show it twice.
        const message = error ?? t('error.INTERNAL_ERROR');
        error = null;
        throw new Error(message);
      }
      // The demo starts with Log Anytime off whatever the global default is:
      // step 19 is "turn it on". In memory only, like any first-open seed.
      const logAnytime = projectLogAnytime() ?? settings.logAnytime;
      if (logAnytime.enabled)
        seedProjectLogAnytime({ ...logAnytime, enabled: false });
    },
    async closeRepo() {
      pending = null;
      forcePushPending = false;
      menu = null;
      diffView = null;
      showSettings = false;
      showCreateCommit = false;
      checkoutChoice = null;
      issueSurface?.reset();
      // Unlike every other close route this waits for the file watcher to
      // stop: the engine deletes the demo directory right after, and a watcher
      // still holding it makes that fail on Windows.
      await closeRepo();
    },
    repoView: () => tutorialView,
    saveFlags: (flags) =>
      persistSettings({
        ...settings,
        tutorial: { ...settings.tutorial, ...flags },
      }),
    showFirstUse() {
      showFirstUseGuide = true;
    },
  };

  // Without the issue tracker the script skips the steps that drive it.
  const tutorial = createTutorial(
    tutorialHost,
    pro ? undefined : stepsWithoutTracker(),
    {
      firstUseShown: () => settings.tutorial.firstUseShown,
      onEnd: resetTutorialRun,
    },
  );
  const tutorialPresentation = $derived(tutorial.presentation);
  /** Steps 1–2 are the WelcomeTour dialog, not the spotlight overlay. */
  const tutorialWelcome = $derived(
    tutorialPresentation?.id === 'welcome' ||
      tutorialPresentation?.id === 'choose',
  );
  /** A step with its own primary button (3 "Create demo", 24 "Finish") shows
   *  that button INSTEAD of Next — both would do the same thing. */
  const overlayPresentation = $derived(
    tutorialPresentation?.primaryLabelKey &&
      tutorialPresentation.mode === 'info'
      ? { ...tutorialPresentation, mode: 'action' as const }
      : tutorialPresentation,
  );
  /** The Issue panel runs in tutorial preview mode (mock provider, unlocked)
   *  only on the tutorial's own demo repo. */
  const tutorialDemoOpen = $derived(
    tutorial.active && repoPath !== null && repoPath === tutorialDemoPath,
  );

  /** Tutorial gate — ask BEFORE any side effect; always true when inactive. */
  function tutAllows(action: TutorialAction): boolean {
    return untrack(() => tutorial.allows(action));
  }

  /** Tutorial outcome — report AFTER the operation resolved. Untracked, so it
   *  is safe from inside an effect (notify reads and bumps engine state). */
  function tutNotify(event: TutorialEvent): void {
    untrack(() => tutorial.notify(event));
  }

  /** The run is over (finished, exited or "use directly"): the engine calls
   *  this synchronously the moment it ends, before the demo is cleaned up.
   *  Drops the preview provider and everything the Issue panel loaded from it,
   *  so a real repo opened next never sees the demo issues. Explicit rather
   *  than an effect on `tutorial.active`: a run that is exited and restarted
   *  in the same tick must not leave its provider behind. */
  function resetTutorialRun() {
    tutorialDemoPath = null;
    issueSurface?.reset();
  }

  // The details panel shows a commit ⇒ `detailOpened` (step 14a).
  $effect(() => {
    const sha = selected?.sha;
    if (sha) tutNotify({ kind: 'detailOpened', sha });
  });

  /**
   * (Re)start the guided tutorial, optionally at a step id. Replay and the
   * first-launch trigger go through the engine directly; this export is the
   * seam for automation (App tests begin mid-script with it).
   */
  // (A default rather than an optional `?` parameter: Svelte's own TypeScript
  // stripping leaves the `?` behind on an exported function.)
  export function startTutorial(
    fromStepId: string | null = null,
  ): Promise<void> {
    return tutorial.start(fromStepId ?? undefined);
  }

  /** Replay (US3): start again from step 3 with a fresh demo repo. */
  function replayTutorial() {
    showUser = false;
    if (tutorial.active) return;
    if (repoPath) void tutorialHost.closeRepo();
    void tutorial.start('create-demo');
  }

  // --- Log Anytime: foreground snapshot timer -------------------------
  // While enabled with a repo open, snapshot the working tree to the log branch
  // every interval. Re-arms on config/repo change; errors are non-fatal.
  // Suppressed while the guided tutorial runs: step 20 simulates snapshots on
  // the demo instead, and nothing may write on its own mid-step.
  $effect(() => {
    if (tutorial.active) return;
    const { enabled, branch, intervalMin, autoPush } = effectiveLogAnytime;
    const path = repoPath;
    const dryRun = effectiveGeneral.dryRun;
    const blocked = remoteBlocked;
    const auth = remoteAuth();
    const target = remoteTargetUrl();
    if (!enabled || !path || dryRun) return;
    const ms = Math.max(1, intervalMin) * 60_000;
    let running = false;
    let cancelled = false;
    const id = setInterval(async () => {
      if (running) return;
      running = true;
      try {
        const sha = await logCommit(path, branch);
        if (sha && autoPush && !blocked && !cancelled) {
          await pushBranch(path, branch, 'origin', auth, target);
        }
      } catch (e) {
        // A failed push leaves the successfully recorded local snapshot intact.
        setError(e);
      } finally {
        running = false;
      }
    }, ms);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  });

  /** Report a thrown value (consent-gated, scrubbed) with its error code. */
  function reportFailure(e: unknown) {
    const { code, message } = errorReport(e);
    report(code, message);
  }

  /** Show a localized error toast and report it. */
  function setError(e: unknown) {
    error = localizedError(e);
    reportFailure(e);
  }

  // --- Onboarding / Welcome flow ---------------------------------------
  let recents = $state<RecentProject[]>([]);
  // Clone-from-remote dialog (Welcome → "Clone from remote").
  let cloneOpen = $state(false);
  // A picked folder with no git repo, awaiting "create a new one here?".
  let confirmCreatePath = $state<string | null>(null);
  let onboardBusy = $state(false);
  let cloneBusy = $state(false);
  let cloneProgress = $state<CloneProgress | null>(null);

  // --- Remote sync -------------------------------------------------
  let sync = $state<AheadBehind | null>(null);
  let pushBusy = $state(false);
  let pullBusy = $state(false);
  // Force push is advanced + destructive (toolbar Push ▾ menu):
  // it always routes through this confirm gate before `push(..., force: true)`
  // ever reaches IPC.
  let forcePushPending = $state(false);
  // Bumped on each refresh so the Files panel re-reads working-tree status when
  // the repo changes on disk.
  let filesReload = $state(0);

  // --- History gestures / context menus ----------------------------
  // A pending rewriting op awaiting confirmation, plus its dialog copy. Routed
  // through ConfirmRewrite so the user always sees what will change.
  type PendingOp =
    | { kind: 'revert'; commit: Commit }
    | { kind: 'cherryPick'; shas: string[]; label: string }
    | {
        kind: 'reset';
        target: string;
        mode: ResetMode;
        short: string;
        candidates?: string[];
        commitSha?: string;
      }
    | { kind: 'drop'; commit: Commit }
    | { kind: 'reword'; commit: Commit }
    | { kind: 'squash'; shas: string[] }
    | { kind: 'merge'; source: string }
    | { kind: 'rebaseOnto'; onto: string }
    // `candidates`/`sourceCandidates`/`targetCandidates` (≥2 entries, else
    // absent/empty) mean that end of the gesture landed on a commit carrying
    // several local branches, so the confirm dialog must ask which one
    // instead of taking the display-order first. A merge drag can be
    // ambiguous at both ends at once, hence two lists.
    | {
        kind: 'mergeBranches';
        source: string;
        target: string;
        sourceCandidates?: string[];
        targetCandidates?: string[];
      }
    | {
        kind: 'rebaseBranch';
        branch: string;
        onto: string;
        candidates?: string[];
      }
    | {
        kind: 'cherryPickNewBranch';
        shas: string[];
        target: string;
        short: string;
      }
    | { kind: 'removeBranch'; name: string };
  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  let pending = $state<PendingOp | null>(null);
  let opBusy = $state(false);
  let canUndo = $state(false);
  let undoBusy = $state(false);
  /**
   * Why the backend says Undo is off, when it is off for a reason worth
   * explaining. Only `external_change` ever reaches the user: "nothing to
   * undo" and "an op is paused" are both already obvious from the screen,
   * whereas a dead Undo button after a terminal `git commit` is a mystery
   * unless we say so.
   */
  let undoReason = $state<UndoBlockedReason | null>(null);
  let notice = $state<string | null>(null);

  // --- Conflict resolution mode ----------------------------
  // Non-null while a merge/rebase/squash/reword sits paused on a conflict.
  // While set: the graph is locked (MetroGraph interactive={false} + gesture/
  // key guards below), undo/pull/push are disabled, and the ResolveBanner
  // offers Continue (gated on conflictedCount === 0) / Abort (confirm-gated).
  let resolve = $state<ResolveState | null>(null);
  /** A continue/abort IPC call is in flight. */
  let resolveBusy = $state(false);
  /** The Abort confirm dialog is open. */
  let abortPending = $state(false);
  // Live count of unmerged paths, driving the banner's Continue enablement.
  // Kept fresh by TWO complementary paths (each covers the case the other
  // can't): (1) FilesPanel's onStatus callback fires with every status the
  // panel loads — including the reload right after each stage action, which
  // never bumps filesReload; (2) the $effect below re-fetches repoStatus on
  // every filesReload bump while resolving (refresh()/repo-changed), which
  // still works when the user has closed the files panel.
  let conflictedCount = $state(0);

  /** Enter (or re-enter, on a continue that re-conflicts) resolve mode. */
  function enterResolve(state: ResolveState) {
    resolve = state;
    // Pessimistic until a real status lands — keeps Continue disabled during
    // the first status round-trip rather than flashing enabled.
    conflictedCount = Math.max(conflictedCount, 1);
    activePanel = 'files';
    filesReload += 1;
  }

  /** Track the conflicted count from a fresh RepoStatus (see conflictedCount). */
  function trackConflicted(st: { conflicted?: unknown[] }) {
    conflictedCount = st.conflicted?.length ?? 0;
  }

  // Path (2): App-level status poll while resolving (see conflictedCount doc).
  $effect(() => {
    void filesReload;
    if (!resolve || !repoPath) return;
    void repoStatus(repoPath)
      .then(trackConflicted)
      .catch(() => {});
  });

  // --- Diff viewer -------------------------------------------------
  interface DiffView {
    title: string;
    subtitle: string;
    loading: boolean;
    error: string | null;
    data: FileDiff | null;
  }
  let diffView = $state<DiffView | null>(null);
  let diffSeq = 0; // latest-wins token for rapid file clicks

  async function openCommitDiff(path: string) {
    if (!repoPath || !selected) return;
    if (!tutAllows({ kind: 'other', name: 'diff' })) return;
    const sha = selected.sha;
    const seq = ++diffSeq;
    diffView = {
      title: path,
      subtitle: selected.short_sha,
      loading: true,
      error: null,
      data: null,
    };
    try {
      const d = await diffFile(repoPath, sha, path);
      if (seq === diffSeq && diffView)
        diffView = { ...diffView, loading: false, data: d };
    } catch (e) {
      if (seq === diffSeq && diffView)
        diffView = { ...diffView, loading: false, error: localizedError(e) };
    }
  }

  async function openWorktreeDiff(path: string) {
    if (!repoPath) return;
    if (!tutAllows({ kind: 'other', name: 'diff' })) return;
    const seq = ++diffSeq;
    diffView = {
      title: path,
      subtitle: 'Working tree',
      loading: true,
      error: null,
      data: null,
    };
    try {
      const d = await diffWorktree(repoPath, path);
      if (seq === diffSeq && diffView)
        diffView = { ...diffView, loading: false, data: d };
    } catch (e) {
      if (seq === diffSeq && diffView)
        diffView = { ...diffView, loading: false, error: localizedError(e) };
    }
  }

  interface MenuItem {
    label: string;
    danger?: boolean;
    disabled?: boolean;
    onSelect?: () => void;
    children?: MenuItem[];
  }

  function commitMenu(c: Commit, x: number, y: number) {
    const onCurrent = refs?.head.branch != null;
    const cur = refs?.head.branch ?? null;
    // Checkout targets at this commit: pointing branches (newest-created
    // first), pointing tags, and always the raw commit (detached).
    const pointing = (refs?.branches ?? [])
      .filter((b) => b.target === c.sha)
      .sort((a, b) => (b.created_ms ?? 0) - (a.created_ms ?? 0));
    const pointingTags = (refs?.tags ?? []).filter((tg) => tg.target === c.sha);
    // Squash is only offered when the right-clicked commit is already inside
    // the current selection (right-click doesn't mutate it) and that
    // selection is a contiguous single-branch range.
    const squashRangeShas =
      onCurrent && selection.shas.has(c.sha)
        ? contiguousRange(selection, commits)
        : null;
    const checkoutChildren: MenuItem[] = [
      ...pointing.map((b) => ({
        label:
          b.name === cur ? t('menu.branchCurrent', { branch: b.name }) : b.name,
        disabled: b.name === cur,
        onSelect: () => void doCheckout(b.name),
      })),
      ...pointingTags.map((tg) => ({
        label: t('menu.checkoutTag', { tag: tg.name }),
        onSelect: () => void doCheckout(tg.name),
      })),
      {
        label: t('menu.checkoutDetached', { short: c.short_sha }),
        onSelect: () => void doCheckout(c.sha),
      },
    ];
    const items: MenuItem[] = [
      { label: t('menu.checkout'), children: checkoutChildren },
      {
        label: t('menu.createBranchHere'),
        onSelect: () => (createBranchFrom = { rev: c.sha, label: c.short_sha }),
      },
      { label: '---' },
      {
        label: t('menu.cherryPickOnto', {
          branch: refs?.head.branch ?? t('branch.head'),
        }),
        disabled: !onCurrent,
        onSelect: () =>
          (pending = { kind: 'cherryPick', shas: [c.sha], label: c.subject }),
      },
      {
        label: t('menu.revert'),
        onSelect: () => (pending = { kind: 'revert', commit: c }),
      },
      {
        label: t('menu.reword'),
        onSelect: () => (pending = { kind: 'reword', commit: c }),
      },
      ...(squashRangeShas
        ? [
            {
              label: t('menu.squash'),
              danger: true,
              onSelect: () =>
                (pending = { kind: 'squash', shas: squashRangeShas }),
            },
          ]
        : []),
      { label: '---' },
      {
        label: t('menu.resetMixed'),
        disabled: !onCurrent,
        onSelect: () =>
          (pending = {
            kind: 'reset',
            target: c.sha,
            mode: 'mixed',
            short: c.short_sha,
          }),
      },
      {
        label: t('menu.resetHard'),
        danger: true,
        disabled: !onCurrent,
        onSelect: () =>
          (pending = {
            kind: 'reset',
            target: c.sha,
            mode: 'hard',
            short: c.short_sha,
          }),
      },
      { label: '---' },
      {
        label: t('menu.drop'),
        danger: true,
        disabled: !onCurrent,
        onSelect: () => (pending = { kind: 'drop', commit: c }),
      },
    ];
    menu = { x, y, items };
  }

  function branchMenu(
    branch: { name: string; current: boolean },
    x: number,
    y: number,
  ) {
    const cur = refs?.head.branch ?? null;
    // Every other local branch is a valid merge/rebase target; the current
    // branch (if it's a candidate) is listed first and marked as such.
    const others = (refs?.branches ?? [])
      .map((b) => b.name)
      .filter((name) => name !== branch.name);
    const candidates =
      cur != null && others.includes(cur)
        ? [cur, ...others.filter((name) => name !== cur)]
        : others;
    const targetLabel = (name: string) =>
      name === cur ? t('menu.branchCurrent', { branch: name }) : name;

    const items: MenuItem[] = [
      {
        label: t('menu.checkout'),
        disabled: branch.current,
        onSelect: () => void doCheckout(branch.name),
      },
      { label: '---' },
      {
        label: t('menu.mergeIntoParent', { branch: branch.name }),
        disabled: candidates.length === 0,
        children: candidates.map((target) => ({
          label: targetLabel(target),
          onSelect: () =>
            (pending = { kind: 'mergeBranches', source: branch.name, target }),
        })),
      },
      {
        label: t('menu.rebaseOntoParent', { branch: branch.name }),
        disabled: candidates.length === 0,
        children: candidates.map((toRebase) => ({
          label: targetLabel(toRebase),
          onSelect: () =>
            (pending = {
              kind: 'rebaseBranch',
              branch: toRebase,
              onto: branch.name,
            }),
        })),
      },
      { label: '---' },
      {
        label: t('menu.createBranchFrom', { branch: branch.name }),
        onSelect: () => {
          const target = refs?.branches.find(
            (b) => b.name === branch.name,
          )?.target;
          if (target) createBranchFrom = { rev: target, label: branch.name };
        },
      },
      {
        label: t('menu.branchProps'),
        onSelect: () => void openBranchEdit(branch.name),
      },
    ];
    menu = { x, y, items };
  }

  // --- Create branch from the commit/branch context menus --------------------
  let createBranchFrom = $state<{ rev: string; label: string } | null>(null);

  /** Dialog submit; rejects on failure so the dialog shows the error inline. */
  async function doCreateBranch(name: string) {
    if (!repoPath || !createBranchFrom) return;
    // Auto-pull gate (see `autoPullBefore`). A false gate means the action was
    // ABANDONED — Cancel on the prompt, a failed pull, a conflict — so the
    // dialog closes with it. Leaving the form sitting there with nothing said
    // reads as a dead Create button, and the gate's own toast
    // (`autoPull.cancelled` / `autoPull.failed` / `autoPull.conflicted`) has
    // already explained what happened.
    //
    // A genuine SUBMIT failure is still the other thing: `createBranch` below
    // rejects, this function rejects with it, and CreateBranchDialog keeps
    // itself open with the error inline — the form stays up because there is
    // something to fix in it.
    if (!(await autoPullBefore('createBranch'))) {
      createBranchFrom = null;
      return;
    }
    await createBranch(repoPath, name, createBranchFrom.rev);
    createBranchFrom = null;
    await refresh();
    notice = t('notice.branchCreated', { name });
  }

  // --- Checkout a remote branch (graph chip / Branches panel row) -----------
  // Double-click or the "Checkout…" context-menu item on a remote asks the
  // backend what the situation *is* first (`inspectRemoteCheckout`), then asks
  // the one question that fits — or none, when a local branch already tracks
  // this remote at the same commit. There is still no direct single-click
  // checkout path for a remote ref.
  //
  // The whole matrix is classified in git-core; this code only maps a case to
  // its prompt. Reconstructing the verdict here from several probes would race
  // a repo that moves between them and would duplicate the rule in TS.
  let remoteCheckout = $state<{ remote: string; suggested: string } | null>(
    null,
  );
  /** Step one of the no-upstream flow: "track this remote branch?" */
  let remoteAdopt = $state<{
    remote: string;
    branch: string;
    ahead: number;
    behind: number;
    sync: SyncPrompt;
  } | null>(null);
  /** Step two (also reached on its own): "pull to fast-forward?" */
  let remotePull = $state<{
    remote: string;
    branch: string;
    behind: number;
    /** Step one ran just now, so a cancel here must still report it. */
    upstreamJustSet: boolean;
  } | null>(null);
  let remoteCheckoutBusy = $state(false);

  /** The local name a fresh checkout of `remoteName` would use: the remote
   *  prefix (e.g. "origin/") stripped, falling back to the whole name when
   *  there's no '/'. */
  function suggestedLocalFor(remoteName: string): string {
    const slash = remoteName.indexOf('/');
    return slash >= 0 ? remoteName.slice(slash + 1) : remoteName;
  }

  /** The *remote* half of a remote-tracking shorthand: "origin/feature" →
   *  "origin". Used to keep the network half of this flow origin-only, because
   *  the configured PAT belongs to origin and to nothing else. */
  function remoteNameOf(remoteName: string): string {
    const slash = remoteName.indexOf('/');
    return slash >= 0 ? remoteName.slice(0, slash) : 'origin';
  }

  /** Inspect `remoteName`, then route to the prompt its case calls for. */
  async function requestRemoteCheckout(remoteName: string) {
    if (!repoPath) return;
    if (!tutAllows({ kind: 'other', name: 'remote-checkout' })) return;
    try {
      await routeRemoteCheckout(
        remoteName,
        await inspectRemoteCheckout(
          repoPath,
          remoteName,
          suggestedLocalFor(remoteName),
        ),
      );
    } catch (e) {
      // Includes the one unresolvable row (REMOTE_UPSTREAM_MISMATCH), whose
      // message already names the branch, what it tracks and what was asked.
      setError(e);
    }
  }

  /** Act on a classification: one prompt (or none) per case. */
  async function routeRemoteCheckout(
    remoteName: string,
    plan: RemoteCheckoutPlan,
  ) {
    switch (plan.case) {
      case 'createLocal':
        remoteCheckout = { remote: remoteName, suggested: plan.suggestedLocal };
        return;
      case 'checkout':
        // Already tracking it: check out with no prompt at all, then raise
        // only what the divergence (if any) actually warrants.
        await runRemoteCheckout(remoteName, plan, false, () =>
          checkout(repoPath!, plan.localName),
        );
        return;
      case 'adoptUpstream':
        remoteAdopt = {
          remote: remoteName,
          branch: plan.localName,
          ahead: plan.ahead,
          behind: plan.behind,
          sync: plan.sync,
        };
        return;
      default: {
        // Exhaustive by construction: a new case in git-core's
        // `RemoteCheckoutPlan` fails to compile here rather than silently
        // falling through to "checked out, nothing to say".
        const unhandled: never = plan;
        throw new Error(`unhandled remote checkout plan: ${unhandled}`);
      }
    }
  }

  /** Run `act` (the checkout, with or without wiring an upstream first), then
   *  announce / prompt according to `sync`. */
  async function runRemoteCheckout(
    remote: string,
    plan: {
      localName: string;
      ahead: number;
      behind: number;
      sync: SyncPrompt;
    },
    upstreamJustSet: boolean,
    act: () => Promise<void>,
  ) {
    remoteCheckoutBusy = true;
    try {
      await act();
      remoteCheckout = null;
      remoteAdopt = null;
      await refresh();
      afterRemoteCheckout(remote, plan, upstreamJustSet);
    } catch (e) {
      // A refused checkout (conflicting uncommitted changes) lands here and
      // leaves every dialog open so the user can retry or cancel.
      setError(e);
    } finally {
      remoteCheckoutBusy = false;
    }
  }

  /** Map the backend's `sync` verdict onto a notice or the pull prompt. */
  function afterRemoteCheckout(
    remote: string,
    plan: {
      localName: string;
      ahead: number;
      behind: number;
      sync: SyncPrompt;
    },
    upstreamJustSet: boolean,
  ) {
    const branch = plan.localName;
    // When step one just ran, every outcome has to say so — a cancel at step
    // two must not leave the user wondering whether the upstream stuck.
    const prefix = upstreamJustSet
      ? t('notice.remoteUpstreamSet', { branch, remote })
      : '';
    const say = (body: string) =>
      (notice = prefix ? `${prefix} ${body}` : body);
    switch (plan.sync) {
      case 'none':
        notice = prefix || t('notice.remoteInSync', { branch, remote });
        return;
      case 'offerPull':
        // Two reasons to state the fact instead of offering the pull:
        //   - `remoteBlocked` — a PAT on a non-HTTPS URL can't be pulled from,
        //     so the question's only honest answer is "no".
        //   - a remote other than origin — this app's credential model is
        //     single-remote: the configured PAT belongs to origin. Pulling
        //     `fork/…` would therefore either go out unauthenticated (and fail
        //     on anything private) or hand origin's token to whatever host
        //     `fork` points at. Neither belongs behind a yes/no the user reads
        //     as routine, so the divergence is reported and the deliberate
        //     remote affordances keep ownership of the network call.
        if (remoteBlocked || remoteNameOf(remote) !== 'origin') {
          say(
            t('notice.remotePullSkipped', {
              branch,
              remote,
              behind: plan.behind,
            }),
          );
          return;
        }
        if (prefix) notice = prefix;
        remotePull = {
          remote,
          branch,
          behind: plan.behind,
          upstreamJustSet,
        };
        return;
      case 'localAhead':
        say(
          t('notice.remoteLocalAhead', { branch, remote, ahead: plan.ahead }),
        );
        return;
      case 'diverged':
        say(
          t('notice.remoteDiverged', {
            branch,
            remote,
            ahead: plan.ahead,
            behind: plan.behind,
          }),
        );
        return;
      default: {
        const unhandled: never = plan.sync;
        throw new Error(`unhandled sync prompt: ${unhandled}`);
      }
    }
  }

  /** Step one confirmed: wire the upstream and check the branch out. */
  async function doRemoteAdoptUpstream() {
    if (!repoPath || !remoteAdopt) return;
    const { remote, branch, ahead, behind, sync } = remoteAdopt;
    await runRemoteCheckout(
      remote,
      { localName: branch, ahead, behind, sync },
      true,
      () => adoptRemoteUpstreamAndCheckout(repoPath!, remote, branch),
    );
  }

  /** Step two confirmed: pull to fast-forward the branch we just checked out.
   *
   *  Origin-only, like every other pull/push call site — `remoteAuth()` carries
   *  the PAT the user configured for origin, so sending it anywhere else would
   *  disclose it. `afterRemoteCheckout` never raises the prompt for another
   *  remote; the guard below is the enforcement, so a future caller cannot
   *  re-open the hole by wiring this up directly. */
  async function doRemoteCheckoutPull() {
    if (!repoPath || !remotePull) return;
    const { remote } = remotePull;
    if (remoteNameOf(remote) !== 'origin') {
      remotePull = null;
      return;
    }
    if (effectiveGeneral.dryRun) {
      remotePull = null;
      notice = t('notice.dryRunPull');
      return;
    }
    remoteCheckoutBusy = true;
    try {
      await pull(repoPath, 'origin', remoteAuth(), remoteTargetUrl());
      canUndo = true;
      remotePull = null;
      await refresh();
      notice = t('notice.pulled');
    } catch (e) {
      setError(e);
    } finally {
      remoteCheckoutBusy = false;
    }
  }

  /** Step two cancelled. Step one (upstream + checkout) stays applied, and the
   *  notice says exactly that, plus how far behind the branch still is. */
  function cancelRemoteCheckoutPull() {
    if (!remotePull) return;
    const { remote, branch, behind, upstreamJustSet } = remotePull;
    remotePull = null;
    const skipped = t('notice.remotePullSkipped', { branch, remote, behind });
    notice = upstreamJustSet
      ? `${t('notice.remoteUpstreamSet', { branch, remote })} ${skipped}`
      : skipped;
  }

  /** Right-click on the graph's remote chip: the shared context menu, with the
   *  single "Checkout…" item that opens the confirm dialog. */
  function remoteChipMenu(name: string, x: number, y: number) {
    menu = {
      x,
      y,
      items: [
        {
          label: t('menu.checkoutRemote'),
          onSelect: () => void requestRemoteCheckout(name),
        },
      ],
    };
  }

  /** Primary action: create a local branch tracking the remote and check it out. */
  async function doRemoteCheckoutCreate(localName: string) {
    if (!repoPath || !remoteCheckout) return;
    const { remote } = remoteCheckout;
    remoteCheckoutBusy = true;
    try {
      // The name is editable, so classify *this* name before creating anything:
      // typing the name of a branch that already exists is the same situation
      // as double-clicking it, and deserves the same question rather than
      // "a local branch named … already exists".
      const plan = await inspectRemoteCheckout(repoPath, remote, localName);
      if (plan.case !== 'createLocal') {
        remoteCheckout = null;
        await routeRemoteCheckout(remote, plan);
        return;
      }
      await checkoutRemoteBranch(repoPath, remote, localName);
      remoteCheckout = null;
      await refresh();
      notice = t('notice.remoteCheckedOut', { branch: localName });
    } catch (e) {
      setError(e);
    } finally {
      remoteCheckoutBusy = false;
    }
  }

  /** Secondary action: check out the remote's tip directly (detached HEAD). */
  async function doRemoteCheckoutDetached() {
    if (!repoPath || !remoteCheckout) return;
    const { remote } = remoteCheckout;
    remoteCheckoutBusy = true;
    try {
      await checkout(repoPath, remote);
      remoteCheckout = null;
      await refresh();
      notice = t('notice.detachedCheckedOut', { name: remote });
    } catch (e) {
      setError(e);
    } finally {
      remoteCheckoutBusy = false;
    }
  }

  /** Double-click a commit node: check out the branch pointing at it (with
   *  several, the most recently created wins); with none, check out the
   *  commit itself — detached HEAD. */
  function activateCommit(c: Commit) {
    const pointing = (refs?.branches ?? []).filter((b) => b.target === c.sha);
    if (pointing.length === 0) {
      if (!repoPath || refs?.head.target === c.sha) return;
      if (!tutAllows({ kind: 'checkout', target: c.sha })) return;
      void (async () => {
        try {
          await checkout(repoPath, c.sha);
          await refresh();
          notice = t('notice.detachedAt', { short: c.short_sha });
          tutNotify({ kind: 'checkedOut', target: c.sha });
        } catch (e) {
          setError(e);
        }
      })();
      return;
    }
    const newest = pointing.reduce((a, b) =>
      (b.created_ms ?? 0) > (a.created_ms ?? 0) ? b : a,
    );
    if (newest.name === refs?.head.branch) return;
    void doCheckout(newest.name);
  }

  // --- Per-branch lane color ---------------------------------------
  let editingBranch = $state<string | null>(null);
  // The editing branch's current upstream, loaded before the dialog
  // opens so it seeds the Properties dialog without an async flicker.
  let editingUpstream = $state<string | null>(null);

  /** Open the branch Properties dialog, pre-loading its current upstream. */
  async function openBranchEdit(name: string) {
    editingUpstream = repoPath
      ? await branchUpstream(repoPath, name).catch(() => null)
      : null;
    editingBranch = name;
  }

  /** Default lane hex for a branch (used to seed the picker when no override). */
  function branchDefaultHex(name: string): string {
    const target = refs?.branches.find((b) => b.name === name)?.target;
    const ci = target != null ? (colorBySha.get(target) ?? 0) : 0;
    return LANE_HEX[ci % LANE_HEX.length];
  }

  function setBranchColor(name: string, hex: string) {
    void setProjectBranchColor(name, hex);
    editingBranch = null;
  }

  function resetBranchColor(name: string) {
    void resetProjectBranchColor(name);
    editingBranch = null;
  }

  /**
   * BranchEditDialog Confirm — shared by the graph's branch-chip menu and the
   * Branches panel's row Edit icon. Renames FIRST, and only then touches the
   * colour: a failed rename must leave both alone, or the override would end up
   * keyed to a branch name that does not exist while the real branch silently
   * keeps its old colour.
   *
   * Colour overrides are keyed by branch name, so a rename MOVES the entry
   * rather than adding a second one — a leftover key would later colour an
   * unrelated branch that happens to reuse the old name.
   */
  async function confirmBranchEdit(
    from: string,
    name: string,
    hex: string,
    upstream: string | null,
  ) {
    const trimmed = name.trim();
    let renamed = false;
    if (repoPath && trimmed && trimmed !== from) {
      try {
        await renameBranch(repoPath, from, trimmed);
      } catch (e) {
        setError(e);
        return;
      }
      renamed = true;
    }
    const target = renamed ? trimmed : from;
    if (renamed) await moveProjectBranchColor(from, target);
    await setProjectBranchColor(target, hex);
    // Upstream: only touch git config when the user actually
    // changed it — a no-op set is avoided so an unrelated rename/colour edit
    // never rewrites tracking config.
    const upstreamChanged = upstream !== editingUpstream;
    if (repoPath && upstreamChanged) {
      try {
        await setUpstream(repoPath, target, upstream);
      } catch (e) {
        setError(e);
        editingBranch = null;
        return;
      }
    }
    editingBranch = null;
    if (renamed || upstreamChanged) await refresh();
  }

  async function doCheckout(name: string) {
    if (!repoPath) return;
    if (!tutAllows({ kind: 'checkout', target: name })) return;
    try {
      await checkout(repoPath, name);
      await refresh();
      tutNotify({ kind: 'checkedOut', target: name });
    } catch (e) {
      setError(e);
    }
  }

  /**
   * Branch-disambiguation prompts for the pending op: one group per end of
   * the gesture that landed on a commit carrying ≥2 local branches, so a
   * single-branch (or branchless) end never adds a step and the common case
   * shows no groups at all. A merge drag can be ambiguous at both ends, and
   * they are independent picks — source first, matching the "merge X into Y"
   * reading order of the body copy.
   *
   * Each `value` is the branch the op will actually use — it lives in
   * `pending`, so picking another one re-renders the dialog copy below and
   * feeds `runPending` without a second source of truth.
   */
  const pendingChoices = $derived.by<ChoiceGroup[]>(() => {
    if (!pending) return [];
    if (pending.kind === 'reset')
      return (pending.candidates?.length ?? 0) > 1
        ? [
            {
              label: t('confirmRewrite.chooseResetTarget'),
              choices: pending.candidates ?? [],
              value: pending.short,
              onChoose: choosePendingResetTarget,
            },
          ]
        : [];
    if (pending.kind === 'rebaseBranch')
      return (pending.candidates?.length ?? 0) > 1
        ? [
            {
              label: t('confirmRewrite.chooseBranch'),
              choices: pending.candidates ?? [],
              value: pending.onto,
              onChoose: choosePendingBranch,
            },
          ]
        : [];
    if (pending.kind === 'mergeBranches') {
      const groups: ChoiceGroup[] = [];
      if ((pending.sourceCandidates?.length ?? 0) > 1)
        groups.push({
          label: t('confirmRewrite.chooseSourceBranch'),
          choices: pending.sourceCandidates ?? [],
          value: pending.source,
          onChoose: choosePendingSource,
        });
      if ((pending.targetCandidates?.length ?? 0) > 1)
        groups.push({
          label: t('confirmRewrite.chooseBranch'),
          choices: pending.targetCandidates ?? [],
          value: pending.target,
          onChoose: choosePendingBranch,
        });
      return groups;
    }
    return [];
  });

  /** Apply the user's pick for the branch the op advances (its target). */
  function choosePendingBranch(name: string) {
    if (!pending) return;
    if (pending.kind === 'rebaseBranch') pending = { ...pending, onto: name };
    else if (pending.kind === 'mergeBranches')
      pending = { ...pending, target: name };
  }

  /** Apply the user's pick for the branch being merged in. Sibling branches
   *  at one commit merge identically — the name only spells the merge commit
   *  message — but the message is what the user reads afterwards. */
  function choosePendingSource(name: string) {
    if (pending?.kind !== 'mergeBranches') return;
    pending = { ...pending, source: name };
  }

  /** Apply the user's pick for where an ambiguous crown-drop reset lands.
   *  `pending.candidates` is `[...branches, commitShort]` by construction
   *  (see dragDispatch's `head` case) — the commit-itself choice is always
   *  last, so a pick that matches it resolves through the full sha
   *  (`commitSha`) rather than the abbreviated display string, while a
   *  branch pick uses the name directly. Either way `history::reset` moves
   *  the current branch to the identical commit — the pick only changes the
   *  reflog text and this dialog's copy. */
  function choosePendingResetTarget(name: string) {
    if (pending?.kind !== 'reset' || !pending.candidates) return;
    const isCommitChoice =
      pending.commitSha != null &&
      name === pending.candidates[pending.candidates.length - 1];
    pending = {
      ...pending,
      target: isCommitChoice ? pending.commitSha! : name,
      short: name,
    };
  }

  // Dialog copy for the pending op.
  const confirmCopy = $derived.by(() => {
    if (!pending) return null;
    const curBranch = refs?.head.branch ?? null;
    const head = curBranch ?? t('branch.head');
    switch (pending.kind) {
      case 'revert':
        return {
          title: t('op.revert.title'),
          body: t('op.revert.body', { subject: pending.commit.subject }),
          confirmLabel: t('op.revert.confirm'),
          danger: false,
          withMessage: false,
          defaultMessage: '',
        };
      case 'cherryPick': {
        const n = pending.shas.length;
        const what =
          n === 1
            ? t('op.cherryPick.whatOne', { subject: pending.label })
            : t('op.cherryPick.whatMany', { n });
        return {
          title:
            n === 1
              ? t('op.cherryPick.titleOne')
              : t('op.cherryPick.titleMany'),
          body: t('op.cherryPick.body', { what, branch: head }),
          confirmLabel: t('op.cherryPick.confirm'),
          danger: false,
          withMessage: false,
          defaultMessage: '',
        };
      }
      case 'reset':
        return {
          title: t('op.reset.title', { mode: pending.mode }),
          body: t('op.reset.body', {
            branch: head,
            short: pending.short,
            effect:
              pending.mode === 'hard'
                ? t('op.reset.effectHard')
                : pending.mode === 'soft'
                  ? t('op.reset.effectSoft')
                  : t('op.reset.effectKeep'),
          }),
          confirmLabel: t('op.reset.confirm'),
          danger: pending.mode === 'hard',
          withMessage: false,
          defaultMessage: '',
        };
      case 'drop':
        return {
          title: t('op.drop.title'),
          body: t('op.drop.body', { subject: pending.commit.subject }),
          confirmLabel: t('op.drop.confirm'),
          danger: true,
          withMessage: false,
          defaultMessage: '',
        };
      case 'reword':
        return {
          title: t('op.reword.title'),
          body: t('op.reword.body'),
          confirmLabel: t('op.reword.confirm'),
          danger: false,
          withMessage: true,
          defaultMessage: pending.commit.subject,
        };
      case 'squash': {
        const bySha = new Map(commits.map((c) => [c.sha, c]));
        const subjects = pending.shas
          .map((sha) => bySha.get(sha)?.subject ?? '')
          .join('\n\n');
        return {
          title: t('op.squash.title'),
          body: t('op.squash.body', { n: pending.shas.length }),
          confirmLabel: t('op.squash.confirm'),
          danger: true,
          withMessage: true,
          defaultMessage: subjects,
        };
      }
      case 'merge':
        return {
          title: t('op.merge.title'),
          body: t('op.merge.body', { source: pending.source, branch: head }),
          confirmLabel: t('op.merge.confirm'),
          danger: false,
          withMessage: false,
          defaultMessage: '',
        };
      case 'rebaseOnto':
        return {
          title: t('op.rebase.title'),
          body: t('op.rebase.body', { branch: head, onto: pending.onto }),
          confirmLabel: t('op.rebase.confirm'),
          danger: true,
          withMessage: false,
          defaultMessage: '',
        };
      case 'mergeBranches': {
        const checkoutFirst = pending.target !== curBranch;
        return {
          title: t('op.merge.title'),
          body: checkoutFirst
            ? t('op.mergeBranches.bodyCheckout', {
                source: pending.source,
                target: pending.target,
              })
            : t('op.mergeBranches.body', {
                source: pending.source,
                target: pending.target,
              }),
          confirmLabel: t('op.merge.confirm'),
          danger: false,
          withMessage: false,
          defaultMessage: '',
        };
      }
      case 'rebaseBranch': {
        const checkoutFirst = pending.branch !== curBranch;
        return {
          title: t('op.rebase.title'),
          body: checkoutFirst
            ? t('op.rebaseBranch.bodyCheckout', {
                branch: pending.branch,
                onto: pending.onto,
              })
            : t('op.rebaseBranch.body', {
                branch: pending.branch,
                onto: pending.onto,
              }),
          confirmLabel: t('op.rebase.confirm'),
          danger: true,
          withMessage: false,
          defaultMessage: '',
        };
      }
      case 'cherryPickNewBranch': {
        const n = pending.shas.length;
        return {
          title: t('op.cherryPickNewBranch.title'),
          body:
            n === 1
              ? t('op.cherryPickNewBranch.bodyOne', { short: pending.short })
              : t('op.cherryPickNewBranch.bodyMany', {
                  n,
                  short: pending.short,
                }),
          confirmLabel: t('op.cherryPickNewBranch.confirm'),
          danger: false,
          withMessage: false,
          defaultMessage: '',
        };
      }
      case 'removeBranch':
        return {
          title: t('op.removeBranch.title'),
          body: t('op.removeBranch.body', { name: pending.name }),
          confirmLabel: t('op.removeBranch.confirm'),
          danger: true,
          withMessage: false,
          defaultMessage: '',
        };
    }
  });

  /** First unused local branch name starting at `base`: `base`, else
   *  `base-2`, `base-3`, … — used to name the scratch branch a Shift-drag
   *  cherry-pick (individual mode) creates. */
  function freeBranchName(base: string): string {
    const names = new Set((refs?.branches ?? []).map((b) => b.name));
    if (!names.has(base)) return base;
    let i = 2;
    while (names.has(`${base}-${i}`)) i++;
    return `${base}-${i}`;
  }

  /**
   * Unwrap a history-op's tagged result: `completed` → return its remap
   * outcome; `conflict` → enter resolve mode (graph locks, the files panel
   * opens on its conflicted section) and return null so the caller skips its
   * success bookkeeping. A conflict is NOT an error — the op is paused, not
   * failed — so no error toast is raised here.
   */
  function resolveOrOutcome(result: HistoryOpResult): HistoryOpOutcome | null {
    if (result.status === 'conflict') {
      enterResolve(result.state);
      return null;
    }
    return result.outcome;
  }

  async function runPending(message: string) {
    if (!pending || !repoPath) return;
    // What the tutorial hears once the op has landed (null: nothing to say —
    // e.g. a conflict, which pauses the op rather than completing it).
    let outcomeEvent: TutorialEvent | null = null;
    const headBefore = refs?.head.branch ?? '';
    opBusy = true;
    try {
      switch (pending.kind) {
        case 'revert':
          await revert(repoPath, pending.commit.sha);
          break;
        case 'cherryPick':
          await cherryPick(repoPath, pending.shas);
          outcomeEvent = {
            kind: 'cherryPicked',
            commits: [...pending.shas],
            onto: headBefore,
          };
          break;
        case 'reset':
          await reset(repoPath, pending.target, pending.mode);
          outcomeEvent = {
            kind: 'reset',
            target: pending.target,
            mode: pending.mode,
          };
          break;
        case 'drop': {
          const outcome = resolveOrOutcome(
            await dropCommit(repoPath, pending.commit.sha),
          );
          if (outcome) noticeRemapSkipped(outcome);
          break;
        }
        case 'reword': {
          const sha = pending.commit.sha;
          const outcome = resolveOrOutcome(
            await reword(repoPath, sha, message),
          );
          if (outcome) {
            noticeRemapSkipped(outcome);
            outcomeEvent = { kind: 'reworded', sha, message };
          }
          break;
        }
        case 'squash': {
          const outcome = resolveOrOutcome(
            await squashRange(repoPath, pending.shas, message),
          );
          if (outcome) {
            // A skipped branch is the more actionable message than the success line.
            if (!noticeRemapSkipped(outcome))
              notice = t('notice.squashed', { n: pending.shas.length });
            // The squashed shas no longer exist — drop them from the selection.
            selection = emptySelection();
          }
          break;
        }
        case 'merge': {
          const source = pending.source;
          if (resolveOrOutcome(await merge(repoPath, source)))
            outcomeEvent = { kind: 'merged', source, target: headBefore };
          break;
        }
        case 'rebaseOnto': {
          const onto = pending.onto;
          const outcome = resolveOrOutcome(await rebaseOnto(repoPath, onto));
          if (outcome) {
            noticeRemapSkipped(outcome);
            outcomeEvent = { kind: 'rebased', branch: headBefore, onto };
          }
          break;
        }
        case 'mergeBranches': {
          const { source, target } = pending;
          if (target !== refs?.head.branch) {
            await checkout(repoPath, target);
          }
          if (resolveOrOutcome(await merge(repoPath, source)))
            outcomeEvent = { kind: 'merged', source, target };
          break;
        }
        case 'rebaseBranch': {
          const { branch, onto } = pending;
          const outcome = resolveOrOutcome(
            await rebaseBranch(repoPath, branch, onto),
          );
          if (outcome) {
            noticeRemapSkipped(outcome);
            outcomeEvent = { kind: 'rebased', branch, onto };
          }
          break;
        }
        case 'cherryPickNewBranch': {
          const shas = [...pending.shas];
          const name = freeBranchName('new_rebased_branch');
          await createBranch(repoPath, name, pending.target);
          await checkout(repoPath, name);
          await cherryPick(repoPath, shas);
          notice = t('notice.branchCreated', { name });
          outcomeEvent = { kind: 'cherryPicked', commits: shas, onto: name };
          break;
        }
        case 'removeBranch':
          await deleteBranch(repoPath, pending.name);
          break;
      }
      // A conflicted op is paused, not done — nothing to undo until it either
      // completes (continueOp sets canUndo) or aborts (nothing happened).
      if (!resolve) canUndo = true;
      pending = null;
      selectedBranch = null;
      await refresh();
      if (outcomeEvent) tutNotify(outcomeEvent);
    } catch (e) {
      setError(e);
    } finally {
      opBusy = false;
    }
  }

  /**
   * Inline reword from the commit details panel (mirrors the context-menu
   * `reword` case in `runPending` above minus the `pending`/`selectedBranch`
   * bookkeeping, which doesn't apply here). Errors are left to reject so
   * CommitDetails can show them inline instead of the global error toast.
   */
  async function rewordSelected(message: string) {
    if (!repoPath || !selected) return;
    const sha = selected.sha;
    if (!tutAllows({ kind: 'reword', sha })) return;
    const outcome = resolveOrOutcome(await reword(repoPath, sha, message));
    if (outcome) {
      noticeRemapSkipped(outcome);
      canUndo = true;
    }
    await refresh();
    if (outcome) tutNotify({ kind: 'reworded', sha, message });
  }

  /**
   * Surface the branches a history rewrite could NOT carry over (their
   * replay conflicted — see git-core remap): the graph would otherwise show
   * them silently still pointing at the orphaned old commits. Returns
   * whether a notice was set so callers can skip their own success notice.
   */
  function noticeRemapSkipped(outcome: HistoryOpOutcome): boolean {
    if (outcome.skipped.length === 0) return false;
    const branches = outcome.skipped
      .map((r) => r.replace(/^refs\/heads\//, ''))
      .join(', ');
    notice = t('notice.remapSkipped', { branches });
    return true;
  }

  /**
   * Purge a file from the commit-details panel.
   * Mirrors `rewordSelected`: the confirm gate (ConfirmRewrite) lives in
   * CommitDetails itself, so this only runs once the user has confirmed —
   * it makes the actual mutating `purge_path` call, then refreshes the graph
   * (every descendant sha changed) and surfaces a notice, exactly like the
   * other rewriting ops. Errors are left to reject so CommitDetails can show
   * them inline instead of the global error toast.
   */
  async function purgeSelectedFile(sha: string, path: string) {
    if (!repoPath) return;
    if (!tutAllows({ kind: 'purge', sha, path })) return;
    const prev = selected;
    const outcome = await purgePath(repoPath, sha, path);
    canUndo = true;
    // A skipped branch is the more actionable message than the success line.
    if (!noticeRemapSkipped(outcome)) notice = t('notice.purged', { path });
    await refresh();
    remapSelectionAfterRewrite(prev);
    tutNotify({ kind: 'purged', sha, path });
  }

  /**
   * After a history rewrite from the details panel (purge/add file), the target
   * commit gets a NEW sha, and the panel must follow it there rather than keep
   * showing the pre-rewrite change set. Re-select the rewritten commit —
   * matched by the identity a tree-only rewrite preserves (author +
   * author-time + message, since only the tree changed) — and reload its files.
   *
   * The subtlety is that the old commit does not go away. Every rewrite parks a
   * backup under `refs/adgitter/`, which keeps the original reachable, so
   * `list_commits` keeps returning it (flagged `ghost`) until that backup
   * expires. Both halves of this function therefore have to discount ghosts:
   * the survival check, because a sha-keyed `preserveSelection` will otherwise
   * "preserve" the orphan; and the identity match, because the orphan is an
   * exact identity twin of its replacement. Getting either wrong pins the panel
   * to the tree the user just rewrote away.
   *
   * No-op when nothing was selected, or when the selection genuinely survived
   * as a live commit (a skipped/no-op rewrite keeps the same sha).
   */
  function remapSelectionAfterRewrite(prev: Commit | null) {
    if (!prev) return;
    // A rewrite does NOT delete the original commit: a `refs/adgitter/` backup
    // keeps it alive, so `list_commits` still returns it — as a GHOST, with its
    // old sha intact. `preserveSelection` is sha-keyed, so it happily
    // "preserves" that ghost and hands back a non-null `selected`, which this
    // guard used to read as "the selection survived, nothing to remap". The
    // panel then stayed pinned to the pre-rewrite tree, still listing the file
    // the user had just purged. Only a LIVE selection counts as survival.
    if (selected && !selected.ghost) return;
    const id = (c: Commit) =>
      `${c.author_email} ${c.timestamp} ${c.subject} ${c.body}`;
    const prevId = id(prev);
    // Ghosts are excluded here too, for the same reason: a tree-only rewrite
    // changes neither author, author-time nor message, so the orphaned original
    // matches this identity *exactly*. Without the filter, `find` returns
    // whichever of the twins the walk reaches first — and re-selecting the
    // ghost is precisely the bug this function exists to prevent.
    const match = commits.find((c) => !c.ghost && id(c) === prevId);
    if (!match) return;
    selected = match;
    selection = { shas: new Set([match.sha]), anchor: match.sha };
    void loadFiles(match);
  }

  /**
   * Add a working-tree file into the selected commit's tree, from the
   * commit-details panel. Mirrors
   * `purgeSelectedFile` exactly, just in reverse: the confirm gate
   * (ConfirmRewrite) and the working-tree file picker live in CommitDetails
   * itself, so this only runs once the user has confirmed — it makes the
   * actual mutating `add_file_to_commit` call, then refreshes the graph
   * (every descendant sha changed) and surfaces a notice. Errors are left to
   * reject so CommitDetails can show them inline instead of the global error
   * toast.
   */
  async function addFileSelected(sha: string, path: string) {
    if (!repoPath) return;
    if (!tutAllows({ kind: 'addFile', sha, path })) return;
    const prev = selected;
    const outcome = await addFileToCommit(repoPath, sha, path);
    canUndo = true;
    // A skipped branch is the more actionable message than the success line.
    if (!noticeRemapSkipped(outcome)) notice = t('notice.addedFile', { path });
    await refresh();
    remapSelectionAfterRewrite(prev);
    tutNotify({ kind: 'fileAdded', sha, path });
  }

  /**
   * Re-read whether Undo is on offer. ADGitter only undoes its own changes, so
   * this has to be asked of the backend rather than inferred here — the single
   * `undo_state` query answers it in one pass over the repository.
   *
   * Called where reality can have diverged from what this window last saw:
   * opening a repo, regaining focus, and the watcher's repo-changed event.
   * It is deliberately NOT called after an in-app op, where Undo is available
   * by construction (the op just recorded where it left the ref) and an extra
   * round-trip would only make the button flicker.
   */
  async function refreshUndo() {
    if (!repoPath) {
      canUndo = false;
      undoReason = null;
      return;
    }
    try {
      const state = await undoState(repoPath);
      canUndo = state.available;
      undoReason = state.reason;
    } catch (e) {
      // A failed probe must not strand the button in a wrong state; leave
      // whatever we had and let the next probe settle it.
      console.error('undoState failed', e);
    }
  }

  async function doUndo() {
    // Undo is meaningless mid-resolve (the paused op hasn't landed yet) —
    // the toolbar button is disabled too; this guards the keyboard path.
    if (!repoPath || resolve) return;
    if (!tutAllows({ kind: 'undo' })) return;
    undoBusy = true;
    try {
      const undone = await undo(repoPath);
      if (undone) {
        notice = t('notice.undid', { op: undone.op });
        canUndo = true;
      } else {
        // The backend declined. That is reachable with the button still
        // enabled: it is armed optimistically by the op that ran, and history
        // can move outside the app before focus or the watcher settles it
        // again. Re-ask, so the message is the real reason — "nothing to undo"
        // would be a wrong answer to an outside change, and sends the user
        // looking in the wrong place.
        await refreshUndo();
        notice =
          undoReason === 'external_change'
            ? t('toolbar.undoBlockedExternal')
            : t('notice.nothingToUndo');
      }
      await refresh();
      if (undone) tutNotify({ kind: 'undone' });
    } catch (e) {
      setError(e);
    } finally {
      undoBusy = false;
    }
  }

  // --- Continue / Abort a paused (conflicted) op ----------------------------

  /** Banner "Continue" — only enabled once every conflicted path is staged. */
  async function doContinue() {
    if (!repoPath || !resolve) return;
    resolveBusy = true;
    try {
      const result = await continueOp(repoPath);
      if (result.status === 'completed') {
        const op = resolve.op;
        resolve = null;
        conflictedCount = 0;
        canUndo = true;
        notice = t('notice.resolved', { op });
      } else {
        // Continuing hit ANOTHER conflict (a later commit in the same replay):
        // stay in resolve mode, now pointing at the new sha.
        enterResolve(result.state);
      }
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      resolveBusy = false;
    }
  }

  /** Runs only after the banner Abort's ConfirmDialog is accepted. */
  async function doAbort() {
    if (!repoPath) return;
    resolveBusy = true;
    try {
      await abortOp(repoPath);
      resolve = null;
      abortPending = false;
      conflictedCount = 0;
      notice = t('notice.opAborted');
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      resolveBusy = false;
    }
  }

  /** Recompute ahead/behind for the current branch's upstream. */
  async function refreshSync() {
    if (!repoPath) {
      sync = null;
      return;
    }
    try {
      sync = await aheadBehind(repoPath);
    } catch {
      sync = null;
    }
  }

  // Detect the opened repo's origin remote: reflect the real .git
  // target in Settings + auth, and classify its scheme to gate PAT-only
  // features. Runs in the BACKGROUND (fire-and-forget from loadRepo, like
  // refreshSync) so it never delays the graph's first paint. `forPath` guards
  // against a repo switch landing this stale result on the wrong repo.
  async function refreshRemoteStatus(forPath: string) {
    let raw: string | null = null;
    try {
      raw = await remoteUrl(forPath);
    } catch {
      raw = null;
    }
    if (repoPath !== forPath) return; // switched repos mid-flight
    // Record the detected .git origin (sanitized of any embedded token). It is
    // deliberately NOT written into the Settings URL field: that field is an
    // optional OVERRIDE the user fills to take priority (config URL > repo URL).
    // An empty field means "use this .git origin" — connected via an SSH key /
    // the origin's own scheme — and `remoteDetected` is that fallback target
    // for classification and pull/push. GeneralPanel surfaces this origin as a
    // hint so the user knows what leaving the field empty will connect to.
    const detected = raw ? sanitizeRemoteUrl(raw) : '';
    remoteDetected = detected || null;
  }

  async function doPull() {
    // Pull merges — never on top of a paused op, and never while the remote is
    // blocked (a PAT on a non-HTTPS URL — would leak over http). The toolbar is
    // disabled in both cases too; this guards the keyboard shortcut.
    if (!repoPath || resolve || remoteBlocked) return;
    if (!tutAllows({ kind: 'other', name: 'pull' })) return;
    if (effectiveGeneral.dryRun) {
      notice = t('notice.dryRunPull');
      return;
    }
    pullBusy = true;
    try {
      await pull(repoPath, 'origin', remoteAuth(), remoteTargetUrl());
      canUndo = true;
      notice = t('notice.pulled');
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      pullBusy = false;
    }
  }

  // --- Auto-pull gate (Settings → General → Auto Pull) ----------------------
  // `autoPullBefore(action)` is the single entry point every gated action goes
  // through. It returns true = "run the action", false = "the action is
  // abandoned, and the user has been told why". Four modes, per action, when
  // that action's checkbox is on (see `lib/autoPull.ts` for the mapping):
  //   off     → true, no side effect (today's behaviour)
  //   always  → pull, then true
  //   warn    → blocking 3-way confirm: Yes = pull then true, Skip = true
  //             without pulling, Cancel = false
  //   notify  → the same three outcomes from a NON-MODAL countdown prompt that
  //             answers Yes by itself on expiry
  //
  // ORDERING AGAINST THE GUIDED TUTORIAL: every caller asks `tutAllows` FIRST,
  // then this gate, then the action. `tutAllows`'s own contract is "ask BEFORE
  // any side effect", and a pull is the biggest side effect in the sequence —
  // gating first would let a step that forbids pushing still fire a network
  // pull and rewrite the demo repo's history. Running the tutorial veto first
  // cannot bypass the gate either, because the gate still sits between the
  // veto and the action: a tutorial step that permits push gets the gate, and
  // one that forbids it never reaches either. (In practice the tutorial runs
  // on a local demo repo with no upstream, so the gate's default `off` leaves
  // it untouched regardless.)
  //
  // Not reached — deliberately — in four situations where a pull is either
  // impossible or already accounted for:
  //  * no repo open;
  //  * mid-resolve: `doPull` itself refuses to merge on top of a paused op, so
  //    there is no pull to offer. The action proceeds ungated rather than being
  //    blocked — committing is how the user finishes resolving;
  //  * `remoteBlocked` (a PAT on a non-HTTPS URL): pulling would leak the
  //    token, and the existing paths already refuse the network for it;
  //  * dry-run: push and pull are both no-ops-with-a-notice under `dryRun`, so
  //    the gate matches them — it emits the same `notice.dryRunPull` and lets
  //    the action through instead of prompting about a pull that cannot run.
  type AutoPullGate = {
    action: AutoPullAction;
    mode: 'warn' | 'notify';
    /** The repo this prompt was raised for. A prompt is only ever about ONE
     *  repository: it is what `autoPullNow` pulls when the answer is Yes
     *  (rather than re-reading `repoPath`, which would pull whichever repo
     *  happens to be open by the time the answer arrives), and it is what
     *  the staleness effect below compares against. */
    path: string;
    decide: (d: AutoPullDecision) => void;
  };
  /** The one in-flight prompt, if any (see the two-prompts rule below). */
  let autoPullGate = $state<AutoPullGate | null>(null);
  /** A gate pull is in flight — disables the warn dialog's buttons. */
  let autoPullBusy = $state(false);

  // A PENDING PROMPT BELONGS TO THE REPO IT WAS RAISED FOR. Closing the repo
  // or switching to another one during a prompt — an ordinary thing to do
  // during a 5-second countdown — abandons it, and abandoning here means
  // settling the pending decision as `cancel`: nobody consented to anything,
  // so neither `yes` (which would pull) nor `skip` (which would run the
  // action) is honest. `cancel` also takes the existing path: the awaiting
  // caller gets `false` back, so its `finally` runs (`pushBusy` is cleared
  // rather than stuck true for the session), `autoPullGate` returns to null
  // so the two-prompts rule stops abandoning every later action, and the
  // user is told via the `autoPull.cancelled` notice.
  //
  // This lives in an effect on `repoPath`, not in `closeRepo`/`loadRepo`,
  // because the invariant is about the variable, not about any one code path:
  // `repoPath` is assigned in three places (close, load's success, load's
  // failure) and the rule has to hold for every future one too. Refusing a
  // stale decision at `decide` time would not be enough on its own — nothing
  // but a button press can settle the promise, and a promise merely
  // abandoned is the defect, not the fix.
  //
  // `autoPullGate` is read untracked so this effect depends on `repoPath`
  // alone; clearing it here is therefore not a self-trigger.
  $effect(() => {
    const current = repoPath;
    const gate = untrack(() => autoPullGate);
    if (!gate || gate.path === current) return;
    autoPullGate = null;
    gate.decide('cancel');
  });

  async function autoPullBefore(action: AutoPullAction): Promise<boolean> {
    const plan = autoPullPlan(
      effectiveGeneral.autoPull,
      effectiveGeneral.autoPullBefore[action],
    );
    if (plan === 'proceed') return true;
    const path = repoPath;
    if (!path || resolve || remoteBlocked) return true;
    if (effectiveGeneral.dryRun) {
      notice = t('notice.dryRunPull');
      return true;
    }
    // TWO PROMPTS MUST NOT STACK. One decision is pending at a time; a second
    // gated action asked for while the first prompt is up is abandoned with a
    // notice rather than queued or silently let through. Queueing would mean
    // answering a prompt whose action the user has forgotten, and letting it
    // through would make the gate conditional on timing.
    if (autoPullGate) {
      notice = t('autoPull.pending');
      return false;
    }
    if (plan === 'pull') return await autoPullNow(action, path);
    const decision = await new Promise<AutoPullDecision>((decide) => {
      autoPullGate = {
        action,
        mode: plan === 'ask' ? 'warn' : 'notify',
        path,
        decide,
      };
    });
    autoPullGate = null;
    // BOTH PROMPTS LAND HERE. The blocking `warn` dialog and the non-modal
    // `notify` countdown each report through `answerAutoPull`, so the three
    // outcomes are acknowledged once, here, rather than per widget. The
    // countdown's own expiry resolves `yes` (see CountdownPrompt), which falls
    // through to the pull below — it must not read as a Skip or a Cancel.
    if (decision === 'cancel') {
      notice = t('autoPull.cancelled');
      return false;
    }
    if (decision === 'skip') {
      // Skip used to pass silently, which left no trace of why a push went out
      // without the pull the user had just been asked about.
      notice = t('autoPull.skipped');
      return true;
    }
    return await autoPullNow(action, path);
  }

  /**
   * The gate's pull. Returns false — the action is ABANDONED — on either of
   * the two ways a pull can fail to leave a clean tree:
   *  * it threw: the error names which pull failed and says nothing ran. It
   *    must never fall through to the action, which would push/commit on a
   *    tree the user believes was just updated;
   *  * it conflicted: the repo is now mid-resolve. Rather than invent a second
   *    conflict surface this re-probes `conflictState` and hands the paused op
   *    to the existing `enterResolve` (same call `loadRepo` makes), so the
   *    ResolveBanner and its Continue/Abort take over — and says the action
   *    did not run.
   *
   * `path` is the repo the gate was entered for, passed in rather than re-read
   * from `repoPath`: a `notify` prompt can be answered Yes seconds after it
   * was raised, and re-reading would pull whichever repo is open by then. (In
   * practice the staleness effect has already cancelled such a prompt, so this
   * is the second line of defence, not the first.)
   */
  async function autoPullNow(
    action: AutoPullAction,
    path: string,
  ): Promise<boolean> {
    const before = t(autoPullBeforeLabelKey(action));
    autoPullBusy = true;
    try {
      await pull(path, 'origin', remoteAuth(), remoteTargetUrl());
      canUndo = true;
      await refresh();
    } catch (e) {
      error = t('autoPull.failed', { before, reason: localizedError(e) });
      reportFailure(e);
      return false;
    } finally {
      autoPullBusy = false;
    }
    // `refresh()` does not probe for a paused op, so ask explicitly. A failure
    // to probe is treated as "no conflict" — `pull` already resolved, and the
    // ResolveBanner's own refresh paths will catch it if there is one.
    let paused: ResolveState | null = null;
    try {
      paused = await conflictState(path);
    } catch {
      paused = null;
    }
    if (paused) {
      enterResolve(paused);
      notice = t('autoPull.conflicted', { before });
      return false;
    }
    return true;
  }

  /** Resolve the open gate prompt (warn dialog or countdown) with `d`. */
  function answerAutoPull(d: AutoPullDecision) {
    autoPullGate?.decide(d);
  }

  /** Remote auth from settings: an HTTPS access token (PAT) when configured,
   *  else none. Password (username/password) auth is intentionally unsupported.
   *  The Basic-auth username is host-specific (GitLab wants oauth2, Bitbucket
   *  x-token-auth), so it is inferred from the configured remote URL. */
  function remoteAuth(): CloneAuth {
    const token = effectiveAccessToken.trim();
    return token
      ? {
          kind: 'password',
          username: patUsernameFor(
            patRemoteUrl(effectiveRemoteUrl) ?? effectiveRemoteUrl,
          ),
          password: token,
        }
      : { kind: 'none' };
  }

  /** Connection target for pull/push: the configured Settings URL when it
   *  differs from the detected `.git` origin (priority: config URL > repo URL),
   *  else `null` to use the named `origin` remote. This is what lets an
   *  https+PAT Settings URL actually drive the update even when the `.git`
   *  origin is ssh; `null` keeps the well-trodden named-origin path for the
   *  common, un-customized case (Settings URL seeded straight from origin). */
  function remoteTargetUrl(): string | null {
    const configured = effectiveGeneral.remoteUrl?.trim() ?? '';
    const origin = remoteDetected ?? '';
    if (!configured || configured === origin) return null;
    return remoteHasPat ? (patRemoteUrl(configured) ?? configured) : configured;
  }

  async function doPush() {
    // The branch mid-resolve is in flux — no pushing until it lands/aborts; and
    // never while the remote is blocked (a PAT on a non-HTTPS URL). The toolbar
    // is disabled in both cases too; this guards the keyboard shortcut.
    if (!repoPath || resolve || remoteBlocked) return;
    if (!tutAllows({ kind: 'push' })) return;
    // Auto-pull gate AFTER the tutorial veto (see `autoPullBefore`) and ahead
    // of the action, which is the same order all three gated actions use. The
    // gate no-ops under dry-run, so the dry-run notice below still wins and
    // the user sees today's "push skipped" message. Force push is NOT gated —
    // `requestForcePush` already collects an explicit confirmation, and a
    // second dialog in front of it would mean two prompts for one click.
    if (!(await autoPullBefore('push'))) return;
    if (effectiveGeneral.dryRun) {
      notice = t('notice.dryRunPush');
      return;
    }
    pushBusy = true;
    try {
      await push(repoPath, 'origin', remoteAuth(), false, remoteTargetUrl());
      notice = t('notice.pushed');
      await refreshSync();
      tutNotify({ kind: 'pushed', force: false, ok: true, rejected: false });
    } catch (e) {
      setError(e);
      tutNotify({
        kind: 'pushed',
        force: false,
        ok: false,
        rejected: isPushRejection(e),
      });
    } finally {
      pushBusy = false;
    }
  }

  /** Best effort: was this push refused as a non-fast-forward? git-core
   *  reports it as a generic GIT_ERROR, so this reads the message. */
  function isPushRejection(e: unknown): boolean {
    const text =
      typeof e === 'object' && e !== null && 'message' in e
        ? String((e as { message: unknown }).message)
        : String(e);
    return /non-fast-forward|NotFastForward|fetch first|rejected/i.test(text);
  }

  /** Open the toolbar's Push ▾ "Force push" confirmation (advanced, destructive). */
  function requestForcePush() {
    if (!repoPath) return;
    if (!tutAllows({ kind: 'forcePush' })) return;
    forcePushPending = true;
  }

  /** Runs only after {@link requestForcePush}'s confirm dialog is accepted. */
  async function doForcePush() {
    if (!repoPath || remoteBlocked) return;
    if (effectiveGeneral.dryRun) {
      notice = t('notice.dryRunPush');
      forcePushPending = false;
      return;
    }
    pushBusy = true;
    try {
      await push(repoPath, 'origin', remoteAuth(), true, remoteTargetUrl());
      notice = t('notice.forcePushed');
      forcePushPending = false;
      await refreshSync();
      tutNotify({ kind: 'pushed', force: true, ok: true, rejected: false });
    } catch (e) {
      setError(e);
      tutNotify({
        kind: 'pushed',
        force: true,
        ok: false,
        rejected: isPushRejection(e),
      });
    } finally {
      pushBusy = false;
    }
  }

  /** Account popover: opening it asks the tutorial (closing never does). */
  function toggleUserMenu() {
    if (!showUser && !tutAllows({ kind: 'other', name: 'user-menu' })) return;
    showUser = !showUser;
  }

  /** Change the UI language live and persist it. */
  function changeLocale(locale: string) {
    setLocale(locale);
    void persistSettings({ ...settings, locale });
  }

  /** Persist edited settings from the modal and apply them live. */
  /** Main-screen Log Anytime toggle: flip `enabled` and persist to the
   *  effective scope — the open repo's project config, else global settings —
   *  mirroring the settings panel's "Enable Log Anytime" checkbox. */
  async function toggleLogAnytime() {
    const next = {
      ...effectiveLogAnytime,
      enabled: !effectiveLogAnytime.enabled,
    };
    if (!tutAllows({ kind: 'logAnytimeToggle', enabled: next.enabled })) return;
    if (repoPath) {
      await setProjectLogAnytime(next);
    } else {
      await persistSettings({ ...settings, logAnytime: next });
    }
    tutNotify({ kind: 'logAnytimeToggled', enabled: next.enabled });
  }

  async function persistSettings(next: Settings) {
    settings = next; // $effect re-applies the theme
    try {
      await saveSettings(next);
    } catch (e) {
      console.error('saveSettings failed', e);
    }
  }

  /**
   * Persist SettingsModal's repo-scoped draft (General/Personalize/Themes/
   * Log Anytime) to the OPEN repo instead of global settings — project
   * config for the three non-secret slices, `repoSecrets.ts` for the token.
   * No-op if the repo somehow closed while the modal was open (defensive;
   * the modal has no way to close a repo itself).
   */
  async function persistProjectSettings(v: {
    general: ProjectGeneralSettings;
    accessToken: string;
    personalize: PersonalizeSettings;
    logAnytime: LogAnytimeSettings;
  }) {
    const path = repoPath;
    if (!path) return;
    void setProjectGeneral(v.general);
    void setProjectPersonalize(v.personalize);
    void setProjectLogAnytime(v.logAnytime);
    repoAccessToken = v.accessToken; // reflect live before the write settles
    try {
      await setRepoAccessToken(path, v.accessToken);
    } catch (e) {
      console.error('setRepoAccessToken failed', e);
    }
  }

  // Global keyboard shortcuts → actions. Handlers self-guard on state.
  const keyHandlers: Record<string, (e: KeyboardEvent) => void> = {
    pull: () => void doPull(),
    push: () => void doPush(),
    newBranch: () => repoPath && (activePanel = 'branches'),
    newTag: () => repoPath && (activePanel = 'branches'),
    showBranchPanel: () =>
      repoPath &&
      (activePanel = activePanel === 'branches' ? null : 'branches'),
    showTagPanel: () =>
      repoPath &&
      (activePanel = activePanel === 'branches' ? null : 'branches'),
    showSettingPanel: () => {
      // Closing this way skips the modal's own Cancel, so it asks the same
      // `closeSettings` gate; opening goes through `openSettings`.
      if (!showSettings) openSettings();
      else if (tutAllows({ kind: 'closeSettings' })) showSettings = false;
    },
    // Momentary, not a toggle: press engages the hand tool, release restores
    // whatever was active before. `e.repeat` (the browser firing repeated
    // keydowns while a key is held) must never re-trigger the press — that
    // would just re-save the same `handToolBefore` value harmlessly today,
    // but would thrash a FUTURE stateful "before" (e.g. once this can nest)
    // and, more immediately, is simply wrong semantics for a hold gesture.
    switchHandTool: (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (!handToolHeld) {
        handToolBefore = handTool;
        handToolHeld = true;
        handToolHeldKey = e.key;
      }
      handTool = true;
    },
  };

  /** `keyHandlers` behind the tutorial gate: every shortcut is asked as
   *  `other:shortcut:<id>` before it runs. */
  const guardedKeyHandlers: Record<string, (e: KeyboardEvent) => void> =
    Object.fromEntries(
      Object.entries(keyHandlers).map(([id, run]) => [
        id,
        (e: KeyboardEvent) => {
          if (tutAllows({ kind: 'other', name: `shortcut:${id}` })) run(e);
        },
      ]),
    );

  /** Every Settings entry point (TopBar gear, Welcome, the shortcut, the
   *  Issue panel's link): the tutorial gate, then open on `tab`. */
  function openSettings(tab: SettingsTab | null = null) {
    if (!tutAllows({ kind: 'openSettings' })) return;
    // Mid-tutorial only step 22 lets Settings open, and it spotlights the
    // Personalize panel alone: land there, not on General (whose git email
    // writes ~/.gitconfig and is out of bounds).
    settingsInitialTab =
      tab ?? (untrack(() => tutorial.active) ? 'Personalize' : null);
    showSettings = true;
  }

  /** Release the momentary hand-tool hold, restoring the pre-press tool. A
   *  no-op when nothing is held, so it's safe to call from both the keyup
   *  and the window-blur path below without a redundant guard at each call
   *  site. */
  function releaseHandTool() {
    if (!handToolHeld) return;
    handTool = handToolBefore;
    handToolHeld = false;
    handToolHeldKey = null;
  }

  /** `switchHandTool`'s keyup half: ends the hold only on the SAME physical
   *  key that started it (see `handToolHeldKey`'s doc comment) — an unrelated
   *  key's release must not cancel an unrelated hold. */
  function onWindowKeyup(e: KeyboardEvent) {
    if (handToolHeld && e.key === handToolHeldKey) releaseHandTool();
  }

  /** Losing window focus while Space is held means no keyup will ever arrive
   *  (the OS/another app ate it) — without this the app would get stuck in
   *  hand-tool mode forever. Mirrors MetroGraph's own `onblur={clearKbMods}`
   *  pattern for the same class of "a key went down but its up is lost"
   *  problem; this one lives here (not in MetroGraph) because `handTool` and
   *  the `switchHandTool` dispatch already live at this level — MetroGraph
   *  only ever receives `handTool` as a read-only prop. */
  function onWindowBlur() {
    releaseHandTool();
  }

  // Lane colours for the branches panel swatches (shared scheme as the graph).
  const colorBySha = $derived(
    new Map(
      [...assignLanes(commits).assignments].map(([sha, a]) => [
        sha,
        a.colorIndex,
      ]),
    ),
  );

  // --- Auto-refresh wiring --------------------------------------------------
  const scheduler = createRefreshScheduler(refresh);
  let unlistenChanged: (() => void) | null = null;
  let unlistenFocus: (() => void) | null = null;
  let unlistenSettings: (() => void) | null = null;
  let unlistenMultiWindowUpsell: (() => void) | null = null;
  // Tauri's onFocusChanged(true) and the DOM window "focus" event can both
  // fire for one refocus; the gate collapses that into a single refresh.
  const focusGate = createFocusGate(() => void onFocusGained());

  onMount(async () => {
    try {
      ipcOk = (await ping()) === 'pong';
    } catch (e) {
      console.error('IPC ping failed', e);
    }
    try {
      recents = await listRecents();
    } catch (e) {
      console.error('listRecents failed', e);
    }
    let settingsLoaded = false;
    try {
      settings = await loadSettings();
      settingsLoaded = true;
      setLocale(settings.locale);
      // Generate + persist an anonymous install-id on first run.
      if (!settings.installId) {
        const id = globalThis.crypto?.randomUUID?.() ?? `iid-${Date.now()}`;
        settings = { ...settings, installId: id };
        void saveSettings(settings);
      }
      configureTelemetry({
        consent: settings.crashReports === 'granted',
        installId: settings.installId,
        transport: tauriTransport,
      });
      // Multi-window (paid, `MultiWindow`): saves are still last-write-wins
      // (no merge across windows), but refreshing the in-memory copy here
      // means this window picks up another window's write on its next read
      // instead of blindly overwriting it on its own next save.
      unlistenSettings = await onSettingsChanged((s) => {
        settings = s;
        setLocale(s.locale);
      });
    } catch (e) {
      console.error('loadSettings failed', e);
    }
    settingsReady = true;
    // Drive the entitlement plan from a verified license. Non-fatal: any
    // failure leaves the app on the free tier.
    //
    // DEV: `VITE_DEV_PLAN` used to ALSO mint and persist a signed dev licence
    // here, so the native `require_feature` gates would agree with the UI
    // override. That is gone. The Rust side now reads the same `VITE_DEV_PLAN`
    // directly (`src-tauri/src/dev_unlock.rs`, debug builds only) and unlocks at
    // its feature gate, so both layers agree with nothing persisted.
    //
    // Persisting was not merely redundant, it was the dangerous half: the token
    // carried `email: dev@adgitter.local`, and the account email is the default
    // git commit author. Once device binding landed, the seeded token stopped
    // verifying anyway (it is bound to "dev-device"), so this had become a stored
    // forged credential that unlocked nothing — one "fix" to its device id away
    // from stamping a made-up address into real commit history.
    void refreshEntitlement();
    // Restore a previous session from the persisted (signed, device-bound)
    // license — the app used to boot "signed out" no matter how recently you
    // had signed in. Fire-and-forget and offline: `verify_license` is a local
    // Ed25519 check, so this neither blocks boot nor needs the network, and a
    // license that fails verification simply leaves us signed out.
    //
    // Once restored, kick off a background (still fire-and-forget)
    // `refreshAccountProfile()` — the actual server round-trip that picks up
    // a Clerk-side name/avatar/username edit made since the license on disk
    // was last issued/renewed. An offline launch behaves exactly as before:
    // the restore already succeeded locally, and a failed refresh is silent
    // and leaves the restored session untouched.
    void restoreSession().then((restored) => {
      if (restored) void refreshAccountProfile();
    });
    // DEV: mock API — fake a signed-in user so the account/UI works without a
    // real Clerk backend.
    if (import.meta.env.DEV && import.meta.env.VITE_MOCK_API === 'true') {
      signInMock({ plan: import.meta.env.VITE_DEV_PLAN });
    }
    // Multi-window boot (paid, `MultiWindow`): a window spawned via
    // `open_repo_window` loads this same frontend with `?repo=<percent-
    // encoded absolute path>` — open that repo directly instead of showing
    // the Welcome screen. URLSearchParams.get already percent-decodes.
    const queryRepoPath = new URLSearchParams(window.location.search).get(
      'repo',
    );
    if (queryRepoPath) {
      void loadRepo(queryRepoPath);
    }
    // Guided tutorial: greet a first launch — only in the main
    // window, never in a repo window opened with `?repo=`, and only once the
    // real settings are known (a failed load must not re-greet every time).
    isMainWindow = getCurrentWindow().label === 'main';
    if (
      settingsLoaded &&
      isMainWindow &&
      !queryRepoPath &&
      !settings.tutorial.completed
    )
      void tutorial.start();
    // Subscribe to the adgitter:// OAuth callback. Non-fatal.
    void initDeepLinks();
    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    // Belt-and-braces: the DOM fallback covers cases where the Tauri event
    // doesn't fire; the gate above prevents a double refresh when both do.
    window.addEventListener('focus', focusGate);
    unlistenChanged = await subscribeRepoChanged(() => repoPath, {
      schedule: () => {
        scheduler.schedule();
        // The watcher fires for writes from outside the app too, which is
        // exactly when Undo may have just become unavailable.
        void refreshUndo();
      },
    });
    unlistenFocus = await getCurrentWindow().onFocusChanged(
      ({ payload: focused }) => {
        if (focused) focusGate();
        else void onFocusLost();
      },
    );
    // Single-instance relaunch (paid, `MultiWindow`): a second app launch on
    // the free tier is forwarded here instead of opening a window — the
    // primary process focuses an existing window and emits this so the user
    // understands why nothing new appeared. Window-scoped: the backend only
    // ever `emit_to("main", ...)`, so this only ever fires in the main window.
    //
    // The payload carries *why* it was refused. Only a genuine tier gap is an
    // upsell: with device binding on the entitlement gate, the same refusal
    // also reaches a paying user on a reinstalled machine (sign in again) and
    // one whose licence lapsed (renew). Telling either of them to buy a plan
    // would be both wrong and the thing that makes them give up.
    unlistenMultiWindowUpsell = await getCurrentWindow().listen<{
      code?: string;
    } | null>('multi-window-upsell', ({ payload }) => {
      notice =
        payload?.code === 'LICENSE_DEVICE_MISMATCH'
          ? t('error.LICENSE_DEVICE_MISMATCH')
          : payload?.code === 'LICENSE_EXPIRED'
            ? t('error.LICENSE_EXPIRED')
            : t('window.lockedUpsell');
    });
  });

  onDestroy(() => {
    unlistenChanged?.();
    unlistenFocus?.();
    unlistenSettings?.();
    unlistenMultiWindowUpsell?.();
    window.removeEventListener('error', onWindowError);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
    window.removeEventListener('focus', focusGate);
    scheduler.cancel();
    void stopRepoWatch();
    // Same reasoning as the staleness effect above: a pending gate must be
    // settled, never merely abandoned, or the awaiting action's `finally`
    // never runs and its promise is left dangling for the component's life.
    const gate = autoPullGate;
    autoPullGate = null;
    gate?.decide('cancel');
  });

  // Uncaught frontend errors → report + show the friendly crash window.
  // The thrown value carries the diagnosis (an IPC rejection is a tagged
  // `{code, message}`), so describe *it* rather than stringifying it — see
  // `lib/errorReport`. `ErrorEvent.message` is only the fallback for events
  // with no `error` (cross-origin scripts).
  function onWindowError(e: ErrorEvent) {
    reportFailure(e.error ?? e.message);
    crash = { reported: settings.crashReports === 'granted' };
  }
  function onUnhandledRejection(e: PromiseRejectionEvent) {
    reportFailure(e.reason);
    crash = { reported: settings.crashReports === 'granted' };
  }

  async function onFocusGained() {
    if (!repoPath) return;
    // Mid-tutorial nothing prunes the demo's backups behind the script's back
    // (undo steps rely on them); the demo is thrown away afterwards anyway.
    if (!tutorial.active) {
      try {
        await expireBackups(repoPath);
      } catch (e) {
        console.error('expireBackups failed', e);
      }
    }
    try {
      await startRepoWatch(repoPath);
    } catch (e) {
      console.error('startRepoWatch failed', e);
    }
    scheduler.flushNow();
    // Another tool may have moved history while we were in the background.
    await refreshUndo();
  }

  async function onFocusLost() {
    scheduler.cancel();
    try {
      await stopRepoWatch();
    } catch (e) {
      console.error('stopRepoWatch failed', e);
    }
  }

  // --- Loading --------------------------------------------------------------
  function basename(p: string): string {
    const parts = p.split(/[/\\]/).filter(Boolean);
    return parts[parts.length - 1] || p;
  }

  // --- Onboarding actions ----------------------------------------------
  /** Native folder picker for the dialogs; returns a path or null. */
  async function browseFolder(): Promise<string | null> {
    const picked = await open({ directory: true, multiple: false });
    return typeof picked === 'string' ? picked : null;
  }

  /** Record a freshly opened repo in recents (most-recent-first). */
  async function rememberRepo(path: string) {
    // The tutorial's throwaway demo never becomes a recent project.
    if (path === tutorialDemoPath) return;
    try {
      recents = await addRecent({ path, name: basename(path) });
    } catch (e) {
      console.error('addRecent failed', e);
    }
  }

  /** Open a recent project; on failure offer to remove the stale entry. */
  async function openRecent(r: RecentProject) {
    await loadRepo(r.path);
    if (repoPath === r.path) {
      await rememberRepo(r.path);
    } else {
      notice = t('notice.openFailed', { name: r.name });
    }
  }

  async function removeRecentEntry(path: string) {
    try {
      recents = await removeRecent(path);
    } catch (e) {
      console.error('removeRecent failed', e);
    }
  }

  /** Open `path` as the active repo and, once it loaded, add it to recents. */
  async function openPickedRepo(path: string) {
    await loadRepo(path);
    if (repoPath === path) await rememberRepo(path);
  }

  /** Welcome "New / Open": straight to the native folder picker. A folder
   *  that is (or sits inside) a git repo opens right away — that's the
   *  expected case; only a folder without one asks before creating a repo. */
  async function openFolder() {
    if (onboardBusy) return;
    const path = await browseFolder();
    if (!path) return;
    onboardBusy = true;
    try {
      const r = await probePath(path);
      if (r.kind === 'repo') await openPickedRepo(path);
      else confirmCreatePath = path;
    } catch (e) {
      setError(e);
    } finally {
      onboardBusy = false;
    }
  }

  /** "Create a new git repo here?" → yes: init, then open it. */
  async function confirmCreateRepo() {
    const path = confirmCreatePath;
    if (!path) return;
    onboardBusy = true;
    try {
      await initRepository(path);
      await loadRepo(path);
      if (repoPath === path) {
        confirmCreatePath = null;
        await rememberRepo(path);
      }
    } catch (e) {
      setError(e);
    } finally {
      onboardBusy = false;
    }
  }

  /** Clone dialog confirmed: pick the destination folder, then clone at once.
   *  Cancelling the picker leaves the dialog open so the URL isn't lost. An
   *  empty folder is cloned into directly; any other folder gets a
   *  `<repo-name>` subfolder (see `cloneDestination`). */
  async function startClone(args: { url: string; recursive: boolean }) {
    if (cloneBusy) return;
    const picked = await browseFolder();
    if (!picked) return;
    let dest: string;
    try {
      const r = await probePath(picked);
      dest = cloneDestination(picked, args.url, r.kind === 'empty');
    } catch (e) {
      setError(e);
      return;
    }
    await doClone({ ...args, dest });
  }

  /** Clone a remote into `dest`, streaming progress, then open it. */
  async function doClone(args: {
    url: string;
    dest: string;
    recursive: boolean;
  }) {
    cloneBusy = true;
    cloneProgress = { received: 0, total: 0 };
    const unlisten = await onCloneProgress((p) => (cloneProgress = p));
    try {
      await cloneRepository(
        args.url,
        args.dest,
        { kind: 'none' },
        args.recursive,
      );
      await loadRepo(args.dest);
      if (repoPath === args.dest) {
        cloneOpen = false;
        // Persist the remote URL, so pull/push can reuse it without
        // re-entering anything in Settings. remoteUrl is per-repo (see the
        // repo-level settings migration) — repoPath === args.dest here
        // guarantees the repo just finished opening (and therefore already
        // seeded its project general config, see `loadRepo`), so write to ITS
        // project config, not global settings.
        const baseGeneral =
          projectGeneral() ?? withoutAccessToken(settings.general);
        void setProjectGeneral({ ...baseGeneral, remoteUrl: args.url });
        await rememberRepo(args.dest);
      }
    } catch (e) {
      setError(e);
    } finally {
      unlisten();
      cloneBusy = false;
      cloneProgress = null;
    }
  }

  /** Return to the entry (Welcome) screen to pick another repo: stop watching
   *  and clear all repo-scoped state so `hasRepo` becomes false. */
  function closeRepo(): Promise<void> {
    // Fire-and-forget for every normal caller; the tutorial awaits the result.
    const watchStopped = stopRepoWatch().catch(() => {});
    repoPath = null;
    repoName = null;
    remoteDetected = null;
    commits = [];
    refs = null;
    truncated = false;
    selected = null;
    selection = emptySelection();
    selectedBranch = null;
    selectedFiles = [];
    activePanel = null;
    error = null;
    resolve = null;
    abortPending = false;
    conflictedCount = 0;
    resetProjectConfig();
    repoAccessToken = ''; // effectiveAccessToken now falls back to global
    return watchStopped;
  }

  async function loadRepo(path: string) {
    loading = true;
    error = null;
    selected = null;
    selection = emptySelection();
    selectedBranch = null;
    selectedFiles = [];
    resolve = null;
    abortPending = false;
    conflictedCount = 0;
    remoteDetected = null;
    try {
      try {
        await expireBackups(path);
      } catch (e) {
        console.error('expireBackups failed', e);
      }
      await loadProjectConfig(path);
      // One-time global → per-repo colour seed: only for a repo that has
      // never had a config file (see loadProjectConfig/projectConfigExists).
      // Seeding here is in-memory only — no write — so the seed is only
      // persisted once the user actually changes a colour; merely opening a
      // repo never creates adgitter.config.json.
      if (
        !projectConfigExists() &&
        Object.keys(settings.branchColors).length > 0
      ) {
        seedProjectBranchColors(settings.branchColors);
      }
      // Repo-level settings (General/Personalize/Log Anytime) seed: unlike
      // the branch-colour seed above, this is per-SLICE (not per-file) — a
      // repo's config file can already exist with some but not all of these
      // three set (hand-edited, or written by an older build before this
      // migration), so each slice seeds independently from its own `null`
      // check. In-memory only, same as above — never persisted until the
      // user actually saves something.
      if (!projectGeneral()) {
        seedProjectGeneral(withoutAccessToken(settings.general));
      }
      if (!projectPersonalize()) {
        seedProjectPersonalize(settings.personalize);
      }
      if (!projectLogAnytime()) {
        seedProjectLogAnytime(settings.logAnytime);
      }
      // The access token is NOT seeded from global (see repoSecrets.ts) — a
      // repo with no stored token of its own simply starts blank.
      repoAccessToken = await loadRepoAccessToken(path).catch(() => '');
      // Bring back the issue tracker binding this repo's config records.
      pro?.restoreIssueBinding(path);
      const page = await listCommits(path, COMMIT_LIMIT);
      refs = await listRefs(path);
      // Resolve-mode survives an app restart: probe for a merge/rebase/
      // squash/reword left paused on disk and re-enter the mode if found.
      const paused = await conflictState(path);
      if (paused) enterResolve(paused);
      commits = page.commits;
      truncated = page.truncated;
      repoPath = path;
      repoName = basename(path);
      void refreshSync();
      void refreshRemoteStatus(path);
      // Settle the Undo affordance for the repo we just opened: a record left
      // from a previous session is only undoable if nothing has touched its
      // refs since, and only the backend can say.
      void refreshUndo();
      try {
        await startRepoWatch(path);
      } catch (e) {
        console.error('startRepoWatch failed', e);
      }
    } catch (e) {
      setError(e);
      commits = [];
      refs = null;
      truncated = false;
      repoPath = null;
      repoName = null;
    } finally {
      loading = false;
    }
  }

  async function refresh() {
    if (!repoPath) return;
    try {
      const page = await listCommits(repoPath, COMMIT_LIMIT);
      const r = await listRefs(repoPath);
      commits = page.commits;
      truncated = page.truncated;
      refs = r;
      void refreshSync();
      const kept = preserveSelection(selected, commits);
      if (kept) selected = kept;
      else {
        selected = null;
        selectedFiles = [];
      }
      // Drop multi-selected shas that no longer exist (e.g. after a rewrite).
      const present = new Set(commits.map((c) => c.sha));
      selection = {
        shas: new Set([...selection.shas].filter((s) => present.has(s))),
        anchor:
          selection.anchor && present.has(selection.anchor)
            ? selection.anchor
            : null,
      };
      // Clear a branch-label selection if that ref is gone (local or remote).
      if (
        selectedBranch &&
        !r.branches.some((b) => b.name === selectedBranch!.name) &&
        !r.remotes.some((b) => b.name === selectedBranch!.name)
      )
        selectedBranch = null;
      error = null;
      filesReload += 1;
      tutNotify({ kind: 'refreshed' });
    } catch (e) {
      setError(e);
    }
  }

  // --- Selection ------------------------------------------------------------
  // The details panel mirrors the selection: it shows the single selected
  // commit, and closes whenever 0 or >1 commits are selected.
  function syncDetail() {
    if (selection.shas.size === 1) {
      const sha = [...selection.shas][0];
      if (selected?.sha !== sha) {
        const c = commits.find((x) => x.sha === sha) ?? null;
        selected = c;
        if (c) void loadFiles(c);
      }
    } else {
      selected = null;
    }
  }

  function handleSelect(c: Commit, mods: ClickMods) {
    // Any commit-selection edit (plain click or ctrl/cmd-toggle) degrades a
    // branch-mode selection to an ordinary commit set: the chip frame turns
    // off, and a subsequent Shift-drag resolves as an individual-mode
    // cherry-pick-onto-new-branch rather than a branch rebase.
    selectedBranch = null;
    selection = applyClick(
      selection,
      c.sha,
      commits.map((x) => x.sha),
      mods,
    );
    syncDetail();
  }

  /** A plain click on empty graph space cancels every selection. */
  function clearSelection() {
    selection = emptySelection();
    selected = null;
    selectedBranch = null;
  }

  // Marquee (rubber-band) multi-select. We snapshot the selection at the start
  // of a sweep so the live box stays reversible (Shift adds, ⌘/Ctrl toggles)
  // as it grows and shrinks; cleared on the final `done` drop.
  let marqueeBase: Selection | null = null;
  function handleMarquee(range: string[], mods: ClickMods, done: boolean) {
    marqueeBase ??= selection;
    selectedBranch = null; // a sweep degrades branch mode too — see handleSelect
    selection = applyMarquee(marqueeBase, range, mods);
    if (done) {
      syncDetail();
      marqueeBase = null;
    } else if (selection.shas.size !== 1) {
      selected = null; // multi-select while sweeping hides the single-commit detail
    }
  }

  // A fresh object per search-select so MetroGraph's $effect re-scrolls even
  // to the same commit.
  let scrollTarget = $state<{ sha: string } | null>(null);

  /** Jump to a search result: select the commit + scroll the graph to it. */
  function onSearchSelect(sha: string) {
    const c = commits.find((x) => x.sha === sha);
    if (!c) return;
    selectedBranch = null;
    selection = single(sha);
    selected = c;
    void loadFiles(c);
    scrollTarget = { sha };
  }

  /** Single-click a branch label → highlight it AND select the branch's own
   *  commits: first-parent (HEAD^1) from the tip down to the fork parent (its
   *  merge-base with HEAD), not the whole shared history. Works for local and
   *  remote (origin/*) branches; only LOCAL branches are a delete-as-unit target. */
  function branchSelect(
    b: { name: string; current: boolean },
    opts: { reveal?: boolean } = {},
  ) {
    const local = refs?.branches.find((x) => x.name === b.name);
    const tip =
      local?.target ?? refs?.remotes.find((x) => x.name === b.name)?.target;
    selectedBranch = { name: b.name, current: b.current, remote: !local };
    const headTarget = refs?.head.target ?? null;
    selection = tip
      ? { shas: new Set(branchSegment(tip, commits, headTarget)), anchor: tip }
      : emptySelection();
    // Many commits selected → the single-commit detail closes (one → shows it).
    syncDetail();
    // Selecting from the Branches panel has to bring the branch into view: its
    // tip is very often scrolled off-screen, and without this the row lights up
    // while the graph sits where it was — the click reads as having done
    // nothing. Deliberately NOT done for the graph's own branch chips (`reveal`
    // is only passed by the panel): you can only click a chip you can already
    // see, so re-centring it would be an unrequested jump. A fresh object is
    // what re-triggers MetroGraph's scroll effect when the same branch is
    // picked twice.
    if (opts.reveal && tip) scrollTarget = { sha: tip };
  }

  // --- Graph callbacks behind the tutorial gate ------------------------------
  // Each MetroGraph (and Branches panel) entry point asks the tutorial first
  // and reports the selection it produced.

  function graphSelect(c: Commit, mods: ClickMods) {
    const additive = mods.shift || mods.meta || mods.ctrl;
    if (!tutAllows({ kind: 'select', sha: c.sha, additive })) return;
    handleSelect(c, mods);
    tutNotify({ kind: 'selected', shas: [...selection.shas] });
  }

  function graphMarquee(range: string[], mods: ClickMods, done: boolean) {
    if (!tutAllows({ kind: 'marquee' })) return;
    handleMarquee(range, mods, done);
    if (done) tutNotify({ kind: 'selected', shas: [...selection.shas] });
  }

  function graphClearSelection() {
    if (!tutAllows({ kind: 'clearSelection' })) return;
    clearSelection();
  }

  function graphBranchSelect(
    b: { name: string; current: boolean },
    opts: { reveal?: boolean } = {},
  ) {
    if (!tutAllows({ kind: 'branchSelect', name: b.name })) return;
    branchSelect(b, opts);
    tutNotify({ kind: 'branchSelected', name: b.name });
  }

  /** Every context menu (commit, branch chip, remote chip) asks first. */
  function contextMenuAllowed(): boolean {
    return tutAllows({ kind: 'other', name: 'contextmenu' });
  }

  /** The HEAD "handle circle" merge drag bypasses `onGesture`. */
  function requestBranchMerge(p: MergeDrop) {
    if (!tutAllows({ kind: 'mergeDrag', drop: p })) return;
    pending = {
      kind: 'mergeBranches',
      source: p.source,
      target: p.target,
      sourceCandidates: p.sourceCandidates,
      targetCandidates: p.targetCandidates,
    };
  }

  /** Top-bar search result → select it (behind the tutorial gate). */
  function searchSelect(sha: string) {
    if (tutAllows({ kind: 'other', name: 'search' })) onSearchSelect(sha);
  }

  /** Delete on a branch-label selection = remove branch; on a commit = drop. */
  function onKeydown(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    const inEditable =
      !!t &&
      (t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.isContentEditable);

    // Configurable shortcuts (Mod-based) — never while typing or mid-dialog.
    if (!inEditable && !pending && !menu) {
      const id = dispatchKey(
        e,
        effectiveKeymap(settings.keymap),
        guardedKeyHandlers,
      );
      if (id) {
        e.preventDefault();
        return;
      }
    }

    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (pending || menu || resolve) return;
    if (inEditable) return;

    if (selectedBranch) {
      // Can't remove the checked-out branch; remotes aren't a delete target.
      if (selectedBranch.current || selectedBranch.remote) return;
      e.preventDefault();
      if (!tutAllows({ kind: 'other', name: 'shortcut:delete' })) return;
      pending = { kind: 'removeBranch', name: selectedBranch.name };
      return;
    }

    // Drop a single selected commit (matches the right-click "Drop" menu).
    const target =
      selection.shas.size === 1
        ? (commits.find((c) => selection.shas.has(c.sha)) ?? selected)
        : selected;
    if (target && refs?.head.branch) {
      e.preventDefault();
      if (!tutAllows({ kind: 'other', name: 'shortcut:delete' })) return;
      pending = { kind: 'drop', commit: target };
    }
  }

  /** Route a resolved drag gesture into the same confirm/op flow as the menus. */
  function onGesture(op: DragOp) {
    // Belt-and-braces: MetroGraph is already non-interactive while resolving
    // (interactive={false} + the .graph-locked overlay), but no gesture may
    // start a graph op mid-resolve even if one slips through.
    if (resolve) return;
    if (!tutAllows({ kind: 'gesture', op })) return;
    switch (op.op) {
      case 'merge':
        pending = { kind: 'merge', source: op.source };
        break;
      case 'rebase':
        pending = { kind: 'rebaseOnto', onto: op.onto };
        break;
      case 'cherryPick': {
        const label =
          commits.find((c) => c.sha === op.commits[0])?.subject ??
          op.commits[0];
        pending = { kind: 'cherryPick', shas: op.commits, label };
        break;
      }
      case 'rebaseBranch':
        // Shift-drag, branch mode: rebase the selected branch onto the
        // dropped commit. Reuses the same pending kind as the branch-onto-
        // branch rebase gesture — `onto` is just a commit sha here instead
        // of a branch name (rebase_onto resolves either via revparse).
        pending = {
          kind: 'rebaseBranch',
          branch: op.branch,
          onto: op.onto,
          candidates: op.candidates,
        };
        break;
      case 'cherryPickNewBranch':
        // Shift-drag, individual mode: cherry-pick the selection onto a
        // fresh branch created at the dropped commit.
        pending = {
          kind: 'cherryPickNewBranch',
          shas: op.shas,
          target: op.target,
          short: op.short,
        };
        break;
      case 'reset':
        // Ambiguous (the target commit carries several local branches):
        // route through the confirm dialog so the user can pick among every
        // branch and the commit itself, same chooser style as rebaseBranch/
        // checkout's own candidate lists.
        if (op.candidates && op.candidates.length > 1) {
          pending = {
            kind: 'reset',
            target: op.target,
            mode: op.mode,
            short: op.short,
            candidates: op.candidates,
            commitSha: op.commitSha,
          };
          break;
        }
        // Unambiguous: a drag-driven reset executes immediately (no confirm
        // dialog) — the drop itself is the confirmation. The context-menu
        // reset entries still go through `pending` (see the menu items
        // above) and keep their confirm dialog.
        void (async () => {
          if (!repoPath) return;
          try {
            await reset(repoPath, op.target, op.mode);
            canUndo = true;
            await refresh();
            notice = t('notice.reset', { mode: op.mode, short: op.short });
            tutNotify({ kind: 'reset', target: op.target, mode: op.mode });
          } catch (e) {
            setError(e);
          }
        })();
        break;
      case 'commit':
        activePanel = 'files';
        notice = t('notice.commitInFiles');
        break;
      case 'checkout':
        // Unambiguous (no candidates): the drop itself is the confirmation,
        // same immediate-execute style as the reset drag above — no dialog,
        // matches double-clicking a branch chip (`onBranchActivate`).
        // Ambiguous (the target commit carries several branches): route
        // through the chooser instead of guessing; cancelling it checks out
        // nothing (see `checkoutChoice` below).
        if (op.candidates && op.candidates.length > 1) {
          checkoutChoice = { branches: op.candidates };
        } else {
          void doCheckout(op.branch);
        }
        break;
    }
  }

  /** "Drag HEAD" onto a commit carrying several local branches: which one to
   *  check out. Populated by `onGesture`'s `checkout` case; cleared by either
   *  a pick (which also runs the checkout) or Cancel (which runs nothing). */
  let checkoutChoice = $state<{ branches: string[] } | null>(null);

  function pickCheckoutChoice(name: string) {
    checkoutChoice = null;
    void doCheckout(name);
  }

  async function loadFiles(c: Commit) {
    if (!repoPath) return;
    filesLoading = true;
    filesError = null;
    selectedFiles = [];
    try {
      const files = await listCommitFiles(repoPath, c.sha);
      if (selected?.sha === c.sha) selectedFiles = files; // latest-wins
    } catch (e) {
      if (selected?.sha === c.sha) filesError = localizedError(e);
    } finally {
      if (selected?.sha === c.sha) filesLoading = false;
    }
  }

  function togglePanel(p: 'branches' | 'files') {
    // Opening a panel asks the tutorial; closing one never needs to.
    if (
      activePanel !== p &&
      !tutAllows(
        p === 'files'
          ? { kind: 'openFiles' }
          : { kind: 'other', name: 'branches-panel' },
      )
    )
      return;
    activePanel = activePanel === p ? null : p;
  }

  // --- Issue tracker (paid, Advance+ `IssueTracker`; see `lib/pro.ts`) -------
  // The panel, its state and the tracker calls all live in the issue surface;
  // a build without it has no issue tracker and the toolbar shows it locked.
  let issueSurface = $state<IssueSurfaceApi | undefined>();
  let issuesOpen = $state(false);
  /** The bound tracker's issues, for the top-bar search's `assignee` scope. */
  let searchableIssues = $state<SearchIssue[]>([]);
  const issuesLocked = $derived(
    !pro || (!hasFeature('IssueTracker') && !tutorialDemoOpen),
  );

  /** Window re-activate: re-sync the open issue from the provider. */
  function onWindowFocus() {
    issueSurface?.windowFocused();
  }

  const hasRepo = $derived(repoPath !== null);
  const hasCommits = $derived(commits.length > 0);
  // GHOST commits (no branch/tag/HEAD points to them; kept alive only by a
  // `refs/adgitter/` backup ref) are hidden from the graph when the setting is
  // on. `commits` itself stays unfiltered — undo/selection/search must keep
  // seeing the full page.
  const visibleCommits = $derived(
    effectiveGeneral.hideGhosts ? commits.filter((c) => !c.ghost) : commits,
  );
</script>

<svelte:window
  onkeydown={onKeydown}
  onkeyup={onWindowKeyup}
  onfocus={onWindowFocus}
  onblur={onWindowBlur}
/>

<!-- Shared icon sprite (hidden); every <Icon> windows into it via <use>. -->
<IconDefs />

{#snippet toasts()}
  {#if error}
    <!-- Errors stay until dismissed by hand (duration 0 = no countdown) —
         except mid-tutorial, where the toast sits outside every spotlight
         hole (it can't be clicked away): it times out, and it sits at the
         bottom so it never covers the toolbar the next step needs (17a's
         expected push rejection → 17b's push menu). -->
    <Toast
      message={error}
      kind="error"
      duration={tutorial.active ? 6000 : 0}
      placement={tutorial.active ? 'bottom' : 'top'}
      onDismiss={() => (error = null)}
    />
  {/if}
  {#if notice}
    <!-- Notices auto-dismiss with a shrinking countdown bar;
         mid-tutorial they sit at the bottom too (see above). -->
    <Toast
      message={notice}
      kind="notice"
      placement={tutorial.active ? 'bottom' : 'top'}
      onDismiss={() => (notice = null)}
    />
  {/if}
  <!-- Auto-pull's `notify` prompt lives in the toast snippet so it is
       top-centred in whichever host is mounted, exactly like a notice — and
       so it is NOT modal: no scrim, no focus trap, the app stays usable while
       it counts down. The pending action still waits on the answer. -->
  {#if autoPullGate?.mode === 'notify'}
    <CountdownPrompt
      message={t('autoPull.title', {
        before: t(autoPullBeforeLabelKey(autoPullGate.action)),
      })}
      seconds={effectiveGeneral.autoPullSeconds}
      yesLabel={t('remotePull.confirm')}
      skipLabel={t('remotePull.skip')}
      cancelLabel={t('common.cancel')}
      onYes={() => answerAutoPull('yes')}
      onSkip={() => answerAutoPull('skip')}
      onCancel={() => answerAutoPull('cancel')}
    />
  {/if}
{/snippet}

{#if !hasRepo && !loading}
  <div class="welcome-host">
    {@render toasts()}
    <Welcome
      {recents}
      onOpenRecent={(r) => {
        if (tutAllows({ kind: 'other', name: 'open-repo' })) void openRecent(r);
      }}
      onRemoveRecent={(path) => {
        if (tutAllows({ kind: 'other', name: 'remove-recent' }))
          void removeRecentEntry(path);
      }}
      onNewOpen={() => {
        if (tutAllows({ kind: 'other', name: 'open-repo' })) void openFolder();
      }}
      onClone={() => {
        if (tutAllows({ kind: 'other', name: 'open-repo' })) cloneOpen = true;
      }}
      onSettings={() => openSettings()}
      onUser={toggleUserMenu}
    />
  </div>
{:else}
  <div class="shell">
    <TopBar
      {repoName}
      {commits}
      {refs}
      issues={searchableIssues}
      onSearchSelect={searchSelect}
      onSearchSelectIssue={(id) => void issueSurface?.selectFromSearch(id)}
      onSettings={() => openSettings()}
      onUser={toggleUserMenu}
      onBack={() => {
        if (tutAllows({ kind: 'other', name: 'close-repo' })) closeRepo();
      }}
    />

    <main class="workspace">
      {@render toasts()}

      <Toolbar
        {activePanel}
        onToggleBranches={() => togglePanel('branches')}
        onToggleFiles={() => togglePanel('files')}
        onUndo={doUndo}
        canUndo={canUndo && !resolve}
        undoHint={undoReason === 'external_change'
          ? t('toolbar.undoBlockedExternal')
          : undefined}
        {undoBusy}
        onPush={doPush}
        onForcePush={requestForcePush}
        onPull={doPull}
        {pushBusy}
        {pullBusy}
        syncDisabled={!sync?.upstream || resolve !== null || remoteBlocked}
        ahead={sync?.ahead ?? 0}
        behind={sync?.behind ?? 0}
        onToggleIssues={() => void issueSurface?.toggle()}
        issuesActive={issuesOpen}
        {issuesLocked}
        logAnytimeEnabled={effectiveLogAnytime.enabled}
        onToggleLogAnytime={() => void toggleLogAnytime()}
        canOpenPushMenu={() => tutAllows({ kind: 'other', name: 'push-menu' })}
      />

      {#if remoteBlocked}
        <!-- The origin remote isn't HTTPS, so it can't be
             PAT-authenticated — push/pull and MR/issue creation are disabled.
             Sits just under the floating toolbar; drops below the resolve
             banner when both are showing. -->
        <div
          class="remote-warning"
          role="alert"
          style="top:{resolve ? 92 : 48}px"
        >
          <span class="rw-icon" aria-hidden="true">⚠</span>
          <span>{t('remote.notHttps')}</span>
        </div>
      {/if}

      {#if resolve}
        <ResolveBanner
          op={resolve.op}
          branch={resolve.branch}
          sha={resolve.sha}
          continueDisabled={conflictedCount > 0}
          busy={resolveBusy}
          onContinue={() => void doContinue()}
          onAbort={() => (abortPending = true)}
        />
      {/if}

      {#if !hasCommits && !loading}
        <EmptyMain mode="empty-repo" />
      {:else}
        {#if truncated}
          <TruncationNotice shown={commits.length} />
        {/if}
        <MetroGraph
          commits={visibleCommits}
          {refs}
          selectedSha={selected?.sha ?? null}
          selection={selection.shas}
          selectedBranch={selectedBranch?.name ?? null}
          branchColors={projectBranchColors()}
          graphTheme={effectivePersonalize.graphTheme}
          personalizeFont={effectivePersonalize.font}
          {scrollTarget}
          onSelect={graphSelect}
          onBranchSelect={(b) => graphBranchSelect(b)}
          onCommitMenu={(c, x, y) => {
            if (contextMenuAllowed()) commitMenu(c, x, y);
          }}
          onBranchMenu={(b, x, y) => {
            if (contextMenuAllowed()) branchMenu(b, x, y);
          }}
          onBranchActivate={(b) => void doCheckout(b.name)}
          onCommitActivate={activateCommit}
          onRemoteMenu={(name, x, y) => {
            if (contextMenuAllowed()) remoteChipMenu(name, x, y);
          }}
          onRemoteCheckout={(name) => void requestRemoteCheckout(name)}
          {onGesture}
          onMarquee={graphMarquee}
          onClearSelection={graphClearSelection}
          onCreateCommit={() => {
            if (tutAllows({ kind: 'other', name: 'create-commit' }))
              showCreateCommit = true;
          }}
          onBranchMerge={requestBranchMerge}
          interactive={resolve === null}
          handTool={handTool && resolve === null}
        />
      {/if}

      {#if activePanel === 'branches' || panelClosing.current === 'branches'}
        <BranchesPanel
          closing={activePanel !== 'branches'}
          {refs}
          {colorBySha}
          {repoPath}
          branchColors={projectBranchColors()}
          linkedIssue={(branch) => issueSurface?.linkedIssue(branch) ?? null}
          selectedBranch={selectedBranch?.name ?? null}
          onClose={() => (activePanel = null)}
          onMutated={refresh}
          onBranchCreated={(name) =>
            emitOutbound('create_branch', 'Branch created', name)}
          onSetBranchColor={setBranchColor}
          onResetBranchColor={resetBranchColor}
          onGoToIssue={(n) => void issueSurface?.goToLinked(n)}
          onCheckoutRemote={(name) => void requestRemoteCheckout(name)}
          onBranchSelect={(b) => graphBranchSelect(b, { reveal: true })}
          guard={tutAllows}
          onTutorialEvent={tutNotify}
        />
      {/if}
      {#if activePanel === 'files' || panelClosing.current === 'files'}
        <FilesPanel
          closing={activePanel !== 'files'}
          {repoPath}
          reloadKey={filesReload}
          onClose={() => (activePanel = null)}
          onMutated={refresh}
          onCommitted={(sha) => {
            emitOutbound('commit', 'Commit created', sha);
            tutNotify({ kind: 'committed', sha });
          }}
          onOpenDiff={openWorktreeDiff}
          onStatus={trackConflicted}
          guard={tutAllows}
          beforeCommit={() => autoPullBefore('commit')}
        />
      {/if}

      {#if selected}
        {@const commitBranch = refs?.head.branch ?? null}
        {@const linkedIssueForCommit =
          !issuesLocked && commitBranch
            ? (issueBranchLinks()[commitBranch] ?? null)
            : null}
        <CommitDetails
          commit={selected}
          files={selectedFiles}
          {filesLoading}
          {filesError}
          branch={commitBranch}
          {repoPath}
          {gitConfigured}
          onClose={() => (selected = null)}
          onOpenDiff={openCommitDiff}
          onSelectCommit={onSearchSelect}
          onReword={rewordSelected}
          onPurgeFile={purgeSelectedFile}
          onAddFile={addFileSelected}
          linkedIssue={linkedIssueForCommit}
          onOpenIssue={() => {
            if (linkedIssueForCommit)
              void issueSurface?.goToLinked(linkedIssueForCommit.issueNumber);
          }}
          guard={tutAllows}
        />
      {/if}

      {#if pro}
        <pro.IssueSurface
          bind:this={issueSurface}
          bind:open={issuesOpen}
          bind:searchable={searchableIssues}
          {repoPath}
          {refs}
          {selected}
          commits={visibleCommits}
          locked={issuesLocked}
          tutorialDemo={tutorialDemoOpen}
          guard={tutAllows}
          onTutorialEvent={tutNotify}
          onRefresh={refresh}
          onSelectBranch={(name) =>
            graphBranchSelect({ name, current: name === refs?.head.branch })}
          onShowBranch={(name) =>
            (selectedBranch = { name, current: name === refs?.head.branch })}
          onError={setError}
          onErrorText={(message) => (error = message)}
          onOpenSettings={() => openSettings('Issue Panel')}
        />
      {/if}
    </main>

    <AdBanner consent={settings.adConsent} />
    <StatusBar
      branch={refs?.head.branch ?? null}
      ahead={sync?.ahead ?? 0}
      behind={sync?.behind ?? 0}
      status={authState().status}
      email={authState().user?.email}
      remoteUrl={effectiveRemoteUrl}
    />
  </div>
{/if}

<!-- Global overlays — usable from both the Welcome screen and the workspace -->
{#if showAdGate}
  <AdGate
    mayDecline={canDeclineAds}
    onAccept={() => void persistSettings({ ...settings, adConsent: 'granted' })}
    onDecline={() =>
      void persistSettings({ ...settings, adConsent: 'declined' })}
  />
{:else if settingsReady && settings.crashReports === 'unset'}
  <CrashConsentNotice
    onAllow={() =>
      void persistSettings({ ...settings, crashReports: 'granted' })}
    onDeny={() =>
      void persistSettings({ ...settings, crashReports: 'declined' })}
  />
{/if}
{#if crash}
  <CrashWindow
    reported={crash.reported}
    onReload={() => location.reload()}
    onDismiss={() => (crash = null)}
  />
{/if}
{#if showUser}
  <UserMenu
    locale={settings.locale}
    onLocale={changeLocale}
    onClose={() => (showUser = false)}
    status={authState().status}
    user={authState().user}
    configured={clerkConfigured()}
    onSignIn={startSignIn}
    onSignOut={signOut}
    onReplayTutorial={isMainWindow ? replayTutorial : undefined}
  />
{/if}
{#if showSettings}
  <SettingsModal
    {settings}
    {repoPath}
    detectedRemote={remoteDetected}
    projectGeneral={projectGeneral()}
    projectPersonalize={projectPersonalize()}
    projectLogAnytime={projectLogAnytime()}
    {repoAccessToken}
    initialTab={settingsInitialTab}
    onSave={persistSettings}
    onSaveProjectSettings={persistProjectSettings}
    onClose={() => (showSettings = false)}
    onPersonalizePreview={(p) => (previewPersonalize = p)}
    onIssueBindingChanged={(binding) => issueSurface?.bindingChanged(binding)}
    guard={tutAllows}
    onTutorialEvent={tutNotify}
  />
{/if}
{#if showCreateCommit && repoPath}
  <CreateCommitDialog
    {repoPath}
    reloadKey={filesReload}
    onClose={() => (showCreateCommit = false)}
    onCommitted={(sha) => {
      emitOutbound('commit', 'Commit created', sha);
      tutNotify({ kind: 'committed', sha });
    }}
    onMutated={refresh}
    guard={tutAllows}
    beforeCommit={() => autoPullBefore('commit')}
  />
{/if}

{#if menu}
  <ContextMenu
    x={menu.x}
    y={menu.y}
    items={menu.items}
    onClose={() => (menu = null)}
  />
{/if}
{#if diffView}
  <DiffViewer
    title={diffView.title}
    subtitle={diffView.subtitle}
    diff={diffView.data}
    loading={diffView.loading}
    error={diffView.error}
    onClose={() => (diffView = null)}
  />
{/if}
{#if pending && confirmCopy}
  <ConfirmRewrite
    title={confirmCopy.title}
    body={confirmCopy.body}
    confirmLabel={confirmCopy.confirmLabel}
    danger={confirmCopy.danger}
    withMessage={confirmCopy.withMessage}
    defaultMessage={confirmCopy.defaultMessage}
    choiceGroups={pendingChoices}
    busy={opBusy}
    onConfirm={runPending}
    onCancel={() => (pending = null)}
  />
{/if}
{#if forcePushPending}
  <ConfirmRewrite
    title={t('op.forcePush.title')}
    body={t('op.forcePush.body')}
    confirmLabel={t('op.forcePush.confirm')}
    danger={true}
    busy={pushBusy}
    onConfirm={() => void doForcePush()}
    onCancel={() => (forcePushPending = false)}
  />
{/if}
<!-- Auto-pull's `warn` prompt: the blocking three-outcome confirm. Yes pulls
     then acts, Skip acts without pulling, Cancel abandons the action. -->
{#if autoPullGate?.mode === 'warn'}
  <ConfirmDialog
    title={t('autoPull.title', {
      before: t(autoPullBeforeLabelKey(autoPullGate.action)),
    })}
    body={t('autoPull.body')}
    confirmLabel={t('remotePull.confirm')}
    skipLabel={t('remotePull.skip')}
    cancelLabel={t('common.cancel')}
    busy={autoPullBusy}
    onConfirm={() => answerAutoPull('yes')}
    onSkip={() => answerAutoPull('skip')}
    onCancel={() => answerAutoPull('cancel')}
  />
{/if}
{#if abortPending}
  <ConfirmDialog
    title={t('resolve.abortConfirm.title')}
    body={t('resolve.abortConfirm.body')}
    confirmLabel={t('resolve.abortConfirm.confirm')}
    cancelLabel={t('common.cancel')}
    busy={resolveBusy}
    onConfirm={() => void doAbort()}
    onCancel={() => (abortPending = false)}
  />
{/if}

{#if cloneOpen}
  <CloneDialog
    busy={cloneBusy}
    progress={cloneProgress}
    onConfirm={(args) => void startClone(args)}
    onCancel={() => (cloneOpen = false)}
  />
{/if}
{#if editingBranch}
  <BranchEditDialog
    branch={editingBranch}
    initial={projectBranchColors()[editingBranch] ??
      branchDefaultHex(editingBranch)}
    upstream={editingUpstream}
    remotes={refs?.remotes.map((r) => r.name) ?? []}
    onConfirm={(name, hex, upstream) =>
      void confirmBranchEdit(editingBranch!, name, hex, upstream)}
    onReset={() => resetBranchColor(editingBranch!)}
    onCancel={() => (editingBranch = null)}
  />
{/if}
{#if createBranchFrom}
  <CreateBranchDialog
    from={createBranchFrom.label}
    onCreate={doCreateBranch}
    onCancel={() => (createBranchFrom = null)}
  />
{/if}
{#if remoteCheckout}
  <CheckoutRemoteDialog
    remoteName={remoteCheckout.remote}
    suggestedLocal={remoteCheckout.suggested}
    busy={remoteCheckoutBusy}
    onCreate={(localName) => void doRemoteCheckoutCreate(localName)}
    onDetached={() => void doRemoteCheckoutDetached()}
    onCancel={() => (remoteCheckout = null)}
  />
{/if}
{#if remoteAdopt}
  <ConfirmDialog
    title={t('remoteAdopt.title')}
    body={t('remoteAdopt.body', {
      branch: remoteAdopt.branch,
      remote: remoteAdopt.remote,
    })}
    confirmLabel={t('remoteAdopt.confirm')}
    cancelLabel={t('common.cancel')}
    busy={remoteCheckoutBusy}
    onConfirm={() => void doRemoteAdoptUpstream()}
    onCancel={() => (remoteAdopt = null)}
  />
{/if}
{#if remotePull}
  <ConfirmDialog
    title={t('remotePull.title')}
    body={t('remotePull.body', {
      branch: remotePull.branch,
      remote: remotePull.remote,
      behind: remotePull.behind,
    })}
    confirmLabel={t('remotePull.confirm')}
    cancelLabel={t('remotePull.skip')}
    busy={remoteCheckoutBusy}
    onConfirm={() => void doRemoteCheckoutPull()}
    onCancel={cancelRemoteCheckoutPull}
  />
{/if}
{#if checkoutChoice}
  <CheckoutBranchDialog
    branches={checkoutChoice.branches}
    onPick={pickCheckoutChoice}
    onCancel={() => (checkoutChoice = null)}
  />
{/if}
{#if confirmCreatePath}
  <ConfirmDialog
    title={t('confirm.createRepo')}
    confirmLabel={t('common.create')}
    cancelLabel={t('common.cancel')}
    busy={onboardBusy}
    onConfirm={confirmCreateRepo}
    onCancel={() => (confirmCreatePath = null)}
  />
{/if}

<!-- Signed-in device limit. Raised by `deviceSeat.svelte.ts`
     when the server refuses to seat this install because the account is
     already at its plan's concurrent-device cap — on sign-in, or on the
     background renew the app fires at startup.

     OK is the ONLY path to an eviction: it resolves the pending question, and
     only then does the licence call retry with `evictOldestDevice`. The server
     picks the victim (its oldest device by `last_seen`) and swaps atomically;
     nothing here names a device. Cancel/Escape/scrim decline, and the caller
     falls back to its ordinary failure path — on startup that means the app
     carries on from the cached licence with nothing said. -->
{#if seatPromptOpen()}
  <ConfirmDialog
    title={t('deviceSeat.limitTitle')}
    body={t('deviceSeat.limitBody')}
    confirmLabel={t('common.ok')}
    cancelLabel={t('common.cancel')}
    onConfirm={confirmSeatPrompt}
    onCancel={cancelSeatPrompt}
  />
{/if}

<!-- Guided tutorial: steps 1–2 are the welcome dialog; every later step
     is the spotlight overlay. The first-use intro follows the tutorial (or
     "use directly") once per machine. -->
{#if tutorial.active && tutorialPresentation && overlayPresentation}
  {#if tutorialWelcome}
    <WelcomeTour
      onStart={() => void tutorial.start('create-demo')}
      onUseDirectly={() => void tutorial.chooseUseDirectly()}
    />
  {:else}
    <TutorialOverlay
      presentation={overlayPresentation}
      error={tutorial.error}
      onNext={() => void tutorial.next()}
      onBack={() => tutorial.back()}
      onPrimary={tutorialPresentation.primaryLabelKey
        ? () => void tutorial.primary()
        : undefined}
      primaryLabelKey={tutorialPresentation.primaryLabelKey}
      onRetry={() => void tutorial.retry()}
      onExit={() => void tutorial.exit()}
    />
  {/if}
{/if}
{#if showFirstUseGuide}
  <FirstUseGuide onClose={() => (showFirstUseGuide = false)} />
{/if}

<div class="ipc-pill" class:ok={ipcOk} title={ipcOk ? 'IPC OK' : 'IPC failed'}>
  {ipcOk ? '● ipc' : '○ ipc'}
</div>

<style>
  .shell {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .welcome-host {
    position: relative;
    height: 100%;
    overflow: hidden;
  }
  .workspace {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    background: var(--workspace-bg);
    overflow: hidden;
  }
  /* Remote-auth warning bar: a non-HTTPS remote can't use a PAT,
     so the affected features are disabled and this explains why. Amber, full
     width, absolutely positioned just under the floating toolbar (`top` is set
     inline so it can drop below the resolve banner). */
  .remote-warning {
    position: absolute;
    left: 0;
    right: 0;
    z-index: 6;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    background: #fef3c7;
    color: #92400e;
    font-size: 13px;
    border-bottom: 1px solid #fcd34d;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
  }
  .rw-icon {
    flex: none;
    font-size: 15px;
  }
  .ipc-pill {
    position: fixed;
    bottom: 26px;
    right: 12px;
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    color: var(--lane-7);
    font-family: var(--mono);
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 999px;
    pointer-events: none;
    opacity: 0.75;
    z-index: 8;
  }
  .ipc-pill.ok {
    color: var(--lane-0);
  }
</style>
