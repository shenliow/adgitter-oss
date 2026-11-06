//! RFC 8252 loopback redirect for desktop sign-in.
//!
//! # Why not the `adgitter://` custom scheme?
//!
//! Sign-in used to redirect to `adgitter://callback`. The OS scheme
//! registration works (and the *other* two deep links —
//! `adgitter://checkout-complete` and `adgitter://issue/<id>` — still use it),
//! but Clerk's hosted **Account Portal** refuses to bounce a `redirect_url`
//! that is not an http(s) URL on an allowed origin: a custom scheme has no
//! origin, so the portal silently drops the redirect and the user is stranded
//! on the web page. Clerk's "Allowlist for mobile SSO redirect" does not help —
//! that governs the native SSO/OAuth flow (`createRedirectUrl`), a different
//! mechanism.
//!
//! So we do what every other desktop OAuth client does (RFC 8252 §7.3, and in
//! practice `gh auth login`, Docker Desktop, `gcloud auth`): the app opens a
//! **temporary HTTP server on the loopback interface** and hands Clerk a plain
//! `http://127.0.0.1:<port>/bridge` redirect. Clerk treats that like any
//! localhost dev origin, which it natively supports.
//!
//! # Why a *bridge page* and not just a callback
//!
//! The redirect alone is not enough, and this was measured, not guessed: the
//! only parameter Clerk's Account Portal puts on the redirect is
//! `__clerk_db_jwt` — a 31-character **development-browser handshake token**,
//! not a JWT and not a session token. Clerk's session lives in a cookie on the
//! Clerk domain and is only reachable by a page that has **loaded Clerk JS** and
//! called `session.getToken()`. A pure redirect therefore *cannot* deliver a
//! session JWT; feeding `__clerk_db_jwt` to `/license/issue` just earns a JWKS
//! rejection, which is exactly how sign-in was failing.
//!
//! So the loopback server serves the page itself:
//!
//! ```text
//! portal ──redirect──▶ GET  http://127.0.0.1:<port>/bridge?state=<nonce>&__clerk_db_jwt=…
//!                       │   (server answers with the bridge page; keeps listening)
//!                       ▼
//!                      page loads Clerk JS from the instance's Frontend API,
//!                      adopts the session via __clerk_db_jwt, getToken()
//!                       │
//!                       ▼
//!                      POST http://127.0.0.1:<port>/bridge/token   (same origin)
//!                      body: state=<nonce>&token=<session JWT>
//!                            (+ best-effort profile: name, email, avatar,
//!                            username, read straight off Clerk.user)
//!                       │
//!                       ▼
//!                      server verifies `state`, hands the token to the app,
//!                      *then* stops and frees the port
//! ```
//!
//! # Threat model
//!
//! A loopback listener is reachable by *every* local process and by *every* web
//! page the user has open (a page can navigate to, or fetch, `127.0.0.1`). It is
//! therefore treated as hostile input:
//!
//! * **Bind loopback only.** [`bind_loopback`] binds `127.0.0.1`, never
//!   `0.0.0.0` — the wildcard would expose the callback to anyone on the same
//!   Wi-Fi, who could then inject their own `?token=` and sign the user into an
//!   attacker's account. Connections whose peer is not loopback are dropped as a
//!   second layer.
//! * **Unguessable `state`.** Each sign-in mints a 244-bit random nonce
//!   ([`new_nonce`]) that travels in the redirect URL. **Every** endpoint checks
//!   it — the bridge page *and* the token POST — and a request whose `state`
//!   does not match is answered with a refusal and **ignored**: the server keeps
//!   waiting for the real one. The comparison is constant-time
//!   ([`constant_time_eq`]) so a local attacker cannot time-probe the nonce byte
//!   by byte.
//! * **The token never travels on a URL.** It comes back in a `POST` body, so it
//!   never lands in browser history, in a `Referer`, or in any intermediary's
//!   access log. [`BRIDGE_TOKEN_PATH`] answers `405` to a `GET`, *including* one
//!   that carries the right `state`.
//! * **Same origin, no redirects.** The bridge page and the token endpoint are
//!   the same `http://127.0.0.1:<port>` origin. Nothing here ever emits a
//!   `Location` header, so there is no open redirect to leak a token through,
//!   and a `POST` whose `Origin` header names a *different* origin is refused.
//! * **Locked-down bridge page.** The page ships a strict CSP
//!   ([`BridgeConfig::csp`]): `default-src 'none'`, the only script sources are
//!   a per-response **nonce** (for our own inline script) and the instance's
//!   Clerk Frontend API host. No `unsafe-inline`, no `unsafe-eval`.
//! * **Delivery, not first contact, ends the wait.** One sign-in is now several
//!   requests (page `GET`, then the token `POST`). The server stops on the first
//!   request that *delivers* an outcome — never merely because it served the
//!   page.
//! * **Bounded lifetime.** The listener self-destructs after
//!   [`CALLBACK_TIMEOUT`], so an abandoned sign-in never squats on the port.
//! * **Never log the payload.** Nothing in this module logs a query string, a
//!   request body, a parameter value, or the nonce — only the port and coarse
//!   outcomes. `never_logs_the_session_token` holds that line.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine as _;
use git_core::{AdgitterError, AdgitterResult};
use tauri::{AppHandle, Manager, State};

/// Ports tried, in order, for the loopback callback.
///
/// **Fixed, not ephemeral.** Clerk's redirect allowlist enumerates URLs one by
/// one, so a random port would be un-allowlistable on a production instance.
/// Three candidates give us headroom when one is already taken without asking
/// the user to paste in a long list; every one of them must be added to Clerk's
/// allowed-redirect list. The values are in the IANA dynamic range and
/// were picked to avoid the well-known dev-server ports (3000/4200/5173/8080…).
pub const CANDIDATE_PORTS: [u16; 3] = [47821, 47822, 47823];

/// The legacy redirect path.
///
/// No longer what we hand Clerk — the portal cannot deliver a session token by
/// redirect at all, which is why [`BRIDGE_PATH`] exists — but still honoured:
/// an already-allowlisted URL, a bookmarked portal link, or a future flow that
/// really does carry a token on the query must not be silently dropped.
pub const CALLBACK_PATH: &str = "/callback";

/// Where Clerk now sends the browser: the page that loads Clerk JS, adopts the
/// session and posts the real JWT back to [`BRIDGE_TOKEN_PATH`].
pub const BRIDGE_PATH: &str = "/bridge";

/// The **`POST`-only** endpoint the bridge page hands the session JWT to.
///
/// `POST`-only on purpose: a token on a URL would be written to browser
/// history and to every log between here and nowhere. A `GET` is `405`, even
/// with a valid `state`.
pub const BRIDGE_TOKEN_PATH: &str = "/bridge/token";

/// How long the listener waits for the browser round-trip before shutting down
/// and releasing the port. Long enough to create an account, verify an email and
/// pass MFA; short enough that a forgotten sign-in does not hold the port for
/// the rest of the session.
pub const CALLBACK_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// How often the accept loop wakes to re-check the deadline / cancel flag.
const ACCEPT_POLL: Duration = Duration::from_millis(25);

/// Per-connection I/O budget, so one stalled client cannot wedge the loop.
const CONNECTION_IO_TIMEOUT: Duration = Duration::from_secs(5);

/// Cap on the request head (line + headers) we are willing to read. Clerk's
/// callback is a few KB with cookies; anything beyond this is not a callback,
/// and the ceiling is what stops a local process from making us buffer forever.
const MAX_REQUEST_HEAD: u64 = 32 * 1024;

/// Cap on the request *body* we read (the token `POST`). A Clerk session JWT is
/// ~1 KB; 16 KB is generous and still bounds what a local process can make us
/// buffer.
const MAX_REQUEST_BODY: usize = 16 * 1024;

/// Cap on how many header lines we drain before giving up on politeness.
const MAX_REQUEST_HEADERS: usize = 100;

// ── Nonce ────────────────────────────────────────────────────────────────────

/// A fresh 244-bit hex nonce for the `state` parameter.
///
/// Two v4 UUIDs concatenated: `uuid`'s v4 generator is a CSPRNG (`getrandom`),
/// and 2 × 122 random bits is far beyond guessing inside a 5-minute window.
/// Hex-only, so it needs no escaping inside a URL.
pub fn new_nonce() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

/// A fresh CSP `script-src`/`style-src` nonce for one bridge-page response.
///
/// Separate from the `state` nonce and regenerated per response: reusing
/// `state` here would publish the anti-forgery secret into the document, and a
/// fixed nonce would make the CSP a formality.
fn new_csp_nonce() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

/// Compare two byte strings without an early exit on the first mismatch.
///
/// The `state` check gates whether we hand a Clerk session JWT to the caller, and
/// any local process may hammer the port; a short-circuiting `==` would leak the
/// nonce a byte at a time through response timing. The length is allowed to leak
/// (it is a compile-time constant here). `black_box` keeps an optimiser from
/// re-introducing the early exit.
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    std::hint::black_box(diff) == 0
}

// ── Request parsing ──────────────────────────────────────────────────────────

/// The method, path and query of a request line.
#[derive(Debug, PartialEq, Eq)]
pub struct RequestLine {
    pub method: String,
    pub path: String,
    pub query: String,
}

/// Split a `<METHOD> <target> HTTP/1.x` request line, or `None` when it is not
/// one.
///
/// The method is *returned*, not filtered, because the two endpoints differ on
/// it: [`BRIDGE_TOKEN_PATH`] must accept a `POST` and refuse a `GET`, and that
/// distinction is the reason the session token never reaches a URL.
pub fn parse_request_line(line: &str) -> Option<RequestLine> {
    let mut parts = line.trim_end().split(' ');
    let method = parts.next()?;
    let target = parts.next()?;
    let version = parts.next()?;
    if method.is_empty() || !method.bytes().all(|b| b.is_ascii_uppercase()) {
        return None;
    }
    if !version.starts_with("HTTP/") {
        return None;
    }
    // An absolute-form target (`GET http://127.0.0.1:1/callback?x=1 HTTP/1.1`)
    // is legal HTTP/1.1 and proxies emit it; take only the path+query.
    let target = match target.find("://") {
        Some(i) => match target[i + 3..].find('/') {
            Some(j) => &target[i + 3 + j..],
            None => "/",
        },
        None => target,
    };
    let (path, query) = match target.split_once('?') {
        Some((p, q)) => (p, q),
        None => (target, ""),
    };
    Some(RequestLine {
        method: method.to_string(),
        path: path.to_string(),
        query: query.to_string(),
    })
}

/// Decode an `application/x-www-form-urlencoded` payload — a URL query string
/// or a form-encoded request body; the grammar is the same.
///
/// Percent-escapes are decoded and `+` means space, matching what a browser
/// produces. A repeated key keeps the **first** occurrence: a hostile page that
/// appends a second `state=` (or a second `token=`) must not be able to override
/// what Clerk — or our own bridge page — actually sent.
pub fn parse_query(query: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (raw_key, raw_value) = pair.split_once('=').unwrap_or((pair, ""));
        let key = decode_component(raw_key);
        if key.is_empty() {
            continue;
        }
        out.entry(key)
            .or_insert_with(|| decode_component(raw_value));
    }
    out
}

