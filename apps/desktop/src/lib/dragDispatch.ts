/**
 * Drag-dispatch resolver.
 *
 * The gesture grammar disambiguates an operation by
 * **(drag source, modifier) → target**. This module is the single, pure source
 * of truth for that mapping so it can be exhaustively unit-tested and reused by
 * both the live drag handlers and their right-click menu equivalents.
 *
 * Every backend op (`merge`/`reset`/`cherry_pick`/`rebase_onto`) acts on the
 * **current** branch, so the rules here are expressed relative to it — exactly
 * mirroring the branch/commit context menus:
 *   - drag a *non-current* branch label onto the *current* branch:
 *       plain  → merge that branch into current
 *       Shift  → rebase current onto that branch
 *   - Alt-drag a commit selection onto the current branch → cherry-pick
 *   - drag a commit selection onto a *commit* node or a *branch* chip:
 *       branch mode (the selection is a whole selected branch, unmodified)
 *         → a branch-as-a-unit drag is ALWAYS a rebase of that branch onto
 *           the target — no modifier needed, Shift behaves identically; Alt
 *           instead turns it into a cherry-pick onto the current branch
 *           (the rule above)
 *       individual mode (an ordinary commit-set selection), Shift, commit
 *         target only
 *         → cherry-pick the selection onto a fresh branch at the target
 *   - drag the HEAD crown onto a commit → reset (plain = mixed, Shift = hard,
 *     Cmd/Ctrl = soft)
 *   - drag changed-files onto the current branch → commit
 * Any other combination resolves to `null` (an invalid drop — no affordance).
 */

export type DragSource =
  | { kind: "branch"; name: string; current: boolean }
  /** `branch` names the branch this selection is "as a unit" (branch mode,
   *  set only while the selection still exactly matches that branch's
   *  segment, unmodified) — absent/null in ordinary individual-commit mode. */
  | { kind: "commits"; shas: string[]; branch?: string | null }
  | { kind: "head"; sha: string }
  | { kind: "files" };

export type DropTarget =
  | { kind: "branch"; name: string; current: boolean }
  | {
      kind: "commit";
      sha: string;
      short: string;
      /** Local branch names pointing at this commit, in display order;
       *  `branches[0]` is the default rebase target when present, and two or
       *  more make the target ambiguous — see {@link chooseTargetBranch}. */
      branches?: string[];
    };

export interface Modifiers {
  shift: boolean;
  alt: boolean;
  meta: boolean;
  ctrl: boolean;
}

export type DragOp =
  /** Merge `source` (a branch) into the current branch. */
  | { op: "merge"; source: string }
  /** Rebase the current branch onto `onto` (a branch). */
  | { op: "rebase"; onto: string }
  /** Cherry-pick `commits` (oldest-first) onto the current branch. */
  | { op: "cherryPick"; commits: string[] }
  /** Branch-mode drag (any modifier but Alt): rebase `branch` onto `onto`
   *  (a rev — a commit sha, or a branch name when the target commit has a
   *  local branch, or a branch was targeted directly; `short` is its
   *  display label). `candidates` is set (length ≥ 2) only when the drop
   *  landed on a commit carrying several local branches, i.e. `onto` is an
   *  arbitrary pick the user must confirm. */
  | {
      op: "rebaseBranch";
      branch: string;
      onto: string;
      short: string;
      candidates?: string[];
    }
  /** Shift-drag, individual mode: cherry-pick `shas` (oldest-first) onto a
   *  new branch created at commit `target` (`short` is its abbreviated sha). */
  | { op: "cherryPickNewBranch"; shas: string[]; target: string; short: string }
  /** Reset the current branch to `target` (a commit sha or a branch name —
   *  {@link chooseTargetBranch}'s "same commit either way" rule applies here
   *  too, so a branch pick and the bare sha move HEAD identically; the pick
   *  only changes the reflog text and dialog copy). `candidates` (length ≥
   *  2, else absent) is set only when the drop landed on a commit carrying
   *  several local branches — the confirm dialog must then let the user
   *  choose among every branch **and** the commit itself (its `short` sha,
   *  paired with the full sha in `commitSha` so the pick always resolves via
   *  a real sha rather than the abbreviated display string). 0 or 1 branch
   *  never prompts. */
  | {
      op: "reset";
      target: string;
      short: string;
      mode: "soft" | "mixed" | "hard";
      candidates?: string[];
      commitSha?: string;
    }
  /** Commit the changed-files selection on the current branch. */
  | { op: "commit" }
  /** Drag the checked-out branch's own chip ("drag HEAD") onto a commit or
   *  another branch label → check out `branch` there. WHAT is being checked
   *  out is never ambiguous (there's only one branch being dragged); only
   *  WHERE it lands can be, exactly like a branch-mode commits drag landing
   *  on a multi-branch commit — see `chooseTargetBranch`. `candidates`
   *  (length ≥ 2, else absent) is set only when the drop landed on a commit
   *  carrying several local branches, so the confirm gate can ask instead of
   *  silently taking chip display order. */
  | { op: "checkout"; branch: string; candidates?: string[] };

