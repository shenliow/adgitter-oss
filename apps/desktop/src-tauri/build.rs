use std::path::{Path, PathBuf};

/// The dev-unlock switch, and the ONLY variable that controls it.
///
/// It is deliberately the *same* name the frontend already reads
/// (`import.meta.env.VITE_DEV_PLAN`, see `lib/license.svelte.ts`) from the
/// *same* file (repo-root `.env.development`, per `vite.config.ts`'s
/// `envDir: '../../'`). Two switches would mean two ways to set only half of
/// it, and half-set is the worst state to be in: the UI lights a paid button up
/// and the native gate then refuses the click (or the reverse — a working
/// backend behind a greyed-out button). One name, one file, both layers.
const DEV_PLAN_KEY: &str = "VITE_DEV_PLAN";

/// The internal name the switch is baked under, read by `dev_unlock.rs` via
/// `option_env!`. Distinct from [`DEV_PLAN_KEY`] so the value the Rust gate sees
/// is the one *this* build script decided to bake (debug profile only) rather
/// than whatever `VITE_DEV_PLAN` happened to be exported in the shell that ran
/// `cargo build --release`.
const DEV_PLAN_BAKED_KEY: &str = "ADGITTER_DEV_PLAN";

fn main() {
    // Two values are baked at compile time from the environment (and, failing
    // that, a gitignored `.env`): the Sentry DSN and the license verifying
    // (public) key. Cargo neither tracks env vars used by macros like
    // `option_env!` nor reads `.env`, so for each we wire both: rebuild on env
    // change, and feed `.env` into the build. Precedence: an already-exported
    // var (CI/shell) wins; otherwise the `.env` value is used. Empty stays inert.
    bake_from_env_or_dotenv("SENTRY_DSN");

    // The license public key is standard-base64 of the 32-byte Ed25519 key. The
    // PRODUCTION key is supplied this way at release-build time and never
    // committed. With no key baked in, release builds treat every license as
    // Invalid (inert) and debug builds fall back to the committed TEST key.
    bake_from_env_or_dotenv("LICENSE_PUBLIC_KEY");

    // Base URL of the license server. A packaged app gets essentially no shell
    // environment — launched from Finder there is no `ADGITTER_API_URL` — so
    // without baking it, every release build silently talks to
    // `http://localhost:8080` and every licence/checkout call fails with a
    // connection refusal. Baking keeps the URL out of source (the default is
    // still localhost) while making a release build able to reach anything.
    // The runtime env var still wins, so dev can point elsewhere per-run.
    bake_from_env_or_dotenv("ADGITTER_API_URL");

    bake_dev_plan();

    tauri_build::build()
}

/// Re-export `key` to the compiling crate via `cargo:rustc-env` so `option_env!`
/// sees it. An exported env var wins; otherwise a non-empty `.env` value is used.
fn bake_from_env_or_dotenv(key: &str) {
    println!("cargo:rerun-if-env-changed={key}");
    if std::env::var_os(key).is_none() {
        if let Some(val) = load_dotenv_var(key, ".env").filter(|v| !v.is_empty()) {
            println!("cargo:rustc-env={key}={val}");
        }
    }
}

