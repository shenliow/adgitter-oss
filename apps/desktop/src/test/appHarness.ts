/**
 * Shared test harness for App.svelte.
 *
 * App.svelte is the 2000+ line root component that owns every destructive
 * operation (push/force-push, purge-from-history, reset, merge, rebase,
 * cherry-pick, drop, reword, branch rename/delete) plus their confirm gates
 * and error paths. Before this harness there was no way to mount it in
 * jsdom at all, so none of that was covered by anything but human review.
 *
 * This module centralizes ALL the mocking a mount needs so individual tests
 * stay short and readable:
 *  - `../lib/ipc` — the entire backend surface, replaced with `vi.fn()`s
 *    (exposed via the `ipc` object) with sane resolved defaults.
 *  - `../lib/license.svelte` — `refreshEntitlement`/`hasFeature` (exposed
 *    via `license`), defaulted so every paid feature reads as locked.
 *  - `../lib/telemetry` — `configureTelemetry`/`report` (exposed via
 *    `telemetry`), stubbed to a no-op so nothing tries to reach a real
 *    transport.
 *  - `../lib/settings` / `../lib/recents` — only `loadSettings`/
 *    `saveSettings` and `listRecents`/`addRecent`/`removeRecent` are
 *    replaced (via `settingsApi`/`recentsApi`); everything else (the real
 *    `DEFAULT_SETTINGS`, `mergeSettings`, `mergeRecent`, …) is re-exported
 *    untouched.
 *  - `@tauri-apps/api/core` — the raw `invoke`, for code that calls a
 *    command directly rather than through `lib/ipc`.
 *  - `@tauri-apps/plugin-dialog`, `@tauri-apps/api/window`,
 *    `@tauri-apps/api/event`, `@tauri-apps/plugin-store` — the native
 *    surfaces App touches directly (folder picker, focus-changed, the
 *    `repo-changed` listen, and the store backing settings/recents).
 *
 * `mountApp()` mounts the real App.svelte with a repo already open (seeded
 * commits/refs) by driving the SAME path a user would: it lets the Welcome
 * screen render, then clicks the seeded "recent project" avatar — exactly
 * like `openRecent()` → `loadRepo()` does in the app itself. No App.svelte
 * internals are poked directly.
 */
import { vi } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import type {
  Commit,
  RefList,
  FileChange,
  AheadBehind,
  Backup,
  RepoStatus,
} from "../lib/ipc";
import type { RecentProject } from "../lib/recents";
import type { Settings } from "../lib/settings";

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

export const REPO_PATH = "/repo";

export const SHA1 = "a1".repeat(20);
export const SHA2 = "b2".repeat(20);
export const SHA3 = "c3".repeat(20);

export function makeCommit(
  sha: string,
  subject: string,
  parents: string[],
): Commit {
  return {
    sha,
    short_sha: sha.slice(0, 7),
    author_name: "Ada Lovelace",
    author_email: "ada@example.com",
    timestamp: 1_700_000_000,
    subject,
    body: "",
    parents,
  };
}

/** Three commits: `main` @ SHA3, `feature` forked off SHA1 and tipped at SHA2. */
export function defaultCommits(): Commit[] {
  return [
    makeCommit(SHA3, "Add feature X", [SHA1]),
    makeCommit(SHA2, "Fix bug Y", [SHA1]),
    makeCommit(SHA1, "Initial commit", []),
  ];
}

export function defaultRefs(): RefList {
  return {
    head: { branch: "main", target: SHA3, detached: false },
    branches: [
      {
        name: "main",
        kind: "branch",
        target: SHA3,
        created_ms: 3000,
        has_upstream: true,
      },
      {
        name: "feature",
        kind: "branch",
        target: SHA2,
        created_ms: 2000,
        has_upstream: false,
      },
    ],
    remotes: [],
    tags: [],
  };
}

export function defaultFiles(): FileChange[] {
  return [
    {
      path: "src/app.ts",
      status: "modified",
      old_path: null,
      insertions: 3,
      deletions: 1,
    },
  ];
}

/**
 * A couple of working-tree changes, one per group, plus a deleted entry
 * (staged) — the add-file-to-commit picker (CommitDetails) must exclude
 * deleted paths (their content can't be read to write into a historic tree).
 */
export function defaultRepoStatus(): RepoStatus {
  return {
    staged: [{ path: "src/old.ts", status: "deleted", old_path: null }],
    changed: [{ path: "src/util.ts", status: "modified", old_path: null }],
    untracked: [{ path: "README.md", status: "new", old_path: null }],
    ignored: [],
    conflicted: [],
  };
}

