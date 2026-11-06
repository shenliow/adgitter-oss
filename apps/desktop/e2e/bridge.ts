/**
 * Node-side IPC bridge (Playwright ⇄ real `git`).
 *
 * `installBridge(page, repoPath)` exposes `window.__E2E_INVOKE__` (see
 * `e2e/shims/core.ts`) — every `invoke(cmd, args)` call the app makes lands
 * here. A handful of commands (the ones the 5 specs actually exercise) shell
 * out to the system `git` against `repoPath` and return DTOs shaped EXACTLY
 * like `src/lib/ipc.ts` declares them (snake_case fields, same optionality).
 * Everything else resolves a benign default mirroring
 * `src/test/appHarness.ts`'s `resetHarness()` — the same "sane default for
 * every ipc function" list that harness keeps for jsdom mounts, just spoken
 * as raw invoke-command strings instead of `vi.fn()`s.
 *
 * Real, as of the gesture-operations suite (`commit`/`merge-rebase`/
 * `cherry-pick`/`remove`/`reset`/`checkout` specs): `repo_status`/
 * `stage_paths`/`unstage_paths`/`discard_paths`/`create_commit` (the
 * commit flow), and the history-rewriting ops the 8 documented gestures
 * drive — `merge`, `reset`, `cherry_pick`, `rebase_onto`, `rebase_branch`,
 * `drop_commit`. Each shells out to the real `git` CLI exactly like the
 * read-only commands above, so a passing spec proves real git semantics end
 * to end (a merge really creates a merge commit, a hard reset really discards
 * working-tree changes, etc.) — not merely that the UI called the right IPC
 * name.
 *
 * Also real, as of the guided tutorial (`e2e/tutorial-demo.spec.ts`):
 * the six `tutorial_demo_*` commands (`e2e/tutorialDemo.ts`, a re-derivation
 * of `crates/git-core/src/tutorial_demo.rs`) and everything the tutorial's
 * script drives on the demo repo — `reword`, `rebase` (explicit plans),
 * `purge_path`, `add_file_to_commit`, `undo` (backup refs under
 * `refs/adgitter/backup/`, one batch per rewrite, descendant-branch remap),
 * `log_commit`, and `push`/`push_branch` (plain push to a local origin; a
 * non-fast-forward rejection throws, `force` overwrites). The history engine
 * lives in `e2e/gitOps.ts`. Repo-scoped commands act on the `repoPath` the
 * app sends (the demo repo is not the fixture), defaulting to the fixture.
 *
 * Also real: `read_project_config`/`write_project_config` (a real
 * `adgitter.config.json` inside the fixture repo).
 *
 * Deliberately still NOT real: `diff_file`/`diff_worktree`/`revert`/
 * `squash_range`/`fetch`/`pull`, the pause-into-resolve-mode state machine
 * (a conflicting merge/replay throws after restoring the pre-op state), and
 * Log-Anytime background/telemetry/license-issuing — no spec touches them,
 * and the real Rust implementations already have cargo-test coverage (this
 * e2e layer's job is the DOM/gesture/git-plumbing seam, not re-proving the
 * Rust layer). `verify_license` is the one deliberate departure from
 * "benign": it returns an ACTIVE enterprise-plan DTO (rather than jsdom's
 * default `invalid`) so every paid feature unlocks —
 * several settings/branches assertions would otherwise sit behind an upsell
 * lock. Since startup session restore reads the same command, the app also
 * boots *signed in* under e2e; no spec asserts the signed-out account panel,
 * and a live enterprise license is what being signed in actually looks like.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { git, gitOrNull, lines } from "./gitCli";
import {
  addFileToCommit,
  backupBeforeAmend,
  cherryPick,
  dropCommit,
  logCommit,
  merge,
  purgePath,
  push,
  pushBranch,
  rebase,
  rebaseBranch,
  rebaseOnto,
  reset,
  reword,
  undoLast,
  type RebaseStep,
} from "./gitOps";
import { TutorialDemoHost } from "./tutorialDemo";

// ---------------------------------------------------------------------------
// list_commits — mirrors crates/git-core/src/git.rs's ghost rule: a commit
// reachable ONLY via `refs/adgitter/*` renders `ghost: true`.
// ---------------------------------------------------------------------------

const FIELD_SEP = "\x1f";
const RECORD_SEP = "\x1e";
const LOG_FORMAT = `%H${FIELD_SEP}%h${FIELD_SEP}%P${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%at${FIELD_SEP}%s${FIELD_SEP}%b${RECORD_SEP}`;

interface CommitDto {
  sha: string;
  short_sha: string;
  author_name: string;
  author_email: string;
  timestamp: number;
  subject: string;
  body: string;
  parents: string[];
  ghost: boolean;
}

function parseLog(output: string): Omit<CommitDto, "ghost">[] {
  return output
    .split(RECORD_SEP)
    .map((r) => r.replace(/^\n+/, "").replace(/\n+$/, ""))
    .filter((r) => r.length > 0)
    .map((record) => {
      const [
        sha,
        short_sha,
        parentsRaw,
        author_name,
        author_email,
        at,
        subject,
        ...bodyParts
      ] = record.split(FIELD_SEP);
      return {
        sha,
        short_sha,
        parents: parentsRaw ? parentsRaw.split(" ").filter(Boolean) : [],
        author_name,
        author_email,
        timestamp: Number(at),
        subject: subject ?? "",
        body: bodyParts.join(FIELD_SEP).replace(/\n+$/, ""),
      };
    });
}

function listCommits(
  repoPath: string,
  limit: number | undefined,
): { commits: CommitDto[]; truncated: boolean; limit: number } {
  const cap = limit ?? 1000;

  let all: Omit<CommitDto, "ghost">[];
  try {
    all = parseLog(
      git(repoPath, ["log", "--all", "--topo-order", `--format=${LOG_FORMAT}`]),
    );
  } catch {
    all = []; // unborn HEAD — no commits yet
  }

  const truncated = all.length > cap;
  const page = all.slice(0, cap);

  // Non-ghost set: everything reachable from HEAD + every ref EXCEPT
  // refs/adgitter/* (the backup refs that keep orphaned commits alive).
  let nonGhost = new Set<string>();
  if (page.length > 0) {
    const nonAdgitterRefs = lines(
      git(repoPath, ["for-each-ref", "--format=%(refname)"]),
    ).filter((r) => !r.startsWith("refs/adgitter/"));
    const reachable = gitOrNull(repoPath, [
      "log",
      "--topo-order",
      "--format=%H",
      "HEAD",
      ...nonAdgitterRefs,
    ]);
    if (reachable) nonGhost = new Set(lines(reachable));
  }

  const commits: CommitDto[] = page.map((c) => ({
    ...c,
    ghost: !nonGhost.has(c.sha),
  }));

  return { commits, truncated, limit: cap };
}

// ---------------------------------------------------------------------------
// list_refs
// ---------------------------------------------------------------------------

interface GitRefDto {
  name: string;
  kind: "branch" | "remote" | "tag";
  target: string;
  created_ms: number | null;
  has_upstream: boolean | null;
}

interface RefListDto {
  head: { branch: string | null; target: string | null; detached: boolean };
  branches: GitRefDto[];
  remotes: GitRefDto[];
  tags: GitRefDto[];
}

/** Committer-timestamp (ms) of a ref's OLDEST reflog entry, or null when the
 *  ref has no reflog — mirrors git.rs's `ref_created_ms`. */
