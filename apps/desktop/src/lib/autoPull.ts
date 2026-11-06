/**
 * Auto-pull gate: the shape and the pure rules behind "pull before
 * create-branch / push / commit".
 *
 * Deliberately separate from `Policy` ("off" | "warn", shared with the
 * `unstaged` warning): "always pull" and "ask with a countdown" are
 * meaningless for an unstaged-files warning, so widening `Policy` would widen
 * a setting nobody asked to widen. This module owns the four-mode type, the
 * countdown clamp, and the mode→behaviour mapping; `App.svelte` owns the
 * side effects.
 */

export const AUTO_PULL_MODES = ["off", "warn", "notify", "always"] as const;
/** Auto-pull mode. `off` = today's behaviour (nothing happens). */
export type AutoPullMode = (typeof AUTO_PULL_MODES)[number];

export const AUTO_PULL_ACTIONS = ["createBranch", "push", "commit"] as const;
/** The three gated actions — one per `autoPullBefore` checkbox. */
export type AutoPullAction = (typeof AUTO_PULL_ACTIONS)[number];

/** The user's answer to a gate prompt (`warn` dialog or `notify` countdown). */
export type AutoPullDecision = "yes" | "skip" | "cancel";

/**
 * What the gate must do before the pending action runs.
 * - `proceed`   — run the action straight away, no pull.
 * - `pull`      — pull first, then run the action, no prompt (`always`).
 * - `ask`       — blocking three-way confirm, then act on the answer (`warn`).
 * - `countdown` — non-modal prompt that auto-answers `yes` on expiry
 *                 (`notify`). The pending action still waits for the answer.
 */
export type AutoPullPlan = "proceed" | "pull" | "ask" | "countdown";

/** Default countdown for `notify`, in seconds (the user's stated default). */
export const AUTO_PULL_SECONDS_DEFAULT = 5;
/**
 * Clamp range for the `notify` countdown.
 *
 * The floor is 1s, not 0: at 0 the prompt would answer itself in the same
 * frame it appeared, so Skip/Cancel could never be clicked and the "notify"
 * mode would be an obfuscated "always". Even 1s is barely actionable, but it
 * is the smallest value that still renders a prompt the user can race.
 *
 * The ceiling is 60s because the countdown holds a *pending git action*
 * hostage: the commit/push the user just asked for does not run until the
 * prompt resolves. Past a minute the user has moved on and reads the stalled
 * action as a bug, not as a prompt they chose to ignore.
 */
export const AUTO_PULL_SECONDS_MIN = 1;
export const AUTO_PULL_SECONDS_MAX = 60;

/** Clamp + integerize a persisted/edited countdown length (see the range above). */
export function clampAutoPullSeconds(v: number): number {
  if (!Number.isFinite(v)) return AUTO_PULL_SECONDS_DEFAULT;
  return Math.min(
    AUTO_PULL_SECONDS_MAX,
    Math.max(AUTO_PULL_SECONDS_MIN, Math.round(v)),
  );
}

/**
 * The mode→behaviour mapping, for one action.
 *
 * `enabled` is that action's `autoPullBefore` checkbox. Note what this
 * function deliberately does NOT take: the cached `behind` count. Prompting is
 * UNCONDITIONAL whenever the gate is enabled — `refreshSync()` runs in only a
 * handful of places (after pull/push/force-push and two repo-load paths), so
 * the cached `behind` can be arbitrarily stale, and suppressing the prompt on
 * a stale `behind: 0` would silently turn the whole feature off. Asking when
 * it turned out not to be needed is the cheaper error; fetching first just to
 * decide whether to ask would make the gate do the very network round-trip it
 * is asking permission for.
 */
export function autoPullPlan(
  mode: AutoPullMode,
  enabled: boolean,
): AutoPullPlan {
  if (!enabled) return "proceed";
  switch (mode) {
    case "off":
      return "proceed";
    case "always":
      return "pull";
    case "warn":
      return "ask";
    case "notify":
      return "countdown";
  }
}

/**
 * i18n key for the action's label, reused from the Settings checkboxes
 * ("Before Push" / "推送前" / "プッシュ前"). Every gate string takes it as a
 * `{before}` prefix rather than splicing an action noun into a sentence — an
 * already-translated adverbial phrase used as a leading label reads correctly
 * in all eight catalogs, whereas an interpolated noun would need per-language
 * word order.
 *
 * Returned as a literal union, not `string`, so `t()` still type-checks the
 * key against the catalog (and this module stays free of an i18n import).
 */
export function autoPullBeforeLabelKey(
  action: AutoPullAction,
):
  | "general.beforeCreateBranch"
  | "general.beforePush"
  | "general.beforeCommit" {
  switch (action) {
    case "createBranch":
      return "general.beforeCreateBranch";
    case "push":
      return "general.beforePush";
    case "commit":
      return "general.beforeCommit";
  }
}
