//! File diffs for the diff viewer.
//!
//! `diff_file` shows a single file's change in a commit (vs. its first parent);
//! `diff_worktree` shows a single file's working-tree change (index + unstaged,
//! vs. HEAD). Both return structured hunks (old/new line ranges + per-line
//! origin) so the frontend can render a side-by-side, syntax-highlighted view
//! without re-parsing a unified-diff string. Read-only — no lock needed.

use std::path::{Path, PathBuf};

use git2::{Delta, DiffFlags, DiffOptions, Oid, Patch, Repository};
use serde::Serialize;

use crate::error::{AdgitterError, AdgitterResult};
use crate::git::open_repo;

/// One line within a hunk. `origin` is libgit2's marker: ' ' context, '+'
/// addition, '-' deletion (also '=','>','<' for EOL-newline edge cases).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DiffLine {
    pub origin: char,
    /// Line number in the old file (None for additions).
    pub old_lineno: Option<u32>,
    /// Line number in the new file (None for deletions).
    pub new_lineno: Option<u32>,
    pub content: String,
}

/// A contiguous block of changes with its `@@ -a,b +c,d @@` ranges.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DiffHunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub header: String,
    pub lines: Vec<DiffLine>,
}

/// A single file's structured diff.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FileDiff {
    pub path: String,
    /// Previous path for a rename, else None.
    pub old_path: Option<String>,
    pub status: String,
    /// True for a binary file — `hunks` is then empty.
    pub binary: bool,
    pub hunks: Vec<DiffHunk>,
}

fn status_str(delta: Delta) -> &'static str {
    match delta {
        Delta::Added => "added",
        Delta::Deleted => "deleted",
        Delta::Renamed => "renamed",
        Delta::Copied => "copied",
        Delta::Typechange => "typechange",
        Delta::Untracked => "untracked",
        Delta::Conflicted => "conflicted",
        _ => "modified",
    }
}

/// Extract every hunk (with its lines) from an already-computed `patch`.
/// Shared by [`build_file_diff`] (diff-derived patches) and
/// [`conflicted_diff`] (a synthesized blob-vs-buffer patch) so both stay in
/// sync with libgit2's hunk/line APIs.
fn hunks_from_patch(patch: &Patch) -> AdgitterResult<Vec<DiffHunk>> {
    let mut hunks = Vec::with_capacity(patch.num_hunks());
    for h in 0..patch.num_hunks() {
        let (hunk, line_count) = patch.hunk(h)?;
        let mut lines = Vec::with_capacity(line_count);
        for l in 0..line_count {
            let dl = patch.line_in_hunk(h, l)?;
            lines.push(DiffLine {
                origin: dl.origin(),
                old_lineno: dl.old_lineno(),
                new_lineno: dl.new_lineno(),
                content: String::from_utf8_lossy(dl.content()).into_owned(),
            });
        }
        hunks.push(DiffHunk {
            old_start: hunk.old_start(),
            old_lines: hunk.old_lines(),
            new_start: hunk.new_start(),
            new_lines: hunk.new_lines(),
            header: String::from_utf8_lossy(hunk.header()).into_owned(),
            lines,
        });
    }
    Ok(hunks)
}

