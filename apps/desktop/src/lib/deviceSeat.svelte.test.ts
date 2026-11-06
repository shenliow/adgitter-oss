import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isSeatLimitError,
  seatPromptOpen,
  askToEvictOldestDevice,
  confirmSeatPrompt,
  cancelSeatPrompt,
  withSeatEvictionPrompt,
  resetSeatPromptForTest,
} from "./deviceSeat.svelte";

/** The shape Rust's `AdgitterError` arrives as over IPC. */
function err(code: string) {
  return { code, message: "…" };
}

/** The server's seat refusal, as the desktop sees it. */
const SEAT_LIMIT = err("DEVICE_SEAT_LIMIT");

beforeEach(resetSeatPromptForTest);

describe("recognising the seat refusal", () => {
  it("matches only DEVICE_SEAT_LIMIT", () => {
    expect(isSeatLimitError(SEAT_LIMIT)).toBe(true);
    // Every neighbouring licence failure must NOT open an eviction prompt —
    // none of them is fixed by destroying a seat.
    for (const code of [
      "NOT_SIGNED_IN",
      "LICENSE_DEVICE_MISMATCH",
      "LICENSE_EXPIRED",
      "FEATURE_LOCKED",
      "INTERNAL_ERROR",
      "SEAT_LIMIT", // the *server's* code; Rust maps it, the frontend does not
    ])
      expect(isSeatLimitError(err(code))).toBe(false);
  });

  it("survives the things a rejection can actually be", () => {
    for (const e of [
      undefined,
      null,
      "DEVICE_SEAT_LIMIT",
      new Error("DEVICE_SEAT_LIMIT"),
      {},
      { code: 403 },
    ])
      expect(isSeatLimitError(e)).toBe(false);
  });
});

describe("the prompt", () => {
  it("is closed until something asks", () => {
    expect(seatPromptOpen()).toBe(false);
  });

  it("opens on ask and resolves true only on confirm", async () => {
    const answer = askToEvictOldestDevice();
    expect(seatPromptOpen()).toBe(true);
    confirmSeatPrompt();
    await expect(answer).resolves.toBe(true);
    expect(seatPromptOpen()).toBe(false);
  });

  it("resolves false on cancel", async () => {
    const answer = askToEvictOldestDevice();
    cancelSeatPrompt();
    await expect(answer).resolves.toBe(false);
    expect(seatPromptOpen()).toBe(false);
  });

  it("declines a second concurrent ask instead of stacking a dialog", async () => {
    const first = askToEvictOldestDevice();
    // Sign-in racing the startup ping: two refusals, one dialog, and at most
    // one eviction.
    await expect(askToEvictOldestDevice()).resolves.toBe(false);
    expect(seatPromptOpen()).toBe(true);
    confirmSeatPrompt();
    await expect(first).resolves.toBe(true);
  });
});

describe("withSeatEvictionPrompt", () => {
  it("does not prompt, and does not evict, on a successful call", async () => {
    const call = vi.fn(async () => "licence");
    await expect(withSeatEvictionPrompt(call)).resolves.toBe("licence");
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(false);
    expect(seatPromptOpen()).toBe(false);
  });

  it("re-throws any other failure without prompting", async () => {
    const other = err("INTERNAL_ERROR");
    const call = vi.fn(async () => {
      throw other;
    });
    await expect(withSeatEvictionPrompt(call)).rejects.toBe(other);
    expect(call).toHaveBeenCalledTimes(1);
    expect(seatPromptOpen()).toBe(false);
  });

  it("asks on a seat refusal and retries with evictOldest once confirmed", async () => {
    const call = vi.fn(async (evictOldest: boolean) => {
      if (!evictOldest) throw SEAT_LIMIT;
      return "licence";
    });
    const done = withSeatEvictionPrompt(call);
    // The question is on screen and the retry has NOT happened yet.
    await vi.waitFor(() => expect(seatPromptOpen()).toBe(true));
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenLastCalledWith(false);

    confirmSeatPrompt();
    await expect(done).resolves.toBe("licence");
    expect(call).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenLastCalledWith(true);
  });

  // ── The property that matters most ──────────────────────────────────────
  //
  // Eviction destroys one of the user's seats. The ONLY route to the
  // `evictOldest: true` call is an explicit confirmation; every other ending
  // must leave the server untouched and report the original refusal.

  it("never evicts when the user declines", async () => {
    const call = vi.fn(async (evictOldest: boolean) => {
      if (!evictOldest) throw SEAT_LIMIT;
      return "licence";
    });
    const done = withSeatEvictionPrompt(call);
    await vi.waitFor(() => expect(seatPromptOpen()).toBe(true));

    cancelSeatPrompt();

    await expect(done).rejects.toBe(SEAT_LIMIT);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).not.toHaveBeenCalledWith(true);
  });

  it("never evicts when nobody ever answers", async () => {
    const call = vi.fn(async (evictOldest: boolean) => {
      if (!evictOldest) throw SEAT_LIMIT;
      return "licence";
    });
    void withSeatEvictionPrompt(call).catch(() => {});
    await vi.waitFor(() => expect(seatPromptOpen()).toBe(true));
    // An unanswered prompt is an unanswered question: no retry, ever.
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).not.toHaveBeenCalledWith(true);
  });

  it("never evicts for a second caller that was declined the dialog", async () => {
    // One prompt, two refusals. The caller that did not get the dialog must
    // fail rather than ride the other one's confirmation.
    const first = vi.fn(async (evictOldest: boolean) => {
      if (!evictOldest) throw SEAT_LIMIT;
      return "first";
    });
    const second = vi.fn(async (evictOldest: boolean) => {
      if (!evictOldest) throw SEAT_LIMIT;
      return "second";
    });
    const a = withSeatEvictionPrompt(first);
    await vi.waitFor(() => expect(seatPromptOpen()).toBe(true));
    const b = withSeatEvictionPrompt(second);
    await expect(b).rejects.toBe(SEAT_LIMIT);
    expect(second).not.toHaveBeenCalledWith(true);

    confirmSeatPrompt();
    await expect(a).resolves.toBe("first");
    expect(first).toHaveBeenLastCalledWith(true);
  });

  it("passes no device id in either direction", async () => {
    // The whole authorization argument: the caller's only say is a boolean, so
    // there is no field in which a victim could be named.
    const call = vi.fn(async (evictOldest: boolean) => {
      if (!evictOldest) throw SEAT_LIMIT;
      return "licence";
    });
    const done = withSeatEvictionPrompt(call);
    await vi.waitFor(() => expect(seatPromptOpen()).toBe(true));
    confirmSeatPrompt();
    await done;
    for (const args of call.mock.calls) {
      expect(args).toHaveLength(1);
      expect(typeof args[0]).toBe("boolean");
    }
  });
});
