# 路线图

当前目标是稳定腾讯国服官方扫码、选服与 Flash 游戏流程。

## 当前优先级

- 验证腾讯官方页面 URL、认证弹窗与选服跳转变化。
- 提升 Session 失效、renderer crash 与 SWF stall 的有界恢复。
- 保持多 Profile Partition 隔离和敏感日志审计。
- 保持 Windows portable 与 Linux AppImage 在 Electron 11.5.0 下可构建。
- 逐步补充 Auditor 与核心 TencentLaunchFlow 的自动化覆盖。

## 明确不做

- QQ 密码采集或自动填充。
- 登录票据伪造、解密、重放或风控绕过。
- Oasis/巴西服兼容。
- 自动选服。
- Electron、Node 或 PPAPI 栈的无计划升级。

外部腾讯页面行为只能通过真实扫码会话进行人工验证，自动化测试不会模拟或绕过认证。
