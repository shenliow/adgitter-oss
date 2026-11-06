use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

/// Subscription plan tiers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Plan {
    Free,
    Basic,
    Advance,
    Enterprise,
}

impl Plan {
    /// The exact wire string (matches the `serde` lowercase representation and
    /// the `plan` column in the license server).
    pub fn as_str(&self) -> &'static str {
        match self {
            Plan::Free => "free",
            Plan::Basic => "basic",
            Plan::Advance => "advance",
            Plan::Enterprise => "enterprise",
        }
    }

    /// The features this tier is entitled to, in the canonical order.
    ///
    /// **The single source of truth for the tier matrix.** It used to be
    /// transcribed in three places — the license server's `derive_features` (what a
    /// real license actually carries), the desktop's debug `dev_features`, and
    /// the frontend's `featuresForPlan`. Every extra copy is a chance for a dev
    /// build to grant something production does not, which is exactly the way a
    /// paywall bypass gets shipped by accident. The server and the desktop's
    /// dev unlock now both read this one table.
    ///
    /// | feature                | Free | Basic | Advance | Enterprise |
    /// |------------------------|:----:|:-----:|:-------:|:----------:|
    /// | ApplyTheme             |  ✓   |   ✓   |    ✓    |     ✓      |
    /// | NoAd                   |      |   ✓   |    ✓    |     ✓      |
    /// | TicketsPriority        |      |   ✓   |    ✓    |     ✓      |
    /// | MultiWindow            |      |   ✓   |    ✓    |     ✓      |
    /// | LogAnytimeBackground   |      |       |    ✓    |     ✓      |
    /// | LogAnytimeSquash       |      |       |    ✓    |     ✓      |
    /// | TeamSeats              |      |       |    ✓    |     ✓      |
    /// | IssueTracker           |      |       |    ✓    |     ✓      |
    pub fn features(&self) -> Vec<Feature> {
        let paid = !matches!(self, Plan::Free);
        let advance_plus = matches!(self, Plan::Advance | Plan::Enterprise);

        let mut features = Vec::new();
        if paid {
            features.push(Feature::NoAd);
        }
        // Applying custom themes is free on every tier.
        features.push(Feature::ApplyTheme);
        if paid {
            features.push(Feature::TicketsPriority);
            features.push(Feature::MultiWindow);
        }
        if advance_plus {
            features.push(Feature::LogAnytimeBackground);
            features.push(Feature::LogAnytimeSquash);
            features.push(Feature::TeamSeats);
            features.push(Feature::IssueTracker);
        }
        features
    }

    /// Whether this tier is entitled to `feature`. Derived from
    /// [`Plan::features`], so the two can never disagree.
    pub fn grants(&self, feature: Feature) -> bool {
        self.features().contains(&feature)
    }
}

impl fmt::Display for Plan {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for Plan {
    type Err = ();

    /// Parse a wire plan string. **Strict**: an unknown value (including the
    /// empty string) is an error, never a silent tier. Callers that want a
    /// lenient default say so explicitly (`.unwrap_or(Plan::Free)`).
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "free" => Ok(Plan::Free),
            "basic" => Ok(Plan::Basic),
            "advance" => Ok(Plan::Advance),
            "enterprise" => Ok(Plan::Enterprise),
            _ => Err(()),
        }
    }
}

/// Canonical paid-feature flags.
///
/// The single source of truth for the entitlement strings that the server
/// derives (the license server) and the desktop gates on.
/// `as_str`/`from_str` round-trip the exact wire strings stored in a
/// license's `features` list. Tier mapping (basic+ vs advance+) is the issuer's
/// job — this enum only names the features.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Feature {
    /// Suppress the free-tier ad strip (basic+).
    NoAd,
    /// Apply custom themes (basic+).
    ApplyTheme,
    /// Priority support tickets (basic+).
    TicketsPriority,
    /// Background Log-Anytime snapshots (advance+).
    LogAnytimeBackground,
    /// Squash Log-Anytime history (advance+).
    LogAnytimeSquash,
    /// Team-seat licensing (advance+).
    TeamSeats,
    /// External issue-tracker panel + lifecycle shell (advance+).
    IssueTracker,
    /// Multiple repo windows open at once (basic+).
    MultiWindow,
}

impl Feature {
    /// The exact wire string stored in a license's `features` list.
    pub fn as_str(&self) -> &'static str {
        match self {
            Feature::NoAd => "NoAd",
            Feature::ApplyTheme => "ApplyTheme",
            Feature::TicketsPriority => "TicketsPriority",
            Feature::LogAnytimeBackground => "LogAnytimeBackground",
            Feature::LogAnytimeSquash => "LogAnytimeSquash",
            Feature::TeamSeats => "TeamSeats",
            Feature::IssueTracker => "IssueTracker",
            Feature::MultiWindow => "MultiWindow",
        }
    }
}

