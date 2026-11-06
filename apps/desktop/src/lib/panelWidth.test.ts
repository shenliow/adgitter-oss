import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  loadPanelWidth,
  savePanelWidth,
  clampWidth,
  PANEL_MIN_WIDTH,
  PANEL_MAX_WIDTH,
} from "./panelWidth";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("panelWidth", () => {
  it("clamps to [min, max]", () => {
    expect(clampWidth(10)).toBe(PANEL_MIN_WIDTH);
    expect(clampWidth(9999)).toBe(PANEL_MAX_WIDTH);
    expect(clampWidth(400)).toBe(400);
  });

  it("falls back when nothing is stored", () => {
    expect(loadPanelWidth("branches", 320)).toBe(320);
  });

  it("round-trips a saved width", () => {
    savePanelWidth("files", 412);
    expect(loadPanelWidth("files", 320)).toBe(412);
  });

  it("keys panels independently", () => {
    savePanelWidth("branches", 300);
    savePanelWidth("details", 500);
    expect(loadPanelWidth("branches", 320)).toBe(300);
    expect(loadPanelWidth("details", 350)).toBe(500);
  });

  it("clamps both on save and on load", () => {
    savePanelWidth("details", 5000); // over max
    expect(loadPanelWidth("details", 350)).toBe(PANEL_MAX_WIDTH);
    // A value that somehow lands out of range in storage is re-clamped on read.
    localStorage.setItem("adgitter.panelWidth.branches", "20");
    expect(loadPanelWidth("branches", 320)).toBe(PANEL_MIN_WIDTH);
  });

  it("falls back on a non-numeric stored value", () => {
    localStorage.setItem("adgitter.panelWidth.files", "wide");
    expect(loadPanelWidth("files", 320)).toBe(320);
  });

  it("survives a storage failure without throwing", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => savePanelWidth("branches", 400)).not.toThrow();
  });
});
