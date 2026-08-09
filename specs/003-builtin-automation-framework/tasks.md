# Tasks：内置自动化脚本框架

**Input**: `specs/003-builtin-automation-framework/` 下的 `spec.md`、`plan.md`、
`research.md`、`data-model.md`、`contracts/` 与 `quickstart.md`

**Tests**: 本 Feature 的规格、计划和 Constitution 明确要求测试与验收先行。每个故事的自动化
测试任务必须先编写并确认在缺少对应实现时失败，再执行实现任务。

**Organization**: 任务按用户故事组织；每项均引用其实现或验证的 FR、SC 或验收场景，并给出
明确文件路径。

## Format：`[ID] [P?] [Story] Description`

- **[P]**：修改不同文件，且在所列前置任务完成后可并行执行
- **[US1] / [US2] / [US3]**：对应规格中的用户故事
- Setup、Foundational 和 Polish 任务不使用故事标签

---

## Phase 1：Setup（共享工程准备）

**Purpose**: 建立不改变运行时版本和依赖的脚本打包与测试基础。

- [X] T001 在 `package.json` 的 electron-builder `files` 中加入完整 `automation-scripts/**` 只读资源，并确认不新增依赖、不修改 `package-lock.json`（FR-007、FR-013、FR-029，SC-001、SC-008）
- [X] T002 [P] 在 `tests/helpers/automation-fixtures.js` 建立可创建临时脚本包、临时 `userData` 和可控时钟的共享测试助手，确保测试结束清理临时文件（FR-005、FR-014、FR-024、FR-028）

**Checkpoint**: 打包入口和测试隔离设施就绪，核心域可以开始失败优先测试。

---

## Phase 2：Foundational（阻塞所有用户故事）

**Purpose**: 建立所有故事共用的错误、取消、数据隔离、Profile 占用和安全日志边界。

**⚠️ CRITICAL**: 本阶段完成前不得开始用户故事实现。

### 先行测试

- [X] T003 [P] 在 `src/automation/__tests__/errors.test.js` 编写稳定 kebab-case 错误码、安全消息和原始异常不外泄测试（FR-022、FR-023，SC-006）
- [X] T004 [P] 在 `src/automation/__tests__/cancellation.test.js` 编写 Node 12 兼容 signal、首次原因获胜、once listener 和重复取消测试（FR-019、FR-020、FR-029，SC-006）
- [X] T005 [P] 在 `src/automation/__tests__/store.test.js` 编写缺失文件默认值、envelope 身份/schema/大小/坐标校验、原子替换失败保留旧文件测试（FR-013～FR-015、FR-022，SC-007）
- [X] T006 [P] 在 `src/automation/__tests__/coordinator.test.js` 编写 Profile lease 所有权、同 lease 动作 FIFO、旧 token 不得释放新 lease的基础测试（FR-021、FR-025，SC-005）
- [X] T007 [P] 在 `src/utils/__tests__/logger.test.js` 增加自动化字段 allowlist、绑定字段不可覆盖、Buffer/循环对象/截图/认证数据安全降级和 logger 失败不中断测试（FR-011、FR-023、FR-024）

### 基础实现

- [X] T008 [P] 在 T003 失败后实现 `src/automation/errors.js` 的注册/运行错误目录、安全摘要和错误转换（FR-006、FR-022、FR-023）
- [X] T009 [P] 在 T004 失败后实现 `src/automation/cancellation.js` 的最小 AbortSignal-compatible controller，禁止脚本获得 controller（FR-008、FR-019、FR-020、FR-029）
- [X] T010 在 T005 与 T008 失败后实现 `src/automation/store.js` 的 `Profile + scriptId` 路径、配置/坐标 envelope、大小上限、深冻结副本和同目录临时文件加 rename（FR-013～FR-015、FR-022，SC-007）
- [X] T011 在 T006 与 T008 失败后实现 `src/automation/coordinator.js` 的 Profile lease、opaque token、FIFO action tail 和所有权校验（FR-021、FR-025，SC-005）
- [X] T012 [P] 在 T007 失败后扩展 `src/utils/logger.js`，只允许 `runId`、`scriptId`、`status`、`action`、`durationMs` 等安全字段并自动绑定运行上下文（FR-023、FR-024）

