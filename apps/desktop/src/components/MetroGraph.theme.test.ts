import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mount, unmount, flushSync } from "svelte";
import MetroGraph from "./MetroGraph.svelte";
import type { Commit, RefList } from "../lib/ipc";
import {
  resolveGraphThemePack,
  registerRemoteGraphThemePack,
  __resetRemoteGraphThemePacks,
  type GraphThemePack,
} from "../lib/graphTheme";

function commit(sha: string, parents: string[] = []): Commit {
  return {
    sha,
    short_sha: sha.slice(0, 7),
    author_name: "Tester",
    author_email: "t@example.com",
    timestamp: 1700000000,
    subject: `subject ${sha}`,
    body: "",
    parents,
  };
}

// A small merge DAG so at least one edge is cross-lane (exercises the corner
// seam): m merges c3 (mainline) and c2 (a fork off c1).
const commits = [
  commit("m", ["c3", "c2"]),
  commit("c3", ["c1"]),
  commit("c2", ["c1"]),
  commit("c1", []),
];

const refs: RefList = {
  head: { branch: "main", target: "m", detached: false },
  branches: [{ name: "main", kind: "branch", target: "m" }],
  remotes: [],
  tags: [],
};

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
  __resetRemoteGraphThemePacks();
});

function render(props: Record<string, unknown>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(MetroGraph, { target: host, props });
  flushSync();
  return host;
}

