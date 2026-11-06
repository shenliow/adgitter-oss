import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mount, unmount, flushSync, type ComponentProps } from "svelte";
import FirstUseGuide from "./FirstUseGuide.svelte";
import { setLocale } from "../../lib/i18n/index.svelte";

const { openExternalUrl } = vi.hoisted(() => ({
  openExternalUrl: vi.fn(),
}));
vi.mock("../../lib/ipc", () => ({ openExternalUrl }));

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

beforeEach(() => {
  setLocale("en");
  openExternalUrl.mockReset();
  openExternalUrl.mockResolvedValue(undefined);
});
afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
  setLocale("en");
});

function render(
  props: Partial<ComponentProps<typeof FirstUseGuide>> = {},
): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(FirstUseGuide, {
    target: host,
    props: { onClose: () => {}, ...props },
  });
  flushSync();
  return host;
}

const q = (h: HTMLElement, sel: string) => h.querySelector(sel) as HTMLElement;
const qa = (h: HTMLElement, sel: string) =>
  [...h.querySelectorAll(sel)] as HTMLElement[];
const click = (el: HTMLElement) => {
  el.click();
  flushSync();
};
const next = (h: HTMLElement) => click(q(h, "button.next"));
const title = (h: HTMLElement) => q(h, ".title").textContent;

describe("FirstUseGuide", () => {
  it("is a modal dialog with four pages", () => {
    const h = render();
    expect(q(h, '[role="dialog"]').getAttribute("aria-modal")).toBe("true");
    expect(qa(h, ".dot")).toHaveLength(4);
    expect(q(h, ".dots").getAttribute("aria-label")).toBe("Page 1 of 4");
  });

  it("page 1: create an empty repo or open an existing one", () => {
    const h = render();
    expect(title(h)).toBe("Start with a repository");
    const text = q(h, ".content").textContent!;
    expect(text).toContain("Create an empty repository");
    expect(text).toContain("Open an existing repository");
    expect(text).toContain("New / Open");
    expect(q(h, "button.back")).toBeNull();
  });

  it("page 2: connect a remote via clone or Settings → General", () => {
    const h = render();
    next(h);
    expect(title(h)).toBe("Connect a remote");
    const text = q(h, ".content").textContent!;
    expect(text).toContain("Clone a remote repository");
    expect(text).toContain("Settings → General → Remote & authentication");
    expect(text).toContain("SSH");
  });

  it("each provider shows its required access and creation steps", () => {
    const h = render();
    next(h);
    next(h);
    const github = q(h, '[data-provider="git-github"]');
    expect(github.querySelector(".p-scopes")!.textContent).toContain(
      "Contents: Read and write",
    );
    expect(
      github.querySelectorAll(".p-steps li").length,
    ).toBeGreaterThanOrEqual(3);
    const azure = q(h, '[data-provider="git-azure"]');
    expect(azure.querySelector(".p-scopes")!.textContent).toContain(
      "Code: Read & write",
    );
  });

  it("a git provider's button opens its token page in the system browser", () => {
    const h = render();
    next(h);
    next(h);
    click(q(h, '[data-provider="git-github"] button.open'));
    expect(openExternalUrl).toHaveBeenCalledTimes(1);
    expect(openExternalUrl).toHaveBeenCalledWith(
      "https://github.com/settings/tokens",
    );
    click(q(h, '[data-provider="git-azure"] button.open'));
    expect(openExternalUrl).toHaveBeenLastCalledWith(
      "https://dev.azure.com/_usersSettings/tokens",
    );
  });

  it("survives openExternalUrl rejecting", async () => {
    openExternalUrl.mockRejectedValue(new Error("no shell"));
    const h = render();
    next(h);
    next(h);
    click(q(h, '[data-provider="git-github"] button.open'));
    await Promise.resolve();
    expect(q(h, ".content")).not.toBeNull();
  });

  it("page 4 says you're all set and Close calls onClose", () => {
    const onClose = vi.fn();
    const h = render({ onClose });
    next(h);
    next(h);
    next(h);
    expect(title(h)).toBe("You are all set");
    expect(q(h, "button.next")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    click(q(h, "button.finish"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Back walks the pages in reverse", () => {
    const h = render();
    next(h);
    next(h);
    click(q(h, "button.back"));
    expect(title(h)).toBe("Connect a remote");
    click(q(h, "button.back"));
    expect(title(h)).toBe("Start with a repository");
    expect(q(h, "button.back")).toBeNull();
  });

  it("closes from the × button, the scrim, and Escape", () => {
    const onClose = vi.fn();
    const h = render({ onClose });
    click(q(h, "button.x"));
    click(q(h, ".scrim"));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
