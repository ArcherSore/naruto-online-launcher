# Tasks：内置脚本共享视觉能力

**Input**: `specs/004-script-vision/` 下已人工确认的 `spec.md`、`plan.md`、`research.md`、
`data-model.md`、`contracts/` 与 `quickstart.md`

**Tests**: 本 Feature 明确要求测试先行。每个行为实现任务开始前，必须先完成对应测试任务，
确认新增断言在缺少实现时按预期失败，并保留失败原因；不得用过度 mock 绕过正式
registry、runner、coordinator、backend mapper 或 CDP 集成链。

**Organization**: 任务按共享基础与三个 User Story 的优先级组织；每项均引用对应 FR、SC 或
验收场景并给出明确文件路径。Vision v1 只面向 Windows x64、固定 `1920×1080 + 100%`；
构造 `imageSize != contentSize` 与 DIP sentinel 只防坐标空间混用，不扩展 DPI/多缩放支持。

## Format：`[ID] [P?] [Story] Description`

- **[P]**：在所列前置任务完成后可并行，且不会与其他并行任务修改同一文件
- **[US1] / [US2] / [US3]**：对应规格中的用户故事
- Setup、Foundational、Polish 与人工验收任务不使用故事标签

---

## Phase 1：Setup（共享测试准备）

**Purpose**: 锁定当前 framework 与旧运行时基线，并建立不持久化截图的可复用视觉测试数据。

- [X] T001 核对 `package.json` 中 Volta Node.js `16.20.2`、npm `8.19.4`、Electron `11.5.0` 与 `automation-scripts/**` 打包基线，运行现有 `src/app/__tests__/GameViewport.test.js`、`src/automation/__tests__/api.test.js`、`src/automation/__tests__/recording.test.js`、`src/automation/__tests__/runner.test.js`、`src/automation/__tests__/coordinator.test.js`、`src/automation/__tests__/cancellation.test.js`、`src/automation/__tests__/errors.test.js`、`src/automation/__tests__/service.test.js` 并记录基线；不得修改 `package-lock.json`（FR-025，SC-009）
- [X] T002 在 `src/automation/__tests__/vision-fixtures.js` 建立纯内存 RGBA/PNG、可变 capture 序列、固定 `1920×1080`、ROI/no-match、`imageSize != contentSize`、DIP sentinel 和可控异步边界测试助手，所有临时文件必须位于测试临时目录并清理，禁止持久化真实截图（FR-005、FR-006、FR-011、FR-021、FR-022，SC-001～SC-005）

**Checkpoint**: 基线与测试夹具就绪；后续新增测试可稳定复现同一视觉输入和生命周期顺序。

---

## Phase 2：Foundational（阻塞所有 User Story）

**Purpose**: 先测试并建立三个公开方法共用的坐标、错误、解码、模板归属、run-bound action 与
安全诊断边界。

**⚠️ CRITICAL**: T003～T008 的失败测试完成前不得开始 T009～T014；本阶段完成前不得实现
任何 User Story。

### 先行测试

- [X] T003 [P] 在 `src/automation/__tests__/coordinates.test.js` 先编写共享坐标合同失败测试：保持当前 normalized→content `floor` 语义，覆盖 `(123,39)` 浮点敏感像素、第一/最后 pixel、奇偶中心、非整数 `200×100 → 101×51` 和 `3840×2160 → 1920×1080`，证明 midpoint 编码经 mapper 可逆且 BrowserWindow DIP 不参与（FR-008～FR-011，SC-002、SC-009）
- [X] T004 [P] 在 `src/automation/__tests__/errors.test.js` 先加入七个 Vision 稳定错误码、固定 safeMessage、未知/raw error 降级及绝对路径/PNG/stack 不外泄测试，区分正常 `find -> null` 与真正失败（FR-019、FR-022、FR-026，SC-007）
- [X] T005 [P] 在 `src/automation/__tests__/vision-codec.test.js` 先编写 PNG signature/IHDR、16 MiB 上限、`nativeImage` empty、解码尺寸、`toBitmap()` 副本长度和截图/模板错误分类测试，验证截图 metadata 与位图来自同一轮且不跨 tick 引用 `getBitmap()`（FR-019、FR-021、FR-022、FR-025，SC-007）
- [X] T006 [P] 在 `src/automation/__tests__/vision-template-loader.test.js` 先编写合法加载、目录名不等于 manifest.id、相同 templateId 的跨包隔离、非法 ID 读取计数为 0、缺失/不可读/伪 PNG/损坏/尺寸/缓存、精确大小写及 symlink/junction containment 测试（FR-016～FR-019、FR-023、FR-024，SC-006、SC-007）
- [X] T007 [P] 在 `src/automation/__tests__/api.test.js` 先锁定现有 automation 五方法不变，并为可供 Vision 复用的 run-bound enqueue/preflight 编写失败测试，覆盖 lease ownership、queued abort 后 backend 调用数为 0、同 Profile FIFO 与页面阶段/`GAME_READY` 不作硬门槛（FR-001、FR-014、FR-015、FR-024，SC-005、SC-009）
- [X] T008 [P] 在 `src/utils/__tests__/logger.test.js` 先加入 Vision 诊断字段 allowlist 测试，只允许 run/profile/script/template、阶段、attempt、时长、稳定 code 与尺寸，拒绝路径、PNG/bitmap、raw fs/nativeImage error、URL/Cookie/Session/认证数据；保留现有 logger 失败不影响动作的合同（FR-022、FR-024、FR-026，SC-006、SC-007）

