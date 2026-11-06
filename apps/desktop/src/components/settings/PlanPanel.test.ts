import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";

const { lic, ipc, auth } = vi.hoisted(() => ({
  lic: {
    plan: "basic",
    refresh: vi.fn(async () => {}),
    trialing: false,
    trialEnds: null as number | null,
  },
  ipc: {
    openExternalUrl: vi.fn(async () => {}),
    createCheckout: vi.fn(async () => "https://checkout.polar.sh/x"),
    createCustomerPortal: vi.fn(async () => "https://polar.sh/portal/x"),
    isAdgitterError: (e: unknown) =>
      typeof e === "object" && e !== null && "code" in e && "message" in e,
    // Only here so the REAL `license.svelte` module can be linked below for
    // its `deviceLimit` (it imports this). The panel never calls it.
    verifyLicense: vi.fn(async () => {
      throw new Error("not used by PlanPanel");
    }),
    trialStatus: vi.fn(async (): Promise<unknown> => {
      throw { code: "NOT_SIGNED_IN", message: "no licence" };
    }),
    startTrial: vi.fn(async () => ({})),
  },
  // The panel runs the real checkout flow; only the browser round-trip it
  // can't perform in a test is faked. `settle` ends the pending wait the way a
  // deep-link callback (or the user giving up) would.
  auth: {
    configured: true,
    status: "signed-out" as string,
    settle: (_outcome: string) => {},
  },
}));

// `getPlan`/`refreshEntitlement` are faked (the panel's inputs), but
// `deviceLimit` is the REAL one: the concurrent-devices row renders straight
// from it, and a stubbed copy here would let the matrix show numbers the rest
// of the app disagrees with. `license.svelte.test.ts` in turn checks that
// function against the server's `device_limit_for`, so the chain is
// matrix → deviceLimit() → the license server, with no hand-written number in it.
vi.mock("../../lib/license.svelte", async () => {
  const actual = await vi.importActual<
    typeof import("../../lib/license.svelte")
  >("../../lib/license.svelte");
  return {
    getPlan: () => lic.plan,
    refreshEntitlement: lic.refresh,
    deviceLimit: actual.deviceLimit,
    onTrial: () => lic.trialing,
    trialEndsMs: () => lic.trialEnds,
  };
});
vi.mock("../../lib/ipc", () => ipc);
vi.mock("../../lib/auth.svelte", () => ({
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

import PlanPanel from "./PlanPanel.svelte";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
  lic.refresh.mockClear();
  ipc.createCheckout.mockReset();
  ipc.createCheckout.mockResolvedValue("https://checkout.polar.sh/x");
  ipc.createCustomerPortal.mockReset();
  ipc.createCustomerPortal.mockResolvedValue("https://polar.sh/portal/x");
  ipc.openExternalUrl.mockClear();
  ipc.trialStatus.mockReset();
  ipc.trialStatus.mockRejectedValue({ code: "NOT_SIGNED_IN", message: "x" });
  ipc.startTrial.mockReset();
  lic.trialing = false;
  lic.trialEnds = null;
  auth.configured = true;
  auth.status = "signed-out";
});

function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(PlanPanel, { target: host });
  flushSync();
  return host;
}

/** Let every queued task run, then re-render. */
async function settled() {
  await new Promise((r) => setTimeout(r, 0));
  flushSync();
}

/** The tagged error the backend returns when there is no license yet. */
const NOT_SIGNED_IN = { code: "NOT_SIGNED_IN", message: "not signed in" };

function hint(h: HTMLElement): string {
  return h.querySelector(".hint")?.textContent?.trim() ?? "";
}

