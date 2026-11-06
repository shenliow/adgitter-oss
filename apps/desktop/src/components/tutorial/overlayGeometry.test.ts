import { describe, it, expect } from "vitest";
import {
  holePath,
  ringPath,
  prepareHoles,
  roundedRectPath,
  placeCard,
  revealDelta,
  type Rect,
} from "./overlayGeometry";

const VP = { w: 1000, h: 800 };
const OUTER = "M0 0H1000V800H0Z";

/** Number of closed sub-paths (`Z`) in a path string. */
const subpaths = (d: string) => (d.match(/Z/g) ?? []).length;

describe("roundedRectPath", () => {
  it("draws a closed rounded rectangle with four arcs", () => {
    const d = roundedRectPath({ x: 10, y: 20, w: 100, h: 50 }, 8);
    expect(d).toBe(
      "M18 20H102A8 8 0 0 1 110 28V62A8 8 0 0 1 102 70H18A8 8 0 0 1 10 62V28A8 8 0 0 1 18 20Z",
    );
    expect((d.match(/A/g) ?? []).length).toBe(4);
  });

  it("clamps the radius to half the shorter side", () => {
    const d = roundedRectPath({ x: 0, y: 0, w: 10, h: 10 }, 99);
    expect(d).toContain("A5 5 0 0 1");
  });
});

describe("prepareHoles", () => {
  it("pads every rect on all sides", () => {
    expect(prepareHoles([{ x: 100, y: 100, w: 50, h: 40 }], VP, 6)).toEqual([
      { x: 94, y: 94, w: 62, h: 52 },
    ]);
  });

  it("clips holes to the viewport and drops fully off-screen ones", () => {
    const holes = prepareHoles(
      [
        { x: -50, y: 10, w: 80, h: 20 }, // sticks out on the left
        { x: 2000, y: 10, w: 80, h: 20 }, // entirely off to the right
      ],
      VP,
      0,
    );
    expect(holes).toEqual([{ x: 0, y: 10, w: 30, h: 20 }]);
  });

  it("keeps disjoint holes separate and in order", () => {
    const a: Rect = { x: 0, y: 0, w: 50, h: 50 };
    const b: Rect = { x: 300, y: 300, w: 50, h: 50 };
    expect(prepareHoles([a, b], VP, 0)).toEqual([a, b]);
  });

  it("drops a hole contained in another (even-odd would re-fill it)", () => {
    const holes = prepareHoles(
      [
        { x: 100, y: 100, w: 400, h: 400 },
        { x: 150, y: 150, w: 50, h: 50 },
      ],
      VP,
      0,
    );
    expect(holes).toEqual([{ x: 100, y: 100, w: 400, h: 400 }]);
  });

  it("merges partially overlapping holes into their bounding box", () => {
    const holes = prepareHoles(
      [
        { x: 100, y: 100, w: 100, h: 100 },
        { x: 150, y: 150, w: 100, h: 100 },
      ],
      VP,
      0,
    );
    expect(holes).toEqual([{ x: 100, y: 100, w: 150, h: 150 }]);
  });

  it("merges chains of overlaps and keeps the first rect's slot", () => {
    const far: Rect = { x: 800, y: 600, w: 20, h: 20 };
    const holes = prepareHoles(
      [
        { x: 0, y: 0, w: 100, h: 100 },
        far,
        { x: 90, y: 0, w: 100, h: 100 },
        { x: 180, y: 0, w: 100, h: 100 },
      ],
      VP,
      0,
    );
    expect(holes).toEqual([{ x: 0, y: 0, w: 280, h: 100 }, far]);
  });

  it("treats rects that merely touch as separate holes", () => {
    const holes = prepareHoles(
      [
        { x: 0, y: 0, w: 100, h: 100 },
        { x: 100, y: 0, w: 100, h: 100 },
      ],
      VP,
      0,
    );
    expect(holes).toHaveLength(2);
  });
});

describe("holePath", () => {
  it("with no holes is just the full-viewport rectangle (full block)", () => {
    expect(holePath([], VP, 6, 8)).toBe(OUTER);
  });

  it("is the outer rect plus one rounded-rect sub-path per hole", () => {
    const rects: Rect[] = [
      { x: 100, y: 100, w: 200, h: 80 },
      { x: 500, y: 400, w: 100, h: 100 },
      { x: 700, y: 50, w: 60, h: 60 },
    ];
    const d = holePath(rects, VP, 6, 8);
    expect(d.startsWith(OUTER)).toBe(true);
    expect(subpaths(d)).toBe(1 + rects.length);
    // the first hole is the first rect padded by 6px, corners rounded by 8
    expect(d).toContain(roundedRectPath({ x: 94, y: 94, w: 212, h: 92 }, 8));
  });

  it("counts overlapping targets once", () => {
    const d = holePath(
      [
        { x: 100, y: 100, w: 300, h: 300 },
        { x: 150, y: 150, w: 40, h: 40 },
      ],
      VP,
      6,
      8,
    );
    expect(subpaths(d)).toBe(2);
  });

  it("uses the supplied viewport for the outer rect", () => {
    expect(holePath([], { w: 320, h: 200 }, 6, 8)).toBe("M0 0H320V200H0Z");
  });
});

