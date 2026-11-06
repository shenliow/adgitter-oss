import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The IPC layer is mocked so the *native* half of the override is observable:
// "both ends agree" is the property this module exists to guarantee, and it is
// only checkable by watching what gets pushed across.
const setDevPlan = vi.fn<(plan: string | null) => Promise<void>>();
vi.mock("./ipc", () => ({
  setDevPlan: (plan: string | null) => setDevPlan(plan),
}));

import {
  DEV_PLAN_CHOICES,
  DEV_PLAN_STORAGE_KEY,
  REAL_LICENCE,
  devPlanSelection,
  effectiveDevPlan,
  setDevPlanChoice,
  syncDevPlanToBackend,
} from "./devPlan.svelte";

// Every test pins `VITE_DEV_PLAN` itself. The ambient value MUST NOT leak in:
// a normal checkout's gitignored `.env` sets `VITE_DEV_PLAN=enterprise` while an
// agent worktree has no env file at all, so an unpinned test agrees with the
// code in one working copy and contradicts it in another. (A green worktree has
// already produced a red `main` in this repo exactly this way.)
beforeEach(() => {
  setDevPlan.mockReset().mockResolvedValue(undefined);
  localStorage.clear();
  vi.stubEnv("VITE_DEV_PLAN", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  localStorage.clear();
  vi.resetModules();
});

/**
 * Re-import the module with its in-memory state discarded — what a webview
 * reload does. `localStorage` survives, which is the whole point of the check.
 */
async function reload() {
  vi.resetModules();
  return import("./devPlan.svelte");
}

describe("devPlan — choosing a tier", () => {
  it("offers exactly the four tiers plus 'no override'", () => {
    expect(DEV_PLAN_CHOICES).toEqual([
      "real",
      "free",
      "basic",
      "advance",
      "enterprise",
    ]);
  });

  it.each(["free", "basic", "advance", "enterprise"] as const)(
    "switches the effective plan to %s",
    (tier) => {
      setDevPlanChoice(tier);
      expect(devPlanSelection()).toBe(tier);
      expect(effectiveDevPlan()).toBe(tier);
    },
  );

  it("treats 'no override' as an explicit choice, not an absence", () => {
    setDevPlanChoice("enterprise");
    setDevPlanChoice(REAL_LICENCE);
    expect(devPlanSelection()).toBe(REAL_LICENCE);
    expect(effectiveDevPlan()).toBeNull();
  });
});

describe("devPlan — precedence over the compile-time VITE_DEV_PLAN", () => {
  it("falls back to the baked tier when nothing has been chosen", async () => {
    vi.stubEnv("VITE_DEV_PLAN", "enterprise");
    const m = await reload();
    m.hydrateDevPlan();
    // A developer who never opens the menu keeps the behaviour they had.
    expect(m.devPlanSelection()).toBe("enterprise");
    expect(m.effectiveDevPlan()).toBe("enterprise");
  });

  it("lets a runtime choice override the baked tier", async () => {
    vi.stubEnv("VITE_DEV_PLAN", "enterprise");
    const m = await reload();
    m.hydrateDevPlan();
    m.setDevPlanChoice("basic");
    expect(m.effectiveDevPlan()).toBe("basic");
  });

  // The entry that motivated the feature: with `.env.development` pinning a
  // tier, the real-licence path was unreachable at runtime.
  it("lets 'no override' beat a baked VITE_DEV_PLAN", async () => {
    vi.stubEnv("VITE_DEV_PLAN", "enterprise");
    const m = await reload();
    m.hydrateDevPlan();
    m.setDevPlanChoice(m.REAL_LICENCE);
    expect(m.effectiveDevPlan()).toBeNull();
  });

  it("ignores an empty or misspelled baked value, as the Rust side does", async () => {
    for (const baked of ["", "platnium", "Enterprise"]) {
      vi.stubEnv("VITE_DEV_PLAN", baked);
      const m = await reload();
      m.hydrateDevPlan();
      expect(m.effectiveDevPlan()).toBeNull();
      expect(m.devPlanSelection()).toBe("real");
    }
  });
});

describe("devPlan — persistence", () => {
  it("survives a reload", async () => {
    setDevPlanChoice("advance");
    expect(localStorage.getItem(DEV_PLAN_STORAGE_KEY)).toBe("advance");

    const m = await reload();
    m.hydrateDevPlan();
    expect(m.devPlanSelection()).toBe("advance");
    expect(m.effectiveDevPlan()).toBe("advance");
  });

  it("survives a reload as 'no override', even with a tier baked in", async () => {
    vi.stubEnv("VITE_DEV_PLAN", "enterprise");
    const first = await reload();
    first.hydrateDevPlan();
    first.setDevPlanChoice(first.REAL_LICENCE);

    const second = await reload();
    second.hydrateDevPlan();
    expect(second.effectiveDevPlan()).toBeNull();
  });

  // localStorage is editable by anything with webview access, so the read side
  // re-validates rather than trusting what it finds (same rule as
  // accountProfile.ts). Junk falls back to the baked value — never to a tier.
  it("does not trust a hand-edited stored value", async () => {
    for (const junk of ["platinum", "REAL", "", "{}"]) {
      localStorage.setItem(DEV_PLAN_STORAGE_KEY, junk);
      const m = await reload();
      m.hydrateDevPlan();
      expect(m.effectiveDevPlan()).toBeNull();
    }
  });

  it("hydrates only once, so a later sync cannot clobber a fresh choice", async () => {
    localStorage.setItem(DEV_PLAN_STORAGE_KEY, "free");
    const m = await reload();
    m.hydrateDevPlan();
    m.setDevPlanChoice("enterprise");
    m.hydrateDevPlan();
    expect(m.effectiveDevPlan()).toBe("enterprise");
  });
});

describe("devPlan — keeping the native gate in step", () => {
  it("pushes the chosen tier to the backend", async () => {
    setDevPlanChoice("advance");
    await syncDevPlanToBackend();
    expect(setDevPlan).toHaveBeenCalledWith("advance");
  });

  it("pushes null for 'no override', so the native gate reads the real licence", async () => {
    setDevPlanChoice(REAL_LICENCE);
    await syncDevPlanToBackend();
    expect(setDevPlan).toHaveBeenCalledWith(null);
  });

  // Rust state is per-process; the choice lives in the webview. Without a
  // re-apply at startup the UI would show one tier and the backend enforce
  // another — a feature hidden in the UI that the backend still performs.
  it("re-applies the persisted choice after a reload without the menu being used", async () => {
    localStorage.setItem(DEV_PLAN_STORAGE_KEY, "basic");
    const m = await reload();
    await m.syncDevPlanToBackend();
    expect(setDevPlan).toHaveBeenCalledWith("basic");
  });

  it("is non-fatal when the native side refuses or is absent", async () => {
    setDevPlan.mockRejectedValue(new Error("command set_dev_plan not found"));
    setDevPlanChoice("advance");
    await expect(syncDevPlanToBackend()).resolves.toBeUndefined();
  });
});

// ── The gate ────────────────────────────────────────────────────────────────
//
// `import.meta.env.DEV` is the frontend half of the two independent gates (the
// native half is `#[cfg(debug_assertions)]` on the command, proven in
// `src-tauri/src/commands.rs`). Vite replaces the literal with `false` in
// `vite build` and the bundler drops the dead bodies; stubbing it here proves
// the *logic* refuses even if that elimination did not happen.
// Every case here first asserts the *unlocked* answer with the flag left alone,
// so a refusal can never be mistaken for "the setup happened not to unlock
// anything". `vi.stubEnv("DEV", false)` really does set `import.meta.env.DEV`
// to `false` under Vitest 2 — the control assertions are what prove it.
describe("devPlan — the frontend gate is closed outside dev", () => {
  it("refuses to record a choice", async () => {
    const control = await reload();
    control.setDevPlanChoice("enterprise");
    expect(control.effectiveDevPlan()).toBe("enterprise"); // …in dev.
    localStorage.clear();

    vi.stubEnv("DEV", false);
    const m = await reload();
    m.setDevPlanChoice("enterprise");
    expect(m.effectiveDevPlan()).toBeNull();
    expect(localStorage.getItem(DEV_PLAN_STORAGE_KEY)).toBeNull();
  });

  it("refuses to honour a value planted in storage", async () => {
    localStorage.setItem(DEV_PLAN_STORAGE_KEY, "enterprise");
    const control = await reload();
    control.hydrateDevPlan();
    expect(control.effectiveDevPlan()).toBe("enterprise"); // …in dev.

    vi.stubEnv("DEV", false);
    const m = await reload();
    m.hydrateDevPlan();
    expect(m.devPlanSelection()).toBe("real");
    expect(m.effectiveDevPlan()).toBeNull();
  });

  it("refuses to honour a baked VITE_DEV_PLAN either", async () => {
    vi.stubEnv("VITE_DEV_PLAN", "enterprise");
    const control = await reload();
    control.hydrateDevPlan();
    expect(control.effectiveDevPlan()).toBe("enterprise"); // …in dev.

    vi.stubEnv("DEV", false);
    const m = await reload();
    m.hydrateDevPlan();
    expect(m.effectiveDevPlan()).toBeNull();
  });

  it("never reaches the native command", async () => {
    localStorage.setItem(DEV_PLAN_STORAGE_KEY, "enterprise");
    const control = await reload();
    await control.syncDevPlanToBackend();
    expect(setDevPlan).toHaveBeenCalledWith("enterprise"); // …in dev.
    setDevPlan.mockClear();

    vi.stubEnv("DEV", false);
    const m = await reload();
    m.setDevPlanChoice("enterprise");
    await m.syncDevPlanToBackend();
    expect(setDevPlan).not.toHaveBeenCalled();
  });
});
