# Data Model: 遗留界面文案清理

本功能不引入数据库或新的运行时持久化文件。以下模型用于约束现有 `config.json` 语言值、文案审计合同与验证证据。

## RuntimeLanguageConfig

启动器全局界面语言状态。

| 字段 | 类型/值 | 规则 |
| --- | --- | --- |
| `rawLanguage` | unknown | 从现有 `config.json` 读取；不得据此修改其他字段。 |
| `normalizedLanguage` | locale string | 默认 `zh-CN`；葡语与无效值规范化为 `zh-CN`。 |
| `defaultLanguage` | `zh-CN` | 缺失、空值、解析失败或新配置的唯一 fallback。 |
| `supportedLanguages` | locale set | 包含 `zh-CN` 和保留的非葡萄牙语显式 locale；不得包含葡萄牙语。 |
| `firstBoot` | boolean | 保持现有语义；语言迁移不得改变。 |
| `advancedMode` | boolean | 由 setup 返回并保持；语言迁移不得改变。 |
| `windowBounds` / 性能偏好 | existing values | 按现有验证/保存规则保持。 |

### 规范化矩阵

| 原始状态 | 规范化结果 | 其他配置 |
| --- | --- | --- |
| 缺失、`undefined`、`null`、空字符串 | `zh-CN` | 保持 |
| `pt`、`pt-BR`、`pt_BR` | `zh-CN` | 保持 |
| 未知 locale、非字符串 | `zh-CN` | 保持 |
| `zh-CN` | `zh-CN` | 保持 |
| 其他明确受支持的非葡语 locale | 原值 | 保持 |

### 状态迁移

```text
RAW_CONFIG
  ├─ missing / invalid / Portuguese ─> ACTIVE_ZH_CN
  └─ supported non-Portuguese ───────> ACTIVE_SELECTED

ACTIVE_ZH_CN / ACTIVE_SELECTED
  ├─ setup explicit selection ───────> ACTIVE_SELECTED
  └─ save ───────────────────────────> PERSISTED_VALID
```

任何状态迁移都不得触发 Profile 文件重建、Partition 重命名、Cookie/Storage 清理或 Session 复制。

## VisibleCopySurface

一个由启动器拥有、可能展示给用户的产品面。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `surfaceId` | string | 稳定审计标识，例如 `setup.window`。 |
| `sourcePaths` | path[] | 产生该文案的真实源码或元数据文件。 |
| `trigger` | string | 首次启动、点击、错误、安装等可达条件。 |
| `owner` | enum | `launcher`、`tencent`、`os`、`user`、`third-party`。 |
| `platform` | enum | `all`、`windows`、`linux`。 |
| `renderChannel` | enum | HTML、动态 HTML、BrowserWindow 标题、dialog、toast、CLI、desktop、generated document。 |
| `defaultChineseRequired` | boolean | launcher-owned 默认路径必须为 true。 |
| `auditStatus` | enum | `pending`、`replace`、`remove-visible-entry`、`protected-retain`、`verified`、`n-a`。 |
| `evidence` | string[] | 自动测试、人工步骤或保留理由。 |

### 关系

- 一个 `VisibleCopySurface` 包含零到多个 `CopyAuditEntry`。
- launcher-owned surface 的每个非中文/遗留候选必须关联一个 `RetainedTerm` 或明确处置。
- owner 不是 launcher 的 surface 默认转为 `ProtectedContent`，不得参与页面改写。

## CopyAuditEntry

单个候选文案或匹配项的审计记录。

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `entryId` | string | 在当前 feature 内唯一。 |
| `surfaceId` | string | 必须指向已登记 surface。 |
| `sourceLocation` | path + locator | 文件与稳定定位信息。 |
| `candidateKind` | enum | Portuguese、Oasis/current-international、ordinary-English、legacy-brand、Unicode、raw-error。 |
| `authoredByLauncher` | boolean | false 时必须给出外部所有者。 |
| `userReachable` | boolean | 结合真实调用路径判断，不能只按文件存在判断。 |
| `disposition` | enum | `translate`、`remove-entry`、`retain-technical`、`retain-protected`。 |
| `rationale` | string | 每项必填，且可追溯到 FR/合同类别。 |
| `verification` | string[] | 至少一个自动或人工证据。 |

### 验证规则

