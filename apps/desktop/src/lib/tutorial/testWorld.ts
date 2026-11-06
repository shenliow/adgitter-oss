/**
 * Test-only fake of the demo repo + `TutorialHost` (never imported by app
 * code). The tests mutate `world.view` to mimic what the real operations do to
 * the graph, so a whole tutorial run can be replayed without any IPC.
 */
import type { TutorialHost, TutorialRepoView, TutorialSettings } from "./types";

/** Labels double as shas, so assertions read like the script. */
export const REPO = "/appdata/tutorial/demo-1/repo";
export const ORIGIN = "/appdata/tutorial/demo-1/origin.git";

type Commit = { sha: string; subject: string; parents: string[] };
/** `parents` default to none; the seeded DAG below always passes them. */
const c = (sha: string, subject: string, parents: string[] = []): Commit => ({
  sha,
  subject,
  parents,
});

export interface World {
  view: TutorialRepoView | null;
  /** Ordered log of host calls, e.g. `openRepo`, `seedHistory`. */
  calls: string[];
  /** Every `saveFlags` payload. */
  flags: Partial<TutorialSettings>[];
  firstUseShown: boolean;
  /** One-shot failures by host method name. */
  fail: Record<string, unknown>;
  /** Hold a host method until `release[name]()` is called. */
  hold: Record<string, boolean>;
  release: Record<string, () => void>;
  host: TutorialHost;
  count(prefix: string): number;
}

export function makeWorld(): World {
  const w: World = {
    view: null,
    calls: [],
    flags: [],
    firstUseShown: false,
    fail: {},
    hold: {},
    release: {},
    host: undefined as unknown as TutorialHost,
    count: (prefix) => w.calls.filter((x) => x.startsWith(prefix)).length,
  };

  async function gate(name: string, entry: string) {
    w.calls.push(entry);
    if (w.hold[name]) {
      await new Promise<void>((resolve) => {
        w.release[name] = () => {
          delete w.hold[name];
          resolve();
        };
      });
    }
    if (name in w.fail) {
      const err = w.fail[name];
      delete w.fail[name];
      throw err;
    }
  }

  w.host = {
    async createDemo() {
      await gate("createDemo", "createDemo");
      return { repoPath: REPO, remotePath: ORIGIN };
    },
    async openRepo(path) {
      await gate("openRepo", `openRepo:${path}`);
      w.view = initialView();
    },
    async seedFiles(path) {
      await gate("seedFiles", `seedFiles:${path}`);
      return ["src/app.js", "src/style.css", "docs/notes.md"];
    },
    async seedHistory(path) {
      await gate("seedHistory", `seedHistory:${path}`);
      w.view = seededView();
    },
    async writeFile(path, file, content) {
      await gate("writeFile", `writeFile:${path}:${file}`);
      void content;
    },
    async simulateLog(path, branch, count) {
      await gate("simulateLog", `simulateLog:${path}:${branch}:${count}`);
      const shas = Array.from({ length: count }, (_, i) => `LOG${i + 1}`);
      if (w.view) {
        w.view = {
          ...w.view,
          commits: [
            ...shas.map((sha, i) =>
              c(
                sha,
                `adgitter-log snapshot ${i + 1}`,
                i === 0 ? [] : [shas[i - 1]],
              ),
            ),
            ...w.view.commits,
          ],
          branches: { ...w.view.branches, [branch]: shas[shas.length - 1] },
        };
      }
      return shas;
    },
    async removeDemo(path) {
      await gate("removeDemo", `removeDemo:${path}`);
    },
    async closeRepo() {
      await gate("closeRepo", "closeRepo");
      w.view = null;
    },
    repoView: () => w.view,
    async saveFlags(f) {
      w.flags.push(f);
      await gate("saveFlags", "saveFlags");
    },
    showFirstUse() {
      w.calls.push("showFirstUse");
    },
  };
  return w;
}

/**
 * The starter history `create_demo` builds (newest first):
 *
 *   C1 ← S1 ← S2 ← SM ← S3        main (S3 "Add license"; tag v0.0.1 on SM)
 *         ↖ D1 ← D2 ↗              docs/intro (merged into SM)
 */
const STARTER = [
  c("S3", "Add license", ["SM"]),
  c("SM", "Merge branch 'docs/intro'", ["S2", "D2"]),
  c("D2", "Polish intro wording", ["D1"]),
  c("S2", "Write getting-started guide", ["S1"]),
  c("D1", "Draft intro page", ["S1"]),
  c("S1", "Add project skeleton", ["C1"]),
  c("C1", "Initial commit"),
];

/** After step 3: the starter history, main at its tip. */
export function initialView(): TutorialRepoView {
  return {
    repoPath: REPO,
    head: "main",
    commits: [...STARTER],
    branches: { main: "S3", "docs/intro": "D2" },
    tags: { "v0.0.1": "SM" },
  };
}

/** After step 5's user commit: C2 on top. */
export function afterFirstCommit(v: TutorialRepoView): TutorialRepoView {
  return {
    ...v,
    commits: [c("C2", "Add app files", ["S3"]), ...v.commits],
    branches: { ...v.branches, main: "C2" },
  };
}

/**
 * After step 6: the full seeded demo history (newest first):
 *
 *   (starter history) ← C2 ← C3 ← C4 ← C5   main
 *                  ↖ L1 ← L2           feature/login (from C4)
 *             C5 ← T1 ← T2             feature/theme (from C5)
 *        C2 ← E1 ← E2                  experiment    (from C2)
 */
export function seededView(): TutorialRepoView {
  return {
    repoPath: REPO,
    head: "main",
    commits: [
      c("E2", "Log timings", ["E1"]),
      c("E1", "Try faster render", ["C2"]),
      c("T2", "Add theme switch", ["T1"]),
      c("T1", "Add drak theme", ["C5"]),
      c("C5", "Update docs", ["C4"]),
      c("L2", "Validate login", ["L1"]),
      c("L1", "Add login form", ["C4"]),
      c("C4", "Add helpers", ["C3"]),
      c("C3", "Add config", ["C2"]),
      c("C2", "Add app files", ["S3"]),
      ...STARTER,
    ],
    branches: {
      main: "C5",
      "feature/login": "L2",
      "feature/theme": "T2",
      experiment: "E2",
      "docs/intro": "D2",
    },
    tags: { "v0.0.1": "SM", "v0.1.0": "C3", "v0.2.0": "C4" },
  };
}

/** Replace a view with changed pieces. */
export function patch(
  v: TutorialRepoView,
  p: Partial<TutorialRepoView>,
): TutorialRepoView {
  return { ...v, ...p };
}

export { c as commit };
