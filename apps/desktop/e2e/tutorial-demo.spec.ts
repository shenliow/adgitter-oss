/**
 * Bridge-level test for the guided tutorial's demo repository.
 *
 * No browser: this spec calls the e2e bridge's `invoke` directly (the very
 * function the app's shim reaches through `window.__E2E_INVOKE__`) and asserts
 * the outcome with the real `git` CLI. It proves that the bridge's
 * `tutorial_demo_*` commands — and every other command the tutorial flow
 * drives on the demo repo — reproduce the Rust reference
 * (`crates/git-core/src/tutorial_demo.rs`, whose
 * `the_full_tutorial_script_replays_on_the_real_engines` test the second block
 * below mirrors step for step) without the Tauri backend.
 */
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createBridge, type Bridge } from "./bridge";

interface DemoRepo {
  repoPath: string;
  remotePath: string;
}
interface StatusDto {
  staged: unknown[];
  changed: unknown[];
  untracked: { path: string }[];
  ignored: { path: string }[];
  conflicted: unknown[];
}
interface RefsDto {
  head: { branch: string | null; detached: boolean };
  branches: { name: string; has_upstream: boolean | null; target: string }[];
  tags: { name: string; target: string }[];
}
interface OpResult {
  status: string;
  outcome: { remapped: string[]; skipped: string[] };
}
interface BackupDto {
  op: string;
  original_ref: string;
  backup_ref: string;
}

function git(dir: string, args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
function gitOrNull(dir: string, args: string[]): string | null {
  try {
    return git(dir, args);
  } catch {
    return null;
  }
}

let root: string;
let base: string;
let bridge: Bridge;

test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "adgitter-e2e-tutdemo-"));
  base = join(root, "tutorial");
  // The fixture repoPath is never used: every call below names its repo.
  bridge = createBridge(join(root, "no-fixture"), { tutorialBaseDir: base });
});
test.afterEach(() => {
  bridge.dispose();
  rmSync(root, { recursive: true, force: true });
});

const call = <T = unknown>(cmd: string, args: Record<string, unknown> = {}) =>
  bridge.invoke(cmd, args) as T;

// ── Helpers mirroring the Rust test module ───────────────────────────────────

const rev = (repo: string, spec: string) =>
  git(repo, ["rev-parse", `${spec}^{commit}`]);
const subject = (repo: string, spec: string) =>
  git(repo, ["log", "-1", "--format=%s", spec]);
const parents = (repo: string, spec: string) =>
  git(repo, ["rev-list", "--parents", "-1", spec]).split(" ").slice(1);
const treeHas = (repo: string, spec: string, path: string) =>
  gitOrNull(repo, ["cat-file", "-e", `${spec}:${path}`]) !== null;
/** Does any commit reachable from `spec` carry `path`? */
const historyHas = (repo: string, spec: string, path: string) =>
  git(repo, ["rev-list", spec])
    .split("\n")
    .filter(Boolean)
    .some((c) => treeHas(repo, c, path));
/** Subjects of the starter history `tutorial_demo_create` builds. */
const STARTER_SUBJECTS = [
  "Initial commit",
  "Add project skeleton",
  "Draft intro page",
  "Polish intro wording",
  "Write getting-started guide",
  "Merge branch 'docs/intro'",
  "Add license",
];
/** The one commit reachable from `from` with this subject. */
function bySubject(repo: string, from: string, wanted: string): string {
  const hits = git(repo, ["log", "--format=%H%x09%s", from])
    .split("\n")
    .filter((l) => l.endsWith(`\t${wanted}`))
    .map((l) => l.split("\t")[0]);
  expect(hits, `exactly one "${wanted}" under ${from}`).toHaveLength(1);
  return hits[0];
}
function expectClean(repo: string): void {
  const st = call<StatusDto>("repo_status", { repoPath: repo });
  expect(st.staged).toEqual([]);
  expect(st.changed).toEqual([]);
  expect(st.untracked).toEqual([]);
  expect(st.conflicted).toEqual([]);
}
const headBranch = (repo: string) =>
  call<RefsDto>("list_refs", { repoPath: repo }).head.branch;

/** create → seed files → the user's step-5 commit (stage + commit through the
 *  bridge, as the UI does). */
function demoWithC2(): { repo: string; demo: DemoRepo } {
  const demo = call<DemoRepo>("tutorial_demo_create");
  const repo = demo.repoPath;
  const files = call<string[]>("tutorial_demo_seed_files", { repoPath: repo });
  call("stage_paths", { repoPath: repo, paths: files });
  call("create_commit", {
    repoPath: repo,
    message: "Add starter files",
    amend: false,
  });
  return { repo, demo };
}

// ── The demo script: create → seed files → commit → seed history → log ───────

