//! Generate a **production** Ed25519 keypair for license signing.
//!
//! Run from the repo root:
//!
//!   cargo run -p license --features mint --example keygen
//!
//! Prints standard-base64 of the raw 32-byte private (signing) and public
//! (verifying) keys — the exact format both ends decode (`api::decode_signing_key`
//! and the desktop `build.rs` `LICENSE_PUBLIC_KEY`). The two are ONE keypair:
//!
//!   - private → server secret:  fly secrets set LICENSE_SIGNING_KEY=<private>
//!   - public  → desktop build:   LICENSE_PUBLIC_KEY=<public>  (baked by build.rs)
//!
//! SECURITY: the private key signs every license — treat it like a root secret.
//! Set it ONLY via `fly secrets set` (never commit it, never paste it into logs
//! or chat). The public key is safe to embed and distribute.

use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::SigningKey;
use rand::rngs::OsRng;

fn main() {
    let signing = SigningKey::generate(&mut OsRng);
    let private_b64 = STANDARD.encode(signing.to_bytes());
    let public_b64 = STANDARD.encode(signing.verifying_key().to_bytes());

    println!("# Ed25519 license keypair — standard-base64 of the raw 32-byte keys.");
    println!("# These two belong together; never mix keys from separate runs.");
    println!();
    println!("# --- SERVER (Fly secret; NEVER commit) ---");
    println!("LICENSE_SIGNING_KEY={private_b64}");
    println!();
    println!("# --- DESKTOP (build env; safe to embed/distribute) ---");
    println!("LICENSE_PUBLIC_KEY={public_b64}");
}
