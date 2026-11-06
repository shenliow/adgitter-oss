import { describe, it, expect } from "vitest";
import { AuthError, RecordingTransport } from "../http/transport";
import { providerClient } from "./providers";

describe("provider MR/Issue clients", () => {
  it("GitHub createIssue → POST /issues with Bearer auth + normalized ref", async () => {
    const rec = new RecordingTransport(() => ({
      status: 201,
      body: { number: 7, id: 100, html_url: "https://github.com/o/r/issues/7" },
    }));
    const client = providerClient("github", "ghp_secret", rec);

    const ref = await client.createIssue({ title: "Bug", body: "boom" });

    expect(rec.sent).toHaveLength(1);
    const req = rec.sent[0];
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/issues");
    expect(req.body).toEqual({ title: "Bug", body: "boom" });
    // Auth header derived from the token (SC — token-scoped call).
    expect(req.headers?.Authorization).toBe("Bearer ghp_secret");
    expect(ref).toEqual({
      url: "https://github.com/o/r/issues/7",
      id: "100",
      number: 7,
    });
  });

  it("GitLab createMergeRequest → POST /merge_requests with PRIVATE-TOKEN + iid", async () => {
    const rec = new RecordingTransport(() => ({
      status: 201,
      body: {
        iid: 3,
        id: 555,
        web_url: "https://gitlab.com/o/r/-/merge_requests/3",
      },
    }));
    const client = providerClient("gitlab", "glpat_secret", rec);

    const ref = await client.createMergeRequest({
      title: "Feature",
      sourceBranch: "feat/x",
      targetBranch: "main",
      body: "please review",
    });

    const req = rec.sent[0];
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/merge_requests");
    expect(req.body).toEqual({
      title: "Feature",
      source_branch: "feat/x",
      target_branch: "main",
      description: "please review",
    });
    expect(req.headers?.["PRIVATE-TOKEN"]).toBe("glpat_secret");
    // GitLab's human-facing number is the `iid`, not the global `id`.
    expect(ref.number).toBe(3);
    expect(ref.id).toBe("555");
    expect(ref.url).toBe("https://gitlab.com/o/r/-/merge_requests/3");
  });

  it("GitHub createMergeRequest → POST /pulls with head/base", async () => {
    const rec = new RecordingTransport(() => ({
      status: 201,
      body: { number: 12, id: 9, html_url: "u" },
    }));
    const client = providerClient("github", "t", rec);
    await client.createMergeRequest({
      title: "PR",
      sourceBranch: "topic",
      targetBranch: "main",
    });
    expect(rec.sent[0].path).toBe("/pulls");
    expect(rec.sent[0].body).toEqual({
      title: "PR",
      head: "topic",
      base: "main",
      body: "",
    });
  });

  it("surfaces a 401 as a typed AuthError (error path via classifyError)", async () => {
    const rec = new RecordingTransport(() => ({ status: 401, body: {} }));
    const client = providerClient("github", "bad", rec);
    await expect(client.createIssue({ title: "x" })).rejects.toBeInstanceOf(
      AuthError,
    );
  });
});