fn decode_component(s: &str) -> String {
    let plus_decoded = s.replace('+', " ");
    percent_encoding::percent_decode_str(&plus_decoded)
        .decode_utf8_lossy()
        .into_owned()
}

/// One parsed request: the line, the two headers we care about, and the body.
struct Request {
    method: String,
    path: String,
    query: String,
    /// `application/x-www-form-urlencoded` body of a `POST`. Empty otherwise.
    /// **Carries the session JWT on the token endpoint — never logged.**
    body: String,
    /// The browser's `Origin`, when it sent one (it always does on a `POST`).
    origin: Option<String>,
}

/// Read one request off `stream`: the request line, `Content-Length`/`Origin`,
/// and — for a `POST` — the body.
///
/// Every read is bounded, in bytes and in time (the caller sets the socket
/// timeouts), so no local process can make us buffer or block without limit.
/// The whole head *and* body must fit the combined `take` budget.
fn read_request(stream: &mut TcpStream) -> Option<Request> {
    let mut line = String::new();
    let mut content_length: usize = 0;
    let mut origin: Option<String> = None;
    let mut body = String::new();

    {
        // Bounded, so a client that never sends a newline cannot make us buffer
        // without limit; the connection read timeout bounds it in time.
        let budget = MAX_REQUEST_HEAD + MAX_REQUEST_BODY as u64;
        let mut reader = BufReader::new(Read::by_ref(stream).take(budget));
        if reader.read_line(&mut line).is_err() || line.is_empty() {
            return None;
        }
        // Drain the request headers up to the blank line. We need only two of
        // them, but leaving unread bytes in the socket turns the close below
        // into an RST on some platforms, which the browser renders as a failed
        // page.
        let mut header = String::new();
        for _ in 0..MAX_REQUEST_HEADERS {
            header.clear();
            match reader.read_line(&mut header) {
                Ok(0) => break,
                Ok(_) if header.trim_end().is_empty() => break,
                Ok(_) => {
                    let Some((name, value)) = header.split_once(':') else {
                        continue;
                    };
                    match name.trim().to_ascii_lowercase().as_str() {
                        "content-length" => content_length = value.trim().parse().unwrap_or(0),
                        "origin" => origin = Some(value.trim().to_string()),
                        _ => {}
                    }
                }
                Err(_) => break,
            }
        }
        // A client that promises more than it sends is cut off by the socket
        // read timeout. One that promises more than we allow is **not** read at
        // all: truncating it would leave a half-parsed body whose leading
        // `state=` still matched, and we would hand the caller a mangled token.
        // Left empty, it fails the `state` check like any other junk.
        if content_length > 0 && content_length <= MAX_REQUEST_BODY {
            let mut buf = vec![0u8; content_length];
            if reader.read_exact(&mut buf).is_ok() {
                body = String::from_utf8_lossy(&buf).into_owned();
            }
        }
    }

    let parsed = parse_request_line(&line)?;
    Some(Request {
        method: parsed.method,
        path: parsed.path,
        query: parsed.query,
        body,
        origin,
    })
}

// ── The bridge page ──────────────────────────────────────────────────────────

/// What the bridge page needs to talk to this Clerk instance.
///
/// Both fields are derived from — and validated against — the **publishable
/// key**, which is public by design (it ships inside the WebView bundle
/// already). The frontend passes it in on [`start_loopback_auth`] rather than
/// Rust growing a second copy of the env plumbing; because it then crosses an
/// IPC boundary it is treated as untrusted input and validated to a strict
/// charset before it is ever interpolated into HTML or into a CSP header.
#[derive(Clone, Debug)]
pub struct BridgeConfig {
    publishable_key: String,
    frontend_api: String,
}

/// A Clerk publishable key is `pk_(test|live)_<base64("<fapi-host>$")>`. Accept
/// only that shape, and only base64's own alphabet: this string is interpolated
/// into an HTML attribute, so anything that could carry a quote or an angle
/// bracket is rejected outright rather than escaped.
fn valid_publishable_key(key: &str) -> bool {
    let Some(rest) = key
        .strip_prefix("pk_test_")
        .or_else(|| key.strip_prefix("pk_live_"))
    else {
        return false;
    };
    !rest.is_empty()
        && rest.len() <= 256
        && rest
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'=' | b'-' | b'_'))
}

/// A hostname made only of LDH labels. This value becomes a `script-src` /
/// `connect-src` source and a `src=` URL, so "looks like a hostname" is the
/// whole defence against a crafted key turning the CSP into a wildcard or the
/// page into an injection.
fn valid_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && host.split('.').count() >= 2
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
}

/// The Frontend API host encoded in a Clerk publishable key, e.g.
/// `discrete-ibex-7.clerk.accounts.dev`. Mirrors `clerkFrontendApi()` in
/// `auth.svelte.ts`; kept in Rust as well so the page's script origin is
/// derived from the key itself rather than trusted from the caller.
pub fn clerk_frontend_api(key: &str) -> Option<String> {
    if !valid_publishable_key(key) {
        return None;
    }
    let b64 = key
        .strip_prefix("pk_test_")
        .or_else(|| key.strip_prefix("pk_live_"))?
        .trim_end_matches('=');
    let decoded = base64::engine::general_purpose::STANDARD_NO_PAD
        .decode(b64)
        .ok()?;
    let host = String::from_utf8(decoded).ok()?;
    let host = host.trim_end_matches('$').to_ascii_lowercase();
    valid_host(&host).then_some(host)
}

/// The bridge page. `{{…}}` placeholders are filled by [`BridgeConfig::page`]
/// with values already constrained to a strict charset, so no escaping pass is
/// needed (and none is relied on).
///
/// **English only, deliberately** — same reasoning as [`SUCCESS_HTML`]: a
/// throwaway browser tab served by a small Rust HTTP server that has no access
/// to the frontend's i18n bundles.
///
/// Notice what the script does *not* do: it never renders the token, never puts
/// it on a URL, and never navigates anywhere. It reads `state` from the query
/// (Clerk's own `__clerk_db_jwt` is left on the URL for Clerk JS to consume),
/// asks Clerk for the session JWT, `POST`s it same-origin, and only then wipes
/// the query out of history.
const BRIDGE_HTML: &str = r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ADGitter — finishing sign-in</title>
<style nonce="{{CSP_NONCE}}">
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
         display: grid; place-items: center; min-height: 100vh; margin: 0; }
  main { text-align: center; padding: 2rem; max-width: 32rem; }
  h1 { font-size: 1.4rem; margin: 0 0 .5rem; }
  p { margin: 0; opacity: .75; }
</style>
</head>
<body>
<main>
  <h1 id="title">Finishing sign-in…</h1>
  <p id="detail">Keep this tab open for a moment.</p>
</main>
<script
  nonce="{{CSP_NONCE}}"
  crossorigin="anonymous"
  data-clerk-publishable-key="{{PUBLISHABLE_KEY}}"
  src="https://{{FRONTEND_API}}/npm/@clerk/clerk-js@5/dist/clerk.browser.js"
></script>
<script nonce="{{CSP_NONCE}}">
(function () {
  var state = new URLSearchParams(location.search).get("state") || "";

  function say(title, detail) {
    document.getElementById("title").textContent = title;
    document.getElementById("detail").textContent = detail;
    // The query carries Clerk's handshake token; drop it from the address bar
    // and from history now that Clerk JS has had its chance to read it.
    try { history.replaceState({}, "", location.pathname); } catch (e) {}
  }

  // The session JWT goes back in a POST body — never on a URL, never to any
  // origin but the one that served this page.
  function post(fields) {
    fields.set("state", state);
    return fetch("/bridge/token", {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: fields.toString()
    });
  }

  // First candidate that is a non-blank string, trimmed. Used to pick a
  // display name out of whichever Clerk.user fields are actually populated.
  function firstNonEmpty() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (typeof v === "string") {
        v = v.replace(/^\s+|\s+$/g, "");
        if (v) { return v; }
      }
    }
    return "";
  }

  // Set a profile field on the outgoing POST, trimmed and length-capped —
  // never as an empty string. `handle_token_post` on the Rust side treats an
  // empty params map as "nothing delivered", so a blank value here must be
  // omitted rather than sent, or it could push over a real value later
  // instead of just being absent.
  function addField(fields, key, value, cap) {
    if (typeof value !== "string") { return; }
    value = value.replace(/^\s+|\s+$/g, "");
    if (!value) { return; }
    fields.set(key, value.slice(0, cap));
  }

  function fail(code) {
    var fields = new URLSearchParams();
    fields.set("error", code);
    post(fields)["catch"](function () {})["then"](function () {
      say("Sign-in could not be completed", "Go back to ADGitter and try again.");
    });
  }

  if (!window.Clerk) { fail("clerk_unavailable"); return; }

  window.Clerk.load()
    .then(function () {
      var session = window.Clerk.session;
      if (!session) { fail("no_session"); return; }
      return session.getToken().then(function (token) {
        if (!token) { fail("no_token"); return; }
        var fields = new URLSearchParams();
        fields.set("token", token);
        // Best-effort profile harvest — never fatal to a working sign-in. If
        // Clerk.user is null, has an unexpected shape, or throws, the fields
        // set above (just the token) still go out unchanged: a profile
        // failure must never turn a working sign-in into "bridge_failed".
        // Every value is trimmed and length-capped (name/email/username to
        // 256 chars, avatar to 512) — the request body is capped at
        // MAX_REQUEST_BODY (16 KiB) on the Rust side and a session JWT alone
        // already uses roughly 1-2 KiB of that budget, so an unbounded field
        // could push the whole POST over the limit and drop the sign-in.
        try {
          var user = window.Clerk.user;
          if (user) {
            var name = firstNonEmpty(
              user.fullName,
              (user.firstName || "") + " " + (user.lastName || ""),
              user.username
            );
            addField(fields, "name", name, 256);
            addField(
              fields,
              "email",
              user.primaryEmailAddress && user.primaryEmailAddress.emailAddress,
              256
            );
            if (typeof user.imageUrl === "string" && user.imageUrl.indexOf("https://") === 0) {
              addField(fields, "avatar", user.imageUrl, 512);
            }
            addField(fields, "username", user.username, 256);
          }
        } catch (e) {}
        return post(fields).then(function (response) {
          if (!response.ok) { throw new Error("refused"); }
          say("You're signed in to ADGitter", "You can close this tab and go back to the app.");
        });
      });
    })["catch"](function () { fail("bridge_failed"); });
})();
</script>
</body>
</html>
"#;

impl BridgeConfig {
    /// Derive the bridge configuration from a Clerk publishable key, or refuse.
    ///
    /// The error deliberately says nothing about the value it was given: it
    /// travels back through IPC into a log the user may paste somewhere.
    pub fn from_publishable_key(key: &str) -> AdgitterResult<Self> {
        let frontend_api = clerk_frontend_api(key).ok_or_else(|| {
            AdgitterError::Internal(
                "sign-in cannot start: the Clerk publishable key is missing or malformed, so the \
                 sign-in bridge has no Frontend API host to talk to."
                    .into(),
            )
        })?;
        Ok(Self {
            publishable_key: key.to_string(),
            frontend_api,
        })
    }

