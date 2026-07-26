# T058 / Windows 敏感日志与诊断审计

记录日期：2026-07-26  
结论：**PASS，SC-008 泄露项 0**

## 覆盖范围

本轮审计覆盖 T056/T057 实际产生的扫码入口、有效 Session 复用、官方退出失效、未认证
登录 UI、有效 Session SELECTOR、GAME_MAIN 跳转、SWF/CDN 内容失败、renderer crash 和
unresponsive 场景。审计脚本只输出分类计数，不打印匹配值、日志行或页面源码。

## 普通日志

文件：Electron `app.getPath('logs')` 下的 `main.log`。文件总计 3966 行、431226 bytes；
其中 2026-07-26 本轮场景产生 959 行。

| 禁止模式 | 本轮场景命中 |
| --- | ---: |
| Cookie / Set-Cookie 非脱敏值 | 0 |
| Authorization 非脱敏值 | 0 |
| openid/access_token/ticket/skey/p_skey/uin/JWT 等身份赋值 | 0 |
| QQ/password/pwd 非脱敏值 | 0 |
| 完整 URL query/fragment | 0 |
| requestBody/responseBody/pageSource | 0 |
| HTML/page source 迹象 | 0 |
| 长 hex/JWT token | 0 |
| 5–12 位疑似 QQ 号 | 0 |

对整个历史日志扫描时另发现 1 个 2026-07-20 的 5 位数字候选，来源分类为迁移前 Flash
本地路径，既不属于本轮场景，也不在腾讯身份字段、URL 或结构化 Profile 数据中；本轮
2026-07-26 日志为 0。该历史行未复制到验证文档或诊断包。

## 错误 UI 与 IPC

受控阻断 SELECTOR Document 时，Chromium 保留了原腾讯官方页面，并未创建启动器错误页；
官方页面内存不属于启动器日志、IPC 或诊断包，审计时没有保存其 HTML。

启动器实际错误 UI 数据链静态检查结果：

- `SessionLifecycle` 只上送 `errorCode`，不传失败 URL 或 description；
- `TencentLaunchFlow` 只产生固定 `stage/status/safeMessage/errorCode/availableActions`；
- `StateBroadcaster` 与 `preload` 再次 allowlist 同一组安全字段；
- `loading.html` 仅以 `textContent` 呈现固定标题、safeMessage 和标量错误码；
- renderer 不能提交 URL、Profile、Cookie、Session 清理或页面源码。

生产路径禁止模式静态扫描结果：

```text
forbiddenProductionPatterns = 0
```

## 脱敏诊断包

通过管理页真实执行一次“导出脱敏诊断”，保存到系统临时目录。生成结果：

- 2244 bytes，4 个条目；
- `system-info.json`
- `config.json`
- `profiles.json`
- `README.md`

本次运行的导出包没有发现 logs 条目，因此普通 `main.log` 已在上一节单独审计。ZIP 在内存
中解析，未解压到仓库；以下模式及禁止 JSON key 均为 0：

| 禁止模式 | 命中 |
| --- | ---: |
| Cookie/Authorization/身份参数/password | 0 |
| URL query/fragment | 0 |
| requestBody/responseBody/pageSource/HTML | 0 |
| 长 token | 0 |
| 5–12 位疑似 QQ 号 | 0 |
| 禁止 JSON key | 0 |

审计完成后临时 ZIP 已删除，工作区没有保留诊断包。

## 自动化与边界验证

- 日志/诊断/inspector/IPC/流程/生命周期定向回归：`7/7` suites、
  `198/198` tests PASS；
- US1/US2/US3 联合回归：`18/18` suites、`572/572` tests PASS；
- `node --check`：TencentLaunchFlow、Launcher、IpcRouter、manager renderer、preload
  全部 PASS；
- `git diff --check`：无 whitespace error，仅显示既有 LF→CRLF 提示；
- Node.js `v16.20.2`、npm `8.19.4`；
- `package-lock.json` SHA-256：
  `216ABA49685A226E07553B67C114CCDD2F2954FA70D84440C92A5981658F1DBB`。

## 结论

扫码、复用、失效和四类失败场景产生的启动器日志、错误数据链和真实诊断包中，QQ 密码、
完整 Cookie、可复用 ticket、QQ 号、身份 query/fragment、pageSource 的泄露项均为 0。
SC-008 PASS。
