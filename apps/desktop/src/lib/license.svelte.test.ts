import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LicenseStatusDto } from "./ipc";

// Mock the IPC layer so we can drive verifyLicense's result. Arguments are
// forwarded, not swallowed: whether this call pins the device is part of the
// contract under test (see "device binding" below).
const verifyLicense =
  vi.fn<
    (
      token?: string,
      opts?: { pinDevice?: boolean },
    ) => Promise<LicenseStatusDto>
  >();
// The native half of the dev override. Mocked (not omitted) so "both ends
// agree" is observable: `refreshEntitlement` is the single seam that pushes the
// effective tier to the native feature gate, and a mock that simply wasn't there
// would let that push break silently.
const setDevPlanIpc = vi.fn<(plan: string | null) => Promise<void>>();
vi.mock("./ipc", () => ({
  verifyLicense: (token?: string, opts?: { pinDevice?: boolean }) =>
    verifyLicense(token, opts),
  setDevPlan: (plan: string | null) => setDevPlanIpc(plan),
}));

import {
  refreshEntitlement,
  getPlan,
  setPlan,
  hasFeature,
  getFeatures,
  featuresForPlan,
  ownedThemes,
  ownsTheme,
  deviceLimit,
} from "./license.svelte";

function dto(over: Partial<LicenseStatusDto>): LicenseStatusDto {
  return {
    status: "invalid",
    plan: null,
    error: null,
    expiresMs: null,
    features: [],
    ownedThemes: [],
    email: null,
    name: null,
    avatarUrl: null,
    username: null,
    ...over,
  };
}

beforeEach(() => {
  verifyLicense.mockReset();
  setDevPlanIpc.mockReset().mockResolvedValue(undefined);
  // No runtime dev-plan choice may leak between tests, and the statically
  // imported store hydrates from this exactly once — so it must be empty from
  // the file's first `refreshEntitlement()` onward, or the `VITE_DEV_PLAN`
  // block below would be reading somebody else's choice.
  localStorage.clear();
  setPlan("free");
});

describe("refreshEntitlement", () => {
  it("maps an active license to its plan", async () => {
    verifyLicense.mockResolvedValue(dto({ status: "active", plan: "advance" }));
    await refreshEntitlement();
    expect(getPlan()).toBe("advance");
  });

  it("treats a grace license as still entitled", async () => {
    verifyLicense.mockResolvedValue(dto({ status: "grace", plan: "basic" }));
    await refreshEntitlement();
    expect(getPlan()).toBe("basic");
  });

  it("falls back to free on an invalid license", async () => {
    setPlan("advance");
    verifyLicense.mockResolvedValue(dto({ status: "invalid", error: "x" }));
    await refreshEntitlement();
    expect(getPlan()).toBe("free");
  });

  it("falls back to free on an unknown plan string", async () => {
    verifyLicense.mockResolvedValue(
      dto({ status: "active", plan: "platinum" }),
    );
    await refreshEntitlement();
    expect(getPlan()).toBe("free");
  });

  it("is non-fatal: stays free when verification throws", async () => {
    verifyLicense.mockRejectedValue(new Error("boom"));
    await refreshEntitlement();
    expect(getPlan()).toBe("free");
  });
});

describe("refreshEntitlement — device binding", () => {
  // `hasFeature` decides whether a paid affordance is enabled; the native
  // `require_feature` guard decides whether pressing it works, and that guard
  // is device-bound. If this read were unpinned the two would disagree and the
  // UI would offer buttons that fail on click with LICENSE_DEVICE_MISMATCH.
  it("pins the device so the UI's answer matches the native gate's", async () => {
    verifyLicense.mockResolvedValue(dto({ status: "active", plan: "advance" }));
    await refreshEntitlement();
    expect(verifyLicense).toHaveBeenCalledWith(undefined, { pinDevice: true });
  });

  // What the backend returns for a licence copied off another machine.
  it("grants nothing when the licence belongs to another device", async () => {
    setPlan("advance");
    verifyLicense.mockResolvedValue(
      dto({ status: "invalid", error: "license bound to a different device" }),
    );
    await refreshEntitlement();
    expect(getPlan()).toBe("free");
    expect(hasFeature("IssueTracker")).toBe(false);
    expect(hasFeature("MultiWindow")).toBe(false);
    expect(getFeatures()).toEqual([]);
  });
});