    /// The Content-Security-Policy the bridge page is served under.
    ///
    /// `default-src 'none'` and then the two things the page genuinely needs:
    /// our own inline script (by per-response nonce) and Clerk JS from this
    /// instance's Frontend API host. No `unsafe-inline`, no `unsafe-eval`, no
    /// wildcard — Clerk's telemetry endpoint is *not* allowlisted and simply
    /// fails closed. `form-action 'none'` plus `base-uri 'none'` mean the page
    /// cannot be made to send anything anywhere else.
    pub fn csp(&self, csp_nonce: &str) -> String {
        format!(
            "default-src 'none'; \
             base-uri 'none'; \
             form-action 'none'; \
             frame-ancestors 'none'; \
             script-src 'nonce-{csp_nonce}' https://{fapi}; \
             connect-src 'self' https://{fapi}; \
             frame-src https://{fapi}; \
             img-src 'self' data:; \
             style-src 'nonce-{csp_nonce}'; \
             worker-src 'self' blob:",
            fapi = self.frontend_api
        )
    }

    /// Render the bridge page for one response.
    fn page(&self, csp_nonce: &str) -> String {
        BRIDGE_HTML
            .replace("{{CSP_NONCE}}", csp_nonce)
            .replace("{{PUBLISHABLE_KEY}}", &self.publishable_key)
            .replace("{{FRONTEND_API}}", &self.frontend_api)
    }
}

// ── Responses ────────────────────────────────────────────────────────────────

/// The page the browser lands on after a successful legacy `/callback`.
///
/// **English only, deliberately.** Every other user-facing string ships in eight
/// locales, but this one is not part of the app UI: it is a throwaway tab in the
/// system browser, rendered by a small HTTP server that has no access to the
/// frontend's i18n bundles and no reliable signal for the user's chosen app
/// language (`Accept-Language` is the *browser's* setting, which routinely
/// disagrees). Pulling the locale catalogue into the Rust callback server to
/// translate one sentence the user reads for two seconds — the app window has
/// already come forward and shows the real, localised state — is not a trade
/// worth making. Revisit if the page ever grows into an error-explaining surface.
const SUCCESS_HTML: &str = r#"<!doctype html>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ADGitter — signed in</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
         display: grid; place-items: center; min-height: 100vh; margin: 0; }
  main { text-align: center; padding: 2rem; max-width: 32rem; }
  h1 { font-size: 1.4rem; margin: 0 0 .5rem; }
  p { margin: 0; opacity: .75; }
</style>
<main>
  <h1>You're signed in to ADGitter</h1>
  <p>You can close this tab and go back to the app.</p>
</main>
<script>
  // Drop the callback query string (it carries the session token) from the
  // address bar and from browser history before anything can read it back.
  history.replaceState({}, "", location.pathname);
</script>
"#;

/// Shown when the portal bounced back with an explicit `error=` — in practice
/// the user declining. Nothing to hand over, so the wait ends here.
const CANCELLED_HTML: &str = r#"<!doctype html>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<title>ADGitter</title>
<p>Sign-in was not completed. Go back to the ADGitter app and try again.</p>
"#;

/// Shown to whoever hit the callback port with the wrong (or no) `state`.
///
/// Says nothing about what was expected: this is exactly the request a hostile
/// local process or web page would make, and it gets no oracle beyond "no".
const REFUSED_HTML: &str = r#"<!doctype html>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<title>ADGitter</title>
<p>This request was not recognised. Start sign-in from the ADGitter app.</p>
"#;

const NOT_FOUND_HTML: &str = r#"<!doctype html>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<title>ADGitter</title>
<p>Not found.</p>
"#;

/// Write a complete, non-cacheable HTTP/1.1 response and half-close.
///
/// `no-store` keeps the token-bearing exchange out of the disk cache; the
/// absence of any CORS header means a cross-origin page cannot read the body,
/// and the absence of any `Location` header means this server can never be
/// turned into an open redirect that carries a token off-box.
///
/// Only the *write* side is shut down. A full `Shutdown::Both` with request
/// bytes still unread makes the kernel answer with an RST, and the browser then
/// shows its own "connection was reset" page instead of ours — the user would
/// think sign-in had failed even though it succeeded.
fn write_response_with(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &str,
    extra_headers: &[String],
) {
    let mut response = format!(
        "HTTP/1.1 {status}\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {len}\r\n\
         Cache-Control: no-store\r\n\
         Referrer-Policy: no-referrer\r\n\
         X-Content-Type-Options: nosniff\r\n\
         Connection: close\r\n",
        len = body.len()
    );
    for header in extra_headers {
        response.push_str(header);
        response.push_str("\r\n");
    }
    response.push_str("\r\n");
    response.push_str(body);
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
    let _ = stream.shutdown(std::net::Shutdown::Write);
}

fn write_response(stream: &mut TcpStream, status: &str, body: &str) {
    write_response_with(stream, status, "text/html; charset=utf-8", body, &[]);
}

/// Answer the token `POST`. The body is a fixed word — never an echo of what
/// was sent, and never a reason.
fn write_text(stream: &mut TcpStream, status: &str, body: &str) {
    write_response_with(stream, status, "text/plain; charset=utf-8", body, &[]);
}

// ── The server ───────────────────────────────────────────────────────────────

/// How a single connection was disposed of.
#[derive(Debug, PartialEq, Eq)]
enum Disposition {
    /// A `state`-verified request that *delivers an outcome* (a session token,
    /// or the portal's own error); the server stops.
    Accepted(HashMap<String, String>),
    /// Anything else — including serving the bridge page itself — the server
    /// answered and keeps waiting.
    Ignored,
}

/// Read one request off `stream`, answer it, and say whether it settled the
/// sign-in.
///
/// The `state` check is the whole security boundary and it guards **every**
/// endpoint: the bridge page, the token `POST` and the legacy callback each
/// compare `state` to `nonce` byte-for-byte in constant time before doing
/// anything. The matched `state` is stripped from the returned map — it is our
/// own value echoed back, not something the caller should forward anywhere.
fn handle_connection(
    stream: &mut TcpStream,
    nonce: &str,
    bridge: &BridgeConfig,
    port: u16,
) -> Disposition {
    let _ = stream.set_read_timeout(Some(CONNECTION_IO_TIMEOUT));
    let _ = stream.set_write_timeout(Some(CONNECTION_IO_TIMEOUT));

    let Some(request) = read_request(stream) else {
        write_response(stream, "400 Bad Request", NOT_FOUND_HTML);
        return Disposition::Ignored;
    };

    // Order matters: the token endpoint is matched (and its method enforced)
    // before anything else, so a `GET /bridge/token?token=…` can never fall
    // through to a handler that would read the query.
    if request.path == BRIDGE_TOKEN_PATH {
        if request.method != "POST" {
            // A session JWT on a URL would be persisted in browser history and
            // in every access log on the way. There is no "but the state
            // matched" exception.
            tracing::warn!("loopback auth: refused a non-POST request to the token endpoint");
            write_text(stream, "405 Method Not Allowed", "method not allowed");
            return Disposition::Ignored;
        }
        return handle_token_post(stream, &request, nonce, port);
    }
    if request.path == BRIDGE_PATH {
        if request.method != "GET" {
            write_text(stream, "405 Method Not Allowed", "method not allowed");
            return Disposition::Ignored;
        }
        return handle_bridge_get(stream, &request, nonce, bridge);
    }
    if request.path == CALLBACK_PATH {
        if request.method != "GET" {
            write_text(stream, "405 Method Not Allowed", "method not allowed");
            return Disposition::Ignored;
        }
        return handle_callback_get(stream, &request, nonce);
    }
    write_response(stream, "404 Not Found", NOT_FOUND_HTML);
    Disposition::Ignored
}

/// Constant-time `state` check against a decoded parameter map.
fn state_matches(params: &HashMap<String, String>, nonce: &str) -> bool {
    let supplied = params.get("state").map(String::as_str).unwrap_or_default();
    constant_time_eq(supplied.as_bytes(), nonce.as_bytes())
}

/// `GET /bridge` — serve the page that will fetch the real session JWT.
///
/// **Not terminal.** Serving the page is the *middle* of the round-trip; the
/// listener has to stay up for the `POST` the page is about to make. Only an
/// explicit `error=` from the portal settles things here.
fn handle_bridge_get(
    stream: &mut TcpStream,
    request: &Request,
    nonce: &str,
    bridge: &BridgeConfig,
) -> Disposition {
    let params = parse_query(&request.query);
    if !state_matches(&params, nonce) {
        // Deliberately coarse: no nonce, no query string, no parameter names in
        // the log line — this path is reachable by any local process, and its
        // failures must not become a side channel.
        tracing::warn!("loopback auth: rejected a bridge request with a mismatched state");
        write_response(stream, "403 Forbidden", REFUSED_HTML);
        return Disposition::Ignored;
    }
    // The portal came back with an explicit error (in practice the user
    // declining). There is no session to adopt, so settle now rather than make
    // the app sit out the full timeout.
    if let Some(error) = params.get("error") {
        write_response(stream, "200 OK", CANCELLED_HTML);
        return Disposition::Accepted(HashMap::from([("error".to_string(), error.clone())]));
    }
    let csp_nonce = new_csp_nonce();
    write_response_with(
        stream,
        "200 OK",
        "text/html; charset=utf-8",
        &bridge.page(&csp_nonce),
        &[format!(
            "Content-Security-Policy: {}",
            bridge.csp(&csp_nonce)
        )],
    );
    tracing::info!("loopback auth: served the sign-in bridge; waiting for the session token");
    Disposition::Ignored
}

/// `POST /bridge/token` — the one way a session JWT enters this process.
fn handle_token_post(
    stream: &mut TcpStream,
    request: &Request,
    nonce: &str,
    port: u16,
) -> Disposition {
    // Same-origin only. Browsers attach `Origin` to every POST, so a page on
    // any other origin is identifiable here even before the nonce is looked at;
    // a non-browser client sends none and is left to the nonce alone.
    if let Some(origin) = &request.origin {
        let ours = [
            format!("http://127.0.0.1:{port}"),
            format!("http://localhost:{port}"),
        ];
        if !ours.iter().any(|o| o == origin) {
            tracing::warn!("loopback auth: rejected a cross-origin post to the token endpoint");
            write_text(stream, "403 Forbidden", "forbidden");
            return Disposition::Ignored;
        }
    }
    // The body — not the URL. Same first-value-wins decoding as the query, so a
    // trailing `&state=` cannot override the real one.
    let mut params = parse_query(&request.body);
    if !state_matches(&params, nonce) {
        tracing::warn!("loopback auth: rejected a token post with a mismatched state");
        write_text(stream, "403 Forbidden", "forbidden");
        return Disposition::Ignored;
    }
    params.remove("state");
    if params.is_empty() {
        // Right nonce, nothing delivered. Not an outcome; keep waiting.
        write_text(stream, "400 Bad Request", "bad request");
        return Disposition::Ignored;
    }
    write_text(stream, "200 OK", "ok");
    Disposition::Accepted(params)
}

