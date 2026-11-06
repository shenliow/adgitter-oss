import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import type { GeneralSettings } from "../../lib/settings";

const { ipc } = vi.hoisted(() => ({
  ipc: { openExternalUrl: vi.fn(async () => {}) },
}));
vi.mock("../../lib/ipc", () => ({
  openExternalUrl: ipc.openExternalUrl,
}));

import GeneralPanel from "./GeneralPanel.svelte";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
  ipc.openExternalUrl.mockClear();
});

function defaults(over: Partial<GeneralSettings> = {}): GeneralSettings {
  return {
    autoPull: "off",
    autoPullBefore: { createBranch: false, push: true, commit: false },
    autoPullSeconds: 5,
    unstaged: "warn",
    undoRedo: 3,
    dryRun: false,
    hideGhosts: false,
    remoteUrl: "",
    accessToken: "",
    ...over,
  };
}

function render(
  value: GeneralSettings,
  extra: {
    repoOpen?: boolean;
    detectedRemote?: string | null;
    gitEmail?: {
      global: string;
      project: string;
      globalName?: string;
      projectName?: string;
      useProject: boolean;
      useAccount?: boolean;
    };
    accountIdentity?: { name: string; email: string } | null;
  } = {},
) {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(GeneralPanel, { target: host, props: { value, ...extra } });
  flushSync();
  return host;
}

const subToggles = (h: HTMLElement) =>
  [...h.querySelectorAll(".checks input[type=checkbox]")] as HTMLInputElement[];

