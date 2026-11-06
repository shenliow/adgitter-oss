import { describe, it, expect } from "vitest";
import {
  patUsernameFor,
  sanitizeRemoteUrl,
  isHttpsRemote,
  isSshRemote,
  resolveRemoteAuth,
  patRemoteUrl,
  remoteProviderLabel,
} from "./gitHosts";

describe("patUsernameFor", () => {
  it("uses x-access-token for GitHub", () => {
    expect(patUsernameFor("https://github.com/u/r.git")).toBe("x-access-token");
  });

  it("uses oauth2 for GitLab, including self-hosted subdomains", () => {
    expect(patUsernameFor("https://gitlab.com/u/r.git")).toBe("oauth2");
    expect(patUsernameFor("https://gitlab.example.io/u/r.git")).toBe("oauth2");
  });

  it("uses x-token-auth for Bitbucket", () => {
    expect(patUsernameFor("https://bitbucket.org/u/r.git")).toBe(
      "x-token-auth",
    );
  });

  it("defaults to x-access-token for other hosts and non-https urls", () => {
    expect(patUsernameFor("https://gitea.example.com/u/r.git")).toBe(
      "x-access-token",
    );
    expect(patUsernameFor("git@github.com:u/r.git")).toBe("x-access-token");
    expect(patUsernameFor("not a url")).toBe("x-access-token");
  });

  it("is not fooled by the host appearing in the path", () => {
    expect(patUsernameFor("https://example.com/gitlab/r.git")).toBe(
      "x-access-token",
    );
  });
});

describe("sanitizeRemoteUrl (strips embedded PAT/userinfo)", () => {
  it("removes a token in the userinfo of an https url", () => {
    expect(sanitizeRemoteUrl("https://ghp_TOKEN@github.com/u/r.git")).toBe(
      "https://github.com/u/r.git",
    );
    expect(
      sanitizeRemoteUrl("https://x-access-token:ghp_TOKEN@github.com/u/r.git"),
    ).toBe("https://github.com/u/r.git");
  });

  it("leaves a clean https url unchanged", () => {
    expect(sanitizeRemoteUrl("https://github.com/u/r.git")).toBe(
      "https://github.com/u/r.git",
    );
  });

  it("returns non-URL remotes (scp-style ssh) trimmed but intact", () => {
    expect(sanitizeRemoteUrl("  git@github.com:u/r.git  ")).toBe(
      "git@github.com:u/r.git",
    );
  });
});

describe("isHttpsRemote", () => {
  it("is true only for https", () => {
    expect(isHttpsRemote("https://github.com/u/r.git")).toBe(true);
    expect(isHttpsRemote("https://tok@github.com/u/r.git")).toBe(true);
  });

  it("is false for ssh, git, and plain http", () => {
    expect(isHttpsRemote("git@github.com:u/r.git")).toBe(false);
    expect(isHttpsRemote("ssh://git@github.com/u/r.git")).toBe(false);
    expect(isHttpsRemote("git://github.com/u/r.git")).toBe(false);
    expect(isHttpsRemote("http://github.com/u/r.git")).toBe(false);
    expect(isHttpsRemote("not a url")).toBe(false);
  });
});

describe("isSshRemote", () => {
  it("is true for scp-style shorthand and ssh:// URLs", () => {
    expect(isSshRemote("git@github.com:u/r.git")).toBe(true);
    expect(isSshRemote("ssh://git@github.com/u/r.git")).toBe(true);
  });

  it("is false for https, git://, http, file, and local paths", () => {
    expect(isSshRemote("https://github.com/u/r.git")).toBe(false);
    expect(isSshRemote("git://github.com/u/r.git")).toBe(false);
    expect(isSshRemote("http://github.com/u/r.git")).toBe(false);
    expect(isSshRemote("file:///srv/bare/r.git")).toBe(false);
    expect(isSshRemote("/srv/bare/r.git")).toBe(false);
    expect(isSshRemote("")).toBe(false);
  });
});