/// `GET /callback` — the legacy shape, unchanged.
fn handle_callback_get(stream: &mut TcpStream, request: &Request, nonce: &str) -> Disposition {
    let mut params = parse_query(&request.query);
    if !state_matches(&params, nonce) {
        tracing::warn!("loopback auth: rejected a callback with a mismatched state");
        write_response(stream, "403 Forbidden", REFUSED_HTML);
        return Disposition::Ignored;
    }
    params.remove("state");
    write_response(stream, "200 OK", SUCCESS_HTML);
    Disposition::Accepted(params)
}

/// Why the wait for a callback ended.
#[derive(Debug)]
pub enum CallbackOutcome {
    /// A `state`-verified request delivered an outcome; these are its
    /// parameters (minus `state`). **Contains the session token — never log
    /// it.**
    Received(HashMap<String, String>),
    /// [`CALLBACK_TIMEOUT`] elapsed with no valid callback.
    TimedOut,
    /// The app asked for the listener to go away (a new sign-in started, or the
    /// browser failed to open).
    Cancelled,
}

/// A running callback listener.
pub struct CallbackServer {
    port: u16,
    cancel: Arc<AtomicBool>,
    /// Taken by the first waiter — the listener is single-use by construction.
    rx: Option<Receiver<CallbackOutcome>>,
}

impl CallbackServer {
    /// The loopback port the listener actually bound.
    pub fn port(&self) -> u16 {
        self.port
    }

    /// Tell the listener to stop and release the port.
    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }
}

impl Drop for CallbackServer {
    fn drop(&mut self) {
        // Dropping the handle must not leave a thread holding the port.
        self.cancel();
    }
}

/// Bind the first available candidate port on the **loopback interface**.
///
/// `127.0.0.1` and nothing else. Binding `0.0.0.0` here would publish the
/// callback to the whole local network, letting anyone on the same Wi-Fi POST a
/// forged sign-in at the port — the single most damaging mistake this file could
/// make, so it is asserted in the tests.
///
/// `0` is accepted as a candidate for tests, where an OS-assigned port avoids
/// collisions with a developer's real running app.
pub fn bind_loopback(ports: &[u16]) -> AdgitterResult<TcpListener> {
    let mut last_err = None;
    for &port in ports {
        let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
        match TcpListener::bind(addr) {
            Ok(listener) => return Ok(listener),
            Err(e) => last_err = Some(e),
        }
    }
    let tried = ports
        .iter()
        .map(u16::to_string)
        .collect::<Vec<_>>()
        .join(", ");
    Err(AdgitterError::Internal(format!(
        "sign-in needs a free local port but every candidate ({tried}) is in use \
         by another application{detail}. Close whatever is using them and try again.",
        detail = last_err.map(|e| format!(" ({e})")).unwrap_or_default()
    )))
}

/// Start the callback listener on `listener`, expecting `nonce`.
///
/// Runs on a plain OS thread (not the async runtime): the accept loop is
/// blocking-with-polling and would otherwise occupy a runtime worker for
/// minutes. The thread ends — releasing the port — on the first request that
/// *delivers* a session token (or the portal's error), on cancellation, or at
/// `timeout`, whichever comes first. Serving the bridge page does **not** end
/// it: the token `POST` is still to come.
pub fn serve(
    listener: TcpListener,
    nonce: String,
    bridge: BridgeConfig,
    timeout: Duration,
) -> CallbackServer {
    let port = listener.local_addr().map(|a| a.port()).unwrap_or_default();
    let cancel = Arc::new(AtomicBool::new(false));
    let (tx, rx): (SyncSender<CallbackOutcome>, Receiver<CallbackOutcome>) = sync_channel(1);
    let thread_cancel = Arc::clone(&cancel);

    // If the thread cannot be spawned the closure — and with it `tx` — is
    // dropped, so the waiter sees a disconnected channel and reports
    // `Cancelled` rather than hanging. Nothing here may panic the app.
    let _ = std::thread::Builder::new()
        .name("adgitter-loopback-auth".into())
        .spawn(move || {
            let outcome = accept_loop(&listener, &nonce, &bridge, port, timeout, &thread_cancel);
            // Dropping `listener` here frees the port before the waiter is told
            // anything, so a retry can immediately rebind it.
            drop(listener);
            let _ = tx.send(outcome);
        });

    CallbackServer {
        port,
        cancel,
        rx: Some(rx),
    }
}

fn accept_loop(
    listener: &TcpListener,
    nonce: &str,
    bridge: &BridgeConfig,
    port: u16,
    timeout: Duration,
    cancel: &AtomicBool,
) -> CallbackOutcome {
    if listener.set_nonblocking(true).is_err() {
        return CallbackOutcome::TimedOut;
    }
    let deadline = Instant::now() + timeout;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return CallbackOutcome::Cancelled;
        }
        if Instant::now() >= deadline {
            tracing::info!("loopback auth: no callback within the timeout; port released");
            return CallbackOutcome::TimedOut;
        }
        match listener.accept() {
            Ok((mut stream, peer)) => {
                // Belt and braces: we only ever bind 127.0.0.1, so a non-loopback
                // peer should be impossible. If it ever happens, it is an attack
                // or a misconfiguration — refuse without reading the request.
                if !peer.ip().is_loopback() {
                    tracing::warn!("loopback auth: dropped a non-loopback connection");
                    continue;
                }
                let _ = stream.set_nonblocking(false);
                if let Disposition::Accepted(params) =
                    handle_connection(&mut stream, nonce, bridge, port)
                {
                    return CallbackOutcome::Received(params);
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(ACCEPT_POLL);
            }
            Err(_) => std::thread::sleep(ACCEPT_POLL),
        }
    }
}

// ── Tauri surface ────────────────────────────────────────────────────────────

/// The app-wide slot holding at most one in-flight sign-in listener.
#[derive(Default)]
pub struct LoopbackAuthState(Mutex<Option<CallbackServer>>);

/// What the frontend needs to build the Clerk URL.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopbackAuthStart {
    /// `http://127.0.0.1:<port>/bridge?state=<nonce>` — pass this verbatim as
    /// Clerk's `redirect_url`.
    pub redirect_url: String,
    /// The nonce, echoed so the frontend can log/diagnose a mismatch. The
    /// *authoritative* check happens in Rust; this is not a second gate.
    pub state: String,
    pub port: u16,
}

/// The settled result of one sign-in wait.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopbackAuthResult {
    /// The delivered parameters, minus `state` — `token` on success, `error`
    /// otherwise. Empty unless the wait ended in a real delivery. **Carries the
    /// session token — the frontend hands it straight to `issue_license` and
    /// never logs it.**
    pub params: HashMap<String, String>,
    pub timed_out: bool,
    pub cancelled: bool,
}

/// Parameter names a delivered Clerk session JWT can arrive under. Mirrors
/// `JWT_PARAMS` in `auth.svelte.ts`: this decides whether the round-trip
/// *succeeded*, and the two ends must agree on what success looks like.
const TOKEN_PARAMS: [&str; 3] = ["token", "session", "__clerk_db_jwt"];

/// Whether an outcome is a **successfully delivered token** — the one condition
/// under which the app pulls itself to the front.
///
/// An `adgitter://` deep link makes macOS raise the app for free; a loopback
/// redirect does not, so nothing tells the user the browser is done and they
/// have to alt-tab back by hand. Focusing fixes that, but only here: stealing
/// focus on a timeout, a cancellation, or a *rejected* callback would yank the
/// user out of whatever they moved on to in order to show them a failure they
/// did not ask about.
///
/// Pure, and separate from the focus call itself, so the "only on success" rule
/// is unit-testable without a running window.
pub fn delivered_token(result: &LoopbackAuthResult) -> bool {
    if result.timed_out || result.cancelled {
        return false;
    }
    // The portal (or the bridge page) reporting a failure is not an acceptance,
    // even if some token-shaped parameter rode along with it.
    if result.params.contains_key("error") {
        return false;
    }
    TOKEN_PARAMS
        .iter()
        .any(|k| result.params.get(*k).is_some_and(|v| !v.is_empty()))
}

/// Bring the app forward after a sign-in lands (see [`delivered_token`]).
///
/// Best-effort and never fails a sign-in: a window that has gone away, or a
/// platform that refuses the activation, must not turn a completed login into
/// an error.
///
/// Order matters. On macOS an app hidden with ⌘H stays hidden no matter what
/// its windows are told, so the *application* is un-hidden first; `AppHandle::
/// show` deliberately does not focus, which is what `set_focus` is for (it
/// activates the app on macOS). A minimized window has to be un-minimized
/// before `show`/`set_focus` can put it in front of the user.
fn focus_main_window(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.show();
    // `main` owns the sign-in, but a build where it was closed should still
    // surface *something* rather than silently leave the user in the browser.
    let Some(window) = app
        .get_webview_window("main")
        .or_else(|| app.webview_windows().values().next().cloned())
    else {
        return;
    };
    if let Ok(true) = window.is_minimized() {
        let _ = window.unminimize();
    }
    let _ = window.show();
    let _ = window.set_focus();
}

/// Begin a loopback sign-in: bind a port, mint a `state`, start listening.
///
/// `publishable_key` is Clerk's **publishable** key — public by design, and
/// already shipped inside the WebView bundle. It comes from the frontend rather
/// than a second env-reading path in Rust, and is validated here (strict
/// charset, decodable Frontend API host) before it is ever interpolated into
/// the bridge page or its CSP.
///
/// Returns the redirect URL to hand Clerk. Starting a new sign-in cancels any
/// listener still running from a previous attempt, so the port is never leaked.
#[tauri::command]
pub fn start_loopback_auth(
    state: State<'_, LoopbackAuthState>,
    publishable_key: String,
) -> AdgitterResult<LoopbackAuthStart> {
    // Validate before binding anything: a bad key means no bridge, and there is
    // no point holding a port for a sign-in that cannot complete.
    let bridge = BridgeConfig::from_publishable_key(&publishable_key)?;
    let mut slot = state
        .0
        .lock()
        .map_err(|_| AdgitterError::Internal("sign-in state poisoned".into()))?;
    // Drop (and therefore cancel) any previous attempt first, so its port is
    // available to this one.
    if let Some(previous) = slot.take() {
        previous.cancel();
    }
    let nonce = new_nonce();
    let listener = bind_loopback(&CANDIDATE_PORTS)?;
    let server = serve(listener, nonce.clone(), bridge, CALLBACK_TIMEOUT);
    let port = server.port();
    tracing::info!(port, "loopback auth: listening for the sign-in callback");
    *slot = Some(server);
    Ok(LoopbackAuthStart {
        redirect_url: format!("http://127.0.0.1:{port}{BRIDGE_PATH}?state={nonce}"),
        state: nonce,
        port,
    })
}

