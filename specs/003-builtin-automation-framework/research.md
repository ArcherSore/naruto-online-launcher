# Phase 0 Research：内置自动化脚本框架

**Date**: 2026-07-30

**Branch baseline**: `feature/framework` / `main@4967578`

**Reference branch**: `demo/builtin-auto@a646977`

## 1. 当前基线与 Demo 迁移策略

**Decision**: 当前实现从 `main@4967578` 开始新增正式框架，只从 `demo/builtin-auto` 选择性迁移已经验证的算法、测试靶场和行为证据；不得整体 cherry-pick `7681c33` 或 `a646977`。

**Rationale**:

- 当前分支不存在 `AutomationDemo`、`DemoCoordinateStore`、`automation-scripts/demo-click`、CDP runtime smoke、AS3 fixture 或 POC 文档。
- Demo 两个提交同时混入失败的 PreloadSwf/FlashProbe/TCP 路线、Debug-only UI、临时 IPC 和耦合到 `Launcher` 的单体实现。
- 可复用资产是归一化坐标映射、CDP 三事件点击序列、AS3 双目标靶场、Chromium/PPAPI runtime smoke 的验证思路，以及 `demo-click` 的行为测试。

**Alternatives considered**:

- **整体 cherry-pick Demo 提交**：拒绝；会恢复失败路线和临时接口，并把“研究代码”误当正式框架。
- **完全重做且不复用验证资产**：拒绝；会丢失 2026-07-29 已获得的真实 Chromium、PPAPI 和腾讯游戏证据。

### 2026-08-09 portable 对照与最终决策

Windows portable 显示脚本已注册且真实 PPAPI Flash 游戏正在运行，但录点和启动按钮一直禁用。
与 `demo/builtin-auto@a646977`、当前源码及真实运行日志对照后确认：

- Demo 只按 Profile 窗口存在性开放操作；正式框架后来增加了 `GAME_READY` 硬门槛，但生产页面
  探针与状态机没有可靠地产生该状态，既有测试用注入的 `true` 掩盖了真实回归。
- 第二轮日志中两个 Profile 均由既有 `StallDetector` 明确记录 `game ready`，但该检测器没有
  `onReady` 回调，状态机丢弃了真实就绪信号；自动化目标仍报告 `gameReady=false`。
- `GAME_READY` 混合了页面语义与通用自动化资源可用性：即使修补 DOM 探针或把 StallDetector
  接入状态机，未来页面变化仍会再次全局禁用本应可用的截图、录点和脚本启动。
- 空录点 `<img hidden>` 的样式问题是独立 UI 缺陷，不能据此推断截图或 Data URL 失败。

最终决策是不修补或扩大 `GAME_READY` 识别链路来授权通用自动化。Launcher 仍可暴露该布尔值
用于状态展示和诊断，但 Manager、runner、recording 与 Automation API 只检查各能力客观需要的
Profile 窗口、webContents、内容尺寸、输入、lease 和取消/deadline 状态。页面是否适合点击由脚本
通过受限 API 判断；未来图像识别或页面等待另由脚本实现。空截图元素继续用
`img[hidden] { display:none !important; }` 修复显示问题。该修订需新增 `gameReady=false` 的失败先行
回归，并重新执行 Windows Chromium、PPAPI、打包和腾讯真实游戏人工验证。

## 2. 主进程接入与职责边界

**Decision**: 新增独立的 `src/automation/` 主进程域；在 Profile Store 加载后、管理 IPC 注册和窗口创建前初始化。`Launcher` 只提供按 `profileId` 获取当前游戏目标及诊断性游戏就绪状态的窄适配，并在窗口关闭时通知自动化服务取消对应运行。

**Rationale**:

- `src/app/Launcher.js` 已用 `Map<profileId, entry>` 维护唯一游戏窗口 registry，并在 `closed` 回调中清理。
- `src/main.js::_initManagerAndLaunch()` 已通过依赖注入向 `IpcRouter` 装配 domain handler。
- 自动化不能通过 Session、窗口标题或全局 `BrowserWindow` 枚举反推目标；这些方式不能证明窗口仍属于目标 Profile。
- 脚本不得接触 `Launcher`、registry、`BrowserWindow`、`webContents` 或 debugger。

