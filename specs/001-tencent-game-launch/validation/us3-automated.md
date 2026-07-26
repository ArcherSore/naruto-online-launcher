# T055 / User Story 3 自动化验证

记录日期：2026-07-25  
结论：**PASS，可以进入人工故障验收**

## Red 阶段证据

| 任务 | 定向结果 | 预期缺口 |
| --- | --- | --- |
| T046 | 既有 39 项通过，新增 10 项失败 | 缺少四阶段失败映射与 `requestRecovery` |
| T047 | 8 项通过，5 项失败 | 生命周期仍 raw reload，缺少 crash 上限元数据及响应状态委托 |
| T048 | 21 项通过，5 项失败 | 非游戏阶段仍启用 stall，SWF 日志包含 query/fragment |
| T049 | 44 项通过，9 项失败 | 缺少 recovery IPC、动作白名单和安全 stage/errorCode 校验 |

上述失败均落在相应任务要求的新行为，未发现无关回归。

## T046–T053 定向回归

命令：

```powershell
npx jest --runInBand --forceExit src/app/__tests__/TencentLaunchFlow.test.js src/app/__tests__/SessionLifecycle.test.js src/app/__tests__/StallDetector.test.js src/app/__tests__/Launcher.test.js src/ui/manager/__tests__/IpcRouter.test.js src/ui/manager/__tests__/StateBroadcaster.test.js
```

结果：

- `6/6` suites PASS；
- `185/185` tests PASS；
- 五个恢复动作均有成功路径；
- 四个自动恢复动作均有达到上限后 `waiting_user` 的分支；
- `RETURN_TO_SELECTOR` 自动上限为 0，仅允许 `user/official`；
- 五个动作逐项拒绝跨 Profile 与非法 renderer 来源；
- crash/stall 来源只允许游戏阶段 `RELOAD_GAME`；
- SessionLifecycle 不再 raw reload，所有恢复路径均未调用 `clearStorageData`。

生产路径静态扫描：

```text
T054_FORBIDDEN_PRODUCTION_PATTERNS=0
```

扫描目标包含 `TencentLaunchFlow`、`SessionLifecycle`、`StallDetector`、`Launcher`、
preload、IPC、状态广播和 manager renderer；模式包含清 Session、任意 URL 动作及非法
renderer 来源标记。

## US1/US2/US3 联合回归

命令：

```powershell
npx jest --runInBand --forceExit src/config/__tests__/urls.test.js src/app/__tests__/TencentLaunchFlow.test.js src/app/__tests__/StallDetector.test.js src/app/__tests__/electron-mock.test.js src/app/__tests__/Launcher.test.js src/app/__tests__/SessionLifecycle.test.js src/profiles/__tests__/partition.test.js src/profiles/__tests__/store.test.js src/profiles/__tests__/manager.test.js src/utils/__tests__/logger.test.js src/network/__tests__/inspector.test.js src/utils/__tests__/diagnostics.test.js src/ui/manager/__tests__/IpcRouter.test.js src/ui/manager/__tests__/StateBroadcaster.test.js src/ui/manager/__tests__/ManagerWindow.test.js src/ui/manager/__tests__/KeyboardShortcuts.test.js src/ui/__tests__/tencent-ui.test.js src/flash/__tests__/plugin.test.js
```

结果：

- `18/18` suites PASS；
- `564/564` tests PASS；
- US1 的腾讯导航/PPAPI/安全边界保持通过；
- US2 的 persist Partition、Session 复用/失效契约和双 Profile 隔离自动化保持通过；
- US3 的阶段化失败、有限恢复、安全 IPC、stall/crash 和日志脱敏全部通过；
- 仅有既有 Jest `--forceExit` open-handle 提示。

## 语法与锁文件边界

以下文件已通过 `node --check`：

- `src/preload.js`
- `src/ui/app.js`
- `src/ui/manager/IpcRouter.js`
- `src/ui/manager/StateBroadcaster.js`
- `src/app/Launcher.js`

本阶段未升级 Node.js、npm、Electron 或核心依赖，未要求修改 `package-lock.json`。

## 自动门判定

T046–T055 自动化全部通过，未发现无限刷新、跨 Profile 恢复污染、任意 URL/清 Session
IPC 或敏感 SWF URL 日志。可以按 `tasks.md` 顺序进入 T056/T057 Windows 人工故障验收；
人工结果尚未计入本文件。

## T056 嵌入式登录 UI selector 修订

用户最初通过 Windows/Electron 11 DevTools Elements 提交二维码子 frame 内 selector
`#qr_area > span.qrlogin_img_out` 和 `exists=true`。该版本完成过一次 Red→Green：

- Red 定向：`55 passed / 6 failed`；六项均为预期的 registry、探针与状态分类缺口；
- Green 定向：`61/61`；
- 相关 6-suite：`187/187`；
- 18-suite 联合回归：`566/566`；
- `node --check`：修改代码与测试均 PASS；
- 定向 ESLint：`0 errors`，仅有一条既有测试辅助参数 `no-unused-vars` warning；
- `git diff --check`：无 whitespace error；
- lockfile SHA-256 未变：
  `216ABA49685A226E07553B67C114CCDD2F2954FA70D84440C92A5981658F1DBB`。

