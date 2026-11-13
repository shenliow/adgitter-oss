//! ADGitter Tauri library entry point.
//!
//! Tauri 2 splits the binary into a thin `main.rs` shim plus this library
//! crate so the same code can be reused for mobile targets later.

mod commands;
/// DEBUG-ONLY paid-feature unlock (`VITE_DEV_PLAN`). The `cfg` is the security
/// boundary, not a build-time optimisation: it keeps the bypass out of release
/// binaries entirely. `dev_unlock.rs` fails the build if this guard is removed.
#[cfg(debug_assertions)]
mod dev_unlock;
mod loopback_auth;
mod svg_sanitize;
mod themes;
mod watch;

use tauri::{Emitter, Manager};

pub use git_core::{AdgitterError, AdgitterResult};

/// Payload of the `multi-window-upsell` event: **why** the second window was
/// refused, as an `AdgitterError` code.
///
/// It used to be a bare `()` and the UI always said "multi-window is a paid
/// feature". Once the entitlement gate checks device binding, that refusal also
/// covers a paying user on a reinstalled machine — who needs to sign in again,
/// not to buy anything. The code lets the frontend pick the right sentence.
#[derive(Clone, serde::Serialize)]
struct FeatureRefusal {
    code: &'static str,
}

impl FeatureRefusal {
    fn from(err: &AdgitterError) -> Self {
        Self { code: err.code() }
    }
}

/// Another window was asked for (a relaunch, or File → New Window). Opening it
/// is the paid `MultiWindow` feature; without it this refuses with the reason
/// the upsell should give.
async fn open_new_window(app: &tauri::AppHandle) -> AdgitterResult<()> {
    match commands::require_feature(app, license::Feature::MultiWindow).await {
        // Entitled, but this build has no multi-window to offer.
        Ok(()) => Err(AdgitterError::FeatureLocked("MultiWindow".into())),
        Err(e) => Err(e),
    }
}

