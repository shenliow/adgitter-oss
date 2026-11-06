/**
 * Guided tutorial — the engine.
 *
 * A small state machine over the flat step script in `steps.ts`:
 *
 *   - **Presentation.** `presentation` is everything the overlay draws for the
 *     current (sub)step: copy keys, spotlight selectors, the step counter and
 *     the `busy` / `blocked` flags. It is derived, so it follows every
 *     `notify()` (the demo repo changed ⇒ targets are re-resolved by subject).
 *   - **Gate.** App asks `allows(action)` before every user operation. While
 *     no tutorial runs it is always `true`; during one, only what the current
 *     step permits runs (`info`, `busy` and errored states allow nothing but
 *     `{kind:'other', name:'tutorial-nav'}`, which is allowed in every state so
 *     Back / Next / Exit keep working). A refusal flashes `blocked` for
 *     {@link BLOCKED_MS} so the overlay can show the step's hint.
 *   - **Progress.** App reports outcomes with `notify(event)`. An `action` step
 *     advances only when its `done(event)` says so — a failed operation never
 *     does. `info` steps advance with `next()`.
 *   - **Setup.** A step's `setup` (seeding the demo …) runs on entering it
 *     (or, for step 3, when the user presses the primary "Create demo"
 *     button), with `busy` set. A failure sets `error`, keeps the step and
 *     `retry()` runs it again.
 *   - **Leaving.** `exit()` / `finish()` / `chooseUseDirectly()` persist
 *     `tutorial.completed`, close and remove the demo (best effort, a failed
 *     removal is logged) and show the first-use intro once. The cleanup works
 *     on a snapshot of the run it ends, and a `start()` waits for it, so a
 *     quick restart can never close or delete the NEW run's demo.
 *
 * The engine only talks to the world through {@link TutorialHost}; it never
 * imports `lib/ipc`. Timers are injectable for tests.
 */
import {
  STEPS,
  isNav,
  newCtx,
  type TutorialCtx,
  type TutorialStep,
} from "./steps";
import type {
  TutorialAction,
  TutorialEvent,
  TutorialHost,
  TutorialPresentation,
} from "./types";

/** How long a refused action keeps `blocked` (the hint) on screen. */
export const BLOCKED_MS = 2500;

/**
 * What the overlay gets. A superset of the contract's
 * {@link TutorialPresentation}: the contract has no slot for a primary-button
 * label or a setup error, so they ride along (proposed contract addition).
 */
export interface EnginePresentation extends TutorialPresentation {
  /** Replaces "Next" on the coach card's primary button (steps 3 and 24). */
  primaryLabelKey?: string;
  /** Setup failure message; the card shows it with a Retry button. */
  error: string | null;
  /** Sub-step letter of a split step (`a`/`b`), for "Step 10a / 24". */
  sub?: string;
}

export interface TutorialOptions {
  /** Has the first-use intro already been shown on this machine? When it
   *  returns false (the default) leaving the tutorial shows it once. */
  firstUseShown?: () => boolean;
  /** Timer injection (tests). Defaults to `setTimeout` / `clearTimeout`. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Called synchronously the moment a run ends (finished, exited or "use
   *  directly"), before its demo is cleaned up: the place to drop whatever the
   *  host kept for that run. */
  onEnd?: () => void;
}

function messageOf(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e) return e;
  if (e && typeof e === "object") {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
  }
  return String(e);
}

