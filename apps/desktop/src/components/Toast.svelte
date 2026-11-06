<!--
  Transient status/error toast. A `notice` auto-dismisses after
  `duration` ms, showing a countdown bar that shrinks to 0 along the way; when
  it empties, the toast fades out and `onDismiss` fires. An `error` passes
  duration=0 to stay until dismissed by hand (no bar, no fade).

  The fade is a plain CSS opacity transition (a `.leaving` class), NOT a Svelte
  `transition:` — the latter needs the Web Animations API (`element.animate`),
  which jsdom lacks, so it would break every component test that shows a toast.
-->
<script lang="ts">
  import { t } from '../lib/i18n/index.svelte';
  import Icon from '../lib/icons/Icon.svelte';

  const FADE_MS = 220;

  let {
    message,
    kind = 'notice',
    duration = 4000,
    placement = 'top',
    onDismiss = () => {},
  }: {
    message: string;
    kind?: 'notice' | 'error';
    /** Auto-dismiss delay in ms; 0 (or less) never auto-dismisses. */
    duration?: number;
    /** Top (default) or bottom of the host. The guided tutorial moves errors
     *  to the bottom so they never cover the toolbar a step points at. */
    placement?: 'top' | 'bottom';
    onDismiss?: () => void;
  } = $props();

  let leaving = $state(false);
  let dismiss: ReturnType<typeof setTimeout> | undefined;
  let fade: ReturnType<typeof setTimeout> | undefined;

  // (Re)start the countdown whenever the message or duration changes — a fresh
  // notice restarts the full timer rather than inheriting the previous one's
  // remaining time. Phase 1 (at `duration`) begins the fade; phase 2 (after
  // the fade) removes it. Cleared on unmount.
  $effect(() => {
    void message;
    void duration;
    clearTimeout(fade);
    clearTimeout(dismiss);
    leaving = false;
    if (duration > 0) {
      fade = setTimeout(() => (leaving = true), duration);
      dismiss = setTimeout(() => onDismiss(), duration + FADE_MS);
    }
    return () => {
      clearTimeout(fade);
      clearTimeout(dismiss);
    };
  });
</script>

<div
  class="toast {kind}"
  class:leaving
  class:bottom={placement === 'bottom'}
  role={kind === 'error' ? 'alert' : 'status'}
  style="--fade-ms:{FADE_MS}ms"
>
  <div class="row">
    <strong>{message}</strong>
    <button onclick={() => onDismiss()} aria-label={t('common.dismiss')}
      ><Icon name="close" size={12} /></button
    >
  </div>
  {#if duration > 0}
    <!-- Keyed on the message so a replacement notice restarts the shrink. -->
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
  .toast {
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 12;
    min-width: 220px;
    max-width: min(90vw, 520px);
    background: #fee2e2;
    color: #991b1b;
    border: 1px solid #fecaca;
    border-radius: 8px;
    font-size: 12px;
    box-shadow: var(--panel-shadow);
    overflow: hidden;
    opacity: 1;
    transition: opacity var(--fade-ms) ease;
  }
  .toast.bottom {
    top: auto;
    bottom: 8px;
  }
  .toast.leaving {
    opacity: 0;
  }
  .toast.notice {
    background: #dcfce7;
    color: #166534;
    border-color: #bbf7d0;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 14px;
  }
  .toast button {
    border: 0;
    background: transparent;
    color: inherit;
    font-size: 16px;
    cursor: pointer;
    line-height: 1;
  }
  /* Countdown bar pinned to the bottom edge, shrinking left→right to empty
     over `duration`. A CSS keyframe animation (not the Web Animations API), so
     it's inert-but-harmless under jsdom. `forwards` holds it at 0. */
  .bar {
    height: 3px;
    transform-origin: left center;
    background: currentColor;
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
  /* Reduced-motion: no shrink; the toast still auto-dismisses on the timer. */
  @media (prefers-reduced-motion: reduce) {
    .bar {
      animation: none;
    }
  }
</style>