**Checkpoint**: 共用数据和运行边界通过测试，三个用户故事可以在这些稳定接口之上推进。

---

## Phase 3：User Story 1 - 对指定 Profile 运行内置脚本（Priority: P1）🎯 MVP

**Goal**: 用户可查看有效内置脚本、为已打开且客观资源有效的 Profile 录制坐标并运行
`demo-click`；脚本通过受限 API 顺序后台点击，窗口不抢焦点且系统鼠标不移动。

**Independent Test**: 在开发环境和 Windows 安装包中发现同一 `demo-click`，为指定 Profile
记录两个点后运行；Chromium 与 PPAPI/AS3 靶场的点击计数和顺序正确，前台窗口和系统鼠标
位置不变，运行终态为 `succeeded`。

### 先行测试与回归靶场

- [X] T013 [P] [US1] 在 `src/automation/__tests__/registry.test.js` 编写固定根目录、确定性扫描、合法 manifest、CommonJS 直接导出和安全 catalog DTO 的 happy-path 测试（FR-001～FR-005、FR-007、FR-012，SC-001）
- [X] T014 [P] [US1] 在 `src/app/__tests__/Launcher.test.js` 增加按真实 `profileId` 返回窄化游戏目标、以只读诊断字段暴露 `GAME_READY` 且不泄露 Session/registry 的测试（FR-010、FR-011、FR-024、FR-029）
- [X] T015 [P] [US1] 在 `src/automation/__tests__/api.test.js` 编写截图、窗口安全 DTO、坐标读取、执行时尺寸映射、CDP move/press/release、owned detach、无 focus/OS 鼠标调用测试（FR-009～FR-011、FR-024～FR-026，SC-003、SC-004）
- [X] T016 [P] [US1] 在 `src/automation/__tests__/runner.test.js` 编写合法脚本成功运行、唯一 runId/时间、冻结配置和仅含五项 API 的最小 context 测试（FR-008、FR-009、FR-017、FR-018、FR-022，US1 验收场景 1）
- [X] T017 [P] [US1] 在 `src/automation/__tests__/recording.test.js` 编写目标窗口有效时的截图、capture 与 `Profile + scriptId + sender` 绑定、图片坐标归一化、五分钟过期和内存清理测试（FR-014、FR-024、FR-025）
- [X] T018 [P] [US1] 在 `src/ui/manager/__tests__/IpcRouter.test.js` 先加入 `automation:list/start/coordinates:get/recording:begin/recording:add-point/coordinates:clear` 的 sender、参数、DTO 与失败 envelope 契约测试（FR-016、FR-022、FR-024，US1 验收场景 1、3）
- [X] T019 [P] [US1] 在 `src/ui/manager/__tests__/StateBroadcaster.test.js` 先加入 catalog、初始 `idle`、启动后 `running` 的字段白名单和 `manager:ready` 全量恢复测试（FR-016～FR-018、FR-023）
- [X] T020 [P] [US1] 在 `src/ui/__tests__/automation-panel.test.js` 编写 Profile 卡片自动化入口、脚本列表、目标窗口不可用时禁用录点/启动、诊断性 `gameReady=false` 不禁用、录点画布和启动交互测试（FR-016、FR-024、US1 验收场景 1、3）
- [X] T021 [P] [US1] 在 `src/automation/__tests__/demo-click.test.js` 编写坐标为空明确失败、按 order 点击、相邻点约 1000ms `wait`、只使用 context API 的示例脚本测试（FR-009～FR-011、FR-027，SC-003）
- [X] T022 [P] [US1] 从 `demo/builtin-auto` 仅提取已验证行为，在 `tests/runtime/cdp-background-smoke.js` 先建立必须经正式 registry/runner/API 执行的隐藏 Chromium 双点回归，记录 focus 和系统鼠标前后值并只使用临时证据目录（FR-026～FR-028，SC-003、SC-004）
- [X] T023 [P] [US1] 从 `demo/builtin-auto` 选择性迁移 `tests/fixtures/flash/CdpClickTarget.as`、`tests/fixtures/flash/CdpClickTarget.swf`、`tests/fixtures/flash/build.ps1`，并在 `tests/runtime/cdp-ppapi-background-smoke.js` 建立 Windows x64 正式 API 的 PPAPI/AS3 双目标回归；不得迁移 FlashProbe/PreloadSwf/TCP/mm.cfg 路线（FR-027～FR-029，SC-003、SC-004、SC-009）

