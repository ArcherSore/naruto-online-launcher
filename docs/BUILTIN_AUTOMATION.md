# 内置自动化框架

本框架只运行由本项目维护、代码审查并随 Windows 安装包发布的可信 CommonJS 脚本。它不是
第三方脚本系统或恶意代码沙箱；脚本、管理 UI 和测试都必须经过正式 registry、runner、
coordinator 与 Automation API，不得直接操作 Electron、CDP 或 Launcher 内部对象。

## 正式模块边界

```text
automation-scripts/<package>
  -> registry（固定根目录、manifest v1、入口/包边界、ID 冲突）
  -> runner（状态、runId、deadline、取消）
  -> coordinator（Profile lease、动作 FIFO）
  -> Automation API（capture/window state/coordinates/click/wait）
  -> Vision API（find/waitFor/waitUntilGone）
  -> backend -> Launcher 当前 Profile 的隔离窗口
```

- `src/automation/index.js` 只负责组合服务并订阅 Profile 删除、窗口关闭和应用退出。
- `registry.js` 不接受用户路径或在线脚本；一个坏包不会阻止其他包注册。
- `runner.js` 向入口传入深冻结的最小 context，不暴露 registry、Session、窗口或认证数据。
- `coordinator.js` 保证一个 Profile 同时只有一个 automation lease，并串行化其动作；不同
  Profile 的 lease 相互独立。
- `api.js` 是脚本能力边界；`backend.js` 才能定位 Launcher target、映射当前内容尺寸并用 CDP
  派发后台点击。
- `vision/api.js` 复用同一 run/Profile FIFO；`codec.js` 用 Electron nativeImage 解码 PNG，
  `matcher.js` 以纯 JS 协作分片做 exact-scale + ROI 匹配，`template-loader.js` 只从 registry
  记录的当前脚本 `packageRoot/assets/vision/` 加载模板。
- 通用能力只检查所属 Profile 的窗口/webContents、内容尺寸、输入、lease 与动作生命周期；
  `GAME_READY` 仅作诊断，不是截图、录点、启动或点击的全局门槛。脚本如需等待特定画面，
  应通过受限 Automation API 自行判断。
- `recording.js` 的截图只作为短期录点数据返回给发起它的管理窗口，过期、窗口关闭或 owner
  离开后即清理，不进入普通日志。
- `IpcRouter.js` 校验 manager sender、Profile/script/run 标识并只返回白名单 DTO；
  `StateBroadcaster.js` 只广播安全 catalog 和状态。

## 脚本作者流程

1. 在 `automation-scripts/` 新建一个直接子目录，提交 `manifest.json`、CommonJS 入口和可选
   相对模块/`assets`。完整 manifest 与 context 示例见该目录的 `README.md`。
2. 入口直接 `module.exports = async function run(context) { ... }`；发布内容必须是 Node.js 16
   可直接运行的 JavaScript。TypeScript 必须先预编译，不能要求用户安装编译器。
3. 只使用 `context.profileId/config/signal/log/automation/vision`。Automation API v1 仅提供
   `capture()`、`getWindowState()`、`getCoordinates()`、`click(point)`、`wait(ms)`。
   Vision v1 仅提供 `find(templateId, options?)`、`waitFor(...)`、`waitUntilGone(...)`。
4. 每个异步动作都 `await`，循环边界检查 `context.signal.aborted`；禁止同步死循环或长时间同步
   计算，因为可信同进程模型无法硬终止阻塞 event loop 的代码。
5. 用 registry、脚本边界、runner/API 测试验证合同；涉及点击时必须再通过 Chromium 与
   PPAPI/AS3 正式链路 smoke，最后重建 Windows portable 并审计 ASAR。

禁止脚本导入 `electron`、启动器 `src/`、绝对路径、网络或进程执行模块，也禁止访问
`BrowserWindow`、`webContents`、debugger/CDP、Profile registry、Session、Cookie、票据、
验证码或 URL query。

## 安装资源与用户数据

- `automation-scripts/**` 是只读安装资源；manifest、入口、相对模块和 assets 会进入 ASAR。
- 视觉模板固定为当前已注册脚本包的 `assets/vision/<template-id>.png`，templateId 仅允许
  1～64 位 lowercase slug。脚本不能传路径/URL/root/身份 override；成功模板可按脚本身份在
  进程内只读缓存，但截图、ROI、结果和等待状态不跨 Profile/run 缓存，也不进入 userData。
- 配置与坐标保存在
  `app.getPath('userData')/automation-data/profiles/<profileId>/scripts/<scriptId>/`，文件分别为
  `config.json` 与 `coordinates.json`。
- 数据 envelope 包含 `schemaVersion`、`profileId`、`scriptId` 和 `updatedAt`。读取时会验证身份、
  schema、大小与坐标；写入使用同目录临时文件再原子替换。
- 定向清除只删除对应 payload；Profile 删除会停止运行和清除临时录点，不递归删除持久用户
  数据。应用更新或脚本资源替换不得覆盖这些数据。

## 稳定状态与错误