/// Build a [`FileDiff`] from delta `idx` of a computed diff.
fn build_file_diff(diff: &git2::Diff, idx: usize) -> AdgitterResult<FileDiff> {
    let delta = diff
        .get_delta(idx)
        .ok_or_else(|| AdgitterError::Internal("diff delta index out of range".into()))?;
    let path = delta
        .new_file()
        .path()
        .or_else(|| delta.old_file().path())
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    let old_path = match delta.status() {
        Delta::Renamed | Delta::Copied => delta.old_file().path().map(|p| p.display().to_string()),
        _ => None,
    };
    let status = status_str(delta.status()).to_string();

    // Generating the patch realizes binary detection on the delta. libgit2
    // returns `None` for some binary deltas and a hunk-less `Some` for others,
    // so check the BINARY flag too.
    let patch = Patch::from_diff(diff, idx)?;
    let binary = patch.is_none()
        || diff
            .get_delta(idx)
            .map(|d| d.flags().contains(DiffFlags::BINARY))
            .unwrap_or(false);
    if binary {
        return Ok(FileDiff {
            path,
            old_path,
            status,
            binary: true,
            hunks: Vec::new(),
        });
    }
    let patch = patch.expect("non-binary diff has a patch");
    let hunks = hunks_from_patch(&patch)?;

    Ok(FileDiff {
        path,
        old_path,
        status,
        binary: false,
        hunks,
    })
}

/// An empty (unmodified) diff for `path` — returned when nothing changed.
fn unmodified(path: String) -> FileDiff {
    FileDiff {
        path,
        old_path: None,
        status: "unmodified".to_string(),
        binary: false,
        hunks: Vec::new(),
    }
}

fn opts_for(path: &str) -> DiffOptions {
    let mut opts = DiffOptions::new();
    opts.pathspec(path);
    // Diff just this file's text; rename detection isn't meaningful for one path.
    opts.context_lines(3);
    opts
}

/// Diff a single file in commit `sha` against its first parent (the root tree
/// for an initial commit).
pub fn diff_file(repo_path: PathBuf, sha: String, path: String) -> AdgitterResult<FileDiff> {
    let repo: Repository = open_repo(&repo_path)?;
    let commit = repo.find_commit(Oid::from_str(&sha)?)?;
    let tree = commit.tree()?;
    let parent_tree = if commit.parent_count() > 0 {
        Some(commit.parent(0)?.tree()?)
    } else {
        None
    };

    let mut opts = opts_for(&path);
    let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut opts))?;
    if diff.deltas().len() == 0 {
        return Ok(unmodified(path));
    }
    build_file_diff(&diff, 0)
}

/// Diff a single file's working-tree state (staged + unstaged) against HEAD.
pub fn diff_worktree(repo_path: PathBuf, path: String) -> AdgitterResult<FileDiff> {
    let repo = open_repo(&repo_path)?;
    let head_tree = match repo.head() {
        Ok(head) => Some(head.peel_to_tree()?),
        Err(_) => None, // unborn branch — diff against an empty tree
    };

    let mut opts = opts_for(&path);
    opts.include_untracked(true).recurse_untracked_dirs(true);
    let diff = repo.diff_tree_to_workdir_with_index(head_tree.as_ref(), Some(&mut opts))?;
    if diff.deltas().len() == 0 {
        return Ok(unmodified(path));
    }
    let delta_status = diff.get_delta(0).map(|d| d.status());
    // An untracked file appears as a delta, but libgit2 emits no content patch
    // for it in a tree→workdir diff (it isn't in the index or HEAD to diff
    // against), so `build_file_diff` would return zero hunks and the viewer
    // would show a blank. Synthesize an all-added diff from the file's on-disk
    // content instead, so opening a new file shows the new file.
    if delta_status == Some(Delta::Untracked) {
        return added_from_workdir(&repo_path, &path);
    }
    // A path conflicted by a paused merge/rebase has index stages 1/2/3 (no
    // stage 0), so — exactly like the untracked case above — libgit2 reports
    // the delta but emits no content patch for it; `build_file_diff` would
    // return zero hunks and the viewer would show a blank. Synthesize the
    // diff that actually matters here: the working file (which still carries
    // the `<<<<<<<`/`=======`/`>>>>>>>` conflict markers) against "ours".
    if delta_status == Some(Delta::Conflicted) {
        return conflicted_diff(&repo, &repo_path, &path);
    }
    build_file_diff(&diff, 0)
}