function emptyDiff(path: string) {
  return {
    path,
    old_path: null,
    status: "modified",
    binary: false,
    hunks: [],
  };
}

// ---------------------------------------------------------------------------
// Mock registries (vi.hoisted so vi.mock factories below can see them)
// ---------------------------------------------------------------------------

const ipc = vi.hoisted(() => ({
  ping: vi.fn(),
  pollNativeModifiers: vi.fn(),
  listCommits: vi.fn(),
  listRefs: vi.fn(),
  listCommitFiles: vi.fn(),
  diffFile: vi.fn(),
  fileHistory: vi.fn(),
  diffWorktree: vi.fn(),
  startRepoWatch: vi.fn(),
  stopRepoWatch: vi.fn(),
  repoStatus: vi.fn(),
  stagePaths: vi.fn(),
  unstagePaths: vi.fn(),
  discardPaths: vi.fn(),
  createCommit: vi.fn(),
  gitIdentityStatus: vi.fn(),
  createBranch: vi.fn(),
  renameBranch: vi.fn(),
  setUpstream: vi.fn(),
  branchUpstream: vi.fn(),
  deleteBranch: vi.fn(),
  checkout: vi.fn(),
  checkoutRemoteBranch: vi.fn(),
  inspectRemoteCheckout: vi.fn(),
  adoptRemoteUpstreamAndCheckout: vi.fn(),
  createTag: vi.fn(),
  deleteTag: vi.fn(),
  merge: vi.fn(),
  reset: vi.fn(),
  cherryPick: vi.fn(),
  revert: vi.fn(),
  reword: vi.fn(),
  rebaseOnto: vi.fn(),
  rebaseBranch: vi.fn(),
  rebase: vi.fn(),
  dropCommit: vi.fn(),
  squashRange: vi.fn(),
  purgePath: vi.fn(),
  addFileToCommit: vi.fn(),
  conflictState: vi.fn(),
  continueOp: vi.fn(),
  abortOp: vi.fn(),
  undo: vi.fn(),
  undoState: vi.fn(),
  expireBackups: vi.fn(),
  probePath: vi.fn(),
  initRepository: vi.fn(),
  cloneRepository: vi.fn(),
  onCloneProgress: vi.fn(),
  aheadBehind: vi.fn(),
  remoteUrl: vi.fn(),
  fetch: vi.fn(),
  pull: vi.fn(),
  push: vi.fn(),
  pushBranch: vi.fn(),
  initCrashReporting: vi.fn(),
  reportEvent: vi.fn(),
  debugTriggerCrash: vi.fn(),
  openExternalUrl: vi.fn(),
  getGitEmail: vi.fn(),
  setGitEmail: vi.fn(),
  openPath: vi.fn(),
  readProjectConfig: vi.fn(),
  quarantineProjectConfig: vi.fn(),
  writeProjectConfig: vi.fn(),
  listDevices: vi.fn(),
  removeDevice: vi.fn(),
  logCommit: vi.fn(),
  tutorialDemoCreate: vi.fn(),
  tutorialDemoSeedFiles: vi.fn(),
  tutorialDemoSeedHistory: vi.fn(),
  tutorialDemoWriteFile: vi.fn(),
  tutorialDemoSimulateLog: vi.fn(),
  tutorialDemoRemove: vi.fn(),
  verifyLicense: vi.fn(),
  checkFeature: vi.fn(),
  issueLicense: vi.fn(),
  mintTestLicense: vi.fn(),
  seedDevLicense: vi.fn(),
  storeLicenseToken: vi.fn(),
  loadLicenseToken: vi.fn(),
}));

/** The mocked entitlement gate. Every paid feature reads as locked by default
 *  (see `resetHarness`); a test that needs one unlocked overrides
 *  `license.hasFeature` itself. */
const license = vi.hoisted(() => ({
  refreshEntitlement: vi.fn(),
  hasFeature: vi.fn(),
  /** False by default, which keeps the free-tier ad gate shut in every test
   *  that doesn't ask for it (it waits for the entitlement to be read). */
  entitlementReady: vi.fn(() => false),
}));

const telemetry = vi.hoisted(() => ({
  configureTelemetry: vi.fn(),
  report: vi.fn(),
}));

