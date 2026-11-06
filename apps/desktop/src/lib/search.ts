/**
 * Repository search. A pure, client-side filter over the already-loaded
 * commits + refs (scope: current repo) — no backend round-trip for v1.
 * Matches commit subject / author / sha,
 * branch/tag names, and — when an external tracker is bound — issue
 * **assignee**, ranked so the most specific matches come first.
 * Commit/branch/tag results resolve to a commit sha (jump the graph); issue
 * results carry an `issueId` (open the issue panel).
 */
import type { Commit, RefList } from "./ipc";

export type SearchResultKind = "commit" | "branch" | "tag" | "issue";

/**
 * Which field(s) the query is compared against.
 *
 * - `all` — the default "this project" scope: every field the original search
 *   covered (commit subject/author/sha + branch/tag names + issue assignee).
 *   Its behaviour is frozen; narrowing scopes are additive code paths so the
 *   default can never regress.
 * - `commits` — every field of a commit (subject, body, author, sha, date).
 * - `message` / `author` / `hash` / `time` — one commit field group each.
 * - `branch` / `tag` — ref names only.
 */
export type SearchScope =
  | "all"
  | "commits"
  | "message"
  | "author"
  | "hash"
  | "time"
  | "branch"
  | "tag";

/** Menu order for the scope picker. `all` first — it is the default. */
export const SEARCH_SCOPES: readonly SearchScope[] = [
  "all",
  "commits",
  "message",
  "author",
  "hash",
  "time",
  "branch",
  "tag",
] as const;

export interface SearchResult {
  kind: SearchResultKind;
  /** The commit sha to jump to (a ref's target for branch/tag results). */
  sha: string;
  label: string;
  detail: string;
  /** For `issue` results: the issue id to open in the panel (sha is empty). */
  issueId?: string;
}

/**
 * Minimal issue shape the `assignee` scope needs — a subset of
 * `IssueModel`, so the caller passes its issues straight through. Only supplied
 * when an external tracker is bound.
 */
export interface SearchIssue {
  id: string;
  number: number;
  title: string;
  assignee?: { name: string };
}

interface Scored {
  r: SearchResult;
  score: number;
}

/** Rank a name match: exact > prefix > substring (0 = no match). */
function nameScore(name: string, q: string): number {
  const n = name.toLowerCase();
  if (n === q) return 6;
  if (n.startsWith(q)) return 5;
  if (n.includes(q)) return 4;
  return 0;
}

