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
const setInput = (h: HTMLDivElement, id: string, v: string) => {
  const el = h.querySelector(`#${id}`) as HTMLInputElement;
  el.value = v;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("CloneDialog", () => {
  it("Create is disabled until url and location are set", () => {
    const h = render({
      onBrowse: async () => null,
      onClone: () => {},
      onCancel: () => {},
    });
    expect(primary(h).disabled).toBe(true);
    setInput(h, "cl-url", "https://x/y.git");
    setInput(h, "cl-dest", "/dest");
    flushSync();
    expect(primary(h).disabled).toBe(false);
  });

  it("clones with no auth when the PAT is blank; label falls back to repo name", () => {
    const onClone = vi.fn();
    const h = render({
      onBrowse: async () => null,
      onClone,
      onCancel: () => {},
    });
    setInput(h, "cl-url", "https://github.com/user/cool-repo.git");
    setInput(h, "cl-dest", "/dest");
    flushSync();
    primary(h).click();
    expect(onClone).toHaveBeenCalledWith({
      url: "https://github.com/user/cool-repo.git",
      dest: "/dest",
      label: "cool-repo",
      auth: { kind: "none" },
    });
  });

  it("sends the PAT as password auth with the host's ceremonial username", () => {
    const onClone = vi.fn();
    const h = render({
      onBrowse: async () => null,
      onClone,
      onCancel: () => {},
    });
    setInput(h, "cl-url", "https://github.com/u/r.git");
    setInput(h, "cl-dest", "/d");
    setInput(h, "cl-pat", "ghp_tok");
    flushSync();
    primary(h).click();
    expect(onClone.mock.calls[0][0].auth).toEqual({
      kind: "password",
      username: "x-access-token",
      password: "ghp_tok",
    });
  });

  it("picks the GitLab username for a gitlab host", () => {
    const onClone = vi.fn();
    const h = render({
      onBrowse: async () => null,
      onClone,
      onCancel: () => {},
    });
    setInput(h, "cl-url", "https://gitlab.com/u/r.git");
    setInput(h, "cl-dest", "/d");
    setInput(h, "cl-pat", "glpat-tok");
    flushSync();
    primary(h).click();
    expect(onClone.mock.calls[0][0].auth).toEqual({
      kind: "password",
      username: "oauth2",
      password: "glpat-tok",
    });
  });

  it("offers no username/password fields — PAT is the only credential", () => {
    const h = render({
      onBrowse: async () => null,
      onClone: () => {},
      onCancel: () => {},
    });
    expect(h.querySelector("#cl-user")).toBeNull();
    expect(h.querySelector("#cl-secret")).toBeNull();
    expect(h.querySelector("#cl-pat")).not.toBeNull();
  });

  it("shows a progress bar while busy", () => {
    const h = render({
      busy: true,
      progress: { received: 5, total: 10 },
      onBrowse: async () => null,
      onClone: () => {},
      onCancel: () => {},
    });
    expect(h.querySelector(".progress")).not.toBeNull();
    expect(h.textContent).toContain("50%");
    expect(primary(h).disabled).toBe(true);
  });
});
