//! Remote sync — fetch / pull / push and ahead-behind counts.
//!
//! Push/pull reuse the clone credentials (`repo::CloneAuth` →
//! `repo::set_credentials`). `pull` is fetch + merge of the branch's upstream,
//! delegating the integration to [`crate::history::merge`] (so it inherits the
//! backup ref, fast-forward/3-way logic, and clean conflict abort). `push`
//! detects a rejected ref and surfaces a recoverable "pull first" error, and
//! advances the remote-tracking ref of every accepted ref (libgit2 only does
//! that through a named remote's fetch refspecs, so the `url`-override path
//! would otherwise leave `ahead_behind` reporting a stale count).

use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;

use git2::{Branch, FetchOptions, PushOptions, RemoteCallbacks};
use serde::Serialize;

use crate::error::{AdgitterError, AdgitterResult};
use crate::git::open_repo;
use crate::mutate::lock_mutations;
use crate::repo::{authenticated_url, set_credentials, CloneAuth};

/// How far the current branch is ahead/behind its upstream tracking branch.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AheadBehind {
    pub ahead: usize,
    pub behind: usize,
    /// Upstream shorthand (e.g. `origin/main`), or None when unconfigured.
    pub upstream: Option<String>,
}

impl AheadBehind {
    fn none() -> Self {
        Self {
            ahead: 0,
            behind: 0,
            upstream: None,
        }
    }
}

/// Compute ahead/behind for the current branch versus its upstream. Returns
/// zeros + `upstream: None` for a detached/unborn HEAD or no configured upstream.
pub fn ahead_behind(repo_path: PathBuf) -> AdgitterResult<AheadBehind> {
    let repo = open_repo(&repo_path)?;
    let Ok(head) = repo.head() else {
        return Ok(AheadBehind::none());
    };
    if !head.is_branch() {
        return Ok(AheadBehind::none());
    }
    let Some(local_oid) = head.target() else {
        return Ok(AheadBehind::none());
    };

    let branch = Branch::wrap(head);
    let Ok(upstream) = branch.upstream() else {
        return Ok(AheadBehind::none());
    };
    let Some(up_oid) = upstream.get().target() else {
        return Ok(AheadBehind::none());
    };
    let name = upstream.name().ok().flatten().map(str::to_string);

    let (ahead, behind) = repo.graph_ahead_behind(local_oid, up_oid)?;
    Ok(AheadBehind {
        ahead,
        behind,
        upstream: name,
    })
}

/// The configured fetch URL of `remote` (e.g. "origin"), or `None` when the
/// remote doesn't exist or has no URL. The desktop reads this on repo-open to
/// reflect the real `.git` target in Settings and to gate PAT-only features
/// on the URL's scheme — the caller strips any embedded userinfo
/// before persisting it, so a token in `https://TOKEN@host/…` never lands in
/// the committable config.
pub fn remote_url(repo_path: PathBuf, remote: String) -> AdgitterResult<Option<String>> {
    let repo = open_repo(&repo_path)?;
    // Bind to a `let` (not a tail expression): the borrowed `Remote` temporary
    // must drop at the `;` here, before `repo` drops at function end.
    let url = match repo.find_remote(&remote) {
        Ok(r) => r.url().map(str::to_string),
        Err(e) if e.code() == git2::ErrorCode::NotFound => None,
        Err(e) => return Err(e.into()),
    };
    Ok(url)
}

fn authenticated_remote_override(
    repo: &git2::Repository,
    remote: &str,
    url: Option<String>,
    auth: &CloneAuth,
    push: bool,
) -> AdgitterResult<Option<String>> {
    if let Some(url) = url {
        return Ok(Some(authenticated_url(&url, auth)?));
    }
    if !matches!(auth, CloneAuth::Password { .. }) {
        return Ok(None);
    }
    let rmt = repo.find_remote(remote)?;
    let original = if push {
        rmt.pushurl().or_else(|| rmt.url())
    } else {
        rmt.url()
    }
    .ok_or_else(|| git2::Error::from_str("remote URL is missing"))?;
    let target = authenticated_url(original, auth)?;
    Ok((target != original).then_some(target))
}

