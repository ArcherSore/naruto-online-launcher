# Tasks: 清理遗留界面文案

**Input**: 来自 `/specs/002-clean-legacy-copy/` 的设计文档

**Prerequisites**: `plan.md`、`spec.md`、`research.md`、`data-model.md`、`contracts/`、`quickstart.md`

**Tests**: 本功能的规格与 Constitution 明确要求自动化测试、范围审计和人工 E2E；每个用户故事均先编写验证，再实施对应变更。

**Organization**: 任务按用户故事组织，使中文默认界面、受保护内容边界和核心行为保持可以分别实施与验收。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（不同文件，且不依赖尚未完成的任务）
- **[Story]**: 任务归属的用户故事（`US1`、`US2`、`US3`）
- 每个任务描述均包含准确文件路径以及对应的 FR、SC 或验收场景

## Phase 1: Setup（共享验证基线）

**Purpose**: 固化清理前事实、审计载体和行为证据结构，避免把历史命中或既有警告误判为本功能回归。

- [X] T001 创建 `specs/002-clean-legacy-copy/validation/baseline.md`，记录 Node.js/npm/Electron/PPAPI 版本、5 suite/125 test 定向基线、17 suite/522 test 全量基线、既有 Jest open-handle 警告和 `package-lock.json` SHA-256 `DCD47B4DB444A346645678D5E63108E6465C77107A568BE3129D666744ACB226`（FR-020、SC-006）
- [X] T002 [P] 按 `specs/002-clean-legacy-copy/contracts/copy-boundary-contract.md` 的 Surface Registry 初始化 `specs/002-clean-legacy-copy/validation/copy-audit.md`，为每个 surface 建立候选数、处置、技术词、受保护类别、未分类数和证据列（FR-001、FR-002、FR-023、SC-001、SC-008）
- [X] T003 [P] 按 `specs/002-clean-legacy-copy/contracts/behavior-preservation-contract.md` 初始化 `specs/002-clean-legacy-copy/validation/behavior-regression.md`，为登录、官方页面、Session/Partition、导航恢复、窗口生命周期、Flash、诊断和锁文件建立 baseline/post-change 状态（FR-012、FR-014、FR-017 至 FR-020、SC-005 至 SC-007）

**Checkpoint**: 清理前基线和两个可追溯验证台账已建立。

---

## Phase 2: Foundational（阻塞性共享前置）

**Purpose**: 建立只扫描 launcher-owned 可见面的范围感知测试基础；该阶段完成前不得开始用户故事实现。

- [X] T004 创建 `src/ui/__tests__/copy-boundary.test.js` 的表驱动 Surface Registry 与提取/分类辅助代码，先以“每个登记路径存在或明确为 N/A、腾讯/日志/协议/第三方路径不进入全仓禁词扫描”为通过条件，覆盖 HTML、动态 HTML、dialog/toast/title、生成文档、shell 展示行和 desktop 展示字段（FR-001、FR-013、FR-021、SC-001）

**Checkpoint**: 共享扫描框架能够限定内容所有者与可见面，后续故事可在其上先添加失败断言。

---

## Phase 3: User Story 1 - 获得干净的中文默认界面（Priority: P1）🎯 MVP

**Goal**: 全新、缺失、无效和遗留葡语配置均以简体中文进入启动器自有界面；所有可达 launcher-owned 常规、空态、加载、失败、恢复、安装和系统入口不再展示未授权葡语/Oasis 文案。

**Independent Test**: 在隔离环境执行语言矩阵并遍历 Surface Registry；首次可见面 100% 为中文，葡语/Oasis 当前产品文案为 0，其他配置与 Profile 数量不变。

### Tests for User Story 1

> **先完成并运行 T005-T010，确认断言因当前葡语默认值或遗留文案而失败，再开始 T011-T020。**

