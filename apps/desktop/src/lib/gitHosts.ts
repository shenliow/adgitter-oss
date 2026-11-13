/**
 * Host-specific username for HTTPS token (PAT) authentication.
 *
 * Git hosts accept a personal access token as the Basic-auth password, but
 * each expects a different (mostly ceremonial) username alongside it:
 * GitHub documents `x-access-token`, GitLab accepts `oauth2`, and Bitbucket
 * Cloud's access tokens use `x-token-auth`. Sending the wrong one makes a
 * perfectly valid token fail, so the username is inferred from the remote's
 * host instead of being asked of (or hardcoded for) the user.
 */
export function patUsernameFor(url: string): string {
  const host = hostOf(url);
  if (host.includes("gitlab")) return "oauth2";
  if (host.includes("bitbucket")) return "x-token-auth";
  // GitHub's documented value; also a safe default for other hosts (Gitea,
  // Forgejo, …), which ignore the username when a token is presented.
  return "x-access-token";
}

/**
 * Strip any embedded userinfo from a remote URL. A PAT can live in the
 * userinfo of `https://TOKEN@host/…` (or `https://user:TOKEN@host/…`);
 * removing it makes the URL safe to display and to persist to the committable
 * `adgitter.config.json`. Non-URL strings (e.g. `git@host:path`)
 * are returned trimmed but unchanged.
 */
export function sanitizeRemoteUrl(url: string): string {
  const trimmed = url.trim();
  try {
    const u = new URL(trimmed);
    u.username = "";
    u.password = "";
    return u.toString();
  } catch {
    return trimmed;
  }
}

/**
 * True iff the remote is an HTTPS URL — the scheme the app authenticates with
 * a PAT. This is the "git is configured" signal: an HTTPS
 * remote is a real network target we can push/pull and open MRs against.
 */
