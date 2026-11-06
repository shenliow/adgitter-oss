/**
 * E2E shim for `@tauri-apps/api/event` (see `src/lib/ipc.ts` `onCloneProgress`
 * and `src/lib/repoWatch.ts` `subscribeRepoChanged`).
 *
 * The e2e fixture repo is mutated by real `git` CLI calls made from Node
 * (Playwright), not from a filesystem watcher inside the WebView, so there is
 * no on-disk-change event to forward here. Every `listen()` resolves an
 * unlisten no-op — callers await it, then nothing ever fires. Tests that need
 * the graph to reflect a mutation call `refresh`-triggering UI actions
 * directly (e.g. clicking Checkout) rather than relying on the watcher.
 */

export type UnlistenFn = () => void;

export interface Event<T> {
  event: string;
  payload: T;
}

export async function listen<T>(
  _event: string,
  _handler: (event: Event<T>) => void,
): Promise<UnlistenFn> {
  return () => {};
}
