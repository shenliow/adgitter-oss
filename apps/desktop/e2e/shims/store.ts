/**
 * E2E shim for `@tauri-apps/plugin-store` (see `src/lib/settings.ts`,
 * `src/lib/recents.ts`, and the license-token helpers in `src/lib/ipc.ts`).
 *
 * A tiny in-memory, Map-backed store per file name — no disk I/O. Seeded via
 * `window.__E2E_STORE_SEED__`, a plain object Playwright injects with
 * `page.addInitScript()` BEFORE any app code runs (see `e2e/helpers.ts`):
 *
 *   { "recents.json": { "projects": [...] }, "settings.json": { "settings": {...} } }
 *
 * Only `get`/`set`/`save` are implemented — the only methods the app code
 * actually calls (every store here is opened with `{ autoSave: true }`, so
 * the real plugin never needs an explicit `.save()` either; it's a no-op here
 * for the same reason, kept only in case some path calls it defensively).
 */

declare global {
  interface Window {
    __E2E_STORE_SEED__?: Record<string, Record<string, unknown>>;
  }
}

export class Store {
  constructor(private readonly data: Map<string, unknown>) {}

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }

  async has(key: string): Promise<boolean> {
    return this.data.has(key);
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }

  async save(): Promise<void> {
    // autoSave: true in every real call site — nothing to flush in-memory.
  }

  /** Multi-window cross-window sync (settings.ts `onSettingsChanged`). No
   *  second window exists under Playwright, so nothing ever fires; resolve an
   *  unlisten no-op. */
  async onKeyChange<T>(
    _key: string,
    _cb: (value: T | undefined) => void,
  ): Promise<() => void> {
    return () => {};
  }
}

const stores = new Map<string, Store>();

export interface LoadOptions {
  autoSave?: boolean;
  defaults?: Record<string, unknown>;
}

/** Mirrors the real plugin's `load(path, options)` — returns the same
 *  in-memory `Store` instance for a given file name across calls, exactly
 *  like the real plugin caches one handle per file path. */
export async function load(
  fileName: string,
  options?: LoadOptions,
): Promise<Store> {
  const existing = stores.get(fileName);
  if (existing) return existing;

  const seed = window.__E2E_STORE_SEED__?.[fileName] ?? options?.defaults ?? {};
  const store = new Store(new Map(Object.entries(seed)));
  stores.set(fileName, store);
  return store;
}
