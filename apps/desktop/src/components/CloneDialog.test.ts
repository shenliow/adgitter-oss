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
      auth: { kind: "none" },
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
      auth: { kind: "none" },
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

  describe("optional personal access token", () => {
    const toggle = (h: HTMLDivElement) =>
      h.querySelector(".pat-toggle") as HTMLButtonElement;
    const setPat = (h: HTMLDivElement, v: string) => {
      const el = h.querySelector("#cl-pat") as HTMLInputElement;
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      flushSync();
    };
    const expand = (h: HTMLDivElement) => {
      toggle(h).click();
      flushSync();
    };

    it("is collapsed by default behind an expandable toggle", () => {
      const h = render({ onConfirm: () => {}, onCancel: () => {} });
      expect(toggle(h).textContent).toContain(
        "Personal access token (optional)",
      );
      expect(toggle(h).getAttribute("aria-expanded")).toBe("false");
      expect(h.querySelector("#cl-pat")).toBeNull();

      expand(h);
      expect(toggle(h).getAttribute("aria-expanded")).toBe("true");
      const pat = h.querySelector("#cl-pat") as HTMLInputElement;
      expect(pat.type).toBe("password");
      expect(h.querySelector(".hint")?.textContent).toContain("Optional");

      expand(h); // click again → collapses
      expect(h.querySelector("#cl-pat")).toBeNull();
    });

    it("sends the PAT as password auth with the host's ceremonial username", () => {
      const onConfirm = vi.fn();
      const h = render({ onConfirm, onCancel: () => {} });
      setUrl(h, "https://github.com/u/r.git");
      expand(h);
      setPat(h, "  ghp_tok ");
      primary(h).click();
      expect(onConfirm.mock.calls[0][0].auth).toEqual({
        kind: "password",
        username: "x-access-token",
        password: "ghp_tok",
      });
    });

    it("picks the GitLab username for a gitlab host", () => {
      const onConfirm = vi.fn();
      const h = render({ onConfirm, onCancel: () => {} });
      setUrl(h, "https://gitlab.com/u/r.git");
      expand(h);
      setPat(h, "glpat-tok");
      primary(h).click();
      expect(onConfirm.mock.calls[0][0].auth).toEqual({
        kind: "password",
        username: "oauth2",
        password: "glpat-tok",
      });
    });

    it("an expanded but blank PAT clones anonymously", () => {
      const onConfirm = vi.fn();
      const h = render({ onConfirm, onCancel: () => {} });
      setUrl(h, "https://github.com/u/r.git");
      expand(h);
      setPat(h, "   ");
      primary(h).click();
      expect(onConfirm.mock.calls[0][0].auth).toEqual({ kind: "none" });
    });

    it("collapsing the section drops a typed token", () => {
      const onConfirm = vi.fn();
      const h = render({ onConfirm, onCancel: () => {} });
      setUrl(h, "https://github.com/u/r.git");
      expand(h);
      setPat(h, "ghp_tok");
      expand(h); // collapse
      primary(h).click();
      expect(onConfirm.mock.calls[0][0].auth).toEqual({ kind: "none" });
    });

    it("Enter in the PAT field confirms", () => {
      const onConfirm = vi.fn();
      const h = render({ onConfirm, onCancel: () => {} });
      setUrl(h, "https://github.com/u/r.git");
      expand(h);
      setPat(h, "ghp_tok");
      (h.querySelector("#cl-pat") as HTMLInputElement).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      expect(onConfirm).toHaveBeenCalledOnce();
    });
  });
});
