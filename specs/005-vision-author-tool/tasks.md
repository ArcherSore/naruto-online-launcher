# Tasks：外部 Vision Author Tool

**Input**: `specs/005-vision-author-tool/` 下已确认的 `spec.md`、`plan.md`、`research.md`、
`data-model.md`、`contracts/` 与 `quickstart.md`

**Prerequisites**: Plan 两次 Constitution Check 均为 PASS；无待澄清项；Node.js `16.20.2`、npm
`8.19.4`、Electron `11.5.0` 与 PPAPI 基线保持不变。

**Tests**: 本 Feature 明确要求测试先行。每个阶段先编写并运行对应测试，确认测试因尚未实现的行为而失败，
再执行该阶段实现任务；不得以改弱断言、替换正式 capture 来源或跳过 Windows 边界测试使测试转绿。

**Organization**: 任务按 User Story 分组；每项均引用相关 FR、SC 或验收场景，并给出确切文件路径。

## Format：`[ID] [P?] [Story] Description`

- **[P]**：在当前阶段内可与其他标记任务并行，且不修改同一文件、不依赖尚未完成的任务。
- **[Story]**：`[US1]`～`[US4]` 对应 `spec.md` 的四个 User Story。
- 未标记 Story 的任务只用于共享 Setup、Foundational 或跨故事收尾。

---

## Phase 1：Setup（共享准备）

**Purpose**：建立 developer-only 工具边界和可复用测试夹具，不改变正式 Launcher 入口或依赖。

- [X] T001 按 `plan.md` 建立 `tools/vision-author/` 目录骨架，并在 `tools/vision-author/README.md` 记录仅限仓库开发环境、固定运行时、不新增依赖、标准 `npm start` 无入口以及禁止截图 fallback 的边界（FR-001、FR-004、FR-029～FR-031）
- [X] T002 [P] 建立 deferred Promise、长度前缀消息、正式 capture frame、临时 registry/package 与 Windows 路径边界等共享夹具，并复用现有 Vision PNG fixture 能力，放入 `tools/vision-author/__tests__/helpers.js`（FR-005、FR-017、FR-026；SC-004～SC-007）

---

## Phase 2：Foundational（阻塞所有 User Story）

**Purpose**：先锁定 private bridge、developer bootstrap 启动时序与正式 capture race 合同，再实现所有故事共用的连接基础。

**⚠️ CRITICAL**：T003～T005 必须先运行并确认失败；T006～T012 完成且 T013 通过前，不得开始 User Story 实现。

### Tests（先写并确认失败）

- [X] T003 [P] 为 4-byte big-endian framing、24 MiB 上限、首包 `hello`、constant-time token、重复 requestId、未知字段/op、第二 client 与未认证零副作用编写失败测试，放入 `tools/vision-author/__tests__/protocol.test.js`（FR-027～FR-028；bridge contract §2～§5）
- [X] T004 [P] 为显式 developer entry、`ready` 后正式同步初始化完成再建 pipe/拉起 child、single-instance 失败零入口、packaged/非 browser/错误 repo fail-closed、退出双向清理编写失败测试，放入 `tools/vision-author/__tests__/bootstrap.test.js`（FR-001、FR-025、FR-029～FR-030；US4-AC1/2/4；SC-009～SC-010）
- [X] T005 [P] 为 `backend.capture()` 前后 window、webContents 与 contentSize 身份一致性编写失败回归，覆盖同一 `profileId` 关闭重开时拒绝旧 PNG，更新 `src/automation/__tests__/vision-coordinate-chain.test.js`（FR-005、FR-007、FR-026；SC-006）

### Implementation