impl FromStr for Feature {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "NoAd" => Ok(Feature::NoAd),
            "ApplyTheme" => Ok(Feature::ApplyTheme),
            "TicketsPriority" => Ok(Feature::TicketsPriority),
            "LogAnytimeBackground" => Ok(Feature::LogAnytimeBackground),
            "LogAnytimeSquash" => Ok(Feature::LogAnytimeSquash),
            "TeamSeats" => Ok(Feature::TeamSeats),
            "IssueTracker" => Ok(Feature::IssueTracker),
            "MultiWindow" => Ok(Feature::MultiWindow),
            _ => Err(()),
        }
    }
}

/// Signed license payload.
///
/// `device_id`, `features`, `seats`, and `iat_ms` bind the token to the
/// licence server's contract: the license is bound to
/// a specific machine (`device_id`), carries the server-derived entitlement
/// `features`, the team `seats` cap (`None` = *no* team seats), and its own issued-at
/// timestamp (`iat_ms`). `features` is derived server-side from `plan` (never
/// trusted from the client).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct License {
    pub plan: Plan,
    pub subject: String,
    /// Stable per-machine id this license is bound to.
    pub device_id: String,
    /// Entitlement feature flags derived server-side from `plan`.
    pub features: Vec<String>,
    /// One-time purchased theme ids. Independent of `plan`: ownership is not
    /// revoked on downgrade, so these ride on the token regardless of tier.
    pub owned_themes: Vec<String>,
    /// Team-seat cap. **`None` = this plan has no team seats** — one meaning,
    /// not two.
    ///
    /// It used to be documented as "unlimited (enterprise/org)" while the
    /// issuer also returned `None` for free and basic, which have none at all.
    /// A free licence and an enterprise one were therefore identical on this
    /// field, so any consumer that read `None` as unlimited would have granted
    /// unlimited seats to the free tier. Enterprise now carries a finite
    /// `Some(5)` (the license server), so there is no
    /// unlimited tier left for `None` to stand for.
    pub seats: Option<u32>,
    pub issued_ms: u64,
    pub expires_ms: u64,
    /// Issued-at timestamp (Unix epoch ms); mirrors a JWT `iat`.
    pub iat_ms: u64,
    pub device_limit: u32,
    /// Account email, carried so it is available **offline** — commits must work
    /// without the network, so this cannot be an API lookup.
    ///
    /// It is a *default*, not the git identity: a configured `user.email` always
    /// wins, and this is used only when git has none (see `git-core`'s
    /// `identity` module). Re-pinned from the database at every issue/renew, so
    /// a Clerk-side change lands on the next round-trip.
    ///
    /// `Option` + `#[serde(default)]` is load-bearing for **backwards
    /// compatibility**: the signature covers the exact payload bytes, so a token
    /// minted before this field existed must still deserialize — with the field
    /// absent it lands as `None` and verifies unchanged. `skip_serializing_if`
    /// keeps a `None` payload byte-identical to the old shape.
    ///
    /// PII: never log it, never put it in an error, never send it to telemetry.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,

    /// Display name (first + last, or the Clerk username when no name is set).
    /// Same re-pinning contract as `email`: re-read from the `users` row at
    /// every issue/renew, so a Clerk-side edit lands on the next round-trip.
    ///
    /// `Option` + `#[serde(default)]` is load-bearing for **backwards
    /// compatibility**: the signature covers the exact payload bytes, so a
    /// token minted before this field existed must still deserialize — with
    /// the field absent it lands as `None` and verifies unchanged.
    /// `skip_serializing_if` keeps a `None` payload byte-identical to the
    /// pre-`name` shape.
    ///
    /// PII: never log it, never put it in an error, never send it to telemetry.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    /// Avatar image URL, as stored by the Clerk webhook. Same backwards- and
    /// forwards-compatibility contract as `name`/`email` — see their doc
    /// comments. Consumers MUST still run this through an https-only sanitizer
    /// before use (see `accountProfile.ts`'s `sanitizeAvatarUrl`): a signed
    /// license is not itself an exemption from that check.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,

    /// Clerk username. Same backwards- and forwards-compatibility contract as
    /// `name`/`email` — see their doc comments.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,

    /// When the free trial this licence carries ends (Unix ms), or `None` for
    /// a licence that is not a trial.
    ///
    /// A trial licence is minted with the trial's `plan` and an ordinary
    /// 30-day `expires_ms`, so the trial cannot simply be its expiry: the
    /// offline grace ([`GRACE_MS`]) would add two more weeks of the paid tier.
    /// [`verify`] reads this instead — past it, the licence is still valid but
    /// *free* (plan and features both), so a trial that ends offline ends on
    /// time and the user stays signed in. The field stays set afterwards so a
    /// client can say the trial is over rather than just showing Free.
    ///
    /// Same backwards-compatibility contract as `email`: absent deserializes to
    /// `None`, and `None` is not serialized, so every non-trial token keeps its
    /// old bytes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trial_ends_ms: Option<u64>,
}

/// Errors that can arise during license verification.
#[derive(Debug, Clone, PartialEq)]
pub enum LicenseError {
    /// Token could not be parsed (bad format, base64, or JSON).
    Malformed,
    /// Signature does not match the payload.
    BadSignature,
    /// License has expired beyond the grace period.
    Expired,
    /// Token is bound to a different device than the one verifying it.
    DeviceMismatch,
    /// License is valid (active or in grace) but does not grant the required
    /// feature. Distinct from `Expired`: the token is fine, the tier is not.
    FeatureNotEntitled,
}