运行状态固定为 `idle`、`running`、`stopping`、`succeeded`、`failed`、`cancelled`。状态保留
当前/最近一次 `runId`、时间与安全错误摘要；停止旧 runId 不得影响同 Profile 的新运行。

稳定错误码按职责分组：

- 注册：`scripts-root-unavailable`、`manifest-read-failed`、`manifest-json-invalid`、
  `manifest-invalid`、`manifest-schema-incompatible`、`script-id-conflict`、
  `entry-outside-package`、`entry-missing`、`entry-load-failed`、`entry-contract-invalid`、
  `api-version-incompatible`。
- 身份/运行：`script-not-found`、`profile-not-found`、`profile-busy`、`game-not-ready`（保留的旧版
  诊断码，通用 v1 能力不再产生）、
  `window-unavailable`、`run-not-active`、`run-cancelled`、`run-timeout`、`script-failed`。
- 数据/录点：`config-invalid`、`coordinates-missing`、`coordinates-invalid`、`capture-failed`、
  `capture-expired`、`storage-read-failed`、`storage-write-failed`。
- 后台动作：`cdp-unavailable`、`cdp-already-attached`、`cdp-attach-failed`、`cdp-detached`、
  `cdp-dispatch-failed`、`action-timeout`。
- Vision：`vision-input-invalid`、`vision-template-id-invalid`、`vision-template-not-found`、
  `vision-template-read-failed`、`vision-template-invalid`、`vision-template-too-large`、
  `vision-timeout`。有效 `find` no-match 是 `null`，有效 `waitUntilGone` no-match 是 `true`，
  均不是错误；后者也不代表此前业务动作成功。

Vision options 采用严格合同：threshold 默认 `0.95`；ROI 是截图像素整数矩形；等待 timeout
默认 `10000ms`（显式 `1..60000`），poll interval 默认 `250ms`（显式 `50..10000` 且不大于
timeout）。首轮立即检查，后续从上一轮结束后等待，不重叠。运行 cancellation/deadline 优先于
局部 `vision-timeout`。

Vision result 的 `rect` 属于截图像素空间；`center` 才是可原样传给 `automation.click()` 的
normalized point。内部先把截图中心量化为 content pixel，再编码为 normalized cell midpoint；
click mapper 仍按执行时规范 contentSize `floor` 回公开整数 contentPoint，backend 随后把该
pixel 单元格中心映射到当前 BrowserWindow/CDP viewport。DIP 不进入 Vision 或脚本 API。
v1 产品边界仍是 `1920×1080 + Windows 100%`，纯逻辑 unequal-size/DIP 哨兵不代表 DPI 或
多缩放支持。

启动器“自动化”面板提供受控的人工验收入口：选中脚本后点击“Vision 框选”，在截图上拖出
ROI，面板会自动填入 screenshot-pixel ROI 和中心坐标，并只列出该脚本自身
`assets/vision/*.png` 的安全 templateId。随后可点击“匹配”查看 rect/confidence，或点击
“匹配并点击”让命中的 `center` 经正式 `automation.click()` 链派发。该入口不接受文件路径，
不绕过 registry、Profile lease、模板隔离、Vision API 或坐标 mapper。

renderer 只能显示 `src/automation/errors.js` 为已知码定义的安全说明。注册日志仅记录安全包名、
script ID、错误码与计数；运行日志只记录 run/Profile/script/phase/level 等结构化字段，不记录
截图、坐标、配置、manifest 原文、绝对路径、异常 stack 或腾讯登录态材料。

## 验证命令（Windows）

```powershell
npm test -- --runInBand
npm run lint
.\node_modules\.bin\electron.cmd tests\runtime\cdp-viewport-coordinate-smoke.js
.\node_modules\.bin\electron.cmd tests\runtime\cdp-background-smoke.js
.\node_modules\.bin\electron.cmd tests\runtime\cdp-ppapi-background-smoke.js
npm run build:win
$env:AUTOMATION_ASAR_PATH = (Resolve-Path 'dist/win-unpacked/resources/app.asar').Path
npm test -- --runInBand src/automation/__tests__/package-discovery.test.js
.\node_modules\.bin\electron.cmd tests\runtime\packaged-automation-smoke.js $env:AUTOMATION_ASAR_PATH
```

打包运行链使用固定 Electron `11.5.0` 执行 `tests/runtime/packaged-automation-smoke.js`，registry、
脚本和模板全部从实际 Windows `app.asar` 读取。
最终腾讯游戏验证按 Feature quickstart 进行，只记录非敏感文字结论。

## 不得恢复的失败路线

本框架只选择性保留已验证的归一化坐标映射、CDP 三事件点击、Chromium/PPAPI 靶场与
`demo-click` 行为。不得恢复或迁移 FlashProbe、PreloadSwf、TCP、`mm.cfg`、临时 Demo
IPC/UI、像素差证据流，也不得整体 cherry-pick Demo 分支。新增脚本不能复制窗口查找、DPI
映射或 CDP 生命周期；这些职责必须留在正式 backend/API。Vision v1 不包含 multi-scale、OCR、
rotation、feature/object detection、Python/OpenCV、Worker/WorkerPool、新输入、调度器或 DSL。
