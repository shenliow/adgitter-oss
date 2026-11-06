/**
 * Carbon Ads provider. Loads the ad inside a **sandboxed iframe** whose
 * sandbox omits `allow-same-origin`, so it runs in an opaque origin and cannot
 * reach the parent window or Tauri IPC. On load failure /
 * offline the slot simply stays blank — nothing throws.
 *
 * Real fill needs Carbon network acceptance: pass a
 * `serve`/`placement` code to embed the live script; without it a tasteful stub
 * placeholder renders so the lifecycle is fully wired and testable.
 */
import type { AdProvider } from "./AdProvider";

export interface CarbonConfig {
  serve?: string;
  placement?: string;
}

const SANDBOX = "allow-scripts allow-popups allow-popups-to-escape-sandbox";

export class CarbonAdsProvider implements AdProvider {
  #iframe: HTMLIFrameElement | null = null;
  #config: CarbonConfig;

  constructor(config: CarbonConfig = {}) {
    this.#config = config;
  }

  async load(): Promise<void> {
    // Carbon is script-embedded; nothing to prefetch. Reserved for providers
    // that genuinely fetch config/inventory ahead of render.
  }

  render(container: HTMLElement): void {
    this.dispose();
    const iframe = document.createElement("iframe");
    iframe.className = "ad-frame";
    iframe.title = "Advertisement";
    // No `allow-same-origin` → opaque origin → no access to IPC / parent.
    iframe.setAttribute("sandbox", SANDBOX);
    iframe.setAttribute("referrerpolicy", "no-referrer");
    iframe.setAttribute("scrolling", "no");
    iframe.srcdoc = this.#srcdoc();
    this.#iframe = iframe;
    container.appendChild(iframe);
  }

  dispose(): void {
    this.#iframe?.remove();
    this.#iframe = null;
  }

  #srcdoc(): string {
    const { serve, placement } = this.#config;
    const body =
      serve && placement
        ? `<script async src="//cdn.carbonads.com/carbon.js?serve=${encodeURIComponent(
            serve,
          )}&placement=${encodeURIComponent(
            placement,
          )}" id="_carbonads_js"></script>`
        : // Stub until Carbon acceptance — self-contained, no network.
          `<div class="stub">Your ad could be here — upgrade to remove ads.</div>`;
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;height:100%;}
      body{display:flex;align-items:center;justify-content:center;
        font-family:-apple-system,system-ui,sans-serif;color:#777;font-size:13px;}
      .stub{opacity:.7;}
    </style></head><body>${body}</body></html>`;
  }
}
