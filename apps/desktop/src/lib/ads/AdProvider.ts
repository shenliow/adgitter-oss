/**
 * Ad provider abstraction. Keeps Carbon (default) swappable for
 * self-served / other networks later. Implementations must be self-contained
 * and **never** expose IPC to the ad context (use a sandboxed iframe).
 */
export interface AdProvider {
  /** Prepare the provider (config/network). Resolves when ready; never throws. */
  load(): Promise<void>;
  /** Mount the (sandboxed) ad into `container`. Safe to call after `load`. */
  render(container: HTMLElement, look?: Partial<AdLook>): void;
  /** Remove the ad and all its DOM/scripts. Idempotent. */
  dispose(): void;
}

/**
 * What the host hands an ad so it matches the app around it. The ad runs in an
 * opaque-origin frame, which can read neither the app's CSS variables nor its
 * locale, so everything it needs is resolved by the host and passed in.
 */
export interface AdLook {
  /** The strip's background, as a resolved CSS colour. */
  background: string;
  /** Ad copy colour — must be legible on {@link background}. */
  text: string;
  /** Secondary text (attribution, the no-ad message). */
  muted: string;
  /** `font-family` stack of the app. */
  font: string;
  /** Shown when there is no ad to show: not configured, no fill, or offline. */
  fallback: string;
  /** Accessible name of the ad frame. */
  title: string;
  /** BCP 47 tag of {@link fallback}. */
  lang: string;
}
