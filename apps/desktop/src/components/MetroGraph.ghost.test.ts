import { describe, it, expect, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import MetroGraph from "./MetroGraph.svelte";
import type { Commit, RefList } from "../lib/ipc";

function commit(sha: string, parents: string[] = [], ghost = false): Commit {
  return {
    sha,
    short_sha: sha.slice(0, 7),
    author_name: "Tester",
    author_email: "t@example.com",
    timestamp: 1700000000,
    subject: `subject ${sha}`,
    body: "",
    parents,
    ghost,
  };
}

// c3 - c2 - c1; c2 is orphaned by a history rewrite (still reachable only via
// its expiring `refs/adgitter/backup` ref).
const commits = [
  commit("c3", ["c2"]),
  commit("c2", ["c1"], true),
  commit("c1", []),
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

function subjectFor(h: HTMLDivElement, text: string): HTMLElement {
  const span = [...h.querySelectorAll<HTMLElement>("span.subject")].find(
    (s) => s.textContent === text,
  );
  if (!span) throw new Error(`no subject span for ${text}`);
  return span;
}

describe("MetroGraph ghost commits", () => {
  it("ghosts the orphaned commit's node, edges, and label", () => {
    const h = render({ commits, refs });

    // Only the ghost commit's node circle carries the hint <title>.
    const hintTitle = h.querySelector("circle > title");
    expect(hintTitle).not.toBeNull();
    expect(hintTitle!.textContent).toBe(
      "Orphaned by a history rewrite - removed after 48h",
    );
    const ghostCircle = hintTitle!.parentElement!;
    expect(ghostCircle.classList.contains("ghost")).toBe(true);

    // Edges touching the ghost commit are de-emphasized too.
    expect(h.querySelectorAll("svg path.ghost").length).toBeGreaterThan(0);

    const ghostLabel = subjectFor(h, "subject c2");
    expect(ghostLabel.classList.contains("ghost")).toBe(true);

    // A non-ghost commit gets neither the node nor the label treatment.
    const liveLabel = subjectFor(h, "subject c1");
    expect(liveLabel.classList.contains("ghost")).toBe(false);
    const nonGhostCircles = [...h.querySelectorAll("circle")].filter(
      (c) => !c.querySelector("title"),
    );
    expect(nonGhostCircles.some((c) => c.classList.contains("ghost"))).toBe(
      false,
    );
  });

  it("ghosts a rail's casing along with its coloured rail, not just one of them", () => {
    // Every edge in this fixture (c3->c2, c2->c1) touches the ghost commit
    // c2, so both rails — and their casings — should be ghosted. A
    // full-opacity casing around a faded rail would defeat the point of
    // de-emphasizing ghost commits.
    const h = render({ commits, refs });
    const paths = [...h.querySelectorAll<SVGPathElement>("g.edges path")];
    expect(paths.length).toBe(4); // 2 edges * (casing + rail)
    for (let i = 0; i + 1 < paths.length; i += 2) {
      const casing = paths[i];
      const rail = paths[i + 1];
      expect(casing.getAttribute("stroke")).toBe("var(--workspace-bg)");
      expect(casing.classList.contains("ghost")).toBe(true);
      expect(rail.classList.contains("ghost")).toBe(true);
    }
  });
});
