/**
 * Demo-repository builder for the guided tutorial, e2e edition.
 *
 * A line-for-line re-derivation of `crates/git-core/src/tutorial_demo.rs` over
 * the REAL system `git` CLI, so the tutorial's e2e run builds exactly the repo
 * the desktop app would (same layout, identity, files, subjects, branches,
 * tags, upstreams, per-repo config, strictly increasing commit times) and
 * enforces the same path confinement. See that file's module docs for the
 * rationale behind each rule; only the deviations are noted here:
 *
 * - `commit.gpgsign` / `tag.gpgsign` are pinned `false` repo-locally so a
 *   developer machine that signs by default cannot make the script prompt
 *   (the fixture repo does the same). Unobservable to the app.
 * - Objects are written with `commit-tree` over a scratch `GIT_INDEX_FILE`
 *   instead of libgit2's tree builder; messages are stored verbatim, as
 *   libgit2 does.
 *
 * The base directory is a per-test temp directory (`TutorialDemoHost`), the
 * stand-in for `<app_data_dir>/tutorial`.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, sep } from "node:path";
import { adgitterError, git, gitOrNull, gitStatus } from "./gitCli";
import {
  commitTree,
  currentBranch,
  logCommit,
  readCommit,
  resolveCommit,
  treeWithBlob,
  type Ident,
} from "./gitOps";

const LEARNER_NAME = "ADGitter Learner";
const LEARNER_EMAIL = "learner@example.com";
const MAIN = "main";

const SEED_FILES: [string, string][] = [
  [
    "src/app.js",
    "// A tiny demo app used by the ADGitter tutorial.\n" +
      "export function greet(name) {\n  return `Hello, ${name}!`;\n}\n\n" +
      'console.log(greet("ADGitter"));\n',
  ],
  [
    "src/style.css",
    "/* Base styles for the demo app. */\n" +
      "body {\n  margin: 0;\n  font-family: system-ui, sans-serif;\n  line-height: 1.5;\n}\n\n" +
      "h1 {\n  font-size: 1.5rem;\n}\n",
  ],
  [
    "docs/notes.md",
    "# Notes\n\n" +
      "- The demo app greets whoever you ask it to.\n" +
      "- Styles live in `src/style.css`.\n" +
      "- Ideas: a login page, a dark theme, faster rendering.\n",
  ],
];

/** File `simulate_log` edits for each simulated snapshot. */
const SIM_FILE = "scratch.md";
/** Upper bound for `simulate_log`'s `count`. */
const SIM_MAX = 20;

const PROJECT_CONFIG_FILENAME = "adgitter.config.json";

/** `serde_json::json!` objects are `BTreeMap`s (no `preserve_order` in this
 *  workspace), so the Rust file has alphabetically sorted keys. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

function demoProjectConfig(): string {
  const cfg = {
    general: {
      autoPull: "off",
      autoPullBefore: { createBranch: false, push: false, commit: false },
      unstaged: "warn",
      undoRedo: 3,
      dryRun: false,
      hideGhosts: false,
      remoteUrl: "",
    },
  };
  return `${JSON.stringify(sortKeys(cfg), null, 2)}\n`;
}

export interface DemoRepo {
  repoPath: string;
  remotePath: string;
}

// ── Confinement ──────────────────────────────────────────────────────────────

const invalid = (msg: string) =>
  adgitterError("INVALID_PATH", `invalid path: ${msg}`);
const repoNotFound = (p: string) =>
  adgitterError("REPO_NOT_FOUND", `repository not found: ${p}`);
const internal = (msg: string) =>
  adgitterError("INTERNAL_ERROR", `internal error: ${msg}`);

/** `demo-<digits>`, the name `createDemo` gives each demo directory. */
function isDemoDirName(name: string): boolean {
  return /^demo-\d+$/.test(name);
}

function checkDemoShape(base: string, demo: string): void {
  if (!(isDemoDirName(basename(demo)) && dirname(demo) === base)) {
    throw invalid(`${demo} is not a tutorial demo directory`);
  }
}