/** Target affordance: `(+)` for additive ops, dashed circle for graph-rewrites. */
export type Affordance = "plus" | "dashed" | null;

export const NO_MODS: Modifiers = {
  shift: false,
  alt: false,
  meta: false,
  ctrl: false,
};

/** Read the modifier flags off a drag/pointer event. */
export function modsOf(e: {
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}): Modifiers {
  return { shift: e.shiftKey, alt: e.altKey, meta: e.metaKey, ctrl: e.ctrlKey };
}

/**
 * Union of two modifier snapshots. Needed because macOS WKWebView never
 * populates the modifier flags on DragEvents (they read `false` throughout a
 * drag), so the graph pairs the event's own flags with a keyboard-tracked
 * snapshot (see MetroGraph's kbMods) — whichever source saw the key wins.
 * Chromium/jsdom deliver real event flags, so this stays correct there too.
 */
export function mergeMods(a: Modifiers, b: Modifiers): Modifiers {
  return {
    shift: a.shift || b.shift,
    alt: a.alt || b.alt,
    meta: a.meta || b.meta,
    ctrl: a.ctrl || b.ctrl,
  };
}

/** Which branch a drop onto a commit targets, and whether that pick is
 *  ambiguous. See {@link chooseTargetBranch}. */
export interface BranchTarget {
  /** The default target — the first candidate in display order, or `null`
   *  when the commit carries no local branch at all. */
  branch: string | null;
  /** Every candidate, display order. Populated (length ≥ 2) **only** when the
   *  pick is ambiguous, so callers can treat a non-empty list as "ask the
   *  user"; a single candidate stays unambiguous and yields `[]`. */
  candidates: string[];
}

/**
 * Disambiguate the branch a merge/rebase drop targets. Pure.
 *
 * Git semantics drive the rules:
 *   - **0 branches** → there is nothing to choose; the caller keeps its
 *     existing commit-as-target behaviour (`rebase --onto <sha>`, create a
 *     branch at the sha, reset to the sha). Tags are deliberately never
 *     candidates: you cannot merge into or rebase a tag, so a commit carrying
 *     only tags lands here and behaves exactly as it does today.
 *   - **1 branch** → unambiguous; behaviour is unchanged and no prompt fires.
 *   - **≥2 branches** → they all point at the same commit, so the first one is
 *     an arbitrary artefact of chip display order. The caller must surface the
 *     candidate list and let the user pick.
 */
export function chooseTargetBranch(
  branches?: readonly string[] | null,
): BranchTarget {
  const list = branches ?? [];
  return {
    branch: list[0] ?? null,
    candidates: list.length > 1 ? [...list] : [],
  };
}

/** A branch-head merge drag (the affordance dot above a branch-head node),
 *  resolved against both endpoints. See {@link resolveMergeDrop}. */
export interface MergeDrop {
  /** The branch to merge in — the default pick at the drag's origin. */
  source: string;
  /** The branch that will be checked out and advanced by the merge. */
  target: string;
  /** Every branch at the drag origin, display order — populated (≥2) only
   *  when that pick is ambiguous. */
  sourceCandidates: string[];
  /** Same, for the drop target. */
  targetCandidates: string[];
}

