import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import type { Commit, RefList } from "../lib/ipc";

// MetroGraph polls this during a drag to work around WKWebView swallowing
// mid-drag keyboard events (see MetroGraph.svelte's "WKWebView modifier
// workaround"). Mocked so tests control exactly what the "hardware" reports,
// without a real Tauri IPC bridge. Defaults to `null` (the non-macOS case —
// DragEvent flags are already correct, nothing to poll), matching every
// existing test in this file that never touches the mock at all.
const pollNativeModifiers = vi.hoisted(() => vi.fn());
vi.mock("../lib/ipc", () => ({ pollNativeModifiers }));

import MetroGraph from "./MetroGraph.svelte";

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

// main is current (tip c3); feature is an older branch on c2.
const refs: RefList = {
  head: { branch: "main", target: "c3", detached: false },
  branches: [
    { name: "main", kind: "branch", target: "c3" },
    { name: "feature", kind: "branch", target: "c2" },
  ],
  remotes: [],
  tags: [{ name: "v1", kind: "tag", target: "c1" }],
};

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

beforeEach(() => {
  pollNativeModifiers.mockReset();
  pollNativeModifiers.mockResolvedValue(null);
});

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
  vi.useRealTimers();
});

function render(props: Record<string, unknown>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(MetroGraph, { target: host, props });
  flushSync();
  return host;
}

// Branch chips are divs (not <button>s, per WKWebView's refusal to start
// HTML5 drags from form controls); remote chips stay buttons (click-only).
function branchChip(h: HTMLDivElement, label: string): HTMLDivElement {
  const chip = [...h.querySelectorAll<HTMLDivElement>(".chip-branch")].find(
    (b) => b.textContent?.trim().startsWith(label),
  );
  if (!chip) throw new Error(`no branch chip for ${label}`);
  return chip;
}

function rows(h: HTMLDivElement): HTMLButtonElement[] {
  return [...h.querySelectorAll<HTMLButtonElement>("button.row")];
}

// The commit drag source is the per-node handle (only the circle is draggable);
// handles render in the same newest-first order as rows. It's a div (not a
// <button>, per WKWebView's refusal to start HTML5 drags from form controls).
function handles(h: HTMLDivElement): HTMLDivElement[] {
  return [...h.querySelectorAll<HTMLDivElement>(".node-handle")];
}

// jsdom lacks DataTransfer, so dispatch a MouseEvent (carries the modifier
// flags resolveDrag reads) with a minimal dataTransfer attached.
function fireDrag(
  el: Element,
  type:
    | "dragstart"
    | "dragenter"
    | "dragover"
    | "dragleave"
    | "drop"
    | "dragend",
  mods: Partial<MouseEventInit> = {},
) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, ...mods });
  Object.defineProperty(ev, "dataTransfer", {
    value: {
      effectAllowed: "",
      dropEffect: "",
      _d: {} as Record<string, string>,
      setData(k: string, v: string) {
        this._d[k] = v;
      },
      getData(k: string) {
        return this._d[k] ?? "";
      },
    },
  });
  el.dispatchEvent(ev);
  return ev;
}

/** Drag `from` onto `to`, applying `mods` on the drop. */
function dragOnto(
  from: Element,
  to: Element,
  mods: Partial<MouseEventInit> = {},
) {
  fireDrag(from, "dragstart");
  fireDrag(to, "dragover", mods);
  fireDrag(to, "drop", mods);
}

describe("MetroGraph gestures", () => {
  it("renders only branches as interactive chips (tags stay static)", () => {
    const h = render({ commits, refs });
    const branchChips = h.querySelectorAll("div.chip-branch");
    expect(branchChips).toHaveLength(2);
    // The tag is a non-interactive span, not a button/interactive chip.
    expect(h.querySelector(".chip-tag.interactive")).toBeNull();
    expect(h.querySelector("span.chip-tag")).not.toBeNull();
  });

  it("right-clicking a branch label opens the branch menu with coords", () => {
    const onBranchMenu = vi.fn();
    const h = render({ commits, refs, onBranchMenu });
    branchChip(h, "feature").dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 42,
        clientY: 99,
      }),
    );
    expect(onBranchMenu).toHaveBeenCalledTimes(1);
    const [branch, x, y] = onBranchMenu.mock.calls[0];
    expect(branch).toEqual({ name: "feature", current: false });
    expect([x, y]).toEqual([42, 99]);
  });

  it("flags the current branch in the menu payload", () => {
    const onBranchMenu = vi.fn();
    const h = render({ commits, refs, onBranchMenu });
    branchChip(h, "main").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true }),
    );
    expect(onBranchMenu.mock.calls[0][0]).toEqual({
      name: "main",
      current: true,
    });
  });

  it("single-clicking a branch label selects it as a unit", () => {
    const onBranchSelect = vi.fn();
    const h = render({ commits, refs, onBranchSelect });
    branchChip(h, "feature").click();
    expect(onBranchSelect).toHaveBeenCalledWith({
      name: "feature",
      current: false,
    });
  });

  it("remote branch chips are clickable and select via onBranchSelect", () => {
    const onBranchSelect = vi.fn();
    const refsWithRemote: RefList = {
      ...refs,
      remotes: [{ name: "origin/main", kind: "remote", target: "c3" }],
    };
    const h = render({ commits, refs: refsWithRemote, onBranchSelect });
    const chip = [
      ...h.querySelectorAll<HTMLButtonElement>("button.chip-remote"),
    ].find((b) => b.textContent?.trim().startsWith("origin/main"));
    expect(chip).toBeTruthy();
    chip!.click();
    expect(onBranchSelect).toHaveBeenCalledWith({
      name: "origin/main",
      current: false,
    });
  });

  it("paints a branch chip with its color override", () => {
    // #abcdef → rgb(171, 205, 239) once the browser parses the style attribute.
    const over = render({
      commits,
      refs,
      branchColors: { feature: "#abcdef" },
    });
    expect(branchChip(over, "feature").getAttribute("style")).toContain(
      "rgb(171, 205, 239)",
    );
    unmount(app);
    host.remove();
    // Without an override the chip uses the lane CSS variable.
    const plain = render({ commits, refs });
    expect(branchChip(plain, "feature").getAttribute("style")).toContain(
      "--lane-",
    );
  });

  it("highlights the selected branch label", () => {
    const h = render({ commits, refs, selectedBranch: "feature" });
    expect(branchChip(h, "feature").classList.contains("label-selected")).toBe(
      true,
    );
    expect(branchChip(h, "main").classList.contains("label-selected")).toBe(
      false,
    );
  });

  it("double-clicking a branch label activates checkout", () => {
    const onBranchActivate = vi.fn();
    const h = render({ commits, refs, onBranchActivate });
    branchChip(h, "feature").dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true }),
    );
    expect(onBranchActivate).toHaveBeenCalledWith({
      name: "feature",
      current: false,
    });
  });
});

