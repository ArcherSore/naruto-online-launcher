# 行为保持回归台账

| Invariant ID | 范围 | 清理前证据 | 清理后证据 | Profile 范围 | 状态 |
| --- | --- | --- | --- | --- | --- |
| `INV-AUTH-01` | 腾讯 selector/auth/game、官方扫码与手动选服 | `TencentLaunchFlow.test.js` baseline PASS | 既有自动 PASS；用户确认单 Profile 扫码进入游戏与刷新正常；双 Profile/失败恢复滞后 | 单/双 Profile | partial |
| `INV-WEB-01` | 腾讯页面无翻译、隐藏、DOM/响应写入 | 生产流程无此类写入 | 仅 logger 固定字面量允许 diff；页面逻辑无修改；完整视觉核对滞后 | 单 Profile | partial |
| `INV-SESSION-01` | `persist:profile-<id>` 稳定映射与 A/B 隔离 | `partition.test.js` baseline PASS | 自动 PASS；双账号 E2E NOT RUN | 双 Profile | partial |
| `INV-LIFE-01` | load/crash/responsive/close 与 Session flush | `SessionLifecycle.test.js` baseline PASS | PASS | 单 Profile | pass |
| `INV-NAV-01` | 页面探针、导航、刷新与有界恢复 | `TencentLaunchFlow.test.js` baseline PASS | PASS：ProbeBudget/恢复/刷新断言 | 单 Profile | pass |
| `INV-FLASH-01` | `plugins:true`、PPAPI、窗口时序与缺失退出 | `Launcher.test.js` baseline PASS | 自动 PASS、Windows 构建 PASS；真实 Flash NOT RUN | 单 Profile | partial |
| `INV-DIAG-01` | ZIP entry、日志/crash 原文、脱敏与大小限制 | `diagnostics.test.js` baseline PASS | PASS | 全局 | pass |
| `INV-LOCK-01` | 运行时、依赖、锁文件与兼容键不变 | 固定版本与锁哈希 | PASS | 全局 | pass |

## 完全不修改路径

- `package-lock.json`
- `src/config/urls.js`
- `src/preload.js`

## 只允许开发者固定文本 diff 的行为所有者

- `src/app/TencentLaunchFlow.js`
- `src/app/SessionLifecycle.js`
- `src/profiles/partition.js`
- `src/flash/`
- `src/network/inspector.js`
- `src/utils/logger.js`

AST 合同确认生产 logger 调用仍为 145 个；固定片段英文化未改变级别、第二参数、动态值或控制流。`src/utils/logger.js` 只把 emoji 前缀改为 ASCII 级别前缀，脱敏、allowlist 和 transport 测试通过。

## 混合模块 diff

- `src/main.js`：语言默认/校验、setup 标题/locale、Flash 缺失 dialog、logger 固定模板和启动横幅。
- `src/app/Launcher.js`：`loadingPage()` 可见文字和 logger 固定模板。
- `src/ui/manager/IpcRouter.js`：用户文案、支持语言事实源、logger 固定模板和启动器自编 machine error 摘要；IPC channel 与 handler 保持。
- `src/profiles/store.js`：自动生成显示名称和 logger 固定模板。
- `src/utils/diagnostics.js`：README、dialog、显示文件名和 logger 固定模板；entry/动态错误/脱敏不变。
- setup/loading/Linux/package：仅合同允许的展示与 locale 点。

`package-lock.json` 哈希不变；完全不修改路径无新增 diff；`package.json` 仍仅有先前 desktop `Comment`/`GenericName` diff。

本次日志修订按用户决定未重复全量 Jest、构建或滞后 E2E；定向 developer-copy/logger/IpcRouter/diagnostics 为 4 suites / 85 tests PASS，相关 28 个 JavaScript 文件 ESLint PASS，`git diff --check` PASS。

## 构建与环境

- Windows portable：PASS。
- Linux `linux-unpacked`：PASS。
- Linux AppImage：BLOCKED，Windows 交叉构建依赖 `service.electron.build`，连续三次 EOF。
- 真实腾讯页面、双 Profile、Flash 交互和 Linux VM：NOT RUN。
