import { describe, it, expect, beforeEach } from "vitest";
import { localizedError } from "./errors";
import { setLocale } from "./index.svelte";
import { catalogs, en } from "./messages";

beforeEach(() => setLocale("en"));

describe("localizedError", () => {
  it("maps a known code to a localized category + detail", () => {
    expect(localizedError({ code: "REPO_NOT_FOUND", message: "/x" })).toBe(
      "Repository not found: /x",
    );
    setLocale("zh-Hant");
    expect(localizedError({ code: "REPO_NOT_FOUND", message: "/x" })).toBe(
      "找不到儲存庫: /x",
    );
  });

  it("uses the category alone when there is no detail", () => {
    expect(localizedError({ code: "GIT_ERROR", message: "" })).toBe(
      "Git error",
    );
  });

  it("stringifies non-AdgitterError values", () => {
    expect(localizedError("boom")).toBe("boom");
  });

  it("names the conflicting commit by its short sha, not the raw backend detail", () => {
    const sha = "abcdef1234567890abcdef1234567890abcdef12";
    expect(
      localizedError({ code: "CONFLICT", message: "conflict applying …", sha }),
    ).toBe(
      "abcdef1 conflicts with the target — resolve it manually or undo the operation.",
    );
    setLocale("zh-Hant");
    expect(
      localizedError({ code: "CONFLICT", message: "conflict applying …", sha }),
    ).toBe("abcdef1 與目標衝突，請手動解決或復原此操作。");
  });

  it("localizes a merge-commit-in-range refusal instead of leaking libgit2's wording", () => {
    // The backend refuses to replay a range containing a merge (e.g. rewording
    // a commit only reachable across one) with its own code; the UI must show
    // a category for it rather than falling through to "Something went wrong".
    const e = {
      code: "MERGE_COMMIT_IN_RANGE" as const,
      message: "cannot rewrite history across merge commit abc123",
      sha: "abc123",
    };
    expect(localizedError(e)).toBe(
      "Can't rewrite across a merge commit: cannot rewrite history across merge commit abc123",
    );
    setLocale("ja");
    expect(localizedError(e)).toContain("マージコミット");
  });

  it("falls back to the generic category when a CONFLICT error carries no sha", () => {
    expect(localizedError({ code: "CONFLICT", message: "boom" })).toBe(
      "Conflict: boom",
    );
  });

  // ── Licence refusals that are not "go buy it" ────────────────────────────
  //
  // The entitlement gate is device-bound, so a refusal now also lands on a
  // paying user who reinstalled or changed machine. If that read as "this
  // feature needs a paid plan" the binding fix would cost real customers.

  it("tells a wrong-device user to sign in again, never to buy a plan", () => {
    const e = {
      code: "LICENSE_DEVICE_MISMATCH" as const,
      message: "this license is registered to another device",
    };
    const en = localizedError(e);
    expect(en).toBe(
      "This licence is registered to another device — sign in again to use it on this one",
    );
    expect(en).not.toContain("paid plan");
    // The instruction is complete on its own — the backend's untranslated
    // restatement must not be appended to it.
    expect(en).not.toContain(e.message);

    setLocale("zh-Hant");
    expect(localizedError(e)).toBe(
      "這張授權屬於另一台裝置——重新登入即可綁定這一台",
    );
  });

  it("tells an expired-licence user to renew, not to upgrade", () => {
    const e = {
      code: "LICENSE_EXPIRED" as const,
      message: "this license has expired",
    };
    const en = localizedError(e);
    expect(en).toBe(
      "Your licence has expired — renew it to keep using paid features",
    );
    expect(en).not.toContain(e.message);

    setLocale("ja");
    expect(localizedError(e)).toContain("有効期限");
  });

  it("keeps FEATURE_LOCKED meaning only 'your tier does not include this'", () => {
    expect(
      localizedError({
        code: "FEATURE_LOCKED",
        message: "license does not include the required feature",
      }),
    ).toBe(
      "This feature needs a paid plan: license does not include the required feature",
    );
  });
});

// ── Catalog coverage for error codes ───────────────────────────────────────
//
// `localizedError` looks up `error.<CODE>`; a key missing from a catalog falls
// back silently to the en source, so an untranslated code ships English to
// seven locales without failing anything. Adding LICENSE_DEVICE_MISMATCH and
// LICENSE_EXPIRED is exactly the kind of change that leaves such a hole, so
// the invariant is pinned for *every* code rather than just the two new ones.
describe("every error code is translated in every catalog", () => {
  const codes = (Object.keys(en) as string[])
    .filter((k) => k.startsWith("error."))
    // `error.conflict` is the sha-parameterized variant, not a code.
    .filter((k) => k !== "error.conflict")
    .map((k) => k.slice("error.".length));

  it("covers the codes this fix added (guards the filter above)", () => {
    expect(codes).toContain("LICENSE_DEVICE_MISMATCH");
    expect(codes).toContain("LICENSE_EXPIRED");
    expect(codes).toContain("FEATURE_LOCKED");
  });

  for (const [loc, catalog] of Object.entries(catalogs)) {
    it(`${loc} carries all ${codes.length} error.* keys`, () => {
      const missing = codes.filter(
        (c) => !(catalog as Record<string, string>)[`error.${c}`],
      );
      expect(missing, `${loc} is missing: ${missing.join(", ")}`).toEqual([]);
    });
  }

  // Present-but-identical-to-en would pass the check above while still being
  // untranslated, so the two new strings are additionally checked for content.
  for (const code of ["LICENSE_DEVICE_MISMATCH", "LICENSE_EXPIRED"] as const) {
    it(`error.${code} is really translated, not copied from en`, () => {
      const source = en[`error.${code}`];
      for (const [loc, catalog] of Object.entries(catalogs)) {
        if (loc === "en") continue;
        expect(
          (catalog as Record<string, string>)[`error.${code}`],
          `${loc} copied the en string for error.${code}`,
        ).not.toBe(source);
      }
    });
  }
});