function refCreatedMs(repoPath: string, fullRefName: string): number | null {
  const out = gitOrNull(repoPath, [
    "reflog",
    "show",
    "--date=unix",
    "--format=%cd",
    fullRefName,
  ]);
  if (!out) return null;
  const entries = lines(out);
  if (entries.length === 0) return null;
  const oldest = Number(entries[entries.length - 1]);
  return Number.isFinite(oldest) ? oldest * 1000 : null;
}

function hasUpstream(repoPath: string, branchName: string): boolean {
  return (
    gitOrNull(repoPath, [
      "rev-parse",
      "--abbrev-ref",
      `${branchName}@{upstream}`,
    ]) !== null
  );
}

function listRefs(repoPath: string): RefListDto {
  const shortRef = gitOrNull(repoPath, [
    "symbolic-ref",
    "-q",
    "--short",
    "HEAD",
  ]);
  const target = gitOrNull(repoPath, ["rev-parse", "--verify", "HEAD"]);
  const head =
    target === null
      ? { branch: null, target: null, detached: false } // unborn HEAD
      : shortRef
        ? { branch: shortRef, target, detached: false }
        : { branch: null, target, detached: true };

  const branches: GitRefDto[] = lines(
    git(repoPath, [
      "for-each-ref",
      "--format=%(refname:short)\t%(objectname)",
      "refs/heads",
    ]),
  ).map((line) => {
    const [name, sha] = line.split("\t");
    return {
      name,
      kind: "branch",
      target: sha,
      created_ms: refCreatedMs(repoPath, `refs/heads/${name}`),
      has_upstream: hasUpstream(repoPath, name),
    };
  });

  const remotes: GitRefDto[] = lines(
    git(repoPath, [
      "for-each-ref",
      "--format=%(refname:short)\t%(objectname)",
      "refs/remotes",
    ]),
  )
    .map((line) => {
      const [name, sha] = line.split("\t");
      return {
        name,
        kind: "remote" as const,
        target: sha,
        created_ms: null,
        has_upstream: null,
      };
    })
    .filter((r) => !r.name.endsWith("/HEAD")); // origin/HEAD is symbolic, not a real branch

  const tags: GitRefDto[] = lines(
    git(repoPath, [
      "for-each-ref",
      "--format=%(refname:short)\t%(objectname)\t%(*objectname)",
      "refs/tags",
    ]),
  ).map((line) => {
    const [name, obj, peeled] = line.split("\t");
    // Annotated tags peel to a commit via `*objectname`; lightweight tags
    // already point straight at one.
    return {
      name,
      kind: "tag" as const,
      target: peeled && peeled.length > 0 ? peeled : obj,
      created_ms: null,
      has_upstream: null,
    };
  });

  return { head, branches, remotes, tags };
}