function canonical(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

/** Canonicalise `baseDir` and `repo` and require
 *  `repo == <baseDir>/demo-<digits>/repo`; returns the canonical repo path.
 *  Canonicalising first resolves `..` and symlinks before the comparison. */
function confineRepo(baseDir: string, repo: string): string {
  const base = canonical(baseDir);
  if (base === null) throw invalid(`${baseDir} does not exist`);
  const real = canonical(repo);
  if (real === null) throw repoNotFound(repo);
  const demo = dirname(real);
  if (basename(real) !== "repo" || demo === real) {
    throw invalid(`${real} is not a tutorial demo repository`);
  }
  checkDemoShape(base, demo);
  return real;
}

function isInside(root: string, p: string): boolean {
  return p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);
}

/** Open-guard for the demo repository at `root` (canonical, already confined):
 *  the e2e twin of Rust's `open_demo`. Git (like `Repository::discover`) walks
 *  UP until it finds a repository, so a demo that lost its own `.git` would
 *  silently act on an enclosing one. Require a real `<root>/.git` directory
 *  (not a symlink, not a `.git` file redirecting elsewhere) and that git itself
 *  resolves exactly `root` as the work tree and `<root>/.git` as the git dir
 *  (an empty/invalid `.git` directory makes git keep walking up). */
function openDemo(root: string): void {
  const dotGit = join(root, ".git");
  let meta;
  try {
    meta = lstatSync(dotGit);
  } catch {
    throw repoNotFound(root);
  }
  const resolved = meta.isDirectory()
    ? gitOrNull(root, ["rev-parse", "--show-toplevel", "--absolute-git-dir"])
    : null;
  const [toplevel, gitDir] = (resolved ?? "").split("\n");
  if (
    !toplevel ||
    !gitDir ||
    canonical(toplevel) !== root ||
    canonical(gitDir) !== dotGit
  ) {
    throw invalid(`${root} is not a self-contained tutorial demo repository`);
  }
}

/** `confineRepo` plus `openDemo`'s check, for the functions that only write
 *  files: they must not touch a demo that has lost its repository. */
function confineDemo(baseDir: string, repo: string): string {
  const root = confineRepo(baseDir, repo);
  openDemo(root);
  return root;
}

/** Is this a spelling of `.git` that a Windows (NTFS) filesystem would resolve
 *  to the git directory? Mirrors git's `is_ntfs_dotgit`: trailing dots and
 *  spaces are ignored and the 8.3 short name is `GIT~<n>`. Case-insensitive. */
function isDotGitAlias(segment: string): boolean {
  const name = segment.replace(/[. ]+$/, "");
  return name.toLowerCase() === ".git" || /^git~\d+$/i.test(name);
}

/** Refuse one path component that is, or could be read as, part of `.git`:
 *  `:` anywhere (NTFS alternate data streams such as
 *  `.git::$INDEX_ALLOCATION`, drive letters), and — since a backslash is a
 *  separator on Windows — any `\`-separated piece that is a `.git` alias, so
 *  the verdict never depends on the platform. */
function isForbiddenComponent(part: string): boolean {
  return part.includes(":") || part.split("\\").some(isDotGitAlias);
}

/** Validate a repo-relative path and return it joined onto `repoRoot`. Refuses
 *  absolute paths, `..`, anything under `.git` (in any spelling — see
 *  `isDotGitAlias`), an empty path, and any path that resolves outside the
 *  repository through a symlink. */
