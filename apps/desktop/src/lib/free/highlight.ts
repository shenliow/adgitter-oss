/**
 * Syntax highlighting for the diff viewer.
 *
 * Uses Shiki with its **JavaScript regex engine** (no WASM) so it stays within
 * the app's strict CSP (`script-src 'self'` — no `unsafe-eval`). The engine,
 * theme, and a curated grammar set live in `./shiki-core`, dynamically imported
 * on first use so they code-split out of the initial bundle. A file whose
 * language isn't in that set falls back to plaintext.
 *
 * For a side-by-side diff we tokenize each hunk's **old side** (context +
 * deletions) and **new side** (context + additions) as separate little
 * documents, so multi-line constructs (block comments, template strings) keep
 * their context within the hunk. The result maps each `DiffLine` to its tokens.
 */
import type { FileDiff, DiffHunk, DiffLine } from "../ipc";
import { THEME } from "./shiki-theme";

/** A themed run of text: its content and a ready-to-apply inline style. */
export interface Token {
  content: string;
  /** Inline CSS (`color:…;font-style:…`) — '' when default-styled. */
  style: string;
}

/** Map a file path's extension to a Shiki language id, or null (plaintext). */
export function langFromPath(path: string): string | null {
  const base = path.split(/[/\\]/).pop() ?? path;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return null; // no extension (or dotfile like `.gitignore`)
  const ext = base.slice(dot + 1).toLowerCase();
  return EXT_LANG[ext] ?? null;
}

const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  rs: "rust",
  py: "python",
  rb: "ruby",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  dart: "dart",
  lua: "lua",
  php: "php",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  json: "json",
  jsonc: "jsonc",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  xml: "xml",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  md: "markdown",
  markdown: "markdown",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  svelte: "svelte",
  vue: "vue",
  r: "r",
};

/** The original `DiffLine`s on a hunk's old (context+deletions) side, in order. */
export function oldSideLines(hunk: DiffHunk): DiffLine[] {
  return hunk.lines.filter((l) => l.origin === " " || l.origin === "-");
}

/** The original `DiffLine`s on a hunk's new (context+additions) side, in order. */
export function newSideLines(hunk: DiffHunk): DiffLine[] {
  return hunk.lines.filter((l) => l.origin === " " || l.origin === "+");
}

// Shiki's FontStyle bitmask (kept inline so we don't import the enum).
const ITALIC = 1;
const BOLD = 2;
const UNDERLINE = 4;

function styleFor(
  color: string | undefined,
  fontStyle: number | undefined,
): string {
  let s = color ? `color:${color}` : "";
  if (fontStyle && fontStyle & ITALIC) s += ";font-style:italic";
  if (fontStyle && fontStyle & BOLD) s += ";font-weight:600";
  if (fontStyle && fontStyle & UNDERLINE) s += ";text-decoration:underline";
  return s.replace(/^;/, "");
}

// --- Lazy highlighter ------------------------------------------------------
// `./shiki-core` (engine + theme + curated grammars) is dynamically imported so
// it stays code-split out of the initial bundle and is fetched only on the
// first diff open.
type Hi = import("@shikijs/core").HighlighterCore;
/** The `lang` accepted by `codeToTokens` (a loaded language id). */
type TokenLang = NonNullable<Parameters<Hi["codeToTokens"]>[1]>["lang"];

function tokenizeSide(
  hl: Hi,
  lines: DiffLine[],
  lang: string,
  out: Map<DiffLine, Token[]>,
) {
  if (lines.length === 0) return;
  const code = lines.map((l) => l.content.replace(/\n$/, "")).join("\n");
  const { tokens } = hl.codeToTokens(code, {
    lang: lang as TokenLang,
    theme: THEME,
  });
  lines.forEach((dl, i) => {
    const row = tokens[i] ?? [];
    out.set(
      dl,
      row.map((t) => ({
        content: t.content,
        style: styleFor(t.color, t.fontStyle),
      })),
    );
  });
}

/**
 * Highlight every line of `diff` for the language inferred from `path`.
 * Resolves to a `DiffLine → Token[]` map; an **empty map** means "render as
 * plaintext" (binary, unknown language, or a highlighter failure).
 */
export async function highlightFileDiff(
  diff: FileDiff,
  path: string,
): Promise<Map<DiffLine, Token[]>> {
  const map = new Map<DiffLine, Token[]>();
  if (diff.binary || diff.hunks.length === 0) return map;
  const lang = langFromPath(path);
  if (!lang) return map;

  try {
    const { loadHighlighter } = await import("./shiki-core");
    const hl = await loadHighlighter();
    // The curated bundle may not include this language → plaintext fallback.
    if (!hl.getLoadedLanguages().includes(lang)) return map;
    for (const hunk of diff.hunks) {
      tokenizeSide(hl, oldSideLines(hunk), lang, map);
      tokenizeSide(hl, newSideLines(hunk), lang, map);
    }
  } catch {
    return new Map(); // never let highlighting break the viewer
  }
  return map;
}
