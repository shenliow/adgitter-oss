import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import MetroGraph from "./MetroGraph.svelte";
import type { Commit, RefList } from "../lib/ipc";

function commit(sha: string, parents: string[] = []): Commit {
  return {
    sha,
    short_sha: sha.slice(0, 7),
    author_name: "Tester",
    author_email: "t@example.com",
    timestamp: 1700000000,
    subject: `subject ${sha}`,
    body: "",
    parents,
  };
}

const commits = [commit("c3", ["c2"]), commit("c2", ["c1"]), commit("c1", [])];

const refs: RefList = {
  head: { branch: "main", target: "c3", detached: false },
  branches: [{ name: "main", kind: "branch", target: "c3" }],
  remotes: [],
  tags: [],
};

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
});

// Svelte 5: components are mounted with `mount()` (the Svelte 4 `new Component()`
// class API was removed). `flushSync()` applies the initial render + bindings so
// the row buttons (and their `bind:this` refs) exist before we assert.
function render(props: Record<string, unknown>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(MetroGraph, { target: host, props });
  flushSync();
  return Array.from(host.querySelectorAll<HTMLButtonElement>("button.row"));
}

describe("MetroGraph keyboard navigation", () => {
  it("renders one row button per commit", () => {
    const rows = render({
      commits,
      refs,
      selectedSha: null,
      onSelect: () => {},
    });
    expect(rows).toHaveLength(3);
  });

  it("ArrowDown / ArrowUp move focus between rows and clamp", () => {
    const rows = render({
      commits,
      refs,
      selectedSha: null,
      onSelect: () => {},
    });
    rows[0].focus();
    rows[0].dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(document.activeElement).toBe(rows[1]);
    rows[1].dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    expect(document.activeElement).toBe(rows[0]);
    rows[0].dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    expect(document.activeElement).toBe(rows[0]);
  });

  it("clicking a row invokes onSelect with the commit", () => {
    const onSelect = vi.fn();
    const rows = render({ commits, refs, selectedSha: null, onSelect });
    rows[2].click();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].sha).toBe("c1");
  });
});
