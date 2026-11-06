/**
 * Per-repository project config (follow-up to the global `settings.ts` store).
 *
 * Branch colours (and, from this feature on, issue↔branch links) live at
 * `<repo>/adgitter.config.json` rather than the global settings store keyed
 * globally by branch name — a branch named `main` in one repo must not share
 * a colour override with `main` in another repo. The backend
 * (`readProjectConfig`/`writeProjectConfig` in `./ipc`) only handles
 * read/write plumbing and validation (JSON object, 256 KiB cap, pretty-print,
 * atomic write); this module owns the JSON schema, exactly as `settings.ts`
 * owns the global settings schema.
 *
 * The file is user-editable (it's a plain file in the working tree), so
 * loading is defensive like `settings.ts`'s `mergeSettings`: any missing,
 * corrupt, or wrong-typed field falls back to its default
 * (`mergeProjectConfig`) rather than throwing. Unknown top-level keys are
 * dropped — the schema is closed, so a stray/future key never round-trips
 * through a load→save cycle it wasn't written by.
 *
 * Writes only ever happen from an explicit mutator (`setProjectBranchColor`,
 * etc.) — `loadProjectConfig` never persists anything on its own, so merely
 * opening a repo that has no config file yet never creates one.
 */
import { AUTO_PULL_MODES, clampAutoPullSeconds } from "./autoPull";
import {
  quarantineProjectConfig,
  readProjectConfig,
  writeProjectConfig,
} from "./ipc";
import {
  PROVIDER_KINDS,
  type ContainerRef,
  type Deployment,
  type IssueProviderKind,
} from "./trackerConfig";
import {
  DEFAULT_SETTINGS,
  type GeneralSettings,
  type PersonalizeSettings,
  type LogAnytimeSettings,
} from "./settings";

/**
 * The NON-SECRET half of `GeneralSettings` — `accessToken` is deliberately
 * excluded from this type (and therefore from `ProjectConfig`) so it can
 * never round-trip through `adgitter.config.json`, a plain committable file
 * in the working tree. Per-repo access tokens live in `repoSecrets.ts`
 * instead (app-local plugin-store, never written to the repo).
 */
export type ProjectGeneralSettings = Omit<GeneralSettings, "accessToken">;

/** A branch↔issue link (no UI yet; schema only). */
export interface IssueBranchLink {
  provider: string;
  issueNumber: number;
  title: string;
}

/**
 * The NON-SECRET half of a repo's issue-provider binding, persisted so a fresh
 * launch comes back bound (kind/host/scope) but 'disconnected' — the access
 * token is intentionally NOT part of this schema (it stays in the license server
 * storage, never in a plain file inside the working tree).
 */
export interface IssueTrackerConfig {
  kind: IssueProviderKind;
  deployment: Deployment;
  hostUrl?: string;
  username?: string;
  scope?: ContainerRef;
  webhookUrl?: string;
}

/**
 * What the Issue panel was last showing in this repo — the memory steps 2 and 3
 * of `resolveIssuePanelDefault` read (see `issues/panelDefault.ts`). Per-repo
 * (issue numbers/projects are meaningless across repos), non-secret, and
 * written whenever the user switches issues rather than only on panel close.
 */
export interface IssuePanelState {
  /** Number of the last issue opened in this repo. */
  lastIssueNumber: number | null;
  /** Project of the last issue opened in this repo. */
  lastProject: string | null;
}

export interface ProjectConfig {
  /** branch name → hex lane-colour override (per-repo). */
  branchColors: Record<string, string>;
  /** branch name → linked issue. */
  issueBranches: Record<string, IssueBranchLink>;
  /** The repo's issue-provider binding (non-secret fields only). */
  issueTracker: IssueTrackerConfig | null;
  /** Per-repo general behaviour policy, minus `accessToken` (see
   *  {@link ProjectGeneralSettings}). `null` until the repo has its own
   *  override — App.svelte's `loadRepo` seeds it in-memory from the global
   *  settings on first open (never auto-persisted). */
  general: ProjectGeneralSettings | null;
  /** Per-repo theme/color/text-size/graph-theme. `null` until seeded —
   *  same pattern as {@link ProjectConfig.general}. */
  personalize: PersonalizeSettings | null;
  /** Per-repo Log Anytime config. `null` until seeded — same
   *  pattern as {@link ProjectConfig.general}. */
  logAnytime: LogAnytimeSettings | null;
  /** Last issue/project shown in the Issue panel (see {@link IssuePanelState}).
   *  Always present (unlike the `null`-means-unseeded slices above) — "nothing
   *  remembered yet" is expressed by its two `null` fields. */
  issuePanel: IssuePanelState;
}

