import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "ping") return "pong";
    if (cmd === "list_commits") {
      return {
        commits: [
          {
            sha: "a".repeat(40),
            short_sha: "aaaaaaa",
            author_name: "Test",
            author_email: "t@example.com",
            timestamp: 1700000000,
            subject: "feat: hi",
            body: "",
            parents: [],
          },
        ],
        truncated: false,
        limit: 50,
      };
    }
    if (cmd === "repo_status")
      return {
        staged: [{ path: "s.ts", status: "new", old_path: null }],
        changed: [{ path: "c.ts", status: "modified", old_path: null }],
        untracked: [],
        ignored: [],
      };
    if (
      cmd === "stage_paths" ||
      cmd === "unstage_paths" ||
      cmd === "discard_paths"
    )
      return undefined;
    if (cmd === "create_commit") return "c".repeat(40);
    if (cmd === "inspect_remote_checkout")
      return { case: "createLocal", suggestedLocal: "feature" };
    if (
      [
        "create_branch",
        "rename_branch",
        "delete_branch",
        "checkout",
        "checkout_remote_branch",
        "adopt_remote_upstream_and_checkout",
        "create_tag",
        "delete_tag",
      ].includes(cmd)
    )
      return undefined;
    if (cmd === "probe_path") return { kind: "repo", path: "/r" };
    if (cmd === "init_repository" || cmd === "clone_repository")
      return undefined;
    if (cmd === "ahead_behind")
      return { ahead: 1, behind: 2, upstream: "origin/main" };
    if (
      cmd === "fetch" ||
      cmd === "pull" ||
      cmd === "push" ||
      cmd === "push_branch"
    )
      return undefined;
    if (cmd === "log_commit") return "f".repeat(40);
    if (cmd === "tutorial_demo_create")
      return {
        repoPath: "/data/tutorial/demo-1/repo",
        remotePath: "/data/tutorial/demo-1/origin.git",
      };
    if (cmd === "tutorial_demo_seed_files")
      return ["src/app.js", "src/style.css", "docs/notes.md"];
    if (cmd === "tutorial_demo_simulate_log")
      return ["1".repeat(40), "2".repeat(40), "3".repeat(40)];
    if (
      cmd === "tutorial_demo_seed_history" ||
      cmd === "tutorial_demo_write_file" ||
      cmd === "tutorial_demo_remove"
    )
      return undefined;
    if (cmd === "init_crash_reporting") return true;
    if (cmd === "report_event") return undefined;
    if (cmd === "verify_license")
      return {
        status: "active",
        plan: "advance",
        error: null,
        expiresMs: 9999999999999,
      };
    if (cmd === "mint_test_license") return "payloadb64.sigb64";
    if (cmd === "issue_license" || cmd === "renew_license")
      return {
        status: "active",
        plan: "advance",
        error: null,
        expiresMs: 123,
      };
    if (cmd === "clerk_portal_capabilities")
      return {
        userProfileUrl: "https://discrete-ibex-7.accounts.dev/user",
        organizationProfileUrl: null,
        organizationsEnabled: false,
        mfaEnabled: false,
      };
    if (cmd === "open_external_url") return undefined;
    if (cmd === "diff_file" || cmd === "diff_worktree")
      return {
        path: "a.txt",
        old_path: null,
        status: "modified",
        binary: false,
        hunks: [
          {
            old_start: 1,
            old_lines: 1,
            new_start: 1,
            new_lines: 1,
            header: "@@ -1 +1 @@",
            lines: [
              { origin: "-", old_lineno: 1, new_lineno: null, content: "a\n" },
              { origin: "+", old_lineno: null, new_lineno: 1, content: "A\n" },
            ],
          },
        ],
      };
    throw { code: "INTERNAL_ERROR", message: `unknown cmd ${cmd}` };
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