**Alternatives considered**:

- **把正式逻辑继续堆进 `Launcher`**：拒绝；Demo 已证明截图、存储、CDP 和脚本运行混在窗口编排中难以测试和维护。
- **通过 Partition/Session 查找目标**：拒绝；Session 不是窗口，并会扩大登录态数据面。
- **新建外部 Bridge**：拒绝；明确属于 Feature 非目标。

## 3. 脚本运行模型

**Decision**: 第一版在 Electron 主进程内直接运行经过项目审核、随包发布的 CommonJS 脚本。入口固定为 `module.exports = async function run(context) { ... }`，启动扫描时加载一次并缓存导出函数；运行期不热重载、不清理 `require.cache`。

**Rationale**:

- 脚本是可信项目代码，不是用户安装代码；直接运行最轻量，不需要新增 worker/child process RPC。
- CommonJS 模块缓存与只读安装资源匹配；升级脚本后重启启动器即可获得新版本。
- 加载时只验证导出为函数，不依赖 `constructor.name === 'AsyncFunction'`；后者会被 TypeScript 转译影响。运行器使用 Promise 边界统一捕获同步 throw 和异步 reject。
- 入口顶层不得保存 Profile 可变状态；每次运行只使用 context 和函数局部状态。

**Trust boundary**:

- 框架只传递冻结的最小 context、配置快照、取消信号、日志包装器和受限 API。
- CommonJS 同进程代码理论上仍可主动 `require('electron')`；第一版通过只发布项目维护脚本、代码审查、ESLint/边界测试和打包审计执行禁止访问规则。
- 本 Feature 不声称能安全运行恶意脚本，也不把 Node `vm` 描述为安全沙箱。

**Alternatives considered**:

- **Worker 或子进程**：拒绝；需新增 RPC、Electron 对象代理、打包和强制终止语义，超出当前可信轻量脚本需求。
- **自制 VM loader**：拒绝；不能形成可靠恶意代码边界，反而容易产生错误安全承诺。
- **每次运行清 require cache**：拒绝；嵌套依赖和并行 Profile 下语义不稳定。

## 4. 内置脚本发现、Manifest 与安装包

**Decision**: 固定从 `path.join(app.getAppPath(), 'automation-scripts')` 扫描直接子目录；脚本通过 electron-builder `files` 进入只读 ASAR。扫描使用 Node 内置 `fs`、`path` 和 `JSON.parse`，不新增 schema、semver 或 glob 依赖。

**Manifest v1**:

- `schemaVersion`: 整数 `1`
- `apiVersion`: 整数 `1`
- `id`: 1～64 字符的 lowercase ASCII slug
- `name`: 非空显示名，最多 80 字符
- `version`: 非空版本字符串，最多 32 字符
- `entry`: 相对脚本目录的 `.js` 文件
- `description`: 可选字符串，最多 500 字符
- 未识别字段不参与第一版行为

**Scan algorithm**:

1. 确定性排序直接子目录。
2. 限量读取并解析 manifest，校验字段与入口路径。
3. 同时执行 lexical containment、真实路径 containment、普通文件检查，拒绝绝对路径、`..` 和符号链接逃逸。
4. 使用 `NFKC + lowercase` 规范化键分组；冲突组全部拒绝，禁止 first-wins。
5. 加载唯一候选的 CommonJS 入口并校验导出合同。
6. 冻结有效注册表和拒绝记录；单包失败不阻止其他包或启动器 UI。

**Rationale**:

- `app.getAppPath()` 同时覆盖开发目录和安装包 `app.asar` 根目录。
- Electron 的 ASAR 支持允许 `fs.readFile`、`readdir` 和 `require` 把 archive 当虚拟目录使用，且 archive 本身只读。
- 当前 `package.json` 使用 `asar:true` 和明确 `files` 白名单；必须把完整脚本目录、manifest、入口及 assets 纳入白名单。

**Alternatives considered**:

- **`extraResources` + `process.resourcesPath`**：拒绝；形成开发/安装双路径，并把程序脚本放到 ASAR 外。
- **从 cwd 扫描**：拒绝；工作目录随启动方式变化。
- **引入 Ajv/semver/glob**：拒绝；v1 schema 很小，且 Feature 不应改依赖或 lockfile。

## 5. Electron 11 取消信号、等待与超时

**Decision**: 框架实现最小 AbortSignal-compatible controller，不依赖全局 `AbortController`。脚本只获得只读 `signal`：`aborted`、稳定 `reason`、`addEventListener('abort', ...)`、`removeEventListener(...)` 和 `onabort`。

**Rationale**:

- 工具链 Node 是 16.20.2，但 Electron 11.5.0 主进程实际内置 Node 12.18.3；Node 12.18.3 没有全局 `AbortController`。
- 自有兼容信号只需满足本 Feature 的协作式取消，不值得引入 polyfill 依赖。

**Timeout policy**:

- 生产默认总运行时限：5 分钟。
- `wait(ms)` 只接受有限非负整数，单次最多 60 秒且不得超过剩余 deadline。
- 测试通过构造参数缩短时限；v1 不把 timeout 加入 manifest。
- 用户 stop：先广播 `stopping`，以 `user-stop` 触发取消，最终为 `cancelled`。
- deadline：以 `timeout` 触发取消，最终为 `failed/run-timeout`。
- 首个终止原因获胜；迟到的 resolve/reject 不得覆盖终态。

**Residual risk**:

- 同进程可信脚本若执行同步死循环，会阻塞事件循环，使 timer 和取消都无法运行。v1 通过脚本审查、测试和“长等待必须调用 `wait`”约束控制；若未来需要硬隔离，必须另立 Feature 评估 worker/子进程。

## 6. Profile 占用、动作串行与并行

**Decision**: 使用 `Map<profileId, lease>` 作为唯一占用边界。脚本运行和独立自动化命令共用 `tryAcquire(profileId)`；忙碌时立即返回 `profile-busy`，不排队。每个 lease 内维护 FIFO action tail，保证脚本即使并发调用 API，动作仍严格串行。不同 Profile 使用独立 lease，可并行。

**Rationale**:

- 只锁“脚本启动”不足以阻止脚本内部 `Promise.all` 造成 CDP 动作交错。
- 接受多个待运行脚本排队会让坐标和窗口状态在等待期间陈旧；明确 busy 更适合个人维护。
- lease 由唯一 token 在统一 finally 中释放，旧运行不得释放新运行的占用。
- 每次 API 动作执行前重新检查 run token、signal、Profile、窗口/webContents、所需内容尺寸和输入；
  页面阶段与 `GAME_READY` 不进入通用 preflight。

**Alternatives considered**:

- **全局 mutex**：拒绝；违反不同 Profile 并行验收。
- **同 Profile 运行排队**：拒绝；产生陈旧 backlog。
- **只锁 run、不串行 API**：拒绝；无法保证动作不交错。

## 7. Automation API 与 CDP 生命周期

**Decision**: 脚本 API 固定为 `capture()`、`getWindowState()`、`getCoordinates()`、`click(normalizedPoint)`、`wait(ms)`。窗口与后台输入只由内部 backend 接触。

**Window and auth boundary**:

- 截图和点击只允许 Launcher 已登记、窗口/webContents 可用且内容尺寸有效的 Profile 游戏目标。
- 返回的窗口状态只包含 availability、诊断性 gameReady、focused、visible、minimized 和 content size；不包含 URL、标题、Session 或身份数据。
- 页面阶段不承担通用能力授权；脚本如需等待特定画面，应通过受限 API 的截图/状态自行判断。

**CDP policy**:

1. 每次点击前验证 `[0,1)` 归一化坐标和当前内容尺寸。
2. 使用执行时内容尺寸映射，不能复用旧截图像素坐标。
3. 检查 debugger 未被 DevTools/其他客户端占用。
4. attach CDP 1.3。
5. 依次派发 `mouseMoved`、`mousePressed`、`mouseReleased`。
6. finally 只 detach 本次成功拥有的连接。
7. attach、dispatch、意外 detach、窗口关闭和 action timeout 映射为稳定错误。