### 基础实现

- [X] T009 在 T003 失败后创建 `src/automation/coordinates.js`，实现并导出 size/normalized 校验、现有 `mapNormalizedPoint()` 语义和 screenshot point→content pixel→normalized cell midpoint helper；最小重构 `src/automation/backend.js` 复用共享 helper 且不改变正式 click/CDP 行为（FR-008～FR-011，SC-002、SC-009）
- [X] T010 [P] 在 T004 失败后扩展 `src/automation/errors.js`，注册 `vision-input-invalid`、`vision-template-id-invalid`、`vision-template-not-found`、`vision-template-read-failed`、`vision-template-invalid`、`vision-template-too-large`、`vision-timeout` 及固定安全消息（FR-019、FR-026，SC-007）
- [X] T011 [P] 在 T005 与 T010 失败后实现 `src/automation/vision/codec.js`，使用 Electron 11 `nativeImage.createFromBuffer()` 与 `toBitmap()` 复制位图，严格校验 PNG/IHDR/尺寸/长度并分别映射模板与 capture 错误（FR-019、FR-021、FR-022、FR-025，SC-007）
- [X] T012 在 T006、T010 与 T011 失败后实现 `src/automation/vision/template-loader.js`，以 `registry.get(scriptId).packageRoot` 为权威根，完成 lowercase slug 1～64、精确文件名、lexical+realpath containment、普通文件、16 MiB/PNG 校验及仅成功项按注册包身份+templateId 缓存（FR-016～FR-019、FR-023、FR-024，SC-006、SC-007）
- [X] T013 [P] 在 T007 失败后重构 `src/automation/api.js`，抽取 automation/vision 可复用但不向脚本暴露的 run-bound enqueue/preflight 入口，保持 automation 五方法、Profile lease/FIFO、取消映射和 backend 调用语义完全不变（FR-001、FR-014、FR-015、FR-024，SC-005、SC-009）
- [X] T014 在 T008 完成后，仅针对失败证据扩展 `src/utils/logger.js` 的 Vision 安全字段 allowlist，并让 `src/automation/vision/template-loader.js` 只使用已校验 identity、阶段、尺寸、时长和稳定 code；若现有 allowlist 已满足断言则不得为制造改动重构 logger；禁止输出候选/真实路径、图片字节或底层异常文本，且 logger 自身失败不得改变模板动作结果（FR-019、FR-022、FR-024、FR-026，SC-006、SC-007）

**Checkpoint**: 坐标与资源边界已由失败测试锁定；User Story 可在不新增依赖、Worker 或调度器的
前提下复用这些基础模块。

---

## Phase 3：User Story 1 - 查找自己的模板并直接点击（Priority: P1）🎯 MVP

**Goal**: 可信内置脚本可通过冻结的 `context.vision.find()` 对当前 Profile 新鲜截图做
exact-scale + ROI + threshold 匹配，获得截图像素 `rect`、可原样点击的 normalized `center` 与
确定性 `confidence`；合法 no-match 返回 `null`。

