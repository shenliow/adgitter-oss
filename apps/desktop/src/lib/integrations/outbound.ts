/**
 * Desktop → `/webhooks/outbound` emit.
 *
 * `emit(scope, title, body)` fans a desktop git event out to the signed-in
 * user's scoped integration tokens **without ever blocking or throwing into the
 * caller**: it is fire-and-forget. Events for a scope with no matching
 * configured token are dropped (only enabled scopes dispatch); the
 * backend re-enforces scope per token. Undeliverable events are held in an
 * **offline queue** (persisted) and retried on the next `emit` or `online` event.
 *
 * The network is the injectable {@link OutboundTransport}, so tests mock it and
 * the live path is not wired yet (in production the transport POSTs `{scope,title,body}`
 * to the license server with the desktop's Clerk JWT).
 */
import type { TokenScope } from "./tokens";

/** A desktop event queued for outbound dispatch. */
export interface OutboundEvent {
  scope: TokenScope;
  title: string;
  body: string;
}

/**
 * The single network seam. `send` resolves when the event was accepted and
 * rejects otherwise (so the queue keeps it for a later retry).
 */
export interface OutboundTransport {
  send(event: OutboundEvent): Promise<void>;
}

/** Persistence for the offline queue (metadata only — never a secret). */
export interface QueueStore {
  load(): OutboundEvent[];
  save(events: OutboundEvent[]): void;
}

export interface OutboundOptions {
  /** Where the offline queue persists (default: in-memory). */
  store?: QueueStore;
  /**
   * Scope gate — only these dispatch. Mirrors the scopes the user has a
   * configured token for. Default: allow all (the backend still enforces).
   */
  isEnabled?: (scope: TokenScope) => boolean;
  /** Online check; when false, events queue instead of flushing. */
  isOnline?: () => boolean;
  /** Cap on the queue so a long offline spell can't grow unbounded. */
  maxQueue?: number;
}

/** In-memory {@link QueueStore} (tests / no persistence available). */
export function memoryQueueStore(): QueueStore {
  let mem: OutboundEvent[] = [];
  return {
    load: () => mem,
    save: (events) => {
      mem = [...events];
    },
  };
}

const LS_KEY = "adgitter.outbound.queue";

/** `localStorage`-backed {@link QueueStore}; falls back to memory if unavailable. */
export function localStorageQueueStore(): QueueStore {
  const ls = globalThis.localStorage;
  if (!ls) return memoryQueueStore();
  return {
    load: () => {
      try {
        const raw = ls.getItem(LS_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? (parsed as OutboundEvent[]) : [];
      } catch {
        return [];
      }
    },
    save: (events) => {
      try {
        ls.setItem(LS_KEY, JSON.stringify(events));
      } catch {
        // best-effort; a persistence failure must not surface to the caller
      }
    },
  };
}

/**
 * Fire-and-forget outbound dispatcher with an offline queue. Every public method
 * swallows its own errors so a dispatch failure can never reach the git op.
 */
export class OutboundDispatcher {
  readonly #transport: OutboundTransport;
  readonly #store: QueueStore;
  readonly #isEnabled: (scope: TokenScope) => boolean;
  readonly #isOnline: () => boolean;
  readonly #maxQueue: number;
  #queue: OutboundEvent[];
  #flushing = false;

  constructor(transport: OutboundTransport, opts: OutboundOptions = {}) {
    this.#transport = transport;
    this.#store = opts.store ?? memoryQueueStore();
    this.#isEnabled = opts.isEnabled ?? (() => true);
    this.#isOnline = opts.isOnline ?? (() => true);
    this.#maxQueue = opts.maxQueue ?? 200;
    this.#queue = this.#store.load();
  }

  /** Queue length (test/introspection helper). */
  get pending(): number {
    return this.#queue.length;
  }

  /**
   * Enqueue an event and kick off a flush. Non-blocking and **never throws** —
   * a disabled scope is dropped; everything else is best-effort.
   */
  emit(scope: TokenScope, title: string, body = ""): void {
    try {
      if (!this.#isEnabled(scope)) return; // only enabled scopes dispatch
      this.#queue.push({ scope, title, body });
      if (this.#queue.length > this.#maxQueue)
        this.#queue = this.#queue.slice(-this.#maxQueue);
      this.#persist();
      void this.flush();
    } catch {
      // Emit must be inert on failure — never disturb the caller's git op.
    }
  }

  /** Drain the queue (called on emit and on `online`). Never throws. */
  async flush(): Promise<void> {
    if (this.#flushing || !this.#isOnline()) return;
    this.#flushing = true;
    try {
      while (this.#queue.length > 0) {
        const event = this.#queue[0];
        try {
          await this.#transport.send(event);
        } catch {
          break; // keep it (and the rest) queued for the next retry
        }
        this.#queue.shift();
        this.#persist();
      }
    } finally {
      this.#flushing = false;
    }
  }

  #persist(): void {
    try {
      this.#store.save(this.#queue);
    } catch {
      // best-effort persistence
    }
  }
}

/**
 * Production transport. POSTs `{scope,title,body}` to
 * the license server's `/webhooks/outbound` with the desktop's Clerk JWT.
 *
 * TODO: wire the real API base + Clerk session token; no backend is
 * reachable in dev/CI, so {@link defaultDispatcher} runs on this and events just
 * queue until a live transport is supplied.
 */
export function httpOutboundTransport(
  baseUrl: string,
  getToken: () => string | null,
): OutboundTransport {
  return {
    async send(event) {
      const token = getToken();
      const res = await fetch(`${baseUrl}/webhooks/outbound`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(event),
      });
      if (!res.ok) throw new Error(`outbound dispatch failed: ${res.status}`);
    },
  };
}

/**
 * A transport that refuses every call — the dev/CI default, since no backend is
 * provisioned. Events emitted through it simply stay queued, so the
 * non-blocking + offline-queue behavior is exercised end-to-end without network.
 */
export const notConfiguredOutboundTransport: OutboundTransport = {
  send() {
    return Promise.reject(new Error("live outbound transport not configured"));
  },
};

let _default: OutboundDispatcher | null = null;

/** Process-wide default dispatcher (persistent queue). */
export function defaultDispatcher(): OutboundDispatcher {
  if (!_default) {
    _default = new OutboundDispatcher(notConfiguredOutboundTransport, {
      store: localStorageQueueStore(),
    });
    // Retry the queue when connectivity returns.
    globalThis.addEventListener?.("online", () => void _default?.flush());
  }
  return _default;
}

/**
 * Emit a desktop git event to configured integrations. Fire-and-forget: safe to
 * call from a git-op success path — it never throws and never blocks.
 */
export function emitOutbound(
  scope: TokenScope,
  title: string,
  body = "",
): void {
  defaultDispatcher().emit(scope, title, body);
}
