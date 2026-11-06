/**
 * Ad provider abstraction. Keeps Carbon (default) swappable for
 * self-served / other networks later. Implementations must be self-contained
 * and **never** expose IPC to the ad context (use a sandboxed iframe).
 */
export interface AdProvider {
  /** Prepare the provider (config/network). Resolves when ready; never throws. */
  load(): Promise<void>;
  /** Mount the (sandboxed) ad into `container`. Safe to call after `load`. */
  render(container: HTMLElement): void;
  /** Remove the ad and all its DOM/scripts. Idempotent. */
  dispose(): void;
}