**Independent Test**: 合成固定 `1920×1080` 目标，经正式 `vision.find()` 得到 center 后原样交给
`automation.click()`，完整经过 mapper 与 CDP move/press/release 命中预期整数 content center；
ROI 外目标为 0，no-match 返回 null，相同输入重复 100 次结果一致。

### 先行测试

- [X] T015 [P] [US1] 在 `src/automation/__tests__/vision-matcher.test.js` 先编写 exact-scale 四通道 SAD confidence、threshold 两端、ROI、目标贴边、模板过大、最佳候选、row-major 并列、alpha 普通通道、提前剪枝不改结果、分片边界不改结果和重复 100 次确定性测试（FR-005～FR-007、FR-012、FR-019，SC-001、SC-003）
- [X] T016 [P] [US1] 在 `src/automation/__tests__/vision-api.test.js` 先编写 `find` 公共合同失败测试：严格 templateId/options/unknown key、每次新鲜 capture、同轮 PNG+metadata、ROI 后置校验、成功结果深冻结、正常 no-match 为 null、错误不伪装 no-match（FR-001、FR-002、FR-006～FR-008、FR-020、FR-021、FR-026，US1 验收场景 1、3、4）
- [X] T017 [P] [US1] 在 `src/automation/__tests__/runner.test.js` 与 `src/automation/__tests__/service.test.js` 先编写冻结 context 新增且仅新增同级 `vision`、vision 仅三方法、automation 仍五方法、身份/lease/signal/deadline 由 runner 绑定且脚本不可覆盖、`gameReady=false` 仍可查找的测试（FR-001、FR-014、FR-015、FR-024，SC-009）
- [X] T018 [P] [US1] 在 `src/automation/__tests__/vision-coordinate-chain.test.js` 先建立 `screenshot pixel → content pixel → normalized cell midpoint → automation.click() → mapper → CDP coordinate` 失败回归，覆盖固定 `1920×1080 + 100%`、`(123,39)`、`imageSize=3840×2160/contentSize=1920×1080/DIP=960×540`、非整数比例、边界/奇偶模板及匹配后 content contract 漂移时零 CDP 调用（FR-008～FR-011，SC-002、SC-009，US1 验收场景 2）

### 实现

- [X] T019 [US1] 在 T015 失败后实现 `src/automation/vision/matcher.js` 的纯 JS exact-scale matcher，按固定像素工作量和约 8ms 内部预算协作分片并通过 `setImmediate` 让出事件循环；实现 ROI、SAD confidence、threshold 剪枝、最高置信度/row-major tie-break 和边界检查回调，不得使用 Worker/WorkerPool 或写逐 slice 硬实时承诺（FR-005～FR-007、FR-012、FR-014，SC-001、SC-003、SC-005）
- [X] T020 [US1] 在 T016、T019 与 Foundation 完成后实现 `src/automation/vision/api.js` 的冻结 `find()`、严格 options、模板加载→新鲜 capture→解码→match→midpoint center 编排，合法 no-match 返回 `null`，模板/capture/window/input 错误保持稳定分类，且只记录 T008/T014 允许的安全诊断字段（FR-001、FR-002、FR-006～FR-010、FR-019～FR-022、FR-026，US1 验收场景 1～4）
- [X] T021 [US1] 在 T017、T020 失败后修改 `src/automation/runner.js` 与 `src/automation/index.js`，装配 registry/codec/loader/matcher/run-bound vision，将冻结 `vision` 注入 context 且不改变 manifest `apiVersion: 1`、automation 五方法、Profile FIFO 或现有脚本行为（FR-001、FR-014、FR-015、FR-024、FR-025，SC-009）

### US1 独立验证

- [X] T022 [US1] 运行 `src/automation/__tests__/coordinates.test.js`、`src/automation/__tests__/vision-codec.test.js`、`src/automation/__tests__/vision-template-loader.test.js`、`src/automation/__tests__/vision-matcher.test.js`、`src/automation/__tests__/vision-api.test.js`、`src/automation/__tests__/vision-coordinate-chain.test.js`、`src/automation/__tests__/api.test.js`、`src/automation/__tests__/runner.test.js` 与 `src/automation/__tests__/service.test.js`，修复仅限 US1 范围的问题并证明 MVP 独立闭环（FR-001、FR-002、FR-005～FR-012、SC-001～SC-003、SC-009）

**Checkpoint**: US1 MVP 可在自动测试中从脚本自有模板完成 find→center→正式后台 click；不包含
等待、OCR、multi-scale、新输入或 Worker。

