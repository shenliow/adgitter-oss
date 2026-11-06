import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import type { ClerkPortalCapabilities } from "../../lib/ipc";

// A mutable auth view so each test can render signed-in vs signed-out.
const { auth } = vi.hoisted(() => ({
  auth: {
    state: { status: "signed-out" } as {
      status: string;
      user?: {
        name?: string;
        email?: string;
        avatarUrl?: string;
        username?: string;
      };
    },
    startSignIn: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    openExternalUrl: vi.fn(async () => {}),
    configured: true,
    leftCredentials: false,
    publishableKey: "pk_test_x" as string | undefined,
    // Default: neither instance-conditional section enabled, and the portal's
    // own user URL matches what the string-munged fallback would derive
    // anyway — so tests that don't care about the capability probe see
    // exactly the pre-probe behaviour without having to await it. Explicitly
    // typed (rather than inferred from this literal) so a later
    // `mockResolvedValue`/`mockRejectedValue` can vary any field, including
    // `organizationProfileUrl` — which starts `null` here — to a string.
    portalCapabilities: vi.fn(
      async (): Promise<ClerkPortalCapabilities> => ({
        userProfileUrl: "https://discrete-ibex-7.accounts.dev/user",
        organizationProfileUrl: null,
        organizationsEnabled: false,
        mfaEnabled: false,
      }),
    ),
    // The server round-trip fired on mount so a stale name/avatar/username
    // is refreshed the moment this panel is what the user is looking at.
    refreshAccountProfile: vi.fn(async () => false),
  },
}));

vi.mock("../../lib/auth.svelte", () => ({
  authState: () => auth.state,
  startSignIn: auth.startSignIn,
  signOut: auth.signOut,
  signOutLeftCredentials: () => auth.leftCredentials,
  clerkFrontendApi: () => "discrete-ibex-7.clerk.accounts.dev",
  clerkConfigured: () => auth.configured,
  clerkPublishableKey: () => auth.publishableKey,
  refreshAccountProfile: auth.refreshAccountProfile,
}));
vi.mock("../../lib/ipc", () => ({
  openExternalUrl: auth.openExternalUrl,
  clerkPortalCapabilities: auth.portalCapabilities,
}));

import AccountPanel from "./AccountPanel.svelte";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
  auth.startSignIn.mockClear();
  auth.signOut.mockClear();
  auth.openExternalUrl.mockClear();
  auth.portalCapabilities.mockClear();
  auth.refreshAccountProfile.mockClear();
  auth.portalCapabilities.mockImplementation(async () => ({
    userProfileUrl: "https://discrete-ibex-7.accounts.dev/user",
    organizationProfileUrl: null,
    organizationsEnabled: false,
    mfaEnabled: false,
  }));
  auth.configured = true;
  auth.leftCredentials = false;
  auth.publishableKey = "pk_test_x";
  setOnline(true);
});

/**
 * Let the (mocked) `clerkPortalCapabilities` probe's promise chain resolve
 * and the resulting `capabilities` state update reach the DOM. The probe
 * starts from the `$effect` that runs on mount, so this always follows
 * `render()`; two microtask ticks cover the mock's own `async` resolution
 * plus the `.then` that assigns state, and `flushSync` applies the re-render
 * synchronously so assertions see the settled markup.
 */
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
}

/** Drive `navigator.onLine`, which jsdom hardcodes to `true`. */
function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    value: online,
    configurable: true,
  });
}

function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(AccountPanel, { target: host });
  flushSync();
  return host;
}

const button = (h: HTMLDivElement, text: string) =>
  [...h.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === text,
  );

/**
 * The confirm dialog renders in a portal-ish sibling of the panel, and its
 * confirm button carries the *same* label as the panel's ("Sign out"), so
 * queries have to be scoped to the dialog or they silently hit the panel
 * button again and the test proves nothing.
 */
