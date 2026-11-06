# End-to-end tests (Playwright)

## Why not `tauri-driver`?

`tauri-driver` needs a native WebDriver server for the platform's WebView.
On Linux that's WebKitWebDriver; on Windows, msedgedriver. **macOS has none** —
WKWebView exposes no WebDriver protocol — so `tauri-driver` cannot drive the
desktop app on this platform at all. Since ADGitter's dev/CI target here is
macOS, these tests instead:

1. Run the real Svelte frontend in a real, headless Chromium (Playwright) —
   real DOM, real CSS, real mouse/keyboard/drag gestures.
2. Replace every Tauri API import (`@tauri-apps/api/core`, `.../event`,
   `.../window`, `plugin-store`, `plugin-dialog`, `plugin-deep-link`) with a
   thin shim (`e2e/shims/*.ts`), wired in ONLY via `vite.e2e.config.ts`'s
   `resolve.alias` — the production `vite.config.ts` (and `pnpm build`) is
   untouched.
3. Route every `invoke(cmd, args)` call through `window.__E2E_INVOKE__`
   (`e2e/shims/core.ts`) to a Node-side bridge (`e2e/bridge.ts`) that Playwright
   installs via `page.exposeFunction`.
4. For the commands the specs actually exercise (`list_commits`, `list_refs`,
   `checkout`, `create_branch`, `checkout_remote_branch`, `create_tag`,
   `rename_branch`, `delete_branch`, `list_commit_files`, `ahead_behind`,
   `repo_status`, `stage_paths`, `unstage_paths`, `discard_paths`,
   `create_commit`, `merge`, `reset`, `cherry_pick`, `rebase_onto`,
   `drop_commit`), the bridge shells out to the **real system `git`** against
   a fixture repository generated fresh per test (`e2e/fixtures/repo.ts`).
   Everything else resolves a benign default mirroring
   `src/test/appHarness.ts`'s jsdom mocks (see `e2e/bridge.ts`'s doc comment
   for the full list and the one deliberate exception: `verify_license`
   returns an active enterprise entitlement so paid features aren't locked
   behind an upsell in these tests).

This means a passing spec proves real DOM/CSS/gesture behavior wired to real
git semantics (a checkout really moves `HEAD`, a remote-checkout really sets
an upstream, etc.) — without needing a WebDriver this platform doesn't have.

## Scope: user operations only

This suite covers **user operations** — a spec must drive a gesture (click /
double-click / right-click menu / keyboard / drag-and-drop) and then assert
the **real git outcome** via the CLI from Node. Pure-rendering assertions
("does the graph show N rows", "does a chip clip its label") are vitest's job
(`src/**/*.test.ts`, jsdom) — the former `graph.spec.ts` and the render-only
half of `branches.spec.ts` were removed for exactly that reason; the
checkout-on-click test that made `branches.spec.ts` worth keeping moved into
`checkout.spec.ts`.

## Operations coverage (the drag-and-drop rules)

| #   | Operation     | Gesture covered                                                             | Menu/other covered                                                | Spec                   |
| --- | ------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------- |
| 1   | Commit        | — (1a file-drag: no drag source exists in FilesPanel — see the spec header) | 1b "+"-circle checkbox dialog; Changes-panel stage + commit bar   | `commit.spec.ts`       |
| 2   | Rebase        | Shift-drag branch chip → current-branch chip                                | — (covered via drag; right-click `Rebase onto…` exists too)       | `merge-rebase.spec.ts` |
| 3   | Merge         | plain-drag branch chip → current-branch chip                                | right-click chip → `Merge {branch} into…` → target                | `merge-rebase.spec.ts` |
| 4   | Cherry-pick   | Alt-drag commit node → current-branch chip                                  | right-click commit → `Cherry-pick onto {branch}`                  | `cherry-pick.spec.ts`  |
| 5   | Checkout      | double-click branch chip; Branches-panel row click                          | right-click commit → `Checkout` → detached                        | `checkout.spec.ts`     |
| 6   | Remove branch | select chip + `Delete` key                                                  | — (no remove-branch menu item exists — see the spec header)       | `remove.spec.ts`       |
| 7   | Remove commit | select row + `Delete` key                                                   | right-click commit → `Drop this commit`                           | `remove.spec.ts`       |
| 8   | Reset         | drag HEAD crown → commit node (plain = mixed, Shift = hard)                 | — (drag-reset runs immediately, no confirm — see the spec header) | `reset.spec.ts`        |

