import { describe, it, expect, beforeEach } from "vitest";
import { getPlan, isFree, setPlan } from "./license.svelte";

beforeEach(() => setPlan("free"));

describe("entitlement stub", () => {
  it("defaults to the free plan", () => {
    expect(getPlan()).toBe("free");
    expect(isFree()).toBe(true);
  });

  it("reflects a plan change", () => {
    setPlan("advance");
    expect(getPlan()).toBe("advance");
    expect(isFree()).toBe(false);
  });
});
