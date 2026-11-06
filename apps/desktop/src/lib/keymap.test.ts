import { describe, it, expect, vi } from "vitest";
import {
  comboFromEvent,
  effectiveKeymap,
  actionForCombo,
  conflicts,
  dispatchKey,
  DEFAULT_KEYMAP,
  KEY_ACTIONS,
} from "./keymap";
import { catalogs, LOCALES } from "./i18n/messages";

const ev = (over: Partial<KeyboardEvent>): KeyboardEvent =>
  ({
    key: "a",
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    ...over,
  }) as KeyboardEvent;

// ── The persisted contract ────────────────────────────────────────────────────
//
// `id` is the key an override is stored under in the user's settings, and
// `default` is what a stored value is compared against to decide "this is still
// the default". Renaming either silently discards or misreads every existing
// user's customization — a data-loss bug that no other test would catch, and
// exactly the sort of thing a refactor of the neighbouring `labelKey` could do
// by accident. Pinned literally.
describe("KEY_ACTIONS is a persistence contract", () => {
  it("keeps every id and default byte-for-byte", () => {
    expect(KEY_ACTIONS.map(({ id, default: d }) => [id, d])).toEqual([
      ["switchHandTool", "Space"],
      ["pull", "Mod+L"],
      ["push", "Mod+P"],
      ["newBranch", "Mod+B"],
      ["newTag", "Mod+T"],
      ["showBranchPanel", "Mod+1"],
      ["showTagPanel", "Mod+2"],
      ["showSettingPanel", "Mod+,"],
    ]);
  });

  it("derives DEFAULT_KEYMAP from exactly those ids", () => {
    expect(Object.keys(DEFAULT_KEYMAP).sort()).toEqual(
      KEY_ACTIONS.map((a) => a.id).sort(),
    );
  });
});

// The panel prints `t(a.labelKey)`, so a labelKey missing from one catalog
// renders the raw key ("shortcut.action.pull") in that language. The whole
// point of the change was that this panel was English everywhere.
describe("every shortcut action is labelled in every catalog", () => {
  for (const { code } of LOCALES) {
    it(`${code} labels all ${KEY_ACTIONS.length} actions`, () => {
      const missing = KEY_ACTIONS.filter(
        (a) => !catalogs[code][a.labelKey],
      ).map((a) => a.labelKey);
      expect(missing, `${code} is missing: ${missing.join(", ")}`).toEqual([]);
    });
  }

  it("really translates them — zh-Hant does not reuse the en label", () => {
    for (const a of KEY_ACTIONS) {
      // "Pull"/"Push" are loanwords some locales legitimately keep, so only
      // zh-Hant (which has native terms for all eight) is checked for content.
      expect(catalogs["zh-Hant"][a.labelKey]).not.toBe(catalogs.en[a.labelKey]);
    }
  });
});

describe("comboFromEvent", () => {
  it("maps ⌘ and Ctrl both to Mod", () => {
    expect(comboFromEvent(ev({ key: "p", metaKey: true }))).toBe("Mod+P");
    expect(comboFromEvent(ev({ key: "p", ctrlKey: true }))).toBe("Mod+P");
  });

  it("orders Mod+Alt+Shift then the key, and names Space", () => {
    expect(
      comboFromEvent(
        ev({ key: " ", metaKey: true, altKey: true, shiftKey: true }),
      ),
    ).toBe("Mod+Alt+Shift+Space");
  });

  it("returns empty for a bare modifier press", () => {
    expect(comboFromEvent(ev({ key: "Shift", shiftKey: true }))).toBe("");
  });
});

describe("effectiveKeymap", () => {
  it("uses defaults with no overrides", () => {
    expect(effectiveKeymap()).toEqual(DEFAULT_KEYMAP);
  });

  it("applies a non-empty override and ignores empty ones", () => {
    const km = effectiveKeymap({ push: "Mod+Shift+P", pull: "" });
    expect(km.push).toBe("Mod+Shift+P");
    expect(km.pull).toBe(DEFAULT_KEYMAP.pull);
  });
});

describe("actionForCombo + conflicts", () => {
  it("reverse-maps a combo to its action", () => {
    expect(actionForCombo("Mod+P", DEFAULT_KEYMAP)).toBe("push");
    expect(actionForCombo("Mod+Z", DEFAULT_KEYMAP)).toBeNull();
  });

  it("detects a combo bound to two actions", () => {
    const km = effectiveKeymap({ pull: "Mod+P" }); // same as push
    expect(conflicts(km)).toContain("Mod+P");
  });

  it("reports no conflicts for the defaults", () => {
    expect(conflicts(DEFAULT_KEYMAP)).toEqual([]);
  });
});

describe("dispatchKey", () => {
  it("invokes the handler for the matched action and returns its id", () => {
    const push = vi.fn();
    const id = dispatchKey(ev({ key: "p", metaKey: true }), DEFAULT_KEYMAP, {
      push,
    });
    expect(id).toBe("push");
    expect(push).toHaveBeenCalledOnce();
  });

  it("does nothing for an unbound combo", () => {
    const h = vi.fn();
    const id = dispatchKey(ev({ key: "q", metaKey: true }), DEFAULT_KEYMAP, {
      push: h,
    });
    expect(id).toBeNull();
    expect(h).not.toHaveBeenCalled();
  });
});