Plus `menus.spec.ts` (context-menu viewport clamping under right-click),
`remote-checkout.spec.ts` (remote-branch checkout dialog), and
`settings.spec.ts` (settings toggles/selects — user operations against the
settings store).

## The `html5Drag` helper (`e2e/dnd.ts`)

MetroGraph's gesture grammar (`src/lib/dragDispatch.ts`) disambiguates
merge/rebase/cherry-pick/reset by the **modifier keys held during
dragover/drop**. Playwright's `Locator.dragTo()`/mouse API cannot hold
modifiers through a native HTML5 drag session, so `html5Drag(page, source,
target, {shift, alt, meta, ctrl})` dispatches synthetic `DragEvent`s instead
— dragstart (source) → dragover (target) → drop (target) → dragend (source)
— sharing one real `DataTransfer` across all four and setting the modifier
flags on every event (the component reads them on both `dragover` — for the
live affordance — and `drop` — for the dispatched op). See the module doc
comment in `e2e/dnd.ts` for the full rationale.

## What this does NOT cover

The Rust layer (`crates/git-core`, the Tauri command handlers in
`apps/desktop/src-tauri`) is **not exercised at all** by this suite — it's
already covered by `cargo test --workspace`. The bridge's git-command
implementations are independent re-derivations (in TypeScript, over the CLI)
of the same semantics, kept as faithful as practical (e.g. the ghost-commit
rule mirrors `crates/git-core/src/git.rs`'s `list_commits` exactly: a commit
reachable only via `refs/adgitter/*` renders `ghost: true`) — they are a
**test double**, not the real IPC command, so a bug unique to the Rust
implementation (vs. this bridge's understanding of it) would not be caught
here.

Also out of scope: anything behind a real native dialog (file picker, OAuth
browser flow), real filesystem-watcher events (`repo-changed` never fires —
mutations happen via direct git calls from Node, not from a watched
filesystem inside the WebView), and Log-Anytime/telemetry/crash-reporting
(their IPC commands resolve benign defaults, never real behavior).

## Running

```sh
pnpm --filter desktop e2e          # headless, all specs
pnpm --filter desktop e2e:ui       # Playwright's interactive UI mode
```

(Or `cd apps/desktop && pnpm e2e`.) The first run needs Chromium installed:

```sh
pnpm --filter desktop exec playwright install chromium
```

`pnpm e2e` starts its own dev server (`vite.e2e.config.ts` on port 4173) via
Playwright's `webServer` config and tears it down after — no manual `pnpm dev`
needed first. These specs are **not** part of `pnpm test` (vitest) — they
live under `e2e/*.spec.ts`, outside vitest's `src/**/*.{test,spec}.ts` include
glob, and are excluded from `svelte-check`'s `tsconfig.json` scope (still
covered by `pnpm lint`/`pnpm fmt`, which include the `e2e/` directory).

## The fixture repo

`e2e/fixtures/repo.ts`'s `makeFixtureRepo(dir)` builds a fresh, real git
repository per test (via synchronous `git` CLI calls — no libgit2/Node git
binding):

- 6 commits on `main`, distinct subjects + authors (own commit each), with
  pinned author/committer dates for fully deterministic ordering.
- `feature-x` — a local branch with **no upstream** configured (the
  Branches-panel cloud-off ☁ fixture).
