/**
 * Guided tutorial — the declarative step script.
 *
 * One flat list of "leaf" steps. A step that the spec splits into ordered
 * sub-steps (7a/7b, 10a/10b …) is simply several leaves sharing the same
 * top-level number `n`; the engine shows `n / TOTAL_STEPS` for all of them.
 *
 * Every leaf declares, as pure functions of the demo repo's current
 * {@link TutorialRepoView}:
 *   - `targets`  CSS selectors the overlay punches holes for (input passes
 *                through them, everything else is blocked);
 *   - `allows`   whether a user ACTION may run right now (wrong kind or wrong
 *                target ⇒ refused BEFORE it runs, the hint is shown);
 *   - `done`     whether an EVENT (something that actually happened) completes
 *                the step — a failed operation never matches.
 * Shas are resolved BY SUBJECT from the view, never hard-coded: the script
 * rewrites history (rebase, purge, reword …) so shas change under it.
 *
 * ## Ambiguous-rule decisions (documented here, tested in steps.test.ts)
 *  - **Subjects are not unique.** After a purge/reword the original commits
 *    stay visible (main, tags and `origin/*` keep the old chain), so two
 *    "Add config" / "Add helpers" / "Add drak theme" exist. Every lookup is
 *    "the commit with this subject REACHABLE FROM that branch's tip" — a walk
 *    over `view.commits[].parents` ({@link findOnBranch}), never "the first in
 *    the list" (list order is irrelevant).
 *  - **Step 12 (reset).** Allowed targets are exactly main's first-parent
 *    line below its tip ({@link mainLineShas}): C5, C4, C3, C2 and the starter history after the
 *    merge — never a commit that is only reachable through a merged side
 *    branch (`feature/login`), `feature/*`, `experiment` or the tip itself.
 *    A target may be a branch name or a sha; both resolve through the view.
 *  - **Step 17a.** A normal push is the point; it completes on ANY failed
 *    non-force push (`ok:false`), regardless of the `rejected` flag — git-core
 *    reports a non-fast-forward as a generic error, so App's `rejected` is
 *    only best-effort. In the local demo that is the only way for it to fail.
 *  - **Step 22.** Completes only when the saved settings really changed the
 *    theme (`themeChanged`). App opens Settings straight on Personalize, and
 *    the holes are just that panel, its tab button, OK and Cancel: the rest of
 *    the modal (General's git email writes `~/.gitconfig`, the other tabs'
 *    account / plan / keymap controls) stays dimmed and unreachable, and a
 *    `settingsTab` to any other tab is refused. `closeSettings` is allowed
 *    (and Cancel is a hole) so the user is never trapped in the modal.
 *  - **Selection steps.** 7a/7b/10b/14a allow `clearSelection`; `marquee`
 *    only where several commits are wanted (7b). 10b and 14a accept only a
 *    plain `select` of the one commit they name (or its `openDetail`); the
 *    details steps 14b/15/16 let the user re-select/re-open exactly their
 *    commit (a rewrite can close the panel) but never clear the selection.
 *  - **`other:*` names** used here (App must raise exactly these):
 *    `create-commit` (step 5), `push-menu` (17b), `tutorial-nav` (always).
 */
import {
  tutorialTarget,
  type TutorialAction,
  type TutorialEvent,
  type TutorialHost,
  type TutorialRepoView,
} from "./types";

/** Values the engine remembers between steps. Mutated by `setup` hooks. */
export interface TutorialCtx {
  /** Demo repo path ('' until step 3's setup created it). */
  repoPath: string;
  /** Bare `origin` path ('' until created). */
  remotePath: string;
  /** True once `host.openRepo` succeeded for the demo. */
  opened: boolean;
  /** Repo-relative paths `seedFiles` wrote (step 5). */
  seededFiles: string[];
  /** Set by the engine when this run was exited or replaced. A `setup` still
   *  in flight must not go on to touch the app (open the demo …): whatever it
   *  already created is removed by the engine's cleanup. */
  cancelled: boolean;
}

export function newCtx(): TutorialCtx {
  return {
    repoPath: "",
    remotePath: "",
    opened: false,
    seededFiles: [],
    cancelled: false,
  };
}