- [X] T006 实现严格 schema、framing 编解码、请求关联、稳定 safe error 与认证状态机，放入 `tools/vision-author/bridge/protocol.js`，使 T003 的纯协议断言通过且不记录 token/PNG/path（FR-027～FR-028；bridge contract §2～§5）
- [X] T007 实现随机 Windows Named Pipe、单 client、消息上限、重复/畸形请求断开和无队列 request dispatcher，放入 `tools/vision-author/bridge/server.js`（FR-001、FR-025、FR-027；SC-009）
- [X] T008 实现外部 Electron 进程的唯一 pipe client、requestId 关联、断连收敛与安全 BrowserWindow 配置，放入 `tools/vision-author/app/main.js`（FR-025、FR-027～FR-030）
- [X] T009 实现 `contextIsolation:true`、`nodeIntegration:false` 的显式方法 allowlist，禁止 renderer 直接接触 token、`net`、`fs`、Electron main 或任意 op/path，放入 `tools/vision-author/app/preload.js`（FR-001、FR-027～FR-030；US4-AC5）
- [X] T010 实现 unpackaged browser/repo fail-closed、正式 `ready` 初始化后启动、随机 256-bit token/pipe、清理开发注入变量的 Author child 环境和双向生命周期，放入 `tools/vision-author/launcher-bootstrap.js`（FR-001、FR-025、FR-027～FR-030；US4-AC1/2/4）
- [X] T011 实现从仓库根解析 Electron、通过根 shim 与显式 developer entry 安装 bootstrap、普通实例冲突恢复提示与 exit-code 透传，放入 `vision-author-launcher.js`、`tools/vision-author/launcher-entry.js` 和 `tools/vision-author/start.ps1`（FR-001、FR-025、FR-029～FR-030；SC-009～SC-010）
- [X] T012 加固正式 capture await race：返回后重新解析同一 Profile 并比较原 window、webContents、contentSize，不一致统一拒绝旧帧，更新 `src/automation/backend.js`，不得新增页面阶段或 `GAME_READY` 门槛（FR-003～FR-005、FR-007、FR-026；SC-006）
- [X] T013 运行 `npm test -- --runInBand tools/vision-author/__tests__/protocol.test.js tools/vision-author/__tests__/bootstrap.test.js src/automation/__tests__/vision-coordinate-chain.test.js`，确认 `tools/vision-author/__tests__/protocol.test.js` 所代表的 Foundational 红灯已转绿且现有坐标链无回归（FR-030；SC-006、SC-009）

**Checkpoint**：bridge 只能由 developer bootstrap 建立，Author child 可安全连接，正式 backend 已拒绝 target replacement race；尚未实现 Profile authoring UI。

---

## Phase 3：User Story 1 - 选择 Profile 并冻结正式画面（Priority：P1）🎯 MVP

**Goal**：列出安全 Profile，按固定 1000ms tick 复用正式 backend 显示完整 capture，精确 Freeze 已显示帧并可恢复 Live。

**Independent Test**：启动至少一个 Profile，选择后观察 frame/metadata；分别手动 Freeze 和以选择开始触发自动 Freeze，验证固定 tick、忙碌跳过、迟到结果丢弃、冻结 30 秒零新 capture，并在 Resume 后使旧产物变为 reference-only（US1 Independent Test；SC-001～SC-002）。

### Tests（先写并确认失败）

- [X] T014 [P] [US1] 为安全 Profile catalog、客观 target 有效但 `GAME_READY=false` 或仍处扫码/选服等页面阶段时仍允许 capture、只调用注入的正式 `backend.capture(profileId)`、bridge 单飞 `capture-busy`、frame/metadata/Profile 不可拆分、display ack 后才能 pin 以及 release 清理编写失败测试，放入 `tools/vision-author/__tests__/session.test.js`（FR-002～FR-005、FR-007～FR-010、FR-025～FR-028；US1-AC1/3/4）
- [X] T015 [P] [US1] 使用 Jest fake timers 与 deferred capture 为 t0 tick、固定 `setInterval(1000)`、900～1100ms 节奏、busy tick 跳过、无并发/队列/补跑、settle 不直启下一轮、Freeze 后零新增调用编写失败测试，放入 `tools/vision-author/__tests__/live-controller.test.js`（FR-006～FR-011；US1-AC2～AC5；SC-001～SC-002）
- [X] T016 [P] [US1] 为 Profile 快切、Freeze 与 response 同时发生、旧 epoch、断连、capture 失败/挂起及恢复编写失败状态视图测试，放入 `tools/vision-author/__tests__/app.test.js`（FR-007～FR-011、FR-025～FR-026；SC-002、SC-006、SC-009）

