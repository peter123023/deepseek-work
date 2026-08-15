# Agent Note: stage-runtime 链接物化中识别 Windows junction

Status: implemented

[English](2026-08-16-stage-runtime-windows-junction-materialization.md) | 中文

## 问题

`desktop/scripts/stage-runtime.ts` 会在 electron-builder 打包前物化 `pnpm deploy` 产生的闭包，因为 electron-builder 的 `copyAppFiles` 会原样重建文件系统链接（`readlink` + `ensureSymlink`）而非跟随它们，从而在打包后的 `host/node_modules` 中留下悬空链接。物化过程用 `lstat(...).isSymbolicLink()` 查找链接，这在 macOS 和 Linux 上可行，因为 pnpm 用符号链接链接工作区包。而在 Windows 上 pnpm 用 junction（`mklink /J`）链接工作区包，Node 会把 junction 报告为目录而非符号链接——`isSymbolicLink()` 返回 false、`isDirectory()` 返回 true。于是 `findSymlink` 永远看不到 junction，`materializeLinks` 变成空操作，暂存树保留着 junction。随后 `verifyEntries` 依然通过，因为 `existsSync` 会跟随 junction，掩盖了缺陷；electron-builder 把悬空的 junction 复制进 `host/node_modules`，导致打包后的应用缺少 `@deepseek-ai/dsh/lib/bin.js`，`afterPack` 检查失败。

## 决策

`stage-runtime.ts` 通过比较 `realpath(path)` 与路径本身来检测链接——当解析后的形式与自身不同时，`isLink` 返回 true。`realpath` 会把符号链接和 junction 都解析到目标，因此在 `isSymbolicLink()` 失效的平台上，该判定依然平台无关。`findSymlink` 和 `copyResolved` 都用 `isLink` 取代 `isSymbolicLink()`，使 junction 在 Windows 上被找到并物化，正如符号链接在 macOS/Linux 上一样。`copyResolved` 的链接处理其余部分不变：复制根处的链接会解析并复制其目标，嵌套的链接则被物化为字节。

## 备选方案

**保留 `isSymbolicLink()` 并额外加一个 Windows 专属的 junction 探测。** 不予采用，因为 junction 探测（检查重解析点标签）不在 Node 的公开 API 中；检测重解析点需要原生代码或解析 `fs.Dir` 内部结构，都比 `realpath` 比较更脆弱。

**对整个树使用 `fs.cp({ dereference: true })`。** 不予采用，因为 `dereference` 在 Windows 上不跟随 junction，而这正是该物化过程存在所要修复的原始缺陷。

**比较 `lstat` 与 `stat` 的结果。** 不予采用，因为在 Windows 上 junction 的 `lstat` 和 `stat` 都报告为目录，这对结果无法区分 junction 与普通目录；只有 `realpath` 能暴露重定向。

## 影响

`stage-runtime` 现在在物化过程中对每个暂存条目执行一次 `realpath`，比此前仅用 `lstat` 的遍历多一次系统调用；这受闭包大小限制，且只在打包路径中运行，不在应用内运行。该判定把任何 `realpath` 结果与自身不同的路径都视为链接，这对 pnpm 在各平台上的工作区链接、以及普通文件与目录（其 `realpath` 就是规范化后的自身）都是正确的。该修复使 Windows 打包通道产出物化的 `host/node_modules` 而非悬空 junction，与已经正常工作的 macOS 通道一致。
