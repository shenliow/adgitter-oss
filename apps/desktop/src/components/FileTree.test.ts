import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import FileTree from "./FileTree.svelte";
import type { TreeNode } from "../lib/fileTree";

const nodes: TreeNode[] = [
  {
    type: "file",
    name: "app.ts",
    change: {
      path: "src/app.ts",
      status: "modified",
      old_path: null,
      insertions: 3,
      deletions: 1,
    },
  },
];

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
});

function render(props: Record<string, unknown>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(FileTree, { target: host, props: { nodes, ...props } });
  flushSync();
}

describe("FileTree — per-file history action", () => {
  it("shows a history button and fires onHistory with the path", () => {
    const onHistory = vi.fn();
    render({ onOpen: () => {}, onHistory });
    const hist = host.querySelector<HTMLButtonElement>("button.hist");
    expect(hist).not.toBeNull();
    hist!.click();
    expect(onHistory).toHaveBeenCalledWith("src/app.ts");
  });

  it("omits the history button when onHistory is not provided", () => {
    render({ onOpen: () => {} });
    expect(host.querySelector("button.hist")).toBeNull();
  });
});

describe("FileTree — three-icon file-row actions (commit-file-actions)", () => {
  it("shows a diff button that fires onOpen (same handler as the name click)", () => {
    const onOpen = vi.fn();
    render({ onOpen });
    const diff = host.querySelector<HTMLButtonElement>("button.act.diff");
    expect(diff).not.toBeNull();
    expect(diff!.getAttribute("aria-label")).toBeTruthy();
    diff!.click();
    expect(onOpen).toHaveBeenCalledWith("src/app.ts");
  });

  it("clicking the file name still opens the diff (unchanged behaviour)", () => {
    const onOpen = vi.fn();
    render({ onOpen });
    host.querySelector<HTMLButtonElement>("button.file.clickable")!.click();
    expect(onOpen).toHaveBeenCalledWith("src/app.ts");
  });

  it("shows an open-in-editor button that fires onOpenFile and NOT onOpen", () => {
    const onOpen = vi.fn();
    const onOpenFile = vi.fn();
    render({ onOpen, onOpenFile });
    const open = host.querySelector<HTMLButtonElement>("button.act.openfile");
    expect(open).not.toBeNull();
    expect(open!.getAttribute("aria-label")).toBeTruthy();
    open!.click();
    expect(onOpenFile).toHaveBeenCalledWith("src/app.ts");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("omits the open-in-editor button when onOpenFile is not provided", () => {
    render({ onOpen: () => {} });
    expect(host.querySelector("button.act.openfile")).toBeNull();
  });

  it("shows a purge button that fires onPurge with the path", () => {
    const onOpen = vi.fn();
    const onPurge = vi.fn();
    render({ onOpen, onPurge });
    const purge = host.querySelector<HTMLButtonElement>("button.act.purge");
    expect(purge).not.toBeNull();
    expect(purge!.getAttribute("aria-label")).toBeTruthy();
    purge!.click();
    expect(onPurge).toHaveBeenCalledWith("src/app.ts");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("omits the purge button when onPurge is not provided", () => {
    render({ onOpen: () => {} });
    expect(host.querySelector("button.act.purge")).toBeNull();
  });

  it("every action button is a focusable, keyboard-reachable <button>", () => {
    render({
      onOpen: () => {},
      onOpenFile: () => {},
      onHistory: () => {},
      onPurge: () => {},
    });
    for (const cls of [".diff", ".openfile", ".hist", ".purge"]) {
      const btn = host.querySelector<HTMLButtonElement>(`button.act${cls}`);
      expect(btn, `expected button.act${cls} to render`).not.toBeNull();
      expect(btn!.tagName).toBe("BUTTON");
      expect(btn!.disabled).toBe(false);
    }
  });
});