- [X] T005 [P] [US1] 扩展 `src/config/__tests__/settings.test.js`，为缺失、`undefined`、`null`、空字符串、无效值、非字符串、`pt`、`pt-BR`、`pt_BR`、`zh-CN` 和保留非葡语 locale 编写失败迁移测试，并断言 `firstBoot`、`advancedMode`、窗口/性能偏好及 Profile 数据不被重置（FR-003、FR-004、SC-002；US1 场景 1、3）
- [X] T006 [P] [US1] 扩展 `src/ui/__tests__/copy-boundary.test.js`，先添加会失败的 `zh-CN` 默认/fallback、setup/runtime locale parity、无葡语 locale、无葡语/Oasis/普通英文动作词及休眠 loading/Linux/package surface 覆盖断言（FR-003、FR-005 至 FR-010、FR-021、SC-002、SC-003）
- [X] T007 [P] [US1] 扩展 `src/ui/__tests__/tencent-ui.test.js`，先添加管理页静态/动态文本、窗口标题、tooltip 和 ARIA 为中文且不显示 `Shinobi Launcher` 当前品牌的失败断言，同时允许中文上下文中的 Flash/Profile 等技术词（FR-006、FR-008、FR-010、SC-003）
- [X] T008 [P] [US1] 扩展 `src/app/__tests__/Launcher.test.js`，先断言 `loadingPage()` 生成中文加载摘要并安全转义 Profile 名，同时锁定 `data:` URL 生成与 `ready-to-show` 后调用顺序（FR-006、FR-017、SC-003、SC-006）
- [X] T009 [P] [US1] 扩展 `src/ui/manager/__tests__/IpcRouter.test.js`，先为 CRUD/toast/dialog、导入导出标题、语言 allowlist、重复副本后缀和默认文件名添加中文失败断言，并保持 IPC channel、输入输出 allowlist 与 handler 调用不变（FR-005、FR-008 至 FR-010、FR-017、SC-003）
- [X] T010 [P] [US1] 扩展 `src/profiles/__tests__/store.test.js`，先为无名 Profile 和复制名称添加中文失败断言，并锁定 schema、ID、去重、迁移 allowlist 与 Partition 删除行为（FR-004、FR-010、FR-018、SC-002、SC-006）

### Implementation for User Story 1

- [X] T011 [US1] 在 `src/config/i18n.js` 中把 `zh-CN` 设为默认与 fallback，导出供主进程复用的支持语言事实源，补齐中文运行时字典并从支持集合/字典移除葡萄牙语（FR-003、FR-005、FR-006、SC-002、SC-003）
- [X] T012 [US1] 在 `src/config/settings.js` 中复用 `src/config/i18n.js` 的事实源实现语言规范化矩阵与 `zh-CN` 保存缺省值，只迁移 `language` 并保持现有原子保存、其他配置、Profile 与 Session 数据（依赖 T011；FR-003、FR-004、FR-018、SC-002）
- [X] T013 [P] [US1] 在 `src/ui/setup/setup.html` 中把 `<html lang>`、静态第一帧、默认 active 语言、内联 fallback 和通用字典改为简体中文，删除葡语按钮/字典且保持 CSP、性能模式值、`advancedMode`、`__SETUP_DONE__` payload 与关闭时序（FR-003、FR-005、FR-006、FR-017、SC-002、SC-003）
- [X] T014 [US1] 在 `src/main.js` 中使用 `zh-CN` 初始化/回退语言并中文化 setup 标题、查询参数和 Flash 缺失原生对话框，只改合同允许点且保持 ready 流程、标题哨兵、Flash 检测与失败退出语义（依赖 T011、T012；FR-003、FR-008、FR-017、SC-002、SC-006）
- [X] T015 [P] [US1] 中文化 `src/ui/index.html`、`src/ui/app.js` 和 `src/ui/manager/ManagerWindow.js` 中 launcher-owned 的静态/动态文本、空态、title、tooltip 与 ARIA，统一腾讯国服产品展示且保留必要技术词的中文上下文（FR-006 至 FR-008、FR-010、SC-003）
- [X] T016 [P] [US1] 在 `src/ui/manager/IpcRouter.js` 中中文化管理 CRUD、Profile 限制、文件选择、刷新/恢复和通用失败的 toast/dialog 文案，复用 i18n 支持集合并保持 IPC channel、文件限制、恢复 action、Session/inspector 调用与原始安全错误字段（依赖 T011；FR-005、FR-008、FR-010、FR-017、SC-003、SC-006）
- [X] T017 [P] [US1] 在 `src/profiles/store.js` 中中文化无名 Profile 和复制显示名称，只改可见默认值并保持 schema、Profile ID、迁移 allowlist、去重、日志与 Partition 删除逻辑（FR-004、FR-010、FR-018、SC-002、SC-006）
- [X] T018 [P] [US1] 只修改 `src/app/Launcher.js` 的 `loadingPage()` 可见文字为中文，保持 BrowserWindow 参数、`plugins:true`、Partition、User-Agent、registry、TencentLaunchFlow/SessionLifecycle/快捷键挂接及调用顺序（FR-006、FR-017 至 FR-019、SC-003、SC-006）
- [X] T019 [P] [US1] 中文化已打包但当前无生产引用的 `src/ui/loading/loading.html` 静态/动态阶段、错误与重试文案，保留 `setProgress`、phase 值、百分比/速度/ETA 解析和恢复 bridge/action（FR-006、FR-008、FR-019、SC-003）
- [X] T020 [P] [US1] 仅中文化 `linux/install.sh`、`linux/uninstall.sh`、`linux/run.sh`、`linux/naruto-online.desktop` 与 `package.json` 中人类可见的提示、确认和 desktop `Comment`/`GenericName` 等展示字段，保持控制流、命令、路径、删除目标、退出码、`Exec`、`Categories`、`Keywords`、`StartupWMClass`、`productName`、appId、依赖、scripts、Volta 和可执行文件名（FR-009、FR-015、FR-020、SC-003、SC-005）

