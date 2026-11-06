//! DEBUG-ONLY paid-feature unlock, so a developer can work on paid UI and paid
//! IPC without holding a real licence.
//!
//! # Why this exists
//!
//! The frontend has had `VITE_DEV_PLAN` for a while: it drives the entitlement
//! store, so the UI *renders* at any tier. The native side had nothing, and once
//! licences became device-bound the two halves stopped agreeing — the Issue
//! panel lit up and `create_issue_branch` came back `LICENSE_DEVICE_MISMATCH`.
//! This module is the native half, driven by the **same** switch (see
//! `build.rs`'s `DEV_PLAN_KEY`): one variable, one file, both layers.
//!
//! # What it does and does not do
//!
//! It answers exactly one question — *"would tier T grant feature F?"* — and it
//! is consulted at exactly one place: the feature gate in
//! [`crate::commands::decide_feature`].
//!
//! It deliberately does **not** fabricate a licence, and nothing here is wired
//! into `resolve_license_status`. That path also feeds `account_email`, which is
//! the default author address for git commits: a forged licence there would
//! stamp a made-up account address onto real commits and write it into history,
//! where it is permanent. An unlock a developer can turn off is worth having; a
//! forged identity in someone's git log is not. So the dev unlock grants
//! *capabilities* and never supplies an *identity* — with the unlock at
//! `enterprise` and no licence, `account_email` still answers `None` and commits
//! still use git's own `user.email`.
//!
//! # The runtime switch (`set_dev_plan`)
//!
//! The compile-time switch above cannot be varied without a rebuild, which made
//! "check this at every tier" a four-rebuild chore and left the *real-licence*
//! path unreachable on any machine whose `.env.development` pins a tier. So
//! [`set_runtime_plan`] lets the account menu retarget the tier in-process, and
//! [`plan`] prefers it over the baked value (see [`resolve_plan`]).
//!
//! That is strictly more dangerous than the compile-time switch it joins: a
//! baked constant is inert in a shipped binary no matter who calls it, whereas a
//! *setter* is something anything running in the webview could invoke. It is
//! therefore confined to this module, which the release build does not compile —
//! and `commands::set_dev_plan`, the only caller, is itself
//! `#[cfg(debug_assertions)]` *and* has no `#[cfg(not(debug_assertions))]`
//! fallback arm, so deleting its guard fails the release build on an unresolved
//! `crate::dev_unlock` path rather than shipping a callable bypass. Nothing
//! here is reachable from configuration: there is no env var, setting or
//! "unlock dev mode" toggle that can put it into a release build.
//!
//! # Never in a release build
//!
//! `mod dev_unlock` is declared `#[cfg(debug_assertions)]`, so none of this is
//! compiled into a release binary; the `compile_error!` below turns a deleted
//! guard into a failed build instead of a shipped bypass. `build.rs` separately
//! refuses to bake the value under `PROFILE=release`.

#[cfg(not(debug_assertions))]
compile_error!(
    "dev_unlock is a paid-feature bypass and must never be compiled without \
     debug_assertions — restore the #[cfg(debug_assertions)] on `mod dev_unlock`"
);

use license::{Feature, Plan};
use std::sync::RwLock;

/// The runtime tier chosen this process, if one has been chosen at all.
///
/// Two levels of `Option` because "not chosen" and "chosen to be nothing" are
/// different answers and collapsing them would break the menu's most useful
/// entry. The outer `None` means *no runtime choice has been made*, so [`plan`]
/// falls back to the compile-time switch and a developer who never opens the
/// menu sees exactly the behaviour they had before. `Some(None)` means the
/// developer explicitly picked **"no override — use the real licence"**, which
/// must beat a baked `VITE_DEV_PLAN`; without the distinction that choice would
/// be indistinguishable from "unset" and silently snap back to the baked tier.
///
/// Process-local, and deliberately not persisted here: the persisted copy lives
/// on the frontend (`lib/devPlan.svelte.ts`), which re-applies it through
/// `set_dev_plan` on every `refreshEntitlement()` — including the one at
/// startup. One writer, one direction, so the two layers cannot drift.
static RUNTIME_PLAN: RwLock<Option<Option<Plan>>> = RwLock::new(None);

/// Point the native gate at `next` for the rest of this process. `None` means
/// "no override": fall through to the real licence, ignoring the baked switch.
///
/// A poisoned lock is recovered from rather than propagated — the guarded value
/// is a single `Copy` enum that cannot be left half-written, and panicking the
/// caller of a dev-only switch would be a worse outcome than the switch working.
pub(crate) fn set_runtime_plan(next: Option<Plan>) {
    *RUNTIME_PLAN.write().unwrap_or_else(|e| e.into_inner()) = Some(next);
}

/// The runtime choice, or `None` when the menu has not been used this process.
fn runtime_plan() -> Option<Option<Plan>> {
    *RUNTIME_PLAN.read().unwrap_or_else(|e| e.into_inner())
}

