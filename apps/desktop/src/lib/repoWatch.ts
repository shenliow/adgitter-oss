/**
 * Focus-gated repository refresh coordination (auto-refresh while focused).
 *
 * The Rust side emits `repo-changed` while watching is active. This module
 * subscribes (filtering by the open repo), debounces a burst of events into a
 * single refresh, and guards against overlapping refreshes. The refresh work
 * is injected so the scheduler is pure and unit-testable with fake timers.
 */
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import type { Commit } from "./ipc";

/** Trailing debounce window; collapses a burst of changes into one refresh. */
export const DEBOUNCE_MS = 300;

export interface RepoChangedPayload {
  repoPath: string;
}

export function createRefreshScheduler(
  refresh: () => Promise<void>,
  delayMs: number = DEBOUNCE_MS,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let pending = false;

  async function run(): Promise<void> {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      await refresh();
    } finally {
      running = false;
      if (pending) {
        pending = false;
        schedule();
      }
    }
  }

  function schedule(): void {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, delayMs);
  }

  function flushNow(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    void run();
  }

  function cancel(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pending = false;
  }

  return { schedule, flushNow, cancel };
}

export async function subscribeRepoChanged(
  getRepoPath: () => string | null,
  scheduler: { schedule: () => void },
): Promise<UnlistenFn> {
  // Window-scoped: the backend now `emit_to`s this event per window (each
  // window watches its own repo), so a global listen() would also pick up
  // other windows' changes. The repo-path filter below stays as belt-and-braces.
  return getCurrentWindow().listen<RepoChangedPayload>(
    "repo-changed",
    (event) => {
      const open = getRepoPath();
      if (open && event.payload?.repoPath && event.payload.repoPath !== open) {
        return;
      }
      scheduler.schedule();
    },
  );
}

/**
 * Dedupe near-simultaneous "window refocused" signals into one call.
 *
 * Tauri's `onFocusChanged(true)` and the DOM `window` `focus` event can both
 * fire for a single refocus (belt-and-braces wiring in App.svelte covers the
 * case where one of them doesn't fire at all). Wrapping `fn` here means the
 * second, redundant signal within `windowMs` of the first is swallowed rather
 * than triggering a duplicate refresh. Leading-edge: the first call always
 * runs immediately.
 */
export function createFocusGate(fn: () => void, windowMs = 200) {
  let lastRun = 0;
  return () => {
    const now = Date.now();
    if (now - lastRun < windowMs) return;
    lastRun = now;
    fn();
  };
}

/** Keep the selected commit if it still exists, else drop it. */
export function preserveSelection(
  previous: Commit | null,
  next: Commit[],
): Commit | null {
  if (!previous) return null;
  return next.find((c) => c.sha === previous.sha) ?? null;
}
