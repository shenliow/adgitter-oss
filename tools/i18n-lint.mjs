#!/usr/bin/env node
/**
 * i18n lint. Dependency-free static check over the desktop frontend:
 *
 *   1. ERROR  — a `t('key')` referenced in code but missing from the `en` source
 *               catalog (catches typos / forgotten catalog entries).
 *   2. ERROR  — a non-`en` catalog has a key that isn't in `en` (stray/typo).
 *   3. WARN   — an `en` key never referenced anywhere (unused), excluding keys
 *               built dynamically (see DYNAMIC_PREFIXES).
 *   4. WARN   — hard-coded UI text in `.svelte` markup (heuristic; may be noisy).
 *   5. INFO   — per-locale translation coverage vs. `en`.
 *
 * Exits non-zero on any ERROR. Run: `node tools/i18n-lint.mjs` (or `pnpm i18n-lint`).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "apps/desktop/src");
const MESSAGES = join(SRC, "lib/i18n/messages.ts");
// Non-launch locales live one-per-file here; scanned alongside the
// `en`/`zhHant` blocks still inline in messages.ts.
const LOCALES_DIR = join(SRC, "lib/i18n/locales");

// Keys assembled at runtime (e.g. `t(`error.${code}`)`) — never flag as unused.
const DYNAMIC_PREFIXES = ["error.", "settings."];

// Brand / placeholder identity text that is intentionally not translated
// (ADGitter = brand; the user identity is a placeholder; ad strip is decor).
const IGNORE_TEXT = new Set([
  "ADGitter",
  "John Duo",
  "Example Company",
  "Advertise",
]);

// --- collect source files --------------------------------------------------
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (/\.(svelte|ts)$/.test(name) && !/\.(test|spec)\.ts$/.test(name))
      out.push(p);
  }
  return out;
}

const files = walk(SRC).filter(
  (p) => p !== MESSAGES && !p.endsWith("lib/i18n/index.svelte.ts"),
);

// --- catalog keys ----------------------------------------------------------
const msgSrc = readFileSync(MESSAGES, "utf8");

/** Keys inside the `export const en = { … } as const;` block. */
function enKeys() {
  const m = msgSrc.match(/export const en = \{([\s\S]*?)\} as const;/);
  if (!m) throw new Error("could not locate `en` catalog in messages.ts");
  return new Set([...m[1].matchAll(/["']([\w.]+)["']\s*:/g)].map((x) => x[1]));
}

/** Keys for each `const <name>: Catalog = { … };` block, by variable name —
 *  scanning both the inline blocks in messages.ts and the one-per-file locales
 *  under ./locales. An empty (`{}`) block still registers, at 0. */
function localeBlocks() {
  const blocks = {};
  const scan = (src) => {
    for (const m of src.matchAll(
      /const (\w+): Catalog = \{([\s\S]*?)\}\s*;/g,
    )) {
      blocks[m[1]] = new Set(
        [...m[2].matchAll(/["']([\w.]+)["']\s*:/g)].map((x) => x[1]),
      );
    }
  };
  scan(msgSrc);
  for (const name of readdirSync(LOCALES_DIR)) {
    if (name.endsWith(".ts")) scan(readFileSync(join(LOCALES_DIR, name), "utf8"));
  }
  return blocks;
}

const EN = enKeys();
const blocks = localeBlocks();

// --- scan usage ------------------------------------------------------------
const referenced = new Set(); // keys via t('…')
const literals = new Set(); // any dotted key-like quoted literal
const hardCoded = [];

for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/\bt\(\s*["']([\w.]+)["']/g))
    referenced.add(m[1]);
  for (const m of text.matchAll(/["']([a-z][\w]*\.[\w.]+)["']/g))
    literals.add(m[1]);

  if (file.endsWith(".svelte")) {
    // Only scan the markup region (after the last </script>) so TS generics
    // like `Promise<…>` in the script don't read as hard-coded text.
    const cut = text.lastIndexOf("</script>");
    const markupStart = cut >= 0 ? text.slice(0, cut).split("\n").length : 1;
    const markup = cut >= 0 ? text.slice(cut) : text;
    markup.split("\n").forEach((line, i) => {
      // Heuristic: markup text node of real words, not an expression/binding.
      const m = line.match(/>\s*([A-Z][A-Za-z][A-Za-z ,.'’!?…/&-]{2,})\s*</);
      if (
        m &&
        !IGNORE_TEXT.has(m[1].trim()) &&
        !line.includes("{") &&
        !/^\s*(\/\/|\*|<!--)/.test(line)
      )
        hardCoded.push(
          `${relative(ROOT, file)}:${markupStart + i}  “${m[1].trim()}”`,
        );
    });
  }
}

// --- checks ----------------------------------------------------------------
const errors = [];
const warnings = [];

for (const key of referenced)
  if (!EN.has(key)) errors.push(`missing en key referenced by t(): "${key}"`);

for (const [name, keys] of Object.entries(blocks)) {
  if (name === "en" || name === "empty") continue;
  for (const k of keys)
    if (!EN.has(k)) errors.push(`stray key in ${name} (not in en): "${k}"`);
}

const isDynamic = (k) => DYNAMIC_PREFIXES.some((p) => k.startsWith(p));
for (const key of EN)
  if (!literals.has(key) && !isDynamic(key))
    warnings.push(`unused en key: "${key}"`);

// --- report ----------------------------------------------------------------
const log = (...a) => console.log(...a);
log(`i18n-lint: ${EN.size} en keys, ${referenced.size} referenced via t()`);

for (const [name, keys] of Object.entries(blocks)) {
  if (name === "en" || name === "empty") continue;
  const pct = Math.round((keys.size / EN.size) * 100);
  log(`  locale ${name}: ${keys.size}/${EN.size} keys (${pct}%)`);
}

if (warnings.length) {
  log(`\n⚠ ${warnings.length} warning(s):`);
  for (const w of warnings) log(`  - ${w}`);
}
if (hardCoded.length) {
  log(`\n⚠ ${hardCoded.length} possible hard-coded string(s):`);
  for (const h of hardCoded) log(`  - ${h}`);
}
if (errors.length) {
  log(`\n✖ ${errors.length} error(s):`);
  for (const e of errors) log(`  - ${e}`);
  process.exit(1);
}
log("\n✓ no errors");
