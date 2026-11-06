# License test fixtures

`test_keypair.json` holds an Ed25519 keypair used **only** for development and
tests of the entitlement-from-license pipeline.

**TEST ONLY — not a secret, never used in production.**

- `signing_key` / `verifying_key` are standard-base64 of the 32-byte raw keys.
- The signing key is exposed in the `license` crate behind the `mint` cargo
  feature (`license::test_keys`) so the desktop app's debug-only
  `mint_test_license` command can sign dev tokens.
- The verifying key is the **debug-build fallback** for `verify_license`. In
  release builds the public key must come from the baked-in `LICENSE_PUBLIC_KEY`
  (see `apps/desktop/src-tauri/build.rs`); an absent key in release is treated as
  `Invalid` (inert), so this test key can never validate a real license in a
  shipped binary.

The production signing key is created by the cloud signing service (not yet
built) and must never be committed or embedded in the binary.