describe("MetroGraph drag gestures", () => {
  it("dragging a branch onto the current branch = merge", () => {
    const onGesture = vi.fn();
    const h = render({ commits, refs, onGesture });
    dragOnto(branchChip(h, "feature"), branchChip(h, "main"));
    expect(onGesture).toHaveBeenCalledWith({ op: "merge", source: "feature" });
  });

  it("Shift-dropping a branch onto the current branch = rebase", () => {
    const onGesture = vi.fn();
    const h = render({ commits, refs, onGesture });
    dragOnto(branchChip(h, "feature"), branchChip(h, "main"), {
      shiftKey: true,
    });
    expect(onGesture).toHaveBeenCalledWith({ op: "rebase", onto: "feature" });
  });

  it("Alt-dragging a commit onto the current branch = cherry-pick", () => {
    const onGesture = vi.fn();
    const h = render({ commits, refs, onGesture });
    // handles are newest-first: [c3, c2, c1]; grab c1 by its node handle.
    dragOnto(handles(h)[2], branchChip(h, "main"), { altKey: true });
    expect(onGesture).toHaveBeenCalledWith({
      op: "cherryPick",
      commits: ["c1"],
    });
  });

  it("a plain commit drag onto a branch does nothing (needs Alt)", () => {
    const onGesture = vi.fn();
    const h = render({ commits, refs, onGesture });
    dragOnto(handles(h)[2], branchChip(h, "main"));
    expect(onGesture).not.toHaveBeenCalled();
  });

  it("clicking a node handle selects that commit (single-select + detail)", () => {
    const onSelect = vi.fn();
    const h = render({ commits, refs, onSelect });
    handles(h)[1].click(); // c2
    expect(onSelect).toHaveBeenCalledTimes(1);
    const [c, mods] = onSelect.mock.calls[0];
    expect(c.sha).toBe("c2");
    expect(mods).toEqual({ shift: false, meta: false, ctrl: false });
  });

  function dragstartWithImage(el: Element) {
    const setDragImage = vi.fn();
    const ev = new MouseEvent("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "dataTransfer", {
      value: {
        effectAllowed: "",
        dropEffect: "",
        setData() {},
        setDragImage,
      },
    });
    el.dispatchEvent(ev);
    return setDragImage;
  }

  it("a multi-commit drag uses a circle drag image badged with the count", () => {
    const h = render({ commits, refs, selection: new Set(["c2", "c1"]) });
    const setDragImage = dragstartWithImage(handles(h)[2]); // grab c1
    expect(setDragImage).toHaveBeenCalledTimes(1);
    const ghost = setDragImage.mock.calls[0][0] as HTMLElement;
    expect(ghost.textContent).toBe("2");
    ghost.remove();
  });

  it("a single-commit drag image carries no count", () => {
    const h = render({ commits, refs });
    const setDragImage = dragstartWithImage(handles(h)[2]);
    const ghost = setDragImage.mock.calls[0][0] as HTMLElement;
    expect(ghost.textContent).toBe("");
    ghost.remove();
  });

  it("the commit rows are not draggable — only the node handles are", () => {
    const h = render({ commits, refs });
    expect(rows(h).every((r) => r.getAttribute("draggable") !== "true")).toBe(
      true,
    );
    const hs = handles(h);
    expect(hs).toHaveLength(3);
    expect(hs.every((n) => n.getAttribute("draggable") === "true")).toBe(true);
  });

  it("dragging the HEAD crown onto a commit = mixed reset", () => {
    const onGesture = vi.fn();
    const h = render({ commits, refs, onGesture });
    const crown = h.querySelector(".crown")!;
    dragOnto(crown, rows(h)[2]); // reset onto c1
    expect(onGesture).toHaveBeenCalledWith({
      op: "reset",
      target: "c1",
      short: "c1",
      mode: "mixed",
    });
  });

  it("Shift-dragging the HEAD crown onto a commit = hard reset", () => {
    const onGesture = vi.fn();
    const h = render({ commits, refs, onGesture });
    const crown = h.querySelector(".crown")!;
    dragOnto(crown, rows(h)[2], { shiftKey: true });
    expect(onGesture).toHaveBeenCalledWith({
      op: "reset",
      target: "c1",
      short: "c1",
      mode: "hard",
    });
  });

  it("dragging the HEAD crown onto a NON-current branch label resolves to a reset targeting that branch — no prompt (exactly one branch named)", () => {
    const onGesture = vi.fn();
    const h = render({ commits, refs, onGesture });
    const crown = h.querySelector(".crown")!;
    dragOnto(crown, branchChip(h, "feature"));
    expect(onGesture).toHaveBeenCalledWith({
      op: "reset",
      target: "feature",
      short: "feature",
      mode: "mixed",
    });
  });

  it("dragging the HEAD crown onto the CURRENT branch's own label is a no-op", () => {
    const onGesture = vi.fn();
    const h = render({ commits, refs, onGesture });
    const crown = h.querySelector(".crown")!;
    dragOnto(crown, branchChip(h, "main"));
    expect(onGesture).not.toHaveBeenCalled();
  });

  it("dragging the HEAD crown onto a branch label accepts the drop as a live drop target (hover styling applies)", () => {
    const h = render({ commits, refs });
    const crown = h.querySelector(".crown")!;
    const chip = branchChip(h, "feature");
    fireDrag(crown, "dragstart");
    fireDrag(chip, "dragover");
    flushSync();
    expect(chip.classList.contains("drop-target")).toBe(true);
  });

  it("dragging the HEAD crown onto a commit with SEVERAL local branches carries candidates listing every branch and the commit itself", () => {
    const ambiguousRefs: RefList = {
      head: { branch: "main", target: "c3", detached: false },
      branches: [
        { name: "main", kind: "branch", target: "c3" },
        { name: "feature", kind: "branch", target: "c2" },
        { name: "wip", kind: "branch", target: "c2" },
      ],
      remotes: [],
      tags: [],
    };
    const onGesture = vi.fn();
    const h = render({ commits, refs: ambiguousRefs, onGesture });
    const crown = h.querySelector(".crown")!;
    dragOnto(crown, rows(h)[1]); // c2 carries feature + wip
    expect(onGesture).toHaveBeenCalledWith({
      op: "reset",
      target: "c2",
      short: "c2",
      mode: "mixed",
      candidates: ["feature", "wip", "c2"],
      commitSha: "c2",
    });
  });

  it("Shift-dragging the HEAD crown onto a several-branch commit still selects hard reset — the modifier still picks the mode on the ambiguous path", () => {
    const ambiguousRefs: RefList = {
      head: { branch: "main", target: "c3", detached: false },
      branches: [
        { name: "main", kind: "branch", target: "c3" },
        { name: "feature", kind: "branch", target: "c2" },
        { name: "wip", kind: "branch", target: "c2" },
      ],
      remotes: [],
      tags: [],
    };
    const onGesture = vi.fn();
    const h = render({ commits, refs: ambiguousRefs, onGesture });
    const crown = h.querySelector(".crown")!;
    dragOnto(crown, rows(h)[1], { shiftKey: true });
    expect(onGesture).toHaveBeenCalledWith({
      op: "reset",
      target: "c2",
      short: "c2",
      mode: "hard",
      candidates: ["feature", "wip", "c2"],
      commitSha: "c2",
    });
  });

  it("grows the hovered commit's circle while a HEAD-crown drag hovers over it, and shrinks it back on drop", () => {
    const h = render({ commits, refs });
    const crown = h.querySelector(".crown")!;
    // Node circles render in commit order (newest-first): [c3, c2, c1].
    const nodeCircles = [...h.querySelectorAll("circle.node")];
    expect(nodeCircles).toHaveLength(3);
    const targetCircle = nodeCircles[2]; // c1, the reset target below
    expect(targetCircle.getAttribute("r")).toBe("12"); // NODE_R, unhovered

    fireDrag(crown, "dragstart");
    fireDrag(rows(h)[2], "dragover");
    flushSync();
    expect(targetCircle.getAttribute("r")).toBe("16"); // NODE_R + 4

    fireDrag(rows(h)[2], "drop");
    flushSync();
    expect(targetCircle.getAttribute("r")).toBe("12"); // back to normal
  });
});

