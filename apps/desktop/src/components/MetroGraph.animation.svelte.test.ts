/**
 * Animation feedback in the real graph: arming a hint, then a commit list that
 * adds commits, puts a flying copy on each new commit's spot — offset back to
 * its source circle — hides the real node until the copy lands, and clears
 * itself. Without the setting, without a hint, or under reduced motion,
 * nothing flies.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import type { Commit, RefList } from "../lib/ipc";
import type { GraphAnimationHint } from "../lib/graphAnimation";

const pollNativeModifiers = vi.hoisted(() => vi.fn());
vi.mock("../lib/ipc", () => ({ pollNativeModifiers }));

import MetroGraph from "./MetroGraph.svelte";

let clock = 1_700_000_000;
function commit(sha: string, parents: string[] = []): Commit {
  return {
    sha,
    short_sha: sha.slice(0, 7),
    author_name: "Tester",
    author_email: "t@example.com",
    timestamp: clock++,
    subject: `subject ${sha}`,
    body: "",
    parents,
  };
}
function refsAt(target: string): RefList {
  return {
    head: { branch: "main", target, detached: false },
    branches: [{ name: "main", kind: "branch", target }],
    remotes: [],
    tags: [],
  };
}

const a = commit("a");
const b = commit("b", ["a"]);
const n = commit("n", ["b"]);

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

beforeEach(() => {
  vi.useFakeTimers();
  pollNativeModifiers.mockResolvedValue(null);
});
afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function render(animate: boolean) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const props = $state<{
    commits: Commit[];
    refs: RefList;
    animate: boolean;
    animationHint: GraphAnimationHint | null;
  }>({ commits: [b, a], refs: refsAt("b"), animate, animationHint: null });
  app = mount(MetroGraph, { target: host, props });
  flushSync();
  return props;
}

const flight = (sha: string) =>
  host.querySelector<SVGGElement>(`[data-flight="${sha}"]`);
const nodeCount = () => host.querySelectorAll("circle.node").length;

/** The commit lands: what App does after a successful `create_commit`. */
function commitN(props: ReturnType<typeof render>, armFirst = true) {
  if (armFirst) {
    props.animationHint = { seq: 1, mode: "head", headBefore: "b" };
    flushSync();
  }
  props.commits = [n, b, a];
  props.refs = refsAt("n");
  flushSync();
}

describe("MetroGraph animation feedback", () => {
  it("a new commit flies out of the circle below it and lands on its own spot", () => {
    const props = render(true);
    commitN(props);

    const f = flight("n");
    expect(f).not.toBeNull();
    // Drawn at the landing spot, offset back to the source: straight down one
    // row (same lane), so no sideways travel.
    const style = f!.getAttribute("style") ?? "";
    expect(style).toMatch(/--dx:\s*0px/);
    const dy = Number(/--dy:\s*(-?[\d.]+)px/.exec(style)?.[1]);
    expect(dy).toBeGreaterThan(0);
    // The real node waits for the copy: two of three nodes are drawn.
    expect(nodeCount()).toBe(2);

    vi.advanceTimersByTime(2000);
    flushSync();
    expect(flight("n")).toBeNull();
    expect(nodeCount()).toBe(3);
  });

  it("does nothing when the setting is off", () => {
    const props = render(false);
    commitN(props);
    expect(flight("n")).toBeNull();
    expect(nodeCount()).toBe(3);
  });

  it("does nothing for an update no operation armed (refresh, pull, undo)", () => {
    const props = render(true);
    commitN(props, false);
    expect(flight("n")).toBeNull();
  });

  it("does nothing when the OS asks for reduced motion", () => {
    vi.stubGlobal(
      "matchMedia",
      (q: string) => ({ matches: q.includes("reduce"), media: q }) as never,
    );
    const props = render(true);
    commitN(props);
    expect(flight("n")).toBeNull();
  });

  it("a failed op (hint cleared) does not animate the next unrelated update", () => {
    const props = render(true);
    props.animationHint = { seq: 1, mode: "head", headBefore: "b" };
    flushSync();
    props.animationHint = null;
    flushSync();
    props.commits = [n, b, a];
    props.refs = refsAt("n");
    flushSync();
    expect(flight("n")).toBeNull();
  });
});
