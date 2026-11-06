/**
 * The identity of an issue-tracker binding, as `adgitter.config.json` stores
 * it: which tracker, where it is hosted, and which container (repository,
 * project or workspace) it is scoped to.
 *
 * Every build reads and writes these fields, including one that cannot use a
 * tracker, so saving a shared config file never drops the binding a teammate
 * made.
 */

/** The external trackers a repository can be bound to. */
export type IssueProviderKind = "jira" | "asana" | "gitlab" | "github";

export const PROVIDER_KINDS: readonly IssueProviderKind[] = [
  "jira",
  "asana",
  "gitlab",
  "github",
];

/** Where the bound instance lives — SaaS or a self-managed install. */
export type Deployment = "cloud" | "selfHosted";

/**
 * Unified container ("scope") shape across providers: GitHub repository,
 * GitLab project, Jira project, or Asana workspace+project.
 */
export interface ContainerRef {
  id: string;
  name: string;
  ref: string;
}