/** One (sub)step of the script. */
export interface TutorialStep {
  /** 1-based top-level number shown as "Step n / TOTAL_STEPS". */
  n: number;
  /** Sub-step letter for a split step (`a`, `b`); absent otherwise. */
  sub?: string;
  /** Stable id, e.g. `merge-drag`. */
  id: string;
  mode: "info" | "action";
  titleKey: string;
  bodyKey: string;
  hintKey?: string;
  /** Label of the coach card's primary button (replaces "Next"). */
  primaryLabelKey?: string;
  placement?: "auto" | "center";
  /** Keys the keyboard guard lets through (a confirm dialog is part of it). */
  allowKeys?: string[];
  /** Spotlight selectors. Empty ⇒ full block with a centred card. */
  targets(view: TutorialRepoView | null, ctx: TutorialCtx): string[];
  /** May this user action run now? (`tutorial-nav` is handled by the engine.) */
  allows(
    action: TutorialAction,
    view: TutorialRepoView | null,
    ctx: TutorialCtx,
  ): boolean;
  /** Does this event complete an `action` step? */
  done(
    event: TutorialEvent,
    view: TutorialRepoView | null,
    ctx: TutorialCtx,
  ): boolean;
  /** Side-effect run on entering the step (or on the primary button, see
   *  `setupOnPrimary`). While it runs the engine is `busy`. */
  setup?(host: TutorialHost, ctx: TutorialCtx): Promise<void>;
  /** Run `setup` when the user presses the primary button instead of on
   *  entry, and advance once it succeeded (step 3 "Create demo"). */
  setupOnPrimary?: boolean;
}

// ── Demo-repo vocabulary ────────────────────────────────────────────────────
export const DEMO = {
  main: "main",
  login: "feature/login",
  theme: "feature/theme",
  experiment: "experiment",
  logBranch: "adgitter-log",
  /** The starter history's merged branch and the commit the tour shows. */
  intro: "docs/intro",
  guide: "Write getting-started guide",
  addConfig: "Add config",
  typo: "Add drak theme",
  tryFaster: "Try faster render",
  secret: "secrets.env",
  secretExample: "secrets.example.env",
  secretExampleContent:
    "# Copy this file to secrets.env and fill in your own values.\nAPI_KEY=\nDB_PASSWORD=\n",
} as const;