test.describe("demo script", () => {
  test("create builds repo + bare origin, main pushed, config hidden", () => {
    const demo = call<DemoRepo>("tutorial_demo_create");
    const repo = demo.repoPath;

    // Layout: <base>/demo-<ms>/{repo, origin.git}
    const demoDir = dirname(repo);
    expect(basename(repo)).toBe("repo");
    expect(basename(demoDir)).toMatch(/^demo-\d+$/);
    expect(dirname(demoDir)).toBe(base);
    expect(demo.remotePath).toBe(join(demoDir, "origin.git"));
    expect(git(demo.remotePath, ["rev-parse", "--is-bare-repository"])).toBe(
      "true",
    );

    // Identity, HEAD, single root commit.
    expect(git(repo, ["config", "user.name"])).toBe("ADGitter Learner");
    expect(git(repo, ["config", "user.email"])).toBe("learner@example.com");
    expect(git(repo, ["symbolic-ref", "--short", "HEAD"])).toBe("main");
    // Starter history: C1 - skeleton - guide - merge(docs/intro) - license.
    expect(subject(repo, "HEAD")).toBe("Add license");
    expect(subject(repo, "HEAD~")).toBe("Merge branch 'docs/intro'");
    expect(parents(repo, "HEAD~")).toHaveLength(2);
    expect(subject(repo, "HEAD~2")).toBe("Write getting-started guide");
    expect(subject(repo, "HEAD~3")).toBe("Add project skeleton");
    expect(subject(repo, "HEAD~4")).toBe("Initial commit");
    expect(parents(repo, "HEAD~4")).toEqual([]);
    expect(subject(repo, "docs/intro")).toBe("Polish intro wording");
    expect(subject(repo, "docs/intro~")).toBe("Draft intro page");
    expect(rev(repo, "docs/intro")).toBe(rev(repo, "HEAD~^2"));
    expect(git(repo, ["cat-file", "-t", "v0.0.1"])).toBe("tag");
    expect(rev(repo, "v0.0.1")).toBe(rev(repo, "HEAD~"));
    expect(
      git(demo.remotePath, ["rev-parse", "refs/tags/v0.0.1^{commit}"]),
    ).toBe(rev(repo, "HEAD~"));
    expect(git(demo.remotePath, ["rev-parse", "refs/heads/docs/intro"])).toBe(
      rev(repo, "docs/intro"),
    );
    expect(
      call("branch_upstream", { repoPath: repo, branch: "docs/intro" }),
    ).toBe("origin/docs/intro");
    expect(treeHas(repo, "HEAD", "README.md")).toBe(true);
    expect(treeHas(repo, "HEAD", "docs/intro.md")).toBe(true);
    expect(treeHas(repo, "HEAD", "LICENSE")).toBe(true);
    // Strictly increasing times (a child is newer than each parent).
    const starter = git(repo, ["log", "--format=%H %P|%at"])
      .split("\n")
      .map((l) => {
        const [shas, at] = l.split("|");
        const [sha, ...ps] = shas.split(" ").filter(Boolean);
        return { sha, ps, at: Number(at) };
      });
    expect(new Set(starter.map((r) => r.at)).size).toBe(starter.length);
    for (const r of starter)
      for (const p of r.ps)
        expect(r.at).toBeGreaterThan(starter.find((x) => x.sha === p)!.at);
    expect(git(repo, ["log", "-1", "--format=%an <%ae>|%cn <%ce>"])).toBe(
      "ADGitter Learner <learner@example.com>|ADGitter Learner <learner@example.com>",
    );

    // main is published and tracks origin/main.
    const refs = call<RefsDto>("list_refs", { repoPath: repo });
    expect(refs.branches.find((b) => b.name === "main")?.has_upstream).toBe(
      true,
    );
    expect(call("branch_upstream", { repoPath: repo, branch: "main" })).toBe(
      "origin/main",
    );
    expect(git(demo.remotePath, ["rev-parse", "refs/heads/main"])).toBe(
      rev(repo, "HEAD"),
    );

    // Per-repo config: autoPull off, hidden from status (ignored, not
    // untracked), never committed. Reads back through the bridge command too.
    const cfg = JSON.parse(
      readFileSync(join(repo, "adgitter.config.json"), "utf8"),
    );
    expect(cfg.general.autoPull).toBe("off");
    expect(Object.values(cfg.general.autoPullBefore)).toEqual([
      false,
      false,
      false,
    ]);
    expect(
      JSON.parse(call<string>("read_project_config", { repoPath: repo }))
        .general.autoPull,
    ).toBe("off");
    expect(readFileSync(join(repo, ".git/info/exclude"), "utf8")).toContain(
      "adgitter.config.json\n",
    );
    expect(treeHas(repo, "HEAD", "adgitter.config.json")).toBe(false);
    expectClean(repo);
    const st = call<StatusDto>("repo_status", { repoPath: repo });
    expect(st.ignored.map((e) => e.path)).toContain("adgitter.config.json");

    // A second demo gets its own directory (and replaces this one).
    const second = call<DemoRepo>("tutorial_demo_create");
    expect(second.repoPath).not.toBe(repo);
    expect(existsSync(repo)).toBe(false);
  });

  test("seed files writes three untracked files; seed history builds the scripted topology; simulate_log adds 3 commits without moving HEAD", () => {
    // seed_files: exactly the three untracked files (checked before any
    // commit, on a throwaway demo that the real one below then replaces).
    const probe = call<DemoRepo>("tutorial_demo_create").repoPath;
    expect(
      call<string[]>("tutorial_demo_seed_files", { repoPath: probe }),
    ).toEqual(["src/app.js", "src/style.css", "docs/notes.md"]);
    const seeded = call<StatusDto>("repo_status", { repoPath: probe });
    expect(seeded.untracked.map((e) => e.path).sort()).toEqual([
      "docs/notes.md",
      "src/app.js",
      "src/style.css",
    ]);
    expect(seeded.staged).toEqual([]);
    expect(seeded.changed).toEqual([]);

    const { repo, demo } = demoWithC2();
    expect(existsSync(probe)).toBe(false); // `create` cleared the older demo
    const origin = demo.remotePath;
    const c2 = rev(repo, "HEAD");
    expect(subject(repo, "HEAD")).toBe("Add starter files");
    call("tutorial_demo_seed_history", { repoPath: repo });

    // main: C2 - C3 - C4 - C5, HEAD on main, tree clean (nothing untracked).
    expect(headBranch(repo)).toBe("main");
    expect(subject(repo, "main")).toBe("Update docs");
    expect(subject(repo, "main~")).toBe("Add helpers");
    expect(subject(repo, "main~2")).toBe("Add config");
    expect(rev(repo, "main~3")).toBe(c2);
    expectClean(repo);
    expect(treeHas(repo, "main", "secrets.env")).toBe(true);
    expect(treeHas(repo, "main", "docs/guide.md")).toBe(true);
    expect(treeHas(repo, "main", "docs/notes.md")).toBe(true); // C2's file survives

    // Tags (annotated, resolving to their commits) on C3 / C4.
    const refs = call<RefsDto>("list_refs", { repoPath: repo });
    expect(refs.tags.find((t) => t.name === "v0.1.0")?.target).toBe(
      rev(repo, "main~2"),
    );
    expect(refs.tags.find((t) => t.name === "v0.2.0")?.target).toBe(
      rev(repo, "main~"),
    );
    expect(git(repo, ["cat-file", "-t", "v0.1.0"])).toBe("tag");

    // feature/login from C4, feature/theme from C5, experiment from C2.
    expect(subject(repo, "feature/login")).toBe("Validate login");
    expect(subject(repo, "feature/login~")).toBe("Add login form");
    expect(rev(repo, "feature/login~2")).toBe(rev(repo, "main~"));
    expect(treeHas(repo, "feature/login", "src/login.js")).toBe(true);
    expect(subject(repo, "feature/theme")).toBe("Add theme switch");
    expect(subject(repo, "feature/theme~")).toBe("Add drak theme");
    expect(rev(repo, "feature/theme~2")).toBe(rev(repo, "main"));
    expect(treeHas(repo, "feature/theme~", "themes/dark.css")).toBe(true);
    expect(treeHas(repo, "feature/theme", "themes/switch.js")).toBe(true);
    expect(subject(repo, "experiment")).toBe("Log timings");
    expect(subject(repo, "experiment~")).toBe("Try faster render");
    expect(rev(repo, "experiment~2")).toBe(c2);
    expect(treeHas(repo, "experiment~", "src/render.js")).toBe(true);
    expect(treeHas(repo, "experiment", "src/timing.js")).toBe(true);

    // Exactly these local branches, every one tracking origin/<name>.
    expect(refs.branches.map((b) => b.name).sort()).toEqual([
      "docs/intro",
      "experiment",
      "feature/login",
      "feature/theme",
      "main",
    ]);
    for (const b of [
      "main",
      "docs/intro",
      "feature/login",
      "feature/theme",
      "experiment",
    ]) {
      expect(git(origin, ["rev-parse", `refs/heads/${b}`]), `${b} pushed`).toBe(
        rev(repo, b),
      );
      expect(
        call("branch_upstream", { repoPath: repo, branch: b }),
        `${b} upstream`,
      ).toBe(`origin/${b}`);
      expect(rev(repo, `origin/${b}`)).toBe(rev(repo, b));
    }
    for (const t of ["v0.0.1", "v0.1.0", "v0.2.0"]) {
      expect(
        gitOrNull(origin, ["rev-parse", `refs/tags/${t}`]),
        `${t} pushed`,
      ).not.toBeNull();
    }

    // Seeded commits: learner identity, distinct strictly increasing times,
    // all after C2, a child never older than its parent.
    const rows = git(repo, ["log", "--all", "--format=%H %P|%ae|%at|%s"])
      .split("\n")
      .map((l) => {
        const [shas, email, at, ...subj] = l.split("|");
        const [sha, ...ps] = shas.split(" ").filter(Boolean);
        return { sha, ps, email, at: Number(at), subject: subj.join("|") };
      });
    const bySha = new Map(rows.map((r) => [r.sha, r]));
    const c2Time = bySha.get(c2)!.at;
    const seededRows = rows.filter(
      (r) =>
        r.email === "learner@example.com" &&
        !STARTER_SUBJECTS.includes(r.subject) &&
        r.subject !== "Add starter files",
    );
    expect(seededRows).toHaveLength(9);
    expect(new Set(seededRows.map((r) => r.at)).size).toBe(9);
    for (const r of seededRows) {
      expect(r.at).toBeGreaterThan(c2Time);
      for (const p of r.ps) expect(r.at).toBeGreaterThan(bySha.get(p)!.at);
    }

    // The app's own view (list_commits) agrees: all of them live, none ghost.
    const page = call<{ commits: { subject: string; ghost: boolean }[] }>(
      "list_commits",
      { repoPath: repo },
    );
    expect(page.commits.some((c) => c.ghost)).toBe(false);
    expect(page.commits.map((c) => c.subject)).toContain("Add drak theme");

    // ── simulate_log(3): three chained commits on adgitter-log, HEAD untouched.
    git(repo, ["checkout", "-q", "feature/theme"]);
    const headBefore = rev(repo, "HEAD");
    const indexBefore = readFileSync(join(repo, ".git/index"));
    const shas = call<string[]>("tutorial_demo_simulate_log", {
      repoPath: repo,
      branch: "adgitter-log",
      count: 3,
    });
    expect(shas).toHaveLength(3);
    expect(new Set(shas).size).toBe(3);
    expect(rev(repo, "adgitter-log")).toBe(shas[2]);
    expect(parents(repo, "adgitter-log")).toEqual([shas[1]]);
    expect(parents(repo, shas[1])).toEqual([shas[0]]);
    expect(subject(repo, "adgitter-log")).toMatch(/^log: snapshot/);
    expect(treeHas(repo, "adgitter-log", "scratch.md")).toBe(true);
    expect(treeHas(repo, "adgitter-log", "themes/dark.css")).toBe(true);
    expect(treeHas(repo, "adgitter-log", "adgitter.config.json")).toBe(false);
    // The log branch is its own chain (the first snapshot is a root commit):
    // exactly the three new commits, none of them on feature/theme.
    expect(parents(repo, shas[0])).toEqual([]);
    expect(git(repo, ["rev-list", "--count", "adgitter-log"])).toBe("3");

    // HEAD, the checked-out branch, the on-disk index and the tree are as before.
    expect(headBranch(repo)).toBe("feature/theme");
    expect(rev(repo, "HEAD")).toBe(headBefore);
    expect(readFileSync(join(repo, ".git/index")).equals(indexBefore)).toBe(
      true,
    );
    expect(existsSync(join(repo, "scratch.md"))).toBe(false);
    expectClean(repo);

    // The log branch is a plain local branch without an upstream; a later call
    // keeps chaining onto it.
    const more = call<string[]>("tutorial_demo_simulate_log", {
      repoPath: repo,
      branch: "adgitter-log",
      count: 1,
    });
    expect(parents(repo, more[0])).toEqual([shas[2]]);
    const after = call<RefsDto>("list_refs", { repoPath: repo });
    expect(
      after.branches.find((b) => b.name === "adgitter-log")?.has_upstream,
    ).toBe(false);
  });

  test("seed history does not depend on what the user committed", () => {
    // Only one of the three files committed: the others are cleaned up.
    {
      const demo = call<DemoRepo>("tutorial_demo_create");
      const repo = demo.repoPath;
      const files = call<string[]>("tutorial_demo_seed_files", {
        repoPath: repo,
      });
      call("stage_paths", { repoPath: repo, paths: [files[0]] });
      call("create_commit", { repoPath: repo, message: "Add the app" });
      call("tutorial_demo_seed_history", { repoPath: repo });
      expectClean(repo);
      expect(existsSync(join(repo, "src/style.css"))).toBe(false);
      expect(existsSync(join(repo, "docs/notes.md"))).toBe(false);
      expect(subject(repo, "main~3")).toBe("Add the app");
      expect(existsSync(join(repo, "src/app.js"))).toBe(true);
      expect(existsSync(join(repo, "docs/guide.md"))).toBe(true);
    }
    // The user committed files named like the script's own.
    {
      const repo = call<DemoRepo>("tutorial_demo_create").repoPath;
      call("tutorial_demo_write_file", {
        repoPath: repo,
        path: "docs/guide.md",
        content: "my own guide\n",
      });
      call("tutorial_demo_write_file", {
        repoPath: repo,
        path: "src/login.js",
        content: "// mine\n",
      });
      call("stage_paths", {
        repoPath: repo,
        paths: ["docs/guide.md", "src/login.js"],
      });
      call("create_commit", { repoPath: repo, message: "My commit" });
      call("tutorial_demo_seed_history", { repoPath: repo });
      expectClean(repo);
      expect(subject(repo, "main")).toBe("Update docs");
      expect(subject(repo, "feature/login")).toBe("Validate login");
    }
  });

  test("seed history refuses off-main and a second run; simulate_log refuses bad input", () => {
    const { repo } = demoWithC2();
    git(repo, ["branch", "side", "main"]);
    git(repo, ["checkout", "-q", "side"]);
    expect(() =>
      call("tutorial_demo_seed_history", { repoPath: repo }),
    ).toThrow(/seeded from `main`/);
    git(repo, ["checkout", "-q", "main"]);
    call("tutorial_demo_seed_history", { repoPath: repo });
    expect(() =>
      call("tutorial_demo_seed_history", { repoPath: repo }),
    ).toThrow(/already seeded/);

    const sim = (branch: string, count: number) =>
      call("tutorial_demo_simulate_log", { repoPath: repo, branch, count });
    expect(() => sim("main", 1)).toThrow(/checked out/);
    expect(() => sim("bad name", 1)).toThrow(/invalid branch name/);
    expect(() => sim("x", 21)).toThrow(/at most 20/);
    expect(sim("x", 0)).toEqual([]);
    expect(
      gitOrNull(repo, ["rev-parse", "--verify", "-q", "refs/heads/x"]),
    ).toBeNull();
  });

  test("simulate_log preserves an existing scratch file", () => {
    const { repo } = demoWithC2();
    call("tutorial_demo_write_file", {
      repoPath: repo,
      path: "scratch.md",
      content: "mine\n",
    });
    call("tutorial_demo_simulate_log", {
      repoPath: repo,
      branch: "adgitter-log",
      count: 2,
    });
    expect(readFileSync(join(repo, "scratch.md"), "utf8")).toBe("mine\n");
  });

  test("write_file creates parents and overwrites", () => {
    const repo = call<DemoRepo>("tutorial_demo_create").repoPath;
    const w = (path: string, content: string) =>
      call("tutorial_demo_write_file", { repoPath: repo, path, content });
    w("a/b/c.txt", "one");
    expect(readFileSync(join(repo, "a/b/c.txt"), "utf8")).toBe("one");
    w("a/b/c.txt", "two");
    expect(readFileSync(join(repo, "a/b/c.txt"), "utf8")).toBe("two");
    w("./top.txt", "x");
    expect(existsSync(join(repo, "top.txt"))).toBe(true);
  });
});

