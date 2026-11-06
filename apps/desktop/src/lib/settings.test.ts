import { describe, it, expect, vi, beforeEach } from "vitest";

const mem = new Map<string, unknown>();
const onKeyChange = vi.fn(async (..._args: unknown[]) => () => {});
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async (k: string) => mem.get(k)),
    set: vi.fn(async (k: string, v: unknown) => {
      mem.set(k, v);
    }),
    onKeyChange: (...a: unknown[]) => onKeyChange(...a),
  })),
}));

import {
  DEFAULT_SETTINGS,
  mergeSettings,
  loadSettings,
  saveSettings,
  onSettingsChanged,
} from "./settings";

beforeEach(() => mem.clear());

describe("mergeSettings (defensive)", () => {
  it("returns defaults for undefined / garbage input", () => {
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(42)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings("nope")).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid fields and defaults the rest", () => {
    const out = mergeSettings({
      general: {
        dryRun: true,
        hideGhosts: true,
        undoRedo: 9,
        autoPull: "warn",
      },
      personalize: { textSize: "large" },
    });
    expect(out.general.dryRun).toBe(true);
    expect(out.general.hideGhosts).toBe(true);
    expect(out.general.undoRedo).toBe(9);
    expect(out.general.autoPull).toBe("warn");
    expect(out.personalize.textSize).toBe("large");
    // untouched fields keep defaults
    expect(out.general.unstaged).toBe(DEFAULT_SETTINGS.general.unstaged);
    expect(out.personalize.theme).toBe("default");
    expect(out.personalize.graphTheme).toBe("default");
  });

  it("keeps a valid graphTheme id and defaults an untyped one", () => {
    expect(
      mergeSettings({ personalize: { graphTheme: "blueprint" } }).personalize
        .graphTheme,
    ).toBe("blueprint");
    expect(
      mergeSettings({ personalize: { graphTheme: 42 } }).personalize.graphTheme,
    ).toBe("default");
  });

  it("rejects wrong-typed / out-of-range values", () => {
    const out = mergeSettings({
      general: {
        dryRun: "yes",
        hideGhosts: "yes",
        undoRedo: -5,
        autoPull: "bogus",
      },
      personalize: { textSize: "huge" },
      keymap: { pull: 123, push: "Ctrl+P" },
      branchColors: "nope",
    });
    expect(out.general.dryRun).toBe(false); // wrong type → default
    expect(out.general.hideGhosts).toBe(false); // wrong type → default
    expect(out.general.undoRedo).toBe(0); // clamped to >= 0
    expect(out.general.autoPull).toBe("off"); // invalid enum → default
    expect(out.personalize.textSize).toBe("medium");
    expect(out.keymap).toEqual({ push: "Ctrl+P" }); // drops non-string entry
    expect(out.branchColors).toEqual({});
  });

  it("does not mutate DEFAULT_SETTINGS", () => {
    mergeSettings({ general: { undoRedo: 99 } });
    expect(DEFAULT_SETTINGS.general.undoRedo).toBe(3);
  });

  it("keeps the paid log-anytime fields and defaults them", () => {
    const out = mergeSettings({
      logAnytime: { background: true, periodicSquash: true, autoPush: true },
    });
    expect(out.logAnytime.background).toBe(true);
    expect(out.logAnytime.periodicSquash).toBe(true);
    expect(out.logAnytime.autoPush).toBe(true);
    // Untouched core fields still default.
    expect(out.logAnytime.branch).toBe("adgitter-log");
  });

  it("defaults wrong-typed paid log-anytime fields to false", () => {
    const out = mergeSettings({
      logAnytime: { background: "yes", periodicSquash: 1, autoPush: null },
    });
    expect(out.logAnytime.background).toBe(false);
    expect(out.logAnytime.periodicSquash).toBe(false);
    expect(out.logAnytime.autoPush).toBe(false);
  });
});

