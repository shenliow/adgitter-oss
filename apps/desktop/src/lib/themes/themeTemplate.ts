/**
 * COPY-PASTE STARTING POINT for a new **App theme** (Theme Store — the CSS
 * chrome/color theme, NOT the graph theme; see `graphThemeTemplate.ts` for
 * that separate system).
 *
 * An App theme is nothing more than a set of `--*` CSS custom-property
 * overrides layered on the base tokens in `app.css`. `applyTheme()`
 * (`lib/theme.ts`) resets every var any registered pack touches, then writes
 * this pack's `vars` onto `:root`. You never need to write CSS yourself —
 * every value below is a plain color/shadow/font-stack string.
 *
 * HOW TO USE THIS FILE:
 * 1. Copy the object below, rename the `id`/`name`, and change whichever
 *    `vars` you want (leave the rest out — anything you omit falls back to
 *    `app.css`'s default).
 * 2. Register it:
 *    - **Free, built-in theme** → add it to the `THEMES` array in
 *      `lib/theme.ts`.
 *    - **Paid, store-sold theme** → wrap it in a `CatalogTheme` (add `id`,
 *      `name`, `priceUsd`) and add that to the list `catalog()` returns
 *      (`lib/themes/catalog.ts`).
 * 3. Registering it is what makes it show up AND makes its CSS vars get
 *    cleaned up correctly when the user switches away — `applyTheme()`
 *    computes "which vars to reset" from every pack currently in `THEMES` /
 *    `COLOR_SCHEMES` / `catalog()`, so an unregistered pack's vars would leak
 *    if you ever stopped applying it.
 * 4. Preview instantly: `SettingsModal.svelte`'s Personalize tab calls
 *    `applyTheme()` live as you pick a theme in the dropdown — no rebuild
 *    needed in dev mode.
 *
 * IMPORTANT GOTCHA: don't bother setting `--sans` here — `applyTheme()`
 * always overwrites `--sans` afterward based on the user's separate font
 * choice (`PersonalizeSettings.font`), so anything you put in `vars["sans"]`
 * is silently clobbered. `--mono` is NOT overwritten, so it's fair game if
 * your theme wants a distinctive monospace stack too.
 */
import type { ThemePack } from "../theme";

export const THEME_TEMPLATE: ThemePack = {
  // Stable id — this is what gets persisted in `PersonalizeSettings.theme`
  // and (for a paid theme) recorded in `entitlement.owned_themes`. Must be
  // unique across THEMES + every catalog entry; never rename it once shipped
  // (existing users' saved settings reference it by this string).
  id: "template",

  // Display name shown in the Personalize dropdown / Theme Store list.
  name: "Template",

  vars: {
    // ---- Chrome (top bar, status bar, the empty canvas behind the graph) ----
    "topbar-bg": "#1f2430",
    "statusbar-bg": "#1f2430",
    "workspace-bg": "#161a22",
    "row-line": "#2a3040",

    // ---- Surfaces (panels: Branches / Changed Files / Commit Details / Settings) ----
    "panel-bg": "#20242f",
    "panel-border": "#2e3444",
    // Any valid CSS `box-shadow` value.
    "panel-shadow": "0 8px 30px rgba(0, 0, 0, 0.35)",
    "pill-bg": "#20242f",
    "btn-bg": "#2a3040",
    "btn-bg-hover": "#343b4e",
    "btn-fg": "#e4e7ee",

    // ---- Text ----
    fg: "#e4e7ee",
    "fg-soft": "#aab0c2",
    "fg-muted": "#7d8399",
    "fg-subtle": "#565c70",

    // ---- Interaction (row hover/selection, focus ring) ----
    "row-hover": "rgba(255, 255, 255, 0.05)",
    "row-selected": "rgba(94, 129, 244, 0.24)",
    // Also drives the Personalize color-scheme accent unless the user's
    // separately-chosen color scheme (Ocean/Grape/Default) overrides it —
    // color scheme is applied AFTER the theme, so this is just this theme's
    // own default.
    "select-ring": "#5e81f4",

    // ---- Ad strip (free tier only; invisible once a user goes ad-free) ----
    "ad-bg": "#232838",
    "ad-fg": "#3a4152",

    // ---- Optional / rarely themed by an App theme (the commit-graph lane
    // palette is normally owned by the separate Graph theme system — see
    // `graphThemeTemplate.ts` — but nothing stops an App theme from also
    // recoloring the 8 lane vars if you want the two to ship as a matched
    // pair). Uncomment to use:
    // "lane-0": "#27ae60",
    // "lane-1": "#ec4f9c",
    // "lane-2": "#c46a1b",
    // "lane-3": "#7c6cf0",
    // "lane-4": "#3a86ff",
    // "lane-5": "#f2b134",
    // "lane-6": "#16a3a3",
    // "lane-7": "#e0533d",

    // Monospace stack (diffs, commit hashes). Optional — omit to keep the
    // app default (`ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`).
    // mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  },
};