// ── The rest of the tutorial, replayed through the bridge ────────────────────

test.describe("the tutorial script on the demo repo", () => {
  test("steps 8–21: merge, rebase, cherry-pick, undo, reset, undo, checkout, purge, add file, reword, rejected push, force push, simulated log", () => {
    const { repo, demo } = demoWithC2();
    const p = { repoPath: repo };
    call("tutorial_demo_seed_history", p);
    expectClean(repo);

    // Step 8: merge feature/login into main (the merge-handle drag).
    const mainBefore = rev(repo, "main");
    const merged = call<OpResult>("merge", { ...p, source: "feature/login" });
    expect(merged.status).toBe("completed");
    expect(parents(repo, "main")).toEqual([
      mainBefore,
      rev(repo, "feature/login"),
    ]);
    expect(subject(repo, "main")).toBe("Merge feature/login");
    expect(treeHas(repo, "main", "src/login.js")).toBe(true);
    expectClean(repo);
    const mergeTip = rev(repo, "main");

    // Step 10a: rebase feature/theme onto main; HEAD is restored to main.
    const rebased = call<OpResult>("rebase_branch", {
      ...p,
      branch: "feature/theme",
      onto: "main",
    });
    expect(rebased.status).toBe("completed");
    expect(headBranch(repo)).toBe("main");
    expect(rev(repo, "feature/theme~2")).toBe(mergeTip);
    expect(subject(repo, "feature/theme~")).toBe("Add drak theme");
    expect(subject(repo, "feature/theme")).toBe("Add theme switch");
    expectClean(repo);

    // Step 10b: cherry-pick E1 onto main.
    const e1 = bySubject(repo, "experiment", "Try faster render");
    call("cherry_pick", { ...p, commits: [e1] });
    expect(subject(repo, "main")).toBe("Try faster render");
    expect(parents(repo, "main")).toEqual([mergeTip]);
    expect(treeHas(repo, "main", "src/render.js")).toBe(true);
    expectClean(repo);

    // Step 11: undo the cherry-pick — the newest backup batch, `cherry-pick`.
    const undone = call<BackupDto>("undo", p);
    expect(undone.op).toBe("cherry-pick");
    expect(undone.original_ref).toBe("refs/heads/main");
    expect(rev(repo, "main")).toBe(mergeTip);
    expect(treeHas(repo, "HEAD", "src/render.js")).toBe(false);
    expectClean(repo);

    // Step 12: reset main to an ancestor on its first-parent line (C4), mixed.
    const c4 = bySubject(repo, "main", "Add helpers");
    call("reset", { ...p, target: c4, mode: "mixed" });
    expect(rev(repo, "main")).toBe(c4);

    // Step 13a: undo the reset (ref AND working tree come back).
    expect(call<BackupDto>("undo", p).op).toBe("reset");
    expect(rev(repo, "main")).toBe(mergeTip);
    expectClean(repo);

    // Step 13b: check out feature/theme.
    call("checkout", { ...p, target: "feature/theme" });
    expect(headBranch(repo)).toBe("feature/theme");
    expectClean(repo);

    // Step 14: purge secrets.env from "Add config" (and everything after it).
    const c3 = bySubject(repo, "HEAD", "Add config");
    expect(treeHas(repo, c3, "secrets.env")).toBe(true);
    const purged = call<{ remapped: string[]; skipped: string[] }>(
      "purge_path",
      { ...p, sha: c3, path: "secrets.env" },
    );
    expect(purged.skipped).toEqual([]);
    expect(purged.remapped).toEqual([
      "refs/heads/feature/login",
      "refs/heads/main",
    ]);
    for (const spec of ["feature/theme", "main", "feature/login"]) {
      expect(
        historyHas(repo, spec, "secrets.env"),
        `${spec} still has it`,
      ).toBe(false);
    }
    expect(headBranch(repo)).toBe("feature/theme");
    expectClean(repo);
    // Tags are not remapped: v0.1.0 keeps the pre-purge commit (secrets.env
    // included), so the graph shows two "Add config" commits.
    expect(treeHas(repo, "v0.1.0", "secrets.env")).toBe(true);
    expect(rev(repo, "v0.1.0")).not.toBe(bySubject(repo, "HEAD", "Add config"));
    // The merge survived the rewrite.
    expect(parents(repo, "main")).toHaveLength(2);
    // The old chain stays alive (as a ghost-or-not-ghost commit) via backups.
    const page = call<{ commits: { sha: string; ghost: boolean }[] }>(
      "list_commits",
      p,
    );
    expect(page.commits.find((c) => c.sha === c3)).toBeDefined();

    // Step 15: write secrets.example.env, then add it into the new "Add config".
    const c3b = bySubject(repo, "HEAD", "Add config");
    expect(treeHas(repo, c3b, "secrets.example.env")).toBe(false);
    call("tutorial_demo_write_file", {
      ...p,
      path: "secrets.example.env",
      content: "API_KEY=\nDB_PASSWORD=\n",
    });
    call("add_file_to_commit", {
      ...p,
      sha: c3b,
      path: "secrets.example.env",
    });
    const c3c = bySubject(repo, "HEAD", "Add config");
    expect(treeHas(repo, c3c, "secrets.example.env")).toBe(true);
    expect(treeHas(repo, "feature/theme", "secrets.example.env")).toBe(true);
    expect(historyHas(repo, "feature/theme", "secrets.env")).toBe(false);
    expectClean(repo);

    // Step 16: reword "Add drak theme" -> "Add dark theme".
    const t1 = bySubject(repo, "HEAD", "Add drak theme");
    const reworded = call<OpResult>("reword", {
      ...p,
      sha: t1,
      message: "Add dark theme",
    });
    expect(reworded.status).toBe("completed");
    expect(subject(repo, "feature/theme~")).toBe("Add dark theme");
    expect(subject(repo, "feature/theme")).toBe("Add theme switch");
    // The typo survives only where it was published.
    expect(
      git(repo, ["log", "--format=%s", "feature/theme"]).split("\n"),
    ).not.toContain("Add drak theme");
    expect(subject(repo, "origin/feature/theme~")).toBe("Add drak theme");
    expectClean(repo);

    // Step 17a: a plain push is rejected — the branch was rewritten.
    const remoteTip = git(demo.remotePath, [
      "rev-parse",
      "refs/heads/feature/theme",
    ]);
    expect(() =>
      call("push", { ...p, remote: "origin", force: false }),
    ).toThrow(/push rejected/);
    expect(
      git(demo.remotePath, ["rev-parse", "refs/heads/feature/theme"]),
    ).toBe(remoteTip);
    expect(rev(repo, "origin/feature/theme")).toBe(remoteTip);

    // Step 17b: force push succeeds, and the tracking ref follows.
    call("push", { ...p, remote: "origin", force: true });
    expect(
      git(demo.remotePath, ["rev-parse", "refs/heads/feature/theme"]),
    ).toBe(rev(repo, "feature/theme"));
    expect(call("ahead_behind", p)).toMatchObject({ ahead: 0, behind: 0 });

    // Steps 19–21: simulated Log Anytime on the (rewritten) feature/theme.
    const shas = call<string[]>("tutorial_demo_simulate_log", {
      ...p,
      branch: "adgitter-log",
      count: 3,
    });
    expect(shas).toHaveLength(3);
    expect(headBranch(repo)).toBe("feature/theme");
    expectClean(repo);

    // Step 23: the issue-preview branch uses the free create_branch + checkout.
    call("create_branch", { ...p, name: "issue-1-gh1", from: "main" });
    call("checkout", { ...p, target: "issue-1-gh1" });
    expect(headBranch(repo)).toBe("issue-1-gh1");
  });

  test("a rewrite and the descendant branches it remapped undo as ONE batch", () => {
    const { repo } = demoWithC2();
    const p = { repoPath: repo };
    call("tutorial_demo_seed_history", p);
    const before = {
      main: rev(repo, "main"),
      login: rev(repo, "feature/login"),
      theme: rev(repo, "feature/theme"),
    };
    // Purge from C3 on main: feature/login (forked from C4) and feature/theme
    // (forked from C5) follow the rewrite as descendants.
    const c3 = bySubject(repo, "main", "Add config");
    const out = call<{ remapped: string[]; skipped: string[] }>("purge_path", {
      ...p,
      sha: c3,
      path: "secrets.env",
    });
    expect(out.remapped).toEqual([
      "refs/heads/feature/login",
      "refs/heads/feature/theme",
    ]);
    expect(rev(repo, "main")).not.toBe(before.main);
    expect(historyHas(repo, "feature/theme", "secrets.env")).toBe(false);
    // Three backups share one batch key.
    const backups = git(repo, [
      "for-each-ref",
      "--format=%(refname)",
      "refs/adgitter/backup/",
    ])
      .split("\n")
      .filter(Boolean);
    expect(backups).toHaveLength(3);
    expect(new Set(backups.map((b) => b.split("/")[3])).size).toBe(1);
    expect(backups.every((b) => b.includes("/purge-path/refs/heads/"))).toBe(
      true,
    );

    expect(call<BackupDto>("undo", p).op).toBe("purge-path");
    expect(rev(repo, "main")).toBe(before.main);
    expect(rev(repo, "feature/login")).toBe(before.login);
    expect(rev(repo, "feature/theme")).toBe(before.theme);
    expect(treeHas(repo, "main", "secrets.env")).toBe(true);
    expectClean(repo);
    // Nothing left to undo.
    expect(call("undo", p)).toBeNull();
  });

  test("undoing add-file puts the injected file back on disk as untracked", () => {
    const { repo } = demoWithC2();
    const p = { repoPath: repo };
    call("tutorial_demo_seed_history", p);
    const c3 = bySubject(repo, "main", "Add config");
    call("tutorial_demo_write_file", {
      ...p,
      path: "secrets.example.env",
      content: "API_KEY=\n",
    });
    call("add_file_to_commit", { ...p, sha: c3, path: "secrets.example.env" });
    expectClean(repo);
    expect(call<BackupDto>("undo", p).op).toBe("add-file");
    expect(readFileSync(join(repo, "secrets.example.env"), "utf8")).toBe(
      "API_KEY=\n",
    );
    const st = call<StatusDto>("repo_status", p);
    expect(st.untracked.map((e) => e.path)).toEqual(["secrets.example.env"]);
  });

  test("a merge that is already up to date leaves no undo entry; a fast-forward keeps one", () => {
    const { repo } = demoWithC2();
    const p = { repoPath: repo };
    call("tutorial_demo_seed_history", p);
    // feature/login's tip is not an ancestor yet → real merge; then it is.
    call("merge", { ...p, source: "feature/login" });
    for (const ref of backupRefs(repo)) git(repo, ["update-ref", "-d", ref]);
    call("merge", { ...p, source: "feature/login" }); // up to date
    expect(backupRefs(repo)).toEqual([]);

    // Fast-forward: a branch strictly ahead of main.
    git(repo, ["branch", "ahead", "main"]);
    git(repo, ["checkout", "-q", "ahead"]);
    writeFileSync(join(repo, "ff.txt"), "ff\n");
    git(repo, ["add", "ff.txt"]);
    git(repo, ["commit", "-q", "-m", "ff"]);
    git(repo, ["checkout", "-q", "main"]);
    call("merge", { ...p, source: "ahead" });
    expect(rev(repo, "main")).toBe(rev(repo, "ahead"));
    expect(backupRefs(repo)).toHaveLength(1);
    expect(call<BackupDto>("undo", p).op).toBe("merge");
    expect(subject(repo, "main")).toBe("Merge feature/login");
  });

  test("a conflicting cherry-pick throws and leaves the tree and branch as they were", () => {
    const { repo } = demoWithC2();
    const p = { repoPath: repo };
    call("tutorial_demo_seed_history", p);
    // Make two branches rewrite the same file differently.
    git(repo, ["checkout", "-q", "-b", "left", "main"]);
    writeFileSync(join(repo, "config.json"), "left\n");
    git(repo, ["commit", "-q", "-am", "left edit"]);
    git(repo, ["checkout", "-q", "-b", "right", "main"]);
    writeFileSync(join(repo, "config.json"), "right\n");
    git(repo, ["commit", "-q", "-am", "right edit"]);
    const tip = rev(repo, "right");
    expect(() =>
      call("cherry_pick", { ...p, commits: [rev(repo, "left")] }),
    ).toThrow(/conflict/);
    expect(rev(repo, "right")).toBe(tip);
    expectClean(repo);
  });
});