/// Wait for the in-flight sign-in to settle.
///
/// Resolves with the delivered parameters, or with `timedOut` / `cancelled`.
/// Errors only when there is no sign-in to wait for (or one is already being
/// waited on) — a state bug, not a user-visible outcome.
#[tauri::command]
pub async fn await_loopback_auth(
    app: AppHandle,
    state: State<'_, LoopbackAuthState>,
) -> AdgitterResult<LoopbackAuthResult> {
    // Take the receiver out under the lock and release it before blocking: the
    // wait lasts minutes, and `cancel_loopback_auth` must stay callable.
    let rx = {
        let mut slot = state
            .0
            .lock()
            .map_err(|_| AdgitterError::Internal("sign-in state poisoned".into()))?;
        let server = slot
            .as_mut()
            .ok_or_else(|| AdgitterError::Internal("no sign-in is in progress".into()))?;
        server.rx.take().ok_or_else(|| {
            AdgitterError::Internal("this sign-in is already being awaited".into())
        })?
    };

    // `recv` blocks for as long as the browser round-trip takes; the accept loop
    // owns the real deadline, so the extra grace here only covers thread wake-up.
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(CALLBACK_TIMEOUT + Duration::from_secs(30))
    })
    .await
    .map_err(|e| AdgitterError::Internal(format!("sign-in wait failed: {e}")))?;

    // Whatever happened, this listener is spent.
    if let Ok(mut slot) = state.0.lock() {
        if let Some(server) = slot.take() {
            server.cancel();
        }
    }

    let result = match outcome {
        Ok(CallbackOutcome::Received(params)) => LoopbackAuthResult {
            params,
            timed_out: false,
            cancelled: false,
        },
        Ok(CallbackOutcome::TimedOut) | Err(RecvTimeoutError::Timeout) => LoopbackAuthResult {
            params: HashMap::new(),
            timed_out: true,
            cancelled: false,
        },
        Ok(CallbackOutcome::Cancelled) | Err(RecvTimeoutError::Disconnected) => {
            LoopbackAuthResult {
                params: HashMap::new(),
                timed_out: false,
                cancelled: true,
            }
        }
    };

    // The browser is done with the user; bring the app back to them. Only on a
    // real token — see `delivered_token`. We are on an async-runtime worker
    // here (never the main thread), so the main-thread dispatch inside
    // `set_focus` has somewhere to return to and cannot self-deadlock.
    if delivered_token(&result) {
        tracing::info!("loopback auth: sign-in delivered; bringing the app forward");
        focus_main_window(&app);
    }

    Ok(result)
}

