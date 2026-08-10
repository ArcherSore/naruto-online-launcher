# 内置自动化脚本作者指南

此目录只存放由项目维护、随启动器发布并经过代码审查的可信脚本。每个脚本使用一个直接子目录；运行时不会从用户目录、网络或任意路径安装脚本，也不提供针对恶意代码的安全沙箱。

## 包结构与 manifest v1

```text
automation-scripts/
└── example-script/
    ├── manifest.json
    ├── index.js
    ├── lib/helper.js       # 可选相对 CommonJS 模块
    └── assets/
        └── vision/
            └── <template-id>.png  # 可选脚本专属视觉模板
```

`manifest.json` 必须包含：

```json
{
  "schemaVersion": 1,
  "id": "example-script",
  "name": "示例脚本",
  "version": "1.0.0",
  "entry": "index.js",
  "apiVersion": 1,
  "description": "可选说明"
}
```

- `id` 必须是 1～64 字符的 lowercase ASCII slug，并在 NFKC + lowercase 后保持唯一。
- `entry` 必须是包内相对 `.js` 路径；禁止绝对路径、`..` traversal 和符号链接逃逸。
- TypeScript 只能用于开发，提交和发布前必须预编译为 Node.js 16 / CommonJS 可直接运行的 JavaScript。
- manifest、入口、相对模块和 `assets` 都是只读安装资源。用户配置由框架写入 `userData/automation-data`，脚本不得修改安装目录。

## 入口与最小上下文

入口必须直接导出运行函数，不得导出 `{ manifest, run }`：

```js
'use strict';

module.exports = async function run(context) {
  const target = await context.vision.waitFor('battle-button', {
    roi: { x: 1400, y: 760, width: 480, height: 260 },
    timeoutMs: 10000
  });
  await context.automation.click(target.center);
};
```

`context` 只包含：

- 只读 `context.profileId`；脚本不得覆盖或伪造 `profileId`/`scriptId`
- 深冻结的 `config`
- 只读协作式取消 `signal`
- 已绑定运行/Profile/脚本身份的结构化 `log`
- 深冻结的 `automation` API：`capture`、`getWindowState`、`click`、`wait`
- 深冻结的 `context.vision`：`find`、`waitFor`、`waitUntilGone`

Vision v1 只做固定 `1920×1080 + Windows 100%` 基准下的 exact-scale 模板匹配，不做缩放、
OCR、旋转或外部 OpenCV。模板 ID 必须是 1～64 位 lowercase ASCII slug，模板固定放在当前
已注册脚本包的 `assets/vision/<template-id>.png`。`assets/vision` 只能通过 Vision API 使用；
脚本不得导入 `fs`/`path`/`nativeImage`，也不能传文件路径、URL、packageRoot、Profile 或脚本身份
override。

```js
const found = await context.vision.find('battle-button', {
  roi: { x: 1400, y: 760, width: 480, height: 260 },
  threshold: 0.97
});
if (found) await context.automation.click(found.center);

await context.vision.waitFor('battle-button', {
  timeoutMs: 10000,
  pollIntervalMs: 250
});
await context.vision.waitUntilGone('loading-indicator', {
  timeoutMs: 30000,
  pollIntervalMs: 500
});
```

`rect` 和 ROI 属于 screenshot pixel；只有 `{ normalizedX, normalizedY }` 的 `center` 可原样传给
`automation.click()`。`confidence` 与 `threshold` 均为 `[0,1]`。threshold 默认 `0.95`；两种
等待的 timeout 默认 `10000ms`（显式 `1..60000`），polling interval 默认 `250ms`（显式
`50..10000` 且不大于 timeout）。第一轮立即检查，轮次不重叠。

`find` 的有效 no-match 返回 `null`；`waitFor` 自身超时抛 `vision-timeout`；
`waitUntilGone` 首次有效 no-match 返回 `true`，但该值不证明此前点击或业务动作成功。runner 的
`run-cancelled`/`run-timeout` 优先于视觉局部 timeout，结果确定后不会被迟到事件改写。

禁止导入或访问 `electron`、`fs`、`path`、`nativeImage`、启动器 `src/`、Profile registry、
`BrowserWindow`、`webContents`、debugger/CDP、网络模块、进程执行模块、绝对路径或认证/Session
数据。相对代码模块必须留在本脚本包内；视觉模板只能由绑定当前脚本身份的 Vision API 读取。

## 取消、时限与错误

所有 API 动作都由正式 coordinator 串行执行，并在开始前检查 lease、Profile、窗口/webContents、所需内容尺寸、输入、取消状态和 deadline。`GAME_READY` 仅作诊断，不是通用能力门槛；脚本如需确认特定游戏画面，应通过受限 Vision API 表达。脚本应使用 `await`，在循环边界检查 `context.signal.aborted`，并让 `automation.wait()` 与视觉等待响应取消。不要捕获后吞掉 `run-cancelled`、`run-timeout`、`vision-timeout` 或其他稳定框架错误。

Vision 模板错误稳定区分 `vision-template-id-invalid`、`vision-template-not-found`、
`vision-template-read-failed`、`vision-template-invalid` 与 `vision-template-too-large`；非法 options
为 `vision-input-invalid`。日志只允许已校验模板 ID、阶段、attempt、耗时、尺寸和稳定 code，
不记录 PNG/bitmap、路径、raw decoder/fs error、URL、Cookie 或 Session。

脚本与框架运行在同一 Electron 主进程。同步死循环或长时间同步计算不会向 event loop 交还控制权，因此第一版无法硬终止这种代码；发布前必须通过审查和测试排除此类实现。不得把当前可信内置脚本边界描述为可安全运行第三方或恶意脚本的沙箱。

## 提交前验证

至少运行：

```powershell
npm test -- --runInBand src/automation/__tests__/script-boundary.test.js
npm test -- --runInBand src/automation/__tests__/package-discovery.test.js
npm run lint
```

新增或调整坐标点击行为时，还必须通过正式 registry → runner → Automation API 的 Chromium 与 PPAPI/AS3 runtime smoke；不得直接从脚本、UI 或测试绕过正式链路调用 Electron/CDP。
