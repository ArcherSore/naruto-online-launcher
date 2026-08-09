# 内置自动化脚本作者指南

此目录只存放由项目维护、随启动器发布并经过代码审查的可信脚本。每个脚本使用一个直接子目录；运行时不会从用户目录、网络或任意路径安装脚本，也不提供针对恶意代码的安全沙箱。

## 包结构与 manifest v1

```text
automation-scripts/
└── example-script/
    ├── manifest.json
    ├── index.js
    ├── lib/helper.js       # 可选相对 CommonJS 模块
    └── assets/             # 可选只读资源
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
- manifest、入口、相对模块和 `assets` 都是只读安装资源。用户配置与坐标由框架写入 `userData/automation-data`，脚本不得修改安装目录。

## 入口与最小上下文

入口必须直接导出运行函数，不得导出 `{ manifest, run }`：

```js
'use strict';

module.exports = async function run(context) {
  const points = await context.automation.getCoordinates();
  for (let index = 0; index < points.length; index++) {
    if (context.signal.aborted) return;
    await context.automation.click(points[index]);
  }
};
```

`context` 只包含：

- `profileId`
- 深冻结的 `config`
- 只读协作式取消 `signal`
- 已绑定运行/Profile/脚本身份的结构化 `log`
- 深冻结的 `automation` API：`capture`、`getWindowState`、`getCoordinates`、`click`、`wait`

禁止导入或访问 `electron`、启动器 `src/`、Profile registry、`BrowserWindow`、`webContents`、debugger/CDP、网络模块、进程执行模块、绝对路径或认证/Session 数据。相对模块必须留在本脚本包内；读取静态文件时只能访问自己的只读 `assets`。

## 取消、时限与错误

所有 API 动作都由正式 coordinator 串行执行，并在开始前检查 lease、Profile、窗口/webContents、所需内容尺寸、输入、取消状态和 deadline。`GAME_READY` 仅作诊断，不是通用能力门槛；脚本如需确认特定游戏画面，应通过受限 Automation API 实现自己的判断。脚本应使用 `await`，在循环边界检查 `context.signal.aborted`，并让 `automation.wait()` 响应取消。不要捕获后吞掉 `run-cancelled`、`run-timeout` 或其他稳定框架错误。

脚本与框架运行在同一 Electron 主进程。同步死循环或长时间同步计算不会向 event loop 交还控制权，因此第一版无法硬终止这种代码；发布前必须通过审查和测试排除此类实现。不得把当前可信内置脚本边界描述为可安全运行第三方或恶意脚本的沙箱。

## 提交前验证

至少运行：

```powershell
npm test -- --runInBand src/automation/__tests__/script-boundary.test.js
npm test -- --runInBand src/automation/__tests__/package-discovery.test.js
npm run lint
```

新增或调整坐标点击行为时，还必须通过正式 registry → runner → Automation API 的 Chromium 与 PPAPI/AS3 runtime smoke；不得直接从脚本、UI 或测试绕过正式链路调用 Electron/CDP。
