/**
 * Real-`git` re-derivations of `crates/git-core`'s history-rewriting engine,
 * for the e2e bridge (`e2e/bridge.ts`).
 *
 * The Rust layer runs on libgit2; this file reproduces the SAME observable
 * semantics over the system `git` CLI (plumbing: `commit-tree`, `merge-tree`,
 * `update-ref`, a scratch `GIT_INDEX_FILE`) so a passing e2e proves real git
 * behaviour wired to the real UI — and so the guided tutorial's demo script
 * (steps 8–21) can be replayed end to end
 * without the Tauri backend. What is mirrored, and from where:
 *
 * - `mutate.rs`   — backup refs `refs/adgitter/backup/<ms>-<seq>/<op>/<ref>`,
 *                   batches (one undo restores every ref a rewrite moved),
 *                   `undo_last` (incl. carrying an injected file back to disk).
 * - `history.rs`  — `merge` (FF keeps its backup, up-to-date drops it, "Merge
 *                   {source}" message), `reset`, `cherry_pick`, `reword`.
 * - `rebase.rs`   — the replay engine (`execute`: autostash → backup → replay
 *                   each commit's DIFF onto the new base → move the branch →
 *                   remap descendants), `rebase_onto`, `rebase_branch`,
 *                   `drop_commit`, explicit plans (`rebase`).
 * - `remap.rs`    — best-effort descendant-branch remap (same batch as the
 *                   primary backup; conflicting branches are `skipped`).
 * - `purge.rs` / `inject.rs` — pure tree surgery over `sha..tip`, merges kept.
 * - `remote.rs`   — `push` (same-name refspec, `+` when forced, rejection →
 *                   "push rejected (…) — pull first, then push again").
 * - `log_anytime.rs` — `log_commit` (working-tree snapshot onto a branch
 *                   without touching HEAD / the on-disk index / the worktree).
 *
 * Deliberate gaps (documented in `e2e/README.md`): a conflicting replay/merge
 * THROWS (after restoring the pre-op state) instead of pausing into the in-app
 * resolver (`resolve.rs`), and `squash_range`/`revert`/`fetch`/`pull` stay
 * benign stubs in the bridge.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { adgitterError, git, gitOrNull, gitStatus, lines } from "./gitCli";

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

const ZERO = "";

export interface HistoryOpOutcome {
  remapped: string[];
  skipped: string[];
}

export type HistoryOpResult = {
  status: "completed";
  outcome: HistoryOpOutcome;
};

function completed(
  outcome: HistoryOpOutcome = { remapped: [], skipped: [] },
): HistoryOpResult {
  return { status: "completed", outcome };
}

/** `AdgitterError::Internal` — its `Display` text carries the "internal error:"
 *  prefix the real backend serialises into `message`. */
function internal(message: string): Error {
  return adgitterError("INTERNAL_ERROR", `internal error: ${message}`);
}

/** Full ref name of the current branch; throws on a detached/unborn HEAD
 *  (`history.rs`'s `current_branch`). */
export function currentBranch(repo: string): string {
  if (gitOrNull(repo, ["rev-parse", "--verify", "-q", "HEAD"]) === null) {
    throw internal("no current branch (unborn HEAD)");
  }
  const ref = gitOrNull(repo, ["symbolic-ref", "-q", "HEAD"]);
  if (!ref) throw internal("HEAD is detached");
  return ref;
}

/** Resolve `rev` to a commit oid (`revparse_single(..).peel_to_commit()`). */
export function resolveCommit(repo: string, rev: string): string {
  const sha = gitOrNull(repo, [
    "rev-parse",
    "--verify",
    "-q",
    "--end-of-options",
    `${rev}^{commit}`,
  ]);
  if (!sha) throw internal(`revspec '${rev}' not found`);
  return sha;
}

function isAncestor(repo: string, maybeAncestor: string, of: string): boolean {
  return (
    gitStatus(repo, ["merge-base", "--is-ancestor", maybeAncestor, of]) === 0
  );
}

/** `graph_descendant_of(tip, old)`: `tip` strictly descends from `old`. */
function isDescendantOf(repo: string, tip: string, old: string): boolean {
  return tip !== old && isAncestor(repo, old, tip);
}

function stripHeads(ref: string): string {
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}

// ---------------------------------------------------------------------------
// Commit objects
// ---------------------------------------------------------------------------

export interface Ident {
  name: string;
  email: string;
  /** git's internal date format: `<unix-seconds> <+hhmm>`. */
  date: string;
}

export interface CommitInfo {
  sha: string;
  tree: string;
  parents: string[];
  author: Ident;
  committer: Ident;
  /** The raw message, exactly as stored (`Commit::message`). */
  message: string;
}

function parseIdent(value: string): Ident {
  const m = /^(.*) <(.*)> (\d+ [+-]\d{4})$/.exec(value);
  if (!m) throw internal(`unparseable identity: ${value}`);
  return { name: m[1], email: m[2], date: m[3] };
}

export function readCommit(repo: string, sha: string): CommitInfo {
  const raw = git(repo, ["cat-file", "commit", sha]);
  const split = raw.indexOf("\n\n");
  const head = split === -1 ? raw : raw.slice(0, split);
  const message = split === -1 ? "" : raw.slice(split + 2);
  let tree = "";
  const parents: string[] = [];
  let author: Ident | null = null;
  let committer: Ident | null = null;
  for (const line of head.split("\n")) {
    if (line.startsWith("tree ")) tree = line.slice(5);
    else if (line.startsWith("parent ")) parents.push(line.slice(7));
    else if (line.startsWith("author ")) author = parseIdent(line.slice(7));
    else if (line.startsWith("committer "))
      committer = parseIdent(line.slice(10));
  }
  if (!tree || !author || !committer) {
    throw internal(`malformed commit ${sha}`);
  }
  return { sha, tree, parents, author, committer, message };
}

