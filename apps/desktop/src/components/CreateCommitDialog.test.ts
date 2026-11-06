import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import CreateCommitDialog from "./CreateCommitDialog.svelte";
import CreateCommitDialogTestHost from "./CreateCommitDialogTestHost.svelte";

const repoStatus = vi.fn<(r: string) => Promise<unknown>>();
const stagePaths = vi.fn<(r: string, p: string[]) => Promise<void>>(() =>
  Promise.resolve(),
);
const unstagePaths = vi.fn<(r: string, p: string[]) => Promise<void>>(() =>
  Promise.resolve(),
);
const createCommit = vi.fn<(r: string, m: string) => Promise<string>>(() =>
  Promise.resolve("newsha"),
);

vi.mock("../lib/ipc", () => ({
  repoStatus: (r: string) => repoStatus(r),
  stagePaths: (r: string, p: string[]) => stagePaths(r, p),
  unstagePaths: (r: string, p: string[]) => unstagePaths(r, p),
  createCommit: (r: string, m: string) => createCommit(r, m),
  errorText: (e: unknown) => String(e),
}));

const status = {
  staged: [{ path: "a.ts", status: "modified", old_path: null }],
  changed: [{ path: "b.ts", status: "modified", old_path: null }],
  untracked: [{ path: "c.ts", status: "new", old_path: null }],
  ignored: [],
};

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

beforeEach(() => {
  // `mockReset` also drops any queued `mockResolvedValueOnce` sequencing
  // (and the call-count history) so each test starts from a clean slate —
  // the reload tests below assert exact `repoStatus` call counts.
  repoStatus.mockReset().mockResolvedValue(status);
  stagePaths.mockClear();
  unstagePaths.mockClear();
  createCommit.mockClear();
});
afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
});

async function settle() {
  flushSync();
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
}

function render(props: Record<string, unknown>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(CreateCommitDialog, {
    target: host,
    props: { repoPath: "/r", ...props },
  });
  return host;
}

// Svelte 5 `mount()` props are captured once and aren't reactive from the
// outside — a real bump of `reloadKey` on an already-mounted dialog needs a
// host component that owns it as `$state` (see CreateCommitDialogTestHost).
function renderHost(props: Record<string, unknown>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(CreateCommitDialogTestHost, {
    target: host,
    props: { repoPath: "/r", ...props },
  });
  return host;
}

function rows() {
  return [...host.querySelectorAll<HTMLLabelElement>("label.row")];
}
function commitBtn() {
  return [...host.querySelectorAll<HTMLButtonElement>("button.btn")].find(
    (b) => !b.classList.contains("ghost"),
  )!;
}
function setMessage(text: string) {
  const ta = host.querySelector<HTMLTextAreaElement>("textarea")!;
  ta.value = text;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
}

describe("CreateCommitDialog", () => {
  it("lists stageable files with staged ones pre-checked", async () => {
    render({});
    await settle();
    expect(rows()).toHaveLength(3); // a.ts (staged) + b.ts + c.ts
    const boxes = host.querySelectorAll<HTMLInputElement>(
      "label.row input[type=checkbox]",
    );
    expect(boxes[0].checked).toBe(true); // a.ts staged → pre-checked
    expect(boxes[1].checked).toBe(false);
    expect(boxes[2].checked).toBe(false);
  });

  it("commits the pre-checked staged file without re-staging", async () => {
    const onCommitted = vi.fn();
    const onClose = vi.fn();
    render({ onCommitted, onClose });
    await settle();
    setMessage("hello");
    commitBtn().click();
    await settle();
    expect(stagePaths).not.toHaveBeenCalled();
    expect(unstagePaths).not.toHaveBeenCalled();
    expect(createCommit).toHaveBeenCalledWith("/r", "hello");
    expect(onCommitted).toHaveBeenCalledWith("newsha");
    expect(onClose).toHaveBeenCalled();
  });

  it("stages a newly-checked file before committing", async () => {
    render({});
    await settle();
    const boxes = host.querySelectorAll<HTMLInputElement>(
      "label.row input[type=checkbox]",
    );
    boxes[1].checked = true; // check b.ts
    boxes[1].dispatchEvent(new Event("change", { bubbles: true }));
    flushSync();
    setMessage("msg");
    commitBtn().click();
    await settle();
    expect(stagePaths).toHaveBeenCalledWith("/r", ["b.ts"]);
    expect(createCommit).toHaveBeenCalledWith("/r", "msg");
  });

  it("disables commit until there is a message and a selection", async () => {
    render({});
    await settle();
    // a.ts pre-checked but no message yet → disabled.
    expect(commitBtn().disabled).toBe(true);
    setMessage("x");
    expect(commitBtn().disabled).toBe(false);
  });
});

describe("CreateCommitDialog reload (focus-triggered refresh)", () => {
  it("reloads status when reloadKey bumps and shows a newly-appeared file", async () => {
    const second = {
      staged: [{ path: "a.ts", status: "modified", old_path: null }],
      changed: [{ path: "b.ts", status: "modified", old_path: null }],
      untracked: [
        { path: "c.ts", status: "new", old_path: null },
        { path: "d.ts", status: "new", old_path: null },
      ],
      ignored: [],
    };
    repoStatus.mockResolvedValueOnce(status).mockResolvedValueOnce(second);

    renderHost({});
    await settle();
    expect(repoStatus).toHaveBeenCalledTimes(1);
    expect(rows()).toHaveLength(3);

    app.bump();
    await settle();

    expect(repoStatus).toHaveBeenCalledTimes(2);
    const paths = rows().map(
      (r) => r.querySelector<HTMLSpanElement>("span.path")!.textContent,
    );
    expect(paths).toContain("d.ts");
  });

  it("preserves checkbox choices across a reload, defaulting new rows to unchecked", async () => {
    const first = {
      staged: [{ path: "a.ts", status: "modified", old_path: null }],
      changed: [{ path: "b.ts", status: "modified", old_path: null }],
      untracked: [],
      ignored: [],
    };
    const second = {
      staged: [{ path: "a.ts", status: "modified", old_path: null }],
      changed: [{ path: "b.ts", status: "modified", old_path: null }],
      untracked: [{ path: "c.ts", status: "new", old_path: null }],
      ignored: [],
    };
    repoStatus.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    renderHost({});
    await settle();
    const boxes = () =>
      host.querySelectorAll<HTMLInputElement>("label.row input[type=checkbox]");
    expect(rows()).toHaveLength(2); // a.ts (staged) + b.ts
    expect(boxes()[0].checked).toBe(true); // a.ts staged → pre-checked
    expect(boxes()[1].checked).toBe(false); // b.ts → unchecked

    // User flips both: unchecks a.ts, checks b.ts.
    boxes()[0].checked = false;
    boxes()[0].dispatchEvent(new Event("change", { bubbles: true }));
    boxes()[1].checked = true;
    boxes()[1].dispatchEvent(new Event("change", { bubbles: true }));
    flushSync();
    expect(boxes()[0].checked).toBe(false);
    expect(boxes()[1].checked).toBe(true);

    app.bump();
    await settle();

    expect(repoStatus).toHaveBeenCalledTimes(2);
    expect(rows()).toHaveLength(3); // a.ts + b.ts + new c.ts
    const after = boxes();
    expect(after[0].checked).toBe(false); // a.ts stays unchecked (preserved)
    expect(after[1].checked).toBe(true); // b.ts stays checked (preserved)
    expect(after[2].checked).toBe(false); // c.ts is new → default unchecked
  });
});
