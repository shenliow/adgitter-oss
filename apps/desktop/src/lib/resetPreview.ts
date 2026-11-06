/**
 * Which commits a HEAD-crown reset would drop from the current branch.
 *
 * Dragging the crown onto a commit (or onto a branch label, which names that
 * branch's tip) resets the current branch there. The graph previews the
 * consequence WHILE the drag hovers, so the user can see what they are about
 * to give up before they let go. `soft`/`mixed`/`hard` discard exactly the
 * same commits — the modifier only decides what happens to the index and the
 * working tree — so this computation is modifier-independent.
 *
 * The set is `ancestors(HEAD) \ ancestors(target)`, both inclusive of their
 * own tip. Written as a walk from HEAD that prunes at anything reachable from
 * the target, which is equivalent: `ancestors(target)` is closed under
 * "parent of", so nothing behind a kept commit can be discarded.
 *
 * Deliberate limits, both of them honest-silence rather than guesswork:
 *  - **The commit page is a window.** The walk can only cross parents that
 *    are actually loaded, so a history longer than the page previews the
 *    loaded prefix of the discarded range and stops. If the TARGET itself is
 *    off-page nothing can be computed at all (we cannot tell which of HEAD's
 *    ancestors the target keeps), and the result is empty — better to preview
 *    nothing than to ghost the whole page.
 *  - A discarded commit that some OTHER ref still points at survives the
 *    reset in the repository even though it leaves the current branch. The
 *    preview answers "what leaves this branch's history", which is what the
 *    gesture does; it does not cross-check every other ref.
 */

/** The shape this needs off `Commit` — sha plus its parent shas. */
export interface ParentedCommit {
  sha: string;
  parents: string[];
}

/** Every loaded commit reachable from `sha` (inclusive), stopping at parents
 *  that fall outside the loaded page. */
function reachable(
  byS: ReadonlyMap<string, ParentedCommit>,
  sha: string,
): Set<string> {
  const seen = new Set<string>();
  const stack = [sha];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    const c = byS.get(cur);
    if (!c) continue; // off-page: the walk stops here
    seen.add(cur);
    for (const p of c.parents) stack.push(p);
  }
  return seen;
}

/**
 * The commits a reset of HEAD onto `targetSha` would abandon, bounded by the
 * loaded commit page. Empty (nothing to preview) when either end is missing
 * from the page, when they are the same commit, or when the target already
 * contains all of HEAD's history — a reset forward onto a descendant, or onto
 * HEAD itself, genuinely loses nothing.
 */
export function discardedByReset(
  commits: readonly ParentedCommit[],
  headSha: string | null | undefined,
  targetSha: string | null | undefined,
): Set<string> {
  const out = new Set<string>();
  if (!headSha || !targetSha || headSha === targetSha) return out;
  const byS = new Map<string, ParentedCommit>();
  for (const c of commits) byS.set(c.sha, c);
  if (!byS.has(headSha) || !byS.has(targetSha)) return out;

  const kept = reachable(byS, targetSha);
  const stack = [headSha];
  while (stack.length) {
    const cur = stack.pop()!;
    if (kept.has(cur) || out.has(cur)) continue;
    const c = byS.get(cur);
    if (!c) continue;
    out.add(cur);
    for (const p of c.parents) stack.push(p);
  }
  return out;
}
