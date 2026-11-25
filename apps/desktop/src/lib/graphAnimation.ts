/**
 * Animation feedback for graph operations (Settings → Personalize →
 * "Animation feedback").
 *
 * When an operation adds commits to the graph, each new commit circle is drawn
 * as a copy flying out of the circle it came from and landing on its own
 * position:
 *
 *  - `head` — commit, merge, revert: one new commit on top of the current one,
 *    so the copy comes out of the circle that was current (HEAD) before.
 *  - `sources` — rebase, cherry-pick and the other rewrites (reword, squash,
 *    drop, purge, add file): every new commit is a replay of an existing one,
 *    so each copy comes out of *its own* source circle.
 *
 * This module is the pure half: which new commit flies from which circle. The
 * drawing is MetroGraph's / GraphRails'. Kept free of Svelte and the DOM so
 * the pairing rules are testable on their own.
 */
import type { Commit } from "./ipc";

/** What App arms right before an operation starts. */
export interface GraphAnimationHint {
  /** Bumped per arming — a new value is a new operation. */
  seq: number;
  mode: "head" | "sources";
  /** The commit that was current (HEAD's target) when the op started. The
   *  origin in `head` mode, and the fallback in `sources` mode. */
  headBefore: string | null;
  /**
   * `sources` mode: the source commits, when the op knows them (cherry-pick
   * does — the picked shas). Rebases and rewrites leave it empty and rely on
   * {@link identityKey} matching instead.
   */
  sources?: string[];
  /**
   * Commits the op is known to have created (a commit reports its new sha).
   * Treated as new even if a background refresh already put them on screen
   * before the hint was armed, so a fast file-watcher can't swallow the
   * animation.
   */
  created?: string[];
}

/** One circle to animate: the new commit and the circle it comes out of. */
export interface Flight {
  sha: string;
  from: string;
}

/** More than this many new commits at once animates only the newest ones —
 *  past a screenful the effect is noise and the cost is not. */
export const MAX_FLIGHTS = 40;

/**
 * The identity git keeps across a rebase or cherry-pick: author, author time
 * and subject. A replayed commit gets a new sha and committer date, but these
 * three are copied from the original — so they pair a rewritten commit with
 * the one it was made from without the backend having to say so.
 */
function identityKey(c: Commit): string {
  return `${c.author_email}\u0000${c.timestamp}\u0000${c.subject}`;
}
/** Looser fallback for a reword, which changes exactly the subject. */
function authorKey(c: Commit): string {
  return `${c.author_email}\u0000${c.timestamp}`;
}

/** First item of `m.get(k)` not yet used, or null. */
function takeUnused(
  m: Map<string, Commit[]>,
  k: string,
  used: Set<string>,
): Commit | null {
  for (const c of m.get(k) ?? []) {
    if (!used.has(c.sha)) return c;
  }
  return null;
}

function group(commits: Commit[], key: (c: Commit) => string) {
  const m = new Map<string, Commit[]>();
  for (const c of commits) {
    const k = key(c);
    const list = m.get(k);
    if (list) list.push(c);
    else m.set(k, [c]);
  }
  return m;
}

/**
 * Pair every commit that `next` has and `before` did not with the circle it
 * should fly out of.
 *
 * `before` is the graph as it was when the hint was armed; `next` the graph
 * after the operation. A source must be a commit that was on screen before
 * (otherwise there is no circle to copy). Returns flights oldest-first — the
 * order they were created in, which is the order they are staggered in.
 */
export function planFlights(
  before: Commit[],
  next: Commit[],
  hint: GraphAnimationHint,
): Flight[] {
  const beforeShas = new Set(before.map((c) => c.sha));
  const created = new Set(hint.created ?? []);
  // `next` is newest-first (the graph's row order); flights go oldest-first.
  const fresh = next
    .filter((c) => !c.ghost && (created.has(c.sha) || !beforeShas.has(c.sha)))
    .reverse()
    .slice(-MAX_FLIGHTS);
  if (fresh.length === 0) return [];

  // Candidate sources: what was on screen before, minus the new commits
  // themselves (a `created` commit may already have been on screen).
  const pool = before.filter((c) => !created.has(c.sha));
  const onScreen = new Set(pool.map((c) => c.sha));
  const head =
    hint.headBefore && onScreen.has(hint.headBefore) ? hint.headBefore : null;

  if (hint.mode === "head") {
    return fresh.flatMap((c) => {
      // The circle a commit is made "on top of" is its first parent when that
      // was on screen; otherwise the commit that was current.
      const parent = c.parents[0];
      const from = parent && onScreen.has(parent) ? parent : head;
      return from ? [{ sha: c.sha, from }] : [];
    });
  }

  // `sources`: exact identity first, then author+time (a reword changes the
  // subject), then the op's own ordered source list, then HEAD.
  const byIdentity = group(pool, identityKey);
  const byAuthor = group(pool, authorKey);
  const listed = (hint.sources ?? []).filter((s) => onScreen.has(s));
  const used = new Set<string>();
  const flights: Flight[] = [];
  let nextListed = 0;
  for (const c of fresh) {
    let from =
      takeUnused(byIdentity, identityKey(c), used)?.sha ??
      takeUnused(byAuthor, authorKey(c), used)?.sha ??
      null;
    if (!from) {
      while (nextListed < listed.length && used.has(listed[nextListed])) {
        nextListed++;
      }
      from = listed[nextListed] ?? null;
      if (from) nextListed++;
    }
    from ??= head;
    if (!from) continue;
    used.add(from);
    flights.push({ sha: c.sha, from });
  }
  return flights;
}

/**
 * Whether the OS asks for reduced motion. Animation feedback is decoration:
 * it is skipped there whatever the setting says.
 */
export function prefersReducedMotion(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch {
    return false;
  }
}
