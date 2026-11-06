<!--
  Tutorial overlay. Pure presentation: everything comes in as props, the
  tutorial engine is not imported here.

  While a step is showing it does three jobs:
   1. SPOTLIGHT — one full-viewport <svg> whose single even-odd <path> is the
      dim layer with a rounded hole per visible target. The svg itself is
      `pointer-events:none`; the path is `pointer-events:fill`, so a click
      OUTSIDE every hole lands on the path (and is swallowed) while a click
      INSIDE a hole falls through to the page beneath. Target rects are re-read every
      animation frame, so the holes follow scrolling, resizing and panels that
      slide open.
   2. INPUT GUARD — a capture-phase window key listener swallows every key
      except modifiers, Tab (which it routes itself, see below), the step's
      `allowKeys` and typing into a field — but those last two only when the
      event happens inside a hole or the card, so a stray focus can never
      operate a control outside the spotlight. `contextmenu` is swallowed
      outside the holes. Keyboard users are never stranded: focus moves to
      the card's main button whenever a step starts, and Tab / Shift+Tab
      cycle through the card's controls and the controls inside the holes —
      nothing else is reachable.
   3. COACH CARD — step counter, copy, nav buttons and an Exit that asks first.
      It sits beside the first hole (never on top of one) or centred.
   4. REACH — a hole the user cannot see is a dead end (a commit row half
      under the status bar, a chip scrolled under the top bar), so:
      - REVEAL: for a moment after a step starts and after every refresh of
        its targets, each scroll container that holds targets is scrolled so
        they show — the step's first target (a drag's source) always, the
        rest while they still fit beside it (`revealDelta`). Never during a
        drag, and a wheel / press by the user ends it at once.
      - WHEEL: a wheel over the dimmed area scrolls whatever scrolls beneath
        it (the graph, a file list), so the user can still look around;
        clicks there stay swallowed.
      - DRAG: `dragover` on the dimmed area is handed to the scroll container
        beneath (not to the element under it, which must not light up as a
        drop target), so the graph's edge auto-scroll keeps working while a
        drag passes over the dim; a drop there is still refused.

  Geometry lives in ./overlayGeometry.ts so it can be unit-tested as numbers.
