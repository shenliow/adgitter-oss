/**
 * Graph-theme registry.
 *
 * A SEPARATE system from `lib/theme.ts` (the CSS-variable engine): a graph
 * theme swaps rendered ASSETS (images/backgrounds) that `MetroGraph.svelte`
 * draws, rather than CSS vars. The shape/naming mirrors `theme.ts` (a
 * `*ThemePack[]` catalog + a `resolve*` lookup that falls back to default for
 * an unknown/stale id) so the two systems stay easy to reason about side by
 * side, even though they touch completely different rendering seams.
 *
 * Selecting `'default'` renders pixel-identical to pre-graph-theme MetroGraph:
 * every field is optional and MetroGraph only swaps a seam when the resolved
 * pack actually sets the corresponding field.
 */

import type { MessageKey } from "./i18n/messages";

import { pro } from "./pro";

/** A drawable asset: an image URL (tiny inline `data:image/svg+xml` URIs for
 *  built-ins) + its intrinsic size, so the renderer can position/size it
 *  without an extra image-decode round trip. */
export interface GraphAsset {
  url: string;
  /** Optional inline SVG *inner* markup (children only, no `<svg>` wrapper),
   *  drawn centred on (0,0), whose tintable parts use `currentColor`. When set,
   *  the graph renderer inlines this with `color` bound to the branch's lane
   *  colour so the icon follows its branch; `url` remains the fixed-colour image used for static
   *  thumbnails/previews and as the fallback. Unlike `url` (a data URI) this is
   *  raw markup, so `#` need NOT be percent-encoded. */
  svg?: string;
  width: number;
  height: number;
}

/** A decoration layer: an optional CSS background (colour/gradient/tiled
 *  url) plus positioned sprites. `x`/`y` are 0..1 fractions of the graph's
 *  rendered size (svgW × totalH in MetroGraph), so a sprite stays anchored
 *  to the same relative spot regardless of graph size. */
export interface GraphDecor {
  background?: string;
  sprites?: { asset: GraphAsset; x: number; y: number; opacity?: number }[];
}

