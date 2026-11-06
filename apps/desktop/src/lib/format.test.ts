import { describe, it, expect, beforeEach } from "vitest";
import { axisTime, relativeTime, initials } from "./format";
import { setLocale } from "./i18n/index.svelte";

beforeEach(() => setLocale("en"));

describe("locale-aware formatting", () => {
  it("axisTime labels today in the active locale", () => {
    const now = Date.now() / 1000;
    expect(axisTime(now).startsWith("Today")).toBe(true);
    setLocale("zh-Hant");
    expect(axisTime(now).startsWith("今天")).toBe(true);
  });

  it("axisTime labels yesterday", () => {
    const y = Date.now() / 1000 - 86400;
    expect(axisTime(y).startsWith("Yesterday")).toBe(true);
  });

  it("relativeTime uses Intl (localized, numeric auto)", () => {
    const twoHoursAgo = Date.now() / 1000 - 7200;
    // en RelativeTimeFormat → "2 hours ago"
    expect(relativeTime(twoHoursAgo)).toMatch(/hour/);
  });

  it("initials are locale-independent", () => {
    expect(initials("John Duo")).toBe("JD");
  });
});