---

## Phase 4：User Story 2 - 有限等待目标出现或消失（Priority: P2）

**Goal**: `waitFor` 与 `waitUntilGone` 第一轮立即检查、按完成后最小 interval 非重叠轮询，并在
local timeout、用户取消和统一 run deadline 竞争中稳定保留 first-settled 结果。

**Independent Test**: 用可控截图序列覆盖首次/后续出现、首次/后续消失、local timeout、取消、
run deadline 与 in-flight capture；terminal 后 capture 增量为 0，大 no-match 时 heartbeat 和另一
Profile action 持续推进。

### 先行测试

- [X] T023 [P] [US2] 扩展 `src/automation/__tests__/vision-api.test.js`，先覆盖 `waitFor`/`waitUntilGone` 首轮立即 capture、上一轮完成后再等待 interval、无重叠/补跑、首次与后续满足、有效 gone 返回 true、错误不得当作 gone、默认/边界 timing、local `vision-timeout` 及允许 capture 次数/terminal 后零新增 capture（FR-003、FR-004、FR-013、FR-020、FR-026，SC-004，US2 验收场景 1～3、5）
- [X] T024 [P] [US2] 扩展 `src/automation/__tests__/cancellation.test.js` 与 `src/automation/__tests__/runner.test.js`，先覆盖调用/capture/slice/sleep/settle 各边界的用户取消、窗口关闭、app quit、统一 deadline 与 local timeout 竞态，验证运行信号优先、结果 once-settled、in-flight capture 返回后丢弃且不 decode/match/再 capture（FR-013、FR-014，SC-004、SC-005，US2 验收场景 3、4）
- [X] T025 [P] [US2] 扩展 `src/automation/__tests__/coordinator.test.js` 与新建 `src/automation/__tests__/vision-responsiveness.test.js`，先验证完整 wait 占一个同 Profile FIFO action、同 Profile 后续 click 排队、另一个 Profile action 与 event-loop heartbeat 在 full-frame no-match 下持续推进、取消/deadline 被观察后 1 秒内停止新轮次；不得断言每个 slice `< 8.000ms` 或其他机器相关精确值（FR-014、FR-015，SC-005、SC-007）

### 实现

- [X] T026 [US2] 在 T023 失败后扩展 `src/automation/vision/api.js`，实现 `waitFor()` 与 `waitUntilGone()` 的立即首轮、非重叠 polling、默认/显式 local deadline、首次 match/gone 终止和 `vision-timeout`，完整等待必须占同一个 coordinator FIFO action且内部不得调用公开 `automation.capture()`/`automation.wait()`（FR-003、FR-004、FR-013、FR-014，SC-004）
- [X] T027 [US2] 在 T024 失败后完善 `src/automation/vision/api.js` 与 `src/automation/vision/matcher.js` 的统一 boundary check、abort-aware timer、once-settle guard 和 in-flight capture 丢弃，检查顺序为 lease/run signal→local timeout，迟到 signal/timer/capture/slice 不得覆盖 terminal（FR-013、FR-014、FR-021、FR-026，SC-004、SC-005）
- [X] T028 [US2] 在 T025、T026 与 T027 失败后完善 `src/automation/index.js` 的 run-bound backend/clock/scheduler 注入和清理，复用现有 coordinator/runner，不新增 scheduler、Worker 或 WorkerPool，并保证不同 Profile action tail 独立推进（FR-014、FR-015、FR-025，SC-005、SC-007）

### US2 独立验证

- [X] T029 [US2] 运行 `src/automation/__tests__/vision-api.test.js`、`src/automation/__tests__/vision-responsiveness.test.js`、`src/automation/__tests__/cancellation.test.js`、`src/automation/__tests__/runner.test.js` 与 `src/automation/__tests__/coordinator.test.js`，重复终止竞态与大 no-match 场景，确认结果正确率 100%、terminal 后 capture 增量 0、heartbeat/cancel/deadline/另一 Profile 可推进且无精确 8ms 断言（FR-003、FR-004、FR-013～FR-015，SC-004、SC-005、SC-007）

**Checkpoint**: US2 的两种有限等待可独立验收；`true` 只表示目标视觉上已不匹配，不表示此前
click 或业务动作成功。

---

## Phase 5：User Story 3 - 安全维护脚本专属模板（Priority: P3）