export interface GraphThemePack {
  id: string;
  name: string;
  /** A paid ("purchased") theme rather than a built-in free one. Ownership is
   *  resolved by the graph-theme store (`lib/themes/graphStore`): a pack with a
   *  `priceUsd` is sold, one without is a free built-in that is always owned. */
  premium?: boolean;
  /** One-time price in USD, shown in the graph-theme store (mock pricing until
   *  Polar is provisioned). Presence marks the theme as purchasable; omit it
   *  for a free built-in (e.g. `default`), which is always owned. */
  priceUsd?: number;
  /** Text styling the theme prefers for graph labels/commit text.
   *  MetroGraph turns this block into
   *  `--graph-text*` custom properties on its scroller; every field is
   *  optional and each text rule falls back to the app's own colour/font, so a
   *  pack that omits the block renders exactly as it did before it existed.
   *
   *  Precedence differs per field, deliberately: `fontFamily` is only the
   *  theme's DEFAULT and yields to an explicit personalize font choice (a user
   *  who picked a font meant it everywhere), while `sizeScale` is a multiplier
   *  the theme applies on top of the graph's own base sizes — personalize's
   *  `textSize` drives the app root font-size and does not reach the graph's
   *  fixed-px label sizes at all, so the two never contend. */
  text?: {
    /** CSS font-family stack for graph text (falls back to the app font). */
    fontFamily?: string;
    /** Multiplier on the base graph text size (1 = unchanged). Clamped by
     *  MetroGraph to a range the fixed row/axis geometry can absorb. */
    sizeScale?: number;
    /** Primary graph text colour (subject, axis, HEAD's author). Set it when
     *  the theme's background is busy or light enough that the app's own
     *  foreground greys stop being readable over it. */
    color?: string;
    /** Secondary graph text colour (author email on non-HEAD rows). */
    colorMuted?: string;
    /** Colour of the outline drawn behind graph text so it stays legible over
     *  busy artwork — a halo rather than a plate, because a plate would hide
     *  the art the theme was bought for. Omit for no halo. */
    halo?: string;
  };
  /** Sprite size and row/lane pitch the theme draws at.
   *
   *  Two knobs rather than one factor, deliberately: `spriteScale` is how big
   *  the ART is, `rowH`/`laneW` are how far apart it is PLACED, and a pixel-art
   *  pack needs to move them independently (a 128px commit source wants to be
   *  drawn large; how much room that needs between rows is a separate
   *  judgement). `lib/graphDraw.ts`'s `resolveGraphGeometry` resolves the block
   *  — including the one inequality that does couple the two, namely that a
   *  node mark has to fit inside its own pitch — and a pack that omits the
   *  block resolves to exactly the app defaults.
   *
   *  Out-of-range values are clamped rather than ignored (see that function),
   *  so a remote pack authored against a different graph still renders. */
  geometry?: {
    /** Multiplies every `GraphAsset`'s drawn size, plus the default stroked
     *  node/rail/corner marks and the node hit areas sized from them. Does NOT
     *  apply to `decorUnder`/`decorOver` sprites — those position by 0..1
     *  fractions of the whole canvas, so they are scenery sized against the
     *  graph's box, not marks sized against its lane/row grid. */
    spriteScale?: number;
    /** Row pitch in px (the app default is 56). */
    rowH?: number;
    /** Lane pitch in px (the app default is 30). */
    laneW?: number;
  };
  /** Store-row display metadata. Free-text (rendered raw, like
   *  the theme name); optional so a bare theme still lists cleanly. */
  author?: string;
  version?: string;
  /** Raw, untranslated description. This is the ONLY option for a REMOTE pack:
   *  its text arrives over the network and cannot be in the catalog, so it is
   *  rendered verbatim in whatever language the pack author wrote it. */
  description?: string;
  /** Catalog key for the description of a BUILT-IN pack, whose text ships with
   *  the binary and therefore *can* be translated. Takes precedence over
   *  `description` in the store row; a remote pack simply never sets it, so the
   *  two coexist without either path needing to know about the other. The type
   *  is imported type-only — this module stays free of the i18n runtime, and
   *  the store row resolves the key with `t()` so it follows a locale switch. */
  descriptionKey?: MessageKey;
  /** Release/update date shown in the store row (raw display string). */
  date?: string;
  /** Ordered branch/lane palette (hex strings). Overrides the default
   *  `--lane-0..7` CSS variables for every lane while this theme is active,
   *  so a purchased theme can reskin branch colours. Indexed by a lane's
   *  `colorIndex` modulo the palette length, so any number of lanes is
   *  supported. A per-branch colour override still wins over this;
   *  omit the field to keep the default lane palette. */
  lanes?: string[];
  /** HEAD crown replacement. */
  head?: GraphAsset;
  /** Commit-node replacement per state; missing selected/dropTarget fall
   *  back to normal. */
  node?: { normal: GraphAsset; selected?: GraphAsset; dropTarget?: GraphAsset };
  /** CSS background for the graph surface. */
  background?: string;
  /** Scroll behaviour of `background` ONLY — `decorUnder`/`decorOver` are
   *  always drawn on content-sized layers and always scroll with the graph
   *  regardless of this flag (deliberate: a floating background with
   *  scrolling decoration gives a parallax effect, not a bug to "fix").
   *  `true` → the background stays pinned to the `.scroller` viewport while
   *  the graph scrolls underneath it (`background-attachment: scroll`).
   *  `false`/absent (default) → the background scrolls with the graph
   *  content (`background-attachment: local`). Explicit per-theme rather
   *  than an inherited browser default, so the one theme that actually needs
   *  pinning (art that doesn't tile vertically) states it, instead of every
   *  theme silently depending on an implicit CSS default. */
  float?: boolean;
  /** How `background` is SIZED and MOVED — the richer successor to `float`,
   *  and, like it, scoped to the `background` layer alone (`decorUnder`/
   *  `decorOver` are unaffected). Grouped under its own key rather than
   *  spread across three top-level fields so that scope is legible from the
   *  structure: a bare top-level `pixelated` would read as "this theme
   *  renders pixelated", which is false — hero's sprites are DOWNSCALED and
   *  need smoothing; only the upscaled background wants nearest-neighbour.
   *
   *  `float` is deliberately NOT replaced. The Rust mirror in
   *  the license server parses with `deny_unknown_fields`, so a
   *  renamed field would make an older client reject the whole downloaded
   *  pack — and a downloaded pack is cached, so old clients persist. This
   *  field simply wins where it is present; a pack that only sets `float`
   *  keeps rendering exactly as before. */
  backgroundFit?: {
    /** How the art is sized across the pane.
     *  - absent / `"natural"` (default): drawn at its intrinsic pixel size,
     *    which is what every pre-`backgroundFit` pack gets.
     *  - `"width"`: `background-size: 100% auto` — the art spans the pane's
     *    width and its height follows its own aspect ratio. Art narrower
     *    than the pane is therefore UPSCALED; see `pixelated`. */
    size?: "natural" | "width";
    /** How the background moves while the graph scrolls.
     *  - absent: falls back to `float` (`true` → `"pin"`, else `"content"`),
     *    so an old pack is unchanged.
     *  - `"content"`: scrolls with the graph (`background-attachment: local`).
     *  - `"pin"`: stays put in the pane (`background-attachment: scroll`).
     *  - `"strip"`: the art is a tall strip whose OWN height is mapped onto
     *    the graph's full scroll range — at the top of the graph the strip
     *    shows its top, and scrolling to the very bottom of the graph brings
     *    the strip's very bottom into view. CSS alone cannot express this, so
     *    `MetroGraph` drives it from a scroll listener; see `--graph-bg-y`
     *    there for the mapping and its degenerate cases. */
    scroll?: "content" | "pin" | "strip";
    /** `image-rendering: pixelated` on the background layer ONLY (the graph's
     *  sprites are explicitly reset back to smooth). Right for `size:
     *  "width"` art that is narrower than the pane: upscaling 592px-wide
     *  pixel art with the default smooth filter turns it to mush. Wrong for
     *  the sprites, which are drawn smaller than their source. */
    pixelated?: boolean;
  };
  /** Edge theming: `pattern` is the generic tile for runs; `vertical`/
   *  `horizontal` override it for their run type; `corner` is the legacy
   *  single-tile quarter-turn, authored for the "enters North, exits East"
   *  turn and rotated for the other three (absent corner → default stroked
   *  corner). Edge theming activates only when at least `pattern` or both
   *  run tiles exist.
   *
   *  The eight fields below are the full junction vocabulary a theme can
   *  supply instead of (or alongside) the legacy `corner`, one asset per
   *  direction-set — see `JunctionRole`/`junctionRole` below for the single
   *  table that maps a direction-set to its role name. `vertical`/
   *  `horizontal` above are this same vocabulary's "NS"/"EW" members (drawn
   *  as tiled patterns since a straight run spans an arbitrary distance —
   *  the eight below are always a single fixed-size image):
   *   - `fromLeft`/`fromRight`/`toLeft`/`toRight`: the four 2-way corners
   *     (N+W, N+E, S+W, S+E). When the theme supplies the specific role tile
   *     for a corner segment, the renderer draws it UNROTATED and does not
   *     consult `corner`/`rotate` at all; `corner` only fires as a fallback
   *     for a corner whose specific role tile is absent.
   *   - `forkLeft`/`forkRight`/`mergeLeft`/`mergeRight`: the four 3-way
   *     T-junctions (N+S+W, N+S+E twice each — see `JunctionRole`'s doc for
   *     why direction-set alone can't disambiguate fork from merge). These
   *     render at a `LaneJunction` point (`lib/graphDraw.ts`), which is
   *     ALWAYS exactly a commit node's position (see that module's doc) — a
   *     theme supplying these should expect its node sprite to cover most or
   *     all of the tile underneath it. */
  edges?: {
    pattern?: GraphAsset;
    vertical?: GraphAsset;
    horizontal?: GraphAsset;
    corner?: GraphAsset;
    fromLeft?: GraphAsset;
    fromRight?: GraphAsset;
    toLeft?: GraphAsset;
    toRight?: GraphAsset;
    forkLeft?: GraphAsset;
    forkRight?: GraphAsset;
    mergeLeft?: GraphAsset;
    mergeRight?: GraphAsset;
    /** Lane-tinted "glow" rails: keep the default per-branch stroked path (so
     *  rails follow their branch colour), but add a coloured drop-shadow halo
     *  and optionally widen the stroke. Mutually exclusive with the image tiles
     *  above (those are lane-agnostic); `glow` is how a theme stays neon while
     *  preserving branch identity. */
    glow?: { blur?: number; widthScale?: number };
    /** Width, in px, of the branch TRACK stroked over the tiles above — the
     *  lane-coloured line that says which branch a run of road belongs to.
     *  Omit (or 0) for tiles alone, which is right for a theme whose art
     *  already carries its own line (blueprint).
     *
     *  This is how a tiled theme keeps branch identity: the tiles themselves
     *  are lane-agnostic road art, and the track is drawn on top of them as an
     *  ordinary stroke — so it dims with `.ghost`/`.discarding`, follows a
     *  per-branch colour override, and needs no `currentColor` plumbing
     *  through a `<pattern>`.
     *
     *  NOT multiplied by `geometry.spriteScale`: this is a DRAWN width, in the
     *  same absolute-pixels currency as the casing rim and the select ring
     *  (see `GraphRails.svelte`'s note on the `+ N` offsets). `trackWidth: 3`
     *  is 3px on screen whatever the art is scaled to, so a theme author can
     *  predict it from this number alone — a scaled one would silently double
     *  when the pack changed its sprite scale. */
    trackWidth?: number;
  };
  /** Decoration between the background and the rails/nodes. */
  decorUnder?: GraphDecor;
  /** Decoration above every graph layer (non-interactive). */
  decorOver?: GraphDecor;
}