### Implementation

- [X] T017 [US1] 实现 `BridgeSession` 的安全 Profile 枚举、catalog membership、capture single-flight、opaque frame cache、display ack、exact frame pin/release 与 session 清理，放入 `tools/vision-author/bridge/session.js`（FR-002～FR-010、FR-025～FR-028；bridge contract `profiles.list`/`capture`/`frame.*`）
- [X] T018 [P] [US1] 实现正式 Vision codec 解码、PNG/imageSize/contentSize/capturedAt/Profile canonical contract 校验与稳定失败码，放入 `tools/vision-author/bridge/frame.js`；invalid frame 可诊断/Freeze 但不得获得 save 资格，禁止 resize/correction（FR-005、FR-016～FR-017；SC-005）
- [X] T019 [US1] 实现 `DISCONNECTED/LIVE/FREEZING/FROZEN`、selection/view epoch、t0+固定 1000ms ticker、client single-flight、迟到 response 丢弃、手动/自动 Freeze 与 Resume reference-only 语义，放入 `tools/vision-author/app/app.js`（FR-006～FR-011、FR-025～FR-026；SC-001～SC-002、SC-006）
- [X] T020 [US1] 将 `profiles.list`、`capture`、`frame.displayed`、`frame.freeze`、`frame.release` 与 `session.close` 路由到同一 session/backend，并从 `profileStore.getAll()` 与 `Launcher.getAutomationTarget` 构造安全依赖，更新 `tools/vision-author/launcher-bootstrap.js` 和 `tools/vision-author/bridge/server.js`（FR-002～FR-010、FR-027）
- [X] T021 [P] [US1] 实现 Profile 选择、完整 Live 图像、Profile identity、`imageSize`、`contentSize`、`capturedAt`、合同失败项、Live/Freeze 状态及无 interval 控件的基础界面，放入 `tools/vision-author/app/index.html` 和 `tools/vision-author/app/styles.css`（FR-002、FR-005～FR-006、FR-016～FR-017；US1-AC1/2）
- [X] T022 [US1] 将显式 Profile/capture/frame 方法和断连事件接入 renderer，更新 `tools/vision-author/app/main.js` 与 `tools/vision-author/app/preload.js`，确保错误只含 stable code、safeMessage、recovery（FR-025、FR-027～FR-028；SC-009）
- [ ] T023 [US1] 运行 US1 三个测试 suite，并按 `specs/005-vision-author-tool/quickstart.md` §4～§5 执行固定 tick、手动 Freeze、自动 Freeze、Resume 的 MVP 人工验收，确认正式 capture 调用来源与 frozen frame 身份证据（FR-004、FR-006～FR-011；SC-001～SC-002）

**Checkpoint**：US1 可独立演示 Profile→Live→Freeze→Resume，且不具备选择、preview 或保存能力。

---

## Phase 4：User Story 2 - 在同一冻结帧框选 Template 与 ROI（Priority：P2）

**Goal**：在 exact frozen frame 上独立选择 Template/ROI，显示准确 screenshot-pixel rect，并由 pinned 原 PNG 生成无缩放 preview。

**Independent Test**：使用已知 1920×1080 fixture，在四角、边缘、中部、正反向 drag、letterbox 与窗口缩放下核对整数 rect；调整 Template/ROI 互不影响，preview 与原 PNG 逐像素一致，invalid contract frame 可诊断但不可保存（US2 Independent Test；SC-003～SC-005）。

### Tests（先写并确认失败）

- [X] T024 [P] [US2] 为正反向 drag、floor/ceil 边界、letterbox、越界/零面积、display scaling、独立 Template/ROI 和 frameId 绑定编写失败测试，扩展 `tools/vision-author/__tests__/live-controller.test.js`（FR-009～FR-014；US2-AC1～AC4；SC-003）
- [X] T025 [P] [US2] 为 pinned 原 PNG crop、previewId 绑定、Template/frame 变化使旧 preview 失效、invalid frame 诊断 preview、输出尺寸和逐像素来源编写失败测试，放入 `tools/vision-author/__tests__/frame.test.js`（FR-010、FR-015～FR-017、FR-020；US2-AC1/5；SC-004～SC-005）