const settingsApi = vi.hoisted(() => ({
  loadSettings: vi.fn(),
  saveSettings: vi.fn(),
}));

const recentsApi = vi.hoisted(() => ({
  listRecents: vi.fn(),
  addRecent: vi.fn(),
  removeRecent: vi.fn(),
}));

const dialogApi = vi.hoisted(() => ({
  open: vi.fn(),
}));

const windowApi = vi.hoisted(() => ({
  onFocusChanged: vi.fn(),
  listen: vi.fn(),
  /** `getCurrentWindow().label` — "main" unless a mount says otherwise. */
  label: "main",
}));

const storeApi = vi.hoisted(() => ({
  onKeyChange: vi.fn(),
}));

/**
 * Backing state for the `@tauri-apps/plugin-store` mock below, keyed by
 * store FILENAME (`settings.json`, `repo-secrets.json`, …) so `repoSecrets.ts`
 * (per-repo access tokens) and `settings.ts`'s own direct store usage
 * (`onSettingsChanged`'s `onKeyChange` subscription) each get an isolated,
 * but PERSISTENT-within-a-test, key/value map — unlike a mock that hands
 * back a fresh no-op store on every `load()` call, this lets a test seed a
 * value before mount (`seedStoreFile`) and lets App.svelte's own
 * set→get round-trip (e.g. `persistProjectSettings` → a later read) actually
 * observe what it wrote.
 */
const storeFiles = vi.hoisted(() => ({
  data: new Map<string, Map<string, unknown>>(),
}));

/** Pre-seed a `@tauri-apps/plugin-store` file's key before `mountApp()` —
 *  e.g. `seedStoreFile("repo-secrets.json", REPO_PATH, { accessToken: "tok" })`
 *  to simulate a repo that already has a stored access token. */
export function seedStoreFile(file: string, key: string, value: unknown): void {
  if (!storeFiles.data.has(file)) storeFiles.data.set(file, new Map());
  storeFiles.data.get(file)!.set(key, value);
}

// Exported separately from their declarations — combining `export const` with
// `vi.hoisted` directly trips Vitest's hoisting transform ("Cannot export
// hoisted variable").
export {
  ipc,
  license,
  telemetry,
  settingsApi,
  recentsApi,
  dialogApi,
  windowApi,
  storeApi,
  storeFiles,
};

// ---------------------------------------------------------------------------
// vi.mock registrations — module bodies run once, at import time, which is
// before `mountApp` ever dynamically imports App.svelte (see below), so these
// are guaranteed to be registered first.
// ---------------------------------------------------------------------------

vi.mock("../lib/ipc", () => {
  const wrapped: Record<string, (...args: unknown[]) => unknown> = {};
  for (const key of Object.keys(ipc) as (keyof typeof ipc)[]) {
    wrapped[key] = (...args: unknown[]) => ipc[key](...args);
  }
  return {
    ...wrapped,
    isAdgitterError: (e: unknown): boolean =>
      typeof e === "object" && e !== null && "code" in e && "message" in e,
    errorText: (e: unknown): string => {
      const tagged =
        typeof e === "object" && e !== null && "code" in e && "message" in e;
      return tagged
        ? `${(e as { code: unknown }).code}: ${(e as { message: unknown }).message}`
        : String(e);
    },
  };
});

vi.mock("../lib/license.svelte", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/license.svelte")>();
  return {
    ...actual,
    refreshEntitlement: (...a: unknown[]) => license.refreshEntitlement(...a),
    hasFeature: (...a: unknown[]) => license.hasFeature(...a),
    entitlementReady: () => license.entitlementReady(),
  };
});

vi.mock("../lib/telemetry", () => ({
  configureTelemetry: (...a: unknown[]) => telemetry.configureTelemetry(...a),
  report: (...a: unknown[]) => telemetry.report(...a),
  noopTransport: { send: async () => {} },
}));

vi.mock("../lib/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/settings")>();
  return {
    ...actual,
    loadSettings: (...a: unknown[]) => settingsApi.loadSettings(...a),
    saveSettings: (...a: unknown[]) => settingsApi.saveSettings(...a),
  };
});

