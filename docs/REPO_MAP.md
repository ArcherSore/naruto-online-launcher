# Repository Map

> 本文以当前工作树中的 `package.json`、构建配置和源码为事实来源。`MIGRATION_PROMPT.md` 仅按历史交接资料处理；其中的状态对照见文末。

## 1. 项目定位与顶层目录

这是一个 Electron 11 桌面启动器：管理多个 Naruto Online 账号/Profile，为每个 Profile 创建隔离的 Chromium Session 和独立游戏窗口，并通过 PPAPI 运行 Flash。管理界面与游戏页均为原生 HTML/CSS/JavaScript，没有前端框架。

| 路径 | 职责 | 后续开发关注点 |
| --- | --- | --- |
| `src/` | 应用主进程、管理界面、Profile/Session、网络、Flash、性能与工具代码 | 业务开发主目录 |
| `src/main.js` | Electron 主入口与启动编排 | 启动顺序、全局生命周期、首次启动、Flash 兜底 |
| `assets/` | 应用 PNG/ICO 图标 | 打包资源 |
| `flash/` | 已纳入版本控制的 Windows/Linux PPAPI 二进制和版本清单 | 不应随意替换；与 Electron 11 强耦合 |
| `linux/` | AppImage 安装、运行、卸载及 desktop entry | Linux/X11/XWayland 与系统依赖 |
| `.github/workflows/` | CI 质量门禁、Linux/Windows 构建、Release | Node 版本和官方构建命令的权威来源之一 |
| `scripts/` | Linux 源码调试和已打包 AppImage 调试脚本 | 非正常启动入口 |
| `tools/` | 可手动粘贴到 DevTools 的网络监视脚本 | 运行时诊断，不参与应用启动 |
| `tests/`、`__mocks__/` | Jest 全局设置和 Electron/electron-log mock | 单元测试基础设施 |
| `docs/` | 面向维护者的仓库导航 | 当前文档所在目录 |

`README.md` 主要面向发行版用户，`CONTRIBUTING.md` 提供基本开发命令，但其目录示例已经落后于当前源码；导航应以本文和实际文件为准。

## 2. 核心模块与关键文件

### 启动与配置

- `package.json`：`main` 指向 `src/main.js`；定义 npm scripts、Electron/electron-builder 版本和打包资源。
- `src/main.js`：必须在 `app.ready` 前完成配置、Flash 探测、GPU 环境变量与 Chromium flags；ready 后启动 Store、MemoryGuard、事件计时器和管理窗口。
- `src/main/flags.js`：唯一的 `app.commandLine.appendSwitch` 权威入口，设置 Flash、sandbox、GPU、缓存和 V8 heap flags。
- `src/main/debug.js`、`src/preload.js`：读取 `SHINOBI_DEBUG` 并向隔离的游戏 renderer 暴露最小 bridge。
- `src/config/settings.js`：在 Electron `userData/config.json` 读写全局设置。
- `src/config/urls.js`：地区入口 URL、game code 和 launcher query 参数的集中定义。
- `src/config/regions.js`、`hardware.js`、`optimization.js`、`i18n.js`：地区、硬件、性能预设和管理 UI 文案配置。

### Profile、凭据与 Session

- `src/profiles/store.js`：Profile 元数据、排序、统计和启动日志的持久化 Store；上限由 `MAX_PROFILES` 定义。
- `src/profiles/manager.js`：Profile 领域 facade；串联 Store、Vault、Partition、Launcher 和 MemoryGuard。
- `src/profiles/partition.js`：选择 `persist:profile-<id>` 或临时 `partition:profile-<id>`，并负责 shadow partition 的 cookie snapshot/restore。
- `src/profiles/vault.js`：兼容 facade。
- `src/profiles/ProfileVault.js`、`PasswordManager.js`、`CryptoService.js`：凭据 CRUD、机器绑定主密码/密钥与 AES-256-GCM/PBKDF2 加解密；同时生成表单自动登录注入脚本。

### 游戏窗口、登录与页面生命周期

