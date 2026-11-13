//! Remote theme catalog + gated pack delivery.
//!
//! Themes used to be hardcoded in TypeScript and shipped inside the executable,
//! so adding one meant shipping an app release. Here the catalog and the packs
//! both come from the license server, and the desktop keeps a local cache so an
//! owned theme keeps working offline.
//!
//! Two IPC commands:
//!
//! * [`theme_catalog`] — public, no auth. Served from cache inside a 24 h TTL,
//!   otherwise fetched. A network failure falls back to the last cached
//!   catalog; with no cache at all it returns an empty list, which the UI reads
//!   as "show the built-ins only".
//! * [`theme_pack`] — **cache first**. On a miss it reads the persisted license
//!   token (the same `stored_token` path `create_checkout` uses), returns
//!   `NOT_SIGNED_IN` when there is none, and otherwise downloads, verifies,
//!   sanitises, caches and returns.
//!
//! Both run over IPC with `reqwest` rather than `fetch` from the WebView. That
//! is deliberate: the bytes arrive through IPC and are handed to the page as
//! data URIs, so **no CSP change is needed** — no new `connect-src` or
//! `img-src` origin has to be opened up.
//!
//! ## Cache shape (`themes.json`, tauri-plugin-store)
//!
//! ```json
//! {
//!   "catalog": { "fetchedAt": 1760000000, "payload": { … } },
//!   "packs": { "aurora": { "fetchedAt": …, "checksum": "sha256:…",
//!                          "kind": "app", "name": "Aurora", "pack": { … } } }
//! }
//! ```
//!
//! A cached **pack never expires** — a theme you paid for must keep working
//! offline forever. Only the catalog carries a TTL.

use crate::svg_sanitize::{check_value, validate_data_uri, validate_svg, SvgRejection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

/// plugin-store file holding the theme cache. Separate from `license.json` /
/// `device.json` because it is pure derived data: deleting it costs a re-fetch
/// and nothing else.
const THEMES_FILE: &str = "themes.json";
const CATALOG_KEY: &str = "catalog";
const PACKS_KEY: &str = "packs";

/// How long a cached catalog is served without re-fetching.
const CATALOG_TTL_SECS: u64 = 24 * 60 * 60;

/// Ceiling on a downloaded pack, checked before parsing. A theme is a handful
/// of kilobytes; this only stops a hostile or broken server from making us
/// allocate without bound.
const MAX_PACK_BYTES: usize = 512 * 1024;

/// Ceiling on how deeply a pack's JSON may nest. Guards the recursive walk in
/// [`sanitize_pack`] against a stack-exhausting payload.
const MAX_PACK_DEPTH: usize = 32;

// ── Wire types (verbatim from the approved contract) ────────────────────────

/// `GET /themes/catalog` — public.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeCatalog {
    pub version: String,
    pub themes: Vec<CatalogTheme>,
}

impl ThemeCatalog {
    /// The "no catalog anywhere" answer: an empty list, which the UI treats as
    /// "built-ins only" rather than as an error.
    fn empty() -> Self {
        Self {
            version: String::new(),
            themes: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogTheme {
    pub id: String,
    /// `"app"` or `"graph"`.
    pub kind: String,
    pub name: String,
    pub price_usd: f64,
    pub preview: ThemePreview,
    pub checksum: String,
    /// Whether the server deployment has a Polar product mapped for this theme
    /// and can therefore actually sell it.
    ///
    /// Defaults to `true` when absent: an older server — or a catalog cached
    /// before this field existed — says nothing about purchasability, and
    /// silently greying out every Buy button on that evidence would be a worse
    /// lie than the one this field exists to fix. A wrong `true` still fails
    /// safely at `/checkout`, which is exactly today's behaviour.
    #[serde(default = "purchasable_default")]
    pub purchasable: bool,
}

fn purchasable_default() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemePreview {
    /// 3–5 hex colours.
    #[serde(default)]
    pub swatches: Vec<String>,
    /// One representative asset, `kind: "graph"` only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node_url: Option<String>,
}

/// `GET /themes/{id}/pack` — requires `Authorization: Bearer <license token>`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemePackPayload {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub checksum: String,
    /// Byte-for-byte the shape the frontend already consumes (`ThemePack` /
    /// `GraphThemePack`). Kept as opaque JSON here: this change introduces a
    /// new delivery path, not a new theme *format*, so Rust has no reason to
    /// model every field — only to prove the asset strings inside are safe.
    pub pack: Value,
}

// ── Cache records ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedCatalog {
    fetched_at: u64,
    payload: ThemeCatalog,
}

/// A cached pack.
///
/// `checksum` is the server's own value, and it is also what the on-read
/// verification recomputes and compares against — the two sides agree because
/// the hash rule is pinned on both: sha256 over the `pack` value serialised
/// compactly with object keys in lexicographic order (see [`pack_checksum`]).
///
/// `kind` and `name` are stored alongside because a cache hit has to answer
/// with a complete [`ThemePackPayload`] while offline, and neither can be
/// recovered from the pack body or from a catalog that may not be cached.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedPack {
    fetched_at: u64,
    checksum: String,
    kind: String,
    name: String,
    pack: Value,
}

