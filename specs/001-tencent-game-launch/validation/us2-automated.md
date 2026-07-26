# T040 / US2 自动验证记录

记录日期：2026-07-25  
运行平台：Windows / PowerShell  
分支：`001-tencent-game-launch`  
结论：**PASS，可进入 T041 / G3a 同进程 Session 复用人工门**

## Red 基线

| 任务 | Red 命令 | 预期失败 |
| --- | --- | --- |
| T033 | `npx jest --runInBand --forceExit src/profiles/__tests__/manager.test.js` | 52/54 通过；2 项仅因 launch/close 仍调用旧 shadow Cookie restore/snapshot 失败 |
| T034 | `npx jest --runInBand --forceExit src/ui/manager/__tests__/KeyboardShortcuts.test.js` | 14/15 通过；1 项仅因 F5 fallback 仍调用 `clearStorageData` 失败 |
| T035 | `npx jest --runInBand --forceExit src/app/__tests__/TencentLaunchFlow.test.js` | 34/37 通过；3 项仅因游戏态回 SELECTOR/AUTH 尚未进入 `SESSION_REJECTED` 失败 |

三组失败均来自缺少目标 Session 生命周期行为，没有通过放宽断言或扩大安全例外解决。

## 实现结果

- Profile launch/close 不再调用 `restoreCookies`、`snapshotCookies` 或 Vault；旧 snapshot API/实现暂时保留，
  但从腾讯启动路径不可达。
- 同一 Profile 继续由 Launcher 的单窗口 registry 管理，并稳定映射到
  `persist:profile-<id>`；A/B 的 webContents、窗口状态和恢复计数按 ID 分离。
- F5 委托 `TencentLaunchFlow.reloadCurrentRole()`；只 reload 已精确分类的 SELECTOR/AUTH/GAME_MAIN，
  UNKNOWN 不 reload，且从不清 Session、调用 API login 或密码预认证。
- 游戏相关状态被官方带回 SELECTOR/AUTH 时进入 `SESSION_REJECTED`；重新扫码回到 SELECTOR 后进入
  `SELECTOR_READY`。流程不检查/解码 Cookie 或票据值，不自动选服或进入游戏。
- 管理页只显示主进程固定生成的“会话被腾讯官方拒绝，请重新扫码”，拒绝账号、QQ、区服或页面文本进入广播。

## US2 定向测试

命令：

```powershell
npx jest --runInBand --forceExit src/profiles/__tests__/manager.test.js src/profiles/__tests__/partition.test.js src/ui/manager/__tests__/KeyboardShortcuts.test.js src/app/__tests__/TencentLaunchFlow.test.js src/app/__tests__/Launcher.test.js src/ui/manager/__tests__/StateBroadcaster.test.js src/ui/__tests__/tencent-ui.test.js
```

结果：`7/7` suites、`224/224` tests PASS。

## US1 回归

命令：

```powershell
npx jest --runInBand --forceExit src/config/__tests__/urls.test.js src/app/__tests__/TencentLaunchFlow.test.js src/app/__tests__/electron-mock.test.js src/app/__tests__/Launcher.test.js src/app/__tests__/SessionLifecycle.test.js src/profiles/__tests__/partition.test.js src/profiles/__tests__/store.test.js src/profiles/__tests__/manager.test.js src/utils/__tests__/logger.test.js src/network/__tests__/inspector.test.js src/utils/__tests__/diagnostics.test.js src/ui/manager/__tests__/IpcRouter.test.js src/ui/manager/__tests__/StateBroadcaster.test.js src/ui/manager/__tests__/ManagerWindow.test.js src/ui/manager/__tests__/KeyboardShortcuts.test.js src/ui/__tests__/tencent-ui.test.js src/flash/__tests__/plugin.test.js
```

结果：`17/17` suites、`505/505` tests PASS。Jest 仅保留实施前已记录的
open-handle/`--forceExit` 提示。

## 静态与工具链检查

命令：

```powershell
$env:ESLINT_USE_FLAT_CONFIG='false'; npx eslint src/
rg -n "restoreCookies|snapshotCookies" src/profiles/manager.js src/app/Launcher.js src/app/TencentLaunchFlow.js
rg -n "clearStorageData|reloadWithPreAuth|api-login|loginAndInject|password|vault" src/ui/manager/KeyboardShortcuts.js src/app/Launcher.js src/app/TencentLaunchFlow.js
Get-FileHash -Algorithm SHA256 package-lock.json
```

结果：

- ESLint PASS；
- 腾讯 launch path：`no-shadow-cookie-copy-in-tencent-launch-path`；
- F5/LaunchFlow：`no-f5-session-clear-or-preauth-chain`；
- `package-lock.json` SHA-256 保持
  `216ABA49685A226E07553B67C114CCDD2F2954FA70D84440C92A5981658F1DBB`。

## SC-004 口径变更后复跑

2026-07-25 完成 Spec → Research/Plan/Tasks/Data Model/Contract/Quickstart/验证记录同步，并完成
Constitution I-X 与文档一致性复查后，重新运行上述 17-suite Jest 命令：

- `17/17` suites、`505/505` tests PASS；
- `npx eslint . --ext .js`：0 errors、2 个既有 `tools/network-monitor.js` `no-empty` warnings；
- `package-lock.json` SHA-256 仍为
  `216ABA49685A226E07553B67C114CCDD2F2954FA70D84440C92A5981658F1DBB`。

## T040 判定

**PASS**

US2 定向测试和 US1 回归均通过，可以按 tasks.md 进入 T041/G3a。2026-07-25 的运行时证据与用户确认
已把 SC-004 调整为“Electron 主进程保持运行时，关闭并重开同一 Profile 游戏窗口”的正式矩阵；
自动化结论不受影响。T041-T043 仍是 Windows 人工门；本记录不证明真实腾讯有效 Session
同进程连续 `2/2` 复用、真实失效回扫码或双 Profile 账号隔离。
