import { describe, it, expect, afterEach } from "vitest";
import { installInspectorGuards } from "./harden";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
});

function keydown(init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  window.dispatchEvent(e);
  return e;
}

describe("installInspectorGuards", () => {
  it("swallows F12", () => {
    dispose = installInspectorGuards();
    expect(keydown({ code: "F12" }).defaultPrevented).toBe(true);
  });

  it("swallows Ctrl+Shift+I and ⌘+⌥+I", () => {
    dispose = installInspectorGuards();
    expect(
      keydown({ code: "KeyI", ctrlKey: true, shiftKey: true }).defaultPrevented,
    ).toBe(true);
    expect(
      keydown({ code: "KeyI", metaKey: true, altKey: true }).defaultPrevented,
    ).toBe(true);
  });

  it("swallows Ctrl+Shift+J / Ctrl+Shift+C and Ctrl+U (view-source)", () => {
    dispose = installInspectorGuards();
    expect(
      keydown({ code: "KeyJ", ctrlKey: true, shiftKey: true }).defaultPrevented,
    ).toBe(true);
    expect(
      keydown({ code: "KeyC", ctrlKey: true, shiftKey: true }).defaultPrevented,
    ).toBe(true);
    expect(keydown({ code: "KeyU", ctrlKey: true }).defaultPrevented).toBe(
      true,
    );
  });

  it("ignores ordinary keys and unmodified letters", () => {
    dispose = installInspectorGuards();
    expect(keydown({ code: "KeyA" }).defaultPrevented).toBe(false);
    expect(keydown({ code: "KeyI" }).defaultPrevented).toBe(false);
    // A bare Ctrl+C (copy) must still work.
    expect(keydown({ code: "KeyC", ctrlKey: true }).defaultPrevented).toBe(
      false,
    );
  });

  it("suppresses the native context menu off editable fields", () => {
    dispose = installInspectorGuards();
    const e = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it("keeps the native menu on text inputs (paste)", () => {
    dispose = installInspectorGuards();
    const input = document.createElement("input");
    document.body.appendChild(input);
    const e = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    input.remove();
  });

  it("cleanup removes the listeners", () => {
    installInspectorGuards()();
    expect(keydown({ code: "F12" }).defaultPrevented).toBe(false);
  });
});
