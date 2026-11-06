/**
 * Typed wrapper around the Tauri IPC commands.
 *
 * Every `invoke` call lives here so the contract with the Rust backend is in
 * one place and tests can mock a single module. The Rust side is read-only
 * for Phase 0 (open a repo, list commits/refs/files, watch for changes).
 */
import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { load, type Store } from "@tauri-apps/plugin-store";
import type { Modifiers } from "./dragDispatch";

export interface Commit {
  sha: string;
  short_sha: string;
  author_name: string;
  author_email: string;
  /** Unix timestamp (seconds, UTC). */
  timestamp: number;
  subject: string;
  body: string;
  /** Parent SHAs, in order. 0 = root, 1 = normal, ≥2 = merge. */
  parents: string[];
  /** True when only reachable via an expiring backup ref (orphaned by a history rewrite). */
  ghost?: boolean;
}

/** A page of commits plus whether more history exists beyond the cap. */
export interface CommitPage {
  commits: Commit[];
  /** True when the repository has more than `limit` commits. */
  truncated: boolean;
  limit: number;
}

export type RefKind = "branch" | "remote" | "tag";

export interface GitRef {
  name: string;
  kind: RefKind;
  /** SHA the ref points to, peeled to a commit. */
  target: string;
  /** Unix ms when the ref was created (oldest reflog entry); local branches
   * only — null for remotes, tags, or a missing reflog. */
  created_ms?: number | null;
  /** Whether the branch has an upstream configured; local branches only —
   * null for remotes and tags, where the concept doesn't apply. */
  has_upstream?: boolean | null;
}

export interface HeadInfo {
  /** Current local branch, or null when detached/unborn. */
  branch: string | null;
  /** SHA HEAD resolves to, or null for an unborn branch. */
  target: string | null;
  detached: boolean;
}

export interface RefList {
  head: HeadInfo;
  branches: GitRef[];
  remotes: GitRef[];
  tags: GitRef[];
}

export type FileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "typechange";

export interface FileChange {
  path: string;
  status: FileStatus;
  /** Previous path — set only for renames/copies. */
  old_path: string | null;
  insertions: number;
  deletions: number;
}

/** Working-tree change type. `"conflicted"` marks an unmerged path
 *  while the app is in resolve mode. */
export type WorkStatus =
  | "new"
  | "modified"
  | "deleted"
  | "renamed"
  | "typechange"
  | "ignored"
  | "conflicted";

export interface StatusEntry {
  path: string;
  status: WorkStatus;
  /** Previous path — set only for renames. */
  old_path: string | null;
}

/** Working-tree status grouped like the design's Changed-Files panel. */
export interface RepoStatus {
  staged: StatusEntry[];
  changed: StatusEntry[];
  untracked: StatusEntry[];
  ignored: StatusEntry[];
  /** Unmerged paths while resolving a conflicted merge/rebase/squash/reword
   *  (entries carry `status: "conflicted"`). Empty outside resolve mode. */
  conflicted: StatusEntry[];
}

export interface AdgitterError {
  code:
    | "REPO_NOT_FOUND"
    | "INVALID_PATH"
    | "GIT_ERROR"
    | "IO_ERROR"
    | "INTERNAL_ERROR"
    /** The licence is valid here but the tier does not include the feature. */
    | "FEATURE_LOCKED"
    /**
     * The stored licence is genuine but bound to a **different device**,
     * so it grants nothing on this install — also covers "this
     * install has no readable device id", which fails closed the same way.
     *
     * Deliberately not `FEATURE_LOCKED`: the user has most likely paid and is
     * on a new or reinstalled machine. The remedy is to sign in again (which
     * re-issues the licence against this device), never to buy a plan.
     */
    | "LICENSE_DEVICE_MISMATCH"
    /** The licence lapsed past its offline grace window: renew, don't upgrade. */
    | "LICENSE_EXPIRED"
    /** Recoverable: no license on disk. The caller signs in and retries. */
    | "NOT_SIGNED_IN"
    /**
     * The account has no subscription to manage, so there is no billing portal
     * to open ({@link createCustomerPortal}).
     *
     * Not a fault and not a sign-in problem: it is the ordinary state of
     * anyone who has never paid, and of a subscriber whose Polar customer id
     * the server has not observed yet. Routing it to `NOT_SIGNED_IN` would
     * launch a browser sign-in that cannot fix it.
     */
    | "NO_SUBSCRIPTION"
    /**
     * The account already has as many signed-in devices as its plan allows
     * (free 1 / basic 2 / advance & enterprise 3), so this install could not be
     * seated. **Nothing on the server changed.**
     *
     * The only licensing refusal with a user action attached: ask whether to
     * sign the oldest device out, and on confirmation retry the same call with
     * `evictOldest` (see {@link issueLicense} / {@link renewLicense}). It is
     * not `NOT_SIGNED_IN` — a sign-in round trip ends at the same refusal —
     * and not `LICENSE_DEVICE_MISMATCH`, which is about a licence bound
     * elsewhere rather than an account with no room.
     */
    | "DEVICE_SEAT_LIMIT"
    | "CONFLICT"
    /**
     * The range a rewrite would have replayed contains a merge commit, which
     * the replay engine refuses to flatten (e.g. rewording a commit only
     * reachable across a merge). Nothing was changed.
     */
    | "MERGE_COMMIT_IN_RANGE";
  message: string;
  /**
   * Set for the sha-carrying codes (`CONFLICT`, `MERGE_COMMIT_IN_RANGE`): the
   * full sha of the offending commit.
   */
  sha?: string;
}

export async function ping(): Promise<string> {
  return invoke<string>("ping");
}

/**
 * Poll the OS for the modifier keys held right now.
 * macOS WKWebView delivers no keyboard events to the page during a native
 * drag session, so MetroGraph polls this every ~80ms while dragging and
 * treats the result as authoritative over its keyboard-tracked snapshot
 * (see MetroGraph's "WKWebView modifier workaround"). Resolves `null` on
 * every other platform, where DragEvent's own flags are already correct and
 * there is nothing to poll — the frontend should stop polling on `null`.
 */
export async function pollNativeModifiers(): Promise<Modifiers | null> {
  return invoke<Modifiers | null>("modifier_flags");
}

export async function listCommits(
  repoPath: string,
  limit?: number,
): Promise<CommitPage> {
  return invoke<CommitPage>("list_commits", { repoPath, limit });
}

export async function listRefs(repoPath: string): Promise<RefList> {
  return invoke<RefList>("list_refs", { repoPath });
}

export async function listCommitFiles(
  repoPath: string,
  sha: string,
): Promise<FileChange[]> {
  return invoke<FileChange[]>("list_commit_files", { repoPath, sha });
}

// ── Structured file diffs ─────────────────────────────────────────

export interface DiffLine {
  /** libgit2 origin marker: ' ' context, '+' add, '-' delete. */
  origin: string;
  /** Line number in the old file (null for additions). */
  old_lineno: number | null;
  /** Line number in the new file (null for deletions). */
  new_lineno: number | null;
  content: string;
}