/// Fetch, updating remote-tracking refs.
///
/// When `url` is `Some`, the network target is that ad-hoc URL (an anonymous
/// remote) instead of the named `remote`'s configured URL — this is how a
/// user-configured Settings URL (e.g. `https://…` + PAT) overrides a `.git`
/// origin that would otherwise be used (e.g. an `ssh://…` origin). Because an
/// anonymous remote has no configured refspecs, heads are fetched into the
/// named remote's tracking namespace (`refs/remotes/<remote>/*`), so a branch's
/// upstream (`refs/remotes/<remote>/<branch>`) still updates and `pull`'s merge
/// target stays correct. With `url == None` the named remote and its own
/// refspecs are used (the default path).
pub fn fetch(
    repo_path: PathBuf,
    remote: String,
    auth: CloneAuth,
    url: Option<String>,
) -> AdgitterResult<()> {
    let _lock = lock_mutations();
    let repo = open_repo(&repo_path)?;

    let explicit_override = url.is_some();
    let url = authenticated_remote_override(&repo, &remote, url, &auth, false)?;
    let mut cb = RemoteCallbacks::new();
    set_credentials(&mut cb, auth);
    let mut fo = FetchOptions::new();
    fo.remote_callbacks(cb);

    match url {
        Some(u) => {
            let mut rmt = repo.remote_anonymous(&u)?;
            if explicit_override {
                let refspec = format!("+refs/heads/*:refs/remotes/{remote}/*");
                rmt.fetch(&[refspec.as_str()], Some(&mut fo), None)?;
            } else {
                let named = repo.find_remote(&remote)?;
                let configured = named.fetch_refspecs()?;
                let refspecs: Vec<&str> = configured.iter().flatten().collect();
                rmt.fetch(&refspecs, Some(&mut fo), None)?;
            }
        }
        None => {
            let mut rmt = repo.find_remote(&remote)?;
            let refspecs: &[&str] = &[];
            rmt.fetch(refspecs, Some(&mut fo), None)?;
        }
    }
    Ok(())
}

/// Pull = fetch `remote`, then merge the current branch's upstream into it.
/// Errors (with a recoverable message) if no upstream is configured. `url`
/// overrides the fetch target exactly as in [`fetch`] (the merge still targets
/// the branch's configured upstream, which the fetch keeps up to date).
pub fn pull(
    repo_path: PathBuf,
    remote: String,
    auth: CloneAuth,
    url: Option<String>,
) -> AdgitterResult<()> {
    // Fetch first (takes + releases the lock).
    fetch(repo_path.clone(), remote, auth, url)?;

    // Resolve the upstream shorthand for the current branch.
    let upstream = {
        let repo = open_repo(&repo_path)?;
        let head = repo.head()?;
        if !head.is_branch() {
            return Err(AdgitterError::Internal(
                "cannot pull onto a detached HEAD".into(),
            ));
        }
        let branch = Branch::wrap(head);
        let up = branch.upstream().map_err(|_| {
            AdgitterError::Internal("no upstream branch is configured for pull".into())
        })?;
        up.name()
            .ok()
            .flatten()
            .ok_or_else(|| AdgitterError::Internal("invalid upstream ref".into()))?
            .to_string()
    };

    // Integrate via the shared merge (backup ref + ff/3-way). `pull` is NOT
    // part of the pausable-conflict IPC contract (its command still returns
    // `()`), so a conflicting pull keeps the pre-resolver behaviour: abort
    // the pause `merge` just materialized (restoring the pre-pull tip, no
    // stray backup or state file) and surface the recoverable Conflict error.
    match crate::history::merge(repo_path.clone(), upstream)? {
        crate::resolve::HistoryOpResult::Completed { .. } => Ok(()),
        crate::resolve::HistoryOpResult::Conflict { state } => {
            crate::resolve::abort_op(repo_path)?;
            Err(AdgitterError::Conflict { sha: state.sha })
        }
    }
}

/// Push the current branch to `remote` (same-name refspec). A rejected update
/// surfaces a recoverable error suggesting a pull. `force` prefixes the
/// refspec with `+`, allowing the update to replace a remote ref whose tip is
/// not an ancestor of the new value (a non-fast-forward / destructive force
/// update) — leave it `false` for the everyday, non-destructive push.
pub fn push(
    repo_path: PathBuf,
    remote: String,
    auth: CloneAuth,
    force: bool,
    url: Option<String>,
) -> AdgitterResult<()> {
    let _lock = lock_mutations();
    let repo = open_repo(&repo_path)?;
    let head = repo.head()?;
    if !head.is_branch() {
        return Err(AdgitterError::Internal(
            "cannot push a detached HEAD".into(),
        ));
    }
    let refname = head
        .name()
        .ok_or_else(|| AdgitterError::Internal("invalid branch ref".into()))?
        .to_string();
    // The commit we are about to publish — the value the remote-tracking ref
    // should carry once the server accepts the update.
    let pushed_oid = head
        .target()
        .ok_or_else(|| AdgitterError::Internal("unborn branch cannot be pushed".into()))?;

    push_ref(&repo, remote, auth, force, url, refname, pushed_oid)
}

