//! Allowlist SVG sanitiser for remotely-delivered theme packs.
//!
//! # Why this exists
//!
//! `MetroGraph.svelte` renders a graph theme's tintable head/node assets with
//! `{@html asset.svg}` — raw markup injection. That is safe while every SVG is
//! hand-written in this repo; the moment the markup arrives over the network it
//! becomes an XSS sink, and the Content-Security-Policy does **not** close it:
//! inline event attributes (`onload=`, `onclick=`, …) are not governed by
//! `script-src`. So the trust boundary has to be enforced here, in Rust, at
//! download time — before anything reaches the cache, and long before it
//! reaches the WebView.
//!
//! # Posture: allowlist + fail closed
//!
//! An unknown element or attribute **rejects the entire pack**. It is not
//! silently stripped: a partially-stripped pack renders differently from what
//! its author intended *and* hides the fact that something unexpected shipped.
//! Every rejection is therefore total and named.
//!
//! The same rules apply to `data:image/svg+xml` asset URLs: decode first, then
//! run the decoded markup through the identical allowlist.

use quick_xml::events::Event;
use quick_xml::Reader;
use std::fmt;

/// Elements a theme asset may use. Anything else — `script`, `style`,
/// `foreignObject`, `a`, `image`, `use`, `animate*`, `set`, … — is rejected by
/// virtue of not being here.
const ALLOWED_ELEMENTS: &[&str] = &[
    "svg",
    "g",
    "defs",
    "circle",
    "ellipse",
    "rect",
    "path",
    "polygon",
    "polyline",
    "line",
    "linearGradient",
    "radialGradient",
    "stop",
    "clipPath",
    "mask",
    "title",
    "desc",
];

/// Attributes a theme asset may set. Geometry, paint and gradient plumbing
/// only. Note the absences: no `href`/`xlink:href` in any form (no external
/// references), no `style` (a CSS parser is a second attack surface), and
/// nothing beginning with `on`.
const ALLOWED_ATTRIBUTES: &[&str] = &[
    "id",
    "class",
    "viewBox",
    "xmlns",
    "width",
    "height",
    "x",
    "y",
    "x1",
    "y1",
    "x2",
    "y2",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "d",
    "points",
    "transform",
    "gradientUnits",
    "gradientTransform",
    "offset",
    "fill",
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-dasharray",
    "opacity",
    "fill-opacity",
    "stroke-opacity",
    "fill-rule",
    "clip-path",
    "clip-rule",
    "mask",
    "stop-color",
    "stop-opacity",
];

/// Substrings that are never acceptable inside a value, whatever the attribute.
/// `data:` catches a *nested* data URI (one asset smuggling another), `url(`
/// catches a CSS-function fetch, and `<!entity` catches an entity declaration
/// that slipped through as a value. Compared case-insensitively against a
/// whitespace-stripped copy, so `java\tscript:` and `JAVASCRIPT:` both match.
const FORBIDDEN_VALUE_TOKENS: &[&str] = &[
    "javascript:",
    "data:",
    "url(",
    "<!entity",
    "<!doctype",
    "<script",
    "expression(",
    "vbscript:",
];

/// Upper bounds. A theme asset is a few hundred bytes of geometry; these are
/// three orders of magnitude of headroom, and exist only so a hostile payload
/// cannot turn the parser into a denial of service.
const MAX_SVG_BYTES: usize = 64 * 1024;
const MAX_ELEMENTS: usize = 4_000;
const MAX_DEPTH: usize = 32;

/// Why a pack was refused. Always names the offending construct — a rejection
/// the operator cannot diagnose is a rejection they will be tempted to disable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SvgRejection {
    /// An element outside {@link ALLOWED_ELEMENTS}.
    Element(String),
    /// An attribute outside {@link ALLOWED_ATTRIBUTES} (includes every `on*`).
    Attribute(String),
    /// An allowed attribute carrying a forbidden substring.
    Value { attr: String, token: String },
    /// `<!DOCTYPE …>` / `<!ENTITY …>` — the XXE and billion-laughs surface.
    Doctype,
    /// `<?…?>` processing instruction or XML declaration.
    ProcessingInstruction,
    /// A comment. Rejected unconditionally rather than scanned for markup.
    Comment,
    /// A `<![CDATA[…]]>` section — a way to hide markup from a naive scanner.
    CData,
    /// An entity reference that is not one of the five predefined ones or a
    /// numeric character reference.
    Entity(String),
    /// Malformed XML (including unbalanced tags).
    Malformed(String),
    /// Not a `data:image/svg+xml` URI, or its payload would not decode.
    DataUri(String),
    /// One of the size/complexity ceilings was hit.
    TooLarge(&'static str),
}

