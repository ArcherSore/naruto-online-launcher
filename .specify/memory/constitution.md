<!--
Sync Impact Report
- Version change: 2.0.0 → 2.1.0
- Modified principles:
  - IV. 模块化而非过度抽象（增加通用能力门槛与脚本策略的职责边界）
- Added sections: 无
- Removed sections: 无
- Templates updated:
  - ✅ `.specify/templates/plan-template.md`
  - ✅ `.specify/templates/spec-template.md`
  - ✅ `.specify/templates/tasks-template.md`
- Current feature artifacts requiring synchronized updates:
  - ✅ `specs/003-builtin-automation-framework/spec.md`
  - ✅ `specs/003-builtin-automation-framework/plan.md`
  - ✅ `specs/003-builtin-automation-framework/data-model.md`
  - ✅ `specs/003-builtin-automation-framework/contracts/manager-ipc-contract.md`
  - ✅ `specs/003-builtin-automation-framework/contracts/runtime-contract.md`
  - ✅ `specs/003-builtin-automation-framework/quickstart.md`
  - ✅ `specs/003-builtin-automation-framework/tasks.md`
- Spec Kit commands reviewed: `.agents/skills/speckit-*/SKILL.md`，无需修改
- Runtime guidance reviewed: `AGENTS.md`、`README.md`、`docs/REPO_MAP.md`；`AGENTS.md` 与
  `docs/REPO_MAP.md` 已同步
- Follow-up TODOs: 无
-->

# 腾讯国服《火影忍者 OL》启动器 Constitution

## Core Principles

### I. 规格驱动

每项功能的 Feature Spec 必须是该功能意图与验收要求的事实来源。Implementation Plan、
Tasks 和代码变更必须能够追溯到明确的用户故事、功能需求（FR）或成功标准（SC）；无法
追溯的工作不得进入实现。若实现过程中发现需求错误、冲突或遗漏，必须先修正 Feature Spec，
再同步 Plan、Tasks 和实现。规格不得取代源码与实测结果对现有系统事实的证明。

理由：本项目是在既有代码上重构，只有同时保持需求追溯和现状核验，才能避免让过时假设
成为实现依据。

### II. 腾讯国服唯一产品方向

腾讯国服必须是唯一产品方向。Oasis、巴西服及其他国际服不得作为兼容目标，也不得为了
保留其行为而增加分支或兼容层。原有国际服专用登录、区域、服务器、页面注入和网络逻辑
可以删除、替换或重构；仍有价值的通用窗口、Session、Profile、Flash 和资源管理能力必须
按国服架构评估后复用，而不是因来源于旧项目而一并丢弃。

理由：明确单一产品边界可减少迁移期间的双重语义，同时保护已经验证的通用工程资产。

### III. 官方认证与受控诊断边界

登录必须通过腾讯官方网页扫码流程完成。项目不得采集或存储 QQ 密码，不得伪造、解密、
重放或绕过登录票据、验证码、设备验证及风控，不得以自动化替代用户必须完成的官方确认。

当用户针对一个具体故障作出明确授权时，开发诊断会话可以只读、临时、最小化地检查解决该
故障所必需的官方页面 DOM/HTML、frame 层级、表单结构及值、完整 URL、Cookie/Storage
名称和值、身份或 Session 参数。该授权仅限当前本地诊断会话和指定 Profile；必须优先使用
测试账号，不得读取 QQ 密码字段，不得修改、复制、延长、伪造、解密、重放或利用认证材料
恢复登录，不得跨 Profile 访问。原始诊断数据不得写入仓库文件、普通日志、错误消息、截图、
文件名、IPC 广播、用户可导出的诊断包或长期存储；完成定位后必须立即停止读取并丢弃临时
数据。没有用户明确授权时，认证诊断仍按最小化、脱敏和未知字段默认拒绝处理。

涉及认证的规格和设计必须分别明确生产数据流、常规诊断边界，以及授权诊断的目的、范围、
时限、Profile、禁止用途、脱敏与清理方式。

理由：认证流程受第三方安全控制约束，任何绕过或泄露都会形成不可接受的账号与合规风险。
在不改变认证状态且不持久化原始数据的前提下，受控读取是定位第三方页面兼容故障所必需的
维护能力。

### IV. 模块化而非过度抽象

