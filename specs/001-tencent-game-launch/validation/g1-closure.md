# T029 / G1 闭合审计

记录日期：2026-07-25  
运行平台：Windows / Electron 11.5.0  
分支：`001-tencent-game-launch`  
结论：**G1 PASS，可进入 T030 / G2**

## 前置门

| 前置 | 证据 | 结果 |
| --- | --- | --- |
| G0 / T014 | `validation/foundation.md`：8/8 suites、301/301 tests；G0 敏感路径扫描零匹配 | PASS |
| US1 自动门 / T026 | `validation/us1-automated.md`：17/17 suites、495/495 tests；SC-007 静态边界通过 | PASS |
| G1 Round 1 / T027 | `validation/windows-navigation-discovery.md`：扫码 UI 稳定显示、扫码成功、回到服务器选择页面 | PASS / non-SC |
| G1 Round 2 / T028 | 同一证据文件：手动选服后 GAME_MAIN 在应用内部承载 | PASS / non-SC |

## 规格同步与执行顺序

T027 首次运行发现的是本地生命周期缺陷，不是新腾讯 host/path：

1. 先增加“重复 `ready-to-show` 只启动一次窗口流程”的预期失败测试；
2. Red：`1 failed, 10 passed`；
3. 最小修复：为单个 BrowserWindow 增加 `readyHandled` 一次性门闩；
4. Green：相关 `4/4` suites、`128/128` tests PASS；
5. 再执行 Round 1 扫码发现。

T027-T028 只确认 Spec 已存在的两个精确元组：

```text
https://huoying.qq.com:443/server/website/  -> SELECTOR
https://game.huoying.qq.com:443/main.html  -> GAME_MAIN
```

没有发现新的 UNKNOWN、AUTH host/path、popup disposition、selector 或网络例外，因此没有新增 allowlist 实现，也没有为不存在的新行为伪造 Red 测试。运行时确认已同步到：

- `research.md`
- `plan.md`
- `contracts/navigation-contract.md`
- `validation/windows-navigation-discovery.md`

运行时事实没有改变产品需求、Feature 范围、安全边界、验收标准、成功率分母或用户能力，因此不触发 Feature Spec 修改分支。Plan 的 Constitution I-X 结论保持 PASS。

## 最终自然导航链

```text
SELECTOR（父游戏窗口）
  -> 官方页面内扫码
  -> SELECTOR（服务器选择）
  -> GAME_MAIN（父 PPAPI 游戏窗口）
```

| 角色 | Origin/Pathname | 承载 | 结果 |
| --- | --- | --- | --- |
| SELECTOR | `https://huoying.qq.com/server/website/` | 父游戏窗口 / top | PASS |
| AUTH | `N/A` | 官方扫码 UI 在现有页面自然显示 | 合理 N/A |
| GAME_MAIN | `https://game.huoying.qq.com/main.html` | 应用内部父窗口 / top | PASS |
| UNKNOWN | 本轮未自然出现 | 默认阻止路径由自动测试覆盖 | PASS |

用户没有在 T027-T028 声明 Flash 内容可见或鼠标响应；G1 只证明顶层认证/选服/游戏导航链，不能代替 G2 或正式 SC。

## 认证子窗与递归路由审计

官方流程未自然创建认证子窗，因此以下人工场景均有理由标记为 `N/A`，且没有修改腾讯页面来人为触发：

- 认证子窗 navigate；
- 认证子窗 redirect / `did-redirect-navigation`；
- 认证子窗 `new-window`；
- 二次 popup。

T016 的 Electron 11 自动化/本地受控 fixture 已覆盖上述通用 handler，并确认：

- 子窗与父 Profile 使用同一 partition；
- `plugins:false`；
- `nodeIntegration:false`；
- `contextIsolation:true`；
- `webSecurity:true`；
- `allowRunningInsecureContent:false`；
- `enableRemoteModule:false`；
- `webviewTag:false`；
- 不设置游戏业务 `preload`；
- 子窗 navigate、redirect、`new-window` 和二次 popup 继续使用同一精确分类器。

## UNKNOWN 与恢复审计

生产代码和 T016 测试确认：

- UNKNOWN 顶层目标调用 `preventDefault()`；
- 状态进入 `BLOCKED_NAVIGATION`；
- 只保存 `role/origin/pathname` 安全位置；
- 提供 `RETURN_TO_SELECTOR`；
- 不清理 Profile Session；
- 不调用 `shell.openExternal`。

## 一致性分析

只读 `speckit-analyze` 审计结果：

| 指标 | 结果 |
| --- | --- |
| FR/SC | 28（FR 20 + SC 8） |
| 需求任务覆盖 | 28/28，100% |
| 任务 ID | T001-T067 连续、唯一 |
| 无需求映射任务 | 0 |
| Constitution 冲突 | 0 |
| CRITICAL/HIGH/MEDIUM 发现 | 0 |
| 未解决占位符或宽泛 host 规则 | 0 |

审计时首个未完成任务为 T029；不存在未完成的 Spec/Plan/Tasks/契约/Constitution 同步。

## 自动回归

命令：

```powershell
npx jest --runInBand --forceExit src/config/__tests__/urls.test.js src/app/__tests__/TencentLaunchFlow.test.js src/app/__tests__/electron-mock.test.js src/app/__tests__/Launcher.test.js src/app/__tests__/SessionLifecycle.test.js src/profiles/__tests__/partition.test.js src/profiles/__tests__/store.test.js src/profiles/__tests__/manager.test.js src/utils/__tests__/logger.test.js src/network/__tests__/inspector.test.js src/utils/__tests__/diagnostics.test.js src/ui/manager/__tests__/IpcRouter.test.js src/ui/manager/__tests__/StateBroadcaster.test.js src/ui/manager/__tests__/ManagerWindow.test.js src/ui/manager/__tests__/KeyboardShortcuts.test.js src/ui/__tests__/tencent-ui.test.js src/flash/__tests__/plugin.test.js
$env:ESLINT_USE_FLAT_CONFIG='false'; npx eslint src/
```

结果：

- `17/17` suites、`496/496` tests PASS；
- ESLint PASS；
- Jest 仅保留实施前已记录的 open-handle 提示；
- `package-lock.json` SHA-256 保持 `216ABA49685A226E07553B67C114CCDD2F2954FA70D84440C92A5981658F1DBB`。

## G1 判定

**PASS**

- 父窗自然链已从 SELECTOR 经官方扫码/选服到 GAME_MAIN；
- 未自然出现的认证子窗事件具有明确 N/A 理由，并由 T016 自动化覆盖；
- 子窗安全配置、递归分类、UNKNOWN 阻止和恢复路径完整；
- 没有未完成的规格、计划、任务、契约或 Constitution 同步；
- 没有扩大 allowlist、探针数据面或安全例外。

下一项只能是 T030 / G2。G2 必须验证应用内游戏内容可见和一次鼠标响应，并检查是否出现新的 SWF/CDN、mixed-content、policy、页面信号或安全配置阻塞事实；本记录不能代替该门。
