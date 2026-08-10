# Repository Map

本文以当前源码与配置为准，用于快速定位腾讯国服启动器模块。

## 顶层目录

| 路径 | 职责 |
| --- | --- |
| `src/` | Electron 主进程、管理 UI、Profile、腾讯流程、Flash 与诊断 |
| `automation-scripts/` | 随 Windows 安装包发布的可信内置 CommonJS 脚本；每个直接子目录一个脚本包 |
| `flash/` | Windows/Linux PPAPI 二进制与版本清单 |
| `assets/` | 应用图标 |
| `linux/` | AppImage 安装、运行与卸载脚本 |
| `.github/workflows/` | Node 16.20.2 下的 CI 与双平台构建 |
| `specs/001-tencent-game-launch/` | 腾讯启动流程需求、设计、任务和历史验证记录 |
| `tests/`、`src/**/__tests__/` | Jest 基础设施、自动化 runtime smoke 与腾讯相关回归测试 |

## 启动与 Flash

- `src/main.js`：启动编排；ready 前读取配置、探测 Flash、应用 GPU 环境变量与 Chromium flags。
- `src/main/flags.js`：`app.commandLine.appendSwitch` 的唯一入口。
- `src/flash/plugin.js`：从发行资源、开发目录或手动 cache 中寻找 PPAPI。
- `src/flash/mms.js`：运行期管理 Flash `mms.cfg`。
- `src/config/settings.js`：`userData/config.json`。

Flash 二进制随仓库和发行包提供。`src/app/FlashUpdater.js` 已按上游 v1.4 架构删除；缺少插件时 `main.js` 显示安装损坏错误并退出。

## 腾讯登录与窗口

- `src/app/Launcher.js`：创建游戏 `BrowserWindow`、绑定 Profile Partition、装配流程与窗口 registry。
- `src/app/GameViewport.js`：仅对游戏窗口按显示器 DPI 反向补偿，使物理内容、页面坐标和截图统一为 1920×1080、有效 devicePixelRatio=1，并在导航或跨屏后恢复合同。
- `src/app/TencentLaunchFlow.js`：腾讯官方选服、扫码认证子窗、游戏导航、页面探针与有界恢复状态机。
- `src/app/SessionLifecycle.js`：通用 load/crash/responsive/close 生命周期。
- `src/app/StallDetector.js`：关键 SWF stall 检测。
- `src/ui/manager/KeyboardShortcuts.js`：游戏窗口 F5、F12、Alt+F4，并阻止 F11 与页面缩放快捷键改变统一画面。
- `src/config/urls.js`：腾讯官方 URL 与精确 URL 角色。

流程：

```text
ProfileManager.launch(profileId)
  -> persist:profile-<id>
  -> Launcher
    -> Tencent official selector
    -> Tencent QR authentication
    -> manual server selection
    -> Tencent game main page
```

启动器不采集 QQ 密码，不读取/复制 Cookie，不自动选服，不回退 Oasis。

## Profile 与 Session

- `src/profiles/store.js`：Profile 通用元数据、统计与 launch log。
- `src/profiles/manager.js`：Store、Partition、Launcher 与 MemoryGuard facade。
- `src/profiles/partition.js`：固定 `persist:profile-<id>` 映射和 Session 获取。

旧 `CryptoService`、`PasswordManager`、`ProfileVault` 与 `vault.js` 已删除。

## 管理窗口与 IPC

- `src/ui/controller.js`：管理 UI facade。
- `src/ui/manager/ManagerWindow.js`：管理窗口生命周期。
- `src/ui/manager/IpcRouter.js`：Profile、窗口恢复、Inspector、内存与诊断 IPC。
- `src/ui/manager/StateBroadcaster.js`：安全 Profile、流程与内存状态推送。
- `src/ui/index.html`、`src/ui/app.js`、`src/ui/styles.css`：腾讯 Profile 管理界面。
- `src/preload.js`：游戏 renderer 的最小版本、debug 与恢复 bridge。

## 内置自动化

- `src/automation/registry.js`：只扫描固定的 `automation-scripts/`，验证 manifest、包边界、
  CommonJS 导出和 ID 唯一性。
