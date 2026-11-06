/**
 * Provider MR/Issue clients — **GitHub + GitLab**.
 *
 * A tiny per-provider client that can `createMergeRequest` / `createIssue` from a
 * commit, built on the **transport seam** (`Transport` + `classifyError`):
 * request-building + response-normalization are pure, and every call crosses the
 * injected {@link Transport}, so tests drive a `RecordingTransport` with no
 * network. The client attaches the provider's auth header from the token; the
 * response is normalized to a small {@link ProviderRef} (`{ url, id, number }`).
 *
 * Live, credentialed delivery is not wired yet (no provisioned accounts): in
 * production the token-bearing request routes through the license server, which holds
 * the decrypted secret. Bitbucket is deferred.
 */
import {
  classifyError,
  type HttpRequest,
  type HttpResponse,
  type Transport,
} from "../http/transport";
import { num, rec, str } from "../http/util";

/** Providers that support create-MR / create-issue in v1. */
export type MrProvider = "github" | "gitlab";

export const MR_PROVIDERS: readonly MrProvider[] = ["github", "gitlab"];

/** True for the providers with a live MR/Issue client (GitHub/GitLab). */
export function isMrProvider(p: string): p is MrProvider {
  return p === "github" || p === "gitlab";
}

export interface CreateMergeRequestInput {
  title: string;
  sourceBranch: string;
  targetBranch: string;
  body?: string;
}

export interface CreateIssueInput {
  title: string;
  body?: string;
}

/** Normalized create result — the minimum the UI needs (link + identity). */
export interface ProviderRef {
  url: string;
  id: string;
  number: number;
}

/** The contract `CommitDetails` depends on (one per configured token). */
export interface ProviderClient {
  readonly provider: MrProvider;
  createMergeRequest(input: CreateMergeRequestInput): Promise<ProviderRef>;
  createIssue(input: CreateIssueInput): Promise<ProviderRef>;
}

/** Auth header a provider expects: GitHub `Bearer`, GitLab `PRIVATE-TOKEN`. */
function authHeader(
  provider: MrProvider,
  token: string,
): Record<string, string> {
  return provider === "github"
    ? { Authorization: `Bearer ${token}` }
    : { "PRIVATE-TOKEN": token };
}

// ── Request builders (pure) ─────────────────────────────────────────────────

function mrRequest(
  provider: MrProvider,
  input: CreateMergeRequestInput,
): HttpRequest {
  if (provider === "github")
    return {
      method: "POST",
      path: "/pulls",
      body: {
        title: input.title,
        head: input.sourceBranch,
        base: input.targetBranch,
        body: input.body ?? "",
      },
    };
  return {
    method: "POST",
    path: "/merge_requests",
    body: {
      title: input.title,
      source_branch: input.sourceBranch,
      target_branch: input.targetBranch,
      description: input.body ?? "",
    },
  };
}

function issueRequest(
  provider: MrProvider,
  input: CreateIssueInput,
): HttpRequest {
  if (provider === "github")
    return {
      method: "POST",
      path: "/issues",
      body: { title: input.title, body: input.body ?? "" },
    };
  return {
    method: "POST",
    path: "/issues",
    body: { title: input.title, description: input.body ?? "" },
  };
}

// ── Response normalization (pure) ───────────────────────────────────────────

/** GitHub returns `{ number, id, html_url }`. */
function githubRef(json: unknown): ProviderRef {
  const o = rec(json);
  return {
    url: str(o.html_url),
    id: String(num(o.id) || str(o.id)),
    number: num(o.number),
  };
}

/** GitLab returns `{ iid, id, web_url }` (the human number is `iid`). */
function gitlabRef(json: unknown): ProviderRef {
  const o = rec(json);
  return {
    url: str(o.web_url),
    id: String(num(o.id) || str(o.id)),
    number: num(o.iid) || num(o.id),
  };
}

function normalizeRef(provider: MrProvider, json: unknown): ProviderRef {
  return provider === "github" ? githubRef(json) : gitlabRef(json);
}

// ── Client ──────────────────────────────────────────────────────────────────

class RestProviderClient implements ProviderClient {
  constructor(
    readonly provider: MrProvider,
    private readonly token: string,
    private readonly transport: Transport,
  ) {}

  createMergeRequest(input: CreateMergeRequestInput): Promise<ProviderRef> {
    return this.#run(mrRequest(this.provider, input));
  }

  createIssue(input: CreateIssueInput): Promise<ProviderRef> {
    return this.#run(issueRequest(this.provider, input));
  }

  async #run(req: HttpRequest): Promise<ProviderRef> {
    // TODO: route the token-bearing call through the license server,
    // which holds the decrypted secret; here we attach it directly so the
    // dev/mock transport carries it.
    const res: HttpResponse = await this.transport.send({
      ...req,
      headers: { ...authHeader(this.provider, this.token), ...req.headers },
    });
    const err = classifyError(res);
    if (err) throw err;
    return normalizeRef(this.provider, res.body);
  }
}

/** Build a {@link ProviderClient} for a provider + token over a transport. */
export function providerClient(
  provider: MrProvider,
  token: string,
  transport: Transport,
): ProviderClient {
  return new RestProviderClient(provider, token, transport);
}
