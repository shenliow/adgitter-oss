import { describe, it, expect, afterEach } from "vitest";
import {
  graphThemes,
  resolveGraphThemePack,
  registerRemoteGraphThemePack,
  availableGraphThemes,
  __resetRemoteGraphThemePacks,
  themeLane,
  laneVar,
  railGlow,
  backgroundStripOffset,
  edgeSegments,
  junctionRole,
  type EdgeGeometry,
  type GraphThemePack,
} from "./graphTheme";
import { svgStripMarker, svgMarkerUrl } from "./themes/svgMarker.js";
import { catalogs } from "./i18n/messages";

/** A pack with a lane palette and glowing rails, for the shared helpers. */
const PALETTE_PACK: GraphThemePack = {
  id: "palette-sample",
  name: "Palette sample",
  lanes: ["#ff2d95", "#00e6e6", "#b56bff"],
  edges: { glow: { blur: 4, widthScale: 1.1 } },
};

describe("themeLane / laneVar / railGlow (shared helpers)", () => {
  it("themeLane returns the theme palette (mod length, wrapped) or null", () => {
    const sw = PALETTE_PACK;
    expect(themeLane(sw, 0)).toBe(sw.lanes![0]);
    expect(themeLane(sw, sw.lanes!.length)).toBe(sw.lanes![0]); // wraps
    expect(themeLane(sw, -1)).toBe(sw.lanes![sw.lanes!.length - 1]);
    // default theme ships no palette.
    expect(themeLane(resolveGraphThemePack("default"), 3)).toBeNull();
  });

  it("laneVar maps to the default --lane-N var (0..7, wrapped)", () => {
    expect(laneVar(0)).toBe("var(--lane-0)");
    expect(laneVar(9)).toBe("var(--lane-1)");
    expect(laneVar(-1)).toBe("var(--lane-7)");
  });

  it("railGlow returns a drop-shadow only for glow themes", () => {
    expect(railGlow(PALETTE_PACK, "#ff2d95")).toContain("drop-shadow");
    expect(railGlow(resolveGraphThemePack("default"), "#000")).toBeUndefined();
  });
});

describe("graphThemes() / resolveGraphThemePack", () => {
  it("ships a free theme besides the default, so there is always one to apply", () => {
    const midnight = resolveGraphThemePack("midnight");
    expect(midnight.id).toBe("midnight");
    expect(midnight.priceUsd).toBeUndefined();
    expect(midnight.premium).toBeUndefined();
    expect(midnight.lanes?.length).toBe(8);
    expect(midnight.text?.color).toBeTruthy();
  });

  it("starts with a no-override default", () => {
    const def = graphThemes()[0];
    expect(def.id).toBe("default");
    expect(def.head).toBeUndefined();
    expect(def.node).toBeUndefined();
    expect(def.background).toBeUndefined();
    expect(def.edges).toBeUndefined();
    expect(def.decorUnder).toBeUndefined();
    expect(def.decorOver).toBeUndefined();
  });

  it("resolves known ids and falls back to default for unknown/stale ids", () => {
    expect(resolveGraphThemePack("default").id).toBe("default");
    expect(resolveGraphThemePack("does-not-exist").id).toBe("default");
    expect(resolveGraphThemePack("").id).toBe("default");
  });

  it("strips a marker `stroke` too, and refuses a marker it cannot delete safely", () => {
    // Two traps a redraw can walk into. A stripe drawn as a STROKE rather
    // than a fill must still go...
    expect(
      svgStripMarker('<rect x="1" stroke="#f00" stroke-width="1"/><g/>'),
    ).toBe("<g/>");
    // ...and a marker this rule cannot delete element-wise (a container with
    // children, a `style=`, a gradient stop) must FAIL THE BUILD rather than
    // ship a red stripe, which would just look like broken art.
    expect(() => svgStripMarker('<g fill="#f00"><rect x="1"/></g>')).toThrow(
      /marker colour survived/,
    );
  });

  it("the strip rule does not swallow a longer hex that merely starts with f00", () => {
    // The art contains `#f1d232`/`#e6cd1b`, and a bare /#f00/ would match the
    // leading half of any future `#f00xxx` — and this rule DELETES what it
    // matches, so a sloppy match would silently drop a road element.
    const kept =
      '<rect fill="#f00baa"/><rect fill="#f1d232"/><rect fill="#F00BAA"/>';
    const stripped = svgStripMarker(
      `<rect fill="#f00"/>${kept}<rect fill="#F00"/>`,
    );
    expect(stripped).toBe(kept);

    const url = svgMarkerUrl(
      '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4" viewBox="0 0 4 4">' +
        `${kept}<rect fill="#f00"/></svg>`,
    );
    expect(url).toContain("%23f00baa");
    expect(url).toContain("%23F00BAA");
    expect(url).toContain("%23f1d232");
    expect(url).not.toMatch(/%23f00(?![0-9a-f])/i);
  });
});