**Goal**: 维护者把只读 PNG 放入对应已注册脚本的 `assets/vision/`；开发树与 Windows ASAR
使用同一 registry packageRoot、模板字节和 matcher 行为，越界/损坏只失败当前 action。

**Independent Test**: 两个脚本包使用相同 templateId 时只读取各自资源；六类路径/网络越界在
读取前拒绝；开发树与 ASAR 清单/SHA/匹配结果一致，一个 Profile/模板失败不影响另一个。

### 先行测试与打包靶场

- [X] T030 [P] [US3] 扩展 `src/automation/__tests__/package-discovery.test.js`，先明确要求开发树包含 `automation-scripts/demo-click/assets/vision/sample-target.png`，并让普通 `npm test` 默认只使用开发树及测试自行创建/清理的临时 archive，绝不要求 `dist/` 或 Windows build 已存在；同一 helper 仅在显式提供 `AUTOMATION_ASAR_PATH` 时校验实际 app.asar 的逐文件清单与 SHA-256，且 `package.json` 继续只用 `automation-scripts/**`、不新增 `extraResources`（FR-023、FR-025，SC-008）
- [X] T031 [P] [US3] 扩展 `src/automation/__tests__/script-boundary.test.js` 与 `src/automation/__tests__/service.test.js`，先确认保留现有只读 `context.profileId`，但脚本不得覆盖或伪造 `profileId`/`scriptId`，也不得获得 packageRoot、filesystem、path、nativeImage 或身份/root override；同时覆盖脚本 A 不能探测脚本 B 同名模板，模板错误只终止当前 action且 Profile B 仍能 find/click（FR-016～FR-019、FR-022、FR-024，SC-006、SC-007）
- [X] T032 [P] [US3] 先编写 `tests/runtime/packaged-automation-smoke.js` 的 packaged verification harness，要求从实际 app.asar 的 registry→runner→冻结 `context.vision` 解析并解码模板，在合成 capture 上得到与开发环境相同的 rect/center/confidence，同时保留现有 catalog 与 demo-click 回归；T032 只负责在实现前完成验证设计，不要求干净 checkout 已存在 `dist/` 或在本任务内执行实际 app.asar，资源缺失的失败先行证据由 T030 的自包含 Jest 回归提供，harness 的首次正式执行与通过判定统一归 T038（FR-001、FR-017、FR-023，SC-006、SC-008、SC-009）
- [X] T033 [P] [US3] 先扩展 `tests/runtime/automation-runtime-harness.js` 与 `tests/runtime/cdp-background-smoke.js`，使 Chromium 靶场的至少一次点击必须由正式 registry→runner→`context.vision.find()` 的 center 原样驱动，并继续验证不抢焦点、不移动系统鼠标；`tests/runtime/cdp-ppapi-background-smoke.js` 只保留为既有 PPAPI/framework 回归，不把其中非 100% scale factor 场景升级为 Vision/DPI 验收，且禁止把预期坐标直接复制给 backend（FR-008～FR-011、FR-023、FR-025，SC-002、SC-008、SC-009）

### 实现与维护合同

- [X] T034 [US3] 在 T030 已确认因资源缺失按预期失败、且 T032/T033 的 packaged/runtime harness 已先行编写后，创建真实只读 PNG `automation-scripts/demo-click/assets/vision/sample-target.png`，保持 `automation-scripts/demo-click/index.js` 与 `manifest.json` 的现有业务/apiVersion 行为不变，不新增第二个生产脚本；T032 的实际 app.asar 执行仍留到 T038（FR-016、FR-023、FR-025，SC-008）
- [X] T035 [US3] 在 T031 完成后，仅针对其失败证据补齐 `src/automation/index.js`、`src/automation/runner.js` 与 `src/automation/vision/template-loader.js` 的 RegisteredScript 身份绑定和跨 Profile 错误隔离；若 T012/T021 已使断言全部通过，则不得为制造改动重构这些文件；始终禁止把模板复制到 `store`/userData、暴露 packageRoot 或清空另一脚本/Profile 的状态（FR-016～FR-019、FR-022～FR-024，SC-006、SC-007）
- [X] T036 [US3] 更新 `automation-scripts/README.md`、`docs/BUILTIN_AUTOMATION.md` 与 `docs/REPO_MAP.md`，公开 `context.vision` 三方法、options/defaults、rect/center 空间、templateId/layout、错误/等待语义、安全日志、ASAR 与 v1 范围；明确 `assets/vision` 只能经 Vision API 使用且这不是恶意同进程脚本沙箱（FR-001～FR-026，SC-006、SC-009）

