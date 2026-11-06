//! Telemetry & error reporting.
//!
//! Builds a **scrubbed** diagnostic packet from panics / errors and hands it to
//! a [`Sink`]. The default [`TracingSink`] only logs locally; a Sentry sink is
//! added once a DSN is provisioned — network send is
//! consent-gated at the sink, never here. `error.code` is the fingerprint
//!. PII (paths, emails) is masked before anything leaves a
//! function, so even local logs are clean.

use std::sync::{Arc, LazyLock};

use regex::Regex;
use serde::Serialize;

static EMAIL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}").unwrap());
// Unix paths of ≥2 segments (so "and/or" is left alone) and Windows paths.
static PATH: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:/[^\s/:]+){2,}/?|[A-Za-z]:\\[^\s]+").unwrap());

/// Mask PII (emails, absolute paths) in free text before it is logged or sent.
pub fn scrub(input: &str) -> String {
    let s = EMAIL.replace_all(input, "<email>");
    PATH.replace_all(&s, "<path>").into_owned()
}

/// A telemetry event. `message` is already scrubbed; `error_code` is the
/// aggregation fingerprint (e.g. `GIT_ERROR`, `PANIC`).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DiagnosticPacket {
    pub release: String,
    pub os: String,
    pub error_code: String,
    pub message: String,
}

/// Build a scrubbed packet for `error_code` + free-text `message`.
pub fn packet(error_code: &str, message: &str) -> DiagnosticPacket {
    DiagnosticPacket {
        release: env!("CARGO_PKG_VERSION").to_string(),
        os: std::env::consts::OS.to_string(),
        error_code: error_code.to_string(),
        message: scrub(message),
    }
}

/// Where scrubbed packets go. Implementations decide on consent + transport.
pub trait Sink: Send + Sync {
    fn capture(&self, packet: &DiagnosticPacket);
}

/// Default sink: logs locally via `tracing` (no network). Always safe.
pub struct TracingSink;

impl Sink for TracingSink {
    fn capture(&self, p: &DiagnosticPacket) {
        tracing::error!(code = %p.error_code, os = %p.os, "telemetry: {}", p.message);
    }
}

/// Install a panic hook that captures a scrubbed `PANIC` packet, then chains to
/// the previous hook (so the default abort/log still runs).
pub fn install_panic_hook(sink: Arc<dyn Sink>) {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        sink.capture(&packet("PANIC", &info.to_string()));
        prev(info);
    }));
}

// --- Sentry sink (feature = "sentry") --------------------------------------
// Real network transport, gated behind the `sentry` feature so the crate's own
// tests stay dependency-light. The DSN is injected by the shell at build time
// (SENTRY_DSN) and never committed. Consent is enforced by an enable flag the
// shell flips from the user's choice — with it off, nothing is sent.
#[cfg(feature = "sentry")]
mod sentry_sink {
    use super::{packet, scrub, DiagnosticPacket, Sink};
    use std::borrow::Cow;
    use std::collections::BTreeMap;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::OnceLock;
    use std::time::Duration;

    static ENABLED: AtomicBool = AtomicBool::new(false);
    static GUARD: OnceLock<sentry::ClientInitGuard> = OnceLock::new();