test.describe("the rest of the engine the demo can reach", () => {
  test("an explicit rebase plan (reword + squash) melds commits and keeps the parent", () => {
    const { repo } = demoWithC2();
    const p = { repoPath: repo };
    call("tutorial_demo_seed_history", p);
    git(repo, ["checkout", "-q", "feature/login"]);
    const [l1, l2] = [rev(repo, "feature/login~"), rev(repo, "feature/login")];
    const c4 = rev(repo, "feature/login~2");
    const out = call<OpResult>("rebase", {
      ...p,
      onto: c4,
      steps: [
        { commit: l1, action: "reword", message: "Login form" },
        {
          commit: l2,
          action: "squash",
          message: "Login form with validation",
        },
      ],
    });
    expect(out.status).toBe("completed");
    expect(parents(repo, "feature/login")).toEqual([c4]);
    expect(subject(repo, "feature/login")).toBe("Login form with validation");
    expect(git(repo, ["rev-parse", "feature/login^{tree}"])).toBe(
      git(repo, ["rev-parse", `${l2}^{tree}`]),
    );
    expectClean(repo);
    expect(call<BackupDto>("undo", p).op).toBe("rebase");
    expect(rev(repo, "feature/login")).toBe(l2);
  });

  test("amend snapshots the branch first, so it is undoable", () => {
    const { repo } = demoWithC2();
    const p = { repoPath: repo };
    const before = rev(repo, "main");
    call("create_commit", { ...p, message: "Reworded starter", amend: true });
    expect(subject(repo, "main")).toBe("Reworded starter");
    expect(backupRefs(repo)).toHaveLength(1);
    expect(backupRefs(repo)[0]).toMatch(/\/amend\/refs\/heads\/main$/);
    expect(call<BackupDto>("undo", p).op).toBe("amend");
    expect(rev(repo, "main")).toBe(before);
  });

  test("push_branch publishes a named branch without touching HEAD", () => {
    const { repo, demo } = demoWithC2();
    const p = { repoPath: repo };
    call("tutorial_demo_seed_history", p);
    call("tutorial_demo_simulate_log", {
      ...p,
      branch: "adgitter-log",
      count: 2,
    });
    call("push_branch", { ...p, branch: "adgitter-log", remote: "origin" });
    expect(git(demo.remotePath, ["rev-parse", "refs/heads/adgitter-log"])).toBe(
      rev(repo, "adgitter-log"),
    );
    expect(headBranch(repo)).toBe("main");
  });

  test("a conflicting merge throws, restores the tree and leaves no undo entry", () => {
    const { repo } = demoWithC2();
    const p = { repoPath: repo };
    call("tutorial_demo_seed_history", p);
    git(repo, ["checkout", "-q", "-b", "left", "main"]);
    writeFileSync(join(repo, "config.json"), "left\n");
    git(repo, ["commit", "-q", "-am", "left edit"]);
    git(repo, ["checkout", "-q", "-b", "right", "main"]);
    writeFileSync(join(repo, "config.json"), "right\n");
    git(repo, ["commit", "-q", "-am", "right edit"]);
    const tip = rev(repo, "right");
    expect(() => call("merge", { ...p, source: "left" })).toThrow();
    expect(rev(repo, "right")).toBe(tip);
    expect(existsSync(join(repo, ".git/MERGE_HEAD"))).toBe(false);
    expectClean(repo);
    expect(backupRefs(repo)).toEqual([]);
  });
});