### US3 独立验证

- [X] T037 [US3] 运行 `src/automation/__tests__/vision-template-loader.test.js`、`src/automation/__tests__/script-boundary.test.js`、`src/automation/__tests__/service.test.js` 与 `src/automation/__tests__/package-discovery.test.js`，确认六类越界读取前拒绝率 100%、跨脚本/Profile 读取为 0、错误分类正确且开发/ASAR 清单与 SHA 差异为 0（FR-016～FR-024，SC-006～SC-008）
- [X] T038 [US3] 使用 `package.json` 的 `npm run build:win` 生成 Windows x64 portable 后，以项目固定 Electron `11.5.0` 执行 `tests/runtime/packaged-automation-smoke.js <actual-app.asar>`，并针对同一实际 `dist/**/resources/app.asar` 重跑 `src/automation/__tests__/package-discovery.test.js`；registry、脚本和模板不得旁路 ASAR，也不得提交构建产物或修改锁文件（FR-023、FR-025，SC-008、SC-009）
- [X] T039 [US3] 在 Windows x64 执行 `tests/runtime/cdp-background-smoke.js`，确认 Chromium 靶场的 Vision center 经正式 click/CDP 命中且 hidden/background/focus/cursor 行为不退化；另行重跑 `tests/runtime/cdp-ppapi-background-smoke.js` 只确认既有 PPAPI/framework 行为无退化，不据此宣称 Vision 支持 DPI/多缩放，并清理全部临时视觉数据（FR-008～FR-011、FR-022、FR-025，SC-002、SC-008、SC-009）

**Checkpoint**: 三个 User Story 均完成；模板在开发与 ASAR 中同源、同归属、同匹配结果。

---

## Phase 6：Polish & Cross-Cutting Concerns

**Purpose**: 执行录点条件门、全量 framework 回归和范围/运行时审计。

- [X] T040 在完全不修改 `src/automation/recording.js` 的前提下，先在 `src/automation/__tests__/recording.test.js` 新增通过正式 `recording.addPoint()`→保存 normalized point→当前 `mapNormalizedPoint()` 的 `(123,39)` 等集成回归并在原实现上运行：只有稳定复现 1px 回退才保留该失败测试并允许 T041；若无法复现，记录证据、保持 `recording.js` 行为不变并将 T041 作为有理由的 N/A，而不是为统一抽象强改（FR-009～FR-011，SC-002、SC-009）
- [X] T041 仅在 T040 已证明原实现稳定发生 1px 回退时，最小修改 `src/automation/recording.js` 复用 `src/automation/coordinates.js` 的 normalized cell midpoint helper，使失败测试通过并保持过期、Profile/script/sender 绑定和其余录点行为；否则不得修改该文件（FR-009～FR-011，SC-002、SC-009）
- [X] T042 运行 `package.json` 中的 `npm test -- --runInBand` 与 `npm run lint`，修复 Feature 范围内回归并确认既有 GameViewport、capture、recording、mapper、CDP、runner/coordinator、Profile 并发、Session/Partition、腾讯登录和 PPAPI 测试退化数为 0（FR-015、FR-021、FR-024、FR-025，SC-009）
- [X] T043 复核 `package.json`、`package-lock.json`、`src/app/GameViewport.js`、`src/app/Launcher.js`、`src/automation/backend.js` 与新增 `src/automation/vision/`，确认没有依赖/lockfile/runtime 升级、Worker/WorkerPool、multi-scale、OCR、Python/OpenCV、新输入/调度器、DPI 产品扩展、页面阶段硬门槛或截图/路径/认证数据持久化（FR-005、FR-015、FR-022～FR-025，SC-006、SC-009）

---

## Phase 7：腾讯真实游戏人工验收

**Purpose**: 自动测试、Electron smoke 与 Windows ASAR 全部通过后，先提供一个不进入正式
发布 catalog 的本地验收入口，再在真实腾讯国服环境做非破坏性视觉闭环；人工任务不得由实现者
自行声称通过。