export interface CommitSpec {
  tree: string;
  parents: string[];
  message: string;
  /** Omitted → git's configured identity, now. */
  author?: Ident;
  committer?: Ident;
}

function identEnv(prefix: "AUTHOR" | "COMMITTER", id: Ident) {
  return {
    [`GIT_${prefix}_NAME`]: id.name,
    [`GIT_${prefix}_EMAIL`]: id.email,
    [`GIT_${prefix}_DATE`]: id.date,
  };
}

/** `git commit-tree` — a loose commit object, no ref moved. The message is
 *  stored verbatim (like libgit2's `Repository::commit`, which neither strips
 *  nor appends a newline). */
export function commitTree(repo: string, spec: CommitSpec): string {
  const env = {
    ...(spec.author ? identEnv("AUTHOR", spec.author) : {}),
    ...(spec.committer ? identEnv("COMMITTER", spec.committer) : {}),
  };
  return git(
    repo,
    [
      "commit-tree",
      spec.tree,
      ...spec.parents.flatMap((p) => ["-p", p]),
      "-F",
      "-",
    ],
    { env, input: spec.message },
  ).trim();
}

// ---------------------------------------------------------------------------
// Scratch index (never the repo's on-disk one)
// ---------------------------------------------------------------------------

let scratchSeq = 0;

export function gitDirOf(repo: string): string {
  return git(repo, ["rev-parse", "--absolute-git-dir"]).trim();
}

/** Run `fn` with `GIT_INDEX_FILE` pointing at a throwaway index file inside
 *  `.git` (the equivalent of `Index::new()` — an in-memory index in libgit2). */
export function withScratchIndex<T>(
  repo: string,
  fn: (env: Record<string, string>) => T,
  seedFromRealIndex = false,
): T {
  const gitDir = gitDirOf(repo);
  const file = join(
    gitDir,
    `adgitter-e2e-index-${process.pid}-${scratchSeq++}`,
  );
  try {
    if (seedFromRealIndex && existsSync(join(gitDir, "index"))) {
      copyFileSync(join(gitDir, "index"), file);
    }
    return fn({ GIT_INDEX_FILE: file });
  } finally {
    rmSync(file, { force: true });
    rmSync(`${file}.lock`, { force: true });
  }
}

/** `tree` with `blob` at `path` (mode 100644), replacing whatever is there and
 *  creating missing directories — `inject.rs`'s `tree_with_path`, and the
 *  demo builder's `tree_with_blob`. */
export function treeWithBlob(
  repo: string,
  tree: string | null,
  path: string,
  blob: string,
): string {
  return withScratchIndex(repo, (env) => {
    if (tree) git(repo, ["read-tree", tree], { env });
    git(
      repo,
      [
        "update-index",
        "--add",
        "--replace",
        "--cacheinfo",
        `100644,${blob},${path}`,
      ],
      { env },
    );
    return git(repo, ["write-tree"], { env }).trim();
  });
}

/** `tree` without `path`, or `tree` itself when the path is absent;
 *  directory paths are rejected (`purge.rs`'s `tree_without_path`). */
function treeWithoutPath(
  repo: string,
  tree: string,
  path: string,
  commit: string,
): string {
  const entry = gitOrNull(repo, ["ls-tree", tree, "--", path]);
  if (!entry) return tree; // absent from this tree: no-op
  const type = entry.split(/\s+/)[1];
  if (type === "tree") {
    throw internal(
      `${path} is a directory in commit ${commit} — purge only supports a single file path, not a directory`,
    );
  }
  return withScratchIndex(repo, (env) => {
    git(repo, ["read-tree", tree], { env });
    git(repo, ["update-index", "--force-remove", "--", path], { env });
    return git(repo, ["write-tree"], { env }).trim();
  });
}

// ---------------------------------------------------------------------------
// Backups (mutate.rs)
// ---------------------------------------------------------------------------

const BACKUP_PREFIX = "refs/adgitter/backup/";
let backupSeq = 0;

export interface Backup {
  backup_ref: string;
  op: string;
  original_ref: string;
  target: string;
  created_ms: number;
  seq: number;
}

function backupWithKey(
  repo: string,
  op: string,
  originalRef: string,
  createdMs: number,
  seq: number,
): Backup {
  if (op.includes("/")) {
    throw internal(`backup op label must not contain '/': ${op}`);
  }
  const target = gitOrNull(repo, ["rev-parse", "--verify", "-q", originalRef]);
  if (!target) throw internal(`cannot back up missing ref ${originalRef}`);
  const backupRef = `${BACKUP_PREFIX}${createdMs}-${seq}/${op}/${originalRef}`;
  // An empty old-value = "must not exist" (libgit2's `force: false`).
  git(repo, [
    "update-ref",
    "-m",
    `adgitter backup: ${op}`,
    backupRef,
    target,
    ZERO,
  ]);
  return {
    backup_ref: backupRef,
    op,
    original_ref: originalRef,
    target,
    created_ms: createdMs,
    seq,
  };
}

/** Snapshot `originalRef` into a brand-new backup batch. */
export function createBackup(
  repo: string,
  op: string,
  originalRef: string,
): Backup {
  return backupWithKey(repo, op, originalRef, Date.now(), backupSeq++);
}

/** Snapshot `originalRef` into the SAME batch as `batch`. */
function addToBatch(
  repo: string,
  batch: Backup,
  op: string,
  originalRef: string,
): Backup {
  return backupWithKey(repo, op, originalRef, batch.created_ms, batch.seq);
}

