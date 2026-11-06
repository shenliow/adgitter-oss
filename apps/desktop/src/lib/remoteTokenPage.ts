/**
 * Where to send the user to create/manage an access token for their git
 * remote's host, so the "Access token" field in Settings → General can link
 * straight to the right page instead of leaving the user to guess (see
 * `general.authHint`).
 *
 * Deliberately a fixed table of well-known hosts, not a guess: a self-hosted
 * GitLab/Gitea/Forgejo instance is indistinguishable from any other domain
 * from a remote URL alone, and sending its user to `gitlab.com`'s token page
 * would be worse than showing no link at all — a wrong link reads as
 * authoritative and sends the user to manage a token on an account that has
 * nothing to do with the repo they're working in. Guessing is the failure
 * mode this returns `null` to avoid; an unrecognized host always resolves to
 * "no link" rather than a nearest-match host.
 *
 * The return value flows into `openExternalUrl` (Tauri's shell-open), so the
 * input (a user- or repo-supplied remote URL) is treated as untrusted: only
 * https URLs on a fixed, recognized host are ever returned, over
 * http/https/ssh git remotes, and never for a `file:`/`javascript:`/malformed
 * value. The one piece derived from the input is Bitbucket's `<workspace>/
 * <repo>` path (its access-token page is per repository): both slugs must
 * match a strict `[A-Za-z0-9._-]` pattern, so nothing but a path segment can
 * ever be spliced in — never a host, scheme, query or userinfo.
 */

/** Host → token-management page. Verified against each vendor's current docs
 *  — use these exact URLs, do not substitute. (Bitbucket is handled apart:
 *  its page depends on the repository.) */
const TOKEN_PAGES: Readonly<Record<string, string>> = {
  "github.com": "https://github.com/settings/tokens",
  "gitlab.com": "https://gitlab.com/-/user_settings/personal_access_tokens",
  "dev.azure.com": "https://dev.azure.com/_usersSettings/tokens",
};

/**
 * Bitbucket Cloud. App passwords can no longer be created (and the existing
 * ones stopped working in June 2026); the app signs in as `x-token-auth`
 * (`gitHosts.ts`), which takes a Repository / Project / Workspace Access
 * Token. Those are created per repository, so with a parseable remote the
 * link goes straight to that repository's "Access tokens" settings;
 * otherwise (no repo, an unusual remote) to Atlassian's how-to page.
 */
const BITBUCKET_HOST = "bitbucket.org";
const BITBUCKET_DOCS =
  "https://support.atlassian.com/bitbucket-cloud/docs/create-a-repository-access-token/";
/** A Bitbucket workspace / repository slug: starts alphanumeric, so `.` and
 *  `..` can never be a segment. */
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Schemes a git remote can plausibly authenticate a token/SSH-key against.
 *  Anything else (`file:`, `javascript:`, …) never produces a link. */
const ALLOWED_PROTOCOLS = new Set(["https:", "http:", "ssh:"]);

/**
 * Parse `remoteUrl` (an HTTPS git remote, a `git@host:path` scp-style SSH
 * shorthand, or an explicit `ssh://` URL) and return the token-management
 * URL for its host, or `null` when the host isn't one of the four above —
 * including when `remoteUrl` is missing, blank, unparseable, or uses a
 * scheme that isn't a git transport. For Bitbucket that is the repository's
 * own access-token settings page when `<workspace>/<repo>` can be read from
 * the remote, else Atlassian's guide.
 */
export function remoteTokenPageFor(
  remoteUrl: string | undefined,
): string | null {
  const remote = parseRemote(remoteUrl);
  if (!remote) return null;
  if (remote.host === BITBUCKET_HOST)
    return bitbucketRepoPage(remote.path) ?? BITBUCKET_DOCS;
  // `hasOwn`: a host called `constructor` must not find `Object`'s members.
  return Object.hasOwn(TOKEN_PAGES, remote.host)
    ? TOKEN_PAGES[remote.host]
    : null;
}

/** `https://bitbucket.org/<workspace>/<repo>/admin/access-tokens` for a remote
 *  path of exactly `<workspace>/<repo>[.git]`, else null. */
function bitbucketRepoPage(path: string): string | null {
  const segments = path.split("/").filter(Boolean);
  if (segments.length !== 2) return null;
  const workspace = segments[0];
  const repo = segments[1].replace(/\.git$/, "");
  if (!SLUG.test(workspace) || !SLUG.test(repo)) return null;
  return `https://${BITBUCKET_HOST}/${workspace}/${repo}/admin/access-tokens`;
}

/** Lower-cased, `www.`-stripped, port-stripped host plus the repository path
 *  (as written, no query/fragment), or `null` if none can be extracted (blank
 *  input, unparseable, or a disallowed scheme). */
function parseRemote(
  remoteUrl: string | undefined,
): { host: string; path: string } | null {
  const trimmed = (remoteUrl ?? "").trim();
  if (!trimmed) return null;

  // scp-style SSH shorthand (`git@github.com:you/repo.git`) has no scheme,
  // so `URL()` can't parse it — match a `user@host:` prefix before any slash
  // (same shape `gitHosts.ts`'s `isSshRemote` recognizes).
  const scpMatch = /^[^/@\s]+@([^/:\s]+):(.*)$/.exec(trimmed);
  if (scpMatch) return { host: normalizeHost(scpMatch[1]), path: scpMatch[2] };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol) || !parsed.hostname) return null;
  // `URL#hostname` already excludes any `:port` suffix.
  return { host: normalizeHost(parsed.hostname), path: parsed.pathname };
}

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}