export function isHttpsRemote(url: string): boolean {
  try {
    return new URL(url.trim()).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * True iff the remote uses SSH transport — scp-style shorthand
 * (`git@host:path`) or an explicit `ssh://…` URL. This is the case the app
 * authenticates with an SSH key (ssh-agent / a default `~/.ssh` key on the
 * Rust side) rather than a PAT.
 */
export function isSshRemote(url: string): boolean {
  const u = url.trim();
  if (!u) return false;
  // scp-style SSH shorthand (`git@github.com:you/repo.git`) — no scheme, so
  // URL() can't parse it; match a `user@host:` prefix before any slash.
  if (/^[^/@]+@[^/:]+:/.test(u)) return true;
  try {
    return new URL(u).protocol === "ssh:";
  } catch {
    return false;
  }
}

/** HTTPS endpoint for PAT use, or null when conversion would require guessing.
 * Keep this conservative public-host mapping in sync with git-core repo.rs. */
export function patRemoteUrl(url: string): string | null {
  const u = url.trim();
  if (isHttpsRemote(u)) return u;
  const match =
    /^(?:git@([^/:]+):|ssh:\/\/(?:git@)?([^/:]+)\/)([A-Za-z0-9._/-]+)$/.exec(u);
  if (!match) return null;
  const host = match[1] ?? match[2];
  const path = match[3];
  if (!["github.com", "gitlab.com", "bitbucket.org"].includes(host))
    return null;
  if (path.split("/").some((part) => !part || part === "." || part === ".."))
    return null;
  return `https://${host}/${path}`;
}

/** How pull/push will authenticate to a remote (see {@link resolveRemoteAuth}). */
export type RemoteAuthMode =
  /** No remote configured — nothing to authenticate against. */
  | "none"
  /** HTTPS URL + PAT → Basic-auth token (the best path). */
  | "https-pat"
  /** SSH/scp URL + blank PAT → ssh-agent / a default `~/.ssh` key. */
  | "ssh-key"
  /** Any non-SSH URL + blank PAT → no credential (public / `file://`). */
  | "anonymous"
  /** A PAT on a URL with no known HTTPS endpoint. */
  | "pat-needs-https";

/**
 * Resolve how pull/push authenticate to `url`, by the fallback priority:
 *
 *   1. HTTPS or convertible SSH **+ PAT** → `https-pat`
 *   2. any URL **+ blank PAT**          → `ssh-key` (ssh/scp) | `anonymous`
 *   3. (the caller supplies the repo's own origin URL as the fallback `url`
 *      when the Settings URL is blank, so priority 3 is "repo URL + blank PAT")
 *   4. a PAT without a known HTTPS endpoint → `pat-needs-https` (error)
 *
 * Conventional public-host SSH URLs are converted to HTTPS for PAT use.
 * A token is refused over anything but HTTPS: it is useless over ssh/git and
 * would leak in the clear over plain `http://`. Clearing the token drops back
 * to SSH-key / anonymous auth, which is allowed for every scheme.
 */
export function resolveRemoteAuth(
  url: string,
  hasPat: boolean,
): RemoteAuthMode {
  const u = url.trim();
  if (!u) return "none";
  if (hasPat) return patRemoteUrl(u) ? "https-pat" : "pat-needs-https";
  return isSshRemote(u) ? "ssh-key" : "anonymous";
}

/** Hosts we can name. Keyed by the host label that identifies the provider. */
const PROVIDER_LABELS: Record<string, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
};

/**
 * Display name of the git provider a remote lives on — "GitHub", "GitLab",
 * "Bitbucket" — for the status bar's leftmost slot.
 *
 * Works on every transport the app accepts (https, ssh://, scp-style
 * `git@host:path`), because the provider is a property of the host, not of
 * the scheme. Matching is per host *label* rather than a substring, so a
 * self-hosted `gitlab.acme.com` is recognised while `mygithubmirror.net`
 * is not mistaken for GitHub.
 *
 * Falls back to the bare host for anything unrecognised (self-hosted Gitea,
 * an internal `git.acme.com`, …): it still answers "which server is this
 * repo on", which is the whole point of the slot. Returns `null` — show
 * nothing — when there is no remote, or when the remote has no network host
 * at all (`file:///srv/bare/r.git`): there is no provider to name.
 */
export function remoteProviderLabel(
  url: string | null | undefined,
): string | null {
  const host = remoteHostOf(url ?? "");
  if (!host) return null;
  for (const label of host.split(".")) {
    if (PROVIDER_LABELS[label]) return PROVIDER_LABELS[label];
  }
  return host;
}

/**
 * Lower-cased host of a remote of any transport — `https://host/…`,
 * `ssh://git@host:2222/…` or scp-style `git@host:path`. Empty when the URL
 * carries no host (`file://…`) or cannot be parsed.
 */
function remoteHostOf(url: string): string {
  const u = url.trim();
  if (!u) return "";
  // scp-style SSH shorthand has no scheme, so URL() cannot parse it.
  const scp = /^[^/@]+@([^/:]+):/.exec(u);
  if (scp) return scp[1].toLowerCase();
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Lower-cased host of an http(s) remote URL; empty for anything else. */
function hostOf(url: string): string {
  try {
    const u = new URL(url.trim());
    return u.protocol === "http:" || u.protocol === "https:"
      ? u.hostname.toLowerCase()
      : "";
  } catch {
    return "";
  }
}

/**
 * The folder name `git clone <url>` would create: the URL's last path segment
 * with any trailing `/` or `.git` removed. Handles https, ssh:// and scp-style
 * (`git@host:owner/repo.git`) URLs as well as local paths.
 */
export function repoNameFromUrl(url: string): string {
  const tail =
    url
      .trim()
      .replace(/[/\\]+$/, "")
      .split(/[/\\:]/)
      .pop() ?? "";
  return tail.replace(/\.git$/i, "") || "repository";
}

/**
 * Where a clone lands after the user picks `picked` in the folder picker:
 * an empty folder is cloned into directly (the user made/chose it for this
 * repo); any other folder is treated as the parent and gets a
 * `<repo-name>` subfolder, like `git clone <url>` run inside it.
 */
export function cloneDestination(
  picked: string,
  url: string,
  pickedIsEmpty: boolean,
): string {
  if (pickedIsEmpty) return picked;
  const sep = picked.includes("\\") && !picked.includes("/") ? "\\" : "/";
  const base = picked.replace(/[/\\]+$/, "");
  return `${base || sep}${base ? sep : ""}${repoNameFromUrl(url)}`;
}
