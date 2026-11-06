<!--
  Devices panel. A display/action panel: lists the signed-in
  account's devices (name + last-seen), marks the current one, and shows seat
  usage ("N of M devices") derived from the plan's device cap. Remove
  deauthorizes a non-current device then re-lists. The license service isn't
  deployed yet, so an empty/unreachable list renders a friendly "sign in to sync"
  state instead of an error (listDevices resolves [] on failure).
-->
<script lang="ts">
  import { listDevices, removeDevice, type DeviceDto } from '../../lib/ipc';
  import { getPlan, deviceLimit } from '../../lib/license.svelte';
  import { t } from '../../lib/i18n/index.svelte';

  let devices = $state<DeviceDto[]>([]);
  let loading = $state(true);

  const max = $derived(deviceLimit(getPlan()));
  const used = $derived(devices.length);

  async function load() {
    loading = true;
    try {
      devices = await listDevices();
    } finally {
      loading = false;
    }
  }

  // Runs once on mount (no reactive reads inside), then again after a removal.
  $effect(() => {
    void load();
  });

  async function remove(id: string) {
    await removeDevice(id);
    await load();
  }

  function lastSeen(ms: number): string {
    if (!ms) return t('devices.neverSeen');
    return t('devices.lastSeen', { when: new Date(ms).toLocaleString() });
  }
</script>

<div class="panel">
  <div class="usage">{t('devices.usage', { used, max })}</div>

  {#if !loading && devices.length === 0}
    <p class="empty">{t('devices.empty')}</p>
  {:else}
    <ul class="list">
      {#each devices as d (d.id)}
        <li class="row" class:current={d.current}>
          <div class="meta">
            <span class="name">{d.name}</span>
            <span class="sub">
              {#if d.current}{t('devices.thisDevice')} ·
              {/if}{lastSeen(d.lastSeen)}
            </span>
          </div>
          {#if !d.current}
            <button class="rm" onclick={() => remove(d.id)}
              >{t('devices.remove')}</button
            >
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .usage {
    font-size: 12px;
    color: var(--fg-muted);
  }
  .empty {
    margin: 0;
    font-size: 13px;
    color: var(--fg-muted);
    line-height: 1.4;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    padding: 8px 10px;
    gap: 12px;
  }
  .row.current {
    background: var(--row-hover);
  }
  .meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .name {
    font-size: 13px;
    color: var(--fg);
    font-weight: 600;
  }
  .sub {
    font-size: 11px;
    color: var(--fg-muted);
  }
  .rm {
    border: 1px solid var(--panel-border);
    background: transparent;
    color: var(--fg);
    border-radius: 6px;
    padding: 5px 12px;
    font-size: 12px;
    cursor: pointer;
  }
</style>