vi.mock("../lib/recents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/recents")>();
  return {
    ...actual,
    listRecents: (...a: unknown[]) => recentsApi.listRecents(...a),
    addRecent: (...a: unknown[]) => recentsApi.addRecent(...a),
    removeRecent: (...a: unknown[]) => recentsApi.removeRecent(...a),
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    void args;
    throw new Error(`unmocked invoke: ${cmd}`);
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...a: unknown[]) => dialogApi.open(...a),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    // "main" by default: App-harness mounts stand in for the primary window; a
    // real secondary repo window (label !== "main") would skip deep-link
    // registration (see auth.svelte.ts initDeepLinks) and never greet with the
    // guided tutorial. `MountOverrides.windowLabel` overrides it.
    label: windowApi.label,
    onFocusChanged: (...a: unknown[]) => windowApi.onFocusChanged(...a),
    listen: (...a: unknown[]) => windowApi.listen(...a),
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

// NOTE: `get`/`set`/`delete` resolve `storeFiles.data.get(file)` freshly on
// EVERY call rather than capturing one `Map` at `load()` time. Reason:
// modules like `repoSecrets.ts` cache their `load()`'d store in a top-level
// `let storeP` the same way `settings.ts` does, and dynamic `import()` of
// `App.svelte` within one test FILE returns the same cached module instance
// across every `mountApp()` call (no `vi.resetModules()` here) — so a store
// object created in test 1 can still be the one a later test's App.svelte
// instance calls into. Resolving `file`'s map lazily means `resetHarness()`'s
// `storeFiles.data.clear()` and `seedStoreFile()` are always honored on the
// very next read/write, regardless of which test originally called `load()`.
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async (file: string) => ({
    get: vi.fn(async (k: string) => storeFiles.data.get(file)?.get(k)),
    set: vi.fn(async (k: string, v: unknown) => {
      if (!storeFiles.data.has(file)) storeFiles.data.set(file, new Map());
      storeFiles.data.get(file)!.set(k, v);
    }),
    delete: vi.fn(
      async (k: string) => storeFiles.data.get(file)?.delete(k) ?? false,
    ),
    onKeyChange: (...a: unknown[]) => storeApi.onKeyChange(...a),
  })),
}));

// ---------------------------------------------------------------------------
// Reset + mount
// ---------------------------------------------------------------------------

/**
 * Reset every mock function to a fresh, deterministic default. Called at the
 * start of every `mountApp()` so each test starts from a clean slate without
 * needing its own `beforeEach`.
 */