export interface DiffHunk {
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  old_path: string | null;
  status: string;
  /** Binary file — `hunks` is empty. */
  binary: boolean;
  hunks: DiffHunk[];
}

/** Diff `path` in commit `sha` against its first parent. */
export async function diffFile(
  repoPath: string,
  sha: string,
  path: string,
): Promise<FileDiff> {
  return invoke<FileDiff>("diff_file", { repoPath, sha, path });
}

/** Commits reachable from HEAD that changed `path`, newest first. */
export async function fileHistory(
  repoPath: string,
  path: string,
  limit?: number,
): Promise<Commit[]> {
  return invoke<Commit[]>("file_history", { repoPath, path, limit });
}

/** Diff `path` in the working tree (staged + unstaged) against HEAD. */
export async function diffWorktree(
  repoPath: string,
  path: string,
): Promise<FileDiff> {
  return invoke<FileDiff>("diff_worktree", { repoPath, path });
}

/** Start focus-scoped watching of the repository for on-disk changes. */
export async function startRepoWatch(repoPath: string): Promise<void> {
  return invoke<void>("start_repo_watch", { repoPath });
}

/** Stop watching the repository (called when the window loses focus). */
export async function stopRepoWatch(): Promise<void> {
  return invoke<void>("stop_repo_watch");
}

/** Working-tree status grouped Staged / Changed / Untracked / Ignored. */
export async function repoStatus(repoPath: string): Promise<RepoStatus> {
  return invoke<RepoStatus>("repo_status", { repoPath });
}

export async function stagePaths(
  repoPath: string,
  paths: string[],
): Promise<void> {
  return invoke<void>("stage_paths", { repoPath, paths });
}

export async function unstagePaths(
  repoPath: string,
  paths: string[],
): Promise<void> {
  return invoke<void>("unstage_paths", { repoPath, paths });
}

export async function discardPaths(
  repoPath: string,
  paths: string[],
): Promise<void> {
  return invoke<void>("discard_paths", { repoPath, paths });
}

/** Commit the staged index; `amend` replaces the HEAD commit. Returns the sha. */
export async function createCommit(
  repoPath: string,
  message: string,
  amend = false,
): Promise<string> {
  return invoke<string>("create_commit", { repoPath, message, amend });
}

/** Create local branch `name` at `from` (a ref name or sha). */
export async function createBranch(
  repoPath: string,
  name: string,
  from: string,
): Promise<void> {
  return invoke<void>("create_branch", { repoPath, name, from });
}

export async function renameBranch(
  repoPath: string,
  oldName: string,
  newName: string,
): Promise<void> {
  return invoke<void>("rename_branch", { repoPath, oldName, newName });
}

export async function deleteBranch(
  repoPath: string,
  name: string,
): Promise<void> {
  return invoke<void>("delete_branch", { repoPath, name });
}

/** Set (or clear, with `null`) a local branch's upstream. */
export async function setUpstream(
  repoPath: string,
  branch: string,
  upstream: string | null,
): Promise<void> {
  return invoke<void>("set_upstream", { repoPath, branch, upstream });
}

/** A local branch's current upstream shorthand (e.g. "origin/main"), or null. */
export async function branchUpstream(
  repoPath: string,
  branch: string,
): Promise<string | null> {
  return invoke<string | null>("branch_upstream", { repoPath, branch });
}

/** Check out a branch or commit (updates HEAD + working tree). */
export async function checkout(
  repoPath: string,
  target: string,
): Promise<void> {
  return invoke<void>("checkout", { repoPath, target });
}

/**
 * What to say about the local and remote tips once the branch is checked out.
 * `"offerPull"` is the only one that earns a prompt — see `SyncPrompt` in
 * `git-core/src/branch.rs` for why the three shapes of "they differ" are not
 * one case.
 */
export type SyncPrompt = "none" | "offerPull" | "localAhead" | "diverged";

/**
 * What a "check out this remote branch" gesture should actually do, classified
 * by the backend in one pass (see `inspect_remote_checkout`). A discriminated
 * union, so a situation this UI has not handled is a type error rather than a
 * silent success.
 */
export type RemoteCheckoutPlan =
  | { case: "createLocal"; suggestedLocal: string }
  | {
      case: "checkout";
      localName: string;
      ahead: number;
      behind: number;
      sync: SyncPrompt;
    }
  | {
      case: "adoptUpstream";
      localName: string;
      ahead: number;
      behind: number;
      sync: SyncPrompt;
    };

/**
 * Classify a remote-branch checkout before doing anything, so the UI asks the
 * question that fits (or nothing at all). Read-only. Rejects with
 * `REMOTE_UPSTREAM_MISMATCH` when a local branch of that name already tracks a
 * *different* remote branch — the one row that cannot proceed.
 */
export async function inspectRemoteCheckout(
  repoPath: string,
  remoteName: string,
  localName: string,
): Promise<RemoteCheckoutPlan> {
  return invoke<RemoteCheckoutPlan>("inspect_remote_checkout", {
    repoPath,
    remoteName,
    localName,
  });
}

/**
 * Check out the existing local branch `localName` and point its upstream at
 * `remoteName` — step one of the `adoptUpstream` row's two-step flow (step two
 * is the optional `pull`).
 */
export async function adoptRemoteUpstreamAndCheckout(
  repoPath: string,
  remoteName: string,
  localName: string,
): Promise<void> {
  return invoke<void>("adopt_remote_upstream_and_checkout", {
    repoPath,
    remoteName,
    localName,
  });
}

/**
 * Create a local branch tracking `remoteName` at its tip and check it out —
 * the `createLocal` row's primary action. Rejects when the remote branch is
 * unknown or `localName` already names a local branch.
 */
export async function checkoutRemoteBranch(
  repoPath: string,
  remoteName: string,
  localName: string,
): Promise<void> {
  return invoke<void>("checkout_remote_branch", {
    repoPath,
    remoteName,
    localName,
  });
}

export async function createTag(
  repoPath: string,
  name: string,
  target: string,
  message?: string,
): Promise<void> {
  return invoke<void>("create_tag", {
    repoPath,
    name,
    target,
    message: message ?? null,
  });
}

export async function deleteTag(repoPath: string, name: string): Promise<void> {
  return invoke<void>("delete_tag", { repoPath, name });
}

// ── History-rewriting operations ──────────────────────────────────
// Every mutating op snapshots the affected ref first, so it is reversible via
// `undo()`. merge/rebaseOnto/rebaseBranch/rebase/dropCommit/squashRange/reword
// resolve a tagged `HistoryOpResult` instead of throwing on conflict — see
// that type below and the "Conflict resolution" section further down.

/**
 * Merge `source` into the current branch (fast-forward or merge commit).
 * Resolves `{status:"conflict", state}` instead of throwing when the merge
 * hits a conflict — the caller enters resolve mode (see `conflictState`).
 */
export async function merge(
  repoPath: string,
  source: string,
): Promise<HistoryOpResult> {
  return invoke<HistoryOpResult>("merge", { repoPath, source });
}