// ---------------------------------------------------------------------------
// Mutating ref/branch/tag commands
// ---------------------------------------------------------------------------

function checkout(repoPath: string, target: string): void {
  git(repoPath, ["checkout", target]);
}

function createBranch(repoPath: string, name: string, from: string): void {
  git(repoPath, ["branch", name, from]);
}

function renameBranch(
  repoPath: string,
  oldName: string,
  newName: string,
): void {
  git(repoPath, ["branch", "-m", oldName, newName]);
}

function deleteBranch(repoPath: string, name: string): void {
  git(repoPath, ["branch", "-D", name]);
}

function checkoutRemoteBranch(
  repoPath: string,
  remoteName: string,
  localName: string,
): void {
  git(repoPath, ["branch", "--track", localName, remoteName]);
  git(repoPath, ["checkout", localName]);
}

/**
 * The configured upstream of `branch` as a remote-tracking shorthand, read from
 * **config** — mirroring git-core's `configured_upstream`.
 *
 * Deliberately not `rev-parse --abbrev-ref <branch>@{upstream}`: that resolves
 * the ref, so a branch wired to a since-deleted remote branch answers nothing
 * and would be classified `adoptUpstream` — the exact mis-classification the
 * production rule exists to prevent (it would silently re-point the branch).
 */
function configuredUpstream(repoPath: string, branch: string): string | null {
  const remote = gitOrNull(repoPath, ["config", `branch.${branch}.remote`]);
  const merge = gitOrNull(repoPath, ["config", `branch.${branch}.merge`]);
  if (!remote || !merge) return null;
  return `${remote}/${merge.replace(/^refs\/heads\//, "")}`;
}

/** Mirrors git-core's `inspect_remote_checkout` matrix with plain git. */
function inspectRemoteCheckout(
  repoPath: string,
  remoteName: string,
  localName: string,
): unknown {
  const localTip = gitOrNull(repoPath, [
    "rev-parse",
    "--verify",
    `refs/heads/${localName}`,
  ]);
  if (localTip === null)
    return { case: "createLocal", suggestedLocal: localName };

  const upstream = configuredUpstream(repoPath, localName);
  const counts =
    gitOrNull(repoPath, [
      "rev-list",
      "--left-right",
      "--count",
      `${remoteName}...${localName}`,
    ]) ?? "0\t0";
  const [behindStr, aheadStr] = counts.split(/\s+/);
  const behind = Number(behindStr) || 0;
  const ahead = Number(aheadStr) || 0;
  const sync =
    ahead === 0 && behind === 0
      ? "none"
      : ahead === 0
        ? "offerPull"
        : behind === 0
          ? "localAhead"
          : "diverged";
  if (upstream !== null && upstream !== remoteName) {
    // Shaped like the real `AdgitterError`, which the frontend switches on by
    // `code` — a bare Error would reach the UI as an untagged string.
    throw Object.assign(
      new Error(
        `local branch '${localName}' already tracks '${upstream}', not '${remoteName}'`,
      ),
      { code: "REMOTE_UPSTREAM_MISMATCH" },
    );
  }
  return {
    case: upstream === null ? "adoptUpstream" : "checkout",
    localName,
    ahead,
    behind,
    sync,
  };
}