impl CachedPack {
    fn from_payload(payload: &ThemePackPayload, now: u64) -> Self {
        Self {
            fetched_at: now,
            checksum: payload.checksum.clone(),
            kind: payload.kind.clone(),
            name: payload.name.clone(),
            pack: payload.pack.clone(),
        }
    }

    fn into_payload(self, id: &str) -> ThemePackPayload {
        ThemePackPayload {
            id: id.to_string(),
            kind: self.kind,
            name: self.name,
            checksum: self.checksum,
            pack: self.pack,
        }
    }
}

// ── Pure decision logic (unit-testable without a running Tauri app) ─────────

/// Whether a catalog cached at `fetched_at` may still be served at `now`.
/// A clock that has gone backwards makes the entry look "from the future";
/// treat that as stale rather than as valid forever.
fn catalog_is_fresh(fetched_at: u64, now: u64) -> bool {
    now >= fetched_at && now - fetched_at < CATALOG_TTL_SECS
}

/// What [`theme_catalog`] should do before touching the network.
#[derive(Debug, Clone, PartialEq)]
enum CatalogAction {
    /// Serve this cached payload as-is.
    Serve(ThemeCatalog),
    /// Go to the network.
    Fetch,
}

fn catalog_action(cached: Option<&CachedCatalog>, force_refresh: bool, now: u64) -> CatalogAction {
    match cached {
        Some(c) if !force_refresh && catalog_is_fresh(c.fetched_at, now) => {
            CatalogAction::Serve(c.payload.clone())
        }
        _ => CatalogAction::Fetch,
    }
}

/// What [`theme_pack`] should do. **Cache first** — a cached pack is served
/// without a network round trip and without a license check, because a theme
/// already downloaded is a theme already paid for, and it has to keep working
/// offline forever.
#[derive(Debug, Clone, PartialEq)]
enum PackSource {
    Cache(Box<ThemePackPayload>),
    Download,
}

fn pack_source(cached: Option<CachedPack>, id: &str) -> PackSource {
    match cached {
        // Verify the checksum before trusting the bytes: this catches a
        // truncated or corrupted cache file. A user who deliberately edits
        // their own app-data is outside the threat model (the project is
        // Apache-2.0 — they can patch the binary). A mismatch is not an error,
        // just a miss: fall through and re-download.
        Some(c) if pack_checksum(&c.pack) == c.checksum => {
            PackSource::Cache(Box::new(c.into_payload(id)))
        }
        _ => PackSource::Download,
    }
}

/// `sha256:<hex>` over the canonical rendering of `value`.
///
/// The rule is shared verbatim with the license server, because a
/// checksum only means anything if both ends hash the same bytes: sha256 over
/// the **`pack` value alone** (not the response envelope), serialised compactly
/// with no whitespace and with object keys in lexicographic order.
fn pack_checksum(value: &Value) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(canonical_json(value).as_bytes());
    format!("sha256:{:x}", hasher.finalize())
}

/// Deterministic JSON rendering: object keys sorted, no insignificant
/// whitespace. Written out rather than relying on `serde_json`'s map ordering,
/// which flips with the `preserve_order` feature a transitive dependency could
/// enable at any time.
fn canonical_json(value: &Value) -> String {
    match value {
        Value::Object(map) => {
            let sorted: BTreeMap<&String, &Value> = map.iter().collect();
            let body: Vec<String> = sorted
                .iter()
                .map(|(k, v)| format!("{}:{}", Value::String((*k).clone()), canonical_json(v)))
                .collect();
            format!("{{{}}}", body.join(","))
        }
        Value::Array(items) => {
            let body: Vec<String> = items.iter().map(canonical_json).collect();
            format!("[{}]", body.join(","))
        }
        other => other.to_string(),
    }
}

// ── Sanitisation of a whole pack ────────────────────────────────────────────

