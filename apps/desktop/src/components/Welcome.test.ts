import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync, type ComponentProps } from "svelte";
import Welcome from "./Welcome.svelte";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
});

function render(props: ComponentProps<typeof Welcome>): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(Welcome, { target: host, props });
  flushSync();
  return host;
}

const recents = [
  { path: "/a", name: "Project Ben", lastOpened: 2 },
  { path: "/b", name: "Project Alen", lastOpened: 1 },
];

describe("Welcome", () => {
  it("lists recents as avatars (initial + name) plus a New/Open tile", () => {
    const h = render({
      recents,
      onOpenRecent: () => {},
      onRemoveRecent: () => {},
      onNewOpen: () => {},
    });
    const labels = [...h.querySelectorAll(".label")].map((l) => l.textContent);
    expect(labels).toEqual(["Project Ben", "Project Alen", "New / Open"]);
    const avatars = h.querySelectorAll(".avatar");
    expect(avatars[0].textContent?.trim()).toBe("P"); // initial of "Project Ben"
  });

  it("greets the user when a name is given", () => {
    const h = render({
      userName: "John Duo",
      recents: [],
      onOpenRecent: () => {},
      onRemoveRecent: () => {},
      onNewOpen: () => {},
    });
    expect(h.querySelector("h1")?.textContent).toBe("Welcome John Duo");
  });

  it("opens a recent on click", () => {
    const onOpenRecent = vi.fn();
    const h = render({
      recents,
      onOpenRecent,
      onRemoveRecent: () => {},
      onNewOpen: () => {},
    });
    (h.querySelectorAll(".avatar")[0] as HTMLButtonElement).click();
    expect(onOpenRecent).toHaveBeenCalledWith(recents[0]);
  });

  it("removes a recent via its × button", () => {
    const onRemoveRecent = vi.fn();
    const h = render({
      recents,
      onOpenRecent: () => {},
      onRemoveRecent,
      onNewOpen: () => {},
    });
    (h.querySelectorAll(".remove")[1] as HTMLButtonElement).click();
    expect(onRemoveRecent).toHaveBeenCalledWith("/b");
  });

  it("fires onNewOpen from the + tile", () => {
    const onNewOpen = vi.fn();
    const h = render({
      recents,
      onOpenRecent: () => {},
      onRemoveRecent: () => {},
      onNewOpen,
    });
    (h.querySelector(".avatar.new") as HTMLButtonElement).click();
    expect(onNewOpen).toHaveBeenCalledOnce();
  });
});
