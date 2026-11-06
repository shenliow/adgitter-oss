/**
 * COPY-PASTE STARTING POINT for a new **Graph theme** (the commit-graph visual
 * skin — a SEPARATE system from the App/chrome theme; see `themeTemplate.ts`
 * for that one). A Graph theme swaps rendered ASSETS that `MetroGraph.svelte`
 * draws — the branch/lane colour palette, the HEAD icon, commit-node dots,
 * the rail (edge) artwork, and background/decoration layers — instead of
 * plain CSS colors.
 *
 * HOW TO USE THIS FILE:
 * 1. Start with just `lanes` + `background` (the "easy tier" below) — every
 *    other field is OPTIONAL. `MetroGraph` only swaps a rendering seam when
 *    the resolved pack actually sets that field, so an unset field silently
 *    falls back to the plain default look (same as `id: "default"` does).
 * 2. Copy this object, rename `id`/`name`, fill in your own colors.
 * 3. Register it in the list `graphThemes()` returns (`lib/graphTheme.ts`).
 *    Free built-in → omit `premium`/`priceUsd`. Paid store theme → set
 *    `premium: true` and a `priceUsd`.
 * 4. Want the full visual treatment (custom HEAD/commit-node icons, tiled
 *    rail artwork, sun/scanline decoration)? Don't reinvent it from scratch —
 *    read the `blueprint` and `synthwave` entries already in
 *    `lib/graphTheme.ts`. They're real, shipping examples of every advanced
 *    field this type supports; the commented-out block near the bottom of
 *    this file shows the SHAPE of those fields, but the two built-ins are the
 *    better reference for actually drawing something good.
 *
 * SVG ASSET RULES (if you go beyond `lanes`/`background`):
 * - Assets are tiny inline `data:image/svg+xml;utf8,...` URIs — no network
 *   fetch, no build step, no separate image files to ship.
 * - Any literal `#` inside the SVG markup MUST be percent-encoded as `%23`
 *   (a raw `#` would terminate the data URI at a URL-fragment boundary) —
 *   this includes `fill='%23...'` colors AND `url(%23gradientId)` references.
 * - Keep them small (the built-ins are ~150–260 characters) — simple
 *   geometric shapes, not detailed illustrations.
 * - The optional `svg` field (raw inner markup, no `<svg>` wrapper, using
 *   `fill="currentColor"`) lets an icon inherit the branch's lane colour at
 *   render time; `url` stays the fixed-colour fallback used for thumbnails.
 */
import type { GraphThemePack } from "../graphTheme";

export const GRAPH_THEME_TEMPLATE: GraphThemePack = {
  // Stable id — persisted in `PersonalizeSettings.graphTheme` and (for a paid
  // theme) recorded in the graph-theme store's ownership record. Must be
  // unique across every graph theme; never rename once shipped.
  id: "template",
  name: "Template",

  // Store-row metadata (all optional, free-text, rendered as-is).
  author: "Your Name",
  version: "1.0.0",
  description: "A short, honest description shown in the theme store.",
  date: "2026/08/04",

  // Omit both of these for a free built-in. For a paid store theme:
  // premium: true,
  // priceUsd: 1.99,

  // ---- Easy tier: recolor every branch lane + the graph background ----
  // 8 hex colors, cycled by a lane's `colorIndex` (any number of branches is
  // fine — the palette just repeats). A per-branch manual color override
  // (Settings → branch color picker) still wins over this.
  lanes: [
    "#5e81f4",
    "#f4a15e",
    "#5ef4a1",
    "#f45ee0",
    "#a15ef4",
    "#f4e05e",
    "#5ef4e0",
    "#f45e5e",
  ],
  // Any valid CSS `background` value — solid color, gradient, or a tiled
  // `url(...)` image.
  background: "#12141c",

  // Optional text styling for graph labels/commit text. A live Personalize
  // font/size override still wins; this is only this theme's own default.
  // text: { fontFamily: '"Segoe UI", system-ui, sans-serif', sizeScale: 1 },

  // Optional geometry. `spriteScale` multiplies every asset's drawn size;
  // `rowH`/`laneW` are the row and lane pitch in px (defaults 56 / 30). Two
  // separate knobs on purpose — art size and art spacing are separate calls.
  // A scale that would make nodes touch at the declared pitch is clamped down,
  // so raise the pitch alongside it (`hero` uses 2 / 84 / 60).
  // geometry: { spriteScale: 1, rowH: 56, laneW: 30 },

  // ---- Advanced tier (all optional — see `blueprint`/`synthwave` in
  // `lib/graphTheme.ts` for complete, working examples of each) ----
  //
  // head: { url: "data:image/svg+xml;utf8,<svg ...>...</svg>", width: 22, height: 20 },
  // node: {
  //   normal: { url: "data:image/svg+xml;utf8,<svg ...>...</svg>", width: 26, height: 26 },
  //   selected: { url: "data:image/svg+xml;utf8,<svg ...>...</svg>", width: 26, height: 26 },
  //   dropTarget: { url: "data:image/svg+xml;utf8,<svg ...>...</svg>", width: 30, height: 30 },
  // },
  // edges: {
  //   pattern: { url: "data:image/svg+xml;utf8,<svg ...>...</svg>", width: 8, height: 8 },
  //   vertical: { url: "data:image/svg+xml;utf8,<svg ...>...</svg>", width: 7, height: 8 },
  //   horizontal: { url: "data:image/svg+xml;utf8,<svg ...>...</svg>", width: 8, height: 7 },
  //   corner: { url: "data:image/svg+xml;utf8,<svg ...>...</svg>", width: 16, height: 16 },
  //   // OR, instead of custom tile art, keep the default stroked rails but
  //   // add a lane-tinted glow halo (what `synthwave` uses):
  //   // glow: { blur: 4, widthScale: 1.1 },
  // },
  // decorUnder: {
  //   background: "radial-gradient(circle at 50% 0%, rgba(94,129,244,0.15), transparent 60%)",
  //   sprites: [{ asset: { url: "data:image/svg+xml;utf8,...", width: 40, height: 40 }, x: 0.5, y: 0.04, opacity: 0.5 }],
  // },
  // decorOver: {
  //   background: "repeating-linear-gradient(0deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 3px)",
  // },
};