function backupRefs(repo: string): string[] {
  return git(repo, [
    "for-each-ref",
    "--format=%(refname)",
    "refs/adgitter/backup/",
  ])
    .split("\n")
    .filter(Boolean);
}

// ── Confinement ──────────────────────────────────────────────────────────────

test.describe("path confinement (refuses anything outside <base>/demo-<ms>/repo)", () => {
  const code = (fn: () => unknown): string | undefined => {
    try {
      fn();
    } catch (e) {
      return (e as { code?: string }).code;
    }
    return undefined;
  };
  const refused = (c: string | undefined) =>
    expect(["INVALID_PATH", "REPO_NOT_FOUND"]).toContain(c);

  test("every command refuses a demo-shaped repo under another base", () => {
    const { repo } = demoWithC2();
    // A perfectly valid demo-shaped repo — but under another base.
    const other = join(root, "elsewhere", "demo-1", "repo");
    mkdirSync(other, { recursive: true });
    git(other, ["init", "-q"]);
    for (const cmd of [
      () => call("tutorial_demo_seed_files", { repoPath: other }),
      () => call("tutorial_demo_seed_history", { repoPath: other }),
      () =>
        call("tutorial_demo_write_file", {
          repoPath: other,
          path: "x.txt",
          content: "x",
        }),
      () =>
        call("tutorial_demo_simulate_log", {
          repoPath: other,
          branch: "log",
          count: 1,
        }),
      () => call("tutorial_demo_remove", { repoPath: other }),
    ]) {
      refused(code(cmd));
    }
    expect(existsSync(other)).toBe(true);
    expect(existsSync(join(other, "x.txt"))).toBe(false);
    expect(existsSync(repo)).toBe(true);
  });

  test("repo paths must be exactly <base>/demo-<digits>/repo", () => {
    const { repo, demo } = demoWithC2();
    const demoDir = dirname(repo);
    for (const bad of [
      base,
      demoDir,
      demo.remotePath,
      // Raw `..` segments (path.join would normalise them away).
      `${repo}/..`,
      `${repo}/../..`,
      `${repo}/../repo/../..`,
      root,
      "/",
    ]) {
      refused(
        code(() =>
          call("tutorial_demo_write_file", {
            repoPath: bad,
            path: "x.txt",
            content: "x",
          }),
        ),
      );
      refused(code(() => call("tutorial_demo_remove", { repoPath: bad })));
    }
    expect(existsSync(demoDir)).toBe(true);
    expect(existsSync(base)).toBe(true);

    // Repo-shaped dirs not named demo-<digits>.
    const fake = join(base, "not-a-demo", "repo");
    mkdirSync(fake, { recursive: true });
    refused(
      code(() =>
        call("tutorial_demo_write_file", {
          repoPath: fake,
          path: "x",
          content: "x",
        }),
      ),
    );
    const fake2 = join(base, "demo-12x", "repo");
    mkdirSync(fake2, { recursive: true });
    refused(code(() => call("tutorial_demo_remove", { repoPath: fake2 })));
    expect(existsSync(fake2)).toBe(true);
  });

  test("write_file refuses paths that escape the repo", () => {
    const { repo } = demoWithC2();
    const outside = join(root, "outside.txt");
    for (const rel of [
      "../outside.txt",
      "../../outside.txt",
      "a/../../outside.txt",
      "a/../../../outside.txt",
      "/etc/adgitter-test",
      outside,
      ".git/config",
      ".git/hooks/pre-commit",
      ".GIT/hooks/pre-commit",
      "sub/.git/config",
      "",
      ".",
      "nul\0byte",
    ]) {
      refused(
        code(() =>
          call("tutorial_demo_write_file", {
            repoPath: repo,
            path: rel,
            content: "pwned",
          }),
        ),
      );
    }
    expect(existsSync(outside)).toBe(false);
    expect(existsSync("/etc/adgitter-test")).toBe(false);
    expect(readFileSync(join(repo, ".git/config"), "utf8")).not.toContain(
      "pwned",
    );
  });

  test("write_file refuses symlink escapes", () => {
    const { repo } = demoWithC2();
    const outside = join(root, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(repo, "link"));
    const write = (path: string) =>
      code(() =>
        call("tutorial_demo_write_file", {
          repoPath: repo,
          path,
          content: "x",
        }),
      );
    refused(write("link/x.txt"));
    refused(write("link/deep/er/x.txt"));
    expect(existsSync(join(outside, "x.txt"))).toBe(false);
    expect(existsSync(join(outside, "deep"))).toBe(false);

    writeFileSync(join(outside, "target.txt"), "original");
    symlinkSync(join(outside, "target.txt"), join(repo, "flink.txt"));
    refused(write("flink.txt"));
    expect(readFileSync(join(outside, "target.txt"), "utf8")).toBe("original");

    // The repo itself linked from inside the base resolves outside it.
    const stolen = join(base, "demo-1");
    mkdirSync(stolen, { recursive: true });
    symlinkSync(outside, join(stolen, "repo"));
    refused(
      code(() =>
        call("tutorial_demo_write_file", {
          repoPath: join(stolen, "repo"),
          path: "x.txt",
          content: "x",
        }),
      ),
    );
    refused(
      code(() =>
        call("tutorial_demo_remove", { repoPath: join(stolen, "repo") }),
      ),
    );
    expect(existsSync(outside)).toBe(true);
  });

  test("write_file refuses every spelling of .git (NTFS aliases, streams)", () => {
    const { repo } = demoWithC2();
    for (const rel of [
      // Trailing dots / spaces are dropped by Windows.
      ".git.",
      ".git ",
      ".git. .",
      ".GIT ",
      ".git...",
      // 8.3 short name.
      "GIT~1",
      "git~1",
      "Git~12",
      "GIT~1.",
      // Alternate data streams.
      ".git::$INDEX_ALLOCATION",
      ".git:stream",
      ".git.:x",
      // Any component, any depth, with a payload underneath.
      "sub/.git.",
      "sub/.git /hooks/pre-commit",
      "sub/GIT~1/hooks/pre-commit",
      ".git./hooks/pre-commit",
      "a/.git::$INDEX_ALLOCATION/hooks/pre-commit",
      // `:` is refused anywhere in a component (streams, drive letters).
      "notes:1.md",
      "dir:x/file.md",
      // A backslash is a separator on Windows, so it splits here too.
      "sub\\.git\\hooks\\pre-commit",
      "sub\\.git.\\config",
      "sub\\GIT~1\\config",
    ]) {
      refused(
        code(() =>
          call("tutorial_demo_write_file", {
            repoPath: repo,
            path: rel,
            content: "pwned",
          }),
        ),
      );
    }
    for (const stray of [
      ".git.",
      ".git ",
      "GIT~1",
      "sub",
      "notes:1.md",
      "dir:x",
    ]) {
      expect(existsSync(join(repo, stray)), `${stray} was created`).toBe(false);
    }
    expect(readFileSync(join(repo, ".git/config"), "utf8")).not.toContain(
      "pwned",
    );
  });

  test("write_file still accepts names that merely resemble .git", () => {
    const { repo } = demoWithC2();
    for (const rel of [
      ".gitignore",
      ".github/workflows/ci.yml",
      ".gitattributes",
      ".gitx",
      "my.git/readme.md",
      "git.md",
      "git~",
      "git~x",
      "git~1x",
      "digit~1",
      "legit~1/a.txt",
      "git/readme.md",
    ]) {
      call("tutorial_demo_write_file", {
        repoPath: repo,
        path: rel,
        content: "ok",
      });
      expect(readFileSync(join(repo, rel), "utf8")).toBe("ok");
    }
  });

  // ── L2: a demo that lost its own repository must not fall through to an
  //    enclosing one (git, like libgit2's discover, walks UP) ────────────────

  test.describe("a demo inside another git repository", () => {
    /** The per-test `root` becomes an enclosing repo on `main` (the base dir
     *  `<root>/tutorial` sits inside it, like a dotfiles repo at `~`). */
    function enclose(): void {
      git(root, ["init", "-q", "-b", "main"]);
      git(root, [
        "-c",
        "user.name=Outer",
        "-c",
        "user.email=outer@example.com",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "outer",
      ]);
    }
    /** Everything the enclosing repo could be changed through. */
    const outerState = () =>
      [
        git(root, ["for-each-ref", "--format=%(refname) %(objectname)"]),
        git(root, ["rev-parse", "HEAD"]),
        git(root, ["status", "--porcelain", "-uall"]),
      ].join("\n--\n");

    /** Every demo command must refuse `repo` and change nothing. */
    function expectAllRefused(repo: string): void {
      const before = outerState();
      for (const cmd of [
        () => call("tutorial_demo_seed_files", { repoPath: repo }),
        () => call("tutorial_demo_seed_history", { repoPath: repo }),
        () =>
          call("tutorial_demo_write_file", {
            repoPath: repo,
            path: "x.txt",
            content: "x",
          }),
        () =>
          call("tutorial_demo_simulate_log", {
            repoPath: repo,
            branch: "log",
            count: 2,
          }),
      ]) {
        refused(code(cmd));
      }
      expect(outerState()).toBe(before);
      for (const leftover of ["src", "docs/notes.md", "x.txt", "scratch.md"]) {
        expect(existsSync(join(repo, leftover)), `${leftover} written`).toBe(
          false,
        );
        expect(existsSync(join(root, leftover)), `${leftover} leaked`).toBe(
          false,
        );
      }
    }

    test("deleting the demo's .git refuses every command and leaves the outer repo alone", () => {
      enclose();
      const { repoPath: repo } = call<DemoRepo>("tutorial_demo_create");
      rmSync(join(repo, ".git"), { recursive: true, force: true });
      // Plain git (and `Repository::discover`) now lands in the outer repo.
      expect(git(repo, ["rev-parse", "--show-toplevel"])).toBe(
        git(root, ["rev-parse", "--show-toplevel"]),
      );
      expectAllRefused(repo);
      // The demo is still removable.
      call("tutorial_demo_remove", { repoPath: repo });
      expect(existsSync(repo)).toBe(false);
    });

    test("an empty .git directory (git keeps walking up) is refused", () => {
      enclose();
      const { repoPath: repo } = call<DemoRepo>("tutorial_demo_create");
      rmSync(join(repo, ".git"), { recursive: true, force: true });
      mkdirSync(join(repo, ".git"));
      expectAllRefused(repo);
    });

    test("a .git file pointing at the enclosing repo's git dir is refused", () => {
      enclose();
      const { repoPath: repo } = call<DemoRepo>("tutorial_demo_create");
      rmSync(join(repo, ".git"), { recursive: true, force: true });
      writeFileSync(join(repo, ".git"), `gitdir: ${join(root, ".git")}\n`);
      expectAllRefused(repo);
    });

    test("a symlinked .git is refused", () => {
      enclose();
      const { repoPath: repo } = call<DemoRepo>("tutorial_demo_create");
      rmSync(join(repo, ".git"), { recursive: true, force: true });
      symlinkSync(join(root, ".git"), join(repo, ".git"));
      expectAllRefused(repo);
    });

    test("an intact demo inside another repo still works", () => {
      enclose();
      const before = git(root, ["for-each-ref"]);
      const { repoPath: repo } = call<DemoRepo>("tutorial_demo_create");
      call("tutorial_demo_write_file", {
        repoPath: repo,
        path: "x.txt",
        content: "x",
      });
      expect(
        call<string[]>("tutorial_demo_seed_files", { repoPath: repo }),
      ).toHaveLength(3);
      expect(
        call<string[]>("tutorial_demo_simulate_log", {
          repoPath: repo,
          branch: "log",
          count: 2,
        }).length,
      ).toBeGreaterThan(0);
      expect(git(root, ["for-each-ref"])).toBe(before);
    });
  });

  test("remove deletes the whole demo directory and only that", () => {
    const a = call<DemoRepo>("tutorial_demo_create");
    // `create` clears older demos, so the neighbour is made by hand.
    const b = join(base, "demo-5", "repo");
    mkdirSync(b, { recursive: true });
    call("tutorial_demo_remove", { repoPath: a.repoPath });
    expect(existsSync(dirname(a.repoPath))).toBe(false); // repo + origin.git gone
    expect(existsSync(b)).toBe(true);
    call("tutorial_demo_remove", { repoPath: a.repoPath }); // already gone: fine
    expect(existsSync(base)).toBe(true);
  });
});