### Verification for User Story 1

- [X] T021 [US1] 运行 US1 定向测试 `src/config/__tests__/settings.test.js`、`src/ui/__tests__/copy-boundary.test.js`、`src/ui/__tests__/tencent-ui.test.js`、`src/app/__tests__/Launcher.test.js`、`src/ui/manager/__tests__/IpcRouter.test.js`、`src/profiles/__tests__/store.test.js`，将 suite/test 数、失败修复和对应 surface 结果写入 `specs/002-clean-legacy-copy/validation/copy-audit.md`（FR-021、FR-023、SC-001 至 SC-003）
- [ ] T022 [US1] 按 `specs/002-clean-legacy-copy/quickstart.md` 在隔离 Windows 用户/VM 验证全新、缺失、空、无效、`pt`、`pt-BR`、`pt_BR`、`zh-CN` 与一个保留非葡语 locale 的第一帧和配置保持，将脱敏结果写入 `specs/002-clean-legacy-copy/validation/windows-copy.md`（FR-004、FR-022、SC-002；US1 场景 1、3）

**Checkpoint**: US1 可独立交付为 MVP；中文为默认，launcher-owned 可见面不存在未授权葡语/Oasis 文案。

---

## Phase 4: User Story 2 - 保留必要的技术表达和受保护内容（Priority: P2）

**Goal**: 必要英文技术词有明确、受限且一致的保留理由；腾讯官方页面、原始诊断、日志、协议、第三方/兼容标识、测试证据和必要 Unicode 不因清理被改写。

**Independent Test**: 对全部命中项按所有者和可见性分类，检查技术词允许表与受保护类别；官方页面改动、第三方/协议无依据改动和未分类项均为 0，诊断 ZIP 原始 entry 结构保持。

### Tests for User Story 2

> **先完成并运行 T023-T025，确认新增断言因当前诊断生成文案或未落实的边界而失败，再开始 T026-T027。**

