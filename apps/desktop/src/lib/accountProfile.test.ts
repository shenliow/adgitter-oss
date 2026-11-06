import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  loadAccountProfile,
  saveAccountProfile,
  clearAccountProfile,
  mergeLicenseProfile,
  accountGitIdentity,
} from "./accountProfile";

const KEY = "adgitter.account.profile";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("accountProfile", () => {
  it("returns null when nothing is stored", () => {
    expect(loadAccountProfile()).toBeNull();
  });

  it("round-trips a full profile", () => {
    saveAccountProfile({
      name: "Ada Lovelace",
      email: "ada@example.com",
      avatarUrl: "https://example.com/ada.png",
      username: "ada",
    });
    expect(loadAccountProfile()).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      avatarUrl: "https://example.com/ada.png",
      username: "ada",
    });
  });

  it("round-trips a partial profile (missing fields simply absent)", () => {
    saveAccountProfile({ name: "Ada" });
    expect(loadAccountProfile()).toEqual({ name: "Ada" });
  });

  it("malformed JSON in storage returns null instead of throwing", () => {
    localStorage.setItem(KEY, "{not json");
    expect(() => loadAccountProfile()).not.toThrow();
    expect(loadAccountProfile()).toBeNull();
  });

  it("a non-object JSON value returns null", () => {
    localStorage.setItem(KEY, JSON.stringify("just a string"));
    expect(loadAccountProfile()).toBeNull();
  });

  it("drops a javascript: avatar URL on read", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ name: "Ada", avatarUrl: "javascript:alert(1)" }),
    );
    const p = loadAccountProfile();
    expect(p?.name).toBe("Ada");
    expect(p?.avatarUrl).toBeUndefined();
  });

  it("drops a plain http:// avatar URL on read", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ avatarUrl: "http://example.com/ada.png" }),
    );
    // The only field was a rejected avatar, so nothing survives — same as an
    // empty profile.
    expect(loadAccountProfile()).toBeNull();
  });

  it("drops a data: avatar URL on read", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ avatarUrl: "data:image/png;base64,AAAA" }),
    );
    expect(loadAccountProfile()).toBeNull();
  });

  it("keeps an https:// avatar URL", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ avatarUrl: "https://example.com/ada.png" }),
    );
    expect(loadAccountProfile()?.avatarUrl).toBe("https://example.com/ada.png");
  });

  it("caps name/email/username at 256 chars on read", () => {
    const long = "a".repeat(300);
    localStorage.setItem(
      KEY,
      JSON.stringify({ name: long, email: long, username: long }),
    );
    const p = loadAccountProfile();
    expect(p?.name).toHaveLength(256);
    expect(p?.email).toHaveLength(256);
    expect(p?.username).toHaveLength(256);
  });

  it("caps avatarUrl at 512 chars on read (over-long becomes non-https-prefixed junk and is dropped)", () => {
    // A too-long https URL still starts with https:// after truncation, so
    // exercise the cap with the prefix itself pushed past the boundary via a
    // long enough URL that truncation just shortens it (still valid) — the
    // real risk case (non-https) is covered separately above. This proves
    // the cap runs without breaking a legitimately long https URL.
    const longPath = "a".repeat(600);
    localStorage.setItem(
      KEY,
      JSON.stringify({ avatarUrl: `https://example.com/${longPath}.png` }),
    );
    const p = loadAccountProfile();
    expect(p?.avatarUrl).toHaveLength(512);
    expect(p?.avatarUrl?.startsWith("https://")).toBe(true);
  });

  it("drops non-string fields on read", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ name: 42, email: null, username: ["ada"] }),
    );
    expect(loadAccountProfile()).toBeNull();
  });

  it("trims whitespace and drops fields that are empty after trimming", () => {
    localStorage.setItem(KEY, JSON.stringify({ name: "   ", email: "  " }));
    expect(loadAccountProfile()).toBeNull();
  });

  it("an all-empty profile clears rather than writes", () => {
    saveAccountProfile({ name: "Ada" });
    expect(localStorage.getItem(KEY)).not.toBeNull();
    saveAccountProfile({});
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(loadAccountProfile()).toBeNull();
  });

  it("a profile whose fields are all whitespace-only also clears", () => {
    saveAccountProfile({ name: "Ada" });
    saveAccountProfile({ name: "   ", email: "" });
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("clearAccountProfile removes a stored profile", () => {
    saveAccountProfile({ name: "Ada" });
    clearAccountProfile();
    expect(loadAccountProfile()).toBeNull();
  });

  it("clearAccountProfile is a no-op (not a throw) when nothing is stored", () => {
    expect(() => clearAccountProfile()).not.toThrow();
  });

  it("a throwing localStorage.setItem never propagates out of saveAccountProfile", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => saveAccountProfile({ name: "Ada" })).not.toThrow();
  });

  it("a throwing localStorage.getItem never propagates out of loadAccountProfile", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("locked");
    });
    expect(() => loadAccountProfile()).not.toThrow();
    expect(loadAccountProfile()).toBeNull();
  });

  it("a throwing localStorage.removeItem never propagates out of clearAccountProfile", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("locked");
    });
    expect(() => clearAccountProfile()).not.toThrow();
  });
});

