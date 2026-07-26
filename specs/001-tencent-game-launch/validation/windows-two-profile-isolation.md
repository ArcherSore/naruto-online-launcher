# T043 / G3c 双 Profile 隔离人工验收

记录日期：2026-07-25  
运行平台：Windows / Electron 11.5.0  
Profile：A/B（只使用内部测试代号，不记录 QQ 身份）  
结论：**PASS，跨 Profile 污染事件为 0**

## 验收口径

Profile A/B 分别使用两个不同的测试账号完成腾讯官方扫码，并在同一 Electron 主进程内同时打开。
只对 A 执行关闭、重开、官方 logout 和重新扫码；B 不执行任何恢复操作。B 的登录状态、当前页面、
窗口与恢复状态必须保持不变，跨 Profile 污染事件必须为 0。

不得读取或比较 Cookie 值。B 仍保持已登录、页面不跳回二维码、不发生非预期 reload/关闭或恢复状态
变化，即作为人工 Session/page/window/state 隔离证据；Partition 和恢复计数隔离另由 T033/T040
自动化证据覆盖。

## 正式矩阵

| 步骤 | 对 Profile A 的操作 | Profile A 预期 | Profile B 预期 | 结果 |
| --- | --- | --- | --- | --- |
| Baseline | A/B 分别扫码两个不同账号并同时打开 | 已登录并停留官方选服流程 | 已登录并停留官方选服流程 | PASS |
| 1 | 只关闭并重开 A 游戏窗口 | A 复用有效 Session | B 无变化 | PASS |
| 2 | 对 A 使用腾讯官方 logout | A 返回二维码入口 | B 无变化 | PASS |
| 3 | A 重新扫码恢复 | A 返回选服页 | B 无变化 | PASS |

当前结果：跨 Profile 污染事件为 0。B 在 A 关闭/重开、官方 logout 和重新扫码期间始终无变化；
B 保持登录且未回二维码，作为不读取 Cookie 值的人工 Session/page/window/state 隔离证据。
Partition 和恢复计数隔离由 T033/T040 自动化证据覆盖。T043 / G3c PASS，可以进入 T044。

## 证据边界

允许记录：内部 Profile A/B 代号、页面角色、窗口是否保持、是否出现二维码、是否发生 reload、
安全阶段/恢复状态和 PASS/FAIL。

禁止记录：QQ 号/昵称、二维码内容或截图、Cookie/票据值、完整 URL、query/fragment、页面源码、
表单值、请求体或响应体。