- [X] T023 [P] [US2] 扩展 `src/utils/__tests__/diagnostics.test.js`，先为中文生成 README/展示文件名添加失败断言，同时锁定 ZIP entry 集合、普通日志、历史 crash、配置/Profile 安全导出、大小限制、脱敏和机器错误码不被关键词清洗（FR-014 至 FR-016、SC-004、SC-005）
- [X] T024 [P] [US2] 扩展 `src/ui/__tests__/copy-boundary.test.js`，先添加英文技术词精确允许表、中文上下文、普通英文动作词拒绝、每个受保护命中映射类别和禁止全仓/非 ASCII 清洗的契约断言（FR-010、FR-011、FR-013 至 FR-015、FR-021、SC-004、SC-005）
- [X] T025 [P] [US2] 扩展 `src/ui/manager/__tests__/IpcRouter.test.js`，先为诊断导出保存对话框、成功/失败中文摘要与原始技术错误安全边界添加失败断言，并锁定结构化返回、IPC channel 和现有脱敏调用（FR-014、FR-016、SC-004、SC-005）

### Implementation for User Story 2

- [X] T026 [P] [US2] 在 `src/utils/diagnostics.js` 中仅中文化启动器生成的 README、展示文件名和用户说明，保持原始日志/crash/config/profile entries、ZIP 结构、大小限制和脱敏逻辑逐项不变（FR-014 至 FR-016、SC-005）
- [X] T027 [P] [US2] 在 `src/ui/manager/IpcRouter.js` 中仅中文化诊断导出对话框与面向用户的成功/失败摘要，原始错误继续限定在既有安全返回/日志边界且不改变 handler 控制流（FR-014、FR-016、SC-004、SC-005）

### Verification for User Story 2

- [X] T028 [US2] 在 `specs/002-clean-legacy-copy/validation/copy-audit.md` 中逐项登记所有实际修改、Flash/PPAPI/SWF/GPU/Session/Profile/URL/JSON/ZIP 等保留技术词的必要性与允许 surface，以及腾讯页面、日志、协议、兼容标识、第三方、测试证据和 Unicode 命中的受保护类别（FR-002、FR-011、FR-013 至 FR-015、FR-023、SC-004、SC-005、SC-008）
- [X] T029 [US2] 比较 `package-lock.json`、`src/app/TencentLaunchFlow.js`、`src/app/SessionLifecycle.js`、`src/profiles/partition.js`、`src/config/urls.js`、`src/preload.js`、`src/flash/`、`src/network/inspector.js`、`src/utils/logger.js` 与基线，并检查 `package.json` 兼容键和 `src/utils/diagnostics.js` 原始 entry 结构，将结果写入 `specs/002-clean-legacy-copy/validation/behavior-regression.md`（FR-012 至 FR-015、FR-020、SC-005、SC-006）
- [ ] T030 [US2] 按 `specs/002-clean-legacy-copy/quickstart.md` 人工核对腾讯 selector/auth/game 页面无翻译/隐藏/DOM 写入，并导出诊断 ZIP 验证中文 README、原始 entry、日志证据和脱敏边界，将不含认证原文的结果写入 `specs/002-clean-legacy-copy/validation/protected-content.md`（FR-012 至 FR-016、FR-022、SC-004、SC-005；US2 场景 2 至 4）

**Checkpoint**: US2 可独立证明“该翻译的可见文案已翻译、必须保留的技术与外部内容未误改”。

---

## Phase 5: User Story 3 - 清理后仍可正常登录和进入游戏（Priority: P3）

**Goal**: 用自动回归和真实双 Profile E2E 证明文案清理没有改变官方扫码、手动选服、Session 隔离、导航/恢复、窗口生命周期和 Flash 行为。

**Independent Test**: Profile A/B 分别完成官方扫码、手动选服和 Flash 进入（2/2），A 的刷新/失效/恢复不影响 B，恢复保持有界且无 Oasis 回退。

### Tests for User Story 3

> **先完成 T031-T034 的行为断言；若任一基线断言失败，停止文案实现并先修正规格/计划或恢复越界改动。**