describe("ringPath", () => {
  it("holds only the hole outlines, no outer rectangle", () => {
    const d = ringPath([{ x: 100, y: 100, w: 50, h: 50 }], VP, 6, 8);
    expect(subpaths(d)).toBe(1);
    expect(d.startsWith(OUTER)).toBe(false);
    expect(ringPath([], VP, 6, 8)).toBe("");
  });
});

describe("placeCard", () => {
  const CARD = { w: 300, h: 160 };
  const overlaps = (a: Rect, b: Rect) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const cardRect = (
    p: { left: number; top: number },
    size: { w: number; h: number } = CARD,
  ): Rect => ({
    x: p.left,
    y: p.top,
    w: size.w,
    h: size.h,
  });

  it("centres the card when there is no hole", () => {
    expect(placeCard([], CARD, VP)).toEqual({
      left: 350,
      top: 320,
      side: "center",
      overlaps: false,
    });
  });

  it("prefers the right of the first hole, top-aligned", () => {
    const hole: Rect = { x: 100, y: 200, w: 120, h: 60 };
    const p = placeCard([hole], CARD, VP);
    expect(p.side).toBe("right");
    expect(p.left).toBe(100 + 120 + 14);
    expect(p.top).toBe(200);
    expect(p.overlaps).toBe(false);
  });

  it("flips to the left when there is no room on the right", () => {
    const hole: Rect = { x: 800, y: 200, w: 150, h: 60 };
    const p = placeCard([hole], CARD, VP);
    expect(p.side).toBe("left");
    expect(p.left).toBe(800 - 14 - CARD.w);
    expect(overlaps(cardRect(p), hole)).toBe(false);
  });

  it("goes below a wide hole spanning most of the width", () => {
    const hole: Rect = { x: 20, y: 20, w: 960, h: 80 };
    const p = placeCard([hole], CARD, VP);
    expect(p.side).toBe("below");
    expect(p.top).toBe(20 + 80 + 14);
    expect(p.left + CARD.w).toBeLessThanOrEqual(VP.w - 12);
    expect(overlaps(cardRect(p), hole)).toBe(false);
  });

  it("goes above a wide hole at the bottom of the viewport", () => {
    const hole: Rect = { x: 20, y: 700, w: 960, h: 80 };
    const p = placeCard([hole], CARD, VP);
    expect(p.side).toBe("above");
    expect(p.top).toBe(700 - 14 - CARD.h);
    expect(overlaps(cardRect(p), hole)).toBe(false);
  });

  it("clamps into the viewport and keeps the margin", () => {
    const hole: Rect = { x: 100, y: 760, w: 100, h: 30 };
    const p = placeCard([hole], CARD, VP);
    expect(p.top + CARD.h).toBeLessThanOrEqual(VP.h - 12);
    expect(p.top).toBeGreaterThanOrEqual(12);
    expect(p.left).toBeGreaterThanOrEqual(12);
  });

  it("also clears the other holes, not only the first", () => {
    const first: Rect = { x: 100, y: 200, w: 120, h: 60 };
    // sits right where the "right of the first hole" candidate would land
    const second: Rect = { x: 240, y: 190, w: 200, h: 100 };
    const p = placeCard([first, second], CARD, VP);
    expect(overlaps(cardRect(p), first)).toBe(false);
    expect(overlaps(cardRect(p), second)).toBe(false);
    expect(p.overlaps).toBe(false);
    expect(p.side).not.toBe("right");
  });

  it("falls back to a clear corner when no side of a big hole fits", () => {
    // a hole covering everything but a 340px strip along the left edge: the
    // card only fits in the left strip, never beside the hole's own sides
    const big: Rect = { x: 340, y: 0, w: 660, h: 800 };
    const p = placeCard([big], CARD, VP);
    expect(overlaps(cardRect(p), big)).toBe(false);
    expect(p.overlaps).toBe(false);
  });

  it("when it must overlap, it covers a sliver of a big panel rather than a whole button inside it", () => {
    // The Settings modal (75vw × 75vh, centred) with its OK button in the
    // bottom-right corner: merging drops the button's hole inside the
    // modal's, so only the per-target scoring can see it.
    const vp = { w: 1280, h: 800 };
    const modal: Rect = { x: 154, y: 94, w: 972, h: 612 };
    const ok: Rect = { x: 1037, y: 647, w: 67, h: 41 };
    const gear: Rect = { x: 1202, y: 0, w: 38, h: 38 };
    const card = { w: 340, h: 168 };
    const p = placeCard([gear, modal], card, vp, {
      targets: [gear, modal, ok],
    });
    expect(p.overlaps).toBe(true);
    expect(overlaps(cardRect(p, card), ok)).toBe(false);
    expect(overlaps(cardRect(p, card), gear)).toBe(false);
  });

  it("reports `overlaps` only when every position would cover a hole", () => {
    const whole: Rect = { x: 0, y: 0, w: 1000, h: 800 };
    const p = placeCard([whole], CARD, VP);
    expect(p.overlaps).toBe(true);
    // still inside the viewport
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.left + CARD.w).toBeLessThanOrEqual(VP.w);
  });
});