describe("tutorial flags", () => {
  it("defaults both flags to false", () => {
    expect(mergeSettings(undefined).tutorial).toEqual({
      completed: false,
      firstUseShown: false,
    });
    expect(DEFAULT_SETTINGS.tutorial).toEqual({
      completed: false,
      firstUseShown: false,
    });
  });

  it("keeps well-typed flags independently", () => {
    expect(mergeSettings({ tutorial: { completed: true } }).tutorial).toEqual({
      completed: true,
      firstUseShown: false,
    });
    expect(
      mergeSettings({ tutorial: { firstUseShown: true } }).tutorial,
    ).toEqual({ completed: false, firstUseShown: true });
    expect(
      mergeSettings({ tutorial: { completed: true, firstUseShown: true } })
        .tutorial,
    ).toEqual({ completed: true, firstUseShown: true });
  });

  it("falls back to false on wrong-typed or corrupt values", () => {
    expect(
      mergeSettings({ tutorial: { completed: "yes", firstUseShown: 1 } })
        .tutorial,
    ).toEqual({ completed: false, firstUseShown: false });
    for (const bad of ["done", 7, null, [], true]) {
      expect(mergeSettings({ tutorial: bad }).tutorial).toEqual({
        completed: false,
        firstUseShown: false,
      });
    }
  });

  it("an older settings file without the key still loads", () => {
    const out = mergeSettings({ locale: "ja", logAnytime: { enabled: true } });
    expect(out.tutorial.completed).toBe(false);
    expect(out.locale).toBe("ja");
  });

  it("a genuinely fresh install (no installId yet) gets the welcome tour", () => {
    for (const raw of [undefined, {}, { installId: "" }, { locale: "ja" }]) {
      expect(mergeSettings(raw).tutorial, JSON.stringify(raw)).toEqual({
        completed: false,
        firstUseShown: false,
      });
    }
  });

  it("an existing user upgrading (installId, no tutorial key) is not greeted", () => {
    const out = mergeSettings({ installId: "abc-123", locale: "ja" });
    expect(out.tutorial).toEqual({ completed: true, firstUseShown: true });
    expect(out.installId).toBe("abc-123");
    expect(out.locale).toBe("ja");
  });

  it("a saved tutorial object always wins over the upgrade default", () => {
    expect(
      mergeSettings({
        installId: "abc-123",
        tutorial: { completed: false, firstUseShown: false },
      }).tutorial,
    ).toEqual({ completed: false, firstUseShown: false });
    // …including a half-written one: only the absent flag takes the default
    expect(
      mergeSettings({ installId: "abc-123", tutorial: { completed: false } })
        .tutorial,
    ).toEqual({ completed: false, firstUseShown: false });
    expect(
      mergeSettings({ installId: "abc-123", tutorial: { firstUseShown: true } })
        .tutorial,
    ).toEqual({ completed: false, firstUseShown: true });
  });

  it("a non-string or empty installId is not a prior install", () => {
    for (const installId of [7, null, true, {}, []]) {
      expect(mergeSettings({ installId }).tutorial).toEqual({
        completed: false,
        firstUseShown: false,
      });
    }
  });
});

describe("store round-trip", () => {
  it("save then load returns merged settings", async () => {
    const next = { ...DEFAULT_SETTINGS };
    next.general = { ...next.general, dryRun: true };
    await saveSettings(next);
    const loaded = await loadSettings();
    expect(loaded.general.dryRun).toBe(true);
  });

  it("loadSettings returns defaults when nothing is stored", async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("onSettingsChanged (multi-window best-effort sync)", () => {
  it("subscribes to the settings key and merges the pushed value", async () => {
    let pushed: ((v: unknown) => void) | undefined;
    onKeyChange.mockImplementationOnce(async (..._args: unknown[]) => {
      pushed = _args[1] as (v: unknown) => void;
      return () => {};
    });
    const cb = vi.fn();
    const unlisten = await onSettingsChanged(cb);
    expect(typeof unlisten).toBe("function");
    pushed?.({ general: { dryRun: true } });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].general.dryRun).toBe(true);
    // untouched fields still default
    expect(cb.mock.calls[0][0].personalize.theme).toBe("default");
  });
});
