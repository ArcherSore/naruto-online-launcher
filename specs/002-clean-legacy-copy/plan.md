# Implementation Plan: 清理遗留界面文案

**Branch**: `[002-clean-legacy-copy]` | **Date**: 2026-07-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-clean-legacy-copy/spec.md`

## Summary

以“内容所有者 + 使用对象”为边界，把启动器自有的首次设置、管理/原生提示、游戏初始加载、诊断导出和 Linux 系统集成文案默认切换为简体中文；把活动生产代码中面向开发者的日志模板、启动横幅、异常摘要和诊断固定文本统一为可搜索的 ASCII 英文；移除两类文本中的葡萄牙语和 Oasis 当前产品文案。全局语言使用 `zh-CN` 作为默认与 fallback，遗留 `pt` 及无效值只迁移语言字段，不重建配置、Profile 或 Session。

实现采用现有模块内的定点文本和语言校验修改，不新增运行时模块或依赖。日志调用级别、位置、控制流、动态值、结构化字段与脱敏保持，只有启动器编写的固定部分可改。腾讯官方网页、原始外部错误、用户数据、协议/兼容标识、第三方文件和必要 Unicode 不进入批量清理；通过 AST 范围感知的开发者文本契约、可见文案契约、现有核心回归和双 Profile 人工 E2E 共同证明边界。

## Technical Context

**Language/Version**: CommonJS JavaScript（Node.js 16.20.2）、HTML/CSS、POSIX shell

**Primary Dependencies**: Electron 11.5.0、PPAPI Flash、electron-log；不新增依赖

**Storage**: `userData/config.json` 中的全局 `language`；现有 Profile 文件、Partition、日志文件位置/轮转/结构保持不变；不新增持久化实体

**Testing**: Jest 29.7 静态契约/单元/模块集成测试，现有腾讯流程与 Partition 回归，`bash -n`，Windows/Linux 人工 E2E

**Target Platform**: Windows portable、Linux AppImage

**Project Type**: 单一 Electron 桌面应用

**Performance Goals**: 不增加网络请求、页面探针、后台 timer 或启动阶段；语言规范化与查词保持常量时间，日志仍通过相同调用和 transport 输出，首次可见界面的加载步骤和窗口时序不变

**Constraints**: 固定 Node.js 16.20.2、npm 8.19.4、Electron 11.5.0 与 PPAPI；不修改腾讯官方网页；不改变登录、Session、导航、窗口生命周期和 Flash；不改 `package-lock.json`；不按全仓关键字或非 ASCII 批量替换

**Scale/Scope**: 约 13 类启动器自有可见面，以及 `src/` 活动生产 JavaScript 中的日志调用、启动横幅、异常摘要和开发诊断固定文本；覆盖本地 UI/对话框/生成文案、3 个 Linux 脚本、desktop 元数据和对应测试；腾讯页面、动态外部值及内部历史/协议资产排除

### 已核实的现状

- `src/config/settings.js`、`src/config/i18n.js`、`src/main.js` 和 `src/ui/setup/setup.html` 当前都以 `pt` 为默认或 fallback；首次设置页另有一份隔离的内联字典。
- 管理主页面 `src/ui/index.html` 与 `src/ui/app.js` 已以中文为主，但 `ManagerWindow` 初始标题、`IpcRouter` toast/文件对话框、Flash 缺失对话框及诊断导出 README 仍有葡语或普通英文。
- 实际游戏初始加载页由 `src/app/Launcher.js` 生成 `data:text/html`，其中仍显示 `Carregando`；`src/ui/loading/loading.html` 当前无生产引用但会被发行包包含，仍需作为休眠可见资产翻译而不是删除。
- Linux 安装、卸载、启动失败提示和 desktop entry 含大量葡语/英文用户文案；同一脚本中的路径、删除目标、命令、变量和审计日志结构属于受保护内容。
- 当前生产入口没有 Oasis 回退；Oasis 命中主要存在于历史规格、负向测试和治理文档，不能为了“全仓零命中”删除。
- `package.json.productName`、`StartupWMClass`、可执行文件名、配置目录及旧日志文件名具有兼容意义；修改可能改变 `userData` 或系统集成，必须保留。
- 计划前定向基线通过：5 个相关 suite、125 个 test；全量基线通过：17 个 suite、522 个 test。Jest 报告已有的强制退出/open handle 提示，但退出码为 0。
- `package-lock.json` 计划前 SHA-256 为 `DCD47B4DB444A346645678D5E63108E6465C77107A568BE3129D666744ACB226`。
- 2026-07-26 实测 `cmd.exe` 活动代码页为 936，而 Electron 日志固定文本包含 `ℹ️`、`→`、葡语重音和装饰性 Unicode，UTF-8 字节被终端按 GBK 解码后出现 `鈩癸笍`、`鈫?`、`regi茫o`。源码字节本身有效；根因是非 ASCII 固定模板与终端代码页不兼容。
- 活动生产源码的日志调用分布于配置、Profile、Session、Flash、性能、诊断和窗口模块；部分已经是英文但仍使用 emoji、箭头或长破折号，部分为葡萄牙语或中文。日志固定模板需要整体合同化，不能只修复示例三行。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Phase 0 研究前门禁

| Principle | 结果 | 证据与约束 |
| --- | --- | --- |
| I. 规格驱动 | PASS | 所有设计均追溯到 US1-US3、FR-001 至 FR-025 和 SC-001 至 SC-010；当前源码与终端实测用于证明日志乱码现状。 |
| II. 腾讯国服唯一产品方向 | PASS | 只移除可见遗留文案并加强负向检查，不新增 Oasis/国际服兼容入口；历史负向证据保留。 |
| III. 官方认证与受控诊断边界 | PASS | 不读取新的页面、Cookie/Storage 或身份数据，不修改腾讯网页；现有只读页面探针保持不变，本功能不需要授权诊断。 |
| IV. 模块化而非过度抽象 | PASS | 在现有 i18n、配置、UI、logger 调用、对话框和脚本职责内定点修改；只新增测试/文档契约，不新增运行时抽象层。 |
| V. 旧版运行时兼容 | PASS | 保持 Node 16.20.2、npm 8.19.4、Electron 11.5.0、PPAPI 和现有 API；无依赖及锁文件变更。 |
| VI. Session 隔离 | PASS | 不修改 Partition 命名、Session 获取/恢复/清理；仍要求两个 Profile 的隔离 E2E 与现有 Partition 测试。 |
| VII. 测试与验收先行 | PASS | 已记录自动化基线；先定义开发者固定文本提取/失败断言，再改生产模板，并保留核心回归、Linux 语法和人工 GUI 验收。 |
| VIII. 简单性与必要性 | PASS | 不引入新框架；使用测试环境已有解析能力提取静态片段，并在原调用点替换模板，不新增日志本地化层。 |
| IX. 可诊断性 | PASS | 用户摘要保持中文；开发者固定文本统一 ASCII 英文；原始错误、结构化上下文、日志级别、脱敏与诊断数据流保持。 |
| X. 治理与语言规范 | PASS | 规格、计划、研究、模型、合同和验证指南均使用中文；代码标识符、命令和原始错误保持原文。 |

**Gate result**: 全部 PASS，无未解决澄清项，无宪章偏离，可以进入 Phase 0。

## Project Structure

### Documentation (this feature)

```text
specs/002-clean-legacy-copy/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── copy-boundary-contract.md
│   ├── behavior-preservation-contract.md
│   └── developer-text-contract.md
├── checklists/
│   └── requirements.md
└── tasks.md                         # 后续 /speckit-tasks 生成
```

### Source Code (repository root)

```text
src/
├── main.js                          # 全局语言初始化、首次设置窗、Flash 缺失对话框
├── app/
│   ├── Launcher.js                  # 实际 data: 初始加载页；其余窗口/流程行为保护
│   ├── TencentLaunchFlow.js         # 仅允许日志固定文本；腾讯页面与导航状态机不变
│   ├── SessionLifecycle.js          # 仅允许日志固定文本；窗口与 Session 生命周期不变
│   └── __tests__/
│       ├── Launcher.test.js
│       ├── TencentLaunchFlow.test.js
│       └── SessionLifecycle.test.js
├── config/
│   ├── i18n.js                      # zh-CN 默认/fallback 与支持语言事实源
│   ├── optimization.js              # 返回给 UI 的优化预设名称与说明
│   ├── settings.js                  # language 规范化与原子保存
│   ├── urls.js                      # 不修改：腾讯 URL 角色
│   └── __tests__/settings.test.js
├── profiles/
│   ├── store.js                     # 用户可见的自动 Profile 名称
│   ├── partition.js                 # 仅允许日志固定文本；Session/Partition 隔离不变
│   └── __tests__/
├── flash/                           # 仅允许日志固定文本；PPAPI 发现与 mms.cfg 行为不变
├── ui/
│   ├── index.html                   # 已有中文管理面，纳入静态回归
│   ├── app.js                       # 已有动态中文文案，纳入静态回归
│   ├── setup/setup.html             # 静态首屏、内联字典、语言选择
│   ├── loading/loading.html         # 已打包休眠加载资产
│   ├── manager/
│   │   ├── ManagerWindow.js         # 初始窗口标题
│   │   ├── IpcRouter.js             # 用户 toast/对话框与 i18n allowlist
│   │   └── __tests__/IpcRouter.test.js
│   └── __tests__/
│       ├── tencent-ui.test.js
│       ├── copy-boundary.test.js    # 范围感知用户文案契约测试
│       └── developer-copy.test.js   # AST 提取开发者固定文本与 ASCII 英文合同
└── utils/
    ├── diagnostics.js               # 用户 README 中文；开发日志模板英文；原始日志保护
    ├── logger.js                    # ASCII 级别前缀；脱敏和 transport 不变
    └── __tests__/diagnostics.test.js

