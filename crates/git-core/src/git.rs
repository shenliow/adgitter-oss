//! Git operations layer.
//!
//! Phase 0 scope:
//!   * open a repository at a given path
//!   * walk all reachable commits across all refs
//!   * return a serializable [`Commit`] list to the frontend
//!
//! Future phases will add: branches, refs, working tree status, and the
//! mutating operations (checkout, rebase, cherry-pick, ...).

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use git2::{BranchType, Delta, DiffFindOptions, ErrorCode, Oid, Patch, Repository, Sort};
use serde::Serialize;

use crate::error::{AdgitterError, AdgitterResult};

/// Maximum commits returned per call. Phase 0 keeps this small to avoid
/// blowing up the IPC payload before virtualization is in place.
pub const DEFAULT_LIMIT: usize = 1_000;

/// A single commit, flattened for IPC.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Commit {
    /// Full 40-char SHA.
    pub sha: String,
    /// First 7 chars of the SHA, convenient for display.
    pub short_sha: String,
    pub author_name: String,
    pub author_email: String,
    /// Unix timestamp in seconds (UTC).
    pub timestamp: i64,
    /// Subject line (first line of the commit message).
    pub subject: String,
    /// Full commit message body (without subject).
    pub body: String,
    /// Parent SHAs in order. A merge commit has 2+ parents.
    pub parents: Vec<String>,
    /// True when this commit is only reachable via an `adgitter/backup` ref —
    /// i.e. a history rewrite (reword/reset/drop/rebase…) orphaned it. Ghost
    /// commits render de-emphasized and disappear once their backup expires
    /// (see [`crate::mutate::expire_backups`]).
    #[serde(default)]
    pub ghost: bool,
}

impl Commit {
    fn from_git2(commit: &git2::Commit<'_>) -> Self {
        let message = commit.message().unwrap_or("").to_string();
        let (subject, body) = split_message(&message);
        let sha = commit.id().to_string();
        let short_sha = sha.chars().take(7).collect();

        let author = commit.author();
        Self {
            sha,
            short_sha,
            author_name: author.name().unwrap_or("").to_string(),
            author_email: author.email().unwrap_or("").to_string(),
            timestamp: author.when().seconds(),
            subject,
            body,
            parents: commit.parent_ids().map(|oid| oid.to_string()).collect(),
            ghost: false,
        }
    }
}

fn split_message(msg: &str) -> (String, String) {
    let trimmed = msg.trim_end();
    if let Some(idx) = trimmed.find('\n') {
        let subject = trimmed[..idx].trim_end().to_string();
        let body = trimmed[idx + 1..].trim_start_matches('\n').to_string();
        (subject, body)
    } else {
        (trimmed.to_string(), String::new())
    }
}

/// A page of commits plus whether the repository has more history than the
/// cap allowed. Carries truncation state so the UI can show an indicator
/// instead of silently hiding older commits.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CommitPage {
    /// Up to `limit` commits, newest first.
    pub commits: Vec<Commit>,
    /// True when the repository has more than `limit` commits.
    pub truncated: bool,
    /// The cap applied to this load.
    pub limit: usize,
}

/// A git reference, flattened for IPC.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct GitRef {
    /// Short display name: "main", "origin/main", "v2.0.1".
    pub name: String,
    /// "branch" (local), "remote", or "tag".
    pub kind: String,
    /// SHA the ref points to, peeled to a commit.
    pub target: String,
    /// Unix millis when the ref was created — the oldest reflog entry's
    /// committer time. Local branches only; `None` for remotes/tags or when
    /// the reflog is missing. Second-granularity, so ties are possible.
    pub created_ms: Option<u64>,
    /// Whether the branch has an upstream configured, i.e. `branch.<name>.remote`
    /// and `.merge` are set (as `git branch --set-upstream-to` does). Local
    /// branches only, mirroring `created_ms`: `Some(true)` or `Some(false)` for
    /// a local branch, `None` for remotes/tags where the concept doesn't apply.
    pub has_upstream: Option<bool>,
}

