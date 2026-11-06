import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config (macOS has no tauri-driver — WKWebView exposes no WebDriver —
 * so Playwright drives the real frontend in a real Chromium instead; see
 * `e2e/README.md` for the full architecture). Runs against the e2e Vite dev
 * server (`vite.e2e.config.ts`), which aliases every Tauri API module to a
 * shim under `e2e/shims/` that routes `invoke()` to the Node-side git bridge
 * (`e2e/bridge.ts`).
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: "*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],

  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],

  webServer: {
    command:
      "pnpm exec vite --config vite.e2e.config.ts --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
