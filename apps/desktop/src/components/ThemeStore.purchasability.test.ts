/**
 * The store must not sell what the deployment can't charge for.
 *
 * Polar product ids are per-deployment env vars, so `GET /themes/catalog`
 * reports a `purchasable` flag per theme. A `false` there means `POST /checkout`
 * is guaranteed to fail, so Buy has to be disabled *before* the click rather
 * than after.
 *
 * Kept in its own file because `MOCK_STORE` is read once at module load: this
 * file mocks it through a getter so both the real (`false`) and the mock
 * (`true`) deployment can be exercised, which the main ThemeStore suite — which
 * runs entirely in the default mock mode — cannot do.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import type { PersonalizeSettings } from "../lib/settings";
import type { ThemePackPayloadDto } from "../lib/ipc";

const { lic, ipc, store } = vi.hoisted(() => ({
  lic: { owned: [] as string[], refresh: vi.fn(async () => {}) },
  ipc: {
    openExternalUrl: vi.fn(async () => {}),
    createCheckout: vi.fn(async () => "https://checkout.polar.sh/x"),
    isAdgitterError: (e: unknown) =>
      typeof e === "object" && e !== null && "code" in e && "message" in e,
    themeCatalog: vi.fn(async () => ({
      version: "2026-08-10T00:00:00Z",
      themes: [] as unknown[],
    })),
    themePack: vi.fn(async (_id: string): Promise<ThemePackPayloadDto> => {
      throw new Error("themePack not stubbed for this test");
    }),
  },
  // Flipped per test; read through a getter so the component sees the current
  // value rather than whatever it was when the module first loaded.
  store: { mock: false },
}));

vi.mock("../lib/license.svelte", () => ({
  ownsTheme: (id: string) => lic.owned.includes(id),
  refreshEntitlement: lic.refresh,
}));
vi.mock("../lib/ipc", () => ipc);
vi.mock("../lib/auth.svelte", () => ({
  clerkConfigured: () => true,
  authState: () => ({ status: "signed-in" }),
  startSignIn: async () => {},
  waitForSignIn: async () => "signed-in",
}));
// The store keeps ownership and purchase, too — flipped through the same
// `store.mock` getter as `MOCK_STORE` so a Buy in mock mode never reaches
// `ipc.createCheckout` (bug 2's regression guard) while real mode still goes
// through the shared checkout flow (`startCheckout`, whose only external
// dependency — `ipc` — is already mocked above).
const mockBought = new Set<string>();
vi.mock("../lib/themes/storeOwnership.svelte", async () => {
  const { startCheckout } = await import("../lib/checkoutFlow");
  return {
    get MOCK_STORE() {
      return store.mock;
    },
    ownsStoreTheme: (id: string) =>
      store.mock ? mockBought.has(id) : lic.owned.includes(id),
    buyStoreTheme: async (id: string) => {
      if (store.mock) {
        mockBought.add(id);
        return { status: "granted" as const };
      }
      return startCheckout("theme", id);
    },
    refreshOwnership: async () => {
      if (!store.mock) await lic.refresh();
    },
    canPurchase: () => true,
  };
});

import ThemeStore from "./ThemeStore.svelte";
import { __resetRemoteCatalog } from "../lib/themes/remote.svelte";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
  lic.owned = [];
  store.mock = false;
  mockBought.clear();
  ipc.createCheckout.mockClear();
  ipc.openExternalUrl.mockClear();
  ipc.themeCatalog.mockClear();
  __resetRemoteCatalog();
});

async function settled() {
  await new Promise((r) => setTimeout(r, 0));
  flushSync();
}

function render(): HTMLDivElement {
  const value: PersonalizeSettings = {
    theme: "default",
    color: "default",
    textSize: "medium",
    font: "system",
    graphTheme: "default",
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(ThemeStore, { target: host, props: { value } });
  flushSync();
  return host;
}

/** A catalog row for a bundled theme, with the given purchasability. */
function row(id: string, name: string, purchasable: boolean) {
  return {
    id,
    kind: "app" as const,
    name,
    priceUsd: 0.99,
    preview: { swatches: ["#101026", "#20204a", "#7c5cff"] },
    checksum: `sha256:${id}`,
    purchasable,
  };
}

