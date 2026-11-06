/**
 * Per-repository secrets (follow-up to `projectConfig.svelte.ts`'s per-repo
 * settings).
 *
 * `adgitter.config.json` (`projectConfig.svelte.ts`) is a plain file INSIDE
 * the repo's working tree — it can be committed, synced, or accidentally
 * shared, so a secret must never be written there. Per-repo HTTPS access
 * tokens (PATs) instead live in an app-local `@tauri-apps/plugin-store` file,
 * `repo-secrets.json`, keyed by absolute repo path — mirroring how
 * `settings.ts` owns the global store's mechanics (load/save, defensive
 * parsing), just keyed per-repo instead of a single global object.
 *
 * Cross-window note: like `projectConfig.svelte.ts`'s mutators, a save here
 * is last-write-wins across windows — two windows editing the SAME repo's
 * token at once will silently clobber each other. No file-watch sync is
 * built for this (acceptable per the feature's scope).
 */
import { load, type Store } from "@tauri-apps/plugin-store";

interface RepoSecret {
  accessToken: string;
}

const FILE = "repo-secrets.json";

let storeP: Promise<Store> | null = null;
function store(): Promise<Store> {
  if (!storeP) storeP = load(FILE, { autoSave: true, defaults: {} });
  return storeP;
}

/** Defensive parse: anything but a well-typed string yields "". */
function accessTokenOf(v: unknown): string {
  if (!v || typeof v !== "object") return "";
  const token = (v as Record<string, unknown>).accessToken;
  return typeof token === "string" ? token : "";
}

/**
 * Load the repo's stored access token. Resolves to `""` when the repo has
 * none yet (most repos won't) or the store is missing/corrupt — never
 * throws, matching `settings.ts`'s `loadSettings` fallback style. Note this
 * is NOT seeded from the global `settings.general.accessToken` on a repo's
 * first open (unlike `general`/`personalize`/`logAnytime` in
 * `projectConfig.svelte.ts`) — secrets are never silently copied across
 * repos; the same precedent as issue-tracker bindings (`projectConfig`'s
 * `IssueTrackerConfig`), which also come back "disconnected" on a fresh
 * launch rather than reusing a token from elsewhere.
 */
export async function loadRepoAccessToken(repoPath: string): Promise<string> {
  try {
    const s = await store();
    return accessTokenOf(await s.get(repoPath));
  } catch {
    return "";
  }
}

/**
 * Persist (or, given an empty string, clear) the repo's access token. Errors
 * are left to the caller to handle/log — mirrors `projectConfig.svelte.ts`'s
 * `writeProjectConfig` call in `persist()`, which callers wrap in try/catch.
 */
export async function setRepoAccessToken(
  repoPath: string,
  accessToken: string,
): Promise<void> {
  const s = await store();
  if (accessToken) {
    await s.set(repoPath, { accessToken } satisfies RepoSecret);
  } else {
    await s.delete(repoPath);
  }
}
