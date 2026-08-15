# Agent Note: Detect Windows junctions in stage-runtime link materialization

Status: implemented

English | [中文](2026-08-16-stage-runtime-windows-junction-materialization.zh.md)

## Problem

`desktop/scripts/stage-runtime.ts` materializes the `pnpm deploy` closure before electron-builder packages it, because electron-builder's `copyAppFiles` re-creates filesystem links verbatim (`readlink` + `ensureSymlink`) rather than following them, leaving dangling links in the packaged `host/node_modules`. The materialization pass found links with `lstat(...).isSymbolicLink()`, which works on macOS and Linux where pnpm links workspace packages as symlinks. On Windows pnpm links workspace packages as junctions (`mklink /J`), and Node reports a junction as a directory rather than a symlink — `isSymbolicLink()` is false and `isDirectory()` is true. `findSymlink` therefore never saw a junction, `materializeLinks` became a no-op, and the staged tree kept its junctions. `verifyEntries` then passed anyway because `existsSync` follows junctions, masking the defect; electron-builder copied the dangling junctions into `host/node_modules`, so `@deepseek-ai/dsh/lib/bin.js` was missing from the packaged app and the `afterPack` check failed.

## Decision

`stage-runtime.ts` detects links by comparing `realpath(path)` against the path itself — `isLink` returns true when the resolved form differs from its own. `realpath` resolves both symlinks and junctions to their target, so the predicate is platform-independent where `isSymbolicLink()` is not. `findSymlink` and `copyResolved` both use `isLink` instead of `isSymbolicLink()`, so junctions are found and materialized on Windows exactly as symlinks are on macOS/Linux. The `copyResolved` link handling is unchanged otherwise: a link at the copy root resolves and copies its target, and a nested link is materialized to bytes.

## Alternatives considered

**Keep `isSymbolicLink()` and add a Windows-specific junction probe.** Rejected because the junction probe (checking reparse-point tags) is not exposed by Node's public API; detecting the reparse point requires native code or parsing `fs.Dir` internals, both more fragile than the `realpath` comparison.

**Use `fs.cp({ dereference: true })` for the whole tree.** Rejected because `dereference` does not follow junctions on Windows, which is the original defect this pass exists to fix.

**Compare `lstat` and `stat` results.** Rejected because a junction's `lstat` and `stat` both report a directory on Windows, so the pair cannot distinguish a junction from an ordinary directory; only `realpath` exposes the retargeting.

## Consequences

`stage-runtime` now performs one `realpath` per staged entry during materialization, an extra system call over the previous `lstat`-only traversal; this is bounded by the closure size and runs only in the packaging path, not in the app. The predicate treats any path whose `realpath` differs from itself as a link, which is correct for pnpm's workspace links on every platform and for ordinary files and directories (whose `realpath` is the normalized self). The fix makes the Windows packaging lane produce a materialized `host/node_modules` instead of dangling junctions, matching the already-working macOS lane.
