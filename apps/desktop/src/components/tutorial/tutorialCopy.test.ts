import { describe, it, expect } from "vitest";
import { catalogs, en, type MessageKey } from "../../lib/i18n/messages";

/** Copy owned by the tutorial UI components (the engine's `tutorial.*` copy is
 *  covered by its own tests). */
const PREFIXES = ["tutorialUi.", "welcomeTour.", "firstUse."];
const keys = (Object.keys(en) as MessageKey[]).filter((k) =>
  PREFIXES.some((p) => k.startsWith(p)),
);

describe("tutorial UI copy", () => {
  it("exists (en)", () => {
    expect(keys.length).toBeGreaterThan(60);
    for (const k of keys) expect(en[k].trim(), k).not.toBe("");
  });

  it("is authored in Traditional Chinese for every key", () => {
    for (const k of keys) {
      const zh = catalogs["zh-Hant"][k];
      expect(zh, `zh-Hant ${k}`).toBeTruthy();
      expect(zh, `zh-Hant ${k} must be translated`).not.toBe(en[k]);
    }
  });

  it("keeps {placeholders} identical across en and zh-Hant", () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of keys)
      expect(ph(catalogs["zh-Hant"][k]!), k).toBe(ph(en[k]));
  });

  it("keeps the per-provider step lists the same length in both languages", () => {
    const steps = keys.filter((k) =>
      /^firstUse\.(git|issue)\.\w+\.steps$/.test(k),
    );
    expect(steps).toHaveLength(8);
    for (const k of steps)
      expect(catalogs["zh-Hant"][k]!.split("\n").length, k).toBe(
        en[k].split("\n").length,
      );
  });
});