describe("junctionRole", () => {
  it("is total over every 2-way direction-set (the four corners + two straights)", () => {
    expect(junctionRole("NS")).toBe("vertical");
    expect(junctionRole("EW")).toBe("horizontal");
    expect(junctionRole("NW")).toBe("fromLeft");
    expect(junctionRole("NE")).toBe("fromRight");
    expect(junctionRole("SW")).toBe("toLeft");
    expect(junctionRole("SE")).toBe("toRight");
  });

  it("disambiguates the two 3-way direction-sets by JunctionSense", () => {
    expect(junctionRole("NSW", "fork")).toBe("forkLeft");
    expect(junctionRole("NSW", "merge")).toBe("mergeLeft");
    expect(junctionRole("NSE", "fork")).toBe("forkRight");
    expect(junctionRole("NSE", "merge")).toBe("mergeRight");
  });

  it("throws for a 3-way direction-set given no sense", () => {
    expect(() => junctionRole("NSW")).toThrow();
    expect(() => junctionRole("NSE")).toThrow();
  });
});

// ── Description: built-in (translatable) vs remote (not) ──────────────────────
//
// A built-in pack's description ships in the binary, so it goes through the
// catalog as `descriptionKey`. A remote pack's arrives over the network and
// *cannot*, so it keeps raw `description`. The two have to coexist: neither
// path may require the other, and a remote pack must never lose its text.
describe("graph-theme descriptions", () => {
  afterEach(() => __resetRemoteGraphThemePacks());

  it("every built-in describes itself by catalog key, not raw English", () => {
    for (const p of graphThemes()) {
      expect(p.descriptionKey, `${p.id} has no descriptionKey`).toBeTruthy();
      // A leftover raw string would win nothing but would rot out of sync.
      expect(
        p.description,
        `${p.id} still has a raw description`,
      ).toBeUndefined();
    }
  });

  it("those keys are translated in all eight catalogs", () => {
    for (const p of graphThemes()) {
      const key = p.descriptionKey!;
      for (const [loc, catalog] of Object.entries(catalogs)) {
        expect(catalog[key], `${loc} is missing ${key}`).toBeTruthy();
        if (loc !== "en")
          expect(catalog[key], `${loc} copied en for ${key}`).not.toBe(
            catalogs.en[key],
          );
      }
    }
  });

  it("a remote pack keeps its raw description and needs no key", () => {
    const pack: GraphThemePack = {
      id: "downloaded-one",
      name: "Downloaded",
      description: "Beschreibung vom Server",
    };
    registerRemoteGraphThemePack(pack);

    const resolved = resolveGraphThemePack("downloaded-one");
    expect(resolved.description).toBe("Beschreibung vom Server");
    expect(resolved.descriptionKey).toBeUndefined();
    // …and it still coexists with the built-ins rather than shadowing them.
    expect(resolveGraphThemePack("default").descriptionKey).toBe(
      "graphTheme.default.description",
    );
    expect(availableGraphThemes().map((p) => p.id)).toContain("downloaded-one");
  });
});