### 实现

- [X] T024 [P] [US1] 在 T013 失败后实现 `src/automation/registry.js` 的 `app.getAppPath()/automation-scripts` 扫描、合法 manifest 加载、CommonJS 函数缓存和冻结安全 catalog（FR-001～FR-005、FR-007、FR-012，SC-001）
- [X] T025 [P] [US1] 在 T014 失败后扩展 `src/app/Launcher.js`，只向自动化域提供按 Profile 获取窗口目标、内容尺寸和诊断性 `TencentLaunchFlow.GAME_READY` 的窄适配（FR-010、FR-011、FR-024、FR-029）
- [X] T026 [US1] 在 T015 与 T025 失败后实现 `src/automation/backend.js` 的截图、窗口状态、运行时坐标映射和每次点击短连接 CDP `1.3` 生命周期（FR-009～FR-011、FR-024～FR-026，SC-003、SC-004）
- [X] T027 [US1] 在 T010、T011、T015 与 T026 失败后实现 `src/automation/api.js`，为当前 run 构造深冻结的 `capture/getWindowState/getCoordinates/click/wait`，并在每个动作前执行 token、signal、Profile、窗口/webContents、所需内容尺寸和输入 preflight；页面阶段不作通用门槛（FR-008～FR-011、FR-019、FR-025）
- [X] T028 [P] [US1] 在 T017 与 T026 失败后实现 `src/automation/recording.js` 的短期 capture record、PNG data URL、录点映射、替换/过期/窗口关闭清理和目标组合坐标写入（FR-014、FR-024、FR-025）
- [X] T029 [US1] 在 T009、T011、T016、T024 与 T027 失败后实现 `src/automation/runner.js` 的启动校验、run context、配置快照、入口 Promise 边界、`idle/running/succeeded/failed` 基础状态和终态保留（FR-008、FR-016～FR-018、FR-022，US1 验收场景 1）
- [X] T030 [P] [US1] 在 T021 失败后创建 `automation-scripts/demo-click/manifest.json` 与 `automation-scripts/demo-click/index.js`，按已记录顺序点击并通过受限 `wait` 保持相邻点击约 1000ms（FR-001～FR-004、FR-027，SC-003）
- [X] T031 [US1] 在 T018、T024、T028 与 T029 失败后扩展 `src/ui/manager/IpcRouter.js`，实现脚本查询、启动、坐标查询/录制/清除命令并验证 ManagerWindow sender 和所有主进程参数（FR-016、FR-022、FR-024）
- [X] T032 [P] [US1] 在 T019 与 T029 失败后扩展 `src/ui/manager/StateBroadcaster.js`，在 `pushAll` 和增量事件中发送严格白名单 catalog/status DTO（FR-016～FR-018、FR-023）
- [X] T033 [US1] 在 `src/main.js` 与 `src/automation/index.js` 装配 registry、store、coordinator、backend、recording、runner，并保证 Profile Store 加载后、IPC/窗口使用前完成扫描（FR-005、FR-007、FR-016，SC-001）
- [X] T034 [US1] 在 T020、T031 与 T032 失败后修改 `src/ui/index.html`、`src/ui/styles.css`、`src/ui/app.js`，实现 Profile 自动化面板、脚本列表、短期截图录点和启动交互，不渲染入口路径或拒绝项原始内容（FR-016、FR-023、FR-024）

### US1 独立验证

- [X] T035 [US1] 运行并修复 `src/automation/__tests__/registry.test.js`、`src/automation/__tests__/api.test.js`、`src/automation/__tests__/runner.test.js`、`src/automation/__tests__/recording.test.js`、`src/automation/__tests__/demo-click.test.js` 及受影响共置测试，证明 US1 单元/契约闭环（FR-027、FR-028，SC-001、SC-003）
- [X] T036 [US1] 在 Windows x64 使用 `tests/runtime/cdp-background-smoke.js` 与 `tests/runtime/cdp-ppapi-background-smoke.js` 执行连续双点回归，验证 click count/order、焦点不变、前台窗口不变和系统鼠标位移为 0（FR-026～FR-028，SC-003、SC-004、SC-009）
- [X] T037 [US1] 通过 `package.json` 的 `npm run build:win` 生成安装产物，实际启动并核对 `automation-scripts/demo-click/manifest.json` 和入口无需 Python、系统 Node.js 或外部工具即可发现和成功运行；代码及打包输入未变化时 MAY 按 Notes 复用同一次 Windows 构建产物和已有证据，但本任务只判定 US1 的 Windows 发现与运行断言；构建产物不得提交仓库（FR-007、FR-013、FR-027、FR-029，SC-001、SC-008）

