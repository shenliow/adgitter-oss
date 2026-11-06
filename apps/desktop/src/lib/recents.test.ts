import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory fake of the plugin-store keyed file.
const mem = new Map<string, unknown>();
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async (k: string) => mem.get(k)),
    set: vi.fn(async (k: string, v: unknown) => {
      mem.set(k, v);
    }),
    save: vi.fn(async () => {}),
  })),
}));

import {
  mergeRecent,
  addRecent,
  listRecents,
  removeRecent,
  RECENTS_CAP,
  type RecentProject,
} from "./recents";

const p = (path: string, name = path): RecentProject => ({
  path,
  name,
  lastOpened: 1,
});

beforeEach(() => mem.clear());

describe("mergeRecent (pure)", () => {
  it("moves an existing path to the front without duplicating", () => {
    const list = [p("/a"), p("/b"), p("/c")];
    const out = mergeRecent(list, p("/c", "C"));
    expect(out.map((r) => r.path)).toEqual(["/c", "/a", "/b"]);
    expect(out[0].name).toBe("C");
  });

  it("prepends a new path", () => {
    expect(mergeRecent([p("/a")], p("/b")).map((r) => r.path)).toEqual([
      "/b",
      "/a",
    ]);
  });

  it("caps the list at RECENTS_CAP", () => {
    const many = Array.from({ length: RECENTS_CAP + 3 }, (_, i) => p(`/r${i}`));
    const out = mergeRecent(many, p("/new"));
    expect(out).toHaveLength(RECENTS_CAP);
    expect(out[0].path).toBe("/new");
  });
});

describe("store-backed recents", () => {
  it("addRecent persists and lists most-recent-first", async () => {
    await addRecent({ path: "/a", name: "A" });
    await addRecent({ path: "/b", name: "B" });
    expect((await listRecents()).map((r) => r.path)).toEqual(["/b", "/a"]);
  });

  it("addRecent stamps lastOpened when omitted", async () => {
    const before = Date.now();
    const [entry] = await addRecent({ path: "/a", name: "A" });
    expect(entry.lastOpened).toBeGreaterThanOrEqual(before);
  });

  it("removeRecent drops the entry", async () => {
    await addRecent({ path: "/a", name: "A" });
    await addRecent({ path: "/b", name: "B" });
    const after = await removeRecent("/a");
    expect(after.map((r) => r.path)).toEqual(["/b"]);
  });

  it("listRecents is empty initially", async () => {
    expect(await listRecents()).toEqual([]);
  });
});