export const DEFAULT_ISSUE_PANEL_STATE: IssuePanelState = {
  lastIssueNumber: null,
  lastProject: null,
};

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  branchColors: {},
  issueBranches: {},
  issueTracker: null,
  general: null,
  personalize: null,
  logAnytime: null,
  issuePanel: DEFAULT_ISSUE_PANEL_STATE,
};

// --- Defensive merge ---------------------------------------------------------
// str/bool/num/oneOf mirror settings.ts's private helpers of the same name
// (not exported there) — kept in sync by hand since both modules validate
// the same field shapes against hostile/partial JSON.
function str(v: unknown, d: string): string {
  return typeof v === "string" ? v : d;
}
function bool(v: unknown, d: boolean): boolean {
  return typeof v === "boolean" ? v : d;
}
function num(v: unknown, d: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}
function oneOf<T extends string>(v: unknown, opts: readonly T[], d: T): T {
  return typeof v === "string" && (opts as readonly string[]).includes(v)
    ? (v as T)
    : d;
}

function strMap(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") out[k] = val;
  }
  return out;
}

function issueBranchLink(v: unknown): IssueBranchLink | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (typeof r.provider !== "string") return null;
  if (typeof r.issueNumber !== "number" || !Number.isFinite(r.issueNumber))
    return null;
  if (typeof r.title !== "string") return null;
  return { provider: r.provider, issueNumber: r.issueNumber, title: r.title };
}

function issueBranchMap(v: unknown): Record<string, IssueBranchLink> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, IssueBranchLink> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const link = issueBranchLink(val);
    if (link) out[k] = link;
  }
  return out;
}

/** An optional string field: kept only when actually a string, else dropped. */
function optStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** A scope survives only when all three of id/name/ref are strings. */
function scopeRef(v: unknown): ContainerRef | undefined {
  if (!v || typeof v !== "object") return undefined;
  const r = v as Record<string, unknown>;
  if (
    typeof r.id !== "string" ||
    typeof r.name !== "string" ||
    typeof r.ref !== "string"
  )
    return undefined;
  return { id: r.id, name: r.name, ref: r.ref };
}

/**
 * A persisted issue-tracker binding is dropped WHOLESALE when its identity
 * (kind + deployment) is missing or unknown — a binding to an unrecognized
 * provider is not actionable. A malformed optional field (host/username/
 * scope/webhook) drops just that field.
 */
function issueTrackerConfig(v: unknown): IssueTrackerConfig | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (
    typeof r.kind !== "string" ||
    !(PROVIDER_KINDS as readonly string[]).includes(r.kind)
  )
    return null;
  if (r.deployment !== "cloud" && r.deployment !== "selfHosted") return null;
  return {
    kind: r.kind as IssueProviderKind,
    deployment: r.deployment,
    hostUrl: optStr(r.hostUrl),
    username: optStr(r.username),
    scope: scopeRef(r.scope),
    webhookUrl: optStr(r.webhookUrl),
  };
}

/**
 * A present-but-partial `general` slice is merged field-by-field against the
 * GLOBAL defaults (`DEFAULT_SETTINGS.general`, minus `accessToken` — that
 * field is not part of this type at all, so it can never survive a
 * round-trip even if a hand-edited file contains one). An ABSENT slice
 * (not an object) yields `null`, not defaults — `null` means "this repo has
 * no override yet", which is how the seed-on-first-open logic in
 * `App.svelte`'s `loadRepo` decides whether to seed from global settings.
 */
