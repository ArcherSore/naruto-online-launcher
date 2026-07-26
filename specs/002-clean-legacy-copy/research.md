# Phase 0 Research: 清理遗留界面文案

## 证据范围

- 需求依据：`specs/002-clean-legacy-copy/spec.md`
- 治理依据：`.specify/memory/constitution.md`、`AGENTS.md`
- 定位入口：`docs/REPO_MAP.md`
- 实际读取：语言配置与字典、首次设置、管理 UI、动态加载页、休眠加载资产、原生对话框、Profile 默认值、诊断导出、Linux 脚本/desktop 元数据、腾讯流程/Session/Partition/Flash 相关测试。
- 实测定向基线：`npm test -- --runInBand src/config/__tests__/settings.test.js src/ui/__tests__/tencent-ui.test.js src/app/__tests__/Launcher.test.js src/app/__tests__/SessionLifecycle.test.js src/profiles/__tests__/partition.test.js`，5 suite / 125 test 通过。
- 实测全量基线：`npm test -- --runInBand`，17 suite / 522 test 通过；两次运行都只有既有 Jest force-exit/open handle 提示，退出码为 0。
- `package-lock.json` 基线 SHA-256：`DCD47B4DB444A346645678D5E63108E6465C77107A568BE3129D666744ACB226`。

## Decision 1: 以内容所有者和可见面清单划定清理范围

**Decision**: 用户文案只清理合同中列明的 launcher-owned 可见面；开发者运行文本只清理活动生产代码中由启动器编写的日志模板、启动横幅、异常摘要和诊断固定片段。每个命中项记录为替换、删除可见入口或受保护保留，扫描不以整个仓库的字符串或字符集为边界。

**Rationale**: 同一葡语/Oasis 词可能同时出现在用户 toast、日志、历史规格、负向测试和代码注释中。全仓正则无法区分产品残留与必要证据，会违反 FR-014、FR-015 和 Constitution IX。

**Alternatives considered**:

- 全仓禁止葡萄牙语/Oasis：拒绝，会删除历史与负向测试证据。
- 删除所有非 ASCII：拒绝，会破坏中文 UI、用户数据、转义及第三方资产；只有 developer-owned 固定文本被单独约束为 ASCII。
- 只检查主 HTML：拒绝，会漏掉动态 data URL、原生对话框、生成 README 和 Linux 输出。

## Decision 2: 使用 `zh-CN` 作为唯一默认与 fallback

**Decision**: 全新、缺失、无效、`pt`、`pt-BR`、`pt_BR` 均规范化到 `zh-CN`；保存缺省值也为 `zh-CN`。葡萄牙语从可选语言、字典和 IPC allowlist 移除。

**Rationale**: 这是满足 FR-003 至 FR-006 的最直接数据迁移，且只影响全局语言值。规范 BCP 47 代码也与现有管理 HTML 的 `lang="zh-CN"` 一致。

**Alternatives considered**:

- 使用 `zh`：拒绝，项目现有中文页面已使用更精确的 `zh-CN`。
- 仅隐藏葡语按钮但保留 `pt` fallback：拒绝，旧配置或 IPC 仍可重新展示葡语。
- 删除 `language` 字段并固定中文：拒绝，超出“其他本地化长期去留不在本功能决定范围”的边界。

## Decision 3: 保留其他既有 locale，但它们不得成为 fallback

**Decision**: 保留当前非葡萄牙语可选语言的显式选择能力；默认中文界面上的语言名称使用中文标签。显式选择后的翻译质量不在本功能扩展范围，但支持集合必须在配置校验、主进程 IPC 和 setup 内联字典之间一致。

**Rationale**: 规格明确不决定葡萄牙语之外本地化的长期去留。当前 setup 已公开这些选项，直接删除会扩大产品范围；当前 `settings.js` 只接受 `pt/en` 又与 UI/字典矛盾，需要通过同一支持集合修正。

**Alternatives considered**:

- 只保留中文：拒绝，属于额外产品决策。
- 保持各处独立 allowlist：拒绝，现有代码已经发生漂移。

## Decision 4: i18n 支持集合集中，setup 字典保持隔离并做 parity 测试

**Decision**: `src/config/i18n.js` 提供默认语言与支持集合，`settings.js` 和 `IpcRouter` 使用该事实源。`setup.html` 继续保留内联字典与标题哨兵通信，但自动测试比较其 locale 集合和关键键。