- launcher-owned 且 user-reachable 的 Portuguese/Oasis 项不得为 `retain-protected`。
- 普通英文动作词不得为 `retain-technical`。
- `retain-protected` 必须关联 `ProtectedContent.category`。
- `translate` 只改变表现文本，不得改变 machine identifier 或回调控制流。

## RetainedTerm

允许保留的英文技术词类别。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `term` | string/pattern | 精确词或受限类别。 |
| `category` | enum | runtime、hardware、session、protocol、format、platform、unit、proper-name。 |
| `rationale` | string | 技术准确性或生态一致性原因。 |
| `allowedSurfaces` | surfaceId[] | 不允许无边界全局使用。 |
| `requiresChineseContext` | boolean | 默认 true；命令/文件名/错误码可有理由例外。 |
| `examples` | string[] | 合法呈现样例。 |

允许类别以 `copy-boundary-contract.md` 为准；新增类别必须先更新合同和测试。

## ProtectedContent

不得因语言或关键字命中被自动删除/替换的内容。

| `category` | 典型内容 | 处理 |
| --- | --- | --- |
| `external.tencent` | 腾讯页面 DOM/文本/样式/资源/标题/响应 | 不修改、不注入翻译 |
| `external.os` | OS 文件选择器控件和系统错误 | 不重写；启动器可提供中文摘要 |
| `user.content` | Profile 名称、备注、路径 | 原样展示并安全转义 |
| `diagnostic.raw` | 既有日志文件、历史 crash、外部错误和动态日志值 | 保留既有脱敏与结构；不包括活动生产代码中的启动器固定模板 |
| `protocol.identifier` | URL、IPC channel、action/stage/error code、MIME、User-Agent | 原样保留 |
| `compatibility.identifier` | `productName`、`StartupWMClass`、可执行文件/目录、环境变量、旧日志路径 | 原样保留 |
| `third_party` | 许可、锁文件、二进制和第三方资产 | 不修改 |
| `test.evidence` | Oasis/葡语负向断言、迁移 fixture、Unicode 样本 | 保留 |
| `unicode.required` | 中文 UI/翻译、用户数据、第三方内容、编码样本、转义 | 保留；开发者运行固定文本中的装饰性 Unicode 不属于该例外 |

## DeveloperRuntimeText

活动生产代码中面向开发者的固定运行文本，不作为运行时数据持久化。

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `sourceLocation` | path + AST locator | 指向 logger 调用、启动横幅、异常摘要或开发诊断固定文本。 |
| `channel` | enum | `log-template`、`startup-banner`、`exception-summary`、`developer-diagnostic`。 |
| `staticFragments` | string[] | 只包含由启动器编写的字面量与模板静态片段。 |
| `dynamicFragments` | expression[] | 路径、Profile 名、外部错误、reason、错误码等；不翻译且继续脱敏。 |
| `level` | debug/info/warn/error/none | logger 调用必须保持原级别；非日志摘要为 none。 |
| `component` | string | 稳定英文组件名，例如 `Config`、`Flash`、`SessionLifecycle`。 |
| `asciiEnglish` | boolean | 所有静态片段必须为 true。 |
| `behaviorEvidence` | string[] | 证明调用数量、参数结构、控制流和结构化字段不变的测试或 diff。 |

### 验证规则

- `staticFragments` 中不得出现葡萄牙语、中文、Oasis 当前品牌、emoji、箭头、框线、长破折号或其他非 ASCII 字符。
- `dynamicFragments` 不得为满足 ASCII 规则而删除、翻译、音译或截断；敏感值继续由既有 logger/diagnostics 规则处理。
- 用户可见中文文案和中文翻译字典不属于 `DeveloperRuntimeText`。
- 日志模板修改不得改变 logger 调用数量、级别、结构化字段、异常捕获、返回值或副作用。

## BehaviorBaseline

用于证明本次表现层修改没有改变核心能力的验证模型，不作为运行时数据保存。

| 字段 | 说明 |
| --- | --- |
| `invariantId` | 对应行为保护合同中的稳定编号。 |
| `modules` | 行为所有者或混合模块允许点。 |
| `baselineEvidence` | 清理前通过的测试/人工事实。 |
| `postChangeEvidence` | 清理后相同或更强的测试/人工结果。 |
| `profileScope` | 单 Profile、双 Profile 或全局。 |
| `status` | pending/pass/fail/not-run。 |

任何 `fail` 都是实施阻塞；不得因“只改文案”而豁免。