### Implementation

- [X] T026 [US2] 实现 rect 合同复用、从 pinned 原 PNG 解码并按 Template rect 无缩放 crop、重新编码校验、单一 `PreviewArtifact` 与 stale preview 释放，更新 `tools/vision-author/bridge/frame.js`（FR-010、FR-013、FR-015、FR-017；authoring contract §1/§5）
- [X] T027 [US2] 实现 rendered image content-box 测量、pointer→screenshot pixel 的 floor/ceil 映射、letterbox 拒绝、自动 Freeze 后再消费 pointer，以及相互独立的 Template/ROI draft，更新 `tools/vision-author/app/app.js`（FR-009、FR-012～FR-014；SC-003）
- [X] T028 [US2] 实现并接线 `preview.create`，只接受 current frozenFrameId+templateRect、只返回 bridge 生成的 preview，更新 `tools/vision-author/bridge/session.js`、`tools/vision-author/bridge/server.js`、`tools/vision-author/app/main.js` 和 `tools/vision-author/app/preload.js`（FR-010、FR-015、FR-017；bridge contract `preview.create`）
- [X] T029 [P] [US2] 增加 Template/ROI 模式、双选区 overlay、整数 rect、合同提示和 crop preview 视图，更新 `tools/vision-author/app/index.html` 与 `tools/vision-author/app/styles.css`；不得使用 canvas/缩略图生成 save source（FR-012～FR-017；US2-AC1～AC5）
- [ ] T030 [US2] 运行 US2 测试，并按 `specs/005-vision-author-tool/quickstart.md` §5～§6 执行四角/反向/缩放/invalid metadata 人工验收，确认 preview 与 frozen PNG 像素一致且静默修正次数为 0（SC-003～SC-005）

**Checkpoint**：US1+US2 可完成正式帧冻结、Template/ROI 框选和可信 preview；仍不写仓库文件。

---

## Phase 5：User Story 3 - 保存模板并复制运行时参数（Priority：P3）

**Goal**：只从正式 registry catalog 选择 Target Script，以 current preview exact bytes 原子保存模板，并复制精确 ROI 与现有 Vision API 示例。

**Independent Test**：对可信 registry fixture 完成 frozen frame→Template→preview→preflight→commit，逐像素比较保存文件；覆盖 manifest id/目录名不同、伪造 id/path、非法 templateId、冲突确认、target 漂移、junction/symlink、写入失败和剪贴板失败（US3 Independent Test；SC-004、SC-007、SC-009）。

### Tests（先写并确认失败）

- [X] T031 [P] [US3] 为 `createRegistry({app}).scan()` 启动快照、安全 `ScriptOption` allowlist、manifest id 与目录名不同、伪造/失效 scriptId 以及 payload 禁止 path 编写失败测试，放入 `tools/vision-author/__tests__/catalog.test.js`（FR-018、FR-024、FR-027；US3-AC1/2/6；SC-007）
- [X] T032 [P] [US3] 为正式 `validTemplateId()`、registry `packageRoot` 权威解析及真实 repo-relative 返回路径、lexical/realpath/lstat、symlink/junction/reparse、case-only conflict、preflight absent→commit existing 时零写入并重新确认、一次性 grant/TTL/stat 漂移、exclusive temp+flush+rename、失败保留旧文件与 temp 清理编写失败测试，放入 `tools/vision-author/__tests__/template-writer.test.js`（FR-018～FR-021、FR-024；US3-AC1～AC3；SC-007）
- [X] T033 [P] [US3] 为 frozen-frame→preview→save exact bytes 的模块集成链编写失败测试，断言 selection/preview/save 为同一 frame/profile/rect、保存零 capture/resize/resample，并覆盖 Resume/Profile switch/contract invalid 后零写入，放入 `tools/vision-author/__tests__/authoring-flow.test.js`（FR-010～FR-011、FR-015、FR-017、FR-020、FR-024、FR-026；SC-004～SC-006）
- [X] T034 [P] [US3] 为 ROI 文本、`find()`/`waitFor()` 有无 ROI、合法 templateId 字符串字面量、threshold/timeout/poll 参数和 clipboard failure 零副作用编写失败测试，放入 `tools/vision-author/__tests__/output.test.js`（FR-022～FR-023；US3-AC4～AC5；SC-007、SC-009）

