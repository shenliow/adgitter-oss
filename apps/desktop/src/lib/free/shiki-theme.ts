/**
 * The Shiki theme id, isolated in its own grammar-free module so both
 * `highlight.ts` (which dynamically imports the heavy core) and `shiki-core.ts`
 * can import it statically without pulling the grammars into the main bundle.
 */
export const THEME = "github-light";
