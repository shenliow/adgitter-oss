/**
 * Slide-out bookkeeping for the docked side panels (branches / files / issues).
 *
 * The panels animate with a plain CSS keyframe driven by a `data-slide`
 * attribute, NOT a Svelte `transition:` — the latter needs the Web Animations
 * API (`element.animate`), which jsdom lacks, so it would break every
 * component test that opens a panel. Same call Toast.svelte makes for its fade.
 *
 * A CSS exit animation only plays while the element is still in the DOM, so a
 * panel the user has just closed has to stay mounted for the length of the
 * slide. `trackClosing` names that lingering panel: App.svelte keeps the
 * `{#if}` true while `current` is set, and drops the panel when it clears.
 *
 * The panels are NOT simply kept mounted and translated off-screen: FilesPanel
 * runs `repo_status` over IPC on mount and on every `reloadKey` bump, and
 * IssuePanel fetches its comment thread through the issue provider on mount —
 * keeping either alive while closed would keep paying for work nobody is
 * looking at (and IssuePanel cannot even render without a selected issue).
 */
import { untrack } from "svelte";

/** Slide duration. 150ms is the app's existing "travel" tempo (the panel
 *  resize transition), one notch above the 120ms used for hover-sized state
 *  changes and well short of the toast's 220ms fade. Kept in sync with the
 *  `--panel-slide-ms` token in app.css. */
export const PANEL_SLIDE_MS = 150;

/** jsdom ships no `matchMedia`, and absence is the "no preference" case —
 *  same optional-chaining fall-through MetroGraph's `scrollBehavior` uses. */
export function prefersReducedMotion(): boolean {
  return (
    globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ??
    false
  );
}

/**
 * Follows an "which panel is open" getter and reports, for `PANEL_SLIDE_MS`
 * after it goes back to `null`, which panel is on its way out.
 *
 * Rapid toggling is safe in both directions: every change to the source
 * cancels the pending unmount timer first, so reopening a panel inside its own
 * closing window leaves it open with no timer left to strand it, and a close →
 * close → close burst never stacks more than one timer.
 *
 * Under `prefers-reduced-motion: reduce` the linger collapses to zero — the
 * panel disappears on the spot rather than sitting there invisibly.
 */
export function trackClosing<T>(open: () => T | null): {
  readonly current: T | null;
} {
  let closing = $state<T | null>(null);
  let previous: T | null = untrack(open);
  let timer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const next = open();
    const was = previous;
    previous = next;
    clearTimeout(timer);
    timer = undefined;
    if (next !== null || was === null || prefersReducedMotion()) {
      closing = null;
      return;
    }
    closing = was;
    timer = setTimeout(() => {
      closing = null;
      timer = undefined;
    }, PANEL_SLIDE_MS);
    return () => {
      clearTimeout(timer);
      timer = undefined;
    };
  });

  return {
    get current() {
      return closing;
    },
  };
}