export function resetHarness(): void {
  storeFiles.data.clear();
  for (const fn of Object.values(ipc)) fn.mockReset();

  ipc.ping.mockResolvedValue("pong");
  // Default to the non-macOS case (nothing to poll) so MetroGraph's mid-drag
  // poller can't fire against App-level tests that never touch it directly.
  ipc.pollNativeModifiers.mockResolvedValue(null);
  ipc.listCommits.mockResolvedValue({
    commits: defaultCommits(),
    truncated: false,
    limit: 1000,
  });
  ipc.listRefs.mockResolvedValue(defaultRefs());
  ipc.listCommitFiles.mockResolvedValue(defaultFiles());
  ipc.diffFile.mockImplementation(
    async (_repo: unknown, _sha: unknown, path: unknown) =>
      emptyDiff(String(path)),
  );
  ipc.diffWorktree.mockImplementation(async (_repo: unknown, path: unknown) =>
    emptyDiff(String(path)),
  );
  ipc.fileHistory.mockResolvedValue([]);
  ipc.startRepoWatch.mockResolvedValue(undefined);
  ipc.stopRepoWatch.mockResolvedValue(undefined);
  ipc.repoStatus.mockResolvedValue(defaultRepoStatus());
  ipc.stagePaths.mockResolvedValue(undefined);
  ipc.unstagePaths.mockResolvedValue(undefined);
  ipc.discardPaths.mockResolvedValue(undefined);
  ipc.createCommit.mockResolvedValue("c".repeat(40));
  // Default: git has its own `user.email`, so the account fallback stays out of
  // it and no identity notice is shown. Tests that want the fallback
  // case override this.
  ipc.gitIdentityStatus.mockResolvedValue({
    source: "git",
    name: "Tester",
    email: "t@example.com",
  });
  ipc.createBranch.mockResolvedValue(undefined);
  ipc.renameBranch.mockResolvedValue(undefined);
  ipc.setUpstream.mockResolvedValue(undefined);
  ipc.branchUpstream.mockResolvedValue(null);
  ipc.deleteBranch.mockResolvedValue(undefined);
  ipc.checkout.mockResolvedValue(undefined);
  ipc.checkoutRemoteBranch.mockResolvedValue(undefined);
  // The remote-checkout matrix defaults to its common row — "no local branch
  // of that name", i.e. today's create-and-track prompt. Tests covering the
  // other rows override this.
  ipc.inspectRemoteCheckout.mockImplementation(
    (_repoPath: string, _remoteName: string, localName: string) =>
      Promise.resolve({ case: "createLocal", suggestedLocal: localName }),
  );
  ipc.adoptRemoteUpstreamAndCheckout.mockResolvedValue(undefined);
  ipc.createTag.mockResolvedValue(undefined);
  ipc.deleteTag.mockResolvedValue(undefined);
  ipc.reset.mockResolvedValue(undefined);
  ipc.cherryPick.mockResolvedValue(undefined);
  ipc.revert.mockResolvedValue(undefined);
  // History-rewrite ops resolve a tagged HistoryOpResult; the quiet default
  // is completed with a clean remap outcome (no descendant branches needed
  // remapping, none skipped). purgePath/addFileToCommit still resolve a bare
  // HistoryOpOutcome (their IPC contract is unchanged).
  const cleanOutcome = { remapped: [], skipped: [] };
  const completedClean = { status: "completed", outcome: cleanOutcome };
  ipc.merge.mockResolvedValue(completedClean);
  ipc.reword.mockResolvedValue(completedClean);
  ipc.rebaseOnto.mockResolvedValue(completedClean);
  ipc.rebaseBranch.mockResolvedValue(completedClean);
  ipc.rebase.mockResolvedValue(completedClean);
  ipc.dropCommit.mockResolvedValue(completedClean);
  ipc.squashRange.mockResolvedValue(completedClean);
  ipc.purgePath.mockResolvedValue(cleanOutcome);
  ipc.addFileToCommit.mockResolvedValue(cleanOutcome);
  // Conflict resolution: no paused op on load, continue completes cleanly.
  ipc.conflictState.mockResolvedValue(null);
  ipc.continueOp.mockResolvedValue(completedClean);
  ipc.abortOp.mockResolvedValue(undefined);
  ipc.undo.mockResolvedValue(null);
  // Nothing has been done yet on a freshly opened repo, which is what the real
  // backend reports too. Tests that care about the in-app-only gate override it.
  ipc.undoState.mockResolvedValue({
    available: false,
    op: null,
    reason: "nothing",
  });
  ipc.expireBackups.mockResolvedValue(0);
  ipc.probePath.mockResolvedValue({ kind: "repo", path: REPO_PATH });
  ipc.initRepository.mockResolvedValue(undefined);
  ipc.cloneRepository.mockResolvedValue(undefined);
  ipc.onCloneProgress.mockResolvedValue(() => {});
  ipc.aheadBehind.mockResolvedValue({
    ahead: 0,
    behind: 0,
    upstream: "origin/main",
  });
  // Default: no git remote detected on open. Tests that care about
  // the remote-auth gate override this per-case.
  ipc.remoteUrl.mockResolvedValue(null);
  ipc.fetch.mockResolvedValue(undefined);
  ipc.pull.mockResolvedValue(undefined);
  ipc.push.mockResolvedValue(undefined);
  ipc.initCrashReporting.mockResolvedValue(false);
  ipc.reportEvent.mockResolvedValue(undefined);
  ipc.debugTriggerCrash.mockResolvedValue(undefined);
  ipc.openExternalUrl.mockResolvedValue(undefined);
  ipc.getGitEmail.mockResolvedValue({ global: null, project: null });
  ipc.setGitEmail.mockResolvedValue(undefined);
  ipc.openPath.mockResolvedValue(undefined);
  // No repo has an `adgitter.config.json` by default — loadProjectConfig
  // falls back to defaults, same as a real fresh repo.
  ipc.readProjectConfig.mockResolvedValue(null);
  ipc.writeProjectConfig.mockResolvedValue(undefined);
  ipc.quarantineProjectConfig.mockResolvedValue(null);
  ipc.listDevices.mockResolvedValue([]);
  ipc.removeDevice.mockResolvedValue(undefined);
  ipc.logCommit.mockResolvedValue(null);
  // Guided-tutorial demo repo: benign defaults — an inert demo that the
  // tutorial tests override per case.
  ipc.tutorialDemoCreate.mockResolvedValue({
    repoPath: "/tutorial/demo-1/repo",
    remotePath: "/tutorial/demo-1/origin.git",
  });
  ipc.tutorialDemoSeedFiles.mockResolvedValue([
    "src/app.js",
    "src/style.css",
    "docs/notes.md",
  ]);
  ipc.tutorialDemoSeedHistory.mockResolvedValue(undefined);
  ipc.tutorialDemoWriteFile.mockResolvedValue(undefined);
  ipc.tutorialDemoSimulateLog.mockResolvedValue([]);
  ipc.tutorialDemoRemove.mockResolvedValue(undefined);
  ipc.verifyLicense.mockResolvedValue({
    status: "invalid",
    plan: null,
    error: null,
    expiresMs: null,
    features: [],
    ownedThemes: [],
  });
  ipc.checkFeature.mockResolvedValue(false);
  ipc.issueLicense.mockResolvedValue({
    status: "invalid",
    plan: null,
    error: null,
    expiresMs: null,
    features: [],
    ownedThemes: [],
  });
  ipc.mintTestLicense.mockResolvedValue("token");
  ipc.seedDevLicense.mockResolvedValue({
    status: "invalid",
    plan: null,
    error: null,
    expiresMs: null,
    features: [],
    ownedThemes: [],
  });
  ipc.storeLicenseToken.mockResolvedValue(undefined);
  ipc.loadLicenseToken.mockResolvedValue(null);

  license.refreshEntitlement.mockReset().mockResolvedValue(undefined);
  license.hasFeature.mockReset().mockReturnValue(false);
  license.entitlementReady.mockReset().mockReturnValue(false);

  telemetry.configureTelemetry.mockReset();
  telemetry.report.mockReset();

  settingsApi.loadSettings.mockReset();
  settingsApi.saveSettings.mockReset().mockResolvedValue(undefined);

  recentsApi.listRecents.mockReset().mockResolvedValue([]);
  recentsApi.addRecent.mockReset().mockResolvedValue([]);
  recentsApi.removeRecent.mockReset().mockResolvedValue([]);

  dialogApi.open.mockReset().mockResolvedValue(null);
  windowApi.onFocusChanged.mockReset().mockResolvedValue(() => {});
  windowApi.listen.mockReset().mockResolvedValue(() => {});
  windowApi.label = "main";
  storeApi.onKeyChange.mockReset().mockResolvedValue(() => {});
}

