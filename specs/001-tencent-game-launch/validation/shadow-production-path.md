# T044 / G3d shadow 生产路径不可达验证

记录日期：2026-07-25  
范围：腾讯 launch、close、reload、会话失效、重新扫码/恢复生产路径  
结论：**PASS**

## 静态调用者审计

只读扫描结果：

```text
TENCENT_PRODUCTION_SHADOW_CALLS=0
TARGET_PATH_CLEAR_STORAGE_CALLS=0
NETWORK_COOKIES_PRODUCTION_CALLERS=0
```

分类结论：

- `snapshotCookies`/`restoreCookies` 仅在 `src/profiles/partition.js` 定义、导出，并由旧模块自测直接调用；
  `src/app/Launcher.js`、`src/app/SessionLifecycle.js`、`src/app/TencentLaunchFlow.js`、
  `src/profiles/manager.js`、`src/ui/manager/KeyboardShortcuts.js` 均不调用。
- `src/profiles/manager.js` 的 `removeSnapshot` 只在用户明确删除整个 Profile 的 `remove()` 路径调用，
  不属于 launch、close、reload、会话失效或恢复路径。
- `src/network/cookies.js` 的全量 Cookie/Storage 清理函数没有生产调用者；腾讯 Launcher 也不安装该模块。
- `src/memory/GcDaemon.js` 只对空闲 Session 清 `cachestorage` 并跳过活动 Profile；没有清 Cookie、
  localStorage 或其他认证存储，不属于上述目标路径。
- `SessionLifecycle` 的 load/close 只调用 `cookies.flushStore()`；该操作只刷新待写数据，不复制、
  恢复、延长或清理 Cookie。
- 旧 shadow API、实现及旧模块自测按 T044 要求保留；本任务没有执行删除。实际删除仍受 T059
  全量调用者审计约束，只能由 T062 原子执行。

## 自动回归

命令：

```powershell
npx jest --runInBand --forceExit src/profiles/__tests__/manager.test.js src/profiles/__tests__/partition.test.js src/app/__tests__/Launcher.test.js src/app/__tests__/SessionLifecycle.test.js src/app/__tests__/TencentLaunchFlow.test.js src/ui/manager/__tests__/KeyboardShortcuts.test.js
```

结果：

- `6/6` suites PASS；
- `195/195` tests PASS；
- manager 证明旧 snapshot API 保持导出但 launch/close 不调用；
- Launcher/SessionLifecycle/TencentLaunchFlow/KeyboardShortcuts 证明 reload、失效、恢复和关闭不清 Session；
- Jest 仅保留既有 `--forceExit` open-handle 提示。

## 锁文件

`package-lock.json` SHA-256：

```text
216ABA49685A226E07553B67C114CCDD2F2954FA70D84440C92A5981658F1DBB
```

与基线一致。
