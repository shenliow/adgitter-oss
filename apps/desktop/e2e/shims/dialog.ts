/**
 * E2E shim for `@tauri-apps/plugin-dialog` (see `App.svelte`'s `browseFolder`,
 * the native folder picker behind the Welcome "New/Open" and Clone dialogs).
 *
 * A real native file dialog can't be driven from Playwright/Chromium, and
 * none of the e2e specs exercise the browse-a-folder path (they open the
 * fixture repo via the Welcome screen's "recent project" avatar instead), so
 * this always resolves `null` — the same "user cancelled" result the real
 * plugin returns when the dialog is dismissed.
 */
export async function open(
  _options?: Record<string, unknown>,
): Promise<string | null> {
  return null;
}