export type ResetMode = "soft" | "mixed" | "hard";

/** Reset the current branch to `target` with the given mode. */
export async function reset(
  repoPath: string,
  target: string,
  mode: ResetMode,
): Promise<void> {
  return invoke<void>("reset", { repoPath, target, mode });
}

/** Cherry-pick `commits` (in order) onto the current branch. */
export async function cherryPick(
  repoPath: string,
  commits: string[],
): Promise<void> {
  return invoke<void>("cherry_pick", { repoPath, commits });
}

/** Revert `commit` — create an inverse commit on the current branch. */
export async function revert(repoPath: string, commit: string): Promise<void> {
  return invoke<void>("revert", { repoPath, commit });
}

/**
 * Result of a history-rewriting op's best-effort descendant remap: which
 * other local branches were re-based onto the new commits, and which were
 * left untouched because their replay conflicted (reported to the user by
 * name — never silent).
 */
export interface HistoryOpOutcome {
  remapped: string[];
  skipped: string[];
}

/**
 * A merge/rebase/squash/reword paused mid-flight on a conflict — the app
 * enters a persistent "resolving conflicts" mode (continue/abort control,
 * graph locked, conflicted files surfaced) until every conflicted path is
 * staged and `continueOp` succeeds, or the user `abortOp`s back to the
 * pre-op state. Survives an app restart (probed via `conflictState`).
 */
export interface ResolveState {
  /** Which op is paused: `"merge" | "rebase" | "squash" | "reword"`. */
  op: string;
  /** The branch the op is running on. */
  branch: string;
  /** The commit that was being applied when the conflict hit. */
  sha: string;
}

/**
 * Result of a history-rewriting call: either it ran to completion (with the
 * usual descendant-remap outcome), or it hit a conflict — the caller must
 * enter resolve mode (`ResolveState`) instead of treating this as an error.
 */
export type HistoryOpResult =
  | { status: "completed"; outcome: HistoryOpOutcome }
  | { status: "conflict"; state: ResolveState };

/**
 * Change `sha`'s message (HEAD amend, or rebase-replay for an older commit).
 * Resolves `{status:"conflict", state}` instead of throwing when the replay
 * hits a conflict.
 */
export async function reword(
  repoPath: string,
  sha: string,
  message: string,
): Promise<HistoryOpResult> {
  return invoke<HistoryOpResult>("reword", { repoPath, sha, message });
}

export type RebaseAction = "pick" | "reword" | "squash" | "fixup" | "drop";

export interface RebaseStep {
  /** The commit this step acts on (a sha). */
  commit: string;
  action: RebaseAction;
  /** New message for `reword`/`squash`. */
  message?: string | null;
}

/**
 * Rebase the current branch onto `onto` (replays merge-base..HEAD as picks).
 * Resolves `{status:"conflict", state}` instead of throwing on conflict.
 */
export async function rebaseOnto(
  repoPath: string,
  onto: string,
): Promise<HistoryOpResult> {
  return invoke<HistoryOpResult>("rebase_onto", { repoPath, onto });
}

/**
 * Rebase `branch` onto `onto`, whether or not `branch` is the branch
 * currently checked out. When it isn't, the backend stashes any dirty
 * working tree/index, checks out `branch`, rebases it, checks the original
 * branch back out, and restores the stash — the caller never needs to
 * checkout before/after itself. Resolves `{status:"conflict", state}`
 * instead of throwing on conflict.
 */
export async function rebaseBranch(
  repoPath: string,
  branch: string,
  onto: string,
): Promise<HistoryOpResult> {
  return invoke<HistoryOpResult>("rebase_branch", { repoPath, branch, onto });
}

/**
 * Run an explicit interactive-rebase plan onto `onto` (steps oldest-first).
 * Resolves `{status:"conflict", state}` instead of throwing on conflict.
 */
export async function rebase(
  repoPath: string,
  onto: string,
  steps: RebaseStep[],
): Promise<HistoryOpResult> {
  return invoke<HistoryOpResult>("rebase", { repoPath, onto, steps });
}

/**
 * Drop `sha` from the current branch (replays descendants without it).
 * Resolves `{status:"conflict", state}` instead of throwing on conflict.
 */
export async function dropCommit(
  repoPath: string,
  sha: string,
): Promise<HistoryOpResult> {
  return invoke<HistoryOpResult>("drop_commit", { repoPath, sha });
}

/**
 * Squash a contiguous range of commits on the current branch into one, with
 * `message` as the new combined commit's message. `shas` must be given
 * oldest-first (replays descendants without the collapsed commits).
 * Resolves `{status:"conflict", state}` instead of throwing on conflict.
 */
export async function squashRange(
  repoPath: string,
  shas: string[],
  message: string,
): Promise<HistoryOpResult> {
  return invoke<HistoryOpResult>("squash_range", { repoPath, shas, message });
}

/**
 * Purge `path` from `sha`'s tree and every descendant commit up to the
 * current branch tip ("a secret got committed, erase it from this point
 * on"). A single file path only — a directory path is rejected with a clear
 * error rather than purged recursively.
 */
export async function purgePath(
  repoPath: string,
  sha: string,
  path: string,
): Promise<HistoryOpOutcome> {
  return invoke<HistoryOpOutcome>("purge_path", { repoPath, sha, path });
}

/**
 * Write the working tree's current content of `path` into `sha`'s tree and
 * replay every descendant commit up to the current branch tip on top of the
 * change ("this file's current state should already have existed as of this
 * commit"). A single file path only — mirrors `purgePath`'s scope, just in
 * reverse (adding rather than erasing).
 */
export async function addFileToCommit(
  repoPath: string,
  sha: string,
  path: string,
): Promise<HistoryOpOutcome> {
  return invoke<HistoryOpOutcome>("add_file_to_commit", {
    repoPath,
    sha,
    path,
  });
}

// ── Conflict resolution ────────────────────────────────────
// A merge/rebase/squash/reword that hits a conflict resolves `HistoryOpResult`
// with `status: "conflict"` (see above) instead of rejecting. The app then
// enters resolve mode until these two calls take it back out.

/**
 * Probe whether the repo is mid-conflict-resolution — a merge/rebase/
 * squash/reword left paused on disk (e.g. from a previous app session).
 * Called once on repo load so resolve mode survives an app restart.
 * Resolves `null` when the working tree is clean of any paused op.
 */
export async function conflictState(
  repoPath: string,
): Promise<ResolveState | null> {
  return invoke<ResolveState | null>("conflict_state", { repoPath });
}

/**
 * Continue the paused op — every conflicted path must already be staged.
 * May hit ANOTHER conflict, resolving `{status:"conflict", state}` with a
 * NEW sha (still in resolve mode); otherwise resolves `{status:"completed"}`.
 */
export async function continueOp(repoPath: string): Promise<HistoryOpResult> {
  return invoke<HistoryOpResult>("continue_op", { repoPath });
}

