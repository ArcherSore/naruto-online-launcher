# Windows 登录、Session 与 Flash E2E

| 验证项 | 结果 | 证据/备注 |
| --- | --- | --- |
| Windows portable 构建 | PASS | `dist/Naruto Online 1.4.0.exe` |
| Profile A/B 官方扫码与手动选服 | NOT RUN | 需要隔离环境和测试 QQ 账号 |
| Flash 进入与鼠标交互 2/2 | NOT RUN | 需要真实腾讯页面与 PPAPI 运行 |
| A 失效/刷新不影响 B | NOT RUN | 自动 Partition/Session 测试 PASS |
| 页面失败、renderer/Flash 恢复 | NOT RUN | 自动有界恢复测试 PASS |
| Flash 缺失原生中文 dialog | NOT RUN | 静态文案与退出语义检查 PASS |

自动测试不能替代本表的真实 GUI 结果。
