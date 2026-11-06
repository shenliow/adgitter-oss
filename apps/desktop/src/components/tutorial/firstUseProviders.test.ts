import { describe, it, expect } from "vitest";
import { gitTokenProviders } from "./firstUseProviders";
import { remoteTokenPageFor } from "../../lib/remoteTokenPage";
import { en } from "../../lib/i18n/messages";

describe("first-use token providers", () => {
  it("lists the git providers in order, with their token pages", () => {
    const git = gitTokenProviders();
    expect(git.map((p) => p.name)).toEqual([
      "GitHub",
      "GitLab",
      "Bitbucket",
      "Azure DevOps",
    ]);
    expect(git.map((p) => p.url)).toEqual([
      "https://github.com/settings/tokens",
      "https://gitlab.com/-/user_settings/personal_access_tokens",
      "https://support.atlassian.com/bitbucket-cloud/docs/create-a-repository-access-token/",
      "https://dev.azure.com/_usersSettings/tokens",
    ]);
  });

  it("sends Bitbucket to the docs page: the guide has no repository to link", () => {
    const bb = gitTokenProviders().find((p) => p.id === "git-bitbucket")!;
    expect(bb.url).toBe(remoteTokenPageFor("https://bitbucket.org"));
    expect(bb.url).not.toContain("/admin/access-tokens");
    expect(bb.url).not.toContain("owner/repo");
  });

  it("teaches the access token the app signs in with, not the retired app password", () => {
    const steps = en["firstUse.git.bitbucket.steps"];
    expect(steps).toMatch(/Repository settings → Security → Access tokens/);
    expect(steps).toMatch(/Repositories: Write/);
    expect(steps).not.toMatch(/app password|API token/i);
  });

  it("derives git URLs from remoteTokenPage.ts (no copies)", () => {
    for (const p of gitTokenProviders()) {
      expect(p.url).not.toBeNull();
    }
    expect(gitTokenProviders()[0].url).toBe(
      remoteTokenPageFor("git@github.com:you/repo.git"),
    );
  });

  it("every provider has scopes and steps copy in the en catalog", () => {
    for (const p of gitTokenProviders()) {
      expect(en[p.scopesKey], p.id).toBeTruthy();
      expect(en[p.stepsKey], p.id).toBeTruthy();
      expect(en[p.stepsKey].split("\n").length, p.id).toBeGreaterThanOrEqual(2);
    }
  });

  it("states each provider's required access", () => {
    const scopes = (id: string) =>
      gitTokenProviders()
        .filter((p) => p.id === id)
        .map((p) => en[p.scopesKey])[0];
    expect(scopes("git-github")).toMatch(/repo/);
    expect(scopes("git-github")).toMatch(/Contents: Read and write/);
    expect(scopes("git-gitlab")).toMatch(/read_repository/);
    expect(scopes("git-gitlab")).toMatch(/write_repository/);
    expect(scopes("git-bitbucket")).toMatch(/Repository Access Token/);
    expect(scopes("git-bitbucket")).toMatch(/Repositories: Write/);
    expect(scopes("git-bitbucket")).not.toMatch(/app password(?!s no longer)/i);
    expect(scopes("git-azure")).toMatch(/Code: Read & write/);
  });
});
