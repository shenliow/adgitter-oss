/**
 * Text colours for the ad strip, chosen from its background.
 *
 * The strip's background is a theme token (`--ad-bg`), but no theme pairs it
 * with a text colour, and a theme may leave it alone entirely — the built-in
 * dark theme recolours `--fg` without touching `--ad-bg`. Picking the text
 * from the background's own lightness keeps the ad legible under every pack,
 * including ones delivered later.
 */
import type { AdLook } from "./AdProvider";

export type AdColors = Pick<AdLook, "background" | "text" | "muted">;

/** `--ad-bg` in `app.css`. */
const BASE_BACKGROUND = "#cdcdcd";
const ON_LIGHT = { text: "#2b2b2b", muted: "#555555" };
const ON_DARK = { text: "#ededee", muted: "#a6a6aa" };

/**
 * `[r, g, b]` (0–255) of an opaque `#rgb`, `#rrggbb`, `rgb()` or `rgba()`
 * colour. Anything see-through is not a background to choose text against.
 */
function channels(color: string): [number, number, number] | null {
  const c = color.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c)?.[1];
  if (hex) {
    const full =
      hex.length === 3 ? [...hex].map((ch) => ch + ch).join("") : hex;
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ];
  }
  // What `getComputedStyle` reports for any sRGB colour, in either the comma
  // or the space-separated form.
  const rgb =
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(
      c,
    );
  if (!rgb) return null;
  const alpha = rgb[4];
  if (
    alpha !== undefined &&
    parseFloat(alpha) < (alpha.endsWith("%") ? 100 : 1)
  )
    return null;
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
}

/** WCAG relative luminance, 0 (black) – 1 (white). */
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * The strip's colours for `background`. A colour that can't be read (an
 * unset variable, a notation other than hex/rgb) falls back to the base
 * theme's own strip colour: the frame needs a solid one, because the ad covers
 * the no-ad message with it.
 */
export function adColors(background: string): AdColors {
  const rgb = channels(background);
  // 0.18 is where black and white text contrast equally.
  const dark = rgb !== null && luminance(rgb) < 0.18;
  return {
    background: rgb ? background.trim() : BASE_BACKGROUND,
    ...(dark ? ON_DARK : ON_LIGHT),
  };
}