/// Publish an explicitly named local branch without changing or inspecting HEAD.
/// The same-name update is always ordinary (never force), so divergence is rejected.
pub fn push_branch(
    repo_path: PathBuf,
    branch: String,
    remote: String,
    auth: CloneAuth,
    url: Option<String>,
) -> AdgitterResult<()> {
    let _lock = lock_mutations();
    let repo = open_repo(&repo_path)?;
    let local = repo.find_branch(&branch, git2::BranchType::Local)?;
    let reference = local.get();
    let refname = reference
        .name()
        .ok_or_else(|| AdgitterError::Internal("invalid branch ref".into()))?
        .to_string();
    let pushed_oid = reference
        .target()
        .ok_or_else(|| AdgitterError::Internal("unborn branch cannot be pushed".into()))?;
    push_ref(&repo, remote, auth, false, url, refname, pushed_oid)
}

fn push_ref(
    repo: &git2::Repository,
    remote: String,
    auth: CloneAuth,
    force: bool,
    url: Option<String>,
    refname: String,
    pushed_oid: git2::Oid,
) -> AdgitterResult<()> {
    // `url` (a user-configured Settings URL) overrides the named remote's own
    // URL as the push target — see `fetch`.
    let url = authenticated_remote_override(repo, &remote, url, &auth, true)?;
    let mut rmt = match &url {
        Some(u) => repo.remote_anonymous(u)?,
        None => repo.find_remote(&remote)?,
    };
    let mut cb = RemoteCallbacks::new();
    set_credentials(&mut cb, auth);

    // The server reports per-ref rejection here (non-fast-forward, hook, …).
    // `status == None` means *this* ref was accepted; that is the only place
    // per-ref acceptance is visible, so both outcomes are recorded here.
    // `RemoteCallbacks`' closures are `FnMut + 'a` (not `Send`), so the
    // single-threaded `Rc<RefCell<…>>` the rejection channel already uses is
    // the right shared-state shape for the accepted names too.
    let rejection: Rc<RefCell<Option<String>>> = Rc::new(RefCell::new(None));
    let accepted: Rc<RefCell<Vec<String>>> = Rc::new(RefCell::new(Vec::new()));
    let rej = rejection.clone();
    let acc = accepted.clone();
    cb.push_update_reference(move |refname, status| {
        match status {
            Some(msg) => *rej.borrow_mut() = Some(format!("{refname}: {msg}")),
            None => acc.borrow_mut().push(refname.to_string()),
        }
        Ok(())
    });

    let mut po = PushOptions::new();
    po.remote_callbacks(cb);
    let prefix = if force { "+" } else { "" };
    rmt.push(&[format!("{prefix}{refname}:{refname}")], Some(&mut po))?;

    if let Some(msg) = rejection.borrow().clone() {
        return Err(AdgitterError::Internal(format!(
            "push rejected ({msg}) — pull first, then push again"
        )));
    }

    // Advance `refs/remotes/<remote>/<branch>` ourselves. libgit2 runs its own
    // `update_tips` after a push, but that maps the pushed ref through the
    // *remote's fetch refspecs* — and the `url`-override path pushes over an
    // anonymous remote, which has none. So on that path the tracking ref stayed
    // at the pre-push commit, and `ahead_behind` (which reads exactly that ref
    // via `branch.upstream()`) kept reporting the old count — the stale toolbar
    // badge. Doing it here covers both paths; for a named remote it is a
    // no-op-equivalent rewrite to the value libgit2 already set. Only refs the
    // server *accepted* are advanced — a rejected one never enters this loop.
    for remote_refname in accepted.borrow().iter() {
        update_tracking_ref(repo, &remote, remote_refname, pushed_oid);
    }
    Ok(())
}

