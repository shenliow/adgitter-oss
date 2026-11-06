import { describe, it, expect, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import MetroGraph from "./MetroGraph.svelte";
import type { Commit, RefList } from "../lib/ipc";

function commit(sha: string, email: string, parents: string[] = []): Commit {
  return {
    sha,
    short_sha: sha.slice(0, 7),
    author_name: "Tester",
    author_email: email,
    timestamp: 1700000000,
    subject: `subject ${sha}`,
    body: "",
    parents,
  };
}

const commits = [
  commit("c3", "head@example.com", ["c2"]),
  commit("c2", "mid@example.com", ["c1"]),
  commit("c1", "root@example.com", []),
];

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

function render(props: Record<string, unknown>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(MetroGraph, { target: host, props });
  flushSync();
  return host;
}

describe("MetroGraph row author identity", () => {
  it("shows the author name and email on EVERY row, with HEAD's row emphasized", () => {
    const h = render({ commits, refs });

    const emails = [...h.querySelectorAll<HTMLElement>(".row .email")];
    expect(emails.map((e) => e.textContent)).toEqual([
      "Tester head@example.com",
      "Tester mid@example.com",
      "Tester root@example.com",
    ]);

    // Only HEAD's row carries the stronger `.head` emphasis.
    const emphasized = emails.filter((e) => e.classList.contains("head"));
    expect(emphasized.map((e) => e.textContent)).toEqual([
      "Tester head@example.com",
    ]);
  });
});