// "Drag HEAD" = drag the checked-out branch's own chip (it carries the ✶
// marker) onto a commit or another branch label — a checkout, disambiguated
// by `resolveDrag`/`dragDispatch.test.ts`; this describe block only checks
// the graph wires that resolution up to `onGesture` for both drop-target
// shapes it accepts (a `.row`, matching the crown-reset test above, and a
// branch chip).
describe("MetroGraph drag gestures — drag HEAD (checkout)", () => {
  it("dropped on a branch label: checks it out directly", () => {
    const onGesture = vi.fn();
    const h = render({ commits, refs, onGesture });
    dragOnto(branchChip(h, "main"), branchChip(h, "feature"));
    expect(onGesture).toHaveBeenCalledWith({
      op: "checkout",
      branch: "feature",
    });
  });

  it("dropped on a commit with exactly one local branch: checks it out, no candidates", () => {
    const onGesture = vi.fn();
    const h = render({ commits, refs, onGesture });
    dragOnto(branchChip(h, "main"), rows(h)[1]); // c2, only "feature" points here
    expect(onGesture).toHaveBeenCalledWith({
      op: "checkout",
      branch: "feature",
    });
  });

  it("dropped on a commit with SEVERAL local branches: candidates ride along for the confirm gate", () => {
    const ambiguousRefs: RefList = {
      head: { branch: "main", target: "c3", detached: false },
      branches: [
        { name: "main", kind: "branch", target: "c3" },
        { name: "feature", kind: "branch", target: "c2" },
        { name: "wip", kind: "branch", target: "c2" },
      ],
      remotes: [],
      tags: [],
    };
    const onGesture = vi.fn();
    const h = render({ commits, refs: ambiguousRefs, onGesture });
    dragOnto(branchChip(h, "main"), rows(h)[1]); // c2 carries feature + wip
    expect(onGesture).toHaveBeenCalledWith({
      op: "checkout",
      branch: "feature",
      candidates: ["feature", "wip"],
    });
  });

  it("dropped back on its own chip: no gesture at all", () => {
    const onGesture = vi.fn();
    const h = render({ commits, refs, onGesture });
    dragOnto(branchChip(h, "main"), branchChip(h, "main"));
    expect(onGesture).not.toHaveBeenCalled();
  });
});

describe("MetroGraph drag commits onto a commit (rebase / cherry-pick onto new branch)", () => {
  it("branch mode: Shift-dragging a branch-selected commit onto a commit with a local branch defaults the target to that branch", () => {
    const onGesture = vi.fn();
    const h = render({
      commits,
      refs,
      onGesture,
      selection: new Set(["c2"]), // feature's own segment (tip only)
      selectedBranch: "feature",
    });
    // handles are newest-first: [c3, c2, c1]; grab c2 (feature's tip), drop on
    // c3 — which "main" points at, so the resolved target is "main", not "c3".
    dragOnto(handles(h)[1], handles(h)[0], { shiftKey: true });
    expect(onGesture).toHaveBeenCalledWith({
      op: "rebaseBranch",
      branch: "feature",
      onto: "main",
      short: "main",
    });
  });

  it("branch mode: a PLAIN drag (no Shift) rebases identically — tooltip during the hover, rebase on drop", () => {
    const onGesture = vi.fn();
    const h = render({
      commits,
      refs,
      onGesture,
      selection: new Set(["c2"]), // feature's own segment (tip only)
      selectedBranch: "feature",
    });
    // Same gesture as the Shift test above, with NO modifiers held: a
    // branch-as-a-unit drag is always a rebase.
    fireDrag(handles(h)[1], "dragstart"); // grab c2 (feature's tip)
    fireDrag(handles(h)[0], "dragover"); // hover c3 (main's tip), plain
    flushSync();
    const tip = h.querySelector(".drag-tip");
    expect(tip).not.toBeNull();
    expect(tip!.textContent).toContain("Rebase feature onto main");
    fireDrag(handles(h)[0], "drop");
    expect(onGesture).toHaveBeenCalledWith({
      op: "rebaseBranch",
      branch: "feature",
      onto: "main",
      short: "main",
    });
  });

  it("branch mode: a PLAIN drop directly on another branch's chip forces that branch (no Shift needed)", () => {
    const onGesture = vi.fn();
    const h = render({
      commits,
      refs,
      onGesture,
      selection: new Set(["c2"]),
      selectedBranch: "feature",
    });
    dragOnto(handles(h)[1], branchChip(h, "main")); // no modifiers
    expect(onGesture).toHaveBeenCalledWith({
      op: "rebaseBranch",
      branch: "feature",
      onto: "main",
      short: "main",
    });
  });

  it("branch mode: Shift-dragging onto a commit with no local branch still falls back to the sha", () => {
    const onGesture = vi.fn();
    const h = render({
      commits,
      refs,
      onGesture,
      selection: new Set(["c2"]),
      selectedBranch: "feature",
    });
    // c1 carries only the tag v1, no branch — drop on it (handles[2]).
    dragOnto(handles(h)[1], handles(h)[2], { shiftKey: true });
    expect(onGesture).toHaveBeenCalledWith({
      op: "rebaseBranch",
      branch: "feature",
      onto: "c1",
      short: "c1",
    });
  });

  it("branch mode: hovering a commit with a local branch highlights that branch's chip like a selected label", () => {
    const h = render({
      commits,
      refs,
      selection: new Set(["c2"]),
      selectedBranch: "feature",
    });
    fireDrag(handles(h)[1], "dragstart"); // grab c2 (feature's tip)
    fireDrag(handles(h)[0], "dragover", { shiftKey: true }); // hover c3 (main's tip)
    flushSync();
    expect(branchChip(h, "main").classList.contains("rebase-target-hint")).toBe(
      true,
    );
  });

  it("branch mode: Shift-dropping directly on another branch's chip forces that branch as the rebase target", () => {
    const onGesture = vi.fn();
    const h = render({
      commits,
      refs,
      onGesture,
      selection: new Set(["c2"]),
      selectedBranch: "feature",
    });
    // grab c2 (feature's tip) via its node handle, drop straight on main's chip.
    dragOnto(handles(h)[1], branchChip(h, "main"), { shiftKey: true });
    expect(onGesture).toHaveBeenCalledWith({
      op: "rebaseBranch",
      branch: "feature",
      onto: "main",
      short: "main",
    });
  });

  it("individual mode (no branch selected): Shift-dragging a commit selection cherry-picks it onto a new branch at the target, oldest-first", () => {
    const onGesture = vi.fn();
    const h = render({
      commits,
      refs,
      onGesture,
      selection: new Set(["c2", "c1"]),
    });
    // grab c1 (part of the multi-selection), drop on c3.
    dragOnto(handles(h)[2], handles(h)[0], { shiftKey: true });
    expect(onGesture).toHaveBeenCalledWith({
      op: "cherryPickNewBranch",
      shas: ["c1", "c2"], // oldest-first
      target: "c3",
      short: "c3",
    });
  });

  it("is a no-op when the drop target sits inside the dragged selection", () => {
    const onGesture = vi.fn();
    const h = render({
      commits,
      refs,
      onGesture,
      selection: new Set(["c2", "c1"]),
    });
    dragOnto(handles(h)[2], handles(h)[1], { shiftKey: true }); // c1 -> c2, both selected
    expect(onGesture).not.toHaveBeenCalled();
  });

  it("Shift-dragging a commit outside the current selection starts a fresh individual-mode drag, even while a branch is selected", () => {
    const onGesture = vi.fn();
    const h = render({
      commits,
      refs,
      onGesture,
      selection: new Set(["c2"]), // feature's segment — c1 is NOT part of it
      selectedBranch: "feature",
    });
    dragOnto(handles(h)[2], handles(h)[0], { shiftKey: true }); // grab c1, drop on c3
    expect(onGesture).toHaveBeenCalledWith({
      op: "cherryPickNewBranch",
      shas: ["c1"],
      target: "c3",
      short: "c3",
    });
  });

  it("a plain (no-modifier) commit-onto-commit drag still does nothing (unchanged)", () => {
    const onGesture = vi.fn();
    const h = render({ commits, refs, onGesture });
    dragOnto(handles(h)[2], handles(h)[0]); // c1 -> c3, no mods
    expect(onGesture).not.toHaveBeenCalled();
  });
});

