//! Repository lifecycle — classify a path, init a new repo, clone a remote.
//!
//! These are the onboarding entry points. `probe_path` is read-only and drives
//! the Welcome dialog routing (open vs. init vs. clone). `init_repository` and
//! `clone_repository` are the first *creating* operations: they make a brand-new
//! repo at a target path (no existing history to back up, so no mutation lock).
//! Clone authentication goes through libgit2 `RemoteCallbacks`; a partial clone
//! is cleaned up on failure and credentials are never logged.

use std::cell::RefCell;
use std::path::{Path, PathBuf};

use git2::{
    build::RepoBuilder, Cred, CredentialType, FetchOptions, RemoteCallbacks, Repository,
    SubmoduleUpdateOptions,
};
use serde::{Deserialize, Serialize};

use crate::error::{AdgitterError, AdgitterResult};

/// How a chosen path classifies for the onboarding flow.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProbeKind {
    /// The path is, or (when non-empty) sits inside, a working copy → open it.
    Repo,
    /// An empty directory → offer to init.
    Empty,
    /// A non-empty directory that is not a repo → offer to init (with care).
    Nonrepo,
}

/// Result of [`probe_path`]: the classification plus the echoed path.
#[derive(Debug, Clone, Serialize)]
pub struct ProbeResult {
    pub kind: ProbeKind,
    pub path: String,
}

/// Credentials for [`clone_repository`], deserialized from the clone dialog.
/// Tagged by `kind`: `none` | `password` | `ssh`.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum CloneAuth {
    /// No authentication (public repo / `file://`).
    None,
    /// HTTPS username + password or personal-access-token.
    Password { username: String, password: String },
    /// SSH private-key file with an optional passphrase.
    Ssh {
        username: String,
        key_path: String,
        #[serde(default)]
        passphrase: Option<String>,
    },
}

fn dir_is_empty(path: &Path) -> AdgitterResult<bool> {
    Ok(std::fs::read_dir(path)?.next().is_none())
}

/// Conventional default SSH private-key locations, checked in the order the
/// `ssh` CLI itself prefers (newest/strongest key type first) when no
/// `IdentityFile` is configured. Relative to `$HOME`.
const DEFAULT_SSH_KEYS: [&str; 3] = [".ssh/id_ed25519", ".ssh/id_ecdsa", ".ssh/id_rsa"];

/// PATs only travel over HTTPS. Convert conventional public-host SSH URLs
/// without guessing the HTTPS endpoint of a custom server or SSH alias.
pub(crate) fn authenticated_url(url: &str, auth: &CloneAuth) -> AdgitterResult<String> {
    let url = url.trim();
    if !matches!(auth, CloneAuth::Password { .. }) {
        return Ok(url.to_string());
    }
    if url.starts_with("https://") {
        return Ok(url.to_string());
    }
    let ssh = url.strip_prefix("ssh://");
    let target = ssh.unwrap_or(url);
    let target = target.strip_prefix("git@").or_else(|| ssh.map(|_| target));
    if let Some(target) = target {
        let split = if ssh.is_some() {
            target.split_once('/')
        } else {
            target.split_once(':')
        };
        if let Some((host, path)) = split {
            if ["github.com", "gitlab.com", "bitbucket.org"].contains(&host)
                && !path.is_empty()
                && path
                    .split('/')
                    .all(|part| !part.is_empty() && part != "." && part != "..")
                && path
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "-._/".contains(c))
            {
                return Ok(format!("https://{host}/{path}"));
            }
        }
    }
    Err(git2::Error::from_str(
        "PAT authentication requires an HTTPS remote URL; configure the HTTPS URL for this server",
    )
    .into())
}

/// Wire `auth` into a remote callback set — shared by clone / fetch / push.
/// Always registers a callback (previously this no-op'd for `CloneAuth::None`,
/// which left SSH remotes with no way to authenticate at all: without a
/// credentials callback libgit2 can't try the ssh-agent or a default key
/// file, it just fails the handshake outright).
///
/// Dispatch is on `allowed` — the credential type libgit2 is asking for on
/// *this* callback invocation — rather than on `auth` alone, because a
/// single SSH connection round-trips through the callback multiple times
/// (first USERNAME, then one or more SSH_KEY attempts) with different
/// `allowed` masks each time. Per-method state (`tried_agent`, `key_idx`,
/// `pw_attempts`) is tracked independently so a USERNAME round-trip — which
/// must always succeed and must never count as a failed attempt — can't
/// exhaust the SSH_KEY or password retry budgets.
pub(crate) fn set_credentials(cb: &mut RemoteCallbacks<'_>, auth: CloneAuth) {
    cb.credentials(credential_callback(auth));
}