/// The tier the dev unlock is running at, or `None` when nothing unlocks it.
///
/// The runtime switch wins over the compile-time one (see [`resolve_plan`]).
pub(crate) fn plan() -> Option<Plan> {
    resolve_plan(runtime_plan(), option_env!("ADGITTER_DEV_PLAN"))
}

/// The precedence rule behind [`plan`], with both inputs passed in.
///
/// **Runtime beats compile-time when a runtime choice exists at all.** The
/// compile-time value is a default a developer set once in a file; the runtime
/// value is what they just picked in the menu, looking at the screen. Deferring
/// to the older, invisible one would make the menu appear not to work — and, on
/// the machine that motivated this (`.env.development` pinned to `enterprise`),
/// would leave the real-licence path untestable, which is the single path most
/// worth exercising.
///
/// Split out for the same reason [`parse_plan`] is: `option_env!` resolves at
/// compile time, so a test written against [`plan`] would depend on whatever the
/// developer's `.env.development` happens to bake and would go red the moment
/// someone legitimately turned the unlock on.
fn resolve_plan(runtime: Option<Option<Plan>>, baked: Option<&str>) -> Option<Plan> {
    match runtime {
        Some(chosen) => chosen,
        None => parse_plan(baked),
    }
}

/// The parsing rule behind [`plan`], with the baked value passed in.
///
/// Split out because `option_env!` resolves at compile time and cannot be varied
/// per test — whether a value is baked depends on the developer's
/// `.env.development`, and a test written against [`plan`] directly would go red
/// the moment someone legitimately turned the unlock on (the same trap
/// `resolve_public_key_from` documents).
///
/// **Empty and unknown values do not unlock.** `Plan::from_str` is strict, so
/// `VITE_DEV_PLAN=` (the classic `.env.development`-copied-from-`.env.example`
/// case) and `VITE_DEV_PLAN=platnium` both land here as `None` — locked, which
/// is the safe direction — and [`log_status`] says so out loud at startup.
fn parse_plan(baked: Option<&str>) -> Option<Plan> {
    baked?.parse().ok()
}

/// Whether the dev unlock grants `feature`.
///
/// It grants exactly what the configured tier would really grant
/// ([`Plan::grants`], the same table the license server issues from), so
/// `VITE_DEV_PLAN=basic` does *not* open advance-only features. A dev unlock
/// that granted more than any real plan would be a worse preview than no preview
/// at all.
pub(crate) fn grants(dev: Option<Plan>, feature: Feature) -> bool {
    dev.is_some_and(|p| p.grants(feature))
}