export interface SettingsOverride {
  general?: Partial<Settings["general"]>;
  keymap?: Record<string, string>;
  personalize?: Partial<Settings["personalize"]>;
  branchColors?: Record<string, string>;
  locale?: string;
  adConsent?: Settings["adConsent"];
  crashReports?: Settings["crashReports"];
  installId?: string;
  logAnytime?: Partial<Settings["logAnytime"]>;
  /** Guided-tutorial flags. Default: both true (a returning user), so App
   *  tests never meet the first-launch welcome unless they ask for it. */
  tutorial?: Partial<Settings["tutorial"]>;
}

export interface MountOverrides {
  commits?: Commit[];
  refs?: RefList;
  files?: FileChange[];
  aheadBehind?: AheadBehind;
  recents?: RecentProject[];
  settings?: SettingsOverride;
  repoPath?: string;
  /** Raw adgitter.config.json content readProjectConfig resolves during the
   *  mount's loadRepo (default: null — no config file exists). */
  projectConfig?: string;
  /** A paused op the `conflict_state` probe resolves during the mount's
   *  loadRepo (default: null — no conflict on disk), so tests can start the
   *  app already in resolve mode, exactly like an app restart mid-conflict. */
  conflictState?: { op: string; branch: string; sha: string } | null;
  /** Pre-seed the repo's stored access token (`repoSecrets.ts`) as though a
   *  previous session already saved one — repo-level settings never seed a
   *  token from global `settings.general.accessToken` (see
   *  `App.svelte`/`repoSecrets.ts`), so tests that need push/pull auth to
   *  already be configured for the open repo must use this instead of
   *  `settings.general.accessToken`. */
  repoAccessToken?: string;
  /** The `.git` origin URL `remote_url` resolves during the mount's loadRepo
   *  (default: null — no remote detected). Lets tests exercise the remote-auth
   *  gate / URL-seeding without the origin being clobbered onto Settings. */
  remoteUrl?: string | null;
  /** Paid features to unlock for this mount (default: none — everything is
   *  locked). Must be set at mount time; see the note in `mountApp`. */
  features?: string[];
  /** Treat the entitlement as already read (default false), which is what
   *  lets the free-tier ad gate open. Mount-time only, like `features`. */
  entitlementReady?: boolean;
  /** Click the seeded recent project to open the repo (default true). A
   *  first-launch tutorial test passes false: the welcome dialog is up and
   *  the tutorial gate refuses opening a repo behind it. */
  openRepo?: boolean;
  /** `getCurrentWindow().label` for this mount (default "main"). */
  windowLabel?: string;
}

