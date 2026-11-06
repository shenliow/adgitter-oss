import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mount, unmount, flushSync, type ComponentProps } from "svelte";
import SettingsModal from "./SettingsModal.svelte";
import { DEFAULT_SETTINGS, type Settings } from "../lib/settings";
import type { TutorialEvent } from "../lib/tutorial/types";

// Graph-theme ownership is pinned here rather than inherited from the
// environment. `VITE_STORE_MOCK` lives in a gitignored `.env`, so it reads
// `false` in a normal checkout (real entitlement → the harness owns nothing,
// every paid row shows Buy) but is UNSET inside a `git worktree`, where
// `MOCK_STORE` defaults to true and demo-owns `synthwave` — so a test that
// waits for an Apply button passes in one and fails in the other. Own exactly
// one paid pack, which is what the assertions below actually need.
vi.mock("../lib/themes/storeOwnership.svelte", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../lib/themes/storeOwnership.svelte")
    >();
  return {
    ...actual,
    MOCK_STORE: false,
    ownsStoreTheme: (id: string) => id === "default" || id === "synthwave",
  };
});

// `setGitName` belongs here just as much as `setGitEmail`: `saveGitEmail`
// calls BOTH, and an un-mocked one reaches the real Tauri `invoke` (undefined
// under jsdom) and throws synchronously — which used to abort the save before
// the email write and make `setGitEmail`'s spy record nothing. Mock exactly
// what the code calls.
const gitIpc = vi.hoisted(() => ({
  getGitEmail: vi.fn(),
  setGitEmail: vi.fn(),
  setGitName: vi.fn(),
}));
vi.mock("../lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/ipc")>();
  return { ...actual, ...gitIpc };
});

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

beforeEach(() => {
  gitIpc.getGitEmail.mockReset();
  gitIpc.setGitEmail.mockReset();
  gitIpc.setGitName.mockReset();
  gitIpc.getGitEmail.mockResolvedValue({ global: null, project: null });
  gitIpc.setGitEmail.mockResolvedValue(undefined);
  gitIpc.setGitName.mockResolvedValue(undefined);
  // Signed out by default — the account-identity block seeds its own profile.
  localStorage.removeItem("adgitter.account.profile");
});

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
});

