/**
 * Low-level helpers over the system `git` CLI, shared by the e2e bridge
 * (`e2e/bridge.ts`) and its helper modules (`e2e/gitRewrite.ts`,
 * `e2e/tutorialDemo.ts`). No app logic lives here — just "run git in this
 * repo and give me the text back".
 */
import { execFileSync, spawnSync } from "node:child_process";

export interface GitOptions {
  /** Extra environment variables (merged over `process.env`). */
  env?: Record<string, string>;
  /** Bytes/text piped to git's stdin (`commit-tree -F -`, `hash-object --stdin`). */
  input?: string | Buffer;
}

/** Run `git -C <repoPath> <args>`; returns stdout (untrimmed), throws on a
 *  non-zero exit with git's stderr in the message. */
export function git(
  repoPath: string,
  args: string[],
  opts: GitOptions = {},
): string {
  return execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    // `input` needs a piped stdin; everything else keeps it closed so a stray
    // prompt can never hang a test.
    stdio: [opts.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    input: opts.input,
    env: opts.env ? { ...process.env, ...opts.env } : undefined,
  });
}

/** Like `git`, but returns `null` instead of throwing (e.g. `rev-parse` on a
 *  ref that doesn't exist — "not configured" rather than an error). */
export function gitOrNull(
  repoPath: string,
  args: string[],
  opts: GitOptions = {},
): string | null {
  try {
    return git(repoPath, args, opts).trim();
  } catch {
    return null;
  }
}

/** Exit status of `git -C <repoPath> <args>` without throwing (0 = success). */
export function gitStatus(repoPath: string, args: string[]): number {
  const r = spawnSync("git", ["-C", repoPath, ...args], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  return r.status ?? 1;
}

/** Non-empty trimmed lines. */
export function lines(s: string): string[] {
  return s
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** An error shaped like the real `AdgitterError` (`{code, message}`). Note
 *  Playwright's `exposeFunction` only carries `message` across to the page, so
 *  the text is what the app actually sees; `code` is kept for in-process
 *  callers (the bridge-level test). */
export function adgitterError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}
