import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig, type UserConfig } from "vite";
import baseConfig from "./vite.config";

const shim = (name: string) =>
  fileURLToPath(new URL(`./e2e/shims/${name}.ts`, import.meta.url));

/**
 * E2E Vite config (Playwright, see `playwright.config.ts`).
 *
 * Extends the main `vite.config.ts` (same Svelte plugin, same `envDir`) and
 * adds `resolve.alias` entries that swap every Tauri API module the app
 * imports for a tiny shim under `e2e/shims/`. Those shims route `invoke()` to
 * a Node-side bridge (`e2e/bridge.ts`) that runs real `git` CLI commands
 * against a fixture repo — this file is the ONLY place those aliases exist,
 * so `pnpm build`/`pnpm dev` (which use `vite.config.ts` directly) are
 * unaffected.
 *
 * Runs as a plain `vite` dev server (not `vite build` + `preview`) so
 * `pnpm e2e` never pays a production-build cost per run.
 */
export default defineConfig(async (env) => {
  const base = (await (typeof baseConfig === "function"
    ? baseConfig(env)
    : baseConfig)) as UserConfig;

  return mergeConfig(base, {
    resolve: {
      alias: {
        "@tauri-apps/api/core": shim("core"),
        "@tauri-apps/api/event": shim("event"),
        "@tauri-apps/api/window": shim("window"),
        "@tauri-apps/plugin-store": shim("store"),
        "@tauri-apps/plugin-dialog": shim("dialog"),
        "@tauri-apps/plugin-deep-link": shim("deep-link"),
      },
    },
    server: {
      port: 4173,
      strictPort: true,
    },
  });
});