登录与选服、Session、窗口生命周期、Flash 宿主、网络策略和自动化能力必须具有明确职责
边界、入口与依赖方向。新增行为应优先在现有架构中形成内聚模块；不得强制把每项功能拆成
独立库，也不得为尚未出现在当前 Feature Spec 中的变化点预建框架、插件层或通用抽象。
跨模块副作用必须在 Plan 中显式说明。

通用框架能力的可用门槛必须只依赖该能力客观需要的资源条件。对于内置自动化，Profile、
所属窗口、webContents、内容尺寸、输入数据和动作生命周期是否有效属于框架职责；“当前页面
是否适合某个脚本操作”属于脚本策略。扫码、选服、Flash 加载或 `GAME_READY` 等页面语义状态
可以作为诊断或脚本判断信号，但不得在没有独立安全必要性的情况下全局禁用截图、录点、脚本
启动或其他通用能力。未来图像识别、页面等待及动作条件必须通过受限 Automation API 由脚本
表达，不得反向固化为框架对所有脚本的统一页面门槛。

理由：清晰边界便于迁移和诊断；按实际需求抽象可避免在旧版 Electron 环境中引入额外复杂度。

### V. 旧版运行时兼容

兼容基线必须保持为 Volta 管理的 Node.js 16.20.2、npm 8.19.4、Electron 11.5.0 和 PPAPI
Flash。普通 Feature 不得顺带升级这些运行时、包管理器、Electron、Flash 接入方式或核心依赖，
也不得无故改写 `package-lock.json`。任何此类升级必须作为独立 Feature Spec，说明迁移、回退、
Flash 兼容和分平台验证策略。

理由：Electron 11 与 PPAPI 是当前产品能够运行 Flash 的基础，隐式升级会改变项目的核心
可运行性边界。

### VI. Session 隔离

每个 Profile 必须使用独立的 Electron Session/Partition。Cookie、缓存、localStorage、
service worker、登录状态、网络处理器和清理操作不得跨 Profile 读取、写入或污染。涉及
Partition 命名、Session 获取、持久化、恢复、清理或窗口复用的修改，必须提供至少两个 Profile
之间的隔离验证，并覆盖一个 Profile 清理或失效不影响另一个 Profile 的场景。

理由：多账号能力的正确性和安全性依赖浏览器存储及生命周期的完整隔离。

### VII. 测试与验收先行

实现开始前，Feature Spec 必须给出可验证的用户行为、验收场景和成功标准，Plan 必须确定
验证层级，Tasks 必须在相应实现任务之前列出验证工作。纯逻辑和稳定模块接口应优先使用自动化
测试；扫码、网页导航、弹窗、官方页面变化和 Flash 渲染等难以可靠自动化的 GUI 行为必须提供
可重复的人工端到端步骤、预期结果及失败证据。测试应优先覆盖真实模块集成；只有外部服务、
不可控页面或昂贵边界才使用必要的 mock，且不得用过度模拟替代关键集成验证。

理由：旧版运行时、第三方网页和多 Session 组合带来高集成风险，验收设计必须先于代码。

### VIII. 简单性与必要性

只能实现可追溯到当前 Feature Spec 的能力。新增模块、抽象层、依赖、配置项和兼容分支必须
在 Plan 中指出其对应需求并说明为何现有结构不足；不得加入推测性的“以后可能需要”功能。
如果存在满足同一验收标准的更简单方案，必须优先采用，除非 Plan 记录了可验证的拒绝理由。

理由：控制范围和依赖是降低遗留系统重构风险、保持可审查性的直接手段。

### IX. 可诊断性

关键状态和失败路径必须可观察，至少覆盖与当前 Feature 相关的页面加载、认证状态、导航、
Flash 加载、Session 获取或失效。错误必须提供有限、明确且可执行的恢复方式；不得使用无限刷新、
无限重试、无上限递归导航或静默失败掩盖问题。日志和诊断事件必须有足够上下文区分 Profile
和阶段，同时遵守敏感信息脱敏要求。常规生产观察必须保持安全字段 allowlist；当该信号不足
以定位问题时，可以依照 Principle III 启动用户明确授权的临时本地诊断，并记录授权范围与
最终脱敏结论，不得把临时原始数据升级为常驻采集能力。

理由：第三方页面与 Flash 故障无法完全消除，受控恢复和安全诊断是可维护性的必要条件。