- `src/app/Launcher.js`：按 Profile 创建带独立 partition 的 `BrowserWindow`，启用插件，安装网络层，维护游戏窗口 registry，然后挂接生命周期与快捷键。
- `src/ui/game-launcher.js`：兼容 facade，直接 re-export `app/Launcher.js`。
- `src/app/SessionLifecycle.js`：页面加载、预登录、表单注入、导航与弹窗、CSS/FB mock 注入、失败重试、stall/crash 恢复、JWT 续期和关闭清理。
- `src/ui/manager/KeyboardShortcuts.js`：游戏窗口 F5、F12、Alt+F4 等快捷键；F5 委托 Launcher 做清 Session 后的 API 预登录。
- `src/app/StallDetector.js`：识别关键资源停滞并触发受控恢复。
- `src/network/api-login.js`：通过 passport API 登录，将 `oas_user` JWT cookie 注入当前 Electron Session，并支持有效性检查/续期。
- `src/network/tempmail.js`：临时邮箱、OAS 注册/登录和服务器查询。

### 网络

- `src/network/blocker.js`：每个 Session 的 `onBeforeRequest` 拦截；按域名/路径屏蔽 tracking，并把 `logintype=3` 重定向为 `4`。
- `src/network/cookies.js`：延长游戏 cookie、删除 tracking cookie，并在唯一的 `onHeadersReceived` handler 中合并 CSP 注入。
- `src/network/inspector.js`：可选的 `webRequest` 采集、分类和 JWT 提取，由管理 UI 的 IPC 开关控制。
- `src/ui/server-selector.js`：通过 Electron `net` 获取/缓存服务器列表。

### 管理窗口与 IPC

- `src/ui/controller.js`：管理 UI 的薄 facade。
- `src/ui/manager/ManagerWindow.js`：本地 dashboard `BrowserWindow` 的创建、显示、隐藏与关闭策略。
- `src/ui/manager/IpcRouter.js`：Profile、Vault、Session、Tempmail、Inspector、Flash、诊断、窗口等 IPC 的集中路由。
- `src/ui/manager/StateBroadcaster.js`：把 Profile、内存、事件状态推送给管理 renderer。
- `src/ui/index.html`、`src/ui/app.js`、`styles.css`：管理 dashboard；该窗口加载本地文件并直接启用 Node integration。

### Flash、性能和诊断

- `src/flash/plugin.js`：从打包资源、开发目录或 `userData/flash-cache` 同步寻找当前平台的 PPAPI 文件并读取版本。
- `src/app/FlashUpdater.js`：仅在内置文件缺失/损坏时兜底；使用固定 release 下载、缓存、解压并触发二次启动。
- `src/flash/mms.js`：运行期间写入 Flash `mms.cfg`，退出时恢复备份。
- `src/memory/MemoryGuard.js`、`GcDaemon.js`、`guard.js`：内存监测、分层 GC 与兼容 facade。
- `src/app/GpuDetector.js`、`CpuOptimizer.js`：启动前 GPU 环境变量和游戏 renderer 的 CPU 优化。
- `src/utils/diagnostics.js`、`logger.js`：本地日志与用户主动导出的脱敏诊断包。

## 3. 应用启动流程

1. npm 执行 `electron .`；Electron 根据 `package.json.main` 加载 `src/main.js`。
2. `src/main.js` 在 top-level 同步读取 `userData/config.json`，探测当前平台 Flash 路径和版本，探测 GPU，并调用 `flags.applyAll()`。PPAPI 路径/版本必须在 Electron ready 前设置。
3. 获取 single-instance lock；第二实例只聚焦/恢复管理窗口。
4. `app.ready` 时：
   - 若找不到有效 Flash，打开本地 loading window，调用 `FlashUpdater.ensureLatest()`，成功后 `app.relaunch()`；
   - 否则加载 Profile Store，启动 MemoryGuard/Webview GC 和事件计时器；
   - 首次运行先显示 `src/ui/setup/setup.html`，持久化语言、地区和轻量模式设置；
   - 随后注册 IPC，创建管理窗口并加载 `src/ui/index.html`。
