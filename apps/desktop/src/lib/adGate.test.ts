import { describe, it, expect } from "vitest";
import { adGateOpen, mayDeclineAds } from "./adGate";

describe("mayDeclineAds", () => {
  it("is true for Korean language or Korea region", () => {
    expect(mayDeclineAds(["ko"])).toBe(true);
    expect(mayDeclineAds(["ko-KR"])).toBe(true);
    expect(mayDeclineAds(["en-KR"])).toBe(true);
    expect(mayDeclineAds(["en_KR"])).toBe(true);
  });
  it("is false elsewhere", () => {
    expect(mayDeclineAds(["en-US", "zh-TW"])).toBe(false);
    expect(mayDeclineAds(["kok-IN"])).toBe(false);
    expect(mayDeclineAds([])).toBe(false);
  });
});

describe("adGateOpen", () => {
  const base = {
    ready: true,
    plan: "free" as const,
    consent: "unset" as const,
    mayDecline: false,
  };
  it("opens for a free user who hasn't accepted", () => {
    expect(adGateOpen(base)).toBe(true);
  });
  it("waits for the entitlement", () => {
    expect(adGateOpen({ ...base, ready: false })).toBe(false);
  });
  it("never opens on a paid plan or a trial", () => {
    expect(adGateOpen({ ...base, plan: "basic" })).toBe(false);
    expect(adGateOpen({ ...base, plan: "advance" })).toBe(false);
  });
  it("closes once ads are accepted", () => {
    expect(adGateOpen({ ...base, consent: "granted" })).toBe(false);
  });
  it("declining keeps it free only where declining is allowed", () => {
    expect(adGateOpen({ ...base, consent: "declined" })).toBe(true);
    expect(adGateOpen({ ...base, consent: "declined", mayDecline: true })).toBe(
      false,
    );
  });
});