describe("revealDelta", () => {
  // The graph at 1280×800: below the 38px top bar, above the status bar.
  const VIEW: Rect = { x: 0, y: 38, w: 1280, h: 740 };
  const row = (y: number): Rect => ({ x: 0, y, w: 1280, h: 56 });
  const chip = (y: number): Rect => ({ x: 500, y, w: 80, h: 24 });

  it("does nothing when every target already shows", () => {
    expect(revealDelta([row(200), chip(400)], VIEW)).toEqual({ dx: 0, dy: 0 });
  });

  it("scrolls a row half under the status bar into view (the cherry-pick report)", () => {
    const { dx, dy } = revealDelta([row(754), chip(378)], VIEW);
    expect(dx).toBe(0);
    // 754+56 = 810 must end 12px above 778.
    expect(dy).toBe(810 - (778 - 12));
  });

  it("scrolls back up for a chip hidden under the top bar", () => {
    expect(revealDelta([chip(22)], VIEW).dy).toBe(22 - (38 + 12));
  });

  it("keeps the source and the drop target together when both fit", () => {
    const { dy } = revealDelta([row(1200), chip(300)], VIEW);
    // The union 300..1256 is 956px: too tall, so the chip is dropped and
    // only the source row is brought in.
    expect(dy).toBe(1256 - (778 - 12));
    const both = revealDelta([row(900), chip(300)], VIEW).dy;
    // Union 300..956 fits: its bottom lands inside the view, its top too.
    expect(300 - both).toBeGreaterThanOrEqual(38);
    expect(956 - both).toBeLessThanOrEqual(778);
  });

  it("shows the start of a source taller than the view", () => {
    expect(revealDelta([{ x: 0, y: 1000, w: 10, h: 2000 }], VIEW).dy).toBe(
      1000 - 38,
    );
    expect(revealDelta([{ x: 0, y: 100, w: 10, h: 2000 }], VIEW).dy).toBe(0);
  });

  it("solves the axes separately, so a full-width row never blocks a chip", () => {
    const narrow: Rect = { x: 0, y: 38, w: 1265, h: 740 }; // a scrollbar
    expect(revealDelta([row(800), chip(300)], narrow)).toEqual({
      dx: 0,
      dy: 856 - (778 - 12),
    });
  });

  it("returns zero without targets", () => {
    expect(revealDelta([], VIEW)).toEqual({ dx: 0, dy: 0 });
  });
});

describe("placeCard with a graph-sized hole", () => {
  const VPG = { w: 1280, h: 800 };
  const graph: Rect = { x: 0, y: 32, w: 1280, h: 752 };
  const card = { w: 340, h: 200 };
  // The first rows' chips sit at the top centre (the tour-graph report).
  const chips: Rect[] = [
    { x: 430, y: 154, w: 100, h: 24 },
    { x: 530, y: 210, w: 80, h: 24 },
    { x: 380, y: 266, w: 220, h: 24 },
  ];

  it("docks bottom-right, clear of every chip, instead of covering them", () => {
    const p = placeCard([graph], card, VPG, { avoid: chips });
    const r = { x: p.left, y: p.top, w: card.w, h: card.h };
    for (const c of chips)
      expect(
        r.x < c.x + c.w &&
          c.x < r.x + r.w &&
          r.y < c.y + c.h &&
          c.y < r.y + r.h,
      ).toBe(false);
    expect(p.left).toBe(1280 - 340 - 12);
    expect(p.top).toBe(800 - 200 - 12);
  });

  it("moves elsewhere when the bottom-right holds a mark", () => {
    const low: Rect = { x: 1100, y: 700, w: 60, h: 30 };
    const p = placeCard([graph], card, VPG, { avoid: [...chips, low] });
    expect(p.top).toBe(800 - 200 - 12);
    expect(p.left).toBe((1280 - 340) / 2);
  });
});
