<script lang="ts">
  import { assignLanes } from '../lib/lanes';
  import {
    resolveGraphGeometry,
    NODE_R as BASE_NODE_R,
    type EdgeGeomMapping,
  } from '../lib/graphDraw';
  import GraphRails from './GraphRails.svelte';
  import { axisTime } from '../lib/format';
  import type { FontChoice } from '../lib/settings';
  import { pollNativeModifiers, type Commit, type RefList } from '../lib/ipc';
  import {
    resolveDrag,
    affordanceFor,
    resolveMergeDrop,
    modsOf,
    mergeMods,
    NO_MODS,
    type DragSource,
    type DropTarget,
    type DragOp,
    type Affordance,
    type MergeDrop,
    type Modifiers,
  } from '../lib/dragDispatch';
  import { discardedByReset } from '../lib/resetPreview';
  import { createEdgeAutoScroll } from '../lib/edgeAutoScroll';
  import Avatar from './Avatar.svelte';
  import { t } from '../lib/i18n/index.svelte';
  import {
    resolveGraphThemePack,
    themeLane,
    laneVar,
    backgroundStripOffset,
  } from '../lib/graphTheme';

  interface ClickMods {
    shift: boolean;
    meta: boolean;
    ctrl: boolean;
  }

  let {
    commits = [],
    refs = null,
    selectedSha = null,
    selection = new Set<string>(),
    selectedBranch = null,
    branchColors = {},
    scrollTarget = null,
    onSelect = () => {},
    onBranchSelect = () => {},
    onCommitMenu = () => {},
    onBranchMenu = () => {},
    onBranchActivate = () => {},
    onCommitActivate = () => {},
    onRemoteMenu = () => {},
    onRemoteCheckout = () => {},
    onGesture = () => {},
    onMarquee = () => {},
    onClearSelection = () => {},
    onCreateCommit = () => {},
    onBranchMerge = () => {},
    graphTheme = 'default',
    personalizeFont = 'system',
    interactive = true,
    handTool = false,
  }: {
    commits?: Commit[];
    refs?: RefList | null;
    /** The commit with the open details panel (ring highlight). */
    selectedSha?: string | null;
    /** Multi-select set of commit shas (gesture source highlight). */
    selection?: Set<string>;
    /** Name of the branch selected as a unit (Delete-remove source). */
    selectedBranch?: string | null;
    /** branch name → hex lane-color override. */
    branchColors?: Record<string, string>;
    /** Scroll the graph to this commit (a fresh object re-triggers). */
    scrollTarget?: { sha: string } | null;
    onSelect?: (c: Commit, mods: ClickMods) => void;
    /** Single-click a branch label → select it as a unit. */
    onBranchSelect?: (branch: { name: string; current: boolean }) => void;
    /** Right-click on a commit row → open a context menu at (x, y). */
    onCommitMenu?: (c: Commit, x: number, y: number) => void;
    /** Right-click on a branch label → open a branch context menu. */
    onBranchMenu?: (
      branch: { name: string; current: boolean },
      x: number,
      y: number,
    ) => void;
    /** Double-click a branch label → check it out. */
    onBranchActivate?: (branch: { name: string; current: boolean }) => void;
    /** Double-click a commit node → check out its newest pointing branch. */
    onCommitActivate?: (c: Commit) => void;
    /** Right-click on a remote chip → open its context menu at (x, y). */
    onRemoteMenu?: (name: string, x: number, y: number) => void;
    /** Double-click a remote chip → request the checkout-remote confirm dialog. */
    onRemoteCheckout?: (name: string) => void;
    /** A resolved drag gesture → route into the confirm/op flow. */
    onGesture?: (op: DragOp) => void;
    /** A marquee sweep: swept shas (screen order) + modifiers. `done` marks the
     * final drop; earlier calls stream the live box. The parent applies these
     * against a start-of-sweep snapshot (see `applyMarquee`). */
    onMarquee?: (range: string[], mods: ClickMods, done: boolean) => void;
    /** A plain click on empty space → clear the whole selection. */
    onClearSelection?: () => void;
    /** Click the HEAD "+" affordance → open the create-commit modal. */
    onCreateCommit?: () => void;
    /** Drag from one branch-head's affordance dot to another branch head →
     *  request a merge of the source branch into the target branch (pointer-
     *  based gesture, independent of the HTML5 drag-and-drop grammar above;
     *  the source need not be the current branch). */
    /** `sourceCandidates`/`targetCandidates` hold every local branch at that
     *  end of the drag when the pick was ambiguous (≥2), empty otherwise. */
    onBranchMerge?: (p: MergeDrop) => void;
    /** Graph-theme id (lib/graphTheme.ts) — swaps rendered graph assets
     *  (HEAD icon, node icons, background, rails, decor layers). Separate
     *  from the CSS-var theme in lib/theme.ts. */
    graphTheme?: string;
    /** The personalize font choice in effect, so the graph theme's own
     *  `text.fontFamily` can stand down when the user picked a font
     *  explicitly (anything but the `system` default). Passing nothing means
     *  "user hasn't chosen", which lets a theme's family through. */
    personalizeFont?: FontChoice;
    /** `false` while the app is in resolve mode (a paused merge/rebase
     *  conflict) — every pointer/drag/menu/keyboard entry point becomes a
     *  no-op and a full-surface overlay (`.graph-locked`) blocks the mouse,
     *  so no gesture can start a new graph operation until the conflict is
     *  resolved. */
    interactive?: boolean;
    /** Hand-tool (pan) mode toggle (keymap `switchHandTool`, default Space).
     *  While on, the cursor is a grab hand and a left-press-drag anywhere pans
     *  the graph — every other pointer interaction (select, node/branch drag,
     *  marquee) is suppressed so the whole surface is grabbable. */
    handTool?: boolean;
  } = $props();

  // The active graph theme (asset-swap seam). Resolved up here, ahead of the
  // geometry block, because the theme is what supplies the pitch/sprite scale
  // every number below is derived from.
  const gtheme = $derived(resolveGraphThemePack(graphTheme));

  // Geometry (metro/transit aesthetic: thick rails, big nodes).
  //
  // The pitch and the sprite scale come from the theme's optional `geometry`
  // block (`GraphThemePack.geometry`), resolved and bounds-checked by
  // `resolveGraphGeometry`. A theme that declares none resolves to the app
  // defaults, so ROW_H/LANE_W/NODE_R/CORNER hold exactly the numbers they were
  // hardcoded to before the block existed, and SPRITE_SCALE stays 1.
  const geom = $derived(resolveGraphGeometry(gtheme));
  const ROW_H = $derived(geom.rowH);
  const LANE_W = $derived(geom.laneW);
  // RAIL_W / NODE_R / CORNER live in lib/graphDraw and come through `geom`
  // already multiplied by SPRITE_SCALE: GraphRails draws with all three, and
  // NODE_R also sizes the hit areas/handles below — a doubled sprite whose hit
  // area stayed at the default radius would only be clickable near its middle.
  const NODE_R = $derived(geom.nodeR);
  const CORNER = $derived(geom.corner);
  const SPRITE_SCALE = $derived(geom.spriteScale);
  // Headroom for the HEAD crown + "create commit" affordance above row 0 — large
  // enough that they clear the floating toolbar (push/pull) at the top. NOT
  // scaled by SPRITE_SCALE: it is a fact about the app's own chrome, not about
  // the art (and at 2× the stack below still fits inside it).
  const PAD_TOP = 100;
  const PAD_BOTTOM = 56;
  const AXIS_W = 150;
  // Radius of the small "drag to merge" affordance dot that appears above a
  // branch-head node on hover (1/2 of the node's DEFAULT radius).
  //
  // Deliberately built from the unscaled `BASE_NODE_R`, not from `NODE_R`: the
  // dot is an APP AFFORDANCE, not theme art. It is the same category as the
  // "+" — whose `plusGlyph` draws a fixed `r="11"` at every scale and whose
  // `.new-commit` hit box is a fixed 26px — so a theme making the art bigger
  // must not make the app's own chrome bigger with it.
  const MERGE_HANDLE_R = BASE_NODE_R / 2;

  // --- Hit areas -------------------------------------------------------------
  // A hit area is the mark the user actually has to hit, so it tracks that
  // mark instead of a hardcoded px size. The split follows the rule this
  // codebase already settled on: a MARK scales with `spriteScale`, a rim or a
  // pointer-tolerance PAD does not — a pad is a fact about how precisely a
  // hand can aim a mouse, not about the art. So a hit area is
  // `<mark size> + <fixed pad>`. Chrome the theme cannot move (the "+", the
  // merge dot) needs none of this and keeps a flat CSS size.
  //
  // This rotted silently: before `geometry` existed the node mark was 24px
  // inside a 30px `.node-handle`, so the handle covered it. At hero's
  // `spriteScale: 2` the mark grew to 56px and the handle did not, ringing
  // every node with exposed `.row` — and `.row` carries the SAME drop key as
  // `.node-handle`, so crossing that ring cleared and refilled `dropHover`
  // twice per node.

  /** Total pointer-tolerance pad around the node mark, in px (half on each
   *  side). 6 is what `.node-handle` already carried: a 30px handle over a
   *  24px mark. Fixed, per the mark/pad rule above. */
  const HIT_PAD = 6;
  // The merge dot needs no such derivation: it is fixed-size app chrome (see
  // `MERGE_HANDLE_R`), so `.merge-handle`'s flat 26px in the CSS below is
  // already the grown 1.5x dot (12 * 1.5 = 18) plus its own 8px pad, at every
  // sprite scale.

  /** Diameter of the commit-node MARK, in px, exactly as `GraphRails` draws
   *  it: a theme that ships node art draws its `GraphAsset` at
   *  `width/height * SPRITE_SCALE`, and a theme that ships none gets the
   *  plain `2 * NODE_R` circle. Takes the LARGEST of the normal/selected/
   *  dropTarget variants, so a selected node stays as grabbable as a plain
   *  one (GraphRails swaps the asset per state; the handle cannot). */
  const NODE_D = $derived.by(() => {
    const n = gtheme.node;
    const art = [n?.normal, n?.selected, n?.dropTarget].reduce(
      (max, a) => (a ? Math.max(max, a.width, a.height) : max),
      0,
    );
    return Math.max(NODE_R * 2, art * SPRITE_SCALE);
  });
  /** The HEAD affordance stack above a node — the crown's gap over the node,
   *  the "+" parking offset above row 0 and the dashed tick between them — is
   *  art-sized, so it scales with the sprites instead of staying at the
   *  default's px offsets. At 2× an unscaled stack puts the (48px) crown
   *  straight over the "+" and pushes its lower edge inside the node sprite.
   *  The "+" GLYPH itself does not scale (see `plusGlyph` in GraphRails): it is
   *  app chrome with a fixed-size CSS hit-area button over it, which is also
   *  why `headSpurPath`'s "+11" meet point stays unscaled. */
  const CROWN_DY = $derived(13 * SPRITE_SCALE);
  const PLUS_DY = $derived(60 * SPRITE_SCALE);
  const STUB_Y1 = $derived(42 * SPRITE_SCALE);
  const STUB_Y2 = $derived(52 * SPRITE_SCALE);
  // Unified ref-label column (tag/branch chips), between the time axis and
  // the lane cluster — every commit's labels right-align to the same edge
  // (labelRightX below), which hugs the graph's leftmost lane. LABEL_COL_W
  // only reserves minimum room for the column when clamping lane0X.
  const LABEL_COL_W = 150;
  const LABEL_LANE_GAP = 30;
  // Rightward offset for the HEAD "+" spur when HEAD isn't on row 0 — routes
  // the connector through the empty margin beyond the lane cluster so it
  // never crosses another lane's rail (see plusX below).
  const HEAD_SPUR_DX = 34;

  /** Visible width of the scroller — used to centre the graph horizontally. */
  let scrollerW = $state(0);
  /** The scroll container, so the hand tool can pan it (scrollLeft/scrollTop). */
  let scrollerEl = $state<HTMLDivElement | null>(null);
  /** The return-to-top control appears only after moving beyond five commit rows. */
  let showBackToTop = $state(false);
  /** Live hand-tool pan drag: pointer origin + scroll offsets at press. */
  let pan = $state<{
    pointerId: number;
    x0: number;
    y0: number;
    left0: number;
    top0: number;
  } | null>(null);

  const headSha = $derived(refs?.head.target ?? null);
  const layout = $derived(assignLanes(commits, headSha));
  const clusterW = $derived(layout.maxLane * LANE_W);
  // Centre the node cluster in the viewport. Lane 0 — always HEAD's branch —
  // sits on the RIGHT of the cluster; other branches fan left. Clamp so the
  // cluster never slides under the axis + ref-label column on narrow /
  // many-lane graphs.
  const lane0X = $derived(
    Math.max(
      scrollerW / 2 + clusterW / 2,
      AXIS_W + LABEL_COL_W + LABEL_LANE_GAP + clusterW,
    ),
  );
  const svgW = $derived(Math.max(scrollerW, lane0X + HEAD_SPUR_DX + 30));
  const totalH = $derived(PAD_TOP + commits.length * ROW_H + PAD_BOTTOM);
  /** Right edge of the ref-label column — the same for every commit,
   *  regardless of which lane its own node sits in. Tracks the graph's
   *  leftmost lane (a fixed gap short of it) so the labels stay flush
   *  against the cluster even when it centres in a wide viewport; the lane0X
   *  clamp above guarantees this never dips below AXIS_W + LABEL_COL_W. */
  const labelRightX = $derived(lane0X - clusterW - LABEL_LANE_GAP);

  function laneX(l: number): number {
    return lane0X - l * LANE_W;
  }
  /** A row's chip strip scrolls horizontally when its refs are wider than the
   *  ref-label column (`.chips` max-width, so chips can never reach over the
   *  time axis). Park it at the node-side (right) end: the chip nearest the
   *  node — the one the connector stem grows from, usually the current branch
   *  — is what you want to see; the outer tags are one flick away. The strip
   *  is packed right (`margin-left: auto` on the first chip) rather than with
   *  `justify-content: flex-end`, whose start-edge overflow is unreachable by
   *  scrolling; that makes the overflow land on the end side, hence this pin.
   *  Args are unused dependencies: they re-run the attachment when the row's
   *  ref set or the column width changes. */
  const pinChipScrollEnd =
    (..._deps: unknown[]) =>
    (node: HTMLElement) => {
      node.scrollLeft = node.scrollWidth;
    };
  function rowY(i: number): number {
    return PAD_TOP + i * ROW_H + ROW_H / 2;
  }
  function laneColor(colorIndex: number): string {
    // Precedence: per-branch override → active graph theme's lane
    // palette → the default `--lane-N` CSS variable. A purchased graph theme
    // may ship its own ordered branch/lane palette via `GraphThemePack.lanes`
    // (shared `themeLane`/`laneVar` helpers, also used by the preview).
    return (
      colorOverride.get(colorIndex) ??
      themeLane(gtheme, colorIndex) ??
      laneVar(colorIndex)
    );
  }

  // Per-branch color overrides → colorIndex → hex. A branch's override recolors
  // the lane its tip sits on.
  const colorOverride = $derived.by(() => {
    const m = new Map<number, string>();
    if (!refs) return m;
    for (const b of refs.branches) {
      const hex = branchColors[b.name];
      if (!hex) continue;
      const ci = layout.assignments.get(b.target)?.colorIndex;
      if (ci != null) m.set(ci, hex);
    }
    return m;
  });

  const rowBySha = $derived(new Map(commits.map((c, i) => [c.sha, i])));
  // Commits orphaned by a history rewrite (still reachable only via an
  // expiring `refs/adgitter/backup` ref) — rendered de-emphasized until the
  // backup expires and they drop out of the graph entirely.
  const ghostShas = $derived(
    new Set(commits.filter((c) => c.ghost).map((c) => c.sha)),
  );
  const headRow = $derived(
    headSha != null ? (rowBySha.get(headSha) ?? null) : null,
  );
  // Now always 0 (rightmost) once assignLanes has HEAD's sha to remap
  // against — see the "HEAD lane is rightmost" tests in lanes.test.ts.
  const headLane = $derived(
    headSha != null ? (layout.assignments.get(headSha)?.lane ?? 0) : 0,
  );
  const headCommit = $derived(
    headSha != null ? (commits.find((c) => c.sha === headSha) ?? null) : null,
  );
  const headColor = $derived(
    laneColor(layout.assignments.get(headSha ?? '')?.colorIndex ?? 0),
  );

  // The "+" (new-commit) affordance always sits at row-0 height, at the top
  // of the graph. Its X position follows HEAD: aligned with HEAD's lane
  // (rightmost) when HEAD is already at row 0 (unchanged from before), or
  // offset into the empty margin beyond the lane cluster when HEAD sits on a
  // lower row — a dedicated vertical channel that can't cross another lane's
  // rail (see headSpurPath below).
  const plusY = $derived(rowY(0) - PLUS_DY);
  const plusX = $derived(
    headRow === 0 ? laneX(headLane) : lane0X + HEAD_SPUR_DX,
  );

  // laneX/rowY mapping passed to the shared `edgePath` (lib/graphDraw) so the
  // rail geometry it draws matches this component's own pitch exactly. Derived
  // rather than a plain object: all three members now follow the active theme's
  // geometry, and GraphRails decomposes its segments from this same `corner`.
  const edgeMapping = $derived<EdgeGeomMapping>({
    laneX,
    rowY,
    corner: CORNER,
  });

  // --- Graph theme (asset-swap) seams ---------------------------------------
  // `gtheme` itself is resolved up in the geometry block above, which needs it.

  /**
   * Bounds on `GraphThemePack.text.sizeScale`.
   *
   * The row geometry is fixed px, so an unbounded multiplier breaks it:
   *  - `.row` is ROW_H tall (56px unless the theme raises `geometry.rowH`,
   *    which only ever loosens this bound — `MIN_ROW_H` is the 30px floor) and
   *    the message column stacks a 13px subject over an 11px email at
   *    line-height 1.25 → 30px at scale 1, so 56 / 30 = 1.86 is where the text
   *    starts spilling out of its own row;
   *  - `.axis` is 150px wide with 24px of left padding → 126px of usable text
   *    width, and its longest label ("Yesterday 11:06", 15 characters, ≈0.5em
   *    average advance at 12px ≈ 90px) hits that at 126 / 90 = 1.4.
   * The axis is the tighter of the two, so 1.4 is the ceiling; past it the
   * timestamp runs under the lane rails.
   *
   * The floor is legibility rather than geometry: the 11px email is the
   * smallest text in the row and stops being readable over artwork below
   * ~8px, i.e. 8 / 11 = 0.72 → 0.75.
   */
  const MIN_TEXT_SCALE = 0.75;
  const MAX_TEXT_SCALE = 1.4;

  // --- Graph theme text styling --------------------------------------------
  // Each of these becomes a `--graph-text*` custom property on `.scroller`,
  // and stays `null` (i.e. the property is never set) when the theme is
  // silent — the CSS rules below carry today's colours/sizes as their var()
  // fallbacks, so an unthemed graph renders exactly as before.
  const textColor = $derived(gtheme.text?.color ?? null);
  const textColorMuted = $derived(gtheme.text?.colorMuted ?? null);
  const textHalo = $derived(gtheme.text?.halo ?? null);
  /** The theme's family, unless the user explicitly picked one — the
   *  personalize choice is a deliberate act and outranks a theme default. */
  const textFamily = $derived(
    personalizeFont === 'system' ? (gtheme.text?.fontFamily ?? null) : null,
  );
  /** The theme's `sizeScale` as a CSS number, clamped into the range above;
   *  `null` (no custom property at all) when the theme supplies nothing
   *  usable, so the rules fall back to their bare px sizes. */
  function clampTextScale(scale: number | undefined): string | null {
    if (scale == null || !Number.isFinite(scale)) return null;
    return String(Math.min(MAX_TEXT_SCALE, Math.max(MIN_TEXT_SCALE, scale)));
  }
  const textScale = $derived(clampTextScale(gtheme.text?.sizeScale));
  /** `ROW_H` as a `--graph-row-h` value for `.row`'s CSS height, or `null` (no
   *  custom property at all) when the theme declares no `rowH` — the rule's own
   *  56px fallback then carries the default, so an unthemed graph emits exactly
   *  the markup it always did. The HTML row layer MUST follow the same pitch
   *  `rowY` positions the SVG nodes on, or the two layers desynchronise. */
  const rowHVar = $derived(gtheme.geometry?.rowH == null ? null : `${ROW_H}px`);

  /** `.node-handle`'s size as a `--graph-node-hit` value: the node mark plus
   *  `HIT_PAD`. `null` (no custom property at all) when the theme declares
   *  neither a sprite scale nor node art — nothing can have moved the mark,
   *  so the rule's own 30px fallback carries the default and an unthemed
   *  graph emits exactly the markup it always did. Same contract `rowHVar`
   *  keeps for `.row`. */
  const nodeHitVar = $derived(
    gtheme.geometry?.spriteScale == null && gtheme.node == null
      ? null
      : `${NODE_D + HIT_PAD}px`,
  );

  // --- Themed background: sizing + scroll behaviour ------------------------
  // `gtheme.backgroundFit` is the richer successor to `gtheme.float`; see
  // `GraphThemePack.backgroundFit` for why `float` is kept alongside it
  // rather than replaced. Everything here is scoped to the `background`
  // layer — the decor layers are content-sized and always scroll.

  /** Resolved scroll behaviour: the new field wins, `float` is the fallback
   *  for a pack that predates it, and a pack with neither lands on
   *  `"content"` — the historical `background-attachment: local` default. */
  const bgScroll = $derived<'content' | 'pin' | 'strip'>(
    gtheme.backgroundFit?.scroll ?? (gtheme.float ? 'pin' : 'content'),
  );
  /** `"strip"` positions a percentage down the image's own overflow, which
   *  only resolves against the visible pane under `scroll`; `local` would
   *  make the positioning area the whole scrollable content. */
  const bgAttachment = $derived(
    gtheme.background ? (bgScroll === 'content' ? 'local' : 'scroll') : null,
  );
  /** `null` (no declaration at all) unless the theme asks to fit the width,
   *  so a theme that sets nothing emits exactly the markup it always did. */
  const bgSize = $derived(
    gtheme.background && gtheme.backgroundFit?.size === 'width'
      ? '100% auto'
      : null,
  );
  const bgStrip = $derived(!!gtheme.background && bgScroll === 'strip');
  /** Strip mode reads its vertical placement from `--graph-bg-y`, which the
   *  scroll listener below writes. Percentage background positioning does the
   *  `-(p * (bgH - paneH))` arithmetic natively, in the compositor, from
   *  dimensions the browser already knows — which is what keeps the listener
   *  free of any layout read. */
  const bgPositionY = $derived(bgStrip ? 'var(--graph-bg-y)' : null);
  const bgPixelated = $derived(
    !!gtheme.background && !!gtheme.backgroundFit?.pixelated,
  );

  /** Visible height of the scroller. Bound (not measured) precisely so the
   *  scroll listener never has to touch `clientHeight`/`getBoundingClientRect`,
   *  either of which would force a reflow on every scroll event. */
  let scrollerH = $state(0);

  /** The strip's placement for a given `scrollTop`; the mapping itself lives
   *  in `backgroundStripOffset` (pure, and unit-tested there, since jsdom
   *  reports every pane dimension as 0).
   *
   *  Two degenerate cases, both deliberate:
   *   - **No scroll range** (content no taller than the pane): nothing to
   *     map, so the strip stays at its top — see the helper.
   *   - **Art shorter than the pane** (no overflow to travel through): CSS
   *     percentage positioning then slides it down the pane's *spare* space
   *     instead, which keeps the same rule — top of graph shows it at the
   *     top, bottom of graph shows it at the bottom. Freezing it instead
   *     would need either a layout read per scroll or a declared art aspect
   *     ratio in the manifest; neither is worth it for a case that needs a
   *     pane roughly 3x taller than it is wide. */
  function stripOffset(scrollTop: number): string {
    return backgroundStripOffset(scrollTop, totalH, scrollerH);
  }

  /** `.scroller`'s scroll listener — a HOT path. It writes one custom
   *  property and does nothing else: no layout read (`totalH` and
   *  `scrollerH` are already in hand), no Svelte state write (which would
   *  re-run every `$derived` in this component on every scroll tick). */
  function onScrollerScroll(e: Event): void {
    const el = e.currentTarget as HTMLElement;
    // This state flips only as the threshold is crossed, rather than causing
    // a component update on every scroll tick.
    const visible = el.scrollTop > ROW_H * 5;
    if (visible !== showBackToTop) showBackToTop = visible;
    if (!bgStrip) return;
    el.style.setProperty('--graph-bg-y', stripOffset(el.scrollTop));
  }

  function backToTop(): void {
    scrollerEl?.scrollTo({ top: 0, behavior: scrollBehavior() });
  }

  // Re-place the strip when something other than scrolling moves the
  // mapping: the pane resizing, the graph growing/shrinking, or the theme
  // switching into or out of strip mode. Not the hot path.
  $effect(() => {
    const el = scrollerEl;
    if (!el) return;
    // `stripOffset` reads `totalH`/`scrollerH`, which is what subscribes this
    // effect to them — no explicit dependency list needed.
    if (!bgStrip) el.style.removeProperty('--graph-bg-y');
    else el.style.setProperty('--graph-bg-y', stripOffset(el.scrollTop));
  });

  // "Right then up" metro-style spur connecting the HEAD commit (wherever it
  // sits) to the "+" affordance parked at the top of the graph. Only drawn
  // when HEAD isn't already at row 0. Grows out of the node's right side so
  // it never overlaps HEAD's own rail.
  function headSpurPath(): string {
    const x1 = laneX(headLane) + NODE_R + 4;
    const y1 = rowY(headRow ?? 0);
    const x2 = plusX;
    const y2 = plusY + 11; // meet the "+" circle's bottom edge, not its centre
    const r = Math.min(CORNER, Math.abs(x2 - x1) / 2, Math.abs(y1 - y2) / 2);
    return `M${x1} ${y1} H${x2 - r} Q${x2} ${y1} ${x2} ${y1 - r} V${y2}`;
  }
  /** The "+" affordance as `GraphRails` draws it, or null when there's nothing
   *  to draw (no HEAD, and not on row 0). Derived here rather than inside the
   *  rails layer because the "+" is HEAD state and Layer 4b's clickable
   *  hit-area below has to sit on exactly the same `plusX`/`plusY`. Exactly
   *  one of `stub` (HEAD already at row 0 — a short dashed tick straight above
   *  it) and `spur` (HEAD lower down — the routed path above) is ever set. */
  const headPlus = $derived.by(() => {
    if (headRow === 0)
      return {
        x: plusX,
        y: plusY,
        color: headColor,
        stub: {
          x: laneX(headLane),
          y1: rowY(headRow) - STUB_Y1,
          y2: rowY(headRow) - STUB_Y2,
        },
        spur: null,
      };
    if (headSha && headRow !== null)
      return {
        x: plusX,
        y: plusY,
        color: headColor,
        stub: null,
        spur: headSpurPath(),
      };
    return null;
  });

  // --- Ref chips, keyed by commit row ---------------------------------------
  interface Chip {
    label: string;
    kind: 'branch' | 'remote' | 'tag' | 'head';
    colorIndex: number;
    current: boolean;
    /** Final CSS background — per-name override, else a palette slot
     *  de-collided against the other chips of the same commit. */
    color: string;
  }

  function chipsFor(rl: RefList | null): Map<string, Chip[]> {
    const map = new Map<string, Chip[]>();
    if (!rl) return map;
    const push = (sha: string, chip: Chip) => {
      const arr = map.get(sha) ?? [];
      arr.push(chip);
      map.set(sha, arr);
    };
    const colorOf = (sha: string) =>
      layout.assignments.get(sha)?.colorIndex ?? 0;

    if (rl.head.detached && rl.head.target) {
      push(rl.head.target, {
        label: 'HEAD',
        kind: 'head',
        colorIndex: colorOf(rl.head.target),
        current: true,
        color: '',
      });
    }
    for (const b of rl.branches)
      push(b.target, {
        label: b.name,
        kind: 'branch',
        colorIndex: colorOf(b.target),
        current: b.name === rl.head.branch,
        color: '',
      });
    for (const r of rl.remotes)
      push(r.target, {
        label: r.name,
        kind: 'remote',
        colorIndex: colorOf(r.target),
        current: false,
        color: '',
      });
    for (const t of rl.tags)
      push(t.target, {
        label: t.name,
        kind: 'tag',
        colorIndex: colorOf(t.target),
        current: false,
        color: '',
      });
    // Tags first (left), then branches, so branch tips sit nearest the node.
    for (const arr of map.values())
      arr.sort((a, b) => Number(a.kind !== 'tag') - Number(b.kind !== 'tag'));

    // Resolve each chip's background. A branch's explicit color override
    // applies to THAT name only — never to same-lane siblings (which is why
    // chips bypass laneColor()/colorOverride here; the lane rail still
    // follows the override). Everything else takes its lane's palette slot,
    // then de-collides: chips of one commit overlap visually, so no two may
    // share a color — a colliding default bumps to the next free slot.
    const palette = (i: number) => themeLane(gtheme, i) ?? laneVar(i);
    for (const arr of map.values()) {
      const seen = new Set<string>();
      for (const chip of arr) {
        const override =
          chip.kind === 'branch' ? branchColors[chip.label] : undefined;
        let color = override ?? palette(chip.colorIndex);
        if (!override) {
          for (let bump = 1; seen.has(color) && bump < 8; bump++)
            color = palette(chip.colorIndex + bump);
        }
        chip.color = color;
        seen.add(color);
      }
    }
    return map;
  }
  const chips = $derived(chipsFor(refs));

  /** Local branch names pointing at `sha`, in chip display order — feeds
   *  `DropTarget.branches` so a Shift-drag onto this commit defaults to the
   *  first one instead of the bare sha. */
  function branchesAt(sha: string): string[] {
    return (chips.get(sha) ?? [])
      .filter((c): c is Chip & { kind: 'branch' } => c.kind === 'branch')
      .map((c) => c.label);
  }

  // --- Drag gestures ------------------------------------
  // The grammar lives in lib/dragDispatch.resolveDrag. We hold the live drag
  // source here, compute the resolved op on dragover to (a) decide whether the
  // drop is legal and (b) paint the target affordance, then dispatch on drop.
  let dragSource = $state<DragSource | null>(null);
  let dropHover = $state<{
    key: string;
    affordance: Affordance;
    /** Set when hovering a commit whose Shift-drag rebase op defaulted to its
     *  first local branch — highlights that branch's chip like a selected
     *  label, matching the "enlarged" commit-node drop-target feel. */
    branchLabel?: string;
  } | null>(null);
  /** Live tooltip that follows the cursor while dragging the HEAD crown,
   *  naming the reset mode the current modifiers resolve to. */
  let dragTip = $state<{ x: number; y: number; text: string } | null>(null);

  /** Drop key the pointer is currently inside, and how many ELEMENTS bearing
   *  that key it is inside at once (`.row` plus the `.node-handle` over it is
   *  the common pair). Plain locals, not `$state`: nothing renders from them,
   *  they only let `leaveTarget` tell a boundary between two elements of one
   *  target apart from a real departure. Reset by `endDrag`, and self-healing
   *  besides — an element removed mid-drag never fires its `dragleave`, but
   *  the next `dragenter` under a different key starts the count over. */
  let hoverKey: string | null = null;
  let hoverDepth = 0;

  // --- Live reset preview (HEAD-crown drag) ---------------------------------
  // While the crown hovers a legal reset target, every commit the reset would
  // drop off the current branch is de-emphasized, so the consequence is
  // visible BEFORE the drop. `dropHover` only ever holds a target
  // `resolveDrag` accepted, and it changes on enter/leave rather than on every
  // `dragover`, so deriving from it costs one walk per target.
  const NO_SHAS: ReadonlySet<string> = new Set();

  /** The commit a drop on the currently-hovered target would reset HEAD to,
   *  or null when this isn't a crown drag over a reset target. A branch chip
   *  resolves through its tip, so hovering a label previews exactly what
   *  hovering that branch's commit would (`resolveDrag` accepts both). */
  const resetPreviewSha = $derived.by(() => {
    if (dragSource?.kind !== 'head' || !dropHover) return null;
    const { key } = dropHover;
    if (key.startsWith('commit:')) return key.slice('commit:'.length);
    if (key.startsWith('branch:')) {
      const name = key.slice('branch:'.length);
      return refs?.branches.find((b) => b.name === name)?.target ?? null;
    }
    return null;
  });

  /** Commits the hovered reset would discard. Deliberately a SEPARATE set
   *  from `ghostShas`: that one is a data fact (orphaned by a past rewrite,
   *  alive only on a backup ref) while this is a hypothetical about a drop
   *  that hasn't happened. They render as two classes, so a commit that is
   *  both keeps the rewrite ghost's strike-through — merging them into one
   *  set would let a transient hover impersonate a real orphan (and, worse,
   *  erase the distinction again when the drag ends). */
  const discardShas = $derived(
    resetPreviewSha
      ? discardedByReset(commits, headSha, resetPreviewSha)
      : NO_SHAS,
  );

  // --- Branch-head → branch-head merge gesture -------------
  // A pointer-based gesture (NOT the HTML5 DnD grammar above): hovering a
  // branch-head node reveals a small affordance dot above it; pressing that
  // dot and dragging paints a rails-styled line following the cursor, and
  // dropping it on another branch head requests a merge of the source branch
  // into the target branch. Pointer-based (rather than reusing dragSource/
  // dropHover) because it needs live cursor coordinates for the connector
  // line, and its own hit-testing independent of the HTML5 dragover targets.
  /** Sha of the branch-head node currently hovered — shows its affordance dot.
   *  Cleared on pointerleave; stays lit for the drag's source node via
   *  `mergeDrag?.sourceSha` below even after the pointer leaves the handle. */
  let hoveredHeadSha = $state<string | null>(null);

  /** True when a pointer(enter/leave) event's `relatedTarget` (the element
   *  the pointer is moving from/to) sits inside an element matching
   *  `selector`. The affordance dot overlaps `.node-handle`'s own hit area
   *  (it's perched right on the node's top edge) — without this check,
   *  crossing from one to the other would fire a leave on whichever one the
   *  pointer is vacating, clearing `hoveredHeadSha` and unmounting the dot
   *  out from under the cursor before it can be pressed. */
  function relatedInside(e: PointerEvent, selector: string): boolean {
    const el = e.relatedTarget as Element | null;
    return !!el?.closest?.(selector);
  }

  /** No `sourceBranch` here on purpose: the connector and the lit affordance
   *  dot are drawn from `sourceSha` alone, so the drag never has to name a
   *  branch. Both endpoints are resolved once at drop time, which keeps the
   *  preview from ever disagreeing with what gets submitted. */
  let mergeDrag = $state<{
    sourceSha: string;
    pointer: { x: number; y: number };
    targetSha: string | null;
  } | null>(null);

  /** Nearest branch-head node (within a generous hit radius) under a point,
   *  excluding `excludeSha` (the drag's own source) — used to find the merge
   *  drop target as the cursor moves. */
  function headAtPoint(
    x: number,
    y: number,
    excludeSha: string,
  ): string | null {
    const hitR = NODE_R + 8;
    for (let i = 0; i < commits.length; i++) {
      const c = commits[i];
      if (c.sha === excludeSha) continue;
      if (branchesAt(c.sha).length === 0) continue;
      const a = layout.assignments.get(c.sha);
      if (!a) continue;
      const dx = x - laneX(a.lane);
      const dy = y - rowY(i);
      if (dx * dx + dy * dy <= hitR * hitR) return c.sha;
    }
    return null;
  }

  /** Re-point the live merge drag at a viewport position: moves the connector
   *  and re-runs the drop hit-test. Split out from `mergeDragMove` so the edge
   *  auto-scroll loop can call it per frame — the pointer can be stationary
   *  while the content scrolls under it, which changes the content-local point
   *  even though no pointer event fires. */
  function mergeDragPointTo(clientX: number, clientY: number) {
    if (!mergeDrag) return;
    const p = localXY(clientX, clientY);
    mergeDrag = {
      ...mergeDrag,
      pointer: p,
      targetSha: headAtPoint(p.x, p.y, mergeDrag.sourceSha),
    };
  }

  function mergeDragMove(e: PointerEvent) {
    if (!mergeDrag) return;
    mergeDragPointTo(e.clientX, e.clientY);
    // The merge drag gets edge scrolling too: it is a drag toward a branch
    // head, and that head is just as likely to be off-screen. It is a POINTER
    // gesture, not an HTML5 drag, so it feeds the same loop from pointermove
    // and tears it down in endMergeDragListeners below.
    autoScroll.update(scrollerEl, e.clientX, e.clientY);
  }

  function endMergeDragListeners() {
    autoScroll.stop();
    window.removeEventListener('pointermove', mergeDragMove);
    window.removeEventListener('pointerup', mergeDragEnd);
    window.removeEventListener('pointercancel', mergeDragCancel);
  }

  function mergeDragEnd() {
    if (!mergeDrag) return;
    const { sourceSha, targetSha } = mergeDrag;
    endMergeDragListeners();
    mergeDrag = null;
    if (!targetSha) return; // dropped on empty space / a non-head commit
    // Either end can carry several branches, and picking by chip display
    // order would be arbitrary at both — hand the candidate lists up and let
    // the confirm gate ask for whichever side is actually ambiguous.
    const drop = resolveMergeDrop(branchesAt(sourceSha), branchesAt(targetSha));
    if (!drop) return;
    onBranchMerge(drop);
  }

  function mergeDragCancel() {
    endMergeDragListeners();
    mergeDrag = null;
  }

  /** Press the affordance dot above a branch-head node → start the merge
   *  drag. Stops propagation so it can't also start the `.node-handle`'s
   *  HTML5 drag or the `.content` marquee sweep underneath it. */
  function startMergeDrag(e: PointerEvent, sha: string) {
    if (!interactive) return;
    if (branchesAt(sha).length === 0) return;
    e.stopPropagation();
    e.preventDefault();
    mergeDrag = {
      sourceSha: sha,
      pointer: localPoint(e),
      targetSha: null,
    };
    window.addEventListener('pointermove', mergeDragMove);
    window.addEventListener('pointerup', mergeDragEnd);
    window.addEventListener('pointercancel', mergeDragCancel);
  }

  /** Same right-angle-with-one-rounded-corner style as `edgePath`'s
   *  NON-first-parent case (horizontal leg, rounded corner, vertical leg) —
   *  horizontal first, toward whichever side the endpoint is on, then down
   *  into it. Deliberately the opposite decomposition from the first-parent
   *  branch: a merge drag reads as "this becomes a merge edge", and that's
   *  exactly how `edgePath` draws a second-parent (merge) rail, so reusing
   *  its H-then-V idiom here keeps the live connector visually consistent
   *  with how a completed merge edge would actually be drawn — and, just as
   *  important, an H-then-V route never runs down the length of the source's
   *  OWN lane the way a V-then-H route would, so it doesn't read as "just
   *  another branch rail" fused with the real one (see the casing below for
   *  the other half of that fix). Falls back to a straight line when the
   *  endpoints share a y (no vertical leg to round into). */
  function railElbowPath(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): string {
    const dx = x2 - x1,
      dy = y2 - y1;
    if (Math.abs(dy) < 0.5) return `M${x1} ${y1} L${x2} ${y2}`;
    const r = Math.min(CORNER, Math.abs(dx) / 2, Math.abs(dy) / 2);
    const sx = Math.sign(dx) || 1,
      sy = Math.sign(dy) || 1;
    return `M${x1} ${y1} H${x2 - sx * r} Q${x2} ${y1} ${x2} ${y1 + sy * r} V${y2}`;
  }

  /** Rails-styled connector for the live merge drag: source node's top edge
   *  (where the affordance dot sits) to either the live cursor position, or —
   *  once the drag is hovering a valid drop target (`mergeDrag.targetSha`) —
   *  locked onto that target node's edge, approaching from whichever side is
   *  closer so the arrowhead lands flush against the target's rim instead of
   *  its center. Colored like the source node's own lane rail; also yields
   *  the solid-triangle arrowhead polygon pointing along the connector's
   *  final leg (no SVG marker — `context-stroke` support is unreliable in
   *  WKWebView). */
  const mergeDragGeom = $derived.by(() => {
    if (!mergeDrag) return null;
    const a = layout.assignments.get(mergeDrag.sourceSha);
    const row = rowBySha.get(mergeDrag.sourceSha);
    if (!a || row == null) return null;
    const x1 = laneX(a.lane);
    const y1 = rowY(row) - NODE_R;
    const color = laneColor(a.colorIndex);

    const target = mergeDrag.targetSha;
    const targetAssignment = target
      ? layout.assignments.get(target)
      : undefined;
    const targetRow = target ? rowBySha.get(target) : undefined;

    let ex: number;
    let ey: number;
    let axis: 'h' | 'v';
    let sign: 1 | -1;

    if (target && targetAssignment && targetRow != null) {
      // Locked onto a drop target — approach from the source's side so the
      // arrow tip sits just outside the target node's rim.
      const tx = laneX(targetAssignment.lane);
      const ty = rowY(targetRow);
      if (Math.abs(tx - x1) < 0.5) {
        axis = 'v';
        sign = ty >= y1 ? 1 : -1;
        ex = tx;
        ey = ty - sign * (NODE_R + 4);
      } else {
        axis = 'h';
        sign = tx > x1 ? 1 : -1;
        ex = tx - sign * (NODE_R + 4);
        ey = ty;
      }
    } else {
      // No lock — follow the live cursor.
      ex = mergeDrag.pointer.x;
      ey = mergeDrag.pointer.y;
      if (Math.abs(ex - x1) < 0.5) {
        axis = 'v';
        sign = ey >= y1 ? 1 : -1;
      } else {
        axis = 'h';
        sign = ex > x1 ? 1 : -1;
      }
    }

    // (ex, ey) is the arrow TIP. The connector line must stop at the arrow's
    // BASE — otherwise the line runs the full length of the triangle and the
    // two visually fuse. So the rail path ends at the base point; the triangle
    // then spans base → tip, meeting the line flush at its base.
    const ARROW_LEN = 12;
    // Scaled with the sprites: the arrowhead terminates a rail of width
    // `geom.railW`, and at 2× an unscaled 12px-wide head vanishes inside a
    // 14px stroke.
    const ARROW_HALF_W = 6 * SPRITE_SCALE;
    let lineEndX = ex;
    let lineEndY = ey;
    let arrowPoints: string;
    if (axis === 'h') {
      const bx = ex - sign * ARROW_LEN;
      lineEndX = bx;
      arrowPoints = `${ex},${ey} ${bx},${ey - ARROW_HALF_W} ${bx},${ey + ARROW_HALF_W}`;
    } else {
      const by = ey - sign * ARROW_LEN;
      lineEndY = by;
      arrowPoints = `${ex},${ey} ${ex - ARROW_HALF_W},${by} ${ex + ARROW_HALF_W},${by}`;
    }

    const path = railElbowPath(x1, y1, lineEndX, lineEndY);

    return { path, color, arrowPoints };
  });

  // Belt-and-braces: if the component is torn down mid-drag, don't leave
  // window listeners registered against a destroyed component.
  $effect(() => {
    return () => endMergeDragListeners();
  });

  /** Commits carried by a commit-node drag: the multi-selection (if the
   * grabbed node is part of it), else just that node — always oldest-first so
   * cherry-pick replays in history order. `branch` is `selectedBranch` iff the
   * grabbed node is part of the current selection AND a branch is selected as
   * a unit — i.e. branch mode is still intact (any selection edit clears
   * `selectedBranch` in the parent, so this can't go stale). Grabbing a node
   * outside the current selection always starts a fresh individual-mode drag,
   * even mid-branch-selection. */
  function dragShas(sha: string): { shas: string[]; branch: string | null } {
    const inSelection = selection.has(sha);
    const set = inSelection && selection.size > 1 ? selection : new Set([sha]);
    const shas = commits
      .filter((c) => set.has(c.sha))
      .map((c) => c.sha)
      .reverse();
    return { shas, branch: inSelection ? selectedBranch : null };
  }

  function startDrag(e: DragEvent, src: DragSource) {
    if (!interactive) return;
    dragSource = src;
    if (e.dataTransfer) {
      // 'all' (not 'move'): macOS can request a drag operation incompatible
      // with 'move' while Shift/Cmd is held (our gesture grammar requires
      // exactly those modifiers for hard/soft reset), which would otherwise
      // veto the drop before it ever reaches `dropOn`.
      e.dataTransfer.effectAllowed = 'all';
      // Firefox requires data for a drag to start at all.
      e.dataTransfer.setData('text/plain', src.kind);
    }
    startModifierPoll();
  }

  /** A detached circle "ghost" used as the drag image for a commit drag: a
   *  coloured node, showing the count when several commits are dragged. */
  function buildCommitGhost(count: number, color: string): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText =
      'position:absolute;top:-1000px;left:-1000px;pointer-events:none;' +
      'width:32px;height:32px;border-radius:50%;border:2.5px solid #fff;' +
      'box-shadow:0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;' +
      `justify-content:center;color:#fff;font:800 13px/1 system-ui,sans-serif;background:${color};`;
    if (count > 1) el.textContent = String(count);
    document.body.appendChild(el);
    return el;
  }

  /** Start a commit drag from a node handle, with a circle drag image showing
   *  the dragged-commit count (the cursor carries the node, not the row). */
  function startCommitDrag(e: DragEvent, sha: string, color: string) {
    const { shas, branch } = dragShas(sha);
    startDrag(e, { kind: 'commits', shas, branch });
    if (e.dataTransfer && typeof e.dataTransfer.setDragImage === 'function') {
      const ghost = buildCommitGhost(shas.length, color);
      e.dataTransfer.setDragImage(ghost, 16, 16);
      // Detach once the browser has snapshotted it.
      setTimeout(() => ghost.remove(), 0);
    }
  }

  /** The permanently-rendered off-screen copy of the crown art used as the
   *  HEAD drag image (see its markup comment). */
  let crownDragEl = $state<HTMLElement | null>(null);

  /** Start a HEAD-crown drag.
   *
   *  Order matters, and the two halves are not independent:
   *  1. Set an EXPLICIT drag image. Without it the browser auto-snapshots
   *     `.crown`, and that snapshot comes out clipped — `.crown` carries
   *     `transform: translate(-50%, -50%)` (the snapshot covers the
   *     untransformed border box while the paint is shifted) and a tight
   *     `padding: 2px 3px` / `line-height: 0` box that `.crown-glyph`'s
   *     `drop-shadow` paints outside of.
   *  2. Only THEN is it safe for the on-screen crown to hide itself for the
   *     duration of the drag (`.crown-dragging`, driven by `dragSource`).
   *     Hiding the source element during `dragstart` blanks an AUTO-generated
   *     drag image; it is harmless only because step 1 decoupled the picture
   *     from the element. Do not "simplify" the hide back onto the automatic
   *     snapshot — the drag would go invisible. */
  function startCrownDrag(e: DragEvent) {
    // The crown only renders when headSha is set; this re-narrows for the
    // type checker, which can't carry the markup's `{#if}` into a handler.
    if (!headSha) return;
    // A new drag supersedes any return still in flight from the last one.
    clearCrownReturn();
    lastHeadCursor = null;
    headDropped = false;
    startDrag(e, { kind: 'head', sha: headSha });
    if (
      crownDragEl &&
      e.dataTransfer &&
      typeof e.dataTransfer.setDragImage === 'function'
    ) {
      // Snapshot a copy attached to `document.body`, NOT the template node
      // itself. That node lives inside `.scroller`, which is `overflow: auto`,
      // so an absolutely-positioned child parked at -1000px is clipped — and a
      // clipped element paints nothing, so the snapshot comes out blank. With
      // step 2 below hiding the real crown, that left nothing on screen at all.
      // `document.body` has no clipping ancestor; it is where `buildCommitGhost`
      // puts its ghost, for exactly this reason.
      //
      // Cloning rather than building the markup here is the whole point of
      // keeping a template node: the clone reuses the themed `<img>`'s
      // already-decoded `src`, which a node created inside this synchronous
      // handler could not wait for.
      const ghost = crownDragEl.cloneNode(true) as HTMLElement;
      ghost.style.cssText =
        'position:absolute;top:-1000px;left:-1000px;padding:8px;pointer-events:none;';
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(
        ghost,
        ghost.offsetWidth / 2,
        ghost.offsetHeight / 2,
      );
      // Detach once the browser has snapshotted it — same one-tick delay as
      // `buildCommitGhost`.
      setTimeout(() => ghost.remove(), 0);
    }
  }

  // --- Cancelled crown drag: fly the crown home ------------------------------
  // Duration of the crown's return flight. 150ms is the app's existing
  // "travel" tempo (`--panel-slide-ms`, the side-panel slide), kept in sync
  // with the `crown-return` keyframe below.
  const CROWN_RETURN_MS = 150;

  /** Last cursor position seen during the live crown drag, in `.content`
   *  coordinates — where the crown flies back FROM when the drag is
   *  cancelled. Plain `let`: only ever read at `dragend`. */
  let lastHeadCursor: { x: number; y: number } | null = null;
  /** True when the in-flight drag ended in an actual drop, so `dragend`
   *  knows not to animate: after a successful reset the crown belongs at its
   *  NEW position, and flying it back from the cursor would be a lie. */
  let headDropped = false;
  /** The offset the crown animates back from, or null when it is at rest.
   *  Cleared by a timer after `CROWN_RETURN_MS` — the animation is CSS, this
   *  only says "is it playing". */
  let crownReturn = $state<{ dx: number; dy: number } | null>(null);
  let crownReturnTimer: ReturnType<typeof setTimeout> | undefined;

  function clearCrownReturn() {
    clearTimeout(crownReturnTimer);
    crownReturnTimer = undefined;
    crownReturn = null;
  }

  /** `dragend` on the crown. A cancelled drag (`dropEffect === 'none'`, and
   *  no drop dispatched) sends the crown back to the branch head from the
   *  last cursor position instead of letting it blink back into existence:
   *  the on-screen crown is `opacity: 0` for the whole drag, so macOS's own
   *  snap-back animation flies the drag image toward something invisible and
   *  the return reads as a pop, not a movement. */
  function crownDragEnd(e: DragEvent) {
    const cancelled = !headDropped && e.dataTransfer?.dropEffect === 'none';
    const from = lastHeadCursor;
    headDropped = false;
    lastHeadCursor = null;
    endDrag();
    if (!cancelled || !from || headRow === null || reducedMotion()) return;
    const dx = from.x - laneX(headLane);
    const dy = from.y - (rowY(headRow) - NODE_R - CROWN_DY);
    if (dx === 0 && dy === 0) return;
    clearCrownReturn();
    crownReturn = { dx, dy };
    crownReturnTimer = setTimeout(() => {
      crownReturn = null;
      crownReturnTimer = undefined;
    }, CROWN_RETURN_MS);
  }

  function endDrag() {
    dragSource = null;
    dropHover = null;
    dragTip = null;
    // The enter/leave bookkeeping belongs to one drag session: a target
    // element unmounted mid-drag never fires its `dragleave`, so start the
    // next gesture from a known-zero count rather than a leaked one.
    hoverKey = null;
    hoverDepth = 0;
    // Every HTML5 drag source wires `dragend` (and `dropOn`) to this, so drop,
    // dragend and an Escape-cancel all land here. The loop ALSO listens for
    // window-level drop/dragend itself, for the case where the source node is
    // re-rendered away mid-drag and never fires its own.
    autoScroll.stop();
    stopModifierPoll();
    // WKWebView may swallow the keyup that happened mid-drag; a fresh gesture
    // re-syncs from its own pointerdown/keydown, so clearing here can't lose a
    // genuinely-held key.
    kbMods = NO_MODS;
  }

  // --- WKWebView modifier workaround -----------------------------------------
  // macOS WKWebView never sets shiftKey/altKey/metaKey/ctrlKey on DragEvents.
  // Worse, once a native HTML5 drag session actually starts, WKWebView
  // delivers NO keyboard events to the page at all — no keydown, no keyup —
  // so a modifier pressed or released mid-drag is invisible to the frontend
  // by any event-based means. Two layers cover the gesture grammar (Shift =
  // rebase, Alt = cherry-pick, Shift/Cmd = reset mode):
  //  1. Pre-drag: track the real keyboard/pointer state at the window level.
  //     Key events and pointerdown carry live flags right up until the drag
  //     starts, so the modifiers held at dragstart are captured even though
  //     the DragEvent itself won't report them.
  //  2. Mid-drag: poll the native `modifier_flags` IPC command (backed by
  //     CGEventSourceFlagsState, which reads the window server directly
  //     rather than relying on event delivery) every ~80ms via
  //     `startModifierPoll`/`stopModifierPoll` below, and REPLACE kbMods with
  //     the result — not OR — since the polled hardware state is
  //     authoritative and also recovers from a keyup that was swallowed
  //     mid-drag. Non-macOS platforms resolve `null` from the poll (Chromium/
  //     WebView2 already populate DragEvent's own flags correctly), so
  //     polling stops immediately there and layer 1 remains the only source.
  let kbMods = $state<Modifiers>(NO_MODS);
  function syncKbMods(e: KeyboardEvent | PointerEvent | MouseEvent) {
    kbMods = modsOf(e);
  }
  function clearKbMods() {
    kbMods = NO_MODS;
  }

  /** setInterval handle for the mid-drag native poll, or null when idle. */
  let modifierPollId: ReturnType<typeof setInterval> | null = null;

  /** Start polling native hardware modifier state for the duration of a drag.
   *  Clears any pre-existing interval first so overlapping drags (or a
   *  dragstart that fires again before endDrag ran) can never double-poll. */
  function startModifierPoll() {
    stopModifierPoll();
    modifierPollId = setInterval(() => {
      pollNativeModifiers().then(
        (mods) => {
          if (mods) {
            kbMods = mods;
          } else {
            // Non-macOS: DragEvent flags are already correct — nothing to poll.
            stopModifierPoll();
          }
        },
        // An IPC failure would otherwise repeat as an unhandled rejection
        // every 80ms for the rest of the drag — stop; the pre-drag keyboard
        // tracking (layer 1 above) still covers the gesture.
        () => stopModifierPoll(),
      );
    }, 80);
  }

  /** Stop the mid-drag poll (endDrag, and component teardown below). */
  function stopModifierPoll() {
    if (modifierPollId !== null) {
      clearInterval(modifierPollId);
      modifierPollId = null;
    }
  }

  // Belt-and-braces: if the component is destroyed mid-drag (e.g. the repo
  // is switched while dragging), don't leave the interval running against a
  // torn-down component.
  $effect(() => {
    return () => {
      stopModifierPoll();
      clearCrownReturn();
    };
  });

  /** The effective modifiers for a drag event: event flags ∪ tracked keyboard
   *  (which the native poll above keeps in sync with hardware mid-drag). */
  function liveMods(e: DragEvent): Modifiers {
    return mergeMods(modsOf(e), kbMods);
  }

  /** Reset-mode label for the live HEAD-crown drag tooltip — same modifier
   *  precedence as resolveDrag's "head" case (shift > meta/ctrl > plain). */
  function resetTipText(mod: Modifiers): string {
    if (mod.shift) return t('graph.resetTip.hard');
    if (mod.meta || mod.ctrl) return t('graph.resetTip.soft');
    return t('graph.resetTip.mixed');
  }

  /** Track the cursor while the HEAD crown is being dragged, so the tooltip
   *  can follow it and relabel live as modifiers are pressed/released. Runs
   *  on the root scroll container (dragover bubbles, so one handler covers
   *  the whole surface) — it must NOT preventDefault; drop legality is still
   *  decided per-target by overTarget. */
  function trackDragTip(e: DragEvent) {
    if (dragSource?.kind !== 'head') return;
    const p = localXY(e.clientX, e.clientY);
    // Also the crown's return-flight origin if this drag ends cancelled —
    // kept outside `dragTip` because `endDrag` clears that before `dragend`
    // gets a chance to read it.
    lastHeadCursor = p;
    dragTip = { x: p.x, y: p.y, text: resetTipText(liveMods(e)) };
  }

  /** Tooltip label for a resolved Shift-drag (rebase / cherry-pick-onto-new-
   *  branch), or `null` when the resolved op isn't one of those two — e.g.
   *  the Alt-drag cherry-pick or an illegal drop, which get no tooltip. */
  function shiftDragTipText(op: DragOp | null): string | null {
    if (!op) return null;
    switch (op.op) {
      case 'rebaseBranch':
        return t('graph.rebaseTip', { branch: op.branch, short: op.short });
      case 'cherryPickNewBranch':
        return t('graph.cherryPickTip', {
          n: op.shas.length,
          short: op.short,
        });
      default:
        return null;
    }
  }

  /** Shared dragenter/dragover handler. WebKit (WKWebView) only treats an
   *  element as the live drop target when `dragenter` is cancelled too — an
   *  uncancelled dragenter falls back to the body as the drop target and the
   *  element never receives dragover, so no affordance paints and the drop
   *  never fires in the real macOS app. Chromium accepts dragover-only, which
   *  is why e2e/jsdom never caught it. Every drop target wires BOTH events
   *  to this handler. */
  function overTarget(e: DragEvent, target: DropTarget, key: string) {
    if (!interactive || !dragSource) return;
    // One drop TARGET is several ELEMENTS: `.row` and the `.node-handle` over
    // it both carry `commit:<sha>`, and a branch chip carries its own key on
    // more than one node. Count how many of them the pointer is inside, so
    // `leaveTarget` can tell a boundary BETWEEN two of them apart from a real
    // departure. Only `dragenter` enters; `dragover` repeats on the element
    // already entered (both events route here — see this function's header).
    if (e.type === 'dragenter') {
      if (key === hoverKey) hoverDepth++;
      else {
        hoverKey = key;
        hoverDepth = 1;
      }
    }
    const op = resolveDrag(dragSource, target, liveMods(e));
    // The commit-drag tooltip needs the hovered target's own short sha, so
    // it's driven per-target here rather than by trackDragTip above (which
    // only cares about the live modifiers, not which node is under the
    // cursor). Recomputed on every dragover so it never goes stale.
    if (dragSource.kind === 'commits') {
      const text = shiftDragTipText(op);
      dragTip = text ? { ...localXY(e.clientX, e.clientY), text } : null;
    }
    if (!op) {
      if (dropHover?.key === key) dropHover = null;
      return;
    }
    e.preventDefault(); // allow the drop
    // macOS narrows the permitted drag operations by held modifier (Option ⇒
    // copy-only), and WebKit rejects the drop when dropEffect falls outside
    // that narrowed set. The additive ("plus") ops are exactly the
    // Option-modified gestures, so advertise those as 'copy'; graph rewrites
    // stay 'move' (Cmd's "generic" operation is move-compatible).
    const affordance = affordanceFor(op);
    if (e.dataTransfer)
      e.dataTransfer.dropEffect = affordance === 'plus' ? 'copy' : 'move';
    const branchLabel =
      op.op === 'rebaseBranch' &&
      target.kind === 'commit' &&
      target.branches?.length
        ? target.branches[0]
        : undefined;
    dropHover = { key, affordance, branchLabel };
  }

  function leaveTarget(key: string) {
    // Not every `dragleave` is a departure. The HTML5 DnD spec fires
    // `dragenter` on the element being ENTERED before `dragleave` on the one
    // being LEFT, so by the time this runs `overTarget` has already accounted
    // for wherever the pointer went. Two cases are therefore not departures:
    //
    //  1. Same key, another element. `.row` and the `.node-handle` over it are
    //     two elements for ONE target, and hero's 2x sprites put a band of
    //     bare `.row` around each handle, so a drag crosses that boundary
    //     twice per node. Clearing there is pure churn — a full O(commits)
    //     teardown plus a full O(commits) rebuild of the `discardShas`
    //     reactive fan-out, per crossing, plus a one-frame blank that makes
    //     the reset preview and the "+" affordance flicker.
    //  2. A DIFFERENT key is live. The pointer has already entered the next
    //     target and `overTarget` has repainted for it; clearing now would
    //     wipe that fresh state and leave the graph blank until the next
    //     `dragover`.
    //
    // What the eager clear is FOR is still intact: a genuine departure —
    // leaving the last element of this target with nothing newer entered —
    // still clears immediately, in this same synchronous handler, with no
    // deferral for a later event to undo.
    if (hoverKey === key) {
      hoverDepth = Math.max(0, hoverDepth - 1);
      if (hoverDepth > 0) return;
      hoverKey = null;
    } else if (hoverKey !== null) {
      return;
    }
    if (dropHover?.key === key) dropHover = null;
    // Leaving a commit target may leave the graph with no valid hover — clear
    // eagerly; overTarget on the next node repaints it immediately if still valid.
    if (dragSource?.kind === 'commits') dragTip = null;
  }

  function dropOn(e: DragEvent, target: DropTarget) {
    if (!interactive || !dragSource) return;
    const op = resolveDrag(dragSource, target, liveMods(e));
    // Recorded before endDrag() wipes the source: the crown's `dragend` fires
    // after this and must not play the cancel animation.
    if (dragSource.kind === 'head') headDropped = true;
    endDrag();
    if (op) {
      e.preventDefault();
      onGesture(op);
    }
  }

  // --- Keyboard navigation (arrows move focus; Enter/Space activate) --------
  let rowEls: HTMLButtonElement[] = $state([]);
  let focusIndex = -1;
  function handleKey(e: KeyboardEvent) {
    if (!interactive) return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (commits.length === 0) return;
    e.preventDefault();
    let cur = focusIndex;
    if (cur < 0)
      cur = selectedSha
        ? Math.max(
            0,
            commits.findIndex((c) => c.sha === selectedSha),
          )
        : 0;
    const next =
      e.key === 'ArrowDown'
        ? Math.min(cur + 1, commits.length - 1)
        : Math.max(cur - 1, 0);
    rowEls[next]?.focus();
  }

  // --- Marquee multi-select (drag on empty space) ---------------------------
  // Only the node handles start a commit drag; pressing-and-dragging anywhere
  // else on the graph sweeps a rubber-band box that selects the enclosed nodes.
  // Shift adds to the selection; ⌘/Ctrl toggles (see lib/selection.applyMarquee).
  let contentEl = $state<HTMLDivElement | null>(null);
  let marquee = $state<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  const MARQUEE_THRESHOLD = 4; // px of travel before a press becomes a sweep
  let mq: {
    pointerId: number;
    x0: number;
    y0: number;
    mods: ClickMods;
    active: boolean;
    /** The press began off any commit row → releasing without a drag clears. */
    background: boolean;
  } | null = null;
  // Set on a sweep release so the trailing click on a row doesn't collapse the
  // multi-selection back to a single commit.
  let suppressClick = false;

  /** Viewport → content-local coordinates (shared by the marquee and the
   *  drag-tooltip tracker below). */
  function localXY(clientX: number, clientY: number): { x: number; y: number } {
    const r = contentEl?.getBoundingClientRect();
    return { x: clientX - (r?.left ?? 0), y: clientY - (r?.top ?? 0) };
  }
  function localPoint(e: PointerEvent): { x: number; y: number } {
    return localXY(e.clientX, e.clientY);
  }

  /** Shas whose node centre falls inside the box, newest-first (screen order). */
  function shasInRect(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): string[] {
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    const out: string[] = [];
    commits.forEach((c, i) => {
      const a = layout.assignments.get(c.sha);
      if (!a) return;
      const cx = laneX(a.lane);
      const cy = rowY(i);
      if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) out.push(c.sha);
    });
    return out;
  }

  function marqueeDown(e: PointerEvent) {
    if (!interactive) return;
    suppressClick = false;
    if (e.button !== 0) return;
    const t = e.target as HTMLElement | null;
    // Node circles / HEAD crown / branch chips own their own press.
    if (t?.closest('.node-handle, .crown, .chip.interactive, .merge-handle'))
      return;
    const p = localPoint(e);
    mq = {
      pointerId: e.pointerId,
      x0: p.x,
      y0: p.y,
      mods: { shift: e.shiftKey, meta: e.metaKey, ctrl: e.ctrlKey },
      active: false,
      background: !t?.closest('.row'),
    };
    // NB: do NOT capture the pointer here. Capturing in pointerdown retargets
    // the follow-up `click` to the capture element, which would swallow a plain
    // row / message click (single-select). We capture only once a drag starts.
  }

  function marqueeMove(e: PointerEvent) {
    if (!mq || e.pointerId !== mq.pointerId) return;
    const p = localPoint(e);
    if (!mq.active) {
      if (
        Math.abs(p.x - mq.x0) < MARQUEE_THRESHOLD &&
        Math.abs(p.y - mq.y0) < MARQUEE_THRESHOLD
      )
        return;
      mq.active = true;
      // Now that it's a real sweep, capture so moves keep flowing if the
      // pointer leaves the element.
      if (typeof contentEl?.setPointerCapture === 'function') {
        try {
          contentEl.setPointerCapture(e.pointerId);
        } catch {
          /* no pointer capture (e.g. jsdom) */
        }
      }
    }
    e.preventDefault();
    marquee = {
      x: Math.min(mq.x0, p.x),
      y: Math.min(mq.y0, p.y),
      w: Math.abs(p.x - mq.x0),
      h: Math.abs(p.y - mq.y0),
    };
    onMarquee(shasInRect(mq.x0, mq.y0, p.x, p.y), mq.mods, false);
  }

  function marqueeUp(e: PointerEvent) {
    if (!mq || e.pointerId !== mq.pointerId) return;
    if (mq.active) {
      const p = localPoint(e);
      onMarquee(shasInRect(mq.x0, mq.y0, p.x, p.y), mq.mods, true);
      suppressClick = true; // swallow the synthetic click that follows a drag
    } else if (mq.background) {
      // A plain click on empty space (off any row) clears the whole selection.
      onClearSelection();
    }
    if (typeof contentEl?.releasePointerCapture === 'function') {
      try {
        contentEl.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    }
    mq = null;
    marquee = null;
  }

  function marqueeCancel() {
    mq = null;
    marquee = null;
  }

  // ── Hand tool (pan) ────────────────────────────────────────────────────────
  // While `handTool` is on, a left-press-drag anywhere pans the scroll container
  // instead of selecting/dragging. The interactive children are made
  // pointer-transparent in CSS (`.content.hand …`), so the press always lands on
  // `.content` and this pans regardless of what's underneath the cursor.

  function panDown(e: PointerEvent) {
    if (!interactive || e.button !== 0 || !scrollerEl) return;
    pan = {
      pointerId: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      left0: scrollerEl.scrollLeft,
      top0: scrollerEl.scrollTop,
    };
    if (typeof contentEl?.setPointerCapture === 'function') {
      try {
        contentEl.setPointerCapture(e.pointerId);
      } catch {
        /* no pointer capture (e.g. jsdom) */
      }
    }
    e.preventDefault();
  }

  function panMove(e: PointerEvent) {
    if (!pan || e.pointerId !== pan.pointerId || !scrollerEl) return;
    scrollerEl.scrollLeft = pan.left0 - (e.clientX - pan.x0);
    scrollerEl.scrollTop = pan.top0 - (e.clientY - pan.y0);
    e.preventDefault();
  }

  function panEnd(e: PointerEvent) {
    if (!pan || e.pointerId !== pan.pointerId) return;
    if (typeof contentEl?.releasePointerCapture === 'function') {
      try {
        contentEl.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    }
    pan = null;
  }

  // ── Edge auto-scroll during a drag ─────────────────────────────────────────
  // Dragging into an edge of the scroller scrolls the view, so a drop target
  // that starts off-screen can be reached without letting go. The zone
  // detection, speed ramp and rAF lifecycle live in lib/edgeAutoScroll — it is
  // self-contained state with no markup of its own, and this component is
  // already long enough that burying another loop in it would hide exactly the
  // bookkeeping that must be provably leak-free. See that module's header for
  // why the loop drives itself instead of stepping per `dragover`.
  const autoScroll = createEdgeAutoScroll({ onStep: autoScrollStep });

  /** The view has scrolled under a stationary pointer, so everything derived
   *  from that pointer's CONTENT-local position is stale: re-derive it. The
   *  merge drag matters most — its drop target is hit-tested from that point,
   *  so leaving it stale could merge into the wrong branch head. */
  function autoScrollStep(clientX: number, clientY: number) {
    if (mergeDrag) mergeDragPointTo(clientX, clientY);
    if (dragSource?.kind === 'head') {
      const p = localXY(clientX, clientY);
      lastHeadCursor = p;
      if (dragTip) dragTip = { ...dragTip, x: p.x, y: p.y };
    }
  }

  /** `dragover` on the scroller: keep the crown tooltip tracking (its original
   *  job) and feed the auto-scroll loop. Deliberately does NOT preventDefault —
   *  drop legality stays per-target in `overTarget`. Gated on `dragSource` so
   *  it only ever runs for our own gestures (not, say, a file dragged in from
   *  Finder) and so a stray late event cannot re-arm the loop after `endDrag`.
   *  Runs for EVERY drag kind: a commit drag needs to reach off-screen targets
   *  just as much as the crown does. */
  function graphDragOver(e: DragEvent) {
    trackDragTip(e);
    if (dragSource) autoScroll.update(scrollerEl, e.clientX, e.clientY);
  }

  /** `dragleave` bubbles from every child the cursor crosses, so it cannot be
   *  taken as "left the graph" on its own — and `relatedTarget` is unreliable
   *  mid-drag. Feeding the coordinates through instead lets the loop decide:
   *  a bubbled child leave is still inside the scroller (keeps going), a real
   *  exit is outside it (stops). */
  function graphDragLeave(e: DragEvent) {
    if (dragSource) autoScroll.update(scrollerEl, e.clientX, e.clientY);
  }

  // Unmount: a rAF loop that outlives the component would keep scrolling a
  // detached node forever.
  $effect(() => () => autoScroll.stop());

  // The `.content` pointer entry points route to pan (hand tool) or the marquee
  // selection. Move/up test `pan` so an in-flight pan finishes cleanly even if
  // the mode is toggled off mid-drag.
  function graphPointerDown(e: PointerEvent) {
    if (handTool) panDown(e);
    else marqueeDown(e);
  }
  function graphPointerMove(e: PointerEvent) {
    if (pan) panMove(e);
    else marqueeMove(e);
  }
  function graphPointerUp(e: PointerEvent) {
    if (pan) panEnd(e);
    else marqueeUp(e);
  }
  function graphPointerCancel(e: PointerEvent) {
    if (pan) panEnd(e);
    else marqueeCancel();
  }

  /** Row / node-circle click → select (single, or extend/toggle with mods),
   *  unless it's the trailing click right after a marquee sweep. */
  function selectClick(c: Commit, e: MouseEvent | KeyboardEvent) {
    if (!interactive) return;
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    onSelect(c, { shift: e.shiftKey, meta: e.metaKey, ctrl: e.ctrlKey });
  }

  /** Enter/Space activation for the crown/node-handle drag sources. They're
   *  plain divs (not <button>s — see the styles below for why), so they lose
   *  the native button keyboard-activation semantics; this restores them by
   *  invoking the same handler a click would. Space is prevented so the page
   *  doesn't scroll. */
  function activateOnKey(e: KeyboardEvent, fn: () => void) {
    if (e.key === 'Enter') {
      fn();
    } else if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      fn();
    }
  }

  /** True when the user has asked for reduced motion. `matchMedia` is absent
   *  under jsdom, and the optional chaining deliberately falls through to
   *  `false` (the "no preference" case) there. */
  function reducedMotion(): boolean {
    return (
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false
    );
  }

  /** `'auto'` (an instant jump) when the user has asked for reduced motion,
   *  else `'smooth'`. `scrollIntoView`'s behaviour can't be driven from the
   *  `prefers-reduced-motion` stylesheet the way Toast's transition is, so the
   *  query has to be read here. */
  function scrollBehavior(): ScrollBehavior {
    return reducedMotion() ? 'auto' : 'smooth';
  }

  // Jump-to from search and from selecting a branch in BranchesPanel:
  // scroll the target commit's row into view. A new `scrollTarget` object
  // re-runs the effect even for the same sha.
  //
  // The scroll is animated so the user can see WHERE the graph travelled to:
  // on a tall history a jump-cut lands you somewhere with no sense of
  // direction or distance, which is the whole point of revealing the branch
  // tip rather than just selecting it.
  $effect(() => {
    const target = scrollTarget;
    if (!target) return;
    const i = rowBySha.get(target.sha);
    if (i != null)
      rowEls[i]?.scrollIntoView?.({
        block: 'center',
        behavior: scrollBehavior(),
      });
  });
</script>

<svelte:window
  onkeydown={syncKbMods}
  onkeyup={syncKbMods}
  onpointerdown={syncKbMods}
  onblur={clearKbMods}
/>

<div class="graph-shell">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="scroller"
    data-tutorial="graph"
    class:bg-pixelated={bgPixelated}
    bind:this={scrollerEl}
    bind:clientWidth={scrollerW}
    bind:clientHeight={scrollerH}
    ondragover={graphDragOver}
    ondragleave={graphDragLeave}
    onscroll={onScrollerScroll}
    style:background={gtheme.background ?? null}
    style:background-attachment={bgAttachment}
    style:background-size={bgSize}
    style:background-position-y={bgPositionY}
    style:--graph-text={textColor}
    style:--graph-text-muted={textColorMuted}
    style:--graph-text-halo={textHalo}
    style:--graph-text-family={textFamily}
    style:--graph-text-scale={textScale}
    style:--graph-row-h={rowHVar}
    style:--graph-node-hit={nodeHitVar}
    aria-disabled={!interactive}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="content"
      class:hand={handTool}
      class:panning={!!pan}
      style="height:{totalH}px"
      bind:this={contentEl}
      onpointerdown={graphPointerDown}
      onpointermove={graphPointerMove}
      onpointerup={graphPointerUp}
      onpointercancel={graphPointerCancel}
    >
      <!-- Layer 0: theme decoration under the rails/nodes (non-interactive). -->
      {#if gtheme.decorUnder}
        <div
          class="decor decor-under"
          style="width:{svgW}px; height:{totalH}px; background:{gtheme
            .decorUnder.background ?? 'none'}"
        >
          {#each gtheme.decorUnder.sprites ?? [] as s, si (si)}
            <img
              src={s.asset.url}
              alt=""
              style="left:{s.x * 100}%; top:{s.y * 100}%; width:{s.asset
                .width}px; height:{s.asset.height}px; opacity:{s.opacity ?? 1}"
            />
          {/each}
        </div>
      {/if}

      <!-- Layer 1: rails + nodes -->
      <GraphRails
        {svgW}
        {totalH}
        {gtheme}
        {geom}
        {layout}
        {commits}
        {edgeMapping}
        {laneColor}
        {ghostShas}
        {discardShas}
        {headSha}
        {selectedSha}
        {selection}
        dropHoverKey={dropHover?.key ?? null}
        mergeTargetSha={mergeDrag?.targetSha ?? null}
        {mergeDragGeom}
        {headPlus}
      />

      <!-- Layer 2: interactive rows (axis + message + author) -->
      {#each commits as c, i (c.sha)}
        {@const isHead = c.sha === headSha}
        <button
          class="row"
          data-tutorial-commit={c.sha}
          class:selected={c.sha === selectedSha || selection.has(c.sha)}
          class:drop-target={dropHover?.key === 'commit:' + c.sha}
          style="top:{PAD_TOP + i * ROW_H}px"
          bind:this={rowEls[i]}
          onfocus={() => (focusIndex = i)}
          onkeydown={handleKey}
          onclick={(e) => selectClick(c, e)}
          ondragenter={(e) =>
            overTarget(
              e,
              {
                kind: 'commit',
                sha: c.sha,
                short: c.short_sha,
                branches: branchesAt(c.sha),
              },
              'commit:' + c.sha,
            )}
          ondragover={(e) =>
            overTarget(
              e,
              {
                kind: 'commit',
                sha: c.sha,
                short: c.short_sha,
                branches: branchesAt(c.sha),
              },
              'commit:' + c.sha,
            )}
          ondragleave={() => leaveTarget('commit:' + c.sha)}
          ondrop={(e) =>
            dropOn(e, {
              kind: 'commit',
              sha: c.sha,
              short: c.short_sha,
              branches: branchesAt(c.sha),
            })}
          oncontextmenu={(e) => {
            e.preventDefault();
            if (interactive) onCommitMenu(c, e.clientX, e.clientY);
          }}
        >
          <span class="axis">{axisTime(c.timestamp)}</span>
          <span class="msg">
            <span class="msg-text">
              <span
                class="subject"
                class:ghost={c.ghost}
                class:discarding={discardShas.has(c.sha)}
                >{c.subject || '(no message)'}</span
              >
              <span class="email" class:head={isHead}
                >{#if c.author_name}{c.author_name}{' '}{/if}{c.author_email}</span
              >
            </span>
            <Avatar name={c.author_name} email={c.author_email} />
          </span>
        </button>
      {/each}

      <!-- Layer 2b: per-node drag handles over the commit circles. ONLY these
         start a commit drag (cherry-pick / reorder); the rest of every row is
         free for marquee selection. They double as drop targets so a drag can
         land on the circle too. -->
      {#each commits as c, i (c.sha)}
        {@const a = layout.assignments.get(c.sha)}
        {#if a}
          <!-- A div, not a <button>: WKWebView (Tauri's macOS WebView) refuses to
             start an HTML5 drag from a form control, so this must be a plain
             element to actually drag in the real app (role/tabindex/onkeydown
             restore the button semantics jsdom can't exercise). -->
          <div
            class="node-handle"
            data-tutorial-commit={c.sha}
            role="button"
            tabindex="0"
            style="left:{laneX(a.lane)}px; top:{rowY(i)}px"
            aria-label={t('graph.commitLabel', { sha: c.short_sha })}
            title={t('graph.commitHint')}
            draggable="true"
            onclick={(e) => selectClick(c, e)}
            ondblclick={() => interactive && onCommitActivate(c)}
            onkeydown={(e) => activateOnKey(e, () => selectClick(c, e))}
            onpointerenter={() => {
              if (interactive && branchesAt(c.sha).length > 0)
                hoveredHeadSha = c.sha;
            }}
            onpointerleave={(e) => {
              if (
                hoveredHeadSha === c.sha &&
                !relatedInside(e, '.merge-handle')
              )
                hoveredHeadSha = null;
            }}
            ondragstart={(e) =>
              startCommitDrag(e, c.sha, laneColor(a.colorIndex))}
            ondragend={endDrag}
            ondragenter={(e) =>
              overTarget(
                e,
                {
                  kind: 'commit',
                  sha: c.sha,
                  short: c.short_sha,
                  branches: branchesAt(c.sha),
                },
                'commit:' + c.sha,
              )}
            ondragover={(e) =>
              overTarget(
                e,
                {
                  kind: 'commit',
                  sha: c.sha,
                  short: c.short_sha,
                  branches: branchesAt(c.sha),
                },
                'commit:' + c.sha,
              )}
            ondragleave={() => leaveTarget('commit:' + c.sha)}
            ondrop={(e) =>
              dropOn(e, {
                kind: 'commit',
                sha: c.sha,
                short: c.short_sha,
                branches: branchesAt(c.sha),
              })}
            oncontextmenu={(e) => {
              e.preventDefault();
              if (interactive) onCommitMenu(c, e.clientX, e.clientY);
            }}
          ></div>
        {/if}
      {/each}

      <!-- Layer 2c: branch-head "drag to merge" affordance dot. Shown above a
         branch-head node while it's hovered (or is the live merge drag's
         source), perched on the node's top edge. Its own pointerdown starts
         the merge drag (see startMergeDrag) — stopPropagation keeps it from
         also triggering the node-handle's HTML5 drag or the marquee sweep. -->
      {#each commits as c, i (c.sha)}
        {@const a = layout.assignments.get(c.sha)}
        {#if interactive && a && (c.sha === hoveredHeadSha || mergeDrag?.sourceSha === c.sha) && branchesAt(c.sha).length > 0}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="merge-handle"
            data-tutorial="merge-handle"
            class:dragging={mergeDrag?.sourceSha === c.sha}
            style="left:{laneX(a.lane)}px; top:{rowY(i) - NODE_R}px"
            title={t('graph.mergeHint')}
            onpointerdown={(e) => startMergeDrag(e, c.sha)}
            onpointerleave={(e) => {
              if (hoveredHeadSha === c.sha && !relatedInside(e, '.node-handle'))
                hoveredHeadSha = null;
            }}
          >
            <span
              class="merge-handle-dot"
              style="width:{MERGE_HANDLE_R * 2}px; height:{MERGE_HANDLE_R *
                2}px; background:{laneColor(a.colorIndex)}"
            >
              <svg
                class="merge-ico"
                width={MERGE_HANDLE_R * 2}
                height={MERGE_HANDLE_R * 2}
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <circle cx="18" cy="18" r="3" />
                <circle cx="6" cy="6" r="3" />
                <path d="M6 21V9a9 9 0 0 0 9 9" />
              </svg>
            </span>
          </div>
        {/if}
      {/each}

      <!-- Layer 3: branch / tag chips overlay -->
      {#each commits as c, i (c.sha)}
        {@const a = layout.assignments.get(c.sha)}
        {#if a && chips.get(c.sha)}
          <!-- Unified ref-label column: every row's chips right-align to the
             same fixed edge (labelRightX), regardless of this commit's own
             lane — see the .chips `transform: translateX(-100%)` trick. The
             column is capped at the axis (max-width below) and scrolls when a
             commit carries more refs than fit. -->
          {@const rowChips = chips.get(c.sha) ?? []}
          <!-- Connector stem: the nearest-node (rightmost) chip's colour runs
             right, under the rail + circle, so the label grows out of the
             node. Width reaches the node centre; the +14 underlap
             tucks its square left edge beneath the rounded pill.
             It is a SIBLING of .chips, not a child: .chips is a horizontal
             scroll container (see its CSS) and would clip the stem off at the
             label column's edge. Placed before .chips in DOM order with the
             same z-index: 0, so it still paints under the pills and under the
             rails — the stacking order the stem depends on. -->
          {#if rowChips.length}
            <span
              class="chip-tail"
              style="top:{rowY(i) - 12}px; left:{labelRightX -
                14}px; width:{laneX(a.lane) -
                labelRightX +
                14}px; background:{rowChips[rowChips.length - 1].color}"
              aria-hidden="true"
            ></span>
          {/if}
          <div
            class="chips"
            style="top:{rowY(i) -
              13}px; left:{labelRightX}px; max-width:{labelRightX - AXIS_W}px"
            {@attach pinChipScrollEnd(rowChips.length, labelRightX)}
          >
            {#each rowChips as chip, ci (chip.kind + chip.label)}
              {#if chip.kind === 'branch'}
                <!-- A div, not a <button>: WKWebView (Tauri's macOS WebView)
                   refuses to start an HTML5 drag from a form control, so this
                   must be a plain element to actually drag in the real app
                   (role/tabindex/onkeydown restore the button semantics). -->
                <div
                  class="chip chip-branch interactive"
                  data-tutorial-branch={chip.label}
                  class:drop-target={dropHover?.key === 'branch:' + chip.label}
                  class:label-selected={selectedBranch === chip.label}
                  class:rebase-target-hint={dropHover?.branchLabel ===
                    chip.label}
                  role="button"
                  tabindex="0"
                  style="background:{chip.color}; --zi:{ci + 1}"
                  title="{chip.label} — Click to select (Delete to remove) · drag onto current to merge (Shift = rebase) · double-click to checkout · right-click for actions"
                  draggable="true"
                  onclick={() =>
                    interactive &&
                    onBranchSelect({ name: chip.label, current: chip.current })}
                  onkeydown={(e) =>
                    activateOnKey(
                      e,
                      () =>
                        interactive &&
                        onBranchSelect({
                          name: chip.label,
                          current: chip.current,
                        }),
                    )}
                  ondragstart={(e) =>
                    startDrag(e, {
                      kind: 'branch',
                      name: chip.label,
                      current: chip.current,
                    })}
                  ondragend={endDrag}
                  ondragenter={(e) =>
                    overTarget(
                      e,
                      {
                        kind: 'branch',
                        name: chip.label,
                        current: chip.current,
                      },
                      'branch:' + chip.label,
                    )}
                  ondragover={(e) =>
                    overTarget(
                      e,
                      {
                        kind: 'branch',
                        name: chip.label,
                        current: chip.current,
                      },
                      'branch:' + chip.label,
                    )}
                  ondragleave={() => leaveTarget('branch:' + chip.label)}
                  ondrop={(e) =>
                    dropOn(e, {
                      kind: 'branch',
                      name: chip.label,
                      current: chip.current,
                    })}
                  ondblclick={() =>
                    interactive &&
                    onBranchActivate({
                      name: chip.label,
                      current: chip.current,
                    })}
                  oncontextmenu={(e) => {
                    e.preventDefault();
                    if (interactive)
                      onBranchMenu(
                        { name: chip.label, current: chip.current },
                        e.clientX,
                        e.clientY,
                      );
                  }}
                >
                  <span class="chip-label">{chip.label}</span
                  >{#if chip.current}<span class="star">✶</span>{/if}
                  {#if dropHover?.key === 'branch:' + chip.label && dropHover.affordance}
                    <span
                      class="afford"
                      class:dashed={dropHover.affordance === 'dashed'}
                    >
                      {dropHover.affordance === 'plus' ? '+' : '◌'}
                    </span>
                  {/if}
                </div>
              {:else if chip.kind === 'remote'}
                <button
                  class="chip chip-remote interactive"
                  class:label-selected={selectedBranch === chip.label}
                  style="background:{chip.color}; --zi:{ci + 1}"
                  title="{chip.label} — Click to select this remote branch's commits · double-click or right-click to checkout"
                  onclick={() =>
                    interactive &&
                    onBranchSelect({ name: chip.label, current: false })}
                  ondblclick={() => interactive && onRemoteCheckout(chip.label)}
                  oncontextmenu={(e) => {
                    e.preventDefault();
                    if (interactive)
                      onRemoteMenu(chip.label, e.clientX, e.clientY);
                  }}
                >
                  <span class="chip-label">{chip.label}</span>
                </button>
              {:else}
                <span
                  class="chip chip-{chip.kind}"
                  style="background:{chip.color}; --zi:{ci + 1}"
                  title={chip.label}
                >
                  <span class="chip-label">{chip.label}</span
                  >{#if chip.current}<span class="star">✶</span>{/if}
                </span>
              {/if}
            {/each}
          </div>
        {/if}
      {/each}

      <!-- Layer 4: HEAD crown — perched just above the node so it's a distinct
         click/drag target (won't be mistaken for the commit). Click = select
         HEAD; drag onto a commit = reset. A div, not a <button>: WKWebView
         (Tauri's macOS WebView) refuses to start an HTML5 drag from a form
         control, so this must be a plain element to actually drag in the real
         app (role/tabindex/onkeydown restore the button semantics jsdom can't
         exercise). -->
      <!-- The crown art itself, factored out so the on-screen crown and the
         off-screen drag image below render from ONE source: the picture the
         cursor carries must keep matching the crown actually on screen,
         including after a theme switch. -->
      {#snippet crownArt()}
        {#if gtheme.head?.svg}
          <!-- Tintable crown: currentColor follows HEAD's branch lane colour.
             SPRITE_SCALE multiplies width/height ONLY — the viewBox stays the
             authored box, which is what makes the viewport bigger than the
             user-space it maps and so scales the art. Scaling both together
             would be a no-op. -->
          <svg
            class="crown-glyph"
            viewBox="{-gtheme.head.width / 2} {-gtheme.head.height / 2} {gtheme
              .head.width} {gtheme.head.height}"
            width={gtheme.head.width * SPRITE_SCALE}
            height={gtheme.head.height * SPRITE_SCALE}
            style:color={headColor}
            aria-hidden="true"
          >
            {@html gtheme.head.svg}
          </svg>
        {:else if gtheme.head}
          <img
            src={gtheme.head.url}
            alt=""
            width={gtheme.head.width * SPRITE_SCALE}
            height={gtheme.head.height * SPRITE_SCALE}
            draggable="false"
          />
        {:else}
          <!-- The app's own crown. It scales too: a theme that sets a
             `spriteScale` without shipping a head asset still means "draw the
             graph's marks bigger", exactly as the default stroked node does. -->
          <svg
            class="crown-glyph"
            viewBox="0 0 24 20"
            width={24 * SPRITE_SCALE}
            height={20 * SPRITE_SCALE}
            aria-hidden="true"
          >
            <path
              d="M2.5 16.5 L2.5 5.5 L8 10 L12 3.5 L16 10 L21.5 5.5 L21.5 16.5 Z"
              fill={headColor}
              stroke="#fff"
              stroke-width="1.6"
              stroke-linejoin="round"
            />
          </svg>
        {/if}
      {/snippet}

      {#if headRow !== null && headSha}
        <div
          class="crown"
          data-tutorial="head-crown"
          class:crown-dragging={dragSource?.kind === 'head'}
          class:crown-returning={crownReturn !== null}
          role="button"
          tabindex="0"
          style="left:{laneX(headLane)}px; top:{rowY(headRow) -
            NODE_R -
            CROWN_DY}px"
          style:--crown-return-dx={crownReturn ? `${crownReturn.dx}px` : null}
          style:--crown-return-dy={crownReturn ? `${crownReturn.dy}px` : null}
          title={t('graph.crownHint')}
          aria-label={t('graph.crownLabel')}
          draggable="true"
          onclick={(e) => headCommit && selectClick(headCommit, e)}
          onkeydown={(e) =>
            activateOnKey(e, () => headCommit && selectClick(headCommit, e))}
          ondragstart={startCrownDrag}
          ondragend={crownDragEnd}
        >
          {@render crownArt()}
        </div>
        <!-- The crown's drag image. Rendered permanently (not built on dragstart)
           so no layout/decode race can hand the browser a half-drawn node at
           snapshot time, and so it re-renders with the theme for free. It is
           deliberately free of everything that clipped the browser's automatic
           snapshot of `.crown`: no transform (the snapshot covers the
           untransformed border box), generous padding instead of `.crown`'s
           tight `2px 3px`, so `.crown-glyph`'s drop-shadow — which paints
           outside the border box — lands inside this box. aria-hidden + no
           tabindex + pointer-events:none keep it out of a11y/keyboard/pointer
           reach. -->
        <div
          class="crown-drag-image"
          aria-hidden="true"
          bind:this={crownDragEl}
        >
          {@render crownArt()}
        </div>
      {/if}

      <!-- Layer 4b: clickable hit-area over the HEAD "+" affordance → new commit.
         Follows HEAD (plusX/plusY — see the script), always at row-0 height.
         The glyph itself is drawn in the (pointer-events:none) rails SVG. -->
      {#if headSha && headRow !== null}
        <button
          class="new-commit"
          data-tutorial="create-commit"
          style="left:{plusX}px; top:{plusY}px"
          title={t('graph.newCommit')}
          aria-label={t('graph.newCommit')}
          disabled={!interactive}
          onclick={onCreateCommit}
        ></button>
      {/if}

      <!-- Layer 5: live marquee selection box -->
      {#if marquee}
        <div
          class="marquee"
          style="left:{marquee.x}px; top:{marquee.y}px; width:{marquee.w}px; height:{marquee.h}px"
        ></div>
      {/if}

      <!-- Layer 6: live drag tooltip — follows the cursor while the HEAD crown
         is being dragged, naming the reset mode the held modifiers resolve
         to (updates live as modifiers are pressed/released mid-drag). -->
      {#if dragTip}
        <div
          class="drag-tip"
          style="left:{dragTip.x + 14}px; top:{dragTip.y + 18}px"
        >
          {dragTip.text}
        </div>
      {/if}

      <!-- Layer 7: theme decoration above everything (non-interactive). -->
      {#if gtheme.decorOver}
        <div
          class="decor decor-over"
          style="width:{svgW}px; height:{totalH}px; background:{gtheme.decorOver
            .background ?? 'none'}"
        >
          {#each gtheme.decorOver.sprites ?? [] as s, si (si)}
            <img
              src={s.asset.url}
              alt=""
              style="left:{s.x * 100}%; top:{s.y * 100}%; width:{s.asset
                .width}px; height:{s.asset.height}px; opacity:{s.opacity ?? 1}"
            />
          {/each}
        </div>
      {/if}

      <!-- Layer 8: resolve-mode lock. Full-surface, on top of every other
         layer, capturing every pointer event so nothing underneath can be
         clicked/dragged while a conflict is being resolved — belt-and-braces
         alongside the per-handler `interactive` guards above (also needed for
         real mouse hit-testing, which the guards alone can't stop). -->
      {#if !interactive}
        <div
          class="graph-locked"
          style="width:{svgW}px; height:{totalH}px"
          aria-hidden="true"
        ></div>
      {/if}
    </div>
  </div>
  {#if showBackToTop}
    <button
      class="back-to-top"
      type="button"
      title={t('graph.backToTop')}
      aria-label={t('graph.backToTop')}
      onclick={backToTop}>↑</button
    >
  {/if}
</div>

<style>
  .graph-shell {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
    /* Keep the button inside the graph's stacking context so side panels and
       workspace chrome continue to overlay it. */
    isolation: isolate;
  }
  .scroller {
    width: 100%;
    height: 100%;
    overflow: auto;
    background: var(--workspace-bg);
    /* Contain the graph's internal stacking (incl. the resolve-mode
     * `.graph-locked` overlay at z-index: 20) so it can never rise above
     * workspace-level chrome — the files panel, the resolve banner, menus —
     * which must stay clickable while the graph itself is locked. */
    isolation: isolate;
    /* Strip-mode backgrounds read their vertical placement from here; the
     * scroll listener overwrites it imperatively (see `onScrollerScroll`).
     * The declaration lives in CSS rather than in a `style:` directive so
     * that the imperative write is never clobbered by a re-render. */
    --graph-bg-y: 0%;
  }
  .back-to-top {
    position: absolute;
    bottom: 12px;
    right: 12px;
    z-index: 25;
    width: 34px;
    height: 34px;
    border: 1px solid var(--panel-border);
    border-radius: 50%;
    background: var(--panel-bg);
    color: var(--fg);
    box-shadow: var(--panel-shadow);
    cursor: pointer;
    font-size: 20px;
    line-height: 1;
  }
  .back-to-top:hover {
    background: var(--row-hover);
  }
  .back-to-top:focus-visible {
    outline: 2px solid var(--select-ring);
    outline-offset: 2px;
  }
  /* Nearest-neighbour filtering for a themed background that is UPSCALED to
   * the pane's width (`backgroundFit.pixelated`). `image-rendering` is an
   * INHERITED property, so it is reset on the children: the graph's own
   * sprites are drawn smaller than their source art and must keep smooth
   * filtering. Only the surface's own background is affected. */
  .scroller.bg-pixelated {
    image-rendering: pixelated;
  }
  .scroller.bg-pixelated > :global(*) {
    image-rendering: auto;
  }
  .content {
    position: relative;
    min-width: 100%;
    /* A marquee sweep must not select the underlying commit text. */
    user-select: none;
    -webkit-user-select: none;
  }
  /* Hand tool: grab the whole surface. The cursor is a hand, and every
     interactive child is made pointer-transparent so a press-drag anywhere
     lands on `.content` and pans (rather than selecting / dragging a node). */
  .content.hand {
    cursor: grab;
  }
  .content.hand.panning {
    cursor: grabbing;
  }
  .content.hand :is(.row, .node-handle, .crown, .chip, .merge-handle) {
    pointer-events: none;
  }

  /* Draggable grab-handle over each commit node — the ONLY commit drag source.
   * A <div role="button">, not a <button> (see the markup comment): WebKit
   * only starts HTML5 drags from arbitrary elements that opt in via
   * -webkit-user-drag, so this is required for real drags in the Tauri
   * WKWebView. box-sizing is explicit since a div's UA default (content-box)
   * differs from some browsers' button default.
   *
   * Sized from `--graph-node-hit` (the node MARK + a fixed pointer pad, see
   * `NODE_D`/`HIT_PAD`), NOT a hardcoded px: the handle has to cover the
   * sprite it grabs, and a theme's `spriteScale`/node art both move that
   * sprite. `--graph-node-hit` is only set when the theme declares one of
   * those, so the 30px fallback carries the unthemed default unchanged.
   * A handle smaller than its sprite rings every node with bare `.row`,
   * which carries the same drop key and so re-triggers the hover on every
   * crossing. */
  .node-handle {
    position: absolute;
    box-sizing: border-box;
    width: var(--graph-node-hit, 30px);
    height: var(--graph-node-hit, 30px);
    transform: translate(-50%, -50%);
    border: 0;
    border-radius: 50%;
    background: transparent;
    padding: 0;
    cursor: grab;
    z-index: 2;
    -webkit-user-drag: element;
  }
  .node-handle:active {
    cursor: grabbing;
  }
  .node-handle:focus-visible {
    outline: 2px solid var(--select-ring);
    outline-offset: 2px;
  }

  /* Branch-head "drag to merge" affordance — a generous invisible hit area
   * (easier to grab than the tiny visible dot) centered on the node's top
   * edge; the dot itself (merge-handle-dot) is the ~1/2-node-radius circle
   * the spec calls for, which grows another 1.5x on hover/drag — the hit area
   * gives that grown state room without clipping. z-index 3 keeps it above
   * .node-handle (2) so its own pointerdown wins the hit-test at that pixel.
   *
   * A flat 26px at every sprite scale, because the dot inside it is flat too:
   * it is app chrome rather than theme art (see MERGE_HANDLE_R), so the 12px
   * dot grown 1.5x is 18px and 26px is that plus an 8px pointer pad, whatever
   * the theme does to the sprites around it. */
  .merge-handle {
    position: absolute;
    box-sizing: border-box;
    width: 26px;
    height: 26px;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: center;
    justify-content: center;
    border: 0;
    background: transparent;
    padding: 0;
    cursor: pointer;
    z-index: 3;
    touch-action: none;
  }
  .merge-handle:active {
    cursor: grabbing;
  }
  .merge-handle-dot {
    position: relative;
    border-radius: 50%;
    background: var(--lane-0);
    border: 1.5px solid #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
    transition: transform 120ms ease;
  }
  .merge-handle:hover .merge-handle-dot,
  .merge-handle.dragging .merge-handle-dot {
    transform: scale(1.5);
  }
  /* git-merge glyph, centered on the dot — hidden until hover/drag so the
   * plain color dot is what's visible at rest. */
  .merge-handle-dot .merge-ico {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    opacity: 0;
    transition: opacity 120ms ease;
    pointer-events: none;
  }
  .merge-handle:hover .merge-ico,
  .merge-handle.dragging .merge-ico {
    opacity: 1;
  }

  /* Clickable hit-area over the HEAD "+" glyph → open the create-commit modal.
   *
   * Deliberately NOT scaled with `spriteScale`, unlike .node-handle and
   * .merge-handle above. The glyph underneath it is app chrome, not art:
   * `plusGlyph` in GraphRails draws a fixed `r="11"` circle at every sprite
   * scale (which is also why `headSpurPath`'s "+11" meet point is unscaled).
   * 26px over a 22px glyph is 2px of pad a side; scaling the box while the
   * mark stayed put would only detach the hit area from what it covers. */
  .new-commit {
    position: absolute;
    width: 26px;
    height: 26px;
    transform: translate(-50%, -50%);
    border: 0;
    border-radius: 50%;
    background: transparent;
    padding: 0;
    cursor: pointer;
    z-index: 3;
  }
  .new-commit:hover {
    box-shadow: 0 0 0 2px var(--select-ring);
  }
  .new-commit:focus-visible {
    outline: 2px solid var(--select-ring);
    outline-offset: 2px;
  }

  /* Live rubber-band selection box. */
  .marquee {
    position: absolute;
    z-index: 4;
    pointer-events: none;
    background: color-mix(in srgb, var(--select-ring) 14%, transparent);
    border: 1px solid var(--select-ring);
    border-radius: 2px;
  }

  /* Live tooltip following the cursor during a HEAD-crown reset drag. */
  .drag-tip {
    position: absolute;
    z-index: 5;
    pointer-events: none;
    background: rgba(20, 20, 20, 0.92);
    color: #fff;
    font-size: 11.5px;
    font-weight: 600;
    white-space: nowrap;
    padding: 4px 9px;
    border-radius: 6px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  /* Graph-theme decoration layers: a full-size overlay (background + any
   * positioned sprites), non-interactive so it never steals row/node/chip
   * hit-testing. decor-under sits behind the rails/nodes (below .rails'
   * z-index: 1); decor-over sits above every other layer (highest z-index). */
  .decor {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    background-repeat: no-repeat;
    background-size: cover;
  }
  .decor-under {
    z-index: 0;
  }
  /* Resolve-mode lock overlay (see the markup comment above): dims + blurs
   * the graph to signal it's frozen, and `pointer-events: auto` (unlike
   * .decor) intercepts the mouse so no gesture can start. Highest z-index of
   * any layer in .content — but trapped inside .scroller's stacking context
   * (isolation: isolate), so the files panel / resolve banner stay above it. */
  .graph-locked {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 20;
    background: rgba(15, 17, 21, 0.32);
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
    cursor: default;
    pointer-events: auto;
  }
  .decor-over {
    z-index: 6;
  }
  .decor img {
    position: absolute;
    transform: translate(-50%, -50%);
  }

  /* z-index: 0 (below .rails' 1) so the separator line / hover / selected
   * backgrounds never paint over a branch rail — the SVG's transparent
   * background lets the row's own text (axis/message, which live clear of
   * the lane columns) still show through untouched. */
  .row {
    position: absolute;
    left: 0;
    right: 0;
    z-index: 0;
    /* MUST match ROW_H: the HTML text layer and the SVG node layer are two
     * separate stacking layers over the same rows, so a mismatch desynchronises
     * a row's text from its own node. `--graph-row-h` is set on `.scroller`
     * only when the active theme declares `geometry.rowH`; the 56px fallback is
     * the app default, i.e. what an unthemed graph renders. */
    height: var(--graph-row-h, 56px);
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: transparent;
    border: 0;
    border-top: 1px solid var(--row-line);
    color: var(--fg);
    cursor: pointer;
    text-align: left;
    padding: 0 18px 0 0;
    font: inherit;
    /* A graph theme may prefer its own family for row text; unset, this is
     * `inherit`, i.e. exactly what `font: inherit` above already resolved to
     * (the app's `--sans`). Declared after the shorthand so it wins. */
    font-family: var(--graph-text-family, inherit);
  }
  .row:hover {
    background: var(--row-hover);
  }
  .row.selected {
    background: var(--row-selected);
    box-shadow: inset 3px 0 0 var(--select-ring);
  }
  .row.drop-target {
    background: var(--row-hover);
  }
  .row:focus-visible {
    outline: 2px solid var(--select-ring);
    outline-offset: -2px;
  }

  /* Graph-theme text seam (`GraphThemePack.text`). Every rule below resolves
   * against a `--graph-text*` custom property the scroller only sets when the
   * active theme asks for it, with the app's own colour/size as the fallback
   * — so an unthemed graph computes to exactly what it did before.
   *
   * The halo is a triple text-shadow rather than a backing plate: a plate
   * would cover the artwork the theme exists to show. A 1px blur draws the
   * rim, a 2px one fills the gaps a single tight pass leaves on diagonal
   * strokes, and a 1px downward offset seats the glyph against what is behind
   * it — three short passes, so it reads as an outline and not a glow (a
   * wider radius is what turns this muddy). It is always declared and
   * defaults to
   * `transparent`, which keeps the shadow stack out of JS — a theme supplying
   * `halo` just colours in a shadow that was already there. */
  .axis,
  .subject,
  .email {
    text-shadow:
      0 0 1px var(--graph-text-halo, transparent),
      0 0 2px var(--graph-text-halo, transparent),
      0 1px 1px var(--graph-text-halo, transparent);
  }

  .axis {
    width: 150px; /* AXIS_W */
    flex: 0 0 auto;
    padding-left: 24px;
    font-size: calc(12px * var(--graph-text-scale, 1));
    color: var(--graph-text, var(--fg-soft));
  }
  .msg {
    flex: 0 1 auto;
    max-width: 340px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    min-width: 0;
  }
  .msg-text {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    min-width: 0;
    line-height: 1.25;
  }
  .subject {
    font-size: calc(13px * var(--graph-text-scale, 1));
    color: var(--graph-text, var(--fg-soft));
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .subject.ghost {
    opacity: 0.55;
    text-decoration: line-through;
  }
  /* Preview only: dimmed, but NOT struck through — nothing has happened yet. */
  .subject.discarding {
    opacity: 0.55;
  }
  .email {
    font-size: calc(11px * var(--graph-text-scale, 1));
    color: var(--graph-text-muted, var(--fg-muted));
  }
  /* HEAD's row keeps its original stronger emphasis. */
  .email.head {
    font-weight: 600;
    color: var(--graph-text, var(--fg));
  }

  /* Unified ref-label column. `left` is a fixed x (labelRightX, the same for
   * every commit); the translateX below pins that as the box's RIGHT edge and
   * lets it grow leftward to fit its content — but only as far as the time
   * axis (max-width), past which it scrolls. So labels stay right-aligned
   * toward the lanes regardless of chip text length, and can never reach over
   * the axis column no matter how many refs a commit has. z-index: 0 keeps
   * the labels on the BOTTOM layer — below the rails (1) and commit nodes — so a
   * label can never paint over a branch line or commit circle; it still sits on
   * top of the row background by DOM/paint order (rendered after .row). */
  .chips {
    /* Slack around the strip so the clip an overflow scroller imposes doesn't
     * eat the selection ring / :hover outline / .rebase-target-hint scale that
     * paint OUTSIDE a chip's box. Added as padding and cancelled again in the
     * transform + height/margin below, so the chips' own geometry is unchanged
     * and the padding stays a transparent gutter. */
    --chip-bleed: 8px;
    position: absolute;
    box-sizing: border-box;
    /* -100% pins `left` (labelRightX) as the box's RIGHT edge; + the bleed
     * puts the CONTENT's right edge (the pills) back exactly on labelRightX. */
    transform: translateX(calc(-100% + var(--chip-bleed)));
    margin-top: calc(-1 * var(--chip-bleed));
    z-index: 0;
    height: calc(26px + 2 * var(--chip-bleed));
    padding: var(--chip-bleed);
    display: flex;
    align-items: center;
    /* Right-aligned via the first chip's `margin-left: auto` (below), NOT
     * justify-content: flex-end — in a scroll container the latter dumps the
     * overflow past the START edge, where it can't be scrolled to. */
    justify-content: flex-start;
    pointer-events: none;
    /* THE FIX: too many / too long refs used to grow leftward without limit and
     * paint over the time axis. `max-width` (inline: labelRightX - AXIS_W; the
     * lane0X clamp guarantees that is >= LABEL_COL_W) stops the column dead at
     * the axis and the surplus becomes scrollable instead. Wheel/trackpad over
     * a chip scrolls the strip — the chips keep pointer-events: auto and the
     * browser scrolls the target's nearest scrollable ancestor, so drag-and-
     * drop is untouched; keyboard focus scrolls an off-screen chip into view.
     * overflow-y is explicit: `auto` on one axis computes the other to `auto`,
     * and a stray vertical scrollbar here would shave the chips. */
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    /* No visible scrollbar: one per row would be visual noise (and on this
     * 26px strip, unusable). The left-edge fade below hints at the overflow. */
    scrollbar-width: none;
  }
  .chips::-webkit-scrollbar {
    display: none;
  }
  /* Fade the outer (left) edge once the strip is actually scrolled, as the
   * "there's more this way" cue a hidden scrollbar can't give. Scroll-driven,
   * so a strip that fits is never dimmed; where scroll timelines are missing
   * the strip simply has a hard edge. A mask makes no difference to stacking:
   * .chips already forms a stacking context (position + z-index: 0). */
  @supports (animation-timeline: scroll()) {
    .chips {
      animation: chips-fade-out linear both;
      animation-timeline: scroll(self inline);
      animation-range: 0 24px;
    }
    @keyframes chips-fade-out {
      from {
        mask-image: linear-gradient(
          to right,
          rgb(0 0 0 / 1) 8px,
          rgb(0 0 0 / 1) 32px
        );
      }
      to {
        mask-image: linear-gradient(
          to right,
          rgb(0 0 0 / 0) 8px,
          rgb(0 0 0 / 1) 32px
        );
      }
    }
  }
  .chip {
    position: relative;
    /* Stacking within one commit's cluster increases left→right, so the
     * chip NEAREST the node (rightmost, last in DOM) paints on top and the
     * outermost tag sits at the bottom. `--zi` is set per chip
     * from its column index; a CSS var (not an inline z-index) so the
     * .rebase-target-hint rule below can still override it on hover. */
    z-index: var(--zi, auto);
    display: inline-flex;
    align-items: center;
    height: 24px;
    padding: 0 14px;
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
  }
  /* Connector "stem": the nearest-node chip's colour extends
   * rightward, under the branch rail and the commit circle, so the ref label
   * reads as a tab growing out of its commit node. It is emitted just BEFORE
   * .chips and shares its z-index: 0, so it paints below every pill (whose
   * rounded right corner hides the stem's square left edge) and below the
   * rails layer (z-index 1:
   * rail line THEN circle), which paints over it — giving the required order
   * circle > rail > label > ruler > bg. It sits OUTSIDE .chips (which scrolls
   * and would clip it); left/top/width are absolute, set inline. */
  .chip-tail {
    position: absolute;
    height: 24px;
    z-index: 0;
    pointer-events: none;
  }
  /* Truncate a long ref name at 12em with an ellipsis; the chip's
   * `title` carries the full name as a tooltip. */
  .chip-label {
    display: block;
    max-width: 12em;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* Several refs on one commit overlap like <=tag=(=branch=): each chip
   * after the first is pulled left into its predecessor. Sort order (tags
   * first, see chipsFor) plus DOM/paint order puts the tag frame outermost
   * and the branch pill on top of it. The UNDER chip additionally extends
   * 1.5em further right (matched by the successor's extra negative pull, so
   * visible geometry is unchanged) — that extension sits beneath the top
   * chip and fills the notch its rounded corners would otherwise leave as a
   * see-through gap. */
  .chips > .chip:not(:last-child) {
    padding-right: calc(14px + 1.5em);
  }
  .chips > .chip:not(:first-child) {
    margin-left: calc(-11px - 1.5em);
  }
  /* Packs the cluster against the column's right edge while leaving any
   * overflow on the scrollable END side — see .chips' justify-content note.
   * (The stem used to be .chips' first child, which made this negative pull
   * apply to the first chip too and let the cluster bleed a little past the
   * container's left edge; with the stem hoisted out, the first chip is the
   * real :first-child and the box now measures the cluster exactly.) */
  .chips > .chip:first-child {
    margin-left: auto;
  }
  /* Branch / remote / detached-HEAD chips: fully rounded pill, "(==)". */
  .chip-branch,
  .chip-remote,
  .chip-head {
    border-radius: 999px;
  }
  /* Tag chips: pointed/chevron both ends, "<==>". */
  .chip-tag {
    padding: 0 16px;
    clip-path: polygon(
      10px 0,
      calc(100% - 10px) 0,
      100% 50%,
      calc(100% - 10px) 100%,
      10px 100%,
      0 50%
    );
  }
  /* The branch chip is a <div role="button"> (see the markup comment): WebKit
   * only starts HTML5 drags from arbitrary elements that opt in via
   * -webkit-user-drag, so the draggable chip needs it to drag in the Tauri
   * WKWebView. box-sizing is explicit since a div's UA default (content-box)
   * differs from some browsers' button default. */
  .chip.interactive {
    box-sizing: border-box;
    border: 0;
    font: inherit;
    cursor: pointer;
    pointer-events: auto;
  }
  .chip.interactive:hover {
    filter: brightness(1.08);
  }
  .chip.interactive:focus-visible {
    outline: 2px solid var(--select-ring);
    outline-offset: 1px;
  }
  .chip.interactive[draggable='true'] {
    cursor: grab;
    -webkit-user-drag: element;
  }
  .chip.interactive:active {
    cursor: grabbing;
  }
  .chip.drop-target {
    outline: 2.5px solid var(--select-ring);
    outline-offset: 2px;
    filter: brightness(1.12);
  }
  .chip.label-selected {
    /* A white gap between the chip and the ring keeps the selection frame
     * legible against any lane color (a same-hue ring alone can vanish). */
    box-shadow:
      0 0 0 2px #fff,
      0 0 0 4px var(--select-ring);
  }
  /* Hovering a Shift-drag over a commit whose rebase target defaulted to
   * this branch: same selected-ring treatment as .label-selected, plus a
   * slight scale for the "enlarged like the commit node" feel. Chips overlap
   * via negative margins by design, so this must stay box-shadow/transform
   * only — no size/padding/margin change, which would shift layout — and
   * needs a z-index bump so the ring isn't buried under an overlapping
   * neighbor chip. */
  .chip.rebase-target-hint {
    position: relative;
    /* High enough to clear any per-chip --zi (see .chip) so the hovered
     * target's ring is never buried under a rightward neighbour. */
    z-index: 50;
    transform: scale(1.08);
    box-shadow:
      0 0 0 2px #fff,
      0 0 0 4px var(--select-ring);
  }
  .afford {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    margin-left: 6px;
    border-radius: 50%;
    background: #fff;
    color: var(--select-ring);
    font-size: 13px;
    font-weight: 800;
    line-height: 1;
  }
  .afford.dashed {
    background: transparent;
    border: 2px dashed #fff;
    color: #fff;
    font-size: 10px;
  }

  /* HEAD crown glyph, perched just above the HEAD node. A <div role="button">,
   * not a <button> (see the markup comment): WebKit only starts HTML5 drags
   * from arbitrary elements that opt in via -webkit-user-drag, so this is
   * required for real drags in the Tauri WKWebView. box-sizing is explicit
   * since a div's UA default (content-box) differs from some browsers'
   * button default. */
  .crown {
    position: absolute;
    box-sizing: border-box;
    transform: translate(-50%, -50%);
    border: 0;
    border-radius: 5px;
    background: transparent;
    padding: 2px 3px;
    cursor: grab;
    z-index: 3;
    line-height: 0;
    -webkit-user-drag: element;
  }
  /* Hidden for the duration of a HEAD drag: the cursor already carries the
   * crown, so leaving it at its home position reads as a second crown.
   * `opacity` rather than visibility/display — the element is the live drag
   * source, and removing it from rendering mid-drag can abort the drag in
   * some engines. `dragSource` is cleared by endDrag, so this restores
   * itself; there is no separate teardown path. */
  .crown-dragging {
    opacity: 0;
  }
  /* Cancelled crown drag: the crown flies home from wherever the cursor let
   * go (`--crown-return-*`, set on the element at `dragend`). A plain CSS
   * keyframe driven by a class, NOT a Svelte `transition:` — those need the
   * Web Animations API, which jsdom lacks, so they break every component test
   * that renders the graph (the same call Toast.svelte and panelSlide make).
   * `translate(-50%, -50%)` is `.crown`'s own resting transform and has to be
   * repeated here, since `animation` replaces `transform` outright. */
  @keyframes crown-return {
    from {
      transform: translate(-50%, -50%)
        translate(var(--crown-return-dx, 0px), var(--crown-return-dy, 0px));
    }
    to {
      transform: translate(-50%, -50%);
    }
  }
  .crown-returning {
    animation: crown-return 150ms ease-out; /* CROWN_RETURN_MS */
    pointer-events: none;
  }
  /* Reduced motion: the crown is simply home. The script already refuses to
   * set the class, so this is belt-and-braces for a preference that flips
   * mid-flight — it must never leave the crown stranded off-position. */
  @media (prefers-reduced-motion: reduce) {
    .crown-returning {
      animation: none;
    }
  }
  /* Off-screen copy of the crown art used as the explicit drag image. No
   * transform and roomy padding, so the whole glyph plus its drop-shadow
   * sits inside the snapshotted border box (see startCrownDrag). */
  .crown-drag-image {
    position: absolute;
    top: -1000px;
    left: -1000px;
    padding: 8px;
    background: transparent;
    pointer-events: none;
  }
  .crown-glyph {
    display: block;
    filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.18));
    pointer-events: none;
  }
  .crown:hover {
    filter: brightness(1.08);
    background: color-mix(in srgb, var(--select-ring) 12%, transparent);
  }
  .crown:active {
    cursor: grabbing;
  }
  .crown:focus-visible {
    outline: 2px solid var(--select-ring);
    outline-offset: 2px;
  }
  .star {
    margin-left: 5px;
    font-size: 11px;
  }
</style>
