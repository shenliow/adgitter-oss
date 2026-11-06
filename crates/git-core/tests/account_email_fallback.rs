//! Repository-level behaviour of the account-email fallback: **the account address is a default, never an override.**
//!
//! These live in their own integration binary for two reasons that the unit
//! tests could not satisfy:
//!
//! 1. **"Unconfigured" has to be genuinely unconfigured.** `Repository::init`
//!    inherits the machine's global `~/.gitconfig`, so on any developer box
//!    (and most CI images) a freshly-initialised repo already has a
//!    `user.email`. Only `git2::opts::set_search_path` — which is *process*
//!    state — can take it away, so it must not run alongside the rest of the
//!    suite.
//! 2. **The registered fallback is process-global.** A separate binary means it
//!    races with nothing but the tests in this file, which serialise on
//!    [`GUARD`].
//!
//! Every assertion reads the identity back off the written commit object; what
//! git actually recorded is the only evidence that counts here.

use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use git2::Repository;
use git_core::{
    commit, identity_status, set_fallback_identity, stage, FallbackIdentity, IdentitySource,
};

static GUARD: Mutex<()> = Mutex::new(());

/// Serialise, isolate git's global/system config, and register `identity`.
/// Everything is restored when the returned guard drops.
fn setup(identity: Option<FallbackIdentity>) -> Fixture {
    let lock = GUARD.lock().unwrap_or_else(|e| e.into_inner());
    let empty = tempfile::TempDir::new().unwrap();
    let previous = isolate_git_config(empty.path());
    set_fallback_identity(identity);
    Fixture {
        _lock: lock,
        _empty: empty,
        previous,
    }
}

struct Fixture {
    _lock: MutexGuard<'static, ()>,
    _empty: tempfile::TempDir,
    previous: Vec<(git2::ConfigLevel, std::ffi::CString)>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        set_fallback_identity(None);
        for (level, path) in self.previous.drain(..) {
            // SAFETY: same contract as `isolate_git_config` — serialised by
            // `GUARD`, and this binary holds no live libgit2 config handles.
            unsafe {
                let _ = git2::opts::set_search_path(level, path.clone());
            }
        }
    }
}

/// Point every non-local config level at an empty directory, so `user.email`
/// can only come from a repo's own config. Returns the previous paths.
fn isolate_git_config(empty: &Path) -> Vec<(git2::ConfigLevel, std::ffi::CString)> {
    use git2::ConfigLevel::*;
    let mut previous = Vec::new();
    for level in [System, Global, XDG, ProgramData] {
        // SAFETY: `set_search_path` mutates process-wide libgit2 state. Calls are
        // serialised by `GUARD`, this binary runs no other libgit2 work
        // concurrently, and the original paths are restored on drop.
        unsafe {
            if let Ok(before) = git2::opts::get_search_path(level) {
                previous.push((level, before));
            }
            let _ = git2::opts::set_search_path(level, empty);
        }
    }
    previous
}

fn init_repo(dir: &Path, email: Option<(&str, &str)>) -> Repository {
    let repo = Repository::init(dir).unwrap();
    if let Some((name, mail)) = email {
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", name).unwrap();
        cfg.set_str("user.email", mail).unwrap();
    }
    repo
}

/// Stage `name` and commit, returning the new sha.
fn commit_file(dir: &Path, name: &str, body: &str, message: &str) -> Result<String, String> {
    std::fs::write(dir.join(name), body).unwrap();
    stage(dir.to_path_buf(), vec![name.to_string()]).unwrap();
    commit(dir.to_path_buf(), message.to_string(), false).map_err(|e| e.to_string())
}

fn author_of(repo: &Repository, sha: &str) -> (String, String) {
    let c = repo.find_commit(git2::Oid::from_str(sha).unwrap()).unwrap();
    let a = c.author();
    (
        a.name().unwrap_or_default().to_string(),
        a.email().unwrap_or_default().to_string(),
    )
}

/// **The load-bearing case.** A configured `user.email` must reach the commit
/// object untouched even with an account address registered. Substituting it
/// would break host attribution, DCO/CLA gates and PRD US28's promise that
/// writes behave like the git CLI.
#[test]
fn a_configured_user_email_is_used_verbatim_and_the_fallback_never_intervenes() {
    let _fx = setup(FallbackIdentity::from_account_email("account@adgitter.app"));
    let dir = tempfile::TempDir::new().unwrap();
    let p = dir.path();
    let repo = init_repo(p, Some(("Ada Lovelace", "ada@employer.example")));

    let sha = commit_file(p, "a.txt", "x", "configured").unwrap();
    let (name, email) = author_of(&repo, &sha);

    assert_eq!(email, "ada@employer.example", "git's own identity must win");
    assert_eq!(name, "Ada Lovelace");
    assert_ne!(email, "account@adgitter.app");

    // The committer too — a half-substituted commit would be worse than either.
    let c = repo
        .find_commit(git2::Oid::from_str(&sha).unwrap())
        .unwrap();
    assert_eq!(c.committer().email(), Some("ada@employer.example"));

    // And the app reports it as git-sourced, so the UI says nothing.
    let status = identity_status(p.to_path_buf()).unwrap();
    assert_eq!(status.source, IdentitySource::Git);
    assert_eq!(status.email.as_deref(), Some("ada@employer.example"));
}