/// Why a downloaded pack was refused. Carries the JSON path so the offending
/// field can actually be found.
#[derive(Debug, Clone, PartialEq)]
pub struct PackRejection {
    pub path: String,
    pub reason: SvgRejection,
}

impl std::fmt::Display for PackRejection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} at `{}`", self.reason, self.path)
    }
}

/// Validate every string a pack carries, **fail closed**.
///
/// Three classes of string, three rules:
///
/// * `svg` — raw markup that `MetroGraph.svelte` injects with `{@html}`. Runs
///   through the element/attribute allowlist.
/// * `url` — a `data:image/svg+xml` asset. Decoded first, then run through the
///   *same* allowlist, because percent-encoding hides a payload from any
///   substring check.
/// * everything else — names, colours, CSS backgrounds, font stacks. Scanned
///   for the forbidden tokens (`javascript:`, nested `data:`, `url(`,
///   `<!ENTITY`, …) so a theme cannot smuggle a fetch or a script through a
///   field that merely looks inert.
///
/// Any single failure rejects the whole pack; nothing is stripped.
pub fn sanitize_pack(pack: &Value) -> Result<(), PackRejection> {
    walk(pack, "pack", 0)
}

fn walk(value: &Value, path: &str, depth: usize) -> Result<(), PackRejection> {
    if depth > MAX_PACK_DEPTH {
        return Err(PackRejection {
            path: path.to_string(),
            reason: SvgRejection::TooLarge("nesting depth"),
        });
    }
    match value {
        Value::Object(map) => {
            for (k, v) in map {
                let child = format!("{path}.{k}");
                match (k.as_str(), v) {
                    ("svg", Value::String(s)) => {
                        validate_svg(s).map_err(|reason| PackRejection {
                            path: child.clone(),
                            reason,
                        })?
                    }
                    ("url", Value::String(s)) => {
                        validate_data_uri(s).map_err(|reason| PackRejection {
                            path: child.clone(),
                            reason,
                        })?
                    }
                    _ => walk(v, &child, depth + 1)?,
                }
            }
            Ok(())
        }
        Value::Array(items) => {
            for (i, v) in items.iter().enumerate() {
                walk(v, &format!("{path}[{i}]"), depth + 1)?;
            }
            Ok(())
        }
        Value::String(s) => check_value(path, s).map_err(|reason| PackRejection {
            path: path.to_string(),
            reason,
        }),
        _ => Ok(()),
    }
}

/// Drop catalog entries whose preview asset would be unsafe to render.
///
/// Unlike a pack — where one bad field rejects the lot, because a partly
/// stripped theme misrepresents its author — a catalog is a *list*, and taking
/// the whole store offline over one malformed row would be a worse outcome than
/// hiding that row. So a bad entry is dropped and logged, and the rest of the
/// store still works.
fn filter_catalog(mut catalog: ThemeCatalog) -> ThemeCatalog {
    catalog.themes.retain(|t| match preview_is_safe(t) {
        Ok(()) => true,
        Err(reason) => {
            tracing::warn!(theme = %t.id, %reason, "dropping catalog entry with an unsafe preview");
            false
        }
    });
    catalog
}

fn preview_is_safe(theme: &CatalogTheme) -> Result<(), SvgRejection> {
    for (i, swatch) in theme.preview.swatches.iter().enumerate() {
        check_value(&format!("preview.swatches[{i}]"), swatch)?;
    }
    match &theme.preview.node_url {
        Some(url) => validate_data_uri(url),
        None => Ok(()),
    }
}

// ── Store access ────────────────────────────────────────────────────────────

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn read_cached_catalog(app: &AppHandle) -> Option<CachedCatalog> {
    use tauri_plugin_store::StoreExt;
    let store = app.store(THEMES_FILE).ok()?;
    let raw = store.get(CATALOG_KEY)?;
    serde_json::from_value(raw).ok()
}

fn write_cached_catalog(app: &AppHandle, entry: &CachedCatalog) {
    use tauri_plugin_store::StoreExt;
    // A cache-write miss only costs a re-fetch next launch, so failures are
    // swallowed rather than surfaced.
    if let Ok(store) = app.store(THEMES_FILE) {
        if let Ok(v) = serde_json::to_value(entry) {
            store.set(CATALOG_KEY, v);
            let _ = store.save();
        }
    }
}

fn read_cached_pack(app: &AppHandle, id: &str) -> Option<CachedPack> {
    use tauri_plugin_store::StoreExt;
    let store = app.store(THEMES_FILE).ok()?;
    let packs = store.get(PACKS_KEY)?;
    let entry = packs.get(id)?.clone();
    serde_json::from_value(entry).ok()
}