- `feature/very-long-branch-name-here` — a branch name >16 chars (the
  chip-clipping fixture: 15-char prefix + `…`), WITH an upstream (contrast
  with `feature-x`).
- `v1.0` — a lightweight tag.
- A bare sibling repo (`<dir>-origin.git`) added as `origin`, with `main`
  pushed via `-u` (so it has a real upstream) and a `remote-only` branch that
  exists ONLY on `origin` (pushed, then its local copy deleted) — the
  checkout-remote-branch dialog's fixture.
- A GHOST commit: committed on a temp branch, pinned alive by a
  `refs/adgitter/backup/<ts>-1/reword/refs-heads-main` ref, then the temp
  branch itself deleted — reachable only via that backup ref, exactly how a
  real history-rewrite op (reword/rebase/drop/purge) orphans a commit until
  its backup expires (`crates/git-core/src/mutate.rs`).
- Gesture-operations fixtures: two extra `main`-tip commits on their own
  dedicated paths (`dropTarget`/`afterDrop`, safe to drop-and-replay without
  a conflict), a `topic` branch diverged from `main` by 2 commits on a path
  `main` never touches (merge/rebase/cherry-pick material), a `disposable`
  branch (safe to delete), and an uncommitted, **untracked** working-tree
  file (`scratch-notes.txt`, the commit-flow fixture — untracked so it never
  blocks a checkout/rebase).

Every test gets its own fixture repo in a fresh `os.tmpdir()` directory (see
`e2e/helpers.ts`'s `repo` fixture) and is free to mutate it — nothing is
shared across tests, and both the working-tree dir and the bare origin are
removed afterward.

## The tutorial demo bridge

The guided tutorial builds a disposable
demo repo at runtime through six Tauri commands. The bridge implements them
(`tutorial_demo_create` / `_seed_files` / `_seed_history` / `_write_file` /
`_simulate_log` / `_remove`, in `e2e/tutorialDemo.ts`) as a line-for-line
re-derivation of `crates/git-core/src/tutorial_demo.rs` over the real system
`git`: same `demo-<ms>/{repo,origin.git}` layout, learner identity, files,
subjects, branches, annotated tags, `origin/<name>` upstreams, `adgitter.config.json`
(autoPull off, listed in `.git/info/exclude`), strictly increasing commit
times, and the same path confinement — every command refuses a repo that is
not exactly `<base>/demo-<digits>/repo`. The base directory is a per-bridge temp
dir (`createBridge`/`installBridge`'s `tutorialBaseDir` option overrides it;
`bridge.dispose()` — called by `helpers.ts` — removes it).

Everything the tutorial then does to that repo goes through the same bridge:
`merge`, `rebase_branch`, `cherry_pick`, `reset`, `undo`, `purge_path`,
`add_file_to_commit`, `reword`, `push` (plain push to the local origin; a
non-fast-forward is rejected, `force` overwrites) and `log_commit`. Those live
in `e2e/gitOps.ts`, which reproduces `mutate.rs`' backup refs and batched undo,
the replay engine (`rebase.rs`) and the descendant-branch remap (`remap.rs`)
with `commit-tree` / `merge-tree` / `update-ref`. Repo-scoped commands act on
the `repoPath` the app sends, defaulting to the fixture repo.

`e2e/tutorial-demo.spec.ts` is a **bridge-level** test (no browser): it calls
`createBridge(...).invoke` directly and replays the whole script — create →
seed files → commit → seed history → merge → rebase → cherry-pick → undo →
reset → undo → checkout → purge → add file → reword → rejected push → force
push → simulated log — mirroring the Rust
`the_full_tutorial_script_replays_on_the_real_engines` test.

The history engine needs `git` >= 2.40 (for `merge-tree --merge-base`).

Known gaps vs the Rust backend: a conflicting merge/replay **throws** (after
restoring the pre-op state) instead of pausing into the in-app resolver;
`squash_range`, `revert`, `fetch` and `pull` remain benign stubs.