describe("GeneralPanel", () => {
  it("reflects the draft in every control", () => {
    const h = render(
      defaults({
        autoPull: "warn",
        unstaged: "off",
        undoRedo: 7,
        dryRun: true,
        hideGhosts: true,
        remoteUrl: "https://github.com/you/repo.git",
        accessToken: "ghp_secret",
      }),
    );
    const selects = h.querySelectorAll("select");
    expect((selects[0] as HTMLSelectElement).value).toBe("warn"); // autoPull
    expect((selects[1] as HTMLSelectElement).value).toBe("off"); // unstaged
    expect(
      (h.querySelector("input[type=number]") as HTMLInputElement).value,
    ).toBe("7");
    expect(
      (h.querySelector('[data-field="remote-url"]') as HTMLInputElement).value,
    ).toBe("https://github.com/you/repo.git");
    expect(
      (h.querySelector('input[type="password"]') as HTMLInputElement).value,
    ).toBe("ghp_secret");
  });

  it("disables the auto-pull sub-toggles when auto-pull is off", () => {
    const h = render(defaults({ autoPull: "off" }));
    const toggles = subToggles(h);
    expect(toggles).toHaveLength(3);
    expect(toggles.every((t) => t.disabled)).toBe(true);
  });

  it("enables the sub-toggles (reflecting their values) when auto-pull is warn", () => {
    const h = render(
      defaults({
        autoPull: "warn",
        autoPullBefore: { createBranch: true, push: false, commit: true },
      }),
    );
    const [createBranch, push, commit] = subToggles(h);
    expect(createBranch.disabled).toBe(false);
    expect(createBranch.checked).toBe(true);
    expect(push.checked).toBe(false);
    expect(commit.checked).toBe(true);
  });

  it("blanks and disables the remote fields on the Welcome screen (no repo)", () => {
    // Even with values present, no-repo (repoOpen=false) renders them blank +
    // disabled — a remote/token has no meaning without an open repo.
    const h = render(
      defaults({
        remoteUrl: "https://github.com/you/repo.git",
        accessToken: "ghp_secret",
      }),
      { repoOpen: false },
    );
    const url = h.querySelector(
      '[data-field="remote-url"]',
    ) as HTMLInputElement;
    const tok = h.querySelector('input[type="password"]') as HTMLInputElement;
    expect(url.disabled).toBe(true);
    expect(tok.disabled).toBe(true);
    expect(url.value).toBe("");
    expect(tok.value).toBe("");
  });

  it("enables + fills the remote fields once a repo is open (repoOpen=true)", () => {
    const h = render(
      defaults({ remoteUrl: "https://github.com/you/repo.git" }),
      { repoOpen: true },
    );
    const url = h.querySelector(
      '[data-field="remote-url"]',
    ) as HTMLInputElement;
    expect(url.disabled).toBe(false);
    expect(url.value).toBe("https://github.com/you/repo.git");
  });

  it("shows the override hint naming the detected .git origin (fill = override, empty = SSH)", () => {
    const h = render(defaults({ remoteUrl: "" }), {
      repoOpen: true,
      detectedRemote: "git@github.com:you/repo.git",
    });
    const hints = [...h.querySelectorAll(".hint")].map(
      (p) => p.textContent ?? "",
    );
    const override = hints.find((t) =>
      t.includes("git@github.com:you/repo.git"),
    );
    expect(override).toBeTruthy();
    expect(override).toMatch(/SSH/i); // explains the leave-empty behaviour
  });

  it("shows no override hint when the repo has no detected origin", () => {
    const h = render(defaults(), { repoOpen: true });
    const hints = [...h.querySelectorAll(".hint")].map(
      (p) => p.textContent ?? "",
    );
    expect(hints.some((t) => /SSH/i.test(t))).toBe(false);
  });

  it("writes an edited number field back to the draft (two-way binding)", () => {
    const value = defaults({ undoRedo: 3 });
    const h = render(value);
    const num = h.querySelector("input[type=number]") as HTMLInputElement;
    num.value = "12";
    num.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(value.undoRedo).toBe(12);
  });

  describe("open-token-page link (remoteTokenPageFor)", () => {
    const findLink = (h: HTMLElement) =>
      h.querySelector(
        '[data-action="open-token-page"]',
      ) as HTMLButtonElement | null;

    it("renders a link for a github.com remote and opens GitHub's token page", () => {
      const h = render(
        defaults({ remoteUrl: "https://github.com/you/repo.git" }),
      );
      const link = findLink(h);
      expect(link).toBeTruthy();
      link!.click();
      expect(ipc.openExternalUrl).toHaveBeenCalledWith(
        "https://github.com/settings/tokens",
      );
    });

    it("is a <button>, not an <a href> (an anchor would navigate the WebView away)", () => {
      const h = render(
        defaults({ remoteUrl: "https://github.com/you/repo.git" }),
      );
      const link = findLink(h);
      expect(link!.tagName).toBe("BUTTON");
      expect(h.querySelector("a[href]")).toBeNull();
    });

    it("prefers the typed remote over detectedRemote (typed value wins)", () => {
      const h = render(
        defaults({ remoteUrl: "https://gitlab.com/you/repo.git" }),
        { detectedRemote: "https://github.com/you/repo.git" },
      );
      const link = findLink(h);
      expect(link).toBeTruthy();
      link!.click();
      expect(ipc.openExternalUrl).toHaveBeenCalledWith(
        "https://gitlab.com/-/user_settings/personal_access_tokens",
      );
    });

    it("falls back to detectedRemote when the typed field is blank", () => {
      const h = render(defaults({ remoteUrl: "" }), {
        detectedRemote: "git@gitlab.com:you/repo.git",
      });
      const link = findLink(h);
      expect(link).toBeTruthy();
      link!.click();
      expect(ipc.openExternalUrl).toHaveBeenCalledWith(
        "https://gitlab.com/-/user_settings/personal_access_tokens",
      );
    });

    it("renders no link for an unknown/self-hosted host", () => {
      const h = render(
        defaults({ remoteUrl: "https://git.internal.example/you/repo.git" }),
      );
      expect(findLink(h)).toBeNull();
    });

    it("renders no link when no repo is open, even with a known-host remote", () => {
      const h = render(
        defaults({ remoteUrl: "https://github.com/you/repo.git" }),
        { repoOpen: false },
      );
      expect(findLink(h)).toBeNull();
    });
  });
});