export function dropBackup(repo: string, backup: Backup): void {
  gitOrNull(repo, ["update-ref", "-d", backup.backup_ref]);
}

/** All backups, newest batch first (then by original ref). */
export function listBackups(repo: string): Backup[] {
  const out: Backup[] = [];
  for (const line of lines(
    git(repo, [
      "for-each-ref",
      "--format=%(refname)\t%(objectname)",
      BACKUP_PREFIX,
    ]),
  )) {
    const [name, target] = line.split("\t");
    const rest = name.slice(BACKUP_PREFIX.length);
    const m = /^(\d+)-(\d+)\/([^/]+)\/(.+)$/.exec(rest);
    if (!m) continue;
    out.push({
      backup_ref: name,
      op: m[3],
      original_ref: m[4],
      target,
      created_ms: Number(m[1]),
      seq: Number(m[2]),
    });
  }
  out.sort(
    (a, b) =>
      b.created_ms - a.created_ms ||
      b.seq - a.seq ||
      (a.original_ref < b.original_ref
        ? -1
        : a.original_ref > b.original_ref
          ? 1
          : 0),
  );
  return out;
}

function newestBatch(repo: string): Backup[] {
  const all = listBackups(repo);
  if (all.length === 0) return [];
  const { created_ms, seq } = all[0];
  return all.filter((b) => b.created_ms === created_ms && b.seq === seq);
}

interface CarriedFile {
  path: string;
  bytes: Buffer;
  mode: number;
}

/** `mutate.rs`'s `carry_over_injected`: the working-tree files an inject's undo
 *  would otherwise delete (present in HEAD, absent from the restored tree). */
function carryOverInjected(
  repo: string,
  group: Backup[],
  headRef: string,
): CarriedFile[] {
  const workdir = git(repo, ["rev-parse", "--show-toplevel"]).trim();
  const backup = group.find((b) => b.original_ref === headRef);
  if (!backup) return [];
  const added = git(repo, [
    "diff-tree",
    "-r",
    "--no-renames",
    "--diff-filter=A",
    "--name-only",
    "-z",
    backup.target,
    "HEAD",
  ])
    .split("\0")
    .filter((p) => p.length > 0);
  const out: CarriedFile[] = [];
  for (const rel of added) {
    const path = join(workdir, rel);
    if (!existsSync(path) || !statSync(path).isFile()) continue;
    out.push({
      path,
      bytes: readFileSync(path),
      mode: statSync(path).mode & 0o777,
    });
  }
  return out;
}

function writeBack(files: CarriedFile[]): void {
  for (const f of files) {
    if (existsSync(f.path)) continue;
    mkdirSync(dirname(f.path), { recursive: true });
    writeFileSync(f.path, f.bytes);
    try {
      chmodSync(f.path, f.mode);
    } catch {
      // Content is what matters; a permission bit that will not apply must
      // not fail the undo (same stance as the Rust version).
    }
  }
}

/** Path-based undo (`mutate.rs`'s `undo_last`): restore the newest backup batch
 *  and bring the working tree in line when the checked-out branch moved.
 *  Returns a representative restored backup, or null when nothing is undoable. */
export function undoLast(repo: string): Backup | null {
  const headRef = gitOrNull(repo, ["symbolic-ref", "-q", "HEAD"]);
  const pending = newestBatch(repo);
  const headMoved =
    headRef !== null && pending.some((b) => b.original_ref === headRef);
  const carried =
    headRef && headMoved && pending[0]?.op === "add-file"
      ? carryOverInjected(repo, pending, headRef)
      : [];

  const group = pending;
  for (const b of group) {
    git(repo, [
      "update-ref",
      "-m",
      `adgitter undo: ${b.op}`,
      b.original_ref,
      b.target,
    ]);
  }
  for (const b of group) {
    git(repo, ["update-ref", "-d", b.backup_ref]);
  }
  if (group.length > 0 && headMoved) {
    // Index, worktree and HEAD all agree afterwards; untracked files stay.
    git(repo, ["reset", "--hard", "HEAD"]);
    writeBack(carried);
  }
  return group[0] ?? null;
}

// ---------------------------------------------------------------------------
// Autostash (autostash.rs)
// ---------------------------------------------------------------------------

function stashIfDirty(
  repo: string,
  label: string,
  includeUntracked: boolean,
): boolean {
  const dirty =
    git(repo, [
      "status",
      "--porcelain",
      includeUntracked ? "--untracked-files=all" : "--untracked-files=no",
    ]).trim().length > 0;
  if (!dirty) return false;
  git(repo, [
    "stash",
    "push",
    ...(includeUntracked ? ["--include-untracked"] : []),
    "-m",
    label,
  ]);
  return true;
}

function stashPop(repo: string): void {
  git(repo, ["stash", "pop"]);
}

function popFailed(op: string, e: unknown): Error {
  return internal(
    `the ${op} succeeded, but restoring your uncommitted changes failed: ${
      e instanceof Error ? e.message : String(e)
    } — they are still saved in the stash; run \`git stash pop\` manually`,
  );
}

// ---------------------------------------------------------------------------
// Replay engine (rebase.rs)
// ---------------------------------------------------------------------------

export type RebaseAction = "pick" | "reword" | "squash" | "fixup" | "drop";

export interface RebaseStep {
  commit: string;
  action: RebaseAction;
  message?: string | null;
}

/** Commits reachable from `tip` but not `base`, oldest first. */
function commitsBetween(repo: string, base: string, tip: string): string[] {
  return lines(
    git(repo, ["rev-list", "--topo-order", "--reverse", tip, `^${base}`]),
  );
}

