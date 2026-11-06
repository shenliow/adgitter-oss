import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync, type ComponentProps } from "svelte";
import OpenOrCreateDialog from "./OpenOrCreateDialog.svelte";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
});

function render(
  props: ComponentProps<typeof OpenOrCreateDialog>,
): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(OpenOrCreateDialog, { target: host, props });
  flushSync();
  return host;
}

const primary = (h: HTMLDivElement) =>
  h.querySelector(".primary") as HTMLButtonElement;
const input = (h: HTMLDivElement) =>
  h.querySelector("input") as HTMLInputElement;

describe("OpenOrCreateDialog", () => {
  it("confirm is disabled until a path is entered", () => {
    const h = render({
      onBrowse: async () => null,
      onConfirm: () => {},
      onCancel: () => {},
    });
    expect(primary(h).disabled).toBe(true);
    input(h).value = "/repo";
    input(h).dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(primary(h).disabled).toBe(false);
  });

  it("browse fills the path field from the picker", async () => {
    const onBrowse = vi.fn(async () => "/picked/path");
    const h = render({ onBrowse, onConfirm: () => {}, onCancel: () => {} });
    (h.querySelector(".browse") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
    expect(input(h).value).toBe("/picked/path");
  });

  it("confirm passes the trimmed path", () => {
    const onConfirm = vi.fn();
    const h = render({
      onBrowse: async () => null,
      onConfirm,
      onCancel: () => {},
    });
    input(h).value = "  /repo  ";
    input(h).dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    primary(h).click();
    expect(onConfirm).toHaveBeenCalledWith("/repo");
  });

  it("shows the clone link only when onClone is provided", () => {
    const h1 = render({
      onBrowse: async () => null,
      onConfirm: () => {},
      onCancel: () => {},
    });
    expect(h1.querySelector(".link")).toBeNull();
    unmount(app);
    host.remove();

    const h2 = render({
      onBrowse: async () => null,
      onConfirm: () => {},
      onCancel: () => {},
      onClone: () => {},
    });
    expect(h2.querySelector(".link")).not.toBeNull();
  });

  it("cancels on Escape", () => {
    const onCancel = vi.fn();
    render({ onBrowse: async () => null, onConfirm: () => {}, onCancel });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
