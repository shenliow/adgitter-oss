import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mount, unmount, flushSync, type ComponentProps } from "svelte";

// The account button now performs real work (a Polar checkout below the top
// tier, a Polar customer-portal session at it), so the Tauri boundary is faked
// for the whole file. Everything above it — `checkoutFlow`, `ipc`, `auth` — is
// the real module, so what the click tests assert is the observable behaviour:
// which native commands ran, with what arguments, and what the popover says
// afterwards.
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import UserMenu from "./UserMenu.svelte";
import { LOCALES } from "../lib/i18n/messages";
import { setLocale } from "../lib/i18n/index.svelte";
import { setPlan, type Plan } from "../lib/license.svelte";
import { signOut } from "../lib/auth.svelte";
import type { LoopbackAuthResult } from "../lib/ipc";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

// The plan is pinned explicitly here and in every plan-sensitive test: it must
// never be inherited from the ambient env. A normal checkout's gitignored
// `.env` sets `VITE_DEV_PLAN=enterprise`, so a test that let the store carry
// whatever it happened to hold would pass in one working copy and fail in
// another. `setPlan` is the store's single reactive entry point.
beforeEach(() => {
  setLocale("en");
  setPlan("free");
});
afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
  setLocale("en");
  setPlan("free");
});

function render(over: Partial<ComponentProps<typeof UserMenu>> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(UserMenu, {
    target: host,
    props: { locale: "en", onLocale: () => {}, onClose: () => {}, ...over },
  });
  flushSync();
  return host;
}

describe("UserMenu language switcher", () => {
  it("lists all launch locales and selects the active one", () => {
    const h = render({ locale: "zh-Hant" });
    const select = h.querySelector("select.lang") as HTMLSelectElement;
    expect(select.querySelectorAll("option")).toHaveLength(LOCALES.length);
    expect(select.value).toBe("zh-Hant");
  });

  it("fires onLocale with the chosen code", () => {
    const onLocale = vi.fn();
    const h = render({ onLocale });
    const select = h.querySelector("select.lang") as HTMLSelectElement;
    select.value = "ja";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onLocale).toHaveBeenCalledWith("ja");
  });

  it("re-renders labels live when the locale changes", () => {
    const h = render({ status: "signed-in" });
    expect(h.textContent).toContain("Log out");
    setLocale("zh-Hant");
    flushSync();
    expect(h.textContent).toContain("登出");
  });
});