describe("edgeSegments", () => {
  it("decomposes a pure vertical edge into one vertical segment", () => {
    const g: EdgeGeometry = {
      x1: 100,
      y1: 50,
      x2: 100,
      y2: 150,
      isFirstParent: true,
      cornerRadius: 14,
    };
    expect(edgeSegments(g)).toEqual([
      { kind: "vertical", x: 100, y1: 50, y2: 150 },
    ]);
  });

  it("pure vertical is independent of isFirstParent", () => {
    const g: EdgeGeometry = {
      x1: 40,
      y1: 0,
      x2: 40,
      y2: 56,
      isFirstParent: false,
      cornerRadius: 14,
    };
    expect(edgeSegments(g)).toEqual([
      { kind: "vertical", x: 40, y1: 0, y2: 56 },
    ]);
  });

  it("first-parent, rightward (parent lane to the right): V -> corner(rotate 0) -> H", () => {
    const g: EdgeGeometry = {
      x1: 100,
      y1: 50,
      x2: 160,
      y2: 200,
      isFirstParent: true,
      cornerRadius: 14,
    };
    // r = min(14, 30, 75) = 14; sx = 1
    expect(edgeSegments(g)).toEqual([
      { kind: "vertical", x: 100, y1: 50, y2: 186 },
      { kind: "corner", x: 100, y: 200, rotate: 0, dirSet: "NE" },
      { kind: "horizontal", y: 200, x1: 114, x2: 160 },
    ]);
  });

  it("first-parent, leftward (parent lane to the left): V -> corner(rotate 270) -> H", () => {
    const g: EdgeGeometry = {
      x1: 160,
      y1: 50,
      x2: 100,
      y2: 200,
      isFirstParent: true,
      cornerRadius: 14,
    };
    // r = min(14, 30, 75) = 14; sx = -1
    expect(edgeSegments(g)).toEqual([
      { kind: "vertical", x: 160, y1: 50, y2: 186 },
      { kind: "corner", x: 160, y: 200, rotate: 270, dirSet: "NW" },
      { kind: "horizontal", y: 200, x1: 146, x2: 100 },
    ]);
  });

  it("non-first-parent (merge edge), rightward: H -> corner(rotate 180) -> V", () => {
    const g: EdgeGeometry = {
      x1: 100,
      y1: 50,
      x2: 160,
      y2: 200,
      isFirstParent: false,
      cornerRadius: 14,
    };
    // r = min(14, 30, 75) = 14; sx = 1
    expect(edgeSegments(g)).toEqual([
      { kind: "horizontal", y: 50, x1: 100, x2: 146 },
      { kind: "corner", x: 160, y: 50, rotate: 180, dirSet: "SW" },
      { kind: "vertical", x: 160, y1: 64, y2: 200 },
    ]);
  });

  it("non-first-parent (merge edge), leftward: H -> corner(rotate 90) -> V", () => {
    const g: EdgeGeometry = {
      x1: 160,
      y1: 50,
      x2: 100,
      y2: 200,
      isFirstParent: false,
      cornerRadius: 14,
    };
    // r = min(14, 30, 75) = 14; sx = -1
    expect(edgeSegments(g)).toEqual([
      { kind: "horizontal", y: 50, x1: 160, x2: 114 },
      { kind: "corner", x: 100, y: 50, rotate: 90, dirSet: "SE" },
      { kind: "vertical", x: 100, y1: 64, y2: 200 },
    ]);
  });

  it("clamps the corner radius to half the (small) horizontal span", () => {
    const g: EdgeGeometry = {
      x1: 100,
      y1: 50,
      x2: 110,
      y2: 200,
      isFirstParent: true,
      cornerRadius: 14,
    };
    // dx = 10 -> |dx|/2 = 5 < 14 < |dy|/2 = 75, so r = 5.
    expect(edgeSegments(g)).toEqual([
      { kind: "vertical", x: 100, y1: 50, y2: 195 },
      { kind: "corner", x: 100, y: 200, rotate: 0, dirSet: "NE" },
      { kind: "horizontal", y: 200, x1: 105, x2: 110 },
    ]);
  });

  it("clamps the corner radius to half the (small) vertical span", () => {
    const g: EdgeGeometry = {
      x1: 100,
      y1: 50,
      x2: 160,
      y2: 60,
      isFirstParent: false,
      cornerRadius: 14,
    };
    // dy = 10 -> |dy|/2 = 5 < 14 < |dx|/2 = 30, so r = 5.
    expect(edgeSegments(g)).toEqual([
      { kind: "horizontal", y: 50, x1: 100, x2: 155 },
      { kind: "corner", x: 160, y: 50, rotate: 180, dirSet: "SW" },
      { kind: "vertical", x: 160, y1: 55, y2: 60 },
    ]);
  });
});

/**
 * `backgroundStripOffset` — the `backgroundFit.scroll: "strip"` mapping.
 *
 * The strip's own height is mapped onto the graph's full scroll range: at the
 * top of the graph the art shows its top, and at the very bottom of the graph
 * it shows its very bottom. CSS cannot express that, so `MetroGraph` drives it
 * from a scroll listener; the arithmetic lives here, pure, because jsdom
 * reports every laid-out dimension as 0 and the degenerate cases are exactly
 * the ones about pane-vs-content size.
 */
describe("backgroundStripOffset maps the scroll range onto the strip", () => {
  it("is at the strip's top when the graph is scrolled to the top", () => {
    expect(backgroundStripOffset(0, 2000, 500)).toBe("0%");
  });

  it("is at the strip's very bottom when the graph is scrolled to the bottom", () => {
    // range = 2000 - 500 = 1500; scrollTop 1500 is the last scrollable pixel.
    expect(backgroundStripOffset(1500, 2000, 500)).toBe("100%");
  });

  it("is proportionally placed in between", () => {
    expect(backgroundStripOffset(750, 2000, 500)).toBe("50%");
    expect(backgroundStripOffset(375, 2000, 500)).toBe("25%");
  });

  it("clamps rubber-band overscroll in both directions", () => {
    // macOS reports a scrollTop outside [0, range] during an elastic bounce;
    // unclamped that would push the background past its own ends.
    expect(backgroundStripOffset(-120, 2000, 500)).toBe("0%");
    expect(backgroundStripOffset(9999, 2000, 500)).toBe("100%");
  });

  it("degenerate: no scroll range at all keeps the strip at its top", () => {
    // Content shorter than (or exactly as tall as) the pane — there is no
    // range to map onto, and the division would be by zero.
    expect(backgroundStripOffset(0, 300, 800)).toBe("0%");
    expect(backgroundStripOffset(50, 800, 800)).toBe("0%");
    // Not NaN/Infinity: either would serialise into an invalid CSS value and
    // the whole `background-position-y` declaration would be dropped.
    expect(backgroundStripOffset(50, 300, 800)).not.toContain("NaN");
  });

  it("degenerate: an unmeasured pane still yields a usable percentage", () => {
    // The very first render, before the pane has been measured. The mapping
    // stays valid (the full content height is the range) rather than
    // producing a broken declaration.
    expect(backgroundStripOffset(0, 1000, 0)).toBe("0%");
    expect(backgroundStripOffset(1000, 1000, 0)).toBe("100%");
  });
});
