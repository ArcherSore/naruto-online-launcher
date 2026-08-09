# Quickstart：实现与验收内置自动化脚本框架

本文是本 Feature 的实现后验收指南。当前 `feature/framework` 已回到
`main@4967578` 基线，因此文中提到的正式自动化测试、脚本包和运行时靶场需要在实现阶段从
`demo/builtin-auto` 选择性迁移后才会出现。

## 1. 环境与基线

- 使用仓库 Volta 固定版本：Node.js `16.20.2`、npm `8.19.4`。
- 保持 Electron `11.5.0` 和 Pepper Flash 配置，不升级核心运行时。
- 确认当前分支为 `feature/framework`，并确认没有把 Demo 两个提交整体合入。
- 安装依赖时不得改写 `package-lock.json`。

实现前记录基线：

```powershell
git branch --show-current
git rev-parse --short HEAD
npm test -- --runInBand
npm run lint
```

预期：分支为 `feature/framework`；HEAD 与本计划记录的 `main@4967578` 一致；现有测试和 lint
通过。若仓库基线之后前移，应在实施前重新核对计划假设，不应强行回退用户提交。

## 2. 自动化测试

实现完成后至少运行：

```powershell
npm test -- --runInBand
npm run lint
```

测试套件应覆盖：

- manifest 合法注册，以及非法 JSON、字段错误、入口越界、入口缺失、导出合同错误、ID
  冲突和 API 版本不兼容；
- 开发目录和打包资源中的脚本发现；
- `Profile + scriptId` 配置与坐标隔离、原子写入、损坏数据和身份不匹配；
- 同一 Profile 占用互斥、动作 FIFO、不同 Profile 并行；
- `idle/running/stopping/succeeded/failed/cancelled` 状态转换；
- 用户停止、5 分钟总超时、窗口关闭、Profile 删除、无效内容尺寸和 CDP 异常；
- 目标窗口可用但 `gameReady=false` 时，启动、截图录点和点击仍可用；
- `demo-click` 读取坐标并按顺序调用点击与等待；
- IPC sender、参数和返回 DTO 白名单；
- 脚本 context 不暴露 Electron、窗口、registry、Session、登录态或任意 CDP 方法。

## 3. Chromium 与 PPAPI 运行时回归

实现阶段从 Demo 分支恢复并重构两类 smoke，使它们只经过正式 Automation API：

```powershell
.\node_modules\.bin\electron.cmd tests\runtime\cdp-background-smoke.js
.\node_modules\.bin\electron.cmd tests\runtime\cdp-ppapi-background-smoke.js
```

验收点：

- Chromium 隐藏目标可收到连续点击；
- Pepper Flash/AS3 双目标按记录顺序收到真实 `MouseEvent.CLICK`；
- 点击间隔与示例脚本配置相符；
- 操作前后游戏窗口均不获得焦点；
- 操作前后系统鼠标位置不变；
- 高 DPI 和运行时内容尺寸变化时，归一化坐标仍映射到正确目标；
- 测试证据只写临时目录，测试结束后清理。

这些 smoke 不应恢复失败的 PreloadSwf、FlashProbe、TCP 或 `mm.cfg` 路线。

## 4. 开发环境验收

1. 启动应用，确认固定内置脚本目录中的 `demo-click` 被发现。
2. 为 Profile A 打开自动化面板；只要游戏窗口已经出现，即使面板收到的诊断状态仍为
   `gameReady=false`，截图录点和启动按钮也应可用。截图并记录至少两个点。
3. 启动 `demo-click`，确认状态按 `running → succeeded` 变化，两个点被连续后台点击。
4. 运行期间切换到其他桌面窗口，确认游戏不抢焦点、系统鼠标不移动。
5. 再次启动并在等待阶段点击停止，确认 `running → stopping → cancelled`。
6. 制造超时、关闭游戏窗口、删除测试 Profile、占用 DevTools/debugger，分别确认稳定错误码和安全说明。
7. 同时对 Profile A 启动两个脚本/命令，确认第二个立即返回 `profile-busy`，且动作不交错。
8. 同时对 Profile A 与 Profile B 启动，确认两者独立运行。
9. 为 Profile A/B 和两个脚本分别保存配置、坐标，重新启动后确认四组数据互不覆盖。

## 5. 安装包验收

```powershell
npm run build:win
```

至少实际启动 Windows 安装产物并检查：

- `demo-click` 的 manifest、入口和 assets 位于安装资源中，且能从 ASAR 内发现与加载；
- 用户数据写入 `userData` 下的自动化数据目录，而不是脚本包或应用安装目录；
- 更新/覆盖安装后，原有 Profile 配置和坐标仍存在；
- 非法测试脚本包不会阻止启动器启动或其他合法脚本注册；
- 开发环境与安装包返回相同的脚本 ID、API 版本和行为结果。

第一版只维护和验收 Windows x64，不需要 WSL 或 Linux AppImage 构建证据。

## 6. 腾讯真实游戏最小人工回归

1. 使用测试 Profile 按腾讯官方网页扫码、选服并进入游戏；不记录 Cookie、票据、验证码或
   URL query。
2. 记录操作前的前台窗口和系统鼠标位置。
3. 在管理页为 `demo-click` 截图并依次记录两个低风险坐标。
4. 将焦点切到与游戏无关的窗口后启动脚本。
5. 目视确认游戏按顺序响应两次点击，间隔符合脚本配置。
6. 确认前台窗口未切换到游戏，系统鼠标位置未改变。
7. 仅记录启动器版本、脚本版本、Profile 的非敏感内部 ID、内容尺寸、时间和结论；不保存或
   提交原始游戏截图。

若任何步骤需要绕过腾讯登录、验证码或风控，立即停止；该行为不属于本 Feature。

## 7. 通过标准

- 所有现有 Jest 与 lint 检查通过；
- Chromium、PPAPI/AS3 正式 API smoke 通过；
- 开发环境和 Windows 安装包均发现并运行 `demo-click`；
- 并发、取消、超时、异常、数据隔离和注册拒绝均符合契约；
- 腾讯真实游戏最小人工回归通过，且没有焦点或系统鼠标副作用；
- `package-lock.json`、Electron、Node/npm 固定版本和登录流程未被无关修改。
