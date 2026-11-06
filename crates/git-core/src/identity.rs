//! Commit-authorship identity resolution (revised 2026-08-18).
//!
//! **The account email is a default, never an override.** A `user.email`
//! configured in git — repo-local first, then global, exactly as
//! `git2::Repository::signature` already resolves it — always wins. The account
//! address registered with ADGitter is consulted *only* when git has no identity
//! at all, which is the newcomer case the licence email exists to smooth over.
//! When neither is available the caller gets the same "not configured" error it
//! always did.
//!
//! Why that ordering is not negotiable: developers legitimately carry several
//! git identities (`includeIf` exists for precisely this), hosts map commits to
//! accounts *by email*, DCO/CLA bots gate on the author address, and PRD User
//! Story 28 promises writes behave like the git CLI. Substituting an address
//! would break all four.
//!
//! ## Why a process-global default rather than a parameter
//!
//! Ten call sites across eight modules build a signature, nearly all of them
//! behind public operations (`commit`, `merge`, `revert`, `rebase`, `purge`, …)
//! whose signatures the Tauri shell mirrors one-for-one. The account address is
//! a single process-wide fact that changes only when the licence does, so
//! threading an `Option<FallbackIdentity>` through every one of those APIs would
//! buy nothing but churn. The shell registers it once (after the licence
//! verifies) via [`set_fallback_identity`]; `git-core` stays framework-agnostic
//! and simply reads it.
//!
//! ## Privacy
//!
//! The address held here is PII. It is never logged, never put in an error
//! message, and never handed to telemetry — it only ever reaches libgit2 as the
//! author/committer of a commit the user asked for. Keep it that way.

use std::sync::RwLock;

use git2::Repository;
use serde::Serialize;

use crate::error::{AdgitterError, AdgitterResult};
use crate::git::open_repo;

/// The error every signature path returns when no identity can be resolved.
/// Deliberately free of any address, so it is safe to log or report.
const NOT_CONFIGURED: &str = "git user.name / user.email is not configured";

/// An identity used **only** when git has none configured.
///
/// `Debug` is hand-written to redact both fields. The derived one would print
/// the address, and `{:?}` is exactly how PII ends up in a log line or a
/// panic message by accident — a `#[derive(Debug)]` here would make every
/// future `tracing::debug!(?identity)` a leak. Read the values through
/// [`FallbackIdentity::email`] / [`FallbackIdentity::name`] when you genuinely
/// need them.
#[derive(Clone, PartialEq, Eq)]
pub struct FallbackIdentity {
    name: String,
    email: String,
}

impl std::fmt::Debug for FallbackIdentity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("FallbackIdentity(<redacted>)")
    }
}

impl FallbackIdentity {
    /// Build a fallback from an account email alone.
    ///
    /// The licence carries an address and no display name, so the name is
    /// derived from the local part (`ada@example.com` → `ada`). That is what a
    /// bare `git config user.name` omission would otherwise cost the user, it is
    /// stable offline, and it never invents a person's name. Callers that *do*
    /// know a display name should use [`FallbackIdentity::new`].
    ///
    /// Returns `None` for anything that is not usable as a git author address —
    /// empty, no `@`, an empty local part, or containing the `<`/`>`/newline
    /// characters that would corrupt a commit header. A malformed value must
    /// degrade to "no fallback" (i.e. the ordinary not-configured error) rather
    /// than write a broken commit object.
    pub fn from_account_email(email: &str) -> Option<Self> {
        let email = email.trim();
        let (local, domain) = email.split_once('@')?;
        if local.is_empty() || domain.is_empty() {
            return None;
        }
        Self::new(local, email)
    }

    /// Build a fallback from an explicit name and email, validating both.
    pub fn new(name: &str, email: &str) -> Option<Self> {
        let name = name.trim();
        let email = email.trim();
        if name.is_empty() || email.is_empty() {
            return None;
        }
        if [name, email]
            .iter()
            .any(|s| s.contains(['<', '>', '\n', '\r', '\0']))
        {
            return None;
        }
        Some(Self {
            name: name.to_string(),
            email: email.to_string(),
        })
    }

    /// The address that would be used when git has no identity.
    pub fn email(&self) -> &str {
        &self.email
    }

    /// The display name that would be used when git has no identity.
    pub fn name(&self) -> &str {
        &self.name
    }
}

/// Process-wide account default. `None` (signed out, or a licence with no email
/// claim) restores the pre-fallback behaviour exactly.
static FALLBACK: RwLock<Option<FallbackIdentity>> = RwLock::new(None);

/// Register (or clear, with `None`) the account identity used when git has no
/// `user.email`. Called by the shell whenever the licence state changes.
pub fn set_fallback_identity(identity: Option<FallbackIdentity>) {
    if let Ok(mut guard) = FALLBACK.write() {
        *guard = identity;
    }
}

/// The currently registered account default, if any.
pub fn fallback_identity() -> Option<FallbackIdentity> {
    FALLBACK.read().ok().and_then(|g| g.clone())
}

/// Where a commit's author/committer address came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum IdentitySource {
    /// `user.email` is configured in git (repo-local or global). The account
    /// address is not involved.
    Git,
    /// Git has no identity; the ADGitter account address will be used.
    Account,
    /// Neither is available — committing will fail until one is set.
    None,
}