function generalConfig(v: unknown): ProjectGeneralSettings | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const gb = (r.autoPullBefore ?? {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS.general;
  return {
    autoPull: oneOf(r.autoPull, AUTO_PULL_MODES, d.autoPull),
    autoPullBefore: {
      createBranch: bool(gb.createBranch, d.autoPullBefore.createBranch),
      push: bool(gb.push, d.autoPullBefore.push),
      commit: bool(gb.commit, d.autoPullBefore.commit),
    },
    autoPullSeconds: clampAutoPullSeconds(
      num(r.autoPullSeconds, d.autoPullSeconds),
    ),
    unstaged: oneOf(r.unstaged, ["off", "warn"], d.unstaged),
    undoRedo: Math.max(0, Math.round(num(r.undoRedo, d.undoRedo))),
    dryRun: bool(r.dryRun, d.dryRun),
    hideGhosts: bool(r.hideGhosts, d.hideGhosts),
    remoteUrl: str(r.remoteUrl, d.remoteUrl),
  };
}

/** Same `null`-means-unseeded convention as {@link generalConfig}. */
function personalizeConfig(v: unknown): PersonalizeSettings | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const d = DEFAULT_SETTINGS.personalize;
  return {
    theme: str(r.theme, d.theme),
    color: str(r.color, d.color),
    textSize: oneOf(r.textSize, ["small", "medium", "large"], d.textSize),
    font: oneOf(r.font, ["system", "sans", "mono"], d.font),
    graphTheme: str(r.graphTheme, d.graphTheme),
  };
}

/** Same `null`-means-unseeded convention as {@link generalConfig}. */
function logAnytimeConfig(v: unknown): LogAnytimeSettings | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const d = DEFAULT_SETTINGS.logAnytime;
  return {
    enabled: bool(r.enabled, d.enabled),
    branch: str(r.branch, d.branch),
    intervalMin: Math.max(1, Math.round(num(r.intervalMin, d.intervalMin))),
    background: bool(r.background, d.background),
    periodicSquash: bool(r.periodicSquash, d.periodicSquash),
    autoPush: bool(r.autoPush, d.autoPush),
  };
}

/**
 * Unlike the three `null`-means-unseeded slices, this one always yields an
 * object: a missing/corrupt field just means "nothing remembered", which the
 * resolution chain already handles as a fall-through. A non-integer or
 * negative issue number is dropped (issue numbers are positive integers).
 */
function issuePanelState(v: unknown): IssuePanelState {
  if (!v || typeof v !== "object") return DEFAULT_ISSUE_PANEL_STATE;
  const r = v as Record<string, unknown>;
  const n = r.lastIssueNumber;
  return {
    lastIssueNumber:
      typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null,
    lastProject: typeof r.lastProject === "string" ? r.lastProject : null,
  };
}

/**
 * Merge an arbitrary (possibly partial/corrupt/hand-edited) value onto the
 * defaults, keeping only well-typed fields. Pure — the hostile-JSON fallback
 * core, mirroring `settings.ts`'s `mergeSettings`. A whole-object entry in
 * `issueBranches` is dropped (not partially kept) when any of its three
 * fields is missing/wrong-typed, since a half-formed link is not a usable
 * link. Unknown top-level keys are silently dropped.
 *
 * `general`/`personalize`/`logAnytime` never round-trip a secret: `general`'s
 * type structurally excludes `accessToken`, so even a hand-edited file that
 * sneaks one in loses it on the very first re-save (whole-slice overwrite).
 */
export function mergeProjectConfig(raw: unknown): ProjectConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    branchColors: strMap(r.branchColors),
    issueBranches: issueBranchMap(r.issueBranches),
    issueTracker: issueTrackerConfig(r.issueTracker),
    general: generalConfig(r.general),
    personalize: personalizeConfig(r.personalize),
    logAnytime: logAnytimeConfig(r.logAnytime),
    issuePanel: issuePanelState(r.issuePanel),
  };
}

// --- Reactive state -----------------------------------------------------------
let config = $state<ProjectConfig>(DEFAULT_PROJECT_CONFIG);
/** The repo the current `config` belongs to; mutators persist against this.
 *  `null` when no repo has been loaded (or the last one was closed). */
let loadedRepoPath: string | null = null;
/** Whether `readProjectConfig` found a file on the last {@link loadProjectConfig}
 *  call — used by the one-time global→per-repo colour seed (App.svelte's
 *  `loadRepo`), which must only fire for a repo that has never had one. */
let fileExisted = $state(false);