- [X] T031 [P] [US3] 加强 `src/app/__tests__/Launcher.test.js` 对 BrowserWindow 安全参数、`plugins:true`、Profile Partition、User-Agent、registry、TencentLaunchFlow/SessionLifecycle/快捷键挂接和 `ready-to-show` 调用顺序的回归断言（FR-017、FR-018、SC-006）
- [X] T032 [P] [US3] 加强 `src/app/__tests__/TencentLaunchFlow.test.js` 对腾讯 selector/auth/game 角色、认证子窗路由、固定只读探针预算、每类一次恢复、全流程上限及无 Oasis fallback 的回归断言（FR-012、FR-017、FR-019、SC-005、SC-006）
- [X] T033 [P] [US3] 加强 `src/app/__tests__/SessionLifecycle.test.js` 对 load/crash/responsive/close 委托、Session flush、无页面翻译注入、无 Session 清理及 renderer crash 有界恢复的回归断言（FR-012、FR-017 至 FR-019、SC-005、SC-006）
- [X] T034 [P] [US3] 加强 `src/profiles/__tests__/partition.test.js` 对 `persist:profile-<id>` 稳定映射、A/B 不同 Partition、同 Profile Session 复用和一个 Profile 清理/失效不影响另一个的回归断言（FR-004、FR-018、SC-006、SC-007）

### Verification for User Story 3

- [X] T035 [US3] 运行 `src/app/__tests__/Launcher.test.js`、`src/app/__tests__/TencentLaunchFlow.test.js`、`src/app/__tests__/SessionLifecycle.test.js`、`src/profiles/__tests__/partition.test.js`、`src/config/__tests__/urls.test.js`、`src/ui/manager/__tests__/KeyboardShortcuts.test.js`、`src/ui/manager/__tests__/StateBroadcaster.test.js`、`src/network/__tests__/inspector.test.js` 与 `src/utils/__tests__/logger.test.js`，将 post-change suite/test 数写入 `specs/002-clean-legacy-copy/validation/behavior-regression.md`（FR-012、FR-014、FR-017 至 FR-019、SC-005、SC-006）
- [ ] T036 [US3] 执行 `package.json` 中 `build:win` 与 `build:linux`，验证 Windows portable/Linux AppImage 在固定 Electron 11.5.0 与 PPAPI 基线下构建，并把产物/启动结论写入 `specs/002-clean-legacy-copy/validation/behavior-regression.md`（FR-017、FR-020、FR-022、SC-006）
- [ ] T037 [US3] 按 `specs/002-clean-legacy-copy/quickstart.md` 在隔离 Windows 环境用测试 Profile A/B 分别完成官方扫码、手动选服、Flash 可见与鼠标交互，验证 2/2 成功、Partition 不同且跨 Profile 污染为 0，将仅含脱敏结论的证据写入 `specs/002-clean-legacy-copy/validation/windows-e2e.md`（FR-012、FR-017、FR-018、FR-022、SC-006、SC-007；US3 场景 1、2）
- [ ] T038 [US3] 在 `specs/002-clean-legacy-copy/validation/windows-e2e.md` 记录同 Profile 刷新、A Session 失效而 B 保持、一次页面失败、一次 renderer/Flash 恢复及可丢弃副本中的 Flash 缺失中文对话框，确认每类恢复有界、退出语义不变且无 Oasis fallback（FR-017、FR-019、FR-022、SC-006、SC-007；US3 场景 3）
- [ ] T039 [US3] 按 `specs/002-clean-legacy-copy/quickstart.md` 仅在 Linux VM/临时用户验证 `linux/install.sh`、`linux/uninstall.sh`、`linux/run.sh`、desktop 入口、真实 AppImage 启动和既有配置路径/`StartupWMClass` 连续性，将输出、退出码和删除目标审计结果写入 `specs/002-clean-legacy-copy/validation/linux-e2e.md`（FR-009、FR-015、FR-017、FR-020、FR-022、SC-003、SC-005、SC-006）

**Checkpoint**: US3 的自动门禁与真实 2/2 Profile E2E 均通过；登录、Session、导航与 Flash 行为不低于清理前基线。

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 汇总全部故事的质量门禁、差异边界和最终可追溯审计。