describe("PlanPanel", () => {
  it("highlights the current plan column", () => {
    lic.plan = "basic";
    const h = render();
    const current = h.querySelector("th.plan-col.current");
    expect(current).toBeTruthy();
    expect(current!.textContent).toContain("Basic");
    // Exactly one plan column is marked current.
    expect(h.querySelectorAll("th.plan-col.current").length).toBe(1);
  });

  it("Upgrade creates a Polar checkout and opens it", async () => {
    lic.plan = "free";
    auth.status = "signed-in";
    ipc.createCheckout.mockResolvedValueOnce("https://checkout.polar.sh/adv");
    const h = render();
    const upgrade = h.querySelector<HTMLButtonElement>(".btn.upgrade")!;
    expect(upgrade.disabled).toBe(false); // always enabled — checkout is server-side
    expect(h.querySelector(".hint")).toBeNull();

    upgrade.click();
    await settled();
    // The tier sold is the one ABOVE the current plan, not a fixed headline
    // tier: a free user is sold `basic`.
    expect(ipc.createCheckout).toHaveBeenCalledWith("plan", "basic");
    expect(ipc.openExternalUrl).toHaveBeenCalledWith(
      "https://checkout.polar.sh/adv",
    );
    expect(h.querySelector(".hint")).toBeNull();
  });

  // The defect this panel carried: a single hardcoded `'advance'` meant an
  // `advance` subscriber's Upgrade button sold them the plan they were already
  // paying for.
  it("sells the tier above the current one, never the current one", async () => {
    lic.plan = "advance";
    auth.status = "signed-in";
    ipc.createCheckout.mockResolvedValueOnce("https://checkout.polar.sh/ent");
    const h = render();

    h.querySelector<HTMLButtonElement>(".btn.upgrade")!.click();
    await settled();
    expect(ipc.createCheckout).toHaveBeenCalledWith("plan", "enterprise");
  });

  // At the top tier there is nothing left to sell, but a subscriber still needs
  // somewhere to cancel — so the button stays live and changes job.
  it("at enterprise it opens the subscription portal instead of a checkout", async () => {
    lic.plan = "enterprise";
    auth.status = "signed-in";
    ipc.createCustomerPortal.mockResolvedValueOnce(
      "https://polar.sh/portal/abc",
    );
    const h = render();
    const btn = h.querySelector<HTMLButtonElement>(".btn.upgrade")!;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toContain("Manage subscription");

    btn.click();
    await settled();
    expect(ipc.createCheckout).not.toHaveBeenCalled();
    expect(ipc.createCustomerPortal).toHaveBeenCalled();
    expect(ipc.openExternalUrl).toHaveBeenCalledWith(
      "https://polar.sh/portal/abc",
    );
  });

  // The lazy-sign-in contract: one click, even when the
  // user has no account yet.
  it("signed out: Upgrade signs in and then opens the checkout by itself", async () => {
    lic.plan = "free";
    ipc.createCheckout
      .mockRejectedValueOnce(NOT_SIGNED_IN)
      .mockResolvedValueOnce("https://checkout.polar.sh/adv");
    const h = render();
    const upgrade = h.querySelector<HTMLButtonElement>(".btn.upgrade")!;

    upgrade.click();
    await settled();
    // Waiting on the browser: the button says so and can't be clicked twice.
    expect(upgrade.disabled).toBe(true);
    expect(upgrade.textContent).toContain("sign-in");
    expect(ipc.openExternalUrl).not.toHaveBeenCalled();

    auth.settle("signed-in");
    await settled();

    expect(ipc.openExternalUrl).toHaveBeenCalledWith(
      "https://checkout.polar.sh/adv",
    );
    expect(ipc.createCheckout).toHaveBeenCalledTimes(2);
    expect(upgrade.disabled).toBe(false);
    expect(h.querySelector(".hint")).toBeNull();
  });

  it("says so and recovers when the user abandons sign-in", async () => {
    lic.plan = "free";
    ipc.createCheckout.mockRejectedValueOnce(NOT_SIGNED_IN);
    const h = render();
    const upgrade = h.querySelector<HTMLButtonElement>(".btn.upgrade")!;

    upgrade.click();
    await settled();
    auth.settle("cancelled");
    await settled();

    expect(hint(h)).toContain("cancelled");
    expect(ipc.openExternalUrl).not.toHaveBeenCalled();
    // Not stuck: the button is clickable again.
    expect(upgrade.disabled).toBe(false);
  });

  it("says so when sign-in never comes back", async () => {
    lic.plan = "free";
    ipc.createCheckout.mockRejectedValueOnce(NOT_SIGNED_IN);
    const h = render();

    h.querySelector<HTMLButtonElement>(".btn.upgrade")!.click();
    await settled();
    auth.settle("timeout");
    await settled();

    expect(hint(h)).toContain("timed out");
    expect(h.querySelector<HTMLButtonElement>(".btn.upgrade")!.disabled).toBe(
      false,
    );
  });

  it("shows a hint when the checkout itself can't be created", async () => {
    lic.plan = "free";
    auth.status = "signed-in";
    ipc.createCheckout.mockRejectedValueOnce({
      code: "INTERNAL_ERROR",
      message: "polar not provisioned",
    });
    const h = render();
    h.querySelector<HTMLButtonElement>(".btn.upgrade")!.click();
    await settled();
    expect(hint(h)).toContain("isn't available");
  });

  it("Refresh entitlement re-verifies the license", async () => {
    lic.plan = "free";
    const h = render();
    h.querySelector<HTMLButtonElement>(".btn.refresh")!.click();
    await Promise.resolve();
    expect(lic.refresh).toHaveBeenCalledOnce();
  });
});