/**
 * Resolve a branch-head merge drag into `git checkout <target> && git merge
 * <source>`, disambiguating **both** endpoints. Pure.
 *
 * Both ends are `chooseTargetBranch` picks: a commit can carry several local
 * branches, and taking chip display order silently is exactly the bug this
 * avoids. The two sides differ in what the pick costs, and the dialog copy
 * should not overstate the source side:
 *   - **target** decides which branch gets checked out and advanced — a
 *     different pick rewrites a different ref.
 *   - **source** only names the commit to merge in. Sibling branches at one
 *     commit resolve to the same commit, so the resulting DAG, the
 *     fast-forward/up-to-date analysis and every ref move are identical; the
 *     name survives solely as text in the merge commit message
 *     (`Merge <source>`, also used for the message written when a conflicted
 *     merge is continued). Nothing tracks upstreams off it.
 *
 * Returns `null` for a drop that cannot merge anything: an endpoint with no
 * local branch, or both ends resolving to the same branch. The latter also
 * covers a drop back onto the *origin commit*, where the two candidate sets
 * are identical — without the guard the user could pick two different names
 * for the same commit and get an already-up-to-date no-op. (Distinct commits
 * always have disjoint branch sets, since a branch name points at one commit,
 * so this only ever fires for the same-commit case.)
 */
export function resolveMergeDrop(
  sourceBranches?: readonly string[] | null,
  targetBranches?: readonly string[] | null,
): MergeDrop | null {
  const src = chooseTargetBranch(sourceBranches);
  const dst = chooseTargetBranch(targetBranches);
  if (!src.branch || !dst.branch) return null;
  if (src.branch === dst.branch) return null;
  return {
    source: src.branch,
    target: dst.branch,
    sourceCandidates: src.candidates,
    targetCandidates: dst.candidates,
  };
}

/**
 * Resolve a drag into a concrete operation, or `null` when the (source,
 * modifier, target) triple is not a legal gesture. Pure — no side effects.
 */