/** Build a full `Settings` object from the real `DEFAULT_SETTINGS` + overrides. */
async function buildSettings(overrides?: SettingsOverride): Promise<Settings> {
  const { DEFAULT_SETTINGS } = await import("../lib/settings");
  const base = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Settings;
  // A non-empty installId by default: with the real "" default, App.svelte's
  // onMount generates one and calls the (mocked) saveSettings once on every
  // mount purely to persist it — a surprise extra call that has nothing to do
  // with whatever the test is exercising. Seeding one here keeps
  // `settingsApi.saveSettings` pristine until a test's own action saves.
  base.installId = "test-install-id";
  // A returning user: the guided tutorial was done and its intro seen, so the
  // first-launch welcome never covers the app in tests that don't ask for it.
  base.tutorial = { completed: true, firstUseShown: true };
  // …and one who has already answered the crash-report question, so its
  // notice doesn't sit over every test.
  base.crashReports = "declined";
  if (!overrides) return base;
  return {
    ...base,
    ...overrides,
    general: { ...base.general, ...(overrides.general ?? {}) },
    tutorial: { ...base.tutorial, ...(overrides.tutorial ?? {}) },
    personalize: { ...base.personalize, ...(overrides.personalize ?? {}) },
    logAnytime: { ...base.logAnytime, ...(overrides.logAnytime ?? {}) },
    branchColors: { ...base.branchColors, ...(overrides.branchColors ?? {}) },
    keymap: { ...base.keymap, ...(overrides.keymap ?? {}) },
  };
}

let host: HTMLDivElement | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let appInstance: any;

/**
 * Flush Svelte's reactive effects and let queued microtasks (mock-resolved
 * IPC promises, chained `await`s in App.svelte's handlers) drain. Generous
 * enough for the handful of sequential awaits `loadRepo`/`refresh` make.
 */
export async function settle(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    flushSync();
    await Promise.resolve();
  }
  flushSync();
}

/**
 * Mount the real App.svelte with a repository already open: seeds one
 * "recent project" (pointing at `overrides.repoPath` or {@link REPO_PATH})
 * and clicks its Welcome-screen avatar, the same path `openRecent()` drives
 * in the real app — no App.svelte internals are touched directly.
 */
export async function mountApp(
  overrides: MountOverrides = {},
): Promise<HTMLDivElement> {
  resetHarness();

  const repoPath = overrides.repoPath ?? REPO_PATH;
  const commits = overrides.commits ?? defaultCommits();
  const refs = overrides.refs ?? defaultRefs();
  const files = overrides.files ?? defaultFiles();

  // Entitlement must be in place BEFORE mount: App reads `hasFeature` into
  // `$derived` gates, and the mocked gate is not reactive, so flipping it
  // afterwards would not re-open a locked panel.
  if (overrides.windowLabel !== undefined)
    windowApi.label = overrides.windowLabel;
  if (overrides.entitlementReady)
    license.entitlementReady.mockReturnValue(true);
  if (overrides.features) {
    const granted = new Set(overrides.features);
    license.hasFeature.mockImplementation((f: unknown) =>
      granted.has(String(f)),
    );
  }

  ipc.listCommits.mockResolvedValue({ commits, truncated: false, limit: 1000 });
  ipc.listRefs.mockResolvedValue(refs);
  ipc.listCommitFiles.mockResolvedValue(files);
  if (overrides.aheadBehind)
    ipc.aheadBehind.mockResolvedValue(overrides.aheadBehind);
  if (overrides.projectConfig !== undefined)
    ipc.readProjectConfig.mockResolvedValue(overrides.projectConfig);
  if (overrides.remoteUrl !== undefined)
    ipc.remoteUrl.mockResolvedValue(overrides.remoteUrl);
  if (overrides.conflictState !== undefined)
    ipc.conflictState.mockResolvedValue(overrides.conflictState);
  if (overrides.repoAccessToken !== undefined)
    seedStoreFile("repo-secrets.json", repoPath, {
      accessToken: overrides.repoAccessToken,
    });

  settingsApi.loadSettings.mockResolvedValue(
    await buildSettings(overrides.settings),
  );
  recentsApi.listRecents.mockResolvedValue(
    overrides.recents ?? [{ path: repoPath, name: "repo", lastOpened: 1 }],
  );

  const { default: App } = await import("../App.svelte");
  host = document.createElement("div");
  document.body.appendChild(host);
  appInstance = mount(App, { target: host });
  await settle();

  const avatar = [...host.querySelectorAll<HTMLButtonElement>(".avatar")].find(
    (b) => !b.classList.contains("new"),
  );
  if (avatar && overrides.openRepo !== false) {
    avatar.click();
    await settle();
  }
  return host;
}