**Rationale**: setup 窗口当前 `nodeIntegration:false`、`contextIsolation:true`，没有专用 preload；为共享字典引入新 bridge 会扩大安全与生命周期变化。集中主进程事实源 + 静态 parity 是兼容 Electron 11 的最小方案。

**Alternatives considered**:

- 新增 preload/IPC 动态加载全部字典：拒绝，增加隔离面和实现复杂度。
- 复制后不做一致性测试：拒绝，现有漂移会重现。
- 删除 setup 多语言字典：拒绝，隐式取消其他 locale。

## Decision 5: 休眠加载资产翻译但不删除

**Decision**: 同时清理实际 `Launcher.loadingPage()` 与 `src/ui/loading/loading.html`；后者标记为“已打包、当前无生产引用”，只翻译可见文案。

**Rationale**: 发行配置会打包该 HTML，将来恢复引用即可重新暴露葡语。删除文件会把文案任务扩大为资产/恢复路径变更，翻译是风险更低的处理。

**Alternatives considered**:

- 因当前不可达而忽略：拒绝，不满足深度清理与打包面审计。
- 删除文件：拒绝，缺乏删除行为与未来恢复用途的需求依据。

## Decision 6: 英文采用精确允许表而不是全放行

**Decision**: 保留 Flash、PPAPI、SWF、GPU、CPU、RAM、Session、Profile、Partition、URL、JSON、ZIP、AppImage、FUSE、单位、命令、错误码和产品专名等必要词；普通按钮/说明必须中文。

**Rationale**: 精确允许表同时满足技术准确性和 SC-004 的可审查性。允许项必须处于中文上下文，并说明为何无法自然替换或为何保持行业一致性。

**Alternatives considered**:

- 所有英文均保留：拒绝，会让普通英文提示逃避清理。
- 所有英文均翻译：拒绝，会损害协议、命令、缩写和故障定位。

## Decision 7: 诊断生成文案与原始诊断内容分层

**Decision**: 中文化保存对话框、toast 和启动器生成的 README；不清洗 ZIP 内的普通日志、历史 crash、配置/Profile 安全导出条目或机器错误码。用户提示用中文摘要，原始错误继续留在安全日志或结构化返回字段。

**Rationale**: README 与对话框是启动器自有可见文案，原始条目则是 FR-014/FR-016 要求保留的诊断证据。二者位于同一导出流程但所有权不同。

**Alternatives considered**:

- 对 ZIP 全部文本做中文化/关键字替换：拒绝，会破坏证据。
- 因为包含日志而整个诊断模块不改：拒绝，会保留可见葡语入口。

## Decision 8: 兼容标识不按品牌文案迁移

**Decision**: 保留 `package.json.productName`、`StartupWMClass`、可执行文件名、配置目录、`SHINOBI_DEBUG`、旧日志文件名和协议/IPC 字符串。`Shinobi Launcher` 只在被触达的用户可见展示副本中替换，不做内部全局重命名。

**Rationale**: Electron `productName` 参与应用名称及可能的 `userData` 路径，Linux 卸载脚本也依赖既有目录。修改会让 Profile/Session 看似丢失，直接违反 FR-004、FR-017 和 Constitution VI。

**Alternatives considered**:

- 全局重命名所有 `Shinobi`：拒绝，属于兼容迁移。
- 保留用户可见旧品牌：拒绝，与当前腾讯国服产品面不一致。

## Decision 9: Linux 只翻译展示字符串

**Decision**: 翻译 `echo`、`log_*`、帮助/确认文本和 desktop 展示字段；保持 shell 控制流、变量、参数、路径、删除目标、退出码、命令、`Exec`、`Categories`、`Keywords`、`StartupWMClass` 及日志记录结构。

**Rationale**: Linux 脚本把 UI、系统集成和破坏性文件操作混在同一文件中。限定到展示字符串可以覆盖用户可见葡语，同时不改变安装/卸载语义。

**Alternatives considered**:

- 用全局翻译替换脚本：拒绝，可能修改变量、路径或命令。
- 本功能不处理 CLI：拒绝，安装/卸载是明确的启动器自有用户界面。

## Decision 10: 核心行为采用“不变模块 + 混合模块允许点”门禁

