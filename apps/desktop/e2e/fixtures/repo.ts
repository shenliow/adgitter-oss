/**
 * Fixture repository generator for the e2e suite.
 *
 * Builds a real, on-disk git repository (via synchronous `execFileSync` calls
 * to the system `git`) with a small history that exercises every feature the
 * specs under `e2e/*.spec.ts` smoke: multiple authors (row emails), a branch
 * with no upstream (cloud-off chip), a long branch name (chip clipping), a
 * lightweight tag, a bare "origin" remote with a remote-only branch (the
 * checkout-remote-branch dialog), and a GHOST commit kept alive only by a
 * `refs/adgitter/backup/*` ref (mirrors `crates/git-core/src/git.rs`'s
 * `list_commits` ghost rule, which the bridge in `e2e/bridge.ts` re-derives
 * with real `git` commands).
 *
 * Also builds the gesture-operations fixtures (merge/rebase/cherry-pick/
 * remove/reset/checkout): a `topic` branch diverged from `main` for
 * merge/rebase/cherry-pick material, a `disposable` branch safe to delete, a
 * `dropTarget`/`afterDrop` commit pair that can be cleanly dropped without a
 * rebase conflict, and an uncommitted, untracked working-tree file for the
 * commit-flow specs. See each field's doc comment on `FixtureRepo` below for
 * why they're shaped the way they are (conflict-avoidance mostly).
 *
 * Every test gets a FRESH repo (see `e2e/helpers.ts`) — this module has no
 * shared state.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface FixtureCommit {
  sha: string;
  subject: string;
}

export interface FixtureRepo {
  /** Working-tree directory — pass this as `repoPath` to `installBridge`. */
  dir: string;
  /** The bare "origin" remote's directory. */
  bareDir: string;
  /** The 6 commits on `main`, oldest first. */
  mainCommits: FixtureCommit[];
  /** The GHOST commit's sha — reachable only via `refs/adgitter/backup/*`. */
  ghostSha: string;
  /** Lightweight tag name, pointing at `mainCommits[4]`. */
  tag: string;
  /** Local branch with NO upstream configured. */
  noUpstreamBranch: string;
  /** Local branch whose name is >16 chars (chip-clipping fixture). */
  longBranch: string;
  /** Remote branch that exists ONLY on `origin` (no local branch of the same
   *  name) — `origin/<remoteOnlyBranch>`, the checkout-remote-branch fixture. */
  remoteOnlyBranch: string;
  /** Local branch diverged from `main` at `mainCommits[3]` by 2 commits of
   *  its own (on a path `main` never touches) — merge/rebase/cherry-pick
   *  material with zero conflict risk. */
  topicBranch: string;
  /** `topicBranch`'s own 2 commits, oldest first. */
  topicCommits: FixtureCommit[];
  /** Local branch safe to delete: never checked out, never merged, no
   *  upstream — the Remove-branch fixture. */
  disposableBranch: string;
  /** A `main` commit that can be DROPPED without a rebase conflict: it (and
   *  `afterDrop`, its only descendant) each touch their own dedicated path,
   *  never `file.txt` — every one of the 6 `mainCommits` fully overwrites
   *  that same path, so dropping any of THEM and replaying what follows
   *  3-way-conflicts (two unrelated full-file rewrites against one base).
   *  This pair is the Remove-commit fixture's safe alternative. */
  dropTarget: FixtureCommit;
  /** The commit right after `dropTarget` on `main` — replayed when
   *  `dropTarget` is dropped; asserts the "descendants survive" half of the
   *  drop-commit gesture. */
  afterDrop: FixtureCommit;
  /** An UNCOMMITTED, untracked file left in the working tree — the
   *  commit-flow fixture. Untracked (not a modification
   *  to an existing tracked path) so it can never block a branch checkout,
   *  unlike editing `file.txt`, whose content differs across every fixture
   *  branch/commit. */
  uncommittedFile: string;
}