5. 管理 renderer 的 `src/ui/app.js` 通过 IPC 请求 Profile 操作；点击 Play 后 `IpcRouter/main.js -> ProfileManager.launch()`。
6. ProfileManager 选择 partition；shadow 模式先异步恢复 cookie，然后调用 Launcher。
7. Launcher 创建游戏 `BrowserWindow`、绑定独立 Session、安装 blocker/cookie+CSP handler、SessionLifecycle 和快捷键，先显示本地 loading data URL。
8. `ready-to-show` 后，SessionLifecycle 优先用 Vault 凭据执行 API 预登录并注入 cookie，再加载 `urls.js` 生成的游戏 URL；失败时回退到页面加载后的表单脚本注入。
9. `did-finish-load` 后执行页面清理/全屏 CSS、FB fallback、自动登录、CPU 优化和 StallDetector；同时按计划检查 JWT 续期。
10. 游戏窗口关闭时先停止页面/Flash 对象并清理计时器；Launcher 从 registry 移除窗口，ProfileManager 注销 MemoryGuard，shadow 模式保存认证 cookie snapshot。最后一个窗口关闭时 Electron 退出，并恢复 `mms.cfg` 备份、停止后台服务。

注意：shadow cookie restore 当前是异步派发后立即继续创建/加载窗口，并未等待完成；其 `AUTH_DOMAINS` 也与 API 登录写入的 `narutowebgame.com` 域名不完全一致。是否影响 shadow 模式保持登录需要运行时验证。

## 4. Profile、Session、Flash、登录、网络与窗口生命周期关系

```text
管理 UI
  -> IPC Router
    -> Profile Store / Vault
    -> ProfileManager.launch(profileId)
       -> Partition: persist 或 shadow Session 名称
       -> shadow cookie restore
       -> Launcher.create BrowserWindow(partition, plugins=true)
          -> Session webRequest: Blocker + Cookies/CSP
          -> SessionLifecycle
             -> API Login -> oas_user cookie -> loadURL
             -> fallback: Vault auto-login JS -> 页面表单
             -> 页面 CSS/JS 注入、导航/弹窗、retry/stall/crash/JWT renewal
          -> KeyboardShortcuts
       -> MemoryGuard 注册/注销游戏 webContents
       -> shadow cookie snapshot on close

进程启动前：Flash Plugin 探测 -> flags.js 注入 ppapi-flash-path/version
缺失时：FlashUpdater -> userData/flash-cache -> relaunch -> 再次探测
```

Flash 是进程级 PPAPI 能力，Session 是 Profile 级隔离边界，BrowserWindow 是可见生命周期边界。登录凭据保存在 Vault；实际登录态位于各自 Session 的 cookie/storage 中。网络拦截和响应头修改必须安装到每个 Profile 对应的 Session，页面注入则作用于该 Profile 的游戏 `webContents`。

## 5. 常见改动的文件导航

| 改动目标 | 首要文件 | 通常还要检查 |
| --- | --- | --- |
| 游戏入口 URL、地区路径、launcher 参数 | `src/config/urls.js` | `src/app/Launcher.js` 的 `getGameUrl()`；`src/app/SessionLifecycle.js` 的 `will-navigate` 参数补全；`src/ui/server-selector.js`；`urls.test.js` |
| 登录方式/API、JWT/cookie 域名 | `src/network/api-login.js`、`src/network/tempmail.js` | `src/app/SessionLifecycle.js` 的预登录与续期；`src/profiles/ProfileVault.js` 的表单 fallback；`src/ui/manager/IpcRouter.js`；相关 network tests |
| 登录表单选择器/点击行为 | `src/profiles/ProfileVault.js` | `src/app/SessionLifecycle.js::_tryAutoLogin()`；Vault tests |
| 弹窗与导航处理 | `src/app/SessionLifecycle.js` 的 `new-window`、`will-navigate` | Electron 11 使用旧 `new-window` 事件；外链通过 `shell.openExternal()` |
| 网络拦截/重定向 | `src/network/blocker.js` | `src/network/cookies.js`（响应头/CSP/cookie）；`src/network/inspector.js`（仅诊断）；对应 tests |
| 页面注入、广告清理、全屏、FB mock | `src/app/SessionLifecycle.js` 的 `did-finish-load` | `src/profiles/ProfileVault.js`（登录脚本）；`src/preload.js`（仅安全 bridge）；`src/app/StallDetector.js` |
| Profile 字段或持久化 | `src/profiles/store.js` | `src/profiles/manager.js`、`partition.js`、`IpcRouter.js`、`src/ui/app.js` |
| Session 隔离或 shadow 行为 | `src/profiles/partition.js` | `src/profiles/manager.js`、`src/app/Launcher.js`、MemoryGuard |
| Flash 路径、版本或兜底下载 | `src/flash/plugin.js`、`src/app/FlashUpdater.js` | `src/main/flags.js`、`src/main.js`、`flash/manifest.json`、`package.json.build.extraResources`、CI |
| 管理窗口关闭/隐藏策略 | `src/ui/manager/ManagerWindow.js` | `src/main.js` 的全局 app lifecycle；Launcher 的 window registry |
| 游戏窗口关闭、失败或 crash 恢复 | `src/app/SessionLifecycle.js` | `src/app/Launcher.js`、`src/profiles/manager.js`、`src/app/StallDetector.js` |