/** Abort the paused op, restoring the pre-op state, and leave resolve mode. */
export async function abortOp(repoPath: string): Promise<void> {
  return invoke<void>("abort_op", { repoPath });
}

/** A pre-operation ref snapshot recorded under `refs/adgitter/backup/`. */
export interface Backup {
  backup_ref: string;
  op: string;
  original_ref: string;
  target: string;
  created_ms: number;
  seq: number;
}

/** Why Undo is not on offer. */
export type UndoBlockedReason = "nothing" | "external_change" | "paused";

/**
 * Whether Undo is on offer, and what it would reverse.
 *
 * Decided entirely in `git-core`, never assembled here: ADGitter can only undo
 * its own changes, and "is this ref still where we left it" has to be answered
 * in one pass over the repository by the same code the action itself obeys.
 */
export interface UndoState {
  available: boolean;
  /** The op Undo would reverse (e.g. `rebase`, `commit`), when available. */
  op: string | null;
  /** Why not, when unavailable. `null` exactly when `available`. */
  reason: UndoBlockedReason | null;
}

/** Ask the backend whether Undo is available right now. */
export async function undoState(repoPath: string): Promise<UndoState> {
  return invoke<UndoState>("undo_state", { repoPath });
}

/** Undo the most recent mutating op (restores ref + working tree). */
export async function undo(repoPath: string): Promise<Backup | null> {
  return invoke<Backup | null>("undo", { repoPath });
}

/**
 * Delete backup refs older than 48h so the ghost commits they were keeping
 * reachable disappear from the graph. Returns the number of backups removed.
 */
export async function expireBackups(repoPath: string): Promise<number> {
  return invoke<number>("expire_backups", { repoPath });
}

// ── Onboarding: probe / init / clone ──────────────────────────────────

export type ProbeKind = "repo" | "empty" | "nonrepo";

export interface ProbeResult {
  kind: ProbeKind;
  path: string;
}

/** Classify a chosen folder so the Welcome flow can route open/init/clone. */
export async function probePath(path: string): Promise<ProbeResult> {
  return invoke<ProbeResult>("probe_path", { path });
}

/** Initialize a new repository at `path`. */
export async function initRepository(path: string): Promise<void> {
  return invoke<void>("init_repository", { path });
}

/** Clone authentication, mirroring the backend's tagged `CloneAuth`. */
export type CloneAuth =
  | { kind: "none" }
  | { kind: "password"; username: string; password: string }
  | { kind: "ssh"; username: string; key_path: string; passphrase?: string };

/** Clone `url` into `dest`. Progress arrives via `onCloneProgress`. */
export async function cloneRepository(
  url: string,
  dest: string,
  auth: CloneAuth = { kind: "none" },
): Promise<void> {
  return invoke<void>("clone_repository", { url, dest, auth });
}

export interface CloneProgress {
  received: number;
  total: number;
}

/** Subscribe to clone transfer progress; returns an unlisten function. */
export async function onCloneProgress(
  cb: (p: CloneProgress) => void,
): Promise<UnlistenFn> {
  // Window-scoped: the backend `emit_to`s this per window so a clone kicked
  // off in one window doesn't spam progress into another.
  return getCurrentWindow().listen<CloneProgress>("clone-progress", (e) =>
    cb(e.payload),
  );
}

// ── Remote sync: fetch / pull / push + ahead-behind ────────────────

export interface AheadBehind {
  ahead: number;
  behind: number;
  /** Upstream shorthand (e.g. "origin/main"), or null when unconfigured. */
  upstream: string | null;
}

/** Ahead/behind of the current branch versus its upstream. */
export async function aheadBehind(repoPath: string): Promise<AheadBehind> {
  return invoke<AheadBehind>("ahead_behind", { repoPath });
}

/** The configured URL of a remote (default "origin"), or null when unset. */
export async function remoteUrl(
  repoPath: string,
  remote = "origin",
): Promise<string | null> {
  return invoke<string | null>("remote_url", { repoPath, remote });
}

/** Fetch a remote (default refspecs). `url`, when set, overrides the network
 *  target (a user-configured Settings URL over the named remote's `.git` URL). */
export async function fetch(
  repoPath: string,
  remote = "origin",
  auth: CloneAuth = { kind: "none" },
  url: string | null = null,
): Promise<void> {
  return invoke<void>("fetch", { repoPath, remote, auth, url });
}

/** Pull = fetch + merge the current branch's upstream. `url` overrides the
 *  fetch target exactly as in {@link fetch}. */
export async function pull(
  repoPath: string,
  remote = "origin",
  auth: CloneAuth = { kind: "none" },
  url: string | null = null,
): Promise<void> {
  return invoke<void>("pull", { repoPath, remote, auth, url });
}

/**
 * Push the current branch to a remote. `force` (advanced, destructive) lets
 * the update overwrite a remote branch whose tip is not an ancestor of the
 * new value — callers must gate it behind explicit user confirmation. `url`,
 * when set, overrides the push target (a user-configured Settings URL over the
 * named remote's `.git` URL).
 */
export async function push(
  repoPath: string,
  remote = "origin",
  auth: CloneAuth = { kind: "none" },
  force = false,
  url: string | null = null,
): Promise<void> {
  return invoke<void>("push", { repoPath, remote, auth, force, url });
}

/** Push only this local branch; ordinary updates reject divergent remote history. */
export async function pushBranch(
  repoPath: string,
  branch: string,
  remote = "origin",
  auth: CloneAuth = { kind: "none" },
  url: string | null = null,
): Promise<void> {
  return invoke<void>("push_branch", { repoPath, branch, remote, auth, url });
}

// ── Telemetry / crash reporting ─────────────────────────────────────────

/** Toggle consent-gated crash reporting; resolves true if a DSN is compiled in. */
export async function initCrashReporting(enabled: boolean): Promise<boolean> {
  return invoke<boolean>("init_crash_reporting", { enabled });
}

/** Forward a scrubbed frontend error to Sentry (consent-gated in the backend). */
export async function reportEvent(
  errorCode: string,
  message: string,
): Promise<void> {
  return invoke<void>("report_event", { errorCode, message });
}

/**
 * DEBUG-ONLY: deliberately panic the backend to verify the crash→Sentry
 * pipeline end to end. The worker-thread panic surfaces here as a rejected
 * promise (`INTERNAL_ERROR`); inert in release builds. Requires consent granted
 * + a compiled-in DSN for the event to actually reach Sentry.
 */
export async function debugTriggerCrash(): Promise<void> {
  return invoke<void>("debug_trigger_crash");
}

// ── Auth / external links ───────────────────────────────────────────────

/** Open an https URL in the user's default system browser (desktop OAuth flow). */
/** Git `user.name` and `user.email` at both scopes; null when unset. */
export interface GitEmailConfig {
  global: string | null;
  globalName: string | null;
  project: string | null;
  projectName: string | null;
}

/** Read the global and (when a repo is open) repo-local Git identity. */
export async function getGitEmail(
  repoPath: string | null,
): Promise<GitEmailConfig> {
  return invoke<GitEmailConfig>("git_email_get", { repoPath });
}