describe("MetroGraph Shift-drag tooltip (rebase / cherry-pick onto new branch)", () => {
  it("shows the rebase tip while Shift-dragging in branch mode", () => {
    const h = render({
      commits,
      refs,
      selection: new Set(["c2"]),
      selectedBranch: "feature",
    });
    fireDrag(handles(h)[1], "dragstart"); // grab c2 (feature's tip)
    fireDrag(handles(h)[0], "dragover", { shiftKey: true }); // hover c3 (main's tip)
    flushSync();
    const tip = h.querySelector(".drag-tip");
    expect(tip).not.toBeNull();
    // c3 carries the "main" branch, so the resolved (and shown) target is
    // the branch name, not the bare sha.
    expect(tip!.textContent).toContain("Rebase feature onto main");
  });

  it("shows the cherry-pick-onto-new-branch tip while Shift-dragging in individual mode", () => {
    const h = render({
      commits,
      refs,
      selection: new Set(["c2", "c1"]),
    });
    fireDrag(handles(h)[2], "dragstart"); // grab c1 (multi-selection)
    fireDrag(handles(h)[0], "dragover", { shiftKey: true }); // hover c3
    flushSync();
    const tip = h.querySelector(".drag-tip");
    expect(tip).not.toBeNull();
    expect(tip!.textContent).toContain(
      "Cherry-pick 2 commits onto a new branch at c3",
    );
  });

  it("hides the tooltip once Shift is released mid-drag", () => {
    const h = render({ commits, refs, selection: new Set(["c2", "c1"]) });
    fireDrag(handles(h)[2], "dragstart");
    fireDrag(handles(h)[0], "dragover", { shiftKey: true });
    flushSync();
    expect(h.querySelector(".drag-tip")).not.toBeNull();
    fireDrag(handles(h)[0], "dragover"); // Shift released, still hovering c3
    flushSync();
    expect(h.querySelector(".drag-tip")).toBeNull();
  });
});

describe("MetroGraph HEAD-crown drag tooltip", () => {
  it("shows the mixed-reset tip while dragging the crown with no modifiers", () => {
    const h = render({ commits, refs });
    const crown = h.querySelector(".crown")!;
    fireDrag(crown, "dragstart");
    fireDrag(rows(h)[2], "dragover");
    flushSync();
    const tip = h.querySelector(".drag-tip");
    expect(tip).not.toBeNull();
    expect(tip!.textContent).toContain(
      "Reset --mixed · keep changes, unstaged",
    );
  });

  it("relabels to the hard-reset tip while Shift is held", () => {
    const h = render({ commits, refs });
    const crown = h.querySelector(".crown")!;
    fireDrag(crown, "dragstart");
    fireDrag(rows(h)[2], "dragover", { shiftKey: true });
    flushSync();
    expect(h.querySelector(".drag-tip")!.textContent).toContain(
      "Reset --hard · discard all changes",
    );
  });

  it("relabels to the soft-reset tip while Cmd/Ctrl is held", () => {
    const h = render({ commits, refs });
    const crown = h.querySelector(".crown")!;
    fireDrag(crown, "dragstart");
    fireDrag(rows(h)[2], "dragover", { metaKey: true });
    flushSync();
    expect(h.querySelector(".drag-tip")!.textContent).toContain(
      "Reset --soft · keep changes staged",
    );
  });

  it("clears the tooltip once the drag ends", () => {
    const h = render({ commits, refs });
    const crown = h.querySelector(".crown")!;
    fireDrag(crown, "dragstart");
    fireDrag(rows(h)[2], "dragover");
    flushSync();
    expect(h.querySelector(".drag-tip")).not.toBeNull();
    fireDrag(crown, "dragend");
    flushSync();
    expect(h.querySelector(".drag-tip")).toBeNull();
  });
});