fn pat_username<'a>(url: &str, fallback: &'a str) -> &'a str {
    let host = url
        .strip_prefix("https://")
        .and_then(|u| u.split('/').next())
        .unwrap_or("");
    match host {
        "github.com" => "x-access-token",
        "gitlab.com" => "oauth2",
        "bitbucket.org" => "x-token-auth",
        _ => fallback,
    }
}

/// Lower-cased `host[:port]` of an `https://` URL (userinfo stripped), or
/// `None` for any other scheme.
fn https_host(url: &str) -> Option<String> {
    let rest = url.trim().strip_prefix("https://")?;
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = authority.rsplit('@').next().unwrap_or("");
    (!host.is_empty()).then(|| host.to_ascii_lowercase())
}

fn credential_callback(
    auth: CloneAuth,
) -> impl FnMut(&str, Option<&str>, CredentialType) -> Result<Cred, git2::Error> {
    let mut tried_agent = false;
    let mut key_idx = 0usize;
    let mut pw_attempts = 0u8;
    // The host the PAT was first handed to. A token is only ever sent back to
    // that same host, so a redirect elsewhere can't harvest it.
    let mut pat_host: Option<String> = None;

    move |url, username_from_url, allowed| {
        // Explicit PAT credentials take priority over every transport fallback.
        if let CloneAuth::Password { username, password } = &auth {
            let Some(host) = https_host(url) else {
                return Err(git2::Error::from_str(
                    "PAT authentication requires HTTPS; SSH fallback is disabled",
                ));
            };
            match &pat_host {
                None => pat_host = Some(host),
                Some(pinned) if *pinned != host => {
                    return Err(git2::Error::from_str(
                        "refusing to send the access token to a different host",
                    ));
                }
                Some(_) => {}
            }
            let username = pat_username(url, username);
            if allowed.contains(CredentialType::USER_PASS_PLAINTEXT) {
                pw_attempts += 1;
                return if pw_attempts > 3 {
                    Err(git2::Error::from_str("authentication failed"))
                } else {
                    Cred::userpass_plaintext(username, password)
                };
            }
            if allowed.contains(CredentialType::USERNAME) {
                return Cred::username(username);
            }
            return Err(git2::Error::from_str("PAT authentication requires HTTPS username/password authentication; SSH fallback is disabled"));
        }
        if allowed.contains(CredentialType::USERNAME) {
            // libgit2 asking "who are you connecting as" before it has even
            // picked an auth method (typical for `git@host` URLs with no
            // explicit user) — answer it and let the next round-trip pick
            // the real credential type. Not a real attempt.
            return Cred::username(username_from_url.unwrap_or("git"));
        }

        if allowed.contains(CredentialType::SSH_KEY) {
            if let CloneAuth::Ssh {
                username,
                key_path,
                passphrase,
            } = &auth
            {
                return Cred::ssh_key(
                    username_from_url.unwrap_or(username),
                    None,
                    Path::new(key_path),
                    passphrase.as_deref(),
                );
            }
            // The clone/fetch/push dialogs have no SSH-key-path field yet —
            // they send `none` even for a `git@github.com:...`
            // remote. Mimic what the `git` CLI does in that situation: ask
            // ssh-agent first, then fall back through the conventional
            // default key files, each tried at most once.
            let user = username_from_url.unwrap_or("git");
            if !tried_agent {
                tried_agent = true;
                if let Ok(cred) = Cred::ssh_key_from_agent(user) {
                    return Ok(cred);
                }
            }
            while key_idx < DEFAULT_SSH_KEYS.len() {
                let rel = DEFAULT_SSH_KEYS[key_idx];
                key_idx += 1;
                let Some(home) = dirs::home_dir() else {
                    continue;
                };
                let path = home.join(rel);
                if path.is_file() {
                    return Cred::ssh_key(user, None, &path, None);
                }
            }
            return Err(git2::Error::from_str(
                "no SSH key available (agent and default key files exhausted)",
            ));
        }

        if allowed.contains(CredentialType::USER_PASS_PLAINTEXT) {
            return Err(git2::Error::from_str("authentication required"));
        }

        if allowed.contains(CredentialType::DEFAULT) {
            return Cred::default();
        }

        Err(git2::Error::from_str("no supported authentication method"))
    }
}