/// Tell the main window why no new window opened. The reason travels with the
/// event: a low tier is an upsell, a wrong device or a lapsed licence is not.
fn refuse_new_window(app: &tauri::AppHandle, err: &AdgitterError) {
    let _ = app.emit_to("main", "multi-window-upsell", FeatureRefusal::from(err));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "adgitter=info,warn".into()),
        )
        .init();

    // If this build unlocks paid features without a licence, say so before
    // anything else runs. A silent override is how a developer ends up believing
    // the paywall works because the feature worked for them.
    #[cfg(debug_assertions)]
    dev_unlock::log_status();

    // Capture Rust panics as scrubbed telemetry. The sink always logs
    // locally and, once consent is granted (init_crash_reporting) with a
    // build-time SENTRY_DSN, also sends to Sentry.
    telemetry::install_panic_hook(std::sync::Arc::new(telemetry::SentrySink));

    tauri::Builder::default()
        // MultiWindow relaunch model (no in-app "open in new window" button):
        // launching the app a second time is forwarded here, to the PRIMARY
        // process, instead of spawning a second OS process. Must be the
        // FIRST plugin registered (the plugin's own requirement) so it can
        // intercept before anything else runs.
        //
        // The `deep-link` cargo feature on this plugin means an `adgitter://`
        // URL carried in a relaunch's argv is already routed to
        // `tauri-plugin-deep-link`'s handler (below) before this callback
        // runs — the standard single-instance + deep-link integration, and
        // also covers Windows/Linux (macOS routes deep links natively; this
        // callback still runs there but the deep-link forwarding is a no-op
        // when there's no `adgitter://` arg). That resolves the follow-up
        // this comment used to flag.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // A relaunch carrying an `adgitter://` deep link (e.g. the OAuth
            // browser callback reopening the app) is not a request for a new
            // window — the `deep-link` feature above already routed it.
            // Only a plain relaunch (no deep link) means "give me a window".
            if args.iter().any(|a| a.starts_with("adgitter://")) {
                return;
            }
            // This callback's thread varies by platform (a tokio task on
            // macOS, the main message-loop thread on Windows, a D-Bus
            // dispatch thread on Linux). `WebviewWindowBuilder::build` and
            // `set_focus` both dispatch to the main thread and block waiting
            // for a reply, which — same as the deadlock `spawn_repo_window`'s
            // doc comment warns sync commands into — self-deadlocks if
            // called while already ON that main thread (the Windows case).
            // Spawning onto the async runtime moves the work off whatever
            // thread we're on so the main-thread dispatch always has
            // somewhere else to return to.
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = open_new_window(&app).await {
                    // Not entitled *here*: no new window — focus whatever's
                    // open (prefer `main`) and let the UI explain why.
                    let existing = app
                        .get_webview_window("main")
                        .or_else(|| app.webview_windows().values().next().cloned());
                    if let Some(w) = existing {
                        if let Ok(true) = w.is_minimized() {
                            let _ = w.unminimize();
                        }
                        let _ = w.set_focus();
                    }
                    refuse_new_window(&app, &e);
                }
            });
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        // Routes the `adgitter://` OAuth callback to the running app; the
        // frontend subscribes via `@tauri-apps/plugin-deep-link` `onOpenUrl`.
        .plugin(tauri_plugin_deep_link::init())
        // Native menu with File → New Window. Reuses the existing
        // MultiWindow-gated path: on the paid tier it opens a fresh window
        // (`spawn_repo_window(None)`, same as a single-instance relaunch); on
        // free it emits `multi-window-upsell`, which the frontend surfaces as a
        // notice. Setting a custom menu replaces the platform default, so the
        // standard App/Edit/Window submenus are rebuilt alongside File.
        .menu(|app| {
            use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
            let new_window = MenuItemBuilder::with_id("new_window", "New Window")
                .accelerator("CmdOrCtrl+Shift+N")
                .build(app)?;
            let app_menu = SubmenuBuilder::new(app, "ADGitter")
                .about(None)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;
            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&new_window)
                .separator()
                .close_window()
                .build()?;
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .separator()
                .close_window()
                .build()?;
            MenuBuilder::new(app)
                .items(&[&app_menu, &file_menu, &edit_menu, &window_menu])
                .build()
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "new_window" {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = open_new_window(&app).await {
                        refuse_new_window(&app, &e);
                    }
                });
            }
        })
        .manage(watch::WatchState::default())
        // Holds the in-flight RFC 8252 loopback listener for sign-in. The
        // Clerk Account Portal will not redirect to a custom scheme, so the
        // login round-trip comes back over `http://127.0.0.1:<port>/callback`
        // instead — see `loopback_auth.rs`. The `adgitter://` scheme is still
        // registered above and still carries `checkout-complete` and
        // `issue/<id>`; only sign-in moved.
        .manage(loopback_auth::LoopbackAuthState::default())
        // MultiWindow: a repo window's watcher is keyed by its
        // window label, so when the window closes its entry must be dropped
        // explicitly — nothing else removes it (WatchState only ever grows
        // otherwise, across window creation/destruction).
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.state::<watch::WatchState>();
                watch::stop(&state, window.label());
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_commits,
            commands::list_refs,
            commands::list_commit_files,
            commands::diff_file,
            commands::file_history,
            commands::diff_worktree,
            commands::probe_path,
            commands::init_repository,
            commands::clone_repository,
            commands::ahead_behind,
            commands::remote_url,
            commands::fetch,
            commands::pull,
            commands::push,
            commands::push_branch,
            commands::log_commit,
            commands::tutorial_demo_create,
            commands::tutorial_demo_seed_files,
            commands::tutorial_demo_seed_history,
            commands::tutorial_demo_write_file,
            commands::tutorial_demo_simulate_log,
            commands::tutorial_demo_remove,
            commands::init_crash_reporting,
            commands::report_event,
            commands::debug_trigger_crash,
            commands::open_external_url,
            commands::open_path,
            commands::read_project_config,
            commands::write_project_config,
            commands::quarantine_project_config,
            commands::ping,
            commands::modifier_flags,
            commands::start_repo_watch,
            commands::stop_repo_watch,
            commands::repo_status,
            commands::stage_paths,
            commands::unstage_paths,
            commands::discard_paths,
            commands::create_commit,
            commands::git_identity_status,
            commands::git_email_get,
            commands::git_email_set,
            commands::git_name_set,
            commands::create_branch,
            commands::rename_branch,
            commands::set_upstream,
            commands::branch_upstream,
            commands::delete_branch,
            commands::checkout,
            commands::checkout_remote_branch,
            commands::inspect_remote_checkout,
            commands::adopt_remote_upstream_and_checkout,
            commands::create_tag,
            commands::delete_tag,
            commands::merge,
            commands::reset,
            commands::cherry_pick,
            commands::revert,
            commands::reword,
            commands::rebase,
            commands::rebase_onto,
            commands::rebase_branch,
            commands::drop_commit,
            commands::squash_range,
            commands::purge_path,
            commands::add_file_to_commit,
            commands::conflict_state,
            commands::continue_op,
            commands::abort_op,
            commands::undo,
            commands::undo_state,
            commands::expire_backups,
            commands::verify_license,
            commands::mint_test_license,
            commands::dev_seed_license,
            // DEBUG-ONLY runtime paid-feature unlock (the account menu's dev
            // plan switcher). The `cfg` is the security boundary: an absent
            // command cannot be invoked from the webview, whereas a registered
            // one that refuses is a single bad `cfg` expression away from
            // obeying. Removing this line's guard fails the release build —
            // `commands::set_dev_plan` does not exist there. See
            // `commands::set_dev_plan` and `dev_unlock.rs`.
            #[cfg(debug_assertions)]
            commands::set_dev_plan,
            commands::get_device_id,
            loopback_auth::start_loopback_auth,
            loopback_auth::await_loopback_auth,
            loopback_auth::cancel_loopback_auth,
            commands::issue_license,
            commands::sign_out,
            commands::renew_license,
            commands::trial_status,
            commands::start_trial,
            commands::create_checkout,
            commands::create_customer_portal,
            commands::clerk_portal_capabilities,
            themes::theme_catalog,
            themes::theme_pack,
            commands::check_feature,
            commands::list_devices,
            commands::remove_device,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ADGitter");
}
