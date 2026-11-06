import { describe, it, expect, beforeEach, vi } from "vitest";

const mem = new Map<string, unknown>();
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async (k: string) => mem.get(k)),
    set: vi.fn(async (k: string, v: unknown) => {
      mem.set(k, v);
    }),
    delete: vi.fn(async (k: string) => mem.delete(k)),
  })),
}));

import { loadRepoAccessToken, setRepoAccessToken } from "./repoSecrets";

const REPO_A = "/repo-a";
const REPO_B = "/repo-b";

beforeEach(() => mem.clear());

describe("loadRepoAccessToken", () => {
  it("resolves to '' for a repo that has never had a token stored", async () => {
    expect(await loadRepoAccessToken(REPO_A)).toBe("");
  });

  it("resolves the stored token after setRepoAccessToken", async () => {
    await setRepoAccessToken(REPO_A, "ghp_abc123");
    expect(await loadRepoAccessToken(REPO_A)).toBe("ghp_abc123");
  });

  it("is keyed per-repo — one repo's token never leaks into another's read", async () => {
    await setRepoAccessToken(REPO_A, "token-a");
    await setRepoAccessToken(REPO_B, "token-b");
    expect(await loadRepoAccessToken(REPO_A)).toBe("token-a");
    expect(await loadRepoAccessToken(REPO_B)).toBe("token-b");
  });

  it("defensively yields '' for a corrupt/wrong-typed stored value", async () => {
    mem.set(REPO_A, { accessToken: 42 });
    expect(await loadRepoAccessToken(REPO_A)).toBe("");
    mem.set(REPO_A, "just a string, not an object");
    expect(await loadRepoAccessToken(REPO_A)).toBe("");
  });
});

describe("setRepoAccessToken", () => {
  it("an empty string clears any previously stored token", async () => {
    await setRepoAccessToken(REPO_A, "ghp_abc123");
    expect(await loadRepoAccessToken(REPO_A)).toBe("ghp_abc123");
    await setRepoAccessToken(REPO_A, "");
    expect(await loadRepoAccessToken(REPO_A)).toBe("");
    expect(mem.has(REPO_A)).toBe(false);
  });

  it("overwriting one repo's token does not disturb another's", async () => {
    await setRepoAccessToken(REPO_A, "token-a");
    await setRepoAccessToken(REPO_B, "token-b");
    await setRepoAccessToken(REPO_A, "token-a-updated");
    expect(await loadRepoAccessToken(REPO_A)).toBe("token-a-updated");
    expect(await loadRepoAccessToken(REPO_B)).toBe("token-b");
  });
});