// The crown's drag picture. The browser's automatic snapshot of `.crown` comes
// out clipped (the element is `transform: translate(-50%,-50%)`d, padded tight
// around the glyph, and its drop-shadow paints outside the border box), so the
// crown hands the browser an explicit off-screen node instead — which is also
// what makes it safe to hide the on-screen crown for the drag's duration.
describe("MetroGraph HEAD-crown drag image", () => {
  // As fireDrag, but with a spyable setDragImage on the dataTransfer (jsdom
  // has no DataTransfer at all, so every field is hand-rolled).
  function crownDragstart(el: Element) {
    const setDragImage = vi.fn();
    const ev = new MouseEvent("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "dataTransfer", {
      value: {
        effectAllowed: "",
        dropEffect: "",
        setData() {},
        setDragImage,
      },
    });
    el.dispatchEvent(ev);
    return setDragImage;
  }

  // The snapshotted node must NOT be the template copy itself: that one lives
  // inside `.scroller`, which is `overflow: auto`, so a child parked at
  // -1000px is clipped — and a clipped element paints nothing, so the drag
  // image came out blank. Since the real crown hides for the drag, that left
  // the user dragging nothing at all.
  it("snapshots a copy attached to document.body, not the clipped template node", () => {
    const h = render({ commits, refs });
    const template = h.querySelector(".crown-drag-image") as HTMLElement;
    const setDragImage = crownDragstart(h.querySelector(".crown")!);
    expect(setDragImage).toHaveBeenCalledTimes(1);
    const ghost = setDragImage.mock.calls[0][0] as HTMLElement;
    expect(ghost).not.toBe(template);
    expect(ghost.parentElement).toBe(document.body);
    expect(h.contains(ghost)).toBe(false);
    // Same art either way, so the drag image still matches the crown.
    expect(ghost.innerHTML).toBe(template.innerHTML);
  });

  it("detaches the snapshotted copy once the browser has taken it", async () => {
    const h = render({ commits, refs });
    const setDragImage = crownDragstart(h.querySelector(".crown")!);
    const ghost = setDragImage.mock.calls[0][0] as HTMLElement;
    expect(ghost.isConnected).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(ghost.isConnected).toBe(false);
  });

  it("renders the drag image off-screen, out of reach of a11y, keyboard and pointer", () => {
    const h = render({ commits, refs });
    const ghost = h.querySelector(".crown-drag-image") as HTMLElement;
    expect(ghost).not.toBeNull();
    expect(ghost.getAttribute("aria-hidden")).toBe("true");
    expect(ghost.hasAttribute("tabindex")).toBe(false);
    // Same art as the crown actually on screen (one snippet, two call sites).
    expect(ghost.innerHTML).toBe(h.querySelector(".crown")!.innerHTML);
  });

  it("starts the drag without throwing where setDragImage is missing (jsdom / older engines)", () => {
    const h = render({ commits, refs });
    const crown = h.querySelector(".crown")!;
    // fireDrag's dataTransfer has no setDragImage at all.
    expect(() => fireDrag(crown, "dragstart")).not.toThrow();
  });

  it("hides the on-screen crown while a head drag is in flight, and restores it after dragend", () => {
    const h = render({ commits, refs });
    const crown = h.querySelector(".crown")!;
    expect(crown.classList.contains("crown-dragging")).toBe(false);
    fireDrag(crown, "dragstart");
    flushSync();
    expect(crown.classList.contains("crown-dragging")).toBe(true);
    fireDrag(crown, "dragend");
    flushSync();
    expect(crown.classList.contains("crown-dragging")).toBe(false);
  });

  it("leaves the crown visible while a COMMIT drag is in flight", () => {
    const h = render({ commits, refs });
    fireDrag(handles(h)[1], "dragstart");
    flushSync();
    expect(
      h.querySelector(".crown")!.classList.contains("crown-dragging"),
    ).toBe(false);
  });
});

// jsdom has no layout, so getBoundingClientRect on the content is all-zero and
// client coords map straight to content-local coords. Node centres are at
// rowY(i) = PAD_TOP(100) + i*56 + 28 → c3=128, c2=184, c1=240 (x is irrelevant
// here since we sweep a very wide box). PointerEvent isn't implemented, so we
// dispatch pointer-typed MouseEvents (the handlers only read clientX/Y +
// pointerId).
function firePointer(
  el: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
  mods: Partial<MouseEventInit> = {},
) {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
    ...mods,
  });
  Object.defineProperty(ev, "pointerId", { value: 1 });
  el.dispatchEvent(ev);
  return ev;
}

/** Sweep a wide box over rows y=160..250 → encloses c2 and c1 (not c3). */
function sweep(content: Element, mods: Partial<MouseEventInit> = {}) {
  firePointer(content, "pointerdown", -5000, 160, mods);
  firePointer(content, "pointermove", 5000, 250, mods);
  firePointer(content, "pointerup", 5000, 250, mods);
}

describe("MetroGraph marquee selection", () => {
  it("a wide sweep selects the enclosed nodes, newest-first, done=true", () => {
    const onMarquee = vi.fn();
    const h = render({ commits, refs, onMarquee });
    sweep(h.querySelector(".content")!);
    expect(onMarquee).toHaveBeenCalled();
    const [range, m, done] = onMarquee.mock.lastCall!;
    expect(range).toEqual(["c2", "c1"]);
    expect(m).toEqual({ shift: false, meta: false, ctrl: false });
    expect(done).toBe(true);
  });

  it("carries Shift (add) and ⌘/Ctrl (toggle) modifiers", () => {
    const onMarquee = vi.fn();
    const h = render({ commits, refs, onMarquee });
    const content = h.querySelector(".content")!;
    sweep(content, { shiftKey: true });
    expect(onMarquee.mock.lastCall![1]).toMatchObject({ shift: true });
    onMarquee.mockClear();
    sweep(content, { metaKey: true });
    expect(onMarquee.mock.lastCall![1]).toMatchObject({ meta: true });
  });

  it("a press without travel is a click, not a sweep", () => {
    const onMarquee = vi.fn();
    const h = render({ commits, refs, onMarquee });
    const content = h.querySelector(".content")!;
    firePointer(content, "pointerdown", 100, 150);
    firePointer(content, "pointerup", 101, 151); // within threshold
    expect(onMarquee).not.toHaveBeenCalled();
    expect(h.querySelector(".marquee")).toBeNull();
  });

  it("does not start a sweep when the press begins on a node handle", () => {
    const onMarquee = vi.fn();
    const h = render({ commits, refs, onMarquee });
    const handle = handles(h)[1];
    firePointer(handle, "pointerdown", 0, 152);
    firePointer(h.querySelector(".content")!, "pointermove", 400, 300);
    expect(onMarquee).not.toHaveBeenCalled();
  });

  it("clicking the HEAD crown selects HEAD (single-select)", () => {
    const onSelect = vi.fn();
    const h = render({ commits, refs, onSelect });
    (h.querySelector(".crown") as HTMLDivElement).click();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].sha).toBe("c3"); // HEAD tip
  });

  it("a plain press on empty space clears the whole selection", () => {
    const onClearSelection = vi.fn();
    const h = render({ commits, refs, onClearSelection });
    const content = h.querySelector(".content")!;
    firePointer(content, "pointerdown", 5, 5); // target = content → background
    firePointer(content, "pointerup", 5, 5); // no travel → a click
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it("a plain press on a commit row does not clear the selection", () => {
    const onClearSelection = vi.fn();
    const h = render({ commits, refs, onClearSelection });
    firePointer(rows(h)[1], "pointerdown", 100, 152); // target = row
    firePointer(h.querySelector(".content")!, "pointerup", 100, 152);
    expect(onClearSelection).not.toHaveBeenCalled();
  });

  it("a sweep over empty space does not fire the clear (it's a marquee)", () => {
    const onClearSelection = vi.fn();
    const h = render({ commits, refs, onClearSelection });
    sweep(h.querySelector(".content")!);
    expect(onClearSelection).not.toHaveBeenCalled();
  });
});

