//! Reading and writing Git's `user.name` and `user.email` at both scopes.
//!
//! Each scope is addressed on its own config level — global reads only
//! `~/.gitconfig` (or XDG), project reads only the repo's `.git/config` — so the
//! UI can show what each level holds instead of the merged value that
//! [`crate::identity`] resolves at commit time.
//!
//! ## Privacy
//!
//! The address is PII. It is never put in an error message or logged.

use std::path::{Path, PathBuf};

use git2::{Config, ConfigLevel};
use serde::{Deserialize, Serialize};

use crate::error::{AdgitterError, AdgitterResult};
use crate::git::open_repo;

const NAME_KEY: &str = "user.name";
const EMAIL_KEY: &str = "user.email";

/// The Git name and email held at each scope. `None` means the key is unset.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitEmailConfig {
    pub global: Option<String>,
    pub global_name: Option<String>,
    pub project: Option<String>,
    pub project_name: Option<String>,
}

/// Which config level a write targets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GitEmailScope {
    Global,
    Project,
}

/// Read `user.name` and `user.email` from global and, when `repo_path` is
/// given, repository-local config. A missing file or key yields `None`.
pub fn read_git_email(repo_path: Option<PathBuf>) -> AdgitterResult<GitEmailConfig> {
    let (global, global_name) = match global_config_path() {
        Some(p) => (read_key_at(&p, EMAIL_KEY)?, read_key_at(&p, NAME_KEY)?),
        None => (None, None),
    };
    let (project, project_name) = match repo_path {
        Some(p) => (read_local(&p, EMAIL_KEY)?, read_local(&p, NAME_KEY)?),
        None => (None, None),
    };
    Ok(GitEmailConfig {
        global,
        global_name,
        project,
        project_name,
    })
}

/// Set (or, for `None`/empty, remove) `user.email` at the given scope.
///
/// Project scope requires `repo_path`. The address is trimmed and validated;
/// the error never echoes it.
pub fn write_git_email(
    scope: GitEmailScope,
    repo_path: Option<PathBuf>,
    email: Option<String>,
) -> AdgitterResult<()> {
    let email = normalize_email(email)?;
    match scope {
        GitEmailScope::Global => {
            let path = global_config_path().ok_or_else(|| {
                AdgitterError::Internal("cannot locate the global git config".into())
            })?;
            write_key_at(&path, EMAIL_KEY, email.as_deref())
        }
        GitEmailScope::Project => {
            let repo_path = repo_path.ok_or_else(|| {
                AdgitterError::Internal("project scope requires a repository".into())
            })?;
            let mut cfg = local_config(&repo_path)?;
            apply(&mut cfg, EMAIL_KEY, email.as_deref())
        }
    }
}

/// Set or clear `user.name` at the requested config scope.
pub fn write_git_name(
    scope: GitEmailScope,
    repo_path: Option<PathBuf>,
    name: Option<String>,
) -> AdgitterResult<()> {
    let name = normalize_name(name)?;
    match scope {
        GitEmailScope::Global => {
            let path = global_config_path().ok_or_else(|| {
                AdgitterError::Internal("cannot locate the global git config".into())
            })?;
            write_key_at(&path, NAME_KEY, name.as_deref())
        }
        GitEmailScope::Project => {
            let repo_path = repo_path.ok_or_else(|| {
                AdgitterError::Internal("project scope requires a repository".into())
            })?;
            let mut cfg = local_config(&repo_path)?;
            apply(&mut cfg, NAME_KEY, name.as_deref())
        }
    }
}

/// Trim and validate. `Ok(None)` means "clear the entry".
fn normalize_email(email: Option<String>) -> AdgitterResult<Option<String>> {
    let Some(raw) = email else { return Ok(None) };
    let e = raw.trim();
    if e.is_empty() {
        return Ok(None);
    }
    let bad_char = e
        .chars()
        .any(|c| matches!(c, '<' | '>' | '\n' | '\r' | '\0'));
    let valid = !bad_char
        && e.split_once('@')
            .is_some_and(|(local, domain)| !local.is_empty() && !domain.is_empty());
    if !valid {
        return Err(AdgitterError::Internal(
            "invalid email address: expected local@domain".into(),
        ));
    }
    Ok(Some(e.to_string()))
}

