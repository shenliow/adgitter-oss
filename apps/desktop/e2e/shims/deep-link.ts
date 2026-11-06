/**
 * E2E shim for `@tauri-apps/plugin-deep-link` (see `src/lib/auth.svelte.ts`'s
 * `initDeepLinks`, a guarded dynamic `import()` — the real plugin already
 * degrades to a no-op there when it throws, e.g. in tests/SSR).
 *
 * No e2e spec drives the `adgitter://` OAuth or issue-link flows, so this
 * always reports "no launch URL" and never calls back.
 */
export async function getCurrent(): Promise<string[] | null> {
  return null;
}

export async function onOpenUrl(
  _handler: (urls: string[]) => void,
): Promise<void> {}