function pickSteps(
  repo: string,
  base: string,
  tip: string,
  actionOf: (sha: string) => RebaseAction,
): RebaseStep[] {
  return commitsBetween(repo, base, tip).map((sha) => ({
    commit: sha,
    action: actionOf(sha),
    message: null,
  }));
}

let mergeTreeChecked = false;

/** The replay engine needs `git merge-tree --write-tree --merge-base=<base>`
 *  (git >= 2.40) — fail with a readable message on an older git instead of a
 *  cryptic usage error mid-test. */
function assertMergeTreeSupport(): void {
  if (mergeTreeChecked) return;
  const out = spawnSync("git", ["--version"], { encoding: "utf8" }).stdout;
  const m = /(\d+)\.(\d+)/.exec(out ?? "");
  if (m && (Number(m[1]) < 2 || (Number(m[1]) === 2 && Number(m[2]) < 40))) {
    throw internal(
      `the e2e bridge's history engine needs git >= 2.40 (merge-tree --write-tree --merge-base); found ${out.trim()}`,
    );
  }
  mergeTreeChecked = true;
}

/** Apply `commit`'s DIFF (vs its first parent) onto `onto` in memory and return
 *  the resulting tree, or `null` on a content conflict (`cherrypick_commit`). */
function cherryPickTree(
  repo: string,
  commit: CommitInfo,
  onto: string,
): string | null {
  assertMergeTreeSupport();
  if (commit.parents.length === 0) {
    throw internal(`cannot replay the root commit ${commit.sha}`);
  }
  const r = spawnSync(
    "git",
    [
      "-C",
      repo,
      "merge-tree",
      "--write-tree",
      "--no-messages",
      `--merge-base=${commit.parents[0]}`,
      onto,
      commit.sha,
    ],
    { encoding: "utf8" },
  );
  if (r.status === 0) return r.stdout.split("\n")[0].trim();
  if (r.status === 1) return null;
  throw internal(`git merge-tree failed: ${r.stderr}`);
}

interface ReplayCursor {
  head: string;
  pickedAny: boolean;
  rewritten: Map<string, string>;
  headGroup: string[];
}

class ReplayConflict extends Error {
  constructor(readonly sha: string) {
    super(
      `conflict applying ${sha} — resolve manually or undo (in-app resolver coming later)`,
    );
    this.name = "ReplayConflict";
  }
}

function conflictError(sha: string): Error {
  return Object.assign(new ReplayConflict(sha), { code: "CONFLICT" });
}

/** Apply one step to `cursor` (`apply_step` + `finish_step`). Throws
 *  `ReplayConflict` when the replay does not apply cleanly. */
function applyStep(repo: string, cursor: ReplayCursor, step: RebaseStep): void {
  const sha = resolveCommit(repo, step.commit);
  if (step.action === "drop") {
    cursor.rewritten.set(sha, cursor.head);
    return;
  }
  if (
    (step.action === "squash" || step.action === "fixup") &&
    !cursor.pickedAny
  ) {
    throw internal("squash/fixup needs a preceding pick");
  }
  const commit = readCommit(repo, sha);
  if (commit.parents.length > 1) {
    throw adgitterError(
      "MERGE_COMMIT_IN_RANGE",
      `cannot rewrite history across merge commit ${sha} — the range contains a merge, which this operation cannot replay`,
    );
  }
  const tree = cherryPickTree(repo, commit, cursor.head);
  if (tree === null) throw conflictError(sha);

  if (step.action === "pick" || step.action === "reword") {
    let message = commit.message;
    if (step.action === "reword") {
      if (step.message == null) {
        throw internal("reword step is missing a message");
      }
      message = step.message;
    }
    const created = commitTree(repo, {
      tree,
      parents: [cursor.head],
      message,
      author: commit.author,
    });
    cursor.head = created;
    cursor.pickedAny = true;
    cursor.rewritten.set(sha, created);
    cursor.headGroup = [sha];
    return;
  }

  // squash / fixup: meld into the running head, re-parented onto its parent.
  const head = readCommit(repo, cursor.head);
  if (head.parents.length === 0)
    throw internal("cannot meld into a root commit");
  const message =
    step.action === "squash"
      ? (step.message ??
        `${head.message.trimEnd()}\n\n${commit.message.trimEnd()}`)
      : head.message;
  const created = commitTree(repo, {
    tree,
    parents: [head.parents[0]],
    message,
    author: head.author,
  });
  for (const prev of cursor.headGroup) cursor.rewritten.set(prev, created);
  cursor.rewritten.set(sha, created);
  cursor.headGroup.push(sha);
  cursor.head = created;
}

/** `execute`: snapshot the current branch, replay `steps` onto `ontoRev`, move
 *  the branch, sync the worktree, remap descendant branches. Any failure
 *  (conflict included) restores the pre-op state and throws. */
function execute(
  repo: string,
  ontoRev: string,
  steps: RebaseStep[],
  op: string,
): HistoryOpResult {
  const branch = currentBranch(repo);
  const preTip = resolveCommit(repo, "HEAD");
  const stashed = stashIfDirty(repo, "adgitter: rewrite autostash", false);
  const backup = createBackup(repo, op, branch);

  const cursor: ReplayCursor = {
    head: "",
    pickedAny: false,
    rewritten: new Map(),
    headGroup: [],
  };
  try {
    cursor.head = resolveCommit(repo, ontoRev);
    for (const step of steps) applyStep(repo, cursor, step);
  } catch (e) {
    // Replay only wrote loose objects; refs are untouched. Drop the orphaned
    // backup and make sure no uncommitted work is lost either.
    dropBackup(repo, backup);
    gitOrNull(repo, ["reset", "--hard", preTip]);
    if (stashed) gitOrNull(repo, ["stash", "pop"]);
    throw e;
  }

  git(repo, ["update-ref", "-m", "rebase", branch, cursor.head]);
  git(repo, ["reset", "--hard", "HEAD"]);
  const outcome = remapDescendants(repo, cursor.rewritten, branch, op, backup);
  if (stashed) {
    try {
      stashPop(repo);
    } catch (e) {
      throw popFailed(op, e);
    }
  }
  return completed(outcome);
}

