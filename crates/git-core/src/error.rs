use serde::{Serialize, Serializer};

/// Errors returned to the frontend.
///
/// All errors are converted into a tagged JSON object with a stable `code`
/// the UI can switch on, plus a human-readable `message`. We deliberately
/// do not expose internal stack traces.
#[derive(Debug, thiserror::Error)]
pub enum AdgitterError {
    #[error("repository not found: {0}")]
    RepoNotFound(String),

    #[error("invalid path: {0}")]
    InvalidPath(String),

    #[error("git error: {0}")]
    Git(#[from] git2::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("internal error: {0}")]
    Internal(String),

    /// A paid feature was invoked without a license that grants it.
    /// Carries the underlying reason so the UI can prompt an upgrade.
    ///
    /// Strictly "your tier does not include this". The two *other* reasons a
    /// paid command can be refused — wrong machine, expired — have their own
    /// codes below, because folding them in here would answer "you have not
    /// paid" to a user who has.
    #[error("feature locked: {0}")]
    FeatureLocked(String),

    /// The stored license is genuine but bound to a **different device** than
    /// this install, so it grants nothing here.
    ///
    /// Deliberately not `FeatureLocked`: the archetypal user hitting this has
    /// paid and is on a reinstalled or replaced machine. "Buy a plan" is the
    /// wrong instruction; signing in again re-issues the license against this
    /// device's id and fixes it.
    ///
    /// Also covers "this install has no readable device id" — we cannot prove
    /// the license belongs here, and the gate fails closed rather than
    /// degrading to an unbound check.
    #[error("this license is registered to another device")]
    LicenseDeviceMismatch,

    /// The stored license verified but is past its expiry **and** its offline
    /// grace window. The tier was right; the clock ran out. Separate from
    /// `FeatureLocked` so the UI can say "renew" instead of "upgrade".
    #[error("this license has expired")]
    LicenseExpired,

    /// An operation that needs an identity (today: creating a Polar checkout)
    /// was invoked with no signed license on disk. This is an expected,
    /// *recoverable* state — not a fault — so it gets its own stable code the
    /// UI switches on to launch sign-in and then retry the same operation
    /// (lazy; deferred sign-in). Matching on the message
    /// text would be brittle, hence a variant rather than `Internal`.
    #[error("not signed in — sign in to continue")]
    NotSignedIn,

    /// The signed-in user has no subscription to manage, so there is no billing
    /// portal to open (`POST /portal` → 404 `NO_SUBSCRIPTION`).
    ///
    /// Its own code, not `Internal`: this is the ordinary state of everyone who
    /// has never paid, and of a subscriber whose Polar customer id has not been
    /// observed yet. "Something went wrong" would be both wrong and unhelpful —
    /// the UI says "no subscription found" and points at the plan page instead.
    /// Also deliberately *not* `NotSignedIn`, which would send the user through
    /// a sign-in round trip that cannot possibly fix it.
    ///
    /// Carries no identifier: the message is user-visible and ships in
    /// diagnostic packets.
    #[error("no subscription found for this account")]
    NoSubscription,

    /// The account already has as many signed-in devices as its plan allows, so
    /// this install could not be seated (`/license/issue` or `/license/renew`
    /// → 403 `SEAT_LIMIT`).
    ///
    /// Its own code, not `Internal`, because it is the one licensing failure
    /// with a *user action* attached: the UI asks whether to sign the oldest
    /// device out and, on confirmation, retries the same call with
    /// `evictOldestDevice`. Routing it to `Internal` left the frontend
    /// string-matching an HTTP status out of a message to find that out, and
    /// routing it to `NotSignedIn` would launch a sign-in round trip that ends
    /// at exactly the same refusal.
    ///
    /// Carries nothing: not the device that was refused, not the one that would
    /// be displaced, not a count. The message is user-visible and ships in
    /// diagnostic packets, and a device id is an identifier this app does not
    /// put in either.
    #[error("this account has reached its signed-in device limit")]
    DeviceSeatLimit,

    /// A rebase/merge/cherry-pick/revert replay hit a genuine content
    /// conflict applying `sha` and aborted cleanly (no half-applied state
    /// left on disk). This is an expected domain event — the user's content
    /// disagrees with itself — not an internal fault, so it gets its own
    /// `code()` distinct from `INTERNAL_ERROR` (the in-app resolver is
    /// deferred; for now the user resolves manually or undoes the op).
    #[error("conflict applying {sha} — resolve manually or undo (in-app resolver coming later)")]
    Conflict { sha: String },

    /// The replay engine (`rebase.rs`) was asked to replay a range that
    /// contains merge commit `sha`. Replaying a merge would have to pick a
    /// mainline and would flatten the other side's history, so the engine
    /// refuses instead of guessing — the caller's range simply cannot be
    /// rewritten (e.g. rewording a commit only reachable across a merge).
    /// Without this variant libgit2's raw text ("mainline branch is not
    /// specified but <oid> is a merge commit") leaked to the UI as a generic
    /// `GIT_ERROR`, naming an internal concept the user never chose.
    #[error(
        "cannot rewrite history across merge commit {sha} — the range contains a merge, which \
         this operation cannot replay"
    )]
    MergeCommitInRange { sha: String },

    /// "Check out this remote branch" found a local branch of the wanted name
    /// that already tracks a **different** remote branch. The two refs are
    /// unrelated bookkeeping-wise, so silently re-pointing the upstream would
    /// quietly detach the branch from the thing it has been pushing to.
    ///
    /// Its own variant rather than `Internal`, because this is the one row of
    /// the remote-checkout matrix that genuinely cannot proceed, and the user
    /// can only act on it if the message names *what* was found: a generic
    /// "something went wrong" leaves them guessing which of their branches is
    /// in the way and what it points at.
    #[error(
        "local branch '{branch}' already tracks '{tracking}', not '{requested}' — rename one of \
         them, or change the branch's upstream, before checking out '{requested}'"
    )]
    RemoteUpstreamMismatch {
        branch: String,
        tracking: String,
        requested: String,
    },
}

