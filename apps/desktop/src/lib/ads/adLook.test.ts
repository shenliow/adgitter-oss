import { describe, it, expect } from "vitest";
import { adColors } from "./adLook";

describe("adColors", () => {
  it("puts dark text on the base theme's light strip", () => {
    const c = adColors("rgb(205, 205, 205)");
    expect(c.background).toBe("rgb(205, 205, 205)");
    expect(c.text).toBe("#2b2b2b");
  });

  it("puts light text on a dark strip", () => {
    // `ad-bg` of the theme template, as hex and as the browser reports it.
    expect(adColors("#232838").text).toBe("#ededee");
    expect(adColors("rgb(35, 40, 56)").text).toBe("#ededee");
    expect(adColors("rgb(35 40 56)").text).toBe("#ededee");
    expect(adColors("#000").text).toBe("#ededee");
  });

  it("keeps secondary text apart from the copy in both cases", () => {
    for (const bg of ["#cdcdcd", "#232838"]) {
      const c = adColors(bg);
      expect(c.muted).not.toBe(c.text);
    }
  });

  it("falls back to the base strip when the background can't be read", () => {
    // An unresolved variable computes to transparent; black-with-no-alpha is
    // not a dark background.
    for (const bg of [
      "",
      "rgba(0, 0, 0, 0)",
      "rgb(0 0 0 / 0%)",
      "oklch(0.3 0 0)",
    ]) {
      expect(adColors(bg)).toEqual(adColors("#cdcdcd"));
    }
  });
});
