import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync, type ComponentProps } from "svelte";
import CheckoutRemoteDialog from "./CheckoutRemoteDialog.svelte";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
});

function render(
  props: ComponentProps<typeof CheckoutRemoteDialog>,
): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(CheckoutRemoteDialog, { target: host, props });
  flushSync();
  return host;
}

const primary = (h: HTMLDivElement) =>
  h.querySelector(".primary") as HTMLButtonElement;
const nameInput = (h: HTMLDivElement) =>
  h.querySelector("#rc-name") as HTMLInputElement;
const setInput = (h: HTMLDivElement, v: string) => {
  const el = nameInput(h);
  el.value = v;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
};

describe("CheckoutRemoteDialog", () => {
  it("prefills the local-name input with suggestedLocal", () => {
    const h = render({
      remoteName: "origin/feature",
      suggestedLocal: "feature",
      onCreate: () => {},
      onDetached: () => {},
      onCancel: () => {},
    });
    expect(nameInput(h).value).toBe("feature");
  });

  it("disables the primary action when the name is empty or whitespace", () => {
    const h = render({
      remoteName: "origin/feature",
      suggestedLocal: "feature",
      onCreate: () => {},
      onDetached: () => {},
      onCancel: () => {},
    });
    expect(primary(h).disabled).toBe(false);

    setInput(h, "   ");
    expect(primary(h).disabled).toBe(true);

    setInput(h, "renamed");
    expect(primary(h).disabled).toBe(false);
  });

  it("clicking Create & checkout calls onCreate with the trimmed local name", () => {
    const onCreate = vi.fn();
    const h = render({
      remoteName: "origin/feature",
      suggestedLocal: "feature",
      onCreate,
      onDetached: () => {},
      onCancel: () => {},
    });
    setInput(h, "  my-feature  ");
    primary(h).click();
    expect(onCreate).toHaveBeenCalledWith("my-feature");
  });

  it("clicking Checkout detached calls onDetached, not onCreate", () => {
    const onCreate = vi.fn();
    const onDetached = vi.fn();
    const h = render({
      remoteName: "origin/feature",
      suggestedLocal: "feature",
      onCreate,
      onDetached,
      onCancel: () => {},
    });
    // The ghost actions are Cancel then Detached checkout, in that order.
    const ghosts = [
      ...h.querySelectorAll<HTMLButtonElement>(".actions .ghost"),
    ];
    expect(ghosts.length).toBe(2);
    ghosts[1].click();
    expect(onDetached).toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("Cancel calls onCancel and never onCreate/onDetached", () => {
    const onCreate = vi.fn();
    const onDetached = vi.fn();
    const onCancel = vi.fn();
    const h = render({
      remoteName: "origin/feature",
      suggestedLocal: "feature",
      onCreate,
      onDetached,
      onCancel,
    });
    const ghosts = [
      ...h.querySelectorAll<HTMLButtonElement>(".actions .ghost"),
    ];
    ghosts[0].click();
    expect(onCancel).toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
    expect(onDetached).not.toHaveBeenCalled();
  });

  it("Escape cancels", () => {
    const onCancel = vi.fn();
    render({
      remoteName: "origin/feature",
      suggestedLocal: "feature",
      onCreate: () => {},
      onDetached: () => {},
      onCancel,
    });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("Enter in the name input triggers the primary action when enabled", () => {
    const onCreate = vi.fn();
    const h = render({
      remoteName: "origin/feature",
      suggestedLocal: "feature",
      onCreate,
      onDetached: () => {},
      onCancel: () => {},
    });
    nameInput(h).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(onCreate).toHaveBeenCalledWith("feature");
  });

  it("Enter does nothing while the primary action is disabled (blank name)", () => {
    const onCreate = vi.fn();
    const h = render({
      remoteName: "origin/feature",
      suggestedLocal: "feature",
      onCreate,
      onDetached: () => {},
      onCancel: () => {},
    });
    setInput(h, "   ");
    nameInput(h).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(onCreate).not.toHaveBeenCalled();
  });
});
