import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the IPC layer so we can drive what the config file contains and
// observe what the mutators persist.
const readProjectConfig = vi.fn<() => Promise<string | null>>();
const writeProjectConfig = vi.fn<() => Promise<void>>();
const quarantineProjectConfig = vi.fn<() => Promise<string | null>>();
vi.mock("./ipc", () => ({
  readProjectConfig: (...a: unknown[]) =>
    (readProjectConfig as (...a: unknown[]) => Promise<string | null>)(...a),
  writeProjectConfig: (...a: unknown[]) =>
    (writeProjectConfig as (...a: unknown[]) => Promise<void>)(...a),
  quarantineProjectConfig: (...a: unknown[]) =>
    (quarantineProjectConfig as (...a: unknown[]) => Promise<string | null>)(
      ...a,
    ),
}));

import {
  mergeProjectConfig,
  DEFAULT_PROJECT_CONFIG,
  DEFAULT_ISSUE_PANEL_STATE,
  projectIssuePanel,
  setProjectIssuePanel,
  loadProjectConfig,
  resetProjectConfig,
  projectConfigExists,
  projectConfigLoadFailure,
  clearProjectConfigLoadFailure,
  projectBranchColors,
  issueBranchLinks,
  seedProjectBranchColors,
  setProjectBranchColor,
  resetProjectBranchColor,
  moveProjectBranchColor,
  setIssueBranchLink,
  removeIssueBranchLink,
  projectIssueTracker,
  setProjectIssueTracker,
  projectGeneral,
  projectPersonalize,
  projectLogAnytime,
  seedProjectGeneral,
  seedProjectPersonalize,
  seedProjectLogAnytime,
  setProjectGeneral,
  setProjectPersonalize,
  setProjectLogAnytime,
  type IssueTrackerConfig,
  type ProjectGeneralSettings,
} from "./projectConfig.svelte";
import { DEFAULT_SETTINGS, type LogAnytimeSettings } from "./settings";

const REPO = "/repo";

/**
 * The exact shape from the user report: a complete, valid config followed by
 * four stray trailing bytes (`  }\n}`) — real settings that JSON.parse refuses.
 */
const CORRUPT_RAW = `${JSON.stringify(
  {
    branchColors: { main: "#ff0000" },
    personalize: {
      theme: "midnight",
      color: "violet",
      textSize: "large",
      font: "mono",
      graphTheme: "retro",
    },
  },
  null,
  2,
)}\n  }\n}`;

/** Name the backend reports for the preserved copy. */
const BACKUP = "adgitter.config.json.corrupt-1758800000.bak";

/** The config object the last writeProjectConfig call persisted. */
function lastWritten(): unknown {
  const call = writeProjectConfig.mock.calls.at(-1) as unknown as [
    string,
    string,
  ];
  expect(call[0]).toBe(REPO);
  return JSON.parse(call[1]);
}

const GENERAL: ProjectGeneralSettings = {
  autoPull: "warn",
  autoPullBefore: { createBranch: true, push: true, commit: false },
  autoPullSeconds: 5,
  unstaged: "off",
  undoRedo: 5,
  dryRun: true,
  hideGhosts: true,
  remoteUrl: "https://example.com/repo.git",
};

const PERSONALIZE = {
  theme: "midnight",
  color: "violet",
  textSize: "large" as const,
  font: "mono" as const,
  graphTheme: "retro",
};

const LOG_ANYTIME: LogAnytimeSettings = {
  enabled: true,
  branch: "adgitter-log",
  intervalMin: 30,
  background: true,
  periodicSquash: false,
  autoPush: true,
};

beforeEach(() => {
  readProjectConfig.mockReset();
  readProjectConfig.mockResolvedValue(null);
  writeProjectConfig.mockReset();
  writeProjectConfig.mockResolvedValue(undefined);
  quarantineProjectConfig.mockReset();
  quarantineProjectConfig.mockResolvedValue(BACKUP);
  resetProjectConfig();
});

