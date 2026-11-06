<!--
  Branch "Properties" popup: rename the
  branch, set its upstream tracking ref, and set a per-branch lane color via the
  ColorPicker — all in one place. Opened by the graph branch-chip context menu.
  Confirm applies name + upstream + hex; Reset clears only the color override.
-->
<script lang="ts">
  import ColorPicker from './ColorPicker.svelte';
  import { t } from '../lib/i18n/index.svelte';

  let {
    branch,
    initial = '#3a86ff',
    upstream = null,
    remotes = [],
    onConfirm,
    onReset,
    onCancel,
  }: {
    branch: string;
    /** Current override hex, or the default lane color. */
    initial?: string;
    /** The branch's current upstream shorthand (e.g. "origin/main"), or null. */
    upstream?: string | null;
    /** Candidate upstreams: remote-tracking branch shorthands. */
    remotes?: string[];
    /** Fires with the (trimmed) name, chosen hex, and upstream (null = none). */
    onConfirm: (name: string, hex: string, upstream: string | null) => void;
    onReset: () => void;
    onCancel: () => void;
  } = $props();

  // Seeded once from the props; the dialog is remounted per branch.
  // svelte-ignore state_referenced_locally
  let name = $state(branch);
  // svelte-ignore state_referenced_locally
  let hex = $state(initial);
  // '' models "no upstream"; the <select> binds to this and maps back to null.
  // svelte-ignore state_referenced_locally
  let up = $state(upstream ?? '');

  const trimmed = $derived(name.trim());
  // A current upstream that isn't in `remotes` (e.g. its remote-tracking ref
  // was pruned) is still offered so we don't silently drop it.
  const upstreamOptions = $derived(
    upstream && !remotes.includes(upstream) ? [upstream, ...remotes] : remotes,
  );
  const confirm = () => onConfirm(trimmed, hex, up === '' ? null : up);
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape') onCancel();
  }}
/>

<div class="overlay">
  <button class="scrim" aria-label={t('common.cancel')} onclick={onCancel}
  ></button>
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-label={t('branchEdit.title')}
  >
    <div class="field">
      <span class="lbl" id="branch-edit-name-lbl">{t('branchEdit.name')}</span>
      <input
        class="val name-input"
        bind:value={name}
        aria-labelledby="branch-edit-name-lbl"
        onkeydown={(e) => {
          if (e.key === 'Enter' && trimmed) confirm();
        }}
      />
    </div>
    <div class="field">
      <span class="lbl" id="branch-edit-upstream-lbl"
        >{t('branchEdit.upstream')}</span
      >
      <select
        class="val up-input"
        bind:value={up}
        aria-labelledby="branch-edit-upstream-lbl"
      >
        <option value="">{t('branchEdit.upstreamNone')}</option>
        {#each upstreamOptions as r (r)}
          <option value={r}>{r}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <span class="lbl">{t('branchEdit.color')}</span>
      <code class="val">{hex}</code>
    </div>

    <ColorPicker bind:value={hex} />

    <div class="actions">
      <button class="ghost" onclick={onReset}>{t('common.reset')}</button>
      <span class="spacer"></span>
      <button class="ghost" onclick={onCancel}>{t('common.cancel')}</button>
      <button class="primary" disabled={!trimmed} onclick={confirm}
        >{t('common.confirm')}</button
      >
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .scrim {
    position: absolute;
    inset: 0;
    border: 0;
    padding: 0;
    background: rgba(0, 0, 0, 0.32);
    cursor: default;
  }
  .dialog {
    position: relative;
    z-index: 1;
    width: 264px;
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    box-shadow: var(--panel-shadow);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 13px;
  }
  .lbl {
    color: var(--fg-soft);
  }
  .val {
    font-weight: 600;
    color: var(--fg);
  }
  code.val {
    font-family: var(--mono);
    font-size: 12px;
  }
  .up-input {
    flex: 0 1 auto;
    width: 176px;
    height: 28px;
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    padding: 0 6px;
    font: inherit;
    font-size: 12px;
    background: transparent;
    color: var(--fg);
  }
  .name-input {
    flex: 0 1 auto;
    width: 160px;
    height: 26px;
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    padding: 0 8px;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    text-align: right;
    background: transparent;
    color: var(--fg);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .spacer {
    flex: 1;
  }
  .actions button {
    height: 30px;
    padding: 0 14px;
    border-radius: 8px;
    border: 0;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .ghost {
    background: var(--row-hover);
    color: var(--fg);
  }
  .primary {
    background: var(--select-ring);
    color: #fff;
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