describe("GeneralPanel git email", () => {
  const email = (h: HTMLElement) =>
    h.querySelector('[data-field="git-email"]') as HTMLInputElement;
  const box = (h: HTMLElement) =>
    h.querySelector('[data-field="git-email-project"]') as HTMLInputElement;

  it("shows the global email by default with the global hint", () => {
    const h = render(defaults(), {
      gitEmail: { global: "g@x.io", project: "", useProject: false },
    });
    expect(email(h).value).toBe("g@x.io");
    expect(box(h).checked).toBe(false);
    expect(h.textContent).toContain("~/.gitconfig");
  });

  it("shows the project email when useProject is set", () => {
    const h = render(defaults(), {
      gitEmail: { global: "g@x.io", project: "p@x.io", useProject: true },
    });
    expect(email(h).value).toBe("p@x.io");
    expect(h.textContent).toContain(".git/config");
  });

  it("checking the box turns on project scope and prefills it from global", () => {
    // The plain-object draft is not reactive here; SettingsModal.test covers
    // the rendered switch. Assert the draft mutation the panel performs.
    const gitEmail = { global: "g@x.io", project: "", useProject: false };
    const h = render(defaults(), { gitEmail });
    box(h).click();
    flushSync();
    expect(gitEmail.useProject).toBe(true);
    expect(gitEmail.project).toBe("g@x.io");
  });

  it("disables the checkbox without an open repo", () => {
    const h = render(defaults(), {
      repoOpen: false,
      gitEmail: { global: "g@x.io", project: "p@x.io", useProject: true },
    });
    expect(box(h).disabled).toBe(true);
    expect(email(h).value).toBe("g@x.io");
  });
});

describe("GeneralPanel account identity", () => {
  // jsdom's getComputedStyle does not resolve Svelte's scoped styles, so every
  // assertion here is on `disabled`, an attribute, or text — never on CSS.
  const name = (h: HTMLElement) =>
    h.querySelector('[data-field="git-name"]') as HTMLInputElement;
  const email = (h: HTMLElement) =>
    h.querySelector('[data-field="git-email"]') as HTMLInputElement;
  const accountBox = (h: HTMLElement) =>
    h.querySelector('[data-field="git-identity-account"]') as HTMLInputElement;
  const reason = (h: HTMLElement) =>
    h.querySelector('[data-field="git-identity-account-reason"]');
  const ACCOUNT = { name: "Ada Lovelace", email: "ada@account.io" };
  const draft = (over: Record<string, unknown> = {}) => ({
    global: "g@x.io",
    project: "p@x.io",
    globalName: "Global Name",
    projectName: "Project Name",
    useProject: false,
    useAccount: false,
    ...over,
  });

  it("fills and disables both fields when the account toggle is on", () => {
    const h = render(defaults(), {
      repoOpen: true,
      accountIdentity: ACCOUNT,
      gitEmail: draft({ useAccount: true }),
    });
    expect(name(h).value).toBe("Ada Lovelace");
    expect(email(h).value).toBe("ada@account.io");
    expect(name(h).disabled).toBe(true);
    expect(email(h).disabled).toBe(true);
  });

  it("leaves both fields editable while the account toggle is off", () => {
    const h = render(defaults(), {
      repoOpen: true,
      accountIdentity: ACCOUNT,
      gitEmail: draft(),
    });
    expect(name(h).disabled).toBe(false);
    expect(email(h).disabled).toBe(false);
    expect(email(h).value).toBe("g@x.io");
  });

  it("checking the box arms the account identity in the draft", () => {
    // The plain-object draft is not reactive here (same caveat as the git
    // email block above); SettingsModal.test covers the rendered switch.
    const gitEmail = draft();
    const h = render(defaults(), {
      repoOpen: true,
      accountIdentity: ACCOUNT,
      gitEmail,
    });
    accountBox(h).click();
    flushSync();
    expect(gitEmail.useAccount).toBe(true);
    // Independent of the project-scope switch — it is not implied.
    expect(gitEmail.useProject).toBe(false);
  });

  // ── The placeholder chain: "what is used if I leave this blank?" ──────────
  it("placeholder is the PROJECT value when the account toggle is on", () => {
    const h = render(defaults(), {
      repoOpen: true,
      accountIdentity: ACCOUNT,
      gitEmail: draft({ useAccount: true }),
    });
    expect(email(h).placeholder).toBe("p@x.io");
    expect(name(h).placeholder).toBe("Project Name");
  });

  it("placeholder is the GLOBAL value in project scope (account toggle off)", () => {
    const h = render(defaults(), {
      repoOpen: true,
      accountIdentity: ACCOUNT,
      gitEmail: draft({ useProject: true }),
    });
    expect(email(h).placeholder).toBe("g@x.io");
    expect(name(h).placeholder).toBe("Global Name");
  });

  it("placeholder is the ACCOUNT fallback in global scope (neither checked)", () => {
    // What git-core's `set_fallback_identity` would substitute when no
    // `user.email` is configured anywhere — the last link in the chain.
    const h = render(defaults(), {
      repoOpen: true,
      accountIdentity: ACCOUNT,
      gitEmail: draft(),
    });
    expect(email(h).placeholder).toBe("ada@account.io");
    expect(name(h).placeholder).toBe("Ada Lovelace");
  });

  it("shows no placeholder when the next level down holds nothing either", () => {
    const h = render(defaults(), {
      repoOpen: true,
      accountIdentity: null,
      gitEmail: draft({ global: "", globalName: "" }),
    });
    expect(email(h).placeholder).toBe("");
  });

  // ── The hover hint ───────────────────────────────────────────────────────
  it("hints about the substitution only for a field that is actually empty", () => {
    const h = render(defaults(), {
      repoOpen: true,
      accountIdentity: ACCOUNT,
      gitEmail: draft({ global: "", globalName: "Global Name" }),
    });
    expect(email(h).title).toMatch(/default/i);
    expect(name(h).title).toBe("");
  });

  it("shows no hint when nothing would be substituted", () => {
    const h = render(defaults(), {
      repoOpen: true,
      accountIdentity: null,
      gitEmail: draft({ global: "", globalName: "" }),
    });
    expect(email(h).title).toBe("");
  });

  // ── Availability ─────────────────────────────────────────────────────────
  it("is unavailable, with a visible reason, when the account has no identity", () => {
    const h = render(defaults(), {
      repoOpen: true,
      accountIdentity: null,
      gitEmail: draft(),
    });
    expect(accountBox(h).disabled).toBe(true);
    expect(reason(h)?.textContent?.trim()).toBeTruthy();
  });

  it("is unavailable without an open repo (it writes the project level)", () => {
    const h = render(defaults(), {
      repoOpen: false,
      accountIdentity: ACCOUNT,
      gitEmail: draft(),
    });
    expect(accountBox(h).disabled).toBe(true);
  });

  it("ignores a drafted useAccount when the repo closed under it", () => {
    const h = render(defaults(), {
      repoOpen: false,
      accountIdentity: ACCOUNT,
      gitEmail: draft({ useAccount: true }),
    });
    expect(accountBox(h).checked).toBe(false);
    expect(email(h).disabled).toBe(false);
  });
});