export function createTutorial(
  host: TutorialHost,
  steps: TutorialStep[] = STEPS,
  opts: TutorialOptions = {},
) {
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    opts.clearTimer ??
    ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const total = Math.max(0, ...steps.map((s) => s.n));

  let active = $state(false);
  let index = $state(0);
  let startIndex = $state(0);
  let busy = $state(false);
  let blocked = $state(false);
  let error = $state<string | null>(null);
  /** Bumped by every `notify` so the derived presentation re-reads the view. */
  let tick = $state(0);

  let ctx: TutorialCtx = newCtx();
  /** Run generation: bumped by every `start()` and `leave()`, so a setup (or a
   *  start waiting for a cleanup) that finds it changed knows its run is over. */
  let epoch = 0;
  let blockTimer: unknown = null;
  let pending: Promise<void> = Promise.resolve();
  /** The cleanup of the run that just ended, while it is still running. */
  let leaving: Promise<void> | null = null;

  const cur = (): TutorialStep | undefined => steps[index];

  // ── blocked flash ──────────────────────────────────────────────────────────
  function clearBlocked() {
    if (blockTimer !== null) clearTimer(blockTimer);
    blockTimer = null;
    blocked = false;
  }
  function flashBlocked() {
    if (blockTimer !== null) clearTimer(blockTimer);
    blocked = true;
    blockTimer = setTimer(() => {
      blockTimer = null;
      blocked = false;
    }, BLOCKED_MS);
  }

  // ── presentation ───────────────────────────────────────────────────────────
  function backOk(): boolean {
    if (!active || busy) return false;
    const step = cur();
    const prev = steps[index - 1];
    // Only info → info, and never back across a step that ran a side effect
    // (or before where this run started: replay begins at step 3).
    return (
      !!step &&
      step.mode === "info" &&
      index > startIndex &&
      !!prev &&
      prev.mode === "info" &&
      !prev.setup
    );
  }

  const presentation = $derived.by((): EnginePresentation | null => {
    if (!active) return null;
    // A real read (the compiler drops a bare `void tick`): `notify` bumps the
    // tick so targets are re-resolved against the changed view.
    if (tick < 0) return null;
    const step = steps[index];
    if (!step) return null;
    const targets = step.targets(host.repoView(), ctx);
    return {
      id: step.id,
      index: step.n,
      total,
      titleKey: step.titleKey,
      bodyKey: step.bodyKey,
      hintKey: busy ? "tutorial.hint.busy" : step.hintKey,
      mode: step.mode,
      targets,
      placement: step.placement ?? (targets.length ? "auto" : "center"),
      allowKeys: step.allowKeys,
      busy,
      blocked,
      canGoBack: backOk(),
      primaryLabelKey: step.primaryLabelKey,
      error,
      sub: step.sub,
    };
  });

  // ── setup ──────────────────────────────────────────────────────────────────
  /** Run `step.setup` under `busy`. Failure ⇒ `error`, step kept. */
  function runSetup(step: TutorialStep, advanceAfter: boolean): Promise<void> {
    const mine = epoch;
    busy = true;
    error = null;
    const p = (async () => {
      try {
        await step.setup!(host, ctx);
      } catch (e) {
        if (mine !== epoch) return;
        busy = false;
        error = messageOf(e);
        tick = tick + 1;
        return;
      }
      if (mine !== epoch) return;
      busy = false;
      tick = tick + 1;
      // Not awaited: the next step's own setup is a separate `pending`
      // (`whenIdle` follows the chain), and `leave` awaits `pending`.
      if (advanceAfter) void advance();
    })();
    pending = p;
    return p;
  }

  /** Move to step `i` and kick off its entry setup. */
  function enter(i: number): Promise<void> {
    index = i;
    error = null;
    clearBlocked();
    tick = tick + 1;
    const step = steps[i];
    if (step?.setup && !step.setupOnPrimary) return runSetup(step, false);
    return Promise.resolve();
  }

  function advance(): Promise<void> {
    if (index + 1 >= steps.length) return leave(true);
    return enter(index + 1);
  }

  // ── leaving ────────────────────────────────────────────────────────────────
  /**
   * Persist the flags, close/remove the demo (best effort — it lives in the
   * app data dir either way) and show the first-use intro once. State flips to
   * inactive immediately so the UI reacts at once; a second call is a no-op.
   *
   * The cleanup acts on what THIS run owns, captured up front: `ctx` and
   * `pending` are replaced by the next `start()`, and reading them after an
   * `await` would clean up (or close) the wrong run's demo.
   */
  function leave(cleanup: boolean): Promise<void> {
    if (!active) return Promise.resolve();
    epoch++;
    active = false;
    busy = false;
    error = null;
    clearBlocked();
    const run = ctx; // the object an in-flight setup is still filling in
    run.cancelled = true;
    const settling = pending;
    const showFirstUse = !(opts.firstUseShown?.() ?? false);
    opts.onEnd?.();
    const mine: Promise<void> = (async () => {
      try {
        await host.saveFlags(
          showFirstUse
            ? { completed: true, firstUseShown: true }
            : { completed: true },
        );
      } catch {
        /* the flag is best effort: worst case the welcome shows again */
      }
      // Let an in-flight setup settle so `run` knows what it created.
      await settling.catch(() => {});
      if (cleanup) {
        if (run.opened) {
          try {
            await host.closeRepo();
          } catch (e) {
            console.warn(
              "tutorial: closing the demo repo failed",
              messageOf(e),
            );
          }
        }
        if (run.repoPath) {
          try {
            await host.removeDemo(run.repoPath);
          } catch (e) {
            // Stale demo dirs are swept on the next launch; just say so.
            console.warn(
              "tutorial: removing the demo failed",
              run.repoPath,
              messageOf(e),
            );
          }
        }
      }
      if (showFirstUse) host.showFirstUse();
    })();
    leaving = mine;
    const done = () => {
      if (leaving === mine) leaving = null;
    };
    mine.then(done, done);
    return mine;
  }

  // ── public operations (plain functions: safe to destructure) ──────────────
  function start(fromStepId?: string): Promise<void> {
    const mine = ++epoch;
    ctx.cancelled = true; // a restarted run's late setup must stay hands-off
    const begin = (): Promise<void> => {
      ctx = newCtx();
      error = null;
      busy = false;
      clearBlocked();
      const i = fromStepId ? steps.findIndex((s) => s.id === fromStepId) : 0;
      startIndex = i < 0 ? 0 : i;
      active = true;
      return enter(startIndex);
    };
    // The previous run may still be closing / removing its demo. Starting now
    // would let that cleanup meet this run's demo: wait for it.
    if (!leaving) return begin();
    return leaving
      .catch(() => {})
      .then(() => (mine === epoch ? begin() : undefined));
  }

  function next(): Promise<void> {
    const step = cur();
    if (!active || busy || error || !step || step.mode !== "info")
      return Promise.resolve();
    if (step.setupOnPrimary && step.setup) return runSetup(step, true);
    return advance();
  }

  function back(): void {
    if (!backOk()) return;
    void enter(index - 1);
  }

  function primary(): Promise<void> {
    const step = cur();
    if (!active || busy || !step) return Promise.resolve();
    if (step.setupOnPrimary && step.setup) return runSetup(step, true);
    return next();
  }

  function retry(): Promise<void> {
    const step = cur();
    if (!active || busy || !error || !step?.setup) return Promise.resolve();
    return runSetup(step, !!step.setupOnPrimary);
  }

  function allows(action: TutorialAction): boolean {
    if (!active) return true;
    if (isNav(action)) return true;
    const step = cur();
    let ok = false;
    if (!busy && !error && step?.mode === "action")
      ok = step.allows(action, host.repoView(), ctx);
    if (!ok) flashBlocked();
    return ok;
  }

  function notify(event: TutorialEvent): void {
    tick = tick + 1;
    if (!active || busy || error) return;
    const step = cur();
    if (step?.mode !== "action") return;
    if (step.done(event, host.repoView(), ctx)) void advance();
  }

  async function whenIdle(): Promise<void> {
    let p: Promise<void>;
    do {
      p = pending;
      await p.catch(() => {});
    } while (p !== pending);
    await leaving?.catch(() => {});
  }

  // ── public API ─────────────────────────────────────────────────────────────
  return {
    get active() {
      return active;
    },
    /** Flat index into the step list (0-based). */
    get index() {
      return index;
    },
    get error() {
      return error;
    },
    get busy() {
      return busy;
    },
    get blocked() {
      return blocked;
    },
    get presentation(): EnginePresentation | null {
      return presentation;
    },

    /** Begin (or restart) at `fromStepId`; default the welcome step. Replay
     *  passes `'create-demo'`. */
    start,
    /** Info steps: advance (the last step finishes; step 3 runs its primary). */
    next,
    /** Info steps: go back one (never across a side effect). */
    back,
    /** The coach card's primary button: run the step's "primary" setup (step
     *  3 "Create demo"), otherwise behave like Next. */
    primary,
    /** Re-run the failed setup of the current step. */
    retry,
    /** Confirmed "Exit tutorial" from anywhere. */
    exit: () => leave(true),
    /** Last step's button — identical to exit. */
    finish: () => leave(true),
    /** Step 2 "Use directly": mark completed and show the first-use intro. */
    chooseUseDirectly: () => leave(true),
    /** May this user operation run? Always true when no tutorial is active. */
    allows,
    /** Something happened. Advances the step when it is that step's `done`. */
    notify,
    /** Resolves when all setup / cleanup work started so far has settled. */
    whenIdle,
  };
}

export type Tutorial = ReturnType<typeof createTutorial>;
