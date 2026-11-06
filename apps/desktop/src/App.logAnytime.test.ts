import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanupApp,
  errorToast,
  ipc,
  mountApp,
  REPO_PATH,
  settle,
} from "./test/appHarness";

const INTERVAL = 60_000;
const snapshot = "a".repeat(40);

afterEach(() => {
  cleanupApp();
  vi.useRealTimers();
});

async function tick() {
  vi.advanceTimersByTime(INTERVAL);
  await settle();
}

describe("Log Anytime automatic push", () => {
  it("keeps automatic push off by default while recording snapshots", async () => {
    vi.useFakeTimers();
    await mountApp({
      settings: { logAnytime: { enabled: true, intervalMin: 1 } },
    });
    ipc.logCommit.mockResolvedValue(snapshot);
    await tick();
    expect(ipc.logCommit).toHaveBeenCalledWith(REPO_PATH, "adgitter-log");
    expect(ipc.pushBranch).not.toHaveBeenCalled();
  });

  it("pushes the configured log branch with repo credentials and remote override", async () => {
    vi.useFakeTimers();
    await mountApp({
      settings: {
        logAnytime: {
          enabled: true,
          autoPush: true,
          intervalMin: 1,
          branch: "backups/work",
        },
        general: { remoteUrl: "https://gitlab.com/u/r.git" },
      },
      remoteUrl: "git@gitlab.com:u/r.git",
      repoAccessToken: "glpat-test",
    });
    ipc.logCommit.mockResolvedValue(snapshot);
    await tick();
    expect(ipc.pushBranch).toHaveBeenCalledWith(
      REPO_PATH,
      "backups/work",
      "origin",
      { kind: "password", username: "oauth2", password: "glpat-test" },
      "https://gitlab.com/u/r.git",
    );
    expect(ipc.push).not.toHaveBeenCalled();
  });

  it("does not push an unchanged working tree or a failed snapshot", async () => {
    vi.useFakeTimers();
    await mountApp({
      settings: {
        logAnytime: { enabled: true, autoPush: true, intervalMin: 1 },
      },
    });
    ipc.logCommit
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("snapshot failed"));
    await tick();
    await tick();
    expect(ipc.logCommit).toHaveBeenCalledTimes(2);
    expect(ipc.pushBranch).not.toHaveBeenCalled();
  });

  it("does not record or push in dry run mode", async () => {
    vi.useFakeTimers();
    await mountApp({
      settings: {
        general: { dryRun: true },
        logAnytime: { enabled: true, autoPush: true, intervalMin: 1 },
      },
    });
    await tick();
    expect(ipc.logCommit).not.toHaveBeenCalled();
    expect(ipc.pushBranch).not.toHaveBeenCalled();
  });

  it("keeps recording locally but never sends a PAT to an HTTP remote", async () => {
    vi.useFakeTimers();
    await mountApp({
      settings: {
        general: { remoteUrl: "http://example.com/u/r.git" },
        logAnytime: { enabled: true, autoPush: true, intervalMin: 1 },
      },
      repoAccessToken: "private-test-token",
    });
    ipc.logCommit.mockResolvedValue(snapshot);
    await tick();
    expect(ipc.logCommit).toHaveBeenCalledTimes(1);
    expect(ipc.pushBranch).not.toHaveBeenCalled();
  });

  it("reports push failures and still records and pushes the next change", async () => {
    vi.useFakeTimers();
    const host = await mountApp({
      settings: {
        logAnytime: { enabled: true, autoPush: true, intervalMin: 1 },
      },
    });
    ipc.logCommit.mockResolvedValue(snapshot);
    ipc.pushBranch
      .mockRejectedValueOnce(new Error("remote unavailable"))
      .mockResolvedValue(undefined);
    await tick();
    expect(errorToast(host)).not.toBeNull();
    await tick();
    expect(ipc.logCommit).toHaveBeenCalledTimes(2);
    expect(ipc.pushBranch).toHaveBeenCalledTimes(2);
  });

  it("skips overlapping intervals while a push is still pending", async () => {
    vi.useFakeTimers();
    await mountApp({
      settings: {
        logAnytime: { enabled: true, autoPush: true, intervalMin: 1 },
      },
    });
    ipc.logCommit.mockResolvedValue(snapshot);
    let finishPush!: () => void;
    ipc.pushBranch.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishPush = resolve;
      }),
    );
    await tick();
    await tick();
    expect(ipc.logCommit).toHaveBeenCalledTimes(1);
    finishPush();
    await settle();
    await tick();
    expect(ipc.logCommit).toHaveBeenCalledTimes(2);
  });

  it("waits for the whole configured interval before the first snapshot", async () => {
    vi.useFakeTimers();
    await mountApp({
      settings: { logAnytime: { enabled: true, intervalMin: 5 } },
    });
    ipc.logCommit.mockResolvedValue(snapshot);

    // Four minutes in, the five-minute interval has not elapsed.
    vi.advanceTimersByTime(4 * INTERVAL);
    await settle();
    expect(ipc.logCommit).not.toHaveBeenCalled();

    // The fifth minute fires it, and it keeps firing on that cadence.
    vi.advanceTimersByTime(INTERVAL);
    await settle();
    expect(ipc.logCommit).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5 * INTERVAL);
    await settle();
    expect(ipc.logCommit).toHaveBeenCalledTimes(2);
  });

  it("re-arms on the new interval and disarms the old one when it changes", async () => {
    vi.useFakeTimers();
    await mountApp({
      settings: { logAnytime: { enabled: true, intervalMin: 1 } },
    });
    ipc.logCommit.mockResolvedValue(snapshot);

    const { setProjectLogAnytime, projectLogAnytime } =
      await import("./lib/projectConfig.svelte");
    await setProjectLogAnytime({ ...projectLogAnytime()!, intervalMin: 10 });
    await settle();

    // The original one-minute timer must be gone, not merely supplemented.
    vi.advanceTimersByTime(5 * INTERVAL);
    await settle();
    expect(ipc.logCommit).not.toHaveBeenCalled();

    // The ten-minute cadence is what is armed now.
    vi.advanceTimersByTime(5 * INTERVAL);
    await settle();
    expect(ipc.logCommit).toHaveBeenCalledTimes(1);
  });

  it("does not push an old in-flight snapshot after its configuration changes", async () => {
    vi.useFakeTimers();
    await mountApp({
      settings: {
        logAnytime: { enabled: true, autoPush: true, intervalMin: 1 },
      },
    });
    let finishSnapshot!: (sha: string) => void;
    ipc.logCommit.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        finishSnapshot = resolve;
      }),
    );
    await tick();
    const { setProjectLogAnytime, projectLogAnytime } =
      await import("./lib/projectConfig.svelte");
    await setProjectLogAnytime({ ...projectLogAnytime()!, autoPush: false });
    await settle();
    finishSnapshot(snapshot);
    await settle();
    expect(ipc.pushBranch).not.toHaveBeenCalled();
    ipc.logCommit.mockResolvedValue(snapshot);
    await tick();
    expect(ipc.logCommit).toHaveBeenCalledTimes(2);
    expect(ipc.pushBranch).not.toHaveBeenCalled();
  });
});