describe("GeneralPanel — auto-pull modes", () => {
  const modeSelect = (h: HTMLElement) =>
    h.querySelector<HTMLSelectElement>("select")!;
  const secondsInput = (h: HTMLElement) =>
    h.querySelector<HTMLInputElement>('[data-testid="autopull-seconds"]');

  it("offers all four modes", () => {
    const h = render(defaults());
    expect([...modeSelect(h).options].map((o) => o.value)).toEqual([
      "off",
      "warn",
      "notify",
      "always",
    ]);
  });

  it("enables the three action checkboxes in every mode but off", () => {
    for (const mode of ["warn", "notify", "always"] as const) {
      const h = render(defaults({ autoPull: mode }));
      expect(subToggles(h).map((b) => b.disabled)).toEqual([
        false,
        false,
        false,
      ]);
      h.remove();
      unmount(app);
      app = undefined;
    }
    const off = render(defaults({ autoPull: "off" }));
    expect(subToggles(off).map((b) => b.disabled)).toEqual([true, true, true]);
  });

  it("shows the response-time sub-option only in notify mode", () => {
    for (const mode of ["off", "warn", "always"] as const) {
      const h = render(defaults({ autoPull: mode }));
      expect(secondsInput(h)).toBeNull();
      h.remove();
      unmount(app);
      app = undefined;
    }
    const h = render(defaults({ autoPull: "notify", autoPullSeconds: 9 }));
    const input = secondsInput(h)!;
    expect(input).not.toBeNull();
    expect(input.value).toBe("9");
    expect(input.min).toBe("1");
    expect(input.max).toBe("60");
  });

  it("clamps an out-of-range response time on change", () => {
    const value = defaults({ autoPull: "notify", autoPullSeconds: 5 });
    const h = render(value);
    const input = secondsInput(h)!;
    input.value = "900";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    flushSync();
    expect(value.autoPullSeconds).toBe(60);
    input.value = "0";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    flushSync();
    expect(value.autoPullSeconds).toBe(1);
  });
});