impl fmt::Display for SvgRejection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Element(n) => write!(f, "disallowed element <{n}>"),
            Self::Attribute(n) => write!(f, "disallowed attribute `{n}`"),
            Self::Value { attr, token } => {
                write!(f, "attribute `{attr}` contains forbidden `{token}`")
            }
            Self::Doctype => write!(f, "doctype/entity declaration is not allowed"),
            Self::ProcessingInstruction => write!(f, "processing instruction is not allowed"),
            Self::Comment => write!(f, "comments are not allowed"),
            Self::CData => write!(f, "CDATA sections are not allowed"),
            Self::Entity(n) => write!(f, "disallowed entity reference `&{n};`"),
            Self::Malformed(e) => write!(f, "malformed SVG: {e}"),
            Self::DataUri(e) => write!(f, "unusable asset URI: {e}"),
            Self::TooLarge(what) => write!(f, "asset exceeds the {what} limit"),
        }
    }
}

/// Validate SVG markup against the allowlist.
///
/// Accepts either a complete `<svg>…</svg>` document or a bare fragment of
/// children (the shape `GraphAsset.svg` uses — markup drawn centred on the
/// origin, with no wrapper). Returns `Ok(())` only when *every* construct in
/// the input is explicitly permitted.
pub fn validate_svg(markup: &str) -> Result<(), SvgRejection> {
    if markup.len() > MAX_SVG_BYTES {
        return Err(SvgRejection::TooLarge("asset size"));
    }

    let mut reader = Reader::from_str(markup);
    reader.config_mut().check_end_names = true;
    // Entities are surfaced as events (see the `GeneralRef` arm) rather than
    // silently expanded, so an unknown one cannot slip through unexamined.
    let mut elements = 0usize;
    let mut depth = 0usize;

    loop {
        match reader.read_event() {
            // `check_end_names` catches a *mismatched* close tag, but a tag
            // simply left open runs off the end of the input unnoticed. That
            // matters here because these fragments are injected with `{@html}`:
            // an unclosed element would swallow the markup that follows it and
            // restructure the surrounding DOM. Balance is therefore required.
            Ok(Event::Eof) if depth == 0 => return Ok(()),
            Ok(Event::Eof) => {
                return Err(SvgRejection::Malformed(format!(
                    "{depth} unclosed element(s) at end of input"
                )))
            }

            Ok(ev @ (Event::Start(_) | Event::Empty(_))) => {
                let opens = matches!(ev, Event::Start(_));
                let e = match &ev {
                    Event::Start(e) | Event::Empty(e) => e,
                    _ => unreachable!("guarded by the match arm above"),
                };
                if opens {
                    depth += 1;
                    if depth > MAX_DEPTH {
                        return Err(SvgRejection::TooLarge("nesting depth"));
                    }
                }
                elements += 1;
                if elements > MAX_ELEMENTS {
                    return Err(SvgRejection::TooLarge("element count"));
                }
                check_element(e.name().as_ref())?;
                for attr in e.attributes() {
                    let attr = attr.map_err(|err| SvgRejection::Malformed(err.to_string()))?;
                    let name = String::from_utf8_lossy(attr.key.as_ref()).into_owned();
                    check_attribute_name(&name)?;
                    // Check the raw bytes *and* the unescaped form: `&#106;…`
                    // spells `javascript:` only after unescaping, while a
                    // deliberately broken escape only shows up raw.
                    check_value(&name, &String::from_utf8_lossy(attr.value.as_ref()))?;
                    match attr.unescape_value() {
                        Ok(v) => check_value(&name, &v)?,
                        Err(err) => return Err(SvgRejection::Malformed(err.to_string())),
                    }
                }
            }

            Ok(Event::End(_)) => depth = depth.saturating_sub(1),

            // Text is only meaningful inside <title>/<desc> and is never
            // injected as markup. Entity references inside it arrive as their
            // own `GeneralRef` events (below) rather than being expanded here,
            // so an unknown entity cannot pass unexamined.
            Ok(Event::Text(_)) => {}

            Ok(Event::GeneralRef(e)) => {
                let name = String::from_utf8_lossy(e.as_ref()).into_owned();
                let predefined = matches!(name.as_str(), "amp" | "lt" | "gt" | "quot" | "apos")
                    || e.is_char_ref();
                if !predefined {
                    return Err(SvgRejection::Entity(name));
                }
            }

            Ok(Event::DocType(_)) => return Err(SvgRejection::Doctype),
            Ok(Event::PI(_)) | Ok(Event::Decl(_)) => {
                return Err(SvgRejection::ProcessingInstruction)
            }
            Ok(Event::Comment(_)) => return Err(SvgRejection::Comment),
            Ok(Event::CData(_)) => return Err(SvgRejection::CData),

            Err(err) => return Err(SvgRejection::Malformed(err.to_string())),
        }
    }
}