/** The mounted App's component exports (e.g. `startTutorial`). */
export function appExports(): {
  startTutorial: (fromStepId?: string | null) => Promise<void>;
} {
  if (!appInstance) throw new Error("mountApp() first");
  return appInstance;
}

/** Unmount the mounted App and remove its host. Call from `afterEach`. */
export function cleanupApp(): void {
  if (appInstance) {
    unmount(appInstance);
    appInstance = undefined;
  }
  host?.remove();
  host = undefined;
}

// ---------------------------------------------------------------------------
// DOM query helpers
// ---------------------------------------------------------------------------

/** First element under `root` whose exact trimmed textContent is `text`. */
export function byText<K extends keyof HTMLElementTagNameMap>(
  root: ParentNode,
  tag: K,
  text: string,
): HTMLElementTagNameMap[K] | null {
  return (
    [...root.querySelectorAll<HTMLElementTagNameMap[K]>(tag)].find(
      (el) => el.textContent?.trim() === text,
    ) ?? null
  );
}

/** A toolbar/round button found by its (localized) `title` attribute. */
export function toolbarButton(
  host: HTMLElement,
  title: string,
): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>(
    `button[title=${JSON.stringify(title)}]`,
  );
}

/** The MetroGraph commit `.row` whose subject matches `subject`. */
export function commitRow(
  host: HTMLElement,
  subject: string,
): HTMLButtonElement | null {
  return (
    [...host.querySelectorAll<HTMLButtonElement>(".row")].find(
      (r) => r.querySelector(".subject")?.textContent === subject,
    ) ?? null
  );
}

/** The MetroGraph branch chip whose label starts with `name`. */
export function branchChip(
  host: HTMLElement,
  name: string,
): HTMLElement | null {
  return (
    [...host.querySelectorAll<HTMLElement>(".chip-branch")].find((el) =>
      el.textContent?.trim().startsWith(name),
    ) ?? null
  );
}

/** Dispatch a right-click (contextmenu) on `el`. */
export function rightClick(el: Element, x = 100, y = 100): void {
  el.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
    }),
  );
}

/**
 * A ContextMenu item (top-level or submenu) with exact label `label`.
 * Top-level items (and submenu *parents*) wrap their label in a `<span>`
 * (ContextMenu.svelte); a submenu *child* button has no such wrapper, just a
 * bare text node — fall back to the button's own text in that case.
 */
export function menuItem(
  host: HTMLElement,
  label: string,
): HTMLButtonElement | null {
  return (
    [
      ...host.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]'),
    ].find((b) => {
      const span = b.querySelector("span");
      return (span ? span.textContent : b.textContent)?.trim() === label;
    }) ?? null
  );
}

/** The (single) currently-open ConfirmRewrite gate, plus small actions on it. */
export function rewriteGate(host: HTMLElement): {
  dialog: HTMLElement | null;
  title: string;
  body: string;
  confirm: () => void;
  cancel: () => void;
} {
  const dialog = host.querySelector<HTMLElement>('.dialog[role="dialog"]');
  return {
    dialog,
    title: dialog?.querySelector("h2")?.textContent?.trim() ?? "",
    body: dialog?.querySelector(".body")?.textContent?.trim() ?? "",
    confirm: () =>
      dialog?.querySelector<HTMLButtonElement>(".primary")?.click(),
    cancel: () => dialog?.querySelector<HTMLButtonElement>(".ghost")?.click(),
  };
}

/** The current error toast's message text, or null when none is shown. */
export function errorToast(host: HTMLElement): string | null {
  return host.querySelector('.toast[role="alert"] strong')?.textContent ?? null;
}

/** The current notice (success) toast's message text, or null. */
export function noticeToast(host: HTMLElement): string | null {
  return (
    host.querySelector('.toast.notice[role="status"] strong')?.textContent ??
    null
  );
}

export type { Backup };
