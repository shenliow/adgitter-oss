import { describe, it, expect, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import GraphThemePreview from "./GraphThemePreview.svelte";
import { resolveGraphThemePack } from "../../lib/graphTheme";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
});

function render(themeId: string) {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(GraphThemePreview, {
    target: host,
    props: { theme: resolveGraphThemePack(themeId) },
  });
  flushSync();
  return host;
}

describe("GraphThemePreview", () => {
  it("renders the HEAD/branch/tag chips, rails and commit nodes for the default theme", () => {
    const h = render("default");
    // Branch + tag chips (SVG <text>): main, feat, bug, and the v1.0 tag —
    // the scenario the personalize preview is required to show.
    expect(h.textContent).toContain("main");
    expect(h.textContent).toContain("feat");
    expect(h.textContent).toContain("bug");
    expect(h.textContent).toContain("v1.0");
    // Six commit nodes (M, B1, F1, C3, C2, C1) and five rails (edges) drawn
    // by the shared edgePath, plus plain circle nodes.
    const svg = h.querySelector("svg.gtp-svg")!;
    expect(svg.querySelectorAll("path").length).toBeGreaterThanOrEqual(5);
    expect(svg.querySelectorAll("circle").length).toBeGreaterThan(0);
    // Default has no currentColor-tinted node/crown groups.
    expect(svg.querySelector("g[style]")).toBeNull();
  });

  it("draws a real merge rail: feat (non-first-parent) rejoining main", () => {
    const h = render("default");
    const svg = h.querySelector("svg.gtp-svg")!;
    const rails = Array.from(svg.querySelectorAll("path"));
    // The merge edge (M -> F1, isFirstParent: false) is drawn by edgePath's
    // H-then-V branch: it starts with a horizontal leg ("H") before the
    // vertical drop, unlike every mainline (first-parent) edge in this
    // scenario, which all start with a vertical leg ("V"). If the merge
    // parent were removed from the synthetic commit list, no path would
    // contain that "H" opening leg and this assertion would fail.
    const hasMergeTurn = rails.some((p) => {
      const d = p.getAttribute("d") ?? "";
      return /^M[\d.-]+ [\d.-]+ H/.test(d);
    });
    expect(hasMergeTurn).toBe(true);
  });
});