**Checkpoint**: US1 是可独立演示的 MVP；有效脚本可以在开发和 Windows 安装环境完成真实后台点击。

---

## Phase 4：User Story 2 - 控制运行并获得明确结果（Priority: P2）

**Goal**: 用户可查看并停止运行；取消、超时、窗口关闭、Profile 不存在和 CDP 异常产生稳定
终态；同 Profile 不交错，不同 Profile 独立并行。

**Independent Test**: 使用可控脚本分别触发成功、停止、超时、窗口关闭、Profile 不存在和
CDP 异常；检查状态、错误码、停止时延与两个 Profile 的隔离并行行为。

### 先行测试

- [X] T038 [P] [US2] 扩展 `src/automation/__tests__/runner.test.js`，先覆盖会向 event loop 交还控制权的正常异步脚本和 `wait()` 的 `running→stopping→cancelled`、`failed/run-timeout`，以及重复 stop、stale runId、窗口关闭、脚本 throw/reject 和首个终止原因获胜；同步死循环或长时间同步阻塞不作为硬终止用例（FR-017～FR-020、FR-022，SC-006）
- [X] T039 [P] [US2] 扩展 `src/automation/__tests__/coordinator.test.js`，先覆盖同 Profile busy 无 backlog、并发 API FIFO 无交错、不同 Profile 同时 running/独立终态、旧 run 不能释放新 lease（FR-021、FR-022，SC-005）
- [X] T040 [P] [US2] 扩展 `src/automation/__tests__/api.test.js`，先覆盖取消后未开始动作 fenced、原子 click 完成 release 后取消、窗口关闭、DevTools 占用、attach/detach/dispatch/action timeout 的稳定错误（FR-019～FR-022、FR-025、FR-026，SC-006）
- [X] T041 [P] [US2] 扩展 `src/ui/manager/__tests__/IpcRouter.test.js` 与 `src/ui/manager/__tests__/StateBroadcaster.test.js`，先覆盖 `automation:status/stop`、重复停止、stale runId、状态字段白名单和跨 Profile 事件隔离（FR-016～FR-023，SC-005、SC-006）
- [X] T042 [P] [US2] 扩展 `src/ui/__tests__/automation-panel.test.js`，先覆盖 Stop、`stopping` 一秒内可见、终态保留、renderer 重载恢复和各稳定错误码的固定中文恢复提示（FR-016～FR-020、FR-022，SC-006）

### 实现

- [X] T043 [P] [US2] 在 T039 失败后完善 `src/automation/coordinator.js`，忙碌立即返回 `profile-busy`、stop 绕过 acquire、每 Profile 独立 action tail，并以 token fencing 防止陈旧释放（FR-021、FR-022，SC-005）
- [X] T044 [US2] 在 T038、T039 与 T043 失败后完善 `src/automation/runner.js`，为会向 event loop 交还控制权的正常异步脚本、Automation API 操作和 `wait()` 加入五分钟 deadline、协作式用户 stop、幂等停止、`stopping/cancelled`、timeout 失败、首因终态和迟到 settlement 防护；不承诺硬终止同步死循环或长时间同步阻塞（FR-017～FR-022，SC-005、SC-006）
- [X] T045 [P] [US2] 在 T040 失败后完善 `src/automation/backend.js` 与 `src/app/Launcher.js`，转换窗口关闭和 CDP 占用/附加/意外断开/派发/超时错误，并保证只清理本次 owned debugger（FR-022、FR-025、FR-026，SC-006）
- [X] T046 [US2] 在 T041、T044 与 T045 失败后完善 `src/ui/manager/IpcRouter.js` 和 `src/ui/manager/StateBroadcaster.js`，实现状态查询、runId 精确停止、全量/增量状态广播及跨 Profile 白名单隔离（FR-016～FR-023，SC-005、SC-006）
- [X] T047 [US2] 在 T042 与 T046 失败后完善 `src/ui/app.js`，渲染 Stop、`stopping` 和全部终态，按错误码显示可操作恢复文本且查询不清除终态（FR-016、FR-017、FR-019、FR-022）
- [X] T048 [US2] 在 `src/main.js` 增加窗口关闭、Profile 失效和 `app-quit` 的有限取消/录点清理装配，确保一个 Profile 的清理不触碰其他 Profile Session、窗口或运行（FR-019、FR-021、FR-022、FR-024，SC-005、SC-006）

