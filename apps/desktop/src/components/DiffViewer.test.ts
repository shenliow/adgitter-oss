import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync, type ComponentProps } from "svelte";
import DiffViewer from "./DiffViewer.svelte";
import type { FileDiff } from "../lib/ipc";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
});

function render(props: ComponentProps<typeof DiffViewer>): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(DiffViewer, { target: host, props });
  flushSync();
  return host;
}

const modified: FileDiff = {
  path: "a.txt",
  old_path: null,
  status: "modified",
  binary: false,
  hunks: [
    {
      old_start: 1,
      old_lines: 3,
      new_start: 1,
      new_lines: 3,
      header: "@@ -1,3 +1,3 @@\n",
      lines: [
        { origin: " ", old_lineno: 1, new_lineno: 1, content: "one\n" },
        { origin: "-", old_lineno: 2, new_lineno: null, content: "two\n" },
        { origin: "+", old_lineno: null, new_lineno: 2, content: "TWO\n" },
        { origin: " ", old_lineno: 3, new_lineno: 3, content: "three\n" },
      ],
    },
  ],
};

describe("DiffViewer", () => {
  it("pairs a modified line as deletion-left / addition-right", () => {
    const h = render({ title: "a.txt", diff: modified, onClose: () => {} });
    const del = h.querySelector(".cell.del") as HTMLElement;
    const add = h.querySelector(".cell.add") as HTMLElement;
    expect(del.textContent).toBe("two");
    expect(add.textContent).toBe("TWO");
    // Context line "one" appears in both panes (a left + right cell).
    const cells = [...h.querySelectorAll(".cell")].map((c) => c.textContent);
    expect(cells.filter((t) => t === "one")).toHaveLength(2);
  });

  it("renders the hunk header", () => {
    const h = render({ title: "a.txt", diff: modified, onClose: () => {} });
    expect(h.querySelector(".hunk-head")?.textContent).toBe("@@ -1,3 +1,3 @@");
  });

  it("shows a binary-file message instead of hunks", () => {
    const bin: FileDiff = {
      path: "b.bin",
      old_path: null,
      status: "modified",
      binary: true,
      hunks: [],
    };
    const h = render({ title: "b.bin", diff: bin, onClose: () => {} });
    expect(h.querySelector(".diff")).toBeNull();
    expect(h.textContent).toContain("Binary file");
  });

  it("shows a loading message while the diff loads", () => {
    const h = render({
      title: "a.txt",
      diff: null,
      loading: true,
      onClose: () => {},
    });
    expect(h.textContent).toContain("Loading diff");
  });

  it("closes on Escape and on the backdrop", () => {
    const onClose = vi.fn();
    const h = render({ title: "a.txt", diff: modified, onClose });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    (h.querySelector(".backdrop") as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