### Implementation

- [X] T035 [US3] 使用同一 developer 会话的正式 registry 建立只读启动快照、输出安全 catalog，并在保存时以 `registry.get(scriptId)` 重取/重验 record，放入 `tools/vision-author/bridge/catalog.js`（FR-018、FR-024、FR-027；bridge contract `scripts.list`）
- [X] T036 [US3] 实现 `packageRoot/assets/vision/<templateId>.png` 的 lexical/realpath/lstat/reparse containment、正式 templateId validator、case-insensitive conflict 与安全 repo-relative 展示路径，放入 `tools/vision-author/bridge/template-writer.js`（FR-018～FR-021、FR-024；SC-007）
- [X] T037 [US3] 在 `tools/vision-author/bridge/template-writer.js` 实现绑定 session/frame/preview/script/template/stat/TTL 的一次性 replacement grant、commit 前 absent/existing 状态重查与新冲突零写入，以及 same-directory `flag:'wx'` temp、write+flush+atomic rename、失败清 temp 且不先 unlink 旧文件（FR-020～FR-021、FR-024；US3-AC1～AC3）
- [X] T038 [US3] 实现 `scripts.list`、`template.save.preflight` 与 `template.save.commit` 路由，commit 只按 current previewId 取 exact crop bytes，写前重查 pinned frame contract、Profile target 可用性和 catalog record 且不得 capture，更新 `tools/vision-author/bridge/session.js`、`tools/vision-author/bridge/server.js` 和 `tools/vision-author/launcher-bootstrap.js`（FR-010、FR-017～FR-021、FR-024～FR-026；bridge contract save ops）
- [X] T039 [P] [US3] 实现纯函数 ROI、`context.vision.find()` 与 `context.vision.waitFor()` 文本生成及 reference-only 标记，更新 `tools/vision-author/app/app.js`（FR-011、FR-022～FR-023；authoring contract §8）
- [X] T040 [US3] 仅通过受控 preload/main IPC 实现 typed clipboard write 与 save 请求方法，更新 `tools/vision-author/app/preload.js` 和 `tools/vision-author/app/main.js`；失败不得触发 capture/preview/save 或清除屏幕文本（FR-022～FR-023、FR-025、FR-027；SC-009）
- [X] T041 [US3] 实现可信 Target Script 下拉、templateId 即时校验、save eligibility、确切冲突确认、ROI/find/waitFor 展示与复制反馈，更新 `tools/vision-author/app/index.html`、`tools/vision-author/app/styles.css` 和 `tools/vision-author/app/app.js`；UI 不提供 scriptId/path/interval 输入（FR-006、FR-018～FR-024；US3-AC1～AC6）
- [ ] T042 [US3] 运行 US3 四个测试 suite，并按 `specs/005-vision-author-tool/quickstart.md` §7～§8 验证可信 catalog、原子覆盖、exact pixels、ROI/示例与缓存后重启提示（FR-018～FR-024；SC-004、SC-007、SC-009）

**Checkpoint**：US1～US3 形成完整开发者 authoring 闭环，唯一持久化游戏画面是 selected script 的 Template crop。

---

## Phase 6：User Story 4 - 保持开发工具边界（Priority：P4）

**Goal**：证明连接最小化、多 Profile 不混用、失败无截图 fallback，且正式 Windows 包中工具与专用入口为零。

