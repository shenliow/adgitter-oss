<!--
  Layer 1 of MetroGraph's z-stack: the `<svg class="rails">` — every branch
  rail, corner and T-junction tile, every commit node, the HEAD "+" spur and
  the live merge-drag connector.

  Why the seam is here: this layer is the only part of the graph that draws in
  *graph space* (lane/row → x/y) with SVG, and it is self-contained in the
  z-stack — nothing above it (rows, chips, crown, marquee, tooltips) shares a
  single style rule or helper with it. So it crosses as one element of the
  stack, and everything that exists only to draw it — the run tiling
  (`runTiles` + a clipping nested `<svg>` viewport per run), the theme's
  edge/corner/junction tile lookups, the segment decomposition and the stroked
  fallbacks — comes with it rather than being passed in.

  What stays in MetroGraph: anything the *other* layers also need. The lane/row
  → x/y mapping (`edgeMapping`, which the lib's `edgePath`/`laneJunctions`
  already take as a unit), the lane palette (`laneColor`, which resolves
  per-branch colour overrides MetroGraph owns), the resolved theme pack, and
  the transient drag/selection state that tints a node. Those cross as props.

  Internal paint order is load-bearing and must not be reordered: edge tiles →
  junction tiles → branch track → HEAD "+" → nodes → merge-drag connector. See
  the comments at each step.