function adoptRemoteUpstreamAndCheckout(
  repoPath: string,
  remoteName: string,
  localName: string,
): void {
  git(repoPath, ["checkout", localName]);
  git(repoPath, ["branch", `--set-upstream-to=${remoteName}`, localName]);
}

function createTag(
  repoPath: string,
  name: string,
  target: string,
  message: string | null | undefined,
): void {
  if (message) {
    git(repoPath, ["tag", "-a", name, "-m", message, target]);
  } else {
    git(repoPath, ["tag", name, target]);
  }
}

// ---------------------------------------------------------------------------
// list_commit_files
// ---------------------------------------------------------------------------

type FileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "typechange";

const STATUS_MAP: Record<string, FileStatus> = {
  A: "added",
  M: "modified",
  D: "deleted",
  T: "typechange",
};

function listCommitFiles(
  repoPath: string,
  sha: string,
): {
  path: string;
  status: FileStatus;
  old_path: string | null;
  insertions: number;
  deletions: number;
}[] {
  const numstatByPath = new Map<
    string,
    { insertions: number; deletions: number }
  >();
  for (const line of lines(
    git(repoPath, ["show", "--numstat", "--format=", sha]),
  )) {
    const [ins, del, path] = line.split("\t");
    numstatByPath.set(path, {
      insertions: ins === "-" ? 0 : Number(ins),
      deletions: del === "-" ? 0 : Number(del),
    });
  }

  return lines(git(repoPath, ["show", "--name-status", "--format=", sha])).map(
    (line) => {
      const parts = line.split("\t");
      const code = parts[0];
      let status: FileStatus;
      let path: string;
      let old_path: string | null = null;
      if (code.startsWith("R") || code.startsWith("C")) {
        status = code.startsWith("R") ? "renamed" : "copied";
        old_path = parts[1];
        path = parts[2];
      } else {
        status = STATUS_MAP[code[0]] ?? "modified";
        path = parts[1];
      }
      const ns = numstatByPath.get(path) ?? { insertions: 0, deletions: 0 };
      return {
        path,
        status,
        old_path,
        insertions: ns.insertions,
        deletions: ns.deletions,
      };
    },
  );
}

// ---------------------------------------------------------------------------
// ahead_behind
// ---------------------------------------------------------------------------

function aheadBehind(repoPath: string): {
  ahead: number;
  behind: number;
  upstream: string | null;
} {
  const branch = gitOrNull(repoPath, ["symbolic-ref", "-q", "--short", "HEAD"]);
  if (!branch) return { ahead: 0, behind: 0, upstream: null };

  const upstream = gitOrNull(repoPath, [
    "rev-parse",
    "--abbrev-ref",
    `${branch}@{upstream}`,
  ]);
  if (!upstream) return { ahead: 0, behind: 0, upstream: null };

  const counts = gitOrNull(repoPath, [
    "rev-list",
    "--left-right",
    "--count",
    `${upstream}...HEAD`,
  ]);
  if (!counts) return { ahead: 0, behind: 0, upstream };
  const [behind, ahead] = counts.split(/\s+/).map(Number);
  return { ahead: ahead || 0, behind: behind || 0, upstream };
}

// remote_url
function remoteUrlOf(repoPath: string, remote: string): string | null {
  return gitOrNull(repoPath, ["remote", "get-url", remote]);
}

// branch upstream get/set
function branchUpstreamOf(repoPath: string, branch: string): string | null {
  return gitOrNull(repoPath, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    `${branch}@{upstream}`,
  ]);
}

function setUpstreamOf(
  repoPath: string,
  branch: string,
  upstream: string | null,
): void {
  if (upstream) {
    git(repoPath, ["branch", `--set-upstream-to=${upstream}`, branch]);
  } else {
    git(repoPath, ["branch", "--unset-upstream", branch]);
  }
}

// ---------------------------------------------------------------------------
// repo_status / stage_paths / unstage_paths / discard_paths / create_commit
// (the commit-flow gestures, `e2e/commit.spec.ts`)
// ---------------------------------------------------------------------------

