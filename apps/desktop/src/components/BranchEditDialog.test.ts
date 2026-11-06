import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync, type ComponentProps } from "svelte";
import BranchEditDialog from "./BranchEditDialog.svelte";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
});

function render(over: Partial<ComponentProps<typeof BranchEditDialog>> = {}) {
  const props: ComponentProps<typeof BranchEditDialog> = {
    branch: "feature",
    initial: "#ffbb00",
    onConfirm: () => {},
    onReset: () => {},
    onCancel: () => {},
    ...over,
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(BranchEditDialog, { target: host, props });
  flushSync();
  return host;
}

const byText = (h: HTMLDivElement, t: string) =>
  [...h.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === t,
  )!;

describe("BranchEditDialog", () => {
  it("shows the branch name (editable) and seeded hex", () => {
    const h = render();
    expect(h.querySelector<HTMLInputElement>("input.name-input")?.value).toBe(
      "feature",
    );
    expect(h.querySelector("code.val")?.textContent?.toLowerCase()).toBe(
      "#ffbb00",
    );
  });

  it("Confirm passes the (unchanged) name, hex, and null upstream", () => {
    const onConfirm = vi.fn();
    const h = render({ onConfirm });
    byText(h, "Confirm").click();
    expect(onConfirm).toHaveBeenCalledWith("feature", "#ffbb00", null);
  });

  it("Confirm passes an edited name", () => {
    const onConfirm = vi.fn();
    const h = render({ onConfirm });
    const input = h.querySelector<HTMLInputElement>("input.name-input")!;
    input.value = "renamed";
    input.dispatchEvent(new Event("input"));
    flushSync();
    byText(h, "Confirm").click();
    expect(onConfirm).toHaveBeenCalledWith("renamed", "#ffbb00", null);
  });

  it("disables Confirm when the name is emptied", () => {
    const onConfirm = vi.fn();
    const h = render({ onConfirm });
    const input = h.querySelector<HTMLInputElement>("input.name-input")!;
    input.value = "   ";
    input.dispatchEvent(new Event("input"));
    flushSync();
    expect(byText(h, "Confirm").disabled).toBe(true);
    byText(h, "Confirm").click();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Reset fires onReset", () => {
    const onReset = vi.fn();
    const h = render({ onReset });
    byText(h, "Reset").click();
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("cancels on Escape and on Cancel", () => {
    const onCancel = vi.fn();
    const h = render({ onCancel });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    byText(h, "Cancel").click();
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  describe("upstream", () => {
    const upSelect = (h: HTMLDivElement) =>
      h.querySelector<HTMLSelectElement>("select.up-input")!;

    it("seeds the select from the current upstream and lists the remotes", () => {
      const h = render({
        upstream: "origin/feature",
        remotes: ["origin/main", "origin/feature"],
      });
      expect(upSelect(h).value).toBe("origin/feature");
      const opts = [...upSelect(h).options].map((o) => o.value);
      expect(opts).toEqual(["", "origin/main", "origin/feature"]);
    });

    it("keeps a current upstream that's no longer among the remotes", () => {
      const h = render({ upstream: "origin/gone", remotes: ["origin/main"] });
      const opts = [...upSelect(h).options].map((o) => o.value);
      expect(opts).toContain("origin/gone");
      expect(upSelect(h).value).toBe("origin/gone");
    });

    it("Confirm passes the chosen upstream", () => {
      const onConfirm = vi.fn();
      const h = render({ onConfirm, remotes: ["origin/main"] });
      const sel = upSelect(h);
      sel.value = "origin/main";
      sel.dispatchEvent(new Event("change"));
      flushSync();
      byText(h, "Confirm").click();
      expect(onConfirm).toHaveBeenCalledWith(
        "feature",
        "#ffbb00",
        "origin/main",
      );
    });

    it("Confirm passes null when '(none)' is chosen", () => {
      const onConfirm = vi.fn();
      const h = render({
        onConfirm,
        upstream: "origin/main",
        remotes: ["origin/main"],
      });
      const sel = upSelect(h);
      sel.value = "";
      sel.dispatchEvent(new Event("change"));
      flushSync();
      byText(h, "Confirm").click();
      expect(onConfirm).toHaveBeenCalledWith("feature", "#ffbb00", null);
    });
  });
});
