import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [svelte()],

  // Under Vitest, resolve Svelte 5's `mount`/`unmount` to the client build —
  // the default Node resolution picks the server build and throws
  // `server_context_required`. The app itself only ever runs in a WebView.
  resolve: process.env.VITEST ? { conditions: ['browser'] } : {},

  // Tauri expects a fixed port and won't fall back to another. Failing fast
  // here is better than launching the desktop app pointing at the wrong url.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: 'ws', host, port: 1421 }
      : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },

  // Load `.env` from the repo root (two levels up) so the SAME file the Rust
  // build.rs reads also feeds Vite's `VITE_*` vars (e.g. VITE_CLERK_PUBLISHABLE_KEY).
  // Without this Vite would only look in apps/desktop and miss the root .env.
  envDir: '../../',
  envPrefix: ['VITE_', 'TAURI_'],

  build: {
    target:
      process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },

  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,js}'],
    setupFiles: ['./src/test-setup.ts'],
    // App.svelte pulls in most of the component tree; dynamically importing
    // it the first time in a run compiles all of that under vitest's
    // transform pipeline, which alone can take several seconds — past the
    // default 5s test timeout. Give the whole suite headroom rather than
    // special-casing App.test.ts.
    testTimeout: 20000,
  },
}));