describe("commit double-click (checkout the pointing branch)", () => {
  it("dblclick on a node handle fires onCommitActivate with that commit", () => {
    const onCommitActivate = vi.fn();
    const h = render({ commits, refs, onCommitActivate });
    handles(h)[1].dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
    );
    expect(onCommitActivate).toHaveBeenCalledTimes(1);
    expect(onCommitActivate.mock.calls[0][0].sha).toBe("c2");
  });
});

describe("commit node context menu", () => {
  it("right-click on the circle's handle opens the commit menu", () => {
    const onCommitMenu = vi.fn();
    const h = render({ commits, refs, onCommitMenu });
    const ev = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 60,
    });
    handles(h)[1].dispatchEvent(ev);
    expect(onCommitMenu).toHaveBeenCalledTimes(1);
    expect(onCommitMenu.mock.calls[0][0].sha).toBe("c2");
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe("MetroGraph WKWebView modifier workaround (kbMods)", () => {
  // macOS WKWebView delivers every DragEvent with the modifier flags FALSE,
  // so the gesture grammar must fall back to window-level keyboard tracking.
  // These drags carry NO flags on the drag events themselves.
  function pressKey(shiftKey = false, altKey = false) {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { shiftKey, altKey, bubbles: true }),
    );
  }

  it("Shift tracked from the window turns a flagless branch drop into rebase", () => {
    const onGesture = vi.fn();
    const h = render({ commits, refs, onGesture });
    pressKey(true, false);
    flushSync();
    dragOnto(branchChip(h, "feature"), branchChip(h, "main")); // no event mods
    expect(onGesture).toHaveBeenCalledWith({ op: "rebase", onto: "feature" });
  });

  it("Alt tracked from the window turns a flagless commit drop into cherry-pick", () => {
    const onGesture = vi.fn();
    const h = render({ commits, refs, onGesture });
    pressKey(false, true);
    flushSync();
    dragOnto(handles(h)[2], branchChip(h, "main")); // no event mods
    expect(onGesture).toHaveBeenCalledWith({
      op: "cherryPick",
      commits: ["c1"],
    });
  });

  it("the tracked state clears when the drag ends, so the next plain drag merges", () => {
    const onGesture = vi.fn();
    const h = render({ commits, refs, onGesture });
    pressKey(true, false);
    flushSync();
    dragOnto(branchChip(h, "feature"), branchChip(h, "main"));
    expect(onGesture).toHaveBeenLastCalledWith({
      op: "rebase",
      onto: "feature",
    });
    // endDrag cleared kbMods; a flagless follow-up drag is a plain merge.
    dragOnto(branchChip(h, "feature"), branchChip(h, "main"));
    expect(onGesture).toHaveBeenLastCalledWith({
      op: "merge",
      source: "feature",
    });
  });

  it("keyup re-sync: releasing Shift before the drop downgrades rebase to merge", () => {
    const onGesture = vi.fn();
    const h = render({ commits, refs, onGesture });
    pressKey(true, false);
    window.dispatchEvent(
      new KeyboardEvent("keyup", { shiftKey: false, bubbles: true }),
    );
    flushSync();
    dragOnto(branchChip(h, "feature"), branchChip(h, "main"));
    expect(onGesture).toHaveBeenCalledWith({ op: "merge", source: "feature" });
  });
});

describe("MetroGraph native modifier poll (WKWebView mid-drag key events)", () => {
  // Once a native drag session starts, WKWebView delivers no keyboard events
  // to the page at all, so the pre-drag kbMods tracking above (keydown/
  // keyup/pointerdown) can never see a Shift pressed mid-drag. These tests
  // drive that scenario directly: no keyboard event is dispatched anywhere,
  // only the mocked `pollNativeModifiers` reports the "hardware" state.

  it("a Shift the poller reports mid-drag resolves rebase, though no keyboard event ever fired", async () => {
    vi.useFakeTimers();
    pollNativeModifiers.mockResolvedValue({
      shift: true,
      alt: false,
      meta: false,
      ctrl: false,
    });
    const onGesture = vi.fn();
    const h = render({ commits, refs, onGesture });

    fireDrag(branchChip(h, "feature"), "dragstart");
    await vi.advanceTimersByTimeAsync(80); // one poll tick: kbMods <- {shift:true,...}

    fireDrag(branchChip(h, "main"), "dragover"); // no event-level modifiers
    flushSync();
    expect(
      branchChip(h, "main").querySelector(".afford.dashed"),
    ).not.toBeNull();

    fireDrag(branchChip(h, "main"), "drop"); // no event-level modifiers either
    expect(onGesture).toHaveBeenCalledWith({ op: "rebase", onto: "feature" });
  });

  it("stops polling once the drag ends and leaves no stale modifier for the next drag", async () => {
    vi.useFakeTimers();
    pollNativeModifiers.mockResolvedValue({
      shift: true,
      alt: false,
      meta: false,
      ctrl: false,
    });
    const onGesture = vi.fn();
    const h = render({ commits, refs, onGesture });

    fireDrag(branchChip(h, "feature"), "dragstart");
    await vi.advanceTimersByTimeAsync(80);
    fireDrag(branchChip(h, "main"), "dragover");
    fireDrag(branchChip(h, "main"), "drop"); // dropOn calls endDrag() -> stops the poll
    expect(onGesture).toHaveBeenLastCalledWith({
      op: "rebase",
      onto: "feature",
    });

    const callsAtDrop = pollNativeModifiers.mock.calls.length;
    // Advance well past several more would-be 80ms ticks; none should land.
    await vi.advanceTimersByTimeAsync(500);
    expect(pollNativeModifiers).toHaveBeenCalledTimes(callsAtDrop);

    // kbMods was cleared at endDrag; a fresh drag+drop with no elapsed poll
    // time (so no new tick landed yet) is a plain merge, not a rebase.
    fireDrag(branchChip(h, "feature"), "dragstart");
    fireDrag(branchChip(h, "main"), "dragover");
    fireDrag(branchChip(h, "main"), "drop");
    expect(onGesture).toHaveBeenLastCalledWith({
      op: "merge",
      source: "feature",
    });
  });

  it("stops polling once the native side reports null (non-macOS: nothing to poll)", async () => {
    vi.useFakeTimers();
    pollNativeModifiers.mockResolvedValue(null);
    const h = render({ commits, refs });

    fireDrag(branchChip(h, "feature"), "dragstart");
    await vi.advanceTimersByTimeAsync(80);
    expect(pollNativeModifiers).toHaveBeenCalledTimes(1);

    // Several more 80ms ticks would have landed if the interval were still
    // running; it isn't, since the first `null` response stops it.
    await vi.advanceTimersByTimeAsync(500);
    expect(pollNativeModifiers).toHaveBeenCalledTimes(1);
  });
});

