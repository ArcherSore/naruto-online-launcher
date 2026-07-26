# T045 / User Story 2 Checkpoint

记录日期：2026-07-25  
结论：**PASS，US2 完成**

## T033–T040 自动化与实现

- T033–T035：先建立 persist Partition、F5 安全 reload、Session rejected/重新扫码的 Red 测试。
- T036–T039：腾讯 launch/close 断开 shadow/Vault，F5 委托安全角色 reload，官方拒绝会话进入
  `SESSION_REJECTED`，管理 UI 只显示固定重新扫码提示。
- T040：US1+US2 定向回归 `17/17` suites、`505/505` tests PASS；SC-004 口径变更后复跑结果不变。

## G3 人工与生产路径门

| Gate | 规定结果 | 实际结果 | 证据 |
| --- | --- | --- | --- |
| T041 / G3a 有效 Session 复用 | 同一主进程内连续 `2/2` | `2/2 PASS` | `windows-cookie-persistence.md` |
| T042 / G3b 失效返回扫码 | 连续 `2/2` | `2/2 PASS` | `windows-session-expiry.md` |
| T043 / G3c 双 Profile 隔离 | 跨 Profile 污染 0 次 | 0 次，PASS | `windows-two-profile-isolation.md` |
| T044 / G3d shadow 不可达 | 目标生产路径调用 0 | shadow 调用 0、清认证存储调用 0，PASS | `shadow-production-path.md` |

T041/T042 均未要求手动删除 Profile 或 Session 数据；T043 中 Profile B 在 A 关闭/重开、
官方 logout 和重新扫码期间始终无变化。人工证据未读取 Cookie/票据值或 QQ 身份。

## T045 回归

命令：

```powershell
npx jest --runInBand --forceExit src/config/__tests__/urls.test.js src/app/__tests__/TencentLaunchFlow.test.js src/app/__tests__/electron-mock.test.js src/app/__tests__/Launcher.test.js src/app/__tests__/SessionLifecycle.test.js src/profiles/__tests__/partition.test.js src/profiles/__tests__/store.test.js src/profiles/__tests__/manager.test.js src/utils/__tests__/logger.test.js src/network/__tests__/inspector.test.js src/utils/__tests__/diagnostics.test.js src/ui/manager/__tests__/IpcRouter.test.js src/ui/manager/__tests__/StateBroadcaster.test.js src/ui/manager/__tests__/ManagerWindow.test.js src/ui/manager/__tests__/KeyboardShortcuts.test.js src/ui/__tests__/tencent-ui.test.js src/flash/__tests__/plugin.test.js
```

结果：

- `17/17` suites PASS；
- `505/505` tests PASS；
- 仅有既有 Jest `--forceExit` open-handle 提示。

## Checkpoint 判定

- SC-004：有效 Session `2/2`、失效 Session `2/2`，PASS；
- SC-005：双 Profile 污染事件 0，PASS；
- 腾讯生产路径不调用 shadow snapshot/restore，不清认证存储；
- US1 回归保持通过。

因此 T045 与 User Story 2 Checkpoint PASS，可以按 `tasks.md` 进入 T046。