impl fmt::Display for LicenseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LicenseError::Malformed => write!(f, "malformed license token"),
            LicenseError::BadSignature => write!(f, "invalid license signature"),
            LicenseError::Expired => write!(f, "license has expired"),
            LicenseError::DeviceMismatch => write!(f, "license bound to a different device"),
            LicenseError::FeatureNotEntitled => {
                write!(f, "license does not include the required feature")
            }
        }
    }
}

impl std::error::Error for LicenseError {}

/// Result of verifying a license token.
#[derive(Debug, Clone, PartialEq)]
pub enum LicenseStatus {
    /// License is valid and within its expiry date.
    Active(License),
    /// License has expired but is within the grace period.
    Grace(License),
    /// License is invalid (malformed, bad signature, or expired beyond grace).
    Invalid(LicenseError),
}

impl License {
    /// Whether this license grants `feature` (its `features` list contains the
    /// canonical wire string).
    pub fn has_feature(&self, feature: Feature) -> bool {
        self.features.iter().any(|f| f == feature.as_str())
    }

    /// This licence as it stands at `now_ms`: past `trial_ends_ms`, a free one.
    /// Trials start only from Free (the license server), so Free is
    /// what a lapsed trial falls back to. Owned themes are untouched — they are
    /// bought, not part of the trial.
    fn after_trial(mut self, now_ms: u64) -> License {
        if self.trial_ends_ms.is_some_and(|end| now_ms > end) {
            self.plan = Plan::Free;
            self.features = Plan::Free
                .features()
                .into_iter()
                .map(|f| f.as_str().to_string())
                .collect();
        }
        self
    }
}

/// Gate a paid feature on a verification result.
///
/// Both `Active` and `Grace` grant when the (valid) license carries the
/// feature — a token still inside its offline grace window is entitled. A valid
/// license that lacks the feature is [`LicenseError::FeatureNotEntitled`] (the
/// tier is too low, not expired). For `Invalid`, the underlying error is
/// propagated unchanged.
pub fn require(status: &LicenseStatus, feature: Feature) -> Result<(), LicenseError> {
    match status {
        LicenseStatus::Active(license) | LicenseStatus::Grace(license) => {
            if license.has_feature(feature) {
                Ok(())
            } else {
                Err(LicenseError::FeatureNotEntitled)
            }
        }
        LicenseStatus::Invalid(e) => Err(e.clone()),
    }
}

/// Grace period after expiry: 14 days in milliseconds.
pub const GRACE_MS: u64 = 14 * 24 * 60 * 60 * 1000;

/// Verify a license token against the given Ed25519 public key at `now_ms`.
///
/// Token format: `"<payload_b64>.<sig_b64>"` where:
/// - `payload_b64` is the standard-base64 encoding of the canonical JSON of [`License`].
/// - `sig_b64` is the standard-base64 encoding of the Ed25519 signature over those exact bytes.
///
/// `now_ms` is caller-supplied (Unix epoch milliseconds); this function never
/// reads the system clock, keeping tests deterministic.
///
/// `expected_device_id` enforces device binding: when `Some(id)`, the
/// token's `device_id` must equal `id` or the result is
/// `Invalid(DeviceMismatch)`; when `None`, no device check is performed
/// (the behaviour of tokens issued before device binding). The check runs only after the signature is
/// validated, so a forged token still fails as `BadSignature` first.
pub fn verify(
    token: &str,
    public_key: &[u8; 32],
    now_ms: u64,
    expected_device_id: Option<&str>,
) -> LicenseStatus {
    // Split on the first '.'
    let (payload_b64, sig_b64) = match token.split_once('.') {
        Some(parts) => parts,
        None => return LicenseStatus::Invalid(LicenseError::Malformed),
    };

    // Decode payload bytes
    let payload_bytes = match STANDARD.decode(payload_b64) {
        Ok(bytes) => bytes,
        Err(_) => return LicenseStatus::Invalid(LicenseError::Malformed),
    };

    // Parse license from JSON
    let license: License = match serde_json::from_slice(&payload_bytes) {
        Ok(l) => l,
        Err(_) => return LicenseStatus::Invalid(LicenseError::Malformed),
    };

    // Decode signature bytes
    let sig_bytes = match STANDARD.decode(sig_b64) {
        Ok(bytes) => bytes,
        Err(_) => return LicenseStatus::Invalid(LicenseError::Malformed),
    };

    let sig_array: [u8; 64] = match sig_bytes.try_into() {
        Ok(arr) => arr,
        Err(_) => return LicenseStatus::Invalid(LicenseError::Malformed),
    };

    let signature = Signature::from_bytes(&sig_array);

    // Build verifying key
    let verifying_key = match VerifyingKey::from_bytes(public_key) {
        Ok(k) => k,
        Err(_) => return LicenseStatus::Invalid(LicenseError::Malformed),
    };

    // Verify — use verify_strict to reject non-canonical / weak-key attacks
    if verifying_key
        .verify_strict(&payload_bytes, &signature)
        .is_err()
    {
        return LicenseStatus::Invalid(LicenseError::BadSignature);
    }

    // Device binding: only when the caller pins an expected device id.
    if let Some(expected) = expected_device_id {
        if license.device_id != expected {
            return LicenseStatus::Invalid(LicenseError::DeviceMismatch);
        }
    }

    // A lapsed trial is a free licence from here on, offline grace included.
    let license = license.after_trial(now_ms);

    // Determine expiry status
    if now_ms <= license.expires_ms {
        LicenseStatus::Active(license)
    } else if now_ms <= license.expires_ms + GRACE_MS {
        LicenseStatus::Grace(license)
    } else {
        LicenseStatus::Invalid(LicenseError::Expired)
    }
}

