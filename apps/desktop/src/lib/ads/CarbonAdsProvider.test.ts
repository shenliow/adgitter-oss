import { describe, it, expect, afterEach } from "vitest";
import { CarbonAdsProvider } from "./CarbonAdsProvider";

let host: HTMLDivElement;
afterEach(() => host?.remove());

function container(): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  return host;
}

const LIVE = { serve: "ABC123", placement: "adgitter" };

/** The frame document a provider renders, parsed. */
function frame(
  config: ConstructorParameters<typeof CarbonAdsProvider>[0],
  look: Parameters<CarbonAdsProvider["render"]>[1] = {},
) {
  const c = container();
  new CarbonAdsProvider(config).render(c, look);
  const iframe = c.querySelector("iframe") as HTMLIFrameElement;
  const doc = new DOMParser().parseFromString(iframe.srcdoc, "text/html");
  return { iframe, srcdoc: iframe.srcdoc, doc };
}

describe("CarbonAdsProvider", () => {
  it("renders a sandboxed iframe that cannot reach the parent (no IPC)", async () => {
    const c = container();
    const p = new CarbonAdsProvider();
    await p.load();
    p.render(c);

    const iframe = c.querySelector("iframe") as HTMLIFrameElement;
    expect(iframe).not.toBeNull();
    const sandbox = iframe.getAttribute("sandbox") ?? "";
    expect(sandbox).toContain("allow-scripts");
    // The critical isolation guarantee: never same-origin (→ no IPC/parent).
    expect(sandbox).not.toContain("allow-same-origin");
    // A click on the ad has to be able to ask for a new window.
    expect(sandbox).toContain("allow-popups");
  });

  it("embeds the Carbon script only when serve/placement are configured", () => {
    const { doc } = frame(LIVE);
    const script = doc.querySelector("script")!;
    // Carbon's script finds its insertion point by this id.
    expect(script.id).toBe("_carbonads_js");
    expect(script.getAttribute("src")).toBe(
      "https://cdn.carbonads.com/carbon.js?serve=ABC123&placement=adgitter",
    );
    expect(new CarbonAdsProvider(LIVE).live).toBe(true);
    expect(new CarbonAdsProvider({ serve: "ABC123" }).live).toBe(false);
  });

  // In the app the frame's embedder is `tauri://localhost`: a scheme-relative
  // URL would resolve against that and go nowhere.
  it("pins the live frame to https and sends links to a new window", () => {
    const { doc } = frame(LIVE);
    const base = doc.querySelector("base")!;
    expect(base.getAttribute("href")).toBe("https://cdn.carbonads.com/");
    expect(base.getAttribute("target")).toBe("_blank");
  });

  it("escapes the codes it puts in the script URL", () => {
    const { doc } = frame({ serve: 'a"><script>x', placement: "p&q=1" });
    expect(doc.querySelectorAll("script")).toHaveLength(1);
    expect(doc.querySelector("script")!.getAttribute("src")).toBe(
      "https://cdn.carbonads.com/carbon.js?serve=a%22%3E%3Cscript%3Ex&placement=p%26q%3D1",
    );
  });

  it("is self-contained (no network, no script) without a serve code", () => {
    const { srcdoc, doc } = frame({}, { fallback: "No ad today" });
    expect(srcdoc).not.toContain("carbonads.com");
    expect(doc.querySelector("script")).toBeNull();
    expect(doc.querySelector("base")).toBeNull();
    const house = doc.querySelector(".house")!;
    expect(house.textContent).toBe("No ad today");
    // Nothing to wait for: the message shows at once.
    expect(house.classList.contains("wait")).toBe(false);
  });

  it("holds the message back while a live ad may still arrive", () => {
    const { doc } = frame(LIVE, { fallback: "No ad today" });
    const house = doc.querySelector(".house")!;
    expect(house.textContent).toBe("No ad today");
    expect(house.classList.contains("wait")).toBe(true);
  });

  // The frame inherits the app's CSP, which allows no inline script.
  it("carries no inline script", () => {
    for (const config of [{}, LIVE]) {
      const { doc } = frame(config, { fallback: "x" });
      for (const s of doc.querySelectorAll("script"))
        expect(s.textContent).toBe("");
      host.remove();
    }
  });

  it("applies the host's look", () => {
    const { iframe, srcdoc, doc } = frame(LIVE, {
      background: "rgb(35, 40, 56)",
      text: "#ededee",
      muted: "#a6a6aa",
      font: '"Inter", "Segoe UI", sans-serif',
      title: "廣告",
      lang: "zh-Hant",
    });
    expect(iframe.title).toBe("廣告");
    expect(doc.documentElement.lang).toBe("zh-Hant");
    const css = doc.querySelector("style")!.textContent!;
    expect(css).toContain("background:rgb(35, 40, 56)");
    expect(css).toContain("color:#ededee");
    expect(css).toContain('"Inter", "Segoe UI", sans-serif');
    // Carbon's markup is styled, and covers the message when it arrives.
    expect(css).toMatch(/#carbonads\{[^}]*background:rgb\(35, 40, 56\)/);
    expect(srcdoc).toContain(".carbon-poweredby");
  });

  it("escapes the message and drops a look value that isn't plain CSS", () => {
    const { doc } = frame(LIVE, {
      fallback: "<img src=x onerror=alert(1)> & more",
      background: "red;}</style><script>alert(1)</script>",
      font: "x;} body{display:none",
    });
    expect(doc.querySelector(".house")!.textContent).toBe(
      "<img src=x onerror=alert(1)> & more",
    );
    expect(doc.querySelector("img")).toBeNull();
    expect(doc.querySelectorAll("script")).toHaveLength(1);
    const css = doc.querySelector("style")!.textContent!;
    expect(css).not.toContain("alert");
    expect(css).not.toContain("display:none");
    expect(css).toContain("background:#cdcdcd");
  });

  it("dispose removes the iframe and is idempotent", () => {
    const c = container();
    const p = new CarbonAdsProvider();
    p.render(c);
    expect(c.querySelector("iframe")).not.toBeNull();
    p.dispose();
    p.dispose(); // no throw on second call
    expect(c.querySelector("iframe")).toBeNull();
  });

  it("re-render replaces the previous iframe (no leak)", () => {
    const c = container();
    const p = new CarbonAdsProvider();
    p.render(c);
    p.render(c);
    expect(c.querySelectorAll("iframe")).toHaveLength(1);
  });
});