// onCloneProgress listens window-scoped (multi-window: each window watches
// its own clone) via getCurrentWindow().listen.
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    listen: vi.fn(async () => () => {}),
  }),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  listCommits,
  ping,
  isAdgitterError,
  errorText,
  repoStatus,
  stagePaths,
  createCommit,
  createBranch,
  checkout,
  checkoutRemoteBranch,
  inspectRemoteCheckout,
  adoptRemoteUpstreamAndCheckout,
  createTag,
  diffFile,
  diffWorktree,
  probePath,
  initRepository,
  cloneRepository,
  aheadBehind,
  pull,
  push,
  pushBranch,
  logCommit,
  tutorialDemoCreate,
  tutorialDemoSeedFiles,
  tutorialDemoSeedHistory,
  tutorialDemoWriteFile,
  tutorialDemoSimulateLog,
  tutorialDemoRemove,
  initCrashReporting,
  reportEvent,
  verifyLicense,
  mintTestLicense,
  issueLicense,
  renewLicense,
  openExternalUrl,
  clerkPortalCapabilities,
} from "./ipc";

beforeEach(() => {
  (invoke as ReturnType<typeof vi.fn>).mockClear();
});

describe("ipc client", () => {
  it("ping returns pong", async () => {
    expect(await ping()).toBe("pong");
  });

  it("listCommits passes camelCase args and returns a CommitPage", async () => {
    const res = await listCommits("/tmp/foo", 50);
    expect(invoke).toHaveBeenCalledWith("list_commits", {
      repoPath: "/tmp/foo",
      limit: 50,
    });
    expect(res.commits).toHaveLength(1);
    expect(res.truncated).toBe(false);
    expect(res.commits[0].subject).toBe("feat: hi");
  });

  it("repoStatus returns grouped working-tree status", async () => {
    const st = await repoStatus("/tmp/foo");
    expect(invoke).toHaveBeenCalledWith("repo_status", {
      repoPath: "/tmp/foo",
    });
    expect(st.staged[0].path).toBe("s.ts");
    expect(st.changed[0].status).toBe("modified");
  });

  it("stagePaths passes repoPath + paths", async () => {
    await stagePaths("/tmp/foo", ["a.ts", "b.ts"]);
    expect(invoke).toHaveBeenCalledWith("stage_paths", {
      repoPath: "/tmp/foo",
      paths: ["a.ts", "b.ts"],
    });
  });

  it("createCommit passes message + amend and returns the sha", async () => {
    const sha = await createCommit("/tmp/foo", "feat: x");
    expect(invoke).toHaveBeenCalledWith("create_commit", {
      repoPath: "/tmp/foo",
      message: "feat: x",
      amend: false,
    });
    expect(sha).toHaveLength(40);
  });

  it("createBranch passes name + from", async () => {
    await createBranch("/r", "feature", "HEAD");
    expect(invoke).toHaveBeenCalledWith("create_branch", {
      repoPath: "/r",
      name: "feature",
      from: "HEAD",
    });
  });

  it("checkout passes the target", async () => {
    await checkout("/r", "main");
    expect(invoke).toHaveBeenCalledWith("checkout", {
      repoPath: "/r",
      target: "main",
    });
  });

  it("checkoutRemoteBranch passes remoteName + localName", async () => {
    await checkoutRemoteBranch("/r", "origin/feature", "feature");
    expect(invoke).toHaveBeenCalledWith("checkout_remote_branch", {
      repoPath: "/r",
      remoteName: "origin/feature",
      localName: "feature",
    });
  });

  it("inspectRemoteCheckout passes remoteName + localName and returns the plan", async () => {
    const plan = await inspectRemoteCheckout("/r", "origin/feature", "feature");
    expect(invoke).toHaveBeenCalledWith("inspect_remote_checkout", {
      repoPath: "/r",
      remoteName: "origin/feature",
      localName: "feature",
    });
    expect(plan).toEqual({ case: "createLocal", suggestedLocal: "feature" });
  });

  it("adoptRemoteUpstreamAndCheckout passes remoteName + localName", async () => {
    await adoptRemoteUpstreamAndCheckout("/r", "origin/feature", "feature");
    expect(invoke).toHaveBeenCalledWith("adopt_remote_upstream_and_checkout", {
      repoPath: "/r",
      remoteName: "origin/feature",
      localName: "feature",
    });
  });

  it("createTag sends null message when omitted", async () => {
    await createTag("/r", "v1", "HEAD");
    expect(invoke).toHaveBeenCalledWith("create_tag", {
      repoPath: "/r",
      name: "v1",
      target: "HEAD",
      message: null,
    });
  });

  it("diffFile passes sha + path and returns structured hunks", async () => {
    const d = await diffFile("/r", "a".repeat(40), "a.txt");
    expect(invoke).toHaveBeenCalledWith("diff_file", {
      repoPath: "/r",
      sha: "a".repeat(40),
      path: "a.txt",
    });
    expect(d.hunks[0].lines[0].origin).toBe("-");
    expect(d.hunks[0].lines[1].new_lineno).toBe(1);
  });

  it("diffWorktree passes the path", async () => {
    await diffWorktree("/r", "a.txt");
    expect(invoke).toHaveBeenCalledWith("diff_worktree", {
      repoPath: "/r",
      path: "a.txt",
    });
  });

  it("probePath returns the classification", async () => {
    const r = await probePath("/r");
    expect(invoke).toHaveBeenCalledWith("probe_path", { path: "/r" });
    expect(r.kind).toBe("repo");
  });

  it("initRepository passes the path", async () => {
    await initRepository("/new");
    expect(invoke).toHaveBeenCalledWith("init_repository", { path: "/new" });
  });

  it("cloneRepository defaults auth to none and passes url+dest", async () => {
    await cloneRepository("https://x/y.git", "/dest");
    expect(invoke).toHaveBeenCalledWith("clone_repository", {
      url: "https://x/y.git",
      dest: "/dest",
      auth: { kind: "none" },
    });
  });

  it("cloneRepository forwards password auth", async () => {
    await cloneRepository("u", "/d", {
      kind: "password",
      username: "me",
      password: "tok",
    });
    expect(invoke).toHaveBeenCalledWith("clone_repository", {
      url: "u",
      dest: "/d",
      auth: { kind: "password", username: "me", password: "tok" },
    });
  });

  it("aheadBehind returns counts + upstream", async () => {
    const ab = await aheadBehind("/r");
    expect(invoke).toHaveBeenCalledWith("ahead_behind", { repoPath: "/r" });
    expect(ab).toEqual({ ahead: 1, behind: 2, upstream: "origin/main" });
  });

  it("pushBranch passes an explicit branch and remote credentials without force", async () => {
    await pushBranch(
      "/r",
      "adgitter/log",
      "origin",
      { kind: "none" },
      "https://h/x.git",
    );
    expect(invoke).toHaveBeenCalledWith("push_branch", {
      repoPath: "/r",
      branch: "adgitter/log",
      remote: "origin",
      auth: { kind: "none" },
      url: "https://h/x.git",
    });
  });

  it("pull/push default remote to origin with no auth", async () => {
    await pull("/r");
    expect(invoke).toHaveBeenCalledWith("pull", {
      repoPath: "/r",
      remote: "origin",
      auth: { kind: "none" },
      url: null,
    });
    await push("/r");
    expect(invoke).toHaveBeenCalledWith("push", {
      repoPath: "/r",
      remote: "origin",
      auth: { kind: "none" },
      force: false,
      url: null,
    });
  });

  it("push forwards force: true when requested", async () => {
    await push("/r", "origin", { kind: "none" }, true);
    expect(invoke).toHaveBeenCalledWith("push", {
      repoPath: "/r",
      remote: "origin",
      auth: { kind: "none" },
      force: true,
      url: null,
    });
  });

  it("push/pull forward a Settings URL override as the target", async () => {
    await push("/r", "origin", { kind: "none" }, false, "https://h/x.git");
    expect(invoke).toHaveBeenCalledWith("push", {
      repoPath: "/r",
      remote: "origin",
      auth: { kind: "none" },
      force: false,
      url: "https://h/x.git",
    });
    await pull("/r", "origin", { kind: "none" }, "https://h/x.git");
    expect(invoke).toHaveBeenCalledWith("pull", {
      repoPath: "/r",
      remote: "origin",
      auth: { kind: "none" },
      url: "https://h/x.git",
    });
  });

  it("logCommit passes repoPath + branch", async () => {
    const sha = await logCommit("/r", "adgitter-log");
    expect(invoke).toHaveBeenCalledWith("log_commit", {
      repoPath: "/r",
      branch: "adgitter-log",
    });
    expect(sha).toHaveLength(40);
  });

  it("tutorial demo commands pass camelCase args and return the backend's shapes", async () => {
    const demo = await tutorialDemoCreate();
    expect(invoke).toHaveBeenCalledWith("tutorial_demo_create");
    expect(demo).toEqual({
      repoPath: "/data/tutorial/demo-1/repo",
      remotePath: "/data/tutorial/demo-1/origin.git",
    });

    const files = await tutorialDemoSeedFiles(demo.repoPath);
    expect(invoke).toHaveBeenCalledWith("tutorial_demo_seed_files", {
      repoPath: demo.repoPath,
    });
    expect(files).toEqual(["src/app.js", "src/style.css", "docs/notes.md"]);

    await tutorialDemoSeedHistory(demo.repoPath);
    expect(invoke).toHaveBeenCalledWith("tutorial_demo_seed_history", {
      repoPath: demo.repoPath,
    });

    await tutorialDemoWriteFile(demo.repoPath, "secrets.example.env", "K=\n");
    expect(invoke).toHaveBeenCalledWith("tutorial_demo_write_file", {
      repoPath: demo.repoPath,
      path: "secrets.example.env",
      content: "K=\n",
    });

    const shas = await tutorialDemoSimulateLog(
      demo.repoPath,
      "adgitter-log",
      3,
    );
    expect(invoke).toHaveBeenCalledWith("tutorial_demo_simulate_log", {
      repoPath: demo.repoPath,
      branch: "adgitter-log",
      count: 3,
    });
    expect(shas).toHaveLength(3);

    await tutorialDemoRemove(demo.repoPath);
    expect(invoke).toHaveBeenCalledWith("tutorial_demo_remove", {
      repoPath: demo.repoPath,
    });
  });

  it("initCrashReporting forwards the consent flag", async () => {
    expect(await initCrashReporting(true)).toBe(true);
    expect(invoke).toHaveBeenCalledWith("init_crash_reporting", {
      enabled: true,
    });
  });

  it("reportEvent passes errorCode + message", async () => {
    await reportEvent("UI_ERROR", "boom");
    expect(invoke).toHaveBeenCalledWith("report_event", {
      errorCode: "UI_ERROR",
      message: "boom",
    });
  });

  it("verifyLicense sends null token by default and returns the DTO", async () => {
    const dto = await verifyLicense();
    expect(invoke).toHaveBeenCalledWith("verify_license", {
      token: null,
      pinDevice: false,
    });
    expect(dto.status).toBe("active");
    expect(dto.plan).toBe("advance");
    expect(dto.expiresMs).toBe(9999999999999);
  });

  it("verifyLicense forwards an explicit token", async () => {
    await verifyLicense("payload.sig");
    expect(invoke).toHaveBeenCalledWith("verify_license", {
      token: "payload.sig",
      pinDevice: false,
    });
  });

  // Session restore asks for the device binding to be re-checked; entitlement
  // refresh deliberately does not (see `verifyLicense`).
  it("verifyLicense asks for a device-pinned check when told to", async () => {
    await verifyLicense(undefined, { pinDevice: true });
    expect(invoke).toHaveBeenCalledWith("verify_license", {
      token: null,
      pinDevice: true,
    });
  });

  it("mintTestLicense passes plan + validDays and returns the token", async () => {
    const token = await mintTestLicense("advance", 30);
    expect(invoke).toHaveBeenCalledWith("mint_test_license", {
      plan: "advance",
      validDays: 30,
    });
    expect(token).toBe("payloadb64.sigb64");
  });

  it("issueLicense passes clerkJwt + deviceId and returns the DTO", async () => {
    const dto = await issueLicense("jwt-x", "dev-1");
    expect(invoke).toHaveBeenCalledWith("issue_license", {
      clerkJwt: "jwt-x",
      deviceId: "dev-1",
      // Eviction is opt-in and off by default: a plain sign-in that hits the
      // account's device cap must be refused, not quietly cost the user their
      // oldest device.
      evictOldest: false,
    });
    expect(dto.status).toBe("active");
    expect(dto.plan).toBe("advance");
    expect(dto.expiresMs).toBe(123);
  });

  /// The confirmed retry, and the only way `evictOldest` is ever true.
  it("issueLicense forwards an explicit eviction confirmation", async () => {
    await issueLicense("jwt-x", "dev-1", true);
    expect(invoke).toHaveBeenCalledWith("issue_license", {
      clerkJwt: "jwt-x",
      deviceId: "dev-1",
      evictOldest: true,
    });
  });

  it("renewLicense defaults to not evicting", async () => {
    await renewLicense();
    expect(invoke).toHaveBeenCalledWith("renew_license", {
      evictOldest: false,
    });
  });

  it("renewLicense forwards an explicit eviction confirmation", async () => {
    await renewLicense(true);
    expect(invoke).toHaveBeenCalledWith("renew_license", { evictOldest: true });
  });

  // Neither call carries a device id to evict — there is no such parameter.
  // The server picks its own oldest row, so a caller can only accept the loss
  // of its own least-recently-used seat.
  it("never sends a victim device id", async () => {
    await issueLicense("jwt-x", "dev-1", true);
    await renewLicense(true);
    for (const [, args] of (invoke as ReturnType<typeof vi.fn>).mock.calls) {
      expect(Object.keys(args ?? {}).sort()).not.toContain("evictDeviceId");
    }
    expect(invoke).toHaveBeenLastCalledWith("renew_license", {
      evictOldest: true,
    });
  });

  it("clerkPortalCapabilities passes the publishable key and returns capabilities", async () => {
    const caps = await clerkPortalCapabilities("pk_test_x");
    expect(invoke).toHaveBeenCalledWith("clerk_portal_capabilities", {
      publishableKey: "pk_test_x",
    });
    expect(caps).toEqual({
      userProfileUrl: "https://discrete-ibex-7.accounts.dev/user",
      organizationProfileUrl: null,
      organizationsEnabled: false,
      mfaEnabled: false,
    });
  });

  it("openExternalUrl passes the url", async () => {
    await openExternalUrl("https://example.accounts.dev/sign-in");
    expect(invoke).toHaveBeenCalledWith("open_external_url", {
      url: "https://example.accounts.dev/sign-in",
    });
  });

  it("isAdgitterError narrows correctly", () => {
    expect(isAdgitterError({ code: "X", message: "y" })).toBe(true);
    expect(isAdgitterError(null)).toBe(false);
    expect(isAdgitterError("boom")).toBe(false);
    expect(isAdgitterError({ code: "X" })).toBe(false);
  });

  it("errorText formats tagged and plain errors", () => {
    expect(errorText({ code: "REPO_NOT_FOUND", message: "nope" })).toBe(
      "REPO_NOT_FOUND: nope",
    );
    expect(errorText("boom")).toBe("boom");
  });
});
