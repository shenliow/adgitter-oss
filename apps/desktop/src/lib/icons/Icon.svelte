<!--
  Vector UI icon. Renders one icon from the shared #ic-board sprite (see
  IconDefs.svelte, mounted once at the app root) by windowing into it with the
  icon's viewBox. Monochrome + `fill: currentColor`, so it inherits the
  surrounding text colour and themes automatically (light/dark).

  Decorative by default (aria-hidden) — the interactive control that wraps the
  icon carries the accessible label/title. Pass `title` for a standalone,
  meaningful icon.
-->
<script lang="ts">
  import { ICON_WINDOWS, type IconName } from './windows';

  let {
    name,
    size = 16,
    title = null,
  }: {
    /** Which icon to render (see IconName / the icons2.svg board). */
    name: IconName;
    /** Rendered box in px (icons are square). */
    size?: number | string;
    /** Optional accessible label; when set the icon is not aria-hidden. */
    title?: string | null;
  } = $props();
</script>

<svg
  class="icon"
  viewBox={ICON_WINDOWS[name]}
  width={size}
  height={size}
  fill="currentColor"
  role={title ? 'img' : undefined}
  aria-label={title ?? undefined}
  aria-hidden={title ? undefined : true}
  focusable="false"
>
  <use href="#ic-board" />
</svg>

<style>
  .icon {
    display: inline-block;
    vertical-align: middle;
    flex: 0 0 auto;
  }
</style>