/// Say so, loudly, at startup.
///
/// Without this a developer forgets the override is on, sees a paid feature
/// work, and concludes the paywall is fine. `warn!` (not `info!`) because the
/// default subscriber filter is `adgitter=info,warn` — a target outside the
/// `adgitter` prefix only surfaces at WARN.
///
/// Also reports the *misconfigured* cases, which are otherwise invisible: the
/// switch is set, the developer expects an unlock, and nothing happens.
pub(crate) fn log_status() {
    let Some(raw) = option_env!("ADGITTER_DEV_PLAN") else {
        return; // switch not set: a normal, locked dev build. Stay quiet.
    };
    match parse_plan(Some(raw)) {
        Some(p) => tracing::warn!(
            plan = %p,
            "DEV UNLOCK ACTIVE — paid features are unlocked WITHOUT a licence \
             (VITE_DEV_PLAN in the repo-root .env.development). This is a debug \
             build only. Nothing is licensed, no account identity is granted, and \
             commits still use git's own user.email. Unset VITE_DEV_PLAN and \
             rebuild to test the real paywall."
        ),
        None if raw.is_empty() => tracing::warn!(
            "VITE_DEV_PLAN is set but EMPTY — the dev unlock is OFF. An empty value \
             in .env.development shadows a real one in .env. Set it to one of: \
             free | basic | advance | enterprise."
        ),
        None => tracing::warn!(
            value = %raw,
            "VITE_DEV_PLAN is not a plan name — the dev unlock is OFF. Expected one \
             of: free | basic | advance | enterprise."
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The switch is off unless it is set to a real tier. Empty and typo'd
    /// values must fail CLOSED — the whole point of `Plan`'s strict `FromStr`.
    #[test]
    fn only_a_real_tier_name_turns_the_unlock_on() {
        assert_eq!(parse_plan(None), None, "unset must not unlock");
        assert_eq!(parse_plan(Some("")), None, "empty must not unlock");
        assert_eq!(parse_plan(Some(" ")), None);
        assert_eq!(parse_plan(Some("platnium")), None, "a typo must not unlock");
        assert_eq!(parse_plan(Some("Enterprise")), None, "case is exact");
        assert_eq!(parse_plan(Some("enterprise")), Some(Plan::Enterprise));
        assert_eq!(parse_plan(Some("free")), Some(Plan::Free));
    }

    /// With no override nothing is granted — a dev build without the switch must
    /// behave exactly like a licence-less production build.
    #[test]
    fn without_the_switch_nothing_is_granted() {
        for f in every_feature() {
            assert!(!grants(None, f), "{f:?} must stay locked");
        }
    }

    /// The unlock is capped at what the tier really sells. `basic` must not open
    /// `IssueTracker`, or paid UI gets developed against an entitlement no
    /// customer can buy.
    #[test]
    fn the_unlock_grants_exactly_what_the_tier_would() {
        for plan in [Plan::Free, Plan::Basic, Plan::Advance, Plan::Enterprise] {
            for f in every_feature() {
                assert_eq!(
                    grants(Some(plan), f),
                    plan.grants(f),
                    "dev unlock at {plan:?} must match the real matrix for {f:?}"
                );
            }
        }
        assert!(!grants(Some(Plan::Free), Feature::MultiWindow));
        assert!(!grants(Some(Plan::Basic), Feature::IssueTracker));
        assert!(grants(Some(Plan::Advance), Feature::IssueTracker));
        assert!(grants(Some(Plan::Enterprise), Feature::LogAnytimeSquash));
    }

    /// The runtime switch is authoritative once used, and "no override" is a
    /// real, distinct answer — not the same thing as "never chosen".
    #[test]
    fn the_runtime_choice_beats_the_baked_one() {
        // Never chosen: the compile-time switch still decides, so a developer
        // who does not open the menu keeps the behaviour they had before.
        assert_eq!(
            resolve_plan(None, Some("enterprise")),
            Some(Plan::Enterprise)
        );
        assert_eq!(resolve_plan(None, None), None);
        assert_eq!(resolve_plan(None, Some("")), None, "empty must not unlock");
        assert_eq!(
            resolve_plan(None, Some("platnium")),
            None,
            "typo must not unlock"
        );

        // Chosen: the menu wins, in both directions.
        for tier in [Plan::Free, Plan::Basic, Plan::Advance, Plan::Enterprise] {
            assert_eq!(
                resolve_plan(Some(Some(tier)), Some("enterprise")),
                Some(tier),
                "the runtime choice must override a baked enterprise"
            );
            assert_eq!(resolve_plan(Some(Some(tier)), None), Some(tier));
        }

        // The entry that motivated the whole change: "no override — use the
        // real licence" must reach the real licence even with a tier baked in.
        assert_eq!(
            resolve_plan(Some(None), Some("enterprise")),
            None,
            "'no override' must beat a baked VITE_DEV_PLAN"
        );
        assert_eq!(resolve_plan(Some(None), None), None);
    }

    /// The runtime switch feeds the same capability table as everything else —
    /// it retargets the tier, it does not widen what a tier grants.
    #[test]
    fn a_runtime_tier_grants_exactly_what_that_tier_would() {
        for tier in [Plan::Free, Plan::Basic, Plan::Advance, Plan::Enterprise] {
            let dev = resolve_plan(Some(Some(tier)), Some("enterprise"));
            for f in every_feature() {
                assert_eq!(
                    grants(dev, f),
                    tier.grants(f),
                    "runtime {tier:?} must match the real matrix for {f:?}"
                );
            }
        }
        // …and "no override" grants nothing at all, baked switch notwithstanding.
        let none = resolve_plan(Some(None), Some("enterprise"));
        for f in every_feature() {
            assert!(!grants(none, f), "{f:?} must stay locked with no override");
        }
    }

    /// `set_runtime_plan` really reaches [`plan`] — the seam the `set_dev_plan`
    /// command drives. Written to leave no residue: the last write restores the
    /// "never chosen" answer for whatever else shares this process.
    ///
    /// This is the one test here that touches the process-wide switch, and
    /// cargo runs tests in parallel threads of a single process. It is safe
    /// only because the other test that reads the switch
    /// (`commands::the_compile_time_switch_surfaces_at_the_gate`) captures
    /// `dev_plan_override()` **once** and then asserts both sides of its
    /// comparison against that captured value — so a concurrent write changes
    /// what it observes, never whether it agrees. Any future test that reads
    /// `plan()` twice and compares the results must take that invariant into
    /// account rather than assume the switch is constant.
    #[test]
    fn the_setter_reaches_the_gate() {
        let baked = parse_plan(option_env!("ADGITTER_DEV_PLAN"));
        set_runtime_plan(Some(Plan::Basic));
        assert_eq!(plan(), Some(Plan::Basic));
        assert!(grants(plan(), Feature::MultiWindow));
        assert!(
            !grants(plan(), Feature::IssueTracker),
            "basic is not advance"
        );

        set_runtime_plan(None);
        assert_eq!(plan(), None, "'no override' must lock the native gate");
        assert!(!grants(plan(), Feature::MultiWindow));

        set_runtime_plan(baked); // leave the process as we found it
    }

    fn every_feature() -> [Feature; 8] {
        [
            Feature::NoAd,
            Feature::ApplyTheme,
            Feature::TicketsPriority,
            Feature::LogAnytimeBackground,
            Feature::LogAnytimeSquash,
            Feature::TeamSeats,
            Feature::IssueTracker,
            Feature::MultiWindow,
        ]
    }
}