/// Build a [`FileDiff`] for a path libgit2 reports as `Delta::Conflicted`
/// (see [`diff_worktree`]). Diffs the on-disk working file — which still has
/// the conflict markers — against the best available "before" side:
///
/// 1. The index's stage-2 ("ours") blob, when one exists.
/// 2. Otherwise HEAD's blob for this path (covers e.g. a delete/modify
///    conflict where our side deleted the file, so stage 2 is absent).
/// 3. Otherwise there is nothing to diff against at all (the path is new to
///    every side involved) — fall back to [`added_from_workdir`]'s all-added
///    rendering of the working file, just relabeled as `"conflicted"`.
fn conflicted_diff(repo: &Repository, repo_path: &Path, path: &str) -> AdgitterResult<FileDiff> {
    let status = "conflicted".to_string();

    let index = repo.index()?;
    let old_blob = index
        .get_path(Path::new(path), 2) // stage 2 = "ours"
        .and_then(|entry| repo.find_blob(entry.id).ok())
        .or_else(|| {
            repo.head()
                .ok()
                .and_then(|head| head.peel_to_tree().ok())
                .and_then(|tree| tree.get_path(Path::new(path)).ok())
                .and_then(|entry| repo.find_blob(entry.id()).ok())
        });

    let old_blob = match old_blob {
        Some(blob) => blob,
        None => {
            let mut diff = added_from_workdir(repo_path, path)?;
            diff.status = status;
            return Ok(diff);
        }
    };

    let new_bytes = std::fs::read(repo_path.join(path))?;
    let mut opts = DiffOptions::new();
    opts.context_lines(3);
    let patch = Patch::from_blob_and_buffer(
        &old_blob,
        Some(Path::new(path)),
        &new_bytes,
        Some(Path::new(path)),
        Some(&mut opts),
    )?;

    // Blob-to-buffer patches run the same binary heuristic as a tree diff —
    // flag it exactly like `build_file_diff`'s binary handling instead of
    // running NUL-laden "content" through the text-hunk machinery.
    if patch.delta().flags().contains(DiffFlags::BINARY) {
        return Ok(FileDiff {
            path: path.to_string(),
            old_path: None,
            status,
            binary: true,
            hunks: Vec::new(),
        });
    }

    let hunks = hunks_from_patch(&patch)?;
    Ok(FileDiff {
        path: path.to_string(),
        old_path: None,
        status,
        binary: false,
        hunks,
    })
}

