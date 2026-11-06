import { describe, it, expect } from "vitest";
import { remoteTokenPageFor } from "./remoteTokenPage";

describe("remoteTokenPageFor", () => {
  it("resolves GitHub via HTTPS and scp-style SSH", () => {
    expect(remoteTokenPageFor("https://github.com/you/repo.git")).toBe(
      "https://github.com/settings/tokens",
    );
    expect(remoteTokenPageFor("git@github.com:you/repo.git")).toBe(
      "https://github.com/settings/tokens",
    );
  });

  it("resolves GitLab via HTTPS and scp-style SSH", () => {
    expect(remoteTokenPageFor("https://gitlab.com/you/repo.git")).toBe(
      "https://gitlab.com/-/user_settings/personal_access_tokens",
    );
    expect(remoteTokenPageFor("git@gitlab.com:you/repo.git")).toBe(
      "https://gitlab.com/-/user_settings/personal_access_tokens",
    );
  });

  const BB_DOCS =
    "https://support.atlassian.com/bitbucket-cloud/docs/create-a-repository-access-token/";

  it("sends Bitbucket to the repository's own access-token settings (https, scp-style and ssh://)", () => {
    const page = "https://bitbucket.org/you/repo/admin/access-tokens";
    expect(remoteTokenPageFor("https://bitbucket.org/you/repo.git")).toBe(page);
    expect(remoteTokenPageFor("https://bitbucket.org/you/repo")).toBe(page);
    expect(remoteTokenPageFor("https://bitbucket.org/you/repo/")).toBe(page);
    expect(remoteTokenPageFor("git@bitbucket.org:you/repo.git")).toBe(page);
    expect(remoteTokenPageFor("ssh://git@bitbucket.org/you/repo.git")).toBe(
      page,
    );
    expect(remoteTokenPageFor("ssh://git@bitbucket.org:22/you/repo.git")).toBe(
      page,
    );
  });

  it("keeps the Bitbucket repo page free of any credentials in the remote", () => {
    expect(
      remoteTokenPageFor(
        "https://x-token-auth:s3cret@bitbucket.org/you/repo.git",
      ),
    ).toBe("https://bitbucket.org/you/repo/admin/access-tokens");
    expect(remoteTokenPageFor("https://me@bitbucket.org/you/repo.git")).toBe(
      "https://bitbucket.org/you/repo/admin/access-tokens",
    );
    expect(
      remoteTokenPageFor(
        "https://x-token-auth:s3cret@bitbucket.org/you/repo.git",
      ),
    ).not.toContain("s3cret");
  });

  it("drops a query or fragment on an https Bitbucket remote instead of echoing it", () => {
    expect(
      remoteTokenPageFor(
        "https://bitbucket.org/you/repo.git?next=https://evil.example#x",
      ),
    ).toBe("https://bitbucket.org/you/repo/admin/access-tokens");
  });

  it("keeps workspace and repo names with dots, dashes and underscores", () => {
    expect(
      remoteTokenPageFor("https://bitbucket.org/my-team_1/web.app-v2.git"),
    ).toBe("https://bitbucket.org/my-team_1/web.app-v2/admin/access-tokens");
  });

  it("falls back to Atlassian's guide when the Bitbucket repo can't be read from the remote", () => {
    expect(remoteTokenPageFor("https://bitbucket.org")).toBe(BB_DOCS);
    expect(remoteTokenPageFor("https://bitbucket.org/")).toBe(BB_DOCS);
    expect(remoteTokenPageFor("https://bitbucket.org/you")).toBe(BB_DOCS);
    expect(remoteTokenPageFor("https://bitbucket.org/you/repo/src/main")).toBe(
      BB_DOCS,
    );
    expect(remoteTokenPageFor("git@bitbucket.org:you")).toBe(BB_DOCS);
    expect(remoteTokenPageFor("git@bitbucket.org:")).toBe(BB_DOCS);
  });

  it("never splices anything but a plain slug into the Bitbucket URL", () => {
    for (const remote of [
      "https://bitbucket.org/../repo.git",
      "https://bitbucket.org/you/..",
      "https://bitbucket.org/./repo",
      "https://bitbucket.org/you/%2e%2e",
      "https://bitbucket.org/you/re%20po",
      "git@bitbucket.org:you/re po.git",
      "git@bitbucket.org:you/repo.git#x",
      "git@bitbucket.org:you/repo?x=1",
      "git@bitbucket.org:you@evil.example/repo.git",
      "git@bitbucket.org:\\evil.example/repo.git",
    ]) {
      expect(remoteTokenPageFor(remote), remote).toBe(BB_DOCS);
    }
  });

  it("only ever returns an https bitbucket.org URL for a Bitbucket remote", () => {
    for (const remote of [
      "https://bitbucket.org/you/repo.git",
      "git@bitbucket.org:you/repo.git",
      "https://bitbucket.org/you",
    ]) {
      const url = new URL(remoteTokenPageFor(remote)!);
      expect(url.protocol).toBe("https:");
      expect(url.hostname).toMatch(
        /^(bitbucket\.org|support\.atlassian\.com)$/,
      );
      expect(url.username + url.password + url.search + url.hash).toBe("");
    }
  });

  it("resolves Azure DevOps via HTTPS and scp-style SSH", () => {
    expect(
      remoteTokenPageFor("https://dev.azure.com/you/project/_git/repo"),
    ).toBe("https://dev.azure.com/_usersSettings/tokens");
    expect(remoteTokenPageFor("git@dev.azure.com:v3/you/project/repo")).toBe(
      "https://dev.azure.com/_usersSettings/tokens",
    );
  });

  it("also accepts an explicit ssh:// URL", () => {
    expect(remoteTokenPageFor("ssh://git@github.com/you/repo.git")).toBe(
      "https://github.com/settings/tokens",
    );
  });

  it("matches the host case-insensitively", () => {
    expect(remoteTokenPageFor("https://WWW.GitHub.COM/you/repo.git")).toBe(
      "https://github.com/settings/tokens",
    );
  });

  it("ignores a www. prefix", () => {
    expect(remoteTokenPageFor("https://www.github.com/you/repo.git")).toBe(
      "https://github.com/settings/tokens",
    );
  });

  it("ignores a :port suffix", () => {
    expect(remoteTokenPageFor("https://github.com:443/you/repo.git")).toBe(
      "https://github.com/settings/tokens",
    );
  });

  it("returns null for a self-hosted / unknown host — never guesses", () => {
    expect(remoteTokenPageFor("https://gitlab.example.com/x/y.git")).toBeNull();
    expect(remoteTokenPageFor("https://git.internal.corp/x/y.git")).toBeNull();
    expect(remoteTokenPageFor("git@git.internal.corp:x/y.git")).toBeNull();
  });

  it("does not mistake a host named like an Object member for a known host", () => {
    for (const host of ["constructor", "toString", "hasOwnProperty"])
      expect(remoteTokenPageFor(`https://${host}/you/repo.git`)).toBeNull();
    expect(remoteTokenPageFor("https://__proto__/you/repo.git")).toBeNull();
  });

  it("returns null for blank, undefined, and unparseable input", () => {
    expect(remoteTokenPageFor(undefined)).toBeNull();
    expect(remoteTokenPageFor("")).toBeNull();
    expect(remoteTokenPageFor("   ")).toBeNull();
    expect(remoteTokenPageFor("not a url")).toBeNull();
  });

  it("returns null for javascript: and file: values (untrusted input)", () => {
    expect(remoteTokenPageFor("javascript:alert(1)")).toBeNull();
    expect(remoteTokenPageFor("file:///tmp/repo")).toBeNull();
  });
});