/**
 * Why a repo's config file could not be turned into settings:
 *  - `corrupt`    — the bytes came back but are not parseable JSON;
 *  - `unreadable` — the read itself failed (over the 256 KiB cap, not valid
 *    UTF-8, or a permissions/IO error), so we never saw the bytes at all.
 * Both mean "this repo HAS settings we cannot read", which is categorically
 * different from "this repo has no settings".
 */
export type ProjectConfigFailureReason = "corrupt" | "unreadable";

/**
 * What the UI needs to tell the user their repo settings could not be read.
 * `backupFile` is the NAME of the sibling copy that preserves the original
 * bytes, or `null` when there was nothing to preserve or preserving it failed.
 *
 * `writesBlocked` is the load-bearing field: it is `true` exactly when we
 * could NOT copy the original aside, and then {@link persist} refuses to save
 * at all — an unpreserved file we failed to read is the one case where a save
 * would destroy settings with no copy to restore from.
 */
export interface ProjectConfigLoadFailure {
  repoPath: string;
  backupFile: string | null;
  reason: ProjectConfigFailureReason;
  writesBlocked: boolean;
}

/** Non-null while the loaded repo's config file exists but could not be read
 *  (unparseable content, or a read that failed outright). */
let loadFailure = $state<ProjectConfigLoadFailure | null>(null);

/**
 * The standing refusal-to-write, kept SEPARATE from {@link loadFailure} on
 * purpose: `loadFailure` is a message the user may dismiss, and dismissing a
 * warning must never re-arm a write that would eat their settings. Carries
 * the repo it was raised for, so a block can never leak onto another repo
 * (`persist` compares it against the repo it is about to write).
 */
let writeBlock: ProjectConfigLoadFailure | null = null;

/**
 * Load `<repoPath>/adgitter.config.json` into the reactive store. Never throws.
 * Sets the repo mutators persist against, even before the read resolves, so
 * a mutation that races a slow load still targets the right repo.
 *
 * ## An unreadable file is NOT a missing file
 *
 * A missing file means "this repo has no settings yet". Unparseable content —
 * or a read that fails outright (over the 256 KiB cap, not valid UTF-8, a
 * permissions/IO error) —
 * means "this repo HAS settings and we cannot read them" — every branch
 * colour, issue link, Log Anytime setting and personalize override is still
 * in there. Treating the two alike (which this did) was silent data loss, not
 * an inconvenience: the store reported the config as existing while holding
 * defaults, and the very next save — which can come from a background path
 * like `setProjectIssuePanel`, not only from a settings dialog — wrote those
 * defaults over the file. So on either failure we:
 *
 *  1. copy the original bytes aside FIRST (`quarantineProjectConfig`), before
 *     the load even resolves, so no later write can outrun it. A byte copy
 *     needs neither parsing nor UTF-8 decoding nor the read cap, so it works
 *     even for the inputs `readProjectConfig` refuses;
 *  2. report the config as NOT existing (see {@link projectConfigExists});
 *  3. record {@link projectConfigLoadFailure} so the UI can say so;
 *  4. if — and only if — the copy ALSO failed (e.g. no read permission at
 *     all), block writes entirely: saving over settings we can neither read
 *     nor preserve is the one variant with no way back. See {@link persist}.
 *
 * Recovery is deliberately NOT automatic. We never rewrite, repair, or delete
 * the file we failed to parse — silently rewriting bytes we do not understand
 * is its own way to destroy data (a file with one stray character still holds
 * everything the user configured, and a "repair" guesses at which half to
 * keep). The app copies it aside and keeps behaving as if the repo had no
 * config; the original stays untouched until an explicit, user-initiated save
 * replaces it, and the `.bak` sibling is there to restore by hand.
 */
