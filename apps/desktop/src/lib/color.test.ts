import { describe, it, expect } from "vitest";
import {
  isValidHex,
  hexToRgb,
  rgbToHex,
  rgbToHsv,
  hsvToRgb,
  hexToHsv,
  hsvToHex,
} from "./color";

describe("hex validation + parsing", () => {
  it("accepts #rgb and #rrggbb, rejects junk", () => {
    expect(isValidHex("#fff")).toBe(true);
    expect(isValidHex("#ffbb00")).toBe(true);
    expect(isValidHex("ffbb00")).toBe(false);
    expect(isValidHex("#xyz")).toBe(false);
  });

  it("expands shorthand hex", () => {
    expect(hexToRgb("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb("bad")).toBeNull();
  });

  it("rgbToHex clamps and pads", () => {
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe("#000000");
    expect(rgbToHex({ r: 300, g: -5, b: 16 })).toBe("#ff0010");
  });
});

describe("hsv conversions", () => {
  it("primary colors round-trip", () => {
    expect(rgbToHsv({ r: 255, g: 0, b: 0 })).toMatchObject({
      h: 0,
      s: 1,
      v: 1,
    });
    expect(rgbToHsv({ r: 0, g: 255, b: 0 }).h).toBeCloseTo(120);
    expect(rgbToHsv({ r: 0, g: 0, b: 255 }).h).toBeCloseTo(240);
  });

  it("hsv→rgb produces the expected hue", () => {
    expect(rgbToHex(hsvToRgb({ h: 0, s: 1, v: 1 }))).toBe("#ff0000");
    expect(rgbToHex(hsvToRgb({ h: 120, s: 1, v: 1 }))).toBe("#00ff00");
  });

  it("hex↔hsv round-trips a mid color", () => {
    const hex = "#3a86ff";
    const back = hsvToHex(hexToHsv(hex)!);
    expect(back.toLowerCase()).toBe(hex);
  });

  it("greys have zero saturation", () => {
    expect(rgbToHsv({ r: 128, g: 128, b: 128 }).s).toBe(0);
  });
});
