# Agent Note: Desktop Electron shell with tray-hosted lifecycle

Status: proposed

English | [中文](2026-08-15-desktop-electron-shell.zh.md)

## Problem

DeepSeek Harness ships a CLI (`apps/cli`, `@deepseek-ai/dsh`) and a browser UI (`apps/web`, served by `dsh web`), but has no installable desktop distribution. A user must install Node, run `dsh web` from a terminal, and keep a terminal open. Community shells (`dataelement/dsh-desktop`, `anywhere-labs/deepseek-harness-desktop`) already prove the demand and the shape, but both live outside this repository, so neither participates in the official build, release, or CI gates.

## Proposal

Add a `desktop/` workspace — a thin Electron shell — that hosts the harness in a background tray and releases installers for macOS and Windows through GitHub Actions.

The shell lives at the repository root (`desktop/`), beside `native/`, rather than under `apps/`. `check-workspace-constraints.ts` infers npm release membership from directory position: `apps/*` and `packages/*/*` members must be publishable npm packages, but the desktop shell publishes no npm package — it produces installers. Siting it at `desktop/` keeps it out of that inference (the `desktop/` path matches no release-member glob), so it is a `private: true` assembly like `native/landlock-run` rather than a fake release member.

### Harness source: local workspace deploy, not npm, not pkg single-exe

The shell must track the harness source line as it changes on every commit, so it re-materializes the harness from the current workspace instead of depending on a published version or a cached artifact:

- **`pnpm deploy`** of the `apps/cli` closure into a staged `runtime-host/` directory, reusing the exact deploy recipe (`--legacy --prod --config.node-linker=hoisted --config.auto-install-peers=false --config.link-workspace-packages=true` + symlink materialization + legacy-hoist restore) that [`scripts/build-exe-for-python-sdk.ts`](../../implemented/architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md) already owns. This is the same methodology the single-exe build and the `anywhere-labs` fork use; it needs no npm publication, no tag, and no fork sync.
- The Electron main process spawns the staged `dsh web` bin as a child process (`ELECTRON_RUN_AS_NODE=1` + `process.execPath`, the `anywhere-labs` host-supervisor shape) and loads the served SPA into a `BrowserWindow`. The harness runs on the same machine, over localhost, so it never crosses the `dsh-client-connection` loopback trust fence.

### Tray-hosted lifecycle

The tray and the Host child process own application lifetime on every platform, matching `anywhere-labs` rather than `dataelement`:

- `window-all-closed` does not quit; the app stays resident in the tray and the Host keeps running.
- Clicking the tray icon or the tray menu restores the window.
- An unexpected Host exit surfaces a Retry / Show Log / Quit dialog instead of silently exiting; a deliberate quit stops the Host child first (`before-quit`).

### Layout

```
desktop/
├── package.json              # @deepseek-ai/dsh-desktop, private: true
├── tsconfig.json
├── src/main/index.ts         # app lifecycle
├── src/main/tray.ts          # tray + menu
├── src/main/host-supervisor.ts  # spawn dsh web, readiness, crash handling
├── src/main/window-lifecycle.ts # BrowserWindow create/restore
├── src/preload/index.ts      # preload bridge
├── src/shared/contracts.ts   # main/preload shared types
├── runtime/                  # @deepseek-ai/dsh-desktop-runtime, pure dependency manifest
├── scripts/stage-runtime.ts  # pnpm deploy of the runtime closure into runtime-host/
├── scripts/verify-packaged-runtime.ts  # electron-builder afterPack check
├── resources/                # extra files copied into the app bundle
└── build/                    # build resources (icon)
```

### Build and CI

- Local: `pnpm --filter @deepseek-ai/dsh-desktop run pack:mac` / `pack:win` (or a root script) runs `stage-runtime` then `electron-builder` on the host platform.
- CI: a new `.github/workflows/desktop-release.yml` with two lanes — `macos-latest` (arm64, DMG + ZIP) and `windows-latest` (x64, NSIS + portable). macOS and Windows packaging each run on their native runner; electron-builder cannot cross-build these targets. Unsigned first release; signing/notarization (Apple Developer ID, Windows code-signing cert) is a follow-up gated on secrets.

### Workspace constraints the layout must satisfy

- The shell sits at `desktop/` (not `apps/desktop`), so `check-workspace-constraints.ts` does not infer npm release membership for it; it is `private: true` and publishes nothing, like `native/landlock-run`.
- `desktop/runtime` is a nested workspace member (depth-2), declared explicitly in `pnpm-workspace.yaml` so it is a deploy root but not a build target or release member.
- `electron`, `electron-builder`, and `electron-winstaller` join `pnpm-workspace.yaml` `allowBuilds` (`strictDepBuilds: true` rejects every unlisted install script).

## Alternatives considered

**Depending on the published `@deepseek-ai/dsh` npm package (the `dataelement` shape).** Rejected: the harness is pre-release (`0.1.0-rc.5`, no tagged release yet), and a published dependency cannot track a harness edit in the same commit. It also needs patch-package for UI customization the shell does not need.

**Reusing the pkg single-file executable (`dist-exe/`).** Rejected: that pipeline targets `dsh-jsonrpc-agent-pkg` (the Python SDK carrier), not the `dsh web` entry, and its platform set is explicitly Linux + macOS with Windows a non-goal — the desktop shell must ship Windows.

**Siting the shell at `apps/desktop` as a public release member.** Rejected: there is no npm package to publish, only installers; making it public would force an artificial `files`/`exports` shape and a publication path that serves no consumer. The `anywhere-labs` fork instead rewrites the constraint script to an explicit release-family whitelist; keeping the shell at `desktop/` achieves the same outcome without changing the gate.

**Cross-building Windows from macOS/Linux.** Rejected: electron-builder requires a Windows host for code signing and produces unreliable Windows binaries cross-host; the CI matrix instead runs each target on its native runner.

## Acceptance criteria

- `pnpm install` succeeds with `desktop/` in the workspace (allowBuilds updated).
- `pnpm --filter @deepseek-ai/dsh-desktop run pack:mac` produces a `.app` and DMG on macOS; `pack:win` produces an NSIS installer and portable exe on Windows.
- The launched app boots `dsh web`, shows the served UI in the window, keeps running in the tray after the window closes, and restores the window from the tray.
- A Host crash shows Retry/Show Log/Quit rather than silently exiting.
- The `desktop-release.yml` workflow runs both lanes and uploads both platform artifacts; a tag triggers the release upload.
- `pnpm run hygiene` and `verify-workspace-constraints` pass with the new package.

## Risks

- **Electron adds a large, native dependency** with its own download/build scripts; `allowBuilds` must be scoped exactly to what the install needs, and `electron` postinstall downloads a binary that the CI cache must cover.
- **Signing/notarization is deferred**: the first installers are unsigned, so users hit Gatekeeper/SmartScreen prompts. This is acceptable for a first local/CI proof but must be closed before public distribution.
- **node-pty and native addons must be rebuilt per platform**; the macOS spawn-helper and Windows ConPTY handling from the single-exe pipeline carry over but need their own staging in `stage-runtime.ts`.
