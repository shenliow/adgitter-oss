<!--
  Generic confirm gate for history-rewriting gestures/menus.
  Every rewriting op routes through here before it runs, so the user always sees
  what will change (and, for reword, edits the new message) and can cancel. The
  whole grammar is undoable, but this is the "affects descendants" guard rail.
-->
<script lang="ts" module>
  /** Radio `name`s are document-wide, so each dialog instance needs its own. */
  let seq = 0;

  /** One controlled radio group: a set of candidates the caller must
   *  disambiguate before the op can run. A gesture can be ambiguous at more
   *  than one end at once (a merge drag whose *source* and *target* commits
   *  each carry several branches), so the dialog takes a list of these. */
  export interface ChoiceGroup {
    /** Legend — must say which end of the op this group picks. */
    label: string;
    /** Candidates in display order; ≤1 renders nothing (see `groups`). */
    choices: string[];
    /** The currently picked candidate — owned by the caller. */
    value: string;
    onChoose: (value: string) => void;
  }
</script>

<script lang="ts">
  import { t } from '../lib/i18n/index.svelte';
  const groupName = `confirm-choice-${seq++}`;
  let {
    title,
    body = '',
    confirmLabel = 'Confirm',
    danger = false,
    /** When set, shows a textarea and passes its value to onConfirm. */
    withMessage = false,
    defaultMessage = '',
    /** Ambiguous drop target: every candidate branch, display order. Rendered
     *  as a radio group only when there are ≥2 — one (or none) is not a
     *  choice and must not add a step. Controlled: the caller owns `choice`
     *  and updates it from `onChoose`, so the body copy above stays in sync
     *  with what will actually run.
     *  Shorthand for a single {@link ChoiceGroup}; pass `choiceGroups`
     *  instead when an op is ambiguous at more than one end. */
    choices = [],
    choiceLabel = '',
    choice = '',
    onChoose = () => {},
    /** General form: zero or more independent radio groups, rendered in the
     *  order given. Takes precedence over the flat `choices` props. */
    choiceGroups = [],
    busy = false,
    error = null,
    onConfirm,
    onCancel,
  }: {
    title: string;
    body?: string;
    confirmLabel?: string;
    danger?: boolean;
    withMessage?: boolean;
    defaultMessage?: string;
    choices?: string[];
    choiceLabel?: string;
    choice?: string;
    onChoose?: (value: string) => void;
    choiceGroups?: ChoiceGroup[];
    busy?: boolean;
    /** Inline failure from a previous confirm attempt (e.g. the IPC call
     * rejected). The dialog stays open — shown here so the caller can retry
     * or cancel without losing context. */
    error?: string | null;
    onConfirm: (message: string) => void;
    onCancel: () => void;
  } = $props();

  // The dialog is freshly mounted per op, so seeding from the initial prop is
  // intentional (not meant to track later changes).
  // svelte-ignore state_referenced_locally
  let message = $state(defaultMessage);
  /** The groups actually worth asking about: a single candidate is not a
   *  choice, so never make the user click through it. Both prop styles
   *  normalise to this one list, so one group and two render identically. */
  const groups = $derived(
    (choiceGroups.length
      ? choiceGroups
      : [{ label: choiceLabel, choices, value: choice, onChoose }]
    ).filter((g) => g.choices.length > 1),
  );
  const blocked = $derived(
    busy ||
      (withMessage && message.trim().length === 0) ||
      // Every ambiguous end must be resolved before the op can run.
      groups.some((g) => !g.choices.includes(g.value)),
  );

  function confirm() {
    if (blocked) return;
    onConfirm(message);
  }
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
    aria-label={title}
    data-tutorial="confirm-rewrite"
  >
    <h2>{title}</h2>
    {#if body}<p class="body">{body}</p>{/if}

    {#if withMessage}
      <!-- svelte-ignore a11y_autofocus -->
      <textarea
        class="message"
        rows="3"
        autofocus
        bind:value={message}
        placeholder={t('confirmRewrite.messagePlaceholder')}
        onkeydown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') confirm();
        }}
      ></textarea>
    {/if}

    <!-- One fieldset per ambiguous end. Each gets its own radio `name` so the
         groups can't steal each other's selection. -->
    {#each groups as group, i (group.label + i)}
      <fieldset class="choices">
        <legend>{group.label || t('confirmRewrite.chooseBranch')}</legend>
        {#each group.choices as name (name)}
          <label class="choice">
            <input
              type="radio"
              name={`${groupName}-${i}`}
              value={name}
              checked={group.value === name}
              disabled={busy}
              onchange={() => group.onChoose(name)}
            />
            <span>{name}</span>
          </label>
        {/each}
      </fieldset>
    {/each}

    <p class="note">{t('confirmRewrite.note')}</p>
    {#if error}<p class="err-msg" role="alert">{error}</p>{/if}

    <div class="actions">
      <button class="ghost" onclick={onCancel} disabled={busy}
        >{t('common.cancel')}</button
      >
      <button class="primary" class:danger disabled={blocked} onclick={confirm}>
        {busy ? '…' : confirmLabel}
      </button>
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
    width: 380px;
    max-width: calc(100vw - 32px);
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    box-shadow: var(--panel-shadow);
    padding: 18px;
  }
  h2 {
    margin: 0 0 8px;
    font-size: 15px;
    color: var(--fg);
  }
  .body {
    margin: 0 0 10px;
    font-size: 13px;
    color: var(--fg-soft);
    line-height: 1.4;
  }
  .message {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    padding: 8px;
    font: inherit;
    font-size: 13px;
    margin-bottom: 8px;
  }
  .choices {
    margin: 0 0 12px;
    padding: 8px 10px;
    border: 1px solid var(--panel-border);
    border-radius: 8px;
  }
  .choices legend {
    padding: 0 4px;
    font-size: 11px;
    color: var(--fg-soft);
  }
  .choice {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 0;
    font-size: 13px;
    color: var(--fg);
    cursor: pointer;
  }
  .choice input {
    margin: 0;
  }
  .note {
    margin: 0 0 14px;
    font-size: 11px;
    color: var(--fg-soft);
  }
  .err-msg {
    margin: 0 0 14px;
    font-size: 12px;
    color: #b91c1c;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
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
  .primary.danger {
    background: #b91c1c;
  }
  .actions button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