    /// Turn on consent-gated reporting. Initializes the Sentry client once
    /// (idempotent) when a non-empty `dsn` is present, then flips the consent
    /// flag on. With `dsn = None`/empty it just arms the flag (still inert until
    /// a client exists). `before_send` scrubs message + exception as a
    /// defence-in-depth backstop (packets are already scrubbed upstream).
    pub fn enable_reporting(dsn: Option<&str>) {
        if let Some(dsn) = dsn {
            if !dsn.is_empty() {
                let _ = GUARD.get_or_init(|| {
                    sentry::init((
                        dsn.to_owned(),
                        sentry::ClientOptions {
                            release: Some(Cow::Borrowed(env!("CARGO_PKG_VERSION"))),
                            send_default_pii: false,
                            before_send: Some(std::sync::Arc::new(
                                |mut ev: sentry::protocol::Event<'static>| {
                                    if let Some(m) = ev.message.take() {
                                        ev.message = Some(scrub(&m));
                                    }
                                    for e in ev.exception.values.iter_mut() {
                                        if let Some(v) = e.value.take() {
                                            e.value = Some(scrub(&v));
                                        }
                                    }
                                    Some(ev)
                                },
                            )),
                            ..Default::default()
                        },
                    ))
                });
            }
        }
        ENABLED.store(true, Ordering::Relaxed);
    }

    /// Consent revoked: stop sending. The client stays initialized but inert.
    pub fn disable_reporting() {
        ENABLED.store(false, Ordering::Relaxed);
    }

    /// Sink that always logs locally and, when enabled, sends a scrubbed event
    /// to Sentry. `error.code` is both a tag and the aggregation fingerprint.
    pub struct SentrySink;

    impl Sink for SentrySink {
        fn capture(&self, p: &DiagnosticPacket) {
            tracing::error!(code = %p.error_code, os = %p.os, "telemetry: {}", p.message);
            if !ENABLED.load(Ordering::Relaxed) {
                return;
            }
            let mut tags = BTreeMap::new();
            tags.insert("error.code".to_string(), p.error_code.clone());
            sentry::capture_event(sentry::protocol::Event {
                message: Some(p.message.clone()),
                level: sentry::Level::Error,
                tags,
                fingerprint: Cow::Owned(vec![Cow::Owned(p.error_code.clone())]),
                ..Default::default()
            });
            // Error/crash paths are rare and may abort right after; flush so the
            // event is not lost (the guard lives for the process, never dropped).
            if let Some(client) = sentry::Hub::current().client() {
                client.flush(Some(Duration::from_secs(2)));
            }
        }
    }

    /// Build a scrubbed packet and route it to Sentry — the bridge the shell
    /// uses to forward frontend (WebView) errors to the same project.
    pub fn report(error_code: &str, message: &str) {
        SentrySink.capture(&packet(error_code, message));
    }
}

#[cfg(feature = "sentry")]
pub use sentry_sink::{disable_reporting, enable_reporting, report, SentrySink};

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[test]
    fn scrub_masks_emails_and_paths() {
        let out = scrub("failed at /Users/sefi/secret/repo/file.rs for a@b.com");
        assert!(!out.contains("sefi"));
        assert!(!out.contains("a@b.com"));
        assert!(out.contains("<path>"));
        assert!(out.contains("<email>"));
    }

    #[test]
    fn scrub_masks_windows_paths_but_not_innocent_slashes() {
        assert!(scrub(r"open C:\Users\me\repo failed").contains("<path>"));
        // a lone "and/or" is not a path
        assert_eq!(scrub("read and/or write"), "read and/or write");
    }

    #[test]
    fn packet_uses_code_as_fingerprint_and_scrubs() {
        let p = packet("GIT_ERROR", "boom at /home/x/y/z.rs");
        assert_eq!(p.error_code, "GIT_ERROR");
        assert!(p.message.contains("<path>"));
        assert_eq!(p.os, std::env::consts::OS);
    }

    #[test]
    fn panic_hook_captures_a_scrubbed_packet() {
        let seen: Arc<Mutex<Vec<DiagnosticPacket>>> = Arc::new(Mutex::new(vec![]));
        struct TestSink(Arc<Mutex<Vec<DiagnosticPacket>>>);
        impl Sink for TestSink {
            fn capture(&self, p: &DiagnosticPacket) {
                self.0.lock().unwrap().push(p.clone());
            }
        }
        install_panic_hook(Arc::new(TestSink(seen.clone())));
        let _ = std::panic::catch_unwind(|| panic!("kaboom at /tmp/a/b/c"));
        let _ = std::panic::take_hook(); // restore for other tests

        let events = seen.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].error_code, "PANIC");
        assert!(events[0].message.contains("<path>"));
    }
}
