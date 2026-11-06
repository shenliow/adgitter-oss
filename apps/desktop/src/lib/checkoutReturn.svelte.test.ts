import { describe, it, expect, vi, beforeEach } from "vitest";

import type { LicenseStatusDto } from "./ipc";

vi.mock("./ipc", () => ({
  renewLicense: vi.fn(),
  verifyLicense: vi.fn(),
  isAdgitterError: (e: unknown) =>
    typeof e === "object" && e !== null && "code" in e,
}));

import { renewLicense, verifyLicense } from "./ipc";
import {
  RETRY_DELAYS_MS,
  checkoutReturnState,
  clearCheckoutReturn,
  currentEntitlement,
  grantsSomethingNew,
  handleCheckoutReturn,
  newlyOwnedThemes,
  pollForNewEntitlement,
} from "./checkoutReturn.svelte";
import { getPlan, ownsTheme, refreshEntitlement } from "./license.svelte";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

/** A verified-licence DTO as Rust returns it after an offline signature check. */
function dto(
  over: Partial<LicenseStatusDto> & { plan?: string } = {},
): LicenseStatusDto {
  return {
    status: "active",
    plan: "free",
    error: null,
    expiresMs: null,
    features: ["ApplyTheme"],
    ownedThemes: [],
    ...over,
  } as LicenseStatusDto;
}

/** Fake `wait` that records the backoff instead of burning real time. */
function recordingWait() {
  const waited: number[] = [];
  return {
    waited,
    wait: async (ms: number) => {
      waited.push(ms);
    },
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  clearCheckoutReturn();
  // Reset the entitlement store to the pre-purchase baseline: a valid free
  // licence (what a signed-in user has before buying anything).
  mocked(verifyLicense).mockResolvedValue(dto());
  await refreshEntitlement();
});

describe("entitlement comparison", () => {
  const base = { plan: "free", ownedThemes: [], features: [] };

  it("sees a newly owned theme", () => {
    expect(
      grantsSomethingNew(base, { ...base, ownedThemes: ["synthwave"] }),
    ).toBe(true);
    expect(
      newlyOwnedThemes(
        { ...base, ownedThemes: ["aurora"] },
        {
          ...base,
          ownedThemes: ["aurora", "synthwave"],
        },
      ),
    ).toEqual(["synthwave"]);
  });

  it("sees a new feature and a plan upgrade", () => {
    expect(grantsSomethingNew(base, { ...base, features: ["NoAd"] })).toBe(
      true,
    );
    expect(grantsSomethingNew(base, { ...base, plan: "advance" })).toBe(true);
  });

  it("does not call an unchanged — or reduced — entitlement a purchase", () => {
    const owned = { plan: "advance", ownedThemes: ["a"], features: ["NoAd"] };
    expect(grantsSomethingNew(owned, owned)).toBe(false);
    expect(grantsSomethingNew(owned, base)).toBe(false);
  });
});

