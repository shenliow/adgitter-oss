/**
 * Free-tier git operations surface.
 *
 * This is
 * the single typed entry point for the **free, open-core** git operations that
 * back the graph, working tree, branches/tags, and history gestures. Everything
 * here is implemented by `crates/git-core` and reached over Tauri IPC; the thin
 * `invoke` wrappers live in `../ipc`. Future paid operations live under
 * `lib/pro/` and are gated by entitlement; free code imports from here so
 * the free/paid boundary stays explicit.
 */
export {
  // read
  listCommits,
  listRefs,
  listCommitFiles,
  diffFile,
  diffWorktree,
  // working tree
  repoStatus,
  stagePaths,
  unstagePaths,
  discardPaths,
  createCommit,
  // branches & tags
  createBranch,
  renameBranch,
  deleteBranch,
  checkout,
  createTag,
  deleteTag,
  // history gestures (all free)
  merge,
  reset,
  cherryPick,
  revert,
  reword,
  rebase,
  rebaseOnto,
  dropCommit,
  undo,
  // conflict resolution
  conflictState,
  continueOp,
  abortOp,
} from "../ipc";

export type {
  Commit,
  CommitPage,
  RefKind,
  GitRef,
  HeadInfo,
  RefList,
  FileStatus,
  FileChange,
  WorkStatus,
  StatusEntry,
  RepoStatus,
  FileDiff,
  DiffHunk,
  DiffLine,
  ResetMode,
  RebaseAction,
  RebaseStep,
  Backup,
} from "../ipc";
