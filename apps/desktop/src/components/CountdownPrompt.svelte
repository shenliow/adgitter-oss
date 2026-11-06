<!--
  Non-modal prompt with a countdown that answers itself.

  Used by the auto-pull gate's `notify` mode: it sits at the top of the host
  like a notice, does NOT trap focus or cover the app with a scrim, and after
  `seconds` it selects the primary answer (`onYes`) on its own. Yes / Skip /
  Cancel are all clickable while it counts down.

  NON-MODAL IS NOT FIRE-AND-FORGET: the caller's pending action still waits on
  one of the three callbacks. "Non-blocking" here means the UI is not blocked —
  the user can keep clicking around the app — not that the gated action
  proceeds without an answer. If it proceeded, auto-selecting Yes once the
  countdown expired would be answering a question that had already been
  decided.

  The countdown mechanics are lifted from `Toast.svelte` on purpose, including
  the two reasons that file documents:
   * the fade is a plain CSS opacity transition (a `.leaving` class), NOT a
     Svelte `transition:` — the latter needs the Web Animations API
     (`element.animate`), which jsdom lacks, so it would break every component
     test that renders this prompt;
   * the shrinking bar is a CSS keyframe animation, inert-but-harmless under
     jsdom.
  It is a sibling rather than a `Toast` prop because Toast has no actions and
  no decision to report; bolting three buttons and a tri-state callback onto it
  would change the markup every existing Toast caller renders.
-->
<script lang="ts">
  const FADE_MS = 220;

  let {
    message,
    seconds,
    yesLabel,
    skipLabel,
    cancelLabel,
    onYes,
    onSkip,
    onCancel,
  }: {
    message: string;
    /** Countdown length. Already clamped by `clampAutoPullSeconds`. */
    seconds: number;
    yesLabel: string;
    skipLabel: string;
    cancelLabel: string;
    /** Fired by a Yes click OR by the countdown expiring. */
    onYes: () => void;
    onSkip: () => void;
    onCancel: () => void;
  } = $props();

  const duration = $derived(Math.max(0, Math.round(seconds * 1000)));

  let leaving = $state(false);
  /** Set by whichever outcome lands first, so the expiry can never also fire. */
  let answered = false;
  let fade: ReturnType<typeof setTimeout> | undefined;
  let expire: ReturnType<typeof setTimeout> | undefined;

  // Same two-phase timer as Toast: phase 1 (at `duration`) begins the fade,
  // phase 2 (after the fade) delivers the answer. (Re)started when the message
  // or the duration changes; cleared on unmount, which is what makes a click
  // outcome final — the parent drops this component and the pending expiry
  // with it.
  $effect(() => {
    void message;
    void duration;
    clearTimeout(fade);
    clearTimeout(expire);
    leaving = false;
    if (duration > 0) {
      fade = setTimeout(() => (leaving = true), duration);
      expire = setTimeout(() => answer(onYes), duration + FADE_MS);
    }
    return () => {
      clearTimeout(fade);
      clearTimeout(expire);
    };
  });

  function answer(fn: () => void) {
    if (answered) return;
    answered = true;
    fn();
  }
</script>

<div
  class="prompt"
  class:leaving
  role="status"
  aria-live="polite"
  data-testid="autopull-countdown"
  style="--fade-ms:{FADE_MS}ms"
>
  <div class="row">
    <strong>{message}</strong>
    <div class="actions">
      <button
        class="primary"
        data-testid="autopull-yes"
        onclick={() => answer(onYes)}>{yesLabel}</button
      >
      <button data-testid="autopull-skip" onclick={() => answer(onSkip)}
        >{skipLabel}</button
      >
      <button data-testid="autopull-cancel" onclick={() => answer(onCancel)}
        >{cancelLabel}</button
      >
    </div>
  </div>
  {#if duration > 0}
    <!-- Keyed on the message so a replacement prompt restarts the shrink. -->
    {#key message}
      <div
        class="bar"
        style="animation-duration:{duration}ms"
        aria-hidden="true"
      ></div>
    {/key}
  {/if}
</div>

<style>
  /* Positioned like Toast (absolute, top-centred in the host) and with no
     scrim or focus trap — this is what "non-modal" means here. */
  .prompt {
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 13;
    min-width: 280px;
    max-width: min(92vw, 560px);
    background: var(--panel-bg);
    color: var(--fg);
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    font-size: 12px;
    box-shadow: var(--panel-shadow);
    overflow: hidden;
    opacity: 1;
    transition: opacity var(--fade-ms) ease;
  }
  .prompt.leaving {
    opacity: 0;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 8px 12px;
  }
  .actions {
    display: flex;
    gap: 6px;
    flex: none;
  }
  .actions button {
    height: 24px;
    padding: 0 10px;
    border-radius: 6px;
    border: 0;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    background: var(--row-hover);
    color: var(--fg);
  }
  .actions .primary {
    background: var(--select-ring);
    color: #fff;
  }
  /* Countdown bar pinned to the bottom edge, shrinking left→right to empty
     over `duration` — a CSS keyframe animation, not the Web Animations API. */
  .bar {
    height: 3px;
    transform-origin: left center;
    background: var(--select-ring);
    opacity: 0.45;
    animation-name: shrink;
    animation-timing-function: linear;
    animation-fill-mode: forwards;
  }
  @keyframes shrink {
    from {
      transform: scaleX(1);
    }
    to {
      transform: scaleX(0);
    }
  }
  /* Reduced-motion: no shrink; the prompt still answers itself on the timer. */
  @media (prefers-reduced-motion: reduce) {
    .bar {
      animation: none;
    }
  }
</style>