export async function loadProjectConfig(
  repoPath: string,
): Promise<ProjectConfig> {
  loadedRepoPath = repoPath;
  let raw: string | null = null;
  let readFailed = false;
  try {
    raw = await readProjectConfig(repoPath);
  } catch (e) {
    // NOT the same as `null`: `null` means "no such file", this means "there
    // may well be a file and we could not get its contents".
    console.error("readProjectConfig failed", e);
    readFailed = true;
    raw = null;
  }
  // A newer load started while this one was in flight — let it win instead
  // of clobbering fresher state with a stale result.
  if (loadedRepoPath !== repoPath) return config;
  let parsed: unknown;
  let corrupt = false;
  if (raw != null) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      corrupt = true;
    }
  }
  const reason: ProjectConfigFailureReason | null = readFailed
    ? "unreadable"
    : corrupt
      ? "corrupt"
      : null;
  let backupFile: string | null = null;
  // `quarantineProjectConfig` resolving to `null` means there was no file to
  // preserve; only a THROW means we failed to preserve one that is there.
  let quarantineFailed = false;
  if (reason) {
    try {
      backupFile = (await quarantineProjectConfig(repoPath)) ?? null;
    } catch (e) {
      console.error("quarantineProjectConfig failed", e);
      quarantineFailed = true;
    }
    // Re-check after the await: a newer load may have started meanwhile.
    if (loadedRepoPath !== repoPath) return config;
  }
  fileExisted = raw != null && !corrupt;
  loadFailure = reason
    ? { repoPath, backupFile, reason, writesBlocked: quarantineFailed }
    : null;
  // A clean (or merely missing-file) load for this repo lifts any standing
  // block — this is how the user recovers: fix the file, reopen the repo.
  writeBlock = quarantineFailed ? loadFailure : null;
  config = mergeProjectConfig(parsed);
  return config;
}

/** Clear the store back to defaults with no repo loaded (e.g. `closeRepo`). */
export function resetProjectConfig(): void {
  loadedRepoPath = null;
  fileExisted = false;
  loadFailure = null;
  writeBlock = null;
  config = DEFAULT_PROJECT_CONFIG;
}

/**
 * Whether the last {@link loadProjectConfig} loaded a usable config file.
 *
 * `false` for a corrupt file, even though a file is physically there. The one
 * production caller (`App.svelte`'s `loadRepo`) uses this to decide whether to
 * seed the in-memory branch colours from the legacy global map, and the
 * question it is really asking is "do we already have this repo's own
 * colours?" — for an unreadable file we have none, so seeding is both correct
 * and strictly better than an empty map. The seed is in-memory only and the
 * original bytes are preserved before we get here, so nothing is at risk.
 */
export function projectConfigExists(): boolean {
  return fileExisted;
}

/**
 * Reactive: non-null while the loaded repo's config file could not be read
 * (unparseable content, or a read that failed outright).
 * Read by `StatusBar.svelte`, which shows a persistent warning naming the
 * preserved copy — persistent rather than a toast on purpose: the repo stays
 * in this state (and keeps loading defaults) until the user fixes or replaces
 * the file, so a message that auto-dismisses would under-report it.
 *
 * SEAM for the global error toast: `App.svelte` cannot be touched by this
 * change, so it does not yet raise one. To add it there, it would need
 * exactly an `$effect` reading `projectConfigLoadFailure()` and setting its
 * local `error` state from `t('status.configUnreadableHint', { file })`,
 * calling {@link clearProjectConfigLoadFailure} in the toast's `onDismiss`.
 */
export function projectConfigLoadFailure(): ProjectConfigLoadFailure | null {
  return loadFailure;
}

/** Dismiss the {@link projectConfigLoadFailure} warning (user acknowledgement
 *  only — it says nothing about the file having been fixed). Dismissal does
 *  NOT lift a write block: the next refused save raises the warning again
 *  (see {@link persist}). */
export function clearProjectConfigLoadFailure(): void {
  loadFailure = null;
}

/** Reactive: the loaded repo's branch-colour overrides. */
export function projectBranchColors(): Record<string, string> {
  return config.branchColors;
}

/** Reactive: the loaded repo's branch→issue links. */
export function issueBranchLinks(): Record<string, IssueBranchLink> {
  return config.issueBranches;
}

/** Reactive: the loaded repo's persisted issue-provider binding (or null). */
export function projectIssueTracker(): IssueTrackerConfig | null {
  return config.issueTracker;
}

/** Reactive: what the Issue panel last showed in this repo (never `null` —
 *  "nothing remembered" is two `null` fields). */
export function projectIssuePanel(): IssuePanelState {
  return config.issuePanel;
}