describe("hasFeature", () => {
  it("is false for every feature on a free/invalid license", async () => {
    verifyLicense.mockResolvedValue(dto({ status: "invalid" }));
    await refreshEntitlement();
    expect(hasFeature("NoAd")).toBe(false);
    expect(getFeatures()).toEqual([]);
  });

  it("reflects the verified feature list for a pro license", async () => {
    verifyLicense.mockResolvedValue(
      dto({
        status: "active",
        plan: "basic",
        features: ["NoAd", "ApplyTheme", "TicketsPriority"],
      }),
    );
    await refreshEntitlement();
    expect(hasFeature("NoAd")).toBe(true);
    expect(hasFeature("ApplyTheme")).toBe(true);
    // advance-only feature not granted at the basic tier
    expect(hasFeature("TeamSeats")).toBe(false);
    expect(getFeatures()).toEqual(["NoAd", "ApplyTheme", "TicketsPriority"]);
  });

  it("carries grace-license features too", async () => {
    verifyLicense.mockResolvedValue(
      dto({ status: "grace", plan: "advance", features: ["TeamSeats"] }),
    );
    await refreshEntitlement();
    expect(hasFeature("TeamSeats")).toBe(true);
  });
});

describe("featuresForPlan", () => {
  it("mirrors the server tiers", () => {
    // Custom themes are free on every tier; the rest stays paid.
    expect(featuresForPlan("free")).toEqual(["ApplyTheme"]);
    expect(featuresForPlan("basic")).toEqual([
      "NoAd",
      "ApplyTheme",
      "TicketsPriority",
      "MultiWindow",
    ]);
    // advance == enterprise: the full set.
    expect(featuresForPlan("enterprise")).toEqual([
      "NoAd",
      "ApplyTheme",
      "TicketsPriority",
      "MultiWindow",
      "LogAnytimeBackground",
      "LogAnytimeSquash",
      "TeamSeats",
      "IssueTracker",
    ]);
    expect(featuresForPlan("advance")).toEqual(featuresForPlan("enterprise"));
  });
});

describe("dev VITE_DEV_PLAN override", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("takes the tier and its features from the override, not the licence", async () => {
    vi.stubEnv("VITE_DEV_PLAN", "enterprise");
    // A free/invalid licence must not drag the overridden tier back down.
    verifyLicense.mockResolvedValue(dto({ status: "invalid" }));
    await refreshEntitlement();
    expect(getPlan()).toBe("enterprise");
    expect(hasFeature("TeamSeats")).toBe(true);
    expect(hasFeature("IssueTracker")).toBe(true);
  });

  // The override grants *capabilities*; a purchase is a fact in the licence.
  // Blanking the list here made dev revoke a theme the user had really bought,
  // and `handleCheckoutReturn` refreshes through this very function the moment
  // a payment lands — so a real dev purchase could never surface.
  it("keeps the owned themes the real licence records", async () => {
    vi.stubEnv("VITE_DEV_PLAN", "enterprise");
    verifyLicense.mockResolvedValue(
      dto({ status: "active", plan: "free", ownedThemes: ["blueprint"] }),
    );
    await refreshEntitlement();
    expect(ownsTheme("blueprint")).toBe(true);
    expect(getPlan()).toBe("enterprise"); // tier still comes from the override
  });

  // The whole point of the override is running dev without a signed licence.
  it("still runs at the override tier when there is no licence to read", async () => {
    vi.stubEnv("VITE_DEV_PLAN", "enterprise");
    verifyLicense.mockRejectedValue(new Error("no licence on this machine"));
    await refreshEntitlement();
    expect(getPlan()).toBe("enterprise");
    expect(hasFeature("IssueTracker")).toBe(true);
    expect(ownedThemes()).toEqual([]);
  });

  it("does not believe an invalid licence's owned themes", async () => {
    vi.stubEnv("VITE_DEV_PLAN", "enterprise");
    verifyLicense.mockResolvedValue(
      dto({ status: "invalid", ownedThemes: ["aurora"] }),
    );
    await refreshEntitlement();
    expect(ownsTheme("aurora")).toBe(false);
  });

  it("ignores an unknown plan and falls through to real verification", async () => {
    vi.stubEnv("VITE_DEV_PLAN", "platinum");
    verifyLicense.mockResolvedValue(dto({ status: "active", plan: "basic" }));
    await refreshEntitlement();
    expect(getPlan()).toBe("basic");
    expect(verifyLicense).toHaveBeenCalled();
  });
});