/// Classify a chosen folder so the Welcome flow can route to open/init/clone.
pub fn probe_path(path: PathBuf) -> AdgitterResult<ProbeResult> {
    if !path.is_dir() {
        return Err(AdgitterError::InvalidPath(path.display().to_string()));
    }
    // Emptiness wins over `discover`: an empty folder that merely sits inside
    // some parent repo (e.g. a dotfiles-tracked $HOME) is a fresh spot for a
    // new repo or a clone, not that parent repo.
    let kind = if dir_is_empty(&path)? {
        ProbeKind::Empty
    } else if Repository::discover(&path).is_ok() {
        ProbeKind::Repo
    } else {
        ProbeKind::Nonrepo
    };
    Ok(ProbeResult {
        kind,
        path: path.display().to_string(),
    })
}

/// Initialize a new repository at `path` (creating the directory if needed).
pub fn init_repository(path: PathBuf) -> AdgitterResult<()> {
    if path.exists() && !path.is_dir() {
        return Err(AdgitterError::InvalidPath(path.display().to_string()));
    }
    std::fs::create_dir_all(&path)?;
    Repository::init(&path)?;
    Ok(())
}

/// Clone `url` into `dest`, authenticating per `auth` and reporting transfer
/// progress as `(received_objects, total_objects)`. Refuses a non-empty `dest`
/// and removes a partial clone on failure.
pub fn clone_repository<P: FnMut(usize, usize)>(
    url: String,
    dest: PathBuf,
    auth: CloneAuth,
    on_progress: P,
) -> AdgitterResult<()> {
    clone_repository_with(url, dest, auth, false, on_progress)
}

/// [`clone_repository`] with an optional `recursive` pass: when set, every
/// submodule (and their submodules, depth-first) is initialized and checked
/// out after the superproject clone, the way `git clone --recursive` does.
/// A failure anywhere — superproject or submodule — removes the whole clone.
pub fn clone_repository_with<P: FnMut(usize, usize)>(
    url: String,
    dest: PathBuf,
    auth: CloneAuth,
    recursive: bool,
    on_progress: P,
) -> AdgitterResult<()> {
    if dest.exists() && !dir_is_empty(&dest)? {
        return Err(AdgitterError::InvalidPath(format!(
            "destination is not empty: {}",
            dest.display()
        )));
    }
    let url = authenticated_url(&url, &auth)?;
    let dest_pre_existed = dest.exists();

    let submodule_auth = recursive.then(|| auth.clone());
    // Shared so the submodule pass keeps reporting progress after the
    // superproject transfer reaches 100%.
    let on_progress = RefCell::new(on_progress);
    let mut cb = RemoteCallbacks::new();
    set_credentials(&mut cb, auth);
    cb.transfer_progress(|stats| {
        (on_progress.borrow_mut())(stats.received_objects(), stats.total_objects());
        true
    });

    let mut fo = FetchOptions::new();
    fo.remote_callbacks(cb);
    let mut builder = RepoBuilder::new();
    builder.fetch_options(fo);

    let result = builder
        .clone(&url, &dest)
        .map_err(AdgitterError::from)
        .and_then(|repo| match &submodule_auth {
            Some(auth) => {
                update_submodules_recursive(&repo, auth, https_host(&url).as_deref(), &on_progress)
            }
            None => Ok(()),
        });

    match result {
        Ok(()) => Ok(()),
        Err(e) => {
            // Best-effort cleanup of whatever the failed clone left behind.
            if dest_pre_existed {
                // The folder was empty before (checked above), so everything
                // in it now came from this clone — remove all of it, not just
                // `.git`, or the checkout is left behind as an orphan tree.
                if let Ok(entries) = std::fs::read_dir(&dest) {
                    for entry in entries.flatten() {
                        let p = entry.path();
                        let _ = if p.is_dir() && !p.is_symlink() {
                            std::fs::remove_dir_all(&p)
                        } else {
                            std::fs::remove_file(&p)
                        };
                    }
                }
            } else {
                let _ = std::fs::remove_dir_all(&dest);
            }
            Err(e)
        }
    }
}

