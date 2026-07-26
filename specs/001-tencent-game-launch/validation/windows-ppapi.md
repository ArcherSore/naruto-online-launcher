# T030 / G2 Windows PPAPI 闭环门

记录日期：2026-07-25  
运行平台：Windows / Electron 11.5.0 / 内置 PPAPI  
Profile：`test`（内部显示代号）  
Gate：G2，全部启动均为 **non-SC**  
前置：T014 / G0 PASS，T029 / G1 PASS

## 数据边界

本门只记录：

- 应用内部承载结果；
- 内容是否可见；
- 鼠标操作是否产生可观察响应；
- 是否出现阻塞性的 SWF/CDN、mixed-content、policy、页面信号或安全配置要求；
- 安全的本地加载/renderer 错误类型。

未记录或读取二维码、QQ 身份、区服参数、Cookie/票据值、完整 URL query/fragment、页面源码、表单值、请求体或响应体。

## 修订轮次

消耗的 G2 修订轮次：`0/3`。

G1 后的首次完整游戏启动未出现需要修改的 SWF/CDN 精确 host/path、mixed-content、`crossdomain.xml`/policy、DOM selector 或 BrowserWindow 安全 flag。未新增网络规则、allowlist、探针 selector 或安全例外。

## 连续稳定性启动

| 启动 | game_internal | content_visible | mouse_response | 新阻塞事实 | 结果 |
| --- | --- | --- | --- | --- | --- |
| Stability 1 | PASS | PASS | PASS | 0 | PASS / non-SC |
| Stability 2 | PASS | PASS | PASS | 0 | PASS / non-SC |

人工确认：

- 两次均在应用内部进入游戏；
- 两次游戏/Flash 内容均实际可见，不是白屏、空容器或仅网页外框；
- 两次均在游戏内容区域执行普通鼠标操作，并得到可观察游戏交互；
- 没有进入系统浏览器；
- 没有报告 UNKNOWN、黑屏、加载错误、SWF/CDN、mixed-content、policy 或安全 flag 阻塞。

第二次稳定性启动中，同一 Profile 的腾讯有效 Session 由 Chromium 持久 Partition 原生复用，无需重新扫码；用户仍手动选服。该现象只作为 G2 附带观察，**不提前计入** T041 / SC-004 的正式有效 Session `2/2`。

## 安全日志检查

修复后的两次窗口启动分别只出现一次 MemoryGuard 注册和一次窗口打开。最近安全日志中没有：

- `SessionLifecycle: falha de carregamento`；
- `renderer encerrado`；
- `UNKNOWN_TOP_LEVEL_NAVIGATION`。

日志检查只使用本地生命周期事件；未展开或复制腾讯请求、页面数据或身份材料。

## 自动回归

命令：

```powershell
npx jest --runInBand --forceExit src/config/__tests__/urls.test.js src/app/__tests__/TencentLaunchFlow.test.js src/app/__tests__/Launcher.test.js src/app/__tests__/SessionLifecycle.test.js src/network/__tests__/inspector.test.js src/flash/__tests__/plugin.test.js
$env:ESLINT_USE_FLAT_CONFIG='false'; npx eslint src/app/SessionLifecycle.js src/app/TencentLaunchFlow.js src/app/Launcher.js src/network/inspector.js
```

结果：

- `6/6` suites、`145/145` tests PASS；
- ESLint PASS；
- Jest 仅保留实施前已记录的 open-handle 提示；
- 没有新增生产实现或 `package-lock.json` 变化。

## G2 判定

**PASS**

- G0/G1 前置均满足；
- 未消耗修订轮次；
- 连续 2 次完整启动均达到应用内部、内容可见和鼠标响应；
- 两次均未出现新的阻塞资源、DOM 信号或安全配置要求；
- 没有通配网络规则、宽泛 allowlist、静默关闭安全能力或敏感捕获。

这些启动均为 G2 non-SC，不能混入 T031 正式 `3/3` 分母。下一项只能执行 T031，并使用相互独立的全新 Profile 从第 1 次开始正式记录。