/** The free built-in: renders pixel-identical to pre-graph-theme MetroGraph. */
const DEFAULT_GRAPH_THEME: GraphThemePack = {
  id: "default",
  name: "Default",
  author: "ADGitter",
  version: "1.0.0",
  descriptionKey: "graphTheme.default.description",
  date: "2026/06/01",
};

/**
 * A free dark theme: palette and colours only, no art. Every build has it, so
 * there is always a theme besides the default to apply (tutorial step 22).
 */
const MIDNIGHT_GRAPH_THEME: GraphThemePack = {
  id: "midnight",
  name: "Midnight",
  author: "ADGitter",
  version: "1.0.0",
  descriptionKey: "graphTheme.midnight.description",
  date: "2026/11/06",
  background: "#111827",
  // Light text: the app's default greys are written for a light canvas.
  text: { color: "#e5e7eb", colorMuted: "#9ca3af" },
  // Soft, bright hues that stay distinct on navy and from each other.
  lanes: [
    "#60a5fa",
    "#f472b6",
    "#34d399",
    "#fbbf24",
    "#a78bfa",
    "#f87171",
    "#22d3ee",
    "#a3e635",
  ],
};

/**
 * Every graph theme this build ships: the free ones, plus the store's own when
 * the build has them (`lib/pro.ts`). A function rather than a constant so the
 * paid themes are read only once every module has loaded.
 */