export function resolveDrag(
  source: DragSource,
  target: DropTarget | null,
  mod: Modifiers,
): DragOp | null {
  if (!target) return null;

  switch (source.kind) {
    case "branch": {
      // Dragging the checked-out branch's own chip ("drag HEAD"): this can
      // never be a merge/rebase source (nothing merges/rebases onto itself),
      // so it's repurposed as a checkout — grab the current branch's chip
      // and drop it wherever HEAD should move to.
      if (source.current) {
        if (target.kind === "commit") {
          const { branch, candidates } = chooseTargetBranch(target.branches);
          // No local branch at the target commit: there's nothing to check
          // OUT to (a bare-commit/detached checkout is a different, existing
          // gesture — double-click — not this one), so no affordance.
          if (!branch) return null;
          // Unambiguous pick that's also already where HEAD is: a true
          // no-op, same guard style as resolveMergeDrop's same-branch case.
          if (!candidates.length && branch === source.name) return null;
          return candidates.length
            ? { op: "checkout", branch, candidates }
            : { op: "checkout", branch };
        }
        if (target.kind === "branch") {
          if (target.name === source.name) return null;
          return { op: "checkout", branch: target.name };
        }
        return null;
      }
      // Merge/rebase are expressed against the current branch: grab another
      // branch's label and drop it on the current branch.
      if (target.kind !== "branch") return null;
      if (!target.current) return null;
      if (source.name === target.name) return null;
      return mod.shift
        ? { op: "rebase", onto: source.name }
        : { op: "merge", source: source.name };
    }

    case "commits": {
      if (source.shas.length === 0) return null;

      // Branch mode: a branch-as-a-unit drag is ALWAYS a rebase — plain drag
      // and Shift-drag behave identically. Only Alt opts out, falling through
      // to the cherry-pick rule below (Alt-drag onto the current branch chip
      // must still cherry-pick).
      if (source.branch && !mod.alt) {
        if (target.kind === "commit") {
          // A no-op if the target sits inside the dragged selection (that
          // covers "the branch's own tip" too, since its segment always
          // includes the tip). When the target commit carries local branch
          // label(s), default the rebase target to the first one instead of
          // the bare sha — and when there are several, hand the whole list up
          // so the confirm gate can ask which one instead of silently picking
          // by chip display order.
          if (source.shas.includes(target.sha)) return null;
          const { branch, candidates } = chooseTargetBranch(target.branches);
          if (!branch)
            return {
              op: "rebaseBranch",
              branch: source.branch,
              onto: target.sha,
              short: target.short,
            };
          const op: DragOp = {
            op: "rebaseBranch",
            branch: source.branch,
            onto: branch,
            short: branch,
          };
          // Only carry `candidates` when the pick was ambiguous, so the
          // single-branch op stays byte-identical to its previous shape.
          return candidates.length ? { ...op, candidates } : op;
        }
        // Directly onto a branch chip: force that branch as the rebase
        // target (a no-op if it's the branch being dragged).
        if (target.name === source.branch) return null;
        return {
          op: "rebaseBranch",
          branch: source.branch,
          onto: target.name,
          short: target.name,
        };
      }

      // Individual mode, Shift onto a commit node: cherry-pick the selection
      // onto a new branch at the target. Same in-selection no-op as above.
      if (!source.branch && mod.shift && target.kind === "commit") {
        if (source.shas.includes(target.sha)) return null;
        return {
          op: "cherryPickNewBranch",
          shas: source.shas,
          target: target.sha,
          short: target.short,
        };
      }

      // Cherry-pick requires Alt and drops onto the current branch.
      if (!mod.alt) return null;
      if (target.kind !== "branch" || !target.current) return null;
      return { op: "cherryPick", commits: source.shas };
    }

    case "head": {
      // The HEAD crown resets the current branch to a commit node or a
      // branch label.
      const mode: "soft" | "mixed" | "hard" = mod.shift
        ? "hard"
        : mod.meta || mod.ctrl
          ? "soft"
          : "mixed";

      if (target.kind === "branch") {
        // Dropping the crown directly on a branch label names exactly one
        // branch, so this can never be ambiguous — no `chooseTargetBranch`
        // needed. Dropping on the current branch's own chip is a no-op:
        // HEAD is already there (same guard style as the `checkout` case).
        if (target.current) return null;
        return { op: "reset", target: target.name, short: target.name, mode };
      }

      // target.kind === "commit"
      if (target.sha === source.sha) return null;
      const { branch, candidates } = chooseTargetBranch(target.branches);
      if (!branch) {
        // No local branch at the target commit: reset to the bare sha,
        // unchanged from before candidate disambiguation existed.
        return { op: "reset", target: target.sha, short: target.short, mode };
      }
      if (!candidates.length) {
        // Exactly one branch: default the target to it (mirrors
        // rebaseBranch/checkout's single-candidate default) — still no
        // prompt, and per `history::reset`'s revparse_single, the branch
        // name and the bare sha move HEAD identically either way.
        return { op: "reset", target: branch, short: branch, mode };
      }
      // ≥2 branches: ambiguous. Offer every branch AND the commit itself
      // (its short sha) as choices; default to the bare commit — the
      // pre-disambiguation behaviour — until the user actively picks one.
      return {
        op: "reset",
        target: target.sha,
        short: target.short,
        mode,
        candidates: [...candidates, target.short],
        commitSha: target.sha,
      };
    }

    case "files": {
      if (target.kind !== "branch" || !target.current) return null;
      return { op: "commit" };
    }
  }
}

/** The affordance the drop target should render for a resolved op. */
export function affordanceFor(op: DragOp | null): Affordance {
  if (!op) return null;
  switch (op.op) {
    case "merge":
    case "rebase":
    case "rebaseBranch":
    case "checkout":
      return "dashed";
    case "cherryPick":
    case "cherryPickNewBranch":
    case "commit":
      return "plus";
    case "reset":
      return null;
  }
}
