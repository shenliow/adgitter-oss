/**
 * Guided tutorial — shared contract.
 *
 * This file is the seam between the three parallel pieces of the tutorial:
 *   - the engine   (`tutorial.svelte.ts` + `steps.ts`)  decides what is allowed
 *     and when a step is complete;
 *   - the overlay  (`components/tutorial/*`)            draws the spotlight,
 *     blocks pointer/keyboard input outside it and shows the coach card;
 *   - App wiring   (`App.svelte` + panels)              asks the engine before
 *     every user operation (`allows`) and reports outcomes (`notify`).
 *
 * Keep it dependency-light: types only, plus the tiny `TUTORIAL_TARGET`
 * helper.
 */
import type { DragOp, MergeDrop } from "../dragDispatch";

/**
 * Something the user is about to do. App calls `tutorial.allows(action)` at
 * every choke point BEFORE running the operation; `false` means "swallow it
 * and show the step hint". When no tutorial is running `allows` is always
 * true, so production paths are unaffected.
 */
export type TutorialAction =
  // ── graph selection (no git mutation) ─────────────────────────────────────
  | { kind: "select"; sha: string; additive: boolean }
  | { kind: "marquee" }
  | { kind: "clearSelection" }
  | { kind: "branchSelect"; name: string }
  // ── graph gestures that mutate ────────────────────────────────────────────
  /** Merge via the HEAD "handle circle" drag (bypasses `onGesture`). */
  | { kind: "mergeDrag"; drop: MergeDrop }
  /** Every HTML5-drag result routed through App's `onGesture`. */
  | { kind: "gesture"; op: DragOp }
  | { kind: "checkout"; target: string }
  | { kind: "undo" }
  // ── commit details ────────────────────────────────────────────────────────
  | { kind: "openDetail"; sha: string }
  | { kind: "purge"; sha: string; path: string }
  | { kind: "addFile"; sha: string; path: string }
  | { kind: "reword"; sha: string }
  // ── working tree ──────────────────────────────────────────────────────────
  | { kind: "openFiles" }
  | { kind: "stage"; paths: string[] }
  | { kind: "commit" }
  // ── remote ────────────────────────────────────────────────────────────────
  | { kind: "push" }
  | { kind: "forcePush" }
  // ── Log Anytime ───────────────────────────────────────────────────────────
  | { kind: "logAnytimeToggle"; enabled: boolean }
  // ── settings / themes ─────────────────────────────────────────────────────
  | { kind: "openSettings" }
  | { kind: "settingsTab"; tab: string }
  | { kind: "applyTheme"; id: string }
  | { kind: "saveSettings" }
  | { kind: "closeSettings" }
  // ── issue tracker (tutorial preview mode) ─────────────────────────────────
  | { kind: "openIssues" }
  | { kind: "issueBranch"; issueId: string }
  | { kind: "issueStatus"; issueId: string; status: string }
  // ── anything else App knows how to name (menus, shortcuts, panels…) ──────
  | { kind: "other"; name: string };

/**
 * Something that HAS happened. App calls `tutorial.notify(event)` after an
 * operation finishes (successfully or not). Steps complete on these, never on
 * actions — a drop that later fails must not advance the tutorial.
 */
export type TutorialEvent =
  | { kind: "selected"; shas: string[] }
  | { kind: "branchSelected"; name: string }
  | { kind: "merged"; source: string; target: string }
  | { kind: "rebased"; branch: string; onto: string }
  | { kind: "cherryPicked"; commits: string[]; onto: string }
  | { kind: "undone" }
  | { kind: "reset"; target: string; mode: "soft" | "mixed" | "hard" }
  | { kind: "checkedOut"; target: string }
  | { kind: "detailOpened"; sha: string }
  | { kind: "purged"; sha: string; path: string }
  | { kind: "fileAdded"; sha: string; path: string }
  | { kind: "reworded"; sha: string; message: string }
  | { kind: "committed"; sha: string }
  | { kind: "pushed"; force: boolean; ok: boolean; rejected: boolean }
  | { kind: "logAnytimeToggled"; enabled: boolean }
  | { kind: "settingsTabOpened"; tab: string }
  | { kind: "settingsSaved"; themeChanged: boolean }
  | { kind: "issueBranchCreated"; issueId: string; branch: string }
  | { kind: "issueStatusChanged"; issueId: string; status: string }
  /** Graph data refreshed — lets steps re-resolve shas/targets. */
  | { kind: "refreshed" };