/** Explicit interactive-rebase plan onto `onto`. */
export function rebase(
  repo: string,
  onto: string,
  steps: RebaseStep[],
): HistoryOpResult {
  return execute(repo, onto, steps, "rebase");
}

/** Rebase the current branch onto `onto` — a no-op when already built on it. */
export function rebaseOnto(repo: string, onto: string): HistoryOpResult {
  const ontoCommit = resolveCommit(repo, onto);
  const head = resolveCommit(repo, "HEAD");
  if (ontoCommit === head) return completed();
  const base = git(repo, ["merge-base", ontoCommit, head]).trim();
  if (base === ontoCommit) return completed(); // already builds on `onto`
  const steps = pickSteps(repo, base, head, () => "pick");
  return execute(repo, onto, steps, "rebase");
}

/** Drop `sha` from the current branch, replaying its descendants without it. */
export function dropCommit(repo: string, sha: string): HistoryOpResult {
  const target = readCommit(repo, resolveCommit(repo, sha));
  if (target.parents.length === 0)
    throw internal("cannot drop the root commit");
  const parent = target.parents[0];
  const head = resolveCommit(repo, "HEAD");
  const steps = pickSteps(repo, parent, head, (c) =>
    c === target.sha ? "drop" : "pick",
  );
  return execute(repo, parent, steps, "rebase");
}

/** Rebase `branch` onto `onto` whether or not it is checked out: autostash
 *  (incl. untracked) → checkout → rebase → checkout back → pop. */
export function rebaseBranch(
  repo: string,
  branch: string,
  onto: string,
): HistoryOpResult {
  let original: string;
  try {
    original = currentBranch(repo);
  } catch {
    throw internal(
      "cannot rebase a branch while HEAD is detached — check out a branch first",
    );
  }
  const target = gitOrNull(repo, [
    "rev-parse",
    "--verify",
    "-q",
    `refs/heads/${branch}`,
  ]);
  if (!target) throw internal(`unknown local branch: ${branch}`);
  if (`refs/heads/${branch}` === original) return rebaseOnto(repo, onto);

  const originalShort = stripHeads(original);
  const stashed = stashIfDirty(repo, "adgitter: rebase_branch autostash", true);

  let result: HistoryOpResult | undefined;
  let opErr: unknown;
  try {
    git(repo, ["checkout", branch]);
    result = rebaseOnto(repo, onto);
  } catch (e) {
    opErr = e;
  }
  let backErr: unknown;
  try {
    git(repo, ["checkout", originalShort]);
  } catch (e) {
    backErr = e;
  }
  let popErr: unknown;
  if (stashed && backErr === undefined) {
    try {
      stashPop(repo);
    } catch (e) {
      popErr = e;
    }
  }
  if (opErr !== undefined) throw opErr;
  if (backErr !== undefined) {
    throw internal(
      `rebase of '${branch}' onto '${onto}' succeeded, but checking the original branch back out failed: ${String(backErr)}${
        stashed
          ? " — your stashed changes are still saved; run `git stash pop` manually"
          : ""
      }`,
    );
  }
  if (popErr !== undefined) {
    throw internal(
      `rebase of '${branch}' onto '${onto}' succeeded and the original branch is restored, but restoring your stashed changes failed: ${String(popErr)} — they are still saved; run \`git stash pop\` manually`,
    );
  }
  return result as HistoryOpResult;
}

// ---------------------------------------------------------------------------
// Descendant remap (remap.rs)
// ---------------------------------------------------------------------------

function collectLocalBranches(
  repo: string,
  excludeRef: string,
): [string, string][] {
  return lines(
    git(repo, [
      "for-each-ref",
      "--format=%(refname)\t%(objectname)",
      "refs/heads",
    ]),
  )
    .map((l) => l.split("\t") as [string, string])
    .filter(([name]) => name !== excludeRef);
}

function needsRemap(
  repo: string,
  rewritten: Map<string, string>,
  tip: string,
): boolean {
  for (const created of rewritten.values()) if (created === tip) return false;
  for (const old of rewritten.keys()) {
    if (old === tip || isDescendantOf(repo, tip, old)) return true;
  }
  return false;
}

/** Ancestors before descendants, so a fork off another not-yet-remapped
 *  candidate is processed after its "parent" branch extended the shared map. */
function topoOrder(repo: string, branches: [string, string][]): number[] {
  const n = branches.length;
  const edges: number[][] = Array.from({ length: n }, () => []);
  const indegree = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const [oi, oj] = [branches[i][1], branches[j][1]];
      if (oi !== oj && isDescendantOf(repo, oj, oi)) {
        edges[i].push(j);
        indegree[j] += 1;
      }
    }
  }
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (indegree[i] === 0) queue.push(i);
  const order: number[] = [];
  while (queue.length > 0) {
    const i = queue.shift() as number;
    order.push(i);
    for (const j of edges[i]) {
      indegree[j] -= 1;
      if (indegree[j] === 0) queue.push(j);
    }
  }
  for (let i = 0; i < n; i++) if (!order.includes(i)) order.push(i);
  return order;
}