**Rationale**:

- 这是 Demo 在 Chromium、Pepper Flash/AS3 和腾讯真实游戏中验证成功的路径。
- 短连接减少长 wait 期间占用 DevTools 和异常恢复范围。
- 一次点击必须视为原子动作：取消不得停在 pressed 与 released 之间；取消在动作完成后阻止下一动作。

**Alternatives considered**:

- **整个 run 保持 CDP 长连接**：拒绝；长等待时占用 debugger，detach 恢复更复杂。
- **`sendInputEvent` 作为主后端**：拒绝；本地对照虽成功，但腾讯真实游戏最终验证使用 CDP，且 Electron 文档把 focus 作为 `sendInputEvent` 前提。
- **保存每次点击前后截图并全图 pixel diff**：拒绝；增加隐私、磁盘和 CPU 成本，且像素变化不能证明业务成功。

## 8. 用户数据与截图生命周期

**Decision**: 脚本程序位于 ASAR；用户数据位于：

```text
<userData>/automation-data/profiles/<profileId>/scripts/<scriptId>/
├── config.json
└── coordinates.json
```

**Storage rules**:

- Profile ID 必须在 Profile Store 中真实存在；scriptId 必须来自注册表。禁止“替换非法字符后当目录名”，以免碰撞。
- 每个 JSON 包含 `schemaVersion`、`profileId`、`scriptId`、`updatedAt` 和 payload。
- config 只接受有界普通 JSON object；coordinates 只接受有序、有限、位于 `[0,1)` 的点。
- 文件缺失返回显式默认值；损坏 JSON、身份不匹配或 schema 不兼容返回明确错误，不静默覆盖。
- 写入使用同目录临时文件 + rename，限制文件大小；清理只作用于目标组合。
- Profile 删除时不在本 Feature 中递归删除自动化数据；避免在未定义恢复策略时顺带扩大破坏面。

**Screenshot rules**:

- 普通 `capture()` 返回当前运行所需的内存 PNG 副本和安全尺寸元数据，不写磁盘、不进日志。
- 管理 UI 的坐标录制使用短期内存 capture record；每个 Profile/脚本最多保留一个，5 分钟过期，并在重新录制、窗口关闭或应用退出时清理。
- runtime smoke 证据只写入测试临时目录；腾讯人工回归只记录版本、尺寸和结论，不把原始游戏截图提交仓库。

**Alternatives considered**:

- **写入脚本目录/ASAR**：拒绝；只读且升级会覆盖。
- **共用一个大 JSON**：拒绝；单点损坏、跨脚本覆盖和写竞争。
- **存入 Profile metadata 或 Partition**：拒绝；会混入 Profile 导出或登录态生命周期。

## 9. 管理 UI、IPC、状态广播与日志

**Decision**: 沿用现有 `IpcRouter → domain service → StateBroadcaster → ManagerWindow` 路径。管理页在 Profile 卡片中增加轻量“自动化”入口，弹层显示脚本列表、坐标录制、Start/Stop 和当前/最近状态。

**IPC boundary**:

- 所有 automation channel 必须验证调用者是当前 ManagerWindow renderer。
- 主进程重新校验字符串 `profileId/scriptId`、Profile 存在、脚本注册和游戏状态。
- renderer 不得提交入口路径、窗口 ID、CDP method、配置文件路径或任意 Electron 参数。
- 命令使用 request/response 返回稳定 code；状态变化通过单独白名单事件推送。

**Logging**:

- 扩展现有 logger allowlist，加入 `runId`、`scriptId`、`status`、`action`、`durationMs`。
- 脚本 logger 自动绑定 run/profile/script，脚本不能覆盖。
- 循环对象、Buffer、函数、截图、配置内容和未知字段拒绝或安全降级。
- 不记录 QQ 密码、Cookie、票据、验证码、URL query、原始坐标或截图内容。

**Alternatives considered**:

