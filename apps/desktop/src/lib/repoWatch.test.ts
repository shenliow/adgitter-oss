import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// subscribeRepoChanged listens window-scoped (multi-window: each window
// watches its own repo) via getCurrentWindow().listen — not exercised by the
// tests below (they only cover the scheduler/gate/selection helpers), but
// mocked so importing this module never touches the real Tauri window API.
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    listen: vi.fn(async () => () => {}),
  }),
}));

import {
  createRefreshScheduler,
  createFocusGate,
  preserveSelection,
  DEBOUNCE_MS,
} from "./repoWatch";
import type { Commit } from "./ipc";

function commit(sha: string): Commit {
  return {
    sha,
    short_sha: sha.slice(0, 7),
    author_name: "T",
    author_email: "t@e.com",
    timestamp: 0,
    subject: sha,
    body: "",
    parents: [],
  };
}

describe("createRefreshScheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces a burst of events into a single refresh", async () => {
    const refresh = vi.fn(async () => {});
    const s = createRefreshScheduler(refresh);
    s.schedule();
    s.schedule();
    vi.advanceTimersByTime(DEBOUNCE_MS - 10);
    s.schedule();
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    await vi.runAllTimersAsync();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("coalesces changes during an in-flight refresh (latest-wins)", async () => {
    let resolveFirst: () => void = () => {};
    const refresh = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((r) => (resolveFirst = r)),
      )
      .mockImplementation(async () => {});
    const s = createRefreshScheduler(refresh);
    s.flushNow();
    expect(refresh).toHaveBeenCalledTimes(1);
    s.schedule();
    s.schedule();
    resolveFirst();
    await vi.runAllTimersAsync();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("cancel prevents a scheduled refresh", async () => {
    const refresh = vi.fn(async () => {});
    const s = createRefreshScheduler(refresh);
    s.schedule();
    s.cancel();
    vi.advanceTimersByTime(DEBOUNCE_MS * 2);
    await vi.runAllTimersAsync();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("createFocusGate", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs fn on the first call", () => {
    const fn = vi.fn();
    const gate = createFocusGate(fn);
    gate();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("swallows a second call within the window", () => {
    const fn = vi.fn();
    const gate = createFocusGate(fn, 200);
    gate();
    vi.advanceTimersByTime(50);
    gate();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("runs again once the window has elapsed", () => {
    const fn = vi.fn();
    const gate = createFocusGate(fn, 200);
    gate();
    vi.advanceTimersByTime(201);
    gate();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("preserveSelection", () => {
  it("keeps the selected commit when it still exists", () => {
    expect(
      preserveSelection(commit("abc"), [commit("abc"), commit("def")])?.sha,
    ).toBe("abc");
  });
  it("clears when the commit is gone", () => {
    expect(preserveSelection(commit("gone"), [commit("abc")])).toBeNull();
  });
  it("returns null when nothing selected", () => {
    expect(preserveSelection(null, [commit("abc")])).toBeNull();
  });
});