### X. 治理与语言规范

Constitution 约束后续所有 Feature Spec、Implementation Plan、Tasks 和实现审查。项目文档、
规格、计划、任务和 Codex 回复必须使用中文；代码标识符、命令及原始错误信息保持原文。
普通 Feature 不得隐式修改 Constitution。任何宪章修改必须单独说明原因、影响范围、迁移要求
和语义化版本变化，并同步依赖模板。

理由：稳定的治理入口和统一语言可避免规则在不同交付物中漂移。

## 工程约束

- 本项目是基于既有 Shinobi Launcher 的定向重构，不得按从零项目假设现有模块、数据或行为。
- 现状判断的证据优先级为：当前源码与配置、实际运行和测试结果、`docs/REPO_MAP.md`、历史文档。
  `MIGRATION_PROMPT.md` 只能作为历史交接材料，不得作为当前需求或事实来源。
- 涉及认证、Session、窗口、网络或 Flash 的设计必须同时检查模块边界、安全边界和旧运行时 API
  可用性。Electron 新版本 API 不得在未验证 Electron 11 支持的情况下写入 Plan。
- 依赖或锁文件变更必须能追溯到明确需求，并记录兼容性、安装验证和回退影响。
- 常规诊断数据必须遵循最小化和脱敏原则；不能证明安全的字段默认按敏感数据处理。只有符合
  Principle III 的用户明确授权诊断可以临时读取原始页面或认证状态，且不得持久化或转为
  生产采集。
- 自动化能力门槛必须区分客观资源有效性和脚本页面策略。若 Plan 拟以流程阶段、页面角色或
  DOM 语义禁用通用能力，必须证明这是该能力本身的安全必要条件；否则该信号只能用于诊断或
  由脚本通过受限 API 消费。

## 规格驱动交付与质量门

1. Feature Spec 必须定义范围内与范围外、按优先级排列且可独立验证的用户故事、编号化 FR、
   可衡量 SC、边界场景，以及受本宪章影响的约束。假设不得隐式扩张范围。
2. Implementation Plan 必须在 Phase 0 研究前逐项执行 I 至 X 的 Constitution Check，并在
   Phase 1 设计完成后复查。每项必须记录 PASS、FAIL 或有理由的 N/A 及证据；存在未解决的
   FAIL、无理由 N/A、未解决澄清项或不可追溯设计时，Plan 必须停止，不得进入 Tasks。
3. Plan 必须从真实仓库结构和源码建立技术方案。任何宪章偏离都只能记录为阻塞问题；不能用
   Complexity Tracking 将安全、认证、Session 隔离、运行时基线或产品方向违规合理化。
4. Tasks 必须按用户故事组织，并在描述中引用所实现的 FR、SC 或验收场景。自动化测试、人工
   验收、Session 隔离验证、诊断与错误恢复必须作为适用的显式任务，且验证设计先于对应实现。
   若需要授权诊断，任务还必须写明授权来源、只读范围、Profile、时限、禁止持久化和清理步骤。
5. 实现与审查必须核对 Spec、Plan、Tasks 和 Constitution。若代码暴露新的需求缺口，先回写
   Spec 并重新执行受影响的 Constitution Check，再继续实现。

## Governance

本 Constitution 在治理约束上高于 Feature Spec、Implementation Plan、Tasks 和一般开发惯例；
下游文档发生冲突时必须修正下游文档。修订必须通过显式 Constitution 工作流完成，并附带
Sync Impact Report、变更理由、受影响模板和必要迁移说明。版本采用语义化规则：删除原则、
放宽不可协商边界或进行不兼容重定义提升 MAJOR；新增原则或实质扩展治理要求提升 MINOR；
不改变含义的澄清和文字修正提升 PATCH。

每个 Plan 必须完成两次 Constitution Check；每次规格、计划、任务或代码审查都必须将违反
MUST 规则视为阻塞问题。复杂性必须回溯到当前需求并记录更简单替代方案。运行时开发指导以
`AGENTS.md` 和 `docs/REPO_MAP.md` 为入口，但它们不得覆盖本 Constitution；发现冲突时必须提出
显式宪章修订或修正文档，禁止静默选择。

**Version**: 2.1.0 | **Ratified**: 2026-07-20 | **Last Amended**: 2026-08-09