export function graphThemes(): GraphThemePack[] {
  return [
    DEFAULT_GRAPH_THEME,
    MIDNIGHT_GRAPH_THEME,
    ...(pro?.graphThemes ?? []),
  ];
}

/**
 * Graph packs delivered over the network, keyed by id.
 * Mirrors `theme.ts`'s registry: `lib/themes/remote.svelte.ts` pushes a pack in
 * here once the cache-first `theme_pack` IPC command has produced it, so this
 * module needs no dependency on the delivery layer.
 *
 * Every asset in these packs has already passed the Rust SVG allowlist — which
 * is precisely what makes MetroGraph's `{@html asset.svg}` injection safe for
 * content that did not ship inside the binary.
 */
const remoteGraphPacks = new Map<string, GraphThemePack>();

/** Make a downloaded/cached graph pack resolvable by {@link resolveGraphThemePack}. */
export function registerRemoteGraphThemePack(pack: GraphThemePack): void {
  remoteGraphPacks.set(pack.id, pack);
}

/** Every graph theme that resolves right now — built-ins plus fetched packs. */
export function availableGraphThemes(): GraphThemePack[] {
  return [...graphThemes(), ...remoteGraphPacks.values()];
}

/** Whether `id` resolves without a network round trip. */
export function graphThemePackAvailable(id: string): boolean {
  return graphThemes().some((p) => p.id === id) || remoteGraphPacks.has(id);
}