/// Point `refs/remotes/<remote>/<branch>` at `oid` after a successful push.
///
/// `remote_refname` is the ref *on the server* (`refs/heads/<branch>`); the
/// refspec is same-name, so the branch component carries over verbatim. The
/// namespace is always the `remote` **name**, even when a `url` override made
/// the push target an anonymous remote: `fetch` fetches an override into that
/// same `refs/remotes/<remote>/*` namespace, and a branch's configured upstream
/// resolves there too, so this keeps both sides of the sync consistent. (A URL
/// is not a legal ref component, so deriving the namespace from it would only
/// produce a malformed ref.)
///
/// Errors are deliberately swallowed: the push already happened and the user's
/// commits are on the server. Turning a bookkeeping failure into a visible
/// error would report a successful push as failed — strictly worse than a
/// stale badge, which the next fetch/pull corrects anyway.
fn update_tracking_ref(
    repo: &git2::Repository,
    remote: &str,
    remote_refname: &str,
    oid: git2::Oid,
) {
    let Some(branch) = remote_refname.strip_prefix("refs/heads/") else {
        return;
    };
    let tracking = format!("refs/remotes/{remote}/{branch}");
    // `force: true` — a force push moves the tracking ref non-fast-forward too.
    let _ = repo.reference(&tracking, oid, true, "update by push");
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::Repository;
    use std::path::Path;

    fn config_user(repo: &Repository) {
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Tester").unwrap();
        cfg.set_str("user.email", "t@example.com").unwrap();
    }

    fn commit_in(dir: &Path, name: &str, content: &str) -> String {
        config_user(&Repository::open(dir).unwrap());
        std::fs::write(dir.join(name), content).unwrap();
        crate::workdir::stage(dir.to_path_buf(), vec![name.to_string()]).unwrap();
        crate::workdir::commit(dir.to_path_buf(), format!("add {name}"), false).unwrap()
    }

    fn file_url(p: &Path) -> String {
        format!("file://{}", p.display())
    }

    /// Build a bare remote seeded with one commit; return (bare path, branch).
    fn seed_bare(src: &Path, bare: &Path) -> String {
        let repo = Repository::init(src).unwrap();
        config_user(&repo);
        commit_in(src, "a.txt", "1");
        let branch = repo.head().unwrap().shorthand().unwrap().to_string();

        Repository::init_bare(bare).unwrap();
        let mut remote = repo.remote("origin", &file_url(bare)).unwrap();
        remote
            .push(&[format!("refs/heads/{branch}:refs/heads/{branch}")], None)
            .unwrap();
        branch
    }

    #[test]
    fn push_branch_publishes_only_log_branch_with_url_override() {
        let src = tempfile::TempDir::new().unwrap();
        let bare = tempfile::TempDir::new().unwrap();
        let branch = seed_bare(src.path(), bare.path());
        let repo = Repository::open(src.path()).unwrap();
        let base = repo.head().unwrap().target().unwrap();
        let tree = repo.find_commit(base).unwrap().tree().unwrap();
        let sig = repo.signature().unwrap();
        let log = repo
            .commit(
                Some("refs/heads/adgitter/log"),
                &sig,
                &sig,
                "log",
                &tree,
                &[&repo.find_commit(base).unwrap()],
            )
            .unwrap();
        commit_in(src.path(), "unpublished.txt", "head changes");
        repo.remote_set_url("origin", "file:///nonexistent/not-here.git")
            .unwrap();

        push_branch(
            src.path().to_path_buf(),
            "adgitter/log".into(),
            "origin".into(),
            CloneAuth::None,
            Some(file_url(bare.path())),
        )
        .unwrap();
        let remote = Repository::open(bare.path()).unwrap();
        assert_eq!(
            remote
                .find_reference("refs/heads/adgitter/log")
                .unwrap()
                .target(),
            Some(log)
        );
        assert_eq!(
            remote
                .find_reference(&format!("refs/heads/{branch}"))
                .unwrap()
                .target(),
            Some(base)
        );
        assert_eq!(
            repo.find_reference("refs/remotes/origin/adgitter/log")
                .unwrap()
                .target(),
            Some(log)
        );
    }

    #[test]
    fn push_branch_rejects_divergence_without_overwriting_remote() {
        let src = tempfile::TempDir::new().unwrap();
        let bare = tempfile::TempDir::new().unwrap();
        seed_bare(src.path(), bare.path());
        let repo = Repository::open(src.path()).unwrap();
        let base = repo.head().unwrap().target().unwrap();
        let tree = repo.find_commit(base).unwrap().tree().unwrap();
        let sig = repo.signature().unwrap();
        let original = repo
            .commit(
                Some("refs/heads/adgitter/log"),
                &sig,
                &sig,
                "first",
                &tree,
                &[&repo.find_commit(base).unwrap()],
            )
            .unwrap();
        push_branch(
            src.path().to_path_buf(),
            "adgitter/log".into(),
            "origin".into(),
            CloneAuth::None,
            None,
        )
        .unwrap();
        let divergent = repo
            .commit(
                None,
                &sig,
                &sig,
                "divergent",
                &tree,
                &[&repo.find_commit(base).unwrap()],
            )
            .unwrap();
        repo.reference("refs/heads/adgitter/log", divergent, true, "diverge")
            .unwrap();
        assert!(push_branch(
            src.path().to_path_buf(),
            "adgitter/log".into(),
            "origin".into(),
            CloneAuth::None,
            None
        )
        .is_err());
        assert_eq!(
            Repository::open(bare.path())
                .unwrap()
                .find_reference("refs/heads/adgitter/log")
                .unwrap()
                .target(),
            Some(original)
        );
        assert_eq!(
            repo.find_reference("refs/remotes/origin/adgitter/log")
                .unwrap()
                .target(),
            Some(original)
        );
    }

    #[test]
    fn remote_url_returns_origin_url_or_none() {
        let src = tempfile::TempDir::new().unwrap();
        let repo = Repository::init(src.path()).unwrap();
        config_user(&repo);
        // No remote yet → None.
        assert_eq!(
            remote_url(src.path().to_path_buf(), "origin".into()).unwrap(),
            None
        );
        // After adding one → its URL.
        repo.remote("origin", "https://github.com/you/repo.git")
            .unwrap();
        assert_eq!(
            remote_url(src.path().to_path_buf(), "origin".into()).unwrap(),
            Some("https://github.com/you/repo.git".to_string())
        );
        // A different remote name that doesn't exist → None (not an error).
        assert_eq!(
            remote_url(src.path().to_path_buf(), "upstream".into()).unwrap(),
            None
        );
    }

    #[test]
    fn push_publishes_local_commits_to_the_remote() {
        let src = tempfile::TempDir::new().unwrap();
        let bare = tempfile::TempDir::new().unwrap();
        let branch = seed_bare(src.path(), bare.path());

        let work = tempfile::TempDir::new().unwrap();
        let dest = work.path().join("clone");
        crate::repo::clone_repository(
            file_url(bare.path()),
            dest.clone(),
            CloneAuth::None,
            |_, _| {},
        )
        .unwrap();

        let c2 = commit_in(&dest, "b.txt", "2");
        push(dest.clone(), "origin".into(), CloneAuth::None, false, None).unwrap();

        let bare_repo = Repository::open(bare.path()).unwrap();
        let pushed = bare_repo
            .find_reference(&format!("refs/heads/{branch}"))
            .unwrap()
            .target()
            .unwrap();
        assert_eq!(pushed.to_string(), c2);
    }

    #[test]
    fn push_uses_the_url_override_instead_of_the_named_remote() {
        // The user configured a Settings URL that differs from `.git` origin:
        // push must target the override URL, not origin's URL. Proven by
        // pointing origin at a bogus path — a plain named push would fail — yet
        // the override still publishes to the real bare.
        let src = tempfile::TempDir::new().unwrap();
        let bare = tempfile::TempDir::new().unwrap();
        let branch = seed_bare(src.path(), bare.path());

        let work = tempfile::TempDir::new().unwrap();
        let dest = work.path().join("clone");
        crate::repo::clone_repository(
            file_url(bare.path()),
            dest.clone(),
            CloneAuth::None,
            |_, _| {},
        )
        .unwrap();
        {
            let repo = Repository::open(&dest).unwrap();
            repo.remote_set_url("origin", "file:///nonexistent/not-here.git")
                .unwrap();
        }

        let c2 = commit_in(&dest, "b.txt", "2");
        push(
            dest.clone(),
            "origin".into(),
            CloneAuth::None,
            false,
            Some(file_url(bare.path())),
        )
        .unwrap();

        let bare_repo = Repository::open(bare.path()).unwrap();
        let pushed = bare_repo
            .find_reference(&format!("refs/heads/{branch}"))
            .unwrap()
            .target()
            .unwrap();
        assert_eq!(pushed.to_string(), c2);
    }

    #[test]
    fn pull_uses_the_url_override_for_the_fetch() {
        // Same override, on the fetch side: A's origin points at a bogus path,
        // but pulling with the override fetches from the real bare into origin's
        // tracking namespace so the upstream merge fast-forwards.
        let src = tempfile::TempDir::new().unwrap();
        let bare = tempfile::TempDir::new().unwrap();
        seed_bare(src.path(), bare.path());

        let a = tempfile::TempDir::new().unwrap();
        let work_a = a.path().join("a");
        crate::repo::clone_repository(
            file_url(bare.path()),
            work_a.clone(),
            CloneAuth::None,
            |_, _| {},
        )
        .unwrap();
        let b = tempfile::TempDir::new().unwrap();
        let work_b = b.path().join("b");
        crate::repo::clone_repository(
            file_url(bare.path()),
            work_b.clone(),
            CloneAuth::None,
            |_, _| {},
        )
        .unwrap();

        // B publishes a new commit to the real bare.
        let c2 = commit_in(&work_b, "b.txt", "2");
        push(work_b, "origin".into(), CloneAuth::None, false, None).unwrap();

        // A's origin is now bogus, but the override fetch targets the real bare.
        {
            let repo = Repository::open(&work_a).unwrap();
            repo.remote_set_url("origin", "file:///nonexistent/not-here.git")
                .unwrap();
        }
        pull(
            work_a.clone(),
            "origin".into(),
            CloneAuth::None,
            Some(file_url(bare.path())),
        )
        .unwrap();

        let head = Repository::open(&work_a)
            .unwrap()
            .head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .id()
            .to_string();
        assert_eq!(head, c2);
    }

    #[test]
    fn pull_fast_forwards_from_the_remote() {
        let src = tempfile::TempDir::new().unwrap();
        let bare = tempfile::TempDir::new().unwrap();
        seed_bare(src.path(), bare.path());

        let a = tempfile::TempDir::new().unwrap();
        let work_a = a.path().join("a");
        crate::repo::clone_repository(
            file_url(bare.path()),
            work_a.clone(),
            CloneAuth::None,
            |_, _| {},
        )
        .unwrap();
        let b = tempfile::TempDir::new().unwrap();
        let work_b = b.path().join("b");
        crate::repo::clone_repository(
            file_url(bare.path()),
            work_b.clone(),
            CloneAuth::None,
            |_, _| {},
        )
        .unwrap();

        // B commits + pushes; A pulls and should fast-forward to it.
        let c2 = commit_in(&work_b, "b.txt", "2");
        push(work_b, "origin".into(), CloneAuth::None, false, None).unwrap();

        pull(work_a.clone(), "origin".into(), CloneAuth::None, None).unwrap();
        let head = Repository::open(&work_a)
            .unwrap()
            .head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .id()
            .to_string();
        assert_eq!(head, c2);
    }

    #[test]
    fn ahead_behind_tracks_divergence() {
        let src = tempfile::TempDir::new().unwrap();
        let bare = tempfile::TempDir::new().unwrap();
        seed_bare(src.path(), bare.path());

        let a = tempfile::TempDir::new().unwrap();
        let work_a = a.path().join("a");
        crate::repo::clone_repository(
            file_url(bare.path()),
            work_a.clone(),
            CloneAuth::None,
            |_, _| {},
        )
        .unwrap();
        let b = tempfile::TempDir::new().unwrap();
        let work_b = b.path().join("b");
        crate::repo::clone_repository(
            file_url(bare.path()),
            work_b.clone(),
            CloneAuth::None,
            |_, _| {},
        )
        .unwrap();

        // Fresh clone: in sync.
        let ab = ahead_behind(work_a.clone()).unwrap();
        assert_eq!((ab.ahead, ab.behind), (0, 0));
        assert!(ab.upstream.is_some());

        // B pushes a commit; A fetches → A is behind by 1.
        commit_in(&work_b, "b.txt", "2");
        push(work_b, "origin".into(), CloneAuth::None, false, None).unwrap();
        fetch(work_a.clone(), "origin".into(), CloneAuth::None, None).unwrap();
        let ab = ahead_behind(work_a.clone()).unwrap();
        assert_eq!((ab.ahead, ab.behind), (0, 1));

        // A makes a local commit → ahead 1, behind 1 (diverged).
        commit_in(&work_a, "c.txt", "3");
        let ab = ahead_behind(work_a).unwrap();
        assert_eq!((ab.ahead, ab.behind), (1, 1));
    }

    #[test]
    fn ahead_behind_is_none_without_upstream() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        config_user(&repo);
        commit_in(dir.path(), "a.txt", "1");
        let ab = ahead_behind(dir.path().to_path_buf()).unwrap();
        assert_eq!(ab, AheadBehind::none());
    }

    // The strongest proof the `force` flag actually changes the refspec: a
    // real non-fast-forward update against a `file://` remote is rejected
    // without force and succeeds (overwriting the remote branch) with it.
    #[test]
    fn push_rejects_non_fast_forward_without_force_but_succeeds_with_force() {
        let src = tempfile::TempDir::new().unwrap();
        let bare = tempfile::TempDir::new().unwrap();
        let branch = seed_bare(src.path(), bare.path());

        let a = tempfile::TempDir::new().unwrap();
        let work_a = a.path().join("a");
        crate::repo::clone_repository(
            file_url(bare.path()),
            work_a.clone(),
            CloneAuth::None,
            |_, _| {},
        )
        .unwrap();
        let b = tempfile::TempDir::new().unwrap();
        let work_b = b.path().join("b");
        crate::repo::clone_repository(
            file_url(bare.path()),
            work_b.clone(),
            CloneAuth::None,
            |_, _| {},
        )
        .unwrap();

        // A publishes a commit; the remote branch now points at it.
        let a_head = commit_in(&work_a, "a2.txt", "from-a");
        push(work_a, "origin".into(), CloneAuth::None, false, None).unwrap();

        // B, still on the older base, commits a divergent history. A normal
        // push is rejected — the remote carries work B doesn't have — and
        // must leave the remote untouched. (libgit2's local transport catches
        // this itself, before any negotiation, so it surfaces as a `Git`
        // error rather than through the `push_update_reference` callback —
        // either phrasing counts as "rejected" for this assertion.)
        let b_head = commit_in(&work_b, "b2.txt", "from-b");
        let err = push(
            work_b.clone(),
            "origin".into(),
            CloneAuth::None,
            false,
            None,
        )
        .unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("rejected") || msg.contains("not present locally"),
            "expected a non-fast-forward rejection, got: {msg}"
        );
        let unchanged = Repository::open(bare.path())
            .unwrap()
            .find_reference(&format!("refs/heads/{branch}"))
            .unwrap()
            .target()
            .unwrap();
        assert_eq!(
            unchanged.to_string(),
            a_head,
            "remote must be unchanged after a rejected non-force push"
        );

        // The same divergent history, pushed with force, overwrites the
        // remote branch — proving the `+` refspec prefix took effect.
        push(work_b, "origin".into(), CloneAuth::None, true, None).unwrap();
        let forced = Repository::open(bare.path())
            .unwrap()
            .find_reference(&format!("refs/heads/{branch}"))
            .unwrap()
            .target()
            .unwrap();
        assert_eq!(forced.to_string(), b_head);
    }

    // With a named remote libgit2's own post-push `update_tips` already maps
    // the pushed ref through the fetch refspec; this guards that `ahead`
    // reaches 0 either way (and that our own update doesn't break it).
    #[test]
    fn push_advances_the_tracking_ref_so_ahead_returns_to_zero() {
        let src = tempfile::TempDir::new().unwrap();
        let bare = tempfile::TempDir::new().unwrap();
        let branch = seed_bare(src.path(), bare.path());

        let work = tempfile::TempDir::new().unwrap();
        let dest = work.path().join("clone");
        crate::repo::clone_repository(
            file_url(bare.path()),
            dest.clone(),
            CloneAuth::None,
            |_, _| {},
        )
        .unwrap();

        let c2 = commit_in(&dest, "b.txt", "2");

        // Before: one unpublished commit — this is the number the badge shows.
        let before = ahead_behind(dest.clone()).unwrap();
        assert_eq!(before.ahead, 1, "fixture must start one commit ahead");
        assert_eq!(before.behind, 0);

        push(dest.clone(), "origin".into(), CloneAuth::None, false, None).unwrap();

        // After: the tracking ref moved with the push, so the badge clears.
        let after = ahead_behind(dest.clone()).unwrap();
        assert_eq!(after.ahead, 0, "ahead must clear once the push succeeded");
        assert_eq!(after.behind, 0);

        let tracked = Repository::open(&dest)
            .unwrap()
            .find_reference(&format!("refs/remotes/origin/{branch}"))
            .unwrap()
            .target()
            .unwrap();
        assert_eq!(tracked.to_string(), c2);
    }

    // The url-override path is where the badge actually went stale: an
    // anonymous remote carries no fetch refspecs, so libgit2's own
    // post-push `update_tips` has nothing to map and the tracking ref stays
    // put. (With a *named* remote libgit2 does the mapping itself — see the
    // test above, which guards that it keeps doing so.)
    #[test]
    fn push_with_a_url_override_advances_the_tracking_ref() {
        let src = tempfile::TempDir::new().unwrap();
        let bare = tempfile::TempDir::new().unwrap();
        let branch = seed_bare(src.path(), bare.path());

        let work = tempfile::TempDir::new().unwrap();
        let dest = work.path().join("clone");
        crate::repo::clone_repository(
            file_url(bare.path()),
            dest.clone(),
            CloneAuth::None,
            |_, _| {},
        )
        .unwrap();

        let c2 = commit_in(&dest, "b.txt", "2");
        let before = ahead_behind(dest.clone()).unwrap();
        assert_eq!(before.ahead, 1, "fixture must start one commit ahead");

        push(
            dest.clone(),
            "origin".into(),
            CloneAuth::None,
            false,
            Some(file_url(bare.path())),
        )
        .unwrap();

        let after = ahead_behind(dest.clone()).unwrap();
        assert_eq!(
            after.ahead, 0,
            "ahead must clear after an override push too — this is the badge bug"
        );

        let tracked = Repository::open(&dest)
            .unwrap()
            .find_reference(&format!("refs/remotes/origin/{branch}"))
            .unwrap()
            .target()
            .unwrap();
        assert_eq!(tracked.to_string(), c2);
    }

    // A force push takes the same code path and must move the tracking ref
    // too — non-fast-forward, which is why our ref write has to be forced.
    // Run over the `url` override, the path libgit2 does not cover itself.
    #[test]
    fn force_push_advances_the_tracking_ref() {
        let src = tempfile::TempDir::new().unwrap();
        let bare = tempfile::TempDir::new().unwrap();
        let branch = seed_bare(src.path(), bare.path());

        let a = tempfile::TempDir::new().unwrap();
        let work_a = a.path().join("a");
        crate::repo::clone_repository(
            file_url(bare.path()),
            work_a.clone(),
            CloneAuth::None,
            |_, _| {},
        )
        .unwrap();
        let b = tempfile::TempDir::new().unwrap();
        let work_b = b.path().join("b");
        crate::repo::clone_repository(
            file_url(bare.path()),
            work_b.clone(),
            CloneAuth::None,
            |_, _| {},
        )
        .unwrap();

        // A publishes; B builds a divergent history on the old base.
        commit_in(&work_a, "a2.txt", "from-a");
        push(work_a, "origin".into(), CloneAuth::None, false, None).unwrap();
        let b_head = commit_in(&work_b, "b2.txt", "from-b");

        push(
            work_b.clone(),
            "origin".into(),
            CloneAuth::None,
            true,
            Some(file_url(bare.path())),
        )
        .unwrap();

        let tracked = Repository::open(&work_b)
            .unwrap()
            .find_reference(&format!("refs/remotes/origin/{branch}"))
            .unwrap()
            .target()
            .unwrap();
        assert_eq!(tracked.to_string(), b_head);
        assert_eq!(ahead_behind(work_b).unwrap().ahead, 0);
    }

    // A ref the server refuses must NOT have its tracking ref advanced —
    // otherwise the badge would clear on a push that never landed.
    #[test]
    fn rejected_push_leaves_the_tracking_ref_untouched() {
        let src = tempfile::TempDir::new().unwrap();
        let bare = tempfile::TempDir::new().unwrap();
        let branch = seed_bare(src.path(), bare.path());

        let a = tempfile::TempDir::new().unwrap();
        let work_a = a.path().join("a");
        crate::repo::clone_repository(
            file_url(bare.path()),
            work_a.clone(),
            CloneAuth::None,
            |_, _| {},
        )
        .unwrap();
        let b = tempfile::TempDir::new().unwrap();
        let work_b = b.path().join("b");
        crate::repo::clone_repository(
            file_url(bare.path()),
            work_b.clone(),
            CloneAuth::None,
            |_, _| {},
        )
        .unwrap();

        let tracking = format!("refs/remotes/origin/{branch}");
        let base = Repository::open(&work_b)
            .unwrap()
            .find_reference(&tracking)
            .unwrap()
            .target()
            .unwrap()
            .to_string();

        // A publishes, then B's non-fast-forward push is rejected.
        commit_in(&work_a, "a2.txt", "from-a");
        push(work_a, "origin".into(), CloneAuth::None, false, None).unwrap();
        commit_in(&work_b, "b2.txt", "from-b");
        push(
            work_b.clone(),
            "origin".into(),
            CloneAuth::None,
            false,
            None,
        )
        .unwrap_err();

        let after = Repository::open(&work_b)
            .unwrap()
            .find_reference(&tracking)
            .unwrap()
            .target()
            .unwrap()
            .to_string();
        assert_eq!(
            after, base,
            "a rejected push must not advance the tracking ref"
        );
        assert_eq!(ahead_behind(work_b).unwrap().ahead, 1);
    }
}

