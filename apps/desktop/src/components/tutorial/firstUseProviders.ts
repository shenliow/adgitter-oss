/**
 * Data behind the first-use guide's personal-access-token page: which
 * providers to list, where each one's token page lives, and the copy keys for
 * the required scopes and creation steps.
 *
 * The URLs are NOT written down here — they come from the same helper the
 * Settings "Where do I get a token?" links use (`remoteTokenPage.ts`), so a
 * vendor URL change is made in exactly one place. The issue trackers' list
 * comes with the issue tracker (`lib/pro.ts`).
 */
import type { MessageKey } from "../../lib/i18n/messages";
import { remoteTokenPageFor } from "../../lib/remoteTokenPage";

export interface TokenProvider {
  /** Stable id, e.g. `git-github` / `issue-jira`. */
  id: string;
  /** Brand name — shown as-is, never translated. */
  name: string;
  /** Cloud token-management page, or null if it cannot be derived. */
  url: string | null;
  scopesKey: MessageKey;
  stepsKey: MessageKey;
}

interface GitProviderDef {
  id: string;
  name: string;
  /** The provider's cloud host. Deliberately no repository path: this guide
   *  is not about any repository, and Bitbucket's token page is per
   *  repository (with no repo, `remoteTokenPageFor` returns its docs page). */
  remote: string;
  scopesKey: MessageKey;
  stepsKey: MessageKey;
}

const GIT_PROVIDERS: readonly GitProviderDef[] = [
  {
    id: "github",
    name: "GitHub",
    remote: "https://github.com",
    scopesKey: "firstUse.git.github.scopes",
    stepsKey: "firstUse.git.github.steps",
  },
  {
    id: "gitlab",
    name: "GitLab",
    remote: "https://gitlab.com",
    scopesKey: "firstUse.git.gitlab.scopes",
    stepsKey: "firstUse.git.gitlab.steps",
  },
  {
    id: "bitbucket",
    name: "Bitbucket",
    remote: "https://bitbucket.org",
    scopesKey: "firstUse.git.bitbucket.scopes",
    stepsKey: "firstUse.git.bitbucket.steps",
  },
  {
    id: "azure",
    name: "Azure DevOps",
    remote: "https://dev.azure.com",
    scopesKey: "firstUse.git.azure.scopes",
    stepsKey: "firstUse.git.azure.steps",
  },
];

/** Git hosting providers (GitHub, GitLab, Bitbucket, Azure DevOps). */
export function gitTokenProviders(): TokenProvider[] {
  return GIT_PROVIDERS.map((p) => ({
    id: `git-${p.id}`,
    name: p.name,
    url: remoteTokenPageFor(p.remote),
    scopesKey: p.scopesKey,
    stepsKey: p.stepsKey,
  }));
}