impl AdgitterError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::RepoNotFound(_) => "REPO_NOT_FOUND",
            Self::InvalidPath(_) => "INVALID_PATH",
            Self::Git(_) => "GIT_ERROR",
            Self::Io(_) => "IO_ERROR",
            Self::Internal(_) => "INTERNAL_ERROR",
            Self::FeatureLocked(_) => "FEATURE_LOCKED",
            Self::LicenseDeviceMismatch => "LICENSE_DEVICE_MISMATCH",
            Self::LicenseExpired => "LICENSE_EXPIRED",
            Self::NotSignedIn => "NOT_SIGNED_IN",
            Self::NoSubscription => "NO_SUBSCRIPTION",
            Self::DeviceSeatLimit => "DEVICE_SEAT_LIMIT",
            Self::Conflict { .. } => "CONFLICT",
            Self::MergeCommitInRange { .. } => "MERGE_COMMIT_IN_RANGE",
            Self::RemoteUpstreamMismatch { .. } => "REMOTE_UPSTREAM_MISMATCH",
        }
    }

    /// The commit an error names, when it names one — the two content-shaped
    /// failures (`Conflict`, `MergeCommitInRange`) both carry a sha the UI can
    /// point at without parsing the message.
    fn sha(&self) -> Option<&str> {
        match self {
            Self::Conflict { sha } | Self::MergeCommitInRange { sha } => Some(sha),
            _ => None,
        }
    }
}

impl Serialize for AdgitterError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        // The sha-carrying variants (`Conflict`, `MergeCommitInRange`) add one
        // extra field so the frontend can name the offending commit without
        // parsing the human-readable message.
        let sha = self.sha();
        let mut map = serializer.serialize_map(Some(if sha.is_some() { 3 } else { 2 }))?;
        map.serialize_entry("code", self.code())?;
        map.serialize_entry("message", &self.to_string())?;
        if let Some(sha) = sha {
            map.serialize_entry("sha", sha)?;
        }
        map.end()
    }
}

pub type AdgitterResult<T> = Result<T, AdgitterError>;

#[cfg(test)]
mod tests {
    use super::*;

    /// The frontend switches on `code`, never on the message — `NOT_SIGNED_IN`
    /// in particular drives the "sign in, then resume the checkout" flow, so it
    /// must serialize as its own stable code (not `INTERNAL_ERROR`).
    #[test]
    fn not_signed_in_serializes_as_its_own_stable_code() {
        let json = serde_json::to_value(AdgitterError::NotSignedIn).unwrap();
        assert_eq!(json["code"], "NOT_SIGNED_IN");
        assert!(json["message"].as_str().unwrap().contains("not signed in"));
    }

    /// A merge commit in a replay range is a domain condition the user can act
    /// on ("you can't reword across that merge"), not an internal fault and not
    /// a raw libgit2 string — so it serializes as its own code, carrying the
    /// offending commit's sha like `CONFLICT` does.
    #[test]
    fn a_merge_commit_in_range_serializes_as_its_own_stable_code_with_the_sha() {
        let json = serde_json::to_value(AdgitterError::MergeCommitInRange {
            sha: "abc123".into(),
        })
        .unwrap();
        assert_eq!(json["code"], "MERGE_COMMIT_IN_RANGE");
        assert_eq!(json["sha"], "abc123");
        assert!(json["message"]
            .as_str()
            .unwrap()
            .contains("merge commit abc123"));
        assert!(
            !json["message"].as_str().unwrap().contains("mainline"),
            "libgit2's raw wording must not leak"
        );
    }

