/**
 * Persisted application settings.
 *
 * One typed `Settings` object persisted via `@tauri-apps/plugin-store`. Loading
 * is defensive: any missing/corrupt field falls back to its default
 * (`mergeSettings`), so a malformed file never crashes the app. The reactive
 * copy lives in `App.svelte`; this module is the pure shape + load/save.
 */
import type { UnlistenFn } from "@tauri-apps/api/event";
import { load, type Store } from "@tauri-apps/plugin-store";
import {
  AUTO_PULL_MODES,
  AUTO_PULL_SECONDS_DEFAULT,
  clampAutoPullSeconds,
  type AutoPullMode,
} from "./autoPull";
import type { TutorialSettings } from "./tutorial/types";

export type { TutorialSettings };
export type { AutoPullMode };

export type Policy = "off" | "warn";
export type TextSize = "small" | "medium" | "large";
/** User-selectable app font family. `system` keeps the OS
 *  default sans; `sans`/`mono` swap the `--sans` stack. */
export type FontChoice = "system" | "sans" | "mono";
/**
 * Free-tier ad consent: undecided → granted → declined.
 *
 * Ads only. It used to cover crash reports too, one button for two purposes —
 * which is not a valid consent for either under GDPR Art. 7(2). The free tier
 * is ad-supported ("ads or pay", see `lib/adGate.ts`), so outside the regions
 * where refusing must still leave the service free, `declined` is not a state
 * the gate offers.
 */
export type AdConsent = "unset" | "granted" | "declined";
/** Crash/error reports to Sentry, asked separately from ads, on every tier. */
export type CrashConsent = "unset" | "granted" | "declined";

export interface GeneralSettings {
  /** Auto-pull mode before the chosen operations: off / warn / notify /
   *  always. Deliberately NOT {@link Policy} — see `lib/autoPull.ts`. */
  autoPull: AutoPullMode;
  autoPullBefore: { createBranch: boolean; push: boolean; commit: boolean };
  /** `notify` only: seconds the non-modal countdown prompt waits before it
   *  answers "yes" by itself. Clamped — see `clampAutoPullSeconds`. */
  autoPullSeconds: number;
  /** Warn when an operation would touch unstaged files. */
  unstaged: Policy;
  /** Undo/redo history depth. */
  undoRedo: number;
  /** Git dry-run: simulate mutating ops without writing. */
  dryRun: boolean;
  /** Hide GHOST commits (kept alive only by an expiring `refs/adgitter/`
   *  backup ref after a history rewrite) from the commit graph. */
  hideGhosts: boolean;
  /** Default remote URL (informational; e.g. https://github.com/you/repo.git). */
  remoteUrl: string;
  /** HTTPS access token (PAT) used to authenticate fetch/pull/push. Password
   *  (username/password) auth is intentionally not supported. */
  accessToken: string;
}

export interface PersonalizeSettings {
  /** Theme id (see lib/theme.ts). Retained for back-compat/graceful load;
   *  the app-theme picker is no longer surfaced (the only "theme" product is
   *  the graph theme below), so this stays `default` for new installs. */
  theme: string;
  /** Color-scheme id. Retained like `theme` above; no longer user-editable. */
  color: string;
  textSize: TextSize;
  /** App font family (see lib/theme.ts FONT_STACKS). */
  font: FontChoice;
  /** Graph-theme id (see lib/graphTheme.ts) — separate from `theme` above:
   *  this swaps rendered graph assets (HEAD icon, node icons, rails,
   *  background, decor), not CSS vars. This is the app's only purchasable
   *  "theme" product (sold via the graph-theme store). */
  graphTheme: string;
}

/** Log Anytime: foreground auto-snapshot + paid background/squash. */
export interface LogAnytimeSettings {
  enabled: boolean;
  /** Dedicated log branch the snapshots commit to. */
  branch: string;
  /** Minutes between snapshots while the app is open. */
  intervalMin: number;
  /** Paid (Advance+): keep running when the app is closed. */
  background: boolean;
  /** Paid (Advance+): periodically compact the log history. */
  periodicSquash: boolean;
  /** Push the dedicated log branch after each successful new snapshot. */
  autoPush: boolean;
}

export interface Settings {
  general: GeneralSettings;
  /** action id → key combo override; empty = built-in default (lib/keymap.ts). */
  keymap: Record<string, string>;
  personalize: PersonalizeSettings;
  /** branch name → hex lane-color override. */
  branchColors: Record<string, string>;
  /** Active UI locale code (lib/i18n). */
  locale: string;
  /** Free-tier ad consent. */
  adConsent: AdConsent;
  /** Crash/error report consent. Separate from {@link adConsent}. */
  crashReports: CrashConsent;
  /** Anonymous, persisted install id for telemetry; generated on first run. */
  installId: string;
  /** Log Anytime auto-snapshot config. */
  logAnytime: LogAnytimeSettings;
  /** Guided tutorial / first-use intro progress flags. */
  tutorial: TutorialSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  general: {
    autoPull: "off",
    autoPullBefore: { createBranch: false, push: true, commit: false },
    autoPullSeconds: AUTO_PULL_SECONDS_DEFAULT,
    unstaged: "warn",
    undoRedo: 3,
    dryRun: false,
    hideGhosts: false,
    remoteUrl: "",
    accessToken: "",
  },
  keymap: {},
  personalize: {
    theme: "default",
    color: "default",
    textSize: "medium",
    font: "system",
    graphTheme: "default",
  },
  branchColors: {},
  locale: "en",
  adConsent: "unset",
  crashReports: "unset",
  installId: "",
  logAnytime: {
    enabled: false,
    branch: "adgitter-log",
    intervalMin: 60,
    background: false,
    periodicSquash: false,
    autoPush: false,
  },
  tutorial: { completed: false, firstUseShown: false },
};