const dialog = () => document.querySelector<HTMLElement>("[role=dialog]");
const dialogButton = (text: string) =>
  [...(dialog()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (b) => b.textContent?.trim() === text,
  );

describe("AccountPanel — refresh on open (Clerk-edit sync)", () => {
  // Opening this tab is exactly the moment a user complaining about a stale
  // name/avatar/username is looking at them — refresh once per mount so a
  // Clerk-side edit shows up without a sign-out.
  it("calls refreshAccountProfile once on mount", () => {
    auth.state = { status: "signed-in", user: { name: "Ada" } };
    render();
    expect(auth.refreshAccountProfile).toHaveBeenCalledOnce();
  });
});

describe("AccountPanel", () => {
  it("signed-out: shows Sign in and calls startSignIn", () => {
    auth.state = { status: "signed-out" };
    const h = render();
    const signIn = button(h, "Sign in");
    expect(signIn).toBeTruthy();
    expect(button(h, "Sign out")).toBeUndefined();
    signIn!.click();
    expect(auth.startSignIn).toHaveBeenCalledOnce();
  });

  // `startSignIn` returns immediately and silently when there is no
  // publishable key. A button that ignores that is worse than a disabled one:
  // it invites the click and then does nothing, which is how an empty key in
  // `.env.development` presented as "the button does nothing".
  it("unconfigured: the button is disabled and says why, rather than no-opping", () => {
    auth.configured = false;
    auth.state = { status: "signed-out" };
    const h = render();
    const signIn = button(h, "Sign in");
    expect(signIn?.disabled, "an unusable sign-in must not look usable").toBe(
      true,
    );
    expect(signIn?.title).toBeTruthy();
    signIn!.click();
    expect(auth.startSignIn).not.toHaveBeenCalled();
  });

  // `signOut` is the only thing that releases the loopback listener's port, and
  // it used to render solely in the signed-in branch. A user who closed the
  // browser tab therefore faced a disabled button for the listener's full
  // five-minute deadline with no way back.
  it("signing-in: the button is disabled but a cancel is offered", () => {
    auth.state = { status: "signing-in" };
    const h = render();
    expect(button(h, "Signing in…")?.disabled).toBe(true);
    const cancel = button(h, "Cancel");
    expect(cancel, "a sign-in in flight must be escapable").toBeTruthy();
    cancel!.click();
    expect(auth.signOut).toHaveBeenCalledOnce();
  });

  it("signing-in: explains that the browser has to finish the job", () => {
    auth.state = { status: "signing-in" };
    const h = render();
    expect(h.textContent).toContain("Finish signing in in your browser");
  });

  it("signed-in: shows identity + Sign out, and manage opens the portal", async () => {
    auth.state = {
      status: "signed-in",
      user: { name: "Jane Doe", email: "jane@example.com" },
    };
    const h = render();
    expect(h.textContent).toContain("jane@example.com");
    expect(h.textContent).toContain("Jane Doe");
    expect(button(h, "Sign out")).toBeTruthy();

    button(h, "Manage account")!.click();
    await Promise.resolve();
    expect(auth.openExternalUrl).toHaveBeenCalledWith(
      "https://discrete-ibex-7.accounts.dev/user",
    );
  });
});

// ── Sign-out warns before destroying credentials (2026-08-18) ────────────────
//
// Sign-out is no longer a view reset: it destroys this device's licence, and
// signing back in is verified online. The user is told that before it happens,
// and told it more pointedly when they are offline and therefore have no way
// back into the account right now.

describe("AccountPanel — sign-out confirmation", () => {
  const signedIn = () => {
    auth.state = { status: "signed-in", user: { email: "ada@example.com" } };
    return render();
  };

  it("asks before signing out instead of doing it on the first click", () => {
    const h = signedIn();
    button(h, "Sign out")!.click();
    flushSync();

    expect(
      auth.signOut,
      "the credential wipe must not start before the user confirms",
    ).not.toHaveBeenCalled();
    expect(dialog(), "a confirmation must be shown").toBeTruthy();
  });

  it("states what is lost, and that signing back in restores it", () => {
    const h = signedIn();
    button(h, "Sign out")!.click();
    flushSync();

    const text = dialog()!.textContent ?? "";
    // The concrete consequences, so "what did I just lose?" is answered
    // before the click rather than discovered afterwards.
    expect(text).toContain("removes the licence stored on this device");
    expect(text).toContain("paid features and purchased themes");
    expect(text).toContain("become unavailable");
    expect(text).toContain("Signing in again restores everything");
  });

  it("offline: leads with the fact that there is no way back in right now", () => {
    setOnline(false);
    const h = signedIn();
    button(h, "Sign out")!.click();
    flushSync();

    const text = dialog()!.textContent ?? "";
    expect(text).toContain("You appear to be offline");
    expect(text).toContain(
      "you will not be able to get back into this account",
    );
  });

  it("confirming performs the sign-out; cancelling leaves the session alone", async () => {
    const h = signedIn();

    button(h, "Sign out")!.click();
    flushSync();
    dialogButton("Cancel")!.click();
    flushSync();
    expect(auth.signOut, "cancel must not sign out").not.toHaveBeenCalled();
    expect(dialog()).toBeFalsy();

    button(h, "Sign out")!.click();
    flushSync();
    dialogButton("Sign out")!.click();
    await Promise.resolve();
    expect(auth.signOut).toHaveBeenCalledOnce();
  });

  // Cancelling a sign-in that is still in flight is a different act: there is no
  // session and no licence yet, so there is nothing to destroy and nothing to
  // warn about. Putting a "you will lose your paid features" dialog in front of
  // it would be both untrue and a trap — that button is the only way to release
  // the loopback port.
  it("cancelling a sign-in in flight is immediate, with no warning dialog", () => {
    auth.state = { status: "signing-in" };
    const h = render();
    button(h, "Cancel")!.click();
    flushSync();

    expect(auth.signOut).toHaveBeenCalledOnce();
    expect(dialog()).toBeFalsy();
  });

  // A wipe that could not finish leaves the app signed out with the licence
  // still on disk. Presenting that as a clean sign-out is the exact dishonesty
  // this work removes, so it is stated.
  it("says so when the licence could not actually be removed", () => {
    auth.leftCredentials = true;
    auth.state = { status: "signed-out" };
    const h = render();

    expect(h.textContent).toContain("could not be removed");
    expect(h.textContent).toContain("may stay unlocked");
    expect(h.querySelector("[role=alert]")).toBeTruthy();
  });

  it("says nothing extra after a clean sign-out", () => {
    auth.state = { status: "signed-out" };
    const h = render();
    expect(h.textContent).not.toContain("could not be removed");
  });
});

// ── Account email ─────────────────────────────────────────────────────

describe("AccountPanel — account email", () => {
  it("shows the real address, not the placeholder dash", () => {
    // The panel used to render "—" forever because nothing ever populated the
    // email; the licence now carries a signed claim for it.
    auth.state = { status: "signed-in", user: { email: "ada@example.com" } };
    const h = render();
    const email = [...h.querySelectorAll(".field")].find((f) =>
      f.textContent?.includes("Email"),
    );
    expect(email?.textContent).toContain("ada@example.com");
    expect(email?.textContent).not.toContain("—");
  });

  it("says the address is only a default, so nobody assumes it overrides git", () => {
    auth.state = { status: "signed-in", user: { email: "ada@example.com" } };
    const h = render();
    // The precedence has to be stated, not implied: a user who thinks ADGitter
    // re-authors their commits would (rightly) stop trusting it to write.
    expect(h.textContent).toContain("only when git has no user.email");
    expect(h.textContent).toContain("always wins");
  });

  it("falls back to a dash for a licence minted before the email claim", () => {
    auth.state = { status: "signed-in", user: { name: "Jane Doe" } };
    const h = render();
    const email = [...h.querySelectorAll(".field")].find((f) =>
      f.textContent?.includes("Email"),
    );
    expect(email?.textContent).toContain("—");
    // …and with no address there is nothing to explain about commit defaults.
    expect(h.textContent).not.toContain("always wins");
  });
});

// ── Avatar + username (account-profile completion) ───────────────────────────

describe("AccountPanel — avatar + username", () => {
  it("renders an avatar image when avatarUrl is present", () => {
    auth.state = {
      status: "signed-in",
      user: {
        email: "ada@example.com",
        avatarUrl: "https://example.com/a.png",
      },
    };
    const h = render();
    const img = h.querySelector<HTMLImageElement>(".avatar img");
    expect(img).toBeTruthy();
    expect(img?.src).toBe("https://example.com/a.png");
  });

  it("falls back to the placeholder when avatarUrl is absent", () => {
    auth.state = { status: "signed-in", user: { email: "ada@example.com" } };
    const h = render();
    expect(h.querySelector(".avatar img")).toBeFalsy();
  });

  // A broken image glyph in a 48px circle reads as a bug, not "no avatar".
  it("falls back to the placeholder when the avatar image fails to load", () => {
    auth.state = {
      status: "signed-in",
      user: {
        email: "ada@example.com",
        avatarUrl: "https://example.com/dead.png",
      },
    };
    const h = render();
    const img = h.querySelector<HTMLImageElement>(".avatar img");
    expect(img).toBeTruthy();
    img!.dispatchEvent(new Event("error"));
    flushSync();
    expect(h.querySelector(".avatar img")).toBeFalsy();
  });

  it("shows a Username row only when a username exists", () => {
    auth.state = {
      status: "signed-in",
      user: { email: "ada@example.com", username: "ada" },
    };
    const h = render();
    const usernameField = [...h.querySelectorAll(".field")].find((f) =>
      f.textContent?.includes("Username"),
    );
    expect(usernameField?.textContent).toContain("ada");
  });

  // Never a permanent dash row — absent entirely rather than "Username: —".
  it("does not render a Username row when there is no username", () => {
    auth.state = { status: "signed-in", user: { email: "ada@example.com" } };
    const h = render();
    const usernameField = [...h.querySelectorAll(".field")].find((f) =>
      f.textContent?.includes("Username"),
    );
    expect(usernameField).toBeUndefined();
  });
});

// ── Clerk portal capabilities ─────────────────────────────────────────────
// Organization stays gated on what Clerk confirms this instance has enabled.
// Two-factor auth is no longer gated at all — it is a deep link into Clerk's
// Security tab that is always shown (see AccountPanel's header comment); the
// probe's `mfaEnabled` only drives whether the button gets a warning tooltip.

describe("AccountPanel — Clerk portal capabilities", () => {
  it("shows Two-factor auth even when neither MFA nor Organization is enabled on this instance; Organization stays hidden", async () => {
    auth.portalCapabilities.mockResolvedValue({
      userProfileUrl: "https://discrete-ibex-7.accounts.dev/user",
      organizationProfileUrl: null,
      organizationsEnabled: false,
      mfaEnabled: false,
    });
    auth.state = { status: "signed-in", user: { email: "ada@example.com" } };
    const h = render();
    await settle();
    expect(button(h, "Manage account")).toBeTruthy();
    expect(button(h, "Password & security")).toBeTruthy();
    expect(
      button(h, "Two-factor auth"),
      "MFA is a deep link now, not a gated section — it must render even when this instance has none configured",
    ).toBeTruthy();
    expect(button(h, "Organization")).toBeUndefined();
  });

  it("Two-factor auth still renders when the capability probe rejects — never an empty manage list, never a throw", async () => {
    auth.portalCapabilities.mockRejectedValue(new Error("offline"));
    auth.state = { status: "signed-in", user: { email: "ada@example.com" } };
    let h!: HTMLDivElement;
    expect(() => (h = render())).not.toThrow();
    await settle();
    expect(button(h, "Manage account")).toBeTruthy();
    expect(button(h, "Password & security")).toBeTruthy();
    expect(button(h, "Two-factor auth")).toBeTruthy();
    expect(button(h, "Organization")).toBeUndefined();
    expect(h.querySelectorAll(".manage button").length).toBeGreaterThan(0);

    button(h, "Manage account")!.click();
    await Promise.resolve();
    expect(auth.openExternalUrl).toHaveBeenCalledWith(
      "https://discrete-ibex-7.accounts.dev/user",
    );
  });

  it("Two-factor auth and Password & security deep-link to the Security tab — not the host root's /security, and not plain /user; Manage account still opens plain /user", async () => {
    auth.portalCapabilities.mockResolvedValue({
      userProfileUrl: "https://discrete-ibex-7.accounts.dev/user",
      organizationProfileUrl: null,
      organizationsEnabled: false,
      mfaEnabled: false,
    });
    auth.state = { status: "signed-in", user: { email: "ada@example.com" } };
    const h = render();
    await settle();

    button(h, "Two-factor auth")!.click();
    await Promise.resolve();
    expect(auth.openExternalUrl).toHaveBeenLastCalledWith(
      "https://discrete-ibex-7.accounts.dev/user/security",
    );

    button(h, "Password & security")!.click();
    await Promise.resolve();
    expect(auth.openExternalUrl).toHaveBeenLastCalledWith(
      "https://discrete-ibex-7.accounts.dev/user/security",
    );

    // The trap this guards against: `new URL('security', userProfileUrl)`
    // resolves against the *origin*, dropping the `/user` path segment.
    expect(auth.openExternalUrl).not.toHaveBeenCalledWith(
      "https://discrete-ibex-7.accounts.dev/security",
    );

    button(h, "Manage account")!.click();
    await Promise.resolve();
    expect(auth.openExternalUrl).toHaveBeenLastCalledWith(
      "https://discrete-ibex-7.accounts.dev/user",
    );
  });

  it("shows Organization pointing at its own URL when enabled; Two-factor auth keeps opening the security tab, with no tooltip, once a second factor is configured", async () => {
    auth.portalCapabilities.mockResolvedValue({
      userProfileUrl: "https://discrete-ibex-7.accounts.dev/user",
      organizationProfileUrl:
        "https://discrete-ibex-7.accounts.dev/organization",
      organizationsEnabled: true,
      mfaEnabled: true,
    });
    auth.state = { status: "signed-in", user: { email: "ada@example.com" } };
    const h = render();
    await settle();

    const mfa = button(h, "Two-factor auth");
    expect(mfa).toBeTruthy();
    expect(mfa!.title).toBeFalsy();
    mfa!.click();
    await Promise.resolve();
    expect(auth.openExternalUrl).toHaveBeenCalledWith(
      "https://discrete-ibex-7.accounts.dev/user/security",
    );

    const org = button(h, "Organization");
    expect(org).toBeTruthy();
    org!.click();
    await Promise.resolve();
    expect(auth.openExternalUrl).toHaveBeenCalledWith(
      "https://discrete-ibex-7.accounts.dev/organization",
    );
  });

  it("tooltips Two-factor auth explaining the instance has no second factor configured, and stays clickable", async () => {
    auth.portalCapabilities.mockResolvedValue({
      userProfileUrl: "https://discrete-ibex-7.accounts.dev/user",
      organizationProfileUrl: null,
      organizationsEnabled: false,
      mfaEnabled: false,
    });
    auth.state = { status: "signed-in", user: { email: "ada@example.com" } };
    const h = render();
    await settle();
    const mfa = button(h, "Two-factor auth")!;
    expect(mfa.title).toBeTruthy();
    expect(
      mfa.disabled,
      "always clickable, per the user's decision — never disabled",
    ).toBe(false);
  });

  it("no tooltip on Two-factor auth once the instance has a second factor configured", async () => {
    auth.portalCapabilities.mockResolvedValue({
      userProfileUrl: "https://discrete-ibex-7.accounts.dev/user",
      organizationProfileUrl: null,
      organizationsEnabled: false,
      mfaEnabled: true,
    });
    auth.state = { status: "signed-in", user: { email: "ada@example.com" } };
    const h = render();
    await settle();
    expect(button(h, "Two-factor auth")!.title).toBeFalsy();
  });

  it("no tooltip on Two-factor auth while the probe is pending or has failed", async () => {
    auth.portalCapabilities.mockRejectedValue(new Error("offline"));
    auth.state = { status: "signed-in", user: { email: "ada@example.com" } };
    const h = render();
    await settle();
    expect(button(h, "Two-factor auth")!.title).toBeFalsy();
  });

  // Polar (merchant of record) handles billing, not Clerk — this
  // button could never have worked, so it is gone rather than disabled.
  it("never offers Payment methods", async () => {
    auth.portalCapabilities.mockResolvedValue({
      userProfileUrl: "https://discrete-ibex-7.accounts.dev/user",
      organizationProfileUrl:
        "https://discrete-ibex-7.accounts.dev/organization",
      organizationsEnabled: true,
      mfaEnabled: true,
    });
    auth.state = { status: "signed-in", user: { email: "ada@example.com" } };
    const h = render();
    await settle();
    expect(button(h, "Payment methods")).toBeUndefined();
  });
});
