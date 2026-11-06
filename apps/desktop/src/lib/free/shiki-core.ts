/**
 * Shiki highlighter core with a **curated** language set.
 *
 * This module statically imports only the grammars we ship, so the bundle is
 * bounded (vs. the full `shiki` bundle's ~200 lazy grammar chunks). It is loaded
 * via a dynamic `import()` from `highlight.ts`, so all of this — engine, theme,
 * and grammars — stays code-split out of the initial app bundle and is fetched
 * only the first time a diff is opened. Uses the JavaScript regex engine (no
 * WASM) to satisfy the app CSP (`script-src 'self'`).
 *
 * A file whose language is not in this set falls back to plaintext (see
 * `highlight.ts`). Add a grammar here + a mapping in `highlight.ts`'s `EXT_LANG`
 * to support a new language.
 */
import { createHighlighterCore, type HighlighterCore } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";
import githubLight from "@shikijs/themes/github-light";
import { THEME } from "./shiki-theme";

import typescript from "@shikijs/langs/typescript";
import tsx from "@shikijs/langs/tsx";
import javascript from "@shikijs/langs/javascript";
import jsx from "@shikijs/langs/jsx";
import rust from "@shikijs/langs/rust";
import python from "@shikijs/langs/python";
import ruby from "@shikijs/langs/ruby";
import go from "@shikijs/langs/go";
import java from "@shikijs/langs/java";
import c from "@shikijs/langs/c";
import cpp from "@shikijs/langs/cpp";
import csharp from "@shikijs/langs/csharp";
import json from "@shikijs/langs/json";
import jsonc from "@shikijs/langs/jsonc";
import yaml from "@shikijs/langs/yaml";
import toml from "@shikijs/langs/toml";
import html from "@shikijs/langs/html";
import css from "@shikijs/langs/css";
import scss from "@shikijs/langs/scss";
import markdown from "@shikijs/langs/markdown";
import bash from "@shikijs/langs/bash";
import sql from "@shikijs/langs/sql";
import svelte from "@shikijs/langs/svelte";
import vue from "@shikijs/langs/vue";
import php from "@shikijs/langs/php";
import xml from "@shikijs/langs/xml";
import lua from "@shikijs/langs/lua";

export { THEME };

const LANGS = [
  typescript,
  tsx,
  javascript,
  jsx,
  rust,
  python,
  ruby,
  go,
  java,
  c,
  cpp,
  csharp,
  json,
  jsonc,
  yaml,
  toml,
  html,
  css,
  scss,
  markdown,
  bash,
  sql,
  svelte,
  vue,
  php,
  xml,
  lua,
];

let core: Promise<HighlighterCore> | null = null;

/** Lazily create (once) the curated highlighter. */
export function loadHighlighter(): Promise<HighlighterCore> {
  if (!core) {
    core = createHighlighterCore({
      themes: [githubLight],
      langs: LANGS,
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
  }
  return core;
}
