/**
 * E2E shim for `@tauri-apps/api/window` (see `App.svelte`'s `onMount`, which
 * calls `getCurrentWindow().onFocusChanged(...)` to refresh the repo when the
 * native window regains focus).
 *
 * Chromium under Playwright never loses/regains OS-level window focus during
 * a run, and no e2e spec depends on that refresh path (the app also has a DOM
 * `window` "focus" listener as a belt-and-braces fallback — see
 * `lib/repoWatch.ts`'s `createFocusGate` — which this shim leaves untouched).
 * `onFocusChanged` therefore just resolves an unlisten no-op and never fires.
 */
export interface FocusChangedEvent {
  payload: boolean;
}

export function getCurrentWindow() {
  return {
    // Multi-window helpers gate on the "main" label (see auth.svelte.ts); the
    // e2e run is always the single main window.
    label: "main",
    async onFocusChanged(
      _handler: (event: FocusChangedEvent) => void,
    ): Promise<() => void> {
      return () => {};
    },
    // Native window events (`clone-progress` in ipc.ts, `repo-changed` in
    // repoWatch.ts) never fire under Playwright — the app has DOM-`window`
    // fallbacks — so this just resolves an unlisten no-op.
    async listen<T>(
      _event: string,
      _handler: (event: { payload: T }) => void,
    ): Promise<() => void> {
      return () => {};
    },
  };
}