fn check_element(raw: &[u8]) -> Result<(), SvgRejection> {
    let name = String::from_utf8_lossy(raw).into_owned();
    if ALLOWED_ELEMENTS.contains(&name.as_str()) {
        Ok(())
    } else {
        Err(SvgRejection::Element(name))
    }
}

fn check_attribute_name(name: &str) -> Result<(), SvgRejection> {
    // Belt and braces: no allowed attribute begins with `on`, but say so
    // explicitly so the intent survives any future edit of the allowlist.
    if name.len() >= 2
        && name[..2].eq_ignore_ascii_case("on")
        && !ALLOWED_ATTRIBUTES.contains(&name)
    {
        return Err(SvgRejection::Attribute(name.to_string()));
    }
    if ALLOWED_ATTRIBUTES.contains(&name) {
        Ok(())
    } else {
        Err(SvgRejection::Attribute(name.to_string()))
    }
}

/// Reject a value carrying any forbidden token. Whitespace (including the
/// newlines and tabs browsers tolerate inside a URL scheme) is stripped before
/// comparison, so `java\nscript:` cannot evade the check.
pub fn check_value(attr: &str, value: &str) -> Result<(), SvgRejection> {
    let squashed: String = value
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '\0')
        .collect::<String>()
        .to_ascii_lowercase();
    for token in FORBIDDEN_VALUE_TOKENS {
        if squashed.contains(token) {
            return Err(SvgRejection::Value {
                attr: attr.to_string(),
                token: (*token).to_string(),
            });
        }
    }
    Ok(())
}