**Independent Test**：分别测试错误 token/断连/Profile 关闭、A/B Profile 延迟切换和同 id 重开、标准 `npm start`、真实 unpacked `app.asar` 与 portable，确认无敏感 DTO、跨 Profile 产物、开发 pipe/window 或发行内容（US4 Independent Test；SC-006、SC-009～SC-010）。

### Tests（先写并确认失败）

- [X] T043 [P] [US4] 为 `package.json` allowlist、正式 `src/main.js` 零 require/flag/env hook、packaged bootstrap fail-closed、Author 文件/协议标识不进入模拟 asar manifest 编写失败测试，放入 `tools/vision-author/__tests__/release-boundary.test.js`（FR-001、FR-029～FR-030；US4-AC1/4；SC-010）
- [X] T044 [P] [US4] 为双 Profile 50 次延迟/快切/关闭/同 id 重开编写失败集成测试，断言 frame、metadata、selection、preview、save 与 source Profile 全链一致且不访问 Session/Partition，放入 `tools/vision-author/__tests__/multi-profile-isolation.test.js`（FR-005、FR-007、FR-010、FR-026～FR-027；US4-AC3/5；SC-006）
- [X] T045 [P] [US4] 为 Launcher/pipe/Profile/capture/clipboard/storage 失败、稳定恢复动作、无无限重试、无禁止 source fallback、日志 DTO 脱敏与退出清 frame/preview/grant/token 编写失败测试，扩展 `tools/vision-author/__tests__/bootstrap.test.js`、`tools/vision-author/__tests__/protocol.test.js` 和 `tools/vision-author/__tests__/session.test.js`（FR-004、FR-025、FR-027～FR-029；US4-AC2/5；SC-009）

### Implementation

- [X] T046 [US4] 实现读取真实 `app.asar`/unpacked manifest 并断言 tool、bootstrap、bridge、UI、preload、start entry、协议标识为零且 `automation-scripts/**` 仍存在的 verifier，放入 `tools/vision-author/scripts/assert-package-excluded.js`（FR-029；US4-AC4；SC-010）
- [X] T047 [P] [US4] 收紧 op/DTO/log allowlist 与 disconnect/session close 清理顺序，更新 `tools/vision-author/bridge/protocol.js`、`tools/vision-author/bridge/server.js`、`tools/vision-author/bridge/session.js` 和 `tools/vision-author/launcher-bootstrap.js`，确保不返回 URL/Cookie/Session/Partition/webContents/path/raw fs error 且 child 退出不关闭游戏窗口（FR-025、FR-027～FR-029；US4-AC2/5）
- [X] T048 [P] [US4] 实现 `DISCONNECTED`、Profile unavailable、capture hung/failed、clipboard/storage failure 的有限恢复 UI，更新 `tools/vision-author/app/app.js` 与 `tools/vision-author/app/index.html`，禁用依赖失效目标的 Freeze/preview/save 且不提供 import/fallback（FR-004、FR-024～FR-025；SC-009）
- [X] T049 [US4] 在 Windows release workflow 的 unpacked 构建后调用发行排除 verifier，并保持正式 portable 构建与现有 packaged automation 正向 smoke，更新 `.github/workflows/build-release.yml`（FR-029～FR-030；SC-010）
- [ ] T050 [US4] 运行 US4 测试，并按 `specs/005-vision-author-tool/quickstart.md` §9～§11 执行真实双 Profile、断连清理、标准 `npm start` 无入口与 unpacked exclusion 验收，确认跨 Profile 混用、敏感字段、fallback 和发行入口计数均为 0（SC-006、SC-009～SC-010）

**Checkpoint**：四个 User Story 均可独立验收，Developer Tool 与正式 Launcher 发布边界有自动化和人工证据。

---

## Phase 7：Polish & Cross-Cutting Concerns

**Purpose**：完成全量回归、真实端到端效率验收、发行产物复核与范围审计。