/// Abandon the in-flight sign-in and release the port. Idempotent.
#[tauri::command]
pub fn cancel_loopback_auth(state: State<'_, LoopbackAuthState>) {
    if let Ok(mut slot) = state.0.lock() {
        if let Some(server) = slot.take() {
            server.cancel();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A real-shaped dev key whose base64 decodes to
    /// `discrete-ibex-7.clerk.accounts.dev` — the same fixture the frontend
    /// tests use, so the two `clerkFrontendApi` implementations are pinned to
    /// one another.
    const DEV_KEY: &str = "pk_test_ZGlzY3JldGUtaWJleC03LmNsZXJrLmFjY291bnRzLmRldiQ";
    const FAPI: &str = "discrete-ibex-7.clerk.accounts.dev";

    fn bridge() -> BridgeConfig {
        BridgeConfig::from_publishable_key(DEV_KEY).expect("dev key")
    }

    /// Bind an OS-assigned loopback port and start a listener on it.
    fn start(nonce: &str, timeout: Duration) -> (CallbackServer, u16) {
        let listener = bind_loopback(&[0]).expect("ephemeral loopback port");
        let port = listener.local_addr().unwrap().port();
        (serve(listener, nonce.to_string(), bridge(), timeout), port)
    }

    /// Issue one raw GET against the callback port and return the response text.
    fn get(port: u16, target: &str) -> std::io::Result<String> {
        request(
            port,
            &format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"),
        )
    }

    /// Issue a form-encoded POST, optionally with an `Origin` header, the way
    /// the bridge page's `fetch` does.
    fn post(port: u16, target: &str, body: &str, origin: Option<&str>) -> std::io::Result<String> {
        let origin_header = origin
            .map(|o| format!("Origin: {o}\r\n"))
            .unwrap_or_default();
        request(
            port,
            &format!(
                "POST {target} HTTP/1.1\r\n\
                 Host: 127.0.0.1\r\n\
                 {origin_header}\
                 Content-Type: application/x-www-form-urlencoded\r\n\
                 Content-Length: {len}\r\n\
                 \r\n\
                 {body}",
                len = body.len()
            ),
        )
    }

    fn request(port: u16, raw: &str) -> std::io::Result<String> {
        let mut stream = TcpStream::connect(("127.0.0.1", port))?;
        stream.set_read_timeout(Some(Duration::from_secs(5)))?;
        stream.write_all(raw.as_bytes())?;
        stream.flush()?;
        let mut response = String::new();
        stream.read_to_string(&mut response)?;
        Ok(response)
    }

    /// Wait until `port` stops accepting connections (the thread closes the
    /// listener asynchronously after it decides to stop).
    fn wait_for_close(port: u16) -> bool {
        for _ in 0..200 {
            if TcpStream::connect(("127.0.0.1", port)).is_err() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        false
    }

    fn recv(server: &mut CallbackServer) -> CallbackOutcome {
        server
            .rx
            .take()
            .expect("receiver")
            .recv_timeout(Duration::from_secs(10))
            .expect("outcome")
    }

    // ── The security boundary: `state` ───────────────────────────────────────

    /// The reason this whole mechanism is safe on a port any local process can
    /// reach. Revert the `constant_time_eq` guard in `handle_callback_get` and
    /// this must go red.
    #[test]
    fn rejects_a_callback_whose_state_does_not_match_and_keeps_waiting() {
        let nonce = new_nonce();
        let (mut server, port) = start(&nonce, Duration::from_secs(20));

        let refused = get(port, "/callback?state=not-the-nonce&token=attacker").unwrap();
        assert!(
            refused.starts_with("HTTP/1.1 403"),
            "a mismatched state must be refused, got: {refused}"
        );
        // …and the impostor must not have consumed the sign-in: the real
        // callback still works.
        let ok = get(port, &format!("/callback?state={nonce}&token=real-jwt")).unwrap();
        assert!(ok.starts_with("HTTP/1.1 200"), "got: {ok}");

        match recv(&mut server) {
            CallbackOutcome::Received(params) => {
                assert_eq!(params.get("token").map(String::as_str), Some("real-jwt"));
                assert!(!params.contains_key("state"), "state is stripped");
            }
            other => panic!("expected the real callback, got {other:?}"),
        }
    }

    #[test]
    fn rejects_a_callback_with_no_state_at_all() {
        let nonce = new_nonce();
        let (_server, port) = start(&nonce, Duration::from_secs(20));
        let refused = get(port, "/callback?token=attacker").unwrap();
        assert!(refused.starts_with("HTTP/1.1 403"), "got: {refused}");
    }

    /// A hostile page cannot append a second `state=` to override the first.
    #[test]
    fn a_duplicated_parameter_keeps_the_first_value() {
        let params = parse_query("state=real&state=forged&token=a&token=b");
        assert_eq!(params["state"], "real");
        assert_eq!(params["token"], "a");
    }

    #[test]
    fn constant_time_eq_matches_only_identical_bytes() {
        assert!(constant_time_eq(b"abcdef", b"abcdef"));
        assert!(!constant_time_eq(b"abcdef", b"abcdeg"));
        assert!(!constant_time_eq(b"abcdef", b"abcde"));
        assert!(!constant_time_eq(b"", b"a"));
        assert!(constant_time_eq(b"", b""));
    }

    #[test]
    fn nonces_are_long_hex_and_never_repeat() {
        let a = new_nonce();
        let b = new_nonce();
        assert_ne!(a, b);
        assert_eq!(a.len(), 64, "two v4 uuids' worth of hex");
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    // ── The bridge: `state` guards every endpoint ────────────────────────────

    /// The bridge page is the thing that will be *given* the session; handing
    /// it to a caller that does not know the nonce would let any local page
    /// drive a Clerk handshake against this port. Remove the `state_matches`
    /// guard in `handle_bridge_get` and this must go red.
    #[test]
    fn refuses_the_bridge_page_when_the_state_does_not_match() {
        let nonce = new_nonce();
        let (_server, port) = start(&nonce, Duration::from_secs(20));

        for target in [
            "/bridge",
            "/bridge?state=",
            "/bridge?state=not-the-nonce",
            "/bridge?state=not-the-nonce&__clerk_db_jwt=abc",
        ] {
            let refused = get(port, target).unwrap();
            assert!(
                refused.starts_with("HTTP/1.1 403"),
                "{target} must be refused, got: {refused}"
            );
            assert!(
                !refused.contains("clerk.browser.js"),
                "{target} must not receive the bridge page"
            );
        }
    }

    /// The second half of the same boundary. Remove the `state_matches` guard
    /// in `handle_token_post` and this must go red — a local page could then
    /// post its own token and sign the user into an attacker's account.
    #[test]
    fn refuses_a_token_post_whose_state_does_not_match_and_keeps_waiting() {
        let nonce = new_nonce();
        let (mut server, port) = start(&nonce, Duration::from_secs(20));

        for body in [
            "token=attacker-jwt",
            "state=&token=attacker-jwt",
            "state=not-the-nonce&token=attacker-jwt",
        ] {
            let refused = post(port, BRIDGE_TOKEN_PATH, body, None).unwrap();
            assert!(
                refused.starts_with("HTTP/1.1 403"),
                "{body} must be refused, got: {refused}"
            );
        }

        // The impostor did not consume the sign-in: the real page still can.
        post(
            port,
            BRIDGE_TOKEN_PATH,
            &format!("state={nonce}&token=real-jwt"),
            Some(&format!("http://127.0.0.1:{port}")),
        )
        .unwrap();
        match recv(&mut server) {
            CallbackOutcome::Received(params) => {
                assert_eq!(params.get("token").map(String::as_str), Some("real-jwt"));
                assert!(!params.contains_key("state"));
            }
            other => panic!("expected the token post, got {other:?}"),
        }
    }

    /// **The token must never travel on a URL.** Change the method guard in
    /// `handle_connection` so the token endpoint answers a `GET`, and this must
    /// go red: a session JWT in the address bar is a session JWT in browser
    /// history, in `Referer`, and in every access log on the way.
    #[test]
    fn refuses_a_token_offered_on_the_url_even_with_the_right_state() {
        let nonce = new_nonce();
        let (mut server, port) = start(&nonce, Duration::from_secs(20));

        let refused = get(
            port,
            &format!("/bridge/token?state={nonce}&token=jwt-on-the-url"),
        )
        .unwrap();
        assert!(
            refused.starts_with("HTTP/1.1 405"),
            "a GET to the token endpoint must be refused, got: {refused}"
        );
        assert!(!refused.contains("jwt-on-the-url"), "and never echoed");

        // Nothing was delivered: the listener is still waiting for the POST.
        post(
            port,
            BRIDGE_TOKEN_PATH,
            &format!("state={nonce}&token=the-real-one"),
            None,
        )
        .unwrap();
        match recv(&mut server) {
            CallbackOutcome::Received(params) => {
                assert_eq!(
                    params.get("token").map(String::as_str),
                    Some("the-real-one"),
                    "the URL-borne token must never have been accepted"
                );
            }
            other => panic!("expected the POST to settle it, got {other:?}"),
        }
    }

    /// A page on any other origin — a random site the user has open, which can
    /// freely `fetch` `127.0.0.1` — is refused before its body is even weighed.
    #[test]
    fn refuses_a_cross_origin_token_post() {
        let nonce = new_nonce();
        let (mut server, port) = start(&nonce, Duration::from_secs(20));

        let refused = post(
            port,
            BRIDGE_TOKEN_PATH,
            &format!("state={nonce}&token=attacker-jwt"),
            Some("https://evil.example"),
        )
        .unwrap();
        assert!(refused.starts_with("HTTP/1.1 403"), "got: {refused}");

        // Still waiting for the genuine, same-origin post.
        post(
            port,
            BRIDGE_TOKEN_PATH,
            &format!("state={nonce}&token=real-jwt"),
            Some(&format!("http://127.0.0.1:{port}")),
        )
        .unwrap();
        assert!(matches!(recv(&mut server), CallbackOutcome::Received(_)));
    }

    /// Serving the page is the *middle* of the round-trip. Return
    /// `Disposition::Accepted` from `handle_bridge_get` (or stop the loop after
    /// it) and this must go red: the port would close before the page could
    /// hand the token back, and every sign-in would fail.
    #[test]
    fn keeps_listening_after_serving_the_bridge_page() {
        let nonce = new_nonce();
        let (mut server, port) = start(&nonce, Duration::from_secs(20));

        let page = get(port, &format!("/bridge?state={nonce}&__clerk_db_jwt=dbjwt")).unwrap();
        assert!(page.starts_with("HTTP/1.1 200"), "got: {page}");

        // The browser will also ask for a favicon on the same origin; neither
        // that nor the page itself may end the wait.
        assert!(get(port, "/favicon.ico")
            .unwrap()
            .starts_with("HTTP/1.1 404"));

        // The port is still open several requests later — that is the point.
        assert!(
            TcpStream::connect(("127.0.0.1", port)).is_ok(),
            "the listener must survive until the token arrives"
        );

        post(
            port,
            BRIDGE_TOKEN_PATH,
            &format!("state={nonce}&token=session-jwt"),
            Some(&format!("http://127.0.0.1:{port}")),
        )
        .unwrap();
        match recv(&mut server) {
            CallbackOutcome::Received(params) => {
                assert_eq!(params.get("token").map(String::as_str), Some("session-jwt"));
            }
            other => panic!("expected the token, got {other:?}"),
        }
        assert!(
            wait_for_close(port),
            "…and only *then* is the port released"
        );
    }

    /// The portal bounced back with an explicit error (the user declined).
    /// There is no session to adopt, so the wait settles immediately instead of
    /// burning the full timeout.
    #[test]
    fn a_bridge_request_carrying_an_error_settles_the_wait() {
        let nonce = new_nonce();
        let (mut server, port) = start(&nonce, Duration::from_secs(20));
        get(port, &format!("/bridge?state={nonce}&error=access_denied")).unwrap();
        match recv(&mut server) {
            CallbackOutcome::Received(params) => {
                assert_eq!(
                    params.get("error").map(String::as_str),
                    Some("access_denied")
                );
                assert!(!params.contains_key("state"));
            }
            other => panic!("expected the error, got {other:?}"),
        }
    }

    /// A right-nonce post that delivers nothing is not an outcome; the listener
    /// must not settle on an empty result the frontend would read as "no JWT".
    #[test]
    fn an_empty_token_post_does_not_settle_the_wait() {
        let nonce = new_nonce();
        let (mut server, port) = start(&nonce, Duration::from_secs(20));
        let resp = post(port, BRIDGE_TOKEN_PATH, &format!("state={nonce}"), None).unwrap();
        assert!(resp.starts_with("HTTP/1.1 400"), "got: {resp}");
        post(
            port,
            BRIDGE_TOKEN_PATH,
            &format!("state={nonce}&token=jwt"),
            None,
        )
        .unwrap();
        assert!(matches!(recv(&mut server), CallbackOutcome::Received(_)));
    }

    /// The wire contract a parallel frontend agent is coding against: a token
    /// POST may carry `name`/`email`/`avatar`/`username` alongside `state`
    /// and `token`, and `handle_token_post` must hand all of them back
    /// (minus the `state` it always strips).
    #[test]
    fn a_token_post_carries_the_profile_fields_through() {
        let nonce = new_nonce();
        let (mut server, port) = start(&nonce, Duration::from_secs(20));
        let body = format!(
            "state={nonce}&token=session-jwt&name=Ada+Lovelace&email=ada%40example.com\
             &avatar=https%3A%2F%2Fimg.clerk.com%2Fa.png&username=ada"
        );
        let resp = post(
            port,
            BRIDGE_TOKEN_PATH,
            &body,
            Some(&format!("http://127.0.0.1:{port}")),
        )
        .unwrap();
        assert!(resp.starts_with("HTTP/1.1 200"), "got: {resp}");
        match recv(&mut server) {
            CallbackOutcome::Received(params) => {
                assert!(!params.contains_key("state"), "state is stripped");
                assert_eq!(params.get("token").map(String::as_str), Some("session-jwt"));
                assert_eq!(params.get("name").map(String::as_str), Some("Ada Lovelace"));
                assert_eq!(
                    params.get("email").map(String::as_str),
                    Some("ada@example.com")
                );
                assert_eq!(
                    params.get("avatar").map(String::as_str),
                    Some("https://img.clerk.com/a.png")
                );
                assert_eq!(params.get("username").map(String::as_str), Some("ada"));
            }
            other => panic!("expected the token post with profile fields, got {other:?}"),
        }
    }

    /// The bridge page having been served must not extend the deadline: a user
    /// who closes the tab mid-handshake still frees the port.
    #[test]
    fn times_out_when_the_bridge_page_never_posts_a_token() {
        let nonce = new_nonce();
        let (mut server, port) = start(&nonce, Duration::from_millis(400));
        let page = get(port, &format!("/bridge?state={nonce}")).unwrap();
        assert!(page.starts_with("HTTP/1.1 200"));
        assert!(matches!(recv(&mut server), CallbackOutcome::TimedOut));
        assert!(
            wait_for_close(port),
            "a timed-out bridge must free its port"
        );
        assert!(TcpListener::bind(("127.0.0.1", port)).is_ok());
    }

    // ── The bridge page itself ───────────────────────────────────────────────

    /// The CSP is what stops a compromised or hijacked bridge page from
    /// shipping the session token anywhere. Loosen it — add `unsafe-inline`,
    /// `unsafe-eval` or a wildcard — and this must go red.
    #[test]
    fn the_bridge_page_ships_a_strict_csp() {
        let nonce = new_nonce();
        let (_server, port) = start(&nonce, Duration::from_secs(20));
        let resp = get(port, &format!("/bridge?state={nonce}")).unwrap();

        let csp = resp
            .lines()
            .find(|l| {
                l.to_ascii_lowercase()
                    .starts_with("content-security-policy:")
            })
            .expect("the bridge page must carry a CSP");

        assert!(csp.contains("default-src 'none'"));
        assert!(csp.contains("base-uri 'none'"));
        assert!(csp.contains("form-action 'none'"));
        assert!(csp.contains("frame-ancestors 'none'"));
        // Only our nonce'd inline script and Clerk's own Frontend API host.
        assert!(csp.contains("script-src 'nonce-"));
        assert!(csp.contains(&format!("https://{FAPI}")));
        assert!(csp.contains("connect-src 'self' "));
        // Verified in a real browser on 2026-08-15: clerk-js spawns a Web
        // Worker from a `blob:` URL. Without an explicit `worker-src` the
        // browser falls back to `script-src`, which does not allow `blob:`,
        // and Chromium logged "Creating a worker from 'blob:…' violates the
        // following Content Security Policy directive". Only scripts that
        // `script-src` already admits can mint such a blob, so allowing it
        // here does not widen who may execute code.
        assert!(
            csp.contains("worker-src 'self' blob:"),
            "clerk-js needs a blob worker: {csp}"
        );
        // The things that would defeat the point.
        assert!(!csp.contains("unsafe-inline"), "no unsafe-inline: {csp}");
        assert!(!csp.contains("unsafe-eval"), "no unsafe-eval: {csp}");
        assert!(!csp.contains('*'), "no wildcard source: {csp}");
        assert!(
            !csp.contains("http://"),
            "no plaintext script origin: {csp}"
        );
    }

    /// The CSP nonce is per-response and is *not* the `state` nonce: reusing
    /// `state` would publish the anti-forgery secret into the document.
    #[test]
    fn the_csp_nonce_is_fresh_per_response_and_is_not_the_state() {
        let nonce = new_nonce();
        let (_server, port) = start(&nonce, Duration::from_secs(20));
        let csp_of = |resp: &str| {
            resp.lines()
                .find(|l| {
                    l.to_ascii_lowercase()
                        .starts_with("content-security-policy:")
                })
                .unwrap()
                .to_string()
        };
        let a = csp_of(&get(port, &format!("/bridge?state={nonce}")).unwrap());
        let b = csp_of(&get(port, &format!("/bridge?state={nonce}")).unwrap());
        assert_ne!(a, b, "the CSP nonce must not be reused across responses");
        assert!(
            !a.contains(&nonce),
            "the state nonce must not become the CSP nonce"
        );
    }

    /// Whatever Clerk put on the redirect stays out of the document: the page
    /// reads `state` from `location.search` at runtime, so nothing
    /// request-derived is ever interpolated into HTML.
    #[test]
    fn the_bridge_page_reflects_nothing_from_the_request() {
        let nonce = new_nonce();
        let (_server, port) = start(&nonce, Duration::from_secs(20));
        let resp = get(
            port,
            &format!("/bridge?state={nonce}&__clerk_db_jwt=handshake-secret&token=super-secret"),
        )
        .unwrap();

        assert!(resp.starts_with("HTTP/1.1 200"), "got: {resp}");
        assert!(!resp.contains(&nonce), "the state must not be reflected");
        assert!(!resp.contains("handshake-secret"));
        assert!(!resp.contains("super-secret"));
        assert!(resp.contains("Cache-Control: no-store"));
        assert!(resp.contains("Referrer-Policy: no-referrer"));
        // No CORS header ⇒ a cross-origin page cannot read the body.
        assert!(!resp
            .to_ascii_lowercase()
            .contains("access-control-allow-origin"));
        // No redirect, ever: an open redirect here would be a token exfiltration
        // primitive.
        assert!(!resp.to_ascii_lowercase().contains("\nlocation:"));
    }

    /// The page must load Clerk JS from the instance's own Frontend API host
    /// (the only origin its CSP allows) and hand it the publishable key.
    #[test]
    fn the_bridge_page_loads_clerk_js_from_the_instance_frontend_api() {
        let nonce = new_nonce();
        let (_server, port) = start(&nonce, Duration::from_secs(20));
        let resp = get(port, &format!("/bridge?state={nonce}")).unwrap();
        assert!(resp.contains(&format!("https://{FAPI}/npm/@clerk/clerk-js")));
        assert!(resp.contains(&format!("data-clerk-publishable-key=\"{DEV_KEY}\"")));
        // It posts the token back rather than putting it on a URL.
        assert!(resp.contains("\"/bridge/token\""));
        assert!(resp.contains("method: \"POST\""));
        assert!(resp.contains("fields.set(\"state\", state)"));
    }

    /// The wire contract a parallel frontend agent is coding against: the
    /// bridge page must read `Clerk.user` and reference all four profile
    /// field names it may send alongside the token.
    #[test]
    fn the_bridge_page_harvests_the_clerk_profile() {
        let cfg = bridge();
        let page = cfg.page(&new_csp_nonce());
        assert!(page.contains("Clerk.user"), "must read Clerk.user");
        for field in ["name", "email", "avatar", "username"] {
            assert!(
                page.contains(&format!("\"{field}\"")),
                "the page script must reference the {field} field"
            );
        }
    }

    /// The response to the token post is a fixed word — never an echo, never a
    /// reason a prober could learn from.
    #[test]
    fn the_token_post_response_echoes_nothing() {
        let nonce = new_nonce();
        let (mut server, port) = start(&nonce, Duration::from_secs(20));
        let resp = post(
            port,
            BRIDGE_TOKEN_PATH,
            &format!("state={nonce}&token=super-secret-jwt"),
            Some(&format!("http://127.0.0.1:{port}")),
        )
        .unwrap();
        assert!(resp.starts_with("HTTP/1.1 200"), "got: {resp}");
        assert!(
            !resp.contains("super-secret-jwt"),
            "the token is not echoed"
        );
        assert!(!resp.contains(&nonce), "the nonce is not echoed");
        assert!(matches!(recv(&mut server), CallbackOutcome::Received(_)));
    }

    /// Nothing in this module may write a token, a nonce or a query string to
    /// the log. Add a `tracing::…(?params)` anywhere on these paths and this
    /// must go red.
    #[test]
    fn never_logs_the_session_token() {
        use std::io::Write as _;

        #[derive(Clone)]
        struct Sink(Arc<Mutex<Vec<u8>>>);
        impl std::io::Write for Sink {
            fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
                self.0.lock().unwrap().extend_from_slice(buf);
                Ok(buf.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for Sink {
            type Writer = Sink;
            fn make_writer(&'a self) -> Sink {
                self.clone()
            }
        }

        let captured = Arc::new(Mutex::new(Vec::new()));
        // The listener runs on its own thread, so only a *global* subscriber
        // sees its events. This is the only test that installs one; if another
        // already did, the assertions below still hold for whatever is captured.
        let _ = tracing::subscriber::set_global_default(
            tracing_subscriber::fmt()
                .with_writer(Sink(Arc::clone(&captured)))
                .with_max_level(tracing::Level::TRACE)
                .with_ansi(false)
                .finish(),
        );

        let nonce = new_nonce();
        let (mut server, port) = start(&nonce, Duration::from_secs(20));

        // Drive every path that touches a secret: a refused bridge GET, a
        // refused token GET, a cross-origin post, a bad-state post, the real
        // page, and the real token post.
        let _ = get(port, "/bridge?state=wrong&__clerk_db_jwt=handshake-canary");
        let _ = get(port, "/bridge/token?state=wrong&token=url-canary");
        let _ = post(
            port,
            BRIDGE_TOKEN_PATH,
            "state=wrong&token=forged-canary",
            Some("https://evil.example"),
        );
        let _ = get(
            port,
            &format!("/bridge?state={nonce}&__clerk_db_jwt=db-canary"),
        );
        let _ = post(
            port,
            BRIDGE_TOKEN_PATH,
            &format!("state={nonce}&token=session-canary"),
            Some(&format!("http://127.0.0.1:{port}")),
        );
        assert!(matches!(recv(&mut server), CallbackOutcome::Received(_)));

        let mut buf = captured.lock().unwrap();
        let _ = buf.flush();
        let log = String::from_utf8_lossy(&buf).into_owned();
        for secret in [
            "session-canary",
            "forged-canary",
            "url-canary",
            "db-canary",
            "handshake-canary",
            nonce.as_str(),
        ] {
            assert!(!log.contains(secret), "the log leaked {secret:?}:\n{log}");
        }
    }

    // ── Publishable key → Frontend API host ──────────────────────────────────

    #[test]
    fn derives_the_frontend_api_host_from_the_publishable_key() {
        assert_eq!(clerk_frontend_api(DEV_KEY).as_deref(), Some(FAPI));
        let cfg = bridge();
        assert_eq!(cfg.frontend_api, FAPI);
        assert_eq!(cfg.publishable_key, DEV_KEY);
    }

    /// The key crosses an IPC boundary and its decoded host is interpolated
    /// into a CSP header and a `src=` URL. Anything that is not a plain
    /// hostname — or a key that is not a key — is refused rather than escaped.
    #[test]
    fn refuses_a_publishable_key_that_could_poison_the_page_or_the_csp() {
        use base64::engine::general_purpose::STANDARD_NO_PAD as B64;

        // Not a Clerk key at all.
        for bad in [
            "",
            "not-a-key",
            "pk_dev_abc",
            "sk_test_ZGlzY3JldGUtaWJleC03LmNsZXJrLmFjY291bnRzLmRldiQ",
            "pk_test_",
        ] {
            assert!(clerk_frontend_api(bad).is_none(), "{bad:?} must be refused");
            assert!(BridgeConfig::from_publishable_key(bad).is_err());
        }

        // Well-formed base64 that decodes to something that is not a hostname:
        // a CSP wildcard, an extra source, a quote-break out of the attribute,
        // an angle bracket, a scheme, a path.
        for payload in [
            "*$",
            "evil.example https://attacker.test$",
            "x.clerk.dev\" onload=\"alert(1)$",
            "x.clerk.dev<script>$",
            "https://x.clerk.dev$",
            "x.clerk.dev/a$",
            "localhost$",
            "x.clerk.dev;script-src *$",
        ] {
            let key = format!("pk_test_{}", B64.encode(payload));
            assert!(
                clerk_frontend_api(&key).is_none(),
                "a key decoding to {payload:?} must be refused"
            );
        }

        // Non-base64 characters in the key body never reach the decoder.
        assert!(!valid_publishable_key("pk_test_abc\"><script>"));
        assert!(!valid_publishable_key("pk_test_abc def"));
    }

    #[test]
    fn accepts_a_live_key_too() {
        use base64::engine::general_purpose::STANDARD_NO_PAD as B64;
        let key = format!("pk_live_{}", B64.encode("clerk.adgitter.dev$"));
        assert_eq!(
            clerk_frontend_api(&key).as_deref(),
            Some("clerk.adgitter.dev")
        );
    }

    // ── The other security boundary: loopback only ───────────────────────────

    /// Binding the wildcard address would expose the sign-in callback to every
    /// machine on the same network. Change `Ipv4Addr::LOCALHOST` to
    /// `Ipv4Addr::UNSPECIFIED` in `bind_loopback` and this must go red.
    #[test]
    fn binds_the_loopback_interface_and_not_the_wildcard() {
        let listener = bind_loopback(&[0]).unwrap();
        let addr = listener.local_addr().unwrap();
        assert_eq!(
            addr.ip(),
            IpAddr::V4(Ipv4Addr::LOCALHOST),
            "the callback port must be reachable only from this machine"
        );
        assert!(addr.ip().is_loopback());
        assert!(
            !addr.ip().is_unspecified(),
            "0.0.0.0 would expose the port to the LAN"
        );
    }

    /// The same property observed from outside: the port must not answer on any
    /// non-loopback address this machine owns. Skipped when the host has no
    /// routable IPv4 (offline CI container).
    #[test]
    fn does_not_answer_on_a_routable_local_address() {
        let Some(routable) = routable_ipv4() else {
            return; // no non-loopback interface here; the bind assertion covers it
        };
        let nonce = new_nonce();
        let (_server, port) = start(&nonce, Duration::from_secs(5));
        let reached = TcpStream::connect_timeout(
            &SocketAddr::new(IpAddr::V4(routable), port),
            Duration::from_millis(500),
        );
        assert!(
            reached.is_err(),
            "the callback port answered on {routable} — it must be loopback-only"
        );
    }

    /// This machine's first non-loopback IPv4, discovered without a DNS lookup or
    /// any packet leaving the host (a `connect` on UDP only sets the route).
    fn routable_ipv4() -> Option<Ipv4Addr> {
        let sock = std::net::UdpSocket::bind(("0.0.0.0", 0)).ok()?;
        sock.connect(("192.0.2.1", 9)).ok()?; // TEST-NET-1, never routed
        match sock.local_addr().ok()?.ip() {
            IpAddr::V4(ip) if !ip.is_loopback() && !ip.is_unspecified() => Some(ip),
            _ => None,
        }
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    /// One delivery, then the door closes: a replay of the same URL must find
    /// nothing listening.
    #[test]
    fn stops_listening_after_the_first_accepted_callback() {
        let nonce = new_nonce();
        let (mut server, port) = start(&nonce, Duration::from_secs(20));
        get(port, &format!("/callback?state={nonce}&token=jwt")).unwrap();
        assert!(matches!(recv(&mut server), CallbackOutcome::Received(_)));
        assert!(
            wait_for_close(port),
            "the port must be released after a single use"
        );
    }

    #[test]
    fn times_out_and_releases_the_port() {
        let nonce = new_nonce();
        let (mut server, port) = start(&nonce, Duration::from_millis(150));
        assert!(matches!(recv(&mut server), CallbackOutcome::TimedOut));
        assert!(
            wait_for_close(port),
            "a timed-out listener must free its port"
        );
        // And the freed port can be rebound immediately.
        assert!(TcpListener::bind(("127.0.0.1", port)).is_ok());
    }

    #[test]
    fn cancelling_stops_the_listener() {
        let nonce = new_nonce();
        let (mut server, port) = start(&nonce, Duration::from_secs(30));
        server.cancel();
        assert!(matches!(recv(&mut server), CallbackOutcome::Cancelled));
        assert!(wait_for_close(port));
    }

    #[test]
    fn every_candidate_port_in_use_is_a_clear_error() {
        // Hold two ephemeral ports, then ask for exactly those.
        let a = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let b = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let ports = [
            a.local_addr().unwrap().port(),
            b.local_addr().unwrap().port(),
        ];
        let err = bind_loopback(&ports).unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains(&ports[0].to_string()),
            "names the ports tried: {msg}"
        );
        assert!(
            msg.contains(&ports[1].to_string()),
            "names the ports tried: {msg}"
        );
        assert!(msg.contains("in use"), "explains why: {msg}");
    }

    /// A busy first candidate must not fail the sign-in — that is the point of
    /// having a list.
    #[test]
    fn falls_through_to_the_next_free_candidate() {
        let taken = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let busy = taken.local_addr().unwrap().port();
        let listener = bind_loopback(&[busy, 0]).unwrap();
        assert_ne!(listener.local_addr().unwrap().port(), busy);
    }

    /// The candidate list is what the user must paste into Clerk's allowlist, so
    /// it is pinned here: changing it silently would break every existing setup.
    #[test]
    fn candidate_ports_are_fixed_and_documented() {
        assert_eq!(CANDIDATE_PORTS, [47821, 47822, 47823]);
    }

    /// Clerk is now sent to the bridge, not the bare callback — and the paths
    /// are what the Clerk instance has to allowlist.
    #[test]
    fn the_redirect_paths_are_fixed_and_documented() {
        assert_eq!(BRIDGE_PATH, "/bridge");
        assert_eq!(BRIDGE_TOKEN_PATH, "/bridge/token");
        assert_eq!(CALLBACK_PATH, "/callback");
    }

    // ── HTTP hygiene ─────────────────────────────────────────────────────────

    /// The browser asks for `/favicon.ico` on the callback origin; that must not
    /// be mistaken for the callback, nor end the wait.
    #[test]
    fn an_unrelated_path_404s_and_the_wait_continues() {
        let nonce = new_nonce();
        let (mut server, port) = start(&nonce, Duration::from_secs(20));
        let resp = get(port, "/favicon.ico").unwrap();
        assert!(resp.starts_with("HTTP/1.1 404"), "got: {resp}");
        get(port, &format!("/callback?state={nonce}&token=jwt")).unwrap();
        assert!(matches!(recv(&mut server), CallbackOutcome::Received(_)));
    }

    /// The success page is a static document: it must not echo the token back
    /// into HTML the browser (or an extension) can scrape.
    #[test]
    fn the_success_page_never_echoes_the_callback_parameters() {
        let nonce = new_nonce();
        let (_server, port) = start(&nonce, Duration::from_secs(20));
        let resp = get(
            port,
            &format!("/callback?state={nonce}&token=super-secret-jwt"),
        )
        .unwrap();
        assert!(
            !resp.contains("super-secret-jwt"),
            "the token must not be reflected"
        );
        assert!(!resp.contains(&nonce), "the nonce must not be reflected");
        assert!(resp.contains("Cache-Control: no-store"));
        assert!(resp.contains("Referrer-Policy: no-referrer"));
        // No CORS header ⇒ a cross-origin page cannot read the response.
        assert!(!resp
            .to_ascii_lowercase()
            .contains("access-control-allow-origin"));
    }

    /// A real browser sends a dozen headers and expects the whole page back. If
    /// the server answered without draining them, the close would land as an RST
    /// and the user would see the browser's error page after a *successful*
    /// sign-in.
    #[test]
    fn answers_a_full_browser_style_request_in_one_piece() {
        let nonce = new_nonce();
        let (mut server, port) = start(&nonce, Duration::from_secs(20));

        let mut raw =
            format!("GET /callback?state={nonce}&token=jwt HTTP/1.1\r\nHost: 127.0.0.1\r\n");
        for i in 0..20 {
            raw.push_str(&format!("X-Filler-{i}: {}\r\n", "v".repeat(200)));
        }
        raw.push_str("Connection: keep-alive\r\n\r\n");

        let resp = request(port, &raw).unwrap();
        assert!(resp.starts_with("HTTP/1.1 200"), "got: {resp}");
        // The whole declared body arrived, not a truncated prefix.
        assert!(resp.contains("You&#39;re signed in") || resp.contains("You're signed in"));
        assert!(resp.trim_end().ends_with("</script>"), "body was truncated");
        assert!(matches!(recv(&mut server), CallbackOutcome::Received(_)));
    }

    /// A body larger than the cap is never buffered — and, just as importantly,
    /// never *half* buffered: a truncated body whose leading `state=` still
    /// matched would otherwise deliver a mangled token as if it were real. The
    /// oversized post is dropped and the listener keeps waiting for the real
    /// one. (The client sees a reset, because refusing to drain is the whole
    /// point of the cap.)
    #[test]
    fn an_oversized_token_post_never_delivers_a_truncated_token() {
        let nonce = new_nonce();
        let (mut server, port) = start(&nonce, Duration::from_secs(20));
        let huge = format!("state={nonce}&token={}", "A".repeat(MAX_REQUEST_BODY * 2));
        // Answered or reset — either is fine; hanging or accepting is not.
        let _ = post(port, BRIDGE_TOKEN_PATH, &huge, None);

        post(
            port,
            BRIDGE_TOKEN_PATH,
            &format!("state={nonce}&token=the-real-one"),
            None,
        )
        .unwrap();
        match recv(&mut server) {
            CallbackOutcome::Received(params) => assert_eq!(
                params.get("token").map(String::as_str),
                Some("the-real-one"),
                "the oversized post must not have been delivered"
            ),
            other => panic!("expected the real token, got {other:?}"),
        }
    }

    #[test]
    fn parses_request_lines_and_rejects_junk() {
        assert_eq!(
            parse_request_line("GET /callback?state=a HTTP/1.1\r\n"),
            Some(RequestLine {
                method: "GET".into(),
                path: "/callback".into(),
                query: "state=a".into()
            })
        );
        assert_eq!(
            parse_request_line("GET /callback HTTP/1.0\r\n"),
            Some(RequestLine {
                method: "GET".into(),
                path: "/callback".into(),
                query: String::new()
            })
        );
        // Absolute-form target (proxy style).
        assert_eq!(
            parse_request_line("GET http://127.0.0.1:47821/callback?x=1 HTTP/1.1"),
            Some(RequestLine {
                method: "GET".into(),
                path: "/callback".into(),
                query: "x=1".into()
            })
        );
        // The method is carried through — the token endpoint's whole defence.
        assert_eq!(
            parse_request_line("POST /bridge/token HTTP/1.1"),
            Some(RequestLine {
                method: "POST".into(),
                path: "/bridge/token".into(),
                query: String::new()
            })
        );
        assert_eq!(parse_request_line("garbage"), None);
        assert_eq!(parse_request_line(""), None);
        assert_eq!(parse_request_line("get /x HTTP/1.1"), None);
        assert_eq!(parse_request_line("GET /x SPDY/1"), None);
    }

    #[test]
    fn decodes_percent_escapes_and_plus() {
        let params = parse_query("a=hello+world&b=%2Ffoo%3D&c&=ignored&d=");
        assert_eq!(params["a"], "hello world");
        assert_eq!(params["b"], "/foo=");
        assert_eq!(params["c"], "");
        assert_eq!(params["d"], "");
        assert!(!params.contains_key(""));
    }

    /// A malformed first line must be answered and ignored, not crash the loop
    /// or be mistaken for a callback.
    #[test]
    fn a_malformed_request_does_not_end_the_wait() {
        let nonce = new_nonce();
        let (mut server, port) = start(&nonce, Duration::from_secs(20));
        {
            let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
            let _ = s.write_all(b"nonsense\r\n\r\n");
            let _ = s.flush();
        }
        // …and neither does a POST to a GET-only path.
        let resp = post(port, CALLBACK_PATH, &format!("state={nonce}&token=x"), None).unwrap();
        assert!(resp.starts_with("HTTP/1.1 405"), "got: {resp}");

        get(port, &format!("/callback?state={nonce}&token=jwt")).unwrap();
        assert!(matches!(recv(&mut server), CallbackOutcome::Received(_)));
    }

    // ── Bringing the app forward after sign-in ───────────────────────────────
    //
    // `delivered_token` is the whole "only on success" rule; `focus_main_window`
    // is the (untestable without a window) mechanical half.

    fn result(pairs: &[(&str, &str)]) -> LoopbackAuthResult {
        LoopbackAuthResult {
            params: pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            timed_out: false,
            cancelled: false,
        }
    }

    #[test]
    fn a_delivered_token_brings_the_app_forward() {
        assert!(delivered_token(&result(&[("token", "jwt")])));
        // Every accepted parameter name the frontend would exchange.
        assert!(delivered_token(&result(&[("session", "jwt")])));
        assert!(delivered_token(&result(&[("__clerk_db_jwt", "handshake")])));
    }

    /// A profile without a token is not a sign-in. `delivered_token` must key
    /// only on the token-shaped parameters, never on the profile fields that
    /// may ride alongside them — and must still fire when they do.
    #[test]
    fn delivered_token_ignores_profile_only_params() {
        assert!(delivered_token(&result(&[
            ("token", "jwt"),
            ("name", "Ada Lovelace"),
            ("email", "ada@example.com"),
            ("avatar", "https://img.clerk.com/a.png"),
            ("username", "ada"),
        ])));
        assert!(!delivered_token(&result(&[
            ("name", "Ada Lovelace"),
            ("email", "ada@example.com"),
            ("avatar", "https://img.clerk.com/a.png"),
            ("username", "ada"),
        ])));
    }

    // The three ways a sign-in ends *without* the user getting what they asked
    // for. Stealing focus for any of them interrupts whatever they moved on to
    // in order to announce a failure — so none of them may.
    #[test]
    fn a_refused_sign_in_never_steals_focus() {
        // The portal (or the bridge page) bounced back an error…
        assert!(!delivered_token(&result(&[("error", "access_denied")])));
        // …and an error wins even if something token-shaped rode along with it.
        assert!(!delivered_token(&result(&[
            ("error", "no_session"),
            ("token", "jwt")
        ])));
        // A present-but-empty token is not a token.
        assert!(!delivered_token(&result(&[("token", "")])));
        // Nothing delivered at all.
        assert!(!delivered_token(&result(&[])));

        let timed_out = LoopbackAuthResult {
            params: HashMap::new(),
            timed_out: true,
            cancelled: false,
        };
        assert!(!delivered_token(&timed_out));
        let cancelled = LoopbackAuthResult {
            params: HashMap::new(),
            timed_out: false,
            cancelled: true,
        };
        assert!(!delivered_token(&cancelled));
    }

    // A timeout/cancel carrying leftover params must still not focus: the flags
    // are checked before the params, not instead of them.
    #[test]
    fn a_settled_flag_outranks_leftover_params() {
        let mut r = result(&[("token", "jwt")]);
        r.timed_out = true;
        assert!(!delivered_token(&r));
        let mut r = result(&[("token", "jwt")]);
        r.cancelled = true;
        assert!(!delivered_token(&r));
    }

    // The two ends must agree on what a delivered token looks like; this pins
    // the Rust list to the frontend's `JWT_PARAMS`.
    #[test]
    fn token_params_match_the_frontend_list() {
        assert_eq!(TOKEN_PARAMS, ["token", "session", "__clerk_db_jwt"]);
    }
}