随后真实 Windows 顶层 Console 证明该 selector 在二维码可见时仍返回 `false`，因此上述
自动化只证明模拟布尔状态机，不能证明生产 selector 可达，T056 仍为 `0/0`。2026-07-26
进一步正反验证顶层 `#ptlogin_iframe`：二维码状态 `exists=true/visible=true`，扫码后的
选服状态 `exists=false/visible=false`。新规则必须重新走文档→Red→最小实现→回归，完成前
不得沿用本节旧 Green 结论宣称 T056 可测。

该新规则现已完成独立 Red→Green 与回归：

- Red：`59 passed / 2 failed`，仅 registry 与脚本仍使用旧 selector；
- Green：`61/61`；
- 相关 6-suite：`187/187`；
- 18-suite 联合回归：`566/566`；
- 生产探针只读取顶层 iframe 的存在性与可见性布尔信号，不进入子 frame、不读取 `src` 或
  内容；静态敏感模式审计零命中；
- 语法、whitespace 与 lockfile 边界保持通过，ESLint 为 `0 errors` 和一条既有 warning。

因此 T056 自动前置再次 PASS，可以重新执行 Windows 正式 Attempt；真实管理页状态、精确
request blocking 故障、两个恢复动作和 Session 保留仍不能由自动化代替。

真实重启复测随后否定了“立即查询足够”的假设：二维码稳定可见时管理页仍为
`SELECTOR_READY`。由于顶层 `#ptlogin_iframe` 的正反存在性/可见性已人工确认，缺口收敛为
官方 iframe 晚于 `did-finish-load` 异步插入。下一修订必须重新执行 Red→Green，验证单次
probe 内最多 2500ms 的 MutationObserver 会在 iframe 出现时返回 true、到期返回 false、两条
路径均 disconnect/清理 timer，且没有 interval、源码或 mutation 内容读取。完成前上一段
“自动前置 PASS”再次失效，T056 维持 `0/0`。

旧自动化证明 SELECTOR 二维码存在时进入 `AUTHENTICATING`、不存在时进入
`SELECTOR_READY`；已识别认证 UI 后同页 reload 保持认证阶段，第一次加载失败自动
`REOPEN_AUTH`，第二次进入 `AUTH_FAILED`/`waiting_user`，同时保留
`REOPEN_AUTH`/`RETURN_TO_SELECTOR` 和 Session。生产脚本仅执行固定
`document.querySelector(...) !== null`，不读取节点内容、表单、Cookie、Storage 或身份
参数。T056 仍必须等待真实 Windows Offline/reload 人工结果，不能由本节代替。

## T056 顶层 iframe 异步时序修订

针对真实 Windows 证明的“`#ptlogin_iframe` 晚于 `did-finish-load` 出现”，已完成新的
文档→Red→最小实现→回归闭环：

- Red 定向：`60 passed / 1 failed`，唯一失败为旧探针缺少有界 `MutationObserver`；
- Green 定向：`61/61`；
- 相关 6-suite：`187/187`；
- US1/US2/US3 18-suite 联合回归：`566/566`；
- `node --check`：生产代码与测试均 PASS；
- 定向 ESLint：`0 errors`，仅一条既有测试辅助参数 `no-unused-vars` warning；
- 敏感读取模式静态审计：零命中；
- Node.js `v16.20.2`、npm `8.19.4`，lockfile SHA-256 仍为
  `216ABA49685A226E07553B67C114CCDD2F2954FA70D84440C92A5981658F1DBB`。

生产探针仍只执行一次 `executeJavaScript`：先立即判断固定 iframe 的存在性/可见性；若尚未
出现，则只观察 `document.body` 的节点变化和 `style/class/hidden` 属性，最多 2500ms。
成功与超时均 disconnect observer 并清理 timer；不使用 interval，不读取 mutation 内容、
iframe `src`、子 frame、HTML、表单、Cookie、Storage 或身份参数。T056 自动前置重新 PASS，
但正式计数仍为 `0/0`，等待真实 Windows 复测后才能关闭。

## T056 最终管理卡片降级回归（2026-07-26）

用户最终撤销不稳定的管理页认证失败说明，改为运行中常态“刷新”。规格同步后完成：

- Red：UI、IPC、Launcher 共 6 个新断言全部按预期失败；
- Green 定向：3 suites，`6/6`；
- 相关回归：6 suites，`173/173`；
- 全量：40/41 suites、`1154/1165`；唯一失败为既有
  `GpuDetector.test.js` Windows/Linux sysfs mock 基线 11 项，未修改相关生产或测试文件；
- 真实 Electron/CDP：未启动“打开”、运行中“刷新”、状态说明节点 0、刷新后固定
  SELECTOR 文档的 `performance.timeOrigin` 更新、关闭后刷新按钮消失，`1/1`。

上一轮 8 秒认证恢复看门狗及其两个专用测试已撤销；顶层登录 iframe selector 修复、后台
有界状态机、Session 隔离和脱敏边界继续保留。T056 通过。