/** Set (or, with null/empty, remove) `user.email` at the given scope. */
export async function setGitEmail(
  scope: "global" | "project",
  repoPath: string | null,
  email: string | null,
): Promise<void> {
  return invoke<void>("git_email_set", { scope, repoPath, email });
}

/** Set (or, with null/empty, remove) `user.name` at the given scope. */
export async function setGitName(
  scope: "global" | "project",
  repoPath: string | null,
  name: string | null,
): Promise<void> {
  return invoke<void>("git_name_set", { scope, repoPath, name });
}

export async function openExternalUrl(url: string): Promise<void> {
  return invoke<void>("open_external_url", { url });
}

/**
 * Open a working-tree file in the OS default application for its type. `path` is
 * repo-relative; the backend refuses anything resolving outside `repoPath`.
 */
export async function openPath(repoPath: string, path: string): Promise<void> {
  return invoke<void>("open_path", { repoPath, path });
}

// ── Project settings (frontend-owned schema) ─────────────────────────────────
// Per-repository project settings (branch colours, issue-branch bindings,
// etc.) live at `<repo>/adgitter.config.json`, a plain file in the working
// tree. The backend only validates shape/size and handles read/write plumbing
// — the frontend owns the JSON schema.

/**
 * Read `<repoPath>/adgitter.config.json`. Resolves to `null` when the file
 * does not exist yet (most repos won't have one — not an error). Rejects on
 * an unreadable file or one over the backend's size cap.
 */
export async function readProjectConfig(
  repoPath: string,
): Promise<string | null> {
  return invoke<string | null>("read_project_config", { repoPath });
}

/**
 * Write `<repoPath>/adgitter.config.json`. `content` must serialize a JSON
 * object (not an array/string/etc.) under the backend's size cap; the backend
 * validates, pretty-prints, and writes atomically (temp file + rename) so a
 * crash mid-write never leaves a truncated file.
 */
export async function writeProjectConfig(
  repoPath: string,
  content: string,
): Promise<void> {
  return invoke<void>("write_project_config", { repoPath, content });
}

/**
 * Copy an unreadable `<repo>/adgitter.config.json` aside before anything can
 * overwrite it, resolving to the backup file's NAME (e.g.
 * `adgitter.config.json.corrupt-1758800000.bak`), or `null` when the repo has
 * no config file at all. Called only on a parse failure — see
 * `loadProjectConfig`. The original file is copied, never moved or repaired.
 */
export async function quarantineProjectConfig(
  repoPath: string,
): Promise<string | null> {
  return invoke<string | null>("quarantine_project_config", { repoPath });
}

// ── Device / seat management ────────────────────────────────────────

/** A registered device for the signed-in account (mirrors backend `DeviceDto`). */
export interface DeviceDto {
  id: string;
  name: string;
  /** Last-seen timestamp (Unix ms); 0 when unknown. */
  lastSeen: number;
  /** True for the device this app instance runs on. */
  current: boolean;
}

/**
 * List the signed-in account's devices. Resolves to an empty array when
 * signed-out or the license service is unreachable (it isn't deployed yet), so
 * the UI can render a friendly empty state without try/catch.
 */
export async function listDevices(): Promise<DeviceDto[]> {
  return invoke<DeviceDto[]>("list_devices");
}

/** Remove (deauthorize) a device by id. Rejects on a network/HTTP failure. */
export async function removeDevice(deviceId: string): Promise<void> {
  return invoke<void>("remove_device", { deviceId });
}

// ── Log Anytime ────────────────────────────────────────────────────────

/** Snapshot the working tree onto `branch`; returns the new sha or null (no-op). */
export async function logCommit(
  repoPath: string,
  branch: string,
): Promise<string | null> {
  return invoke<string | null>("log_commit", { repoPath, branch });
}

// ── Guided tutorial demo repository ──────────────────────────────────
// Backed by `git_core::tutorial_demo`. The backend confines every path to
// `<app data>/tutorial/demo-<ms>/repo`, so these reject for any other repo.

/** Where a freshly created demo repository (and its bare `origin`) lives. */
export interface TutorialDemoRepo {
  repoPath: string;
  remotePath: string;
}

/** Create a fresh demo repo (+ bare `origin`) under the app data dir. */
export async function tutorialDemoCreate(): Promise<TutorialDemoRepo> {
  return invoke<TutorialDemoRepo>("tutorial_demo_create");
}

/** Write the untracked starter files; resolves to their repo-relative paths. */
export async function tutorialDemoSeedFiles(
  repoPath: string,
): Promise<string[]> {
  return invoke<string[]>("tutorial_demo_seed_files", { repoPath });
}

/** Create the demo commits, branches and tags and push them to `origin`. */
export async function tutorialDemoSeedHistory(repoPath: string): Promise<void> {
  return invoke<void>("tutorial_demo_seed_history", { repoPath });
}

/** Write one file inside the demo repo (`path` is repo-relative). */
export async function tutorialDemoWriteFile(
  repoPath: string,
  path: string,
  content: string,
): Promise<void> {
  return invoke<void>("tutorial_demo_write_file", {
    repoPath,
    path,
    content,
  });
}

/** Append `count` simulated Log Anytime snapshots to `branch`; resolves to their shas. */
export async function tutorialDemoSimulateLog(
  repoPath: string,
  branch: string,
  count: number,
): Promise<string[]> {
  return invoke<string[]>("tutorial_demo_simulate_log", {
    repoPath,
    branch,
    count,
  });
}

/** Delete the whole demo directory (repo + `origin.git`). Already gone is fine. */
export async function tutorialDemoRemove(repoPath: string): Promise<void> {
  return invoke<void>("tutorial_demo_remove", { repoPath });
}

// ── Entitlement: signed-license verification ───────────────────────────

export type LicenseStatusValue = "active" | "grace" | "invalid";

/** IPC view of a verified license (mirrors the backend `LicenseStatusDto`). */
export interface LicenseStatusDto {
  status: LicenseStatusValue;
  /** Plan tier when valid ("free" | "basic" | "advance" | "enterprise"). */
  plan: string | null;
  /** Reason when `status === "invalid"`. */
  error: string | null;
  /** License expiry (Unix ms) when valid. */
  expiresMs: number | null;
  /** Server-derived entitlement features when valid (empty for `invalid`). */
  features: string[];
  /** One-time purchased theme ids when valid (empty for `invalid`). */
  ownedThemes: string[];
  /**
   * Account email carried by the license. `null` for an invalid
   * license, and for a token minted before the claim existed.
   *
   * Shown in the account panel, and used as the *default* commit identity —
   * only when git has no `user.email` of its own. Never logged.
   */
  email: string | null;
  /**
   * Display name carried by the license, re-pinned from Clerk at every
   * issue/renew (see `license::License::name`). `null` for an invalid
   * license and for a token minted before the claim existed.
   *
   * PII — shown in the account panel, never logged.
   */
  name: string | null;
  /**
   * Avatar URL carried by the license (see `license::License::avatar_url`).
   * MUST be passed through {@link sanitizeAvatarUrl} before use — a signed
   * license is not itself an exemption from that check.
   *
   * PII — shown in the account panel, never logged.
   */
  avatarUrl: string | null;
  /**
   * Clerk username carried by the license (see `license::License::username`).
   *
   * PII — shown in the account panel, never logged.
   */
  username: string | null;
  /**
   * When this licence's free trial ends or ended (Unix ms), or null/absent
   * when it isn't a trial. Past it, `plan` and `features` are already Free
   * (`license::verify`), so this is only for saying so.
   */
  trialEndsMs?: number | null;
}

