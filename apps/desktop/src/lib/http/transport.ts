/**
 * The HTTP seam every provider call crosses (issue trackers, MR/issue
 * creation): the request/response shapes, the {@link Transport} interface,
 * typed errors, and the test and placeholder transports. Pure — the live,
 * network-bearing transports are built elsewhere.
 */

// ── Transport ───────────────────────────────────────────────────────────────

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** A provider-agnostic HTTP request an adapter emits (no auth attached here). */
export interface HttpRequest {
  method: HttpMethod;
  /** Provider-relative path, e.g. `/rest/api/3/issue/PROJ-1`. */
  path: string;
  /** JSON body (already in the provider's native shape). */
  body?: unknown;
  /**
   * Optional request headers. Issue adapters leave auth to the production
   * transport (the license server attaches the stored token); the outbound
   * provider clients set an explicit `Authorization`/`PRIVATE-TOKEN` header so
   * the dev/mock transport carries it and tests can assert it.
   */
  headers?: Record<string, string>;
}

/** A provider-agnostic HTTP response the transport returns. */
export interface HttpResponse {
  status: number;
  headers?: Record<string, string>;
  /** Parsed JSON body (or `undefined` for 204). */
  body?: unknown;
}

/**
 * The single seam every live call crosses. In production this is a client that
 * routes `req` through the license server with the workspace's stored token
 * and returns the provider's response.
 *
 * TODO: route through the license server with the stored token.
 */
export interface Transport {
  send(req: HttpRequest): Promise<HttpResponse>;
}

// ── Typed errors ─────────────────────────

export type ProviderErrorKind =
  | "auth"
  | "not_found"
  | "conflict"
  | "rate_limit"
  | "validation"
  | "transport";

/** Base class for every adapter-surfaced failure. */
export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** 401/403 (credential rejected / insufficient scope). */
export class AuthError extends ProviderError {
  constructor(status: number, message = "authentication failed") {
    super("auth", status, message);
    this.name = "AuthError";
  }
}

/** 404 — the issue/resource does not exist. */
export class NotFoundError extends ProviderError {
  constructor(status = 404, message = "not found") {
    super("not_found", status, message);
    this.name = "NotFoundError";
  }
}

/**
 * 409 — the local edit lost a race, resolved **remote-wins**: the
 * {@link AdapterIssueProvider} re-hydrates from the provider on this error.
 */
export class ConflictError extends ProviderError {
  constructor(status = 409, message = "remote changed since read") {
    super("conflict", status, message);
    this.name = "ConflictError";
  }
}

/** 429 (or GitHub's 403 + `x-ratelimit-remaining: 0`). */
export class RateLimitError extends ProviderError {
  constructor(
    status: number,
    readonly retryAfterMs: number | null,
    message = "rate limited",
  ) {
    super("rate_limit", status, message);
    this.name = "RateLimitError";
  }
}

/**
 * Shared status → typed-error classifier. Returns `null` for a 2xx response.
 * Adapters may wrap this to add provider-specific quirks (e.g. GitHub encodes
 * rate limits as 403).
 */
export function classifyError(res: HttpResponse): ProviderError | null {
  if (res.status >= 200 && res.status < 300) return null;
  const retry = retryAfterMs(res.headers);
  switch (res.status) {
    case 401:
    case 403:
      return new AuthError(res.status);
    case 404:
      return new NotFoundError(res.status);
    case 409:
      return new ConflictError(res.status);
    case 429:
      return new RateLimitError(res.status, retry);
    default:
      if (res.status >= 400 && res.status < 500)
        return new ProviderError("validation", res.status, "invalid request");
      return new ProviderError("transport", res.status, "provider error");
  }
}

/** Parse a `Retry-After` header (seconds) into ms, or null when absent. */
export function retryAfterMs(
  headers: Record<string, string> | undefined,
): number | null {
  const raw = headers?.["retry-after"] ?? headers?.["Retry-After"];
  if (!raw) return null;
  const secs = Number(raw);
  return Number.isFinite(secs) ? Math.max(0, secs) * 1000 : null;
}

/** A request handler: turn a request into a response (sync or async). */
export type TransportHandler = (
  req: HttpRequest,
) => HttpResponse | Promise<HttpResponse>;

/** Wrap a handler function as a {@link Transport}. */
export function functionTransport(handler: TransportHandler): Transport {
  return { send: (req) => Promise.resolve(handler(req)) };
}

/**
 * A {@link Transport} that records every request it is asked to send — handy for
 * asserting write-back paths without a network. The handler
 * decides the response (default `200 {}`), so a test can inject a 409 to drive
 * the remote-wins path.
 */
export class RecordingTransport implements Transport {
  readonly sent: HttpRequest[] = [];

  constructor(
    private readonly handler: TransportHandler = () => ({
      status: 200,
      body: {},
    }),
  ) {}

  async send(req: HttpRequest): Promise<HttpResponse> {
    this.sent.push(req);
    return this.handler(req);
  }

  /** All requests whose path matches (substring) — assertion sugar. */
  matching(pathPart: string): HttpRequest[] {
    return this.sent.filter((r) => r.path.includes(pathPart));
  }
}

/**
 * A {@link Transport} that refuses every call — the safe default for a
 * component handed no transport of its own (see CommitDetails).
 *
 * It no longer implies any fallback: the app builds a real
 * live transport where it can, and where it cannot the caller says why. A refusal here is
 * a genuine "this caller was never wired up", not a route to mock data.
 */
export const notConfiguredTransport: Transport = {
  send() {
    return Promise.reject(new Error("live provider transport not configured"));
  },
};