/// What identity the next commit in a repo would carry, for the UI to show
/// *before* anything is written. Returning the address is intentional: it is the
/// user's own, shown back to them in their own app.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityStatus {
    pub source: IdentitySource,
    pub name: Option<String>,
    pub email: Option<String>,
}

/// Resolve the signature for a commit: git's configured identity first, the
/// account default only if git has none, else the long-standing error.
pub(crate) fn signature_for(repo: &Repository) -> AdgitterResult<git2::Signature<'static>> {
    if let Ok(sig) = repo.signature() {
        return Ok(sig);
    }
    fallback_signature().ok_or_else(|| AdgitterError::Internal(NOT_CONFIGURED.into()))
}

/// Like [`signature_for`] but yielding `None` instead of an error, for the
/// background paths that have their own last-resort placeholder.
pub(crate) fn signature_or_none(repo: &Repository) -> Option<git2::Signature<'static>> {
    repo.signature().ok().or_else(fallback_signature)
}

/// Turn the registered account default into a libgit2 signature. `None` when
/// nothing is registered, or when libgit2 rejects the value anyway.
fn fallback_signature() -> Option<git2::Signature<'static>> {
    let id = fallback_identity()?;
    git2::Signature::now(&id.name, &id.email).ok()
}

/// Report which identity `repo_path` would commit under, without committing.
///
/// This is what makes the substitution honest: the UI calls it before a commit
/// and tells the user when the account address is about to stand in for a
/// missing `user.email` ("the app says so when it does").
pub fn identity_status(repo_path: std::path::PathBuf) -> AdgitterResult<IdentityStatus> {
    let repo = open_repo(&repo_path)?;
    Ok(status_of(&repo))
}

fn status_of(repo: &Repository) -> IdentityStatus {
    if let Ok(sig) = repo.signature() {
        return IdentityStatus {
            source: IdentitySource::Git,
            name: sig.name().map(str::to_string),
            email: sig.email().map(str::to_string),
        };
    }
    match fallback_identity() {
        Some(id) => IdentityStatus {
            source: IdentitySource::Account,
            name: Some(id.name),
            email: Some(id.email),
        },
        None => IdentityStatus {
            source: IdentitySource::None,
            name: None,
            email: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_is_derived_from_the_email_local_part() {
        let id = FallbackIdentity::from_account_email("ada.lovelace@example.com").unwrap();
        assert_eq!(id.name(), "ada.lovelace");
        assert_eq!(id.email(), "ada.lovelace@example.com");
    }

    #[test]
    fn surrounding_whitespace_is_trimmed() {
        let id = FallbackIdentity::from_account_email("  ada@example.com \n").unwrap();
        assert_eq!(id.email(), "ada@example.com");
        assert_eq!(id.name(), "ada");
    }

    #[test]
    fn an_unusable_address_yields_no_fallback() {
        // A malformed address must degrade to "no fallback" — writing it into a
        // commit header would corrupt the object or forge a second identity.
        for bad in [
            "",
            "   ",
            "no-at-sign",
            "@example.com",
            "ada@",
            "ada<evil@example.com",
            "ada@example.com>",
            "ada\n@example.com",
        ] {
            assert_eq!(
                FallbackIdentity::from_account_email(bad),
                None,
                "{bad:?} must not produce a fallback identity"
            );
        }
    }

    #[test]
    fn an_explicit_name_is_kept() {
        let id = FallbackIdentity::new("Ada Lovelace", "ada@example.com").unwrap();
        assert_eq!(id.name(), "Ada Lovelace");
    }

    /// The not-configured message must stay address-free: it is surfaced to the
    /// user, logged, and eligible for a diagnostic packet.
    #[test]
    fn the_not_configured_message_carries_no_address() {
        assert!(!NOT_CONFIGURED.contains('@'));
    }

    /// `{:?}` is how PII reaches a log by accident. It must not, here.
    #[test]
    fn debug_formatting_redacts_the_address() {
        let id = FallbackIdentity::from_account_email("secret@example.com").unwrap();
        let shown = format!("{id:?}");
        assert!(!shown.contains("secret"), "{shown}");
        assert!(!shown.contains('@'), "{shown}");
    }

    #[test]
    fn a_registered_identity_round_trips_and_clears() {
        // The only lib-test that touches the process-global: it restores `None`,
        // and no other unit test in this crate reads it (repository-level
        // behaviour lives in `tests/account_email_fallback.rs`, its own process).
        let id = FallbackIdentity::from_account_email("ada@example.com");
        set_fallback_identity(id.clone());
        assert_eq!(fallback_identity(), id);
        set_fallback_identity(None);
        assert_eq!(fallback_identity(), None);
    }

    #[test]
    fn the_status_of_a_configured_repo_is_git_sourced() {
        // Uses a repo-local identity, so it holds regardless of the machine's
        // global gitconfig.
        let dir = tempfile::tempdir().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        {
            let mut cfg = repo.config().unwrap();
            cfg.set_str("user.name", "Tester").unwrap();
            cfg.set_str("user.email", "t@example.com").unwrap();
        }
        let s = status_of(&repo);
        assert_eq!(s.source, IdentitySource::Git);
        assert_eq!(s.email.as_deref(), Some("t@example.com"));
    }
}