// ── Pure helpers over the view ──────────────────────────────────────────────
function esc(v: string): string {
  return v.replace(/["\\]/g, "\\$&");
}
export const commitSel = (sha: string) =>
  `[data-tutorial-commit="${esc(sha)}"]`;
export const branchSel = (name: string) =>
  `[data-tutorial-branch="${esc(name)}"]`;
export const fileSel = (path: string) => `[data-tutorial-file="${esc(path)}"]`;
const T = tutorialTarget;

/**
 * The commit with exactly `subject` that is reachable from `branch`'s tip
 * (breadth-first over `parents`, so the nearest one wins). Subjects repeat
 * across the old and rewritten chains; reachability is what tells them
 * apart. `undefined` when the branch or the commit is unknown.
 */
export function findOnBranch(
  view: TutorialRepoView | null,
  branch: string | null | undefined,
  subject: string,
): string | undefined {
  const tip = branch ? view?.branches[branch] : undefined;
  if (!view || !tip) return undefined;
  const bySha = new Map(view.commits.map((c) => [c.sha, c]));
  const seen = new Set<string>();
  const queue = [tip];
  for (let i = 0; i < queue.length; i++) {
    const sha = queue[i];
    if (seen.has(sha)) continue;
    seen.add(sha);
    const c = bySha.get(sha);
    if (!c) continue;
    if (c.subject === subject) return sha;
    queue.push(...c.parents);
  }
  return undefined;
}

/** `branch`'s first-parent line, tip first (the tip is included). */
export function firstParentLine(
  view: TutorialRepoView | null,
  branch: string,
): string[] {
  const tip = view?.branches[branch];
  if (!view || !tip) return [];
  const bySha = new Map(view.commits.map((c) => [c.sha, c]));
  const line: string[] = [];
  const seen = new Set<string>();
  for (let sha: string | undefined = tip; sha && !seen.has(sha); ) {
    seen.add(sha);
    line.push(sha);
    sha = bySha.get(sha)?.parents[0];
  }
  return line;
}

export function subjectOf(
  view: TutorialRepoView | null,
  sha: string,
): string | undefined {
  return view?.commits.find((c) => c.sha === sha)?.subject;
}

/** Resolve a branch name, full sha or (≥4 char) sha prefix to a full sha. */
export function resolveRef(
  view: TutorialRepoView | null,
  ref: string,
): string | undefined {
  if (!view || !ref) return undefined;
  const bare = ref.replace(/^refs\/heads\//, "");
  if (view.branches[bare]) return view.branches[bare];
  const exact = view.commits.find((c) => c.sha === ref);
  if (exact) return exact.sha;
  if (ref.length >= 4 && /^[0-9a-f]+$/i.test(ref))
    return view.commits.find((c) => c.sha.startsWith(ref))?.sha;
  return undefined;
}

/** Is `ref` main (by name, by tip sha, or by a unique sha prefix of its tip)? */
export function isMainRef(
  ref: string | undefined,
  view: TutorialRepoView | null,
): boolean {
  if (!ref) return false;
  if (ref === DEMO.main || ref === `refs/heads/${DEMO.main}`) return true;
  const tip = view?.branches[DEMO.main];
  return !!tip && (ref === tip || resolveRef(view, ref) === tip);
}

/**
 * Commits a HEAD-crown reset may target in step 12: main's first-parent line
 * below its tip (see the file header).
 */
export function mainLineShas(view: TutorialRepoView | null): string[] {
  return firstParentLine(view, DEMO.main).slice(1);
}

const isNav = (a: TutorialAction) =>
  a.kind === "other" && a.name === "tutorial-nav";
const isOther = (a: TutorialAction, name: string) =>
  a.kind === "other" && a.name === name;

// ── Step builders ───────────────────────────────────────────────────────────
type Def = Pick<TutorialStep, "n" | "id" | "titleKey" | "bodyKey"> &
  Partial<TutorialStep>;

const never = () => false;
const noTargets = () => [] as string[];

/** An info step: advances with Next, allows nothing but navigation. */
function info(def: Def): TutorialStep {
  return {
    mode: "info",
    hintKey: "tutorial.hint.info",
    targets: noTargets,
    allows: never,
    done: never,
    ...def,
  };
}

/** An action step: waits for its `done` event. */
function action(
  def: Def & Pick<TutorialStep, "allows" | "done" | "targets">,
): TutorialStep {
  return { mode: "action", ...def };
}

/** Selectors for dialogs a mutating step opens (confirm / rewrite gate). */
const CONFIRMS = [T("confirm-dialog"), T("confirm-rewrite")];
const CONFIRM_KEYS = ["Enter", "Escape"];

/** Single-commit selection allowances: `clearSelection`, or a plain (non
 *  additive) `select` of exactly one of `shas`. */
function selectionOk(a: TutorialAction, shas: (string | undefined)[]): boolean {
  if (a.kind === "clearSelection") return true;
  return (
    a.kind === "select" && !a.additive && shas.some((s) => !!s && s === a.sha)
  );
}

// ── The script ──────────────────────────────────────────────────────────────
export const STEPS: TutorialStep[] = [
  // 1 · welcome ─────────────────────────────────────────────────────────────
  info({
    n: 1,
    id: "welcome",
    titleKey: "tutorial.welcome.title",
    bodyKey: "tutorial.welcome.body",
    placement: "center",
  }),

  // 2 · tutorial or use directly ────────────────────────────────────────────
  info({
    n: 2,
    id: "choose",
    titleKey: "tutorial.choose.title",
    bodyKey: "tutorial.choose.body",
    placement: "center",
  }),

  // 3 · create the demo repo (the user presses the primary button) ──────────
  info({
    n: 3,
    id: "create-demo",
    titleKey: "tutorial.createDemo.title",
    bodyKey: "tutorial.createDemo.body",
    hintKey: "tutorial.createDemo.hint",
    primaryLabelKey: "tutorial.createDemo.primary",
    placement: "center",
    setupOnPrimary: true,
    async setup(host, ctx) {
      // A retry after a failed `openRepo` must not create a second demo.
      if (!ctx.repoPath) {
        const made = await host.createDemo();
        ctx.repoPath = made.repoPath;
        ctx.remotePath = made.remotePath;
      }
      // Exited while the demo was being made: don't open it (it would flash
      // in the user's window); the engine's cleanup removes what exists.
      if (ctx.cancelled) return;
      await host.openRepo(ctx.repoPath);
      ctx.opened = true;
    },
  }),

  // 4 · tour of the graph (multi-spot, info) ────────────────────────────────
  info({
    n: 4,
    id: "tour-graph",
    titleKey: "tutorial.tourGraph.title",
    bodyKey: "tutorial.tourGraph.body",
    targets: () => [T("graph")],
  }),
  info({
    n: 4,
    id: "tour-commit",
    titleKey: "tutorial.tourCommit.title",
    bodyKey: "tutorial.tourCommit.body",
    targets: (view) => {
      const sha = findOnBranch(view, DEMO.main, DEMO.guide);
      return [sha ? commitSel(sha) : T("graph")];
    },
  }),
  info({
    n: 4,
    id: "tour-branch",
    titleKey: "tutorial.tourBranch.title",
    bodyKey: "tutorial.tourBranch.body",
    targets: () => [branchSel(DEMO.main), branchSel(DEMO.intro)],
  }),
  info({
    n: 4,
    id: "tour-head",
    titleKey: "tutorial.tourHead.title",
    bodyKey: "tutorial.tourHead.body",
    targets: () => [T("head-crown")],
  }),
  info({
    n: 4,
    id: "tour-handle",
    titleKey: "tutorial.tourHandle.title",
    bodyKey: "tutorial.tourHandle.body",
    // The handle only appears while its branch tip is hovered, so the tip's
    // row is highlighted too (hover must reach it through the hole).
    targets: (view) => {
      const tip = view?.branches[DEMO.main];
      return [...(tip ? [commitSel(tip)] : []), T("merge-handle")];
    },
  }),

  // 5 · stage the generated files and make the first commit ─────────────────
  action({
    n: 5,
    id: "first-commit",
    titleKey: "tutorial.firstCommit.title",
    bodyKey: "tutorial.firstCommit.body",
    hintKey: "tutorial.firstCommit.hint",
    // `create-commit-dialog` is what the allowed "+" opens (a centred modal
    // outside every other hole), so it must be a hole too.
    targets: () => [
      T("toolbar-files"),
      T("files-panel"),
      T("commit-bar"),
      T("create-commit"),
      T("create-commit-dialog"),
    ],
    async setup(host, ctx) {
      ctx.seededFiles = await host.seedFiles(ctx.repoPath);
    },
    allows: (a, _v, ctx) => {
      switch (a.kind) {
        case "openFiles":
        case "commit":
          return true;
        case "stage":
          return a.paths.every((p) => ctx.seededFiles.includes(p));
        case "other":
          return a.name === "create-commit";
        default:
          return false;
      }
    },
    done: (e) => e.kind === "committed",
  }),

  // 6 · demo history is generated (auto), then Next ─────────────────────────
  info({
    n: 6,
    id: "seed-history",
    titleKey: "tutorial.seedHistory.title",
    bodyKey: "tutorial.seedHistory.body",
    targets: () => [T("graph")],
    async setup(host, ctx) {
      await host.seedHistory(ctx.repoPath);
    },
  }),

  // 7a · select a single commit ─────────────────────────────────────────────
  action({
    n: 7,
    sub: "a",
    id: "select-commit",
    titleKey: "tutorial.selectCommit.title",
    bodyKey: "tutorial.selectCommit.body",
    hintKey: "tutorial.selectCommit.hint",
    targets: () => [T("graph")],
    allows: (a) =>
      a.kind === "clearSelection" || (a.kind === "select" && !a.additive),
    done: (e) => e.kind === "selected" && e.shas.length === 1,
  }),

  // 7b · box-select several commits ─────────────────────────────────────────
  action({
    n: 7,
    sub: "b",
    id: "select-many",
    titleKey: "tutorial.selectMany.title",
    bodyKey: "tutorial.selectMany.body",
    hintKey: "tutorial.selectMany.hint",
    targets: () => [T("graph")],
    allows: (a) =>
      a.kind === "clearSelection" ||
      a.kind === "marquee" ||
      a.kind === "select",
    done: (e) => e.kind === "selected" && e.shas.length >= 2,
  }),

  // 8 · merge feature/login into main with the handle circle ────────────────
  action({
    n: 8,
    id: "merge-drag",
    titleKey: "tutorial.mergeDrag.title",
    bodyKey: "tutorial.mergeDrag.body",
    hintKey: "tutorial.mergeDrag.hint",
    allowKeys: CONFIRM_KEYS,
    targets: (view) => {
      const login = view?.branches[DEMO.login];
      const tip = view?.branches[DEMO.main];
      return [
        ...(login ? [commitSel(login)] : []),
        ...(tip ? [commitSel(tip)] : []),
        T("merge-handle"),
        branchSel(DEMO.login),
        branchSel(DEMO.main),
        ...CONFIRMS,
      ];
    },
    allows: (a) =>
      a.kind === "mergeDrag" &&
      a.drop.source === DEMO.login &&
      a.drop.target === DEMO.main,
    done: (e) =>
      e.kind === "merged" && e.source === DEMO.login && e.target === DEMO.main,
  }),

  // 9 · click a branch name to select the branch ────────────────────────────
  action({
    n: 9,
    id: "branch-select",
    titleKey: "tutorial.branchSelect.title",
    bodyKey: "tutorial.branchSelect.body",
    hintKey: "tutorial.branchSelect.hint",
    targets: () => [branchSel(DEMO.theme)],
    allows: (a) => a.kind === "branchSelect" && a.name === DEMO.theme,
    done: (e) => e.kind === "branchSelected" && e.name === DEMO.theme,
  }),

  // 10a · drag-rebase feature/theme onto main ───────────────────────────────
  action({
    n: 10,
    sub: "a",
    id: "rebase",
    titleKey: "tutorial.rebase.title",
    bodyKey: "tutorial.rebase.body",
    hintKey: "tutorial.rebase.hint",
    allowKeys: CONFIRM_KEYS,
    targets: (view) => {
      const theme = view?.branches[DEMO.theme];
      const tip = view?.branches[DEMO.main];
      return [
        branchSel(DEMO.theme),
        ...(theme ? [commitSel(theme)] : []),
        branchSel(DEMO.main),
        ...(tip ? [commitSel(tip)] : []),
        ...CONFIRMS,
      ];
    },
    allows: (a, view) => {
      // Re-selecting the branch is fine (the drag needs it selected).
      if (a.kind === "branchSelect") return a.name === DEMO.theme;
      return (
        a.kind === "gesture" &&
        a.op.op === "rebaseBranch" &&
        a.op.branch === DEMO.theme &&
        isMainRef(a.op.onto, view)
      );
    },
    // `allows` already pinned branch + target; the event's `onto` may be the
    // pre- or post-rewrite tip, so only the branch is re-checked here.
    done: (e) => e.kind === "rebased" && e.branch === DEMO.theme,
  }),

  // 10b · Alt-drag cherry-pick of "Try faster render" onto main ─────────────
  action({
    n: 10,
    sub: "b",
    id: "cherry-pick",
    titleKey: "tutorial.cherryPick.title",
    bodyKey: "tutorial.cherryPick.body",
    hintKey: "tutorial.cherryPick.hint",
    allowKeys: CONFIRM_KEYS,
    targets: (view) => {
      const e1 = findOnBranch(view, DEMO.experiment, DEMO.tryFaster);
      // The copy points at "the experiment branch", so its chip is lit too
      // (dragging it is refused: `allows` wants exactly E1). The commit
      // comes first: the overlay keeps the first target (the drag source)
      // on screen above all.
      return [
        ...(e1 ? [commitSel(e1)] : []),
        branchSel(DEMO.experiment),
        branchSel(DEMO.main),
        ...CONFIRMS,
      ];
    },
    allows: (a, view) => {
      const e1 = findOnBranch(view, DEMO.experiment, DEMO.tryFaster);
      if (a.kind === "gesture")
        return (
          a.op.op === "cherryPick" &&
          a.op.commits.length === 1 &&
          !!e1 &&
          a.op.commits[0] === e1
        );
      return selectionOk(a, [e1]);
    },
    done: (e, view) =>
      e.kind === "cherryPicked" &&
      e.commits.length >= 1 &&
      (view?.head === DEMO.main || isMainRef(e.onto, view)),
  }),

  // 11 · undo the last operation ────────────────────────────────────────────
  action({
    n: 11,
    id: "undo",
    titleKey: "tutorial.undo.title",
    bodyKey: "tutorial.undo.body",
    hintKey: "tutorial.undo.hint",
    allowKeys: CONFIRM_KEYS,
    targets: () => [T("toolbar-undo"), ...CONFIRMS],
    allows: (a) => a.kind === "undo",
    done: (e) => e.kind === "undone",
  }),

  // 12 · drag the HEAD crown onto an older commit on main ───────────────────
  action({
    n: 12,
    id: "reset",
    titleKey: "tutorial.reset.title",
    bodyKey: "tutorial.reset.body",
    hintKey: "tutorial.reset.hint",
    allowKeys: CONFIRM_KEYS,
    targets: (view) => [
      T("head-crown"),
      ...mainLineShas(view).map(commitSel),
      ...CONFIRMS,
    ],
    allows: (a, view) => {
      if (a.kind !== "gesture" || a.op.op !== "reset") return false;
      // `commitSha` is the real sha when the drop was ambiguous (several
      // branches on one commit); otherwise `target` is a branch or a sha.
      const sha = a.op.commitSha ?? resolveRef(view, a.op.target);
      return !!sha && mainLineShas(view).includes(sha);
    },
    done: (e) => e.kind === "reset",
  }),

  // 13a · undo the reset ────────────────────────────────────────────────────
  action({
    n: 13,
    sub: "a",
    id: "undo-reset",
    titleKey: "tutorial.undoReset.title",
    bodyKey: "tutorial.undoReset.body",
    hintKey: "tutorial.undoReset.hint",
    allowKeys: CONFIRM_KEYS,
    targets: () => [T("toolbar-undo"), ...CONFIRMS],
    allows: (a) => a.kind === "undo",
    done: (e) => e.kind === "undone",
  }),

  // 13b · check out feature/theme ───────────────────────────────────────────
  action({
    n: 13,
    sub: "b",
    id: "checkout",
    titleKey: "tutorial.checkout.title",
    bodyKey: "tutorial.checkout.body",
    hintKey: "tutorial.checkout.hint",
    allowKeys: CONFIRM_KEYS,
    targets: () => [branchSel(DEMO.theme), ...CONFIRMS],
    // By NAME only: double-clicking the tip commit would detach HEAD.
    allows: (a) => a.kind === "checkout" && a.target === DEMO.theme,
    done: (e) => e.kind === "checkedOut" && e.target === DEMO.theme,
  }),

  // 14a · open the details of "Add config" ──────────────────────────────────
  action({
    n: 14,
    sub: "a",
    id: "open-detail",
    titleKey: "tutorial.openDetail.title",
    bodyKey: "tutorial.openDetail.body",
    hintKey: "tutorial.openDetail.hint",
    targets: (view) => {
      const sha = addConfigSha(view);
      return [sha ? commitSel(sha) : T("graph")];
    },
    // Selecting a commit opens its details, so `select` is the usual path.
    allows: (a, view) => {
      const sha = addConfigSha(view);
      return (
        selectionOk(a, [sha]) ||
        (a.kind === "openDetail" && !!sha && a.sha === sha)
      );
    },
    done: (e, view) => {
      const sha = addConfigSha(view);
      if (!sha) return false;
      return (
        (e.kind === "detailOpened" && e.sha === sha) ||
        (e.kind === "selected" && e.shas.length === 1 && e.shas[0] === sha)
      );
    },
  }),

  // 14b · purge secrets.env from history ────────────────────────────────────
  action({
    n: 14,
    sub: "b",
    id: "purge",
    titleKey: "tutorial.purge.title",
    bodyKey: "tutorial.purge.body",
    hintKey: "tutorial.purge.hint",
    allowKeys: CONFIRM_KEYS,
    targets: (view) => {
      const sha = addConfigSha(view);
      return [
        fileSel(DEMO.secret),
        ...(sha ? [commitSel(sha)] : []),
        ...CONFIRMS,
      ];
    },
    allows: (a, view) => {
      const sha = addConfigSha(view);
      if (!sha) return false;
      if (a.kind === "purge") return a.sha === sha && a.path === DEMO.secret;
      return detailOk(a, sha);
    },
    done: (e) => e.kind === "purged" && e.path === DEMO.secret,
  }),

  // 15 · add the safe template into that historical commit ──────────────────
  action({
    n: 15,
    id: "add-file",
    titleKey: "tutorial.addFile.title",
    bodyKey: "tutorial.addFile.body",
    hintKey: "tutorial.addFile.hint",
    allowKeys: CONFIRM_KEYS,
    async setup(host, ctx) {
      await host.writeFile(
        ctx.repoPath,
        DEMO.secretExample,
        DEMO.secretExampleContent,
      );
    },
    targets: (view) => {
      const sha = addConfigSha(view);
      return [
        T("detail-add-file"),
        T("commit-details"),
        ...(sha ? [commitSel(sha)] : []),
        ...CONFIRMS,
      ];
    },
    allows: (a, view) => {
      const sha = addConfigSha(view);
      if (!sha) return false;
      if (a.kind === "addFile")
        return a.sha === sha && a.path === DEMO.secretExample;
      return detailOk(a, sha);
    },
    done: (e) => e.kind === "fileAdded" && e.path === DEMO.secretExample,
  }),

  // 16 · reword the typo'd commit message ───────────────────────────────────
  action({
    n: 16,
    id: "reword",
    titleKey: "tutorial.reword.title",
    bodyKey: "tutorial.reword.body",
    hintKey: "tutorial.reword.hint",
    allowKeys: CONFIRM_KEYS,
    targets: (view) => {
      const sha = typoSha(view);
      return [
        ...(sha ? [commitSel(sha)] : []),
        T("detail-reword"),
        T("commit-details"),
        ...CONFIRMS,
      ];
    },
    allows: (a, view) => {
      const sha = typoSha(view);
      if (!sha) return false;
      if (a.kind === "reword") return a.sha === sha;
      return detailOk(a, sha);
    },
    // The lesson is fixing the typo, so an unchanged message does not count.
    done: (e) => {
      if (e.kind !== "reworded") return false;
      const first = e.message.trim().split("\n")[0].trim();
      return first !== "" && first !== DEMO.typo;
    },
  }),

  // 17a · a normal push is rejected ─────────────────────────────────────────
  action({
    n: 17,
    sub: "a",
    id: "push-rejected",
    titleKey: "tutorial.pushRejected.title",
    bodyKey: "tutorial.pushRejected.body",
    hintKey: "tutorial.pushRejected.hint",
    allowKeys: CONFIRM_KEYS,
    targets: () => [T("toolbar-push"), ...CONFIRMS],
    allows: (a) => a.kind === "push",
    done: (e) => e.kind === "pushed" && !e.force && !e.ok,
  }),

  // 17b · force push ────────────────────────────────────────────────────────
  action({
    n: 17,
    sub: "b",
    id: "force-push",
    titleKey: "tutorial.forcePush.title",
    bodyKey: "tutorial.forcePush.body",
    hintKey: "tutorial.forcePush.hint",
    allowKeys: CONFIRM_KEYS,
    targets: () => [T("toolbar-push-menu"), T("push-force-item"), ...CONFIRMS],
    allows: (a) => a.kind === "forcePush" || isOther(a, "push-menu"),
    done: (e) => e.kind === "pushed" && e.force && e.ok,
  }),

  // 18 · Log Anytime introduction ───────────────────────────────────────────
  info({
    n: 18,
    id: "log-intro",
    titleKey: "tutorial.logIntro.title",
    bodyKey: "tutorial.logIntro.body",
    targets: () => [T("toolbar-log-anytime")],
  }),

  // 19 · turn Log Anytime on ────────────────────────────────────────────────
  action({
    n: 19,
    id: "log-on",
    titleKey: "tutorial.logOn.title",
    bodyKey: "tutorial.logOn.body",
    hintKey: "tutorial.logOn.hint",
    targets: () => [T("toolbar-log-anytime")],
    allows: (a) => a.kind === "logAnytimeToggle" && a.enabled,
    done: (e) => e.kind === "logAnytimeToggled" && e.enabled,
  }),

  // 20 · simulated snapshots appear on the log branch (auto), then Next ─────
  info({
    n: 20,
    id: "log-sim",
    titleKey: "tutorial.logSim.title",
    bodyKey: "tutorial.logSim.body",
    targets: () => [branchSel(DEMO.logBranch), T("toolbar-log-anytime")],
    async setup(host, ctx) {
      await host.simulateLog(ctx.repoPath, DEMO.logBranch, 3);
    },
  }),

  // 21 · turn Log Anytime off ───────────────────────────────────────────────
  action({
    n: 21,
    id: "log-off",
    titleKey: "tutorial.logOff.title",
    bodyKey: "tutorial.logOff.body",
    hintKey: "tutorial.logOff.hint",
    targets: () => [T("toolbar-log-anytime")],
    allows: (a) => a.kind === "logAnytimeToggle" && !a.enabled,
    done: (e) => e.kind === "logAnytimeToggled" && !e.enabled,
  }),

  // 22 · apply a theme in Settings → Personalize ────────────────────────────
  action({
    n: 22,
    id: "theme",
    titleKey: "tutorial.theme.title",
    bodyKey: "tutorial.theme.body",
    hintKey: "tutorial.theme.hint",
    allowKeys: CONFIRM_KEYS,
    // Deliberately NOT `settings-modal`: only the Personalize panel (theme
    // list, font, text size) plus OK / Cancel are touchable.
    targets: () => [
      T("topbar-settings"),
      T("settings-tab-Personalize"),
      T("settings-panel-Personalize"),
      T("settings-ok"),
      T("settings-cancel"),
    ],
    allows: (a) => {
      switch (a.kind) {
        case "openSettings":
        case "applyTheme":
        case "saveSettings":
        case "closeSettings":
          return true;
        case "settingsTab":
          return a.tab.toLowerCase() === "personalize";
        default:
          return false;
      }
    },
    done: (e) => e.kind === "settingsSaved" && e.themeChanged,
  }),

  // 23a · bind an issue to a branch ─────────────────────────────────────────
  action({
    n: 23,
    sub: "a",
    id: "issue-branch",
    titleKey: "tutorial.issueBranch.title",
    bodyKey: "tutorial.issueBranch.body",
    hintKey: "tutorial.issueBranch.hint",
    // "New Branch & Go" opens the branch composer, a centred modal outside
    // the panel — it is part of the allowed operation, so it is a hole too.
    targets: () => [T("toolbar-issues"), T("issue-panel"), T("issue-composer")],
    allows: (a) => a.kind === "openIssues" || a.kind === "issueBranch",
    done: (e) => e.kind === "issueBranchCreated",
  }),

  // 23b · update the issue while working ────────────────────────────────────
  action({
    n: 23,
    sub: "b",
    id: "issue-status",
    titleKey: "tutorial.issueStatus.title",
    bodyKey: "tutorial.issueStatus.body",
    hintKey: "tutorial.issueStatus.hint",
    // Rejecting is a status change too; its reason dialog sits outside the
    // panel, so it is a hole as well.
    targets: () => [T("issue-panel"), T("toolbar-issues"), T("issue-reject")],
    allows: (a) => a.kind === "openIssues" || a.kind === "issueStatus",
    done: (e) => e.kind === "issueStatusChanged",
  }),

  // 24 · finish ─────────────────────────────────────────────────────────────
  info({
    n: 24,
    id: "finish",
    titleKey: "tutorial.finish.title",
    bodyKey: "tutorial.finish.body",
    primaryLabelKey: "tutorial.finish.primary",
    placement: "center",
  }),
];

/** Number of top-level steps ("Step n / TOTAL_STEPS"). */
export const TOTAL_STEPS = 24;

// ── Shared resolvers for the history-surgery steps ──────────────────────────
/** Sha of "Add config" on feature/theme — the rewritten commit, not the
 *  original that main, the tags and `origin/*` still carry. */
function addConfigSha(view: TutorialRepoView | null): string | undefined {
  return findOnBranch(view, DEMO.theme, DEMO.addConfig);
}

/** Sha of the typo'd theme commit on feature/theme. */
function typoSha(view: TutorialRepoView | null): string | undefined {
  return findOnBranch(view, DEMO.theme, DEMO.typo);
}

/** Re-opening the details of exactly `sha` is always fine in those steps. */
function detailOk(a: TutorialAction, sha: string): boolean {
  return (
    (a.kind === "select" && !a.additive && a.sha === sha) ||
    (a.kind === "openDetail" && a.sha === sha)
  );
}

// `isNav` is exported for the engine: navigation is allowed in every state.
export { isNav };

/** The steps that drive the issue tracker (23a, 23b). */
const TRACKER_STEP_IDS: ReadonlySet<string> = new Set([
  "issue-branch",
  "issue-status",
]);

/**
 * The script for a build without the issue tracker: its steps dropped and the
 * ones after them renumbered, so "Step n / total" stays contiguous.
 */
export function stepsWithoutTracker(
  steps: readonly TutorialStep[] = STEPS,
): TutorialStep[] {
  const kept = steps.filter((s) => !TRACKER_STEP_IDS.has(s.id));
  const keptNs = new Set(kept.map((s) => s.n));
  const gone = [...new Set(steps.map((s) => s.n))].filter(
    (n) => !keptNs.has(n),
  );
  return kept.map((s) => {
    const shift = gone.filter((n) => n < s.n).length;
    return shift ? { ...s, n: s.n - shift } : s;
  });
}