type BranchOutcome =
  | { kind: "remapped"; newTip: string; pairs: [string, string][] }
  | { kind: "conflict" };

function remapOneBranch(
  repo: string,
  map: Map<string, string>,
  tip: string,
): BranchOutcome {
  const commits = lines(
    git(repo, [
      "rev-list",
      "--topo-order",
      "--reverse",
      tip,
      ...[...map.keys()].map((k) => `^${k}`),
    ]),
  );
  if (commits.length === 0) {
    return { kind: "remapped", newTip: map.get(tip) ?? tip, pairs: [] };
  }

  const local = new Map<string, string>();
  const resolve = (oid: string) => local.get(oid) ?? map.get(oid) ?? oid;

  for (const oid of commits) {
    const commit = readCommit(repo, oid);
    // A commit none of whose parents resolves differently sits on an untouched
    // line: keep it byte-identical (see remap.rs).
    if (commit.parents.every((p) => resolve(p) === p)) continue;
    let created: string;
    if (commit.parents.length <= 1) {
      const mappedParent = resolve(commit.parents[0]);
      const tree = cherryPickTree(repo, commit, mappedParent);
      if (tree === null) return { kind: "conflict" };
      created = commitTree(repo, {
        tree,
        parents: [mappedParent],
        message: commit.message,
        author: commit.author,
      });
    } else {
      // A merge carries no single diff: map every parent, keep its own tree.
      created = commitTree(repo, {
        tree: commit.tree,
        parents: commit.parents.map(resolve),
        message: commit.message,
        author: commit.author,
      });
    }
    local.set(oid, created);
  }
  return {
    kind: "remapped",
    newTip: resolve(commits[commits.length - 1]),
    pairs: [...local.entries()],
  };
}

function remapDescendants(
  repo: string,
  rewritten: Map<string, string>,
  excludeRef: string,
  op: string,
  primary: Backup,
): HistoryOpOutcome {
  const outcome: HistoryOpOutcome = { remapped: [], skipped: [] };
  if (rewritten.size === 0) return outcome;

  let candidates: [string, string][];
  try {
    candidates = collectLocalBranches(repo, excludeRef);
  } catch {
    return outcome;
  }
  const needing = candidates.filter(([, tip]) =>
    needsRemap(repo, rewritten, tip),
  );
  if (needing.length === 0) return outcome;

  const map = new Map(rewritten);
  for (const idx of topoOrder(repo, needing)) {
    const [refname, tip] = needing[idx];
    try {
      const r = remapOneBranch(repo, map, tip);
      if (r.kind === "conflict") {
        outcome.skipped.push(refname);
        continue;
      }
      // Back up the pre-move target into the primary batch, then move once.
      const backup = addToBatch(repo, primary, op, refname);
      try {
        git(repo, [
          "update-ref",
          "-m",
          `adgitter: ${op} descendant remap`,
          refname,
          r.newTip,
        ]);
      } catch {
        dropBackup(repo, backup);
        outcome.skipped.push(refname);
        continue;
      }
      for (const [old, created] of r.pairs) map.set(old, created);
      map.set(tip, r.newTip);
      outcome.remapped.push(refname);
    } catch {
      outcome.skipped.push(refname);
    }
  }
  outcome.remapped.sort();
  outcome.skipped.sort();
  return outcome;
}

// ---------------------------------------------------------------------------
// Purge / inject (purge.rs, inject.rs) — tree surgery over `sha..tip`
// ---------------------------------------------------------------------------

/** `sha` through `tip` inclusive, oldest first; `sha` must be on the tip. */
function rangeInclusive(repo: string, sha: string, tip: string): string[] {
  if (sha !== tip && !isAncestor(repo, sha, tip)) {
    throw internal(`${sha} is not an ancestor of the current branch tip`);
  }
  const target = readCommit(repo, sha);
  return lines(
    git(repo, [
      "rev-list",
      "--topo-order",
      "--reverse",
      tip,
      ...target.parents.map((p) => `^${p}`),
    ]),
  );
}

/** Re-create every commit in `range` with its tree transformed by `retree`,
 *  parents mapped through the rewrite (graph shape — merges included — kept). */
function rewriteRange(
  repo: string,
  range: string[],
  tip: string,
  retree: (commit: CommitInfo) => string,
): { newTip: string; rewritten: Map<string, string> } {
  const rewritten = new Map<string, string>();
  for (const oid of range) {
    const commit = readCommit(repo, oid);
    const created = commitTree(repo, {
      tree: retree(commit),
      parents: commit.parents.map((p) => rewritten.get(p) ?? p),
      message: commit.message,
      author: commit.author,
    });
    rewritten.set(oid, created);
  }
  return { newTip: rewritten.get(tip) as string, rewritten };
}

/** Remove `path` from `sha`'s tree and every commit through the branch tip. */
export function purgePath(
  repo: string,
  sha: string,
  path: string,
): HistoryOpOutcome {
  const branch = currentBranch(repo);
  const tip = resolveCommit(repo, "HEAD");
  const target = resolveCommit(repo, sha);
  const range = rangeInclusive(repo, target, tip);

  const touched = range.some(
    (oid) => !!gitOrNull(repo, ["ls-tree", oid, "--", path]),
  );
  if (!touched) {
    throw internal(
      `${path} does not appear in any commit from ${target} to the branch tip`,
    );
  }

  const stashed = stashIfDirty(repo, "adgitter: purge autostash", false);
  const backup = createBackup(repo, "purge-path", branch);

  let result: { newTip: string; rewritten: Map<string, string> };
  try {
    result = rewriteRange(repo, range, tip, (c) =>
      treeWithoutPath(repo, c.tree, path, c.sha),
    );
  } catch (e) {
    dropBackup(repo, backup);
    if (stashed) gitOrNull(repo, ["stash", "pop"]);
    throw e;
  }

  git(repo, ["update-ref", "-m", "purge-path", branch, result.newTip]);
  git(repo, ["reset", "--hard", "HEAD"]);
  const outcome = remapDescendants(
    repo,
    result.rewritten,
    branch,
    "purge-path",
    backup,
  );
  if (stashed) {
    try {
      stashPop(repo);
    } catch (e) {
      throw popFailed("purge", e);
    }
  }
  return outcome;
}

