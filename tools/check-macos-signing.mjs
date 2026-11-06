#!/usr/bin/env node
/**
 * Verify that a built macOS bundle is signed, hardened and notarized.
 *
 * **Why this is a script and not a config change.** Tauri v2 already defaults
 * `bundle.macOS.hardenedRuntime` to `true`, and leaving `signingIdentity`
 * unset already makes it read `APPLE_SIGNING_IDENTITY` from the environment —
 * so there is no configuration missing. What is missing is a *failure*: with
 * no certificate and no env vars, `tauri build` happily produces an unsigned
 * `.app` and says nothing. An unsigned build is not a cosmetic problem on
 * macOS — a keychain item's ACL is bound to the signing identity of the binary
 * that created it, so every update of an unsigned (or ad-hoc signed) app is a
 * different app to the OS, and every user gets re-prompted for their own
 * stored credentials. This script is the thing that notices.
 *
 *     node tools/check-macos-signing.mjs [path/to/App.app]
 *
 * With no argument it looks for the release bundle Tauri produces. Exits
 * non-zero on any failed check, so it can gate a release step.
 *
 * Dependency-free, same house style as `tools/i18n-lint.mjs`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE_DIR = join(
  ROOT,
  "apps/desktop/src-tauri/target/release/bundle/macos",
);

/**
 * Run a command, returning `{ ok, out }` with **stdout and stderr merged**.
 *
 * The merge is load-bearing, not tidiness: `codesign -dv` prints its entire
 * report (`Authority=`, `CodeDirectory ... flags=`) to stderr and still exits
 * 0, and `spctl` does the same. Reading only stdout returns an empty string
 * from a perfectly good signature, so every check silently "fails" on a
 * correctly signed app.
 */
function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return { ok: r.status === 0, out };
}

/** The `.app` to inspect: an explicit argument, else the release bundle. */
function resolveApp() {
  const explicit = process.argv[2];
  if (explicit) {
    if (!existsSync(explicit)) fail(`no such bundle: ${explicit}`);
    return explicit;
  }
  if (!existsSync(BUNDLE_DIR))
    fail(
      `no release bundle found at ${BUNDLE_DIR}\n` +
        `Build one first (\`pnpm tauri build\`), or pass a path.`,
    );
  const apps = readdirSync(BUNDLE_DIR).filter((f) => f.endsWith(".app"));
  if (apps.length !== 1)
    fail(`expected exactly one .app in ${BUNDLE_DIR}, found ${apps.length}`);
  return join(BUNDLE_DIR, apps[0]);
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const results = [];
/**
 * Record one check. `hint` is printed only on failure.
 *
 * `severity: "warn"` reports without failing the run — for findings that are
 * real but do not affect what this script exists to protect.
 */
function check(name, passed, detail, hint, severity = "error") {
  results.push({ name, passed, detail, hint, severity });
}

if (process.platform !== "darwin") {
  console.log("– not macOS; nothing to verify here.");
  process.exit(0);
}

const app = resolveApp();
console.log(`Inspecting ${app}\n`);

// 1. Signed at all, and by a Developer ID rather than ad-hoc.
//    An ad-hoc signature ("Signature=adhoc") is what an unconfigured
//    `tauri build` produces: it satisfies "is signed" but carries no stable
//    identity, which is precisely what the keychain ACL needs.
const desc = run("codesign", ["-dv", "--verbose=4", app]);
const authority = /^Authority=(.+)$/m.exec(desc.out)?.[1] ?? null;
check(
  "signed with a Developer ID",
  Boolean(authority?.startsWith("Developer ID Application:")),
  authority ? `Authority=${authority}` : "no Authority line (unsigned/ad-hoc)",
  "Set APPLE_SIGNING_IDENTITY (or bundle.macOS.signingIdentity) to your Developer ID Application certificate.",
);

// 2. Hardened runtime. Required for notarization; Tauri defaults it on, so a
//    miss here means someone turned it off.
check(
  "hardened runtime enabled",
  /flags=.*runtime/.test(desc.out),
  /^CodeDirectory .*flags=\S+/m.exec(desc.out)?.[0] ?? "no flags reported",
  "bundle.macOS.hardenedRuntime must stay true.",
);

// 3. The signature actually verifies over the whole bundle.
const verify = run("codesign", ["--verify", "--deep", "--strict", app]);
check(
  "signature verifies",
  verify.ok,
  verify.ok ? "ok" : verify.out.trim(),
  "The bundle was modified after signing, or a nested binary is unsigned.",
);

// 4. Notarization ticket stapled. A WARNING, not a failure: stapling only
//    decides whether a machine that has never seen this build can verify it
//    OFFLINE. Gatekeeper (check 5) is the real verdict, and the keychain ACL
//    this script exists to protect does not care either way. Worth reporting
//    because an unstapled build gives a first-launch spinner on a flaky
//    connection — but it is not a reason to block a release.
const staple = run("xcrun", ["stapler", "validate", app]);
check(
  "notarization ticket stapled",
  staple.ok,
  staple.ok ? "ok" : staple.out.trim().split("\n").pop(),
  "Staple after notarizing (`xcrun stapler staple`) so first launch works offline.",
  "warn",
);

// 5. Gatekeeper's own verdict, which is the question a user's Mac asks.
const spctl = run("spctl", ["-a", "-vvv", "-t", "install", app]);
check(
  "Gatekeeper accepts it",
  spctl.ok && /accepted/.test(spctl.out),
  spctl.out.trim().split("\n").slice(0, 2).join(" · "),
  "Follows from 1 + 4; fix those first.",
);

let failed = 0;
let warned = 0;
for (const r of results) {
  const mark = r.passed ? "✓" : r.severity === "warn" ? "!" : "✗";
  console.log(`${mark} ${r.name}\n    ${r.detail}`);
  if (!r.passed) {
    if (r.severity === "warn") warned += 1;
    else failed += 1;
    if (r.hint) console.log(`    → ${r.hint}`);
  }
}

console.log();
if (failed) {
  console.error(
    `${failed} of ${results.length} checks failed. This build must not ship:\n` +
      `users would be re-prompted for their own keychain items on every update.`,
  );
  process.exit(1);
}
console.log(
  `Signing checks passed${warned ? ` (${warned} warning${warned > 1 ? "s" : ""})` : ""}.`,
);