type WorkStatus =
  | "new"
  | "modified"
  | "deleted"
  | "renamed"
  | "typechange"
  | "ignored"
  | "conflicted";

interface WorkStatusEntryDto {
  path: string;
  status: WorkStatus;
  old_path: string | null;
}

interface RepoStatusDto {
  staged: WorkStatusEntryDto[];
  changed: WorkStatusEntryDto[];
  untracked: WorkStatusEntryDto[];
  ignored: WorkStatusEntryDto[];
  conflicted: WorkStatusEntryDto[];
}

/** Map a single `git status --porcelain` X/Y status letter to `WorkStatus`.
 *  `C` (copied) has no dedicated `WorkStatus` — closest analog is `renamed`.
 *  `U` (unmerged/conflict) maps to `conflicted` — the resolve-mode section
 *  of the files panel. */
function mapWorkStatus(code: string): WorkStatus {
  switch (code) {
    case "A":
      return "new";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "renamed";
    case "T":
      return "typechange";
    case "U":
      return "conflicted";
    default:
      return "modified";
  }
}

/** An unmerged porcelain XY pair: any `U`, plus the U-less both-added /
 *  both-deleted combos (`AA` / `DD`). */
function isUnmerged(x: string, y: string): boolean {
  return (
    x === "U" ||
    y === "U" ||
    (x === "A" && y === "A") ||
    (x === "D" && y === "D")
  );
}

interface RawStatusEntry {
  x: string;
  y: string;
  path: string;
  origPath: string | null;
}

/** Parse `git status --porcelain=v1 --ignored -z` output. Each record is
 *  `XY<space>PATH`; a rename/copy (R/C in either column) additionally carries
 *  the original path as its own NUL-terminated field right after. */
function parseStatusZ(output: string): RawStatusEntry[] {
  const parts = output.split("\0").filter((p) => p.length > 0);
  const out: RawStatusEntry[] = [];
  let i = 0;
  while (i < parts.length) {
    const rec = parts[i];
    i += 1;
    const x = rec[0];
    const y = rec[1];
    const path = rec.slice(3);
    let origPath: string | null = null;
    if (x === "R" || y === "R" || x === "C" || y === "C") {
      origPath = parts[i] ?? null;
      i += 1;
    }
    out.push({ x, y, path, origPath });
  }
  return out;
}

/** Working-tree status grouped Staged / Changed / Untracked / Ignored —
 *  mirrors `crates/git-core/src/workdir.rs`'s `status()` grouping (index
 *  delta → staged, worktree delta → changed, `??` → untracked, `!!` →
 *  ignored) over real `git status` instead of libgit2. */
function repoStatus(repoPath: string): RepoStatusDto {
  // `--untracked-files=all`: `workdir.rs` sets `recurse_untracked_dirs(true)`, so
  // a new directory lists its files (`src/app.js`), not the collapsed `src/` —
  // the Files panel (and the tutorial's per-file targets) need real paths.
  const raw = git(repoPath, [
    "status",
    "--porcelain=v1",
    "--ignored",
    "--untracked-files=all",
    "-z",
  ]);
  const out: RepoStatusDto = {
    staged: [],
    changed: [],
    untracked: [],
    ignored: [],
    conflicted: [],
  };
  for (const e of parseStatusZ(raw)) {
    if (e.x === "!" && e.y === "!") {
      out.ignored.push({ path: e.path, status: "ignored", old_path: null });
      continue;
    }
    if (e.x === "?" && e.y === "?") {
      out.untracked.push({ path: e.path, status: "new", old_path: null });
      continue;
    }
    if (isUnmerged(e.x, e.y)) {
      out.conflicted.push({
        path: e.path,
        status: "conflicted",
        old_path: null,
      });
      continue;
    }
    if (e.x !== " " && e.x !== "?") {
      out.staged.push({
        path: e.path,
        status: mapWorkStatus(e.x),
        old_path: e.origPath,
      });
    }
    if (e.y !== " " && e.y !== "?") {
      out.changed.push({
        path: e.path,
        status: mapWorkStatus(e.y),
        old_path: e.origPath,
      });
    }
  }
  return out;
}

function stagePaths(repoPath: string, paths: string[]): void {
  if (paths.length === 0) return;
  git(repoPath, ["add", "--", ...paths]);
}