describe("polling through the webhook race", () => {
  it("unlocks on the first attempt when the webhook already landed", async () => {
    mocked(renewLicense).mockResolvedValue(dto({ ownedThemes: ["synthwave"] }));
    const { wait, waited } = recordingWait();

    const out = await pollForNewEntitlement({
      before: { plan: "free", ownedThemes: [], features: [] },
      renew: renewLicense,
      wait,
    });

    expect(out).toMatchObject({ status: "unlocked", newThemes: ["synthwave"] });
    expect(renewLicense).toHaveBeenCalledTimes(1);
    expect(waited).toEqual([]); // no delay before the first try
  });

  it("keeps re-issuing with backoff until the delayed webhook lands", async () => {
    // The first two renewals return the *pre-purchase* entitlement — exactly
    // what happens when Polar redirects before `order.paid` is processed.
    mocked(renewLicense)
      .mockResolvedValueOnce(dto())
      .mockResolvedValueOnce(dto())
      .mockResolvedValue(dto({ ownedThemes: ["synthwave"] }));
    const { wait, waited } = recordingWait();

    const out = await pollForNewEntitlement({
      before: { plan: "free", ownedThemes: [], features: ["ApplyTheme"] },
      renew: renewLicense,
      wait,
    });

    expect(out.status).toBe("unlocked");
    expect(renewLicense).toHaveBeenCalledTimes(3);
    expect(waited).toEqual([RETRY_DELAYS_MS[1], RETRY_DELAYS_MS[2]]);
  });

  it("spends its whole budget and then reports pending, not failure", async () => {
    mocked(renewLicense).mockResolvedValue(dto());
    const { wait, waited } = recordingWait();

    const out = await pollForNewEntitlement({
      before: { plan: "free", ownedThemes: [], features: ["ApplyTheme"] },
      renew: renewLicense,
      wait,
    });

    expect(out).toEqual({ status: "pending" });
    expect(renewLicense).toHaveBeenCalledTimes(RETRY_DELAYS_MS.length);
    // The bounded window is tens of seconds — long enough for a late webhook.
    const total = waited.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(30_000);
    expect(total).toBeLessThanOrEqual(120_000);
  });

  it("retries through transient renewal errors", async () => {
    mocked(renewLicense)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(dto({ plan: "advance", features: ["NoAd"] }));
    const { wait } = recordingWait();

    const out = await pollForNewEntitlement({
      before: { plan: "free", ownedThemes: [], features: ["ApplyTheme"] },
      renew: renewLicense,
      wait,
    });

    expect(out.status).toBe("unlocked");
    expect(renewLicense).toHaveBeenCalledTimes(2);
  });

  it("stops immediately when there is no licence to renew", async () => {
    mocked(renewLicense).mockRejectedValue({
      code: "NOT_SIGNED_IN",
      message: "not signed in",
    });
    const { wait } = recordingWait();

    const out = await pollForNewEntitlement({
      before: { plan: "free", ownedThemes: [], features: [] },
      renew: renewLicense,
      wait,
    });

    expect(out).toEqual({ status: "signin-needed" });
    expect(renewLicense).toHaveBeenCalledTimes(1);
  });

  it("treats an invalid re-issued licence as granting nothing", async () => {
    mocked(renewLicense).mockResolvedValue(
      // A licence that failed verification must not unlock anything, whatever
      // fields ride along with it.
      dto({ status: "invalid", plan: "enterprise", ownedThemes: ["x"] }),
    );
    const { wait } = recordingWait();

    const out = await pollForNewEntitlement({
      before: { plan: "free", ownedThemes: [], features: [] },
      renew: renewLicense,
      wait,
    });

    expect(out).toEqual({ status: "pending" });
  });
});

describe("handleCheckoutReturn (the deep-link entry point)", () => {
  const fast = { delays: [0, 0], wait: async () => {} };

  it("shows processing, then unlocks and refreshes the entitlement store", async () => {
    const unlocked = dto({ ownedThemes: ["synthwave"] });
    mocked(renewLicense).mockResolvedValue(unlocked);
    mocked(verifyLicense).mockResolvedValue(unlocked);

    const done = handleCheckoutReturn(fast);
    expect(checkoutReturnState().status).toBe("processing");
    await done;

    expect(checkoutReturnState()).toEqual({
      status: "unlocked",
      newThemes: ["synthwave"],
    });
    // The store the UI actually gates on was re-read.
    expect(ownsTheme("synthwave")).toBe(true);
  });

  it("reports pending — never a lie — when confirmation never arrives", async () => {
    mocked(renewLicense).mockResolvedValue(dto());

    await handleCheckoutReturn(fast);

    expect(checkoutReturnState()).toEqual({ status: "pending" });
    expect(getPlan()).toBe("free");
  });

  it("joins an in-flight check instead of starting a second poll", async () => {
    mocked(renewLicense).mockResolvedValue(dto());
    const a = handleCheckoutReturn(fast);
    const b = handleCheckoutReturn(fast);
    expect(a).toBe(b);
    await a;
    expect(renewLicense).toHaveBeenCalledTimes(2); // one poll of two attempts
  });
});

describe("the deep link is not a proof of purchase", () => {
  it("grants nothing when a hostile page fires it and the server says no", async () => {
    // Any web page can navigate to `adgitter://checkout-complete?...`. The only
    // thing that can unlock anything is the server-signed licence, so a return
    // trip whose renewal reports the *same* free entitlement must leave the
    // user exactly as they were — and say "pending", not "purchased".
    mocked(renewLicense).mockResolvedValue(dto());
    mocked(verifyLicense).mockResolvedValue(dto());

    await handleCheckoutReturn({ delays: [0], wait: async () => {} });

    expect(checkoutReturnState().status).not.toBe("unlocked");
    expect(getPlan()).toBe("free");
    expect(ownsTheme("synthwave")).toBe(false);
    expect(currentEntitlement().ownedThemes).toEqual([]);
  });

  it("takes no argument, so nothing from the URL can reach the entitlement", () => {
    // Compile-time *and* runtime guard: the handler's only parameter is the
    // (test-only) timing override. A theme id in the query string has no path
    // into this module.
    expect(handleCheckoutReturn.length).toBe(0);
  });
});
