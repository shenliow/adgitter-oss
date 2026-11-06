import { describe, it, expect } from "vitest";
import {
  langFromPath,
  oldSideLines,
  newSideLines,
  highlightFileDiff,
} from "./highlight";
import type { DiffHunk, DiffLine, FileDiff } from "../ipc";

const line = (origin: string, content: string): DiffLine => ({
  origin,
  old_lineno: null,
  new_lineno: null,
  content,
});

describe("langFromPath", () => {
  it("maps known extensions to Shiki language ids", () => {
    expect(langFromPath("src/lib/foo.ts")).toBe("typescript");
    expect(langFromPath("a/b/c.rs")).toBe("rust");
    expect(langFromPath("Component.svelte")).toBe("svelte");
    expect(langFromPath("deep\\win\\path\\main.py")).toBe("python");
  });

  it("returns null for unknown or extensionless paths", () => {
    expect(langFromPath("Makefile")).toBeNull();
    expect(langFromPath("LICENSE")).toBeNull();
    expect(langFromPath(".gitignore")).toBeNull(); // dotfile, no real ext
    expect(langFromPath("data.unknownext")).toBeNull();
  });
});

describe("hunk side reconstruction", () => {
  const hunk: DiffHunk = {
    old_start: 1,
    old_lines: 2,
    new_start: 1,
    new_lines: 2,
    header: "@@ -1,2 +1,2 @@",
    lines: [
      line(" ", "ctx\n"),
      line("-", "old\n"),
      line("+", "new\n"),
      line(" ", "tail\n"),
    ],
  };

  it("old side keeps context + deletions in order", () => {
    expect(oldSideLines(hunk).map((l) => l.content.trim())).toEqual([
      "ctx",
      "old",
      "tail",
    ]);
  });

  it("new side keeps context + additions in order", () => {
    expect(newSideLines(hunk).map((l) => l.content.trim())).toEqual([
      "ctx",
      "new",
      "tail",
    ]);
  });
});

describe("highlightFileDiff", () => {
  const tsDiff: FileDiff = {
    path: "a.ts",
    old_path: null,
    status: "modified",
    binary: false,
    hunks: [
      {
        old_start: 1,
        old_lines: 1,
        new_start: 1,
        new_lines: 1,
        header: "@@ -1 +1 @@",
        lines: [line("-", "const x = 1;\n"), line("+", "const y = 2;\n")],
      },
    ],
  };

  it("tokenizes each line with Shiki (color spans for keywords)", async () => {
    const map = await highlightFileDiff(tsDiff, "a.ts");
    const del = tsDiff.hunks[0].lines[0];
    const add = tsDiff.hunks[0].lines[1];
    const delToks = map.get(del)!;
    const addToks = map.get(add)!;
    expect(delToks).toBeDefined();
    expect(addToks).toBeDefined();
    // Concatenated token content reconstructs the line (sans newline).
    expect(delToks.map((t) => t.content).join("")).toBe("const x = 1;");
    // `const` is a keyword → it gets a non-empty color style.
    const kw = delToks.find((t) => t.content === "const");
    expect(kw?.style).toMatch(/color:/);
  });

  it("returns an empty map for binary diffs (plaintext fallback)", async () => {
    const bin: FileDiff = { ...tsDiff, binary: true, hunks: [] };
    expect((await highlightFileDiff(bin, "a.bin")).size).toBe(0);
  });

  it("returns an empty map for unknown languages", async () => {
    const map = await highlightFileDiff(
      { ...tsDiff, path: "x.unknownext" },
      "x.unknownext",
    );
    expect(map.size).toBe(0);
  });
});