**Decision**: `urls.js` 的协议事实、腾讯页面与导航状态机、Session/Partition、Flash 和网络安全行为不改。为满足新增的开发者运行文本合同，活动生产模块可以只修改 logger 调用中的固定字面量；调用数量、级别、参数结构、控制流和所有非日志逻辑继续冻结。对 `main.js`、`Launcher.js`、`IpcRouter.js` 等混合模块，只允许合同列出的 UI/语言/开发者文本点，并用既有回归与新增局部断言保护其余行为。

**Rationale**: 单纯以文件为单位冻结会阻止翻译实际动态加载页和原生错误；完全放开混合模块又容易引入窗口/导航副作用。允许点合同提供可审查的中间粒度。

**Alternatives considered**:

- 所有启动模块完全不改：拒绝，实际可见葡语和开发者日志残留就在 `Launcher.js`/`main.js` 等生产模块。
- 只依赖人工 diff：拒绝，无法持续防回归。

## Decision 11: 验证采用静态契约、现有回归和真实 E2E 三层

**Decision**:

1. 范围感知静态测试验证语言、可见文本、允许表和受保护排除。
2. Jest 迁移/模块集成与全量回归证明调用、IPC、Session、导航、Flash 和诊断结构不变。
3. Windows 与 Linux 隔离环境人工验收覆盖第一帧、原生 UI、腾讯网页、双 Profile、打包和系统集成。

**Rationale**: 休眠 HTML 和 Linux 文案适合静态检查；扫码、官方页面与 Flash 不能由 mock 完整证明；三层组合符合 Constitution VII。

**Alternatives considered**:

- 只用关键词扫描：拒绝，不能证明运行时回退或行为保持。
- 只用 GUI：拒绝，覆盖慢且无法稳定覆盖全部错误字符串。
- 只用 mock：拒绝，不能证明官方网页、Session 与 Flash 的真实组合。

## Decision 12: 开发者运行固定文本使用 ASCII 英文，动态值保持原样

**Decision**: 活动生产代码中由启动器编写的日志模板、启动横幅、异常摘要和开发者诊断固定文本统一使用 ASCII 英文。日志固定格式采用稳定的 `Component: action/result key=value` 词汇，logger 前缀使用 ASCII 级别标签；路径、Profile 名、`e.message`、reason、错误码和结构化字段值保持原样并继续经过既有脱敏。用户界面和诊断 README 继续中文。

**Rationale**: Windows `cmd.exe` 代码页 936 会把 Electron 输出的 UTF-8 emoji、箭头、框线和葡语重音解码为乱码。只把固定模板改为 ASCII 能让组件和阶段在常见终端中稳定可读、可搜索，同时不牺牲上游错误证据、用户 Unicode 数据或机器合同。英文开发文本与中文用户界面的职责分离也符合跨语言维护惯例。

**Alternatives considered**:

- 只要求用户每次执行 `chcp 65001`：拒绝，依赖外部终端设置，不能保证默认 `npm start` 的启动日志可定位。
- 把动态路径、Profile 名和外部错误强制转 ASCII/翻译：拒绝，会损失证据、改变用户数据并可能破坏协议语义。
- 给日志增加运行时 i18n：拒绝，日志关键词会随 locale 漂移，增加依赖和故障定位复杂度。
- 只替换用户报告的三行：拒绝，同一乱码/葡语模式存在于配置、Profile、Session、Flash、诊断和启动横幅等多个生产模块，会继续产生不可搜索输出。
- 修改历史日志文件：拒绝，历史证据应保持；合同只约束修改后新产生的固定文本。

## 运行时待验证事实

- 中文首次设置文本在固定 500×400 内容区和 Windows/Linux 字体下无截断。
- 旧 `pt` 配置升级后是否会在用户完成一次运行内持久保存为 `zh-CN`；无论是否立即写回，首次可见文案必须已为中文且其他配置不变。
- Windows native dialog 与 Linux desktop shell 对中文字体/编码的实际呈现。
- Windows 默认代码页下，ASCII 固定日志模板应稳定可读；包含中文 Profile 名或路径的动态值仍由终端字体/代码页决定，但其前置组件、动作和字段名必须可读。
- 两个真实腾讯账号/Profile 的扫码、Session 复用/失效和 Flash 加载。
- Linux AppImage 的安装、卸载与既有 `StartupWMClass`/配置路径连续性。
