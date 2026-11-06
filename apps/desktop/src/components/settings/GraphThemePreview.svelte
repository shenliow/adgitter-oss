<!--
  Live graph-theme preview. Renders a little metro graph — HEAD crown,
  branch-name chips, a tag chip, commit nodes and rails — entirely from the
  passed pack's own assets, so it always matches what MetroGraph will draw: the
  theme's background/decor, its lane palette (branch colours), its tintable
  node/HEAD `svg` (currentColor bound to each lane colour) or image fallback,
  and glow-vs-plain rails.

  The LAYOUT (lane/row assignment) and the RAIL PATHS are computed by the same
  code the real graph uses — `assignLanes` (lib/lanes) and `edgePath`
  (lib/graphDraw) — run over a small synthetic commit DAG, so this preview is
  an honest sample of what MetroGraph draws rather than a hand-drawn
  look-alike. Only the pixel MAPPING (lane→x, row→y) is preview-specific: the
  pane is narrow (`.gtp { min-height: 320px }`) and MetroGraph's own row
  pitch (56px) would overflow/clip over this many commits, so `laneX`/`rowY`
  below are derived from the measured pane size instead — same idea as
  MetroGraph's own derivation, just scaled to fit here. The path CONSTRUCTION
  itself (`edgePath`) is shared and un-tweaked.

  The synthetic scenario (newest → oldest):
    M   (HEAD, main)  parents = [C3, F1]   — merge: feat rejoins main
    B1  (bug)         parents = [C3]        — forked from main, still open
    F1  (feat)        parents = [C2]        — forked from main
    C3  (main)        parents = [C2]
    C2  (main)        parents = [C1]
    C1  (main, v1.0)  parents = []          — tagged root
  which `assignLanes` lays out as three lanes: main = lane 0, feat = lane 1,
  bug = lane 2, with M→F1 emitted as a non-first-parent (merge) edge.
-->
<script lang="ts">
  import {
    themeLane,
    laneVar,
    railGlow,
    type GraphThemePack,
  } from '../../lib/graphTheme';
  import { assignLanes } from '../../lib/lanes';
  import { edgePath } from '../../lib/graphDraw';
  import type { Commit } from '../../lib/ipc';

  let { theme }: { theme: GraphThemePack } = $props();

  // Measured pane size → viewBox units are pixels (nodes stay ~26px and the
  // trunk extends to fill the height instead of scaling up).
  let w = $state(0);
  let h = $state(0);
  const vw = $derived(w || 180);
  const vh = $derived(h || 360);

  // --- Synthetic scenario: main / feat / bug, feat merged back into main ----
  function commit(sha: string, parents: string[]): Commit {
    return {
      sha,
      short_sha: sha,
      author_name: 'Preview',
      author_email: 'preview@example.com',
      timestamp: 0,
      subject: sha,
      body: '',
      parents,
    };
  }
  // Newest-first, as `commits` is ordered everywhere else in the app.
  const commits: Commit[] = [
    commit('M', ['C3', 'F1']), // HEAD, main — merges feat back in
    commit('B1', ['C3']), // bug — forked from main, still open
    commit('F1', ['C2']), // feat — forked from main
    commit('C3', ['C2']), // main
    commit('C2', ['C1']), // main
    commit('C1', []), // main, root — carries the v1.0 tag
  ];
  const HEAD_SHA = 'M';
  const layout = $derived(assignLanes(commits, HEAD_SHA));
  const rowBySha = new Map(commits.map((c, i) => [c.sha, i]));

  // --- Preview-scaled lane/row pixel mapping (shared edgePath draws from it) -
  // Clamped so three lanes always fit inside the measured pane width, even
  // when the settings panel is narrower than the default 180px fallback.
  const LANE_W = $derived(
    layout.maxLane > 0
      ? Math.min(40, Math.max(18, (vw - 40) / layout.maxLane))
      : 40,
  );
  const lane0X = $derived(vw - 30); // rightmost lane (main, HEAD) near the right edge
  const PAD_TOP_FRAC = 0.16; // row 0 (HEAD/main tip) at 16% of the pane height
  const ROW_FRAC = 0.12; // row pitch, as a fraction of the pane height
  function laneX(lane: number): number {
    return lane0X - lane * LANE_W;
  }
  function rowY(row: number): number {
    return vh * (PAD_TOP_FRAC + row * ROW_FRAC);
  }
  const crownY = $derived(rowY(0) - vh * 0.085);
  const NODE_GAP = 15; // node radius + a little → chips stop this far left

  // Shared with MetroGraph: theme palette lane colour (else default var), and
  // the lane-tinted glow filter.
  const laneColor = (i: number): string => themeLane(theme, i) ?? laneVar(i);
  const railWidth = $derived(4 * (theme.edges?.glow?.widthScale ?? 1));

  function colorIndexOf(sha: string): number {
    return layout.assignments.get(sha)?.colorIndex ?? 0;
  }
  function laneOf(sha: string): number {
    return layout.assignments.get(sha)?.lane ?? 0;
  }
</script>

<div
  class="gtp"
  style="background:{theme.background ?? 'var(--workspace-bg)'}"
  bind:clientWidth={w}
  bind:clientHeight={h}
