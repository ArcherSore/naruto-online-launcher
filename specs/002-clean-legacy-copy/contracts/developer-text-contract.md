# Developer Text Contract: 生产运行文本英文化

## 目的

让维护者在 Windows 默认终端、文件日志和开发诊断结果中稳定检索启动器组件、动作、结果与失败阶段，同时保持原始动态数据、脱敏、安全字段和核心行为不变。

## 适用范围

| Surface ID | 来源 | 范围 |
| --- | --- | --- |
| `developer.logger-prefix` | `src/utils/logger.js` | debug/info/warn/error 固定前缀 |
| `developer.log-template` | `src/**/*.js`，排除 `__tests__` | `logger.debug/info/warn/error` 第一参数中的静态片段 |
| `developer.startup-banner` | `src/main.js` | 应用名、版本、Flash、Profile、语言、RAM、性能模式摘要 |
| `developer.exception-summary` | 活动生产 JavaScript | 启动器编写并返回、抛出或记录的异常固定摘要 |
| `developer.diagnostic` | `src/utils/diagnostics.js`、`src/ui/manager/IpcRouter.js` 等 | 面向维护者的固定诊断状态；用户 README、dialog、toast 仍为中文 |

## 固定文本合同

- 所有静态片段必须为 ASCII 英文，即每个字符都位于 `U+0000` 至 `U+007F`。
- 固定文本不得包含葡萄牙语、中文、Oasis 当前产品品牌、`Shinobi Launcher` 当前品牌、emoji、箭头、框线、长破折号、省略号或其他装饰性 Unicode。
- 推荐格式为 `Component: action/result key=value`；同一组件使用稳定大小写，例如 `Config`、`Flash`、`ProfileStore`、`SessionLifecycle`、`Diagnostics`。
- 级别前缀固定为 `[DEBUG] [Launcher]`、`[INFO] [Launcher]`、`[WARN] [Launcher]`、`[ERROR] [Launcher]`。
- 启动横幅使用当前产品名 `Naruto Online Launcher`，不得显示旧启动器品牌。
- UI、toast、dialog、诊断 README、安装/卸载提示和翻译字典不受本合同英文化；它们继续遵守中文默认合同。

## 动态值合同

以下内容不是固定模板，不做翻译、ASCII 清洗或音译：

- 文件路径、目录、文件名和用户环境值。
- Profile 名、备注和其他用户输入。
- `Error.message`、renderer reason、系统/Chromium/Flash 原始错误。
- URL 的既有安全位置、错误码、状态码、stage/action/role 和其他协议值。
- 结构化安全字段及其动态值。

动态值必须继续经过既有 `sanitizeMessage()`、`sanitizeFields()`、诊断脱敏和安全 allowlist。不得为了模板英文化而扩大原始数据读取、日志字段或持久化范围。

## AST 提取合同

自动测试使用项目测试环境现有 JavaScript 解析能力读取活动生产 `.js` 文件：

1. 排除 `__tests__`、fixtures、文档、第三方和生成产物。
2. 对 `logger.debug/info/warn/error` 第一参数递归收集字符串字面量、模板字面量静态片段、字符串拼接和条件表达式中的静态片段。
3. 标识符、成员表达式、函数调用和模板插值记为动态值，不检查其语言。
4. 对登记的异常摘要与开发诊断位置采用同一静态片段提取。
5. 每个静态片段检查 ASCII、葡语/Oasis/旧品牌禁止词及装饰符号。
6. 测试必须包含一个中文动态 Profile 名和一个非 ASCII 外部错误样本，证明动态值未被错误清洗。

## 行为保持合同

- logger 调用数量、级别、调用位置和第二参数结构不变。
- `src/utils/logger.js` 的 URL/认证材料脱敏、`SAFE_LOG_FIELDS`、文件/控制台 level、轮转和导出 API 不变。
- 不改变异常捕获、分支、返回值、重试、窗口生命周期、Session、导航、Flash 或诊断 ZIP entry。
- 不回写既有日志文件。
- 任何非日志逻辑 diff、结构化字段变化、敏感数据新增、动态值翻译或 logger transport 变化均为阻塞失败。

## 验收样例

合法：

```text
[INFO] [Launcher] Config: loaded region=br profile=modern
[INFO] [Launcher] Flash: searching for PPAPI plugin
[INFO] [Launcher] Flash: candidate path=D:\flash-auto-scripts\naruto-online-launcher\pepflashplayer.dll
[ERROR] [Launcher] Config: load failed: <original error>
```

不合法：

```text
Config carregada
配置已加载
ℹ️ [Launcher]
→ D:\path
Shinobi Launcher
```

## 验收指标

- 登记的生产开发者固定文本覆盖率：100%。
- 非 ASCII 固定片段：0。
- 葡萄牙语、中文固定模板、Oasis/旧品牌当前横幅：0。
- 动态值被翻译或删除：0。
- logger 行为、核心回归和锁文件新增变化：0。