- **renderer 轮询**：拒绝；已有白名单 StateBroadcaster，可实时推送并在 `manager:ready` 恢复全量快照。
- **继续使用 Debug-only `CDP POC` 专用通道**：拒绝；不支持通用注册、状态、停止和错误合同。

## 10. 错误与状态策略

**Decision**: 使用稳定 lowercase kebab-case code；UI 和测试依赖 code，不依赖原始异常文本。

**Registration codes**:

`scripts-root-unavailable`、`manifest-read-failed`、`manifest-json-invalid`、`manifest-invalid`、`manifest-schema-incompatible`、`script-id-conflict`、`entry-outside-package`、`entry-missing`、`entry-load-failed`、`entry-contract-invalid`、`api-version-incompatible`

**Runtime codes**:

`profile-not-found`、`profile-busy`、`game-not-ready`（仅保留旧版诊断兼容，通用能力不再产生）、`window-unavailable`、`config-invalid`、`coordinates-missing`、`coordinates-invalid`、`run-cancelled`、`run-timeout`、`script-failed`、`capture-failed`、`capture-expired`、`cdp-unavailable`、`cdp-already-attached`、`cdp-attach-failed`、`cdp-detached`、`cdp-dispatch-failed`、`action-timeout`、`storage-read-failed`、`storage-write-failed`

**State machine**:

```text
idle -> running -> succeeded
                -> failed
                -> stopping -> cancelled
```

Timeout 使用取消信号清理，但终态固定为 `failed/run-timeout`。终态保留到同一 `Profile + scriptId` 的下一次运行。同步竞态采用“首个终止原因获胜”；旧 run 的迟到 API 通过 run token fencing 拒绝。

## 11. 验证层级与历史证据

**Historical verified facts from `demo/builtin-auto` (2026-07-29)**:

- hidden Chromium：DOM clickCount=1，focus false→false，系统鼠标不动。
- hidden Pepper Flash 34.0.0.376：真实 AS3 `MouseEvent.CLICK`，高 DPI、`wmode=direct`、focus/cursor 均通过。
- 双目标：first→second，派发间隔约 1006ms，AS3 接收间隔约 1008ms。
- 腾讯真实游戏：用户人工完成截图录点、Profile JSON、运行时尺寸映射和连续后台点击；确认顺序、约 1000ms、无抢焦点和无系统鼠标移动。

这些是历史证据，当前 main 尚未恢复或重跑对应测试。实现必须通过正式 API 重建自动回归；真实游戏仍是人工验收，不能描述为 CI。

**Rejected historical route**:

- PreloadSwf/FlashProbe/TCP/`mm.cfg` 路线未在普通发布版 Pepper Flash 中建立连接，未验证 DisplayList 或公共函数访问。
- 不迁移 `src/flash-probe/**`、FlashProbe server/runtime、临时 preload/IPC 或 AS3 Agent。

## 12. Primary Sources

- Electron 11.5.0 runtime matrix（Node 12.18.3 / Chromium 87）: https://releases.electronjs.org/release/v11.5.0
- Electron `app.getAppPath()` / `userData`: https://www.electronjs.org/docs/latest/api/app
- Electron ASAR read/require and read-only behavior: https://www.electronjs.org/docs/latest/tutorial/asar-archives
- Electron Debugger API: https://www.electronjs.org/docs/latest/api/debugger
- Electron `webContents.capturePage` / debugger: https://www.electronjs.org/docs/latest/api/web-contents
- Node 12.18.3 CommonJS modules: https://nodejs.org/download/release/v12.18.3/docs/api/modules.html
- Node 12.18.3 globals: https://nodejs.org/download/release/v12.18.3/docs/api/globals.html
- Repository baseline: `package.json`, `src/main.js`, `src/app/Launcher.js`, `src/app/TencentLaunchFlow.js`, `src/profiles/*`, `src/ui/manager/*`, `src/utils/logger.js`
- Demo evidence: `demo/builtin-auto:docs/CDP_PPAPI_BACKGROUND_AUTOMATION_POC.md` and commits `7681c33`, `a646977`
