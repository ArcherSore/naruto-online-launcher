# T026 / US1 自动验证记录

记录日期：2026-07-21  
运行平台：Windows / PowerShell  
分支：`001-tencent-game-launch`  
结论：**PASS，可进入 T027 / G1 人工 host 门**

## 固定环境与锁文件

| 项目 | 实际值 | 结果 |
| --- | --- | --- |
| Node.js | `v16.20.2` | PASS |
| npm | `8.19.4` | PASS |
| Electron | `11.5.0` | PASS |
| `package-lock.json` SHA-256 | `216ABA49685A226E07553B67C114CCDD2F2954FA70D84440C92A5981658F1DBB` | 与 T001 基线一致 |

## US1 定向测试

命令：

```powershell
npx jest --runInBand --forceExit src/config/__tests__/urls.test.js src/app/__tests__/TencentLaunchFlow.test.js src/app/__tests__/electron-mock.test.js src/app/__tests__/Launcher.test.js src/app/__tests__/SessionLifecycle.test.js src/profiles/__tests__/partition.test.js src/profiles/__tests__/store.test.js src/profiles/__tests__/manager.test.js src/utils/__tests__/logger.test.js src/network/__tests__/inspector.test.js src/utils/__tests__/diagnostics.test.js src/ui/manager/__tests__/IpcRouter.test.js src/ui/manager/__tests__/StateBroadcaster.test.js src/ui/manager/__tests__/ManagerWindow.test.js src/ui/manager/__tests__/KeyboardShortcuts.test.js src/ui/__tests__/tencent-ui.test.js src/flash/__tests__/plugin.test.js
```

结果：PASS，`17/17` suites、`495/495` tests；最终复跑耗时 `5.139 s`。覆盖：

- 腾讯 SELECTOR/GAME_MAIN 精确 URL 分类、UNKNOWN 默认阻止和安全位置输出；
- Electron 11 父窗、认证子窗、redirect、`new-window`、二次 popup 递归路由；
- 认证子窗固定安全参数、同 Profile partition、游戏窗口 PPAPI 配置；
- 页面探针空生产 selector registry、可信加载触发、有界次数、3 秒超时和失败不清 Session；
- Profile 通用元数据迁移及 region/server/language/credentials 默认拒绝；
- 正常 UI/IPC/广播不暴露旧凭据、区服、JWT、Cookie value 或页面源码；
- G0 日志、诊断与 inspector 只允许安全网络元数据。

Jest 仍输出实施前已经记录的 `--forceExit`/open-handle 提示；没有新增定向测试失败。

## 首次启动页审计修正

T026 审计发现 `src/ui/setup/setup.html` 仍有旧国际服区服控件。该控件虽然已不再驱动主进程入口，仍属于用户可见 SC-007 漏项，因此在闭合本任务前已移除：

- 删除 `.region-grid` / `.region-btn` 样式和全部 `data-region` 控件；
- 删除 `setup.region.*` 国际服文案；
- 删除 `selectedRegion` 状态、事件处理和 setup result 的 `region` 字段；
- 将 `src/ui/__tests__/tencent-ui.test.js` 的静态边界扩展到首次启动页。

复验命令：

```powershell
npx jest --runInBand --forceExit src/ui/__tests__/tencent-ui.test.js src/app/__tests__/Launcher.test.js src/ui/manager/__tests__/IpcRouter.test.js
rg -n "region-grid|region-btn|data-region=|setup\.region\.|selectedRegion|region:\s*selectedRegion" src/ui/setup/setup.html
```

结果：`3/3` suites、`47/47` tests PASS；静态扫描 `no-matches`。

## 基础回归

全量命令：

```powershell
npm test -- --runInBand
```

结果：`40/41` suites、`1096/1107` tests 通过。仅 `src/app/__tests__/GpuDetector.test.js` 的既有 `11` 项 Windows/Linux mock 失败，与 T001 的 `11` 项失败集合和原因一致；没有新增失败套件。Jest 仍有实施前已记录的 open-handle 提示。

PowerShell ESLint：

```powershell
$env:ESLINT_USE_FLAT_CONFIG='false'; npx eslint src/
```

结果：PASS，退出码 `0`，无输出。

## Oasis 残留与可达性分类

以下文件仍存在，但没有从 `src/main.js`、当前 `src/app/`、Profile/UI 正常根链导入；其中 `api-login.js -> tempmail.js -> jwt.js` 只形成孤立的旧内部子图。它们按 tasks.md 要求暂不在 US1 批量删除：

- `src/app/StallDetector.js`
- `src/network/blocker.js`
- `src/network/cookies.js`
- `src/network/api-login.js`
- `src/network/tempmail.js`
- `src/utils/jwt.js`
- `src/ui/server-selector.js`

扫描同时确认当前正常 UI/IPC/启动根不存在旧 `vault:*`、`tempmail:*`、`servers:*`、`auto-login:*`、session check 或 API login 调用，也不存在用户可见国际服 region/server 控件。

下列代码仍是后续任务明确安排的“已加载或条件可达残留”，本记录不把它们误报为零调用者，也不提前删除：

- `src/profiles/manager.js` 仍导入 `src/profiles/vault.js`，内部保留旧凭据方法；当前 UI/IPC 无调用者，T033/T036 与 T059/T060 将按顺序处理；
- `src/profiles/manager.js` 与 `src/profiles/partition.js` 仍保留 shadow `snapshotCookies`/`restoreCookies` 条件路径；T033/T036 负责先从腾讯路径断开，T059/T062 再审计和原子删除；
- `src/utils/EventTimers.js` 及其通用事件 IPC/广播仍由主进程加载，但新管理页不渲染该数据；最终去留由 T059 调用者审计决定；
- `src/network/inspector.js` 当前仍由诊断 IPC 使用，只暴露 G0 已验证的 `resourceType/origin/pathname/statusCode/errorCode`，其去留由 T059/T061 决定。

## 门禁结论

- T015-T025 的 US1 自动化目标与基础回归满足 T026。
- SC-007 的管理页和首次启动页静态边界均通过。
- 未进行真实扫码、官方认证跳转、Flash/CDN 观察或鼠标交互；这些属于 T027-T031 的 Windows 人工门，不能由本记录代替。
- T027 只能记录安全导航元数据与安全 boolean/enum 探针结果，不得记录二维码、Cookie/票据值、QQ 号、完整 URL query/fragment、页面源码或表单内容。