- [X] T051 运行 `npm test -- --runInBand`，修复全部 `src/automation/__tests__/` 与 `tools/vision-author/__tests__/` 回归并保留测试先行断言强度，验证 `specs/005-vision-author-tool/spec.md` 的 SC-001～SC-007、SC-009（FR-030）
- [X] T052 运行 `npm run lint` 及 `npx eslint tools/vision-author/**/*.js src/automation/backend.js`，只修复本 Feature 文件问题且不得格式化无关源码，范围依据 `specs/005-vision-author-tool/plan.md`（FR-030）
- [ ] T053 按 `specs/005-vision-author-tool/quickstart.md` §3～§10、§12 用真实腾讯游戏 Profile 完成 2 分钟“选择→Freeze→Template/ROI→preview→save→copy examples”验收及全部错误恢复场景，确认不用外部截图/图片编辑器并记录未自动验证风险（SC-008～SC-009）
- [ ] T054 构建 unpacked 与 portable，运行 `tools/vision-author/scripts/assert-package-excluded.js` 和 `tests/runtime/packaged-automation-smoke.js`，核对标准 executable 无 pipe/window、Author 内容为 0 而可信脚本模板仍发布（FR-029～FR-030；SC-010）
  - 自动化部分已通过：unpacked/portable 构建、真实 `app.asar` 排除检查和 packaged automation smoke；标准 executable 启动时无 Author pipe/window 仍待人工观察。
- [X] T055 审计 `tools/vision-author/README.md`、`specs/005-vision-author-tool/quickstart.md`、`package.json` 与 `package-lock.json`：同步最终开发命令/覆盖后重启限制，确认无新依赖/lockfile 改写、无 GPL 源码或素材、无 OCR/公开 API/任意文件能力及其他 Out of Scope（FR-001、FR-030～FR-031）
- [X] T056 修复 Electron 11 真实启动：以显式 developer entry 替代 `NODE_OPTIONS --require`，归一正式 userData，保持 `start.ps1` 为 Windows PowerShell 5.1 可解析的纯 ASCII，禁止隐藏交互式 Author child，并通过真实启动核对 Launcher 窗口、可见 Author 窗口、随机 Pipe 各 1 且退出遗留进程 0（FR-001、FR-025、FR-029～FR-030；SC-009～SC-010）
- [X] T057 为 Profile 原地刷新、后台 Live tick 与拖拽实时选择框编写失败回归测试，并更新 Author BrowserWindow、toolbar 与 pointer 事件状态机；验证初始不可用 Profile 可在启动后刷新为可用、窗口失焦/被遮挡仍约 1 秒 capture、Template/ROI 拖动中实时显示但仅在 pointerup 提交（FR-002、FR-006、FR-012；US1-AC6/7、US2-AC6；SC-001、SC-003、SC-008）
- [X] T058 [US1] 为 Live 非帧状态 emit 重复设置同一大 PNG source 编写失败 Renderer 回归测试，并按 frameId 去重 `capture-image.src` 提交；验证 scheduled/pending/error/mode 更新写入数为 0、新 frame 写入数为 1，避免 Electron 11 持续取消图片解码导致 Freeze 后才可见（FR-007；US1-AC8；SC-001～SC-002）
- [X] T059 [US1] 用锁定 Electron 11 Renderer probe 复现默认 timer adapter 的 `TypeError: Illegal invocation`，为 timer host receiver 编写失败回归并改用 host-bound wrapper；验证 Profile selection/Resume 的 t0 capture 后可成功注册固定 ticker（FR-006；US1-AC9；SC-001）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**：无依赖，可立即开始。
- **Phase 2 Foundational**：依赖 Phase 1；T003～T005 的测试必须先失败，T006～T012 才可实现；阻塞全部 User Story。
- **Phase 3 US1**：依赖 Foundational；交付可独立演示的 MVP。
- **Phase 4 US2**：依赖 US1 的 displayed/pinned frame identity；只增加选择和 preview，不依赖保存。
- **Phase 5 US3**：依赖 US1 frozen frame 与 US2 PreviewArtifact；完成持久化和复制闭环。
- **Phase 6 US4**：结构性 release 测试 T043/T046 可在 Foundational 后提前并行；完整 multi-Profile、save 与发行验收依赖 US1～US3。
- **Phase 7 Polish**：依赖希望交付的全部 User Story 完成。