### US2 独立验证

- [X] T049 [US2] 运行并修复 `src/automation/__tests__/runner.test.js`、`src/automation/__tests__/coordinator.test.js`、`src/automation/__tests__/api.test.js`、`src/ui/manager/__tests__/IpcRouter.test.js`、`src/ui/manager/__tests__/StateBroadcaster.test.js`，使用两个 Profile 验证最大同 Profile 并发为 1、动作交错为 0、停止 1 秒内可见、可取消 `wait()` 在 5 秒内终止，以及正常异步脚本/API 操作超过 deadline 后进入 `failed/run-timeout`；不验证同步阻塞的硬终止（FR-017～FR-022，SC-005、SC-006）

**Checkpoint**: US2 可独立触发并区分所有规定终态，停止/失败一个 Profile 不影响另一个 Profile。

---

## Phase 5：User Story 3 - 独立维护并随启动器发布脚本（Priority: P3）

**Goal**: 维护者可以按 v1 合同新增可信脚本；启动扫描严格拒绝坏包和冲突包，用户数据在
Profile、脚本和安装更新之间保持隔离。

**Independent Test**: 同一次扫描放入有效包以及 manifest 非法、入口缺失、ID 冲突和 API
版本不兼容包；全部坏包以不同 code 拒绝，有效包仍可运行。两个 Profile × 两个脚本的四组
数据在重启和覆盖安装后不变。

### 先行测试

- [X] T050 [P] [US3] 扩展 `src/automation/__tests__/registry.test.js`，先覆盖根目录缺失或不可读时启动继续、catalog 为空并返回稳定 `scripts-root-unavailable` 注册诊断，根目录为空时启动继续且 catalog 为空，以及 manifest 大小/JSON/字段/schema、绝对/遍历/符号链接逃逸、入口缺失/加载失败/导出错误、NFKC+lowercase ID 冲突组全拒绝、API 不兼容和有效包不受坏包及启动器不受单包异常影响（FR-002～FR-007，SC-001、SC-002）
- [X] T051 [P] [US3] 扩展 `src/automation/__tests__/store.test.js`，先完成两个 Profile × 两个 scriptId 的四组配置/坐标、重启读取、安装资源替换、损坏/不兼容数据、定向 clear 和原子写失败隔离测试（FR-013～FR-015、FR-022，SC-007）
- [X] T052 [P] [US3] 在 `src/automation/__tests__/script-boundary.test.js` 建立内置脚本包审计，拒绝 `electron`、launcher `src/`、Profile、debugger/CDP、网络/进程执行和绝对路径导入，并确认不把该审计描述为恶意代码沙箱（FR-002、FR-011、FR-012、FR-029）
- [X] T053 [P] [US3] 在 `src/automation/__tests__/package-discovery.test.js` 建立开发根与打包 ASAR 文件清单对照测试，确认 manifest、入口、相对模块和 assets 版本一致、遗漏为 0（FR-003、FR-007、FR-013，SC-001、SC-008）

### 实现与维护合同