/// Bake the DEBUG-ONLY dev-unlock switch (see [`DEV_PLAN_KEY`]).
///
/// ## Never in a release build
///
/// This is a paid-feature bypass, so "we just wouldn't set that variable" is not
/// good enough. Two independent, compile-time defences:
///
/// 1. Here: nothing is baked when `PROFILE=release`, so a release build has no
///    value to read even if the developer's shell or `.env.development` has one.
/// 2. In `dev_unlock.rs` / `commands.rs`: the module and the early-return that
///    consults it are `#[cfg(debug_assertions)]`, so the bypass is not *compiled*
///    into a release binary at all. `dev_unlock.rs` additionally carries a
///    `#[cfg(not(debug_assertions))] compile_error!`, so deleting that guard
///    breaks the release build rather than shipping the hole.
///
/// (2) is the real guarantee — `PROFILE` reports the profile *name*, and a
/// hand-rolled profile could in principle name itself "dev" with
/// `debug-assertions = false`. (1) is defence in depth and keeps the value out
/// of the release build's fingerprint entirely.
///
/// ## Precedence
///
/// Mirrors Vite's `loadEnv` for mode `development` so both layers resolve the
/// *same* value: exported shell var, then repo-root `.env.development`, then
/// repo-root `.env`. First **present** wins — a present-but-empty value in
/// `.env.development` shadows `.env` exactly as it does in Vite. That is the
/// trap this repo has already hit once (a `.env.development` copied from
/// `.env.example` whose empty values silently overrode `.env`), so the empty
/// value is baked through verbatim and `dev_unlock.rs` reports it loudly at
/// startup, rather than being quietly dropped here where nobody would see it.
///
/// The value is NOT validated here: `license::Plan::from_str` is the single
/// validator, and duplicating the tier list in a build script is how the two
/// drift apart.
fn bake_dev_plan() {
    println!("cargo:rerun-if-env-changed={DEV_PLAN_KEY}");
    // Look the value up unconditionally so the `rerun-if-changed` lines for the
    // env files are emitted in every profile — a release build that skipped them
    // would not re-run this script (and re-assert the skip) after an edit.
    let from_files = load_dotenv_var(DEV_PLAN_KEY, ".env.development")
        .or_else(|| load_dotenv_var(DEV_PLAN_KEY, ".env"));

    if std::env::var("PROFILE").as_deref() == Ok("release") {
        return;
    }

    let Some(raw) = std::env::var(DEV_PLAN_KEY).ok().or(from_files) else {
        return;
    };

    // `cargo:` instructions are line-oriented: a value carrying a newline would
    // let an env file inject arbitrary build directives. `parse_dotenv` reads a
    // single trimmed line so this should be unreachable — refuse loudly anyway
    // rather than pass it through.
    if raw.contains(['\n', '\r']) || raw.chars().any(char::is_control) {
        println!("cargo:warning={DEV_PLAN_KEY} contains control characters; ignoring it.");
        return;
    }

    println!("cargo:rustc-env={DEV_PLAN_BAKED_KEY}={raw}");
    if raw.is_empty() {
        println!(
            "cargo:warning={DEV_PLAN_KEY} is set but EMPTY — the dev paid-feature unlock is OFF. \
             (An empty value in .env.development shadows a real one in .env, in Vite and here alike.)"
        );
    } else {
        println!(
            "cargo:warning=DEV UNLOCK: building with {DEV_PLAN_KEY}={raw} — paid features are \
             unlocked in this DEBUG build without a licence. Never for release."
        );
    }
}

/// Walk up from the manifest dir looking for `file_name` (`.env`,
/// `.env.development`, …), returning the value for `key` if present. Supports
/// simple `KEY=VALUE` lines, `export KEY=...`, `#` comments, and surrounding
/// single/double quotes. Emits `rerun-if-changed` so a new value takes effect on
/// the next build.
fn load_dotenv_var(key: &str, file_name: &str) -> Option<String> {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").ok()?);
    let mut dir: Option<&Path> = Some(manifest.as_path());
    let mut found = None;
    while let Some(d) = dir {
        let candidate = d.join(file_name);
        if candidate.is_file() {
            println!("cargo:rerun-if-changed={}", candidate.display());
            if found.is_none() {
                if let Ok(contents) = std::fs::read_to_string(&candidate) {
                    found = parse_dotenv(&contents, key);
                }
            }
        }
        dir = d.parent();
    }
    found
}

fn parse_dotenv(contents: &str, key: &str) -> Option<String> {
    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        // A line with no `=` is not a definition — skip it. This used to `?`,
        // which abandoned the whole file: one stray word near the top and every
        // key below it silently read as absent.
        let Some((k, v)) = line.split_once('=') else {
            continue;
        };
        if k.trim() != key {
            continue;
        }
        let v = v.trim();
        let v = v
            .strip_prefix('"')
            .and_then(|s| s.strip_suffix('"'))
            .or_else(|| v.strip_prefix('\'').and_then(|s| s.strip_suffix('\'')))
            .unwrap_or(v);
        return Some(v.to_string());
    }
    None
}