- [X] T044 在 T001～T043 全部完成后创建 `tests/manual/vision-real-game.js` 与 `tests/manual/README.md`，提供 `find-click`、`waitFor`、`waitUntilGone` 三种明确命令/配置和清理步骤；同时在现有启动器自动化面板提供主要人工验收入口：选中脚本后在截图框选并自动填入 screenshot-pixel ROI/中心坐标，从当前脚本安全模板下拉框选择 templateId，使用“匹配”查看 rect/confidence，或使用“匹配并点击”经正式 Profile lease、`vision.find()`、`automation.click(result.center)` 和坐标 mapper 派发。UI/IPC 不得接受路径或绕过模板隔离；命令行 harness 仍须通过正式 registry→runner→冻结 `context.vision` 链并在结束时清理临时包。（FR-001～FR-004、FR-016～FR-024，SC-002、SC-006、SC-008、SC-009）
- [ ] T045 在 T044 完成后，由用户优先使用启动器自动化面板（动态 `waitFor`/`waitUntilGone` 可选用 `tests/manual/vision-real-game.js`）在 Windows x64、`1920×1080 + 100%`、腾讯官方扫码/手工选服环境只验收真实 PPAPI 腾讯页面才能证明的行为：当前 Profile 可真实 capture；局部模板 `find` 返回的 rect 完全位于配置 ROI 和所选真实 UI 目标边界内，confidence 为有限 `[0,1]` 且 `>=` 本次配置 threshold；`automation.click(result.center)` 命中目标且不抢焦点、不移动 OS 鼠标；真实画面变化能被 `waitFor`/`waitUntilGone` 观察；如方便再让两个 Profile 各执行一次确认不串窗口。local timeout、cancellation、run deadline、terminal 后零 capture、heartbeat 与错误分类以此前自动测试结果为准，不要求人工重复；只记录 templateId、尺寸、rect/confidence 等非敏感证据，不保存原始截图、URL query、Cookie、票据或验证码，且 `waitUntilGone() === true` 不得替代业务成功目视确认（FR-002～FR-004、FR-008～FR-015、FR-022～FR-025，SC-002、SC-004、SC-009）

  **2026-08-10 部分人工证据**：用户已在真实腾讯 PPAPI 页面通过 UI 验证 templateId `target`
  （`42×50`）、ROI `1355,359,61,50`、threshold `0.95` 的 `find` 与
  `automation.click(result.center)`，并确认实际目标被触发；会话日志无 Vision/capture/template/
  CDP/script 错误。由于 UI 不记录结果详情，文档不补造 rect/confidence；动态等待和双 Profile
  真实页面场景未在本次重复，因此 T045 保持未完成。

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**：无前置条件；T001 先锁定基线，T002 随后建立测试夹具。
- **Phase 2 Foundational**：依赖 Phase 1；T003～T008 必须先于 T009～T014，且本阶段阻塞全部故事。
- **US1（Phase 3）**：依赖 Foundational；T015～T018 先行失败，T019→T020→T021 依次实现，T022 完成 MVP 验证。
- **US2（Phase 4）**：依赖 US1 的 matcher/find/context；T023～T025 先行失败，T026→T027→T028 后由 T029 验证。
- **US3（Phase 5）**：资源/文档测试 T030～T033 可在 Foundational 后提前编写；T030 提供资源缺失的失败先行证据，T032 只先行完成 packaged harness 设计且首次正式执行/通过归 T038，T033 的正式通过依赖 US1；T034/T035 完成后执行 T037→T038→T039。
- **Polish（Phase 6）**：依赖三个故事；T040 是 T041 的硬门，T042/T043 在条件性录点决定后执行。
- **人工验收（Phase 7）**：T044 依赖 T001～T043 全部自动化、runtime 与 packaged 验证完成；T045 优先使用启动器 UI，动态等待可选用 manual harness，并在临时资源清理后记录非敏感证据。

### User Story Dependency Graph

```text
Setup
  └─ Foundational（coordinates/errors/codec/template ownership/run gate）
       └─ US1 find + exact matcher + pixel→CDP MVP
            ├─ US2 wait/poll/cancel/deadline/responsiveness
            └─ US3 package/ASAR/runtime tests（可提前编写）

US1 + US2 + US3
  └─ recording failure gate → framework regression/scope audit
       └─ Tencent real-game manual acceptance
```

### Implement 严格依赖顺序