// --- Defensive merge -------------------------------------------------------
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

/**
 * Merge an arbitrary (possibly partial/corrupt) value onto the defaults,
 * keeping only well-typed fields. Pure — the corrupt-store fallback core.
 */
export function mergeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const g = (r.general ?? {}) as Record<string, unknown>;
  const gb = (g.autoPullBefore ?? {}) as Record<string, unknown>;
  const p = (r.personalize ?? {}) as Record<string, unknown>;
  const la = (r.logAnytime ?? {}) as Record<string, unknown>;
  const tu = (r.tutorial ?? {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  // The welcome tour is for first-time users only. Settings saved by a build
  // that predates the tutorial flags have an `installId` (generated on the
  // very first run) but no `tutorial` key: that is an existing user, who must
  // not be greeted once after upgrading. A genuinely fresh install has no
  // `installId` yet, so it keeps the false/false default and gets the tour.
  const returning =
    r.tutorial === undefined &&
    typeof r.installId === "string" &&
    r.installId !== "";
  const td: TutorialSettings = returning
    ? { completed: true, firstUseShown: true }
    : d.tutorial;
  return {
    general: {
      autoPull: oneOf(g.autoPull, AUTO_PULL_MODES, d.general.autoPull),
      autoPullBefore: {
        createBranch: bool(
          gb.createBranch,
          d.general.autoPullBefore.createBranch,
        ),
        push: bool(gb.push, d.general.autoPullBefore.push),
        commit: bool(gb.commit, d.general.autoPullBefore.commit),
      },
      autoPullSeconds: clampAutoPullSeconds(
        num(g.autoPullSeconds, d.general.autoPullSeconds),
      ),
      unstaged: oneOf(g.unstaged, ["off", "warn"], d.general.unstaged),
      undoRedo: Math.max(0, Math.round(num(g.undoRedo, d.general.undoRedo))),
      dryRun: bool(g.dryRun, d.general.dryRun),
      hideGhosts: bool(g.hideGhosts, d.general.hideGhosts),
      remoteUrl: str(g.remoteUrl, d.general.remoteUrl),
      accessToken: str(g.accessToken, d.general.accessToken),
    },
    keymap: strMap(r.keymap),
    personalize: {
      theme: str(p.theme, d.personalize.theme),
      color: str(p.color, d.personalize.color),
      textSize: oneOf(
        p.textSize,
        ["small", "medium", "large"],
        d.personalize.textSize,
      ),
      font: oneOf(p.font, ["system", "sans", "mono"], d.personalize.font),
      graphTheme: str(p.graphTheme, d.personalize.graphTheme),
    },
    branchColors: strMap(r.branchColors),
    locale: str(r.locale, d.locale),
    adConsent: oneOf(
      r.adConsent,
      ["unset", "granted", "declined"],
      d.adConsent,
    ),
    // Never inherited from `adConsent`: a grant given under the old bundled
    // prompt didn't validly cover crash reports, so everyone is asked again.
    crashReports: oneOf(
      r.crashReports,
      ["unset", "granted", "declined"],
      d.crashReports,
    ),
    installId: str(r.installId, d.installId),
    logAnytime: {
      enabled: bool(la.enabled, d.logAnytime.enabled),
      branch: str(la.branch, d.logAnytime.branch),
      intervalMin: Math.max(
        1,
        Math.round(num(la.intervalMin, d.logAnytime.intervalMin)),
      ),
      background: bool(la.background, d.logAnytime.background),
      periodicSquash: bool(la.periodicSquash, d.logAnytime.periodicSquash),
      autoPush: bool(la.autoPush, d.logAnytime.autoPush),
    },
    tutorial: {
      completed: bool(tu.completed, td.completed),
      firstUseShown: bool(tu.firstUseShown, td.firstUseShown),
    },
  };
}

// --- Store ------------------------------------------------------------------
const FILE = "settings.json";
const KEY = "settings";

let storeP: Promise<Store> | null = null;
function store(): Promise<Store> {
  if (!storeP) storeP = load(FILE, { autoSave: true, defaults: {} });
  return storeP;
}

/** Load settings, falling back to defaults on a missing/corrupt store. */
export async function loadSettings(): Promise<Settings> {
  try {
    const s = await store();
    return mergeSettings(await s.get(KEY));
  } catch {
    return mergeSettings(undefined);
  }
}

/** Persist the full settings object. */
export async function saveSettings(settings: Settings): Promise<void> {
  const s = await store();
  await s.set(KEY, settings);
}

/**
 * Multi-window (paid, `MultiWindow`): saves remain last-write-wins across
 * windows (no merge) — this only lets a window pick up another window's
 * write via the store's change notification instead of silently clobbering
 * it on its own next save. Best-effort: `Store.onKeyChange` is available in
 * the installed `@tauri-apps/plugin-store` (2.4.3); if it's ever removed,
 * `store().onKeyChange` will just throw and callers should treat this as
 * unavailable rather than crash the app.
 */
export async function onSettingsChanged(
  cb: (settings: Settings) => void,
): Promise<UnlistenFn> {
  const s = await store();
  return s.onKeyChange<Partial<Settings>>(KEY, (value) => {
    cb(mergeSettings(value));
  });
}
