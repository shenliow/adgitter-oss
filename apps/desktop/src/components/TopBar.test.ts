import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync, type ComponentProps } from "svelte";
import TopBar from "./TopBar.svelte";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
});

function render(props: ComponentProps<typeof TopBar> = {}): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(TopBar, { target: host, props });
  flushSync();
  return host;
}

describe("TopBar back + repo name (merged button)", () => {
  it("calls onBack when the merged back-repo button is clicked", () => {
    const onBack = vi.fn();
    const h = render({ repoName: "adgitter", onBack });
    const btn = h.querySelector<HTMLButtonElement>(".back-repo")!;
    btn.click();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("renders the repo name text inside the same back-repo button", () => {
    const h = render({ repoName: "my-long-repository-name" });
    const btn = h.querySelector<HTMLButtonElement>(".back-repo")!;
    expect(btn.textContent).toContain("my-long-repository-name");
  });
});
