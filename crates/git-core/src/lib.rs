//! ADGitter free open-core Git logic (Apache-2.0).
//!
//! Extracted from the Tauri shell so the same read/write libgit2 operations can
//! be reused by the desktop app, a future CLI, or mobile targets, and so free
//! contributors can build the core on its own (open core).
//!
//! This crate is deliberately framework-agnostic: it knows nothing about Tauri
//! or the WebView. The shell layer (`apps/desktop/src-tauri`) maps these types
//! to IPC commands and events.

mod autostash;
pub mod branch;
pub mod diff;
mod error;
mod git;
pub mod git_email;
pub mod history;
pub mod identity;
pub mod inject;
pub mod log_anytime;
pub mod mutate;
pub mod purge;
pub mod rebase;
pub mod remap;
pub mod remote;
pub mod repo;
pub mod resolve;
pub mod tutorial_demo;
pub mod undo;
pub mod workdir;

pub use branch::{
    adopt_remote_upstream_and_checkout, branch_upstream, checkout, checkout_remote_branch,
    create_branch, create_tag, delete_branch, delete_tag, inspect_remote_checkout, rename_branch,
    set_upstream, RemoteCheckoutPlan, SyncPrompt,
};
pub use diff::{diff_file, diff_worktree, DiffHunk, DiffLine, FileDiff};
pub use error::{AdgitterError, AdgitterResult};
pub use git::{
    file_history, list_commit_files, list_commits, list_refs, Commit, CommitPage, FileChange,
    GitRef, HeadInfo, RefList,
};
pub use git_email::{
    read_git_email, write_git_email, write_git_name, GitEmailConfig, GitEmailScope,
};
pub use history::{cherry_pick, merge, reset, revert, reword};
pub use identity::{
    fallback_identity, identity_status, set_fallback_identity, FallbackIdentity, IdentitySource,
    IdentityStatus,
};
pub use inject::add_file_to_commit;
pub use log_anytime::log_commit;
pub use mutate::{
    create_backup, expire_backups, list_backups, lock_mutations, reflog_undo, undo_last, Backup,
};
pub use purge::purge_path;
pub use rebase::{
    drop_commit, rebase, rebase_branch, rebase_onto, squash_range, RebaseAction, RebaseStep,
};
pub use remap::{HistoryOpOutcome, RemapOutcome};
pub use remote::{ahead_behind, fetch, pull, push, push_branch, remote_url, AheadBehind};
pub use repo::{clone_repository, init_repository, probe_path, CloneAuth, ProbeKind, ProbeResult};
pub use resolve::{abort_op, conflict_state, continue_op, HistoryOpResult, ResolveState};
pub use undo::{seal_backup, undo_state, UndoBlockedReason, UndoState};
pub use workdir::{commit, discard, stage, status, unstage, RepoStatus, StatusEntry};