function render(over: Partial<ComponentProps<typeof SettingsModal>> = {}) {
  const props: ComponentProps<typeof SettingsModal> = {
    settings: structuredClone(DEFAULT_SETTINGS),
    onSave: () => {},
    onClose: () => {},
    ...over,
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(SettingsModal, { target: host, props });
  flushSync();
  return host;
}

const tab = (h: HTMLDivElement, name: string) =>
  [...h.querySelectorAll<HTMLButtonElement>(".tabs button")].find(
    (b) => b.textContent?.trim() === name,
  )!;
const ok = (h: HTMLDivElement) =>
  [...h.querySelectorAll<HTMLButtonElement>(".btn")].find(
    (b) => b.textContent?.trim() === "OK",
  )!;

describe("SettingsModal initialTab", () => {
  it("defaults to General when initialTab is not given", () => {
    const h = render();
    expect(h.querySelector("h2")?.textContent).toBe("General");
  });

  it("defaults to General when initialTab is explicitly null", () => {
    const h = render({ initialTab: null });
    expect(h.querySelector("h2")?.textContent).toBe("General");
  });

  it("lands on Issue Panel when initialTab='Issue Panel'", () => {
    const h = render({ initialTab: "Issue Panel" });
    expect(h.querySelector("h2")?.textContent).toBe("Issue Panel");
  });

  // Regression for the "opened via the issue-empty link, then via the
  // TopBar" bug: since the modal is only ever mounted under App.svelte's
  // `{#if showSettings}`, a stale `active` tab could only leak forward if
  // the entry-point call sites failed to reset their seed — this pins the
  // component-level half of that contract: a fresh mount with no
  // `initialTab` must never land anywhere but General, regardless of what
  // an earlier mount was seeded with.
  it("a later mount with no initialTab is not affected by an earlier mount's tab", () => {
    const first = render({ initialTab: "Issue Panel" });
    expect(first.querySelector("h2")?.textContent).toBe("Issue Panel");
    unmount(app);
    host.remove();

    const second = render();
    expect(second.querySelector("h2")?.textContent).toBe("General");
  });
});

describe("SettingsModal", () => {
  it("defaults to General and edits persist on OK", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    const h = render({ onSave, onClose });
    expect(h.querySelector("h2")?.textContent).toBe("General");

    // The only initially-enabled checkbox is Git Dry Run.
    const dryRun = h.querySelector(
      "input[type=checkbox]:not([disabled])",
    ) as HTMLInputElement;
    dryRun.click();
    flushSync();
    ok(h).click();

    expect(onSave).toHaveBeenCalledOnce();
    const saved = onSave.mock.calls[0][0] as Settings;
    expect(saved.general.dryRun).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("routes between panels via the left nav", () => {
    const h = render();
    tab(h, "Personalize").click();
    flushSync();
    expect(h.querySelector("h2")?.textContent).toBe("Personalize");
    expect(h.querySelector(".preview")).not.toBeNull();

    // Every remaining tab routes to a real panel (Hooks/Webhooks stubs are
    // gone) — Shortcut renders the keymap editor.
    tab(h, "Shortcut").click();
    flushSync();
    expect(h.querySelector("h2")?.textContent).toBe("Shortcut");
    expect(h.querySelector(".placeholder")).toBeNull();
  });

  it("Cancel closes without saving", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    const h = render({ onSave, onClose });
    [...h.querySelectorAll<HTMLButtonElement>(".btn")]
      .find((b) => b.textContent?.trim() === "Cancel")!
      .click();
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("blocks OK while a keymap conflict exists", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.keymap = { pull: "Mod+P" }; // collides with push's default Mod+P
    const onSave = vi.fn();
    const h = render({ settings, onSave });
    tab(h, "Shortcut").click();
    flushSync();
    expect(ok(h).disabled).toBe(true);
    ok(h).click();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("SettingsModal: repo-level settings (General/Personalize/Themes/Log Anytime)", () => {
  it("shows the global-fallback hint on a migrating tab when no repo is open", () => {
    const h = render();
    expect(h.querySelector(".scope-hint")?.textContent).toContain(
      "No repository open",
    );
  });

  it("shows the repo-scoped hint on a migrating tab when a repo is open", () => {
    const h = render({ repoPath: "/repo" });
    expect(h.querySelector(".scope-hint")?.textContent).toContain(
      "Stored in this repository",
    );
  });

  it("shows no scope hint on a global-only tab (e.g. Shortcut)", () => {
    const h = render({ repoPath: "/repo" });
    tab(h, "Shortcut").click();
    flushSync();
    expect(h.querySelector(".scope-hint")).toBeNull();
  });

  it("with no repo open, the repo-specific remote fields are blank + disabled", () => {
    // A remote URL / token only mean something for an open repo — on the
    // Welcome screen they render blank and disabled regardless of any stray
    // global value, so the user can't misconfigure a "repo" that isn't open.
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.general.remoteUrl = "https://global.example/repo.git";
    settings.general.accessToken = "global-token";
    const h = render({ settings });
    const remoteInput = h.querySelector<HTMLInputElement>(
      'input[placeholder="https://github.com/you/repo.git"]',
    )!;
    expect(remoteInput.value).toBe("");
    expect(remoteInput.disabled).toBe(true);
    const tokenInput = h.querySelector<HTMLInputElement>(
      'input[type="password"][placeholder="ghp_…"]',
    )!;
    expect(tokenInput.value).toBe("");
    expect(tokenInput.disabled).toBe(true);
  });

  it("with a repo open, the draft sources General from projectGeneral + repoAccessToken (NOT global)", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.general.remoteUrl = "https://global.example/repo.git";
    settings.general.accessToken = "global-token";
    const h = render({
      settings,
      repoPath: "/repo",
      projectGeneral: {
        ...DEFAULT_SETTINGS.general,
        remoteUrl: "https://repo-specific.example/repo.git",
      },
      repoAccessToken: "repo-token",
    });
    const remoteInput = h.querySelector<HTMLInputElement>(
      'input[placeholder="https://github.com/you/repo.git"]',
    )!;
    expect(remoteInput.value).toBe("https://repo-specific.example/repo.git");
    const tokenInput = h.querySelector<HTMLInputElement>(
      'input[type="password"][placeholder="ghp_…"]',
    )!;
    expect(tokenInput.value).toBe("repo-token");
  });

  it("with a repo open, Save routes General/Personalize/Log Anytime through onSaveProjectSettings, split out accessToken, and never puts them in onSave's global object", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    const onSave = vi.fn();
    const onSaveProjectSettings = vi.fn();
    const h = render({
      settings,
      repoPath: "/repo",
      projectGeneral: { ...DEFAULT_SETTINGS.general },
      projectPersonalize: { ...DEFAULT_SETTINGS.personalize },
      projectLogAnytime: { ...DEFAULT_SETTINGS.logAnytime },
      repoAccessToken: "repo-token",
      onSave,
      onSaveProjectSettings,
    });

    // Edit the repo-scoped General dry-run checkbox.
    const dryRun = h.querySelector(
      "input[type=checkbox]:not([disabled])",
    ) as HTMLInputElement;
    dryRun.click();
    flushSync();
    ok(h).click();

    expect(onSaveProjectSettings).toHaveBeenCalledOnce();
    const projectSave = onSaveProjectSettings.mock.calls[0][0];
    expect(projectSave.general.dryRun).toBe(true);
    expect(projectSave.accessToken).toBe("repo-token");
    expect("accessToken" in projectSave.general).toBe(false);

    // onSave still fires (for keymap/locale/etc), but general/personalize/
    // logAnytime are put back EXACTLY as the original global settings, never
    // the repo-scoped edits.
    expect(onSave).toHaveBeenCalledOnce();
    const globalSave = onSave.mock.calls[0][0] as Settings;
    expect(globalSave.general).toEqual(settings.general);
    expect(globalSave.personalize).toEqual(settings.personalize);
    expect(globalSave.logAnytime).toEqual(settings.logAnytime);
  });

  it("with no repo open, Save never calls onSaveProjectSettings", () => {
    const onSave = vi.fn();
    const onSaveProjectSettings = vi.fn();
    const h = render({ onSave, onSaveProjectSettings });
    ok(h).click();
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSaveProjectSettings).not.toHaveBeenCalled();
  });
});

/**
 * Live preview is reported UPWARD now (it used to be a local `applyTheme`
 * here, which could only ever reach the CSS variables — never the graph
 * theme, which travels to MetroGraph as a prop). App.svelte turns these
 * reports into its `previewPersonalize` override and clears it on close.
 */
describe("SettingsModal: personalize preview reporting (onPersonalizePreview)", () => {
  it("reports the draft's personalize on mount and again on every change", () => {
    const onPersonalizePreview = vi.fn();
    const h = render({ onPersonalizePreview });
    // Mounting reports the seed, so the app's override always holds a full
    // value while the modal is open (never a mix of draft and saved).
    expect(onPersonalizePreview).toHaveBeenCalled();
    expect(onPersonalizePreview.mock.calls.at(-1)![0].graphTheme).toBe(
      "default",
    );

    tab(h, "Personalize").click();
    flushSync();
    const textSize = h.querySelectorAll("select")[1] as HTMLSelectElement;
    textSize.value = "large";
    textSize.dispatchEvent(new Event("change", { bubbles: true }));
    flushSync();
    expect(onPersonalizePreview.mock.calls.at(-1)![0].textSize).toBe("large");
  });

  it("with a repo open, the first report is the repo-scoped personalize, not the global one", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.personalize.graphTheme = "synthwave";
    const onPersonalizePreview = vi.fn();
    render({
      settings,
      repoPath: "/repo",
      projectGeneral: { ...DEFAULT_SETTINGS.general },
      projectPersonalize: {
        ...DEFAULT_SETTINGS.personalize,
        graphTheme: "blueprint",
      },
      projectLogAnytime: { ...DEFAULT_SETTINGS.logAnytime },
      onPersonalizePreview,
    });
    expect(onPersonalizePreview.mock.calls[0][0].graphTheme).toBe("blueprint");
  });
});

describe("SettingsModal git email", () => {
  const settle = async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
  };
  const email = (h: HTMLElement) =>
    h.querySelector('[data-field="git-email"]') as HTMLInputElement;
  const box = (h: HTMLElement) =>
    h.querySelector('[data-field="git-email-project"]') as HTMLInputElement;
  const type = (h: HTMLElement, v: string) => {
    email(h).value = v;
    email(h).dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
  };
  const props = { repoPath: "/r", onSaveProjectSettings: () => {} };

  it("loads the global email and does not save when unchanged", async () => {
    gitIpc.getGitEmail.mockResolvedValue({ global: "g@x.io", project: null });
    const h = render(props);
    await settle();
    expect(gitIpc.getGitEmail).toHaveBeenCalledWith("/r");
    expect(email(h).value).toBe("g@x.io");
    expect(box(h).checked).toBe(false);
    ok(h).click();
    expect(gitIpc.setGitEmail).not.toHaveBeenCalled();
  });

  it("saves a changed global email", async () => {
    gitIpc.getGitEmail.mockResolvedValue({ global: "g@x.io", project: null });
    const h = render(props);
    await settle();
    type(h, "new@x.io");
    ok(h).click();
    expect(gitIpc.setGitEmail).toHaveBeenCalledTimes(1);
    expect(gitIpc.setGitEmail).toHaveBeenCalledWith("global", "/r", "new@x.io");
  });

  it("starts in project mode when a project email exists and saves edits", async () => {
    gitIpc.getGitEmail.mockResolvedValue({
      global: "g@x.io",
      project: "p@x.io",
    });
    const h = render(props);
    await settle();
    expect(box(h).checked).toBe(true);
    expect(email(h).value).toBe("p@x.io");
    type(h, "p2@x.io");
    ok(h).click();
    // The save awaits the name write before the email write, so the email
    // call lands a microtask later — settle before asserting.
    await settle();
    expect(gitIpc.setGitEmail).toHaveBeenCalledTimes(1);
    expect(gitIpc.setGitEmail).toHaveBeenCalledWith("project", "/r", "p2@x.io");
  });

  it("sets a project email after checking the box", async () => {
    gitIpc.getGitEmail.mockResolvedValue({ global: "g@x.io", project: null });
    const h = render(props);
    await settle();
    box(h).click();
    flushSync();
    type(h, "p@x.io");
    ok(h).click();
    await settle();
    expect(gitIpc.setGitEmail).toHaveBeenCalledTimes(1);
    expect(gitIpc.setGitEmail).toHaveBeenCalledWith("project", "/r", "p@x.io");
  });

  it("unchecking clears the project email", async () => {
    gitIpc.getGitEmail.mockResolvedValue({
      global: "g@x.io",
      project: "p@x.io",
    });
    const h = render(props);
    await settle();
    box(h).click();
    flushSync();
    expect(email(h).value).toBe("g@x.io");
    ok(h).click();
    expect(gitIpc.setGitEmail).toHaveBeenCalledTimes(1);
    expect(gitIpc.setGitEmail).toHaveBeenCalledWith("project", "/r", null);
  });

  it("stays usable when the read fails, and disables project scope without a repo", async () => {
    gitIpc.getGitEmail.mockRejectedValue(new Error("boom"));
    const h = render();
    await settle();
    expect(gitIpc.getGitEmail).toHaveBeenCalledWith(null);
    expect(box(h).disabled).toBe(true);
    type(h, "a@x.io");
    ok(h).click();
    expect(gitIpc.setGitEmail).toHaveBeenCalledWith("global", null, "a@x.io");
  });
});

describe("SettingsModal account identity", () => {
  // jsdom's getComputedStyle does not resolve Svelte's scoped styles — every
  // assertion below is on `disabled`, an attribute, a call or text.
  const settle = async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
  };
  const name = (h: HTMLElement) =>
    h.querySelector('[data-field="git-name"]') as HTMLInputElement;
  const email = (h: HTMLElement) =>
    h.querySelector('[data-field="git-email"]') as HTMLInputElement;
  const accountBox = (h: HTMLElement) =>
    h.querySelector('[data-field="git-identity-account"]') as HTMLInputElement;
  const cancel = (h: HTMLDivElement) =>
    h.querySelector('[data-tutorial="settings-cancel"]') as HTMLButtonElement;
  const props = { repoPath: "/r", onSaveProjectSettings: () => {} };
  // The real localStorage-backed display profile, not a mock — that is where
  // `accountGitIdentity` reads from, and seeding it exercises the same path
  // the app takes after a sign-in.
  const signIn = (p: { name?: string; email?: string }) =>
    localStorage.setItem("adgitter.account.profile", JSON.stringify(p));

  it("fills and disables both fields when the box is checked", async () => {
    signIn({ name: "Ada Lovelace", email: "ada@account.io" });
    gitIpc.getGitEmail.mockResolvedValue({
      global: "g@x.io",
      globalName: "Global Name",
      project: null,
      projectName: null,
    });
    const h = render(props);
    await settle();
    expect(accountBox(h).disabled).toBe(false);
    accountBox(h).click();
    flushSync();
    expect(name(h).value).toBe("Ada Lovelace");
    expect(email(h).value).toBe("ada@account.io");
    expect(name(h).disabled).toBe(true);
    expect(email(h).disabled).toBe(true);
  });

  it("writes the account identity to the PROJECT level on OK", async () => {
    signIn({ name: "Ada Lovelace", email: "ada@account.io" });
    gitIpc.getGitEmail.mockResolvedValue({
      global: "g@x.io",
      globalName: "Global Name",
      project: null,
      projectName: null,
    });
    const h = render(props);
    await settle();
    accountBox(h).click();
    flushSync();
    ok(h).click();
    await settle();
    expect(gitIpc.setGitName).toHaveBeenCalledWith(
      "project",
      "/r",
      "Ada Lovelace",
    );
    expect(gitIpc.setGitEmail).toHaveBeenCalledWith(
      "project",
      "/r",
      "ada@account.io",
    );
    // …and NOT to the global level, which the toggle must leave alone.
    expect(gitIpc.setGitName).not.toHaveBeenCalledWith(
      "global",
      "/r",
      "Ada Lovelace",
    );
    expect(gitIpc.setGitEmail).not.toHaveBeenCalledWith(
      "global",
      "/r",
      "ada@account.io",
    );
  });

  it("overwrites a project identity that already differs", async () => {
    signIn({ name: "Ada Lovelace", email: "ada@account.io" });
    gitIpc.getGitEmail.mockResolvedValue({
      global: "g@x.io",
      globalName: "Global Name",
      project: "old@x.io",
      projectName: "Old Name",
    });
    const h = render(props);
    await settle();
    accountBox(h).click();
    flushSync();
    ok(h).click();
    await settle();
    expect(gitIpc.setGitEmail).toHaveBeenCalledWith(
      "project",
      "/r",
      "ada@account.io",
    );
  });

  it("writes nothing when the toggle is flipped and then cancelled", async () => {
    signIn({ name: "Ada Lovelace", email: "ada@account.io" });
    gitIpc.getGitEmail.mockResolvedValue({
      global: "g@x.io",
      globalName: "Global Name",
      project: null,
      projectName: null,
    });
    const h = render(props);
    await settle();
    accountBox(h).click();
    flushSync();
    cancel(h).click();
    await settle();
    expect(gitIpc.setGitName).not.toHaveBeenCalled();
    expect(gitIpc.setGitEmail).not.toHaveBeenCalled();
  });

  it("is unavailable, with a reason, when signed out", async () => {
    gitIpc.getGitEmail.mockResolvedValue({ global: "g@x.io", project: null });
    const h = render(props);
    await settle();
    expect(accountBox(h).disabled).toBe(true);
    expect(
      h
        .querySelector('[data-field="git-identity-account-reason"]')
        ?.textContent?.trim(),
    ).toBeTruthy();
  });

  it("is unavailable with an account that has no email", async () => {
    signIn({ name: "Ada Lovelace" });
    gitIpc.getGitEmail.mockResolvedValue({ global: "g@x.io", project: null });
    const h = render(props);
    await settle();
    expect(accountBox(h).disabled).toBe(true);
  });

  it("is unavailable without an open repo (it writes the project level)", async () => {
    signIn({ name: "Ada Lovelace", email: "ada@account.io" });
    gitIpc.getGitEmail.mockResolvedValue({ global: "g@x.io", project: null });
    const h = render();
    await settle();
    expect(accountBox(h).disabled).toBe(true);
  });

  it("placeholders follow the resolution chain across both toggles", async () => {
    signIn({ name: "Ada Lovelace", email: "ada@account.io" });
    gitIpc.getGitEmail.mockResolvedValue({
      global: "g@x.io",
      globalName: "Global Name",
      project: "p@x.io",
      projectName: "Project Name",
    });
    const h = render(props);
    await settle();
    // Loaded with a project identity ⇒ project scope: next level is global.
    expect(email(h).placeholder).toBe("g@x.io");
    expect(name(h).placeholder).toBe("Global Name");
    // Account identity on ⇒ next level is the project value.
    accountBox(h).click();
    flushSync();
    expect(email(h).placeholder).toBe("p@x.io");
    expect(name(h).placeholder).toBe("Project Name");
  });

  it("falls back to the account address once both git scopes are off", async () => {
    signIn({ name: "Ada Lovelace", email: "ada@account.io" });
    gitIpc.getGitEmail.mockResolvedValue({
      global: "g@x.io",
      globalName: "Global Name",
      project: null,
      projectName: null,
    });
    const h = render(props);
    await settle();
    // Global scope: the next level down is git-core's account fallback.
    expect(email(h).placeholder).toBe("ada@account.io");
    expect(name(h).placeholder).toBe("Ada Lovelace");
  });

  it("still writes the email when the name write throws synchronously", async () => {
    // The resilience contract: "log and carry on" must survive a SYNCHRONOUS
    // throw, not just a rejection — one failing write cannot cancel the rest.
    gitIpc.getGitEmail.mockResolvedValue({ global: "g@x.io", project: null });
    gitIpc.setGitName.mockImplementation(() => {
      throw new Error("boom");
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = render(props);
    await settle();
    name(h).value = "New Name";
    name(h).dispatchEvent(new Event("input", { bubbles: true }));
    email(h).value = "new@x.io";
    email(h).dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    ok(h).click();
    await settle();
    expect(gitIpc.setGitEmail).toHaveBeenCalledWith("global", "/r", "new@x.io");
    spy.mockRestore();
  });

  it("never logs the account address", async () => {
    signIn({ name: "Ada Lovelace", email: "ada@account.io" });
    gitIpc.getGitEmail.mockResolvedValue({ global: "g@x.io", project: null });
    gitIpc.setGitEmail.mockRejectedValue(new Error("write refused"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = render(props);
    await settle();
    accountBox(h).click();
    flushSync();
    ok(h).click();
    await settle();
    const logged = spy.mock.calls.flat().map(String).join(" ");
    expect(logged).not.toContain("ada@account.io");
    spy.mockRestore();
  });
});

describe("SettingsModal — guided-tutorial hooks", () => {
  /** Step 22 spotlights the panel container, so it must follow the tab. */

  it("can open straight on Personalize (the tutorial's step 22)", () => {
    const h = render({ initialTab: "Personalize" });
    expect(
      h.querySelector('[data-tutorial="settings-panel-Personalize"]'),
    ).not.toBeNull();
    expect(
      h.querySelector('[data-tutorial="settings-panel-General"]'),
    ).toBeNull();
  });

  const backdrop = (h: HTMLDivElement) =>
    h.parentElement!.querySelector<HTMLElement>(".backdrop")!;
  const cancelBtn = (h: HTMLDivElement) =>
    [...h.querySelectorAll<HTMLButtonElement>(".btn")].find(
      (b) => b.textContent?.trim() === "Cancel",
    )!;

  it("a tab switch asks the guard, then reports settingsTabOpened", () => {
    const guard = vi.fn(() => true);
    const events: TutorialEvent[] = [];
    const h = render({ guard, onTutorialEvent: (e) => events.push(e) });
    tab(h, "Personalize").click();
    flushSync();
    expect(guard).toHaveBeenCalledWith({
      kind: "settingsTab",
      tab: "Personalize",
    });
    expect(h.querySelector("h2")?.textContent).toBe("Personalize");
    expect(events).toEqual([{ kind: "settingsTabOpened", tab: "Personalize" }]);
  });

  it("a refused tab switch stays put and reports nothing", () => {
    const events: TutorialEvent[] = [];
    const h = render({
      guard: () => false,
      onTutorialEvent: (e) => events.push(e),
    });
    tab(h, "Personalize").click();
    flushSync();
    expect(h.querySelector("h2")?.textContent).toBe("General");
    expect(events).toEqual([]);
  });

  it("a refused OK saves nothing and keeps the modal open", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    const events: TutorialEvent[] = [];
    const guard = vi.fn(() => false);
    const h = render({
      guard,
      onSave,
      onClose,
      onTutorialEvent: (e) => events.push(e),
    });
    ok(h).click();
    expect(guard).toHaveBeenCalledWith({ kind: "saveSettings" });
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("a refused Cancel and a refused backdrop click both keep the modal open", () => {
    const onClose = vi.fn();
    const guard = vi.fn(() => false);
    const h = render({ guard, onClose });
    cancelBtn(h).click();
    backdrop(h).click();
    expect(guard).toHaveBeenCalledTimes(2);
    expect(guard).toHaveBeenNthCalledWith(1, { kind: "closeSettings" });
    expect(guard).toHaveBeenNthCalledWith(2, { kind: "closeSettings" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("an allowed Cancel / backdrop click closes (without a settingsSaved event)", () => {
    const onClose = vi.fn();
    const events: TutorialEvent[] = [];
    const h = render({
      guard: () => true,
      onClose,
      onTutorialEvent: (e) => events.push(e),
    });
    cancelBtn(h).click();
    backdrop(h).click();
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(events).toEqual([]);
  });

  it("OK reports settingsSaved{themeChanged:false} when the theme is untouched", () => {
    const onSave = vi.fn();
    const events: TutorialEvent[] = [];
    const h = render({
      guard: () => true,
      onSave,
      onTutorialEvent: (e) => events.push(e),
    });
    ok(h).click();
    expect(onSave).toHaveBeenCalledOnce();
    expect(events).toEqual([{ kind: "settingsSaved", themeChanged: false }]);
  });

  it("with a repo open, themeChanged compares against the repo's own theme", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.personalize.graphTheme = "synthwave";
    const events: TutorialEvent[] = [];
    const h = render({
      settings,
      repoPath: "/repo",
      projectGeneral: { ...DEFAULT_SETTINGS.general },
      // The repo's theme differs from the global one, but that is what the
      // modal OPENED with, so saving it untouched is not a theme change.
      projectPersonalize: {
        ...DEFAULT_SETTINGS.personalize,
        graphTheme: "blueprint",
      },
      projectLogAnytime: { ...DEFAULT_SETTINGS.logAnytime },
      onTutorialEvent: (e) => events.push(e),
    });
    ok(h).click();
    expect(events).toEqual([{ kind: "settingsSaved", themeChanged: false }]);
  });

  it("without the props nothing is gated or reported (regression)", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    const h = render({ onSave, onClose });
    tab(h, "Personalize").click();
    flushSync();
    expect(h.querySelector("h2")?.textContent).toBe("Personalize");
    ok(h).click();
    expect(onSave).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