- [X] T054 [US3] 在 T050 失败后完善 `src/automation/registry.js` 的根目录缺失/不可读空 catalog 与 `scripts-root-unavailable` 诊断、空根目录正常返回、限量读取、完整 manifest v1 校验、lexical/realpath containment、两阶段 canonical ID 分组、所有注册错误码和单包失败隔离，确保扫描异常不阻止启动器继续运行（FR-002～FR-006，SC-002）
- [X] T055 [P] [US3] 在 T051 失败后完善 `src/automation/store.js` 的四维隔离验证、损坏数据显式错误、定向清除与更新不覆盖行为；不得在 Profile 删除时递归删除自动化数据（FR-013～FR-015、FR-022，SC-007）
- [X] T056 [P] [US3] 创建 `automation-scripts/README.md`，说明 manifest v1、直接 CommonJS 导出、可选 assets、TypeScript 预编译、最小 context、禁止导入边界、协作式取消和同步死循环残余风险（FR-001～FR-004、FR-008～FR-012、FR-029）
- [X] T057 [US3] 在 `src/main.js` 与 `src/utils/logger.js` 接入注册摘要和逐包安全错误码日志，仅记录 package 显示名/scriptId/code，不记录绝对路径、manifest 原文或入口异常 stack（FR-006、FR-023，SC-002）

### US3 独立验证

- [X] T058 [US3] 运行 `src/automation/__tests__/registry.test.js`、`src/automation/__tests__/store.test.js`、`src/automation/__tests__/script-boundary.test.js`、`src/automation/__tests__/package-discovery.test.js`，再通过 `package.json` 的 `npm run build:win` 审计 Windows x64 ASAR 发现以及四组用户数据升级保留；第一版只维护 Windows，不要求 WSL 或 Linux AppImage。代码及打包输入未变化时 MAY 按 Notes 复用同一次构建产物和已有证据，但本任务只判定 US3 的注册合同、包内资源及数据隔离断言；不得提交构建产物（FR-007、FR-013～FR-015、FR-029，SC-001、SC-002、SC-007、SC-008）

**Checkpoint**: 三个用户故事均可独立验收；新增可信脚本无需复制窗口、坐标或 CDP 逻辑。

---

## Phase 6：Polish & Cross-Cutting Concerns

**Purpose**: 完成跨故事文档、全量回归、安装验证与腾讯真实游戏人工证据。

- [X] T059 [P] 更新 `docs/REPO_MAP.md` 并创建 `docs/BUILTIN_AUTOMATION.md`，记录正式模块边界、脚本作者流程、数据位置、稳定状态/错误、测试命令和不得恢复的 Demo/FlashProbe 临时路线（FR-010～FR-012、FR-023、FR-027～FR-029）
- [X] T060 运行 `package.json` 中的 `npm test -- --runInBand` 与 `npm run lint`，修复所有新旧回归并确认 `package-lock.json` 未变化（FR-028、FR-029，SC-009）
- [X] T061 在 Windows x64 重新执行 `tests/runtime/cdp-background-smoke.js` 与 `tests/runtime/cdp-ppapi-background-smoke.js`，确认普通 Chromium、Pepper Flash/AS3、高 DPI、尺寸变化、连续双点、焦点和系统鼠标全部通过并清理临时证据（FR-024～FR-028，SC-003、SC-004、SC-009）
- [X] T062 使用 `package.json` 的 `npm run build:win` 完成开发/Windows ASAR 资源一致性审计；在无 Python、系统 Node.js 和外部自动化工具的 Windows x64 环境运行 portable 包，任何预期内置脚本遗漏均使发布验收失败。代码及打包输入未变化时 MAY 按 Notes 复用同一次构建产物和已有证据，但本任务只判定 Windows 发布断言；构建产物不提交仓库（FR-007、FR-013、FR-029，SC-001、SC-008）
- [X] T064 复核 `src/app/__tests__/Launcher.test.js`、`src/app/__tests__/TencentLaunchFlow.test.js`、`src/ui/manager/__tests__/IpcRouter.test.js`、`src/utils/__tests__/logger.test.js` 与 `package-lock.json`，确认 Profile Session/Partition、腾讯官方扫码流程、运行时版本和敏感数据边界无回退（FR-011、FR-022、FR-023、FR-029）

---

## Phase 7：通用能力门槛修订

**Purpose**: 修复真实游戏窗口已运行但诊断性 `gameReady=false` 导致录点和脚本启动被全局禁用的
回归；保留客观资源校验和诊断字段，不修补或扩大页面探针，也不引入视觉识别实现。