/** Where the next commit's author/committer address would come from. */
export type IdentitySource =
  /** `user.email` is configured in git (repo-local or global). */
  | "git"
  /** Git has none; the ADGitter account address stands in. */
  | "account"
  /** Neither — committing will fail until one is set. */
  | "none";

/** What identity the next commit in a repo would carry. */
export interface IdentityStatus {
  source: IdentitySource;
  name: string | null;
  email: string | null;
}

/**
 * Ask which identity the next commit in `repoPath` would be authored with,
 * **without writing anything**.
 *
 * A configured `user.email` always wins; the account address is only a default
 * for repos where git has none. The UI calls this so it can say when
 * the account address is about to be used, rather than substituting silently.
 */
export async function gitIdentityStatus(
  repoPath: string,
): Promise<IdentityStatus> {
  return invoke<IdentityStatus>("git_identity_status", { repoPath });
}

/**
 * Verify a signed license token and resolve the entitlement. With no `token`,
 * the backend reads the persisted one (see {@link storeLicenseToken}). Absent or
 * invalid input resolves to an inert `invalid` status (never throws), so callers
 * can safely default to the free tier.
 *
 * **Entirely offline**: the token is an Ed25519-signed blob checked against the
 * public key baked into the binary. No network, so it is safe on the startup
 * path and works with the machine disconnected.
 *
 * `pinDevice` additionally requires the license to be bound to *this* install.
 * Off by default — entitlement refresh keeps the historical
 * device-agnostic behaviour; session restore turns it on so a license copied
 * from another machine cannot present itself as a signed-in session. Rust
 * resolves the device id itself; there is nothing to pass.
 */
export async function verifyLicense(
  token?: string,
  opts: { pinDevice?: boolean } = {},
): Promise<LicenseStatusDto> {
  return invoke<LicenseStatusDto>("verify_license", {
    token: token ?? null,
    pinDevice: opts.pinDevice ?? false,
  });
}

/**
 * Query whether the current (persisted, verified) license entitles `feature` —
 * a canonical feature string like "NoAd". Delegates to the same `require_feature`
 * guard paid commands use. Resolves `false` when locked; rejects only
 * on an unknown feature string.
 */
export async function checkFeature(feature: string): Promise<boolean> {
  return invoke<boolean>("check_feature", { feature });
}

/** What a local sign-out could **not** destroy. All-false is the normal answer. */
export interface SignOutReport {
  /**
   * A license token is still readable afterwards (a locked/failing keychain, or
   * an unwritable store file). The app is signed out either way, so the UI has
   * to say that paid features may stay unlocked until the next launch rather
   * than quietly present a half sign-out as a clean one.
   */
  tokenRemains: boolean;
}

/**
 * Destroy this machine's credentials: **both** persisted copies of the license
 * token (OS keychain *and* the `license.json` fallback that debug builds also
 * write), plus the account-derived commit-author identity held in `git-core`.
 *
 * This is what makes sign-out mean something. Without it the UI said "signed
 * out" while the token stayed in the keychain — paid features remained
 * unlocked, and, worse, commits kept being authored with the signed-out
 * account's email (permanent, and pushed to every mirror).
 *
 * **No network, ever.** Signing out cannot be blocked by connectivity: the
 * decision (2026-08-18) is that sign-out destroys local credentials online or
 * off, and "cannot sign back in until there is a network" is an accepted
 * consequence of sign-in requiring online verification in the first place. Seat
 * release is therefore not attempted here (and the server has no
 * device-removal endpoint anyway); the seat is reclaimed on the next sign-in
 * from this same device id.
 */
export async function destroyLocalCredentials(): Promise<SignOutReport> {
  return invoke<SignOutReport>("sign_out");
}

/**
 * This install's stable device id, minted and persisted by Rust on
 * first call. Licenses are bound to it and a plan's seats are counted by it, so
 * it is the same value for the life of the install. Rejects (rather than
 * inventing a throwaway id) when it can't be persisted.
 */
export async function getDeviceId(): Promise<string> {
  return invoke<string>("get_device_id");
}

// ── Loopback sign-in redirect (RFC 8252) ────────────────────────────────
//
// Clerk's hosted Account Portal will not redirect to a custom scheme, so
// sign-in comes back over a temporary `http://127.0.0.1:<port>` listener that
// Rust owns. The `adgitter://` scheme is untouched and still carries
// `checkout-complete` and `issue/<id>`.
//
// The redirect lands on `/bridge`, a page the Rust server serves itself: the
// portal's redirect only ever carries `__clerk_db_jwt` (a dev-browser handshake
// token, not a session JWT), so the *page* has to load Clerk JS and call
// `session.getToken()` to get the real thing, then POST it back to
// `/bridge/token`. See `loopback_auth.rs` for the threat model.

/** What Rust hands back when it has started the loopback callback listener. */
export interface LoopbackAuthStart {
  /**
   * Pass verbatim as Clerk's `redirect_url`; already carries `?state=`.
   * `http://127.0.0.1:<port>/bridge?state=<nonce>`.
   */
  redirectUrl: string;
  /** The anti-forgery nonce. Rust enforces it; this copy is for diagnostics. */
  state: string;
  port: number;
}

/** How one loopback sign-in wait ended. */
export interface LoopbackAuthResult {
  /**
   * What the bridge delivered, `state` already stripped and verified: `token`
   * (the Clerk session JWT) on success, or `error` when the portal bounced back
   * or the bridge could not reach a session.
   * **Carries the Clerk session token — never log this object.**
   */
  params: Record<string, string>;
  timedOut: boolean;
  cancelled: boolean;
}

/**
 * Bind a loopback port, mint a `state` nonce and start listening for the
 * sign-in callback. Rejects with `INTERNAL_ERROR` when every candidate port is
 * already taken. Starting a second sign-in cancels the first.
 *
 * `publishableKey` is Clerk's **publishable** key — public by design and
 * already baked into this bundle. Rust needs it to build the bridge page (it
 * decodes the instance's Frontend API host from it, which becomes the page's
 * only allowed script origin), and passing it here avoids a second, divergent
 * env-reading path on the Rust side. Rust re-validates it.
 */
export async function startLoopbackAuth(
  publishableKey: string,
): Promise<LoopbackAuthStart> {
  return invoke<LoopbackAuthStart>("start_loopback_auth", { publishableKey });
}