function confineRel(repoRoot: string, relPath: string): string {
  if (relPath.length === 0 || relPath.includes("\0")) {
    throw invalid("path must be a non-empty relative path");
  }
  if (
    isAbsolute(relPath) ||
    (process.platform === "win32" && /^[A-Za-z]:|^[\\/]/.test(relPath))
  ) {
    throw invalid(
      `${relPath}: must be relative and stay inside the repository`,
    );
  }
  const parts = relPath
    .split(process.platform === "win32" ? /[\\/]/ : "/")
    .filter((c) => c.length > 0 && c !== ".");
  let normals = 0;
  for (const part of parts) {
    if (part === "..") {
      throw invalid(
        `${relPath}: must be relative and stay inside the repository`,
      );
    }
    if (isForbiddenComponent(part)) {
      throw invalid(`${relPath}: .git is off limits`);
    }
    normals += 1;
  }
  if (normals === 0) throw invalid("path must name a file");
  const target = join(repoRoot, ...parts);

  // A symlink *inside* the repo can still lead out of it: resolve the deepest
  // part of the path that exists and require it to stay under the root.
  let probe = target;
  for (;;) {
    if (existsSync(probe)) break;
    try {
      lstatSync(probe); // dangling symlink: stop here (and fail below)
      break;
    } catch {
      // keep walking up
    }
    const parent = dirname(probe);
    if (parent === probe) throw invalid(`${relPath}: cannot be resolved`);
    probe = parent;
  }
  const resolved = canonical(probe);
  if (resolved === null) throw invalid(`${relPath}: cannot be resolved`);
  if (!isInside(repoRoot, resolved)) {
    throw invalid(`${relPath}: resolves outside the repository`);
  }
  return target;
}

/** Write `content` to `relPath` inside `repoRoot`, creating parent
 *  directories. Never follows a symlink out of the repository. */