/// Mint a signed token for a license.
///
/// Gated behind the `mint` cargo feature (and always available under `cfg(test)`)
/// so the signing path is never compiled into a normal release of a consumer that
/// only needs [`verify`]. The production signing key lives in the cloud signing
/// service and never ships in any binary; the desktop app only enables `mint` to
/// sign throwaway dev tokens with the committed TEST key (see [`test_keys`]).
#[cfg(any(test, feature = "mint"))]
pub fn sign(license: &License, key: &ed25519_dalek::SigningKey) -> String {
    use ed25519_dalek::Signer;
    let payload_bytes = serde_json::to_vec(license).expect("license must serialize");
    let payload_b64 = STANDARD.encode(&payload_bytes);
    let sig = key.sign(&payload_bytes);
    let sig_b64 = STANDARD.encode(sig.to_bytes());
    format!("{}.{}", payload_b64, sig_b64)
}

/// Committed **TEST-ONLY** Ed25519 keypair (mirrors `fixtures/test_keypair.json`).
///
/// NOT A SECRET — never used in production. Available only with the `mint`
/// feature (or under test). Consumers use [`signing_key`] to mint dev tokens and
/// [`verifying_key_bytes`] as a debug-build fallback for verification.
#[cfg(any(test, feature = "mint"))]
pub mod test_keys {
    use super::STANDARD;
    use base64::Engine;
    use ed25519_dalek::SigningKey;

    /// Standard-base64 of the 32-byte TEST signing key. TEST ONLY.
    pub const SIGNING_KEY_B64: &str = "L4KcCg7/csLoAA/H4RbWv8tSzOVYGiXUEOAswlst594=";
    /// Standard-base64 of the 32-byte TEST verifying (public) key. TEST ONLY.
    pub const VERIFYING_KEY_B64: &str = "9TxUA1aDcPAbQn5WpIPezU87HQuL8uXSweAdhNg4Q+k=";

    /// Decode the 32-byte TEST verifying key. TEST ONLY.
    pub fn verifying_key_bytes() -> [u8; 32] {
        let v = STANDARD
            .decode(VERIFYING_KEY_B64)
            .expect("test verifying key must be valid base64");
        v.try_into().expect("test verifying key must be 32 bytes")
    }