fn write_cached_pack(app: &AppHandle, id: &str, entry: &CachedPack) {
    use tauri_plugin_store::StoreExt;
    let Ok(store) = app.store(THEMES_FILE) else {
        return;
    };
    let mut packs = match store.get(PACKS_KEY) {
        Some(Value::Object(m)) => m,
        _ => serde_json::Map::new(),
    };
    let Ok(v) = serde_json::to_value(entry) else {
        return;
    };
    packs.insert(id.to_string(), v);
    store.set(PACKS_KEY, Value::Object(packs));
    let _ = store.save();
}

// ── Errors ──────────────────────────────────────────────────────────────────

/// Why [`theme_pack`] could not produce a pack.
///
/// Serialises as `{ code, message }` — the same shape `AdgitterError` uses, so
/// the frontend's existing `isAdgitterError` guard recognises it and switches on
/// `code` rather than parsing prose. A dedicated type (rather than folding
/// everything into `AdgitterError::Internal`) is what lets the UI tell "you
/// don't own this yet" apart from "you're offline" apart from "sign in" —
/// three different things to say to the user, and only one of them is a fault.
///
/// The codes mirror what the license server returns so the desktop does not invent
/// a second vocabulary for the same conditions.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ThemeError {
    pub code: &'static str,
    pub message: String,
}

impl ThemeError {
    /// No license on disk. Reuses the existing `NOT_SIGNED_IN` code verbatim so
    /// the established sign-in-and-retry handling applies unchanged.
    fn not_signed_in() -> Self {
        Self {
            code: "NOT_SIGNED_IN",
            message: "not signed in — sign in to continue".into(),
        }
    }
    /// 403: a valid license whose `ownedThemes` does not include this theme.
    fn not_owned(id: &str) -> Self {
        Self {
            code: "THEME_NOT_OWNED",
            message: format!("theme `{id}` is not owned by this license"),
        }
    }
    /// 404: no such theme in the catalog.
    fn not_found(id: &str) -> Self {
        Self {
            code: "THEME_NOT_FOUND",
            message: format!("theme `{id}` does not exist"),
        }
    }
    /// The pack failed sanitisation, its checksum did not match, or it was
    /// otherwise malformed. Never cached.
    fn rejected(id: &str, why: impl std::fmt::Display) -> Self {
        Self {
            code: "THEME_REJECTED",
            message: format!("theme `{id}` was rejected: {why}"),
        }
    }
    /// Network/transport failure — the recoverable "you're offline" case.
    fn unavailable(id: &str, why: impl std::fmt::Display) -> Self {
        Self {
            code: "THEME_UNAVAILABLE",
            message: format!("theme `{id}` could not be downloaded: {why}"),
        }
    }
}

// ── IPC commands ────────────────────────────────────────────────────────────

/// The purchasable theme catalog. Public — browsing the store has to work
/// signed out, since that is how someone decides to buy.
///
/// Served from the cache inside its 24 h TTL (`force_refresh` skips the TTL).
/// On a network failure the last cached catalog is returned, and with no cache
/// at all an empty list — never an error, because a store that cannot reach the
/// server should degrade to "built-in themes only", not to a broken dialog.
#[tauri::command]
pub async fn theme_catalog(
    app: AppHandle,
    force_refresh: bool,
) -> Result<ThemeCatalog, ThemeError> {
    let cached = read_cached_catalog(&app);
    if let CatalogAction::Serve(payload) =
        catalog_action(cached.as_ref(), force_refresh, now_secs())
    {
        return Ok(payload);
    }

    match fetch_catalog().await {
        Ok(fresh) => {
            let fresh = filter_catalog(fresh);
            write_cached_catalog(
                &app,
                &CachedCatalog {
                    fetched_at: now_secs(),
                    payload: fresh.clone(),
                },
            );
            Ok(fresh)
        }
        Err(err) => {
            tracing::warn!(%err, "theme catalog fetch failed; falling back to cache");
            Ok(cached
                .map(|c| c.payload)
                .unwrap_or_else(ThemeCatalog::empty))
        }
    }
}

async fn fetch_catalog() -> Result<ThemeCatalog, String> {
    let url = format!(
        "{}/themes/catalog",
        crate::commands::api_base().trim_end_matches('/')
    );
    let resp = reqwest::Client::new()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("catalog request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("catalog rejected ({})", resp.status()));
    }
    resp.json::<ThemeCatalog>()
        .await
        .map_err(|e| format!("catalog parse failed: {e}"))
}