### User Story Dependency Graph

```text
Setup → Foundational → US1 (P1 / MVP) → US2 (P2) → US3 (P3) → Polish
                         │                 │          │
                         └────── US4 security/release boundary ──────┘
```

### Within Each User Story

- 先完成该 Story 的全部 Tests 任务并确认因目标行为未实现而失败。
- 数据/状态与纯逻辑先于 bridge operation wiring；bridge wiring 先于 UI 集成。
- 集成测试必须使用正式 backend/registry seam，不能用桌面截图、外部 PNG upload 或任意 path 绕过关键链。
- Story checkpoint 通过后再进入下一优先级；发现需求缺口时先回写 Spec/Plan，不在实现中臆测扩展。

## Parallel Opportunities

- Setup：T002 可在 T001 编写 README 时并行准备测试夹具。
- Foundational：T003、T004、T005 修改不同测试文件，可并行；T008、T009 在 T006/T007 contract 稳定后按 pipe client→preload allowlist 顺序接线。
- US1：T014、T015、T016 可并行先写红灯；T018 与 UI 静态布局 T021 可在 T017/T019 期间并行。
- US2：T024 与 T025 可并行；bridge crop T026 与静态 overlay T029 可并行，随后由 T027/T028 集成。
- US3：T031～T034 可并行先写红灯；T035 与 T039 可并行；T036/T037 完成 writer 后再执行 T038。
- US4：T043～T045 可并行；T046 可与 T047/T048 并行，T049 依赖 T046。
- Polish：T051 完成全量测试修复后再执行 T052 lint；真实 GUI/发行构建 T053/T054 串行，避免争用 Launcher/dist。

## Parallel Examples

### User Story 1

```text
并行：T014 session contract tests | T015 fake-timer live tests | T016 stale-response view tests
随后：T017/T018 → T019/T020/T022；T021 可与 bridge 实现并行
```

### User Story 2

```text
并行：T024 display mapping tests | T025 pixel crop tests
随后：T026 bridge preview 与 T029 UI overlay 可并行 → T027/T028 集成
```

### User Story 3

```text
并行：T031 catalog tests | T032 writer tests | T033 exact-byte flow test | T034 output tests
随后：T035 catalog 与 T039 generators 可并行；T036 → T037 → T038 → T040/T041
```

### User Story 4

```text
并行：T043 release boundary tests | T044 multi-Profile tests | T045 cleanup/error tests
随后：T046 verifier 与 T047/T048 可并行 → T049/T050
```

## Implementation Strategy

### MVP First（US1）

1. 完成 Setup 与 Foundational，锁定 developer-only bootstrap、private pipe 和正式 capture race。
2. 只实现 US1，交付 Profile→Live→Freeze→Resume。
3. 停止并执行 T023；未证明固定 tick、正式 capture 与 frozen identity 前，不进入选择/保存。

### Incremental Delivery

1. **US1**：证明画面来源、Profile 归属、Live/Freeze 竞态正确。
2. **US2**：在同一 frozen frame 上增加准确 Template/ROI 与 preview，不写文件。
3. **US3**：只用可信 registry 与 current preview exact bytes 完成保存/复制。
4. **US4**：完成最小暴露、多 Profile、失败恢复与正式发布排除证据。
5. **Polish**：全量回归、真实腾讯 Profile、2 分钟效率与 Windows artifact 验收。

## Notes

- `[P]` 只表示文件与依赖允许并行，不表示可跳过前置红灯或 Story checkpoint。
- 所有完整 frame、preview、token 与 grant 仅驻留当前 developer session 内存；任务不得新增 descriptor、长期缓存或普通日志落盘。
- `automation-scripts/**` 中开发者明确保存的 Template 是预期生产资产；`tools/vision-author/**` 与其专用入口必须完全不发布。
- 覆盖当前 Launcher 已缓存模板后，必须重启 developer Launcher 再做真实 runtime Vision 验证；V1 不增加 cache hot reload。
- 每完成一个任务或逻辑组即可提交；不要修改无关 dirty worktree 内容。
