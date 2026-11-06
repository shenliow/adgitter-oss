/**
 * Integration-token client.
 *
 * The Webhook settings panel manages *scoped outbound tokens* (Slack/Jira, plus
 * the GitHub/GitLab provider clients). The security-critical rule is
 * **reveal-once**: a token's plaintext is returned exactly once — from
 * {@link TokenClient.create} / {@link TokenClient.regenerate} — and never
 * afterwards. Every read ({@link TokenClient.list}) yields metadata only.
 *
 * The panel talks to a {@link TokenClient}, so tests inject a mock and the real
 * transport can be swapped without touching the UI. The default
 * {@link LocalTokenClient} is a **clearly-labelled dev/local** implementation:
 * it mints the plaintext locally, hands it back once, and persists only
 * metadata. In production this is replaced by an API client hitting
 * the license server, which stores only
 * its ciphertext/hash.
 *
 * TODO: server-backed client — the desktop should exchange its Clerk JWT for
 * a real server-minted token via the license server; live network is unavailable in
 * CI, so the dev/local client stands in.
 */

export type IntegrationProvider = "slack" | "jira" | "github" | "gitlab";

export const PROVIDERS: readonly IntegrationProvider[] = [
  "slack",
  "jira",
  "github",
  "gitlab",
];

/** Event scopes a token may dispatch on (mirrors the backend `Scope`). */
export type TokenScope =
  | "send_notification"
  | "commit"
  | "leave_comment"
  | "create_branch"
  | "rename_branch"
  | "delete_branch";

export const SCOPES: readonly TokenScope[] = [
  "send_notification",
  "commit",
  "leave_comment",
  "create_branch",
  "rename_branch",
  "delete_branch",
];

/** Metadata-only view of a token — safe to list/persist (no secret). */
export interface TokenMeta {
  id: string;
  name: string;
  provider: IntegrationProvider;
  scopes: TokenScope[];
  /** Non-secret inbound webhook URL for this integration. */
  webhookUrl: string;
  createdAtMs: number;
  lastUsedAtMs: number | null;
}

/** Creation/rotation result — carries the reveal-once `plaintext`. */
export interface CreatedToken extends TokenMeta {
  /** Shown exactly once; never retrievable again. */
  plaintext: string;
}

export interface NewTokenRequest {
  name: string;
  provider: IntegrationProvider;
  scopes: TokenScope[];
}

/** The contract the Webhook panel depends on. */
export interface TokenClient {
  list(): Promise<TokenMeta[]>;
  create(req: NewTokenRequest): Promise<CreatedToken>;
  /** Rotate a token's secret in place → a fresh one-time plaintext. */
  regenerate(id: string): Promise<CreatedToken>;
  revoke(id: string): Promise<void>;
}

// ── Local/dev implementation ────────────────────────────────────────────────

const WEBHOOK_BASE = "https://api.adgitter.app/hooks";

/** Strip the secret from a created token → the metadata we persist/list. */
function toMeta(t: CreatedToken): TokenMeta {
  const { plaintext: _plaintext, ...meta } = t;
  void _plaintext;
  return meta;
}

/** Cryptographically-random URL-safe id/secret material. */
function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  const c = globalThis.crypto;
  if (c?.getRandomValues) c.getRandomValues(buf);
  else for (let i = 0; i < bytes; i++) buf[i] = Math.floor(Math.random() * 256);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Dev/local {@link TokenClient}. Mints the plaintext locally, reveals it once,
 * and keeps only metadata in memory. NOT the production path (see file TODO) —
 * a real server never lets the client generate the secret.
 */
export class LocalTokenClient implements TokenClient {
  #tokens = new Map<string, TokenMeta>();

  async list(): Promise<TokenMeta[]> {
    return [...this.#tokens.values()].sort(
      (a, b) => b.createdAtMs - a.createdAtMs,
    );
  }

  async create(req: NewTokenRequest): Promise<CreatedToken> {
    const id = randomHex(8);
    const created: CreatedToken = {
      id,
      name: req.name.trim(),
      provider: req.provider,
      scopes: [...req.scopes],
      webhookUrl: `${WEBHOOK_BASE}/${id}`,
      createdAtMs: Date.now(),
      lastUsedAtMs: null,
      plaintext: `adg_${req.provider}_${randomHex(24)}`,
    };
    // Persist metadata only — the plaintext is intentionally dropped here.
    this.#tokens.set(id, toMeta(created));
    return created;
  }

  async regenerate(id: string): Promise<CreatedToken> {
    const existing = this.#tokens.get(id);
    if (!existing) throw new Error("token not found");
    const rotated: CreatedToken = {
      ...existing,
      lastUsedAtMs: null,
      plaintext: `adg_${existing.provider}_${randomHex(24)}`,
    };
    this.#tokens.set(id, toMeta(rotated));
    return rotated;
  }

  async revoke(id: string): Promise<void> {
    this.#tokens.delete(id);
  }
}

/** Process-wide default client (dev/local). Swap for a server client in prod. */
export const defaultTokenClient: TokenClient = new LocalTokenClient();

/** Copy `text` to the clipboard; resolves false when unavailable. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const c = globalThis.navigator?.clipboard;
    if (c?.writeText) {
      await c.writeText(text);
      return true;
    }
  } catch {
    // fall through to failure
  }
  return false;
}
