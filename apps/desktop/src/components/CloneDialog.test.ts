import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync, type ComponentProps } from "svelte";
import CloneDialog from "./CloneDialog.svelte";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
});

function render(props: ComponentProps<typeof CloneDialog>): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(CloneDialog, { target: host, props });
  flushSync();
  return host;
}

const primary = (h: HTMLDivElement) =>
  h.querySelector(".primary") as HTMLButtonElement;
const setUrl = (h: HTMLDivElement, v: string) => {
  const el = h.querySelector("#cl-url") as HTMLInputElement;
  el.value = v;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
};

describe("CloneDialog", () => {
  it("asks only for a Remote URL and a 'Clone recursively' checkbox", () => {
    const h = render({ onConfirm: () => {}, onCancel: () => {} });
    expect(h.querySelector("#cl-url")).not.toBeNull();
    const box = h.querySelector("#cl-recursive") as HTMLInputElement;
    expect(box.type).toBe("checkbox");
    expect(box.checked).toBe(false);
    expect(h.textContent).toContain("Remote URL");
    expect(h.textContent).toContain("Clone recursively");
    // No destination / label / credential fields — the folder comes from the
    // native picker after confirm.
    expect(h.querySelector("#cl-dest")).toBeNull();
    expect(h.querySelector("#cl-label")).toBeNull();
    expect(h.querySelector("#cl-pat")).toBeNull();
  });

  it("Confirm is disabled until a url is entered", () => {
    const h = render({ onConfirm: () => {}, onCancel: () => {} });
    expect(primary(h).disabled).toBe(true);
    setUrl(h, "   ");
    expect(primary(h).disabled).toBe(true);
    setUrl(h, "https://x/y.git");
    expect(primary(h).disabled).toBe(false);
  });

  it("confirms with the trimmed url and recursive=false by default", () => {
    const onConfirm = vi.fn();
    const h = render({ onConfirm, onCancel: () => {} });
    setUrl(h, "  https://github.com/u/r.git ");
    primary(h).click();
    expect(onConfirm).toHaveBeenCalledWith({
      url: "https://github.com/u/r.git",
      recursive: false,
    });
  });

  it("forwards recursive=true when the box is ticked", () => {
    const onConfirm = vi.fn();
    const h = render({ onConfirm, onCancel: () => {} });
    setUrl(h, "git@github.com:u/r.git");
    (h.querySelector("#cl-recursive") as HTMLInputElement).click();
    flushSync();
    primary(h).click();
    expect(onConfirm).toHaveBeenCalledWith({
      url: "git@github.com:u/r.git",
      recursive: true,
    });
  });

  it("Enter in the url field confirms", () => {
    const onConfirm = vi.fn();
    const h = render({ onConfirm, onCancel: () => {} });
    setUrl(h, "https://x/y.git");
    (h.querySelector("#cl-url") as HTMLInputElement).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("shows a progress bar while busy and locks the inputs", () => {
    const onCancel = vi.fn();
    const h = render({
      busy: true,
      progress: { received: 5, total: 10 },
      onConfirm: () => {},
      onCancel,
    });
    expect(h.querySelector(".progress")).not.toBeNull();
    expect(h.textContent).toContain("50%");
    expect(primary(h).disabled).toBe(true);
    expect((h.querySelector("#cl-url") as HTMLInputElement).disabled).toBe(
      true,
    );
    (h.querySelector(".scrim") as HTMLButtonElement).click();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