-->
<script lang="ts">
  import type { GraphLayout, LaneEdge } from '../lib/lanes';
  import {
    CORNER,
    edgePath,
    laneJunctions,
    type EdgeGeomMapping,
    type GraphGeometry,
    type LaneJunction,
  } from '../lib/graphDraw';
  import type { Commit } from '../lib/ipc';
  import {
    railGlow,
    edgeSegments,
    junctionRole,
    type EdgeGeometry,
    type EdgeSegment,
    type GraphAsset,
    type GraphThemePack,
  } from '../lib/graphTheme';

  /** The HEAD "+" (create-commit) affordance, or `null` when there is nothing
   *  to draw. Derived by MetroGraph because the "+" is HEAD state, and its
   *  Layer 4b hit-area has to land on exactly the same x/y. Exactly one of
   *  `stub` (HEAD already on row 0 — a short dashed tick straight above it)
   *  and `spur` (HEAD lower down — a path routed round the lane cluster) is
   *  ever set. */
  interface HeadPlus {
    /** Centre of the "+" glyph. */
    x: number;
    y: number;
    /** HEAD's own lane colour. */
    color: string;
    stub: { x: number; y1: number; y2: number } | null;
    spur: string | null;
  }

  let {
    svgW,
    totalH,
    gtheme,
    geom,
    layout,
    commits,
    edgeMapping,
    laneColor,
    ghostShas,
    discardShas,
    headSha,
    selectedSha,
    selection,
    dropHoverKey,
    mergeTargetSha,
    mergeDragGeom,
    headPlus,
  }: {
    /** Size of the rails canvas — MetroGraph owns it (the scroller width and
     *  the row count decide it) and the other layers measure against it. */
    svgW: number;
    totalH: number;
    /** The active graph theme pack. Every edge/corner/junction/node asset
     *  lookup below is a pure function of it, so they all live here. */
    gtheme: GraphThemePack;
    /** The active theme's resolved geometry (`resolveGraphGeometry`). Passed
     *  rather than re-resolved so this layer draws with byte-identical numbers
     *  to the ones MetroGraph positions its own layers on. `railW`/`nodeR`/
     *  `corner` arrive already multiplied by `spriteScale`; `spriteScale`
     *  itself is still needed because a `GraphAsset` states its own size. */
    geom: GraphGeometry;
    /** Lane assignment for the current commit list. Passed rather than
     *  recomputed: `assignLanes` is not cheap and MetroGraph needs it too. */
    layout: GraphLayout;
    commits: Commit[];
    /** lane/row → x/y in graph space, plus the corner radius — the same unit
     *  `edgePath`/`laneJunctions` take. Crosses as one object rather than two
     *  function props because it is already the lib's geometry seam, and
     *  because `laneX`/`rowY` close over MetroGraph's centring maths
     *  (`lane0X`, the scroller width) that the other layers position against
     *  too, so they cannot move to `lib/`. */
    edgeMapping: EdgeGeomMapping;
    /** colorIndex → CSS colour. A function, not a precomputed table: it
     *  resolves per-branch colour overrides that MetroGraph derives from
     *  `refs` + `branchColors`, and it is called with indices coming from
     *  edges, junctions AND nodes — handing over a map would mean enumerating
     *  them up here and rebuilding it on every override change, for no gain.
     *  Reads stay reactive across the boundary either way. */
    laneColor: (colorIndex: number) => string;
    /** Commits orphaned by a history rewrite (dimmed). */
    ghostShas: ReadonlySet<string>;
    /** Commits a hovered reset would drop (dimmed) — Layer 2 dims its text
     *  rows off the same set. */
    discardShas: ReadonlySet<string>;
    headSha: string | null;
    selectedSha: string | null;
    /** Read-only here — it arrives as MetroGraph's own (readonly) prop. */
    selection: ReadonlySet<string>;
    /** `dropHover?.key ?? null`. The raw key, not a parsed sha: the node's
     *  drop-target test stays the same `'commit:' + sha` comparison it always
     *  was, and MetroGraph's drag-state shape does not leak across. */
    dropHoverKey: string | null;
    /** `mergeDrag?.targetSha ?? null` — the other half of that same test. */
    mergeTargetSha: string | null;
    /** The live merge-drag connector's geometry, or null when no drag is up.
     *  Derived by MetroGraph because it needs live pointer coordinates. */
    mergeDragGeom: {
      path: string;
      color: string;
      arrowPoints: string;
    } | null;
    headPlus: HeadPlus | null;
  } = $props();

  // Thin aliases so the geometry reads the same here as it did inline.
  const laneX = (l: number) => edgeMapping.laneX(l);
  const rowY = (i: number) => edgeMapping.rowY(i);
  // Rail stroke / node radius, already scaled by the theme (see
  // `GraphGeometry`). Aliased to the names this file has always drawn with.
  //
  // The `+ N` offsets applied to them below do NOT scale, deliberately: the
  // casing rim (`RAIL_W + 2`), the node's white backing (`NODE_R + 3`), the
  // select ring and the drop-target ring are all fixed-weight outlines whose
  // job — separating one mark from another, and staying visible — is an
  // absolute number of pixels, not a proportion of the art. `RAIL_W + 2` at 2×
  // is still the same 1px-per-side rim it was designed as.
  const RAIL_W = $derived(geom.railW);
  const NODE_R = $derived(geom.nodeR);

  /** A sprite's drawn width/height at the theme's `spriteScale`. Every
   *  `GraphAsset` states the size it was AUTHORED at; the theme's scale is how
   *  big it is DRAWN. */
  const aw = (a: GraphAsset) => a.width * geom.spriteScale;
  const ah = (a: GraphAsset) => a.height * geom.spriteScale;
  /** ` scale(k)` to append to an inline fragment's own `<g transform>`.
   *
   *  A `GraphAsset.svg` fragment is a self-sizing fragment with its drawn size
   *  baked into its own markup (blueprint's and synthwave's node/head sprites
   *  are the ones that ship it), centred on the origin — so unlike the `url`
   *  arms, its size CANNOT be
   *  changed by handing it a different width/height, and it has to be scaled by
   *  the transform of the group it sits in. Scaling about the origin is exactly
   *  right given the fragment is centred there. Empty at 1×, so the markup an
   *  unscaled theme emits is byte-identical to before. */
  const fit = $derived(
    geom.spriteScale === 1 ? '' : ` scale(${geom.spriteScale})`,
  );

  // Edge theming activates only when there's a generic tile OR both run
  // tiles are supplied (see GraphThemePack.edges' doc comment); once active,
  // `vTile`/`hTile` resolve their run-specific override, falling back to the
  // generic `pattern` tile — guaranteed non-null whenever `edgeThemeActive`.
  const edgeThemeActive = $derived(
    !!gtheme.edges?.pattern ||
      !!(gtheme.edges?.vertical && gtheme.edges?.horizontal),
  );
  const vTile = $derived(
    gtheme.edges?.vertical ?? gtheme.edges?.pattern ?? null,
  );
  const hTile = $derived(
    gtheme.edges?.horizontal ?? gtheme.edges?.pattern ?? null,
  );
  const cornerTile = $derived(gtheme.edges?.corner ?? null);
  /** The theme's specific role tile for a 2-way corner segment, or null when
   *  the theme has none — in which case the caller falls back to the legacy
   *  `cornerTile` (rotated) or, failing that, the stroked corner. Takes the
   *  general `EdgeSegment` (not just the corner variant) so it can sit
   *  directly in the template's `{#if}` chain without a separate narrowing
   *  step; non-corner segments always resolve to null. */
  function roleCornerTile(seg: EdgeSegment) {
    if (seg.kind !== 'corner') return null;
    return gtheme.edges?.[junctionRole(seg.dirSet)] ?? null;
  }
  /** Whether the active theme supplies at least one T-junction tile — gates
   *  the (otherwise wasted) `laneJunctions` scan for every other theme, none
   *  of which currently ship any of the four. */
  const junctionThemeActive = $derived(
    !!(
      gtheme.edges?.forkLeft ||
      gtheme.edges?.forkRight ||
      gtheme.edges?.mergeLeft ||
      gtheme.edges?.mergeRight
    ),
  );
  /** Every 3-way T-junction in the current layout that the active theme has
   *  a tile for (most themes supply none — see `edges`' doc comment on
   *  `GraphThemePack` for why a T tile is expected to sit mostly under its
   *  node's sprite). */
  const junctions = $derived(
    junctionThemeActive ? laneJunctions(layout.edges, edgeMapping) : [],
  );
  function junctionTile(j: LaneJunction): GraphAsset | null {
    return gtheme.edges?.[j.role] ?? null;
  }
  /** Tile offsets, along a run's own axis, for a run `len` px long tiled with
   *  a `step`-px tile: `[0, step, 2*step, …]`, the last one overrunning the
   *  end.
   *
   *  The overrun is deliberate and is what makes the last tile a non-problem:
   *  the run is drawn inside a nested `<svg>` viewport exactly `len` long, and
   *  a nested viewport clips its content by default, so the final tile is cut
   *  at the run's end by the viewport rather than by any arithmetic here. A
   *  run is never a whole number of tiles (hero's pitch is `rowH: 84` against
   *  a 64px drawn tile), so there is ALWAYS a partial one.
   *
   *  `Math.max(1, …)` so a zero-length run — two commits on the same row,
   *  which the layout can produce transiently — still yields one (fully
   *  clipped, invisible) tile instead of an empty array that would make the
   *  `{#each}` key set churn. */
  function runTiles(len: number, step: number): number[] {
    const n = Math.max(1, Math.ceil(len / step));
    return Array.from({ length: n }, (_, i) => i * step);
  }
  /** Width of the lane-coloured branch track stroked OVER the road tiles, or 0
   *  when the theme wants tiles alone (blueprint: its art carries its own
   *  line). Deliberately NOT multiplied by `geom.spriteScale` — same
   *  absolute-pixel currency as the casing rim and the select ring above; see
   *  `GraphThemePack.edges.trackWidth`. */
  const trackW = $derived(gtheme.edges?.trackWidth ?? 0);
  // Lane-tinted glow rails (mutually exclusive with the image tiles above):
  // the default per-branch stroked path stays, plus a coloured drop-shadow
  // (shared `railGlow` helper). `edgeGlow` also drives the stroke widthScale.
  const edgeGlow = $derived(gtheme.edges?.glow ?? null);
  /** `edgeSegments`' geometry input for one lane edge — same lane/row → x/y
   *  mapping `edgePath` uses, so the decomposition matches it exactly. */
  function edgeGeom(e: LaneEdge): EdgeGeometry {
    return {
      x1: laneX(e.childLane),
      y1: rowY(e.childRow),
      x2: laneX(e.parentLane),
      y2: rowY(e.parentRow),
      isFirstParent: e.isFirstParent,
      // The mapping's own corner, not the module default: it follows the
      // theme's `spriteScale`, and a decomposition that disagreed with
      // `edgePath`'s radius would leave a gap between run and corner tile.
      cornerRadius: edgeMapping.corner ?? CORNER,
    };
  }

  /** The default (no corner asset) stroked quarter-turn — just the corner
   *  sub-path, reconstructed from the segment triple's own boundary points
   *  (the corner segment's x/y is exactly the Q control point `edgePath`
   *  uses), so it lines up pixel-for-pixel with the themed vertical/
   *  horizontal rects flanking it. Segs shorter than 3 (a pure-vertical
   *  edge) have no corner and return ''. */
  function defaultCornerPath(segs: EdgeSegment[]): string {
    if (segs.length < 3) return '';
    const [first, corner, last] = segs;
    if (corner.kind !== 'corner') return '';
    if (first.kind === 'vertical' && last.kind === 'horizontal') {
      return `M${first.x} ${first.y2} Q${corner.x} ${corner.y} ${last.x1} ${last.y}`;
    }
    if (first.kind === 'horizontal' && last.kind === 'vertical') {
      return `M${first.x2} ${first.y} Q${corner.x} ${corner.y} ${last.x} ${last.y1}`;
    }
    return '';
  }
