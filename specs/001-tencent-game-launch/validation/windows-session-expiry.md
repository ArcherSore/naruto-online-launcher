# T042 / G3b 会话失效人工验收

记录日期：2026-07-25  
运行平台：Windows / Electron 11.5.0  
Profile：`g3a-valid`（内部测试代号）  
结论：**PASS，正式矩阵 `2/2`**

## 验收口径

保持管理窗口和 Electron 主进程运行。使用腾讯官方页面提供的 logout；若官方页面没有可用 logout，
则使用测试撤销或自然过期。不得删除 Profile、调用 `clearStorageData`、手动删除 Cookie/Storage，
也不得读取或记录 Cookie/票据值。

每次正式 Attempt 必须满足：

1. 同一 Profile 先处于腾讯官方认可的有效会话；
2. 通过官方 logout、测试撤销或自然过期使该会话失效；
3. 关闭并重开游戏窗口或继续官方流程后，页面返回官方二维码扫码入口；
4. 未删除 Profile 或 Session 数据；
5. 为下一次 Attempt 重新扫码恢复有效会话，再独立制造失效。

## 正式矩阵

| Attempt | 失效方式 | 返回官方二维码 | 删除 Profile/Session 数据 | 结果 |
| --- | --- | --- | --- | --- |
| 1 | 腾讯官方 logout | YES；点击登录后显示二维码，并重新扫码恢复至选服页 | NO；未手动删除 | PASS |
| 2 | 腾讯官方 logout | YES；点击登录后显示二维码，并重新扫码恢复至选服页 | NO；未手动删除 | PASS |

当前结果：`passed/attempted=2/2`。两次都只使用腾讯官方 logout 使认证状态失效，没有手动删除
Profile、清理应用存储或调用清 Session；官方 logout 自身对认证状态的变更属于预期测试行为。
两次均能返回二维码并重新扫码恢复到选服页。T042 / G3b PASS，可以按顺序进入 T043。

## 证据边界

允许记录：内部 Profile 代号、`SESSION_REJECTED`/`AUTHENTICATING` 等阶段、安全错误码、
失效方式类别、二维码入口是否可见、是否删除 Profile/Session 数据和 `passed/attempted`。

禁止记录：二维码内容或截图、QQ 号/昵称、Cookie/Set-Cookie/Authorization 值、ticket/JWT、
完整 URL、query/fragment、页面源码、表单值、请求体或响应体。