    /// The whole point of splitting these out: a paying user on a new machine,
    /// and a user whose licence lapsed, must not both be told "this feature
    /// needs a paid plan". Each gets a code the UI can turn into the action
    /// that actually helps (sign in again / renew).
    #[test]
    fn a_wrong_device_and_an_expiry_are_not_feature_locked() {
        let mismatch = serde_json::to_value(AdgitterError::LicenseDeviceMismatch).unwrap();
        assert_eq!(mismatch["code"], "LICENSE_DEVICE_MISMATCH");
        assert_ne!(mismatch["code"], "FEATURE_LOCKED");

        let expired = serde_json::to_value(AdgitterError::LicenseExpired).unwrap();
        assert_eq!(expired["code"], "LICENSE_EXPIRED");
        assert_ne!(expired["code"], "FEATURE_LOCKED");

        // …and the three stay distinct from each other.
        let locked = serde_json::to_value(AdgitterError::FeatureLocked("tier".into())).unwrap();
        assert_eq!(locked["code"], "FEATURE_LOCKED");
        assert_ne!(mismatch["code"], expired["code"]);
    }

    /// A subscriber with nothing to manage is not a fault, and not a sign-in
    /// problem: `NO_SUBSCRIPTION` must stay distinct from both
    /// `INTERNAL_ERROR` and `NOT_SIGNED_IN`, because the UI says something
    /// different for each — and routing it to `NOT_SIGNED_IN` would send the
    /// user through a browser sign-in round trip that cannot possibly fix it.
    #[test]
    fn no_subscription_is_neither_internal_nor_a_sign_in_problem() {
        let json = serde_json::to_value(AdgitterError::NoSubscription).unwrap();
        assert_eq!(json["code"], "NO_SUBSCRIPTION");
        assert_ne!(json["code"], "INTERNAL_ERROR");
        assert_ne!(json["code"], "NOT_SIGNED_IN");
        assert!(json["message"]
            .as_str()
            .unwrap()
            .contains("no subscription"));
    }

    /// The seat cap has a user action behind it (sign the oldest device out),
    /// so it must stay distinguishable from both the generic failure and the
    /// two neighbouring licence refusals the UI answers differently.
    #[test]
    fn the_device_seat_limit_has_its_own_actionable_code() {
        let json = serde_json::to_value(AdgitterError::DeviceSeatLimit).unwrap();
        assert_eq!(json["code"], "DEVICE_SEAT_LIMIT");
        assert_ne!(json["code"], "INTERNAL_ERROR");
        // Signing in again cannot fix a full account, and the licence is not
        // bound to the wrong machine — it was never seated at all.
        assert_ne!(json["code"], "NOT_SIGNED_IN");
        assert_ne!(json["code"], "LICENSE_DEVICE_MISMATCH");
        assert_ne!(json["code"], "FEATURE_LOCKED");
    }

    /// These messages are shown to the user and shipped in diagnostic packets:
    /// they must not name a device id, a subject, or an address.
    #[test]
    fn the_licence_failure_messages_carry_no_identifiers() {
        for e in [
            AdgitterError::LicenseDeviceMismatch,
            AdgitterError::LicenseExpired,
            AdgitterError::NoSubscription,
            AdgitterError::DeviceSeatLimit,
        ] {
            let msg = e.to_string();
            assert!(!msg.contains('@'), "{msg}");
            assert!(
                !msg.is_empty(),
                "an empty message would render as bare code"
            );
        }
    }

    /// The only unresolvable row of the remote-checkout matrix. The UI shows
    /// this text verbatim, so it must name the branch, what it tracks, and
    /// what was asked for — and must not collapse into `INTERNAL_ERROR`,
    /// which is what the old `checkout_remote_branch` produced.
    #[test]
    fn a_conflicting_upstream_names_what_it_found_and_is_not_internal() {
        let json = serde_json::to_value(AdgitterError::RemoteUpstreamMismatch {
            branch: "feature".into(),
            tracking: "upstream/feature".into(),
            requested: "origin/feature".into(),
        })
        .unwrap();
        assert_eq!(json["code"], "REMOTE_UPSTREAM_MISMATCH");
        assert_ne!(json["code"], "INTERNAL_ERROR");
        let msg = json["message"].as_str().unwrap();
        assert!(msg.contains("feature"), "{msg}");
        assert!(msg.contains("upstream/feature"), "{msg}");
        assert!(msg.contains("origin/feature"), "{msg}");
    }

    #[test]
    fn an_internal_error_keeps_its_own_code() {
        let json = serde_json::to_value(AdgitterError::Internal("boom".into())).unwrap();
        assert_eq!(json["code"], "INTERNAL_ERROR");
    }
}