function git(dir: string, args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    // Quiet by default — `push`/`checkout -b`/etc. narrate to stderr, which
    // would otherwise spam the Playwright test report on every run.
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function headSha(dir: string): string {
  return git(dir, ["rev-parse", "HEAD"]);
}

let commitSeq = 0;

/** Stage every change and commit, pinning author + committer dates so
 *  ordering is fully deterministic (git's 1s timestamp resolution could
 *  otherwise tie two fast sequential commits together). */
function commitWithDate(
  dir: string,
  path: string,
  content: string,
  subject: string,
  author: { name: string; email: string },
): string {
  commitSeq += 1;
  const date = `2024-01-01T00:${String(Math.floor(commitSeq / 60)).padStart(2, "0")}:${String(commitSeq % 60).padStart(2, "0")}Z`;
  writeFileSync(join(dir, path), content);
  git(dir, ["add", "-A"]);
  execFileSync(
    "git",
    [
      "-C",
      dir,
      "commit",
      "--no-gpg-sign",
      "-m",
      subject,
      "--author",
      `${author.name} <${author.email}>`,
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      },
    },
  );
  return headSha(dir);
}

const AUTHORS = [
  { name: "Alice Anders", email: "alice@example.com" },
  { name: "Bob Baker", email: "bob@example.com" },
  { name: "Carol Chen", email: "carol@example.com" },
  { name: "Dave Diaz", email: "dave@example.com" },
  { name: "Alice Anders", email: "alice@example.com" },
  { name: "Eve Evans", email: "eve@example.com" },
];

const SUBJECTS = [
  "Initial commit",
  "Add README",
  "Implement core parser",
  "Fix off-by-one bug",
  "Add tests for parser",
  "Polish CLI output",
];

/** Build a fresh fixture repository at `dir` (must already exist and be
 *  empty — `e2e/helpers.ts` creates it via `fs.mkdtempSync` per test). */
