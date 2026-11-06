import { describe, it, expect, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import fs from "node:fs";
import path from "node:path";
import Icon from "./Icon.svelte";
import IconDefs from "./IconDefs.svelte";
import { ICON_WINDOWS } from "./windows";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
});

function render(Cmp: unknown, props: Record<string, unknown> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app = mount(Cmp as any, { target: host, props });
  flushSync();
  return host;
}

describe("icon system", () => {
  it("IconDefs renders the shared #ic-board sprite once", () => {
    const h = render(IconDefs);
    expect(h.querySelector("#ic-board")).not.toBeNull();
    // the board carries the icon geometry (many paths)
    expect(h.querySelectorAll("#ic-board path").length).toBeGreaterThan(50);
  });

  it("Icon windows into the sprite via <use> with the icon's viewBox", () => {
    const h = render(Icon, { name: "settings" });
    const svg = h.querySelector("svg.icon") as SVGSVGElement;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute("viewBox")).toBe(ICON_WINDOWS.settings);
    expect(svg.getAttribute("fill")).toBe("currentColor");
    const use = svg.querySelector("use");
    expect(use?.getAttribute("href")).toBe("#ic-board");
  });

  it("is decorative by default but labelled when given a title", () => {
    let h = render(Icon, { name: "trash" });
    expect(h.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    unmount(app);
    h.remove();
    h = render(Icon, { name: "trash", title: "Delete" });
    const svg = h.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBeNull();
    expect(svg.getAttribute("aria-label")).toBe("Delete");
    expect(svg.getAttribute("role")).toBe("img");
  });

  it("every window value is a valid 4-number viewBox", () => {
    for (const [name, vb] of Object.entries(ICON_WINDOWS)) {
      const parts = vb.split(" ").map(Number);
      expect(parts, name).toHaveLength(4);
      expect(
        parts.every((n) => Number.isFinite(n)),
        name,
      ).toBe(true);
    }
  });

  // The sprite's monochrome contract (see IconDefs.svelte's header comment)
  // depends on every fill/stroke resolving through `currentColor`. A fresh
  // Affinity export hardcodes `fill:white` and `stroke:black` instead — this
  // guards the sprite SOURCE (not the rendered DOM) so a re-export can't
  // quietly reintroduce either without failing a test.
  it("sprite source has no hardcoded fill:white or stroke:black", () => {
    // IconDefs.svelte's header comment itself names `fill:white` and
    // `stroke:black` as the defect to avoid — strip that leading HTML
    // comment before scanning so the warning text isn't a false positive.
    const iconDefsRaw = fs.readFileSync(
      path.join(__dirname, "IconDefs.svelte"),
      "utf-8",
    );
    const iconDefsBody = iconDefsRaw.replace(/^<!--[\s\S]*?-->/, "");
    expect(iconDefsBody).not.toContain("fill:white");
    expect(iconDefsBody).not.toContain("stroke:black");

    const iconBoardSvg = fs.readFileSync(
      path.join(__dirname, "icon-board.svg"),
      "utf-8",
    );
    expect(iconBoardSvg).not.toContain("fill:white");
    expect(iconBoardSvg).not.toContain("stroke:black");
  });
});