describe("ThemeStore purchasability (real deployment)", () => {
  it("disables Buy and says why for a theme the deployment can't sell", async () => {
    ipc.themeCatalog.mockResolvedValueOnce({
      version: "v1",
      themes: [row("aurora", "Aurora", false), row("sunset", "Sunset", true)],
    });
    const h = render();
    await settled();

    const blocked = h.querySelector<HTMLButtonElement>(
      '.btn.buy[data-unavailable="aurora"]',
    );
    expect(blocked).not.toBeNull();
    expect(blocked!.disabled).toBe(true);
    expect(blocked!.textContent).toContain("Not on sale");
    // The reason is visible, not hidden in a tooltip a disabled button eats.
    expect(h.querySelector(".hint.unavailable")?.textContent).toContain(
      "isn't available for purchase yet",
    );

    // Clicking it can't start a checkout.
    blocked!.click();
    await settled();
    expect(ipc.createCheckout).not.toHaveBeenCalled();
  });

  it("leaves Buy live for a theme the deployment does sell", async () => {
    ipc.themeCatalog.mockResolvedValueOnce({
      version: "v1",
      themes: [row("aurora", "Aurora", false), row("sunset", "Sunset", true)],
    });
    const h = render();
    await settled();

    // Sunset keeps a normal, enabled Buy button with its price.
    const buttons = [...h.querySelectorAll<HTMLButtonElement>(".btn.buy")];
    const live = buttons.filter((b) => !b.disabled);
    expect(live.length).toBeGreaterThan(0);
    expect(live.some((b) => b.textContent?.includes("$"))).toBe(true);

    const sunsetRow = [...h.querySelectorAll("li.item")].find((li) =>
      li.querySelector('.preview[data-theme="sunset"]'),
    )!;
    const sunsetBuy = sunsetRow.querySelector<HTMLButtonElement>(".btn.buy")!;
    expect(sunsetBuy.disabled).toBe(false);
    sunsetBuy.click();
    await settled();
    expect(ipc.createCheckout).toHaveBeenCalledWith("theme", "sunset");
  });

  // An EMPTY catalog is the no-information case — unreachable server, or the
  // load simply hasn't happened — and is not evidence that anything is
  // unsellable. Greying out the whole shop the moment the network blinks is
  // worse than a checkout that fails safely and says so. A server that DOES
  // answer is a different case entirely; see the next test.
  it("keeps Buy live when the catalog is empty", async () => {
    ipc.themeCatalog.mockResolvedValueOnce({ version: "", themes: [] });
    const h = render();
    await settled();

    expect(h.querySelector("[data-unavailable]")).toBeNull();
    expect(
      [...h.querySelectorAll<HTMLButtonElement>(".btn.buy")].every(
        (b) => !b.disabled,
      ),
    ).toBe(true);
  });

  // The Hero regression. A bundled theme shipped ahead of the deployed server:
  // the catalog arrives and lists what that deployment sells, with no row for
  // `hero` at all. That absence is evidence — `GET /themes/catalog` reports
  // every theme it serves, `purchasable` true or false, rather than hiding the
  // ones it can't charge for — so an id it never mentions is one this
  // deployment cannot sell. Buy used to stay lit and spend the user's click on
  // a generic "checkout isn't available right now".
});

describe("ThemeStore purchasability (mock store)", () => {
  // Mock mode never reaches Polar and dev servers have no Polar config at all,
  // so honouring `purchasable` there would grey out the whole shop. Buy stays
  // live and clickable regardless of the (false) `purchasable` flag — but,
  // unlike before the fix, clicking it grants locally instead of reaching
  // Polar (see the regression test below).
  it("ignores purchasable:false, and grants locally instead of calling Polar", async () => {
    store.mock = true;
    ipc.themeCatalog.mockResolvedValueOnce({
      version: "v1",
      themes: [row("aurora", "Aurora", false)],
    });
    const h = render();
    await settled();

    expect(h.querySelector("[data-unavailable]")).toBeNull();
    const buy = [...h.querySelectorAll<HTMLButtonElement>(".btn.buy")].find(
      (b) => b.textContent?.includes("$"),
    )!;
    expect(buy.disabled).toBe(false);

    buy.click();
    await settled();
    // Bug 2's regression guard: mock mode used to call `startCheckout`
    // unconditionally, guaranteeing a `checkout.unavailable` failure. Now
    // `buy()` goes through `buyStoreTheme`, which grants locally and never
    // reaches Polar while `MOCK_STORE` is on.
    expect(ipc.createCheckout).not.toHaveBeenCalled();
  });

  // Bug 1's regression guard: a theme this module already reports as owned
  // (e.g. because it was bought a moment ago, from this screen or from
  // `PersonalizePanel` — both call the same `ownsStoreTheme`) must render
  // Apply here too. Ownership is seeded *before* mount rather than via a
  // live click-then-recheck, the same way `PersonalizePanel.test.ts` proves
  // Apply-vs-Buy — `ownsStoreTheme` is mocked as a plain function in this
  // file (not the real module's reactive `$state`), so asserting a DOM
  // update in response to a post-render mutation wouldn't be meaningful
  // here; the reactive transition itself is proven in
  // `storeOwnership.svelte.test.ts`.
  it("a theme the module reports owned shows Apply, not Buy", async () => {
    store.mock = true;
    mockBought.add("aurora");
    ipc.themeCatalog.mockResolvedValueOnce({
      version: "v1",
      themes: [row("aurora", "Aurora", true)],
    });
    const h = render();
    await settled();

    const auroraRow = [...h.querySelectorAll("li.item")].find((li) =>
      li.querySelector('.preview[data-theme="aurora"]'),
    )!;
    expect(auroraRow.querySelector(".btn.apply")).not.toBeNull();
    expect(auroraRow.querySelector(".btn.buy")).toBeNull();
  });
});
