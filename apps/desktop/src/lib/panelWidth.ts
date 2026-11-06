// Persisted panel widths (drag-to-resize). Each dockable overlay
// panel — Branches, Changes (files), Commit details, Issue — remembers the
// width the user dragged it to, so toggling it closed/open or reloading keeps
// the size.
// Stored in localStorage (webview-local, non-secret, per-machine) rather than
// settings/project-config: it is pure view chrome, unrelated to the repo, and
// must survive even with no repo open.

const KEY = (id: PanelId) => `adgitter.panelWidth.${id}`;

export type PanelId = "branches" | "files" | "details" | "issues";

/** Read a saved width, clamped to sane bounds; falls back when unset/invalid. */
export function loadPanelWidth(id: PanelId, fallback: number): number {
  try {
    const raw = localStorage.getItem(KEY(id));
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? clampWidth(n) : fallback;
  } catch {
    return fallback;
  }
}

/** Persist a dragged width (best-effort; a storage failure is non-fatal). */
export function savePanelWidth(id: PanelId, width: number): void {
  try {
    localStorage.setItem(KEY(id), String(Math.round(clampWidth(width))));
  } catch {
    /* private mode / quota — the live width still applies this session */
  }
}

/** Shared resize bounds for the dockable panels (px). */
export const PANEL_MIN_WIDTH = 240;
export const PANEL_MAX_WIDTH = 720;

export function clampWidth(w: number): number {
  return Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, w));
}