- [X] T065 [P] 在 `src/automation/__tests__/api.test.js`、`src/automation/__tests__/runner.test.js`、`src/automation/__tests__/recording.test.js` 与 `src/ui/__tests__/automation-panel.test.js` 增加 `available=true + gameReady=false` 时截图、录点、启动和点击可用的失败先行回归，同时保留窗口/webContents 缺失、销毁或内容尺寸无效时拒绝的断言，并确认当前缺少实现时测试失败（FR-009、FR-010、FR-016、FR-024、FR-025，US1 验收场景 1）
- [X] T066 同步 `.specify/memory/constitution.md`、Spec Kit 模板、本 Feature 的 `spec.md`、`plan.md`、`research.md`、数据模型、契约、quickstart、维护文档和本任务清单，明确客观资源与页面/脚本策略的边界；不得扩大视觉识别范围（FR-009、FR-010、FR-016、FR-024）
- [X] T067 在 T065 失败后最小修改 `src/automation/backend.js`、`src/automation/runner.js` 及必要组合代码，移除通用 capture/click/start/recording 的 `GAME_READY` hard gate，继续逐动作校验 Profile、窗口/webContents、内容尺寸、输入、lease、取消和 deadline（FR-009、FR-010、FR-021、FR-024、FR-025）
- [X] T068 在 T065 失败后最小修改 `src/ui/app.js` 及必要 Manager 契约实现，使目标窗口可用时启动和截图录点按钮可操作，`gameReady` 只作诊断；目标不可用及运行占用等既有禁用条件保持不变（FR-016、FR-022、FR-024）
- [X] T069 运行 Phase 7 定向测试、全部受影响共置测试、`npm test -- --runInBand` 与 `npm run lint`，确认 `package-lock.json` 未变化，并把失败先行与修复后结果记录到验证文档（FR-028、FR-029，SC-009）
- [X] T070 在 Windows x64 重新执行 Chromium 与 Pepper Flash/AS3 正式链路 smoke，重建 Windows portable、核对 ASAR 内置脚本资源并执行 packaged automation smoke；不得停止或干扰用户当前运行的真实游戏进程，若产物被占用则由用户关闭后再构建（FR-007、FR-024～FR-029，SC-001、SC-003、SC-004、SC-008、SC-009）

**Checkpoint**: `gameReady=false` 不再禁用通用自动化，客观资源错误仍被主进程拒绝，Windows
Chromium、PPAPI、包内资源和 portable 自动 smoke 全部通过后，才可进入腾讯真实游戏人工回归。

---

## Phase 8：腾讯真实游戏人工回归

- [ ] T063 在 T065～T070 全部完成后，由用户在 Windows x64 按 `specs/003-builtin-automation-framework/quickstart.md` 执行腾讯真实游戏最小人工回归，并反馈版本、非敏感 Profile ID、内容尺寸、双点顺序/间隔、焦点和鼠标结论；不得由实现者自行声称通过，也不得保存原始截图、URL query、Cookie、票据或验证码（FR-023、FR-024、FR-026～FR-029，SC-009）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**：无前置条件；T001 与 T002 可并行。
- **Phase 2 Foundational**：依赖 Phase 1；阻塞全部用户故事。先执行 T003～T007 的失败测试，
  再执行 T008～T012。
- **US1（Phase 3）**：依赖 Foundational；提供可运行 MVP。
- **US2（Phase 4）**：依赖 US1 的 runner/API/IPC 接口；它用自己的可控脚本和双 Profile
  场景独立验收，不依赖腾讯真实游戏。
- **US3（Phase 5）**：测试设计可在 Foundational 后与 US1/US2 并行；T054 的 registry
  hardening 依赖 T024 的 happy-path registry，T058 在 US1 打包入口完成后执行。
- **Polish（Phase 6）**：依赖计划交付的全部用户故事。
- **能力门槛修订（Phase 7）**：依赖 Phase 6 已有自动化基线；先完成 T065 失败测试与 T066
  制品同步，再执行 T067/T068，最后执行 T069/T070 完整 Windows 验证。
- **腾讯人工回归（Phase 8）**：T063 依赖 T065～T070 全部完成，且只能由用户执行并反馈。

### User Story Dependency Graph

```text
Setup
  └─ Foundational
       ├─ US1（MVP：发现、录点、运行、后台点击）
       │    ├─ US2（状态、停止、超时、并发与故障）
       │    └─ US3 registry hardening / package verification
       └─ US3 tests、store isolation、authoring contract（可先行）

US1 + US2 + US3
  └─ Polish
       └─ Capability gate correction
            └─ Tencent real-game manual regression (T063)
```

