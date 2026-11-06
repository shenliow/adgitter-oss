<!--
  Customizable shortcuts. Click a binding, then press a combo to set it;
  conflicts are flagged. "Restore defaults" clears all overrides. Edits the draft
  keymap-overrides map in place.
-->
<script lang="ts">
  import {
    KEY_ACTIONS,
    DEFAULT_KEYMAP,
    effectiveKeymap,
    comboFromEvent,
    conflicts,
  } from '../../lib/keymap';
  import { t } from '../../lib/i18n/index.svelte';

  let { value = $bindable() }: { value: Record<string, string> } = $props();

  let capturing = $state<string | null>(null);
  // bind:this targets, keyed by action id, so capture can .focus() the row
  // it just entered and the outside-click canceler can tell "this button"
  // from "somewhere else".
  let buttons: Record<string, HTMLButtonElement> = $state({});

  const effective = $derived(effectiveKeymap(value));
  const conflicting = $derived(new Set(conflicts(effective)));

  function capture(e: KeyboardEvent, actionId: string) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      capturing = null;
      return;
    }
    const combo = comboFromEvent(e);
    if (!combo) return; // bare modifier — keep waiting
    if (combo === DEFAULT_KEYMAP[actionId]) delete value[actionId];
    else value[actionId] = combo;
    capturing = null;
  }

  function startCapture(actionId: string) {
    capturing = actionId;
    // Clicking a <button> does not give it DOM focus in WKWebView (Tauri's
    // macOS webview) the way it does in Chromium — see the `$effect` below
    // for why capture no longer depends on focus at all. This call is only
    // to keep the focus ring in sync with capture state for keyboard users.
    buttons[actionId]?.focus();
  }

  // Capture used to be driven by the combo button's own `onkeydown`, which
  // requires the button to hold DOM focus. WKWebView doesn't focus a
  // <button> on click, so once `capturing` was set, keystrokes went to
  // document.body and the handler never ran. Listening on `window` instead
  // makes capture independent of who currently has focus.
  //
  // Registered on the *capture* phase specifically: App.svelte's global
  // shortcut dispatcher is a `<svelte:window onkeydown>`, which binds in the
  // default (bubble) phase. A capture-phase listener on `window` always runs
  // before a bubble-phase listener on `window`, regardless of where the
  // event originated, so stopPropagation() here (inside `capture()`) reaches
  // the keystroke first and keeps the app from also firing e.g. "new branch"
  // while the user is mid-rebind of that same combo.
  $effect(() => {
    if (!capturing) return;
    const actionId = capturing;

    function onWindowKeydown(e: KeyboardEvent) {
      capture(e, actionId);
    }

    // A click outside the row being captured cancels capture, same as
    // Escape. Without this, clicking anywhere other than a shortcut row
    // (the panel background, Restore defaults, the modal's own close
    // button) would leave this listener bound and swallow every keystroke
    // in the app until some other row happened to be clicked.
    function onWindowPointerdown(e: PointerEvent) {
      if (e.target !== buttons[actionId]) capturing = null;
    }

    window.addEventListener('keydown', onWindowKeydown, true);
    window.addEventListener('pointerdown', onWindowPointerdown, true);
    return () => {
      window.removeEventListener('keydown', onWindowKeydown, true);
      window.removeEventListener('pointerdown', onWindowPointerdown, true);
    };
  });

  function restoreDefaults() {
    for (const k of Object.keys(value)) delete value[k];
    capturing = null;
  }
</script>

<div class="panel">
  <div class="rows">
    {#each KEY_ACTIONS as a (a.id)}
      <div class="row">
        <span class="label">{t(a.labelKey)}</span>
        <button
          class="combo"
          bind:this={buttons[a.id]}
          class:capturing={capturing === a.id}
          class:conflict={conflicting.has(effective[a.id])}
          onclick={() => startCapture(a.id)}
        >
          {capturing === a.id ? t('shortcut.pressKeys') : effective[a.id]}
        </button>
      </div>
    {/each}
  </div>

  {#if conflicting.size > 0}
    <p class="warn">{t('shortcut.conflict')}</p>
  {/if}

  <button class="restore" onclick={restoreDefaults}
    >{t('shortcut.restoreDefaults')}</button
  >
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .rows {
    display: flex;
    flex-direction: column;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 0;
    font-size: 13px;
    border-bottom: 1px solid var(--row-line);
  }
  .combo {
    min-width: 130px;
    height: 26px;
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    background: var(--panel-bg);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    color: var(--fg);
  }
  .combo.capturing {
    border-color: var(--select-ring);
    color: var(--fg-muted);
  }
  .combo.conflict {
    border-color: #e0533d;
    color: #e0533d;
  }
  .warn {
    margin: 0;
    font-size: 12px;
    color: #e0533d;
  }
  .restore {
    align-self: flex-start;
    border: 0;
    background: var(--row-hover);
    color: var(--fg);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
  }
</style>