- `src/automation/runner.js`、`coordinator.js`：运行状态、deadline、取消、同 Profile lease 与动作
  FIFO；不同 Profile 可独立运行。
- `src/automation/api.js`、`backend.js`：脚本唯一受支持的 Automation API 与 Launcher/CDP 后端；
  负责窗口状态、坐标映射和不抢焦点的后台点击。
- `src/automation/coordinates.js`：共享 normalized/content mapper 与 screenshot center 到 normalized
  cell midpoint 编码；BrowserWindow/CDP viewport 的末段映射只存在于 backend。
- `src/automation/vision/`：可信脚本的 `find/waitFor/waitUntilGone`、Electron nativeImage PNG
  解码、纯 JS exact-scale/ROI 协作分片 matcher，以及基于 registry packageRoot 的专属模板加载。
- `src/automation/recording.js`、`store.js`：有时限的截图录点，以及
  `userData/automation-data/profiles/<profileId>/scripts/<scriptId>/` 下的隔离用户数据。
- `src/ui/automation-selection.js`：管理页截图点击/拖拽到 screenshot-pixel ROI、中心点及
  click-compatible normalized point 的纯几何换算；自动化面板可自动填入 ROI，并通过受控 IPC
  调用正式 Vision/Automation API 执行“匹配”与“匹配并点击”。
- `src/automation/index.js`：组合 registry、runner、coordinator、backend、recording 与 Profile/
  窗口生命周期。
- `automation-scripts/demo/`：正式示例脚本，只通过注入的 Vision/Automation API 依次等待模板
  并点击匹配中心。
- `src/ui/manager/IpcRouter.js`、`StateBroadcaster.js`：管理页的请求校验、安全 DTO 与状态广播。
- `tests/runtime/`：经过正式 registry → runner → Automation/Vision API 的 Chromium、PPAPI/AS3 和
  Windows 打包运行 smoke。

通用自动化能力只检查所属 Profile 窗口、webContents、内容尺寸、输入和动作生命周期等客观
资源。腾讯流程阶段及 `GAME_READY` 仅用于诊断；页面是否适合操作由脚本通过受限 API 判断，
不能成为截图、录点或脚本启动的全局硬门槛。

脚本合同、稳定状态/错误、数据边界和验证命令详见
[`docs/BUILTIN_AUTOMATION.md`](./BUILTIN_AUTOMATION.md)。

## 网络、安全与诊断

- `src/network/inspector.js`：只保留 resource type、origin、pathname、status code、error code。
- `src/utils/diagnostics.js`：用户主动导出的脱敏诊断。
- `src/utils/logger.js`：本地结构化日志。
- `src/app/Auditor.js`：Profile 级游玩时长、stall、crash、reload 汇总。

旧 `api-login`、`blocker`、`cookies`、`tempmail`、`jwt` 与 `server-selector` 已删除。

## 性能

- `src/app/GpuDetector.js`：启动前 GPU 环境变量。
- `src/app/CpuOptimizer.js`：游戏 renderer CPU 优化。
- `src/memory/MemoryGuard.js`：低内存模式与轻量状态；强制 renderer GC 已移除，保留兼容 IPC 返回。
- `src/utils/throttle.js`：renderer debounce/throttle。

## 常用命令

| 目的 | 命令 |
| --- | --- |
| 安装 | `npm ci --no-audit --no-fund` |
| 启动 | `npm start` |
| Jest | `npm test -- --runInBand` |
| lint | `npm run lint` |
| Prettier 检查 | `npx prettier --check "src/**/*.{js,html,css,json}" "tests/**/*.js"` |
| 默认发布构建（Windows） | `npm run build` |
| Windows portable | `npm run build:win` |

项目固定 Node.js 16.20.2、npm 8.19.4、Electron 11.5.0。

## 运行时仍需人工验证

- 腾讯选服页、二维码与认证弹窗的当前线上结构。
- 扫码后跳转、Session 过期和重新扫码。
- Flash 游戏主页面与关键 SWF 加载。
- 两个 Profile 的真实登录态隔离。
- Windows portable 的真实启动与包内自动化脚本发现。
