import { describe, it, expect, afterEach } from "vitest";
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

// Three refs on the SAME commit — the worst case for the overlapped
// <=tag=(=branch=) label presentation: identical lane colors everywhere.
const refs: RefList = {
  head: { branch: "main", target: "c3", detached: false },
  branches: [
    { name: "main", kind: "branch", target: "c3" },
    { name: "feature", kind: "branch", target: "c3" },
  ],
  remotes: [],
  tags: [{ name: "v1", kind: "tag", target: "c3" }],
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

const styleOf = (el: Element) => el.getAttribute("style") ?? "";

function branchChip(h: HTMLDivElement, label: string): HTMLDivElement {
  const chip = [...h.querySelectorAll<HTMLDivElement>(".chip-branch")].find(
    (b) => b.textContent?.trim().startsWith(label),
  );
  if (!chip) throw new Error(`no branch chip for ${label}`);
  return chip;
}

describe("chip colors (adjacent de-collision + per-name override)", () => {
  it("chips sharing a commit never share a background", () => {
    const h = render({ commits, refs });
    const tag = h.querySelector(".chip-tag")!;
    const backgrounds = [
      styleOf(tag),
      styleOf(branchChip(h, "main")),
      styleOf(branchChip(h, "feature")),
    ];
    expect(new Set(backgrounds).size).toBe(backgrounds.length);
  });

  it("a color override recolors only that branch's chip, not its siblings", () => {
    const h = render({
      commits,
      refs,
      branchColors: { main: "#123456" },
    });
    // jsdom normalizes the hex into the rgb() form in the style attribute.
    const overridden = "rgb(18, 52, 86)"; // == #123456
    expect(styleOf(branchChip(h, "main"))).toContain(overridden);
    expect(styleOf(branchChip(h, "feature"))).not.toContain(overridden);
    expect(styleOf(h.querySelector(".chip-tag")!)).not.toContain(overridden);
  });
});

describe("chip stacking + connector stem", () => {
  const zi = (el: Element) => {
    const m = styleOf(el).match(/--zi:\s*(\d+)/);
    return m ? Number(m[1]) : NaN;
  };
  const bg = (el: Element) => styleOf(el).match(/background:\s*([^;]+)/)?.[1];

  it("assigns per-chip --zi increasing left→right so the nearest-node chip is topmost", () => {
    const h = render({ commits, refs });
    // DOM order within the cluster is tag (outermost/left) → branches
    // (rightmost, nearest the node); --zi must strictly increase along it.
    const tag = zi(h.querySelector(".chip-tag")!);
    const main = zi(branchChip(h, "main"));
    const feature = zi(branchChip(h, "feature"));
    expect(tag).toBeLessThan(main);
    expect(main).toBeLessThan(feature);
  });

  it("renders a connector stem coloured like the nearest-node chip", () => {
    const h = render({ commits, refs });
    const tail = h.querySelector(".chip-tail");
    expect(tail).not.toBeNull();
    // The rightmost chip (last in DOM) is the branch nearest the node; the
    // stem borrows its colour so the label reads as growing out of the node.
    const chips = [...h.querySelectorAll(".chips > .chip")];
    const rightmost = chips[chips.length - 1];
    expect(bg(tail!)).toBe(bg(rightmost));
  });
});

describe("ref-label column never reaches over the time axis", () => {
  // MetroGraph's own constants; the layout invariant under test is
  // labelRightX >= AXIS_W + LABEL_COL_W, guaranteed by the lane0X clamp.
  const AXIS_W = 150;
  const LABEL_COL_W = 150;

  const px = (el: Element, prop: string) => {
    const m = styleOf(el).match(
      new RegExp(`(?:^|;)\\s*${prop}:\\s*([-\\d.]+)px`),
    );
    if (m === null) throw new Error(`no ${prop} on ${styleOf(el)}`);
    return Number(m[1]);
  };

  /** One commit carrying `n` branches with deliberately punishing names. */
  const crowdedRefs = (n: number): RefList => ({
    head: {
      branch: "release/2026-07-15/candidate-0",
      target: "c3",
      detached: false,
    },
    branches: Array.from({ length: n }, (_, i) => ({
      name: `release/2026-07-15/candidate-${i}`,
      kind: "branch" as const,
      target: "c3",
    })),
    remotes: [],
    tags: [{ name: "v1.0.0-rc.1+build.20260715", kind: "tag", target: "c3" }],
  });

  it("caps the chip strip's width at the axis instead of growing over it", () => {
    const h = render({ commits, refs: crowdedRefs(8) });
    const strip = h.querySelector(".chips")!;

    // `left` is the column's right edge (labelRightX; the box is pulled left
    // by translateX(-100%)), so its leftmost possible edge is left - maxWidth.
    // That must stop at or after the axis column — the chips can never paint
    // over the timestamps no matter how many refs the commit carries.
    const left = px(strip, "left");
    const maxWidth = px(strip, "max-width");
    expect(left - maxWidth).toBeGreaterThanOrEqual(AXIS_W);
    // The column still gets its full guaranteed width — the cap is not a
    // degenerate 0 that would hide every chip.
    expect(maxWidth).toBeGreaterThanOrEqual(LABEL_COL_W);
  });

  it("keeps the same cap however many refs pile onto one commit", () => {
    // A content-driven width would widen with the ref count; a hard column cap
    // does not — the surplus becomes scrollable instead.
    const one = px(
      render({ commits, refs: crowdedRefs(1) }).querySelector(".chips")!,
      "max-width",
    );
    unmount(app);
    host.remove();
    const many = px(
      render({ commits, refs: crowdedRefs(12) }).querySelector(".chips")!,
      "max-width",
    );
    expect(many).toBe(one);
  });

  it("leaves the connector stem outside the scrolling strip so it is not clipped", () => {
    const h = render({ commits, refs: crowdedRefs(8) });
    const tail = h.querySelector(".chip-tail")!;
    const strip = h.querySelector(".chips")!;

    // Inside .chips (a horizontal scroll container) the stem would be cut off
    // at the label column's edge instead of reaching the commit node.
    expect(h.querySelector(".chips .chip-tail")).toBeNull();
    // Emitted before .chips so it still paints beneath the pills (both z-index 0).
    expect(
      tail.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Still spans from just under the rightmost pill out to the node centre.
    expect(px(tail, "left")).toBe(px(strip, "left") - 14);
    expect(px(tail, "width")).toBeGreaterThan(14);
  });

  it("keeps the chips draggable inside the scrolling strip", () => {
    const h = render({ commits, refs: crowdedRefs(3) });
    const chip = branchChip(h, "release/2026-07-15/candidate-1");
    expect(chip.closest(".chips")).not.toBeNull();
    // A div (WKWebView refuses drags from form controls) that still opts in.
    expect(chip.tagName).toBe("DIV");
    expect(chip.getAttribute("draggable")).toBe("true");
  });
});

describe("chip label truncation (CSS max-width 12em, full name in tooltip)", () => {
  const longBranch = "feature/very-long-branch-name";
  const longTag = "release-2026-07-15-hotfix";
  const clippedRefs: RefList = {
    head: { branch: longBranch, target: "c3", detached: false },
    branches: [{ name: longBranch, kind: "branch", target: "c3" }],
    remotes: [],
    tags: [{ name: longTag, kind: "tag", target: "c2" }],
  };

  it("renders the full label (CSS truncates at 12em) with the full name in the tooltip", () => {
    const h = render({ commits, refs: clippedRefs });

    // The label lives in a .chip-label span whose CSS (max-width:12em +
    // text-overflow:ellipsis) truncates it visually; the full text stays in the
    // DOM and the tooltip, so nothing is lost.
    const branchLabel = h.querySelector<HTMLElement>(
      ".chip-branch .chip-label",
    )!;
    expect(branchLabel.textContent).toBe(longBranch);
    const branch = h.querySelector<HTMLElement>(".chip-branch")!;
    expect(branch.getAttribute("title")).toContain(longBranch);

    const tagLabel = h.querySelector<HTMLElement>(".chip-tag .chip-label")!;
    expect(tagLabel.textContent).toBe(longTag);
    expect(h.querySelector(".chip-tag")!.getAttribute("title")).toBe(longTag);
  });

  it("leaves short labels untouched", () => {
    const h = render({ commits, refs });
    expect(branchChip(h, "main").textContent).toContain("main");
    expect(h.querySelector(".chip-tag")!.textContent?.trim()).toBe("v1");
  });
});
