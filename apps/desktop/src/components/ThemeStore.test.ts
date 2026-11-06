import { describe, it, expect, vi, afterEach, afterAll } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import { resolveThemePack } from "../lib/theme";
import type { PersonalizeSettings } from "../lib/settings";
import type { ThemePackPayloadDto } from "../lib/ipc";

// Drive the entitlement store's ownership + refresh from the test.
const { lic, ipc, auth } = vi.hoisted(() => ({
  lic: { owned: [] as string[], refresh: vi.fn(async () => {}) },
  ipc: {
    openExternalUrl: vi.fn(async () => {}),
    createCheckout: vi.fn(async () => "https://checkout.polar.sh/x"),
    isAdgitterError: (e: unknown) =>
      typeof e === "object" && e !== null && "code" in e && "message" in e,
    // Remote delivery. Default: a server that offers one extra theme
    // nobody has bought, and a pack endpoint no test may reach by accident.
    themeCatalog: vi.fn(async () => ({
      version: "2026-08-10T00:00:00Z",
      themes: [
        // A real deployment lists EVERY theme it serves — the bundled ones
        // included, each flagged `purchasable` or not, rather than hiding the
        // ones it can't charge for. `storeListings`' `sellable` relies on that:
        // a built-in absent from a non-empty catalog means the server predates
        // it and cannot sell it, so Buy is disabled before the click. Without
        // the bundled rows here every built-in would (correctly) render as
        // "not on sale" and these tests would be exercising that path instead
        // of the purchase they mean to test.
        //
        // Only `purchasable` is read from these rows; name and price come from
        // the bundle, so they need not match.
        ...(
          [
            ["aurora", "app"],
            ["sunset", "app"],
            ["sepia", "app"],
            ["synthwave", "graph"],
            ["blueprint", "graph"],
            ["hero", "graph"],
          ] as const
        ).map(([id, kind]) => ({
          id,
          kind,
          name: id,
          priceUsd: 0.99,
          preview: { swatches: ["#101026", "#20204a", "#7c5cff"] },
          checksum: `sha256:${id}`,
          purchasable: true,
        })),
        {
          id: "nebula",
          kind: "app" as const,
          name: "Nebula",
          priceUsd: 1.49,
          preview: { swatches: ["#101026", "#20204a", "#7c5cff"] },
          checksum: "sha256:nebula",
        },
      ],
    })),
    // Typed explicitly: an always-throwing implementation would otherwise
    // infer `Promise<never>` and reject every `mockResolvedValueOnce`.
    themePack: vi.fn(async (_id: string): Promise<ThemePackPayloadDto> => {
      throw new Error("themePack not stubbed for this test");
    }),
  },
  // The store runs the real checkout flow; only the browser round-trip it
  // can't perform in a test is faked. `settle` ends the pending sign-in wait
  // the way a deep-link callback (or the user giving up) would.
  auth: {
    configured: true,
    status: "signed-out" as string,
    settle: (_outcome: string) => {},
  },
}));

vi.mock("../lib/license.svelte", () => ({
  ownsTheme: (id: string) => lic.owned.includes(id),
  refreshEntitlement: lic.refresh,
}));
vi.mock("../lib/ipc", () => ipc);
vi.mock("../lib/auth.svelte", () => ({
  clerkConfigured: () => auth.configured,
  authState: () => ({ status: auth.status }),
  startSignIn: async () => {
    auth.status = "signing-in";
  },
  waitForSignIn: () =>
    new Promise((resolve) => {
      auth.settle = (outcome: string) => {
        if (outcome === "signed-in") auth.status = "signed-in";
        resolve(outcome);
      };
    }),
}));

import { __resetRemoteCatalog } from "../lib/themes/remote.svelte";
import { __resetRemoteThemePacks } from "../lib/theme";
import { __resetRemoteGraphThemePacks } from "../lib/graphTheme";

// This suite exercises the *real* store backend (ownership from the license,
// purchase through Polar checkout) — the same idiom as
// `lib/themes/storeOwnership.real.test.ts`: pin the env rather than inherit
// it, and import the component dynamically because `MOCK_STORE` (read by
// `lib/themes/storeOwnership.svelte`, which `ThemeStore.svelte` imports) is
// evaluated once at module scope. Without this, a worktree/CI checkout with
// no local `.env` silently runs the suite in mock mode instead, and every
// `lic.owned`/`ipc.createCheckout` stub in this file stops applying.
vi.stubEnv("VITE_STORE_MOCK", "false");
const ThemeStore = (await import("./ThemeStore.svelte")).default;