/** TEST-ONLY: forget every registered remote graph pack. */
export function __resetRemoteGraphThemePacks(): void {
  remoteGraphPacks.clear();
}

/**
 * Resolve a graph-theme id to its {@link GraphThemePack}, in the delivery
 * order: **built-in → cache → download**. A built-in therefore never depends on
 * the network, and a remote pack can never shadow one.
 *
 * Unknown/stale ids (e.g. a theme removed in a later release, or one whose pack
 * has not been fetched yet) fall back to default, so a corrupt/old settings
 * file degrades gracefully — mirrors `theme.ts`'s `resolveThemePack`.
 */
export function resolveGraphThemePack(id: string): GraphThemePack {
  return (
    graphThemes().find((p) => p.id === id) ??
    remoteGraphPacks.get(id) ??
    DEFAULT_GRAPH_THEME
  );
}

// --- Lane colour + glow (shared by MetroGraph and the personalize preview) ---

/** The active theme's lane colour for `colorIndex` (its `lanes` palette, modulo
 *  length), or null when the theme ships no palette — the caller then falls back
 *  to {@link laneVar}. A negative index is wrapped, never out of range. */
export function themeLane(
  theme: GraphThemePack,
  colorIndex: number,
): string | null {
  const lanes = theme.lanes;
  if (!lanes || lanes.length === 0) return null;
  return lanes[((colorIndex % lanes.length) + lanes.length) % lanes.length];
}

/** The default `--lane-N` CSS variable for `colorIndex` (0..7, wrapped). */
export function laneVar(colorIndex: number): string {
  return `var(--lane-${((colorIndex % 8) + 8) % 8})`;
}

/** The background's vertical placement under `backgroundFit.scroll: "strip"`,
 *  as a CSS `background-position-y` PERCENTAGE: how far the graph is through
 *  its scroll range, and therefore how far the strip is through its own
 *  height. A percentage is used rather than a pixel offset so the browser
 *  does the `-(p * (bgH - paneH))` arithmetic itself, from the image's
 *  rendered height — which is what lets `MetroGraph`'s scroll listener stay
 *  free of any layout read.
 *
 *  Pure and exported so the mapping (including its degenerate cases) is
 *  testable without a laid-out pane; jsdom reports every dimension as 0.
 *
 *  @param scrollTop  the scroller's current `scrollTop`
 *  @param contentH   the graph content's full height
 *  @param paneH      the scroller's visible height
 */
export function backgroundStripOffset(
  scrollTop: number,
  contentH: number,
  paneH: number,
): string {
  const range = contentH - paneH;
  // Degenerate: content no taller than the pane, so there is no scroll range
  // to map onto. The strip stays at its top rather than dividing by zero.
  if (!(range > 0)) return "0%";
  // Clamp: macOS rubber-band overscroll reports a `scrollTop` outside the
  // range in both directions.
  const p = Math.min(1, Math.max(0, scrollTop / range));
  return `${p * 100}%`;
}