// ── The runtime dev plan switcher (account menu) ────────────────────────────
//
// These drive the whole chain the switcher actually uses: choose a tier →
// `refreshEntitlement()` → plan + features + the push to the native gate. Each
// case re-imports both modules so it starts from a clean store with nothing
// carried over, which is also what a reload looks like.
describe("dev runtime plan override (E-dev)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
    vi.resetModules();
  });

  async function fresh() {
    vi.resetModules();
    const [lic, dev] = await Promise.all([
      import("./license.svelte"),
      import("./devPlan.svelte"),
    ]);
    return { ...lic, ...dev };
  }

  it.each([
    ["free", ["ApplyTheme"]],
    ["basic", ["NoAd", "ApplyTheme", "TicketsPriority", "MultiWindow"]],
    ["advance", ["IssueTracker", "TeamSeats", "LogAnytimeSquash"]],
    ["enterprise", ["IssueTracker", "TeamSeats", "LogAnytimeBackground"]],
  ] as const)(
    "switching to %s takes effect on plan and features",
    async (tier, expected) => {
      verifyLicense.mockResolvedValue(dto({ status: "invalid" }));
      const m = await fresh();
      m.setDevPlanChoice(tier);
      await m.refreshEntitlement();

      expect(m.getPlan()).toBe(tier);
      for (const f of expected) expect(m.hasFeature(f)).toBe(true);
      expect(m.getFeatures()).toEqual(m.featuresForPlan(tier));
      // A tier is not a skeleton key: `basic` must not reach advance-only gates.
      if (tier === "basic" || tier === "free")
        expect(m.hasFeature("IssueTracker")).toBe(false);
      if (tier === "free") expect(m.hasFeature("NoAd")).toBe(false);
    },
  );

  it("'no override' falls back to the real licence", async () => {
    verifyLicense.mockResolvedValue(
      dto({ status: "active", plan: "basic", features: ["NoAd"] }),
    );
    const m = await fresh();
    m.setDevPlanChoice("enterprise");
    await m.refreshEntitlement();
    expect(m.getPlan()).toBe("enterprise"); // control: the override is live

    m.setDevPlanChoice(m.REAL_LICENCE);
    await m.refreshEntitlement();
    expect(m.getPlan()).toBe("basic");
    expect(m.getFeatures()).toEqual(["NoAd"]);
    expect(m.hasFeature("IssueTracker")).toBe(false);
  });

  // The machine that motivated the feature has `VITE_DEV_PLAN=enterprise` in
  // `.env.development`, which made the real-licence path unreachable at runtime.
  it("'no override' reaches the real licence even with VITE_DEV_PLAN baked", async () => {
    vi.stubEnv("VITE_DEV_PLAN", "enterprise");
    verifyLicense.mockResolvedValue(dto({ status: "active", plan: "basic" }));
    const m = await fresh();
    await m.refreshEntitlement();
    expect(m.getPlan()).toBe("enterprise"); // control: the baked value applies

    m.setDevPlanChoice(m.REAL_LICENCE);
    await m.refreshEntitlement();
    expect(m.getPlan()).toBe("basic");
  });

  it("falls back to a free licence when there is none to read", async () => {
    verifyLicense.mockRejectedValue(new Error("no licence on this machine"));
    const m = await fresh();
    m.setDevPlanChoice(m.REAL_LICENCE);
    await m.refreshEntitlement();
    expect(m.getPlan()).toBe("free");
    expect(m.getFeatures()).toEqual([]);
  });

  it("survives a reload", async () => {
    verifyLicense.mockResolvedValue(dto({ status: "invalid" }));
    const first = await fresh();
    first.setDevPlanChoice("advance");
    await first.refreshEntitlement();
    expect(first.getPlan()).toBe("advance");

    // A reload: fresh module state, same localStorage. Nothing calls the
    // switcher — the choice has to come back on its own.
    const second = await fresh();
    await second.refreshEntitlement();
    expect(second.getPlan()).toBe("advance");
    expect(second.hasFeature("IssueTracker")).toBe(true);
  });

  // Rust state is per-process, so the persisted choice must be re-applied at
  // app start, not only when the menu is used — otherwise the UI shows one tier
  // while the backend enforces another.
  it("re-applies the choice to the native gate at startup", async () => {
    verifyLicense.mockResolvedValue(dto({ status: "invalid" }));
    const first = await fresh();
    first.setDevPlanChoice("advance");
    await first.refreshEntitlement();

    setDevPlanIpc.mockClear();
    const second = await fresh();
    await second.refreshEntitlement(); // the startup refresh, menu untouched
    expect(setDevPlanIpc).toHaveBeenCalledWith("advance");
  });

  it("tells the native gate the same tier the UI is showing", async () => {
    verifyLicense.mockResolvedValue(dto({ status: "invalid" }));
    const m = await fresh();
    for (const tier of ["free", "basic", "advance", "enterprise"] as const) {
      setDevPlanIpc.mockClear();
      m.setDevPlanChoice(tier);
      await m.refreshEntitlement();
      expect(setDevPlanIpc).toHaveBeenCalledWith(tier);
      expect(m.getPlan()).toBe(tier);
    }
    setDevPlanIpc.mockClear();
    m.setDevPlanChoice(m.REAL_LICENCE);
    await m.refreshEntitlement();
    expect(setDevPlanIpc).toHaveBeenCalledWith(null);
  });

  // The override grants *capabilities*, never purchases. A previous bug here
  // blanked the list and made dev revoke a theme the user had really bought —
  // `handleCheckoutReturn` refreshes through this very function when a payment
  // lands, so the purchase could never surface.
  it("leaves owned themes alone at every tier, and on the way back", async () => {
    verifyLicense.mockResolvedValue(
      dto({ status: "active", plan: "free", ownedThemes: ["blueprint"] }),
    );
    const m = await fresh();
    for (const c of [
      "enterprise",
      "free",
      "basic",
      "real",
      "advance",
    ] as const) {
      m.setDevPlanChoice(c);
      await m.refreshEntitlement();
      expect(m.ownsTheme("blueprint")).toBe(true);
      expect(m.ownedThemes()).toEqual(["blueprint"]);
    }
  });

  it("does not fabricate an owned theme the licence never recorded", async () => {
    verifyLicense.mockResolvedValue(dto({ status: "active", plan: "free" }));
    const m = await fresh();
    m.setDevPlanChoice("enterprise");
    await m.refreshEntitlement();
    expect(m.getPlan()).toBe("enterprise");
    expect(m.ownedThemes()).toEqual([]);
    expect(m.ownsTheme("aurora")).toBe(false);
  });

  // The frontend gate, independent of the native `#[cfg(debug_assertions)]`
  // one. Each case first asserts the unlocked answer so the refusal cannot be
  // an artefact of the setup.
  it("is inert outside dev, whatever is stored or baked", async () => {
    vi.stubEnv("VITE_DEV_PLAN", "enterprise");
    localStorage.setItem("adgitter.dev.plan-override", "enterprise");
    verifyLicense.mockResolvedValue(dto({ status: "active", plan: "basic" }));

    const control = await fresh();
    await control.refreshEntitlement();
    expect(control.getPlan()).toBe("enterprise"); // …in dev.
    setDevPlanIpc.mockClear();

    vi.stubEnv("DEV", false);
    const m = await fresh();
    await m.refreshEntitlement();
    expect(m.getPlan()).toBe("basic");
    expect(m.hasFeature("IssueTracker")).toBe(false);
    expect(setDevPlanIpc).not.toHaveBeenCalled();
  });
});