// ── Stale demos ──────────────────────────────────────────────────────────────

test.describe("stale demo cleanup", () => {
  test("create removes abandoned demo-<digits> directories and nothing else", () => {
    mkdirSync(base, { recursive: true });
    // Two abandoned demos, with content (the app was closed mid-tutorial).
    for (const stale of ["demo-1", "demo-1700000000000"]) {
      mkdirSync(join(base, stale, "repo"), { recursive: true });
      mkdirSync(join(base, stale, "origin.git"));
      writeFileSync(join(base, stale, "repo", "README.md"), "stale");
    }
    // Things that are not `demo-<digits>` directories.
    mkdirSync(join(base, "keep", "nested"), { recursive: true });
    writeFileSync(join(base, "keep", "nested", "f.txt"), "keep");
    const keepNames = [
      "demo-",
      "demo-12x",
      "demo-x",
      "my-demo-5",
      "Demo-5",
      "demo-5-",
    ];
    for (const name of keepNames) mkdirSync(join(base, name));
    writeFileSync(join(base, "notes.txt"), "keep");
    // A *file* named like a demo is not a demo directory.
    writeFileSync(join(base, "demo-777"), "keep");
    // A symlink named like a demo: never followed, never removed.
    const outside = join(root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "precious.txt"), "precious");
    symlinkSync(outside, join(base, "demo-123"));

    const fresh = call<DemoRepo>("tutorial_demo_create");

    expect(existsSync(join(base, "demo-1"))).toBe(false);
    expect(existsSync(join(base, "demo-1700000000000"))).toBe(false);
    expect(existsSync(join(fresh.repoPath, ".git"))).toBe(true);
    expect(existsSync(fresh.remotePath)).toBe(true);
    expect(readFileSync(join(base, "keep", "nested", "f.txt"), "utf8")).toBe(
      "keep",
    );
    for (const name of keepNames) {
      expect(existsSync(join(base, name)), `${name} must survive`).toBe(true);
    }
    expect(readFileSync(join(base, "notes.txt"), "utf8")).toBe("keep");
    expect(readFileSync(join(base, "demo-777"), "utf8")).toBe("keep");
    expect(lstatSync(join(base, "demo-123")).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(outside, "precious.txt"), "utf8")).toBe(
      "precious",
    );
  });

  test("create keeps only the newest demo", () => {
    const first = call<DemoRepo>("tutorial_demo_create");
    const second = call<DemoRepo>("tutorial_demo_create");
    expect(second.repoPath).not.toBe(first.repoPath);
    expect(existsSync(first.repoPath)).toBe(false);
    expect(existsSync(join(second.repoPath, ".git"))).toBe(true);
    expect(readdirSync(base)).toHaveLength(1);
  });
});