/** Set `path` to its CURRENT working-tree content in `sha`'s tree and every
 *  commit through the branch tip (the inverse of purge). */
export function addFileToCommit(
  repo: string,
  sha: string,
  path: string,
): HistoryOpOutcome {
  const branch = currentBranch(repo);
  const tip = resolveCommit(repo, "HEAD");
  const target = resolveCommit(repo, sha);

  const workdir = git(repo, ["rev-parse", "--show-toplevel"]).trim();
  const full = join(workdir, path);
  if (!existsSync(full)) {
    throw internal(`${path} does not exist in the working tree`);
  }
  const st = statSync(full);
  if (st.isDirectory()) {
    throw internal(
      `${path} is a directory in the working tree — add_file_to_commit only supports a single file path, not a directory`,
    );
  }
  if (!st.isFile()) throw internal(`${path} is not a regular file`);

  const range = rangeInclusive(repo, target, tip);
  // One blob shared by every rewritten tree; raw bytes (no clean filters).
  const blob = git(repo, ["hash-object", "-w", "--stdin"], {
    input: readFileSync(full),
  }).trim();

  const stashed = stashIfDirty(repo, "adgitter: add-file autostash", false);
  const backup = createBackup(repo, "add-file", branch);

  let result: { newTip: string; rewritten: Map<string, string> };
  try {
    result = rewriteRange(repo, range, tip, (c) =>
      treeWithBlob(repo, c.tree, path, blob),
    );
  } catch (e) {
    dropBackup(repo, backup);
    if (stashed) gitOrNull(repo, ["stash", "pop"]);
    throw e;
  }

  git(repo, ["update-ref", "-m", "add-file", branch, result.newTip]);
  // A hard reset (not a bare checkout): the injected file is typically
  // untracked and already matches the new tree, so it must also enter the
  // index — otherwise it shows as a staged deletion + untracked file.
  git(repo, ["reset", "--hard", result.newTip]);
  const outcome = remapDescendants(
    repo,
    result.rewritten,
    branch,
    "add-file",
    backup,
  );
  if (stashed) {
    try {
      stashPop(repo);
    } catch (e) {
      throw popFailed("add-file", e);
    }
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// history.rs — merge / reset / cherry-pick / reword
// ---------------------------------------------------------------------------

/** Merge `source` into the current branch: up-to-date → no-op (backup
 *  dropped), fast-forward when possible (backup kept), else a real merge
 *  commit "Merge {source}". A conflict restores the pre-op state and throws. */
export function merge(repo: string, source: string): HistoryOpResult {
  const branch = currentBranch(repo);
  const backup = createBackup(repo, "merge", branch);

  let theirs: string;
  try {
    theirs = resolveCommit(repo, source);
  } catch (e) {
    dropBackup(repo, backup);
    throw e;
  }
  const ours = resolveCommit(repo, "HEAD");

  if (isAncestor(repo, theirs, ours)) {
    dropBackup(repo, backup); // nothing to merge — no no-op undo entry
    return completed();
  }
  if (isAncestor(repo, ours, theirs)) {
    git(repo, ["update-ref", "-m", "merge: fast-forward", branch, theirs]);
    git(repo, ["reset", "--hard", "HEAD"]);
    return completed();
  }
  try {
    git(repo, ["merge", "--no-ff", "-m", `Merge ${source}`, theirs]);
  } catch (e) {
    gitOrNull(repo, ["merge", "--abort"]);
    dropBackup(repo, backup);
    throw e;
  }
  return completed();
}

/** Reset the current branch to `target` (`mode` = soft | mixed | hard). */
export function reset(repo: string, target: string, mode: string): void {
  if (!["soft", "mixed", "hard"].includes(mode)) {
    throw internal(`unknown reset mode: ${mode}`);
  }
  const branch = currentBranch(repo);
  const sha = resolveCommit(repo, target);
  createBackup(repo, "reset", branch);
  git(repo, ["reset", `--${mode}`, sha]);
}

/** Cherry-pick `commits` (in order) onto the current branch, one at a time; a
 *  conflict aborts back to the tip before THAT pick and throws. */
export function cherryPick(repo: string, commits: string[]): void {
  const branch = currentBranch(repo);
  createBackup(repo, "cherry-pick", branch);
  for (const rev of commits) {
    const pick = resolveCommit(repo, rev);
    try {
      git(repo, ["cherry-pick", "--keep-redundant-commits", pick]);
    } catch {
      gitOrNull(repo, ["cherry-pick", "--abort"]);
      throw conflictError(pick);
    }
  }
}

/** Change `sha`'s message: a HEAD amend is cheap; an older commit replays the
 *  range through the engine (and must not contain a merge). */
export function reword(
  repo: string,
  sha: string,
  message: string,
): HistoryOpResult {
  if (message.trim().length === 0) {
    throw internal("commit message must not be empty");
  }
  const head = resolveCommit(repo, "HEAD");
  const target = resolveCommit(repo, sha);
  const branch = currentBranch(repo);

  if (target === head) {
    // Amend the tip (original author AND committer kept, as libgit2's amend
    // does with `None`s), then run the one-pair descendant remap.
    const backup = createBackup(repo, "reword", branch);
    const old = readCommit(repo, head);
    const created = commitTree(repo, {
      tree: old.tree,
      parents: old.parents,
      message,
      author: old.author,
      committer: old.committer,
    });
    git(repo, ["update-ref", "-m", "reword", branch, created, head]);
    const outcome = remapDescendants(
      repo,
      new Map([[head, created]]),
      branch,
      "reword",
      backup,
    );
    return completed(outcome);
  }

  if (!isAncestor(repo, target, head)) {
    throw internal(
      `${target} is not on the current branch (${stripHeads(branch)}) — check out a branch that contains it, then reword`,
    );
  }
  const parents = readCommit(repo, target).parents;
  if (parents.length === 0) {
    throw internal("cannot reword the root commit via rebase");
  }
  const steps = pickSteps(repo, parents[0], head, () => "pick").map((s) =>
    s.commit === target ? { ...s, action: "reword" as const, message } : s,
  );
  return execute(repo, parents[0], steps, "reword");
}

/** `workdir::commit(.., amend = true)` snapshots the branch first. */
export function backupBeforeAmend(repo: string): void {
  const branch = gitOrNull(repo, ["symbolic-ref", "-q", "HEAD"]);
  if (branch) createBackup(repo, "amend", branch);
}

// ---------------------------------------------------------------------------
// remote.rs — push
// ---------------------------------------------------------------------------

function pushRef(
  repo: string,
  remote: string,
  force: boolean,
  url: string | null,
  refname: string,
  oid: string,
): void {
  const refspec = `${force ? "+" : ""}${refname}:${refname}`;
  const r = spawnSync(
    "git",
    ["-C", repo, "push", "--porcelain", url ?? remote, refspec],
    {
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    },
  );
  if (r.status !== 0) {
    // `--porcelain` reports a per-ref rejection as `!\t<spec>\t[rejected] (<why>)`.
    const rejected = /^!\t[^\t]*\t\[(?:remote )?rejected\](?: \((.*)\))?/m.exec(
      r.stdout ?? "",
    );
    if (rejected) {
      throw internal(
        `push rejected (${refname}: ${rejected[1] ?? "rejected"}) — pull first, then push again`,
      );
    }
    throw internal(`git push failed: ${(r.stderr || r.stdout || "").trim()}`);
  }
  // Advance the tracking ref ourselves, like `update_tracking_ref` (also covers
  // the `url`-override path, which has no fetch refspec).
  if (refname.startsWith("refs/heads/")) {
    gitOrNull(repo, [
      "update-ref",
      `refs/remotes/${remote}/${stripHeads(refname)}`,
      oid,
    ]);
  }
}

/** Push the current branch (same-name refspec; `force` → `+`). */
export function push(
  repo: string,
  remote: string,
  force: boolean,
  url: string | null,
): void {
  let refname: string;
  try {
    refname = currentBranch(repo);
  } catch {
    throw internal("cannot push a detached HEAD");
  }
  pushRef(repo, remote, force, url, refname, resolveCommit(repo, "HEAD"));
}

/** Publish a named local branch (never forced, HEAD untouched). */
export function pushBranch(
  repo: string,
  branch: string,
  remote: string,
  url: string | null,
): void {
  const refname = `refs/heads/${branch}`;
  const oid = gitOrNull(repo, ["rev-parse", "--verify", "-q", refname]);
  if (!oid) throw internal(`unknown local branch: ${branch}`);
  pushRef(repo, remote, false, url, refname, oid);
}

// ---------------------------------------------------------------------------
// log_anytime.rs — log_commit
// ---------------------------------------------------------------------------

/** Snapshot the working tree onto `refs/heads/<branch>` without touching HEAD,
 *  the on-disk index or the worktree. Returns the new sha, or null when the
 *  tree equals the previous snapshot. */
export function logCommit(repo: string, branch: string): string | null {
  const tree = withScratchIndex(
    repo,
    (env) => {
      // `Index::add_all(["*"])` adds/updates every non-ignored file but never
      // removes entries for deleted ones — `--ignore-removal` is its twin.
      git(repo, ["add", "--ignore-removal", "--", "."], { env });
      return git(repo, ["write-tree"], { env }).trim();
    },
    true, // start from the real index, never write it back
  );

  const logRef = `refs/heads/${branch}`;
  const parent = gitOrNull(repo, [
    "rev-parse",
    "--verify",
    "-q",
    `${logRef}^{commit}`,
  ]);
  if (parent && readCommit(repo, parent).tree === tree) return null;

  // Git's identity, else the anonymous placeholder (a background snapshot
  // never fails over a missing `user.email`).
  const hasIdentity =
    !!gitOrNull(repo, ["config", "user.name"]) &&
    !!gitOrNull(repo, ["config", "user.email"]);
  const now = `${Math.floor(Date.now() / 1000)} +0000`;
  const placeholder: Ident = {
    name: "ADGitter Log",
    email: "log@adgitter",
    date: now,
  };
  const created = commitTree(repo, {
    tree,
    parents: parent ? [parent] : [],
    message: `log: snapshot ${Date.now()}`,
    ...(hasIdentity ? {} : { author: placeholder, committer: placeholder }),
  });
  git(repo, [
    "update-ref",
    "-m",
    "log snapshot",
    logRef,
    created,
    parent ?? ZERO,
  ]);
  return created;
}