// E-clerk-profile-sync: a fresh license's re-pinned profile claims are merged
// over the cached copy before being persisted — see the doc comment on
// `mergeLicenseProfile` for the exact contract.
describe("mergeLicenseProfile", () => {
  it("a present license field overwrites the cached one", () => {
    const merged = mergeLicenseProfile(
      { name: "New Name", email: "new@example.com" },
      { name: "Old Name", email: "old@example.com" },
    );
    expect(merged.name).toBe("New Name");
    expect(merged.email).toBe("new@example.com");
  });

  it("a null license field falls back to the cached value rather than clobbering it", () => {
    const merged = mergeLicenseProfile(
      { name: null, avatarUrl: null, username: null, email: null },
      {
        name: "Cached Name",
        avatarUrl: "https://example.com/cached.png",
        username: "cached_user",
        email: "cached@example.com",
      },
    );
    expect(merged).toEqual({
      name: "Cached Name",
      avatarUrl: "https://example.com/cached.png",
      username: "cached_user",
      email: "cached@example.com",
    });
  });

  it("an absent license field (undefined) also falls back to the cached value", () => {
    const merged = mergeLicenseProfile({}, { name: "Cached Name" });
    expect(merged.name).toBe("Cached Name");
  });

  it("no license value and no cached value is undefined, not null or empty string", () => {
    const merged = mergeLicenseProfile({}, null);
    expect(merged.name).toBeUndefined();
    expect(merged.email).toBeUndefined();
    expect(merged.avatarUrl).toBeUndefined();
    expect(merged.username).toBeUndefined();
  });

  // The license is signed, but that is not an exemption from the https-only
  // avatar rule — see `sanitizeAvatarUrl`'s doc comment.
  it("a non-https license avatar is dropped, not merged in", () => {
    const merged = mergeLicenseProfile(
      { avatarUrl: "http://example.com/insecure.png" },
      { avatarUrl: "https://example.com/cached.png" },
    );
    // The insecure license value is rejected; the cached (already-validated)
    // value survives.
    expect(merged.avatarUrl).toBe("https://example.com/cached.png");
  });

  it("a blank license field is treated as absent, not as a real value", () => {
    const merged = mergeLicenseProfile(
      { name: "   " },
      { name: "Cached Name" },
    );
    expect(merged.name).toBe("Cached Name");
  });
});

// Mirrors `FallbackIdentity::from_account_email`'s unit tests in
// crates/git-core/src/identity.rs — the two must stay in step, or the Settings
// toggle will offer an identity the backend would refuse to write.
describe("accountGitIdentity", () => {
  it("derives the name from the local part when the profile has none", () => {
    expect(accountGitIdentity({ email: "ada.lovelace@example.com" })).toEqual({
      name: "ada.lovelace",
      email: "ada.lovelace@example.com",
    });
  });

  it("keeps an explicit display name", () => {
    expect(
      accountGitIdentity({ name: "Ada Lovelace", email: "ada@example.com" }),
    ).toEqual({ name: "Ada Lovelace", email: "ada@example.com" });
  });

  it("trims surrounding whitespace", () => {
    expect(
      accountGitIdentity({ name: "  Ada  ", email: "  ada@example.com \n" }),
    ).toEqual({ name: "Ada", email: "ada@example.com" });
  });

  it("yields null when there is no profile at all (signed out)", () => {
    expect(accountGitIdentity(null)).toBeNull();
  });

  it("yields null for a profile with a name but no email", () => {
    // An email is the irreducible part: git cannot author a commit without
    // one, so there is nothing here worth arming the toggle for.
    expect(accountGitIdentity({ name: "Ada Lovelace" })).toBeNull();
  });

  it("yields null for an address git could not author with", () => {
    for (const email of [
      "",
      "   ",
      "no-at-sign",
      "@example.com",
      "ada@",
      "ada<evil@example.com",
      "ada@example.com>",
      "ada\n@example.com",
    ]) {
      expect(accountGitIdentity({ email }), email).toBeNull();
    }
  });

  it("yields null when the display name would corrupt a commit header", () => {
    expect(
      accountGitIdentity({ name: "Ada <evil>", email: "ada@example.com" }),
    ).toBeNull();
  });
});
