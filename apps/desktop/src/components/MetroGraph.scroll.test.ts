import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
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

/** Every `scrollIntoView` call made during a test, with the element that
 *  received it — jsdom does not implement the method at all, so the stub is
 *  both the spy and the implementation. */
let calls: { el: Element; opts: ScrollIntoViewOptions | undefined }[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal("HTMLElement", HTMLElement);
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: function (this: Element, opts?: ScrollIntoViewOptions) {
      calls.push({ el: this, opts });
    },
  });
});

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
  vi.unstubAllGlobals();
  // @ts-expect-error — remove the stub so it can't leak into another file.
  delete HTMLElement.prototype.scrollIntoView;
});

function render(props: Record<string, unknown>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(MetroGraph, { target: host, props });
  flushSync();
  return host;
}

/** Pretend the OS/browser reduced-motion setting is `reduce`. jsdom ships no
 *  `matchMedia`, so absence is the "no preference" case and this adds it. */
function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: reduce && query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList,
  );
}

describe("MetroGraph scrollTarget", () => {
  it("animates the scroll so the travel is visible", () => {
    render({ commits, refs, scrollTarget: { sha: "c1" } });
    expect(calls).toHaveLength(1);
    expect(calls[0].opts).toMatchObject({
      block: "center",
      behavior: "smooth",
    });
  });

  it("scrolls the row belonging to the requested sha, not the first row", () => {
    const el = render({ commits, refs, scrollTarget: { sha: "c1" } });
    const rows = [...el.querySelectorAll("button.row")];
    // `commits` is newest-first, so c1 is the LAST row — a naive
    // implementation that ignored the sha would scroll rows[0] (c3).
    expect(calls).toHaveLength(1);
    expect(calls[0].el).toBe(rows[rows.length - 1]);
  });

  it("jumps instantly when the user asked for reduced motion", () => {
    stubReducedMotion(true);
    render({ commits, refs, scrollTarget: { sha: "c1" } });
    expect(calls[0].opts).toMatchObject({ behavior: "auto" });
  });

  it("still animates when reduced motion is not requested", () => {
    stubReducedMotion(false);
    render({ commits, refs, scrollTarget: { sha: "c1" } });
    expect(calls[0].opts).toMatchObject({ behavior: "smooth" });
  });

  it("does not scroll for a sha that is not in the graph", () => {
    render({ commits, refs, scrollTarget: { sha: "nope" } });
    expect(calls).toHaveLength(0);
  });

  it("does not scroll when no target is set", () => {
    render({ commits, refs, scrollTarget: null });
    expect(calls).toHaveLength(0);
  });
});
