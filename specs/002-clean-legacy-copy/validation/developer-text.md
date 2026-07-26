# 开发者运行文本验证

## 范围决定

- 用户界面、toast、dialog、诊断 README 和翻译资源保持中文。
- 活动生产代码中的日志模板、启动横幅、启动器自编异常摘要和开发诊断固定文本使用 ASCII 英文。
- 路径、Profile 名、外部 `Error.message`、renderer reason、错误码和结构化字段值保持原样，并继续经过既有脱敏。
- 不回写历史日志，不修改腾讯内容、协议字段、第三方内容或用户数据。
- 按用户决定，本次不重复全量 Jest、Windows/Linux 构建或滞后人工 E2E；只执行开发者文本合同、logger 单元测试、相关 lint 和差异门禁。

## 乱码基线

| 固定文本 | Windows CP936 现象 | 根因 |
| --- | --- | --- |
| `ℹ️ [Launcher]` | `鈩癸笍 [Launcher]` | UTF-8 emoji 被按 GBK 解码 |
| `região` | `regi茫o` | UTF-8 葡语重音被按 GBK 解码 |
| `→` | `鈫?` | UTF-8 箭头被按 GBK 解码 |

源码以 UTF-8 读取时字符正常；修复目标是消除 developer-owned 固定文本中的非 ASCII，而不是清洗动态值。

## Surface Registry

| Surface | 提取范围 | 固定文本要求 | 动态保护 |
| --- | --- | --- | --- |
| logger prefix | `src/utils/logger.js` | ASCII 级别 + `[Launcher]` | message/data 继续脱敏 |
| logger template | 生产 `src/**/*.js` 的 logger 第一参数 | ASCII 英文、无葡语/中文/旧品牌/装饰符号 | 表达式与结构化字段不翻译 |
| startup banner | `src/main.js` | `Naruto Online Launcher` + ASCII 状态关键词 | version/count/locale 等保持 |
| exception summary | 启动器自编 machine error 固定值 | ASCII 英文或稳定 ASCII code | `e.message` 原样 |
| developer diagnostic | diagnostics/IPC 的开发者固定摘要 | ASCII 英文 | 用户 README/dialog/toast 中文 |

## TDD 结果

| 阶段 | 命令 | 结果 |
| --- | --- | --- |
| Red | `npm test -- --runInBand src/ui/__tests__/developer-copy.test.js src/utils/__tests__/logger.test.js` | EXPECTED FAIL：2 suites；7 failed / 21 passed。捕获非 ASCII、葡语/中文/旧品牌固定模板及四个 emoji 前缀 |
| Green | `npm test -- --runInBand --no-verbose src/ui/__tests__/developer-copy.test.js src/utils/__tests__/logger.test.js src/ui/manager/__tests__/IpcRouter.test.js src/utils/__tests__/diagnostics.test.js` | PASS：4 suites / 85 tests |
| Contract recheck | `npm test -- --runInBand --no-verbose src/ui/__tests__/developer-copy.test.js` | PASS：1 suite / 4 tests |
| UI omission recheck | `npm test -- --runInBand --no-verbose src/ui/__tests__/copy-boundary.test.js src/ui/__tests__/developer-copy.test.js` | PASS：2 suites / 27 tests；补齐 optimization UI 预设葡语遗漏 |
| Related lint | 对 `git status --short -- src` 中 28 个已修改 `.js` 文件执行 ESLint | PASS；首次发现 `no-control-regex` 后改用字符码检查并复跑通过 |
| Diff/hash audit | `git diff --check`、logger 调用计数、`package-lock.json` SHA-256 | PASS；logger 调用仍为 145；锁文件哈希保持 `DCD47B4DB444A346645678D5E63108E6465C77107A568BE3129D666744ACB226` |

## 最终计数

| 指标 | 结果 |
| --- | --- |
| developer-owned 固定片段 | 145 个 logger 调用及登记的异常/诊断摘要，100% AST 扫描 |
| 非 ASCII 固定片段 | 0 |
| 葡语固定片段 | 0 |
| 中文固定片段 | 0 |
| Oasis/旧品牌当前固定片段 | 0 |
| 动态值误清洗 | 0；中文动态消息单元测试保持原样 |