#[cfg(test)]
mod pat_transport_tests {
    use super::*;
    #[test]
    fn named_remote_pat_uses_fetch_or_push_endpoint_without_changing_config() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(tmp.path()).unwrap();
        repo.remote("origin", "git@gitlab.com:u/read.git").unwrap();
        repo.remote_set_pushurl("origin", Some("git@github.com:u/write.git"))
            .unwrap();
        let auth = CloneAuth::Password {
            username: "user".into(),
            password: "test-pat".into(),
        };
        assert_eq!(
            authenticated_remote_override(&repo, "origin", None, &auth, false)
                .unwrap()
                .as_deref(),
            Some("https://gitlab.com/u/read.git")
        );
        assert_eq!(
            authenticated_remote_override(&repo, "origin", None, &auth, true)
                .unwrap()
                .as_deref(),
            Some("https://github.com/u/write.git")
        );
        assert!(
            authenticated_remote_override(&repo, "origin", None, &CloneAuth::None, false)
                .unwrap()
                .is_none()
        );
        assert_eq!(
            repo.find_remote("origin").unwrap().url(),
            Some("git@gitlab.com:u/read.git")
        );
        assert_eq!(
            authenticated_remote_override(
                &repo,
                "origin",
                Some("git@bitbucket.org:u/override.git".into()),
                &auth,
                true
            )
            .unwrap()
            .as_deref(),
            Some("https://bitbucket.org/u/override.git")
        );
    }
}