/// A full theme pack, ready for the frontend's existing theme engine.
///
/// **Cache first**: an already-downloaded pack is returned straight from
/// `themes.json` with no network call and no license check — you own it, and it
/// must keep working offline forever.
///
/// On a miss this needs an identity, so it reads the persisted license token
/// (the same `stored_token` path `create_checkout` uses) and returns
/// `NOT_SIGNED_IN` when there is none — a recoverable state the UI answers by
/// launching sign-in, not an internal fault. Otherwise it downloads,
/// **verifies and sanitises before caching** (so the cache can only ever hold
/// vetted markup), stores, and returns.
#[tauri::command]
pub async fn theme_pack(app: AppHandle, id: String) -> Result<ThemePackPayload, ThemeError> {
    if let PackSource::Cache(payload) = pack_source(read_cached_pack(&app, &id), &id) {
        return Ok(*payload);
    }

    let token = crate::commands::stored_token(&app)
        .await
        .ok_or_else(ThemeError::not_signed_in)?;
    let payload = download_pack(&id, &token).await?;

    write_cached_pack(&app, &id, &CachedPack::from_payload(&payload, now_secs()));
    Ok(payload)
}

async fn download_pack(id: &str, token: &str) -> Result<ThemePackPayload, ThemeError> {
    let url = format!(
        "{}/themes/{}/pack",
        crate::commands::api_base().trim_end_matches('/'),
        urlencoding(id)
    );
    let resp = reqwest::Client::new()
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| ThemeError::unavailable(id, e))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(status_error(id, status.as_u16()));
    }

    let body = resp
        .text()
        .await
        .map_err(|e| ThemeError::unavailable(id, e))?;
    if body.len() > MAX_PACK_BYTES {
        return Err(ThemeError::rejected(id, "pack exceeds the size limit"));
    }
    let payload: ThemePackPayload =
        serde_json::from_str(&body).map_err(|e| ThemeError::rejected(id, e))?;

    if payload.id != id {
        return Err(ThemeError::rejected(
            id,
            format!("server returned `{}`", payload.id),
        ));
    }

    // Both ends hash the same bytes by agreement (see `pack_checksum`), so a
    // mismatch here is real: a corrupted transfer or a tampered payload.
    let computed = pack_checksum(&payload.pack);
    if computed != payload.checksum {
        return Err(ThemeError::rejected(
            id,
            format!(
                "checksum mismatch (expected {}, got {computed})",
                payload.checksum
            ),
        ));
    }

    // Sanitise BEFORE the caller can cache it, so nothing unvetted is ever
    // written to disk. A pack that fails is refused outright and not cached.
    sanitize_pack(&payload.pack).map_err(|e| ThemeError::rejected(id, e))?;

    Ok(payload)
}

/// Map the contract's HTTP statuses onto the codes the UI switches on.
///
/// Per the contract: **401** missing/invalid license token · **403** a valid
/// token whose `ownedThemes` lacks this id · **404** unknown id. A 401 is
/// genuinely "sign in again", so it collapses onto the existing recoverable
/// `NOT_SIGNED_IN` code the sign-in flow already handles.
fn status_error(id: &str, status: u16) -> ThemeError {
    match status {
        401 => ThemeError::not_signed_in(),
        403 => ThemeError::not_owned(id),
        404 => ThemeError::not_found(id),
        other => ThemeError::unavailable(id, format!("server returned HTTP {other}")),
    }
}

