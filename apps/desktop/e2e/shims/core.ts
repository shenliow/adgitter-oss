/**
 * E2E shim for `@tauri-apps/api/core` (see `src/lib/ipc.ts`).
 *
 * Every `invoke()` call in the real app routes through here. Under the e2e
 * Vite config (`vite.e2e.config.ts`) this module replaces the real Tauri
 * bridge via a `resolve.alias`, forwarding each call to a Node-side handler
 * that Playwright installs on `window.__E2E_INVOKE__` (see `e2e/bridge.ts`).
 * That handler runs real `git` CLI commands against a fixture repository, so
 * the DOM/CSS/gesture layer under test talks to real git semantics without a
 * WebDriver (tauri-driver does not support macOS/WKWebView).
 */

declare global {
  interface Window {
    __E2E_INVOKE__?: (
      cmd: string,
      args: Record<string, unknown>,
    ) => Promise<unknown>;
  }
}

export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const fn = window.__E2E_INVOKE__;
  if (!fn) {
    throw new Error(
      `__E2E_INVOKE__ is not installed — did the test call installBridge(page, ...) before page.goto('/')?`,
    );
  }
  return (await fn(cmd, args ?? {})) as T;
}