### Within Each Story

1. 先创建测试/靶场并确认缺少实现时失败。
2. 数据和模型边界先于服务；服务先于 IPC/renderer。
3. 主进程校验先于 UI，UI 不能成为安全边界。
4. 单元/契约测试通过后才运行 Chromium、PPAPI 和安装包验证。
5. 腾讯真实游戏人工回归最后执行，且不能替代自动测试。

---

## Parallel Opportunities

### Shared Foundation

- T003、T004、T005、T006、T007 修改不同测试文件，可并行编写。
- 各测试失败后，T008、T009、T012 可并行；T010 依赖 T008，T011 依赖 T008。

### User Story 1

```text
并行测试批次：
T013 registry
T014 Launcher adapter
T015 Automation API/backend
T016 runner happy path
T017 recording
T018 IPC
T019 broadcaster
T020 renderer
T021 demo-click
T022 Chromium runtime harness
T023 PPAPI/AS3 fixture and harness

并行实现批次：
T024 registry + T025 Launcher adapter + T030 demo-click
随后 T026 backend
随后 T027 API + T028 recording
随后 T029 runner + T032 broadcaster
最后 T031 IPC → T033 composition → T034 renderer
```

### User Story 2

```text
并行测试批次：T038 runner、T039 coordinator、T040 backend、T041 IPC/broadcast、T042 renderer
并行实现批次：T043 coordinator 与 T045 backend
随后 T044 runner → T046 IPC/broadcast → T047 renderer；T048 独立完成退出清理装配
```

### User Story 3

```text
并行测试批次：T050 registry invalid matrix、T051 store isolation、T052 script boundary、T053 package discovery
并行实现批次：T054 registry、T055 store、T056 authoring guide
随后 T057 diagnostics → T058 package validation
```

---

## Implementation Strategy

### MVP First（只完成 User Story 1）

1. 完成 T001～T012，锁定共享边界。
2. 完成 T013～T023，确认测试和 runtime harness 在无实现时失败。
3. 完成 T024～T034，形成有效脚本发现、录点、运行和 UI 闭环。
4. 完成 T035～T037，独立验证开发环境、Chromium、PPAPI/AS3 和 Windows 安装包。
5. 在 MVP 检查点停下评审，不提前加入 P2/P3 非必要能力。

### Incremental Delivery

1. **Foundation**：错误、取消、存储、lease、日志。
2. **US1**：可用的 `demo-click` 后台点击 MVP。
3. **US2**：可停止、可超时、可诊断、同 Profile 互斥和跨 Profile 并行。
4. **US3**：严格脚本合同、错误隔离、打包一致性和维护文档。
5. **Release**：全量自动回归、干净环境安装验证、腾讯真实游戏人工回归。

### Scope Guards

- 不整体 cherry-pick `demo/builtin-auto` 的 `7681c33` 或 `a646977`。
- 不迁移 FlashProbe、PreloadSwf、TCP、`mm.cfg`、临时 Demo IPC/UI 或像素差证据流程。
- 不新增依赖，不升级 Node.js、npm、Electron、PPAPI，不无故改写 `package-lock.json`。
- 不加入第三方脚本安装、外部 Bridge、完整沙箱、更多输入类型或视觉识别。
- 若实现暴露新的需求缺口，先更新 `spec.md`、`plan.md` 和 Constitution Check，再继续任务。

---

## Notes

- `[P]` 仅表示在前置任务完成后可修改不同文件并行推进。
- 所有脚本和运行时测试必须经过正式 registry、runner 与 Automation API，不能直接把 Demo
  debugger 调用包装成回归。
- 任何测试产生的截图或临时数据必须位于临时目录并清理；腾讯人工验证不得提交原始游戏截图。
- T037、T058、T062 在代码、依赖、electron-builder 配置、`automation-scripts/**` 和其他打包输入
  均未变化，且 Windows 构建命令、产物校验值和非敏感证据可追溯时，MAY 复用同一次构建产物与
  已有证据；每个任务仍只判定自身列出的用户故事或发布断言，任一输入变化后 MUST 重新构建。
- 每个任务或紧密逻辑组完成后运行对应测试；达到故事 Checkpoint 时再执行该故事完整验证。