-->
<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { t } from '../../lib/i18n/index.svelte';
  import type { MessageKey } from '../../lib/i18n/messages';
  import type { TutorialPresentation } from '../../lib/tutorial/types';
  import {
    holePath,
    ringPath,
    prepareHoles,
    placeCard,
    revealDelta,
    type Rect,
    type Size,
  } from './overlayGeometry';

  /** Padding around each target, and the hole's corner radius (px). */
  const PAD = 6;
  const RADIUS = 8;
  const CARD_W = 340;
  /** How long after a step (or its targets) changed the overlay keeps
   *  scrolling the targets into view: long enough for a graph refresh to
   *  render and a smooth scroll to land. */
  const REVEAL_MS = 1500;
  /** Card height assumed until the real one has been measured. */
  const CARD_H_GUESS = 200;
  const MODIFIER_KEYS = new Set(['Shift', 'Alt', 'Meta', 'Control']);
  /** Keys that press a focused button (inside the card or a hole). */
  const PRESS_KEYS = new Set(['Enter', ' ']);
  /** What the keyboard can land on (before the disabled / hidden filters). */
  const FOCUSABLE =
    'a[href], button, input, select, textarea, summary, [tabindex], ' +
    '[contenteditable]:not([contenteditable="false"])';
  /** Controls Enter / Space may press inside a hole. */
  const PRESSABLE =
    'button, [role="button"], [role="tab"], [role="menuitem"], a[href], ' +
    'input[type="checkbox"], input[type="radio"]';

  let {
    presentation,
    error = null,
    onNext,
    onBack,
    onPrimary,
    primaryLabelKey,
    onRetry,
    onExit,
    root = document,
  }: {
    presentation: TutorialPresentation;
    /** A failed setup/operation message; shows Retry and holds Next. */
    error?: string | null;
    onNext: () => void;
    onBack: () => void;
    /** An extra call-to-action in the card (e.g. "Create demo repo"). */
    onPrimary?: () => void;
    /** i18n key for the primary button's label. */
    primaryLabelKey?: string;
    onRetry: () => void;
    /** Called only after the user confirms the inline "Exit tutorial?". */
    onExit: () => void;
    /** Where target selectors are resolved. Defaults to the document. */
    root?: Document | HTMLElement;
  } = $props();

  let rects = $state.raw<Rect[]>([]);
  /** What the card must not cover inside a big hole (see `placeCard`). */
  let avoidRects = $state.raw<Rect[]>([]);
  let viewport = $state<Size>({
    w: window.innerWidth,
    h: window.innerHeight,
  });
  let cardEl = $state<HTMLElement | null>(null);
  let cardH = $state(0);
  let cancelExitBtn = $state<HTMLButtonElement | null>(null);
  let confirmingExit = $state(false);

  // ── rect tracking ─────────────────────────────────────────────────────────

  function queryAll(selector: string): Element[] {
    try {
      return Array.from(root.querySelectorAll(selector));
    } catch {
      return []; // a malformed selector must not take the overlay down
    }
  }

  function sameRects(a: Rect[], b: Rect[]): boolean {
    return (
      a.length === b.length &&
      a.every(
        (r, i) =>
          r.x === b[i].x && r.y === b[i].y && r.w === b[i].w && r.h === b[i].h,
      )
    );
  }

  /** Re-read every target's box; only touches state when something moved. */
  function measure(): void {
    const next: Rect[] = [];
    for (const selector of presentation.targets) {
      for (const el of queryAll(selector)) {
        const b = el.getBoundingClientRect();
        // Hidden / not-yet-rendered targets have an empty box: no hole.
        if (b.width > 0 && b.height > 0)
          next.push({ x: b.left, y: b.top, w: b.width, h: b.height });
      }
    }
    if (!sameRects(next, rects)) rects = next;
    const avoid = measureAvoid(next);
    if (!sameRects(avoid, avoidRects)) avoidRects = avoid;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w !== viewport.w || h !== viewport.h) viewport = { w, h };
  }

  /** What the user reads or presses inside a big hole: graph chips, nodes
   *  and crown, and any control (a details panel's popover item). */
  const MARKS =
    '[data-tutorial-branch], div[data-tutorial-commit], ' +
    '[data-tutorial="head-crown"], button, input, textarea, select, ' +
    '[role="button"], [role="menuitem"]';

  /** The card's no-go list: every small target, plus — when a target is as
   *  big as a quarter of the window (the whole graph, a details panel) — the
   *  marks and controls on screen inside it (not full-width ones like a
   *  graph row, which no spot could avoid). Without big targets the holes
   *  alone steer the card. */
  function measureAvoid(targets: Rect[]): Rect[] {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const isBig = (r: Rect) => r.w * r.h > (vw * vh) / 4;
    const big = targets.filter(isBig);
    if (big.length === 0) return [];
    const out: Rect[] = targets.filter((r) => !isBig(r));
    for (const el of root.querySelectorAll(MARKS)) {
      if (el.closest('[data-tutorial-overlay]')) continue;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.bottom <= 0 || b.top >= vh) continue;
      if (b.right <= 0 || b.left >= vw) continue;
      const cx = b.left + b.width / 2;
      const cy = b.top + b.height / 2;
      const host = big.find(
        (r) => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h,
      );
      if (host && b.width <= host.w / 2)
        out.push({ x: b.left, y: b.top, w: b.width, h: b.height });
    }
    return out;
  }

  // A new step: re-measure at once rather than waiting for the next frame.
  $effect(() => {
    void presentation.targets;
    untrack(measure);
  });

  // The per-frame loop; cancelled on destroy.
  $effect(() => {
    let raf = 0;
    const tick = () => {
      measure();
      if (!dragging && performance.now() < revealUntil) reveal();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

  // ── reach: reveal, wheel, drag ────────────────────────────────────────────

  /** True between a page `dragstart` and its `dragend` / `drop`. */
  let dragging = false;
  /** `performance.now()` until which {@link reveal} runs every frame. */
  let revealUntil = 0;
  /** Scroll positions already asked of each container in this reveal
   *  window, so a smooth scroll in flight is not restarted every frame. */
  let issued = new Map<Element, { top: number; left: number }>();

  function canScroll(el: Element, axis: 'x' | 'y'): boolean {
    const st = getComputedStyle(el);
    const ov = axis === 'y' ? st.overflowY : st.overflowX;
    if (ov !== 'auto' && ov !== 'scroll' && ov !== 'overlay') return false;
    return axis === 'y'
      ? el.scrollHeight > el.clientHeight
      : el.scrollWidth > el.clientWidth;
  }

  /** The nearest element at or above `el` that scrolls (on either axis, or on
   *  the axis a wheel delta asks for); never the page itself. */
  function scrollerOf(
    el: Element | null,
    want: { x: number; y: number } | null = null,
  ): HTMLElement | null {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (!(n instanceof HTMLElement) || n === document.documentElement)
        continue;
      if (want) {
        if ((want.y && canScroll(n, 'y')) || (want.x && canScroll(n, 'x')))
          return n;
      } else if (canScroll(n, 'y') || canScroll(n, 'x')) return n;
    }
    return null;
  }

  /** The topmost page element at a point, looking through the overlay. */
  function elementBelow(x: number, y: number): Element | null {
    for (const el of document.elementsFromPoint(x, y))
      if (!el.closest('[data-tutorial-overlay]')) return el;
    return null;
  }

  function behavior(): ScrollBehavior {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
      ? 'auto'
      : 'smooth';
  }

  /** Scroll every container that holds targets so they show (see header). */
  function reveal(): void {
    const groups = new Map<HTMLElement, Rect[]>();
    for (const selector of presentation.targets) {
      for (const el of queryAll(selector)) {
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        const sc = scrollerOf(el.parentElement);
        if (!sc) continue;
        let list = groups.get(sc);
        if (!list) groups.set(sc, (list = []));
        list.push({ x: b.left, y: b.top, w: b.width, h: b.height });
      }
    }
    for (const [sc, boxes] of groups) {
      const b = sc.getBoundingClientRect();
      const x0 = Math.max(0, b.left + sc.clientLeft);
      let y0 = Math.max(0, b.top + sc.clientTop);
      const x1 = Math.min(
        window.innerWidth,
        b.left + sc.clientLeft + sc.clientWidth,
      );
      let y1 = Math.min(
        window.innerHeight,
        b.top + sc.clientTop + sc.clientHeight,
      );
      // Chrome floating over the container (the toolbar over the graph's
      // top rows) hides what is under it: shrink the view past it.
      for (const c of document.querySelectorAll('[data-tutorial-chrome]')) {
        const r = c.getBoundingClientRect();
        if (r.height === 0 || r.right <= x0 || r.left >= x1) continue;
        if (r.bottom <= y0 || r.top >= y1) continue;
        if (r.top + r.height / 2 < (y0 + y1) / 2) y0 = Math.max(y0, r.bottom);
        else y1 = Math.min(y1, r.top);
      }
      if (x1 <= x0 || y1 <= y0) continue;
      const { dx, dy } = revealDelta(boxes, {
        x: x0,
        y: y0,
        w: x1 - x0,
        h: y1 - y0,
      });
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      const top = Math.round(sc.scrollTop + dy);
      const left = Math.round(sc.scrollLeft + dx);
      const prev = issued.get(sc);
      if (
        prev &&
        Math.abs(prev.top - top) < 2 &&
        Math.abs(prev.left - left) < 2
      )
        continue;
      issued.set(sc, { top, left });
      sc.scrollTo({ top, left, behavior: behavior() });
    }
  }

  // A new step, or its targets re-resolved after a refresh: reveal again.
  $effect(() => {
    void presentation.id;
    void presentation.index;
    void presentation.targets;
    untrack(() => {
      issued = new Map();
      revealUntil = performance.now() + REVEAL_MS;
    });
  });

  /** The user is steering: stop moving the view under them. */
  function stopReveal(): void {
    revealUntil = 0;
  }

  /** A wheel over the dim scrolls what is beneath it (never the page). */
  function onDimWheel(e: WheelEvent): void {
    stopReveal();
    const sc = scrollerOf(elementBelow(e.clientX, e.clientY), {
      x: e.deltaX,
      y: e.deltaY,
    });
    if (!sc) return;
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? sc.clientHeight : 1;
    sc.scrollBy({ left: e.deltaX * k, top: e.deltaY * k });
  }

  /** The container the last forwarded `dragover` went to. */
  let dragFeed: HTMLElement | null = null;

  /** A drag over the dim: hand its position to the scroll container beneath
   *  (its edge auto-scroll listens there) — not to the element under the
   *  pointer, which must not become a drop target. Leaving every container
   *  tells the last one, so its auto-scroll stops. */
  function onDimDragOver(e: DragEvent): void {
    const sc = scrollerOf(elementBelow(e.clientX, e.clientY));
    const init: DragEventInit = {
      bubbles: false,
      cancelable: true,
      clientX: e.clientX,
      clientY: e.clientY,
      screenX: e.screenX,
      screenY: e.screenY,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
      dataTransfer: e.dataTransfer,
    };
    if (dragFeed && dragFeed !== sc)
      dragFeed.dispatchEvent(new DragEvent('dragleave', init));
    dragFeed = sc;
    sc?.dispatchEvent(new DragEvent('dragover', init));
  }

  function onDragStart(): void {
    dragging = true;
    stopReveal();
  }
  function onDragEnd(): void {
    dragging = false;
    dragFeed = null;
  }

  // ── derived geometry ──────────────────────────────────────────────────────

  const holes = $derived(prepareHoles(rects, viewport, PAD));
  const dimPath = $derived(holePath(rects, viewport, PAD, RADIUS));
  const ring = $derived(ringPath(rects, viewport, PAD, RADIUS));
  const centred = $derived(
    presentation.placement === 'center' || holes.length === 0,
  );
  /** Every target on its own (padded, not merged): the card's last-resort
   *  placement weighs what it would cover per target. */
  const paddedTargets = $derived(
    rects.map((r) => ({
      x: r.x - PAD,
      y: r.y - PAD,
      w: r.w + 2 * PAD,
      h: r.h + 2 * PAD,
    })),
  );
  const placement = $derived(
    placeCard(
      centred ? [] : holes,
      { w: CARD_W, h: cardH || CARD_H_GUESS },
      viewport,
      { targets: paddedTargets, avoid: avoidRects },
    ),
  );
  const progress = $derived(
    presentation.total > 0
      ? Math.min(
          100,
          Math.max(0, (presentation.index / presentation.total) * 100),
        )
      : 0,
  );
  const hintKey = $derived(
    (presentation.hintKey ?? 'tutorialUi.blockedHint') as MessageKey,
  );

  // ── input guard ───────────────────────────────────────────────────────────

  function elementOf(e: Event): Element | null {
    return e.target instanceof Element ? e.target : null;
  }

  /** Is `el` (or an ancestor) one of the current step's targets? */
  function inHole(el: Element): boolean {
    return presentation.targets.some((selector) => {
      try {
        return el.closest(selector) !== null;
      } catch {
        return false;
      }
    });
  }

  function inCard(el: Element): boolean {
    return cardEl !== null && cardEl.contains(el);
  }

  function isTextField(el: Element): boolean {
    return (
      el.closest(
        'input, textarea, [contenteditable]:not([contenteditable="false"])',
      ) !== null
    );
  }

  /** Not `display:none` (itself or an ancestor), not `visibility:hidden`. */
  function isShown(el: HTMLElement): boolean {
    const own = getComputedStyle(el);
    if (own.visibility === 'hidden' || own.visibility === 'collapse')
      return false;
    for (let n: Element | null = el; n; n = n.parentElement)
      if (getComputedStyle(n).display === 'none') return false;
    return true;
  }

  function isTabbable(el: HTMLElement): boolean {
    if ((el as HTMLButtonElement).disabled) return false;
    if (el instanceof HTMLInputElement && el.type === 'hidden') return false;
    // `tabindex="-1"` is focusable by script only.
    if (el.hasAttribute('tabindex') && el.tabIndex < 0) return false;
    if (el.closest('[inert], [hidden]')) return false;
    return isShown(el);
  }

  /** Everything Tab may visit, in document order: the card's controls and the
   *  controls inside the holes. Never anything else. */
  function tabbables(): HTMLElement[] {
    const found = new Set<HTMLElement>();
    const collect = (scope: Element) => {
      const all = [
        ...(scope.matches(FOCUSABLE) ? [scope] : []),
        ...scope.querySelectorAll(FOCUSABLE),
      ];
      for (const el of all)
        if (el instanceof HTMLElement && isTabbable(el)) found.add(el);
    };
    if (cardEl) collect(cardEl);
    for (const selector of presentation.targets)
      for (const el of queryAll(selector)) collect(el);
    return [...found].sort((a, b) =>
      a === b
        ? 0
        : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
          ? -1
          : 1,
    );
  }

  /** Tab / Shift+Tab: step to the neighbour inside {@link tabbables}, wrapping
   *  at both ends. From anywhere else (body, a control that left the page)
   *  Tab enters at the first control and Shift+Tab at the last. */
  function cycleFocus(from: Element | null, backwards: boolean): void {
    const items = tabbables();
    if (items.length === 0) return;
    let i = from
      ? items.findIndex((it) => it === from || it.contains(from))
      : -1;
    if (i < 0) i = backwards ? 0 : items.length - 1;
    const n = items.length;
    items[(i + (backwards ? n - 1 : 1)) % n].focus();
  }

  /**
   * Capture-phase keyboard guard. Everything is swallowed (default prevented
   * and the event stopped before any app listener sees it) except:
   *  - modifier keys themselves (Alt/Shift-drag needs them);
   *  - Tab / Shift+Tab, which we run ourselves ({@link cycleFocus});
   *  - Enter/Space on a control in the coach card: the browser's default
   *    (the button press) still runs, but the key never reaches the app's
   *    shortcut handler (a confirm dialog behind the card listens for Enter);
   *  - typing into an input/textarea/contenteditable inside a hole or the card;
   *  - the step's `allowKeys`, when the event happens inside a hole (which
   *    includes a dialog that is itself a hole target) or the card;
   *  - Enter/Space on a button-like control inside a hole: default runs (the
   *    click goes through the app's own tutorial gate), the app's key
   *    handlers don't see it.
   */
  function onKey(e: KeyboardEvent): void {
    if (e.type === 'keydown' && e.key === 'Escape' && confirmingExit) {
      confirmingExit = false;
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (MODIFIER_KEYS.has(e.key)) return;
    const el = elementOf(e);
    if (e.key === 'Tab') {
      // Never the browser's own focus move: it could leave the holes.
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === 'keydown') cycleFocus(el, e.shiftKey);
      return;
    }
    const inside = el !== null && (inHole(el) || inCard(el));
    if (el && inCard(el) && PRESS_KEYS.has(e.key)) {
      e.stopImmediatePropagation();
      return;
    }
    if (el && inside && isTextField(el)) return;
    if (inside && presentation.allowKeys?.includes(e.key)) return;
    if (
      el &&
      inHole(el) &&
      PRESS_KEYS.has(e.key) &&
      el.closest(PRESSABLE) !== null
    ) {
      e.stopImmediatePropagation();
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  /** Context menus are only for the highlighted controls. */
  function onContextMenu(e: Event): void {
    const el = elementOf(e);
    if (el && inHole(el)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  $effect(() => {
    const opts = { capture: true };
    window.addEventListener('keydown', onKey, opts);
    window.addEventListener('keyup', onKey, opts);
    window.addEventListener('contextmenu', onContextMenu, opts);
    window.addEventListener('dragstart', onDragStart, opts);
    window.addEventListener('dragend', onDragEnd, opts);
    window.addEventListener('drop', onDragEnd, opts);
    window.addEventListener('pointerdown', stopReveal, opts);
    // A wheel inside a hole scrolls natively: the user is steering too.
    const passive = { capture: true, passive: true };
    window.addEventListener('wheel', stopReveal, passive);
    return () => {
      window.removeEventListener('wheel', stopReveal, passive);
      window.removeEventListener('dragstart', onDragStart, opts);
      window.removeEventListener('dragend', onDragEnd, opts);
      window.removeEventListener('drop', onDragEnd, opts);
      window.removeEventListener('pointerdown', stopReveal, opts);
      window.removeEventListener('keydown', onKey, opts);
      window.removeEventListener('keyup', onKey, opts);
      window.removeEventListener('contextmenu', onContextMenu, opts);
    };
  });

  // ── coach card ────────────────────────────────────────────────────────────

  // A new step starts without a stale "Exit tutorial?" prompt.
  $effect(() => {
    void presentation.id;
    void presentation.index;
    confirmingExit = false;
  });

  /** The card's main button: primary, else Next, else Exit (the first one
   *  that exists and is enabled). */
  function mainButton(): HTMLButtonElement | null {
    for (const cls of ['btn-primary', 'btn-next', 'btn-exit']) {
      const b = cardEl?.querySelector<HTMLButtonElement>(`button.${cls}`);
      if (b && !b.disabled) return b;
    }
    return null;
  }

  /**
   * Hand keyboard focus to the card. `force` (a new step, or the exit prompt
   * closing) always does; otherwise (a setup just finished) only when focus
   * has nowhere better to be — on the page body, or parked on Exit while the
   * real buttons were disabled. Never while the user is inside a hole
   * (typing a commit message) and never over the exit prompt.
   */
  function placeFocus(force: boolean): void {
    if (!cardEl || !cardEl.isConnected || confirmingExit) return;
    const active = document.activeElement;
    if (active && active !== document.body && inHole(active)) return;
    if (!force) {
      const idle =
        !active ||
        active === document.body ||
        (inCard(active) && active.classList.contains('btn-exit'));
      if (!idle) return;
    }
    mainButton()?.focus();
  }

  // A new step (or the overlay's first paint): focus the card so a keyboard
  // user can reach Create demo / Next / Exit. When a step's setup finishes
  // the buttons were disabled until then, so look again.
  let focusedStep = '';
  $effect(() => {
    const step = `${presentation.id}#${presentation.index}`;
    void presentation.busy;
    untrack(() => {
      const changed = step !== focusedStep;
      focusedStep = step;
      // After the DOM caught up (`bind:this`, the confirm prompt closing).
      void tick().then(() => placeFocus(changed));
    });
  });

  // Put keyboard focus on the safe choice when the confirm opens; hand it
  // back to the card when it closes (the button that had it is gone).
  let wasConfirming = false;
  $effect(() => {
    if (confirmingExit) {
      wasConfirming = true;
      cancelExitBtn?.focus();
    } else if (wasConfirming) {
      wasConfirming = false;
      untrack(() => void tick().then(() => placeFocus(true)));
    }
  });

  const nextDisabled = $derived(presentation.busy || error !== null);
</script>

<!-- `data-tutorial-targets`: the live hole selectors, so the e2e walkthrough
     can assert every one is on screen and hit-testable before it acts. -->
<div
  class="tutorial-overlay"
  data-tutorial-overlay
  data-tutorial-targets={JSON.stringify(presentation.targets)}
>
  <svg class="spot" style="pointer-events:none" aria-hidden="true">
    <!-- A click out here is swallowed. Its mousedown must not also blur the
         focused control, or a keyboard user who misclicks loses their place.
         (The whole svg is aria-hidden: it is not an interactive element.) -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <path
      class="dim"
      d={dimPath}
      fill-rule="evenodd"
      style="pointer-events:fill"
      onmousedown={(e) => e.preventDefault()}
      onwheel={onDimWheel}
      ondragover={onDimDragOver}
    />
    <path class="ring" d={ring} fill="none" style="pointer-events:none" />
  </svg>

  <div
    class="card"
    data-side={placement.side}
    role="dialog"
    aria-label={t('tutorialUi.dialogLabel')}
    bind:this={cardEl}
    bind:offsetHeight={cardH}
    style="width:min({CARD_W}px, calc(100vw - 24px)); left:{placement.left}px; top:{placement.top}px"
  >
    <header class="head">
      <span
        class="counter"
        title={t('tutorialUi.progressLabel', {
          index: presentation.index,
          total: presentation.total,
        })}>{presentation.index} / {presentation.total}</span
      >
      <div
        class="progress"
        role="progressbar"
        aria-label={t('tutorialUi.progressLabel', {
          index: presentation.index,
          total: presentation.total,
        })}
        aria-valuemin="0"
        aria-valuemax={presentation.total}
        aria-valuenow={presentation.index}
      >
        <span class="progress-fill" style="width:{progress}%"></span>
      </div>
    </header>

    <h2 class="title">{t(presentation.titleKey as MessageKey)}</h2>
    <div class="body" aria-live="polite">
      <p class="text">{t(presentation.bodyKey as MessageKey)}</p>
      {#if presentation.blocked}
        <p class="hint">{t(hintKey)}</p>
      {/if}
    </div>

    {#if presentation.busy}
      <p class="busy" role="status">
        <span class="spinner" aria-hidden="true"></span>
        {t('tutorialUi.working')}
      </p>
    {/if}

    {#if error}
      <div class="error-row">
        <p class="error" role="alert">{error}</p>
        <button
          class="btn btn-retry"
          onclick={onRetry}
          disabled={presentation.busy}>{t('tutorialUi.retry')}</button
        >
      </div>
    {/if}

    {#if confirmingExit}
      <div
        class="confirm"
        role="group"
        aria-label={t('tutorialUi.exitConfirmTitle')}
      >
        <p class="confirm-title">{t('tutorialUi.exitConfirmTitle')}</p>
        <p class="confirm-body">{t('tutorialUi.exitConfirmBody')}</p>
        <div class="actions">
          <button
            class="btn btn-exit-cancel"
            bind:this={cancelExitBtn}
            onclick={() => (confirmingExit = false)}
            >{t('tutorialUi.exitKeep')}</button
          >
          <button class="btn danger btn-exit-confirm" onclick={onExit}
            >{t('tutorialUi.exitConfirm')}</button
          >
        </div>
      </div>
    {:else}
      <div class="actions">
        <button
          class="btn link btn-exit"
          onclick={() => (confirmingExit = true)}>{t('tutorialUi.exit')}</button
        >
        <span class="spacer"></span>
        {#if presentation.canGoBack}
          <button
            class="btn btn-back"
            onclick={onBack}
            disabled={presentation.busy}>{t('tutorialUi.back')}</button
          >
        {/if}
        {#if presentation.mode === 'info'}
          <button
            class="btn primary btn-next"
            onclick={onNext}
            disabled={nextDisabled}>{t('tutorialUi.next')}</button
          >
        {/if}
        {#if onPrimary}
          <button
            class="btn primary btn-primary"
            onclick={onPrimary}
            disabled={presentation.busy}
            >{primaryLabelKey
              ? t(primaryLabelKey as MessageKey)
              : t('tutorialUi.continue')}</button
          >
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  /* Above dialogs (40), commit-details popovers (44/45), settings (30) and the
     graph focus ring (50); below the crash window (60). */
  .tutorial-overlay {
    position: fixed;
    inset: 0;
    z-index: 55;
    pointer-events: none;
  }
  .spot {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  .dim {
    fill: var(--tutorial-dim, rgba(8, 12, 24, 0.58));
  }
  .ring {
    stroke: var(--select-ring, #2f9bf0);
    stroke-width: 2.5;
  }

  .card {
    position: absolute;
    box-sizing: border-box;
    max-height: calc(100vh - 24px);
    overflow-y: auto;
    pointer-events: auto;
    background: var(--panel-bg);
    color: var(--fg);
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    box-shadow: var(--panel-shadow);
    padding: 14px 16px 12px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }
  .counter {
    flex: 0 0 auto;
    font-size: 11px;
    font-weight: 600;
    color: var(--fg-muted);
    font-variant-numeric: tabular-nums;
  }
  .progress {
    flex: 1 1 auto;
    height: 4px;
    border-radius: 2px;
    background: var(--row-hover);
    overflow: hidden;
  }
  .progress-fill {
    display: block;
    height: 100%;
    background: var(--select-ring);
    transition: width 0.2s ease;
  }
  .title {
    margin: 0 0 6px;
    font-size: 15px;
    font-weight: 600;
    line-height: 1.35;
  }
  .body {
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--fg-soft);
  }
  .body p {
    margin: 0 0 8px;
  }
  .hint {
    padding: 6px 8px;
    border-radius: 6px;
    background: var(--row-selected);
    color: var(--fg);
  }
  .busy {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 8px;
    font-size: 12px;
    color: var(--fg-soft);
  }
  .spinner {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid var(--panel-border);
    border-top-color: var(--select-ring);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .error-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 8px;
  }
  .error {
    flex: 1 1 auto;
    margin: 0;
    font-size: 12px;
    color: #b91c1c;
    overflow-wrap: anywhere;
  }
  .confirm {
    margin-top: 4px;
    padding-top: 10px;
    border-top: 1px solid var(--panel-border);
  }
  .confirm-title {
    margin: 0 0 4px;
    font-size: 13px;
    font-weight: 600;
  }
  .confirm-body {
    margin: 0 0 10px;
    font-size: 12px;
    line-height: 1.45;
    color: var(--fg-soft);
  }
  .actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 6px;
  }
  .spacer {
    flex: 1 1 auto;
  }
  .btn {
    height: 30px;
    padding: 0 14px;
    border: 0;
    border-radius: 8px;
    background: var(--row-hover);
    color: var(--fg);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .btn.primary {
    background: var(--select-ring);
    color: #fff;
  }
  .btn.danger {
    background: #dc2626;
    color: #fff;
  }
  .btn.link {
    padding: 0 4px;
    background: transparent;
    color: var(--fg-muted);
    font-size: 12px;
  }
  .btn.link:hover {
    color: var(--fg);
    text-decoration: underline;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .btn:focus-visible {
    outline: 2px solid var(--select-ring);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation-duration: 2.4s;
    }
    .progress-fill {
      transition: none;
    }
  }
</style>