/** Unstage `paths` — `restore --staged` (rather than `reset HEAD --`) works
 *  the same on an unborn HEAD, which `reset` rejects. */
function unstagePaths(repoPath: string, paths: string[]): void {
  if (paths.length === 0) return;
  git(repoPath, ["restore", "--staged", "--", ...paths]);
}

/** Discard unstaged working-tree changes for tracked `paths` (untracked
 *  files are left untouched — matches `workdir.rs`'s `discard()`). */
function discardPaths(repoPath: string, paths: string[]): void {
  if (paths.length === 0) return;
  git(repoPath, ["checkout", "--", ...paths]);
}

/** Commit the currently-staged index with `message`; `amend` replaces HEAD
 *  instead. Returns the new sha. */
function createCommit(
  repoPath: string,
  message: string,
  amend: boolean,
): string {
  // `workdir::commit(.., amend = true)` snapshots the branch first (undoable).
  if (amend) backupBeforeAmend(repoPath);
  const args = amend
    ? ["commit", "--amend", "-m", message]
    : ["commit", "-m", message];
  git(repoPath, args);
  return git(repoPath, ["rev-parse", "HEAD"]).trim();
}

// ---------------------------------------------------------------------------
// History-rewriting ops (merge/rebase/cherry-pick/reset/drop, the
// gestures `e2e/merge-rebase.spec.ts`, `e2e/cherry-pick.spec.ts`,
// `e2e/reset.spec.ts` and `e2e/remove.spec.ts` drive; plus reword/purge/
// add-file/undo/push for the guided tutorial). The implementations live in
// `e2e/gitOps.ts` — real-`git` re-derivations of `crates/git-core`'s engine,
// backup refs and undo included. A merge/replay conflict throws (after
// restoring the pre-op state), which propagates through `page.exposeFunction`
// as a rejected promise the app surfaces like any other IPC rejection.
// ---------------------------------------------------------------------------

const PROJECT_CONFIG_FILENAME = "adgitter.config.json";
/** 256 KiB — `commands.rs`'s `PROJECT_CONFIG_MAX_BYTES`. */
const PROJECT_CONFIG_MAX_BYTES = 256 * 1024;

/** Read `<repo>/adgitter.config.json`, or null when it does not exist (the
 *  common case, not an error — mirrors `read_project_config_sync`). */
function readProjectConfig(repoPath: string): string | null {
  const path = join(repoPath, PROJECT_CONFIG_FILENAME);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

/** Validate + write `<repo>/adgitter.config.json` — same contract as
 *  `write_project_config_sync`: under the size cap, valid JSON, a top-level
 *  object, stored pretty-printed. The Rust version writes atomically (temp file
 *  + rename); a single-process test double writes directly. */
function writeProjectConfigFile(repoPath: string, content: string): void {
  if (Buffer.byteLength(content) > PROJECT_CONFIG_MAX_BYTES) {
    throw new Error("adgitter.config.json content is too large");
  }
  const value: unknown = JSON.parse(content);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("adgitter.config.json must be a JSON object");
  }
  writeFileSync(
    join(repoPath, PROJECT_CONFIG_FILENAME),
    JSON.stringify(value, null, 2),
    "utf8",
  );
}

// ---------------------------------------------------------------------------
// Benign defaults for everything else (mirrors src/test/appHarness.ts)
// ---------------------------------------------------------------------------

function emptyDiff(path: string) {
  return { path, old_path: null, status: "modified", binary: false, hunks: [] };
}

/** An always-active, all-features enterprise entitlement — unlocks every
 *  paid feature so no
 *  spec has to fight an upsell lock. See the module doc for why this is the
 *  one deliberate departure from "benign default". */
const ACTIVE_LICENSE = {
  status: "active",
  plan: "enterprise",
  error: null,
  expiresMs: Date.now() + 365 * 24 * 60 * 60 * 1000,
  features: [
    "NoAd",
    "ApplyTheme",
    "TicketsPriority",
    "LogAnytimeBackground",
    "LogAnytimeSquash",
    "TeamSeats",
    "IssueTracker",
  ],
  ownedThemes: [] as string[],
};

// ---------------------------------------------------------------------------
// createBridge / installBridge
// ---------------------------------------------------------------------------

export interface BridgeOptions {
  /** Directory the `tutorial_demo_*` commands confine to (the stand-in for
   *  `<app_data_dir>/tutorial`). Default: a lazily created per-bridge temp
   *  dir that `dispose()` removes. */
  tutorialBaseDir?: string;
}

