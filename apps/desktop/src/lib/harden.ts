/**
 * Desktop hardening — suppress the WebView developer tools / inspector in the
 * shipped app.
 *
 * PRIMARY protection is compile-time: release builds ship WITHOUT devtools
 * because the `tauri` crate's `devtools` feature is off and `tauri build`
 * compiles with `debug_assertions` disabled, so wry never enables the
 * WKWebView / WebView2 inspector (F12 is inert, no "Inspect" context-menu item).
 *
 * These runtime guards are a SECOND layer: they swallow the common devtools key
 * combos and the generic native context menu, so casual attempts to pry the
 * WebView open (and tamper with entitlement gating) get nowhere. They are not a
 * security boundary — the real gate is the server-signed Ed25519 license,
 * verified natively. Wired from main.ts under
 * `import.meta.env.PROD` only, so dev builds keep their inspector.
 */

// Physical key codes (layout-independent; `e.key` is unreliable while ⌥/Alt is
// held on macOS) for the inspector/console shortcuts.
const DEVTOOLS_LETTER_CODES = new Set(["KeyI", "KeyJ", "KeyC", "KeyK"]);

/** Is this keydown one of the devtools / view-source shortcuts? */
function isDevtoolsCombo(e: KeyboardEvent): boolean {
  if (e.code === "F12") return true;
  const mod = e.ctrlKey || e.metaKey; // Ctrl (Win/Linux) or ⌘ (macOS)
  if (!mod) return false;
  const secondary = e.shiftKey || e.altKey; // ⇧ (Win) or ⌥ (macOS)
  if (secondary && DEVTOOLS_LETTER_CODES.has(e.code)) return true; // inspector/console
  if (e.code === "KeyU") return true; // view-source
  return false;
}

/** Editable targets keep their native cut/copy/paste menu. */
function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

/**
 * Install the inspector guards on `target` (defaults to `window`). Returns a
 * disposer that removes them (used by tests).
 */
export function installInspectorGuards(target: Window = window): () => void {
  const onKeydown = (e: KeyboardEvent) => {
    if (isDevtoolsCombo(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  // Suppress the generic WebView menu everywhere except text fields (so paste
  // still works). App-rendered menus set their own preventDefault and are
  // unaffected — we never stopPropagation here.
  const onContextmenu = (e: MouseEvent) => {
    if (!isEditable(e.target)) e.preventDefault();
  };

  target.addEventListener("keydown", onKeydown, { capture: true });
  target.addEventListener("contextmenu", onContextmenu);
  return () => {
    target.removeEventListener("keydown", onKeydown, { capture: true });
    target.removeEventListener("contextmenu", onContextmenu);
  };
}