/// The multi-identity case this rule exists to protect: a repo-local address (work
/// vs personal, as `includeIf` arranges) beats the one account address.
#[test]
fn a_repo_local_user_email_still_wins_when_it_differs_from_the_account() {
    let _fx = setup(FallbackIdentity::from_account_email(
        "personal@adgitter.app",
    ));
    let dir = tempfile::TempDir::new().unwrap();
    let p = dir.path();
    let repo = init_repo(p, Some(("Work Me", "me@employer.example")));

    let sha = commit_file(p, "a.txt", "x", "work").unwrap();
    assert_eq!(author_of(&repo, &sha).1, "me@employer.example");
}

/// The newcomer case the licence email exists for.
#[test]
fn the_account_address_is_used_when_git_has_no_identity() {
    let _fx = setup(FallbackIdentity::from_account_email(
        "newcomer@adgitter.app",
    ));
    let dir = tempfile::TempDir::new().unwrap();
    let p = dir.path();
    let repo = init_repo(p, None);

    let sha = commit_file(p, "a.txt", "x", "first ever").unwrap();
    let (name, email) = author_of(&repo, &sha);

    assert_eq!(email, "newcomer@adgitter.app");
    assert_eq!(name, "newcomer", "the name derives from the local part");
    let c = repo
        .find_commit(git2::Oid::from_str(&sha).unwrap())
        .unwrap();
    assert_eq!(c.committer().email(), Some("newcomer@adgitter.app"));
}

/// …and the app can say so *before* the commit, which is what keeps the
/// substitution honest rather than silent.
#[test]
fn the_status_announces_the_substitution_before_anything_is_written() {
    let _fx = setup(FallbackIdentity::from_account_email(
        "newcomer@adgitter.app",
    ));
    let dir = tempfile::TempDir::new().unwrap();
    let p = dir.path();
    let _repo = init_repo(p, None);

    let status = identity_status(p.to_path_buf()).unwrap();
    assert_eq!(status.source, IdentitySource::Account);
    assert_eq!(status.email.as_deref(), Some("newcomer@adgitter.app"));
    assert_eq!(status.name.as_deref(), Some("newcomer"));
}

/// No git identity and no account address: exactly the error it always was.
#[test]
fn with_neither_identity_the_existing_error_is_unchanged() {
    let _fx = setup(None);
    let dir = tempfile::TempDir::new().unwrap();
    let p = dir.path();
    let _repo = init_repo(p, None);

    let err = commit_file(p, "a.txt", "x", "nope").unwrap_err();
    assert!(
        err.contains("git user.name / user.email is not configured"),
        "unexpected error: {err}"
    );

    let status = identity_status(p.to_path_buf()).unwrap();
    assert_eq!(status.source, IdentitySource::None);
    assert_eq!(status.email, None);
}

/// The failure message is user-visible and log-eligible, so it must never carry
/// the address — even when one is registered and merely unusable.
#[test]
fn the_failure_message_never_leaks_the_account_address() {
    let _fx = setup(None);
    // A malformed account address must behave exactly like "no fallback", and
    // must not appear in the resulting error.
    set_fallback_identity(FallbackIdentity::from_account_email("not-an-email"));
    let dir = tempfile::TempDir::new().unwrap();
    let p = dir.path();
    let _repo = init_repo(p, None);

    let err = commit_file(p, "a.txt", "x", "nope").unwrap_err();
    assert!(!err.contains("not-an-email"), "leaked the address: {err}");
    assert!(!err.contains('@'), "error contains an address: {err}");
}

/// Clearing the fallback (sign-out) restores the pre-fallback behaviour exactly.
#[test]
fn signing_out_restores_the_unconfigured_error() {
    let _fx = setup(FallbackIdentity::from_account_email(
        "newcomer@adgitter.app",
    ));
    let dir = tempfile::TempDir::new().unwrap();
    let p = dir.path();
    let _repo = init_repo(p, None);

    commit_file(p, "a.txt", "x", "while signed in").unwrap();

    set_fallback_identity(None);
    let err = commit_file(p, "b.txt", "y", "after sign-out").unwrap_err();
    assert!(err.contains("is not configured"), "unexpected: {err}");
}

