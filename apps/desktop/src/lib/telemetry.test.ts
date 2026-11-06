import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  scrub,
  report,
  flush,
  configureTelemetry,
  __resetTelemetry,
  type DiagnosticPacket,
  type Transport,
} from "./telemetry";

function recorder() {
  const sent: DiagnosticPacket[] = [];
  const transport: Transport = {
    send: vi.fn(async (p) => {
      sent.push(p);
    }),
  };
  return { sent, transport };
}

beforeEach(() => __resetTelemetry());

describe("scrub", () => {
  it("masks emails and absolute paths, leaves innocent slashes", () => {
    const out = scrub("crash at /Users/sefi/repo/a.ts for me@x.com");
    expect(out).not.toContain("sefi");
    expect(out).not.toContain("me@x.com");
    expect(out).toContain("<path>");
    expect(out).toContain("<email>");
    expect(scrub("read and/or write")).toBe("read and/or write");
  });
});

describe("report (consent gate)", () => {
  it("sends nothing when consent is not granted", async () => {
    const { transport } = recorder();
    configureTelemetry({ transport, consent: false });
    report("GIT_ERROR", "boom");
    await flush();
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("sends a scrubbed, fingerprinted packet when consented", async () => {
    const { sent, transport } = recorder();
    configureTelemetry({
      transport,
      consent: true,
      installId: "iid-123",
      release: "1.2.3",
    });
    report("GIT_ERROR", "failed at /home/me/secret/x.rs");
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].errorCode).toBe("GIT_ERROR"); // fingerprint
    expect(sent[0].installId).toBe("iid-123");
    expect(sent[0].release).toBe("1.2.3");
    expect(sent[0].message).toContain("<path>");
    expect(sent[0].message).not.toContain("secret");
  });
});

describe("offline queue", () => {
  it("retries after a failure and never duplicates", async () => {
    const sent: DiagnosticPacket[] = [];
    let online = false;
    const transport: Transport = {
      send: vi.fn(async (p) => {
        if (!online) throw new Error("offline");
        sent.push(p);
      }),
    };
    configureTelemetry({ transport, consent: true });

    report("IO_ERROR", "disk gone");
    await flush(); // offline → stays queued
    expect(sent).toHaveLength(0);

    online = true;
    await flush(); // reconnect → sends once
    await flush(); // second flush must not resend
    expect(sent).toHaveLength(1);
  });

  it("flushes queued events when consent is granted later", async () => {
    const { sent, transport } = recorder();
    configureTelemetry({ transport, consent: false });
    report("X", "nope"); // dropped (no consent)
    configureTelemetry({ consent: true });
    report("Y", "now ok");
    await flush();
    expect(sent.map((p) => p.errorCode)).toEqual(["Y"]);
  });
});