// ── The comparison matrix ───────────────────────────────────────────────────
//
// Text and attributes only. jsdom's `getComputedStyle` does not resolve
// Svelte's scoped styles, so nothing here may assert on computed CSS.

/** The four plan cells of the row whose feature label is `label`. */
function matrixRow(h: HTMLElement, label: string): string[] {
  const row = [...h.querySelectorAll("table.matrix tbody tr")].find(
    (tr) => tr.querySelector("td.feat")?.textContent?.trim() === label,
  );
  if (!row) throw new Error(`no matrix row labelled "${label}"`);
  return [...row.querySelectorAll("td")]
    .slice(1)
    .map((td) => td.textContent?.trim() ?? "");
}

describe("plan comparison matrix", () => {
  it("shows the concurrent-device cap for each tier (1 / 2 / 3 / 3)", () => {
    const h = render();
    expect(matrixRow(h, "Concurrent devices")).toEqual(["1", "2", "3", "3"]);
  });

  it("gives team seats to Enterprise only, as a finite number with add-ons", () => {
    const h = render();
    const seats = matrixRow(h, "Team seats");
    // Free, Basic AND Advance have none — uniformly. Advance used to claim 3.
    expect(seats.slice(0, 3)).toEqual(["–", "–", "–"]);
    // Enterprise: five, and the add-on availability is stated rather than
    // implied. It used to read "Unlimited", which was simply untrue.
    expect(seats[3]).toContain("5");
    expect(seats[3]).toContain("add-ons");
    expect(seats[3]).not.toContain("Unlimited");
  });

  it("has no row claiming anything is unlimited", () => {
    const h = render();
    expect(h.querySelector("table.matrix")!.textContent).not.toContain(
      "Unlimited",
    );
  });
});

describe("PlanPanel free trial", () => {
  const AVAILABLE = { state: "available", days: 14, plan: "advance" };

  it("offers the trial to a free user, signed out too", () => {
    lic.plan = "free";
    const h = render();
    expect(h.querySelector(".trial")?.textContent).toContain("14");
    expect(h.querySelector(".trial button")?.textContent).toContain(
      "Start free trial",
    );
  });

  it("does not offer it on a paid plan", () => {
    lic.plan = "basic";
    expect(render().querySelector(".trial")).toBeNull();
  });

  it("starts the trial and re-reads the entitlement", async () => {
    lic.plan = "free";
    auth.status = "signed-in";
    ipc.trialStatus.mockResolvedValue(AVAILABLE);
    const h = render();
    await settled();
    ipc.trialStatus
      .mockResolvedValueOnce(AVAILABLE)
      .mockResolvedValue({ ...AVAILABLE, state: "active" });
    h.querySelector<HTMLButtonElement>(".trial button")!.click();
    await settled();
    await settled();
    expect(ipc.startTrial).toHaveBeenCalledTimes(1);
    expect(lic.refresh).toHaveBeenCalled();
  });

  it("signs in first when signed out, then starts", async () => {
    lic.plan = "free";
    const h = render();
    h.querySelector<HTMLButtonElement>(".trial button")!.click();
    await settled();
    ipc.trialStatus.mockResolvedValue(AVAILABLE);
    auth.settle("signed-in");
    await settled();
    await settled();
    expect(ipc.startTrial).toHaveBeenCalledTimes(1);
  });

  it("says so when this computer or account has used it", async () => {
    lic.plan = "free";
    auth.status = "signed-in";
    ipc.trialStatus.mockResolvedValue({ ...AVAILABLE, state: "used" });
    const h = render();
    await settled();
    expect(h.querySelector(".trial")).toBeNull();
    expect(h.textContent).toContain("already used its free trial");
  });

  it("on a trial, shows the end date and sells the plan being tried", async () => {
    lic.plan = "advance";
    lic.trialing = true;
    lic.trialEnds = Date.UTC(2030, 0, 15, 12);
    auth.status = "signed-in";
    ipc.trialStatus.mockResolvedValue({ ...AVAILABLE, state: "active" });
    const h = render();
    await settled();
    expect(h.querySelector(".trial-line")?.textContent).toContain("2030");
    expect(h.querySelector("th.plan-col.current")?.textContent).toContain(
      "Trial",
    );
    const buy = h.querySelector<HTMLButtonElement>(".btn.upgrade")!;
    expect(buy.textContent).toContain("Buy Advance");
    buy.click();
    await settled();
    expect(ipc.createCheckout).toHaveBeenCalledWith("plan", "advance");
  });
});