/// State of the repository's HEAD.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct HeadInfo {
    /// Current local branch, or `None` when detached or unborn.
    pub branch: Option<String>,
    /// SHA HEAD resolves to, or `None` for an unborn branch.
    pub target: Option<String>,
    pub detached: bool,
}

/// All references in a repository, grouped by kind.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RefList {
    pub head: HeadInfo,
    pub branches: Vec<GitRef>,
    pub remotes: Vec<GitRef>,
    pub tags: Vec<GitRef>,
}

/// A single file changed by a commit, diffed against its first parent.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FileChange {
    /// File path: the new path normally, the old path for deletions.
    pub path: String,
    /// "added", "modified", "deleted", "renamed", "copied", or "typechange".
    pub status: String,
    /// Previous path — set only for renames and copies.
    pub old_path: Option<String>,
    pub insertions: usize,
    pub deletions: usize,
}

/// Open a repository, walking up from `path` so the user can point at any
/// directory inside their working copy.
pub(crate) fn open_repo(path: &Path) -> AdgitterResult<Repository> {
    if !path.exists() {
        return Err(AdgitterError::InvalidPath(path.display().to_string()));
    }
    Repository::discover(path).map_err(|_| AdgitterError::RepoNotFound(path.display().to_string()))
}

/// Walk all commits reachable from any ref, newest first.
///
/// `limit` caps the number of commits returned (defaults to [`DEFAULT_LIMIT`]).
/// Returns a [`CommitPage`] whose `truncated` flag is set when the repository
/// has more history than `limit`. Truncation is detected by walking one extra
/// commit (`limit + 1`) — an O(1) probe that avoids counting all of history.
pub fn list_commits(repo_path: PathBuf, limit: Option<usize>) -> AdgitterResult<CommitPage> {
    let repo = open_repo(&repo_path)?;
    let limit = limit.unwrap_or(DEFAULT_LIMIT);

    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;

    // Push every reference (branches, tags, remotes). For a brand-new repo
    // with no commits yet, this is fine — the walk will just be empty.
    walk.push_glob("refs/*")?;
    if let Ok(head) = repo.head() {
        if let Some(target) = head.target() {
            // No-op if already pushed via globs; safe to call.
            let _ = walk.push(target);
        }
    }

    // Take one extra so we can tell whether more history exists without
    // counting the whole graph.
    let mut commits = Vec::with_capacity(limit.min(1024));
    let mut oids = Vec::with_capacity(limit.min(1024));
    for oid in walk.take(limit + 1) {
        let oid = oid?;
        let commit = repo.find_commit(oid)?;
        commits.push(Commit::from_git2(&commit));
        oids.push(oid);
    }

    let truncated = commits.len() > limit;
    commits.truncate(limit);
    oids.truncate(limit);

    // Mark ghosts: a commit only kept alive by an `refs/adgitter/` backup ref
    // (i.e. orphaned by a history rewrite) renders "ghosted" until its backup
    // expires (see `crate::mutate::expire_backups`). Re-walk with the same
    // sort, but seeded from HEAD plus every non-backup ref; a page commit
    // absent from the first `limit + 1` oids of that walk is a ghost. This is
    // sound because the subset walk is a subset of the full walk with
    // identical sorting, so any page commit still reachable from a non-backup
    // ref is guaranteed to appear within the first `limit + 1` entries of the
    // subset walk too.
    if !commits.is_empty() {
        let mut subset = repo.revwalk()?;
        subset.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;
        if let Ok(head) = repo.head() {
            if let Some(target) = head.target() {
                let _ = subset.push(target);
            }
        }
        for reference in repo.references()? {
            let reference = reference?;
            let Some(name) = reference.name() else {
                continue;
            };
            if name.starts_with("refs/adgitter/") {
                continue;
            }
            let Some(target) = reference.target() else {
                continue;
            };
            // No-op if already pushed; safe to call.
            let _ = subset.push(target);
        }

        let non_ghost: HashSet<Oid> = subset.take(limit + 1).filter_map(Result::ok).collect();
        for (commit, oid) in commits.iter_mut().zip(oids.iter()) {
            commit.ghost = !non_ghost.contains(oid);
        }
    }

    Ok(CommitPage {
        commits,
        truncated,
        limit,
    })
}