/** A CSS `drop-shadow` filter tinting a rail with `color`'s neon glow when the
 *  theme opts into glow rails (`edges.glow`), else undefined. */
export function railGlow(
  theme: GraphThemePack,
  color: string,
): string | undefined {
  const g = theme.edges?.glow;
  return g ? `drop-shadow(0 0 ${g.blur ?? 3}px ${color})` : undefined;
}

// --- Edge segment decomposition ---------------------------------------------
// Mirrors `MetroGraph.svelte`'s `edgePath` EXACTLY (same math), decomposed
// into typed segments a renderer can draw with pattern-filled rects +
// rotated corner images instead of a single stroked `<path>`.

/** The two endpoints + first-parent flag `MetroGraph.edgePath` starts from:
 *  `x1/y1` is the child's lane/row position, `x2/y2` the parent's. */
export interface EdgeGeometry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  isFirstParent: boolean;
  cornerRadius: number;
}

// --- Junction role vocabulary -------------------------------------------
// The full tile vocabulary a theme's `edges` can supply is ten roles, every
// one keyed by the direction-set of the roads meeting at that point:
//
//   2 straights   vertical N+S,   horizontal E+W    (tiled pattern)
//   4 corners     fromLeft N+W,   fromRight N+E,
//                 toLeft   S+W,   toRight  S+E       (single image)
//   4 T-junctions forkLeft N+S+W, forkRight N+S+E,
//                 mergeLeft N+S+W, mergeRight N+S+E  (single image)
//
// Fork and merge share a direction-set with their same-side corner-turned-T
// (N+S+W for fromLeft's fork/merge, N+S+E for fromRight's) because the
// direction-set alone only describes the TILE'S SHAPE — it can't distinguish
// "a branch forks away from a through-lane" from "a branch merges into a
// through-lane", which is a fact about git history (which edge is the
// child's own continuation vs. the other parent), not about geometry. That
// is why `junctionRole` below takes an explicit `JunctionSense` for the
// 3-way cases: the direction-set picks the shape (left vs. right T), the
// sense picks which of the two same-shaped tiles the artist drew for it.

/** A compass direction a rail can run in/out of a point. */
export type Dir = "N" | "S" | "E" | "W";

/** The eight direction-sets that occur in this graph's rail geometry (a
 *  lane never turns more than 90°, and a junction is at most 3-way), each
 *  written N/E/S/W-ordered so it is usable as a lookup key. */
export type DirSetKey = "NS" | "EW" | "NW" | "NE" | "SW" | "SE" | "NSW" | "NSE";

/** Disambiguates the two 3-way `DirSetKey`s (see the vocabulary comment
 *  above) — irrelevant for the six 2-way/straight keys. */
export type JunctionSense = "fork" | "merge";

/** Every `edges` field name a theme can supply for a rail tile, one per
 *  direction-set (the 3-way keys split into two by `JunctionSense`). */
export type JunctionRole =
  | "vertical"
  | "horizontal"
  | "fromLeft"
  | "fromRight"
  | "toLeft"
  | "toRight"
  | "forkLeft"
  | "forkRight"
  | "mergeLeft"
  | "mergeRight";

/** The single source of truth for "which asset draws this direction-set" —
 *  every reader (edge decomposition, the junction pass, the renderer) goes
 *  through `junctionRole` rather than re-deriving role names inline. `Record`
 *  over the full key sets makes an unhandled direction-set a compile error,
 *  not a silently-missing tile. */
const TWO_WAY_ROLE: Record<Exclude<DirSetKey, "NSW" | "NSE">, JunctionRole> = {
  NS: "vertical",
  EW: "horizontal",
  NW: "fromLeft",
  NE: "fromRight",
  SW: "toLeft",
  SE: "toRight",
};

const THREE_WAY_ROLE: Record<
  Extract<DirSetKey, "NSW" | "NSE">,
  Record<JunctionSense, JunctionRole>
> = {
  NSW: { fork: "forkLeft", merge: "mergeLeft" },
  NSE: { fork: "forkRight", merge: "mergeRight" },
};