// ── After sign-out, nothing may be authored as the account (2026-08-18) ──────
//
// **The most important guarantee in the sign-out work.** A sign-out that only
// reset the UI left this process-global set, so every commit the user made
// afterwards was still stamped with the address of the account they had just
// left — written into git history, which is permanent and gets pushed to every
// mirror. That is strictly worse than a paid feature staying unlocked: an
// entitlement can be re-checked, an author line cannot be un-pushed.
//
// The shell-side half — that ADGitter's sign-out is what performs this clear,
// and that it does so even when destroying the token partly failed — is pinned
// by `destroy_credentials`'s own tests in `apps/desktop/src-tauri/src/commands.rs`
// (`signing_out_clears_the_account_commit_identity`,
// `the_commit_identity_is_cleared_even_when_a_token_survives`). What follows is
// the consequence, read back off real commit objects: with the fallback cleared,
// the address cannot reach a commit by any route.

/// Every commit written after sign-out, checked against the account address —
/// including the case where git *does* have an identity, so a commit really is
/// produced and there is an author line to inspect.
#[test]
fn no_commit_written_after_sign_out_carries_the_account_email() {
    const ACCOUNT: &str = "signed-out-user@adgitter.app";
    let _fx = setup(FallbackIdentity::from_account_email(ACCOUNT));
    let dir = tempfile::TempDir::new().unwrap();
    let p = dir.path();
    let repo = init_repo(p, None);

    // Signed in, git unconfigured: the fallback really is live, so the clear
    // below is proving something rather than passing vacuously.
    let before = commit_file(p, "a.txt", "x", "while signed in").unwrap();
    assert_eq!(author_of(&repo, &before).1, ACCOUNT, "precondition");

    // ── sign out ────────────────────────────────────────────────────────────
    set_fallback_identity(None);

    // With git still unconfigured there is no identity at all, so the commit is
    // refused outright. The refusal matters as much as the address: it must not
    // write a commit "anonymously" either.
    let err = commit_file(p, "b.txt", "y", "after sign-out").unwrap_err();
    assert!(
        !err.contains(ACCOUNT),
        "the error leaked the address: {err}"
    );
    assert_eq!(
        repo.head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .id()
            .to_string(),
        before,
        "a refused commit must not have moved HEAD"
    );

    // Now the realistic post-sign-out case: the user configures git and carries
    // on working. The commit must be authored — and committed — as *them*.
    {
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Ada Lovelace").unwrap();
        cfg.set_str("user.email", "ada@employer.example").unwrap();
    }
    let after = commit_file(p, "c.txt", "z", "after configuring git").unwrap();
    let (name, email) = author_of(&repo, &after);
    assert_eq!(email, "ada@employer.example");
    assert_eq!(name, "Ada Lovelace");

    // The whole history, author *and* committer: the account address appears
    // exactly once — on the commit made while genuinely signed in.
    let mut walk = repo.revwalk().unwrap();
    walk.push_head().unwrap();
    let mut seen = 0;
    for oid in walk {
        let c = repo.find_commit(oid.unwrap()).unwrap();
        if c.id().to_string() == before {
            seen += 1;
            continue;
        }
        assert_ne!(
            c.author().email(),
            Some(ACCOUNT),
            "commit {} was authored as the signed-out account",
            c.id()
        );
        assert_ne!(
            c.committer().email(),
            Some(ACCOUNT),
            "commit {} was committed as the signed-out account",
            c.id()
        );
    }
    assert_eq!(seen, 1, "the signed-in commit should still be in history");
}

/// …and the app stops *offering* the address too: with the fallback cleared,
/// the pre-commit status reports no account identity, so the UI cannot announce
/// (or quietly imply) an address the user has signed out of.
#[test]
fn the_identity_status_offers_no_account_address_after_sign_out() {
    let _fx = setup(FallbackIdentity::from_account_email("gone@adgitter.app"));
    let dir = tempfile::TempDir::new().unwrap();
    let p = dir.path();
    let _repo = init_repo(p, None);

    assert_eq!(
        identity_status(p.to_path_buf()).unwrap().source,
        IdentitySource::Account,
        "precondition: the account address is on offer while signed in"
    );

    set_fallback_identity(None);

    let status = identity_status(p.to_path_buf()).unwrap();
    assert_eq!(status.source, IdentitySource::None);
    assert_eq!(status.email, None, "no address may survive sign-out");
    assert_eq!(status.name, None);
}