describe("MetroGraph graph themes", () => {
  it("default id renders today's plain circles/paths — no themed assets", () => {
    const h = render({ commits, refs, graphTheme: "default" });
    expect(h.querySelectorAll("svg image").length).toBe(0);
    expect(h.querySelector(".decor-under")).toBeNull();
    expect(h.querySelector(".decor-over")).toBeNull();
    expect(h.querySelectorAll("svg defs pattern").length).toBe(0);
    // Nodes still render as plain circles.
    expect(h.querySelectorAll("g.nodes circle.node").length).toBe(
      commits.length,
    );
    // The crown is still the inline glyph, not an <img>.
    expect(h.querySelector(".crown svg.crown-glyph")).not.toBeNull();
    expect(h.querySelector(".crown img")).toBeNull();
  });

  it("casings the default stroked rail — same path, wider, themed-bg coloured", () => {
    // Metro-map casing (user request: "graph branch 線段都加上 1px 陰影，避免同色疊在一
    // 起分不出來"): every rail is drawn twice, casing first, so a 1px rim in
    // the canvas backdrop colour separates two branches that share a lane
    // colour once the palette wraps.
    const h = render({ commits, refs, graphTheme: "default" });
    const paths = [...h.querySelectorAll<SVGPathElement>("g.edges path")];
    // This fixture's DAG has 4 edges (m->c3, m->c2, c3->c1, c2->c1): one
    // casing + one coloured rail per edge.
    expect(paths.length).toBe(8);
    for (let i = 0; i + 1 < paths.length; i += 2) {
      const casing = paths[i];
      const rail = paths[i + 1];
      // Same geometry, casing drawn first (underneath, per SVG paint order).
      expect(casing.getAttribute("d")).toBe(rail.getAttribute("d"));
      // Casing is exactly 2px wider than its rail (a 1px rim on each side).
      const casingW = Number(casing.getAttribute("stroke-width"));
      const railW = Number(rail.getAttribute("stroke-width"));
      expect(casingW).toBe(railW + 2);
      // Casing is theme-aware — the workspace-bg CSS var, never a literal.
      expect(casing.getAttribute("stroke")).toBe("var(--workspace-bg)");
      expect(rail.getAttribute("stroke")).not.toBe("var(--workspace-bg)");
      expect(rail.getAttribute("stroke")).not.toMatch(/^#|^rgb/);
    }
  });

  it("a theme with tiled runs but no corner asset still casings its stroked corner fallback", () => {
    // Some future/remote theme may ship vertical+horizontal run tiles
    // without a corner tile: MetroGraph falls back to a stroked
    // `defaultCornerPath` for just the corner arc, which needs the same
    // casing treatment as the plain default rail.
    registerRemoteGraphThemePack({
      id: "casing-fallback-test",
      name: "Casing Fallback Test",
      edges: {
        vertical: {
          url: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='7' height='8'/>",
          width: 7,
          height: 8,
        },
        horizontal: {
          url: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='8' height='7'/>",
          width: 8,
          height: 7,
        },
        // no `corner` — forces the stroked defaultCornerPath fallback below.
      },
    });
    const h = render({
      commits,
      refs,
      graphTheme: "casing-fallback-test",
    });
    // No corner image asset on this theme.
    expect(h.querySelectorAll("g.edges image.edge-corner").length).toBe(0);
    // The straight runs still tile (unchanged, no casing expected there —
    // they aren't lane-coloured strokes).
    expect(h.querySelectorAll("g.edges > svg.edge-run").length).toBeGreaterThan(
      0,
    );
    // Every corner falls back to a casing+rail stroked path pair.
    const cornerPaths = [...h.querySelectorAll<SVGPathElement>("g.edges path")];
    expect(cornerPaths.length).toBeGreaterThan(0);
    expect(cornerPaths.length % 2).toBe(0);
    for (let i = 0; i < cornerPaths.length; i += 2) {
      const casing = cornerPaths[i];
      const rail = cornerPaths[i + 1];
      expect(casing.getAttribute("d")).toBe(rail.getAttribute("d"));
      expect(casing.getAttribute("stroke")).toBe("var(--workspace-bg)");
      expect(Number(casing.getAttribute("stroke-width"))).toBe(
        Number(rail.getAttribute("stroke-width")) + 2,
      );
      expect(rail.getAttribute("stroke")).not.toBe("var(--workspace-bg)");
    }
  });

  it("the track's width comes from the theme, and does NOT follow spriteScale", () => {
    // `trackWidth` is a DRAWN width, in the same absolute-pixel currency as
    // the casing rim and the select ring: a theme author reads the on-screen
    // weight straight off the number. A scaled one would silently double the
    // moment the pack changed its sprite scale.
    registerRemoteGraphThemePack({
      id: "track-width-test",
      name: "Track Width Test",
      geometry: { spriteScale: 2, rowH: 84, laneW: 60 },
      edges: {
        vertical: { url: "data:image/png;base64,v", width: 10, height: 32 },
        horizontal: { url: "data:image/png;base64,h", width: 32, height: 10 },
        trackWidth: 5,
      },
    });
    const h = render({ commits, refs, graphTheme: "track-width-test" });
    const track = [...h.querySelectorAll<SVGPathElement>("path.edge-track")];
    expect(track.length).toBeGreaterThan(0);
    for (const p of track) expect(p.getAttribute("stroke-width")).toBe("5");
  });

  it("a tiled theme with no trackWidth strokes no track at all", () => {
    // Blueprint's tiles carry their own line; an overlay would double it.
    const h = render({ commits, refs, graphTheme: "blueprint" });
    expect(h.querySelectorAll("path.edge-track").length).toBe(0);
  });

  it("an unknown theme id falls back to default rendering", () => {
    const h = render({ commits, refs, graphTheme: "not-a-real-theme" });
    expect(h.querySelectorAll("svg image").length).toBe(0);
    expect(h.querySelector(".decor-under")).toBeNull();
    expect(h.querySelector(".decor-over")).toBeNull();
    expect(h.querySelectorAll("g.nodes circle.node").length).toBe(
      commits.length,
    );
  });
});

/**
 * `GraphThemePack.text` → `--graph-text*` custom properties on `.scroller`.
 *
 * The seam is deliberately fallback-shaped: the CSS rules carry today's
 * colours/sizes inside `var(..., <fallback>)`, so the guarantee worth testing
 * is that a theme which says nothing sets NO custom property at all — that is
 * what keeps default/blueprint rendering byte-identically to before the seam
 * existed. jsdom doesn't resolve Svelte's scoped stylesheet, so the assertions
 * are on the properties the component writes, not on computed colours.
 */
const TEXT_PROPS = [
  "--graph-text",
  "--graph-text-muted",
  "--graph-text-halo",
  "--graph-text-family",
  "--graph-text-scale",
];

function scrollerStyle(h: HTMLElement): CSSStyleDeclaration {
  return h.querySelector<HTMLElement>(".scroller")!.style;
}

/** The inline size of the "drag to merge" dot on `sha`'s row. The dot only
 *  mounts while its node is hovered, so this hovers the node handle first —
 *  same trick `MetroGraph.mergeDrag.test.ts` uses. */
function mergeDotSize(
  h: HTMLElement,
  sha: string,
): { width: string; height: string } {
  const i = commits.findIndex((c) => c.sha === sha);
  const handle = [...h.querySelectorAll<HTMLElement>(".node-handle")][i];
  handle.dispatchEvent(new MouseEvent("pointerenter", { cancelable: true }));
  flushSync();
  const dot = h.querySelector<HTMLElement>(".merge-handle-dot");
  if (!dot) throw new Error(`no merge dot on ${sha}`);
  return { width: dot.style.width, height: dot.style.height };
}

describe("MetroGraph graph-theme text styling", () => {
  it.each(["default", "blueprint"])(
    "%s sets no text custom property — unchanged from before the seam",
    (id) => {
      const s = scrollerStyle(render({ commits, refs, graphTheme: id }));
      for (const p of TEXT_PROPS) expect(s.getPropertyValue(p)).toBe("");
    },
  );

  it("a theme's colour/muted/halo become the matching custom properties", () => {
    registerRemoteGraphThemePack({
      id: "text-colour-test",
      name: "Text Colour Test",
      text: { color: "#f7faf5", colorMuted: "#e2e8dc", halo: "#0d1a07" },
    });
    const s = scrollerStyle(
      render({ commits, refs, graphTheme: "text-colour-test" }),
    );
    expect(s.getPropertyValue("--graph-text")).toBe("#f7faf5");
    expect(s.getPropertyValue("--graph-text-muted")).toBe("#e2e8dc");
    expect(s.getPropertyValue("--graph-text-halo")).toBe("#0d1a07");
    // Untouched fields stay unset rather than landing as empty values.
    expect(s.getPropertyValue("--graph-text-family")).toBe("");
    expect(s.getPropertyValue("--graph-text-scale")).toBe("");
  });

  it("sizeScale is clamped at both ends so the fixed row geometry holds", () => {
    // Above the ceiling: the axis column (150px wide, 24px padded) cannot
    // hold its timestamp past 1.4.
    registerRemoteGraphThemePack({
      id: "scale-huge-test",
      name: "Scale Huge Test",
      text: { sizeScale: 9 },
    });
    expect(
      scrollerStyle(
        render({ commits, refs, graphTheme: "scale-huge-test" }),
      ).getPropertyValue("--graph-text-scale"),
    ).toBe("1.4");

    // Below the floor: the 11px email would drop under 8px and stop being
    // readable over artwork.
    registerRemoteGraphThemePack({
      id: "scale-tiny-test",
      name: "Scale Tiny Test",
      text: { sizeScale: 0.1 },
    });
    expect(
      scrollerStyle(
        render({ commits, refs, graphTheme: "scale-tiny-test" }),
      ).getPropertyValue("--graph-text-scale"),
    ).toBe("0.75");

    // In range, it passes through untouched.
    registerRemoteGraphThemePack({
      id: "scale-ok-test",
      name: "Scale Ok Test",
      text: { sizeScale: 1.2 },
    });
    expect(
      scrollerStyle(
        render({ commits, refs, graphTheme: "scale-ok-test" }),
      ).getPropertyValue("--graph-text-scale"),
    ).toBe("1.2");
  });

  it("an explicit personalize font beats the theme's fontFamily", () => {
    registerRemoteGraphThemePack({
      id: "text-font-test",
      name: "Text Font Test",
      text: { fontFamily: '"Segoe UI", system-ui, sans-serif' },
    });

    // `system` is the personalize default — the user has not chosen, so the
    // theme's own preference applies.
    expect(
      scrollerStyle(
        render({
          commits,
          refs,
          graphTheme: "text-font-test",
          personalizeFont: "system",
        }),
      ).getPropertyValue("--graph-text-family"),
    ).toBe('"Segoe UI", system-ui, sans-serif');

    // An explicit choice wins: the property is never set, so the row keeps
    // inheriting the app's `--sans`.
    expect(
      scrollerStyle(
        render({
          commits,
          refs,
          graphTheme: "text-font-test",
          personalizeFont: "mono",
        }),
      ).getPropertyValue("--graph-text-family"),
    ).toBe("");
  });
});

/**
 * `GraphThemePack.geometry` — the sprite scale and the row/lane pitch.
 *
 * The bar these guard is that the two knobs move independently AND that the
 * HTML text layer's row pitch never drifts from the SVG node layer's: `.row`
 * is a CSS height and `rowY` is an SVG coordinate, so they are only in step
 * because `--graph-row-h` carries the same number to both.
 */
describe("MetroGraph theme geometry", () => {
  const PAD_TOP = 100;

  /** Every row's inline `top`, in order. */
  function rowTops(h: HTMLElement): number[] {
    return [...h.querySelectorAll<HTMLElement>(".row")].map((r) =>
      parseFloat(r.style.top),
    );
  }
  /** The default stroked node circles' centres + radius. */
  function nodeCircles(h: HTMLElement) {
    return [...h.querySelectorAll("g.nodes circle.node")].map((c) => ({
      cx: parseFloat(c.getAttribute("cx")!),
      cy: parseFloat(c.getAttribute("cy")!),
      r: parseFloat(c.getAttribute("r")!),
    }));
  }

  it("a theme with no geometry keeps today's pitch and sets no row property", () => {
    const h = render({ commits, refs, graphTheme: "default" });
    // Rows step by ROW_H (56) from PAD_TOP (100).
    expect(rowTops(h)).toEqual([100, 156, 212, 268]);
    // The custom property is never emitted, so `.row`'s own 56px fallback
    // carries the height — byte-identical markup to before the seam existed.
    expect(scrollerStyle(h).getPropertyValue("--graph-row-h")).toBe("");
    const nodes = nodeCircles(h);
    // Node centres sit on the same pitch, offset by half a row.
    expect(nodes.map((n) => n.cy)).toEqual([128, 184, 240, 296]);
    expect(nodes.map((n) => n.r)).toEqual([12, 12, 12, 12]);
    // c2 is the forked lane: one LANE_W (30) off the lane-0 column.
    expect(Math.abs(nodes[0].cx - nodes[2].cx)).toBe(30);
    // The app's own crown glyph draws at its authored size.
    const crown = h.querySelector("svg.crown-glyph")!;
    expect(crown.getAttribute("width")).toBe("24");
    expect(crown.getAttribute("height")).toBe("20");
  });

  it("rowH moves the SVG layout and the .row CSS height together", () => {
    registerRemoteGraphThemePack({
      id: "geom-rowh-test",
      name: "Geom RowH Test",
      geometry: { rowH: 84 },
    });
    const h = render({ commits, refs, graphTheme: "geom-rowh-test" });
    expect(rowTops(h)).toEqual([100, 184, 268, 352]);
    // The HTML rows are sized by the property, the SVG nodes by rowY — same
    // pitch, or a row's text detaches from its own node.
    expect(scrollerStyle(h).getPropertyValue("--graph-row-h")).toBe("84px");
    expect(nodeCircles(h).map((n) => n.cy)).toEqual([142, 226, 310, 394]);
    // The graph grows to match: PAD_TOP + 4*rowH + PAD_BOTTOM.
    expect(
      parseFloat(h.querySelector<HTMLElement>(".content")!.style.height),
    ).toBe(PAD_TOP + 4 * 84 + 56);
  });

  it("laneW moves the lane pitch and nothing else", () => {
    registerRemoteGraphThemePack({
      id: "geom-lanew-test",
      name: "Geom LaneW Test",
      geometry: { laneW: 60 },
    });
    const h = render({ commits, refs, graphTheme: "geom-lanew-test" });
    const nodes = nodeCircles(h);
    expect(Math.abs(nodes[0].cx - nodes[2].cx)).toBe(60);
    // Row pitch untouched — the two knobs are independent.
    expect(rowTops(h)).toEqual([100, 156, 212, 268]);
    expect(scrollerStyle(h).getPropertyValue("--graph-row-h")).toBe("");
  });

  it("spriteScale multiplies every drawn sprite size", () => {
    registerRemoteGraphThemePack({
      id: "geom-sprite-test",
      name: "Geom Sprite Test",
      geometry: { spriteScale: 2, rowH: 84, laneW: 60 },
      head: { url: "data:image/png;base64,x", width: 24, height: 24 },
      node: {
        normal: { url: "data:image/png;base64,y", width: 28, height: 28 },
      },
      edges: {
        vertical: { url: "data:image/png;base64,v", width: 10, height: 32 },
        horizontal: { url: "data:image/png;base64,h", width: 32, height: 10 },
      },
    });
    const h = render({ commits, refs, graphTheme: "geom-sprite-test" });

    // HEAD crown: an <img>, drawn at 2x its authored 24x24.
    const crownImg = h.querySelector<HTMLImageElement>(".crown img")!;
    expect(crownImg.getAttribute("width")).toBe("48");
    expect(crownImg.getAttribute("height")).toBe("48");

    // Commit nodes: 28x28 authored → 56x56 drawn, still centred on the node.
    const nodeImg = h.querySelector("g.nodes image")!;
    expect(nodeImg.getAttribute("width")).toBe("56");
    expect(nodeImg.getAttribute("height")).toBe("56");
    const cy = parseFloat(nodeImg.getAttribute("y")!) + 28;
    expect(cy).toBe(100 + 84 / 2); // rowY(0) at the theme's own pitch

    // Run tiles: the tile is drawn at the scaled size, so the rail thickness
    // and the repeat pitch along the run both double.
    const vRun = h.querySelector<SVGSVGElement>("g.edges > svg.edge-run")!;
    expect(parseFloat(vRun.getAttribute("width")!)).toBe(20);
    const vTiles = [...vRun.querySelectorAll("image")];
    expect(vTiles.length).toBeGreaterThan(0);
    for (const t of vTiles) {
      expect(t.getAttribute("width")).toBe("20");
      expect(t.getAttribute("height")).toBe("64");
    }
    // …and the pitch IS that scaled height: consecutive tiles sit 64 apart.
    expect(vTiles.map((t) => parseFloat(t.getAttribute("y")!))).toEqual(
      vTiles.map((_, i) => i * 64),
    );
  });

  it("a tintable sprite scales by transform, since its size is baked in", () => {
    // `GraphAsset.svg` is a self-sizing fragment centred on the origin (see
    // themes/svgMarker.js), so handing it a different width/height cannot
    // resize it — the group it sits in has to carry a scale().
    registerRemoteGraphThemePack({
      id: "geom-tint-test",
      name: "Geom Tint Test",
      geometry: { spriteScale: 2, rowH: 84, laneW: 60 },
      node: {
        normal: {
          url: "data:image/svg+xml;utf8,<svg/>",
          svg: '<circle r="11" fill="currentColor"></circle>',
          width: 22,
          height: 22,
        },
      },
    });
    const h = render({ commits, refs, graphTheme: "geom-tint-test" });
    const g = [...h.querySelectorAll("g.nodes g")].find((el) =>
      el.querySelector("circle"),
    )!;
    expect(g.getAttribute("transform")).toMatch(/ scale\(2\)$/);
  });

  it("an unscaled theme emits the same transform markup it always did", () => {
    registerRemoteGraphThemePack({
      id: "geom-tint-1x-test",
      name: "Geom Tint 1x Test",
      node: {
        normal: {
          url: "data:image/svg+xml;utf8,<svg/>",
          svg: '<circle r="11" fill="currentColor"></circle>',
          width: 22,
          height: 22,
        },
      },
    });
    const h = render({ commits, refs, graphTheme: "geom-tint-1x-test" });
    const g = [...h.querySelectorAll("g.nodes g")].find((el) =>
      el.querySelector("circle"),
    )!;
    expect(g.getAttribute("transform")).not.toContain("scale");
  });

  it("the default stroked marks scale too, with fixed-weight rims", () => {
    registerRemoteGraphThemePack({
      id: "geom-stroked-test",
      name: "Geom Stroked Test",
      geometry: { spriteScale: 2, rowH: 84, laneW: 60 },
    });
    const h = render({ commits, refs, graphTheme: "geom-stroked-test" });
    expect(nodeCircles(h).map((n) => n.r)).toEqual([24, 24, 24, 24]);
    // The white backing circle stays NODE_R + 3: a rim is an absolute number
    // of pixels, not a proportion of the mark it outlines.
    const backing = h.querySelector("g.nodes circle:not(.node)")!;
    expect(parseFloat(backing.getAttribute("r")!)).toBe(27);
    // The app crown scales with them even though the theme ships no head art.
    const crown = h.querySelector("svg.crown-glyph")!;
    expect(crown.getAttribute("width")).toBe("48");
    // ...but its viewBox does NOT, or the scale would cancel itself out.
    expect(crown.getAttribute("viewBox")).toBe("0 0 24 20");
  });

  it("the HEAD crown clears its own node at 2x, and the + clears the crown", () => {
    registerRemoteGraphThemePack({
      id: "geom-crown-test",
      name: "Geom Crown Test",
      geometry: { spriteScale: 2, rowH: 84, laneW: 60 },
    });
    const h = render({ commits, refs, graphTheme: "geom-crown-test" });
    const rowY0 = 100 + 84 / 2;
    // `.crown` is translate(-50%,-50%)-centred on its inline top: NODE_R (24)
    // + the scaled 13px gap above HEAD's node centre.
    const crownCy = parseFloat(
      h.querySelector<HTMLElement>(".crown")!.style.top,
    );
    expect(crownCy).toBe(rowY0 - 24 - 26);
    // Its lower edge (half of the scaled 40px glyph height below that) still
    // sits above the node's own top edge, exactly as at 1x.
    expect(crownCy + 20).toBeLessThan(rowY0 - 24);
    // The "+" parks a scaled 60px above row 0, clear of the taller crown.
    const plusTop = parseFloat(
      h.querySelector<HTMLElement>(".new-commit")!.style.top,
    );
    expect(plusTop).toBe(rowY0 - 120);
    expect(plusTop).toBeLessThan(crownCy - 24);
  });
});

/**
 * The INTERACTIVE hit areas, which are the half of the geometry seam that
 * silently rotted: the sprites followed `spriteScale` and the CSS boxes over
 * them did not, so hero's 56px node sat inside a 30px `.node-handle` and every
 * node was ringed with exposed `.row`. `.row` carries the SAME drop key as the
 * handle, so a drag crossing that ring cleared and refilled the hover twice per
 * node — see `leaveTarget`.
 *
 * The rule each case below pins is "marks scale, pads do not": a hit area is
 * `<the mark it covers> + <a fixed pointer-tolerance pad>`, so it follows the
 * mark exactly and the pad stays put.
 */
describe("MetroGraph hit areas follow the geometry", () => {
  it("a theme with no geometry and no node art sets no hit property at all", () => {
    const s = scrollerStyle(render({ commits, refs, graphTheme: "default" }));
    // Nothing can have moved the mark, so the rule's own 30px fallback carries
    // it — byte-identical markup to before this seam existed.
    expect(s.getPropertyValue("--graph-node-hit")).toBe("");
  });

  it("the node handle grows with spriteScale, keeping its fixed pad", () => {
    registerRemoteGraphThemePack({
      id: "hit-stroked-test",
      name: "Hit Stroked Test",
      geometry: { spriteScale: 2, rowH: 84, laneW: 60 },
    });
    const h = render({ commits, refs, graphTheme: "hit-stroked-test" });
    // No node art, so the mark is the plain 2 * NODE_R circle: 48 at 2x.
    // The handle is that plus the 6px pad it always carried (30 over 24).
    expect(scrollerStyle(h).getPropertyValue("--graph-node-hit")).toBe("54px");
    // The pad is FIXED, not proportional: 54 - 48 is the same 6px as 30 - 24.
    const r = parseFloat(
      h.querySelector("g.nodes circle.node")!.getAttribute("r")!,
    );
    expect(54 - 2 * r).toBe(6);
  });

  it("the handle tracks the LARGEST node variant, so a selected node is still grabbable", () => {
    // GraphRails swaps the asset per state; one CSS box has to serve all of
    // them, so it is sized from the biggest.
    registerRemoteGraphThemePack({
      id: "hit-variants-test",
      name: "Hit Variants Test",
      node: {
        normal: { url: "data:image/png;base64,n", width: 20, height: 20 },
        selected: { url: "data:image/png;base64,s", width: 34, height: 34 },
      },
    });
    const h = render({ commits, refs, graphTheme: "hit-variants-test" });
    expect(scrollerStyle(h).getPropertyValue("--graph-node-hit")).toBe("40px");
  });

  it("the merge affordance dot does NOT scale: it is app chrome, not art", () => {
    // Same category as the "+": the dot says "you can drag from here", which
    // is a fact about the app, not about the theme's sprites. So there is no
    // `--graph-merge-hit` at any scale — `.merge-handle`'s flat 26px is the
    // grown (1.5x) 12px dot plus its 8px pointer pad, forever.
    registerRemoteGraphThemePack({
      id: "hit-merge-1x-test",
      name: "Hit Merge 1x Test",
    });
    registerRemoteGraphThemePack({
      id: "hit-merge-2x-test",
      name: "Hit Merge 2x Test",
      geometry: { spriteScale: 2, rowH: 84, laneW: 60 },
    });
    const at = (id: string) => {
      const h = render({ commits, refs, graphTheme: id });
      expect(scrollerStyle(h).getPropertyValue("--graph-merge-hit")).toBe("");
      return mergeDotSize(h, "m");
    };
    // "m" is the branch head, so it is the one row that grows a merge dot.
    const one = at("hit-merge-1x-test");
    const two = at("hit-merge-2x-test");
    expect(one).toEqual({ width: "12px", height: "12px" });
    expect(two).toEqual(one);
  });

  it("the + hit area does NOT scale: the glyph under it is fixed-size chrome", () => {
    // `plusGlyph` in GraphRails draws r="11" at every sprite scale, so a
    // scaled box would only detach the hit area from what it covers.
    registerRemoteGraphThemePack({
      id: "hit-plus-test",
      name: "Hit Plus Test",
      geometry: { spriteScale: 2, rowH: 84, laneW: 60 },
    });
    const h = render({ commits, refs, graphTheme: "hit-plus-test" });
    expect(h.querySelector(".new-commit")).not.toBeNull();
    // No custom property exists for it at all — the rule's 26px is the size.
    expect(scrollerStyle(h).getPropertyValue("--graph-plus-hit")).toBe("");
    const plus = [...h.querySelectorAll("svg circle")].find(
      (c) => c.getAttribute("r") === "11",
    );
    expect(plus).toBeDefined();
  });
});

/**
 * `GraphThemePack.backgroundFit` → how `.scroller`'s background is sized,
 * moved and filtered.
 *
 * The regression bar is the first test here: a theme that sets none of the
 * new fields must emit exactly the declarations it emitted before the field
 * existed — no `background-size`, no `background-position-y`, no filtering
 * class — which is what keeps `default`/`blueprint`/`synthwave` untouched.
 *
 * `backgroundFit` is ADDED alongside `float` rather than replacing it: the
 * Rust mirror parses with `deny_unknown_fields`, so a renamed field would make
 * an older client reject the whole downloaded pack, and a downloaded pack is
 * cached rather than re-fetched.
 */
describe("MetroGraph themed background fit", () => {
  /** Mount a one-off remote pack and hand back its `.scroller`. */
  function scrollerFor(id: string, pack: Partial<GraphThemePack>): HTMLElement {
    registerRemoteGraphThemePack({ id, name: id, ...pack } as GraphThemePack);
    return render({ commits, refs, graphTheme: id }).querySelector<HTMLElement>(
      ".scroller",
    )!;
  }

  it.each(["default", "blueprint", "synthwave"])(
    "%s sets none of the new fields and renders exactly as before",
    (id) => {
      expect(resolveGraphThemePack(id).backgroundFit).toBeUndefined();
      const s = render({
        commits,
        refs,
        graphTheme: id,
      }).querySelector<HTMLElement>(".scroller")!;
      // No declaration at all — not "the default value", none.
      expect(s.style.backgroundSize).toBe("");
      expect(s.style.backgroundPositionY).toBe("");
      expect(s.classList.contains("bg-pixelated")).toBe(false);
      expect(s.style.getPropertyValue("--graph-bg-y")).toBe("");
    },
  );

  it("a float-only pack keeps its old attachment and gains nothing else", () => {
    // The compatibility case: a pack authored before `backgroundFit`.
    const pinned = scrollerFor("fit-float-pin", {
      background: "#222222",
      float: true,
    });
    expect(pinned.style.backgroundAttachment).toBe("scroll");
    expect(pinned.style.backgroundSize).toBe("");
    expect(pinned.style.backgroundPositionY).toBe("");

    const scrolls = scrollerFor("fit-float-local", { background: "#222222" });
    expect(scrolls.style.backgroundAttachment).toBe("local");
  });

  it.each([
    ["content", "local"],
    ["pin", "scroll"],
    // Strip positions a percentage down the art's OWN overflow, which only
    // resolves against the visible pane under `scroll`; `local` would make the
    // positioning area the whole scrollable content instead.
    ["strip", "scroll"],
  ] as const)("scroll: %s uses background-attachment: %s", (mode, attach) => {
    const s = scrollerFor(`fit-scroll-${mode}`, {
      background: "#222222",
      backgroundFit: { scroll: mode },
    });
    expect(s.style.backgroundAttachment).toBe(attach);
  });

  it("backgroundFit.scroll wins over float when both are present", () => {
    // hero ships both: `float: true` for old clients, `scroll: "strip"` for
    // new ones. A new client must not be pinned by the compatibility flag.
    const s = scrollerFor("fit-both", {
      background: "#222222",
      float: true,
      backgroundFit: { scroll: "content" },
    });
    expect(s.style.backgroundAttachment).toBe("local");
  });

  it("only strip mode reads its position from --graph-bg-y", () => {
    const strip = scrollerFor("fit-posy-strip", {
      background: "#222222",
      backgroundFit: { scroll: "strip" },
    });
    expect(strip.style.backgroundPositionY).toBe("var(--graph-bg-y)");
    const pinned = scrollerFor("fit-posy-pin", {
      background: "#222222",
      backgroundFit: { scroll: "pin" },
    });
    expect(pinned.style.backgroundPositionY).toBe("");
  });

  it("size: width fits the art across the pane; natural/absent does not", () => {
    expect(
      scrollerFor("fit-size-width", {
        background: "#222222",
        backgroundFit: { size: "width" },
      }).style.backgroundSize,
    ).toBe("100% auto");
    expect(
      scrollerFor("fit-size-natural", {
        background: "#222222",
        backgroundFit: { size: "natural" },
      }).style.backgroundSize,
    ).toBe("");
    expect(
      scrollerFor("fit-size-absent", {
        background: "#222222",
        backgroundFit: { pixelated: true },
      }).style.backgroundSize,
    ).toBe("");
  });

  it("pixelated toggles the background-only filtering class", () => {
    expect(
      scrollerFor("fit-px-on", {
        background: "#222222",
        backgroundFit: { pixelated: true },
      }).classList.contains("bg-pixelated"),
    ).toBe(true);
    expect(
      scrollerFor("fit-px-off", {
        background: "#222222",
        backgroundFit: { pixelated: false },
      }).classList.contains("bg-pixelated"),
    ).toBe(false);
    // No background to filter -> no class, however the flag is set.
    expect(
      scrollerFor("fit-px-nobg", {
        backgroundFit: { pixelated: true },
      }).classList.contains("bg-pixelated"),
    ).toBe(false);
  });

  it("pixelated filtering is reset on the graph's own sprites", () => {
    // `image-rendering` INHERITS, so pixelating the surface would otherwise
    // reach every sprite inside it — and hero's sprites are DOWNSCALED, where
    // nearest-neighbour is wrong. The reset lives in the component's scoped
    // stylesheet, which jsdom does not resolve, so assert on the source.
    const css = readFileSync(path.join(__dirname, "MetroGraph.svelte"), "utf8");
    expect(css).toMatch(
      /\.scroller\.bg-pixelated\s*\{[^}]*image-rendering:\s*pixelated/,
    );
    expect(css).toMatch(
      /\.scroller\.bg-pixelated\s*>\s*:global\(\*\)\s*\{[^}]*image-rendering:\s*auto/,
    );
  });

  it("scrolling a strip-mode graph writes --graph-bg-y and nothing else", () => {
    const s = scrollerFor("fit-strip-live", {
      background: "#222222",
      backgroundFit: { scroll: "strip" },
    });
    // jsdom lays nothing out, so `clientHeight` is 0 and the scroll range is
    // the graph's full content height; the mapping itself is unit-tested in
    // `lib/graphTheme.test.ts`. What matters here is that the listener runs
    // and that the value it writes lands on the element.
    s.dispatchEvent(new Event("scroll"));
    expect(s.style.getPropertyValue("--graph-bg-y")).toBe("0%");

    Object.defineProperty(s, "scrollTop", { value: 1e6, configurable: true });
    s.dispatchEvent(new Event("scroll"));
    expect(s.style.getPropertyValue("--graph-bg-y")).toBe("100%");
  });

  it("a non-strip theme's scroll listener writes nothing at all", () => {
    const s = scrollerFor("fit-nostrip-live", {
      background: "#222222",
      backgroundFit: { scroll: "pin" },
    });
    Object.defineProperty(s, "scrollTop", { value: 500, configurable: true });
    s.dispatchEvent(new Event("scroll"));
    expect(s.style.getPropertyValue("--graph-bg-y")).toBe("");
  });
});
