# ADGitter

> A lightweight, cross-platform, gesture-driven visual Git client.

ADGitter turns your Git history into a clean, interactive graph and its
operations into direct manipulation: double-click to check out, drag to
rebase or merge, drag `HEAD` to reset, and `Cmd/Ctrl+Z` to undo. It is built
on Tauri 2, Rust and Svelte 5, and runs on macOS, Windows and Linux.

This repository is the **free, open-source edition** of ADGitter, under the
Apache License 2.0. The app distributed from the official website also offers
paid features (issue-tracker integration, multiple windows, background
Log Anytime with history compaction, and more); their code is not part of
this repository, and a build from this source runs without them.


---

## Features

- **Commit graph** rendered as SVG, with lane colours, branch and tag chips,
  and ghost commits kept by undo history
- **Gesture operations**: check out, branch, merge, rebase (including
  interactive rebase by dragging), cherry-pick, reset, revert, reword, squash
  and drop
- **Conflict resolution** without leaving the app
- **Undo** for every history rewrite, through backup refs
- **Remotes**: clone, fetch, pull and push over HTTPS (personal access token)
  and SSH
- **Log Anytime**: timed snapshots of the working tree to a dedicated branch
- **Themes**, keyboard shortcuts, eight interface languages, and a guided
  tutorial on a demo repository

## Build from source

### Prerequisites

| | macOS | Windows | Linux |
|---|---|---|---|
| Node 20+ | `brew install node@20` | [nodejs.org](https://nodejs.org/) | distro package |
| pnpm 9+ | `npm i -g pnpm` | `npm i -g pnpm` | `npm i -g pnpm` |
| Rust (stable) | [rustup.rs](https://rustup.rs/) | [rustup.rs](https://rustup.rs/) | [rustup.rs](https://rustup.rs/) |
| Tauri prerequisites | Xcode CLT (`xcode-select --install`) | WebView2 (built into Windows 11) | `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev` |

See <https://tauri.app/start/prerequisites/> for the full list.

### Run

```bash
pnpm install
pnpm dev
```

The first build compiles Tauri and libgit2 and takes several minutes; later
runs are fast. Optional build-time settings (crash reporting, sign-in, ads)
are described in `.env.example`; without them the app runs with those
features inert.

### Test

```bash
cargo test --workspace          # Rust: git operations against fixture repos
pnpm --filter desktop test      # frontend unit tests (Vitest)
pnpm --filter desktop check     # type check (svelte-check)
pnpm --filter desktop e2e       # end-to-end tests (Playwright)
```

### Package

```bash
pnpm build
# installers land in target/release/bundle/
```

## Repository layout

```
apps/desktop/
  src/            Svelte 5 + TypeScript frontend
  src-tauri/      Tauri shell: IPC commands, file watching, sign-in
  e2e/            Playwright end-to-end tests
crates/
  git-core/       all Git operations (libgit2), framework-agnostic
  license/        licence verification and the feature tiers
  telemetry/      opt-in crash reporting with PII scrubbing
tools/            i18n lint, macOS signing check
```

## Contributing

Issues and pull requests are welcome. Please open an issue to discuss a
larger change first, run the tests above before sending a pull request, and
follow Conventional Commits (`feat:`, `fix:`, `docs:`, …).

## License

ADGitter's open-source edition is licensed under the **Apache License 2.0**
(see [LICENSE](LICENSE) and [NOTICE](NOTICE)). The name "ADGitter" and its
logo are trademarks and are not licensed for use by derived products (Apache
2.0 §6).
