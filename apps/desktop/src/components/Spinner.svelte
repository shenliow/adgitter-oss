<!--
  Busy indicator: a small rotating ring, sized to sit where an icon was.

  Shared on purpose. Several controls go busy by swapping their icon for a
  "working" marker (the toolbar's Push, and the Pull beside it), and each one
  rolling its own keyframes would drift in size and tempo. Callers render
  `<Spinner />` in place of their `<Icon />` and keep their own disabled state.

  It is a CSS keyframe animation, NOT a Svelte `transition:` or
  `element.animate()` — per the note in Toast.svelte, the Web Animations API is
  missing under jsdom, so either of those would break every component test that
  renders a busy control. A CSS animation is inert-but-harmless there.

  ACCESSIBILITY / REDUCED MOTION. The ring is decoration (`aria-hidden`): the
  busy state is carried by the host button's `aria-busy` and `disabled`, which
  is what assistive tech reads, so nothing depends on the animation being seen.
  Under `prefers-reduced-motion: reduce` the rotation stops entirely rather
  than merely slowing — a spinning loop is exactly the decorative motion that
  setting asks to be rid of. The ring itself stays visible and keeps its
  accented quarter, so "this control is working" is still perceivable: the
  control shows a ring where its icon used to be.
-->
<script lang="ts">
  let {
    size = 16,
  }: {
    /** Outer diameter in px. Defaults to the 16px toolbar icon size. */
    size?: number;
  } = $props();

  /** Ring thickness: 2px at the icon sizes in use, never below 1px. */
  const thickness = $derived(Math.max(1, Math.round(size / 8)));
</script>

<span
  class="spinner"
  data-testid="spinner"
  aria-hidden="true"
  style="width:{size}px; height:{size}px; border-width:{thickness}px"
></span>

<style>
  .spinner {
    display: inline-block;
    flex: none;
    box-sizing: border-box;
    border-radius: 50%;
    border-style: solid;
    border-color: var(--panel-border);
    border-top-color: var(--select-ring);
    animation: spinner-rotate 0.8s linear infinite;
  }
  @keyframes spinner-rotate {
    to {
      transform: rotate(360deg);
    }
  }
  /* Reduced-motion: no rotation. The ring stays put and stays visible, so the
     control still reads as busy (plus the host's `aria-busy`/`disabled`). */
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
    }
  }
</style>
