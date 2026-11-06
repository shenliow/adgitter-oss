import { describe, it, expect, beforeEach } from "vitest";
import { t, setLocale, getLocale } from "./index.svelte";
import { catalogs, LOCALES, en, type MessageKey } from "./messages";
import { SEARCH_SCOPES } from "../search";

beforeEach(() => setLocale("en"));

describe("i18n runtime", () => {
  it("returns the source (en) string by default", () => {
    expect(getLocale()).toBe("en");
    expect(t("user.logout")).toBe("Log out");
  });

  it("switches locale and translates", () => {
    setLocale("zh-Hant");
    expect(getLocale()).toBe("zh-Hant");
    expect(t("user.logout")).toBe("登出");
  });

  it("uses the zh-Hant translation for every launch-locale key (100% covered)", () => {
    setLocale("zh-Hant");
    // topbar.repoFallback used to be en-only; zh-Hant is now complete.
    expect(t("topbar.repoFallback")).toBe("儲存庫名稱");
  });

  it("every locale is now fully translated — no en fallback", () => {
    const enValue = t("user.logout"); // "Log out"
    for (const loc of ["zh-Hans", "ja", "ko", "hi", "de", "fr"] as const) {
      setLocale(loc);
      const v = t("user.logout");
      expect(v).toBeTruthy();
      expect(v).not.toBe(enValue); // translated, not the en source
    }
    // Exact spot-checks for a couple of locales.
    setLocale("ja");
    expect(t("user.logout")).toBe("ログアウト");
    setLocale("de");
    expect(t("user.logout")).toBe("Abmelden");
  });

  it("interpolates params", () => {
    expect(t("welcome.greetingName", { name: "Ada" })).toBe("Welcome Ada");
    setLocale("zh-Hant");
    expect(t("welcome.greetingName", { name: "Ada" })).toBe("歡迎 Ada");
  });

  it("ignores unknown locales", () => {
    setLocale("klingon");
    expect(getLocale()).toBe("en");
  });
});

// `Catalog` is a `Partial<Record<MessageKey, string>>`, so a key added to `en`
// and forgotten in a locale compiles fine and silently ships English there.
// Pin full alignment for every catalog: same key set as `en`, no extras, no
// blanks — the guard that makes "add a key to all 8" mechanically checkable.
describe("every catalog is aligned with the en source", () => {
  const enKeys = Object.keys(en).sort();

  for (const [loc, catalog] of Object.entries(catalogs)) {
    if (loc === "en") continue;

    it(`${loc} defines all ${enKeys.length} keys, and nothing else`, () => {
      const keys = Object.keys(catalog).sort();
      const missing = enKeys.filter((k) => !keys.includes(k));
      const extra = keys.filter((k) => !enKeys.includes(k));
      expect(missing, `${loc} is missing: ${missing.join(", ")}`).toEqual([]);
      expect(extra, `${loc} has stray keys: ${extra.join(", ")}`).toEqual([]);
    });

    it(`${loc} has no empty values`, () => {
      const blank = Object.entries(catalog)
        .filter(([, v]) => !v || !String(v).trim())
        .map(([k]) => k);
      expect(blank, `${loc} has blank values: ${blank.join(", ")}`).toEqual([]);
    });
  }
});

// The scope picker builds its menu from SEARCH_SCOPES, so a scope whose label
// is missing from a catalog would render the raw key ("search.scope.hash") in
// that language. Pin every scope's label + placeholder to every catalog — the
// same guard the error codes already have.
describe("every search scope is labelled in every catalog", () => {
  const localeCodes = LOCALES.map((l) => l.code);

  for (const loc of localeCodes) {
    it(`${loc} labels all ${SEARCH_SCOPES.length} scopes`, () => {
      for (const scope of SEARCH_SCOPES) {
        const key =
          scope === "all"
            ? "topbar.searchScope"
            : (`search.scope.${scope}` as MessageKey);
        const ph =
          scope === "all"
            ? "search.placeholder"
            : (`search.placeholder.${scope}` as MessageKey);
        expect(catalogs[loc][key as MessageKey], `${loc} ${key}`).toBeTruthy();
        expect(catalogs[loc][ph as MessageKey], `${loc} ${ph}`).toBeTruthy();
      }
    });
  }
});
