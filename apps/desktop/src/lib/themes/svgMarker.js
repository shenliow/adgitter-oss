/**
 * Derive an edge tile's `GraphAsset` from its own `.svg` file, with the art's
 * branch-track marker STRIPPED.
 *
 * The hero theme's ten edge tiles ship as real `.svg` files under
 * `assets/hero/`. Each one is a pixel-art stone road drawn in earth tones, plus
 * a 1px stripe down its centre painted in one reserved marker colour (see
 * `MARKER_COLOR`) that the artist uses to mark where the branch track runs.
 * That stripe is NOT shipped: `GraphRails.svelte` draws the track as a
 * conventional stroked line over the road (`GraphThemePack.edges.trackWidth`),
 * which reads at any sprite scale, follows the lane colour without any
 * `currentColor` plumbing, and dims with `.ghost`/`.discarding` like every
 * other stroked mark. So the pipeline's job here is to drop the marked
 * elements and embed what remains.
 *
 * Stripping happens HERE, on the way into the build, rather than in the art:
 * the designer's source SVG and stays authored with the
 * marker, so a redrawn tile still states where its track runs and still ships
 * without it. The alternative — checking in already-stripped copies — would
 * make the shipped art a hand-edited fork of the design source, which is
 * exactly the drift this module exists to prevent.
 *
 * Plain `.js` with JSDoc types on purpose: `graphTheme.ts` imports it through
 * Vite (`checkJs` type-checks it like any other source file) and the
 * dependency-free `tools/gen-theme-manifest.mjs` generator imports the very
 * same file through Node's ESM loader. A `.ts` module could only serve the
 * first of those.
 *
 * What the derivation does, and deliberately does not do:
 *  - It removes every element PAINTED in the marker colour, and throws if the
 *    colour survives anywhere else (see `svgStripMarker`) — a redraw that puts
 *    the marker somewhere this rule cannot reach fails the build instead of
 *    shipping a red stripe to a paying customer.
 *  - It does NOT rewrite geometry or convert `style` declarations. The files
 *    under `assets/hero/` are already authored as sanitizer-clean presentation
 *    attributes (no `style`, no editor cruft), so the remaining markup is
 *    embedded verbatim. The designer's source is editor
 *    output and is NOT sanitizer-clean; normalising it is a step of importing
 *    the art, not something this module does at runtime.
 */

/** The single colour the hero edge art reserves for the branch track: the 1px
 *  stripe running along the centre of the stone road, authored as pure red.
 *  The road itself is earth tones (`#777349`, `#847254`, `#917951`, `#988259`,
 *  `#d0d04b`, `#74603f`, `#89785d`, `#85883b`, `#f1d232`, `#e6cd1b`) and must
 *  survive untouched — the stripe's elements sit ON TOP of the road body path,
 *  so dropping them exposes the road, never a hole.
 *
 *  The trailing-hex lookahead is load-bearing: the art contains `#f1d232` and
 *  `#e6cd1b`, and while neither starts with `f00`, a bare `/#f00/` would also
 *  match the leading half of any future `#f00xxx` — and this rule DELETES what
 *  it matches, so a sloppy match would silently drop a road pixel. Matching a
 *  three-digit shorthand safely means asserting the hex ENDS there. */
const MARKER_COLOR = /#f00(?![0-9a-f])/i;

/** One self-closing element (`<rect …/>`, `<path …/>`). Every marker element
 *  in the art is one of these — the road's own shading is too, so the pattern
 *  is not specific to the stripe; `MARKER_PAINT` is what selects. */
const SELF_CLOSING_ELEMENT = /<[a-z][^>]*\/>/gi;

/** An element painted in the marker colour: `fill` OR `stroke`, either one
 *  alone being enough. Matching the ATTRIBUTE rather than the bare colour is
 *  what makes "carries other attributes too" a non-issue — the whole element
 *  goes, whatever else it declares. */
const MARKER_PAINT = /\b(?:fill|stroke)\s*=\s*"\s*#f00(?![0-9a-f])\s*"/i;

const ROOT_TAG = /<svg\b[^>]*>/i;

/**
 * @param {string} tag a `<svg ...>` open tag
 * @param {string} name attribute name
 * @returns {string} the attribute's value
 */
function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`));
  if (!m) throw new Error(`svgMarker: <svg> has no "${name}" attribute`);
  return m[1];
}

/**
 * The drawn size an asset file declares, i.e. what belongs in
 * `GraphAsset.width`/`height`. Lane spacing and rail thickness are derived
 * from these, so the file is the single place they are stated.
 *
 * @param {string} source the full text of an `.svg` file
 * @returns {{ width: number, height: number }}
 */
export function svgRootSize(source) {
  const open = source.match(ROOT_TAG);
  if (!open) throw new Error("svgMarker: source has no <svg> root element");
  const width = Number(attr(open[0], "width"));
  const height = Number(attr(open[0], "height"));
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(
      "svgMarker: <svg> width/height must be plain numbers (not percentages)",
    );
  }
  return { width, height };
}

/**
 * The same markup with every marker-painted element removed.
 *
 * Throws if the marker colour survives the pass — which means the art used it
 * somewhere this rule cannot delete safely: on a container with children, in a
 * `style=` declaration, or as a gradient stop. Failing loudly is the point:
 * the alternative is a pure-red stripe reaching a customer, which looks like
 * broken art rather than like a bug.
 *
 * @param {string} markup SVG source (a whole document or a fragment)
 * @returns {string} the markup without its marker elements
 */
export function svgStripMarker(markup) {
  const stripped = markup.replace(SELF_CLOSING_ELEMENT, (el) =>
    MARKER_PAINT.test(el) ? "" : el,
  );
  if (MARKER_COLOR.test(stripped)) {
    throw new Error(
      "svgMarker: the marker colour survived stripping — it must only ever " +
        "appear as the fill/stroke of a self-closing element",
    );
  }
  return stripped;
}

/**
 * The `GraphAsset.url` for an asset file: the whole document as a
 * `data:image/svg+xml;utf8,` URI, marker elements dropped.
 *
 * `;utf8,` rather than base64: a fraction of the size, and the same form every
 * hand-written asset in `lib/graphTheme.ts` uses, so a reviewer can read what
 * ships. Only `%` and `#` have to be escaped — an unescaped `#` truncates the
 * URI at a fragment identifier, and `%` goes first so the escaping round-trips
 * through the percent-decode in `src-tauri/src/svg_sanitize.rs`.
 *
 * @param {string} source the full text of an `.svg` file
 * @returns {string} a `data:image/svg+xml;utf8,…` URI
 */
export function svgMarkerUrl(source) {
  const text = svgStripMarker(source.trim())
    .replace(/%/g, "%25")
    .replace(/#/g, "%23");
  return `data:image/svg+xml;utf8,${text}`;
}

/**
 * A complete `GraphAsset` for an edge tile — the road image and its drawn
 * size, both derived from the one file.
 *
 * No `svg` fragment: an edge tile is lane-agnostic road art now, so nothing
 * about it follows the branch colour and there is nothing to inline. (The
 * field still exists on `GraphAsset` — blueprint's and synthwave's node/head
 * sprites are tintable.)
 *
 * @param {string} source the full text of an `.svg` file
 * @returns {{ url: string, width: number, height: number }}
 */
export function svgEdgeAsset(source) {
  return { url: svgMarkerUrl(source), ...svgRootSize(source) };
}
