/**
 * Keyboard shortcut map + dispatcher.
 *
 * Actions have a default combo; the user can override per action. Combos are
 * normalized strings like `Mod+Shift+P` where **Mod** = ⌘ on macOS / Ctrl
 * elsewhere, so one default keymap works cross-platform. `comboFromEvent`
 * produces the same normal form from a `KeyboardEvent`, and `actionForCombo`
 * reverse-maps a pressed combo to its action. Conflicts (one combo → two
 * actions) are detected so the Shortcut panel can block the save.
 */

// Type-only: keeps this module free of the i18n runtime (see `KeyAction.labelKey`).
import type { MessageKey } from "./i18n/messages";

export interface KeyAction {
  /**
   * Stable identity: the key this action's override is persisted under in
   * settings, and the handler name `dispatchKey` looks up. NEVER rename one —
   * a rename silently drops every existing user's override for that action.
   */
  id: string;
  /**
   * Catalog key for the display name, resolved by the *component* that renders
   * it (ShortcutPanel) rather than here. This module is plain TS reached from
   * non-reactive callers (the global key dispatcher), so it must not import the
   * Svelte-runtime-backed `t()`: calling `t()` at module scope would also
   * freeze the label at the locale that happened to be active on first import,
   * where the panel's `t(a.labelKey)` re-renders on every locale switch. Only
   * the type is imported, so there is no runtime dependency on i18n at all.
   */
  labelKey: MessageKey;
  /** Default combo in normal form. Persisted settings compare against this, so
   *  changing one would silently reinterpret a stored override — treat as
   *  frozen alongside `id`. */
  default: string;
}

/** Editable actions, in display order (mockup: setting panel - shortcut). */
export const KEY_ACTIONS: KeyAction[] = [
  {
    id: "switchHandTool",
    labelKey: "shortcut.action.switchHandTool",
    default: "Space",
  },
  { id: "pull", labelKey: "shortcut.action.pull", default: "Mod+L" },
  { id: "push", labelKey: "shortcut.action.push", default: "Mod+P" },
  { id: "newBranch", labelKey: "shortcut.action.newBranch", default: "Mod+B" },
  { id: "newTag", labelKey: "shortcut.action.newTag", default: "Mod+T" },
  {
    id: "showBranchPanel",
    labelKey: "shortcut.action.showBranchPanel",
    default: "Mod+1",
  },
  {
    id: "showTagPanel",
    labelKey: "shortcut.action.showTagPanel",
    default: "Mod+2",
  },
  {
    id: "showSettingPanel",
    labelKey: "shortcut.action.showSettingPanel",
    default: "Mod+,",
  },
];

export const DEFAULT_KEYMAP: Record<string, string> = Object.fromEntries(
  KEY_ACTIONS.map((a) => [a.id, a.default]),
);

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

/** Normalize a `KeyboardEvent` to a combo string, or "" for a bare modifier. */
export function comboFromEvent(e: {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}): string {
  if (MODIFIER_KEYS.has(e.key)) return "";
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("Mod");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(normalizeKey(e.key));
  return parts.join("+");
}

function normalizeKey(key: string): string {
  if (key === " ") return "Space";
  // Single letters → uppercase so Shift-less letter keys match the default form.
  if (key.length === 1) return key.toUpperCase();
  return key; // ArrowUp, Enter, Escape, "," etc. stay as-is
}

/** Merge user overrides onto the defaults → full action→combo map. */
export function effectiveKeymap(
  overrides: Record<string, string> = {},
): Record<string, string> {
  const out: Record<string, string> = { ...DEFAULT_KEYMAP };
  for (const a of KEY_ACTIONS) {
    const o = overrides[a.id];
    if (typeof o === "string" && o.length > 0) out[a.id] = o;
  }
  return out;
}

/** The action bound to `combo` in `keymap`, or null. First match wins. */
export function actionForCombo(
  combo: string,
  keymap: Record<string, string>,
): string | null {
  if (!combo) return null;
  for (const id of Object.keys(keymap)) {
    if (keymap[id] === combo) return id;
  }
  return null;
}

/** Combos bound to more than one action (the conflict set). */
export function conflicts(keymap: Record<string, string>): string[] {
  const seen = new Map<string, number>();
  for (const combo of Object.values(keymap)) {
    if (!combo) continue;
    seen.set(combo, (seen.get(combo) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([c]) => c);
}

/**
 * Resolve `e` against `keymap` and invoke the matching handler, if any.
 * Returns the dispatched action id (or null). The handler decides whether to
 * `preventDefault`.
 */
export function dispatchKey(
  e: KeyboardEvent,
  keymap: Record<string, string>,
  handlers: Record<string, (e: KeyboardEvent) => void>,
): string | null {
  const id = actionForCombo(comboFromEvent(e), keymap);
  if (id && handlers[id]) {
    handlers[id](e);
    return id;
  }
  return null;
}
