/**
 * Frontend telemetry pipeline. Consent-gated, PII-scrubbed error reporting
 * with an `error.code` fingerprint, an anonymous install-id, and an offline
 * queue that flushes exactly once per event.
 *
 * Transport is pluggable: the default is a no-op; a real
 * `@sentry/svelte` transport is dropped in once a DSN is provisioned.
 * With consent declined, `report` is a no-op so
 * **zero telemetry leaves the device**.
 */
export interface DiagnosticPacket {
  release: string;
  os: string;
  /** Aggregation fingerprint, e.g. "GIT_ERROR" / "PANIC" / "UI_ERROR". */
  errorCode: string;
  /** Already scrubbed. */
  message: string;
  /** Unique per event — dedupe key for the offline flush. */
  eventId: string;
  /** Anonymous, persisted; no personal data. */
  installId: string;
}

export interface Transport {
  /** Send a packet; throw to signal failure (offline) so it stays queued. */
  send(packet: DiagnosticPacket): Promise<void>;
}

export const noopTransport: Transport = {
  async send() {},
};

// --- config (set by App) ---------------------------------------------------
let transport: Transport = noopTransport;
let consent = false;
let installId = "anonymous";
let release = "0.0.0";

export function configureTelemetry(opts: {
  transport?: Transport;
  consent?: boolean;
  installId?: string;
  release?: string;
}): void {
  if (opts.transport !== undefined) transport = opts.transport;
  if (opts.consent !== undefined) consent = opts.consent;
  if (opts.installId) installId = opts.installId;
  if (opts.release) release = opts.release;
  if (consent) void flush(); // a fresh grant drains anything queued
}

// --- PII scrub (mirrors crates/telemetry::scrub) ---------------------------
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PATH = /(?:\/[^\s/:]+){2,}\/?|[A-Za-z]:\\[^\s]+/g;

export function scrub(input: string): string {
  return input.replace(EMAIL, "<email>").replace(PATH, "<path>");
}

function uuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function osName(): string {
  return (
    (typeof navigator !== "undefined" &&
      (navigator.platform || navigator.userAgent)) ||
    "unknown"
  );
}

// --- reporting + offline queue ---------------------------------------------
const queue: DiagnosticPacket[] = [];
const sent = new Set<string>();

/** Report an error. No-op unless consent was granted. Scrubs the message. */
export function report(errorCode: string, message: string): void {
  if (!consent) return;
  queue.push({
    release,
    os: osName(),
    errorCode,
    message: scrub(message),
    eventId: uuid(),
    installId,
  });
  void flush();
}

// Serialize flushes onto a single chain so concurrent calls (e.g. report()'s
// auto-flush racing an explicit flush()) never send an event twice.
let tail: Promise<void> = Promise.resolve();

async function drain(): Promise<void> {
  while (queue.length > 0) {
    const p = queue[0];
    if (sent.has(p.eventId)) {
      queue.shift();
      continue;
    }
    try {
      await transport.send(p);
      sent.add(p.eventId);
      queue.shift();
    } catch {
      break; // offline / failed — keep it queued, retry on next flush
    }
  }
}

/** Drain the queue through the transport; each event is sent at most once. */
export function flush(): Promise<void> {
  tail = tail.then(drain, drain);
  return tail;
}

/** Test hook: reset module state. */
export function __resetTelemetry(): void {
  transport = noopTransport;
  consent = false;
  installId = "anonymous";
  release = "0.0.0";
  queue.length = 0;
  sent.clear();
  tail = Promise.resolve();
}
