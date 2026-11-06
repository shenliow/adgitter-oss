<!--
  Welcome tour (tutorial steps 1–2): a centred modal shown on first
  launch. Page 1 introduces ADGitter's highlights; page 2 asks whether to take
  the interactive tutorial or use the app directly. There is deliberately no
  scrim-click / Escape dismissal: the user picks one of the two choices.
  Pure presentation — the two outcomes are callbacks.
-->
<script lang="ts">
  import { t } from '../../lib/i18n/index.svelte';
  import type { MessageKey } from '../../lib/i18n/messages';
  import Icon from '../../lib/icons/Icon.svelte';
  import type { IconName } from '../../lib/icons/windows';

  let {
    onStart,
    onUseDirectly,
  }: {
    /** "Start the interactive tutorial". */
    onStart: () => void;
    /** "Use ADGitter directly". */
    onUseDirectly: () => void;
  } = $props();

  const PAGES = 2;
  let page = $state(1);

  const CARDS: { icon: IconName; title: MessageKey; body: MessageKey }[] = [
    {
      icon: 'branch',
      title: 'welcomeTour.graph.title',
      body: 'welcomeTour.graph.body',
    },
    {
      icon: 'merge',
      title: 'welcomeTour.drag.title',
      body: 'welcomeTour.drag.body',
    },
    {
      icon: 'undo',
      title: 'welcomeTour.undo.title',
      body: 'welcomeTour.undo.body',
    },
    {
      icon: 'edit',
      title: 'welcomeTour.surgery.title',
      body: 'welcomeTour.surgery.body',
    },
    {
      icon: 'logAnytime',
      title: 'welcomeTour.logAnytime.title',
      body: 'welcomeTour.logAnytime.body',
    },
    {
      icon: 'view',
      title: 'welcomeTour.themes.title',
      body: 'welcomeTour.themes.body',
    },
    {
      icon: 'issues',
      title: 'welcomeTour.issues.title',
      body: 'welcomeTour.issues.body',
    },
  ];
</script>

<div class="overlay">
  <div class="scrim" aria-hidden="true"></div>
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-label={t('welcomeTour.title')}
  >
    {#if page === 1}
      <h1 class="title">{t('welcomeTour.title')}</h1>
      <p class="intro">{t('welcomeTour.intro')}</p>
      <ul class="cards">
        {#each CARDS as c (c.title)}
          <li class="card">
            <span class="ico"><Icon name={c.icon} size={20} /></span>
            <div class="txt">
              <p class="card-title">{t(c.title)}</p>
              <p class="card-body">{t(c.body)}</p>
            </div>
          </li>
        {/each}
      </ul>
    {:else}
      <h1 class="title">{t('welcomeTour.choiceTitle')}</h1>
      <div class="choices">
        <button class="choice start" onclick={onStart}>
          <span class="choice-title">{t('welcomeTour.startTitle')}</span>
          <span class="choice-body">{t('welcomeTour.startBody')}</span>
        </button>
        <button class="choice direct" onclick={onUseDirectly}>
          <span class="choice-title">{t('welcomeTour.directTitle')}</span>
          <span class="choice-body">{t('welcomeTour.directBody')}</span>
        </button>
      </div>
    {/if}

    <footer class="foot">
      <span
        class="dots"
        role="img"
        aria-label={t('welcomeTour.pageLabel', { page, total: PAGES })}
      >
        {#each Array.from({ length: PAGES }, (_, i) => i + 1) as p (p)}
          <span class="dot" class:on={p === page}></span>
        {/each}
      </span>
      <span class="spacer"></span>
      {#if page > 1}
        <button class="btn back" onclick={() => (page = page - 1)}
          >{t('welcomeTour.back')}</button
        >
      {/if}
      {#if page < PAGES}
        <button class="btn primary next" onclick={() => (page = page + 1)}
          >{t('welcomeTour.next')}</button
        >
      {/if}
    </footer>
  </div>
</div>

<style>
  /* Above the tutorial overlay (55) so it also works if both are mounted. */
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 56;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .scrim {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
  }
  .dialog {
    position: relative;
    box-sizing: border-box;
    width: 600px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 32px);
    overflow-y: auto;
    background: var(--panel-bg);
    color: var(--fg);
    border: 1px solid var(--panel-border);
    border-radius: 14px;
    box-shadow: var(--panel-shadow);
    padding: 22px 24px 16px;
  }
  .title {
    margin: 0 0 6px;
    font-size: 20px;
    font-weight: 700;
    line-height: 1.3;
  }
  .intro {
    margin: 0 0 14px;
    font-size: 13px;
    color: var(--fg-soft);
    line-height: 1.5;
  }
  .cards {
    list-style: none;
    margin: 0 0 14px;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .card {
    display: flex;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--panel-border);
    border-radius: 10px;
    background: var(--row-hover);
  }
  .card:last-child:nth-child(odd) {
    grid-column: 1 / -1;
  }
  .ico {
    flex: 0 0 auto;
    display: flex;
    align-items: flex-start;
    padding-top: 1px;
    color: var(--select-ring);
  }
  .txt {
    min-width: 0;
  }
  .card-title {
    margin: 0 0 2px;
    font-size: 13px;
    font-weight: 600;
  }
  .card-body {
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
    color: var(--fg-soft);
  }
  .choices {
    display: grid;
    gap: 12px;
    margin: 14px 0 18px;
  }
  .choice {
    display: flex;
    flex-direction: column;
    gap: 4px;
    text-align: left;
    padding: 14px 16px;
    border-radius: 10px;
    border: 1px solid var(--panel-border);
    background: var(--panel-bg);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }
  .choice:hover {
    background: var(--row-hover);
  }
  .choice.start {
    border-color: var(--select-ring);
    box-shadow: inset 0 0 0 1px var(--select-ring);
  }
  .choice-title {
    font-size: 14px;
    font-weight: 600;
  }
  .choice-body {
    font-size: 12px;
    line-height: 1.45;
    color: var(--fg-soft);
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
  }
  .spacer {
    flex: 1 1 auto;
  }
  .dots {
    display: inline-flex;
    gap: 6px;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--fg-subtle);
  }
  .dot.on {
    background: var(--select-ring);
  }
  .btn {
    height: 30px;
    padding: 0 16px;
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
  .btn:focus-visible,
  .choice:focus-visible {
    outline: 2px solid var(--select-ring);
    outline-offset: 2px;
  }
  @media (max-width: 520px) {
    .cards {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