1. T001～T014：基线 → 共享失败测试 → coordinates/errors/codec/loader/run gate。
2. T015～T022：matcher/find/context/完整 pixel→CDP 链，形成 MVP。
3. T023～T029：waitFor/waitUntilGone、polling、first-settled 与响应性。
4. T030～T039：模板资源、脚本隔离、开发/ASAR parity 与 Electron runtime smoke。
5. T040→T041：先证明 recording 1px 回退，再决定是否改 recording；不可逆序。
6. T042～T043：全量 framework 回归与范围审计。
7. T044：建立启动器内主要验收 UI，并保留不进入正式 catalog/ASAR 的可选 manual harness。
8. T045：最后由用户执行缩小后的腾讯真实游戏人工验收。

---

## Parallel Opportunities

### Shared Foundation

```text
失败测试批次：T003 coordinates | T004 errors | T005 codec | T006 loader | T007 run gate | T008 logs
实现批次：T009 coordinates | T010 errors | T013 run gate
随后：T011 codec → T012 loader → T014 diagnostics
```

### User Story 1

```text
失败测试批次：T015 matcher | T016 find API | T017 runner/service surface | T018 coordinate chain
实现顺序：T019 matcher → T020 find API → T021 composition → T022 validation
```

### User Story 2

```text
失败测试批次：T023 polling | T024 cancellation/deadline | T025 FIFO/responsiveness
实现顺序：T026 waits → T027 boundary/settle → T028 composition → T029 validation
```

### User Story 3

```text
失败测试/靶场批次：T030 package discovery | T031 isolation | T032 packaged smoke | T033 CDP/PPAPI smoke
实现与验证：T034 asset → T035 binding/isolation；T036 docs 可并行；随后 T037 → T038 → T039
```

---

## Implementation Strategy

### MVP First（只完成 User Story 1）

1. 完成 T001～T014，锁定共享合同与安全资源边界。
2. 完成 T015～T018 并确认测试因缺少 matcher/find/context 实现失败。
3. 完成 T019～T021。
4. 执行 T022，在固定环境和构造的 unequal-size/DIP sentinel 用例上验证完整 pixel→CDP 链。
5. 在 Checkpoint 停止评审；不提前加入等待、Worker、多缩放或发布范围外能力。

### Incremental Delivery

1. **Foundation**：坐标、错误、PNG 解码、脚本模板归属、run-bound action、安全诊断。
2. **US1**：单次 exact-scale find 与可直接 click 的 center。
3. **US2**：有限 waitFor/waitUntilGone、polling、取消/deadline 与事件循环响应性。
4. **US3**：模板随脚本发布、跨脚本隔离、ASAR/CDP/PPAPI 一致性和作者文档。
5. **Release**：录点条件门、全量回归、范围审计、腾讯真实游戏人工验收。

### Scope Guards

- 不寻找、恢复或沿用不可用 POC 分支及其 normalize 公式。
- 不引入 Worker/WorkerPool、multi-scale、OCR、feature/object detection、rotation、Python/OpenCV、第三方模板、Vision DSL、调度器或新输入。
- 不把 `imageSize != contentSize`/DIP sentinel 测试写成 DPI/多缩放产品支持。
- 不把约 8ms 实现预算写成逐 slice 精确时限；只验 heartbeat、取消/deadline 和另一 Profile 推进。
- 不让 Vision 内部嵌套公开 Automation API，不让页面阶段、Flash 状态或 `GAME_READY` 成为硬门槛。
- 不新增依赖、不升级 Node.js/npm/Electron/PPAPI、不无故修改 `package-lock.json`。
- 若实现暴露 Spec/Plan 未覆盖的需求缺口，先停止并更新 `spec.md`、`plan.md` 与 Constitution Check。

---

## Notes

- `[P]` 只表示不同文件且依赖已满足时可并行；同一测试文件的新增断言应由同一任务串行完成。
- 每个测试任务先确认正确的失败原因，再开始对应实现；已存在行为的 characterization 断言可以先通过，但新增能力断言必须先失败。
- T040/T041 是不可绕过的条件门：没有 recording 集成失败证据，就没有 recording 生产代码改动。
- T038 的 Windows 构建可在代码、依赖、构建配置、脚本资源均未变化且证据可追溯时复用同一产物；任一输入变化后必须重建。
- 所有临时截图、位图、ASAR 解包与测试 Profile 数据必须放入临时目录并在测试后清理；构建产物不得提交。