describe("resolveRemoteAuth (auth priority)", () => {
  it("uses https+PAT when a token is set on an HTTPS URL", () => {
    expect(resolveRemoteAuth("https://github.com/u/r.git", true)).toBe(
      "https-pat",
    );
  });

  it("uses ssh-key for an SSH/scp URL with a blank PAT", () => {
    expect(resolveRemoteAuth("git@github.com:u/r.git", false)).toBe("ssh-key");
    expect(resolveRemoteAuth("ssh://git@github.com/u/r.git", false)).toBe(
      "ssh-key",
    );
  });

  it("uses anonymous for a non-SSH URL with a blank PAT (public / file)", () => {
    expect(resolveRemoteAuth("https://github.com/u/r.git", false)).toBe(
      "anonymous",
    );
    expect(resolveRemoteAuth("git://github.com/u/r.git", false)).toBe(
      "anonymous",
    );
    expect(resolveRemoteAuth("file:///srv/bare/r.git", false)).toBe(
      "anonymous",
    );
  });

  it("is the one error case: a PAT on a non-HTTPS URL is refused", () => {
    for (const url of [
      "git@custom.example:u/r.git",
      "ssh://git@github.com:2222/u/r.git",
      "git://github.com/u/r.git",
      "http://github.com/u/r.git", // would leak the token in the clear
    ]) {
      expect(resolveRemoteAuth(url, true)).toBe("pat-needs-https");
    }
  });

  it("is 'none' when no remote is configured", () => {
    expect(resolveRemoteAuth("", true)).toBe("none");
    expect(resolveRemoteAuth("   ", false)).toBe("none");
  });
});

describe("remoteProviderLabel", () => {
  it("names the provider from an HTTPS remote", () => {
    expect(remoteProviderLabel("https://github.com/u/r.git")).toBe("GitHub");
    expect(remoteProviderLabel("https://gitlab.com/u/r.git")).toBe("GitLab");
    expect(remoteProviderLabel("https://bitbucket.org/u/r.git")).toBe(
      "Bitbucket",
    );
  });

  it("names the provider from SSH remotes (scp-style and ssh://)", () => {
    expect(remoteProviderLabel("git@github.com:u/r.git")).toBe("GitHub");
    expect(remoteProviderLabel("ssh://git@gitlab.com/u/r.git")).toBe("GitLab");
    expect(remoteProviderLabel("ssh://git@bitbucket.org:2222/u/r.git")).toBe(
      "Bitbucket",
    );
  });

  it("recognises a self-hosted instance by its host label", () => {
    expect(remoteProviderLabel("https://gitlab.acme.com/u/r.git")).toBe(
      "GitLab",
    );
    expect(remoteProviderLabel("git@gitlab.acme.com:u/r.git")).toBe("GitLab");
  });

  it("does not mistake a lookalike domain for a provider", () => {
    expect(remoteProviderLabel("https://mygithubmirror.net/u/r.git")).toBe(
      "mygithubmirror.net",
    );
  });

  it("falls back to the bare host for an unclassifiable host", () => {
    expect(remoteProviderLabel("https://git.acme.com/u/r.git")).toBe(
      "git.acme.com",
    );
    expect(remoteProviderLabel("git@git.acme.com:u/r.git")).toBe(
      "git.acme.com",
    );
  });

  it("is null when there is no remote at all", () => {
    expect(remoteProviderLabel("")).toBeNull();
    expect(remoteProviderLabel("   ")).toBeNull();
    expect(remoteProviderLabel(null)).toBeNull();
    expect(remoteProviderLabel(undefined)).toBeNull();
  });

  it("is null for a remote with no network host", () => {
    expect(remoteProviderLabel("file:///srv/bare/r.git")).toBeNull();
    expect(remoteProviderLabel("/srv/bare/r.git")).toBeNull();
  });
});

describe("PAT SSH transport conversion", () => {
  it.each(["github.com", "gitlab.com", "bitbucket.org"])(
    "routes %s SSH through HTTPS",
    (host) => {
      for (const remote of [
        `git@${host}:u/r.git`,
        `ssh://git@${host}/u/r.git`,
        `ssh://${host}/u/r.git`,
      ]) {
        expect(patRemoteUrl(remote)).toBe(`https://${host}/u/r.git`);
        expect(resolveRemoteAuth(remote, true)).toBe("https-pat");
      }
    },
  );
  it.each([
    "git@github.com:../r.git",
    "git@github.com:u//r.git",
    "ssh://git@github.com:22/u/r.git",
    "git@github.com.evil:u/r.git",
    "http://github.com/u/r.git",
  ])("refuses unsafe or ambiguous target %s", (remote) => {
    expect(patRemoteUrl(remote)).toBeNull();
    expect(resolveRemoteAuth(remote, true)).toBe("pat-needs-https");
  });
});