- [X] T040 运行 `specs/002-clean-legacy-copy/quickstart.md` 列出的定向 Jest 命令，覆盖 `src/config/__tests__/settings.test.js`、`src/ui/__tests__/copy-boundary.test.js`、`src/ui/__tests__/tencent-ui.test.js`、`src/ui/manager/__tests__/IpcRouter.test.js`、`src/utils/__tests__/diagnostics.test.js`、`src/app/__tests__/Launcher.test.js`、`src/app/__tests__/TencentLaunchFlow.test.js`、`src/app/__tests__/SessionLifecycle.test.js` 和 `src/profiles/__tests__/partition.test.js`，将最终结果写入 `specs/002-clean-legacy-copy/validation/baseline.md`（FR-021、FR-023、SC-001 至 SC-006）
- [ ] T041 [P] 运行 `package.json` 的全量 `test` 与 `lint` scripts 以及对 `src/**/*.{js,html,css,json}`、`tests/**/*.js` 的 Prettier check，把退出码、suite/test 数和既有警告写入 `specs/002-clean-legacy-copy/validation/baseline.md`（FR-017、FR-020、SC-006）
- [ ] T042 [P] 对 `linux/install.sh`、`linux/uninstall.sh`、`linux/run.sh` 执行 `bash -n`，并把仅语法检查、未执行安装/删除的结果写入 `specs/002-clean-legacy-copy/validation/linux-e2e.md`（FR-009、FR-015、SC-003、SC-005）
- [X] T043 执行 `git diff --check`，核对 `package-lock.json` 哈希、行为合同完全不修改列表、混合模块允许点和 `package.json` 兼容键，将逐项 PASS/FAIL 写入 `specs/002-clean-legacy-copy/validation/behavior-regression.md`（FR-012 至 FR-020、SC-005、SC-006）
- [X] T044 汇总 `specs/002-clean-legacy-copy/validation/copy-audit.md`，确保全部 Surface Registry 行的未分类数为 0、未授权葡语/Oasis 为 0、每个英文技术词和受保护命中有理由且每项改动可追溯到测试/人工证据（FR-001、FR-002、FR-011、FR-023、SC-001、SC-003 至 SC-005、SC-008）
- [X] T045 按 `specs/002-clean-legacy-copy/quickstart.md` 的结果记录模板复核 `specs/002-clean-legacy-copy/validation/baseline.md`、`copy-audit.md`、`behavior-regression.md`、`windows-copy.md`、`protected-content.md`、`windows-e2e.md` 与 `linux-e2e.md`，把未执行环境、失败证据和剩余风险显式标为 NOT RUN/FAIL，不用推断代替真实验证（FR-022、FR-023、SC-006 至 SC-008）

---

## Phase 7: User Story 2 Amendment - 开发者运行文本英文化（Priority: P2）

**Goal**: 启动器自编的生产日志模板、启动横幅、异常摘要和开发诊断固定文本全部使用可搜索的 ASCII 英文；用户界面继续中文，动态原始值和脱敏边界保持。

**Independent Test**: AST 提取全部活动生产日志固定片段并验证 ASCII/禁词合同，再用 logger 单元测试证明四个级别前缀、动态 Unicode 和既有脱敏不变。

### Tests for User Story 2 Amendment

- [X] T046 [US2] 在 `specs/002-clean-legacy-copy/validation/developer-text.md` 登记乱码基线、开发者文本 surface、静态/动态边界和不执行全量验证的用户决定（FR-014、FR-024、FR-025、SC-009、SC-010）
- [X] T047 [US2] 新增 `src/ui/__tests__/developer-copy.test.js`，先以 AST 提取活动生产 logger/启动横幅固定片段，添加 ASCII、葡语/中文/Oasis/旧品牌/装饰 Unicode 为零及动态值不清洗的失败断言（FR-014、FR-024、SC-009）
- [X] T048 [US2] 扩展 `src/utils/__tests__/logger.test.js`，先为 `[DEBUG|INFO|WARN|ERROR] [Launcher]` ASCII 前缀和中文动态值保持添加失败断言，并继续锁定 URL/认证材料脱敏及安全字段 allowlist（FR-014、FR-025、SC-010）