/**
 * Wait for the browser round-trip. Resolves once the bridge has posted back a
 * session token carrying the matching `state`, or with `timedOut` /
 * `cancelled`. Rejects only when no sign-in is in progress.
 */
export async function awaitLoopbackAuth(): Promise<LoopbackAuthResult> {
  return invoke<LoopbackAuthResult>("await_loopback_auth");
}

/** Abandon the in-flight sign-in and release the loopback port. Idempotent. */
export async function cancelLoopbackAuth(): Promise<void> {
  return invoke<void>("cancel_loopback_auth");
}

/**
 * Exchange a Clerk session JWT for a real signed license from the license server,
 * verify it offline, and persist it. Resolves the verified entitlement
 * DTO; rejects with an {@link AdgitterError} on network/verification failure,
 * and with `DEVICE_SEAT_LIMIT` when the account is already at its plan's
 * concurrent-device cap.
 *
 * `evictOldest` is the user's **explicit** answer to the device-limit prompt.
 * Omit it (the default) and a full account is refused with nothing changed;
 * pass `true` and the server signs the account's oldest device out by
 * `last_seen` and seats this one in its place, in one transaction.
 *
 * Note what is *not* here: a device id to evict. The caller cannot choose a
 * victim — the server picks the oldest from rows it already scopes to this
 * account — so the worst a confirmed request can do is cost the caller its own
 * least-recently-used seat.
 */
export async function issueLicense(
  clerkJwt: string,
  deviceId: string,
  evictOldest = false,
): Promise<LicenseStatusDto> {
  return invoke<LicenseStatusDto>("issue_license", {
    clerkJwt,
    deviceId,
    evictOldest,
  });
}

/**
 * Re-issue the persisted license from the server's current entitlement, verify
 * it offline and persist it — the post-purchase unlock path.
 *
 * Sign-in does not retain the Clerk JWT, so {@link issueLicense} is unavailable
 * after the fact; the stored license (our own signature, device-bound) is the
 * credential instead. Resolves the freshly verified entitlement DTO. Rejects
 * with an {@link AdgitterError}: `NOT_SIGNED_IN` when there is no license to
 * renew, otherwise `INTERNAL_ERROR` (network / rejected).
 *
 * **It is also the device-seat ping.** The server's renew path re-runs the seat
 * check, which bumps this device's `last_seen` — so the background renew the
 * app already fires at startup registers this install and its last-login time
 * without a second round trip or a second scheduler.
 *
 * A renew can therefore reject with `DEVICE_SEAT_LIMIT`: this device's row is
 * gone (evicted elsewhere, or deauthorized from the account panel) and the
 * account is full. Nothing changed server-side, and `evictOldest: true` — the
 * user's answer to the prompt — is the authorized retry. See
 * {@link issueLicense} for why there is no victim parameter.
 */
export async function renewLicense(
  evictOldest = false,
): Promise<LicenseStatusDto> {
  return invoke<LicenseStatusDto>("renew_license", { evictOldest });
}

/**
 * Where this account stands with the free trial on this computer, as the
 * license server sees it.
 */
export interface TrialStatusDto {
  /**
   * `available`: can start now. `active`: running here. `used`: this account,
   * install or computer has had one. `paid`: on a paid plan or a team seat.
   */
  state: "available" | "active" | "used" | "paid";
  /** When the account's own trial ends or ended (Unix ms). */
  endsMs?: number | null;
  /** Trial length, from the server. */
  days: number;
  /** The plan it unlocks, from the server. */
  plan: string;
}

/**
 * The trial status for the signed-in account on this computer. Rejects with
 * `NOT_SIGNED_IN` when there is no licence — a trial needs an account.
 */
export async function trialStatus(): Promise<TrialStatusDto> {
  return invoke<TrialStatusDto>("trial_status");
}

/**
 * Start the free trial; resolves to the stored licence that carries it.
 * A refusal rejects — re-read {@link trialStatus} for why.
 */
export async function startTrial(): Promise<LicenseStatusDto> {
  return invoke<LicenseStatusDto>("start_trial");
}

// ── Clerk portal capabilities (account panel) ───────────────────────────────
//
// The account panel used to derive every "manage on website" link from one
// string-munged guess (`fapi.replace('.clerk.', '.') + '/user'`) and offered
// five sections regardless of what this Clerk instance actually has turned
// on — which is how a signed-in user could click "Two-factor auth" and land
// on a portal page that does not exist (this instance has no factor with
// `used_for_second_factor: true`, and `organization_settings.enabled` is
// false too). This probes Clerk's own public environment for what is real
// before the panel offers it.

/** What the signed-in Clerk instance's hosted Account Portal actually offers. */
export interface ClerkPortalCapabilities {
  /** The portal's own user-profile URL, or null if it couldn't be derived. */
  userProfileUrl: string | null;
  /** The portal's own organization-profile URL, or null. */
  organizationProfileUrl: string | null;
  /** Whether this instance has organizations enabled at all. */
  organizationsEnabled: boolean;
  /** Whether any factor is configured `used_for_second_factor` on this instance. */
  mfaEnabled: boolean;
}

/**
 * Probe Clerk's public environment (via Rust, over `publishableKey`'s
 * Frontend API host) for what the hosted Account Portal actually offers.
 * Rejects on a network failure, an unconfigured/malformed key, or an
 * unreachable instance — there is no offline fallback for this, so callers
 * MUST have their own fallback (the account panel falls back to the
 * string-munged `/user` URL and hides `organization`/`mfa` entirely) rather
 * than leaving the manage list empty while this is pending or has failed.
 */
export async function clerkPortalCapabilities(
  publishableKey: string,
): Promise<ClerkPortalCapabilities> {
  return invoke<ClerkPortalCapabilities>("clerk_portal_capabilities", {
    publishableKey,
  });
}

/**
 * Create a Polar checkout for the signed-in user and return the hosted
 * checkout URL to open in the browser. Auth is the persisted license, read
 * server-side by the Rust command — no token argument here. `kind` selects a
 * subscription plan or a one-time theme; `id` is the tier / theme id. Rejects
 * with an {@link AdgitterError}: `NOT_SIGNED_IN` when there is no license yet
 * (recoverable — see `startCheckout` in `checkoutFlow.ts`, which signs in and
 * retries), otherwise `INTERNAL_ERROR` (Polar not provisioned / network).
 */
export async function createCheckout(
  kind: "plan" | "theme",
  id: string,
): Promise<string> {
  return invoke<string>("create_checkout", { kind, id });
}

/**
 * Mint a Polar **customer-portal** session for the signed-in subscriber and
 * return its hosted URL — where they cancel, change payment method and read
 * invoices.
 *
 * Takes **no arguments on purpose.** Auth is the persisted licence, read
 * server-side, and the customer is derived from that licence's verified
 * `subject` alone. There is no customer id, email or user id to pass, and the
 * server would ignore one if this page sent it.
 *
 * The resolved URL **is a credential** — it embeds a `customer_session_token`
 * that grants billing management for that customer. Hand it straight to
 * {@link openExternalUrl}; never log it, render it, or persist it.
 *
 * Rejects with an {@link AdgitterError}: `NOT_SIGNED_IN` when there is no
 * licence yet or the server rejected the one we have (recoverable — see
 * `startSubscriptionPortal` in `checkoutFlow.ts`, which signs in and retries),
 * `NO_SUBSCRIPTION` when the account has nothing to manage, otherwise
 * `INTERNAL_ERROR`.
 */