linux/
├── install.sh
├── uninstall.sh
├── run.sh
└── naruto-online.desktop

package.json                         # 只处理 desktop 展示元数据；productName 保留
package-lock.json                    # 不修改
```

**Structure Decision**: 继续使用现有单一 Electron 项目。语言规范化留在 `config`，各用户可见面和开发者固定文本在其现有所有者中定点替换；测试层新增一个只读、AST 范围感知的开发者文本契约测试，不新增运行时日志抽象或依赖。首次设置页因 `nodeIntegration:false`、`contextIsolation:true` 且使用现有标题哨兵通信，保留内联字典，通过 parity 测试约束它与主进程支持语言集合，不为本功能新增 preload 或 i18n 框架。

## Design

### 1. 语言默认值与迁移

- 规范默认代码为 `zh-CN`，并由 `src/config/i18n.js` 导出的默认值/支持集合成为主进程语言校验的事实源。
- `undefined`、`null`、空值、未知值、`pt`、`pt-BR`、`pt_BR` 统一规范化为 `zh-CN`；`zh-CN` 和既有非葡萄牙语受支持值保持。
- `saveConfig()` 在调用方缺少语言时写入 `zh-CN`，继续使用现有临时文件 + rename 原子保存。
- 迁移只改变返回/后续保存的 `language`，不得清除或重建 `firstBoot`、`windowBounds`、性能偏好、Profile 文件或 Chromium Partition。
- 从运行时字典、IPC allowlist 和首次设置选择器移除葡萄牙语；其他可选本地化的长期去留不在本功能决定范围，但它们不得成为 fallback。
- 首次设置页静态首屏、`<html lang>`、默认 active 语言和内联 fallback 均为 `zh-CN`；保留 `__SETUP_DONE__`、`advancedMode`、窗口尺寸与关闭语义。

### 2. 可见文案定点清理

- 按 [copy-boundary-contract.md](./contracts/copy-boundary-contract.md) 的 surface registry 清理，不扫描或替换整个仓库。
- 管理主页面只补强静态契约；不重写已经正确的中文结构。
- `optimization.listForUI()` 返回的预设名称与说明属于 launcher-owned UI 元数据，使用中文；preset code、性能参数、icon 和颜色不变。
- `Launcher.loadingPage()` 只替换可见文本，保持 `data:` URL、转义、Profile 窗口 registry、BrowserWindow 选项、生命周期和 `TencentLaunchFlow.start()` 时序。
- `src/ui/loading/loading.html` 虽当前不可达但进入发行包，翻译其静态/动态加载、错误和重试文案；不得改变 `setProgress`、阶段值、恢复 action、进度计算或 bridge。
- 原生对话框/toast/确认框使用中文摘要；机器错误码和 `e.message` 继续作为返回值或安全日志上下文，不直接当作普通中文界面的主体文案。
- 自动生成的 Profile 名称和复制后缀改为中文一致表达，不改变 ID、schema、去重或持久化行为。
- 诊断 ZIP 中启动器生成的 README、保存对话框和默认展示文件名中文化；ZIP 内原始日志、历史 crash、配置与 Profile 安全导出条目不做关键字清洗。

### 3. Linux 与系统集成

- 只翻译 `echo`、`log_*`、确认/帮助文本以及 desktop 的 `Name`/`Comment`/`GenericName` 等展示字段。
- 保留命令参数、退出码、条件分支、路径、变量、删除目标、`Exec`、`TryExec`、`Categories`、`Keywords`、`StartupWMClass` 和写入审计日志的结构。
- `package.json.productName`、可执行文件名和 `~/.config/Naruto Online` 兼容路径不改；只中文化不会改变身份/路径的 desktop 描述。
- 真正安装/卸载仅在临时 Linux 用户或 VM 验证；本地语法检查不得执行删除路径。

### 4. 开发者运行文本英文化

- 新增 [developer-text-contract.md](./contracts/developer-text-contract.md)，将活动生产 JavaScript 中 `logger.debug/info/warn/error` 第一参数的静态片段、启动横幅以及启动器自编异常/诊断摘要登记为 developer-owned surface。
- 使用测试环境现有 JavaScript 解析能力读取 AST，只抽取固定字符串、模板字面量静态片段和字符串拼接中的字面量；标识符、路径、Profile 名、`e.message`、reason、错误码与结构化字段值作为动态数据排除。
- 固定文本必须为 ASCII 英文，使用稳定的 `Component: action/result key=value` 词汇；删除 emoji、箭头、框线、长破折号和旧品牌横幅。`src/utils/logger.js` 的固定前缀改为 `[DEBUG|INFO|WARN|ERROR] [Launcher]`，其 sanitize、allowlist、file/console transport、level、轮转和 API 不变。
- 用户界面、对话框、toast、诊断 README 和翻译资源继续中文；开发者运行文本不进入 i18n 字典，也不随用户 locale 切换。
- 启动器自编的机器错误摘要改为英文；原始外部错误只作为动态值进入既有安全日志/返回边界，不翻译、不清洗、不扩大采集。
- 不回写既有日志文件，不翻译腾讯/OS/Chromium/Flash 的原始文本，不改变协议、IPC、stage/action、error code 或文件格式。

### 5. 英文技术词与受保护内容

- 允许英文必须属于合同中的精确类别，并处于中文上下文；普通动作词如 `Save`、`Exit`、`Installer`、`Uninstaller`、`Play` 不因“英文”而保留。
- `Flash`、`PPAPI`、`SWF`、`GPU`、`CPU`、`RAM`、`Session`、`Profile`、`Partition`、`URL`、`JSON`、`ZIP`、单位、命令和产品专名可按合同保留。
- 腾讯网页、OS 原生控件、用户输入、既有日志/crash 原文、动态外部错误、协议/IPC 标识、兼容标识、第三方/二进制/许可、历史/测试证据和必要 Unicode 明确排除；活动生产代码中的开发者固定文本不再排除。
- 负向测试中的 `Oasis`、`narutowebgame.com`、旧语言代码和葡语样本属于防回归证据，不以全仓零命中为目标。

### 6. 行为保护

- [behavior-preservation-contract.md](./contracts/behavior-preservation-contract.md) 将不变模块、允许修改点和自动/人工证据绑定。
- `config/urls.js`、页面分类/探针与二进制资产仍完全不改。`TencentLaunchFlow.js`、`SessionLifecycle.js`、`profiles/partition.js`、`flash/` 与网络安全模块只允许改变 logger 调用中的固定字面量；调用数量、级别、参数结构和所有非日志逻辑不得改变。
- `main.js`、`Launcher.js`、`IpcRouter.js` 等混合模块只允许合同列出的表现层/语言校验变更；现有 IPC channel、字段 allowlist、BrowserWindow 安全/Flash 参数、恢复 action 和回调时序保持。
- 不新增页面写入、翻译注入、Cookie/Storage 读取、认证数据观察或授权诊断路径。

## Verification Strategy

### 自动测试

1. `settings.test.js`：语言迁移矩阵、无关配置字段保持、保存默认值。
2. i18n/首次设置 parity：初始与 fallback 为 `zh-CN`，运行时支持集合/IPC allowlist/内联字典不含葡语且集合一致。
3. `copy-boundary.test.js`：只扫描合同声明的 launcher-owned 表面，检查葡语词组、葡语 locale、Oasis 当前入口、普通英文按钮和遗留品牌；允许表与排除表显式生效。
4. `Launcher.test.js`：解码 `data:text/html` 验证中文，同时继续断言 Partition、BrowserWindow、TencentLaunchFlow、SessionLifecycle、F5 和窗口 registry。
5. `IpcRouter.test.js`：Profile 上限/删除/复制/诊断 toast、导入导出对话框；IPC channel 与安全 allowlist 不变。
6. `diagnostics.test.js`：生成 README 中文，原始日志/crash/JSON entry 仍存在且未做关键字清洗。
7. 保留并运行 `TencentLaunchFlow.test.js`、`SessionLifecycle.test.js`、`partition.test.js`、URL/Flash/日志脱敏相关测试。
8. Linux：`bash -n` 三个脚本；范围感知静态测试验证展示文案，不执行真实安装或删除。
9. `developer-copy.test.js`：AST 提取生产 logger/启动横幅/异常摘要固定片段，断言 100% ASCII、葡语/Oasis/中文/装饰符号为 0，并验证动态值不被当作模板清洗。
10. `logger.test.js`：四个级别使用 ASCII 前缀，既有 URL/认证材料脱敏和安全字段 allowlist 继续通过。
11. 全量 `npm test -- --runInBand`、`npm run lint` 和 Prettier check。

### 必须人工验证

- 在隔离的 Windows 测试用户或 VM 中覆盖全新、缺失、无效、`pt`、`pt-BR`、`pt_BR` 六类语言状态，确认第一帧中文且其他配置/Profile 不丢失。
- 遍历首次设置、管理 CRUD/空态/错误、实际游戏初始加载、诊断成功/失败、Flash 缺失副本和窗口标题。
- 两个 Profile 分别扫码、手动选服、进入 Flash，记录 `2/2`；再覆盖 Session 失效、F5 安全刷新和一个失败恢复场景，跨 Profile 污染为 0。
- 对腾讯官方选服/认证页面做视觉和交互对比，只确认启动器没有新增翻译、隐藏、样式或 DOM 写入；不采集认证原始数据。
- 在临时 Linux 用户或 VM 中验证安装、取消/依赖失败、desktop、`uninstall.sh --help`、真正卸载和 `run.sh` 缺文件分支。
- 构建并启动 Windows portable 与 Linux AppImage，确认系统标题/入口中文且现有 `userData`、Profile 和 Session 连续。
- 在 Windows `cmd.exe` 默认代码页下运行 `npm start`，确认启动横幅、配置加载和 Flash 搜索的固定部分为可读英文，不再出现由 emoji、葡语重音、箭头或框线造成的乱码；动态 Unicode 值只记录原始内容。

### FR/SC 追溯

| 需求/结果 | 设计与合同 | 验证 |
| --- | --- | --- |
| FR-001、FR-002、FR-008、FR-009、FR-021、FR-023；SC-001、SC-003、SC-008 | surface registry、CopyAuditEntry、范围感知扫描 | copy-boundary test + 人工全入口审计 |
| FR-003 至 FR-006；SC-002 | `zh-CN` 规范化、setup parity、语言状态迁移 | settings/i18n/setup 测试 + 六类配置人工验证 |
| FR-007、FR-012、FR-013、FR-017 至 FR-019；SC-005 至 SC-007 | 行为保护合同、官方页面所有权、核心模块不变清单 | 腾讯流程/Partition 回归 + 双 Profile E2E |
| FR-010、FR-011；SC-004 | 英文技术词允许表与中文上下文规则 | 静态合同测试 + 人工文案复核 |
| FR-014 至 FR-016、FR-024、FR-025；SC-005、SC-008 至 SC-010 | 开发者文本合同、受保护分类、固定模板/动态值分离、诊断 README/原始条目分离 | developer-copy/diagnostics/logger 测试 + 启动日志复核 + diff 审计 |
| FR-020；SC-006 | 运行时/依赖/锁文件不变 | Git diff + 版本命令 + 全量测试 |
| FR-022；SC-006、SC-007 | quickstart 分平台人工场景 | Windows/Linux 结果记录 |

## Phase 1 后 Constitution 复查

| Principle | 结果 | Phase 1 设计证据 |
| --- | --- | --- |
| I. 规格驱动 | PASS | 数据模型、三份合同、quickstart 与 FR/SC 追溯表均已生成并覆盖 FR-001 至 FR-025、SC-001 至 SC-010。 |
| II. 腾讯国服唯一产品方向 | PASS | copy contract 对 Oasis 当前入口为零，历史负向证据受保护。 |
| III. 官方认证与受控诊断边界 | PASS | behavior contract 禁止腾讯 DOM 写入和新增认证数据读取；无需授权诊断。 |
| IV. 模块化而非过度抽象 | PASS | 设计复用现有模块，仅增加测试合同；setup 保留现有隔离通信。 |
| V. 旧版运行时兼容 | PASS | 无新 API/依赖/升级；quickstart 固定版本并覆盖双平台。 |
| VI. Session 隔离 | PASS | Partition 模块列为不可修改，quickstart 明确双 Profile 与失效隔离。 |
| VII. 测试与验收先行 | PASS | quickstart 包含自动、Windows GUI、Linux VM、构建和证据模板。 |
| VIII. 简单性与必要性 | PASS | 明确拒绝全仓替换、产品名/路径迁移、新 i18n 框架和删除休眠资产。 |
| IX. 可诊断性 | PASS | 用户诊断说明保持中文，开发者固定文本统一 ASCII 英文；原始错误、动态字段、级别、脱敏和恢复行为保持。 |
| X. 治理与语言规范 | PASS | 全部 Phase 0/1 文档为中文，原始命令和技术标识保持原文。 |

**Post-design gate result**: 全部 PASS；没有 Complexity Tracking 项，没有未解决澄清，可以进入 `/speckit-tasks`。