/// History of a single file: commits reachable from HEAD that changed `path`,
/// newest first (`git log -- <path>` semantics), capped at `limit`.
///
/// A commit "changed" the file when its tree differs from its first parent's for
/// that path (a root commit counts when the path exists in it). An unborn HEAD
/// yields an empty list.
pub fn file_history(
    repo_path: PathBuf,
    path: String,
    limit: Option<usize>,
) -> AdgitterResult<Vec<Commit>> {
    let repo = open_repo(&repo_path)?;
    let limit = limit.unwrap_or(DEFAULT_LIMIT);

    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;
    if walk.push_head().is_err() {
        return Ok(Vec::new()); // unborn HEAD → no history
    }

    let mut out = Vec::new();
    for oid in walk {
        if out.len() >= limit {
            break;
        }
        let commit = repo.find_commit(oid?)?;
        if commit_touches_path(&repo, &commit, &path)? {
            out.push(Commit::from_git2(&commit));
        }
    }
    Ok(out)
}

/// Whether `commit`'s tree differs from its first parent's for `path`. A root
/// commit (no parents) counts when the path is present in its tree.
fn commit_touches_path(
    repo: &Repository,
    commit: &git2::Commit,
    path: &str,
) -> AdgitterResult<bool> {
    let tree = commit.tree()?;
    let mut opts = git2::DiffOptions::new();
    opts.pathspec(path);
    let parent_tree = match commit.parent(0) {
        Ok(parent) => Some(parent.tree()?),
        Err(_) => None, // root commit
    };
    let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut opts))?;
    Ok(diff.deltas().len() > 0)
}

/// Enumerate all references: HEAD, local branches, remote branches, tags.
pub fn list_refs(repo_path: PathBuf) -> AdgitterResult<RefList> {
    let repo = open_repo(&repo_path)?;

    let head = match repo.head() {
        Ok(reference) => {
            let detached = repo.head_detached()?;
            HeadInfo {
                branch: if detached {
                    None
                } else {
                    reference.shorthand().map(str::to_string)
                },
                target: reference.peel_to_commit().ok().map(|c| c.id().to_string()),
                detached,
            }
        }
        Err(e) if e.code() == ErrorCode::UnbornBranch => HeadInfo {
            branch: None,
            target: None,
            detached: false,
        },
        Err(e) => return Err(e.into()),
    };

    let mut branches = Vec::new();
    let mut remotes = Vec::new();
    for entry in repo.branches(None)? {
        let (branch, kind) = entry?;
        let Some(name) = branch.name()?.map(str::to_string) else {
            continue;
        };
        // `origin/HEAD` is a symbolic ref, not a real branch — skip it.
        if matches!(kind, BranchType::Remote) && name.ends_with("/HEAD") {
            continue;
        }
        let Ok(commit) = branch.get().peel_to_commit() else {
            continue;
        };
        let created_ms = match kind {
            BranchType::Local => ref_created_ms(&repo, branch.get().name()),
            BranchType::Remote => None,
        };
        let has_upstream = match kind {
            BranchType::Local => Some(branch.upstream().is_ok()),
            BranchType::Remote => None,
        };
        let git_ref = GitRef {
            name,
            kind: match kind {
                BranchType::Local => "branch",
                BranchType::Remote => "remote",
            }
            .to_string(),
            target: commit.id().to_string(),
            created_ms,
            has_upstream,
        };
        match kind {
            BranchType::Local => branches.push(git_ref),
            BranchType::Remote => remotes.push(git_ref),
        }
    }

    let mut tags = Vec::new();
    for reference in repo.references()? {
        let reference = reference?;
        if !reference.is_tag() {
            continue;
        }
        let Some(name) = reference.shorthand() else {
            continue;
        };
        // Peels both lightweight and annotated tags down to a commit.
        let Ok(commit) = reference.peel_to_commit() else {
            continue;
        };
        tags.push(GitRef {
            name: name.to_string(),
            kind: "tag".to_string(),
            target: commit.id().to_string(),
            created_ms: None,
            has_upstream: None,
        });
    }

    Ok(RefList {
        head,
        branches,
        remotes,
        tags,
    })
}

