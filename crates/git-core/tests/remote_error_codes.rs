//! What the user actually hits when a remote says no — end to end, through a
//! real libgit2 HTTP transport talking to a throwaway local server.
//!
//! The frontend skips crash reporting for expected codes (missing token,
//! rejected token, no access, missing repository, no network) and shows a hint
//! instead, so these codes are a contract: if libgit2 ever changes how it
//! words one of these failures, the classification in `error.rs` must be
//! updated, and these tests are where that shows up.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

use git_core::repo::{clone_repository, CloneAuth};

/// Serve `response` to every connection until the test process exits, and
/// return the base URL. Each request's headers are drained first so libgit2
/// sees a well-formed exchange.
fn serve(response: &'static str) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut buf = [0u8; 4096];
            let mut seen = Vec::new();
            while !seen.windows(4).any(|w| w == b"\r\n\r\n") {
                match stream.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => seen.extend_from_slice(&buf[..n]),
                }
            }
            let _ = stream.write_all(response.as_bytes());
        }
    });
    format!("http://{addr}/owner/repo.git")
}

fn clone_code(url: String) -> String {
    let dest = tempfile::TempDir::new().unwrap();
    let err = clone_repository(url, dest.path().join("clone"), CloneAuth::None, |_, _| {})
        .expect_err("the server refuses every request");
    let json = serde_json::to_value(&err).unwrap();
    json["code"].as_str().unwrap().to_string()
}

#[test]
fn a_private_remote_without_a_token_is_auth_required() {
    let url = serve(
        "HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm=\"git\"\r\n\
         Content-Length: 0\r\nConnection: close\r\n\r\n",
    );
    assert_eq!(clone_code(url), "AUTH_REQUIRED");
}

#[test]
fn a_forbidden_remote_is_permission_denied() {
    let url = serve("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    assert_eq!(clone_code(url), "PERMISSION_DENIED");
}

#[test]
fn a_missing_remote_repository_is_remote_not_found() {
    let url = serve("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    assert_eq!(clone_code(url), "REMOTE_NOT_FOUND");
}

#[test]
fn an_unreachable_host_is_a_network_error() {
    // Bind, note the port, and close it again: nothing listens there now.
    let port = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    assert_eq!(
        clone_code(format!("http://127.0.0.1:{port}/owner/repo.git")),
        "NETWORK_ERROR"
    );
}