afterAll(() => {
  vi.unstubAllEnvs();
});

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
  lic.owned = [];
  lic.refresh.mockClear();
  ipc.createCheckout.mockReset();
  ipc.createCheckout.mockResolvedValue("https://checkout.polar.sh/x");
  ipc.openExternalUrl.mockClear();
  ipc.themeCatalog.mockClear();
  ipc.themePack.mockReset();
  ipc.themePack.mockRejectedValue(new Error("themePack not stubbed"));
  auth.configured = true;
  auth.status = "signed-out";
  // The catalog + downloaded packs are module-level state shared across tests.
  __resetRemoteCatalog();
  __resetRemoteThemePacks();
  __resetRemoteGraphThemePacks();
});

/** Let every queued task run, then re-render. */
async function settled() {
  await new Promise((r) => setTimeout(r, 0));
  flushSync();
}

function render(value: PersonalizeSettings) {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(ThemeStore, { target: host, props: { value } });
  flushSync();
  return host;
}

function personalize(theme = "default"): PersonalizeSettings {
  return {
    theme,
    color: "default",
    textSize: "medium",
    font: "system",
    graphTheme: "default",
  };
}

describe("ThemeStore", () => {
  // ── Remote delivery (asset-delivery.md) ─────────────────────────────────

  // The whole point of the built-in tier: it is in the binary, so applying it
  // must not depend on a server being reachable.

  it("applying an owned remote theme downloads the pack first, then applies", async () => {
    lic.owned = ["nebula"];
    ipc.themePack.mockResolvedValueOnce({
      id: "nebula",
      kind: "app",
      name: "Nebula",
      checksum: "sha256:nebula",
      pack: {
        id: "nebula",
        name: "Nebula",
        vars: { "select-ring": "#7c5cff" },
      },
    });
    const value = personalize();
    const h = render(value);
    await settled();

    h.querySelector<HTMLButtonElement>(".btn.apply")!.click();
    await settled();

    expect(ipc.themePack).toHaveBeenCalledWith("nebula");
    expect(value.theme).toBe("nebula");
    // Registered with the engine, so the theme actually resolves now.
    expect(resolveThemePack("nebula").vars["select-ring"]).toBe("#7c5cff");
  });

  // Owned, not cached, no network: the failure has to be recoverable and must
  // NOT leave the user on a half-applied theme.
  it("offline: says so and keeps the current theme when the pack can't be fetched", async () => {
    lic.owned = ["nebula"];
    ipc.themePack.mockRejectedValueOnce({
      code: "THEME_UNAVAILABLE",
      message: "network down",
    });
    const value = personalize("dark");
    const h = render(value);
    await settled();

    h.querySelector<HTMLButtonElement>(".btn.apply")!.click();
    await settled();

    expect(value.theme).toBe("dark"); // unchanged
    const notice = h.querySelector('[data-theme-notice="nebula"]');
    expect(notice?.textContent).toContain("connection");
    // Recoverable: the button is live again for a retry.
    expect(h.querySelector<HTMLButtonElement>(".btn.apply")!.disabled).toBe(
      false,
    );
  });

  // Each backend code is a different thing to tell the user, so they must not
  // collapse into one generic failure.
  it.each([
    ["NOT_SIGNED_IN", "Sign in"],
    ["THEME_NOT_OWNED", "purchases"],
    ["THEME_NOT_FOUND", "no longer available"],
    ["THEME_REJECTED", "safety check"],
  ])("reports %s with its own message", async (code, expected) => {
    lic.owned = ["nebula"];
    ipc.themePack.mockRejectedValueOnce({ code, message: code });
    const value = personalize("dark");
    const h = render(value);
    await settled();

    h.querySelector<HTMLButtonElement>(".btn.apply")!.click();
    await settled();

    expect(
      h.querySelector('[data-theme-notice="nebula"]')?.textContent,
    ).toContain(expected);
    expect(value.theme).toBe("dark");
  });

  // Buying goes through the protected, license-authenticated checkout — never
  // a static link — so a purchase is always tied to a real account and to the
  // theme that was actually clicked.

  // The lazy-sign-in contract: one click, even with no
  // account yet.

  it("Refresh re-verifies the entitlement and re-pulls the catalog past its TTL", async () => {
    const h = render(personalize());
    await settled();
    ipc.themeCatalog.mockClear();

    h.querySelector<HTMLButtonElement>(".btn.refresh")!.click();
    await settled();

    expect(lic.refresh).toHaveBeenCalledOnce();
    // `true` = bypass the 24 h cache, which is the point of the button.
    expect(ipc.themeCatalog).toHaveBeenCalledWith(true);
  });
});