fn normalize_name(name: Option<String>) -> AdgitterResult<Option<String>> {
    let Some(raw) = name else { return Ok(None) };
    let n = raw.trim();
    if n.is_empty() {
        return Ok(None);
    }
    if n.chars()
        .any(|c| matches!(c, '<' | '>' | '\n' | '\r' | '\0'))
    {
        return Err(AdgitterError::Internal(
            "invalid Git name: angle brackets and control characters are not allowed".into(),
        ));
    }
    Ok(Some(n.to_string()))
}

/// The global config file to use: the existing one if git finds it, otherwise
/// `$HOME/.gitconfig` (created on first write).
fn global_config_path() -> Option<PathBuf> {
    Config::find_global()
        .ok()
        .or_else(|| dirs::home_dir().map(|h| h.join(".gitconfig")))
}

fn read_key_at(path: &Path, key: &str) -> AdgitterResult<Option<String>> {
    if !path.exists() {
        return Ok(None);
    }
    Ok(Config::open(path)?.get_string(key).ok())
}

fn write_key_at(path: &Path, key: &str, value: Option<&str>) -> AdgitterResult<()> {
    if value.is_none() && !path.exists() {
        return Ok(());
    }
    let mut cfg = Config::open(path)?;
    apply(&mut cfg, key, value)
}

fn apply(cfg: &mut Config, key: &str, value: Option<&str>) -> AdgitterResult<()> {
    match value {
        Some(v) => cfg.set_str(key, v)?,
        None => match cfg.remove(key) {
            Ok(()) => {}
            Err(e) if e.code() == git2::ErrorCode::NotFound => {}
            Err(e) => return Err(e.into()),
        },
    }
    Ok(())
}

/// The repository's own `.git/config`, isolated from global/system levels.
fn local_config(repo_path: &Path) -> AdgitterResult<Config> {
    let repo = open_repo(repo_path)?;
    Ok(repo.config()?.open_level(ConfigLevel::Local)?)
}

fn read_local(repo_path: &Path, key: &str) -> AdgitterResult<Option<String>> {
    Ok(local_config(repo_path)?.get_string(key).ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::Repository;

    fn repo() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        Repository::init(dir.path()).unwrap();
        let p = dir.path().to_path_buf();
        (dir, p)
    }

    #[test]
    fn project_none_then_set_then_clear() {
        let (_d, p) = repo();
        assert_eq!(read_local(&p, EMAIL_KEY).unwrap(), None);
        write_git_email(
            GitEmailScope::Project,
            Some(p.clone()),
            Some("  ada@example.com ".into()),
        )
        .unwrap();
        assert_eq!(
            read_local(&p, EMAIL_KEY).unwrap().as_deref(),
            Some("ada@example.com")
        );
        write_git_email(GitEmailScope::Project, Some(p.clone()), Some("  ".into())).unwrap();
        assert_eq!(read_local(&p, EMAIL_KEY).unwrap(), None);
        // Clearing an absent key is not an error.
        write_git_email(GitEmailScope::Project, Some(p), None).unwrap();
    }

    #[test]
    fn global_helpers_create_read_and_clear() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join(".gitconfig");
        assert_eq!(read_key_at(&file, EMAIL_KEY).unwrap(), None);
        write_key_at(&file, EMAIL_KEY, None).unwrap();
        assert!(!file.exists());
        write_key_at(&file, EMAIL_KEY, Some("g@example.com")).unwrap();
        assert_eq!(
            read_key_at(&file, EMAIL_KEY).unwrap().as_deref(),
            Some("g@example.com")
        );
        write_key_at(&file, EMAIL_KEY, None).unwrap();
        assert_eq!(read_key_at(&file, EMAIL_KEY).unwrap(), None);
        write_key_at(&file, EMAIL_KEY, None).unwrap();
    }

    #[test]
    fn read_without_repo_has_no_project() {
        assert_eq!(read_git_email(None).unwrap().project, None);
    }

    #[test]
    fn invalid_emails_rejected_without_echo() {
        let (_d, p) = repo();
        for bad in ["nope", "@x.com", "a@", "a<b>@x.com", "a@x.com\nb", "a@x\0"] {
            let err = write_git_email(GitEmailScope::Project, Some(p.clone()), Some(bad.into()))
                .unwrap_err();
            assert!(!err.to_string().contains(bad.trim()), "leaked {bad:?}");
        }
        assert_eq!(read_local(&p, EMAIL_KEY).unwrap(), None);
    }

    #[test]
    fn project_scope_requires_repo() {
        assert!(write_git_email(GitEmailScope::Project, None, Some("a@b.c".into())).is_err());
    }
}