export interface Bridge {
  /** One `invoke(cmd, args)` call, exactly as the app's shim issues it. */
  invoke(cmd: string, args?: Record<string, unknown>): unknown;
  /** Remove everything the bridge created on its own (the tutorial temp dir). */
  dispose(): void;
}

/**
 * The command router behind `window.__E2E_INVOKE__`, usable without a browser
 * (the bridge-level test `e2e/tutorial-demo.spec.ts` calls `invoke` directly).
 * Repo-scoped commands act on `args.repoPath` when the app sends one — the
 * guided tutorial opens a demo repo that is NOT the fixture — and fall back to
 * `repoPath` (the fixture) otherwise.
 */
export function createBridge(
  repoPath: string,
  options: BridgeOptions = {},
): Bridge {
  const tutorial = new TutorialDemoHost(options.tutorialBaseDir);

  const invoke = (cmd: string, args: Record<string, unknown> = {}): unknown => {
    const rp =
      typeof args.repoPath === "string" && args.repoPath.length > 0
        ? args.repoPath
        : repoPath;
    switch (cmd) {
      // --- REAL git, against the fixture repo --------------------------
      case "list_commits":
        return listCommits(rp, args.limit as number | undefined);
      case "list_refs":
        return listRefs(rp);
      case "checkout":
        checkout(rp, args.target as string);
        return null;
      case "create_branch":
        createBranch(rp, args.name as string, args.from as string);
        return null;
      case "rename_branch":
        renameBranch(rp, args.oldName as string, args.newName as string);
        return null;
      case "delete_branch":
        deleteBranch(rp, args.name as string);
        return null;
      case "checkout_remote_branch":
        checkoutRemoteBranch(
          rp,
          args.remoteName as string,
          args.localName as string,
        );
        return null;
      case "inspect_remote_checkout":
        return inspectRemoteCheckout(
          rp,
          args.remoteName as string,
          args.localName as string,
        );
      case "adopt_remote_upstream_and_checkout":
        adoptRemoteUpstreamAndCheckout(
          rp,
          args.remoteName as string,
          args.localName as string,
        );
        return null;
      case "create_tag":
        createTag(
          rp,
          args.name as string,
          args.target as string,
          args.message as string | null | undefined,
        );
        return null;
      case "list_commit_files":
        return listCommitFiles(rp, args.sha as string);
      case "ahead_behind":
        return aheadBehind(rp);
      case "remote_url":
        return remoteUrlOf(rp, (args.remote as string) ?? "origin");
      case "branch_upstream":
        return branchUpstreamOf(rp, args.branch as string);
      case "set_upstream":
        setUpstreamOf(
          rp,
          args.branch as string,
          (args.upstream as string | null) ?? null,
        );
        return null;
      case "repo_status":
        return repoStatus(rp);
      case "stage_paths":
        stagePaths(rp, args.paths as string[]);
        return null;
      case "unstage_paths":
        unstagePaths(rp, args.paths as string[]);
        return null;
      case "discard_paths":
        discardPaths(rp, args.paths as string[]);
        return null;
      case "create_commit":
        return createCommit(rp, args.message as string, !!args.amend);

      // History-rewrite ops resolve a tagged HistoryOpResult. A conflicting
      // merge/replay throws instead of pausing into resolve mode (that state
      // machine is backend logic covered by git-core's Rust tests); every
      // other behaviour — backup refs, ghosts, descendant remap, undo — is
      // re-derived in `e2e/gitOps.ts`.
      case "merge":
        return merge(rp, args.source as string);
      case "reset":
        reset(rp, args.target as string, args.mode as string);
        return null;
      case "cherry_pick":
        cherryPick(rp, args.commits as string[]);
        return null;
      case "rebase_onto":
        return rebaseOnto(rp, args.onto as string);
      case "rebase_branch":
        return rebaseBranch(rp, args.branch as string, args.onto as string);
      case "drop_commit":
        return dropCommit(rp, args.sha as string);
      case "rebase":
        return rebase(rp, args.onto as string, args.steps as RebaseStep[]);
      case "reword":
        return reword(rp, args.sha as string, args.message as string);
      case "purge_path":
        return purgePath(rp, args.sha as string, args.path as string);
      case "add_file_to_commit":
        return addFileToCommit(rp, args.sha as string, args.path as string);
      case "undo":
        return undoLast(rp);
      case "log_commit":
        return logCommit(rp, args.branch as string);
      case "push":
        push(
          rp,
          (args.remote as string | undefined) ?? "origin",
          !!args.force,
          (args.url as string | null | undefined) ?? null,
        );
        return undefined;
      case "push_branch":
        pushBranch(
          rp,
          args.branch as string,
          (args.remote as string | undefined) ?? "origin",
          (args.url as string | null | undefined) ?? null,
        );
        return undefined;

      // --- REAL guided-tutorial demo repo (crates/git-core/src/tutorial_demo.rs)
      case "tutorial_demo_create":
        return tutorial.create();
      case "tutorial_demo_seed_files":
        return tutorial.seedFiles(args.repoPath as string);
      case "tutorial_demo_seed_history":
        tutorial.seedHistory(args.repoPath as string);
        return undefined;
      case "tutorial_demo_write_file":
        tutorial.writeFile(
          args.repoPath as string,
          args.path as string,
          args.content as string,
        );
        return undefined;
      case "tutorial_demo_simulate_log":
        return tutorial.simulateLog(
          args.repoPath as string,
          args.branch as string,
          args.count as number,
        );
      case "tutorial_demo_remove":
        tutorial.remove(args.repoPath as string);
        return undefined;

      case "read_project_config":
        return readProjectConfig(args.repoPath as string);
      case "write_project_config":
        writeProjectConfigFile(args.repoPath as string, args.content as string);
        return undefined;

      // --- Benign defaults (mirror src/test/appHarness.ts) -------------
      case "ping":
        return "pong";
      case "diff_file":
        return emptyDiff(String(args.path));
      case "diff_worktree":
        return emptyDiff(String(args.path));
      case "file_history":
        return [];
      case "start_repo_watch":
      case "stop_repo_watch":
      case "delete_tag":
      case "revert":
        // Not exercised by the specs today, but they resolve the same
        // HistoryOpOutcome shape the app reads `.skipped` from.
        return { remapped: [], skipped: [] };
      case "squash_range":
      // continue_op resolves the same tagged shape (completed-empty here —
      // the bridge never actually pauses an op, see the comment above).
      case "continue_op":
        return {
          status: "completed",
          outcome: { remapped: [], skipped: [] },
        };
      case "conflict_state":
        // No paused op in this suite's fixtures — resolve mode never
        // re-enters on load.
        return null;
      case "abort_op":
        return undefined;
      case "init_repository":
      case "clone_repository":
      case "fetch":
      case "pull":
      case "report_event":
      case "debug_trigger_crash":
      case "open_external_url":
      case "open_path":
      case "remove_device":
        return undefined;
      case "expire_backups":
        return 0;
      case "probe_path": {
        // A real repo path (the tutorial's demo repo) probes as itself; the
        // default stays the fixture repo, as before.
        const p = typeof args.path === "string" ? args.path : null;
        if (p && existsSync(join(p, ".git"))) return { kind: "repo", path: p };
        return { kind: "repo", path: repoPath };
      }
      case "init_crash_reporting":
        return false;
      case "list_devices":
        return [];
      case "verify_license":
      case "issue_license":
      case "renew_license":
      case "dev_seed_license":
        return ACTIVE_LICENSE;
      case "set_dev_plan":
        return undefined;
      case "check_feature":
        return true;
      case "mint_test_license":
        return "token";

      default:
        console.log(
          `[e2e bridge] unhandled command "${cmd}" — returning null`,
          args,
        );
        return null;
    }
  };

  return { invoke, dispose: () => tutorial.dispose() };
}

/**
 * Expose `window.__E2E_INVOKE__` on `page`, routing every `invoke(cmd, args)`
 * call the app makes against the fixture repo at `repoPath` (or the repo the
 * call names — see {@link createBridge}). Must run BEFORE `page.goto('/')`
 * (see `e2e/helpers.ts`). Returns the bridge so the caller can `dispose()` the
 * temp directory the tutorial commands may have created.
 */
export async function installBridge(
  page: Page,
  repoPath: string,
  options: BridgeOptions = {},
): Promise<Bridge> {
  const bridge = createBridge(repoPath, options);
  await page.exposeFunction(
    "__E2E_INVOKE__",
    (cmd: string, args: Record<string, unknown>): unknown =>
      bridge.invoke(cmd, args),
  );
  return bridge;
}