/// The credentials a submodule at `sm_url` may use, given the parent's `auth`
/// and the https host the parent was fetched from. A PAT is scoped to the host
/// it was entered for: a submodule on any other host (or over ssh) gets
/// `None` — anonymous https, or the ssh-agent / default keys for ssh — so the
/// token never reaches a server named by a repo's `.gitmodules`.
fn submodule_auth(
    auth: &CloneAuth,
    parent_host: Option<&str>,
    sm_url: &str,
) -> (CloneAuth, Option<String>) {
    let relative = sm_url.starts_with("./") || sm_url.starts_with("../");
    let host = if relative {
        parent_host.map(str::to_owned)
    } else {
        https_host(sm_url)
    };
    let auth = match auth {
        CloneAuth::Password { .. } if host.is_none() || host.as_deref() != parent_host => {
            CloneAuth::None
        }
        other => other.clone(),
    };
    (auth, host)
}

/// Init + update every submodule of `repo`, then recurse into each one.
/// Transfer progress keeps flowing to `on_progress` (it restarts per
/// submodule, so the dialog shows activity instead of a frozen 100%).
fn update_submodules_recursive<P: FnMut(usize, usize)>(
    repo: &Repository,
    auth: &CloneAuth,
    parent_host: Option<&str>,
    on_progress: &RefCell<P>,
) -> AdgitterResult<()> {
    for mut sm in repo.submodules()? {
        let (auth, host) = submodule_auth(auth, parent_host, sm.url().unwrap_or(""));
        let mut cb = RemoteCallbacks::new();
        set_credentials(&mut cb, auth.clone());
        cb.transfer_progress(|stats| {
            (on_progress.borrow_mut())(stats.received_objects(), stats.total_objects());
            true
        });
        let mut fo = FetchOptions::new();
        fo.remote_callbacks(cb);
        let mut opts = SubmoduleUpdateOptions::new();
        opts.fetch(fo);
        sm.update(true, Some(&mut opts))?;
        let sub = sm.open()?;
        update_submodules_recursive(&sub, &auth, host.as_deref(), on_progress)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;

    fn init_repo(dir: &Path) -> Repository {
        let repo = Repository::init(dir).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Tester").unwrap();
        cfg.set_str("user.email", "t@example.com").unwrap();
        repo
    }

    fn commit(dir: &Path, name: &str, content: &str) -> String {
        fs::write(dir.join(name), content).unwrap();
        crate::workdir::stage(dir.to_path_buf(), vec![name.to_string()]).unwrap();
        crate::workdir::commit(dir.to_path_buf(), format!("add {name}"), false).unwrap()
    }

    #[test]
    fn probe_classifies_a_repo_directory() {
        let dir = tempfile::TempDir::new().unwrap();
        init_repo(dir.path());
        let r = probe_path(dir.path().to_path_buf()).unwrap();
        assert_eq!(r.kind, ProbeKind::Repo);
    }

    #[test]
    fn probe_classifies_a_subdir_of_a_repo_as_repo() {
        let dir = tempfile::TempDir::new().unwrap();
        init_repo(dir.path());
        let sub = dir.path().join("nested");
        fs::create_dir_all(&sub).unwrap();
        fs::write(sub.join("file.txt"), "x").unwrap();
        assert_eq!(probe_path(sub).unwrap().kind, ProbeKind::Repo);
    }

    #[test]
    fn probe_classifies_an_empty_subdir_of_a_repo_as_empty() {
        let dir = tempfile::TempDir::new().unwrap();
        init_repo(dir.path());
        let sub = dir.path().join("fresh");
        fs::create_dir_all(&sub).unwrap();
        assert_eq!(probe_path(sub).unwrap().kind, ProbeKind::Empty);
    }

    fn pat() -> CloneAuth {
        CloneAuth::Password {
            username: "u".into(),
            password: "secret".into(),
        }
    }

    #[test]
    fn https_host_extracts_lowercased_authority() {
        assert_eq!(
            https_host("https://GitHub.com/a/b.git").as_deref(),
            Some("github.com")
        );
        assert_eq!(
            https_host("https://u:p@host:8443/x").as_deref(),
            Some("host:8443")
        );
        assert_eq!(https_host("git@github.com:a/b.git"), None);
        assert_eq!(https_host("http://github.com/a"), None);
    }

    #[test]
    fn submodule_pat_is_scoped_to_the_parent_host() {
        let same = submodule_auth(&pat(), Some("github.com"), "https://github.com/o/lib.git");
        assert!(matches!(same.0, CloneAuth::Password { .. }));

        let rel = submodule_auth(&pat(), Some("github.com"), "../lib.git");
        assert!(matches!(rel.0, CloneAuth::Password { .. }));
        assert_eq!(rel.1.as_deref(), Some("github.com"));

        let other = submodule_auth(&pat(), Some("github.com"), "https://attacker.example/x.git");
        assert!(matches!(other.0, CloneAuth::None));

        let ssh = submodule_auth(&pat(), Some("github.com"), "git@github.com:o/lib.git");
        assert!(matches!(ssh.0, CloneAuth::None));
    }

    #[test]
    fn pat_callback_refuses_a_second_host() {
        let mut cb = credential_callback(pat());
        assert!(cb(
            "https://github.com/o/r.git",
            None,
            CredentialType::USER_PASS_PLAINTEXT
        )
        .is_ok());
        assert!(cb(
            "https://evil.example/o/r.git",
            None,
            CredentialType::USER_PASS_PLAINTEXT
        )
        .is_err());
    }

    #[test]
    fn probe_classifies_empty_and_nonrepo_directories() {
        let empty = tempfile::TempDir::new().unwrap();
        assert_eq!(
            probe_path(empty.path().to_path_buf()).unwrap().kind,
            ProbeKind::Empty
        );

        let nonrepo = tempfile::TempDir::new().unwrap();
        fs::write(nonrepo.path().join("readme.txt"), "hi").unwrap();
        assert_eq!(
            probe_path(nonrepo.path().to_path_buf()).unwrap().kind,
            ProbeKind::Nonrepo
        );
    }

    #[test]
    fn probe_rejects_a_nonexistent_path() {
        let missing = tempfile::TempDir::new().unwrap().path().join("nope");
        assert!(matches!(
            probe_path(missing),
            Err(AdgitterError::InvalidPath(_))
        ));
    }

    #[test]
    fn init_creates_a_valid_unborn_repo() {
        let dir = tempfile::TempDir::new().unwrap();
        let target = dir.path().join("fresh");
        init_repository(target.clone()).unwrap();

        let repo = Repository::open(&target).unwrap();
        // A fresh repo has no commits yet → HEAD is unborn.
        assert!(repo.head().is_err());
        assert_eq!(probe_path(target).unwrap().kind, ProbeKind::Repo);
    }

    #[test]
    fn clone_from_a_local_file_url_succeeds() {
        let src = tempfile::TempDir::new().unwrap();
        init_repo(src.path());
        let sha = commit(src.path(), "a.txt", "hello");

        let dest_dir = tempfile::TempDir::new().unwrap();
        let dest = dest_dir.path().join("cloned"); // must not exist yet
        let url = format!("file://{}", src.path().display());

        let mut last = (0usize, 0usize);
        clone_repository(url, dest.clone(), CloneAuth::None, |r, t| last = (r, t)).unwrap();

        let repo = Repository::open(&dest).unwrap();
        assert_eq!(
            repo.head()
                .unwrap()
                .peel_to_commit()
                .unwrap()
                .id()
                .to_string(),
            sha
        );
        assert!(last.1 > 0, "transfer progress was reported");
    }

    /// A superproject at `sup` whose `libs/sub` submodule points at `sub`
    /// (which itself carries `sub.txt`). Returns the superproject's URL.
    fn superproject_with_submodule(sup: &Path, sub: &Path) -> String {
        init_repo(sub);
        commit(sub, "sub.txt", "from the submodule");

        let repo = init_repo(sup);
        commit(sup, "top.txt", "top");
        let sub_url = format!("file://{}", sub.display());
        let mut sm = repo
            .submodule(&sub_url, Path::new("libs/sub"), true)
            .unwrap();
        sm.clone(None).unwrap();
        sm.add_finalize().unwrap();

        let mut index = repo.index().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = repo.signature().unwrap();
        let parent = repo.head().unwrap().peel_to_commit().unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "add submodule", &tree, &[&parent])
            .unwrap();
        format!("file://{}", sup.display())
    }

    #[test]
    fn recursive_clone_checks_out_submodules() {
        let sup = tempfile::TempDir::new().unwrap();
        let sub = tempfile::TempDir::new().unwrap();
        let url = superproject_with_submodule(sup.path(), sub.path());

        let dest_dir = tempfile::TempDir::new().unwrap();
        let dest = dest_dir.path().join("cloned");
        clone_repository_with(url, dest.clone(), CloneAuth::None, true, |_, _| {}).unwrap();

        assert_eq!(
            fs::read_to_string(dest.join("libs/sub/sub.txt")).unwrap(),
            "from the submodule"
        );
    }

    #[test]
    fn non_recursive_clone_leaves_submodules_unpopulated() {
        let sup = tempfile::TempDir::new().unwrap();
        let sub = tempfile::TempDir::new().unwrap();
        let url = superproject_with_submodule(sup.path(), sub.path());

        let dest_dir = tempfile::TempDir::new().unwrap();
        let dest = dest_dir.path().join("cloned");
        clone_repository_with(url, dest.clone(), CloneAuth::None, false, |_, _| {}).unwrap();

        assert!(dest.join("top.txt").exists());
        assert!(!dest.join("libs/sub/sub.txt").exists());
    }

    #[test]
    fn clone_with_a_bad_url_errors_and_cleans_up() {
        let dest_dir = tempfile::TempDir::new().unwrap();
        let dest = dest_dir.path().join("cloned");
        let res = clone_repository(
            "file:///no/such/repo/here".into(),
            dest.clone(),
            CloneAuth::None,
            |_, _| {},
        );
        assert!(res.is_err());
        assert!(!dest.exists(), "partial clone was cleaned up");
    }

    #[test]
    fn failed_submodule_into_existing_empty_dest_leaves_it_empty() {
        let sup = tempfile::TempDir::new().unwrap();
        let sub = tempfile::TempDir::new().unwrap();
        let url = superproject_with_submodule(sup.path(), sub.path());
        // Make the submodule fetch fail after the superproject checked out.
        fs::remove_dir_all(sub.path()).unwrap();

        let dest = tempfile::TempDir::new().unwrap();
        let res = clone_repository_with(
            url,
            dest.path().to_path_buf(),
            CloneAuth::None,
            true,
            |_, _| {},
        );
        assert!(res.is_err());
        assert!(dest.path().exists(), "the user's folder itself is kept");
        assert!(
            dir_is_empty(dest.path()).unwrap(),
            "checkout and partial submodules are removed, not just .git"
        );
    }

    #[test]
    fn clone_refuses_a_non_empty_destination() {
        let dest_dir = tempfile::TempDir::new().unwrap();
        fs::write(dest_dir.path().join("keep.txt"), "x").unwrap();
        let res = clone_repository(
            "file:///whatever".into(),
            dest_dir.path().to_path_buf(),
            CloneAuth::None,
            |_, _| {},
        );
        assert!(matches!(res, Err(AdgitterError::InvalidPath(_))));
        assert!(
            dest_dir.path().join("keep.txt").exists(),
            "existing files untouched"
        );
    }

    /// Proves the built libgit2 actually carries an HTTPS/TLS transport — the
    /// regression this guards was `default-features = false` on the `git2`
    /// dependency silently stripping the `https` feature, which made every
    /// https:// remote (clone/fetch/pull/push, and PAT auth with them) fail
    /// before credentials were even sent. All other tests use `file://` URLs
    /// and can't catch it. Ignored by default: needs network — run with
    /// `cargo test -p git-core -- --ignored`.
    #[test]
    #[ignore = "requires network access"]
    fn clones_a_public_https_repo() {
        let dir = tempfile::TempDir::new().unwrap();
        let dest = dir.path().join("clone");
        clone_repository(
            "https://github.com/octocat/Hello-World.git".into(),
            dest.clone(),
            CloneAuth::None,
            |_, _| {},
        )
        .unwrap();
        assert!(dest.join(".git").is_dir());
    }

    /// SSH counterpart to `clones_a_public_https_repo`: proves a `git@…`
    /// remote actually authenticates end-to-end via `set_credentials`'s
    /// agent/default-key fallback, with `CloneAuth::None` — the same "no key
    /// path configured in the app" case a real user hits. Ignored by
    /// default: needs network *and* a reachable ssh-agent or a default key
    /// registered with a GitHub account — run with
    /// `cargo test -p git-core -- --ignored`.
    #[test]
    #[ignore = "requires network access and an ssh agent/key"]
    fn clones_a_public_repo_over_ssh() {
        let dir = tempfile::TempDir::new().unwrap();
        let dest = dir.path().join("clone");
        clone_repository(
            "git@github.com:octocat/Hello-World.git".into(),
            dest.clone(),
            CloneAuth::None,
            |_, _| {},
        )
        .unwrap();
        assert!(dest.join(".git").is_dir());
    }

    /// Regression guard for the git2 feature list in the workspace root
    /// `Cargo.toml`: `default-features = false` silently drops whichever
    /// transport isn't explicitly re-listed, and a dropped transport fails
    /// at URL-scheme selection — before the credentials callback ever runs —
    /// so the breakage is invisible until someone happens to use the
    /// affected scheme. Assert both transports are actually compiled in so
    /// a future re-strip of the feature list fails `cargo test`, not a
    /// user's clone.
    #[test]
    fn libgit2_has_https_and_ssh_transports() {
        let v = git2::Version::get();
        assert!(v.https(), "libgit2 was built without HTTPS support");
        assert!(v.ssh(), "libgit2 was built without SSH support");
    }
}

