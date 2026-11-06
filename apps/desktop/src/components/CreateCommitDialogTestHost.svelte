<!--
  Test-only harness for CreateCommitDialog.test.ts.

  Svelte 5's `mount()` props are captured once and aren't reactive from the
  outside — only genuine component state is. To exercise "the parent bumps
  reloadKey after a focus-triggered refresh" on an *already-mounted* dialog
  (rather than unmount/remount, which would also reset the dialog's own
  checkbox state and defeat the point of the test), this host owns
  `reloadKey` as real `$state` and exposes `bump()` for the test to call.
-->
<script lang="ts">
  import CreateCommitDialog from './CreateCommitDialog.svelte';

  let {
    repoPath,
    onClose = () => {},
    onCommitted = () => {},
    onMutated = () => {},
  }: {
    repoPath: string;
    onClose?: () => void;
    onCommitted?: (sha: string) => void;
    onMutated?: () => void;
  } = $props();

  let reloadKey = $state(0);

  /** Simulate the parent's post-refresh bump of `filesReload`. */
  export function bump() {
    reloadKey += 1;
  }
</script>

<CreateCommitDialog
  {repoPath}
  {reloadKey}
  {onClose}
  {onCommitted}
  {onMutated}
/>