### Implementation for User Story 2 Amendment

- [X] T049 [US2] 在 `src/utils/logger.js` 中把 emoji 前缀改为 ASCII 级别前缀，只改 `formatMessage()` 的固定输出并保持 transport、level、轮转、脱敏、allowlist 和导出 API（FR-014、FR-025、SC-009）
- [X] T050 [US2] 将 `src/` 活动生产 JavaScript 内 logger 调用和 `src/main.js` 启动横幅的固定片段统一为稳定 ASCII 英文，删除葡语、中文固定模板、旧品牌、emoji、箭头、框线和长破折号；保持动态表达式、调用数量/级别/参数结构及全部控制流（FR-014、FR-024、FR-025、SC-009、SC-010）
- [X] T051 [US2] 将 `src/ui/manager/IpcRouter.js`、`src/utils/diagnostics.js` 等生产路径中启动器自编的开发者异常摘要统一为 ASCII 英文，保持用户 toast/dialog/README 中文以及原始外部错误、协议字段、结构化返回与脱敏不变（FR-014、FR-016、FR-024、FR-025、SC-009）

### Verification for User Story 2 Amendment

- [X] T052 [US2] 仅运行 `src/ui/__tests__/developer-copy.test.js`、`src/utils/__tests__/logger.test.js`、相关改动文件 lint、`git diff --check` 与锁文件哈希/日志调用结构审计，并把结果写入 `specs/002-clean-legacy-copy/validation/developer-text.md`；按用户决定不重复全量 Jest、构建或滞后 E2E（FR-014、FR-020、FR-024、FR-025、SC-009、SC-010）
- [X] T053 [US1] 将审计发现的 `src/config/optimization.js` UI 预设名称/说明中文化，并在 `src/ui/__tests__/copy-boundary.test.js` 登记该 surface 和葡语负向断言，保持 preset code、性能参数、icon、颜色和 IPC 行为（FR-001、FR-006、FR-008、FR-010、SC-001、SC-003）

**Checkpoint**: 新生成的开发者固定文本可在常见 Windows 终端中检索，用户中文界面、动态原始值与核心行为边界不变。

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1（Setup）**: 无依赖，可立即开始。
- **Phase 2（Foundational）**: 依赖 Phase 1，且阻塞全部用户故事。
- **Phase 3（US1）**: 依赖 Phase 2；是最小可交付 MVP。
- **Phase 4（US2）**: 依赖 Phase 2；逻辑上可独立验证，但在同一 worktree 中与 US1 共用 `copy-boundary.test.js` 和 `IpcRouter`，建议按 US1 → US2 合并以避免文件冲突。
- **Phase 5（US3）**: 依赖 Phase 2；行为测试可与文案实现并行，但同一 worktree 中的 `Launcher.test.js` 应在 T008 后再执行 T031。
- **Phase 6（Polish）**: 依赖计划交付的所有用户故事和人工验证任务完成或明确标记 NOT RUN。
- **Phase 7（US2 Amendment）**: 依赖原 US2 文案/诊断分层；T047-T048 必须先观察预期失败，T049-T051 顺序实施，T052 只执行日志相关定向门禁。

### User Story Dependency Graph

```text
Phase 1 Setup
      │
      ▼
Phase 2 Foundational
   ┌──┴─────────────┐
   ▼                ▼
US1 (P1, MVP)   US3 behavior tests
   │                │
   ▼                │
US2 (P2) ◄──────────┘  （同一 worktree 推荐顺序；逻辑验收彼此独立）
   └────────┬───────┘
            ▼
       Phase 6 Polish
```

### Within Each User Story

- 先写契约/回归测试并确认它们因当前缺口失败，再修改生产文件。
- `src/config/i18n.js` 的事实源先于 `src/config/settings.js`、`src/main.js` 和 `src/ui/manager/IpcRouter.js` 接入。
- launcher-owned 文案修改完成后再填写最终处置与证据，不提前把 pending 项标为 verified。
- 自动回归先于真实双 Profile、官方网页、Flash 和 Linux VM 人工门禁。
- 任一官方页面写入、敏感数据新读取、跨 Profile 污染、无限恢复、核心不变模块 diff 或锁文件变化均阻塞后续交付。