/** Resolve a direction-set (+ sense, required only for the two 3-way keys)
 *  to the `edges` field name that draws it. Total over every `DirSetKey` —
 *  see `TWO_WAY_ROLE`/`THREE_WAY_ROLE`'s `Record` types. */
export function junctionRole(
  dirSet: DirSetKey,
  sense?: JunctionSense,
): JunctionRole {
  if (dirSet === "NSW" || dirSet === "NSE") {
    if (!sense) {
      throw new Error(`junctionRole: ${dirSet} requires a JunctionSense`);
    }
    return THREE_WAY_ROLE[dirSet][sense];
  }
  return TWO_WAY_ROLE[dirSet];
}

/** The 2-way corner's direction-set for one `edgeSegments` elbow, derived
 *  from the same `isFirstParent`/`sx` facts `edgePath` itself turns into a
 *  rotation (see `EdgeSegment`'s `corner` variant doc). */
function cornerDirSet(isFirstParent: boolean, sx: 1 | -1): DirSetKey {
  if (isFirstParent) return sx === 1 ? "NE" : "NW";
  return sx === 1 ? "SW" : "SE";
}

export type EdgeSegment =
  | { kind: "vertical"; x: number; y1: number; y2: number }
  | { kind: "horizontal"; y: number; x1: number; x2: number }
  | {
      kind: "corner";
      x: number;
      y: number;
      /** Degrees (clockwise, SVG `rotate()` convention) to spin the LEGACY
       *  canonical corner asset — one authored for the "enters from the
       *  North, exits to the East" turn (rotate: 0) — into place. The other
       *  three turns (NW/SW/SE) are pure 90°-multiple rotations of that same
       *  tile (no reflection needed): rotate 90 → SE, 180 → SW, 270 → NW.
       *  Only consulted when the theme has no specific role tile for
       *  `dirSet` (see `edges.corner`'s doc comment). */
      rotate: number;
      /** This corner's direction-set — feed to `junctionRole` (no `sense`
       *  needed; 2-way corners are unambiguous) to find the theme field that
       *  draws it unrotated. */
      dirSet: DirSetKey;
    };

/**
 * Decompose one rounded-orthogonal rail into its straight runs + corner,
 * exactly matching `edgePath`'s geometry (same `r` clamp, same V/H order per
 * `isFirstParent`, same corner direction per `sx`). A pure vertical edge
 * (`x1 === x2`) short-circuits to a single `vertical` segment, just like
 * `edgePath`'s `L` fast path.
 */
export function edgeSegments(g: EdgeGeometry): EdgeSegment[] {
  const { x1, y1, x2, y2, isFirstParent, cornerRadius } = g;
  if (x1 === x2) return [{ kind: "vertical", x: x1, y1, y2 }];

  const r = Math.min(
    cornerRadius,
    Math.abs(x2 - x1) / 2,
    Math.abs(y2 - y1) / 2,
  );
  const sx = x2 > x1 ? 1 : -1;

  if (isFirstParent) {
    // V (x1, y1 → y2-r) → corner (elbow at x1,y2) → H (x1+sx*r → x2, y2).
    return [
      { kind: "vertical", x: x1, y1, y2: y2 - r },
      {
        kind: "corner",
        x: x1,
        y: y2,
        rotate: sx === 1 ? 0 : 270,
        dirSet: cornerDirSet(isFirstParent, sx),
      },
      { kind: "horizontal", y: y2, x1: x1 + sx * r, x2 },
    ];
  }
  // H (x1 → x2-sx*r, y1) → corner (elbow at x2,y1) → V (x2, y1+r → y2).
  return [
    { kind: "horizontal", y: y1, x1, x2: x2 - sx * r },
    {
      kind: "corner",
      x: x2,
      y: y1,
      rotate: sx === 1 ? 180 : 90,
      dirSet: cornerDirSet(isFirstParent, sx),
    },
    { kind: "vertical", x: x2, y1: y1 + r, y2 },
  ];
}
