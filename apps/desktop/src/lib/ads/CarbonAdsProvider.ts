/**
 * Carbon Ads provider. Loads the ad inside a **sandboxed iframe** whose
 * sandbox omits `allow-same-origin`, so it runs in an opaque origin and cannot
 * reach the parent window or Tauri IPC. On load failure / offline / no fill
 * the strip shows the host's own message instead — nothing throws.
 *
 * Real fill needs Carbon network acceptance: pass a `serve`/`placement` code
 * to embed the live script. Without them the frame is self-contained (no
 * network) and shows only the message, so the lifecycle stays wired and
 * testable.
 *
 * The frame carries **no script of ours**. It inherits the app's CSP, which
 * allows no inline script, so everything here — the layout of Carbon's
 * markup, the no-ad message, its delayed appearance — is HTML and CSS only.
 * That CSS is an inline `<style>`, which the same CSP allows only through
 * `style-src 'unsafe-inline'`. Tauri adds a nonce to `style-src` as soon as
 * `index.html` itself contains a `<style>` tag, and a nonce switches
 * `'unsafe-inline'` off — so keep `index.html` free of inline styles, or the
 * frame renders unstyled in packaged builds (and only there).
 */
import type { AdLook, AdProvider } from "./AdProvider";

export interface CarbonConfig {
  serve?: string;
  placement?: string;
}

const SANDBOX = "allow-scripts allow-popups allow-popups-to-escape-sandbox";

/** Carbon's script host. Also the frame's `<base>`: see {@link frameDocument}. */
const CARBON_ORIGIN = "https://cdn.carbonads.com";

/** How long a live frame waits for an ad before showing the message. */
const NO_FILL_DELAY_S = 4;

const DEFAULT_LOOK: AdLook = {
  background: "#cdcdcd",
  text: "#2b2b2b",
  muted: "#555555",
  font: "-apple-system, system-ui, sans-serif",
  fallback: "",
  title: "Advertisement",
  lang: "en",
};

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

// The look is interpolated into a `<style>` block, and its values come from
// theme packs. Anything that isn't plainly a colour / a font stack is dropped
// for the default rather than trusted to stay inside its declaration.
const cssColor = (v: string, fallback: string) =>
  /^[#\w\s(),.%/-]{1,80}$/.test(v) ? v : fallback;
const cssFont = (v: string, fallback: string) =>
  /^[\w\s"',.-]{1,400}$/.test(v) ? v : fallback;

export class CarbonAdsProvider implements AdProvider {
  #iframe: HTMLIFrameElement | null = null;
  #config: CarbonConfig;

  constructor(config: CarbonConfig = {}) {
    this.#config = config;
  }

  /** Whether this provider is configured to request real ads. */
  get live(): boolean {
    return Boolean(this.#config.serve && this.#config.placement);
  }

  async load(): Promise<void> {
    // Carbon is script-embedded; nothing to prefetch. Reserved for providers
    // that genuinely fetch config/inventory ahead of render.
  }

  render(container: HTMLElement, look: Partial<AdLook> = {}): void {
    this.dispose();
    const resolved = { ...DEFAULT_LOOK, ...look };
    const iframe = document.createElement("iframe");
    iframe.className = "ad-frame";
    iframe.title = resolved.title;
    // No `allow-same-origin` → opaque origin → no access to IPC / parent.
    iframe.setAttribute("sandbox", SANDBOX);
    iframe.setAttribute("referrerpolicy", "no-referrer");
    iframe.setAttribute("scrolling", "no");
    iframe.srcdoc = this.#frameDocument(resolved);
    this.#iframe = iframe;
    container.appendChild(iframe);
  }

  dispose(): void {
    this.#iframe?.remove();
    this.#iframe = null;
  }

  /**
   * The frame's whole document.
   *
   * Carbon's script inserts one `#carbonads` element next to its own tag:
   *
   *   #carbonads > span > span.carbon-wrap > a.carbon-img > img
   *                                        > a.carbon-text
   *                     > a.carbon-poweredby
   *
   * The CSS lays that out as a single row for the strip and gives it a solid
   * background, so when an ad arrives it simply covers the message underneath.
   */
  #frameDocument(look: AdLook): string {
    const { serve, placement } = this.#config;
    const live = this.live;
    const bg = cssColor(look.background, DEFAULT_LOOK.background);
    const text = cssColor(look.text, DEFAULT_LOOK.text);
    const muted = cssColor(look.muted, DEFAULT_LOOK.muted);
    const font = cssFont(look.font, DEFAULT_LOOK.font);

    // A `srcdoc` document resolves URLs against its *embedder* — in the app
    // that is `tauri://localhost`, where a scheme-relative `//host/…` (the
    // form ad scripts habitually write their own requests in) points nowhere.
    // The base pins those to https, and sends every link to a new window —
    // which the shell hands to the system browser — instead of navigating
    // the strip itself.
    const head = live ? `<base href="${CARBON_ORIGIN}/" target="_blank">` : "";
    const script = live
      ? `<script async src="${CARBON_ORIGIN}/carbon.js?serve=${encodeURIComponent(
          serve!,
        )}&placement=${encodeURIComponent(
          placement!,
        )}" id="_carbonads_js"></script>`
      : "";
    // Live: stay out of the way while the ad loads, and appear only if none
    // did. Not configured: there is nothing to wait for.
    const house = `<p class="house${live ? " wait" : ""}">${escapeHtml(
      look.fallback,
    )}</p>`;

    return `<!doctype html><html lang="${escapeHtml(look.lang)}"><head><meta charset="utf-8">${head}<style>
      html,body{margin:0;height:100%;}
      body{position:relative;overflow:hidden;background:${bg};color:${text};
        font:13px/1.4 ${font};-webkit-font-smoothing:antialiased;}
      a{color:inherit;text-decoration:none;}
      .house{position:absolute;top:0;right:0;bottom:0;left:0;margin:0;
        padding:0 120px;display:flex;align-items:center;justify-content:center;
        text-align:center;color:${muted};}
      .house.wait{opacity:0;animation:house .4s ease ${NO_FILL_DELAY_S}s forwards;}
      @keyframes house{to{opacity:1;}}
      #carbonads{position:absolute;top:0;right:0;bottom:0;left:0;z-index:1;
        display:flex;align-items:center;justify-content:center;background:${bg};}
      #carbonads>span{display:grid;grid-template-columns:auto minmax(0,340px);
        grid-template-rows:auto auto;column-gap:14px;row-gap:4px;padding:0 120px;}
      .carbon-wrap{display:contents;}
      .carbon-img{grid-column:1;grid-row:1/span 2;align-self:center;line-height:0;}
      .carbon-img img{display:block;height:76px;width:auto;max-width:none!important;
        border-radius:4px;}
      .carbon-text{grid-column:2;grid-row:1;align-self:end;overflow:hidden;
        display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;}
      .carbon-text:hover{text-decoration:underline;}
      .carbon-poweredby{grid-column:2;grid-row:2;align-self:start;
        font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:${muted};}
      .carbon-poweredby:hover{color:${text};}
    </style></head><body>${house}${script}</body></html>`;
  }
}