describe("mergeProjectConfig (hostile-JSON fallback)", () => {
  it("keeps well-typed fields", () => {
    expect(
      mergeProjectConfig({
        branchColors: { main: "#112233" },
        issueBranches: {
          "fix/x-gh12": { provider: "github", issueNumber: 12, title: "X" },
        },
      }),
    ).toEqual({
      branchColors: { main: "#112233" },
      issueBranches: {
        "fix/x-gh12": { provider: "github", issueNumber: 12, title: "X" },
      },
      issueTracker: null,
      general: null,
      personalize: null,
      logAnytime: null,
      issuePanel: DEFAULT_ISSUE_PANEL_STATE,
    });
  });

  it("falls back to defaults for non-objects and drops wrong-typed entries", () => {
    expect(mergeProjectConfig(null)).toEqual(DEFAULT_PROJECT_CONFIG);
    expect(mergeProjectConfig("nope")).toEqual(DEFAULT_PROJECT_CONFIG);
    expect(
      mergeProjectConfig({ branchColors: { a: "#111", b: 42 } }).branchColors,
    ).toEqual({ a: "#111" });
  });

  it("drops a half-formed issue link entirely rather than keeping fragments", () => {
    const merged = mergeProjectConfig({
      issueBranches: {
        good: { provider: "jira", issueNumber: 7, title: "t" },
        noTitle: { provider: "jira", issueNumber: 8 },
        badNumber: { provider: "jira", issueNumber: "8", title: "t" },
      },
    });
    expect(Object.keys(merged.issueBranches)).toEqual(["good"]);
  });

  it("drops unknown top-level keys (closed schema)", () => {
    const merged = mergeProjectConfig({ future: true, branchColors: {} });
    expect(merged).toEqual(DEFAULT_PROJECT_CONFIG);
    expect("future" in merged).toBe(false);
  });
});

describe("mergeProjectConfig: general/personalize/logAnytime slices", () => {
  it("an absent slice yields null (means 'not seeded yet'), not defaults", () => {
    const merged = mergeProjectConfig({});
    expect(merged.general).toBeNull();
    expect(merged.personalize).toBeNull();
    expect(merged.logAnytime).toBeNull();
  });

  it("a well-formed general slice round-trips in full", () => {
    expect(mergeProjectConfig({ general: GENERAL }).general).toEqual(GENERAL);
  });

  it("a partial general slice merges missing fields against the GLOBAL defaults", () => {
    const merged = mergeProjectConfig({
      general: { dryRun: true },
    }).general;
    // accessToken is not part of this type at all — DEFAULT_SETTINGS.general
    // has it, so it's explicitly excluded from the expectation.
    const { accessToken: _accessToken, ...defaultsWithoutToken } =
      DEFAULT_SETTINGS.general;
    expect(merged).toEqual({ ...defaultsWithoutToken, dryRun: true });
    expect(merged && "accessToken" in merged).toBe(false);
  });

  it("a wrong-typed general field falls back to its default instead of the whole slice", () => {
    const merged = mergeProjectConfig({
      general: { ...GENERAL, autoPull: "sometimes", undoRedo: "nope" },
    }).general;
    expect(merged?.autoPull).toBe(DEFAULT_SETTINGS.general.autoPull);
    expect(merged?.undoRedo).toBe(DEFAULT_SETTINGS.general.undoRedo);
    expect(merged?.remoteUrl).toBe(GENERAL.remoteUrl);
  });

  it("accessToken sneaked into a hand-edited general slice never survives the merge", () => {
    const merged = mergeProjectConfig({
      general: { ...GENERAL, accessToken: "ghp_shouldNeverAppear" },
    }).general as unknown as Record<string, unknown>;
    expect("accessToken" in merged).toBe(false);
  });

  it("a well-formed personalize slice round-trips in full", () => {
    expect(
      mergeProjectConfig({ personalize: PERSONALIZE }).personalize,
    ).toEqual(PERSONALIZE);
  });

  it("an invalid textSize on personalize falls back to the default", () => {
    const merged = mergeProjectConfig({
      personalize: { ...PERSONALIZE, textSize: "huge" },
    }).personalize;
    expect(merged?.textSize).toBe(DEFAULT_SETTINGS.personalize.textSize);
  });

  it("a well-formed logAnytime slice round-trips in full", () => {
    expect(mergeProjectConfig({ logAnytime: LOG_ANYTIME }).logAnytime).toEqual(
      LOG_ANYTIME,
    );
  });

  it("logAnytime.intervalMin below 1 clamps like the global settings merge does", () => {
    const merged = mergeProjectConfig({
      logAnytime: { ...LOG_ANYTIME, intervalMin: 0 },
    }).logAnytime;
    expect(merged?.intervalMin).toBe(1);
  });
});