Electron 的一个 Session/webRequest 事件通常只能保留一个 handler；尤其不要在别处再注册第二个 `onHeadersReceived` 覆盖 `cookies.js` 中合并后的 CSP/cookie 逻辑。

## 6. 安装、开发、检查与构建命令

以下命令来自当前 `package.json`、CI workflow、README/CONTRIBUTING 和构建配置。仓库没有单独的 hot-reload `dev` script；“开发模式”就是从源码运行 Electron。

| 目的 | 准确命令 | 说明 |
| --- | --- | --- |
| 安装依赖（推荐） | `npm ci --no-audit --no-fund` | 使用现有完整 lockfile 做确定性安装；已在 Node 16.20.2/npm 8.19.4 下验证通过且锁文件哈希不变 |
| 安装依赖（CI 当前写法） | `npm install --no-audit --no-fund` | workflow 当前使用此命令；仅在 `npm ci` 因历史锁文件不兼容时才应作为本地 fallback |
| 开发模式启动 | `npm start` | 等价于 `electron .`，无 hot reload |
| 测试 | `npm test` | Jest；可选 `npm run test:watch`、`npm run test:coverage` |
| lint | `npm run lint` | ESLint 检查 `src/` |
| 自动修复 lint | `npm run lint:fix` | 会修改文件 |
| 格式化 | `npm run format` | Prettier 写入 `src/`，会修改文件 |
| CI 格式检查（只读） | `npx prettier --check "src/**/*.{js,html,css,json}" "tests/**/*.js"` | workflow 中的实际质量门禁 |
| Windows portable EXE | `npm run build:win` | `electron-builder --win portable --publish never`，目标仅 x64，输出到 `dist/` |
| Linux AppImage | `npm run build:linux` | 输出到 `dist/` |
| 同时请求两平台构建 | `npm run build` | 从单一宿主跨平台构建可能还受 electron-builder 工具链限制；CI 使用 OS matrix 分开构建 |

CI 的直接打包命令分别是 `npx electron-builder --linux AppImage --publish never` 和 `npx electron-builder --win portable --publish never`。Windows 发布物名称由 `productName`/`executableName` 和 electron-builder 决定，发行包预期为 portable `NarutoOnline.exe`。

## 7. 环境要求与运行前检查

### Node、npm 与 Electron

- `package.json.engines.node`：Node.js `>=16.0.0`。
- 项目级 Volta 基线：Node.js `16.20.2`、npm `8.19.4`；CI 明确使用 Node `16.20.2`，该 Node 发行版配套 npm `8.19.4`。
- `package-lock.json` 是完整的 lockfile v3。已使用 `npm ci --no-audit --no-fund` 成功安装 550 个包，安装前后 SHA-256 均为 `216ABA49685A226E07553B67C114CCDD2F2954FA70D84440C92A5981658F1DBB`。不要改用 yarn/pnpm/bun，仓库明确以 npm 为准。
- Electron 与 build 配置都固定为 `11.5.0`，electron-builder 固定为 `22.14.13`。不要升级 Electron：当前 Flash/Chromium 87/PPAPI 依赖这条旧运行时链。
- Node 16 已经 EOL，仅用于兼容当前旧版 Electron 11/PPAPI 项目，不应作为新项目的通用运行时。系统现有 Node 24 不需要降级或卸载。

