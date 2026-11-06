/**
 * Describing a thrown value for a diagnostic report.
 *
 * The bug this covers: `String(e)` on an IPC rejection — a plain
 * `{code, message}` object — yields `"[object Object]"`, so every crash report
 * looked the same and the actual cause (`NOT_SIGNED_IN`) never left the device
 * in any usable form. Hence the blanket assertion in every case below.
 */
import { describe, it, expect } from "vitest";
import { describeError, errorCode, errorReport } from "./errorReport";

const OBJ = "[object Object]";

describe("describeError", () => {
  it("keeps the code and message of a tagged IPC error", () => {
    const out = describeError({
      code: "NOT_SIGNED_IN",
      message: "no license on disk",
    });
    expect(out).toBe("NOT_SIGNED_IN: no license on disk");
  });

  it("falls back to the code when a tagged error has no message text", () => {
    expect(describeError({ code: "GIT_ERROR", message: "  " })).toBe(
      "GIT_ERROR",
    );
  });

  it("uses an Error's message, or its name when empty", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
    expect(describeError(new TypeError(""))).toBe("TypeError");
  });

  it("passes a string through", () => {
    expect(describeError("script error")).toBe("script error");
    expect(describeError("   ")).toBe("(empty string)");
  });

  it("names null and undefined rather than guessing", () => {
    expect(describeError(null)).toBe("null");
    expect(describeError(undefined)).toBe("undefined");
  });

  it("serializes a bare object as JSON, never [object Object]", () => {
    const out = describeError({ kind: "weird", detail: { n: 1 } });
    expect(out).toBe('{"kind":"weird","detail":{"n":1}}');
  });

  it("describes an object JSON can't encode by name and keys", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    // A cycle is survivable (the replacer breaks it)…
    expect(describeError(circular)).toContain('"[circular]"');
    // …and an object that encodes to nothing still says something.
    expect(describeError({ fn: () => {} })).toBe("Object {fn}");
    expect(describeError({})).toBe("Object");
  });

  it("renders non-object primitives", () => {
    expect(describeError(42)).toBe("42");
    expect(describeError(false)).toBe("false");
    expect(describeError(Symbol("s"))).toBe("Symbol(s)");
  });

  it("caps the length so a serialized payload can't run away", () => {
    const out = describeError({ blob: "x".repeat(5000) });
    expect(out.length).toBeLessThanOrEqual(501);
    expect(out.endsWith("…")).toBe(true);
  });

  it("never produces [object Object], whatever it is given", () => {
    const inputs: unknown[] = [
      { code: "IO_ERROR", message: "disk" },
      new Error("boom"),
      "text",
      { anything: 1 },
      {},
      { fn: () => {} },
      Object.create(null),
      [1, 2],
      null,
      undefined,
      0,
      new Date(0),
    ];
    for (const input of inputs) {
      const out = describeError(input);
      expect(out).not.toContain(OBJ);
      expect(out.length).toBeGreaterThan(0);
    }
  });
});

describe("errorCode / errorReport", () => {
  it("fingerprints a tagged error by its own code, not UI_ERROR", () => {
    expect(errorCode({ code: "NOT_SIGNED_IN", message: "x" })).toBe(
      "NOT_SIGNED_IN",
    );
  });

  it("falls back to UI_ERROR for anything untagged", () => {
    expect(errorCode(new Error("boom"))).toBe("UI_ERROR");
    expect(errorCode("boom")).toBe("UI_ERROR");
    expect(errorCode({ nope: 1 })).toBe("UI_ERROR");
  });

  it("reports both halves together", () => {
    expect(errorReport({ code: "GIT_ERROR", message: "bad ref" })).toEqual({
      code: "GIT_ERROR",
      message: "GIT_ERROR: bad ref",
    });
  });
});