describe("MetroGraph hand tool (pan)", () => {
  it("marks the content with the grab-cursor class while the tool is on", () => {
    const h = render({ commits, refs, handTool: true });
    expect(h.querySelector(".content")!.classList.contains("hand")).toBe(true);
  });

  it("a left-drag pans the scroller and never starts a marquee/selection", () => {
    const onMarquee = vi.fn();
    const onClearSelection = vi.fn();
    const h = render({
      commits,
      refs,
      handTool: true,
      onMarquee,
      onClearSelection,
    });

    // jsdom has no real scroll extent, so back scrollLeft/scrollTop with plain
    // fields to observe the pan's reads/writes.
    const scroller = h.querySelector(".scroller") as HTMLElement;
    let left = 40;
    let top = 80;
    Object.defineProperty(scroller, "scrollLeft", {
      configurable: true,
      get: () => left,
      set: (v) => (left = v),
    });
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (v) => (top = v),
    });

    const content = h.querySelector(".content")!;
    firePointer(content, "pointerdown", 200, 300);
    firePointer(content, "pointermove", 170, 260); // moved (-30, -40)
    // Pan follows the drag: offset = start − delta → 40−(−30)=70, 80−(−40)=120.
    expect(left).toBe(70);
    expect(top).toBe(120);
    firePointer(content, "pointerup", 170, 260);

    // Hand mode suppresses selection entirely.
    expect(onMarquee).not.toHaveBeenCalled();
    expect(onClearSelection).not.toHaveBeenCalled();
  });

  it("leaves the marquee working when the tool is off", () => {
    const onMarquee = vi.fn();
    const h = render({ commits, refs, handTool: false, onMarquee });
    expect(h.querySelector(".content")!.classList.contains("hand")).toBe(false);
    sweep(h.querySelector(".content")!);
    expect(onMarquee).toHaveBeenCalled();
  });
});