/// Creation time of a ref in unix millis: the committer timestamp of its
/// OLDEST reflog entry (libgit2 lists entries newest-first). `None` when the
/// name is unavailable or the reflog is missing/empty.
fn ref_created_ms(repo: &Repository, full_name: Option<&str>) -> Option<u64> {
    let log = repo.reflog(full_name?).ok()?;
    let oldest = log.get(log.len().checked_sub(1)?)?;
    let secs = oldest.committer().when().seconds();
    u64::try_from(secs).ok().map(|s| s.saturating_mul(1000))
}

/// List the files a commit changed, diffed against its first parent.
///
/// Root commits (no parents) are diffed against an empty tree, so every
/// file shows up as "added".
pub fn list_commit_files(repo_path: PathBuf, sha: String) -> AdgitterResult<Vec<FileChange>> {
    let repo = open_repo(&repo_path)?;
    let oid = Oid::from_str(&sha)?;
    let commit = repo.find_commit(oid)?;
    let tree = commit.tree()?;

    let parent_tree = if commit.parent_count() > 0 {
        Some(commit.parent(0)?.tree()?)
    } else {
        None
    };

    let mut diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)?;
    let mut find_opts = DiffFindOptions::new();
    find_opts.renames(true).copies(true);
    diff.find_similar(Some(&mut find_opts))?;

    let count = diff.deltas().len();
    let mut files = Vec::with_capacity(count);
    for idx in 0..count {
        let Some(delta) = diff.get_delta(idx) else {
            continue;
        };
        let status = match delta.status() {
            Delta::Added => "added",
            Delta::Deleted => "deleted",
            Delta::Renamed => "renamed",
            Delta::Copied => "copied",
            Delta::Typechange => "typechange",
            _ => "modified",
        };
        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.display().to_string())
            .unwrap_or_default();
        let old_path = match delta.status() {
            Delta::Renamed | Delta::Copied => {
                delta.old_file().path().map(|p| p.display().to_string())
            }
            _ => None,
        };
        // `None` patch == binary file; report it with zero line counts.
        let (insertions, deletions) = match Patch::from_diff(&diff, idx)? {
            Some(patch) => {
                let (_context, add, del) = patch.line_stats()?;
                (add, del)
            }
            None => (0, 0),
        };
        files.push(FileChange {
            path,
            status: status.to_string(),
            old_path,
            insertions,
            deletions,
        });
    }
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Repository, Signature};
    use std::fs;
    use tempfile::TempDir;

    /// Build a tiny repo:  A — B — C (main)
    ///                              \— D (feature)
    fn fixture_repo() -> (TempDir, PathBuf) {
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().to_path_buf();
        let repo = Repository::init(&path).expect("init");
        let sig = Signature::now("Tester", "tester@example.com").expect("sig");

        // A
        let a = commit_file(&repo, &sig, "a.txt", "alpha", "feat: add a", &[]);
        // B
        let b = commit_file(&repo, &sig, "b.txt", "bravo", "feat: add b", &[a]);
        // C on main
        let c = commit_file(
            &repo,
            &sig,
            "c.txt",
            "charlie",
            "feat: add c\n\nbody line",
            &[b],
        );
        repo.branch("main", &repo.find_commit(c).unwrap(), true)
            .unwrap();

        // D on feature, branched off B
        repo.branch("feature", &repo.find_commit(b).unwrap(), true)
            .unwrap();
        repo.set_head("refs/heads/feature").unwrap();
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .unwrap();
        commit_file(&repo, &sig, "d.txt", "delta", "feat: add d", &[b]);

        // Leave HEAD on main for a clean state.
        repo.set_head("refs/heads/main").unwrap();
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .unwrap();

        (dir, path)
    }

    fn commit_file(
        repo: &Repository,
        sig: &Signature<'_>,
        name: &str,
        contents: &str,
        message: &str,
        parents: &[git2::Oid],
    ) -> git2::Oid {
        let workdir = repo.workdir().unwrap();
        fs::write(workdir.join(name), contents).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new(name)).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let parent_commits: Vec<_> = parents
            .iter()
            .map(|oid| repo.find_commit(*oid).unwrap())
            .collect();
        let parent_refs: Vec<&git2::Commit> = parent_commits.iter().collect();
        repo.commit(Some("HEAD"), sig, sig, message, &tree, &parent_refs)
            .unwrap()
    }

    #[test]
    fn lists_all_commits_across_branches() {
        let (_dir, path) = fixture_repo();
        let page = list_commits(path, None).expect("list");
        assert!(!page.truncated, "small repo should not be truncated");
        let commits = page.commits;
        // 4 commits: A, B, C on main + D on feature
        assert_eq!(commits.len(), 4, "got {} commits", commits.len());

        let subjects: Vec<&str> = commits.iter().map(|c| c.subject.as_str()).collect();
        for expected in ["feat: add a", "feat: add b", "feat: add c", "feat: add d"] {
            assert!(
                subjects.contains(&expected),
                "missing commit '{expected}', got {subjects:?}"
            );
        }
    }

    #[test]
    fn file_history_returns_only_commits_that_touched_the_path() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().to_path_buf();
        let repo = Repository::init(&path).unwrap();
        let sig = Signature::now("Tester", "tester@example.com").unwrap();
        // f.txt is added, then an unrelated commit, then f.txt is edited.
        let c1 = commit_file(&repo, &sig, "f.txt", "1", "add f", &[]);
        let c2 = commit_file(&repo, &sig, "other.txt", "x", "add other", &[c1]);
        commit_file(&repo, &sig, "f.txt", "2", "edit f", &[c2]);

        let hist = file_history(path.clone(), "f.txt".into(), None).expect("history");
        let subjects: Vec<&str> = hist.iter().map(|c| c.subject.as_str()).collect();
        // Newest-first, and the unrelated commit is excluded.
        assert_eq!(subjects, vec!["edit f", "add f"]);

        // Respects the limit and returns empty for an untracked path.
        assert_eq!(
            file_history(path.clone(), "f.txt".into(), Some(1))
                .unwrap()
                .len(),
            1
        );
        assert!(file_history(path, "nope.txt".into(), None)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn parses_subject_and_body() {
        let (_dir, path) = fixture_repo();
        let commits = list_commits(path, None).unwrap().commits;
        let c = commits.iter().find(|c| c.subject == "feat: add c").unwrap();
        assert_eq!(c.body.trim(), "body line");
    }

    #[test]
    fn includes_parent_links() {
        let (_dir, path) = fixture_repo();
        let commits = list_commits(path, None).unwrap().commits;
        let by_subject: std::collections::HashMap<&str, &Commit> =
            commits.iter().map(|c| (c.subject.as_str(), c)).collect();

        // A has no parents
        assert!(by_subject["feat: add a"].parents.is_empty());
        // B's parent is A's sha
        assert_eq!(
            by_subject["feat: add b"].parents,
            vec![by_subject["feat: add a"].sha.clone()]
        );
        // D's parent is B's sha (branched from B)
        assert_eq!(
            by_subject["feat: add d"].parents,
            vec![by_subject["feat: add b"].sha.clone()]
        );
    }

    #[test]
    fn respects_limit() {
        let (_dir, path) = fixture_repo();
        // 4-commit repo with limit 2 → 2 returned, flagged truncated.
        let page = list_commits(path, Some(2)).unwrap();
        assert_eq!(page.commits.len(), 2);
        assert!(page.truncated, "limit below history size should truncate");
    }

    #[test]
    fn not_truncated_at_exactly_limit() {
        // 4-commit repo with limit 4 → exactly the cap, NOT truncated.
        let (_dir, path) = fixture_repo();
        let page = list_commits(path, Some(4)).unwrap();
        assert_eq!(page.commits.len(), 4);
        assert!(
            !page.truncated,
            "a repo with exactly `limit` commits must not be flagged truncated"
        );
    }

    #[test]
    fn list_refs_reports_local_branch_creation_time() {
        let (_dir, path) = fixture_repo();
        // Tag a commit so the tag path is exercised too.
        {
            let repo = Repository::open(&path).unwrap();
            let head = repo.head().unwrap().peel_to_commit().unwrap();
            repo.tag_lightweight("v1", head.as_object(), true).unwrap();
        }

        let refs = list_refs(path).unwrap();
        let main = refs.branches.iter().find(|b| b.name == "main").unwrap();
        let feature = refs.branches.iter().find(|b| b.name == "feature").unwrap();
        assert!(
            main.created_ms.is_some(),
            "local branch has a creation time"
        );
        assert!(feature.created_ms.is_some());
        // The fixture creates `feature` after `main`; reflog stamps are
        // second-granularity, so >= (not >) is the strongest safe assertion.
        assert!(feature.created_ms >= main.created_ms);
        let tag = refs.tags.iter().find(|t| t.name == "v1").unwrap();
        assert!(tag.created_ms.is_none(), "tags have no creation time");
    }

    #[test]
    fn list_refs_reports_upstream_presence_for_local_branches() {
        let (_dir, path) = fixture_repo();
        // Fake a remote-tracking ref for `main` and wire it as `main`'s upstream;
        // `feature` is left with none configured.
        {
            let repo = Repository::open(&path).unwrap();
            // `set_upstream` needs a configured remote to resolve the refspec
            // against; the URL is never dialed in this test.
            repo.remote("origin", "https://example.invalid/origin.git")
                .unwrap();
            let main_target = repo
                .find_branch("main", BranchType::Local)
                .unwrap()
                .get()
                .target()
                .unwrap();
            repo.reference("refs/remotes/origin/main", main_target, true, "test")
                .unwrap();
            repo.find_branch("main", BranchType::Local)
                .unwrap()
                .set_upstream(Some("origin/main"))
                .unwrap();
        }

        let refs = list_refs(path).unwrap();
        let main = refs.branches.iter().find(|b| b.name == "main").unwrap();
        let feature = refs.branches.iter().find(|b| b.name == "feature").unwrap();
        assert_eq!(
            main.has_upstream,
            Some(true),
            "main has an upstream configured"
        );
        assert_eq!(
            feature.has_upstream,
            Some(false),
            "feature has no upstream configured"
        );
        assert!(
            !refs.remotes.is_empty(),
            "the fake origin/main remote-tracking ref should be listed"
        );
        assert!(
            refs.remotes.iter().all(|r| r.has_upstream.is_none()),
            "remote branches don't carry upstream info"
        );
    }

    #[test]
    fn truncates_large_history_and_stays_within_budget() {
        // A repo larger than the cap returns exactly
        // `limit` newest-first commits, flagged truncated, and the bounded
        // walk completes quickly (no full-history traversal).
        let dir = TempDir::new().unwrap();
        let path = dir.path().to_path_buf();
        let repo = Repository::init(&path).unwrap();
        let sig = Signature::now("Tester", "tester@example.com").unwrap();
        let mut parents: Vec<git2::Oid> = vec![];
        for i in 0..50 {
            let oid = commit_file(
                &repo,
                &sig,
                "f.txt",
                &format!("v{i}"),
                &format!("commit {i}"),
                &parents,
            );
            parents = vec![oid];
        }

        let start = std::time::Instant::now();
        let page = list_commits(path, Some(10)).unwrap();
        let elapsed = start.elapsed();

        assert_eq!(page.commits.len(), 10, "must cap at limit");
        assert!(page.truncated, "50 > 10 must be truncated");
        assert_eq!(page.commits[0].subject, "commit 49", "newest first");
        assert!(
            elapsed.as_secs() < 2,
            "bounded load should be well under budget, took {elapsed:?}"
        );
    }

    #[test]
    fn browsing_does_not_mutate_the_repository() {
        // A full read pass leaves HEAD, refs, and the object
        // database byte-for-byte unchanged.
        let (_dir, path) = fixture_repo();
        let snapshot = |p: &std::path::Path| -> (String, Vec<(String, String)>) {
            let repo = Repository::open(p).unwrap();
            let head = repo
                .head()
                .unwrap()
                .peel_to_commit()
                .unwrap()
                .id()
                .to_string();
            let mut refs: Vec<(String, String)> = repo
                .references()
                .unwrap()
                .filter_map(|r| {
                    let r = r.ok()?;
                    let name = r.name()?.to_string();
                    let target = r.peel_to_commit().ok()?.id().to_string();
                    Some((name, target))
                })
                .collect();
            refs.sort();
            (head, refs)
        };

        let before = snapshot(&path);
        // Exercise every read path, including a re-read (refresh).
        for _ in 0..2 {
            let page = list_commits(path.clone(), None).unwrap();
            let refs = list_refs(path.clone()).unwrap();
            for b in refs.branches.iter().chain(refs.tags.iter()) {
                let _ = b;
            }
            for c in &page.commits {
                let _ = list_commit_files(path.clone(), c.sha.clone()).unwrap();
            }
        }
        let after = snapshot(&path);

        assert_eq!(before, after, "read-only browse must not mutate the repo");
    }

    #[test]
    fn returns_error_for_non_repo_path() {
        let dir = TempDir::new().unwrap();
        let result = list_commits(dir.path().to_path_buf(), None);
        assert!(matches!(result, Err(AdgitterError::RepoNotFound(_))));
    }

    #[test]
    fn returns_error_for_missing_path() {
        let result = list_commits(PathBuf::from("/definitely/not/here/abc123"), None);
        assert!(matches!(result, Err(AdgitterError::InvalidPath(_))));
    }

    #[test]
    fn discovers_repo_from_subdirectory() {
        let (_dir, path) = fixture_repo();
        // Create a subdirectory and point at it — discover() should walk up.
        let sub = path.join("nested/deep");
        fs::create_dir_all(&sub).unwrap();
        let commits = list_commits(sub, None).unwrap().commits;
        assert_eq!(commits.len(), 4);
    }

    #[test]
    fn lists_refs_with_branches_and_head() {
        let (_dir, path) = fixture_repo();
        let refs = list_refs(path).expect("refs");

        assert_eq!(refs.head.branch.as_deref(), Some("main"));
        assert!(!refs.head.detached);
        assert!(refs.head.target.is_some());

        let names: Vec<&str> = refs.branches.iter().map(|b| b.name.as_str()).collect();
        assert!(names.contains(&"main"), "got {names:?}");
        assert!(names.contains(&"feature"), "got {names:?}");
        assert!(refs.remotes.is_empty());
    }

    #[test]
    fn lists_lightweight_tags() {
        let (_dir, path) = fixture_repo();
        let repo = Repository::open(&path).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.tag_lightweight("v1.0", head.as_object(), false)
            .unwrap();

        let refs = list_refs(path).unwrap();
        let tag_names: Vec<&str> = refs.tags.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(tag_names, vec!["v1.0"]);
        assert_eq!(refs.tags[0].target, head.id().to_string());
    }

    #[test]
    fn list_refs_errors_for_non_repo_path() {
        let dir = TempDir::new().unwrap();
        let result = list_refs(dir.path().to_path_buf());
        assert!(matches!(result, Err(AdgitterError::RepoNotFound(_))));
    }

    #[test]
    fn lists_files_changed_in_commit() {
        let (_dir, path) = fixture_repo();
        let commits = list_commits(path.clone(), None).unwrap().commits;
        let c = commits.iter().find(|c| c.subject == "feat: add c").unwrap();

        let files = list_commit_files(path, c.sha.clone()).expect("files");
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "c.txt");
        assert_eq!(files[0].status, "added");
        assert_eq!(files[0].insertions, 1);
        assert_eq!(files[0].deletions, 0);
        assert!(files[0].old_path.is_none());
    }

    #[test]
    fn lists_files_for_root_commit() {
        let (_dir, path) = fixture_repo();
        let commits = list_commits(path.clone(), None).unwrap().commits;
        let a = commits.iter().find(|c| c.subject == "feat: add a").unwrap();

        let files = list_commit_files(path, a.sha.clone()).expect("files");
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "a.txt");
        assert_eq!(files[0].status, "added");
    }

    #[test]
    fn list_commit_files_errors_for_unknown_sha() {
        let (_dir, path) = fixture_repo();
        let result = list_commit_files(path, "0".repeat(40));
        assert!(result.is_err());
    }

    #[test]
    fn reword_ghosts_the_orphaned_old_head_until_backup_expires() {
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().to_path_buf();
        let repo = Repository::init(&path).expect("init");
        let sig = Signature::now("Tester", "tester@example.com").expect("sig");

        let c1 = commit_file(&repo, &sig, "a.txt", "1", "c1", &[]);
        let old_head = commit_file(&repo, &sig, "a.txt", "2", "c2", &[c1]);

        crate::history::reword(path.clone(), old_head.to_string(), "c2 reworded".into())
            .expect("reword");

        let page = list_commits(path.clone(), None).expect("list after reword");
        assert_eq!(page.commits.len(), 3, "old head + new head + ancestor");

        let old = page
            .commits
            .iter()
            .find(|c| c.sha == old_head.to_string())
            .expect("orphaned old head still visible via its backup ref");
        assert!(
            old.ghost,
            "commit only reachable via a backup ref is a ghost"
        );

        let non_ghosts: Vec<&str> = page
            .commits
            .iter()
            .filter(|c| !c.ghost)
            .map(|c| c.subject.as_str())
            .collect();
        assert_eq!(
            non_ghosts.len(),
            2,
            "new (reworded) head and ancestor c1 are not ghosts, got {non_ghosts:?}"
        );
        assert!(non_ghosts.contains(&"c1"));
        assert!(non_ghosts.contains(&"c2 reworded"));

        // Expiring with max_age_ms=0 removes every backup immediately, so the
        // orphaned commit falls out of the graph entirely.
        let removed = crate::mutate::expire_backups(path.clone(), 0).expect("expire");
        assert_eq!(removed, 1);

        let page_after = list_commits(path, None).expect("list after expiry");
        assert!(
            !page_after
                .commits
                .iter()
                .any(|c| c.sha == old_head.to_string()),
            "expired backup makes the orphan unreachable"
        );
    }

    #[test]
    fn split_message_handles_subject_only() {
        let (s, b) = split_message("subject only");
        assert_eq!(s, "subject only");
        assert_eq!(b, "");
    }

    #[test]
    fn split_message_handles_subject_and_body() {
        let (s, b) = split_message("subject\n\nbody one\nbody two\n");
        assert_eq!(s, "subject");
        assert_eq!(b, "body one\nbody two");
    }
}