/** Reactive: the loaded repo's general-settings override, or `null` if it
 *  has never been seeded/saved for this repo (see `seedProjectGeneral`). */
export function projectGeneral(): ProjectGeneralSettings | null {
  return config.general;
}

/** Reactive: the loaded repo's personalize override, or `null` if unseeded. */
export function projectPersonalize(): PersonalizeSettings | null {
  return config.personalize;
}

/** Reactive: the loaded repo's Log Anytime override, or `null` if unseeded. */
export function projectLogAnytime(): LogAnytimeSettings | null {
  return config.logAnytime;
}

/**
 * Seed the in-memory branch-colour map (e.g. from the legacy global
 * `settings.branchColors`) WITHOUT writing to disk — used once, by
 * `App.svelte`'s `loadRepo`, for a repo that has no config file yet. The seed
 * is only persisted once the user actually changes something (any mutator
 * below writes the *whole* current config, seed included), so opening a repo
 * that never touches its colours never creates `adgitter.config.json`.
 */
export function seedProjectBranchColors(colors: Record<string, string>): void {
  config = { ...config, branchColors: { ...colors } };
}

/**
 * Defense-in-depth for the secret red line: strip `accessToken` at the
 * `general`-slice boundary regardless of what the caller's object literally
 * carries at runtime. The `ProjectGeneralSettings` TS type alone does NOT
 * stop a smuggled `accessToken` property from surviving a shallow spread —
 * e.g. `{ ...someGeneralSettingsWithAToken }` still copies it at runtime even
 * though the destination variable's TS type says it doesn't have one. Both
 * `seedProjectGeneral` and `setProjectGeneral` route through this rather than
 * trusting callers to have stripped it themselves.
 */
function sanitizeGeneral(
  value: ProjectGeneralSettings,
): ProjectGeneralSettings {
  const { accessToken: _accessToken, ...rest } =
    value as ProjectGeneralSettings & Record<string, unknown>;
  return {
    ...(rest as ProjectGeneralSettings),
    autoPullBefore: { ...(rest as ProjectGeneralSettings).autoPullBefore },
  };
}

/**
 * Seed the in-memory `general`/`personalize`/`logAnytime` slices from the
 * current global settings WITHOUT writing to disk — same pattern and same
 * caller (`App.svelte`'s `loadRepo`) as {@link seedProjectBranchColors}, but
 * per-slice rather than file-level: each of the three is seeded only when
 * IT is still `null` (unlike branch colours, a repo's config file can exist
 * with some but not all of these slices set, e.g. hand-edited or written by
 * an older build). `accessToken` is never part of `general` — see
 * {@link sanitizeGeneral}, which strips it defensively even so.
 */
export function seedProjectGeneral(value: ProjectGeneralSettings): void {
  config = { ...config, general: sanitizeGeneral(value) };
}

/** See {@link seedProjectGeneral}. */
export function seedProjectPersonalize(value: PersonalizeSettings): void {
  config = { ...config, personalize: { ...value } };
}

/** See {@link seedProjectGeneral}. */
export function seedProjectLogAnytime(value: LogAnytimeSettings): void {
  config = { ...config, logAnytime: { ...value } };
}

/**
 * Persist the full current config against the loaded repo. No-op (resolves
 * immediately) when no repo is loaded. Errors are logged, never thrown —
 * matches how `App.svelte`'s `persistSettings` handles a failed save today.
 *
 * ## Never overwrite a config file we failed to read
 *
 * Every mutator lands here, including background ones (`setProjectIssuePanel`
 * fires from merely opening an issue), and the write is a whole-file
 * overwrite with whatever is in memory — defaults, if the load failed. So
 * when `loadProjectConfig` could neither read the file NOR copy it aside, the
 * only safe move is to refuse: the user's settings exist only in that file.
 *
 * The refusal is not silent. It re-raises {@link projectConfigLoadFailure} —
 * the same record `StatusBar.svelte` renders — so a user who dismissed the
 * warning and then changed a setting sees it come back rather than believing
 * the change was saved.
 *
 * The block is repo-scoped: it applies only to the repo it was raised for, so
 * a blocked repo never silences saves in the next repo the user opens.
 */
