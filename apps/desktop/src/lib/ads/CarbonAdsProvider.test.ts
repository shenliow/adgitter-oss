import { describe, it, expect, afterEach } from "vitest";
import { CarbonAdsProvider } from "./CarbonAdsProvider";

let host: HTMLDivElement;
afterEach(() => host?.remove());

function container(): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  return host;
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
  });

  it("embeds the Carbon script only when serve/placement are configured", async () => {
    const c = container();
    const live = new CarbonAdsProvider({
      serve: "ABC123",
      placement: "adgitter",
    });
    live.render(c);
    expect((c.querySelector("iframe") as HTMLIFrameElement).srcdoc).toContain(
      "cdn.carbonads.com/carbon.js?serve=ABC123&placement=adgitter",
    );
  });

  it("renders a self-contained stub (no network) without a serve code", () => {
    const c = container();
    new CarbonAdsProvider().render(c);
    const srcdoc = (c.querySelector("iframe") as HTMLIFrameElement).srcdoc;
    expect(srcdoc).not.toContain("carbonads.com");
    expect(srcdoc).toContain("Your ad could be here");
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
