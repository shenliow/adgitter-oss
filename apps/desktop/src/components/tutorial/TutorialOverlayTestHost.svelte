<!--
  Test-only harness for TutorialOverlay.test.ts.

  Svelte 5's `mount()` props are captured once and aren't reactive from the
  outside, so this host owns `presentation` / `error` as real `$state` and
  exposes setters — letting a test move an already-mounted overlay to the next
  step (the engine does exactly that) without unmounting it.
-->
<script lang="ts">
  import TutorialOverlay from './TutorialOverlay.svelte';
  import type { TutorialPresentation } from '../../lib/tutorial/types';

  let {
    initial,
    onExit = () => {},
  }: {
    initial: TutorialPresentation;
    onExit?: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let presentation = $state.raw<TutorialPresentation>(initial);
  let error = $state<string | null>(null);

  export function setPresentation(p: TutorialPresentation) {
    presentation = p;
  }
  export function setError(e: string | null) {
    error = e;
  }
</script>

<TutorialOverlay
  {presentation}
  {error}
  onNext={() => {}}
  onBack={() => {}}
  onRetry={() => {}}
  {onExit}
/>
