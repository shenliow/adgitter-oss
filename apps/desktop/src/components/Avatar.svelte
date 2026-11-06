<!-- Round avatar with initials fallback (we have no photo in Phase 0). -->
<script lang="ts">
  import { initials } from '../lib/format';
  let {
    name = '',
    email = '',
    size = 28,
  }: { name?: string; email?: string; size?: number } = $props();

  // Deterministic colour from the email/name so avatars are stable.
  function hue(seed: string): number {
    let h = 0;
    for (let i = 0; i < seed.length; i++)
      h = (h * 31 + seed.charCodeAt(i)) % 360;
    return h;
  }
  const bg = $derived(`hsl(${hue(email || name)} 55% 55%)`);
</script>

<span
  class="avatar"
  style="width:{size}px;height:{size}px;background:{bg};font-size:{Math.round(
    size * 0.38,
  )}px"
  title={email || name}
>
  {initials(name)}
</span>

<style>
  .avatar {
    display: inline-grid;
    place-items: center;
    border-radius: 50%;
    color: #fff;
    font-weight: 600;
    flex: 0 0 auto;
    user-select: none;
    box-shadow: 0 0 0 2px #fff;
  }
</style>