/** Best `nameScore` across several candidate strings (0 = none matched). */
function bestScore(candidates: string[], q: string): number {
  let best = 0;
  for (const c of candidates) {
    if (!c) continue;
    const s = nameScore(c, q);
    if (s > best) best = s;
  }
  return best;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The string the `time` scope matches against: `YYYY-MM-DD HH:MM` in the
 * viewer's **local** time zone — the same wall clock the graph rows and the
 * commit-details footer render, so what you see is what you can search.
 *
 * Deliberately ISO-shaped rather than locale-formatted: `03/04` means March 4th
 * in one locale and April 3rd in another, so matching localized text would make
 * results depend on the UI language. One stable format keeps `time` searches
 * predictable, and prefix matching then falls out for free — `2026` is a year,
 * `2026-08` a month, `2026-08-18` a day.
 */
export function commitDateKey(tsSeconds: number): string {
  const d = new Date(tsSeconds * 1000);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    ` ${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/**
 * Date queries are typed with whatever separator is at hand, so `/` and `.` are
 * folded to `-`; `2026/08` and `2026-08` mean the same thing.
 */
function normalizeTimeQuery(q: string): string {
  return q.replace(/[/.]/g, "-");
}

/** Score one commit for a single-field scope (0 = no match). */
function commitScopeScore(c: Commit, q: string, scope: SearchScope): number {
  switch (scope) {
    case "message":
      return bestScore([c.subject, c.body], q);
    case "author":
      return bestScore([c.author_name, c.author_email], q);
    case "hash":
      return bestScore([c.sha, c.short_sha], q);
    case "time":
      return bestScore([commitDateKey(c.timestamp)], normalizeTimeQuery(q));
    case "commits":
      // Every commit field: the text fields with the raw query, the date with
      // the separator-folded one.
      return Math.max(
        bestScore(
          [
            c.subject,
            c.body,
            c.author_name,
            c.author_email,
            c.sha,
            c.short_sha,
          ],
          q,
        ),
        bestScore([commitDateKey(c.timestamp)], normalizeTimeQuery(q)),
      );
    default:
      return 0;
  }
}

function commitResult(c: Commit): SearchResult {
  return {
    kind: "commit",
    sha: c.sha,
    label: c.subject || "(no message)",
    detail: `${c.short_sha} · ${c.author_name}`,
  };
}

/**
 * Search `commits` + `refs` for `query`. Returns up to `limit` results,
 * best-match first. An empty/whitespace query yields no results.
 *
 * `scope` narrows which fields are compared (default `all` = the original
 * whole-project behaviour, including the issue-assignee match). Narrowed scopes
 * rank with the same exact(6) > prefix(5) > substring(4) ladder as ref names, so
 * ordering stays meaningful when only one kind of result can appear.
 */
export function searchRepo(
  query: string,
  commits: Commit[],
  refs: RefList | null,
  issues: SearchIssue[] = [],
  limit = 20,
  scope: SearchScope = "all",
): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  if (scope !== "all") {
    const out: Scored[] = [];
    if (scope === "branch" && refs) {
      for (const b of refs.branches) {
        const s = nameScore(b.name, q);
        if (s) out.push({ r: ref("branch", b.target, b.name), score: s });
      }
    } else if (scope === "tag" && refs) {
      for (const t of refs.tags) {
        const s = nameScore(t.name, q);
        if (s) out.push({ r: ref("tag", t.target, t.name), score: s });
      }
    } else {
      for (const c of commits) {
        const s = commitScopeScore(c, q, scope);
        if (s) out.push({ r: commitResult(c), score: s });
      }
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, limit).map((x) => x.r);
  }

  const out: Scored[] = [];

  if (refs) {
    for (const b of refs.branches) {
      const s = nameScore(b.name, q);
      if (s) out.push({ r: ref("branch", b.target, b.name), score: s });
    }
    for (const t of refs.tags) {
      const s = nameScore(t.name, q);
      if (s) out.push({ r: ref("tag", t.target, t.name), score: s });
    }
  }

  for (const c of commits) {
    const subject = c.subject.toLowerCase();
    const author = c.author_name.toLowerCase();
    const shaHit = c.sha.startsWith(q) || c.short_sha.toLowerCase().includes(q);
    let score = 0;
    if (shaHit) score = Math.max(score, 3);
    if (subject.startsWith(q)) score = Math.max(score, 2);
    else if (subject.includes(q)) score = Math.max(score, 1);
    if (author.includes(q)) score = Math.max(score, 1);
    if (score > 0) out.push({ r: commitResult(c), score });
  }

  // Issue `assignee` scope: only present when a tracker is bound, so
  // free / unbound repos never surface issue results. Match the assignee name.
  for (const issue of issues) {
    const name = issue.assignee?.name;
    const s = name ? nameScore(name, q) : 0;
    if (s) {
      out.push({
        r: {
          kind: "issue",
          sha: "",
          issueId: issue.id,
          label: issue.title || `#${issue.number}`,
          detail: `#${issue.number} · ${name}`,
        },
        score: s,
      });
    }
  }

  // Stable sort by descending score (refs outrank commits via higher scores).
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit).map((x) => x.r);
}

function ref(kind: "branch" | "tag", sha: string, name: string): SearchResult {
  return { kind, sha, label: name, detail: kind };
}