export async function createCustomerPortal(): Promise<string> {
  return invoke<string>("create_customer_portal");
}

// ── Remote theme delivery ────
//
// Both commands run in Rust over reqwest rather than `fetch` from this page.
// That is deliberate: the bytes arrive over IPC and reach the DOM as data URIs,
// so no `connect-src`/`img-src` origin has to be opened up in the CSP. Rust
// also sanitises every pack against an SVG allowlist *before* caching it, which
// is what makes MetroGraph's `{@html asset.svg}` injection safe for remote
// content.

/** A catalog row's store preview: swatches, plus one asset for graph themes. */
export interface ThemePreviewDto {
  /** 3–5 hex colours. */
  swatches: string[];
  /** A representative `data:image/svg+xml` asset; `kind: "graph"` only. */
  nodeUrl?: string;
}

/** One purchasable theme as advertised by the public catalog. */
export interface CatalogThemeDto {
  id: string;
  kind: "app" | "graph";
  name: string;
  priceUsd: number;
  /** Deliberately a *subset* — the full pack stays behind the license. */
  preview: ThemePreviewDto;
  checksum: string;
  /**
   * Whether the server deployment has a Polar product mapped for this theme,
   * i.e. whether a checkout for it can actually be created.
   *
   * Optional on the wire: a server (or a cached catalog) from before the field
   * existed simply omits it, and absence must read as "assume sellable" —
   * greying out every Buy button on no evidence is worse than the failure this
   * field prevents.
   */
  purchasable?: boolean;
}

export interface ThemeCatalogDto {
  version: string;
  themes: CatalogThemeDto[];
}

/** A full pack. `pack` is the shape `ThemePack` / `GraphThemePack` already use. */
export interface ThemePackPayloadDto {
  id: string;
  kind: "app" | "graph";
  name: string;
  checksum: string;
  pack: unknown;
}

/**
 * The purchasable theme catalog — public, so browsing works signed out.
 *
 * Served from the local cache inside its 24 h TTL; `forceRefresh` skips the
 * TTL. Never rejects for network reasons: an unreachable server falls back to
 * the last cached catalog, and with no cache at all returns an empty list,
 * which callers read as "offer the built-ins only".
 */
export async function themeCatalog(
  forceRefresh = false,
): Promise<ThemeCatalogDto> {
  return invoke<ThemeCatalogDto>("theme_catalog", { forceRefresh });
}

/** The `code` values {@link themePack} can reject with. */
export type ThemePackErrorCode =
  /** No license on disk yet — recoverable: sign in and retry. */
  | "NOT_SIGNED_IN"
  /** Valid license, but this theme isn't in its `ownedThemes` (HTTP 403). */
  | "THEME_NOT_OWNED"
  /** No such theme (HTTP 404). */
  | "THEME_NOT_FOUND"
  /** Failed the SVG allowlist or its checksum — never cached. */
  | "THEME_REJECTED"
  /** Network/transport failure: the offline case. */
  | "THEME_UNAVAILABLE";

/**
 * A full theme pack, ready for the theme engine.
 *
 * Cache-first: an already-downloaded pack comes back with no network call and
 * no license check, so a theme you own keeps working offline forever. On a
 * cache miss it downloads, verifies the checksum, sanitises, and caches.
 *
 * Rejects with a `{code, message}` error (same shape as {@link AdgitterError},
 * so `isAdgitterError` recognises it) whose `code` is a
 * {@link ThemePackErrorCode} — five distinct conditions rather than one opaque
 * failure, because "you don't own this", "you're offline" and "sign in" each
 * need a different sentence in the UI.
 */
export async function themePack(id: string): Promise<ThemePackPayloadDto> {
  return invoke<ThemePackPayloadDto>("theme_pack", { id });
}

/**
 * DEV-ONLY: mint a signed dev license token with the embedded TEST key. Returns
 * an error (rejected promise) in release builds.
 */
export async function mintTestLicense(
  plan: string,
  validDays: number,
): Promise<string> {
  return invoke<string>("mint_test_license", { plan, validDays });
}

/**
 * DEV-ONLY: mint AND persist a signed test license for `plan`, then return its
 * verified status. Makes the license the active one so both the entitlement
 * store and the native `require_feature` gates see it (paid commands run in
 * dev). Rejects in release builds.
 */
export async function seedDevLicense(plan: string): Promise<LicenseStatusDto> {
  return invoke<LicenseStatusDto>("dev_seed_license", { plan });
}

/**
 * DEV-ONLY: point the native paid-feature gate at `plan` for the rest of this
 * process, so it agrees with the frontend's dev plan override. `null` means "no
 * override — use the real licence".
 *
 * Unlike `seedDevLicense` above, the command behind this **does not exist** in a
 * release build: it and its handler registration are both
 * `#[cfg(debug_assertions)]`, so there is nothing to invoke rather than
 * something that refuses. That is deliberate — this is a live setter for the
 * entitlement gate, and an absent command cannot be called by anything running
 * in the webview. Its only caller (`devPlan.svelte.ts`) independently returns
 * early unless `import.meta.env.DEV`, so a release bundle never reaches here
 * either.
 *
 * It grants capabilities, not a licence: nothing is signed, no identity is
 * supplied, and owned themes are untouched.
 */
export async function setDevPlan(plan: string | null): Promise<void> {
  return invoke<void>("set_dev_plan", { plan });
}

// The license token is persisted in its own plugin-store file. The backend reads
// the same file when `verifyLicense()` is called with no explicit token.
const LICENSE_FILE = "license.json";
const LICENSE_TOKEN_KEY = "token";
let licenseStoreP: Promise<Store> | null = null;
function licenseStore(): Promise<Store> {
  if (!licenseStoreP)
    licenseStoreP = load(LICENSE_FILE, { autoSave: true, defaults: {} });
  return licenseStoreP;
}

/** Persist a license token for later verification (and across restarts). */
export async function storeLicenseToken(token: string): Promise<void> {
  const s = await licenseStore();
  await s.set(LICENSE_TOKEN_KEY, token);
}

/** Read the persisted license token, or null when none is stored. */
export async function loadLicenseToken(): Promise<string | null> {
  const s = await licenseStore();
  return (await s.get<string>(LICENSE_TOKEN_KEY)) ?? null;
}

/** Type-narrow a thrown value to our tagged error shape. */
export function isAdgitterError(e: unknown): e is AdgitterError {
  return typeof e === "object" && e !== null && "code" in e && "message" in e;
}

/** Render a thrown IPC value as a user-facing string. */
export function errorText(e: unknown): string {
  return isAdgitterError(e) ? `${e.code}: ${e.message}` : String(e);
}
