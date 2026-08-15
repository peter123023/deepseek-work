# Agent Note: 桌面 Electron 壳与托盘托管生命周期

Status: proposed

[English](2026-08-15-desktop-electron-shell.md)

## Problem

DeepSeek Harness 目前只发布 CLI(`apps/cli`,`@deepseek-ai/dsh`)和浏览器 UI(`apps/web`,由 `dsh web` 提供服务),没有可安装的桌面发行版。用户必须安装 Node、在终端里运行 `dsh web`、并且一直开着终端。社区壳(`dataelement/dsh-desktop`、`anywhere-labs/deepseek-harness-desktop`)已经证明了这一需求和形态,但两者都位于本仓库之外,因此都不参与官方构建、发布或 CI 门禁。

## Proposal

新增 `desktop/` workspace——一个薄 Electron 壳——在后台托盘里托管 harness,并通过 GitHub Actions 发布 macOS 和 Windows 的安装包。

壳位于仓库根(`desktop/`),与 `native/` 平级,而非 `apps/` 之下。`check-workspace-constraints.ts` 从目录位置推断 npm release 成员资格:`apps/*` 与 `packages/*/*` 成员必须是可发布的 npm 包,但桌面壳不发布任何 npm 包——它只产出安装包。把它放在 `desktop/` 可以避开这种推断(`desktop/` 路径不匹配任何 release-member glob),因此它像 `native/landlock-run` 一样是 `private: true` 的装配产物,而非虚假的 release member。

### harness 来源:本地 workspace deploy,而非 npm、也非 pkg 单文件

壳必须随着每次提交的 harness 源码变化而同步跟进,因此它从当前 workspace 重新物化 harness,而不是依赖某个已发布版本或缓存产物:

- 将 `apps/cli` 的闭包 `pnpm deploy` 到暂存的 `runtime-host/` 目录,复用 [`scripts/build-exe-for-python-sdk.ts`](../../implemented/architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md) 已经拥有的那一套 deploy 配方(`--legacy --prod --config.node-linker=hoisted --config.auto-install-peers=false --config.link-workspace-packages=true` + symlink 物化 + legacy-hoist 恢复)。这与单文件构建以及 `anywhere-labs` fork 用的是同一套方法论;它不需要 npm 发布、不需要 tag、也不需要 fork 同步。
- Electron 主进程把暂存的 `dsh web` bin 作为子进程 spawn(`ELECTRON_RUN_AS_NODE=1` + `process.execPath`,即 `anywhere-labs` 的 host-supervisor 形态),并把服务的 SPA 加载进 `BrowserWindow`。harness 运行在同一台机器上、走 localhost,因此绝不会跨越 `dsh-client-connection` 的回环信任围栏。

### 托盘托管生命周期

托盘和 Host 子进程在所有平台上拥有应用生命周期,对齐 `anywhere-labs` 而非 `dataelement`:

- `window-all-closed` 不退出;应用常驻托盘,Host 继续运行。
- 点击托盘图标或托盘菜单恢复窗口。
- Host 意外退出时弹出 Retry / Show Log / Quit 对话框,而不是静默退出;主动退出则先停止 Host 子进程(`before-quit`)。

### 目录结构

```
desktop/
├── package.json              # @deepseek-ai/dsh-desktop, private: true
├── tsconfig.json
├── src/main/index.ts         # 应用生命周期
├── src/main/tray.ts          # 托盘 + 菜单
├── src/main/host-supervisor.ts  # spawn dsh web、就绪检测、崩溃处理
├── src/main/window-lifecycle.ts # BrowserWindow 创建/恢复
├── src/preload/index.ts      # preload 桥
├── src/shared/contracts.ts   # 主进程/preload 共享类型
├── runtime/                  # @deepseek-ai/dsh-desktop-runtime,纯依赖清单
├── scripts/stage-runtime.ts  # 将 runtime 闭包 pnpm deploy 到 runtime-host/
├── scripts/verify-packaged-runtime.ts  # electron-builder afterPack 校验
├── resources/                # 拷贝进应用包的额外文件
└── build/                    # 构建资源(图标)
```

### 构建与 CI

