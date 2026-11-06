/**
 * Recent-projects store.
 *
 * Persists the most-recently-opened repositories (path + display name +
 * last-opened) via `@tauri-apps/plugin-store`, most-recent-first and capped.
 * The ordering/dedupe/cap logic is a pure function (`mergeRecent`) so it can be
 * unit-tested without the Tauri runtime.
 */
import { load, type Store } from "@tauri-apps/plugin-store";

export interface RecentProject {
  path: string;
  name: string;
  /** Unix ms of the last open. */
  lastOpened: number;
}

const FILE = "recents.json";
const KEY = "projects";
/** Most-recent-first cap (resolved to 6). */
export const RECENTS_CAP = 6;

/**
 * Pure reducer: put `entry` at the front, drop any prior entry with the same
 * path, and cap the list. Used by `addRecent`; exported for testing.
 */
export function mergeRecent(
  list: RecentProject[],
  entry: RecentProject,
  cap = RECENTS_CAP,
): RecentProject[] {
  return [entry, ...list.filter((r) => r.path !== entry.path)].slice(0, cap);
}

let storeP: Promise<Store> | null = null;
function store(): Promise<Store> {
  if (!storeP) storeP = load(FILE, { autoSave: true, defaults: {} });
  return storeP;
}

/** All recent projects, most-recent-first. */
export async function listRecents(): Promise<RecentProject[]> {
  const s = await store();
  return (await s.get<RecentProject[]>(KEY)) ?? [];
}

/** Record `entry` (or refresh its position); returns the new list. */
export async function addRecent(
  entry: Omit<RecentProject, "lastOpened"> & { lastOpened?: number },
): Promise<RecentProject[]> {
  const full: RecentProject = {
    path: entry.path,
    name: entry.name,
    lastOpened: entry.lastOpened ?? Date.now(),
  };
  const next = mergeRecent(await listRecents(), full);
  const s = await store();
  await s.set(KEY, next);
  return next;
}

/** Remove the entry with `path`; returns the new list. */
export async function removeRecent(path: string): Promise<RecentProject[]> {
  const next = (await listRecents()).filter((r) => r.path !== path);
  const s = await store();
  await s.set(KEY, next);
  return next;
}
