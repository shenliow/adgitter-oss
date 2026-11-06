/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * DEV-ONLY entitlement override (see `lib/license.svelte.ts`). Set it in the
   * **repo-root** `.env.development` to preview the app at a tier without a
   * signed license, e.g. `VITE_DEV_PLAN=enterprise`. One of: free | basic |
   * advance | enterprise. The root is the only location Vite reads env files
   * from (`vite.config.ts` → `envDir: '../../'`); a `.env*` under `apps/desktop`
   * is silently ignored.
   */
  readonly VITE_DEV_PLAN?: "free" | "basic" | "advance" | "enterprise";
  /**
   * DEV-ONLY mock-API switch. When "true", the app fakes a signed-in user
   * (see `auth.signInMock`) so account/UI can be developed without a real
   * backend. Not loaded by production or test runs.
   */
  readonly VITE_MOCK_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