>
  {#if theme.decorUnder}
    <div
      class="decor"
      style="background:{theme.decorUnder.background ?? 'none'}"
    >
      {#each theme.decorUnder.sprites ?? [] as s, si (si)}
        <img
          src={s.asset.url}
          alt=""
          style="left:{s.x * 100}%; top:{s.y * 100}%; width:{s.asset
            .width}px; height:{s.asset.height}px; opacity:{s.opacity ?? 1}"
        />
      {/each}
    </div>
  {/if}

  <svg class="gtp-svg" viewBox="0 0 {vw} {vh}" aria-hidden="true">
    <!-- Chips first (under rails + nodes so a node always sits on top). -->
    {@render chip(
      laneX(laneOf('M')) - NODE_GAP,
      rowY(rowBySha.get('M')!),
      'main',
      laneColor(colorIndexOf('M')),
      false,
    )}
    {@render chip(
      laneX(laneOf('F1')) - NODE_GAP,
      rowY(rowBySha.get('F1')!),
      'feat',
      laneColor(colorIndexOf('F1')),
      false,
    )}
    {@render chip(
      laneX(laneOf('B1')) - NODE_GAP,
      rowY(rowBySha.get('B1')!),
      'bug',
      laneColor(colorIndexOf('B1')),
      false,
    )}
    {@render chip(
      laneX(laneOf('C1')) - NODE_GAP,
      rowY(rowBySha.get('C1')!),
      'v1.0',
      laneColor(colorIndexOf('C1')),
      true,
    )}

    <!-- Rails, drawn by the same `edgePath` MetroGraph uses, over this pane's
         own (measured) lane/row pixel mapping. -->
    {#each layout.edges as e (e.childSha + '->' + e.parentSha)}
      <path
        d={edgePath(e, { laneX, rowY })}
        fill="none"
        stroke={laneColor(e.colorIndex)}
        stroke-width={railWidth}
        stroke-linecap="round"
        stroke-linejoin="round"
        style:filter={railGlow(theme, laneColor(e.colorIndex))}
      />
    {/each}

    <!-- Commit nodes (on top of the rails → rails visually connect into them). -->
    {#each commits as c (c.sha)}
      {@render node(
        laneX(laneOf(c.sha)),
        rowY(rowBySha.get(c.sha)!),
        colorIndexOf(c.sha),
      )}
    {/each}

    <!-- HEAD crown perched over the top main node. -->
    {@render crown(laneX(laneOf(HEAD_SHA)), crownY, colorIndexOf(HEAD_SHA))}
  </svg>

  {#if theme.decorOver}
    <div
      class="decor over"
      style="background:{theme.decorOver.background ?? 'none'}"
    >
      {#each theme.decorOver.sprites ?? [] as s, si (si)}
        <img
          src={s.asset.url}
          alt=""
          style="left:{s.x * 100}%; top:{s.y * 100}%; width:{s.asset
            .width}px; height:{s.asset.height}px; opacity:{s.opacity ?? 1}"
        />
      {/each}
    </div>
  {/if}
</div>

{#snippet node(x: number, y: number, ci: number)}
  {@const n = theme.node?.normal}
  {#if n?.svg}
    <g transform="translate({x},{y})" style:color={laneColor(ci)}
      >{@html n.svg}</g
    >
  {:else if n}
    <image
      href={n.url}
      x={x - n.width / 2}
      y={y - n.height / 2}
      width={n.width}
      height={n.height}
    />
  {:else}
    <circle cx={x} cy={y} r="7" fill="#fff" />
    <circle cx={x} cy={y} r="5.5" fill={laneColor(ci)} />
  {/if}
{/snippet}

{#snippet crown(x: number, y: number, ci: number)}
  {@const hd = theme.head}
  {#if hd?.svg}
    <g transform="translate({x},{y})" style:color={laneColor(ci)}
      >{@html hd.svg}</g
    >
  {:else if hd}
    <image
      href={hd.url}
      x={x - hd.width / 2}
      y={y - hd.height / 2}
      width={hd.width}
      height={hd.height}
    />
  {:else}
    <path
      transform="translate({x},{y})"
      d="M-9 6 L-9 -3 L-4 1 L0 -6 L4 1 L9 -3 L9 6 Z"
      fill={laneColor(ci)}
      stroke="#fff"
      stroke-width="1.4"
      stroke-linejoin="round"
    />
  {/if}
{/snippet}

<!-- A branch/tag chip whose RIGHT edge sits at `rightX`, vertically centred on
     `cy`. `rightX` is set a node-gap left of the node so the label never covers
     the commit. Tag chips get a pointed left edge. -->
{#snippet chip(
  rightX: number,
  cy: number,
  label: string,
  color: string,
  tag: boolean,
)}
  {@const cw = label.length * 6.2 + (tag ? 20 : 16)}
  {@const x = rightX - cw}
  {@const y = cy - 7.5}
  {#if tag}
    <path
      d="M{x + 7} {y} L{rightX} {y} L{rightX} {y + 15} L{x + 7} {y +
        15} L{x} {y + 7.5} Z"
      fill={color}
    />
  {:else}
    <rect {x} {y} width={cw} height="15" rx="7.5" fill={color} />
  {/if}
  <text
    x={x + (tag ? 12 : cw / 2)}
    y={y + 11}
    fill="#fff"
    font-size="9.5"
    font-weight="600"
    text-anchor={tag ? 'start' : 'middle'}>{label}</text
  >
{/snippet}

<style>
  .gtp {
    position: relative;
    width: 100%;
    flex: 1 1 auto;
    min-height: 320px;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid var(--panel-border);
  }
  .gtp-svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .decor {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .decor.over {
    z-index: 2;
  }
  .decor img {
    position: absolute;
    transform: translate(-50%, -50%);
  }
</style>