    /// Reconstruct the TEST [`SigningKey`] for minting dev tokens. TEST ONLY.
    pub fn signing_key() -> SigningKey {
        let v = STANDARD
            .decode(SIGNING_KEY_B64)
            .expect("test signing key must be valid base64");
        let bytes: [u8; 32] = v.try_into().expect("test signing key must be 32 bytes");
        SigningKey::from_bytes(&bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;
    use rand::rngs::OsRng;

    fn make_signing_key() -> SigningKey {
        SigningKey::generate(&mut OsRng)
    }

    fn sample_license() -> License {
        License {
            trial_ends_ms: None,
            plan: Plan::Basic,
            subject: "test@example.com".to_string(),
            device_id: "device-abc".to_string(),
            features: vec!["NoAd".to_string(), "ApplyTheme".to_string()],
            owned_themes: vec!["midnight".to_string()],
            seats: Some(3),
            issued_ms: 1_000_000,
            expires_ms: 2_000_000,
            iat_ms: 1_000_000,
            device_limit: 3,
            email: Some("ada@example.com".to_string()),
            name: Some("Ada Lovelace".to_string()),
            avatar_url: Some("https://example.com/ada.png".to_string()),
            username: Some("ada".to_string()),
        }
    }

    fn trial_license(trial_ends_ms: u64) -> License {
        License {
            plan: Plan::Advance,
            features: Plan::Advance
                .features()
                .into_iter()
                .map(|f| f.as_str().to_string())
                .collect(),
            trial_ends_ms: Some(trial_ends_ms),
            ..sample_license()
        }
    }

    #[test]
    fn a_trial_grants_its_plan_until_it_ends() {
        let key = make_signing_key();
        let pubkey = key.verifying_key().to_bytes();
        let lic = trial_license(1_500_000);
        let token = sign(&lic, &key);
        assert_eq!(
            verify(&token, &pubkey, 1_500_000, None),
            LicenseStatus::Active(lic)
        );
    }

    /// The trial ends on time even though the licence itself is still valid —
    /// and inside the offline grace too, which is the two weeks a trial must
    /// not get. The user stays signed in, on Free, with their themes.
    #[test]
    fn a_lapsed_trial_is_free_but_still_valid() {
        let key = make_signing_key();
        let pubkey = key.verifying_key().to_bytes();
        let token = sign(&trial_license(1_500_000), &key);
        for now in [1_500_001, 2_000_000 + GRACE_MS - 1] {
            let lic = match verify(&token, &pubkey, now, None) {
                LicenseStatus::Active(l) | LicenseStatus::Grace(l) => l,
                other => panic!("expected a valid licence, got {other:?}"),
            };
            assert_eq!(lic.plan, Plan::Free);
            assert_eq!(lic.features, vec!["ApplyTheme"]);
            assert_eq!(lic.owned_themes, vec!["midnight"]);
            assert_eq!(lic.trial_ends_ms, Some(1_500_000));
            assert_eq!(
                require(&LicenseStatus::Active(lic), Feature::LogAnytimeBackground),
                Err(LicenseError::FeatureNotEntitled)
            );
        }
    }

    #[test]
    fn a_non_trial_token_keeps_its_old_bytes() {
        let json = serde_json::to_string(&sample_license()).unwrap();
        assert!(!json.contains("trial"));
    }

    #[test]
    fn valid_token_is_active() {
        let key = make_signing_key();
        let license = sample_license();
        let token = sign(&license, &key);
        let pubkey = key.verifying_key().to_bytes();
        let status = verify(&token, &pubkey, 1_500_000, None);
        assert_eq!(status, LicenseStatus::Active(license));
    }

    #[test]
    fn matching_device_id_is_active() {
        let key = make_signing_key();
        let license = sample_license();
        let token = sign(&license, &key);
        let pubkey = key.verifying_key().to_bytes();
        let status = verify(&token, &pubkey, 1_500_000, Some("device-abc"));
        assert_eq!(status, LicenseStatus::Active(license));
    }

    #[test]
    fn mismatched_device_id_is_invalid() {
        let key = make_signing_key();
        let license = sample_license();
        let token = sign(&license, &key);
        let pubkey = key.verifying_key().to_bytes();
        let status = verify(&token, &pubkey, 1_500_000, Some("other-device"));
        assert_eq!(status, LicenseStatus::Invalid(LicenseError::DeviceMismatch));
    }

    #[test]
    fn new_fields_round_trip_through_token() {
        let key = make_signing_key();
        let license = sample_license();
        let token = sign(&license, &key);
        let pubkey = key.verifying_key().to_bytes();
        match verify(&token, &pubkey, 1_500_000, None) {
            LicenseStatus::Active(l) => {
                assert_eq!(l.device_id, "device-abc");
                assert_eq!(l.features, vec!["NoAd", "ApplyTheme"]);
                assert_eq!(l.owned_themes, vec!["midnight"]);
                assert_eq!(l.seats, Some(3));
                assert_eq!(l.iat_ms, 1_000_000);
            }
            other => panic!("expected active, got {other:?}"),
        }
    }

    // ── `email` claim compatibility ─────────────────────────────────

    /// Sign raw payload bytes exactly as a server of that vintage would have.
    /// Deliberately *not* routed through `sign`, which would re-serialize the
    /// current struct and so could never reproduce an older payload shape.
    fn sign_raw(payload: &str, key: &SigningKey) -> String {
        use ed25519_dalek::Signer;
        let bytes = payload.as_bytes();
        format!(
            "{}.{}",
            STANDARD.encode(bytes),
            STANDARD.encode(key.sign(bytes).to_bytes())
        )
    }

    /// **The compatibility guarantee.** Adding `email` changed the signed
    /// payload's shape. A token minted before the field existed carries a
    /// signature over bytes that have no `email` key at all — it must keep
    /// verifying, with the claim absent, or every licence in the field would
    /// turn invalid the moment this shipped.
    #[test]
    fn a_token_minted_before_the_email_claim_still_verifies() {
        let key = make_signing_key();
        let pubkey = key.verifying_key().to_bytes();
        let old_payload = r#"{"plan":"basic","subject":"user_7","device_id":"device-abc","features":["NoAd"],"owned_themes":[],"seats":3,"issued_ms":1000000,"expires_ms":2000000,"iat_ms":1000000,"device_limit":3}"#;

        match verify(&sign_raw(old_payload, &key), &pubkey, 1_500_000, None) {
            LicenseStatus::Active(l) => {
                assert_eq!(l.email, None, "an absent claim must decode as None");
                assert_eq!(l.subject, "user_7");
                assert_eq!(l.plan, Plan::Basic);
            }
            other => panic!("a pre-email token must still be active, got {other:?}"),
        }
    }

    // ── `name`/`avatar_url`/`username` claim compatibility ──────────────────

    /// Same guarantee as `a_token_minted_before_the_email_claim_still_verifies`,
    /// extended to the three profile claims added alongside `email`: a payload
    /// with none of `name`/`avatar_url`/`username` (and even without `email`)
    /// must still verify, decoding all four as `None`.
    #[test]
    fn a_token_minted_before_the_profile_claims_still_verifies() {
        let key = make_signing_key();
        let pubkey = key.verifying_key().to_bytes();
        let old_payload = r#"{"plan":"basic","subject":"user_7","device_id":"device-abc","features":["NoAd"],"owned_themes":[],"seats":3,"issued_ms":1000000,"expires_ms":2000000,"iat_ms":1000000,"device_limit":3}"#;

        match verify(&sign_raw(old_payload, &key), &pubkey, 1_500_000, None) {
            LicenseStatus::Active(l) => {
                assert_eq!(l.email, None);
                assert_eq!(l.name, None, "an absent name claim must decode as None");
                assert_eq!(
                    l.avatar_url, None,
                    "an absent avatar_url claim must decode as None"
                );
                assert_eq!(
                    l.username, None,
                    "an absent username claim must decode as None"
                );
                assert_eq!(l.subject, "user_7");
            }
            other => panic!("a pre-profile-claims token must still be active, got {other:?}"),
        }
    }

    /// Mirrors `an_absent_email_is_omitted_from_the_payload`: `None` profile
    /// fields must serialize away entirely, so a token minted for a user with
    /// no stored profile is byte-identical to the pre-`name`/`avatar_url`/
    /// `username` shape.
    #[test]
    fn absent_profile_fields_are_omitted_from_the_payload() {
        let lic = License {
            name: None,
            avatar_url: None,
            username: None,
            ..sample_license()
        };
        let json = serde_json::to_string(&lic).unwrap();
        assert!(!json.contains("\"name\""), "{json}");
        assert!(!json.contains("avatar_url"), "{json}");
        assert!(!json.contains("username"), "{json}");
    }

    /// A present value for each of the three new claims round-trips through a
    /// signed token, mirroring `a_present_email_round_trips_through_a_token`.
    #[test]
    fn present_profile_fields_round_trip_through_a_token() {
        let key = make_signing_key();
        let token = sign(&sample_license(), &key);
        match verify(&token, &key.verifying_key().to_bytes(), 1_500_000, None) {
            LicenseStatus::Active(l) => {
                assert_eq!(l.name.as_deref(), Some("Ada Lovelace"));
                assert_eq!(l.avatar_url.as_deref(), Some("https://example.com/ada.png"));
                assert_eq!(l.username.as_deref(), Some("ada"));
            }
            other => panic!("expected active, got {other:?}"),
        }
    }

    /// …including inside the grace window and under a device check, so the
    /// compatibility does not quietly depend on the happy path.
    #[test]
    fn a_pre_email_token_still_works_in_grace_and_with_device_binding() {
        let key = make_signing_key();
        let pubkey = key.verifying_key().to_bytes();
        let old_payload = r#"{"plan":"advance","subject":"user_7","device_id":"device-abc","features":[],"owned_themes":[],"seats":null,"issued_ms":0,"expires_ms":1000,"iat_ms":0,"device_limit":3}"#;
        let token = sign_raw(old_payload, &key);

        assert!(matches!(
            verify(&token, &pubkey, 1_000 + GRACE_MS - 1, Some("device-abc")),
            LicenseStatus::Grace(_)
        ));
    }

    /// A `None` email must serialize away entirely, so a token we mint for a
    /// user with no address is byte-identical to the pre-`email` shape.
    #[test]
    fn an_absent_email_is_omitted_from_the_payload() {
        let lic = License {
            email: None,
            ..sample_license()
        };
        let json = serde_json::to_string(&lic).unwrap();
        assert!(!json.contains("email"), "{json}");
    }

    #[test]
    fn a_present_email_round_trips_through_a_token() {
        let key = make_signing_key();
        let token = sign(&sample_license(), &key);
        match verify(&token, &key.verifying_key().to_bytes(), 1_500_000, None) {
            LicenseStatus::Active(l) => assert_eq!(l.email.as_deref(), Some("ada@example.com")),
            other => panic!("expected active, got {other:?}"),
        }
    }

    /// The email is PII and must never surface in a failure string — those are
    /// shown to the user, logged, and eligible for a diagnostic packet.
    #[test]
    fn no_license_error_message_can_carry_an_address() {
        for e in [
            LicenseError::Malformed,
            LicenseError::BadSignature,
            LicenseError::Expired,
            LicenseError::DeviceMismatch,
            LicenseError::FeatureNotEntitled,
        ] {
            let msg = e.to_string();
            assert!(!msg.contains('@'), "{msg}");
        }
    }

    #[test]
    fn tampered_payload_is_bad_signature() {
        let key = make_signing_key();
        let license = sample_license();
        let token = sign(&license, &key);
        let pubkey = key.verifying_key().to_bytes();

        // Keep the original signature but replace the payload
        let (_, sig_b64) = token.split_once('.').unwrap();
        let tampered = License {
            plan: Plan::Enterprise,
            ..license
        };
        let tampered_payload = STANDARD.encode(serde_json::to_vec(&tampered).unwrap());
        let tampered_token = format!("{}.{}", tampered_payload, sig_b64);

        let status = verify(&tampered_token, &pubkey, 1_500_000, None);
        assert_eq!(status, LicenseStatus::Invalid(LicenseError::BadSignature));
    }

    #[test]
    fn wrong_public_key_is_bad_signature() {
        let key = make_signing_key();
        let other_key = make_signing_key();
        let license = sample_license();
        let token = sign(&license, &key);
        let wrong_pubkey = other_key.verifying_key().to_bytes();

        let status = verify(&token, &wrong_pubkey, 1_500_000, None);
        assert_eq!(status, LicenseStatus::Invalid(LicenseError::BadSignature));
    }

    #[test]
    fn expired_within_grace_is_grace() {
        let key = make_signing_key();
        let license = sample_license(); // expires_ms = 2_000_000
        let token = sign(&license, &key);
        let pubkey = key.verifying_key().to_bytes();

        // One millisecond before grace period ends
        let now_ms = license.expires_ms + GRACE_MS - 1;
        let status = verify(&token, &pubkey, now_ms, None);
        assert_eq!(status, LicenseStatus::Grace(license));
    }

    #[test]
    fn expired_beyond_grace_is_invalid_expired() {
        let key = make_signing_key();
        let license = sample_license(); // expires_ms = 2_000_000
        let token = sign(&license, &key);
        let pubkey = key.verifying_key().to_bytes();

        // One millisecond past grace period
        let now_ms = license.expires_ms + GRACE_MS + 1;
        let status = verify(&token, &pubkey, now_ms, None);
        assert_eq!(status, LicenseStatus::Invalid(LicenseError::Expired));
    }

    #[test]
    fn malformed_no_dot_is_invalid_malformed() {
        let pubkey = [0u8; 32];
        let status = verify("nodothere", &pubkey, 1_000_000, None);
        assert_eq!(status, LicenseStatus::Invalid(LicenseError::Malformed));
    }

    #[test]
    fn malformed_bad_base64_is_invalid_malformed() {
        let pubkey = [0u8; 32];
        // Exclamation marks are not valid base64
        let status = verify("!!!notbase64!!!.alsowrong!!!", &pubkey, 1_000_000, None);
        assert_eq!(status, LicenseStatus::Invalid(LicenseError::Malformed));
    }

    #[test]
    fn embedded_test_keys_mint_and_verify() {
        // The committed TEST signing key must produce tokens that verify against
        // the committed TEST verifying key — this is the dev pipeline's contract.
        let signing = test_keys::signing_key();
        let pubkey = test_keys::verifying_key_bytes();
        // The embedded verifying key must match the signing key's public half.
        assert_eq!(signing.verifying_key().to_bytes(), pubkey);

        let license = sample_license();
        let token = sign(&license, &signing);
        assert_eq!(
            verify(&token, &pubkey, 1_500_000, None),
            LicenseStatus::Active(license)
        );
    }

    #[test]
    fn feature_string_round_trips() {
        let all = [
            Feature::NoAd,
            Feature::ApplyTheme,
            Feature::TicketsPriority,
            Feature::LogAnytimeBackground,
            Feature::LogAnytimeSquash,
            Feature::TeamSeats,
            Feature::IssueTracker,
            Feature::MultiWindow,
        ];
        for f in all {
            assert_eq!(Feature::from_str(f.as_str()), Ok(f), "round-trip {f:?}");
        }
        assert_eq!(Feature::from_str("NoSuchFeature"), Err(()));
    }

    fn license_with(features: &[Feature], expires_ms: u64) -> License {
        License {
            features: features.iter().map(|f| f.as_str().to_string()).collect(),
            expires_ms,
            ..sample_license()
        }
    }

    #[test]
    fn owned_themes_round_trip_through_token() {
        let key = make_signing_key();
        let license = License {
            owned_themes: vec!["aurora".to_string(), "sunset".to_string()],
            ..sample_license()
        };
        let token = sign(&license, &key);
        let pubkey = key.verifying_key().to_bytes();
        match verify(&token, &pubkey, 1_500_000, None) {
            LicenseStatus::Active(l) => {
                assert_eq!(l.owned_themes, vec!["aurora", "sunset"]);
            }
            other => panic!("expected active, got {other:?}"),
        }
    }

    #[test]
    fn require_grants_features_a_pro_license_carries() {
        let lic = license_with(&[Feature::NoAd, Feature::ApplyTheme], 2_000_000);
        let status = LicenseStatus::Active(lic);
        assert_eq!(require(&status, Feature::NoAd), Ok(()));
        assert_eq!(require(&status, Feature::ApplyTheme), Ok(()));
    }

    #[test]
    fn require_denies_free_license_without_the_feature() {
        let free = LicenseStatus::Active(license_with(&[], 2_000_000));
        assert_eq!(
            require(&free, Feature::NoAd),
            Err(LicenseError::FeatureNotEntitled)
        );
    }

    #[test]
    fn require_grants_within_grace_window() {
        let grace = LicenseStatus::Grace(license_with(&[Feature::TeamSeats], 2_000_000));
        assert_eq!(require(&grace, Feature::TeamSeats), Ok(()));
        // A valid grace license still lacking the feature is FeatureNotEntitled.
        assert_eq!(
            require(&grace, Feature::NoAd),
            Err(LicenseError::FeatureNotEntitled)
        );
    }

    #[test]
    fn require_propagates_invalid_underlying_error() {
        let expired = LicenseStatus::Invalid(LicenseError::Expired);
        assert_eq!(require(&expired, Feature::NoAd), Err(LicenseError::Expired));
        let bad = LicenseStatus::Invalid(LicenseError::BadSignature);
        assert_eq!(
            require(&bad, Feature::NoAd),
            Err(LicenseError::BadSignature)
        );
    }

    #[test]
    fn plan_serde_round_trip() {
        let plans = [Plan::Free, Plan::Basic, Plan::Advance, Plan::Enterprise];
        for plan in plans {
            let json = serde_json::to_string(&plan).unwrap();
            let decoded: Plan = serde_json::from_str(&json).unwrap();
            assert_eq!(plan, decoded, "round-trip failed for {:?}", plan);
        }
        // Verify lowercase representation
        assert_eq!(serde_json::to_string(&Plan::Free).unwrap(), "\"free\"");
        assert_eq!(serde_json::to_string(&Plan::Basic).unwrap(), "\"basic\"");
        assert_eq!(
            serde_json::to_string(&Plan::Advance).unwrap(),
            "\"advance\""
        );
        assert_eq!(
            serde_json::to_string(&Plan::Enterprise).unwrap(),
            "\"enterprise\""
        );
    }

    /// `as_str` must agree with the serde representation — the desktop's dev
    /// unlock and the license server both key off the same wire strings, so a drift
    /// here would silently mean "unknown plan" on one side of the wire.
    #[test]
    fn plan_as_str_matches_the_serde_wire_form() {
        for plan in [Plan::Free, Plan::Basic, Plan::Advance, Plan::Enterprise] {
            let json = serde_json::to_string(&plan).unwrap();
            assert_eq!(json, format!("\"{}\"", plan.as_str()));
            assert_eq!(Plan::from_str(plan.as_str()), Ok(plan));
        }
    }

    /// Parsing is **strict**. An empty or unknown value must not resolve to a
    /// tier: the dev-unlock switch reads a plan name out of an env file, and
    /// "`VITE_DEV_PLAN=` silently means something" is precisely how an empty
    /// value once overrode a real one in this repo.
    #[test]
    fn an_unknown_or_empty_plan_string_does_not_parse() {
        for raw in ["", " ", "Free", "platinum", "enterprise "] {
            assert_eq!(
                Plan::from_str(raw),
                Err(()),
                "{raw:?} must not resolve to a plan"
            );
        }
    }

    /// The tier matrix. This is what a real licence carries
    /// (the license server delegates here) **and** the ceiling the
    /// desktop dev unlock grants, so it is pinned exhaustively per tier.
    #[test]
    fn the_tier_matrix_is_pinned() {
        assert_eq!(Plan::Free.features(), vec![Feature::ApplyTheme]);
        assert_eq!(
            Plan::Basic.features(),
            vec![
                Feature::NoAd,
                Feature::ApplyTheme,
                Feature::TicketsPriority,
                Feature::MultiWindow,
            ]
        );
        let advance = vec![
            Feature::NoAd,
            Feature::ApplyTheme,
            Feature::TicketsPriority,
            Feature::MultiWindow,
            Feature::LogAnytimeBackground,
            Feature::LogAnytimeSquash,
            Feature::TeamSeats,
            Feature::IssueTracker,
        ];
        assert_eq!(Plan::Advance.features(), advance);
        assert_eq!(Plan::Enterprise.features(), advance);
    }

    /// `grants` is the query form of `features` and must never disagree with it
    /// — the desktop gate calls `grants`, the server ships `features`.
    #[test]
    fn grants_agrees_with_features_for_every_tier() {
        let all = [
            Feature::NoAd,
            Feature::ApplyTheme,
            Feature::TicketsPriority,
            Feature::LogAnytimeBackground,
            Feature::LogAnytimeSquash,
            Feature::TeamSeats,
            Feature::IssueTracker,
            Feature::MultiWindow,
        ];
        for plan in [Plan::Free, Plan::Basic, Plan::Advance, Plan::Enterprise] {
            for f in all {
                assert_eq!(
                    plan.grants(f),
                    plan.features().contains(&f),
                    "{plan:?} / {f:?}"
                );
            }
        }
        // Spot-checks of the tier boundaries the paywall actually rides on.
        assert!(!Plan::Free.grants(Feature::MultiWindow));
        assert!(Plan::Basic.grants(Feature::MultiWindow));
        assert!(!Plan::Basic.grants(Feature::IssueTracker));
        assert!(Plan::Advance.grants(Feature::IssueTracker));
        assert!(Plan::Advance.grants(Feature::LogAnytimeSquash));
    }
}