describe("loadProjectConfig / projectConfigExists", () => {
  it("a missing file yields defaults and reports no file", async () => {
    readProjectConfig.mockResolvedValue(null);
    const cfg = await loadProjectConfig(REPO);
    expect(cfg).toEqual(DEFAULT_PROJECT_CONFIG);
    expect(projectConfigExists()).toBe(false);
  });

  it("a missing file is NOT quarantined and raises no warning (the common path)", async () => {
    readProjectConfig.mockResolvedValue(null);
    await loadProjectConfig(REPO);
    expect(quarantineProjectConfig).not.toHaveBeenCalled();
    expect(projectConfigLoadFailure()).toBeNull();
  });

  it("a valid file populates the reactive accessors", async () => {
    readProjectConfig.mockResolvedValue(
      JSON.stringify({
        branchColors: { dev: "#abcdef" },
        issueBranches: {
          "feat/y-a9": { provider: "asana", issueNumber: 9, title: "Y" },
        },
      }),
    );
    await loadProjectConfig(REPO);
    expect(projectBranchColors()).toEqual({ dev: "#abcdef" });
    expect(issueBranchLinks()["feat/y-a9"].title).toBe("Y");
  });

  it("a valid file with general/personalize/logAnytime populates those accessors too", async () => {
    readProjectConfig.mockResolvedValue(
      JSON.stringify({
        general: GENERAL,
        personalize: PERSONALIZE,
        logAnytime: LOG_ANYTIME,
      }),
    );
    await loadProjectConfig(REPO);
    expect(projectGeneral()).toEqual(GENERAL);
    expect(projectPersonalize()).toEqual(PERSONALIZE);
    expect(projectLogAnytime()).toEqual(LOG_ANYTIME);
  });

  it("switching repos replaces every project-scoped slice with the new repo's", async () => {
    // Repo A: a fully-populated config.
    readProjectConfig.mockResolvedValueOnce(
      JSON.stringify({
        branchColors: { dev: "#abcdef" },
        general: GENERAL,
        personalize: PERSONALIZE,
        logAnytime: LOG_ANYTIME,
      }),
    );
    await loadProjectConfig("/repo-a");
    expect(projectGeneral()).toEqual(GENERAL);
    expect(projectBranchColors()).toEqual({ dev: "#abcdef" });

    // Switch to repo B (a different config): the old repo's values must not
    // bleed through — every slice reflects B, and B's absent slices go null.
    readProjectConfig.mockResolvedValueOnce(
      JSON.stringify({ branchColors: { main: "#111111" } }),
    );
    await loadProjectConfig("/repo-b");
    expect(projectBranchColors()).toEqual({ main: "#111111" });
    expect(projectGeneral()).toBeNull();
    expect(projectPersonalize()).toBeNull();
    expect(projectLogAnytime()).toBeNull();
  });

  it("a read failure is swallowed and yields defaults", async () => {
    readProjectConfig.mockRejectedValue(new Error("io"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cfg = await loadProjectConfig(REPO);
    spy.mockRestore();
    expect(cfg).toEqual(DEFAULT_PROJECT_CONFIG);
    expect(projectConfigExists()).toBe(false);
  });

  it("a missing file still saves normally (the common path, unchanged)", async () => {
    readProjectConfig.mockResolvedValue(null);
    await loadProjectConfig(REPO);
    await setProjectBranchColor("main", "#111111");
    expect(writeProjectConfig).toHaveBeenCalledTimes(1);
  });
});

// A corrupt file is a different thing from a missing one: the repo HAS
// settings, we just cannot read them. Nothing may quietly overwrite them.
describe("loadProjectConfig with an unreadable config file", () => {
  beforeEach(() => readProjectConfig.mockResolvedValue(CORRUPT_RAW));

  it("preserves the original bytes before the load even resolves", async () => {
    await loadProjectConfig(REPO);
    expect(quarantineProjectConfig).toHaveBeenCalledWith(REPO);
  });

  it("does not present as a normal empty config", async () => {
    await loadProjectConfig(REPO);
    // In-memory values still fall back to defaults (we cannot parse the file)…
    expect(projectBranchColors()).toEqual({});
    // …but the store must not claim it loaded a config file.
    expect(projectConfigExists()).toBe(false);
    expect(projectConfigLoadFailure()).toEqual({
      repoPath: REPO,
      backupFile: BACKUP,
      reason: "corrupt",
      writesBlocked: false,
    });
  });

  it("the original survives a subsequent save: the copy is taken first", async () => {
    await loadProjectConfig(REPO);
    await setProjectBranchColor("main", "#111111");
    // The defaults-overwrite still happens (an explicit, user-initiated save),
    // but only after the unreadable bytes were copied aside.
    expect(writeProjectConfig).toHaveBeenCalled();
    const quarantineOrder = quarantineProjectConfig.mock.invocationCallOrder[0];
    const writeOrder = writeProjectConfig.mock.invocationCallOrder[0];
    expect(quarantineOrder).toBeLessThan(writeOrder);
  });

  it("never rewrites or repairs the file on its own — loading writes nothing", async () => {
    await loadProjectConfig(REPO);
    expect(writeProjectConfig).not.toHaveBeenCalled();
  });

  it("still warns when the bytes could not be preserved — and blocks saves", async () => {
    quarantineProjectConfig.mockRejectedValue(new Error("io"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await loadProjectConfig(REPO);
    spy.mockRestore();
    expect(projectConfigLoadFailure()).toEqual({
      repoPath: REPO,
      backupFile: null,
      reason: "corrupt",
      writesBlocked: true,
    });
  });

  it("clears the warning when a later repo loads cleanly", async () => {
    await loadProjectConfig(REPO);
    expect(projectConfigLoadFailure()).not.toBeNull();
    readProjectConfig.mockResolvedValue(JSON.stringify({ branchColors: {} }));
    await loadProjectConfig("/repo-b");
    expect(projectConfigLoadFailure()).toBeNull();
  });

  it("clearProjectConfigLoadFailure dismisses the warning", async () => {
    await loadProjectConfig(REPO);
    clearProjectConfigLoadFailure();
    expect(projectConfigLoadFailure()).toBeNull();
  });

  it("resetProjectConfig clears the warning too", async () => {
    await loadProjectConfig(REPO);
    resetProjectConfig();
    expect(projectConfigLoadFailure()).toBeNull();
  });
});

// The other half of the same bug: an IPC *error* (not unparseable content)
// used to collapse to `raw = null`, i.e. it was indistinguishable from "this
// repo has no config" — no quarantine, no warning, and the first mutator
// (`setProjectIssuePanel` fires from merely opening an issue) overwrote the
// file with defaults. `read_project_config_sync` errors on at least three real
// inputs: over the 256 KiB cap, content that is not valid UTF-8, and a
// permissions/IO failure. Which of those can be preserved is decided
// backend-side (see the Rust `project_config_tests`); here they all arrive as
// a rejected promise, so the distinction that matters is: NOT a missing file.
describe("loadProjectConfig when the read itself fails", () => {
  /** The three real backend failures, as the frontend sees them. */
  const READ_FAILURES: Array<[string, string]> = [
    ["over the size cap", "adgitter.config.json is too large (300000 bytes)"],
    ["not valid UTF-8", "stream did not contain valid UTF-8"],
    ["a permissions/IO error", "Permission denied (os error 13)"],
  ];

  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  for (const [label, message] of READ_FAILURES) {
    it(`${label} is treated as an unreadable file, not a missing one`, async () => {
      readProjectConfig.mockRejectedValue(new Error(message));
      await loadProjectConfig(REPO);

      // A missing file would do none of these three.
      expect(quarantineProjectConfig).toHaveBeenCalledWith(REPO);
      expect(projectConfigExists()).toBe(false);
      expect(projectConfigLoadFailure()).toEqual({
        repoPath: REPO,
        backupFile: BACKUP,
        reason: "unreadable",
        writesBlocked: false,
      });
    });
  }

  it("preserves the bytes before any mutator can write over them", async () => {
    readProjectConfig.mockRejectedValue(new Error("io"));
    await loadProjectConfig(REPO);
    await setProjectBranchColor("main", "#111111");

    expect(writeProjectConfig).toHaveBeenCalled();
    expect(quarantineProjectConfig.mock.invocationCallOrder[0]).toBeLessThan(
      writeProjectConfig.mock.invocationCallOrder[0],
    );
  });

  it("loading writes nothing on its own", async () => {
    readProjectConfig.mockRejectedValue(new Error("io"));
    await loadProjectConfig(REPO);
    expect(writeProjectConfig).not.toHaveBeenCalled();
  });

  // THE regression test: read failed AND the bytes could not be copied aside,
  // so there is no restorable copy anywhere. A save here is unrecoverable
  // data loss, and the background `setProjectIssuePanel` path means it takes
  // nothing more than opening an issue.
  describe("and the bytes could not be preserved either", () => {
    beforeEach(async () => {
      readProjectConfig.mockRejectedValue(new Error("Permission denied"));
      quarantineProjectConfig.mockRejectedValue(new Error("Permission denied"));
      await loadProjectConfig(REPO);
      writeProjectConfig.mockClear();
    });

    it("a mutator does NOT write the file", async () => {
      await setProjectBranchColor("main", "#111111");
      expect(writeProjectConfig).not.toHaveBeenCalled();
    });

    it("opening an issue does not write the file either", async () => {
      await setProjectIssuePanel(7, "proj");
      expect(writeProjectConfig).not.toHaveBeenCalled();
    });

    it("every other mutator is blocked too", async () => {
      await setProjectGeneral(GENERAL);
      await setProjectPersonalize(PERSONALIZE);
      await setProjectLogAnytime(LOG_ANYTIME);
      await setProjectIssueTracker(null);
      await setIssueBranchLink("b", {
        provider: "asana",
        issueNumber: 1,
        title: "t",
      });
      expect(writeProjectConfig).not.toHaveBeenCalled();
    });

    it("says so: the warning reports the block", () => {
      expect(projectConfigLoadFailure()).toEqual({
        repoPath: REPO,
        backupFile: null,
        reason: "unreadable",
        writesBlocked: true,
      });
    });

    it("a refused save re-raises the warning the user dismissed", async () => {
      clearProjectConfigLoadFailure();
      expect(projectConfigLoadFailure()).toBeNull();

      await setProjectBranchColor("main", "#111111");

      // Dismissing the message must not be a way to re-arm the write, and a
      // silently-dropped save would look exactly like a successful one.
      expect(writeProjectConfig).not.toHaveBeenCalled();
      expect(projectConfigLoadFailure()?.writesBlocked).toBe(true);
    });

    it("the block does not leak onto the next repo", async () => {
      readProjectConfig.mockResolvedValue(JSON.stringify({ branchColors: {} }));
      await loadProjectConfig("/repo-b");

      await setProjectBranchColor("main", "#111111");
      expect(writeProjectConfig).toHaveBeenCalledTimes(1);
      expect(projectConfigLoadFailure()).toBeNull();
    });

    it("clears once the same repo loads cleanly again (user fixed the file)", async () => {
      readProjectConfig.mockResolvedValue(JSON.stringify({ branchColors: {} }));
      await loadProjectConfig(REPO);

      await setProjectBranchColor("main", "#111111");
      expect(writeProjectConfig).toHaveBeenCalledTimes(1);
    });

    it("stays blocked while the repo keeps failing to load", async () => {
      await loadProjectConfig(REPO);
      await setProjectBranchColor("main", "#111111");
      expect(writeProjectConfig).not.toHaveBeenCalled();
    });

    it("resetProjectConfig clears the block with the repo", async () => {
      resetProjectConfig();
      readProjectConfig.mockResolvedValue(null);
      await loadProjectConfig(REPO);
      await setProjectBranchColor("main", "#111111");
      expect(writeProjectConfig).toHaveBeenCalledTimes(1);
    });
  });
});

describe("mutators persist the whole config against the loaded repo", () => {
  beforeEach(async () => {
    await loadProjectConfig(REPO);
  });

  it("setProjectBranchColor writes the new override", async () => {
    await setProjectBranchColor("main", "#111111");
    expect(lastWritten()).toEqual({
      branchColors: { main: "#111111" },
      issueBranches: {},
      issueTracker: null,
      general: null,
      personalize: null,
      logAnytime: null,
      issuePanel: DEFAULT_ISSUE_PANEL_STATE,
    });
  });

  it("resetProjectBranchColor removes the override", async () => {
    await setProjectBranchColor("main", "#111111");
    await resetProjectBranchColor("main");
    expect(lastWritten()).toEqual(DEFAULT_PROJECT_CONFIG);
  });

  it("moveProjectBranchColor MOVES the entry on rename", async () => {
    await setProjectBranchColor("old", "#222222");
    await moveProjectBranchColor("old", "new");
    expect(lastWritten()).toEqual({
      branchColors: { new: "#222222" },
      issueBranches: {},
      issueTracker: null,
      general: null,
      personalize: null,
      logAnytime: null,
      issuePanel: DEFAULT_ISSUE_PANEL_STATE,
    });
  });

  it("moveProjectBranchColor is a no-write no-op when the source has no override", async () => {
    await moveProjectBranchColor("uncoloured", "renamed");
    expect(writeProjectConfig).not.toHaveBeenCalled();
    expect(projectBranchColors()).toEqual({});
  });

  it("issue links round-trip through set/remove", async () => {
    const link = { provider: "gitlab", issueNumber: 3, title: "Z" };
    await setIssueBranchLink("fix/z-gl3", link);
    expect(lastWritten()).toEqual({
      branchColors: {},
      issueBranches: { "fix/z-gl3": link },
      issueTracker: null,
      general: null,
      personalize: null,
      logAnytime: null,
      issuePanel: DEFAULT_ISSUE_PANEL_STATE,
    });
    await removeIssueBranchLink("fix/z-gl3");
    expect(lastWritten()).toEqual(DEFAULT_PROJECT_CONFIG);
  });
});

describe("issueTracker binding (non-secret persistence)", () => {
  const FULL: IssueTrackerConfig = {
    kind: "gitlab",
    deployment: "selfHosted",
    hostUrl: "https://git.example.com",
    scope: { id: "201", name: "group/project-one", ref: "201" },
    webhookUrl: "https://api.adgitter.app/hooks/issues/gitlab/x",
  };

  it("merge keeps a well-formed binding and round-trips it", () => {
    expect(mergeProjectConfig({ issueTracker: FULL }).issueTracker).toEqual(
      FULL,
    );
  });

  it("merge drops the whole binding on an unknown kind or deployment", () => {
    expect(
      mergeProjectConfig({ issueTracker: { ...FULL, kind: "bugzilla" } })
        .issueTracker,
    ).toBeNull();
    expect(
      mergeProjectConfig({ issueTracker: { ...FULL, deployment: "onprem" } })
        .issueTracker,
    ).toBeNull();
    expect(
      mergeProjectConfig({ issueTracker: "nope" }).issueTracker,
    ).toBeNull();
  });

  it("merge drops a half-formed scope but keeps the rest of the binding", () => {
    const merged = mergeProjectConfig({
      issueTracker: { ...FULL, scope: { id: "201", name: 42 } },
    }).issueTracker;
    expect(merged?.kind).toBe("gitlab");
    expect(merged?.hostUrl).toBe("https://git.example.com");
    expect(merged?.scope).toBeUndefined();
  });

  it("a token-looking field never survives the merge (closed schema)", () => {
    const merged = mergeProjectConfig({
      issueTracker: { ...FULL, accessToken: "glpat-secret" },
    }).issueTracker as unknown as Record<string, unknown>;
    expect("accessToken" in merged).toBe(false);
  });

  it("setProjectIssueTracker persists the whole config and null clears it", async () => {
    await loadProjectConfig(REPO);
    await setProjectIssueTracker(FULL);
    expect(projectIssueTracker()).toEqual(FULL);
    expect(lastWritten()).toEqual({
      branchColors: {},
      issueBranches: {},
      issueTracker: FULL,
      general: null,
      personalize: null,
      logAnytime: null,
      issuePanel: DEFAULT_ISSUE_PANEL_STATE,
    });
    await setProjectIssueTracker(null);
    expect(projectIssueTracker()).toBeNull();
    expect(lastWritten()).toEqual(DEFAULT_PROJECT_CONFIG);
  });
});

describe("general/personalize/logAnytime: accessors, seed, mutators", () => {
  beforeEach(async () => {
    await loadProjectConfig(REPO);
  });

  it("accessors are null before anything seeds/sets them", () => {
    expect(projectGeneral()).toBeNull();
    expect(projectPersonalize()).toBeNull();
    expect(projectLogAnytime()).toBeNull();
  });

  it("seedProjectGeneral/Personalize/LogAnytime fill the store without writing to disk", () => {
    seedProjectGeneral(GENERAL);
    seedProjectPersonalize(PERSONALIZE);
    seedProjectLogAnytime(LOG_ANYTIME);
    expect(projectGeneral()).toEqual(GENERAL);
    expect(projectPersonalize()).toEqual(PERSONALIZE);
    expect(projectLogAnytime()).toEqual(LOG_ANYTIME);
    expect(writeProjectConfig).not.toHaveBeenCalled();
  });

  it("setProjectGeneral persists the whole config", async () => {
    await setProjectGeneral(GENERAL);
    expect(projectGeneral()).toEqual(GENERAL);
    expect(lastWritten()).toEqual({
      ...DEFAULT_PROJECT_CONFIG,
      general: GENERAL,
    });
  });

  it("setProjectPersonalize persists the whole config", async () => {
    await setProjectPersonalize(PERSONALIZE);
    expect(projectPersonalize()).toEqual(PERSONALIZE);
    expect(lastWritten()).toEqual({
      ...DEFAULT_PROJECT_CONFIG,
      personalize: PERSONALIZE,
    });
  });

  it("setProjectLogAnytime persists the whole config", async () => {
    await setProjectLogAnytime(LOG_ANYTIME);
    expect(projectLogAnytime()).toEqual(LOG_ANYTIME);
    expect(lastWritten()).toEqual({
      ...DEFAULT_PROJECT_CONFIG,
      logAnytime: LOG_ANYTIME,
    });
  });

  // Mandatory leak guard: accessToken must NEVER reach the object passed to
  // write_project_config, however it arrives — not via setProjectGeneral, not
  // via a seed, not by any other path. adgitter.config.json is a plain,
  // committable file inside the repo's working tree.
  it("LEAK GUARD: accessToken never appears in the object persisted to write_project_config", async () => {
    // Even if a caller manages to smuggle an `accessToken` property onto the
    // object at runtime (bypassing the `ProjectGeneralSettings` TS type,
    // e.g. via an `as any` cast elsewhere), the mutator's explicit
    // `{ ...value, autoPullBefore: {...} }` shallow-clone plus the type's
    // structural shape must still keep it out of what actually gets written.
    const tainted = {
      ...GENERAL,
      accessToken: "ghp_shouldNeverBeWritten",
    } as ProjectGeneralSettings;
    await setProjectGeneral(tainted);

    const written = lastWritten() as Record<string, unknown>;
    const writtenGeneral = written.general as Record<string, unknown>;
    expect(writtenGeneral).toBeTruthy();
    expect("accessToken" in writtenGeneral).toBe(false);

    // Also assert on the raw JSON string — belt and suspenders against a
    // future refactor that stringifies a differently-shaped object.
    const raw = (
      writeProjectConfig.mock.calls.at(-1) as unknown as [string, string]
    )[1];
    expect(raw).not.toContain("accessToken");
    expect(raw).not.toContain("ghp_shouldNeverBeWritten");
  });
});

describe("seeding and lifecycle", () => {
  it("seedProjectBranchColors fills the store without writing to disk", async () => {
    await loadProjectConfig(REPO);
    seedProjectBranchColors({ main: "#333333" });
    expect(projectBranchColors()).toEqual({ main: "#333333" });
    expect(writeProjectConfig).not.toHaveBeenCalled();
    // …and the seed rides along on the next real mutation.
    await setProjectBranchColor("dev", "#444444");
    expect(lastWritten()).toEqual({
      branchColors: { main: "#333333", dev: "#444444" },
      issueBranches: {},
      issueTracker: null,
      general: null,
      personalize: null,
      logAnytime: null,
      issuePanel: DEFAULT_ISSUE_PANEL_STATE,
    });
  });

  it("mutating with no repo loaded never writes", async () => {
    await setProjectBranchColor("main", "#555555");
    expect(writeProjectConfig).not.toHaveBeenCalled();
  });

  it("resetProjectConfig clears state so the next repo starts clean", async () => {
    await loadProjectConfig(REPO);
    await setProjectBranchColor("main", "#666666");
    resetProjectConfig();
    expect(projectBranchColors()).toEqual({});
    expect(projectConfigExists()).toBe(false);
  });

  it("resetProjectConfig clears the issue-tracker binding too", async () => {
    await loadProjectConfig(REPO);
    await setProjectIssueTracker({ kind: "github", deployment: "cloud" });
    resetProjectConfig();
    expect(projectIssueTracker()).toBeNull();
  });

  it("resetProjectConfig clears general/personalize/logAnytime too", async () => {
    await loadProjectConfig(REPO);
    seedProjectGeneral(GENERAL);
    await setProjectPersonalize(PERSONALIZE);
    resetProjectConfig();
    expect(projectGeneral()).toBeNull();
    expect(projectPersonalize()).toBeNull();
    expect(projectLogAnytime()).toBeNull();
  });

  it("a stale in-flight load loses to a newer one", async () => {
    let resolveSlow!: (v: string | null) => void;
    const slow = new Promise<string | null>((r) => {
      resolveSlow = r;
    });
    readProjectConfig.mockReturnValueOnce(slow);
    const first = loadProjectConfig("/repo-a");
    readProjectConfig.mockResolvedValueOnce(
      JSON.stringify({ branchColors: { b: "#777777" } }),
    );
    await loadProjectConfig("/repo-b");
    resolveSlow(JSON.stringify({ branchColors: { a: "#888888" } }));
    await first;
    expect(projectBranchColors()).toEqual({ b: "#777777" });
  });

  // Repo-switch: this is the mechanism App.svelte's "effective" values rely
  // on (repo open → the project-config slice; switching repos switches
  // settings automatically) — proven here at the cheapest level, without a
  // full App mount, by loading two different repos in sequence and checking
  // their personalize slices differ.
  it("loading repo A then repo B yields different personalize (repo switch)", async () => {
    readProjectConfig.mockResolvedValueOnce(
      JSON.stringify({
        personalize: {
          theme: "midnight",
          color: "violet",
          textSize: "large",
          font: "system",
          graphTheme: "retro",
        },
      }),
    );
    await loadProjectConfig("/repo-a");
    expect(projectPersonalize()).toEqual({
      theme: "midnight",
      color: "violet",
      textSize: "large",
      font: "system",
      graphTheme: "retro",
    });

    readProjectConfig.mockResolvedValueOnce(
      JSON.stringify({
        personalize: {
          theme: "daylight",
          color: "amber",
          textSize: "small",
          font: "system",
          graphTheme: "classic",
        },
      }),
    );
    await loadProjectConfig("/repo-b");
    expect(projectPersonalize()).toEqual({
      theme: "daylight",
      color: "amber",
      textSize: "small",
      font: "system",
      graphTheme: "classic",
    });
  });
});

describe("issuePanel: last opened issue / last used project (per repo)", () => {
  beforeEach(async () => {
    await loadProjectConfig(REPO);
  });

  it("remembers nothing before anything is set", () => {
    expect(projectIssuePanel()).toEqual(DEFAULT_ISSUE_PANEL_STATE);
  });

  it("persists the last issue number + project and reflects it immediately", async () => {
    await setProjectIssuePanel(42, "Beta");
    expect(projectIssuePanel()).toEqual({
      lastIssueNumber: 42,
      lastProject: "Beta",
    });
    expect(lastWritten()).toEqual({
      ...DEFAULT_PROJECT_CONFIG,
      issuePanel: { lastIssueNumber: 42, lastProject: "Beta" },
    });
  });

  it("does not re-write the file when nothing changed", async () => {
    await setProjectIssuePanel(42, "Beta");
    expect(writeProjectConfig).toHaveBeenCalledTimes(1);
    await setProjectIssuePanel(42, "Beta");
    expect(writeProjectConfig).toHaveBeenCalledTimes(1);
    await setProjectIssuePanel(43, "Beta");
    expect(writeProjectConfig).toHaveBeenCalledTimes(2);
  });

  it("comes back on a fresh load of the repo (survives a relaunch)", async () => {
    readProjectConfig.mockResolvedValueOnce(
      JSON.stringify({
        issuePanel: { lastIssueNumber: 7, lastProject: "Alpha" },
      }),
    );
    await loadProjectConfig(REPO);
    expect(projectIssuePanel()).toEqual({
      lastIssueNumber: 7,
      lastProject: "Alpha",
    });
  });

  it("is per repo — another repo's memory does not leak in", async () => {
    await setProjectIssuePanel(7, "Alpha");
    readProjectConfig.mockResolvedValueOnce(null);
    await loadProjectConfig("/repo-b");
    expect(projectIssuePanel()).toEqual(DEFAULT_ISSUE_PANEL_STATE);
  });

  it("drops hostile/corrupt values instead of throwing", () => {
    expect(mergeProjectConfig({ issuePanel: "nope" }).issuePanel).toEqual(
      DEFAULT_ISSUE_PANEL_STATE,
    );
    expect(
      mergeProjectConfig({
        issuePanel: { lastIssueNumber: "7", lastProject: 5 },
      }).issuePanel,
    ).toEqual(DEFAULT_ISSUE_PANEL_STATE);
    expect(
      mergeProjectConfig({ issuePanel: { lastIssueNumber: -3 } }).issuePanel
        .lastIssueNumber,
    ).toBeNull();
    expect(
      mergeProjectConfig({ issuePanel: { lastIssueNumber: 1.5 } }).issuePanel
        .lastIssueNumber,
    ).toBeNull();
  });

  it("clears the memory when both fields are set back to null", async () => {
    await setProjectIssuePanel(42, "Beta");
    await setProjectIssuePanel(null, null);
    expect(projectIssuePanel()).toEqual(DEFAULT_ISSUE_PANEL_STATE);
    expect(lastWritten()).toEqual(DEFAULT_PROJECT_CONFIG);
  });
});
