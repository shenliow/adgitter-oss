//! Links that ask for a new window go to the user's browser.
//!
//! Nothing in the app opens a second WebView by link: every external page —
//! sign-in, checkout, a token page — is opened deliberately through the
//! `open_external_url` command. The one thing that *can't* take that route is
//! the free tier's ad. It runs in a sandboxed, opaque-origin iframe with no
//! IPC (see `lib/ads/CarbonAdsProvider.ts`), so a click on it reaches the shell
//! only as the WebView's own "open a new window" request. Left unhandled, wry
//! drops that request on every platform and the ad is dead to the click.
//!
//! The handler below answers the request by handing the URL to the system
//! browser and refusing the in-app window. The window is refused
//! unconditionally: an ad never gets a WebView of its own.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::webview::{NewWindowFeatures, NewWindowResponse};
use tauri::{Runtime, Url};

/// Shortest gap between two links handed to the browser. A person can't click
/// faster than this; a script calling `window.open` in a loop can, and the
/// frame it would be doing that from is third-party content.
const MIN_INTERVAL: Duration = Duration::from_secs(1);

/// Only web pages leave the app this way — never `file:`, `javascript:`, or a
/// custom scheme that would launch some other program.
fn is_web_url(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
}

/// Lets one link through per [`MIN_INTERVAL`].
#[derive(Default)]
struct Throttle {
    last: Mutex<Option<Instant>>,
}

impl Throttle {
    fn admit(&self, now: Instant) -> bool {
        let mut last = self.last.lock().unwrap_or_else(|e| e.into_inner());
        if last.is_some_and(|t| now.saturating_duration_since(t) < MIN_INTERVAL) {
            return false;
        }
        *last = Some(now);
        true
    }
}

/// The new-window handler for an app window: see the module docs.
pub fn open_in_browser<R: Runtime>(
) -> impl Fn(Url, NewWindowFeatures) -> NewWindowResponse<R> + Send + 'static {
    let throttle = Throttle::default();
    move |url, _features| {
        if !is_web_url(&url) {
            tracing::warn!(scheme = url.scheme(), "refused a new-window link");
        } else if throttle.admit(Instant::now()) {
            // The URL is not logged: an ad's click-through carries its tracking
            // parameters.
            if let Err(e) = opener::open(url.as_str()) {
                tracing::warn!(error = %e, "could not open a link in the browser");
            }
        }
        NewWindowResponse::Deny
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn only_web_urls_leave_the_app() {
        assert!(is_web_url(&url("https://srv.carbonads.net/ads/click/x")));
        assert!(is_web_url(&url("http://carbonads.net/?utm_source=app")));
        assert!(!is_web_url(&url("file:///etc/passwd")));
        assert!(!is_web_url(&url("javascript:alert(1)")));
        assert!(!is_web_url(&url("adgitter://issue/1")));
        assert!(!is_web_url(&url("about:blank")));
    }

    #[test]
    fn a_burst_of_links_opens_only_the_first() {
        let throttle = Throttle::default();
        let start = Instant::now();
        assert!(throttle.admit(start));
        assert!(!throttle.admit(start));
        assert!(!throttle.admit(start + MIN_INTERVAL / 2));
        assert!(throttle.admit(start + MIN_INTERVAL));
        // A refused link does not push the next allowed one further out.
        assert!(!throttle.admit(start + MIN_INTERVAL + MIN_INTERVAL / 2));
        assert!(throttle.admit(start + MIN_INTERVAL * 2));
    }
}
