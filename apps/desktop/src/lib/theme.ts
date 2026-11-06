/**
 * CSS-variable theming engine (shared base for the theme store).
 *
 * A theme/color scheme is a set of `--*` overrides layered on the base tokens in
 * `app.css`; `applyTheme` swaps them on `:root` and sets the root font-size for
 * text-size. Selecting "default" removes all managed overrides, so switching is
 * reversible. Unknown ids fall back to default.
 */
import type { PersonalizeSettings, TextSize, FontChoice } from "./settings";
import { catalog } from "./themes/catalog";

export interface ThemePack {
  id: string;
  name: string;
  /** `--var` → value overrides (without the leading `--`). */
  vars: Record<string, string>;
}

export const THEMES: ThemePack[] = [
  { id: "default", name: "Default", vars: {} },
  {
    id: "dark",
    name: "Dark",
    vars: {
      "topbar-bg": "#2a2a2c",
      "statusbar-bg": "#2a2a2c",
      "workspace-bg": "#1e1e20",
      "row-line": "#333336",
      "panel-bg": "#262629",
      "panel-border": "#3a3a3d",
      "pill-bg": "#262629",
      fg: "#e7e7e8",
      "fg-soft": "#b5b5b8",
      "fg-muted": "#8a8a8e",
      "row-hover": "rgba(255,255,255,0.06)",
      "row-selected": "rgba(64,150,255,0.22)",
    },
  },
];

export const COLOR_SCHEMES: ThemePack[] = [
  { id: "default", name: "Default", vars: {} },
  { id: "ocean", name: "Ocean", vars: { "select-ring": "#0ea5e9" } },
  { id: "grape", name: "Grape", vars: { "select-ring": "#8b5cf6" } },
];

/** Root font-size per text-size step. */
export const TEXT_SIZE_PX: Record<TextSize, string> = {
  small: "13px",
  medium: "15px",
  large: "17px",
};

/** `--sans` stack per font choice. `system` mirrors app.css's default stack;
 *  `mono` reuses the monospace family; each is applied wholesale so switching
 *  back to `system` is just re-setting the default (no reset bookkeeping). */
export const FONT_STACKS: Record<FontChoice, string> = {
  system:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  sans: '"Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

const byId = (packs: ThemePack[], id: string): ThemePack =>
  packs.find((p) => p.id === id) ?? packs[0];

/**
 * Packs delivered over the network, keyed by theme id.
 *
 * Populated by `lib/themes/remote.svelte.ts` once a pack has been fetched
 * through the `theme_pack` IPC command — which is itself cache-first, so an
 * entry here came either from the on-disk cache or from a fresh download.
 * Registration is a one-way push *into* this module so that `theme.ts` (the
 * engine) stays free of any dependency on the delivery layer.
 *
 * Every pack in here has already passed the Rust-side SVG allowlist; nothing
 * unvetted reaches the renderer.
 */
const remotePacks = new Map<string, ThemePack>();

/** Make a downloaded/cached pack resolvable by {@link resolveThemePack}. */
export function registerRemoteThemePack(pack: ThemePack): void {
  remotePacks.set(pack.id, pack);
}

/** Whether `id` resolves without a network round trip (built-in or already fetched). */
export function themePackAvailable(id: string): boolean {
  return (
    THEMES.some((p) => p.id === id) ||
    catalog().some((c) => c.id === id) ||
    remotePacks.has(id)
  );
}

/** TEST-ONLY: forget every registered remote pack. */
export function __resetRemoteThemePacks(): void {
  remotePacks.clear();
}

/**
 * Resolve a theme id to its {@link ThemePack}, in the delivery order the
 * design fixes: **built-in → cache → download**.
 *
 * Built-in {@link THEMES} win, then the bundled purchasable {@link catalog}
 * (owned themes persist their catalog id in `PersonalizeSettings.theme`), then
 * anything delivered remotely and registered via
 * {@link registerRemoteThemePack}. A built-in therefore never depends on the
 * network, and a remote pack can never shadow one.
 *
 * Unknown ids fall back to default, so a stale/unowned id — or an owned theme
 * whose pack has not been fetched yet — degrades gracefully instead of
 * rendering nothing. Shared so store previews and the live `applyTheme` render
 * identical vars.
 */
export function resolveThemePack(id: string): ThemePack {
  return (
    THEMES.find((p) => p.id === id) ??
    catalog().find((c) => c.id === id)?.pack ??
    remotePacks.get(id) ??
    THEMES[0]
  );
}

/** Every CSS var any theme/color/catalog pack can touch — cleared before re-applying. */
function managedKeys(): string[] {
  const keys = new Set<string>();
  for (const p of [
    ...THEMES,
    ...COLOR_SCHEMES,
    ...catalog().map((c) => c.pack),
    // Remote packs set vars the built-ins never mention, so they have to be
    // cleared too — otherwise switching away from a downloaded theme would
    // leave its overrides stuck on `:root`.
    ...remotePacks.values(),
  ])
    for (const k of Object.keys(p.vars)) keys.add(k);
  return [...keys];
}

/**
 * Apply a personalize selection to `root` (defaults to `:root`). Pure aside
 * from the DOM writes; safe to call on every change for a live preview.
 */
export function applyTheme(
  p: PersonalizeSettings,
  root: HTMLElement = document.documentElement,
): void {
  // Reset everything any pack manages, then layer the selected theme + color.
  for (const k of managedKeys()) root.style.removeProperty(`--${k}`);
  // Resolve built-in themes and purchasable catalog packs through one lookup so
  // an owned store theme applies via the same engine as a built-in.
  const theme = resolveThemePack(p.theme);
  const color = byId(COLOR_SCHEMES, p.color);
  for (const [k, v] of Object.entries(theme.vars))
    root.style.setProperty(`--${k}`, v);
  for (const [k, v] of Object.entries(color.vars))
    root.style.setProperty(`--${k}`, v);
  root.style.fontSize = TEXT_SIZE_PX[p.textSize] ?? TEXT_SIZE_PX.medium;
  root.style.setProperty("--sans", FONT_STACKS[p.font] ?? FONT_STACKS.system);
}