/// Decode a `data:image/svg+xml` URI and validate the SVG inside it.
///
/// Only that one media type is accepted: a theme asset is vector markup, and
/// admitting arbitrary media types (or an `http(s)://` URL) would reintroduce
/// exactly the remote-content problem this module exists to prevent.
pub fn validate_data_uri(uri: &str) -> Result<(), SvgRejection> {
    if uri.len() > MAX_SVG_BYTES {
        return Err(SvgRejection::TooLarge("asset size"));
    }
    let rest = uri
        .strip_prefix("data:")
        .or_else(|| uri.strip_prefix("DATA:"))
        .ok_or_else(|| SvgRejection::DataUri("only data: URIs are allowed".into()))?;

    let (meta, payload) = rest
        .split_once(',')
        .ok_or_else(|| SvgRejection::DataUri("missing payload separator".into()))?;

    let meta_lower = meta.to_ascii_lowercase();
    let mut parts = meta_lower.split(';');
    let media = parts.next().unwrap_or("");
    if media != "image/svg+xml" {
        return Err(SvgRejection::DataUri(format!(
            "media type `{media}` is not image/svg+xml"
        )));
    }
    let is_base64 = parts.clone().any(|p| p == "base64");

    let decoded = if is_base64 {
        use base64::Engine as _;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(payload.trim())
            .map_err(|e| SvgRejection::DataUri(format!("base64 decode failed: {e}")))?;
        String::from_utf8(bytes)
            .map_err(|_| SvgRejection::DataUri("payload is not valid UTF-8".into()))?
    } else {
        percent_encoding::percent_decode_str(payload)
            .decode_utf8()
            .map_err(|_| SvgRejection::DataUri("payload is not valid UTF-8".into()))?
            .into_owned()
    };

    validate_svg(&decoded)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every hostile input below must be refused outright — the assertion is
    /// deliberately "rejected", not "sanitised", because a partial strip is the
    /// failure mode this module is designed to avoid.
    fn assert_rejected(markup: &str) -> SvgRejection {
        match validate_svg(markup) {
            Ok(()) => panic!("expected rejection, got Ok for: {markup}"),
            Err(e) => e,
        }
    }

    #[test]
    fn accepts_a_hand_written_built_in_asset() {
        let svg = "<circle cx='13' cy='13' r='11' fill='currentColor' stroke='white' \
                   stroke-width='2.5'/>";
        assert_eq!(validate_svg(svg), Ok(()));
    }

    #[test]
    fn accepts_a_full_document_with_gradients_and_title() {
        let svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 26 26' width='26' \
                   height='26'><title>Node</title><defs><linearGradient id='g' \
                   gradientUnits='userSpaceOnUse' x1='0' y1='0' x2='1' y2='1'><stop offset='0' \
                   stop-color='#fff' stop-opacity='0.5'/></linearGradient></defs>\
                   <g transform='translate(1,1)'><path d='M0 0 L4 4 Z' fill='url' \
                   fill-rule='evenodd'/></g></svg>";
        assert_eq!(validate_svg(svg), Ok(()));
    }

    // ── Attack vectors ──────────────────────────────────────────────────────

    #[test]
    fn rejects_an_onload_event_attribute() {
        let r = assert_rejected("<svg xmlns='x' onload='alert(1)'><circle r='1'/></svg>");
        assert_eq!(r, SvgRejection::Attribute("onload".into()));
    }

    #[test]
    fn rejects_every_on_star_event_attribute() {
        for evt in [
            "onclick",
            "onerror",
            "onmouseover",
            "onfocus",
            "onbegin",
            "onanimationend",
        ] {
            let markup = format!("<circle r='1' {evt}='alert(1)'/>");
            assert_eq!(
                assert_rejected(&markup),
                SvgRejection::Attribute(evt.into()),
                "{evt} must be refused"
            );
        }
    }

    #[test]
    fn rejects_a_script_element() {
        assert_eq!(
            assert_rejected("<g><script>alert(1)</script></g>"),
            SvgRejection::Element("script".into())
        );
    }

    #[test]
    fn rejects_a_foreign_object() {
        assert_eq!(
            assert_rejected("<foreignObject><div>hi</div></foreignObject>"),
            SvgRejection::Element("foreignObject".into())
        );
    }

    #[test]
    fn rejects_style_elements_and_attributes() {
        assert_eq!(
            assert_rejected("<style>*{x:y}</style>"),
            SvgRejection::Element("style".into())
        );
        assert_eq!(
            assert_rejected("<circle r='1' style='fill:red'/>"),
            SvgRejection::Attribute("style".into())
        );
    }

    #[test]
    fn rejects_use_image_and_animation_elements() {
        for el in ["use", "image", "a", "animate", "animateTransform", "set"] {
            let markup = format!("<{el}/>");
            assert_eq!(
                assert_rejected(&markup),
                SvgRejection::Element(el.into()),
                "<{el}> must be refused"
            );
        }
    }

    #[test]
    fn rejects_external_href_and_xlink_href() {
        assert_eq!(
            assert_rejected("<path d='M0 0' href='https://evil.example/x.svg'/>"),
            SvgRejection::Attribute("href".into())
        );
        assert_eq!(
            assert_rejected("<path d='M0 0' xlink:href='https://evil.example/x.svg'/>"),
            SvgRejection::Attribute("xlink:href".into())
        );
    }

    #[test]
    fn rejects_a_javascript_scheme_inside_an_allowed_attribute() {
        assert_eq!(
            assert_rejected("<path d='M0 0' clip-path='javascript:alert(1)'/>"),
            SvgRejection::Value {
                attr: "clip-path".into(),
                token: "javascript:".into()
            }
        );
    }

    #[test]
    fn rejects_a_javascript_scheme_split_by_whitespace() {
        // Browsers ignore whitespace inside a scheme; so must the check.
        let r = assert_rejected("<path d='M0 0' fill='java\nscript:alert(1)'/>");
        assert_eq!(
            r,
            SvgRejection::Value {
                attr: "fill".into(),
                token: "javascript:".into()
            }
        );
    }

    #[test]
    fn rejects_a_nested_data_uri_in_a_value() {
        assert_eq!(
            assert_rejected("<path d='M0 0' fill='data:image/svg+xml,%3Cscript%3E'/>"),
            SvgRejection::Value {
                attr: "fill".into(),
                token: "data:".into()
            }
        );
    }

    #[test]
    fn rejects_a_css_url_function_in_a_value() {
        assert_eq!(
            assert_rejected("<rect width='1' height='1' fill='url(https://evil.example/x)'/>"),
            SvgRejection::Value {
                attr: "fill".into(),
                token: "url(".into()
            }
        );
    }

    #[test]
    fn rejects_a_doctype_and_an_entity_declaration() {
        // The XXE / billion-laughs surface.
        assert_eq!(
            assert_rejected("<!DOCTYPE svg><svg xmlns='x'/>"),
            SvgRejection::Doctype
        );
        assert_eq!(
            assert_rejected(
                "<!DOCTYPE svg [<!ENTITY xxe SYSTEM \"file:///etc/passwd\">]><svg xmlns='x'/>"
            ),
            SvgRejection::Doctype
        );
    }

    #[test]
    fn rejects_an_unknown_entity_reference() {
        assert!(matches!(
            assert_rejected("<title>&xxe;</title>"),
            SvgRejection::Entity(_) | SvgRejection::Malformed(_)
        ));
    }

    #[test]
    fn rejects_processing_instructions_and_comments() {
        assert_eq!(
            assert_rejected("<?xml-stylesheet href='x.css'?><circle r='1'/>"),
            SvgRejection::ProcessingInstruction
        );
        assert_eq!(
            assert_rejected("<!-- <script>alert(1)</script> --><circle r='1'/>"),
            SvgRejection::Comment
        );
    }

    #[test]
    fn rejects_a_cdata_section_hiding_markup() {
        assert_eq!(
            assert_rejected("<title><![CDATA[<script>alert(1)</script>]]></title>"),
            SvgRejection::CData
        );
    }

    #[test]
    fn rejects_malformed_and_unbalanced_markup() {
        assert!(matches!(
            assert_rejected("<g><circle r='1'/>"),
            SvgRejection::Malformed(_)
        ));
    }

    #[test]
    fn rejects_an_asset_over_the_size_ceiling() {
        let huge = format!("<circle r='1' id='{}'/>", "a".repeat(MAX_SVG_BYTES));
        assert_eq!(assert_rejected(&huge), SvgRejection::TooLarge("asset size"));
    }

    // ── data: URI assets ────────────────────────────────────────────────────

    #[test]
    fn accepts_a_percent_encoded_built_in_data_uri() {
        let uri = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='26' \
                   height='26'><circle cx='13' cy='13' r='11' fill='%232196f3' stroke='white' \
                   stroke-width='2.5'/></svg>";
        assert_eq!(validate_data_uri(uri), Ok(()));
    }

    #[test]
    fn accepts_a_base64_data_uri() {
        use base64::Engine as _;
        let inner = "<svg xmlns='http://www.w3.org/2000/svg'><circle r='2'/></svg>";
        let uri = format!(
            "data:image/svg+xml;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(inner)
        );
        assert_eq!(validate_data_uri(&uri), Ok(()));
    }

    #[test]
    fn rejects_a_data_uri_whose_decoded_svg_is_hostile() {
        // The percent-encoding hides the payload from a naive substring scan —
        // decoding before validating is the whole point.
        let uri = "data:image/svg+xml;utf8,%3Csvg%20onload%3D%22alert(1)%22%3E%3C/svg%3E";
        assert_eq!(
            validate_data_uri(uri),
            Err(SvgRejection::Attribute("onload".into()))
        );
    }

    #[test]
    fn rejects_a_base64_data_uri_hiding_a_script() {
        use base64::Engine as _;
        let uri = format!(
            "data:image/svg+xml;base64,{}",
            base64::engine::general_purpose::STANDARD
                .encode("<svg><script>alert(1)</script></svg>")
        );
        assert_eq!(
            validate_data_uri(&uri),
            Err(SvgRejection::Element("script".into()))
        );
    }

    #[test]
    fn rejects_a_non_svg_or_remote_asset_url() {
        assert!(matches!(
            validate_data_uri("https://evil.example/x.svg"),
            Err(SvgRejection::DataUri(_))
        ));
        assert!(matches!(
            validate_data_uri("data:text/html,<script>alert(1)</script>"),
            Err(SvgRejection::DataUri(_))
        ));
        assert!(matches!(
            validate_data_uri("data:image/svg+xml"),
            Err(SvgRejection::DataUri(_))
        ));
    }

}
