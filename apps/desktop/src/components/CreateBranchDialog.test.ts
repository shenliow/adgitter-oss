import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync, type ComponentProps } from "svelte";
import CreateBranchDialog from "./CreateBranchDialog.svelte";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
});

function render(over: Partial<ComponentProps<typeof CreateBranchDialog>> = {}) {
  const props: ComponentProps<typeof CreateBranchDialog> = {
    from: "abc1234",
    onCreate: async () => {},
    onCancel: () => {},
    ...over,
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(CreateBranchDialog, { target: host, props });
  flushSync();
  return host;
}

const byText = (h: HTMLDivElement, t: string) =>
  [...h.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === t,
  )!;

function typeName(h: HTMLDivElement, value: string) {
  const input = h.querySelector<HTMLInputElement>("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
  return input;
}

const settle = async () => {
  await new Promise((r) => setTimeout(r, 0));
  flushSync();
};

describe("CreateBranchDialog", () => {
  it("shows the starting point and disables Create while the name is empty", () => {
    const h = render();
    expect(h.textContent).toContain("abc1234");
    expect(byText(h, "Create").disabled).toBe(true);
    typeName(h, "feature/x");
    expect(byText(h, "Create").disabled).toBe(false);
  });

  it("Create calls onCreate with the trimmed name", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const h = render({ onCreate });
    typeName(h, "  feature/x  ");
    byText(h, "Create").click();
    await settle();
    expect(onCreate).toHaveBeenCalledWith("feature/x");
  });

  it("Enter in the input submits", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const h = render({ onCreate });
    const input = typeName(h, "feature/y");
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await settle();
    expect(onCreate).toHaveBeenCalledWith("feature/y");
  });

  it("cancels on Escape and on Cancel without creating", () => {
    const onCancel = vi.fn();
    const onCreate = vi.fn();
    const h = render({ onCancel, onCreate });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    byText(h, "Cancel").click();
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("a rejected onCreate shows an inline error and stays open", async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error("name taken"));
    const h = render({ onCreate });
    typeName(h, "dupe");
    byText(h, "Create").click();
    await settle();
    const alert = h.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("name taken");
    expect(h.querySelector("input")).not.toBeNull();
  });
});
