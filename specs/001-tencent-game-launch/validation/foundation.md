# T014 G0 基础安全门闭合记录

记录日期：2026-07-21  
运行平台：Windows / PowerShell  
分支：`001-tencent-game-launch`

## 测试先行证据

| 任务 | Red 阶段结果 | 转绿依据 |
| --- | --- | --- |
| T003 URL 分类 | `31/31` 失败，缺少腾讯 URL 角色与精确分类接口 | T009 后 `31/31` 通过 |
| T004 状态机骨架 | 测试套件因缺少 `TencentLaunchFlow` 模块失败 | T010 后 `14/14` 通过 |
| T005 Session 映射 | `7/45` 失败，旧 shadow/default 行为不符合隔离要求 | T011 后 `45/45` 通过 |
| T006 日志边界 | `12/23` 失败，完整 URL、秘密和未知身份字段未被统一拒绝 | T012 后 `23/23` 通过 |
| T007 G0 敏感路径 | `21` 失败、`1` 通过，inspector/诊断/IPC 仍存在敏感采集或输出路径 | T013 后四个相关套件 `207/207` 通过 |

Red 阶段只使用合成测试数据，未进行真实扫码、认证跳转或 Flash/CDN 观察。

## G0 定向回归

命令：

```powershell
npx jest --runInBand --forceExit src/config/__tests__/urls.test.js src/app/__tests__/TencentLaunchFlow.test.js src/app/__tests__/electron-mock.test.js src/profiles/__tests__/partition.test.js src/utils/__tests__/logger.test.js src/network/__tests__/inspector.test.js src/utils/__tests__/diagnostics.test.js src/ui/manager/__tests__/IpcRouter.test.js
```

结果：PASS，`8/8` suites、`301/301` tests；耗时 `1.575 s`。Jest 仍报告基线中已有的 `--forceExit`/潜在未关闭异步句柄提示。

## ESLint

命令：

```powershell
$env:ESLINT_USE_FLAT_CONFIG='false'; npx eslint src/
```

结果：PASS，退出码 `0`，无 lint 输出。

## 禁止敏感路径静态扫描

命令：

```powershell
rg -n "details\.(requestHeaders|responseHeaders|uploadData|requestBody|responseBody|pageSource)|entry\.(url|jwt)|captured(Cookies|Jwts)|jwt\.decode|document\.documentElement\.outerHTML|dev:get-(page-source|cookies)" src/network/inspector.js src/utils/diagnostics.js src/ui/manager/IpcRouter.js src/utils/logger.js
```

结果：PASS，零匹配；`rg` 退出码 `1` 表示未找到匹配。当前生产观察、诊断、IPC 和日志通路未引用请求/响应头、请求/响应体、页面源码、完整 URL/JWT 捕获字段或敏感调试 IPC。

## 锁文件

命令：

```powershell
(Get-FileHash -Algorithm SHA256 package-lock.json).Hash
git diff -- package-lock.json
```

结果：PASS。SHA-256 仍为 `216ABA49685A226E07553B67C114CCDD2F2954FA70D84440C92A5981658F1DBB`，与 T001 基线一致；`git diff -- package-lock.json` 无输出。

## G0 判定

G0 PASS。T003-T013 的共同边界已自动验证，T007 已保留先失败后转绿证据。该判定仅解除后续任务对 G0 的阻塞；真实扫码/认证观察仍须等待 T015-T026 完成并严格进入 T027，Flash/CDN 观察仍须等待 G1/T029 PASS 后进入 T030。