- 本地:`pnpm --filter @deepseek-ai/dsh-desktop run pack:mac` / `pack:win`(或根脚本)先跑 `stage-runtime` 再跑 `electron-builder`,在宿主平台上进行。
- CI:新增 `.github/workflows/desktop-release.yml`,含两条 lane——`macos-latest`(arm64,DMG + ZIP)和 `windows-latest`(x64,NSIS + portable)。macOS 与 Windows 打包各自在原生 runner 上运行;electron-builder 无法跨主机构建这些目标。首版不签名;签名/公证(Apple Developer ID、Windows 代码签名证书)是后续工作,由 secrets 决定是否启用。

### 该目录结构必须满足的 workspace 约束

- 壳位于 `desktop/`(而非 `apps/desktop`),因此 `check-workspace-constraints.ts` 不会为它推断 npm release 成员资格;它像 `native/landlock-run` 一样是 `private: true`,不发布任何东西。
- `desktop/runtime` 是嵌套的 workspace 成员(第二层),在 `pnpm-workspace.yaml` 中显式声明,因此它是一个 deploy 根,但不是构建目标、也不是 release member。
- `electron`、`electron-builder`、`electron-winstaller` 加入 `pnpm-workspace.yaml` 的 `allowBuilds`(`strictDepBuilds: true` 会拒绝每一个未列出的 install script)。

## Alternatives considered

**依赖已发布的 `@deepseek-ai/dsh` npm 包(`dataelement` 的形态)。** 否决:harness 尚处于预发布(`0.1.0-rc.5`,尚无 tagged release),而已发布的依赖无法在同一提交内跟进 harness 的修改。此外它还需要 patch-package 来做壳并不需要的 UI 定制。

**复用 pkg 单文件可执行产物(`dist-exe/`)。** 否决:该流水线的目标产物是 `dsh-jsonrpc-agent-pkg`(Python SDK 的载体),而非 `dsh web` 入口;而且其平台集合明确是 Linux + macOS、Windows 为非目标——桌面壳必须发布 Windows。

**把壳放在 `apps/desktop` 并作为 public release member。** 否决:没有任何要发布的 npm 包,只有安装包;把它做成 public 会强加一个虚假的 `files`/`exports` 形态以及一个不服务任何消费者的发布路径。`anywhere-labs` fork 的做法是重写约束脚本、改成显式的 release-family 白名单;把壳放在 `desktop/` 可以在不改动门禁的情况下达成同样的结果。

**从 macOS/Linux 交叉构建 Windows。** 否决:electron-builder 代码签名需要 Windows 宿主,跨宿主产出的 Windows 二进制不可靠;因此 CI 矩阵改为每个目标各跑在其原生 runner 上。

## Acceptance criteria

- 加入 `desktop/` 后 `pnpm install` 成功(allowBuilds 已更新)。
- `pnpm --filter @deepseek-ai/dsh-desktop run pack:mac` 在 macOS 上产出 `.app` 和 DMG;`pack:win` 在 Windows 上产出 NSIS 安装包和 portable exe。
- 启动后的应用能 boot `dsh web`、在窗口中显示服务出来的 UI、关闭窗口后继续驻留托盘、并能从托盘恢复窗口。
- Host 崩溃时显示 Retry/Show Log/Quit,而不是静默退出。
- `desktop-release.yml` workflow 运行两条 lane 并上传两个平台的产物;打 tag 触发 release 上传。
- 新增该包后 `pnpm run hygiene` 和 `verify-workspace-constraints` 通过。

## Risks

- **Electron 引入了一个大型的原生依赖**,自带下载/构建脚本;`allowBuilds` 必须精确限定到 install 实际需要的范围,而且 `electron` 的 postinstall 会下载一个二进制、必须由 CI 缓存覆盖。
- **签名/公证被推迟**:首批安装包未签名,用户会撞上 Gatekeeper/SmartScreen 提示。对首个本地/CI 验证来说可接受,但在公开分发之前必须关闭。
- **node-pty 和原生插件必须按平台重新构建**;单文件流水线里的 macOS spawn-helper 与 Windows ConPTY 处理要延续过来,但需要在 `stage-runtime.ts` 里做各自的暂存。