/// Percent-encode a theme id for use as a path segment. Ids are slugs today,
/// but the id reaches here from the frontend, so it is encoded rather than
/// trusted to be path-safe.
fn urlencoding(id: &str) -> String {
    use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
    utf8_percent_encode(id, NON_ALPHANUMERIC).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn catalog(version: &str) -> ThemeCatalog {
        ThemeCatalog {
            version: version.into(),
            themes: vec![CatalogTheme {
                id: "aurora".into(),
                kind: "app".into(),
                name: "Aurora".into(),
                price_usd: 0.99,
                preview: ThemePreview {
                    swatches: vec!["#0b1020".into()],
                    node_url: None,
                },
                checksum: "sha256:abc".into(),
                purchasable: true,
            }],
        }
    }

    /// A catalog cached (or served) before `purchasable` existed must still
    /// parse, and must not turn every Buy button off on that silence.
    #[test]
    fn a_catalog_without_purchasable_defaults_to_sellable() {
        let row: CatalogTheme = serde_json::from_value(json!({
            "id": "aurora",
            "kind": "app",
            "name": "Aurora",
            "priceUsd": 0.99,
            "preview": { "swatches": ["#0b1020"] },
            "checksum": "sha256:abc"
        }))
        .expect("an older catalog row still parses");
        assert!(row.purchasable);
    }

    /// …but an explicit `false` is carried through to the UI verbatim.
    #[test]
    fn purchasable_false_is_preserved() {
        let row: CatalogTheme = serde_json::from_value(json!({
            "id": "aurora",
            "kind": "app",
            "name": "Aurora",
            "priceUsd": 0.99,
            "preview": { "swatches": ["#0b1020"] },
            "checksum": "sha256:abc",
            "purchasable": false
        }))
        .expect("row parses");
        assert!(!row.purchasable);
        let back = serde_json::to_value(&row).unwrap();
        assert_eq!(back["purchasable"], serde_json::Value::Bool(false));
    }

    // ── Catalog TTL ─────────────────────────────────────────────────────────

    #[test]
    fn serves_a_catalog_cached_inside_the_ttl() {
        let cached = CachedCatalog {
            fetched_at: 1_000,
            payload: catalog("v1"),
        };
        assert_eq!(
            catalog_action(Some(&cached), false, 1_000 + CATALOG_TTL_SECS - 1),
            CatalogAction::Serve(catalog("v1"))
        );
    }

    #[test]
    fn refetches_once_the_ttl_has_elapsed() {
        let cached = CachedCatalog {
            fetched_at: 1_000,
            payload: catalog("v1"),
        };
        assert_eq!(
            catalog_action(Some(&cached), false, 1_000 + CATALOG_TTL_SECS),
            CatalogAction::Fetch
        );
    }

    #[test]
    fn force_refresh_ignores_a_fresh_cache() {
        let cached = CachedCatalog {
            fetched_at: 1_000,
            payload: catalog("v1"),
        };
        assert_eq!(
            catalog_action(Some(&cached), true, 1_001),
            CatalogAction::Fetch
        );
    }

    #[test]
    fn fetches_when_nothing_is_cached() {
        assert_eq!(catalog_action(None, false, 1_000), CatalogAction::Fetch);
    }

    #[test]
    fn treats_a_backwards_clock_as_stale_rather_than_eternally_fresh() {
        assert!(!catalog_is_fresh(5_000, 1_000));
    }

    // ── Pack: cache first, never expiring ───────────────────────────────────

    fn cached_pack(now: u64) -> CachedPack {
        let pack = json!({ "id": "aurora", "name": "Aurora", "vars": { "fg": "#fff" } });
        CachedPack::from_payload(
            &ThemePackPayload {
                id: "aurora".into(),
                kind: "app".into(),
                name: "Aurora".into(),
                // What the server would have sent: both ends hash the same way.
                checksum: pack_checksum(&pack),
                pack,
            },
            now,
        )
    }

    #[test]
    fn serves_a_cached_pack_without_touching_the_network() {
        match pack_source(Some(cached_pack(1_000)), "aurora") {
            PackSource::Cache(p) => {
                assert_eq!(p.id, "aurora");
                assert_eq!(p.kind, "app");
                assert_eq!(p.name, "Aurora");
                assert_eq!(p.pack["vars"]["fg"], json!("#fff"));
            }
            PackSource::Download => panic!("cache-first was not honoured"),
        }
    }

    #[test]
    fn a_cached_pack_never_expires() {
        // Ten years on, an owned theme still resolves from cache: it was paid
        // for, and offline use must not decay.
        let ancient = cached_pack(0);
        assert!(matches!(
            pack_source(Some(ancient), "aurora"),
            PackSource::Cache(_)
        ));
    }

    #[test]
    fn downloads_when_nothing_is_cached() {
        assert_eq!(pack_source(None, "aurora"), PackSource::Download);
    }

    #[test]
    fn refuses_a_cached_pack_whose_checksum_no_longer_matches() {
        let mut corrupt = cached_pack(1_000);
        corrupt.pack = json!({ "id": "aurora", "vars": { "fg": "#000" } });
        assert_eq!(pack_source(Some(corrupt), "aurora"), PackSource::Download);
    }

    #[test]
    fn the_checksum_ignores_key_order_but_not_content() {
        let a = json!({ "a": 1, "b": { "c": 2, "d": 3 } });
        let b = json!({ "b": { "d": 3, "c": 2 }, "a": 1 });
        assert_eq!(pack_checksum(&a), pack_checksum(&b));
        assert_ne!(pack_checksum(&a), pack_checksum(&json!({ "a": 2 })));
    }

    /// The checksum rule is a cross-service agreement with the license server
    /// (`src/themes.rs`): compact, no whitespace, object keys lexicographic.
    /// Pin the exact canonical rendering — if this drifts, every cache-hit
    /// verification and every download check silently starts failing.
    #[test]
    fn the_canonical_rendering_matches_the_rule_shared_with_the_api() {
        let v = json!({ "z": 1, "a": { "n": [1, 2], "m": "x" }, "b": true, "c": null });
        assert_eq!(
            canonical_json(&v),
            r#"{"a":{"m":"x","n":[1,2]},"b":true,"c":null,"z":1}"#
        );
        assert!(pack_checksum(&v).starts_with("sha256:"));
        assert_eq!(pack_checksum(&v).len(), "sha256:".len() + 64);
    }

    // ── Error codes the UI switches on ──────────────────────────────────────

    /// The contract's three failure statuses have to reach the user as three
    /// different sentences, so they must not collapse into one code.
    #[test]
    fn maps_each_contract_status_to_its_own_code() {
        assert_eq!(status_error("aurora", 401).code, "NOT_SIGNED_IN");
        assert_eq!(status_error("aurora", 403).code, "THEME_NOT_OWNED");
        assert_eq!(status_error("aurora", 404).code, "THEME_NOT_FOUND");
        assert_eq!(status_error("aurora", 500).code, "THEME_UNAVAILABLE");
    }

    #[test]
    fn a_theme_error_serialises_like_an_adgitter_error() {
        // The frontend's `isAdgitterError` guard checks for exactly {code, message}.
        let v = serde_json::to_value(ThemeError::not_owned("aurora")).unwrap();
        assert_eq!(v["code"], json!("THEME_NOT_OWNED"));
        assert!(v["message"].as_str().unwrap().contains("aurora"));
        assert_eq!(v.as_object().unwrap().len(), 2);
    }

    // ── Pack sanitisation: fail closed on every hostile field ───────────────

    #[test]
    fn accepts_a_pack_shaped_like_the_built_ins() {
        let pack = json!({
            "id": "synthwave",
            "name": "Synthwave",
            "lanes": ["#ff00ff", "#00ffff"],
            "background": "linear-gradient(#000, #222)",
            "head": {
                "url": "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' \
                        width='22' height='20'><polygon points='11,1 20,19 2,19' \
                        fill='%232196f3'/></svg>",
                "svg": "<polygon points='11,1 20,19 2,19' fill='currentColor'/>",
                "width": 22,
                "height": 20
            },
            "node": { "normal": { "url": "data:image/svg+xml;utf8,<svg \
                        xmlns='http://www.w3.org/2000/svg'><circle r='11'/></svg>",
                      "width": 26, "height": 26 } }
        });
        assert_eq!(sanitize_pack(&pack), Ok(()));
    }

    #[test]
    fn rejects_the_whole_pack_for_one_hostile_inline_svg() {
        let pack = json!({
            "id": "evil",
            "head": { "svg": "<circle r='1' onload='alert(1)'/>", "width": 1, "height": 1 }
        });
        let err = sanitize_pack(&pack).expect_err("must be rejected");
        assert_eq!(err.path, "pack.head.svg");
        assert_eq!(err.reason, SvgRejection::Attribute("onload".into()));
    }

    #[test]
    fn rejects_the_whole_pack_for_one_hostile_data_uri_asset() {
        let pack = json!({
            "id": "evil",
            "node": { "normal": {
                "url": "data:image/svg+xml;utf8,%3Cscript%3Ealert(1)%3C/script%3E",
                "width": 1, "height": 1
            } }
        });
        let err = sanitize_pack(&pack).expect_err("must be rejected");
        assert_eq!(err.path, "pack.node.normal.url");
        assert_eq!(err.reason, SvgRejection::Element("script".into()));
    }

    #[test]
    fn rejects_a_css_url_fetch_hidden_in_a_background() {
        let pack = json!({ "id": "evil", "background": "url(https://evil.example/track.png)" });
        let err = sanitize_pack(&pack).expect_err("must be rejected");
        assert_eq!(
            err.reason.to_string(),
            "attribute `pack.background` contains forbidden `url(`"
        );
    }

    #[test]
    fn rejects_a_hostile_asset_nested_in_a_decor_sprite_array() {
        let pack = json!({
            "id": "evil",
            "decorOver": { "sprites": [
                { "asset": { "svg": "<circle r='1'/>", "width": 1, "height": 1 }, "x": 0, "y": 0 },
                { "asset": { "svg": "<foreignObject/>", "width": 1, "height": 1 }, "x": 1, "y": 1 }
            ] }
        });
        let err = sanitize_pack(&pack).expect_err("must be rejected");
        assert_eq!(err.path, "pack.decorOver.sprites[1].asset.svg");
        assert_eq!(err.reason, SvgRejection::Element("foreignObject".into()));
    }

    #[test]
    fn rejects_a_javascript_scheme_in_an_ordinary_looking_field() {
        let pack = json!({ "id": "evil", "text": { "fontFamily": "javascript:alert(1)" } });
        assert!(sanitize_pack(&pack).is_err());
    }

    #[test]
    fn rejects_an_entity_declaration_smuggled_into_a_plain_string() {
        let pack =
            json!({ "id": "evil", "description": "<!ENTITY xxe SYSTEM 'file:///etc/passwd'>" });
        assert!(sanitize_pack(&pack).is_err());
    }

    #[test]
    fn rejects_a_doctype_in_an_inline_svg() {
        let pack = json!({
            "id": "evil",
            "head": { "svg": "<!DOCTYPE svg><circle r='1'/>", "width": 1, "height": 1 }
        });
        assert_eq!(
            sanitize_pack(&pack).expect_err("must be rejected").reason,
            SvgRejection::Doctype
        );
    }

    #[test]
    fn rejects_a_pack_nested_beyond_the_depth_ceiling() {
        let mut v = json!("leaf");
        for _ in 0..(MAX_PACK_DEPTH + 2) {
            v = json!({ "n": v });
        }
        assert!(sanitize_pack(&v).is_err());
    }

    // ── Catalog previews ────────────────────────────────────────────────────

    #[test]
    fn drops_only_the_catalog_entry_whose_preview_is_unsafe() {
        let mut c = catalog("v1");
        c.themes.push(CatalogTheme {
            id: "evil".into(),
            kind: "graph".into(),
            name: "Evil".into(),
            price_usd: 1.99,
            preview: ThemePreview {
                swatches: vec!["#000".into()],
                node_url: Some(
                    "data:image/svg+xml;utf8,%3Csvg%20onload%3D%22alert(1)%22%3E%3C/svg%3E".into(),
                ),
            },
            checksum: "sha256:def".into(),
            purchasable: true,
        });

        let filtered = filter_catalog(c);

        // One bad row is hidden; the store as a whole stays usable.
        assert_eq!(
            filtered
                .themes
                .iter()
                .map(|t| t.id.as_str())
                .collect::<Vec<_>>(),
            vec!["aurora"]
        );
    }

    #[test]
    fn keeps_a_catalog_entry_with_a_safe_preview_asset() {
        let mut c = catalog("v1");
        c.themes[0].preview.node_url = Some(
            "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><circle r='4'/></svg>"
                .into(),
        );
        assert_eq!(filter_catalog(c).themes.len(), 1);
    }

    // ── Wire shape ──────────────────────────────────────────────────────────

    #[test]
    fn decodes_the_catalog_contract_verbatim() {
        // Guards the field names against drift from the server's contract.
        let wire = r##"{
            "version": "2026-08-10T00:00:00Z",
            "themes": [{
                "id": "synthwave", "kind": "graph", "name": "Synthwave",
                "priceUsd": 1.99,
                "preview": { "swatches": ["#0b1020", "#5ec8ff"], "nodeUrl": "data:image/svg+xml,x" },
                "checksum": "sha256:deadbeef",
                "purchasable": false
            }]
        }"##;
        let parsed: ThemeCatalog = serde_json::from_str(wire).unwrap();
        assert_eq!(parsed.version, "2026-08-10T00:00:00Z");
        let t = &parsed.themes[0];
        assert_eq!(
            (t.id.as_str(), t.kind.as_str(), t.price_usd),
            ("synthwave", "graph", 1.99)
        );
        assert_eq!(t.preview.swatches.len(), 2);
        assert_eq!(t.preview.node_url.as_deref(), Some("data:image/svg+xml,x"));
        assert!(!t.purchasable);
    }

    #[test]
    fn decodes_the_pack_contract_verbatim() {
        let wire = r##"{
            "id": "aurora", "kind": "app", "name": "Aurora", "checksum": "sha256:abc",
            "pack": { "id": "aurora", "name": "Aurora", "vars": { "fg": "#e6fffb" } }
        }"##;
        let parsed: ThemePackPayload = serde_json::from_str(wire).unwrap();
        assert_eq!(parsed.kind, "app");
        assert_eq!(parsed.pack["vars"]["fg"], json!("#e6fffb"));
    }
}