#[cfg(test)]
mod pat_priority_tests {
    use super::*;
    fn pat() -> CloneAuth {
        CloneAuth::Password {
            username: "oauth2".into(),
            password: "test-pat".into(),
        }
    }
    #[test]
    fn pat_never_falls_back_to_ssh_or_default() {
        let mut callback = credential_callback(pat());
        for allowed in [CredentialType::SSH_KEY, CredentialType::DEFAULT] {
            assert!(callback("ssh://git@gitlab.com/u/r.git", Some("git"), allowed).is_err());
        }
        let cred = callback(
            "https://gitlab.com/u/r.git",
            Some("git"),
            CredentialType::SSH_KEY | CredentialType::USER_PASS_PLAINTEXT,
        )
        .unwrap();
        assert_eq!(cred.credtype(), CredentialType::USER_PASS_PLAINTEXT.bits());
        for _ in 0..2 {
            assert!(callback(
                "https://gitlab.com/u/r.git",
                None,
                CredentialType::USER_PASS_PLAINTEXT
            )
            .is_ok());
        }
        assert!(callback(
            "https://gitlab.com/u/r.git",
            None,
            CredentialType::USER_PASS_PLAINTEXT
        )
        .is_err());
    }
    #[test]
    fn pat_username_follows_final_endpoint() {
        assert_eq!(
            pat_username("https://bitbucket.org/u/r.git", "oauth2"),
            "x-token-auth"
        );
        assert_eq!(
            pat_username("https://gitlab.com/u/r.git", "x-access-token"),
            "oauth2"
        );
        assert_eq!(
            pat_username("https://custom.example/u/r.git", "custom-user"),
            "custom-user"
        );
    }
    #[test]
    fn ssh_urls_use_https_only_when_pat_is_supplied() {
        for host in ["github.com", "gitlab.com", "bitbucket.org"] {
            for url in [
                format!("git@{host}:u/r.git"),
                format!("ssh://git@{host}/u/r.git"),
                format!("ssh://{host}/u/r.git"),
            ] {
                assert_eq!(
                    authenticated_url(&url, &pat()).unwrap(),
                    format!("https://{host}/u/r.git")
                );
                assert_eq!(authenticated_url(&url, &CloneAuth::None).unwrap(), url);
            }
        }
        for url in [
            "git@custom.example:u/r.git",
            "ssh://git@github.com:22/u/r.git",
            "git@github.com:../r.git",
            "http://github.com/u/r.git",
        ] {
            assert!(authenticated_url(url, &pat()).is_err());
        }
    }
}