/// Build an all-added [`FileDiff`] (status `"added"`) from an on-disk file's
/// current content — used for untracked files, which libgit2 reports without a
/// content patch. NUL bytes flag it binary (empty `hunks`), matching
/// [`build_file_diff`]'s binary handling.
fn added_from_workdir(repo_path: &Path, path: &str) -> AdgitterResult<FileDiff> {
    let bytes = std::fs::read(repo_path.join(path))?;
    if bytes.contains(&0) {
        return Ok(FileDiff {
            path: path.to_string(),
            old_path: None,
            status: "added".to_string(),
            binary: true,
            hunks: Vec::new(),
        });
    }
    let text = String::from_utf8_lossy(&bytes);
    let mut lines = Vec::new();
    for (i, line) in text.split_inclusive('\n').enumerate() {
        lines.push(DiffLine {
            origin: '+',
            old_lineno: None,
            new_lineno: Some(i as u32 + 1),
            content: line.to_string(),
        });
    }
    // An empty file has no lines → no hunk (nothing to show).
    let hunks = if lines.is_empty() {
        Vec::new()
    } else {
        let new_lines = lines.len() as u32;
        vec![DiffHunk {
            old_start: 0,
            old_lines: 0,
            new_start: 1,
            new_lines,
            header: format!("@@ -0,0 +1,{new_lines} @@\n"),
            lines,
        }]
    };
    Ok(FileDiff {
        path: path.to_string(),
        old_path: None,
        status: "added".to_string(),
        binary: false,
        hunks,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;

    fn init_repo(dir: &Path) -> git2::Repository {
        let repo = git2::Repository::init(dir).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Tester").unwrap();
        cfg.set_str("user.email", "t@example.com").unwrap();
        repo
    }

    fn commit(dir: &Path, name: &str, content: &str) -> String {
        fs::write(dir.join(name), content).unwrap();
        crate::workdir::stage(dir.to_path_buf(), vec![name.to_string()]).unwrap();
        crate::workdir::commit(dir.to_path_buf(), format!("edit {name}"), false).unwrap()
    }

    #[test]
    fn diff_file_reports_added_lines_for_a_new_file() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        init_repo(p);
        let sha = commit(p, "a.txt", "one\ntwo\n");

        let d = diff_file(p.into(), sha, "a.txt".into()).unwrap();
        assert_eq!(d.status, "added");
        assert!(!d.binary);
        assert_eq!(d.hunks.len(), 1);
        let adds: Vec<_> = d.hunks[0]
            .lines
            .iter()
            .filter(|l| l.origin == '+')
            .collect();
        assert_eq!(adds.len(), 2);
        assert!(adds.iter().all(|l| l.old_lineno.is_none()));
        assert_eq!(adds[0].new_lineno, Some(1));
    }

    #[test]
    fn diff_file_reports_a_modified_line_as_minus_plus() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        init_repo(p);
        commit(p, "a.txt", "one\ntwo\nthree\n");
        let sha = commit(p, "a.txt", "one\nTWO\nthree\n");

        let d = diff_file(p.into(), sha, "a.txt".into()).unwrap();
        assert_eq!(d.status, "modified");
        let minus = d.hunks[0].lines.iter().find(|l| l.origin == '-').unwrap();
        let plus = d.hunks[0].lines.iter().find(|l| l.origin == '+').unwrap();
        assert_eq!(minus.content.trim_end(), "two");
        assert_eq!(plus.content.trim_end(), "TWO");
    }

    #[test]
    fn diff_worktree_reports_unstaged_edits() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        init_repo(p);
        commit(p, "a.txt", "one\ntwo\n");
        // Edit the working tree without staging.
        fs::write(p.join("a.txt"), "one\ntwo\nthree\n").unwrap();

        let d = diff_worktree(p.into(), "a.txt".into()).unwrap();
        assert_eq!(d.status, "modified");
        let adds: Vec<_> = d.hunks[0]
            .lines
            .iter()
            .filter(|l| l.origin == '+')
            .collect();
        assert_eq!(adds.len(), 1);
        assert_eq!(adds[0].content.trim_end(), "three");
    }

    #[test]
    fn diff_worktree_shows_untracked_new_file_as_added_content() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        init_repo(p);
        commit(p, "a.txt", "one\n"); // establish HEAD
                                     // A brand-new, never-staged file.
        fs::write(p.join("new.txt"), "hello\nworld\n").unwrap();

        let d = diff_worktree(p.into(), "new.txt".into()).unwrap();
        assert_eq!(d.status, "added");
        assert!(!d.binary);
        assert_eq!(d.hunks.len(), 1);
        let adds: Vec<_> = d.hunks[0]
            .lines
            .iter()
            .filter(|l| l.origin == '+')
            .collect();
        assert_eq!(adds.len(), 2);
        assert_eq!(adds[0].content.trim_end(), "hello");
        assert_eq!(adds[0].new_lineno, Some(1));
        assert!(adds.iter().all(|l| l.old_lineno.is_none()));
    }

    #[test]
    fn diff_worktree_flags_untracked_binary_file() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        init_repo(p);
        commit(p, "a.txt", "one\n");
        fs::write(p.join("blob.bin"), [0u8, 1, 2, 0, 3]).unwrap();

        let d = diff_worktree(p.into(), "blob.bin".into()).unwrap();
        assert_eq!(d.status, "added");
        assert!(d.binary);
        assert!(d.hunks.is_empty());
    }

    #[test]
    fn diff_file_flags_binary_content() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        init_repo(p);
        // NUL bytes make libgit2 treat the blob as binary.
        fs::write(p.join("b.bin"), [0u8, 1, 2, 0, 3, 4]).unwrap();
        crate::workdir::stage(p.to_path_buf(), vec!["b.bin".to_string()]).unwrap();
        let sha = crate::workdir::commit(p.to_path_buf(), "add bin".into(), false).unwrap();

        let d = diff_file(p.into(), sha, "b.bin".into()).unwrap();
        assert!(d.binary);
        assert!(d.hunks.is_empty());
    }

    /// Reproduces the "conflict diff is blank" bug: merging two branches
    /// that both edit the same line leaves `a.txt` conflicted (stages
    /// 1/2/3, no stage 0). `diff_worktree` must show the real conflict
    /// content — not an empty, "modified"-labeled diff.
    #[test]
    fn diff_worktree_reports_conflict_markers_for_a_conflicted_merge() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "a.txt", "base\n");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();
        crate::branch::create_branch(p.into(), "feature".into(), "HEAD".into()).unwrap();
        crate::branch::checkout(p.into(), "feature".into()).unwrap();
        commit(p, "a.txt", "feature\n");
        crate::branch::checkout(p.into(), main).unwrap();
        commit(p, "a.txt", "main\n");
        // Merging feature into main conflicts on a.txt's single line.
        crate::history::merge(p.into(), "feature".into()).unwrap();
        assert!(
            repo.index().unwrap().has_conflicts(),
            "fixture must actually produce a conflicted index"
        );

        let d = diff_worktree(p.into(), "a.txt".into()).unwrap();
        assert_eq!(d.status, "conflicted");
        assert!(!d.binary, "conflicted text file must not be flagged binary");
        assert!(
            !d.hunks.is_empty(),
            "conflict diff must show the merge markers, not a blank viewer"
        );
    }

    #[test]
    fn diff_file_unmodified_when_path_did_not_change() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        init_repo(p);
        commit(p, "a.txt", "one\n");
        let sha = commit(p, "b.txt", "other\n"); // a.txt unchanged in this commit

        let d = diff_file(p.into(), sha, "a.txt".into()).unwrap();
        assert_eq!(d.status, "unmodified");
        assert!(d.hunks.is_empty());
    }

    /// main deletes a.txt; feature modifies it — a "deleted by us, modified
    /// by them" conflict. There is no stage-2 ("ours") index entry, and HEAD's
    /// tree lacks the path too (main's HEAD is the delete commit), so
    /// `conflicted_diff` must cascade all the way to the all-added fallback
    /// rather than panicking or returning a blank diff.
    #[test]
    fn diff_worktree_falls_back_for_a_delete_modify_conflict() {
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let repo = init_repo(p);
        commit(p, "a.txt", "base\n");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();
        crate::branch::create_branch(p.into(), "feature".into(), "HEAD".into()).unwrap();
        crate::branch::checkout(p.into(), "feature".into()).unwrap();
        commit(p, "a.txt", "feature-edit\n");
        crate::branch::checkout(p.into(), main).unwrap();
        std::fs::remove_file(p.join("a.txt")).unwrap();
        crate::workdir::stage(p.to_path_buf(), vec!["a.txt".to_string()]).unwrap();
        crate::workdir::commit(p.to_path_buf(), "delete a.txt".into(), false).unwrap();
        crate::history::merge(p.into(), "feature".into()).unwrap();
        assert!(repo.index().unwrap().has_conflicts());

        let d = diff_worktree(p.into(), "a.txt".into()).unwrap();
        assert_eq!(d.status, "conflicted");
        assert!(!d.binary);
        assert_eq!(d.hunks.len(), 1);
        assert!(d.hunks[0].lines.iter().all(|l| l.origin == '+'));
    }
}
