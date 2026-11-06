import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync, type ComponentProps } from "svelte";
import ConfirmDialog from "./ConfirmDialog.svelte";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
});

function render(props: ComponentProps<typeof ConfirmDialog>): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(ConfirmDialog, { target: host, props });
  flushSync();
  return host;
}

describe("ConfirmDialog", () => {
  it("renders title/body and confirm/cancel labels", () => {
    const h = render({
      title: "Open it?",
      body: "contains a repo",
      confirmLabel: "Open",
      onConfirm: () => {},
      onCancel: () => {},
    });
    expect(h.querySelector(".title")?.textContent).toBe("Open it?");
    expect(h.querySelector(".body")?.textContent).toContain("contains a repo");
    expect(h.querySelector(".primary")?.textContent?.trim()).toBe("Open");
  });

  it("fires onConfirm and onCancel from the buttons", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const h = render({ title: "X", onConfirm, onCancel });
    (h.querySelector(".primary") as HTMLButtonElement).click();
    (h.querySelector(".ghost") as HTMLButtonElement).click();
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("confirms on Enter and cancels on Escape", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render({ title: "X", onConfirm, onCancel });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("disables both buttons while busy", () => {
    const h = render({
      title: "X",
      busy: true,
      onConfirm: () => {},
      onCancel: () => {},
    });
    expect((h.querySelector(".primary") as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((h.querySelector(".ghost") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe("ConfirmDialog — optional third outcome", () => {
  it("renders exactly two buttons when no onSkip is given", () => {
    const h = render({ title: "X", onConfirm: () => {}, onCancel: () => {} });
    expect(h.querySelectorAll("button:not(.scrim)")).toHaveLength(2);
    expect(h.querySelectorAll(".ghost")).toHaveLength(1);
  });

  it("adds a third, labelled button when onSkip is given", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const onSkip = vi.fn();
    const h = render({
      title: "X",
      confirmLabel: "Pull",
      cancelLabel: "Cancel",
      skipLabel: "Not now",
      onConfirm,
      onCancel,
      onSkip,
    });
    const labels = [
      ...h.querySelectorAll<HTMLButtonElement>("button:not(.scrim)"),
    ].map((b) => b.textContent?.trim());
    expect(labels).toEqual(["Cancel", "Not now", "Pull"]);
    const skip = [...h.querySelectorAll<HTMLButtonElement>(".ghost")].find(
      (b) => b.textContent?.trim() === "Not now",
    )!;
    skip.click();
    expect(onSkip).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("disables the third button while busy too", () => {
    const h = render({
      title: "X",
      skipLabel: "Not now",
      busy: true,
      onConfirm: () => {},
      onCancel: () => {},
      onSkip: () => {},
    });
    expect(
      [...h.querySelectorAll<HTMLButtonElement>("button:not(.scrim)")].map(
        (b) => b.disabled,
      ),
    ).toEqual([true, true, true]);
  });

  it("keeps Enter on confirm and Escape on cancel, never on skip", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const onSkip = vi.fn();
    render({ title: "X", onConfirm, onCancel, onSkip });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSkip).not.toHaveBeenCalled();
  });
});
