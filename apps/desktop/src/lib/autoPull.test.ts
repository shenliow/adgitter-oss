import { describe, expect, it } from "vitest";
import {
  AUTO_PULL_MODES,
  AUTO_PULL_SECONDS_DEFAULT,
  AUTO_PULL_SECONDS_MAX,
  AUTO_PULL_SECONDS_MIN,
  autoPullBeforeLabelKey,
  autoPullPlan,
  clampAutoPullSeconds,
  type AutoPullMode,
} from "./autoPull";
import { DEFAULT_SETTINGS, mergeSettings } from "./settings";

describe("autoPullPlan", () => {
  it("maps each mode to its behaviour when the action is enabled", () => {
    expect(autoPullPlan("off", true)).toBe("proceed");
    expect(autoPullPlan("warn", true)).toBe("ask");
    expect(autoPullPlan("notify", true)).toBe("countdown");
    expect(autoPullPlan("always", true)).toBe("pull");
  });

  it("proceeds for every mode when the action's checkbox is off", () => {
    for (const mode of AUTO_PULL_MODES)
      expect(autoPullPlan(mode, false)).toBe("proceed");
  });
});

describe("clampAutoPullSeconds", () => {
  it("keeps an in-range integer", () => {
    expect(clampAutoPullSeconds(5)).toBe(5);
    expect(clampAutoPullSeconds(AUTO_PULL_SECONDS_MIN)).toBe(
      AUTO_PULL_SECONDS_MIN,
    );
    expect(clampAutoPullSeconds(AUTO_PULL_SECONDS_MAX)).toBe(
      AUTO_PULL_SECONDS_MAX,
    );
  });

  it("clamps a countdown that could not be raced or that would stall", () => {
    // 0 would answer itself before the prompt could be clicked; 600 would hold
    // the pending action for ten minutes.
    expect(clampAutoPullSeconds(0)).toBe(AUTO_PULL_SECONDS_MIN);
    expect(clampAutoPullSeconds(-30)).toBe(AUTO_PULL_SECONDS_MIN);
    expect(clampAutoPullSeconds(600)).toBe(AUTO_PULL_SECONDS_MAX);
  });

  it("rounds a fractional value and falls back on a non-number", () => {
    expect(clampAutoPullSeconds(5.4)).toBe(5);
    expect(clampAutoPullSeconds(5.6)).toBe(6);
    expect(clampAutoPullSeconds(Number.NaN)).toBe(AUTO_PULL_SECONDS_DEFAULT);
    expect(clampAutoPullSeconds(Number.POSITIVE_INFINITY)).toBe(
      AUTO_PULL_SECONDS_DEFAULT,
    );
  });
});

describe("autoPullBeforeLabelKey", () => {
  it("names an existing catalog key per action", () => {
    expect(autoPullBeforeLabelKey("createBranch")).toBe(
      "general.beforeCreateBranch",
    );
    expect(autoPullBeforeLabelKey("push")).toBe("general.beforePush");
    expect(autoPullBeforeLabelKey("commit")).toBe("general.beforeCommit");
  });
});

describe("settings merge", () => {
  it("defaults the mode to off and the countdown to 5s", () => {
    expect(DEFAULT_SETTINGS.general.autoPull).toBe("off");
    expect(DEFAULT_SETTINGS.general.autoPullSeconds).toBe(
      AUTO_PULL_SECONDS_DEFAULT,
    );
  });

  it("keeps all four modes and rejects an unknown one", () => {
    for (const mode of AUTO_PULL_MODES)
      expect(
        mergeSettings({ general: { autoPull: mode } }).general.autoPull,
      ).toBe(mode);
    expect(
      mergeSettings({ general: { autoPull: "sometimes" } }).general.autoPull,
    ).toBe("off");
  });

  it("clamps a hand-edited countdown out of range", () => {
    const of = (v: unknown): number =>
      mergeSettings({ general: { autoPullSeconds: v } }).general
        .autoPullSeconds;
    expect(of(12)).toBe(12);
    expect(of(0)).toBe(AUTO_PULL_SECONDS_MIN);
    expect(of(9999)).toBe(AUTO_PULL_SECONDS_MAX);
    expect(of("five")).toBe(AUTO_PULL_SECONDS_DEFAULT);
  });
});

// A compile-time reminder that `Policy` was deliberately NOT widened: an
// AutoPullMode is not assignable to the two-value Policy that `unstaged` uses.
describe("Policy is untouched", () => {
  it("still rejects the auto-pull-only modes for `unstaged`", () => {
    for (const bad of ["notify", "always"] as AutoPullMode[])
      expect(
        mergeSettings({ general: { unstaged: bad } }).general.unstaged,
      ).toBe(DEFAULT_SETTINGS.general.unstaged);
  });
});