async function persist(): Promise<void> {
  const path = loadedRepoPath;
  if (!path) return;
  if (writeBlock && writeBlock.repoPath === path) {
    console.error(
      "writeProjectConfig refused: adgitter.config.json could not be read or preserved",
      path,
    );
    loadFailure = writeBlock;
    return;
  }
  try {
    await writeProjectConfig(path, JSON.stringify(config));
  } catch (e) {
    console.error("writeProjectConfig failed", e);
  }
}

/** Record (or clear, with null) the repo's issue-provider binding and persist.
 *  Callers pass only the non-secret fields — never a token. */
export function setProjectIssueTracker(
  cfg: IssueTrackerConfig | null,
): Promise<void> {
  config = { ...config, issueTracker: cfg ? { ...cfg } : null };
  return persist();
}

/**
 * Remember the issue the Issue panel is now showing (steps 2/3 of the panel's
 * default-content chain). Called on every issue SWITCH, not only on close, so
 * a crash or a forced quit still leaves the right memory behind.
 *
 * Returns without writing when nothing actually changed — the panel re-selects
 * the same issue on every open/refresh, and this file lives inside the working
 * tree, so a redundant write would churn the user's git status.
 */
export function setProjectIssuePanel(
  lastIssueNumber: number | null,
  lastProject: string | null,
): Promise<void> {
  const cur = config.issuePanel;
  if (
    cur.lastIssueNumber === lastIssueNumber &&
    cur.lastProject === lastProject
  )
    return Promise.resolve();
  config = { ...config, issuePanel: { lastIssueNumber, lastProject } };
  return persist();
}

/**
 * Set the repo's general-settings override and persist. `accessToken` is not
 * part of this type — see {@link ProjectGeneralSettings}; callers persist the
 * token separately via `repoSecrets.ts`'s `setRepoAccessToken`.
 *
 * Cross-window note: like every mutator here, this is last-write-wins — two
 * windows editing settings for the SAME repo at once will silently clobber
 * each other (no file-watch sync). Acceptable per the feature's scope.
 */
export function setProjectGeneral(
  value: ProjectGeneralSettings,
): Promise<void> {
  config = { ...config, general: sanitizeGeneral(value) };
  return persist();
}

/** Set the repo's personalize override and persist. */
export function setProjectPersonalize(
  value: PersonalizeSettings,
): Promise<void> {
  config = { ...config, personalize: { ...value } };
  return persist();
}

/** Set the repo's Log Anytime override and persist. */
export function setProjectLogAnytime(value: LogAnytimeSettings): Promise<void> {
  config = { ...config, logAnytime: { ...value } };
  return persist();
}

/** Set (or overwrite) a branch's colour override and persist. */
export function setProjectBranchColor(
  name: string,
  hex: string,
): Promise<void> {
  config = { ...config, branchColors: { ...config.branchColors, [name]: hex } };
  return persist();
}

/** Clear a branch's colour override (falls back to the default lane colour)
 *  and persist. */
export function resetProjectBranchColor(name: string): Promise<void> {
  const next = { ...config.branchColors };
  delete next[name];
  config = { ...config, branchColors: next };
  return persist();
}

/**
 * Move a colour override from one branch name to another (a branch rename).
 * No-op — including no write — when `from` carries no override, so renaming
 * an uncoloured branch never touches the file. Keyed by name, so a rename
 * MOVES the entry rather than leaving a stale key that would later colour an
 * unrelated branch reusing the old name.
 */
export function moveProjectBranchColor(
  from: string,
  to: string,
): Promise<void> {
  if (!(from in config.branchColors)) return Promise.resolve();
  const next = { ...config.branchColors };
  const hex = next[from];
  delete next[from];
  next[to] = hex;
  config = { ...config, branchColors: next };
  return persist();
}

/** Link a branch to an issue and persist. No UI consumes this yet; the accessor exists so the schema is ready. */
export function setIssueBranchLink(
  branch: string,
  link: IssueBranchLink,
): Promise<void> {
  config = {
    ...config,
    issueBranches: { ...config.issueBranches, [branch]: link },
  };
  return persist();
}

/** Remove a branch's issue link and persist. */
export function removeIssueBranchLink(branch: string): Promise<void> {
  const next = { ...config.issueBranches };
  delete next[branch];
  config = { ...config, issueBranches: next };
  return persist();
}