### Parallel Opportunities

- T002 与 T003 可在 T001 执行期间并行准备。
- T005-T010 分属不同测试文件，可在 T004 完成后并行编写。
- T013、T015、T017-T020 修改不同产品面，可在 T011/T012 的依赖满足后并行；T014/T016 需等待 i18n 事实源。
- T023-T025 可并行编写；T026 与 T027 修改不同模块，可并行实施。
- T031-T034 分属四个核心回归测试文件，可并行加强。
- T041 与 T042 可并行执行；T043-T045 必须基于所有最终变更与证据。
- T047 与 T048 修改不同测试文件但共同依赖 T046 的边界；T049-T051 涉及相同生产日志调用，按顺序执行以避免冲突。

---

## Parallel Examples

### User Story 1

```text
并行测试：T005 settings migration | T007 manager UI | T008 Launcher loading | T009 IpcRouter | T010 profile store
并行实现：T013 setup | T015 manager HTML/app/title | T017 profile names | T018 inline loading | T019 dormant loading | T020 Linux/desktop
```

### User Story 2

```text
并行测试：T023 diagnostics ZIP boundary | T024 allowlist/protected exclusions | T025 diagnostics dialog summary
并行实现：T026 generated diagnostics copy | T027 IpcRouter diagnostics copy
日志修订：T046 baseline → T047/T048 red tests → T049 prefix → T050 templates → T051 summaries → T052 targeted gates
```

### User Story 3

```text
并行测试：T031 Launcher wiring | T032 Tencent flow | T033 Session lifecycle | T034 Profile partition
串行实测：T035 automatic regression → T036 builds → T037/T038 Windows E2E and T039 Linux VM
```

---

## Implementation Strategy

### MVP First（仅 User Story 1）

1. 完成 Phase 1 的基线与审计台账。
2. 完成 Phase 2 的范围感知扫描框架。
3. 先完成 T005-T010 并观察预期失败。
4. 实施 T011-T020。
5. 完成 T021-T022，确认中文默认、遗留迁移和全部 launcher-owned 可见面。
6. 停止并独立评审 US1；此时已形成可演示的中文默认 MVP。

### Incremental Delivery

1. **US1**: 中文默认和零未授权葡语/Oasis 可见文案。
2. **US2**: 技术词理由、诊断分层和受保护内容完整性证明。
3. **US3**: 自动核心回归、构建及双 Profile/Flash/恢复真实 E2E。
4. **Polish**: 全量质量门禁、diff/hash 门禁和 100% 可追溯审计。
5. **US2 Amendment**: 开发者运行固定文本 ASCII 英文化；按用户决定只运行日志相关定向门禁。

### Scope Guardrails

- 不修改腾讯官方网页内容，不新增页面翻译、DOM 写入或认证数据读取。
- 行为所有者只允许修改 developer text contract 登记的固定字面量；logger 调用结构和非日志逻辑不得改变。
- 不升级 Node.js、npm、Electron、PPAPI 或核心依赖，不改写 `package-lock.json`。
- 不对整个仓库执行葡语/Oasis 全局替换或非 ASCII 清洗。
- 不删除日志、协议、第三方资产、历史/测试证据或必要 Unicode。
- 不把人工 E2E 的 NOT RUN 记录成 PASS，也不保存 QQ 密码、Cookie/Storage、认证参数或页面原文作为证据。

## Notes

- `[P]` 只表示文件与依赖允许并行；在单一 worktree 中仍需避免同时编辑同一文件。
- 每个故事的测试任务均位于对应生产实现之前，符合 Constitution VII。
- 每完成一个任务或逻辑组即可提交；提交前执行与变更风险相称的最小测试。
- 若实现暴露新的需求缺口，先更新 `specs/002-clean-legacy-copy/spec.md`，再同步 `plan.md` 与本文件。