export function makeFixtureRepo(dir: string): FixtureRepo {
  commitSeq = 0;

  git(dir, ["init", "-q"]);
  // Deterministic default branch regardless of the machine's
  // `init.defaultBranch` — set before the first commit, always safe on an
  // unborn HEAD.
  git(dir, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  // Repo-local identity + no gpg signing, so this never depends on (or
  // pollutes) the machine's global git config.
  git(dir, ["config", "user.name", "ADGitter Fixture"]);
  git(dir, ["config", "user.email", "fixture@adgitter.test"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  git(dir, ["config", "tag.gpgsign", "false"]);

  const mainCommits: FixtureCommit[] = [];
  for (let i = 0; i < SUBJECTS.length; i++) {
    const sha = commitWithDate(
      dir,
      "file.txt",
      `${SUBJECTS[i]}\n`,
      SUBJECTS[i],
      AUTHORS[i],
    );
    mainCommits.push({ sha, subject: SUBJECTS[i] });
  }

  // Branch with NO upstream — deliberately never pushed/tracked.
  const noUpstreamBranch = "feature-x";
  git(dir, ["branch", noUpstreamBranch, mainCommits[3].sha]);

  // Branch whose name is >16 chars — MetroGraph's chip-clipping fixture.
  const longBranch = "feature/very-long-branch-name-here";
  git(dir, ["branch", longBranch, mainCommits[5].sha]);

  // Lightweight tag.
  const tag = "v1.0";
  git(dir, ["tag", tag, mainCommits[4].sha]);

  // Bare "origin" remote + push main (also sets main's upstream, so it
  // visibly contrasts with `noUpstreamBranch`'s lack of one).
  const bareDir = `${dir}-origin.git`;
  mkdirSync(bareDir, { recursive: true });
  execFileSync("git", ["init", "--bare", "-q", bareDir], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  git(dir, ["remote", "add", "origin", bareDir]);
  git(dir, ["push", "-u", "origin", "main"]);
  // Give the long-name branch an upstream too, purely for contrast with
  // `noUpstreamBranch` (any upstream works — origin/main already exists).
  git(dir, ["branch", "--set-upstream-to=origin/main", longBranch]);

  // Remote-only branch: push a local branch under a different remote name,
  // then delete the local copy — only `origin/<remoteOnlyBranch>` survives.
  const remoteOnlyBranch = "remote-only";
  const remoteOnlyTemp = "remote-only-tmp";
  git(dir, ["branch", remoteOnlyTemp, mainCommits[1].sha]);
  git(dir, [
    "push",
    "origin",
    `${remoteOnlyTemp}:refs/heads/${remoteOnlyBranch}`,
  ]);
  git(dir, ["branch", "-D", remoteOnlyTemp]);
  git(dir, ["fetch", "origin"]); // guarantee refs/remotes/origin/* is populated

  // GHOST commit: committed on a temp branch, kept alive only by a backup
  // ref, then the temp branch itself is deleted — mirrors how a real
  // history-rewrite op (reword/rebase/drop/etc.) orphans the old tip until
  // its backup ref expires (crates/git-core/src/mutate.rs).
  const ghostBranch = "tmp-ghost";
  git(dir, ["checkout", "-b", ghostBranch]);
  const ghostSha = commitWithDate(
    dir,
    "secret.txt",
    "super-secret-token\n",
    "Committed a secret (to be purged)",
    { name: "Frank Ford", email: "frank@example.com" },
  );
  const backupRef = `refs/adgitter/backup/${Date.now()}-1/reword/refs-heads-main`;
  git(dir, ["update-ref", backupRef, ghostSha]);
  git(dir, ["checkout", "main"]);
  git(dir, ["branch", "-D", ghostBranch]);

  // Two more `main`-tip commits, each on its OWN dedicated path — safe replay
  // material for the "drop a commit" gesture (see `dropTarget`'s doc comment
  // above: dropping any of the 6 `mainCommits` and replaying what follows
  // 3-way-conflicts, since they all fully rewrite the same `file.txt`).
  const dropTargetSubject = "Add drop-test scratch file";
  const dropTargetSha = commitWithDate(
    dir,
    "drop-target.txt",
    "drop me\n",
    dropTargetSubject,
    AUTHORS[2],
  );
  const dropTarget: FixtureCommit = {
    sha: dropTargetSha,
    subject: dropTargetSubject,
  };
  const afterDropSubject = "Follow-up after the drop-test commit";
  const afterDropSha = commitWithDate(
    dir,
    "after-drop.txt",
    "kept\n",
    afterDropSubject,
    AUTHORS[3],
  );
  const afterDrop: FixtureCommit = {
    sha: afterDropSha,
    subject: afterDropSubject,
  };

  // Side branch diverged from `main` at `mainCommits[3]` — merge/rebase/
  // cherry-pick material. Its own commits live on `topic.txt`, a path none
  // of `main`'s commits ever touch, so merging/rebasing across the
  // divergence never conflicts.
  const topicBranch = "topic";
  git(dir, ["checkout", "-q", "-b", topicBranch, mainCommits[3].sha]);
  const topicSubjects = ["Topic: add login flow", "Topic: fix login bug"];
  const topicCommits: FixtureCommit[] = topicSubjects.map((subject) => ({
    sha: commitWithDate(dir, "topic.txt", `${subject}\n`, subject, AUTHORS[1]),
    subject,
  }));
  git(dir, ["checkout", "main"]);

  // Branch safe to delete (Remove-branch fixture): never checked out, never
  // merged, no upstream.
  const disposableBranch = "disposable";
  git(dir, ["branch", disposableBranch, afterDropSha]);

  // Keep `origin/main` in sync with the extra tip commits — harmless, and
  // avoids a spurious "ahead" state if a future spec checks it.
  git(dir, ["push", "origin", "main"]);

  // An UNCOMMITTED, untracked file in the working tree (Commit-flow fixture,
  // gesture 1b) — added LAST so no `commitWithDate`'s `git add -A` above ever
  // sweeps it up.
  const uncommittedFile = "scratch-notes.txt";
  writeFileSync(join(dir, uncommittedFile), "unsaved notes\n");

  return {
    dir,
    bareDir,
    mainCommits,
    ghostSha,
    tag,
    noUpstreamBranch,
    longBranch,
    remoteOnlyBranch,
    topicBranch,
    topicCommits,
    disposableBranch,
    dropTarget,
    afterDrop,
    uncommittedFile,
  };
}