### Volta 使用方式

- 仓库根目录的 `package.json` 包含 `"volta": { "node": "16.20.2", "npm": "8.19.4" }`。安装 Volta 的开发者进入本目录后，`node`、`npm` 和 npm scripts 会自动解析到固定版本；离开项目目录后仍使用其系统/默认工具链。
- 首次配置命令：`volta pin node@16.20.2 npm@8.19.4`。该命令已经执行，无需每次启动重复运行。
- 验证命令：`node -v`、`npm -v`、`volta which node`、`volta which npm`；预期分别为 `v16.20.2`、`8.19.4` 和对应的 Volta 工具缓存路径。
- 新 clone 的标准流程：进入仓库目录，确认上述版本，执行 `npm ci --no-audit --no-fund`，然后用 `npm start` 启动。

### Flash

- Windows：`flash/pepflashplayer.dll`，清单版本 `34.0.0.376`，x64。
- Linux：`flash/libpepflashplayer.so`，清单版本 `34.0.0.137`，x64。
- 两个二进制都已被 Git 跟踪，当前文件尺寸均大于代码要求的 1 MiB；正常源码启动无需另行下载 Flash，也无需设置 Flash 路径环境变量。
- 如果文件缺失/损坏，首次运行兜底会访问 GitHub 固定 release；Windows 解压兜底需要系统可执行的 `7z`，Linux 使用 `tar`。成功后写入 Electron `userData/flash-cache` 并重启。
- 当前 Linux 兜底存在静态不一致：release matcher 选择 `.tar.gz`，但 `extractAsset()` 只为 `.tar.xz`、`.7z`、`.exe`、`.zip` 分派解压。因此内置 `.so` 缺失时不能假定自动下载可用，需先修复或实测；正常内置路径不受影响。

### 操作系统

- Windows 构建目标仅 `x64` portable；仓库未声明精确最低 Windows 版本。当前仓库内置的是 x64 DLL。
- Linux 构建目标为 x86_64 AppImage。CI 在 Ubuntu 22.04 安装 `libgtk-3-0`、`libnotify4`、`libnss3`、`libxss1`、`libxtst6`、`xdg-utils`、`libatspi2.0-0`、`libuuid1`、`libappindicator3-1`。
- Linux 运行要求 X11；Wayland 下 `linux/run.sh` 会强制经 XWayland。安装脚本还检查 GTK 3、通知工具和 `xdg-open`。FUSE 不是硬要求，因为脚本使用解包运行模式。
- macOS 没有 Flash 插件名、打包 target 或受支持启动路径，视为不支持。
- 应用强制关闭 Chromium/GPU/setuid sandbox 以运行 PPAPI；这是安全边界上的已知折衷。游戏窗口还设置 `webSecurity: false` 和 `allowRunningInsecureContent: true`，不要把不可信本地内容或任意 URL 接入该窗口。

### 环境变量

正常运行没有必需的业务环境变量。可选调试变量为 `SHINOBI_DEBUG=1` 和 `LOG_LEVEL=debug`；Linux 的 `scripts/debug.sh` 会同时设置 Electron logging 变量。Linux Wayland 相关变量由运行脚本自动调整。

## 8. `MIGRATION_PROMPT.md` 历史结论核验

状态含义：`CONFIRMED_BY_SOURCE` 表示当前静态源码/配置可直接确认；`STALE` 表示曾经合理但已被后续实现取代；`CONFLICTS_WITH_SOURCE` 表示与当前配置或实现方向直接相反；`NEEDS_RUNTIME_VERIFICATION` 表示源码存在，但“实际可用/性能/外部服务行为”不能靠静态阅读证明。

### CONFIRMED_BY_SOURCE

