import { describe, it, expect } from "vitest";
import {
  OutboundDispatcher,
  memoryQueueStore,
  notConfiguredOutboundTransport,
  type OutboundEvent,
  type OutboundTransport,
} from "./outbound";

/** A transport that records events and can be scripted to fail. */
function recording(
  fail = false,
): OutboundTransport & { sent: OutboundEvent[] } {
  const sent: OutboundEvent[] = [];
  return {
    sent,
    async send(event) {
      sent.push(event);
      if (fail) throw new Error("boom");
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("OutboundDispatcher", () => {
  it("only enabled scopes dispatch", async () => {
    const t = recording();
    const d = new OutboundDispatcher(t, {
      isEnabled: (s) => s === "commit",
    });

    d.emit("commit", "Committed", "abc123");
    d.emit("create_branch", "Branch created", "feat/x"); // scope disabled → dropped
    await flush();

    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].scope).toBe("commit");
    expect(d.pending).toBe(0);
  });

  it("emit is non-blocking and never throws when delivery fails", async () => {
    const t = recording(true);
    const d = new OutboundDispatcher(t, {});

    // Must return synchronously without throwing even though send() rejects.
    expect(() => d.emit("commit", "Committed")).not.toThrow();
    await flush();

    // The failed event stays queued for a later retry (never lost, never fatal).
    expect(t.sent).toHaveLength(1);
    expect(d.pending).toBe(1);
  });

  it("a rejecting transport still never throws", async () => {
    const d = new OutboundDispatcher(notConfiguredOutboundTransport, {});
    expect(() => d.emit("create_branch", "Branch created")).not.toThrow();
    await flush();
    expect(d.pending).toBe(1); // queued, not lost
  });

  it("retries the offline queue on the next emit once delivery recovers", async () => {
    let online = false;
    const sent: OutboundEvent[] = [];
    const t: OutboundTransport = {
      async send(e) {
        if (!online) throw new Error("offline");
        sent.push(e);
      },
    };
    const d = new OutboundDispatcher(t, {});

    d.emit("commit", "first");
    await flush();
    expect(d.pending).toBe(1); // held while "offline"

    online = true;
    d.emit("commit", "second"); // next emit drains the whole queue
    await flush();

    expect(sent.map((e) => e.title)).toEqual(["first", "second"]);
    expect(d.pending).toBe(0);
  });

  it("persists the queue across dispatcher instances (offline durability)", async () => {
    const store = memoryQueueStore();
    const failing = new OutboundDispatcher(recording(true), { store });
    failing.emit("commit", "durable");
    await flush();
    expect(failing.pending).toBe(1);

    // A fresh dispatcher (e.g. app restart) reloads the unsent event and,
    // with a healthy transport, delivers it.
    const healthy = recording();
    const revived = new OutboundDispatcher(healthy, { store });
    expect(revived.pending).toBe(1);
    await revived.flush();
    expect(healthy.sent.map((e) => e.title)).toEqual(["durable"]);
    expect(revived.pending).toBe(0);
  });

  it("does not flush while offline, then drains when back online", async () => {
    const t = recording();
    let online = false;
    const d = new OutboundDispatcher(t, { isOnline: () => online });

    d.emit("commit", "queued");
    await flush();
    expect(t.sent).toHaveLength(0);
    expect(d.pending).toBe(1);

    online = true;
    await d.flush();
    expect(t.sent).toHaveLength(1);
    expect(d.pending).toBe(0);
  });
});