function writeConfined(
  repoRoot: string,
  relPath: string,
  content: string,
): void {
  const target = confineRel(repoRoot, relPath);
  try {
    const meta = lstatSync(target);
    if (meta.isSymbolicLink()) throw invalid(`${relPath}: is a symlink`);
    if (meta.isDirectory()) throw invalid(`${relPath}: is a directory`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const parent = dirname(target);
  mkdirSync(parent, { recursive: true });
  // Re-check after creating: the parent now exists, so this is the real
  // resolved location of everything we are about to write under.
  const realParent = canonical(parent);
  if (realParent === null || !isInside(repoRoot, realParent)) {
    throw invalid(`${relPath}: resolves outside the repository`);
  }
  writeFileSync(target, content, "utf8");
}

// ── Building blocks ──────────────────────────────────────────────────────────

const unixSecs = () => Math.floor(Date.now() / 1000);

function learnerAt(secs: number): Ident {
  return { name: LEARNER_NAME, email: LEARNER_EMAIL, date: `${secs} +0000` };
}

/** Creates the scripted commits as loose objects, one tick of the clock each. */
class History {
  constructor(
    private readonly repo: string,
    private nextTime: number,
  ) {}

  /** A commit on top of `parent` adding/replacing `files`; no ref is moved. */
  commit(parent: string, files: [string, string][], message: string): string {
    return this.commitOn([parent], files, message);
  }

  /** Like `commit` with several parents (a merge): the tree starts from the
   *  first parent's and `files` are applied on top. */
  commitOn(
    parents: string[],
    files: [string, string][],
    message: string,
  ): string {
    let tree = readCommit(this.repo, parents[0]).tree;
    for (const [path, content] of files) {
      const blob = git(this.repo, ["hash-object", "-w", "--stdin"], {
        input: content,
      }).trim();
      tree = treeWithBlob(this.repo, tree, path, blob);
    }
    const sig = learnerAt(this.nextTime);
    this.nextTime += 1;
    return commitTree(this.repo, {
      tree,
      parents,
      message,
      author: sig,
      committer: sig,
    });
  }
}

/** Push `branches`/`tags` to `origin`, make sure the remote-tracking refs
 *  exist, and set each branch's upstream to `origin/<branch>`. */
function publish(repo: string, branches: string[], tags: string[]): void {
  const specs = [
    ...branches.map((b) => `refs/heads/${b}:refs/heads/${b}`),
    ...tags.map((t) => `refs/tags/${t}:refs/tags/${t}`),
  ];
  git(repo, ["push", "origin", ...specs], {
    env: { GIT_TERMINAL_PROMPT: "0" },
  });
  for (const branch of branches) {
    const oid = git(repo, ["rev-parse", `refs/heads/${branch}`]).trim();
    git(repo, ["update-ref", `refs/remotes/origin/${branch}`, oid]);
    git(repo, ["branch", `--set-upstream-to=origin/${branch}`, branch]);
  }
}

// ── Public API (the six `tutorial_demo_*` commands) ──────────────────────────

/** Delete every `demo-<digits>` *directory* directly inside `baseDir`: called
 *  from `createDemo` before it makes the new one, so each is a leftover (the
 *  app was closed mid-tutorial). Symlinks are never followed (`lstat`), files
 *  and other names are left alone, and individual failures are ignored. */
function removeStaleDemos(baseDir: string): void {
  let names: string[];
  try {
    names = readdirSync(baseDir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!isDemoDirName(name)) continue;
    const path = join(baseDir, name);
    try {
      if (lstatSync(path).isDirectory()) {
        rmSync(path, { recursive: true, force: true });
      }
    } catch {
      // best effort
    }
  }
}

/** `<baseDir>/demo-<unix_ms>/{repo, origin.git}`: a repo on `main` with one
 *  commit (C1 "Initial commit", `README.md`), a bare `origin`, the push of
 *  `main`, and `origin/main` as its upstream; plus the per-repo project config
 *  that turns auto-pull off (listed in `.git/info/exclude`). Any other
 *  `demo-<digits>` directory in `baseDir` is an abandoned earlier demo and is
 *  deleted first. */
export function createDemo(baseDir: string): DemoRepo {
  mkdirSync(baseDir, { recursive: true });
  removeStaleDemos(baseDir);
  let ms = Date.now();
  let demo: string;
  for (;;) {
    const candidate = join(baseDir, `demo-${ms}`);
    try {
      mkdirSync(candidate);
      demo = candidate;
      break;
    } catch (e) {
      // Two demos in the same millisecond: take the next free name.
      if ((e as NodeJS.ErrnoException).code === "EEXIST") ms += 1;
      else throw e;
    }
  }
  const repoPath = join(demo, "repo");
  const remotePath = join(demo, "origin.git");

  mkdirSync(remotePath);
  git(remotePath, ["init", "--bare", "-q"]);
  git(remotePath, ["symbolic-ref", "HEAD", `refs/heads/${MAIN}`]);

  mkdirSync(repoPath);
  git(repoPath, ["init", "-q"]);
  git(repoPath, ["symbolic-ref", "HEAD", `refs/heads/${MAIN}`]);
  git(repoPath, ["config", "user.name", LEARNER_NAME]);
  git(repoPath, ["config", "user.email", LEARNER_EMAIL]);
  git(repoPath, ["config", "commit.gpgsign", "false"]);
  git(repoPath, ["config", "tag.gpgsign", "false"]);

  // Per-repo settings, hidden from status/commits via `.git/info/exclude`.
  writeFileSync(join(repoPath, PROJECT_CONFIG_FILENAME), demoProjectConfig());
  const info = join(
    git(repoPath, ["rev-parse", "--absolute-git-dir"]).trim(),
    "info",
  );
  mkdirSync(info, { recursive: true });
  const exclude = join(info, "exclude");
  let text = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
  if (text.length > 0 && !text.endsWith("\n")) text += "\n";
  text += `${PROJECT_CONFIG_FILENAME}\n`;
  writeFileSync(exclude, text);

  // Starter history, back-dated a little so the user's own commit (real time)
  // follows it. C1 first, one second apart from here on:
  //
  //   main:       C1 - skeleton - guide ------- merge - license   (tag v0.0.1 @ merge)
  //   docs/intro:          \- draft - polish -/
  const start = unixSecs() - 100;
  writeFileSync(
    join(repoPath, "README.md"),
    "# ADGitter tutorial repository\n\n" +
      "A small practice repository. Nothing here is real, and it is deleted when the " +
      "tutorial ends.\n",
  );
  git(repoPath, ["add", "README.md"]);
  const tree = git(repoPath, ["write-tree"]).trim();
  const sig = learnerAt(start);
  const c1 = commitTree(repoPath, {
    tree,
    parents: [],
    message: "Initial commit",
    author: sig,
    committer: sig,
  });
  git(repoPath, [
    "update-ref",
    "-m",
    "commit (initial)",
    `refs/heads/${MAIN}`,
    c1,
  ]);

  const h = new History(repoPath, start + 1);
  const skeleton = h.commit(
    c1,
    [["package.json", '{\n  "name": "tutorial-demo",\n  "private": true\n}\n']],
    "Add project skeleton",
  );
  const draft = h.commit(
    skeleton,
    [["docs/intro.md", "# Intro\n\nA first draft of the intro page.\n"]],
    "Draft intro page",
  );
  const polishedIntro =
    "# Introduction\n\nWelcome! This page explains what the demo is for.\n";
  const polish = h.commit(
    draft,
    [["docs/intro.md", polishedIntro]],
    "Polish intro wording",
  );
  const guide = h.commit(
    skeleton,
    [
      [
        "docs/getting-started.md",
        "# Getting started\n\n1. Open the repository.\n2. Look at the commit graph.\n",
      ],
    ],
    "Write getting-started guide",
  );
  const merge = h.commitOn(
    [guide, polish],
    [["docs/intro.md", polishedIntro]],
    "Merge branch 'docs/intro'",
  );
  const license = h.commit(
    merge,
    [["LICENSE", "MIT License (demo only; nothing here is real).\n"]],
    "Add license",
  );

  const why = "tutorial demo: starter history";
  git(repoPath, ["update-ref", "-m", why, "refs/heads/docs/intro", polish, ""]);
  const tagger = learnerAt(start + 1);
  git(repoPath, ["tag", "-a", "-m", "Release v0.0.1", "v0.0.1", merge], {
    env: {
      GIT_COMMITTER_NAME: tagger.name,
      GIT_COMMITTER_EMAIL: tagger.email,
      GIT_COMMITTER_DATE: tagger.date,
    },
  });
  git(repoPath, ["update-ref", "-m", why, `refs/heads/${MAIN}`, license]);
  git(repoPath, ["reset", "--hard", license]);

  git(repoPath, ["remote", "add", "origin", remotePath]);
  publish(repoPath, [MAIN, "docs/intro"], ["v0.0.1"]);

  return { repoPath, remotePath };
}

/** Tutorial step 5: write the untracked files the user stages and commits.
 *  Returns their repo-relative paths. */
export function seedFiles(baseDir: string, repo: string): string[] {
  const root = confineDemo(baseDir, repo);
  return SEED_FILES.map(([path, content]) => {
    writeConfined(root, path, content);
    return path;
  });
}

/** Tutorial step 6: build the rest of the demo history on top of whatever
 *  `main` is now (C2, the user's commit) and publish it.
 *
 *  ```
 *  main:           C2 - C3 "Add config" - C4 "Add helpers" - C5 "Update docs"   (tags v0.1.0@C3, v0.2.0@C4)
 *  feature/login:  from C4 - "Add login form" - "Validate login"
 *  feature/theme:  from C5 - "Add drak theme" (typo, on purpose) - "Add theme switch"
 *  experiment:     from C2 - "Try faster render" - "Log timings"
 *  ```
 *
 *  HEAD stays on `main`, hard-reset to C5 so the working tree matches; seeded
 *  files the user chose not to commit are removed so the tree ends clean. */
export function seedHistory(baseDir: string, repoArg: string): void {
  const root = confineRepo(baseDir, repoArg);
  openDemo(root);

  const headRef = currentBranch(root);
  if (headRef !== `refs/heads/${MAIN}`) {
    throw internal(
      `the demo history is seeded from \`${MAIN}\`, but HEAD is on ${headRef}`,
    );
  }
  for (const name of ["feature/login", "feature/theme", "experiment"]) {
    if (
      gitOrNull(root, ["rev-parse", "--verify", "-q", `refs/heads/${name}`])
    ) {
      throw internal(`demo history already seeded (${name} exists)`);
    }
  }

  const c2 = resolveCommit(root, "HEAD");
  const c2Time = Number(git(root, ["log", "-1", "--format=%ct", c2]).trim());
  // Strictly after C2 (which carries real time), then one second apart.
  const h = new History(root, Math.max(c2Time, unixSecs()) + 1);

  // Creation order doubles as the time order: the experiment forks early, the
  // login branch forks from C4, the theme branch from C5.
  const e1 = h.commit(
    c2,
    [
      [
        "src/render.js",
        "export const render = (el) => el.replaceChildren();\n",
      ],
    ],
    "Try faster render",
  );
  const e2 = h.commit(
    e1,
    [
      [
        "src/timing.js",
        "export const time = (label) => console.time(label);\n",
      ],
    ],
    "Log timings",
  );
  const c3 = h.commit(
    c2,
    [
      ["config.json", '{\n  "name": "demo",\n  "debug": false\n}\n'],
      [
        "secrets.env",
        "API_KEY=demo-not-a-real-key\nDB_PASSWORD=demo-not-a-real-password\n",
      ],
    ],
    "Add config",
  );
  const c4 = h.commit(
    c3,
    [
      [
        "src/utils.js",
        "export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));\n",
      ],
    ],
    "Add helpers",
  );
  const l1 = h.commit(
    c4,
    [
      [
        "src/login.js",
        "export function loginForm() {\n  return '<form id=\"login\"></form>';\n}\n",
      ],
    ],
    "Add login form",
  );
  const l2 = h.commit(
    l1,
    [
      [
        "src/login.js",
        "export function loginForm() {\n  return '<form id=\"login\"></form>';\n}\n\n" +
          "export function validate(user, pass) {\n  return user.length > 0 && pass.length >= 8;\n}\n",
      ],
    ],
    "Validate login",
  );
  const c5 = h.commit(
    c4,
    [
      [
        "docs/guide.md",
        "# Guide\n\nRun the app, then open the page. See `notes.md` for ideas.\n",
      ],
    ],
    "Update docs",
  );
  const t1 = h.commit(
    c5,
    [["themes/dark.css", "body {\n  background: #111;\n  color: #eee;\n}\n"]],
    "Add drak theme",
  );
  const t2 = h.commit(
    t1,
    [
      [
        "themes/switch.js",
        "export const toggle = () => document.body.classList.toggle('dark');\n",
      ],
    ],
    "Add theme switch",
  );

  // Objects are all written; only now move refs, so a failure above leaves the
  // repository untouched. An empty old-value = "must not exist".
  for (const [name, oid] of [
    ["feature/login", l2],
    ["feature/theme", t2],
    ["experiment", e2],
  ] as const) {
    git(root, [
      "update-ref",
      "-m",
      "tutorial demo: seed history",
      `refs/heads/${name}`,
      oid,
      "",
    ]);
  }
  const tagger = learnerAt(Math.max(c2Time, unixSecs()));
  for (const [name, oid] of [
    ["v0.1.0", c3],
    ["v0.2.0", c4],
  ] as const) {
    git(root, ["tag", "-a", "-m", `Release ${name}`, name, oid], {
      env: {
        GIT_COMMITTER_NAME: tagger.name,
        GIT_COMMITTER_EMAIL: tagger.email,
        GIT_COMMITTER_DATE: tagger.date,
      },
    });
  }

  // Move `main` to C5 and bring index + working tree with it.
  git(root, ["reset", "--hard", c5]);

  // A hard reset leaves untracked files alone: drop the seeded files the user
  // did not commit so the tree really is clean.
  for (const [path] of SEED_FILES) {
    const untracked = git(root, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
      path,
    ]).trim();
    if (untracked.length > 0) rmSync(join(root, path), { force: true });
  }

  publish(
    root,
    [MAIN, "feature/login", "feature/theme", "experiment"],
    ["v0.1.0", "v0.2.0"],
  );
}

/** Write one file inside the demo repo (`relPath` is repo-relative). */
export function writeFile(
  baseDir: string,
  repo: string,
  relPath: string,
  content: string,
): void {
  writeConfined(confineDemo(baseDir, repo), relPath, content);
}

/** Tutorial step 20: append `count` simulated Log Anytime snapshots to
 *  `branch` and return their shas, oldest first.
 *
 *  Each round edits `scratch.md` in the working tree, then calls the real
 *  `log_commit` equivalent, so the snapshots are exactly what the timer would
 *  have produced; afterwards the file is put back as it was (deleted if it did
 *  not exist), leaving the tree as clean as before. `branch` must be a valid
 *  branch name other than the checked-out one. */
export function simulateLog(
  baseDir: string,
  repo: string,
  branch: string,
  count: number,
): string[] {
  const root = confineRepo(baseDir, repo);
  openDemo(root);
  if (count > SIM_MAX) {
    throw internal(`at most ${SIM_MAX} simulated snapshots at a time`);
  }
  if (gitStatus(root, ["check-ref-format", `refs/heads/${branch}`]) !== 0) {
    throw internal(`invalid branch name: ${branch}`);
  }
  if (currentBranch(root) === `refs/heads/${branch}`) {
    throw internal(
      `${branch} is checked out — a simulated log would rewrite the user's branch`,
    );
  }

  const simPath = confineRel(root, SIM_FILE);
  const original = existsSync(simPath) ? readFileSync(simPath) : null;
  const shas: string[] = [];
  try {
    for (let i = 1; i <= count; i++) {
      let text = original ? original.toString("utf8") : "";
      for (let n = 1; n <= i; n++) {
        text += `Edit ${n}: tweaked the demo while Log Anytime was on.\n`;
      }
      writeConfined(root, SIM_FILE, text);
      // Like `log_commit`, git walks up: re-verify right before each round.
      openDemo(root);
      const sha = logCommit(root, branch);
      if (sha !== null) shas.push(sha);
    }
  } finally {
    // Restore the working tree whatever happened above.
    if (original) writeFileSync(simPath, original);
    else rmSync(simPath, { force: true });
  }
  return shas;
}

/** Delete the whole `demo-<ms>` directory that contains `repo` (working
 *  repository and `origin.git`). Already-gone is success. */
export function removeDemo(baseDir: string, repo: string): void {
  const base = canonical(baseDir);
  if (base === null) throw invalid(`${baseDir} does not exist`);
  const notADemo = () => invalid(`${repo} is not a tutorial demo repository`);
  if (basename(repo) !== "repo") throw notADemo();
  const demoRaw = dirname(repo);
  const demo = canonical(demoRaw);
  if (demo === null) return; // nothing there to delete
  checkDemoShape(base, demo);
  // A `repo` that exists must really be `<demo>/repo` — not a link elsewhere.
  const real = canonical(repo);
  if (real !== null && real !== join(demo, "repo")) throw notADemo();
  rmSync(demo, { recursive: true, force: true });
}

// ── Host: the per-test base directory ────────────────────────────────────────

/**
 * Owns the base directory the six commands confine to — the e2e stand-in for
 * `<app_data_dir>/tutorial`. With no `baseDir` it lazily creates
 * `<os tmp>/adgitter-e2e-tutorial-XXXXXX/tutorial` and `dispose()` removes the
 * whole thing; an explicit `baseDir` is created on use but left to the caller.
 */
export class TutorialDemoHost {
  private root: string | null = null;

  constructor(private readonly baseOverride?: string) {}

  /** The confinement base, created on first use (`tutorial_base_dir`). */
  baseDir(): string {
    if (this.baseOverride) {
      mkdirSync(this.baseOverride, { recursive: true });
      return this.baseOverride;
    }
    if (this.root === null) {
      this.root = mkdtempSync(join(tmpdir(), "adgitter-e2e-tutorial-"));
    }
    const base = join(this.root, "tutorial");
    mkdirSync(base, { recursive: true });
    return base;
  }

  create = (): DemoRepo => createDemo(this.baseDir());
  seedFiles = (repo: string): string[] => seedFiles(this.baseDir(), repo);
  seedHistory = (repo: string): void => seedHistory(this.baseDir(), repo);
  writeFile = (repo: string, path: string, content: string): void =>
    writeFile(this.baseDir(), repo, path, content);
  simulateLog = (repo: string, branch: string, count: number): string[] =>
    simulateLog(this.baseDir(), repo, branch, count);
  remove = (repo: string): void => removeDemo(this.baseDir(), repo);

  /** Remove the temp root this host created (no-op for an explicit base). */
  dispose(): void {
    if (this.root !== null) {
      rmSync(this.root, { recursive: true, force: true });
      this.root = null;
    }
  }
}
