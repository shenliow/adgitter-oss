import { describe, it, expect } from "vitest";
import { LocalTokenClient, type NewTokenRequest } from "./tokens";

const req: NewTokenRequest = {
  name: "  release bot  ",
  provider: "slack",
  scopes: ["send_notification", "commit"],
};

describe("LocalTokenClient — reveal-once", () => {
  it("returns the plaintext exactly once on create, never on list", async () => {
    const c = new LocalTokenClient();
    const created = await c.create(req);

    // The one-time reveal carries a non-empty, provider-prefixed secret.
    expect(created.plaintext).toMatch(/^adg_slack_/);
    expect(created.name).toBe("release bot"); // trimmed
    expect(created.scopes).toEqual(["send_notification", "commit"]);
    expect(created.webhookUrl).toContain(created.id);

    // Every subsequent read is metadata-only — the plaintext must be gone.
    const listed = await c.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(created.id);
    expect("plaintext" in listed[0]).toBe(false);
  });

  it("regenerate rotates to a fresh one-time secret and keeps identity/scopes", async () => {
    const c = new LocalTokenClient();
    const first = await c.create(req);
    const rotated = await c.regenerate(first.id);

    expect(rotated.id).toBe(first.id);
    expect(rotated.scopes).toEqual(first.scopes);
    expect(rotated.plaintext).not.toBe(first.plaintext);

    const listed = await c.list();
    expect(listed).toHaveLength(1); // rotated in place, not duplicated
    expect("plaintext" in listed[0]).toBe(false);
  });

  it("revoke removes the token from the list", async () => {
    const c = new LocalTokenClient();
    const a = await c.create(req);
    await c.create({ ...req, name: "second" });
    await c.revoke(a.id);

    const listed = await c.list();
    expect(listed).toHaveLength(1);
    expect(listed.find((t) => t.id === a.id)).toBeUndefined();
  });

  it("lists newest-first", async () => {
    const c = new LocalTokenClient();
    const a = await c.create({ ...req, name: "a" });
    // Ensure a strictly-later createdAt for deterministic ordering.
    await new Promise((r) => setTimeout(r, 2));
    const b = await c.create({ ...req, name: "b" });

    const listed = await c.list();
    expect(listed.map((t) => t.id)).toEqual([b.id, a.id]);
  });
});