- Electron `11.5.0`、vanilla UI、Electron main/renderer 架构、Linux AppImage + Windows portable x64 均由 `package.json` 和 workflow 确认。
- Flash PPAPI 版本仍为 Linux `34.0.0.137`、Windows `34.0.0.376`，且 flags 在 ready 前应用。
- Multi-Profile、persist/shadow partition、MemoryGuard、API Login、Tempmail、Network Inspector、诊断导出和 AES-256-GCM/PBKDF2 模块均存在并已接入 IPC/启动链路。
- CI 仍使用 Ubuntu 22.04、Windows 2022 和 Node `16.20.2`，并执行 lint、Prettier check、Jest 和双平台构建。
- `src/main/flags.js` 仍是 command-line flags 的单一入口；`--expose-gc`、`no-sandbox` 和 PPAPI flags 都在这里设置。
- 调试环境变量 `SHINOBI_DEBUG` 仍存在，并通过 `main/debug.js`、preload 和 UI 使用。

### STALE

- “当前版本 4.9.2”：当前 `package.json` 为 `5.12.0`；README 顶部仍显示 4.7.0，本身也有文档漂移。
- 旧目录/行数和 God Object 描述：controller、game launcher、vault、memory guard 已拆为当前的 facade + 模块结构；历史绝对路径 `/home/z/naruto-repo` 也不适用于当前工作区。
- “F5、DevTools、JWT 自动续期、Tempmail 自动创建 Profile 尚未实现”：当前分别已接入 `KeyboardShortcuts.js`、`IpcRouter.js`、`SessionLifecycle.js` 和 `IpcRouter.js`。
- “6 种管理 UI 语言”：游戏入口仍覆盖多地区/语言，但 `settings.js` 当前只接受 `pt`/`en` 作为管理 UI 语言。
- “必须创建 debug 分支/隐藏 Ctrl+Shift+D”：当前工作树位于 `main`，环境变量调试仍保留；源码调试脚本明确说明 UI 秘密快捷键已移除。
- “只有 6 个测试文件”：当前 `src/**/__tests__` 数量远多于历史清单。

### CONFLICTS_WITH_SOURCE

- “Flash 始终下载 latest、删除仓库二进制”：当前源码和 CI 明确要求 Flash 二进制提交到仓库，正常启动优先使用内置文件，下载仅为损坏/缺失兜底。
- “Flash fallback 使用 latest 的 `.tar.xz`/`.exe`”：当前 `FlashUpdater` 固定 Linux `v1.7` 的 `.tar.gz` 和 Windows `v1.54` 的 `.7z`。
- “缓存 manifest 不在仓库”：当前 `flash/manifest.json` 和平台清单都在仓库中；运行时另有 `cache-manifest.json`。
- 历史文档中的自动删文件、改分支、提交并 push 指令不是当前仓库事实，也与本阶段只读分析/非破坏性要求冲突，不应执行。

### NEEDS_RUNTIME_VERIFICATION

- “Tempmail/mail.tm 注册、passport 登录、JWT 注入在约 1 秒内且 proven working”：相关实现和测试存在，但外部 API、限流、字段与 cookie 接受情况会变化，必须联网实测。
- 游戏入口 URL、服务器数量、表单 selector、OAS API/cookie 域名和 Flash 资源加载是否仍有效，依赖当前线上页面与服务。
- GC 是否仍导致黑屏、自动恢复是否稳定、45 MB idle/多账号内存收益等性能结论需要真实 Electron + Flash 会话测量。
- shadow partition 的 cookie snapshot/restore 是否保持当前登录需要重点实测，原因见启动流程后的注意项。
- Flash 缺失时的 fallback 下载/解压需要分平台实测；尤其 Linux 当前 `.tar.gz` asset 与解压分支不匹配。
- Windows/Linux 可执行文件是否可完整打包和启动，需要在对应 OS、Node 16.20.2 环境跑 CI 等价流程；静态配置只能确认命令和目标。
- “zero tracking”可确认项目未配置自有遥测且 blocker 存在，但第三方游戏页面在实际运行中发出哪些请求仍应通过 Inspector/DevTools 抓包验证。

## 9. 当前建议

当前项目级 Volta 环境和依赖已经准备完成，可以继续执行 `npm start`。实际项目工具链为 Node `v16.20.2`、npm `8.19.4`，系统 Node 24 未被降级。后续新 clone 推荐先运行 `npm ci --no-audit --no-fund`。仓库内已经有 Windows/Linux Flash 文件，正常情况下无需额外准备 Flash，也没有必需环境变量；只有启用调试时才设置 `SHINOBI_DEBUG=1`。
