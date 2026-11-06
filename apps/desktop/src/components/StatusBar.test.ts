import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mount, unmount, flushSync, type ComponentProps } from "svelte";
import StatusBar from "./StatusBar.svelte";
import { setLocale } from "../lib/i18n/index.svelte";
import fs from "node:fs";
import path from "node:path";

// The bar reads the project-config store directly (no prop), so drive that
// store through a mocked IPC layer.
const readProjectConfig = vi.fn<() => Promise<string | null>>();
const quarantineProjectConfig = vi.fn<() => Promise<string | null>>();
vi.mock("../lib/ipc", () => ({
  readProjectConfig: (...a: unknown[]) =>
    (readProjectConfig as (...a: unknown[]) => Promise<string | null>)(...a),
  writeProjectConfig: vi.fn(),
  quarantineProjectConfig: (...a: unknown[]) =>
    (quarantineProjectConfig as (...a: unknown[]) => Promise<string | null>)(
      ...a,
    ),
}));

import {
  loadProjectConfig,
  resetProjectConfig,
} from "../lib/projectConfig.svelte";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

beforeEach(() => {
  setLocale("en");
  readProjectConfig.mockReset();
  readProjectConfig.mockResolvedValue(null);
  quarantineProjectConfig.mockReset();
  quarantineProjectConfig.mockResolvedValue(null);
  resetProjectConfig();
});
afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
  setLocale("en");
  resetProjectConfig();
});

function render(over: Partial<ComponentProps<typeof StatusBar>> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(StatusBar, {
    target: host,
    props: { ...over },
  });
  flushSync();
  return host;
}

describe("StatusBar account status (Epic D)", () => {
  it("shows the signed-in user's email", () => {
    const h = render({ status: "signed-in", email: "ada@example.com" });
    expect(h.textContent).toContain("ada@example.com");
  });

  it("shows a dash for a signed-in user with no email, not the signed-out text", () => {
    const h = render({ status: "signed-in" });
    expect(h.textContent).toContain("—");
    expect(h.textContent).not.toContain("Not signed in");
  });

  it("shows 'Not signed in' when signed out", () => {
    const h = render({ status: "signed-out" });
    expect(h.textContent).toContain("Not signed in");
  });

  it("shows 'Signing in…' while signing in", () => {
    const h = render({ status: "signing-in" });
    expect(h.textContent).toContain("Signing in…");
  });

  it("never renders the old placeholder email, even with no props at all", () => {
    const h = render();
    expect(h.textContent).not.toContain("John.duo@example.com");
    expect(h.textContent).not.toContain("example.com");
  });

  it("never contains the old placeholder email in source", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "StatusBar.svelte"),
      "utf-8",
    );
    expect(src).not.toContain("John.duo@example.com");
  });

  it("still renders branch and ahead/behind counts when signed out", () => {
    const h = render({
      status: "signed-out",
      branch: "main",
      ahead: 2,
      behind: 3,
    });
    expect(h.textContent).toContain("main");
    expect(h.textContent).toContain("2");
    expect(h.textContent).toContain("3");
  });
});

describe("StatusBar unreadable-config warning", () => {
  const BACKUP = "adgitter.config.json.corrupt-1758800000.bak";

  it("says nothing when the repo's config loaded fine", async () => {
    readProjectConfig.mockResolvedValue(JSON.stringify({ branchColors: {} }));
    await loadProjectConfig("/repo");
    const h = render({ branch: "main" });
    expect(h.querySelector("[data-config-unreadable]")).toBeNull();
  });

  it("says nothing when the repo simply has no config file", async () => {
    readProjectConfig.mockResolvedValue(null);
    await loadProjectConfig("/repo");
    const h = render({ branch: "main" });
    expect(h.querySelector("[data-config-unreadable]")).toBeNull();
  });

  it("warns, and names the preserved copy, when the config is unreadable", async () => {
    // Valid JSON plus the four stray trailing bytes from the user report.
    readProjectConfig.mockResolvedValue(
      `${JSON.stringify({ branchColors: { main: "#ff0000" } }, null, 2)}\n  }\n}`,
    );
    quarantineProjectConfig.mockResolvedValue(BACKUP);
    await loadProjectConfig("/repo");

    const h = render({ branch: "main" });
    const warning = h.querySelector("[data-config-unreadable]");
    expect(warning).not.toBeNull();
    expect(warning?.getAttribute("role")).toBe("alert");
    expect(warning?.textContent).toContain("Repo settings unreadable");
    expect(warning?.getAttribute("title")).toContain(BACKUP);
  });

  it("warns that saves are blocked when the file could not even be copied aside", async () => {
    // A read that fails outright (over the cap / not UTF-8 / no permission)
    // AND a quarantine that fails too: the store refuses to save, so the hint
    // has to say that rather than point at a backup that does not exist.
    readProjectConfig.mockRejectedValue(new Error("Permission denied"));
    quarantineProjectConfig.mockRejectedValue(new Error("Permission denied"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await loadProjectConfig("/repo");
    spy.mockRestore();

    const h = render({ branch: "main" });
    const warning = h.querySelector("[data-config-unreadable]");
    expect(warning).not.toBeNull();
    expect(warning?.getAttribute("title")).toContain("NOT being saved");
  });
});

describe("StatusBar git provider (leftmost slot)", () => {
  const provider = (h: HTMLDivElement) =>
    h.querySelector("[data-provider]") as HTMLElement | null;

  it("names the provider of an HTTPS remote", () => {
    const h = render({ branch: "main", remoteUrl: "https://github.com/u/r" });
    expect(provider(h)?.textContent).toBe("GitHub");
  });

  it("names the provider of an scp-style SSH remote", () => {
    const h = render({ branch: "main", remoteUrl: "git@gitlab.com:u/r.git" });
    expect(provider(h)?.textContent).toBe("GitLab");
  });

  it("names Bitbucket too", () => {
    const h = render({
      branch: "main",
      remoteUrl: "https://bitbucket.org/u/r.git",
    });
    expect(provider(h)?.textContent).toBe("Bitbucket");
  });

  it("shows the bare host when the provider cannot be classified", () => {
    const h = render({ branch: "main", remoteUrl: "https://git.acme.com/u/r" });
    expect(provider(h)?.textContent).toBe("git.acme.com");
  });

  it("shows nothing when the repo has no remote", () => {
    const h = render({ branch: "main", remoteUrl: "" });
    expect(provider(h)).toBeNull();
  });

  it("shows nothing when no repo is open (no remote prop at all)", () => {
    const h = render({});
    expect(provider(h)).toBeNull();
  });

  it("keeps the branch icon next to the branch name", () => {
    const h = render({ branch: "main", remoteUrl: "https://github.com/u/r" });
    expect(h.querySelector(".branch .b-ico svg")).not.toBeNull();
  });
});