</script>

<svg
  class="rails"
  width={svgW}
  height={totalH}
  viewBox="0 0 {svgW} {totalH}"
  aria-hidden="true"
>
  <g class="edges">
    {#if edgeThemeActive && vTile && hTile}
      <!-- No `<defs><pattern>` here any more, and that absence is the whole
           point of this branch. A `<pattern patternUnits="userSpaceOnUse">`
           with no `x`/`y`/`patternTransform` anchors its tile grid to the SVG
           ORIGIN, while the run it fills starts at an arbitrary lane x / row
           y. A run tile is exactly one rail thick across its width and its
           two outer edge columns are PARTLY TRANSPARENT by design (hero's
           irregular stone-path edge: 40.6% / 34.4% of the vertical tile's
           first and last columns). Whenever the grid's phase disagreed with
           the run's own edge — i.e. whenever `lane0X - railW/2` was not a
           multiple of the tile width, or `rowY(i) - railH/2` not a multiple
           of the tile height — those transparent columns landed INSIDE the
           rail and the background showed through as a seam straight down the
           middle of the road.

           The phase could not be fixed by arithmetic, either. All lanes share
           one x-phase only because `laneW` (60) happens to divide by the
           drawn tile width (20); `rowH` (84) is NOT a multiple of the drawn
           tile height (20), so two horizontal runs on different rows have
           different phases and no single pattern offset can serve both.

           So the runs are placed EXPLICITLY instead (see below): a nested
           `<svg>` viewport at the run's own rect, tiles laid from its local
           origin. Alignment is then a fact of the markup rather than a
           coincidence that has to keep holding. -->
      {#each layout.edges as e (e.childSha + '->' + e.parentSha)}
        {@const segs = edgeSegments(edgeGeom(e))}
        {@const isGhost =
          ghostShas.has(e.childSha) || ghostShas.has(e.parentSha)}
        {@const isDiscarding = discardShas.has(e.childSha)}
        {#each segs as seg, si (si)}
          {@const roleTile = roleCornerTile(seg)}
          {#if seg.kind === 'vertical'}
            <!-- The run's own viewport: `x`/`y`/`width`/`height` ARE the rail
                 rect the pattern-filled `<rect>` used to be, so the run keeps
                 exactly the position and thickness it always had. What
                 changes is that the tiles inside are placed in the viewport's
                 LOCAL coordinates, whose origin is the rail's top-left corner
                 — so the tile's edge columns can only ever land on the rail's
                 own edges. A nested `<svg>` clips to its viewport by default,
                 which is what cuts the last (always partial) tile at the end
                 of the run; nothing here can paint past it. -->
            {@const len = Math.abs(seg.y2 - seg.y1)}
            <svg
              class="edge-run"
              x={seg.x - aw(vTile) / 2}
              y={Math.min(seg.y1, seg.y2)}
              width={aw(vTile)}
              height={len}
              class:ghost={isGhost}
              class:discarding={isDiscarding}
            >
              {#each runTiles(len, ah(vTile)) as ty (ty)}
                <image
                  href={vTile.url}
                  x="0"
                  y={ty}
                  width={aw(vTile)}
                  height={ah(vTile)}
                />
              {/each}
            </svg>
          {:else if seg.kind === 'horizontal'}
            {@const len = Math.abs(seg.x2 - seg.x1)}
            <svg
              class="edge-run"
              x={Math.min(seg.x1, seg.x2)}
              y={seg.y - ah(hTile) / 2}
              width={len}
              height={ah(hTile)}
              class:ghost={isGhost}
              class:discarding={isDiscarding}
            >
              {#each runTiles(len, aw(hTile)) as tx (tx)}
                <image
                  href={hTile.url}
                  x={tx}
                  y="0"
                  width={aw(hTile)}
                  height={ah(hTile)}
                />
              {/each}
            </svg>
          {:else if roleTile}
            <!-- The theme supplies its own tile for this exact
                 direction-set (e.g. hero's `from-right.svg`, drawn as
                 authored): no rotation, unlike the legacy `cornerTile`
                 fallback below. Lane-agnostic road art like the runs — the
                 branch's colour is the track stroked over it below. -->
            <image
              class="edge-corner"
              href={roleTile.url}
              x={seg.x - aw(roleTile) / 2}
              y={seg.y - ah(roleTile) / 2}
              width={aw(roleTile)}
              height={ah(roleTile)}
              class:ghost={isGhost}
              class:discarding={isDiscarding}
            />
          {:else if cornerTile}
            <image
              class="edge-corner"
              href={cornerTile.url}
              x={seg.x - aw(cornerTile) / 2}
              y={seg.y - ah(cornerTile) / 2}
              width={aw(cornerTile)}
              height={ah(cornerTile)}
              transform="rotate({seg.rotate} {seg.x} {seg.y})"
              class:ghost={isGhost}
              class:discarding={isDiscarding}
            />
          {:else}
            <!-- No corner asset on this theme: same stroked-corner rim
                 as the default edgePath branch below, cast under this
                 corner's own coloured arc within this same segment
                 iteration (see the comment there for why order matters).
                 The flanking vertical/horizontal runs above are pattern-
                 tile <rect>s, not lane-coloured strokes, so they get no
                 casing — only this stroked corner needs one. Casing
                 colour: `gtheme.background` when the active theme sets
                 one, else the `--workspace-bg` custom property — see the
                 matching comment on the default rail below. -->
            <path
              d={defaultCornerPath(segs)}
              fill="none"
              stroke={gtheme.background ?? 'var(--workspace-bg)'}
              stroke-width={RAIL_W + 2}
              stroke-linecap="round"
              stroke-linejoin="round"
              class:ghost={isGhost}
              class:discarding={isDiscarding}
            />
            <path
              d={defaultCornerPath(segs)}
              fill="none"
              stroke={laneColor(e.colorIndex)}
              stroke-width={RAIL_W}
              stroke-linecap="round"
              stroke-linejoin="round"
              class:ghost={isGhost}
              class:discarding={isDiscarding}
            />
          {/if}
        {/each}
      {/each}
      <!-- 3-way T-junctions: drawn once per layout (not per-edge — a
           junction point is shared by the through-lane and the
           branching edge, so it must not be duplicated), and BEFORE
           `<g class="nodes">` below in document order, so a commit's
           node sprite naturally paints over the junction tile sitting
           at its own position — see `laneJunctions`' doc comment for
           why that position is always a node's. -->
      {#each junctions as j (j.lane + ',' + j.row)}
        {@const tile = junctionTile(j)}
        {#if tile}
          <image
            class="edge-junction"
            href={tile.url}
            x={j.x - aw(tile) / 2}
            y={j.y - ah(tile) / 2}
            width={aw(tile)}
            height={ah(tile)}
          />
        {/if}
      {/each}
      <!-- The branch TRACK, stroked over the road (`edges.trackWidth`).
           Every other mark in this branch is lane-agnostic artwork; this
           one line is what says which branch a stretch of road belongs to.
           It is drawn per EDGE (the whole `edgePath`, corner arc included),
           not per segment, so it turns a corner and crosses a junction tile
           as one continuous line instead of stopping at each tile's edge.

           Order: AFTER the junction tiles, so a junction's own artwork
           can't paint over the track running through it, and BEFORE
           `<g class="nodes">`, so a commit's sprite still covers the track
           where it sits — the same reason the junction tiles themselves
           sit here (see the comment above).

           No casing, unlike the stroked fallback below. A casing is a rim
           of BACKDROP colour, and its job — stopping two same-coloured
           rails fusing into one blob — is already done here by the road the
           track is drawn on: two tracks that touch are two roads apart.
           Painting the backdrop over the artwork would cut exactly the
           hole in the road this change exists to avoid.

           Glow still applies (`railGlow`), on the same rule as every other
           lane-coloured stroke in this file: a theme that asks for glow
           gets it on its rails, tiled or not. -->
      {#if trackW > 0}
        {#each layout.edges as e (e.childSha + '->' + e.parentSha)}
          <path
            class="edge-track"
            d={edgePath(e, edgeMapping)}
            fill="none"
            stroke={laneColor(e.colorIndex)}
            stroke-width={trackW}
            stroke-linecap="round"
            stroke-linejoin="round"
            style:filter={railGlow(gtheme, laneColor(e.colorIndex))}
            class:ghost={ghostShas.has(e.childSha) ||
              ghostShas.has(e.parentSha)}
            class:discarding={discardShas.has(e.childSha)}
          />
        {/each}
      {/if}
    {:else}
      {#each layout.edges as e (e.childSha + '->' + e.parentSha)}
        {@const isGhost =
          ghostShas.has(e.childSha) || ghostShas.has(e.parentSha)}
        {@const isDiscarding = discardShas.has(e.childSha)}
        {@const railW = RAIL_W * (edgeGlow?.widthScale ?? 1)}
        <!-- Casing: the same path drawn first, 2px wider, in the graph
             canvas backdrop colour — a 1px rim on each side of the rail
             that comes right after it (metro-map "casing" technique).
             Two branches can share a lane colour once the palette wraps,
             so without this rim same-coloured rails that run parallel or
             cross merge into one blob. This casing MUST be emitted here,
             immediately before its own rail, inside this same per-edge
             iteration — hoisting every casing into its own pass before
             all the rails would stack every casing under every rail
             instead of directly under the one it's meant to separate,
             and nothing would be cut apart. Never glowed (railGlow stays
             on the coloured rail only): a glow around the casing would
             bleed across the gap it exists to create.

             Colour: `.scroller`'s actual backdrop is `gtheme.background`
             when the active theme sets one (inline `style:background`
             above overrides the CSS class for that seam — e.g. synthwave's
             purple gradient), and only falls back to the `--workspace-bg`
             custom property when the theme leaves it unset. A bare
             `var(--workspace-bg)` would be right for `default`/`blueprint`
             but paint a mismatched rim over a themed gradient, so mirror
             the same fallback here rather than hardcoding the CSS var. -->
        <path
          d={edgePath(e, edgeMapping)}
          fill="none"
          stroke={gtheme.background ?? 'var(--workspace-bg)'}
          stroke-width={railW + 2}
          stroke-linecap="round"
          stroke-linejoin="round"
          class:ghost={isGhost}
          class:discarding={isDiscarding}
        />
        <path
          d={edgePath(e, edgeMapping)}
          fill="none"
          stroke={laneColor(e.colorIndex)}
          stroke-width={railW}
          stroke-linecap="round"
          stroke-linejoin="round"
          style:filter={railGlow(gtheme, laneColor(e.colorIndex))}
          class:ghost={isGhost}
          class:discarding={isDiscarding}
        />
      {/each}
    {/if}
  </g>

  <!-- "create commit" affordance — always parked at the top of the graph
       (row-0 height), following HEAD's lane. Sits above the crown, which
       perches just over the HEAD node. Its position and connector come in
       pre-derived as `headPlus` (see the prop's doc comment): Layer 4b's
       clickable hit-area up in MetroGraph has to land on the same x/y, so
       MetroGraph stays the one place that decides where the "+" sits. -->
  {#snippet plusGlyph(cx: number, cy: number, color: string)}
    <circle {cx} {cy} r="11" fill="#fff" stroke={color} stroke-width="2.5" />
    <path
      d="M{cx - 5} {cy} h10 M{cx} {cy - 5} v10"
      stroke={color}
      stroke-width="2.5"
      stroke-linecap="round"
    />
  {/snippet}
  {#if headPlus}
    {#if headPlus.stub}
      <line
        x1={headPlus.stub.x}
        y1={headPlus.stub.y1}
        x2={headPlus.stub.x}
        y2={headPlus.stub.y2}
        stroke={headPlus.color}
        stroke-width="3"
        stroke-dasharray="3 5"
        stroke-linecap="round"
      />
    {:else if headPlus.spur}
      <!-- HEAD isn't at the top: grow a dimmed, dashed spur out of its
           right side, up to the "+" affordance parked at row 0. -->
      <path
        d={headPlus.spur}
        fill="none"
        stroke={headPlus.color}
        stroke-width={RAIL_W}
        stroke-linecap="round"
        stroke-dasharray="4 6"
        opacity="0.55"
      />
    {/if}
    {@render plusGlyph(headPlus.x, headPlus.y, headPlus.color)}
  {/if}

  <g class="nodes">
    {#each commits as c, i (c.sha)}
      {@const a = layout.assignments.get(c.sha)}
      {#if a}
        {@const isHead = c.sha === headSha}
        {@const isSel = c.sha === selectedSha || selection.has(c.sha)}
        {@const isDropTarget =
          dropHoverKey === 'commit:' + c.sha || mergeTargetSha === c.sha}
        {#if gtheme.node}
          {@const asset = isDropTarget
            ? (gtheme.node.dropTarget ?? gtheme.node.normal)
            : isSel
              ? (gtheme.node.selected ?? gtheme.node.normal)
              : gtheme.node.normal}
          {#if asset.svg}
            <!-- Tintable node: inline SVG whose currentColor follows the
                 branch's lane colour (so every branch keeps its colour). -->
            <g
              transform="translate({laneX(a.lane)},{rowY(i)}){fit}"
              style:color={laneColor(a.colorIndex)}
              class:ghost={c.ghost}
              class:discarding={discardShas.has(c.sha)}
            >
              {@html asset.svg}
              {#if c.ghost}
                <title>Orphaned by a history rewrite - removed after 48h</title>
              {/if}
            </g>
          {:else}
            <image
              href={asset.url}
              x={laneX(a.lane) - aw(asset) / 2}
              y={rowY(i) - ah(asset) / 2}
              width={aw(asset)}
              height={ah(asset)}
              class:ghost={c.ghost}
              class:discarding={discardShas.has(c.sha)}
            >
              {#if c.ghost}
                <title>Orphaned by a history rewrite - removed after 48h</title>
              {/if}
            </image>
          {/if}
          {#if isSel && !gtheme.node.selected}
            <!-- No dedicated selected asset: keep the select-ring stroke
                 visible around the (normal/dropTarget) image. -->
            <circle
              cx={laneX(a.lane)}
              cy={rowY(i)}
              r={Math.max(aw(asset), ah(asset)) / 2 + 3}
              fill="none"
              stroke="var(--select-ring)"
              stroke-width="3.5"
            />
          {/if}
          {#if isDropTarget}
            <!-- drop affordance ring for a HEAD-crown reset onto this commit -->
            <circle
              cx={laneX(a.lane)}
              cy={rowY(i)}
              r={Math.max(aw(asset), ah(asset)) / 2 + 7}
              fill="none"
              stroke="var(--select-ring)"
              stroke-width="2.5"
              stroke-dasharray="4 4"
            />
          {/if}
        {:else}
          <circle cx={laneX(a.lane)} cy={rowY(i)} r={NODE_R + 3} fill="#fff" />
          <circle
            class="node"
            cx={laneX(a.lane)}
            cy={rowY(i)}
            r={isDropTarget ? NODE_R + 4 : NODE_R}
            fill={laneColor(a.colorIndex)}
            stroke={isSel ? 'var(--select-ring)' : '#fff'}
            stroke-width={isSel ? 3.5 : 2.5}
            class:ghost={c.ghost}
            class:discarding={discardShas.has(c.sha)}
          >
            {#if c.ghost}
              <title>Orphaned by a history rewrite - removed after 48h</title>
            {/if}
          </circle>
          {#if isHead}
            <circle cx={laneX(a.lane)} cy={rowY(i)} r={4} fill="#fff" />
          {/if}
          {#if isDropTarget}
            <!-- drop affordance ring for a HEAD-crown reset onto this commit -->
            <circle
              cx={laneX(a.lane)}
              cy={rowY(i)}
              r={NODE_R + 7}
              fill="none"
              stroke="var(--select-ring)"
              stroke-width="2.5"
              stroke-dasharray="4 4"
            />
          {/if}
        {/if}
      {/if}
    {/each}
  </g>

  <!-- Live connector for the branch-head merge drag (see mergeDrag in the
       script): rails-styled — same width/caps/lane-color as the edges
       above, right-angle-with-rounded-corner path like the rails —
       running from the source head's affordance dot to either the live
       cursor or (once locked onto a drop target) that target's edge,
       with a solid arrowhead pointing along the final leg. Painted last
       so it draws over the nodes.

       Casing: same metro-map technique as every branch rail's casing
       above (the same path, 2px wider, in the graph canvas backdrop
       colour) — without it, a connector crossing same-coloured lanes
       visually fuses with them exactly like two rails would. Same
       `gtheme.background ?? 'var(--workspace-bg)'` fallback as the rails'
       own casing (the scroller's real backdrop when a purchased theme
       sets one inline, else the CSS var) — never hardcode a colour here,
       it must always match whatever's actually behind the connector. -->
  {#if mergeDragGeom}
    <path
      class="merge-drag-casing"
      d={mergeDragGeom.path}
      fill="none"
      stroke={gtheme.background ?? 'var(--workspace-bg)'}
      stroke-width={RAIL_W + 2}
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <path
      class="merge-drag-line"
      d={mergeDragGeom.path}
      fill="none"
      stroke={mergeDragGeom.color}
      stroke-width={RAIL_W}
      stroke-linecap="round"
      stroke-linejoin="round"
      style:filter={railGlow(gtheme, mergeDragGeom.color)}
    />
    <polygon points={mergeDragGeom.arrowPoints} fill={mergeDragGeom.color} />
  {/if}
</svg>

<style>
  /* Sits above MetroGraph's .row (z-index 0) so branch rails always paint
   * over the row separator lines / hover backgrounds beneath them.
   * pointer-events: none already lets clicks fall through to the row. */
  .rails {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 1;
    pointer-events: none;
  }

  /* The commit-node circle grows slightly while a HEAD-crown reset drag
   * hovers over it (see the `r` binding above). Harmless where the browser
   * doesn't support transitioning SVG geometry properties. */
  .node {
    transition: r 120ms ease;
  }

  /* Ghost commits: only reachable via an expiring backup ref (orphaned by a
     history rewrite). De-emphasized until the backup expires and they drop
     out of the graph entirely. Interactions stay enabled. `svg` covers a
     themed straight RUN (a nested viewport full of tiles — dimming the
     viewport dims every tile in it at once, which is why the tiles inside
     carry no class of their own), `image` the corner/junction/node sprites,
     and `g` the
     TINTABLE ones — a theme that ships `GraphAsset.svg` renders its node and
     corner sprites as an inlined `<g>` (see the `{@html}` arms), so without
     it a themed graph dimmed its rails and text but left every node sprite at
     full strength. The inlined markup carries no class of its own, so nothing
     compounds this opacity. MetroGraph keeps the matching `.subject.ghost`
     rule for the text row, which no element-qualified selector here can
     reach. */
  circle.ghost,
  path.ghost,
  image.ghost,
  svg.ghost,
  g.ghost {
    opacity: 0.4;
  }

  /* Reset preview: while a HEAD-crown drag hovers a legal reset target,
     everything that reset would drop off the current branch is de-emphasized
     the same way — a live answer to "what am I about to lose?". A separate
     class from `.ghost` on purpose: a commit can be both (an orphan that the
     reset would also drop), and `.subject.ghost`'s strike-through — "this is
     already gone" — must stay reserved for the real thing. Same opacity, so
     a commit that is both looks no different from either alone. */
  circle.discarding,
  path.discarding,
  image.discarding,
  svg.discarding,
  g.discarding {
    opacity: 0.4;
  }
</style>
