/**
 * Welcome-screen entry points: "New / Open" goes straight to the native
 * folder picker (no intermediate dialog) and only asks before creating a repo
 * when the picked folder has none; "Clone from remote" asks for a URL +
 * recursive flag, then the folder picker, then clones right away.
 *
 * Drives the real App.svelte through the shared harness and asserts on IPC
 * calls and what's on screen.
 */
import { afterEach, describe, expect, it } from "vitest";
import { flushSync } from "svelte";
import {
  cleanupApp,
  dialogApi,
  ipc,
  mountApp,
  settle,
} from "./test/appHarness";
import { t } from "./lib/i18n/index.svelte";

afterEach(() => cleanupApp());

const welcome = (h: HTMLElement) => h.querySelector(".welcome");
const newOpenTile = (h: HTMLElement) =>
  h.querySelector(".avatar.new") as HTMLButtonElement;
const cloneLink = (h: HTMLElement) =>
  h.querySelector(".clone-link") as HTMLButtonElement;
const cloneDialog = (h: HTMLElement) =>
  h.querySelector(`[role="dialog"][aria-label="${t("clone.title")}"]`);
const createConfirm = (h: HTMLElement) =>
  [...h.querySelectorAll('[role="dialog"], [role="alertdialog"]')].find((d) =>
    d.textContent?.includes(t("confirm.createRepo")),
  ) ?? null;

async function mountWelcome(): Promise<HTMLElement> {
  return mountApp({ openRepo: false, recents: [] });
}

describe("Welcome → New / Open", () => {
  it("opens the native folder picker directly — no in-app dialog", async () => {
    const h = await mountWelcome();
    newOpenTile(h).click();
    await settle();
    expect(dialogApi.open).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
    });
    expect(h.querySelector('[role="dialog"]')).toBeNull();
  });

  it("opens a folder that already has git without asking", async () => {
    const h = await mountWelcome();
    dialogApi.open.mockResolvedValue("/work/proj");
    ipc.probePath.mockResolvedValue({ kind: "repo", path: "/work/proj" });
    newOpenTile(h).click();
    await settle();

    expect(ipc.probePath).toHaveBeenCalledWith("/work/proj");
    expect(createConfirm(h)).toBeNull();
    expect(ipc.initRepository).not.toHaveBeenCalled();
    expect(welcome(h)).toBeNull(); // repo workspace is showing
  });

  it("asks to create a new git repo when the folder has none, then inits + opens it", async () => {
    const h = await mountWelcome();
    dialogApi.open.mockResolvedValue("/work/plain");
    ipc.probePath.mockResolvedValue({ kind: "nonrepo", path: "/work/plain" });
    newOpenTile(h).click();
    await settle();

    const dlg = createConfirm(h);
    expect(dlg).not.toBeNull();
    expect(ipc.initRepository).not.toHaveBeenCalled();

    const create = [...dlg!.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === t("common.create"),
    )!;
    create.click();
    await settle(80);

    expect(ipc.initRepository).toHaveBeenCalledWith("/work/plain");
    expect(createConfirm(h)).toBeNull();
    expect(welcome(h)).toBeNull();
  });

  it("declining the create prompt stays on Welcome without touching disk", async () => {
    const h = await mountWelcome();
    dialogApi.open.mockResolvedValue("/work/empty");
    ipc.probePath.mockResolvedValue({ kind: "empty", path: "/work/empty" });
    newOpenTile(h).click();
    await settle();

    const cancel = [...createConfirm(h)!.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === t("common.cancel"),
    )!;
    cancel.click();
    await settle();

    expect(createConfirm(h)).toBeNull();
    expect(ipc.initRepository).not.toHaveBeenCalled();
    expect(welcome(h)).not.toBeNull();
  });

  it("does nothing when the picker is cancelled", async () => {
    const h = await mountWelcome();
    dialogApi.open.mockResolvedValue(null);
    newOpenTile(h).click();
    await settle();
    expect(ipc.probePath).not.toHaveBeenCalled();
    expect(welcome(h)).not.toBeNull();
  });
});

describe("Welcome → Clone from remote", () => {
  async function openCloneDialog(url: string, recursive: boolean) {
    const h = await mountWelcome();
    cloneLink(h).click();
    await settle();
    const dlg = cloneDialog(h)!;
    expect(dlg).not.toBeNull();
    const input = dlg.querySelector("#cl-url") as HTMLInputElement;
    input.value = url;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    if (recursive) (dlg.querySelector("#cl-recursive") as HTMLElement).click();
    flushSync();
    return { h, confirm: dlg.querySelector(".primary") as HTMLButtonElement };
  }

  it("confirm → folder picker → clones into <folder>/<repo-name> right away", async () => {
    const { h, confirm } = await openCloneDialog(
      "https://github.com/u/proj.git",
      true,
    );
    expect(dialogApi.open).not.toHaveBeenCalled();
    dialogApi.open.mockResolvedValue("/code");
    ipc.probePath.mockResolvedValue({ kind: "nonrepo", path: "/code" });
    confirm.click();
    await settle(80);

    expect(dialogApi.open).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
    });
    expect(ipc.cloneRepository).toHaveBeenCalledWith(
      "https://github.com/u/proj.git",
      "/code/proj",
      { kind: "none" },
      true,
    );
    expect(cloneDialog(h)).toBeNull();
    expect(welcome(h)).toBeNull();
  });

  it("clones straight into an empty picked folder, non-recursive by default", async () => {
    const { confirm } = await openCloneDialog(
      "git@github.com:u/proj.git",
      false,
    );
    dialogApi.open.mockResolvedValue("/code/mine");
    ipc.probePath.mockResolvedValue({ kind: "empty", path: "/code/mine" });
    confirm.click();
    await settle();

    expect(ipc.cloneRepository).toHaveBeenCalledWith(
      "git@github.com:u/proj.git",
      "/code/mine",
      { kind: "none" },
      false,
    );
  });

  it("cancelling the folder picker keeps the dialog (and URL) open", async () => {
    const { h, confirm } = await openCloneDialog("https://x/y.git", false);
    dialogApi.open.mockResolvedValue(null);
    confirm.click();
    await settle();

    expect(ipc.cloneRepository).not.toHaveBeenCalled();
    const dlg = cloneDialog(h)!;
    expect(dlg).not.toBeNull();
    expect((dlg.querySelector("#cl-url") as HTMLInputElement).value).toBe(
      "https://x/y.git",
    );
  });
});