// Dragging the HEAD crown onto a commit (or a branch label) resets the current
// branch there. While the drag HOVERS a legal target, everything the reset
// would drop off the branch renders de-emphasized (`.discarding`) — a preview
// of the consequence, deliberately a different class from `.ghost` (commits
// orphaned by a PAST rewrite, a data fact carried on `Commit.ghost`).
describe("MetroGraph HEAD-crown reset preview", () => {
  /** Subjects of every commit currently previewed as "would be discarded". */
  function discarding(h: HTMLDivElement): string[] {
    return [...h.querySelectorAll(".subject.discarding")].map((e) =>
      (e.textContent ?? "").trim(),
    );
  }

  /** `dragend` with an explicit `dropEffect`: `'none'` is the browser's
   *  cancel signal, anything else means the drop was taken. */
  function fireDragEnd(el: Element, dropEffect: string) {
    const ev = new MouseEvent("dragend", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "dataTransfer", { value: { dropEffect } });
    el.dispatchEvent(ev);
  }

  it("hovering a commit previews exactly the commits the reset would discard", () => {
    const h = render({ commits, refs });
    const crown = h.querySelector(".crown")!;
    fireDrag(crown, "dragstart");
    fireDrag(rows(h)[2], "dragover"); // reset onto c1
    flushSync();
    // c3 (HEAD) and c2 leave the branch; c1 — the target itself — stays.
    expect(discarding(h)).toEqual(["subject c3", "subject c2"]);
  });

  it("previews the same set when hovering a branch label (via that branch's tip)", () => {
    const h = render({ commits, refs });
    const crown = h.querySelector(".crown")!;
    fireDrag(crown, "dragstart");
    fireDrag(branchChip(h, "feature"), "dragover"); // feature is at c2
    flushSync();
    expect(discarding(h)).toEqual(["subject c3"]);
  });

  it("previews nothing for a target that discards nothing, while still accepting the drop", () => {
    // main (HEAD) is at c3; `ahead` is one commit further on at c4, so
    // resetting main onto it loses nothing at all.
    const fwdCommits = [
      commit("c4", ["c3"]),
      commit("c3", ["c2"]),
      commit("c2", ["c1"]),
      commit("c1"),
    ];
    const fwdRefs: RefList = {
      head: { branch: "main", target: "c3", detached: false },
      branches: [
        { name: "main", kind: "branch", target: "c3" },
        { name: "ahead", kind: "branch", target: "c4" },
      ],
      remotes: [],
      tags: [],
    };
    const h = render({ commits: fwdCommits, refs: fwdRefs });
    const crown = h.querySelector(".crown")!;
    fireDrag(crown, "dragstart");
    fireDrag(rows(h)[0], "dragover"); // c4
    flushSync();
    // "Nothing would be lost" — no ghosts, but the target still lights up as
    // a live drop target, so the empty preview can't read as a broken one.
    expect(discarding(h)).toEqual([]);
    expect(rows(h)[0].classList.contains("drop-target")).toBe(true);
  });

  it("previews nothing while hovering HEAD's own commit (an illegal, lossless drop)", () => {
    const h = render({ commits, refs });
    const crown = h.querySelector(".crown")!;
    fireDrag(crown, "dragstart");
    fireDrag(rows(h)[0], "dragover"); // c3 = HEAD
    flushSync();
    expect(discarding(h)).toEqual([]);
  });

  it("clears the preview on drop", () => {
    const h = render({ commits, refs });
    const crown = h.querySelector(".crown")!;
    fireDrag(crown, "dragstart");
    fireDrag(rows(h)[2], "dragover");
    flushSync();
    expect(discarding(h)).toHaveLength(2);
    fireDrag(rows(h)[2], "drop");
    flushSync();
    expect(discarding(h)).toEqual([]);
  });

  it("clears the preview when the drag is cancelled", () => {
    const h = render({ commits, refs });
    const crown = h.querySelector(".crown")!;
    fireDrag(crown, "dragstart");
    fireDrag(rows(h)[2], "dragover");
    flushSync();
    expect(discarding(h)).toHaveLength(2);
    fireDragEnd(crown, "none");
    flushSync();
    expect(discarding(h)).toEqual([]);
  });

  it("leaves real history-rewrite ghosts alone: the preview is a second, separate class", () => {
    const withGhost = [
      commit("c3", ["c2"]),
      { ...commit("c2", ["c1"]), ghost: true },
      commit("c1"),
    ];
    const h = render({ commits: withGhost, refs });
    const subjects = [...h.querySelectorAll(".subject")];
    const [s3, s2, s1] = subjects;
    expect(s2.classList.contains("ghost")).toBe(true);

    const crown = h.querySelector(".crown")!;
    fireDrag(crown, "dragstart");
    fireDrag(rows(h)[2], "dragover"); // reset onto c1
    flushSync();
    // c2 is BOTH a real orphan and part of what this reset would drop: it
    // carries both classes, and keeps the rewrite ghost's own treatment.
    expect(s2.classList.contains("ghost")).toBe(true);
    expect(s2.classList.contains("discarding")).toBe(true);
    expect(s3.classList.contains("ghost")).toBe(false);
    expect(s3.classList.contains("discarding")).toBe(true);
    expect(s1.classList.contains("discarding")).toBe(false);

    fireDragEnd(crown, "none");
    flushSync();
    // The preview goes; the data-driven ghost stays.
    expect(s2.classList.contains("discarding")).toBe(false);
    expect(s2.classList.contains("ghost")).toBe(true);
  });

  it("flies the crown home on a cancelled drag, then settles", () => {
    vi.useFakeTimers();
    const h = render({ commits, refs });
    const crown = h.querySelector(".crown")!;
    fireDrag(crown, "dragstart");
    fireDrag(rows(h)[2], "dragover"); // records the cursor to fly back from
    flushSync();
    expect(crown.classList.contains("crown-dragging")).toBe(true);

    fireDragEnd(crown, "none");
    flushSync();
    expect(crown.classList.contains("crown-returning")).toBe(true);
    // The crown is visible again for the flight, and carries the offset the
    // CSS keyframe animates away from.
    expect(crown.classList.contains("crown-dragging")).toBe(false);
    expect(crown.getAttribute("style")).toContain("--crown-return-dy");

    vi.advanceTimersByTime(200);
    flushSync();
    expect(crown.classList.contains("crown-returning")).toBe(false);
  });

  it("does NOT fly the crown home after a successful drop", () => {
    const onGesture = vi.fn();
    const h = render({ commits, refs, onGesture });
    const crown = h.querySelector(".crown")!;
    dragOnto(crown, rows(h)[2]);
    expect(onGesture).toHaveBeenCalled();
    // Even if the browser reports 'none' on the trailing dragend, a drop was
    // dispatched — the crown belongs at its new home, not back at the old one.
    fireDragEnd(crown, "none");
    flushSync();
    expect(crown.classList.contains("crown-returning")).toBe(false);
  });

  it("returns the crown instantly under prefers-reduced-motion", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((q: string) => ({
        matches: q.includes("prefers-reduced-motion"),
        media: q,
        addEventListener() {},
        removeEventListener() {},
      })),
    );
    try {
      const h = render({ commits, refs });
      const crown = h.querySelector(".crown")!;
      fireDrag(crown, "dragstart");
      fireDrag(rows(h)[2], "dragover");
      flushSync();
      fireDragEnd(crown, "none");
      flushSync();
      // No flight at all — nothing left mid-air, no class to clean up.
      expect(crown.classList.contains("crown-returning")).toBe(false);
      expect(crown.classList.contains("crown-dragging")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/**
 * One drop TARGET is several ELEMENTS. `.row` and the `.node-handle` over it
 * both carry `commit:<sha>`, and a themed sprite bigger than its handle leaves
 * a band of bare `.row` around every node — so a drag crosses that boundary
 * twice per node even though it never leaves the target.
 *
 * The HTML5 DnD spec fires `dragenter` on the element being ENTERED before
 * `dragleave` on the one being LEFT, so a leave handler that clears on key
 * alone wipes the hover the enter just painted, one frame before the next
 * `dragover` puts it back. At a thousand commits that is a full O(commits)
 * teardown plus a full O(commits) rebuild of the `discardShas` fan-out per
 * crossing, and a visible blink of the reset preview and the "+" affordance.
 *
 * These pin the BEHAVIOUR (does the hover survive / does it clear), not any
 * timing: what `leaveTarget`'s eager clear protects — a genuine departure
 * clearing immediately, in the same synchronous handler — is the fourth case.
 */
describe("MetroGraph drop-hover across same-key elements", () => {
  function discarding(h: HTMLDivElement): string[] {
    return [...h.querySelectorAll(".subject.discarding")].map((e) =>
      (e.textContent ?? "").trim(),
    );
  }

  /** Crown-drag onto row 2 (reset to c1), the state every case starts from. */
  function hovering(): { h: HTMLDivElement; crown: Element } {
    const h = render({ commits, refs });
    const crown = h.querySelector(".crown")!;
    fireDrag(crown, "dragstart");
    fireDrag(rows(h)[2], "dragenter");
    fireDrag(rows(h)[2], "dragover");
    flushSync();
    expect(discarding(h)).toHaveLength(2);
    return { h, crown };
  }

  it("moving from a row onto its OWN node handle keeps the hover", () => {
    const { h } = hovering();
    // Enter the handle over the same commit, then leave the row under it.
    fireDrag(handles(h)[2], "dragenter");
    fireDrag(rows(h)[2], "dragleave");
    flushSync();
    expect(discarding(h)).toHaveLength(2);
    expect(rows(h)[2].classList.contains("drop-target")).toBe(true);
  });

  it("moving from a node handle back out onto its own row keeps the hover", () => {
    const { h } = hovering();
    fireDrag(handles(h)[2], "dragenter");
    fireDrag(rows(h)[2], "dragleave");
    flushSync();
    // ...and back out across the same boundary, the other way.
    fireDrag(rows(h)[2], "dragenter");
    fireDrag(handles(h)[2], "dragleave");
    flushSync();
    expect(discarding(h)).toHaveLength(2);
  });

  it("does not blank the hover when the pointer has entered a DIFFERENT target", () => {
    const { h } = hovering();
    // Row 1 is c2: entering it repaints the preview for that target, and the
    // trailing leave from row 2 must not undo it.
    fireDrag(rows(h)[1], "dragenter");
    fireDrag(rows(h)[2], "dragleave");
    flushSync();
    expect(discarding(h)).toEqual(["subject c3"]);
    expect(rows(h)[1].classList.contains("drop-target")).toBe(true);
    expect(rows(h)[2].classList.contains("drop-target")).toBe(false);
  });

  it("clears at once when the drag leaves the target for good", () => {
    const { h } = hovering();
    // Both elements of the target entered, then both left, with nothing new
    // entered: this IS a departure, and it clears in the leave handler
    // itself — no waiting for a later event.
    fireDrag(handles(h)[2], "dragenter");
    fireDrag(rows(h)[2], "dragleave");
    fireDrag(handles(h)[2], "dragleave");
    flushSync();
    expect(discarding(h)).toEqual([]);
    expect(rows(h)[2].classList.contains("drop-target")).toBe(false);
  });

  it("a leave with no matching enter still clears, as it always did", () => {
    // `overTarget` is wired to dragover as well as dragenter, and older call
    // paths (and jsdom tests) reach a target by dragover alone. Such a hover
    // has no enter to pair with, and must still clear on leave rather than
    // sticking.
    const h = render({ commits, refs });
    const crown = h.querySelector(".crown")!;
    fireDrag(crown, "dragstart");
    fireDrag(rows(h)[2], "dragover");
    flushSync();
    expect(discarding(h)).toHaveLength(2);
    fireDrag(rows(h)[2], "dragleave");
    flushSync();
    expect(discarding(h)).toEqual([]);
  });

  it("a new gesture starts from a clean count after a target unmounted mid-drag", () => {
    // An element removed mid-drag never fires its `dragleave`, so the count it
    // was holding leaks. `endDrag` resets it, or the NEXT drag's first leave
    // would find a non-zero count and refuse to clear.
    const { h, crown } = hovering();
    fireDrag(handles(h)[2], "dragenter"); // count 2, only one of which leaves
    fireDrag(crown, "dragend");
    flushSync();
    expect(discarding(h)).toEqual([]);

    fireDrag(crown, "dragstart");
    fireDrag(rows(h)[2], "dragenter");
    fireDrag(rows(h)[2], "dragover");
    flushSync();
    expect(discarding(h)).toHaveLength(2);
    fireDrag(rows(h)[2], "dragleave");
    flushSync();
    expect(discarding(h)).toEqual([]);
  });
});