describe("ownedThemes / ownsTheme", () => {
  it("is empty for a free/invalid license", async () => {
    verifyLicense.mockResolvedValue(dto({ status: "invalid" }));
    await refreshEntitlement();
    expect(ownedThemes()).toEqual([]);
    expect(ownsTheme("aurora")).toBe(false);
  });

  it("reflects the license's owned themes", async () => {
    verifyLicense.mockResolvedValue(
      dto({ status: "active", plan: "basic", ownedThemes: ["aurora"] }),
    );
    await refreshEntitlement();
    expect(ownsTheme("aurora")).toBe(true);
    expect(ownsTheme("sunset")).toBe(false);
    expect(ownedThemes()).toEqual(["aurora"]);
  });

  it("keeps owned themes on a free plan — ownership is plan-independent", async () => {
    // A downgraded (free) license still carries its one-time purchases.
    verifyLicense.mockResolvedValue(
      dto({
        status: "active",
        plan: "free",
        ownedThemes: ["aurora", "sunset"],
      }),
    );
    await refreshEntitlement();
    expect(getPlan()).toBe("free");
    expect(ownsTheme("aurora")).toBe(true);
    expect(ownsTheme("sunset")).toBe(true);
  });
});

describe("device cap", () => {
  it("matches the shipped pricing matrix (1 / 2 / 3 / 3)", () => {
    expect(deviceLimit("free")).toBe(1);
    expect(deviceLimit("basic")).toBe(2);
    expect(deviceLimit("advance")).toBe(3);
    expect(deviceLimit("enterprise")).toBe(3);
  });
});