/** Snapshot of the demo repo the engine reasons about (fed by App). */
export interface TutorialRepoView {
  repoPath: string;
  /** Current branch name, or null when detached. */
  head: string | null;
  /**
   * Every commit the graph shows, newest first, with parent shas. Subjects are
   * NOT unique: after a purge/reword the original commits stay visible via
   * `main`, tags and remote-tracking refs (e.g. two "Add config"). Steps must
   * resolve a subject among commits reachable from the relevant branch tip
   * (walk `parents`), never "the first commit with this subject".
   */
  commits: { sha: string; subject: string; parents: string[] }[];
  /** Local branch name → tip sha. */
  branches: Record<string, string>;
  tags: Record<string, string>;
}

/** What the overlay needs from the engine for the current step. */
export interface TutorialPresentation {
  /** Stable step id, e.g. `merge-drag`. */
  id: string;
  /** 1-based position and total, for "Step 8 / 24". */
  index: number;
  total: number;
  titleKey: string;
  bodyKey: string;
  /** Extra hint shown after a blocked action (`allows` returned false). */
  hintKey?: string;
  /** `info` steps advance with Next; `action` steps wait for `notify`. */
  mode: "info" | "action";
  /**
   * CSS selectors whose bounding boxes become holes in the overlay (input
   * passes through them; everything else is blocked). Empty = full block,
   * e.g. a centred info card. Every element the step needs the user to touch
   * (including dialogs the allowed operation opens) must be listed.
   */
  targets: string[];
  /** Where the coach card prefers to sit relative to the first target. */
  placement?: "auto" | "center";
  /** Keys the keyboard guard lets through (e.g. 'Enter', 'Escape'). Modifier
   *  keys (Shift/Alt/Meta/Control) always pass — drags need them. */
  allowKeys?: string[];
  /** True while a `setup` side-effect (seeding the demo) is running. */
  busy: boolean;
  /** True briefly after `allows` refused something — show `hintKey`. */
  blocked: boolean;
  canGoBack: boolean;
}

/**
 * Attribute every tutorial-addressable element carries:
 * `<button data-tutorial="toolbar-push">`. Steps build selectors with
 * {@link tutorialTarget}; never select by class names (they churn).
 */
export const TUTORIAL_ATTR = "data-tutorial";

export function tutorialTarget(id: string): string {
  return `[${TUTORIAL_ATTR}="${id}"]`;
}

/**
 * Everything the engine needs from the outside world. App implements it with
 * the real IPC + its own repo state; engine tests implement it with fakes.
 * The engine never imports `lib/ipc` directly.
 */
export interface TutorialHost {
  /** Create a fresh demo repo (+ bare `origin`) under the app data dir. */
  createDemo(): Promise<{ repoPath: string; remotePath: string }>;
  /** Step 5: write untracked test files; returns their repo-relative paths. */
  seedFiles(repoPath: string): Promise<string[]>;
  /** Step 6: create demo commits, branches, tags; push them to `origin`. */
  seedHistory(repoPath: string): Promise<void>;
  /** Write one file inside the demo repo (repo-relative path). */
  writeFile(repoPath: string, path: string, content: string): Promise<void>;
  /** Step 20: append `count` simulated Log Anytime snapshots to `branch`. */
  simulateLog(
    repoPath: string,
    branch: string,
    count: number,
  ): Promise<string[]>;
  /** Delete the whole demo directory (repo + origin). */
  removeDemo(repoPath: string): Promise<void>;
  /** Open `repoPath` in this window (App's `loadRepo`). */
  openRepo(repoPath: string): Promise<void>;
  /** Return this window to the Welcome screen. Resolves once the repo's file
   *  watcher has stopped: the engine deletes the demo directory right after,
   *  and a watcher still holding it breaks that on Windows. */
  closeRepo(): Promise<void>;
  /** Current view of the open demo repo (null when none is open). */
  repoView(): TutorialRepoView | null;
  /** Persist `Settings.tutorial` changes. */
  saveFlags(flags: Partial<TutorialSettings>): Promise<void>;
  /** Show the first-use intro (US4). */
  showFirstUse(): void;
}

/** Persisted flags (Settings.tutorial). */
export interface TutorialSettings {
  /** The guided tutorial finished, was skipped ("use directly") or exited. */
  completed: boolean;
  /** The first-use introduction has been shown once. */
  firstUseShown: boolean;
}