describe("UserMenu auth entry", () => {
  it("shows a Sign in button when signed out, disabled until configured", () => {
    const h = render();
    const btn = h.querySelector("button.primary") as HTMLButtonElement;
    expect(btn.textContent).toContain("Sign in");
    expect(btn.disabled).toBe(true);
  });

  it("enables Sign in and fires onSignIn when configured", () => {
    const onSignIn = vi.fn();
    const h = render({ configured: true, onSignIn });
    const btn = h.querySelector("button.primary") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it("shows identity + Log out when signed in", () => {
    const onSignOut = vi.fn();
    const h = render({
      status: "signed-in",
      user: { name: "Ada", email: "ada@example.com" },
      onSignOut,
    });
    expect(h.textContent).toContain("Ada");
    expect(h.textContent).toContain("ada@example.com");
    const logout = [...h.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Log out"),
    ) as HTMLButtonElement;
    logout.click();
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});

// ── Avatar + name/email de-duplication (account-profile completion) ─────────

describe("UserMenu avatar + identity lines", () => {
  it("renders an avatar image when avatarUrl is present", () => {
    const h = render({
      status: "signed-in",
      user: { name: "Ada", avatarUrl: "https://example.com/ada.png" },
    });
    const img = h.querySelector<HTMLImageElement>(".avatar img");
    expect(img).toBeTruthy();
    expect(img?.src).toBe("https://example.com/ada.png");
  });

  it("falls back to the gradient placeholder when avatarUrl is absent", () => {
    const h = render({ status: "signed-in", user: { name: "Ada" } });
    expect(h.querySelector(".avatar img")).toBeFalsy();
  });

  // A broken-image glyph in a 40px circle reads as a bug, not "no avatar".
  it("falls back to the placeholder when the avatar image fails to load", () => {
    const h = render({
      status: "signed-in",
      user: { name: "Ada", avatarUrl: "https://example.com/dead.png" },
    });
    const img = h.querySelector<HTMLImageElement>(".avatar img");
    expect(img).toBeTruthy();
    img!.dispatchEvent(new Event("error"));
    flushSync();
    expect(h.querySelector(".avatar img")).toBeFalsy();
  });

  it("shows email on both the name line and the line below when there is a real name", () => {
    const h = render({
      status: "signed-in",
      user: { name: "Ada", email: "ada@example.com" },
    });
    const strong = h.querySelector(".who strong");
    const span = h.querySelector(".who span");
    expect(strong?.textContent).toBe("Ada");
    expect(span?.textContent).toBe("ada@example.com");
  });

  // The bug this fixes: with no name, the same email used to render on both
  // lines. The bold line falls back to it; the line underneath must not
  // repeat it.
  it("does not duplicate the email on both lines when there is no name", () => {
    const h = render({
      status: "signed-in",
      user: { email: "ada@example.com" },
    });
    const strong = h.querySelector(".who strong");
    const span = h.querySelector(".who span");
    expect(strong?.textContent).toBe("ada@example.com");
    expect(span?.textContent).toBe("");
  });

  it("falls back to username, then email, for the bold line", () => {
    const h = render({
      status: "signed-in",
      user: { username: "ada", email: "ada@example.com" },
    });
    const strong = h.querySelector(".who strong");
    const span = h.querySelector(".who span");
    expect(strong?.textContent).toBe("ada");
    expect(span?.textContent).toBe("ada@example.com");
  });
});

// ── Paid-tier star + upgrade ceiling ───────────────────────────────────────

describe("UserMenu plan star", () => {
  /** Mount signed in on an explicitly pinned tier. */
  function signedInOn(plan: Plan) {
    setPlan(plan);
    return render({ status: "signed-in", user: { name: "Ada" } });
  }
  /** Tear down the current mount so a loop can render the next tier. */
  function teardown() {
    unmount(app);
    app = undefined;
    host.remove();
  }

  it("shows no star on free — the free tier is unmarked", () => {
    const h = signedInOn("free");
    expect(h.querySelector(".star")).toBeNull();
  });

  it("colours the star per paid tier", () => {
    for (const [plan, cls] of [
      ["basic", "plan-basic"],
      ["advance", "plan-advance"],
      ["enterprise", "plan-enterprise"],
    ] as const) {
      const h = signedInOn(plan);
      const star = h.querySelector(".star") as HTMLElement;
      expect(star, plan).not.toBeNull();
      expect(star.classList.contains(cls), plan).toBe(true);
      teardown();
    }
  });

  // The star is an image with a name, not a decorative glyph: the plan reaches
  // a screen reader through aria-label, not hover alone.
  it("names the current plan to assistive tech and on hover", () => {
    const h = signedInOn("advance");
    const star = h.querySelector(".star") as HTMLElement;
    expect(star.getAttribute("role")).toBe("img");
    expect(star.getAttribute("aria-label")).toBe("Current plan: Advance");
    expect(star.getAttribute("title")).toBe("Current plan: Advance");
    expect(star.getAttribute("aria-hidden")).toBeNull();
  });

  it("translates the plan tooltip with the active locale", () => {
    const h = signedInOn("basic");
    setLocale("zh-Hant");
    flushSync();
    const star = h.querySelector(".star") as HTMLElement;
    expect(star.getAttribute("aria-label")).toBe("目前方案：Basic");
  });

  // Signed out there is no plan at all, so no star — and this is not confusable
  // with free's unmarked star, because the head reads "Not signed in".
  it("shows no star and no plan tooltip when signed out", () => {
    setPlan("enterprise"); // even a stale paid plan must not leak a star
    const h = render({ status: "signed-out" });
    expect(h.querySelector(".star")).toBeNull();
    expect(h.textContent).toContain("Not signed in");
  });
});

// ── The account button: upgrade below the top tier, manage at it ───────────
//
// This button used to be inert at every tier, and *visibly* inert at
// enterprise. It is now live in both states: below the top tier it starts a
// real Polar checkout for the next tier up, and at the top it opens Polar's
// customer portal — enabled, because an enterprise subscriber with no way to
// cancel or replace a card is the worst-served user of the lot.
//
// Every test below pins the plan explicitly. A normal checkout's gitignored
// `.env` sets `VITE_DEV_PLAN=enterprise`, so a test that let the entitlement
// store carry whatever it happened to hold would exercise the *portal* branch
// in one working copy and the *checkout* branch in another.

const CHECKOUT_URL = "https://sandbox.polar.sh/checkout/co_1";
/** A portal URL carries a `customer_session_token` — it is a credential. */
const PORTAL_URL =
  "https://sandbox.polar.sh/org/portal?customer_session_token=tok_secret";
/** pk for frontend API host "discrete-ibex-7.clerk.accounts.dev". */
const DEV_KEY = "pk_test_ZGlzY3JldGUtaWJleC03LmNsZXJrLmFjY291bnRzLmRldiQ";

/** The tagged error shapes Rust serializes for the two expected refusals. */
const notSignedIn = { code: "NOT_SIGNED_IN", message: "not signed in" };
const noSubscription = {
  code: "NO_SUBSCRIPTION",
  message: "no subscription found for this account",
};

describe("UserMenu account button", () => {
  /**
   * The account action — located by position (the first non-ghost, non-primary
   * button in `.actions`) rather than by its text, because its label is
   * exactly what changes between the two states under test.
   */
  function accountBtn(h: HTMLElement) {
    return h.querySelector(
      ".actions .btn:not(.ghost):not(.primary)",
    ) as HTMLButtonElement;
  }
  function commands(): string[] {
    return invoke.mock.calls.map((c) => c[0] as string);
  }
  function argsOf(cmd: string) {
    return invoke.mock.calls.filter((c) => c[0] === cmd).map((c) => c[1]);
  }
  function mountOn(plan: Plan) {
    setPlan(plan);
    return render({ status: "signed-in", user: { name: "Ada" } });
  }
  function teardown() {
    unmount(app);
    app = undefined;
    host.remove();
  }

  /**
   * Resolver for the loopback listener a parked sign-in is waiting on, so a
   * test can play the browser's part (mirrors `checkoutFlow.test.ts`).
   */
  let settleCallback: ((r: LoopbackAuthResult) => void) | null = null;

  /** Fake backend with the three loopback sign-in commands always answered. */
  function backend(handler: (cmd: string) => unknown) {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "start_loopback_auth") {
        return {
          redirectUrl: "http://127.0.0.1:47821/callback?state=nonce-1",
          state: "nonce-1",
          port: 47821,
        };
      }
      if (cmd === "await_loopback_auth") {
        return new Promise<LoopbackAuthResult>((r) => {
          settleCallback = r;
        });
      }
      if (cmd === "cancel_loopback_auth") {
        settleCallback?.({ params: {}, timedOut: false, cancelled: true });
        settleCallback = null;
        return undefined;
      }
      return handler(cmd);
    });
  }

  beforeEach(() => {
    settleCallback = null;
    signOut();
    invoke.mockReset();
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", DEV_KEY);
  });
  afterEach(() => vi.unstubAllEnvs());

  // ── What it renders ──────────────────────────────────────────────────────

  it("reads 'Upgrade' and is enabled below the top tier, tooltipped with the plan", () => {
    for (const plan of ["free", "basic", "advance"] as const) {
      const btn = accountBtn(mountOn(plan));
      expect(btn.textContent, plan).toContain("Upgrade");
      expect(btn.textContent, plan).not.toContain("Manage subscription");
      expect(btn.disabled, plan).toBe(false);
      expect(btn.title, plan).toContain("Current plan:");
      teardown();
    }
  });

  // Free has no star to hover, so the button's tooltip is where a free user
  // learns their plan.
  it("names free's plan on the button, the only tooltip free has", () => {
    expect(accountBtn(mountOn("free")).title).toBe("Current plan: Free");
  });

  // The headline UI change. It was `disabled` here before, with "Already on
  // the top plan" as its tooltip and nothing to click.
  it("reads 'Manage subscription' and is ENABLED on enterprise", () => {
    const btn = accountBtn(mountOn("enterprise"));
    expect(btn.textContent).toContain("Manage subscription");
    expect(btn.textContent).not.toContain("Upgrade");
    expect(btn.disabled).toBe(false);
    // Visibly a different control, not just a relabelled one…
    expect(btn.classList.contains("manage")).toBe(true);
    // …and its tooltip says what it opens, which an enabled button labelled
    // only "Manage subscription" otherwise would not.
    expect(btn.title).toBe(
      "Top plan — cancel, change payment method, or view invoices",
    );
    expect(btn.title).not.toContain("Already on the top plan");
  });

  it("translates both states with the active locale", () => {
    const h = mountOn("enterprise");
    setLocale("zh-Hant");
    flushSync();
    expect(accountBtn(h).textContent).toContain("管理訂閱");
    teardown();

    const free = mountOn("free");
    setLocale("zh-Hant");
    flushSync();
    expect(accountBtn(free).textContent).toContain("升級");
  });

  // ── What it does ─────────────────────────────────────────────────────────

  // Not a hardcoded tier: a single generic "Upgrade" must never charge someone
  // for the tier they already hold.
  it("checks out the next tier ABOVE the current plan", async () => {
    for (const [plan, expected] of [
      ["free", "basic"],
      ["basic", "advance"],
      ["advance", "enterprise"],
    ] as const) {
      invoke.mockReset();
      backend((cmd) => (cmd === "create_checkout" ? CHECKOUT_URL : undefined));
      const h = mountOn(plan);

      accountBtn(h).click();
      await vi.waitFor(() => expect(commands()).toContain("open_external_url"));

      expect(argsOf("create_checkout"), plan).toEqual([
        { kind: "plan", id: expected },
      ]);
      expect(argsOf("open_external_url"), plan).toEqual([
        { url: CHECKOUT_URL },
      ]);
      // Never the portal below the top tier.
      expect(commands(), plan).not.toContain("create_customer_portal");
      teardown();
    }
  });

  it("opens the customer portal on enterprise, never a checkout", async () => {
    backend((cmd) =>
      cmd === "create_customer_portal" ? PORTAL_URL : undefined,
    );
    const h = mountOn("enterprise");

    accountBtn(h).click();
    await vi.waitFor(() => expect(commands()).toContain("open_external_url"));

    // No argument of any kind: the server derives the customer from the
    // verified licence subject, so there is nothing for this page to pass.
    expect(argsOf("create_customer_portal")).toEqual([undefined]);
    expect(argsOf("open_external_url")).toEqual([{ url: PORTAL_URL }]);
    expect(commands()).not.toContain("create_checkout");
    // Success says nothing — the browser opening is the feedback.
    expect(h.querySelector(".notice")).toBeNull();
  });

  /// A portal URL is a credential. It goes to the browser and nowhere else.
  it("never renders the portal URL or its session token", async () => {
    backend((cmd) =>
      cmd === "create_customer_portal" ? PORTAL_URL : undefined,
    );
    const h = mountOn("enterprise");
    accountBtn(h).click();
    await vi.waitFor(() => expect(commands()).toContain("open_external_url"));
    flushSync();

    expect(h.innerHTML).not.toContain("customer_session_token");
    expect(h.innerHTML).not.toContain("tok_secret");
    expect(h.innerHTML).not.toContain(PORTAL_URL);
  });

  // ── What it says when it cannot ───────────────────────────────────────────

  it("tells a non-subscriber there is no subscription, in its own words", async () => {
    backend((cmd) => {
      if (cmd === "create_customer_portal") throw noSubscription;
      return undefined;
    });
    const h = mountOn("enterprise");

    accountBtn(h).click();
    await vi.waitFor(() => expect(h.querySelector(".notice")).not.toBeNull());

    expect(h.querySelector(".notice")?.textContent).toBe(
      "No subscription found for this account.",
    );
    // Specifically NOT the generic failure, and no browser tab was opened.
    expect(h.textContent).not.toContain("isn't available right now");
    expect(commands()).not.toContain("open_external_url");
    // …and the button is usable again.
    expect(accountBtn(h).disabled).toBe(false);
  });

  // The guarantee that makes the busy flag safe: every ending releases it.
  it("restores the button when the user cancels sign-in — upgrade", async () => {
    backend((cmd) => {
      if (cmd === "create_checkout") throw notSignedIn;
      return undefined;
    });
    const h = mountOn("free");

    accountBtn(h).click();
    // Busy while the browser round trip is parked.
    await vi.waitFor(() => expect(accountBtn(h).disabled).toBe(true));
    await vi.waitFor(() => expect(settleCallback).not.toBeNull());

    // The portal bounced back with a refusal (user cancelled / denied).
    settleCallback!({
      params: { error: "access_denied" },
      timedOut: false,
      cancelled: false,
    });
    settleCallback = null;

    await vi.waitFor(() => expect(accountBtn(h).disabled).toBe(false));
    expect(accountBtn(h).textContent).toContain("Upgrade");
    expect(h.querySelector(".notice")?.textContent).toBe(
      "Sign-in was cancelled — nothing was purchased.",
    );
  });

  it("restores the button when the user cancels sign-in — manage subscription", async () => {
    backend((cmd) => {
      if (cmd === "create_customer_portal") throw notSignedIn;
      return undefined;
    });
    const h = mountOn("enterprise");

    accountBtn(h).click();
    await vi.waitFor(() => expect(accountBtn(h).disabled).toBe(true));
    await vi.waitFor(() => expect(settleCallback).not.toBeNull());

    settleCallback!({
      params: { error: "access_denied" },
      timedOut: false,
      cancelled: false,
    });
    settleCallback = null;

    await vi.waitFor(() => expect(accountBtn(h).disabled).toBe(false));
    // Still the manage button, not reverted to Upgrade.
    expect(accountBtn(h).textContent).toContain("Manage subscription");
    // The browser was opened for the *sign-in page* only; the abandoned
    // action never reached a portal, so no session was ever minted or opened.
    expect(argsOf("open_external_url")).not.toContainEqual({ url: PORTAL_URL });
    expect(argsOf("create_customer_portal")).toHaveLength(1);
    expect(h.querySelector(".notice")?.textContent).toBe(
      "Sign-in was cancelled — nothing was purchased.",
    );
  });
});

// ── DEV-ONLY plan switcher ─────────────────────────────────────────────────
//
// The control lives here, rather than in Settings, so a tier change is visible
// in the same glance that made it: the star, the plan label and the upgrade
// button's disabled state are all in this popover. These tests assert exactly
// that live feedback loop, plus the two things that make it safe — it is marked
// as a development tool, and it is absent when `import.meta.env.DEV` is false.

describe("UserMenu dev plan switcher", () => {
  function devSelect(h: HTMLElement) {
    return h.querySelector("select.devselect") as HTMLSelectElement;
  }
  function choose(h: HTMLElement, value: string) {
    const s = devSelect(h);
    s.value = value;
    s.dispatchEvent(new Event("change", { bubbles: true }));
    flushSync();
  }
  /** Located by position, since the label is one of the things that moves. */
  function accountBtn(h: HTMLElement) {
    return h.querySelector(
      ".actions .btn:not(.ghost):not(.primary)",
    ) as HTMLButtonElement;
  }
  function remount() {
    unmount(app);
    app = undefined;
    host.remove();
    return render({ status: "signed-in", user: { name: "Ada" } });
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
  });

  it("offers the four tiers plus 'no override'", () => {
    const h = render({ status: "signed-in", user: { name: "Ada" } });
    const opts = [...devSelect(h).querySelectorAll("option")].map(
      (o) => o.value,
    );
    expect(opts).toEqual(["real", "free", "basic", "advance", "enterprise"]);
  });

  // Not decoration: a control that grants paid tiers must never be mistakable
  // for a product feature in a screenshot.
  it("is labelled as a development tool", () => {
    const h = render({ status: "signed-in", user: { name: "Ada" } });
    expect(h.querySelector(".devtag")?.textContent).toBe("DEV ONLY");
    expect(devSelect(h).title).toContain("Development tool");
    // …and says out loud when it is actively bypassing the paywall.
    choose(h, "advance");
    expect(h.querySelector(".devwarn")?.textContent).toContain(
      "without a licence",
    );
    choose(h, "real");
    expect(h.querySelector(".devwarn")).toBeNull();
  });

  // The reason the switcher is in this popover at all.
  it("moves the star, the label and the account button's job live", () => {
    const h = render({ status: "signed-in", user: { name: "Ada" } });
    expect(h.querySelector(".star")).toBeNull(); // free: unmarked
    expect(accountBtn(h).textContent).toContain("Upgrade");

    choose(h, "advance");
    setPlan("advance"); // stands in for the async refreshEntitlement
    flushSync();
    let star = h.querySelector(".star") as HTMLElement;
    expect(star.classList.contains("plan-advance")).toBe(true);
    expect(star.getAttribute("aria-label")).toBe("Current plan: Advance");
    expect(accountBtn(h).textContent).toContain("Upgrade");

    choose(h, "enterprise");
    setPlan("enterprise");
    flushSync();
    star = h.querySelector(".star") as HTMLElement;
    expect(star.classList.contains("plan-enterprise")).toBe(true);
    // Top tier: nothing left to buy, so the button switches to managing the
    // existing subscription — and stays clickable while doing it.
    expect(accountBtn(h).textContent).toContain("Manage subscription");
    expect(accountBtn(h).disabled).toBe(false);
  });

  it("persists the choice, so a remount shows it selected", () => {
    const h = render({ status: "signed-in", user: { name: "Ada" } });
    choose(h, "basic");
    expect(localStorage.getItem("adgitter.dev.plan-override")).toBe("basic");
    expect(devSelect(remount()).value).toBe("basic");
  });

  // The frontend gate, independent of the native `#[cfg(debug_assertions)]`
  // one. The control asserts the switcher IS there in dev, so its absence
  // below cannot be an artefact of the mount.
  it("is not rendered at all when import.meta.env.DEV is false", () => {
    const control = render({ status: "signed-in", user: { name: "Ada" } });
    expect(devSelect(control)).not.toBeNull();

    vi.stubEnv("DEV", false);
    const h = remount();
    expect(devSelect(h)).toBeNull();
    expect(h.querySelector(".devtag")).toBeNull();
    expect(h.textContent).not.toContain("DEV ONLY");
  });
});
