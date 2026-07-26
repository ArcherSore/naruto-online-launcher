# Tasks: 腾讯国服扫码登录与游戏启动基础链路

**Input**: `/specs/001-tencent-game-launch/` 下的 `spec.md`、`plan.md`、`research.md`、`data-model.md`、`contracts/navigation-contract.md`、`quickstart.md`

**Tests**: 本 Feature 采用测试先行。每个用户故事先编写并运行自动化测试，确认测试因缺少目标行为而失败，再实现对应逻辑；不要求为 Red 阶段单独创建 Git commit。扫码、官方重定向、同进程 Session 复用、双 Profile 和 PPAPI 使用明确的 Windows 人工验收门。

**Organization**: 任务按可独立验证的增量组织。任何 Oasis 删除都位于替代流程通过测试和调用者审计之后。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 仅表示修改不同文件、且不依赖尚未完成任务的真正安全并行项
- **[Story]**: `[US1]`、`[US2]`、`[US3]` 对应 `spec.md` 用户故事
- 每项均包含具体文件路径和 FR/SC 追溯

---

## Phase 1: Setup（验证环境与证据模板）

**Purpose**: 固定既有运行时和测试基线，不初始化新项目、不升级依赖。

- [X] T001 运行 `node -v`、`npm -v`、相关 Jest、全量 Jest、PowerShell ESLint 等基线命令，并把版本、lockfile SHA-256、既有 `GpuDetector.test.js`/open-handle 问题记录到 `specs/001-tencent-game-launch/validation/baseline.md`（FR-007、FR-020）
- [X] T002 [P] 建立不含二维码、Cookie、票据、QQ 号和 URL query/fragment 的人工验收记录模板及阻塞规则，写入 `specs/001-tencent-game-launch/validation/README.md`（FR-013、FR-014、FR-019、SC-008）

**Checkpoint**: 运行时、锁文件和既有失败已留证；后续结果可与基线比较。

---

## Phase 2: Foundational（所有故事的阻塞基础）

**Purpose**: 优先建立 URL 分类、状态机、Session 映射和脱敏测试，再实现这些共同边界。

**⚠️ CRITICAL**: T003-T008 的测试/测试基础设施先完成；T009-T013 实现后，T014 必须通过，方可开始用户故事。尤其 T007→T013→T014 构成 G0 安全网络观察硬门，未通过时不得开始任何真实扫码、认证跳转或 Flash/CDN 观察，也不得进入 G1/G2。

### 先编写、运行并确认预期失败

- [X] T003 [P] 在 `src/config/__tests__/urls.test.js` 编写并运行腾讯 SELECTOR/GAME_MAIN 精确 scheme-host-port-path、仿冒 hostname、未知协议、query/fragment 丢弃和 safe location 测试，确认因缺少目标分类行为而失败（FR-001、FR-005、FR-014、FR-018）
- [X] T004 [P] 在新文件 `src/app/__tests__/TencentLaunchFlow.test.js` 编写并运行 `LaunchFlowState` 合法/非法迁移、阶段计数、UNKNOWN 阻止、恢复动作白名单和“不调用 clearStorageData”测试，确认因缺少目标状态行为而失败（FR-013、FR-015 至 FR-019）
- [X] T005 [P] 在 `src/profiles/__tests__/partition.test.js` 编写并运行同一 Profile 映射稳定 `persist:profile-<id>`、Profile A/B 映射不同、腾讯流程不使用 defaultSession/shadow 的测试，确认因缺少目标 Session 行为而失败（FR-008、FR-009、FR-020、SC-005）
- [X] T006 [P] 在 `src/utils/__tests__/logger.test.js` 编写并运行 URL query/fragment、Cookie/Authorization、`openid`、`access_token`、ticket、QQ 号和未知身份字段默认拒绝/脱敏测试，确认因缺少目标日志边界而失败（FR-014、FR-019、SC-008）
- [X] T007 **G0 失败测试（依赖 T006）**——在 `src/network/__tests__/inspector.test.js`、`src/utils/__tests__/diagnostics.test.js` 及相关 `src/ui/manager/__tests__/IpcRouter.test.js`/logger 测试中证明现有 inspector/诊断路径不得采集、保存、广播或写入日志：完整 URL、query/fragment、Cookie、Set-Cookie、Authorization、JWT、ticket、QQ 身份字段、请求体、响应体、页面源码；同时测试只允许 resource type、origin、pathname、status code、error code 且未知字段默认拒绝，运行并确认因现有敏感路径而失败（FR-014、FR-019、SC-008）
- [X] T008 [P] 扩充 `__mocks__/electron.js` 的 Electron 11 BrowserWindow、Session、`will-navigate`、`new-window`、redirect 和 partition 观测能力，包括认证子窗完整 webPreferences、无游戏业务 preload及子窗/二次 popup 递归导航事件，且不模拟新版 Electron API（FR-006、FR-018、FR-020）

### 实现共同边界

- [X] T009 实现单一腾讯入口、URL 角色枚举、精确分类和 `origin + pathname` 安全位置输出，修改 `src/config/urls.js` 直至 T003 通过（FR-001、FR-002、FR-005、FR-014、FR-018）
- [X] T010 新建纯内存状态机及有限计数/恢复动作校验骨架 `src/app/TencentLaunchFlow.js`，暂不接管现有 Launcher，直至 T004 的状态测试通过（FR-015 至 FR-019）
- [X] T011 固定腾讯 Profile 的持久 Session 映射，修改 `src/profiles/partition.js` 直至 T005 通过；旧 snapshot API 暂不删除但不得进入腾讯路径（FR-008、FR-009、FR-020）
- [X] T012 在 `src/utils/logger.js` 实现结构化字段 allowlist 和源头 URL/秘密脱敏，禁止调用者以完整 URL 字符串绕过，直至 T006 通过（FR-014、FR-019、SC-008）
- [X] T013 **G0 最小实现（依赖 T007）**——修改 `src/network/inspector.js`、`src/utils/diagnostics.js`、当前 inspector IPC/广播接线及 logger 边界，在任何真实观察前删除禁止字段的采集/保存/广播/日志路径，只保留 resource type、origin、pathname、status code、error code 的源头 allowlist并默认拒绝未知字段，直至 T007 全部通过；本阶段不按未来用途扩展字段（FR-014、FR-019、SC-008）
- [X] T014 **G0 闭合判定**——运行 T003-T013 的定向 Jest 与 PowerShell ESLint，确认 T007 的测试先失败、T013 后转绿，扫描 inspector/诊断/IPC/日志无禁止字段通路，并把结果及无 lockfile 变化记录到 `specs/001-tencent-game-launch/validation/foundation.md`；G0 未 PASS 时阻塞 T027/T030 及任何真实扫码、认证跳转或 Flash/CDN 观察（FR-014、FR-018 至 FR-020、SC-008）

**Checkpoint**: URL、状态、Session 和诊断边界已经自动验证；尚未删除任何 Oasis 模块。

---

## Phase 3: User Story 1 - 首次扫码并进入游戏（Priority: P1）🎯 MVP

**Goal**: 全新 Profile 在应用内打开腾讯官方扫码/选服页，手动选服后在原 PPAPI 游戏窗口加载并交互游戏。

**Independent Test**: 使用无腾讯登录态的全新 Profile 完成扫码、选服和进入游戏；游戏不进入外部浏览器，内容可见并响应一次正常鼠标操作。

### 先编写、运行并确认预期失败

- [X] T015 [P] [US1] 在 `src/app/__tests__/Launcher.test.js` 编写并运行默认加载腾讯 SELECTOR、保持 `plugins:true`/独立 partition、挂接 TencentLaunchFlow、且不安装 Oasis blocker/cookie/pre-auth 的测试，确认因缺少目标 Launcher 行为而失败（FR-001 至 FR-003、FR-006、FR-020）
- [X] T016 [P] [US1] 扩充并运行 `src/app/__tests__/TencentLaunchFlow.test.js`：覆盖 SELECTOR→AUTH/SELECTOR→GAME_MAIN、同页 redirect、游戏 `new-window` 回原窗口；认证子窗共享父 Profile partition，固定 `plugins:false`、`nodeIntegration:false`、`contextIsolation:true`、`webSecurity:true`、`allowRunningInsecureContent:false`、`enableRemoteModule:false`、`webviewTag:false`、不加载游戏业务 preload，并用自动化或本地受控 fixture 对自身 navigate、redirect、`new-window`、二次 popup 递归精确分类，UNKNOWN 可恢复阻止；页面探针只测试接口、空 selector registry、boolean/enum、数据禁区、仅可信 `did-finish-load` 后调用、每次顶层加载 1 次、单次窗口 `LaunchFlow` 生命周期内每 stage 3 次/全流程 12 次、用户重启窗口后重置、3 秒超时、无无限 timer/interval、失败不清 Session并保持安全状态；确认测试因缺少目标行为而失败。全局 `no-sandbox` 仅作为已知基线，不在测试中要求本 Feature 修改（FR-004 至 FR-006、FR-013、FR-014、FR-017、FR-018、SC-002、SC-008）
- [X] T017 [P] [US1] 在 `src/profiles/__tests__/store.test.js` 编写并运行新 Profile 不依赖 region/server/language/vault、旧 Profile 仅保留通用元数据且旧字段不再驱动入口的测试，确认因缺少目标迁移行为而失败（FR-001、FR-012、SC-007）
- [X] T018 [P] [US1] 在 `src/ui/manager/__tests__/IpcRouter.test.js` 和 `src/ui/manager/__tests__/StateBroadcaster.test.js` 编写并运行正常 Profile create/update/launch 只接受通用字段、状态广播不含凭据/服务器/JWT，且 Vault/tempmail/server/JWT/cookie value/pageSource IPC 不再注册的测试，确认因缺少目标 IPC/广播边界而失败（FR-003、FR-012 至 FR-014、FR-019）
- [X] T019 [P] [US1] 新建并运行 `src/ui/__tests__/tencent-ui.test.js`，覆盖管理页不存在 Oasis、国际服 region/server、邮箱、密码、tempmail、旧凭据备份和自动登录可见控件，确认测试因旧控件仍存在而失败（FR-003、FR-012、SC-007）

### 实现最小腾讯主链

- [X] T020 [US1] 在 `src/app/TencentLaunchFlow.js` 实现 SELECTOR 加载、Electron 11 顶层导航/redirect/`new-window` 路由、GAME_MAIN 原 PPAPI 窗口接管；认证子窗按 T016 固定全部安全选项、不加载游戏业务 preload，并让子窗及二次 popup 的 navigate/redirect/`new-window` 递归使用同一精确分类器。页面探针初始只实现接口、空 selector registry、boolean/enum、数据禁区及“可信 `did-finish-load` 后/每次加载 1 次/单次窗口 `LaunchFlow` 生命周期每 stage 3 次且全流程 12 次/重启窗口重置/3 秒超时/无无限轮询/失败不清 Session并保持安全状态”的预算，不加入未经 T027-T029 Windows 验证的生产 selector（FR-002、FR-004 至 FR-006、FR-013、FR-014、FR-017、FR-018）
- [X] T021 [US1] 在 T020 测试通过后，把 `src/app/SessionLifecycle.js` 收敛为通用 load/close/crash 生命周期，移除启动前 Vault/API、表单注入、JWT renewal、Oasis CSS/`#oas-player`/FB mock 和 `logintype` 导航行为（FR-003、FR-012、FR-013）
- [X] T022 [US1] 修改 `src/app/Launcher.js` 接入 TencentLaunchFlow 和腾讯 SELECTOR，保留窗口 registry、PPAPI、preload 与独立 partition，并停止安装 `src/network/blocker.js`、`src/network/cookies.js` 和宽松 CSP 覆盖（FR-001、FR-002、FR-006、FR-018、FR-020）
- [X] T023 [US1] 修改 `src/profiles/store.js`，让新建/导入 Profile 只保留通用元数据并执行非敏感旧字段迁移，确保 region/server/language/credentials 永不参与 URL 或正常流程（FR-001、FR-012、SC-007）
- [X] T024 [US1] 修改 `src/main.js`、`src/ui/manager/IpcRouter.js`、`src/ui/manager/StateBroadcaster.js`、`src/ui/controller.js`，移除正常启动中的 Vault/tempmail/server/JWT、备份流程中的 Oasis 凭据字段/凭据 IPC/自动登录用途及 cookie value/pageSource 等敏感 debug IPC 接线并广播安全流程状态；若备份仍承载通用 Profile 元数据，本阶段保留该通用能力，其最终去留交由 T059/T062 调用者审计（FR-003、FR-012 至 FR-014、FR-019）
- [X] T025 [US1] 修改 `src/ui/index.html`、`src/ui/app.js`、`src/ui/styles.css`，将创建/编辑/启动界面收敛为腾讯 Profile 和流程状态，删除所有用户可见 Oasis、国际服、账号密码、tempmail、旧凭据备份和自动登录入口（FR-001、FR-003、FR-012、SC-007）
- [X] T026 [US1] 运行 US1 定向测试与基础回归，把结果和仍存在但不可达的 Oasis 文件列表记录到 `specs/001-tencent-game-launch/validation/us1-automated.md`；测试未通过不得进入人工 host 门（FR-001 至 FR-007、SC-001、SC-002、SC-007）

### Windows 运行时验证门

- [X] T027 [US1] **G1 第 1 轮发现（硬依赖 G0/T014 PASS）**——允许使用测试账号执行明确标记为 non-SC 的发现扫码；导航记录只能包含 `role/origin/pathname/disposition/frame`，当轮只提出一个精确 `scheme/hostname/port/path` 或 popup disposition 候选。另行人工 DevTools 探针发现只记录 selector 名称、存在性和安全 boolean/enum；不得记录源码、表单值、文本或身份数据。只记录腾讯流程自然出现的认证子窗 navigate/redirect/`new-window`/二次 popup；未自然出现的事件记为有理由的 `N/A`，由 T016 的自动化或本地受控 fixture 验证通用 handler，不得修改腾讯页面来触发。UNKNOWN 保持阻止并将证据写入 `specs/001-tencent-game-launch/validation/windows-navigation-discovery.md`（FR-002、FR-003、FR-013、FR-014、FR-018）
- [X] T028 [US1] **G1 有界发现循环（依赖 T027，最多 5 轮）**——每轮只批准 T027/上一轮重新发现的一条精确 URL 元组或 popup disposition。若仅补充精确 host/path、既有能力的 selector 或具体兼容参数，依次更新 `research.md`、`plan.md`、相关契约和失败测试；若发现改变产品需求、Feature 范围、安全边界、验收标准、成功率分母或增加用户能力，立即停止 Gate，先更新 `spec.md`，再同步 Plan、Tasks、契约，重新执行 Constitution Check 并完成一致性确认。同步完成后才可添加并运行预期失败测试、实施单条精确规则/经验证 selector、运行定向和前序回归、重新发现下一跳。禁止在代码中静默扩大范围/安全例外，禁止通配、suffix/substring、宽泛 port/path、动态 allowlist 和扩大探针数据；第 5 轮仍未闭合、出现无法解释导航或需要宽泛规则时停止并请求人工评审（FR-003、FR-013、FR-014、FR-018）
- [X] T029 [US1] **G1 闭合判定**——审计 G0/T014 前置证据、T027-T028 每轮规格同步分流、文档→失败测试→精确实现→回归顺序及最终认证 redirect 链；父窗和认证子窗 navigate/redirect/`new-window`/二次 popup 必须由自然实测或 T016 自动化/本地受控 fixture 覆盖，未自然出现的人工场景须有理由的 `N/A` 且不得修改腾讯页面。只有子窗安全配置完整、UNKNOWN 失败分支可恢复且不存在未完成的 Spec/Plan/Tasks/契约/Constitution 同步时标记 G1 PASS，否则保持阻塞且不得执行 T030（FR-002、FR-003、FR-017、FR-018）
- [X] T030 [US1] **G2 闭环门：最多 3 个修订轮次（硬依赖 G0/T014 与 G1/T029 PASS）**——在 Windows Electron 11/内置 `flash/pepflashplayer.dll` 下运行完整游戏启动；一轮定义为“一次完整启动发现的一组阻塞事实，加上对应修订和回归”，仅处理阻塞当前完整场景的新 SWF/CDN 精确 host-path、mixed-content、`crossdomain.xml`/policy、安全 flag 或经 DevTools 验证的页面信号。技术事实走 Research/Plan/契约/失败测试分支；任何产品需求、范围、安全边界、验收标准、成功率分母或新用户能力变更必须停止 Gate，先更新 Spec，再同步 Plan/Tasks/契约、重跑 Constitution Check 和一致性确认；不得在代码中静默扩大范围/安全例外。随后实施最小规则并运行自动回归。完整启动必须达到应用内游戏窗口、内容可见和一次鼠标响应；修订后连续 2 次完整启动没有新阻塞资源、DOM 信号或安全配置要求时 G2 PASS，均标记 non-SC 且不额外消耗修订轮次。消耗第 3 个修订轮次后仍不稳定则停止并请求人工评审；禁止通配网络规则、宽泛 allowlist、静默关闭安全能力或敏感捕获，证据写入 `specs/001-tencent-game-launch/validation/windows-ppapi.md`（FR-006、FR-007、FR-013、FR-014、SC-003）
- [X] T031 [US1] **正式 `3/3` 启动矩阵（仅 G1/G2 PASS 后）**——使用相互独立的全新 Profile 连续执行 3 次扫码、官方确认、手动选服、GAME_MAIN 内部导航和鼠标交互；每个实例记录 `game_internal`、`content_visible`、`mouse_response`，三项全 PASS 才计入 passed。要求 SC-001、SC-002、SC-003 均为 `3/3` 且系统浏览器承载游戏 0 次，写入 `specs/001-tencent-game-launch/validation/windows-scan-redirect.md`（FR-002 至 FR-007、SC-001、SC-002、SC-003）
- [X] T032 [US1] 汇总 T015-T031 自动与人工证据到 `specs/001-tencent-game-launch/validation/us1-checkpoint.md`，确认 G1 发现扫码和 G2 稳定性启动均未计入 SC，且正式矩阵每次 `game_internal`、`content_visible`、`mouse_response` 全 PASS；仅在 SC-001/SC-002/SC-003 均为 `3/3` 且 SC-007 通过时标记 US1 MVP 完成（US1、SC-001 至 SC-003、SC-007）

**Checkpoint**: US1 是可独立演示的 MVP；Oasis 文件仍未批量删除，只从正常流程断开。

---

## Phase 4: User Story 2 - 复用有效登录状态（Priority: P2）

**Goal**: Electron 主进程保持运行时，同一 Profile 关闭并重开游戏窗口可复用腾讯认可的有效 Session；失效后回官方扫码；A/B Profile 完全隔离。

**Independent Test**: 保持 Electron 主进程运行，分别验证同 Profile 关闭并重开游戏窗口后的有效/失效会话，并让 Profile A 失效、重登、关闭或 reload，确认 Profile B 不受影响。

### 先编写、运行并确认预期失败

- [X] T033 [P] [US2] 在 `src/profiles/__tests__/manager.test.js` 编写并运行 launch/close 始终使用稳定 persist partition、不调用 restoreCookies/snapshotCookies/Vault、同一 ID 复用、同一 Profile 同时最多一个游戏窗口且 A/B 的 Session/窗口状态/恢复计数分离的测试；旧 snapshot API 暂保留但从腾讯路径不可达，确认测试因缺少目标 Session 生命周期行为而失败（FR-008、FR-009、FR-020、SC-004、SC-005）
- [X] T034 [P] [US2] 在 `src/ui/manager/__tests__/KeyboardShortcuts.test.js` 编写并运行 F5 委托安全的当前角色 reload、且不调用 `clearStorageData`、API login 或密码预认证的测试，确认因缺少目标 reload 行为而失败（FR-010、FR-011、FR-013）
- [X] T035 [P] [US2] 扩充并运行 `src/app/__tests__/TencentLaunchFlow.test.js`，覆盖官方回 SELECTOR/AUTH 时进入 `SESSION_REJECTED`、重新扫码后回 SELECTOR_READY、不会自动选服/进入游戏/清 Session，确认因缺少目标失效恢复行为而失败（FR-010、FR-011、FR-013）

### 实现会话复用与失效恢复

- [X] T036 [US2] 修改 `src/profiles/manager.js`，断开 launch/close 对 shadow restore/snapshot 和凭据状态协调的调用，只用 T011 的 persist mapping、单游戏窗口 registry 与 MemoryGuard；本任务不删除旧 snapshot API 或实现（FR-008、FR-009、FR-020）
- [X] T037 [US2] 修改 `src/ui/manager/KeyboardShortcuts.js`、`src/app/Launcher.js`，让 F5/reload 委托 TencentLaunchFlow 的当前安全角色 reload，并删除 `reloadWithPreAuth` 调用链（FR-010、FR-011、FR-013）
- [X] T038 [US2] 在 `src/app/TencentLaunchFlow.js` 实现基于已验证 SELECTOR/AUTH 导航信号的 session rejected/重新扫码状态迁移，不检查或解码 Cookie/票据值（FR-010、FR-011、FR-013、FR-015）
- [X] T039 [US2] 修改 `src/ui/manager/StateBroadcaster.js`、`src/ui/app.js`，显示安全的“会话被官方拒绝/请重新扫码”状态且不显示账号身份，不自动选择区服（FR-010、FR-011、FR-014、FR-019）
- [X] T040 [US2] 运行 US2 定向测试和 US1 回归，把结果记录到 `specs/001-tencent-game-launch/validation/us2-automated.md`；失败时不得进入 G3 Session 复用/隔离人工门（FR-008 至 FR-011、SC-004、SC-005）

### Windows 会话验证门

- [X] T041 [US2] **G3a 同进程 Session 复用人工验收**——在 Windows 同一 Profile 扫码后保持管理窗口和 Electron 主进程运行，只关闭并重开该 Profile 的游戏窗口；有效 Session 复用连续执行 2 次，记录 `passed/attempted=2/2`，确认无需扫码且仍手动选服。证据只记录内部 Profile 代号、阶段、结果及必要的 Cookie 名/域/flags/存在性，不记录值；完整退出 Electron 进程后的行为不计入矩阵。结果写入 `specs/001-tencent-game-launch/validation/windows-cookie-persistence.md`（FR-008、FR-010、SC-004）
- [X] T042 [US2] **G3b 会话失效人工验收**——保持 Electron 主进程运行，使用腾讯官方 logout、测试撤销或自然过期使同一 Profile 失效；返回扫码流程连续执行 2 次，记录 `passed/attempted=2/2`，确认无需删除 Profile/Session 数据，写入 `specs/001-tencent-game-launch/validation/windows-session-expiry.md`（FR-011、SC-004）
- [X] T043 [US2] **G3c 双 Profile 隔离人工验收**——Profile A/B 分别扫码两个测试账号，保持 Electron 主进程运行并执行 A 的关闭、重开、失效和重新扫码，确认 B 的 Cookie/page/state/retry 均不变，写入 `specs/001-tencent-game-launch/validation/windows-two-profile-isolation.md`（FR-009、FR-020、SC-005）
- [X] T044 [US2] **G3d shadow 生产路径不可达验证**——仅验证腾讯生产 launch/close/reload/失效/恢复路径均不调用 snapshot/restore、旧 API 保持不可达且应用不清腾讯认证存储；不得删除 API、实现或旧模块自测。实际删除只能在 T059 区分生产调用者与旧自测并确认无其他生产用途后，由 T062 原子执行（FR-008、FR-009、FR-013）
- [X] T045 [US2] 重新运行 US1+US2 测试并汇总 T033-T044 到 `specs/001-tencent-game-launch/validation/us2-checkpoint.md`；仅在 SC-004 的有效 `2/2`、失效 `2/2` 与 SC-005 全部通过时标记 US2 完成（US2、SC-004、SC-005）

**Checkpoint**: 会话复用、失效回扫码和双 Profile 隔离已由真实 Windows Session 证明。

---

## Phase 5: User Story 3 - 从启动失败中可靠恢复（Priority: P3）

**Goal**: 未认证登录 UI、已认证选服页、游戏跳转和游戏加载失败各有独立阶段、有界自动恢复以及契约限定的用户恢复动作。

**Independent Test**: 分开模拟“无有效 Session 的登录 UI 加载失败”和“有效 Session 的选服页加载失败”，分别记录阶段、动作与 Session 保留；再模拟进入游戏跳转失败、游戏/SWF 加载失败、renderer crash 和会话中途失效，每类都显示正确阶段并停止无限刷新。

### 先编写、运行并确认预期失败

- [X] T046 [P] [US3] 扩充并运行 `src/app/__tests__/TencentLaunchFlow.test.js`，分别覆盖未认证登录 UI、已认证选服页、游戏跳转、游戏加载四类错误映射，并逐项验证 `RELOAD_SELECTOR`、`REOPEN_AUTH`、`RETRY_GAME_NAVIGATION`、`RELOAD_GAME`、`RETURN_TO_SELECTOR` 的允许阶段、来源、重试上限、内存 URL 销毁和不清 Session；覆盖达到上限进入 `waiting_user`、非核心外链/UNKNOWN 失败终态，确认因缺少目标恢复行为而失败（FR-015 至 FR-018、SC-006）
- [X] T047 [P] [US3] 重写并运行 `src/app/__tests__/SessionLifecycle.test.js` 的失败/crash 断言，要求按当前角色委托流程、不得 raw reload 未知 URL、不得清 Session、10 分钟 crash 上限后等待用户，确认因当前生命周期行为不符而失败（FR-015 至 FR-017）
- [X] T048 [P] [US3] 扩充并运行 `src/app/__tests__/StallDetector.test.js`，要求只在 GAME_LOADING/GAME_READY 启用、selector/auth 不判 stall、SWF 错误只输出 origin/path/errorCode 且不含 query，确认因当前 stall 行为不符而失败（FR-014、FR-015、FR-017、FR-019）
- [X] T049 [P] [US3] 在 `src/ui/manager/__tests__/IpcRouter.test.js`、`src/ui/manager/__tests__/StateBroadcaster.test.js` 编写并运行 recovery action 白名单、profileId/stage/errorCode 安全广播、跨 Profile action 拒绝测试，确认因缺少目标 IPC/隔离行为而失败（FR-009、FR-015、FR-016、FR-019）

### 实现阶段化失败恢复

- [X] T050 [US3] 在 `src/app/TencentLaunchFlow.js` 实现未认证 auth/已认证 selector/navigation/game 独立计数、有界自动重试、`waiting_user` 及完整恢复动作 allowlist；严格执行契约的阶段、来源、上限和内存 URL 生命周期，所有动作保留 Session 且不影响其他 Profile（FR-009、FR-015 至 FR-017、FR-020、SC-006）
- [X] T051 [US3] 修改 `src/app/SessionLifecycle.js`，把 `did-fail-load`、render-process-gone、unresponsive/responsive 委托给 TencentLaunchFlow，保留关闭清理并移除通用 raw reload/旧 Oasis 错误页（FR-015 至 FR-017）
- [X] T052 [US3] 修改 `src/app/StallDetector.js`，仅在腾讯游戏加载/就绪阶段监听 SWF/网络停滞，复用有限重试并通过 logger 输出安全资源位置（FR-014、FR-015、FR-017、FR-019）
- [X] T053 [US3] 在 `src/ui/loading/loading.html`、`src/preload.js`、`src/ui/manager/IpcRouter.js`、`src/ui/manager/StateBroadcaster.js`、`src/ui/app.js`、`src/ui/styles.css` 实现固定 recovery action bridge、阶段化本地错误页、安全状态广播和适用按钮；renderer 不能提交任意 URL、Profile 或清 Session 请求，UI 不显示完整 URL/身份参数（FR-009、FR-014 至 FR-016、FR-019）
- [X] T054 [US3] 检查 `TencentLaunchFlow`、IPC 和 UI 的动作来源/阶段矩阵，运行 T046-T053 定向测试并修正不一致；确认五个动作均有成功路径和达到上限/非法来源/跨 Profile 拒绝的失败分支（FR-009、FR-015 至 FR-017、FR-020、SC-006）
- [X] T055 [US3] 运行 US3 定向测试与 US1/US2 回归，把结果记录到 `specs/001-tencent-game-launch/validation/us3-automated.md`；失败时不得开始人工故障验收（FR-015 至 FR-019、SC-006、SC-008）

### Windows 故障与安全人工验收

- [X] T056 [US3] **管理卡片故障恢复降级验收**——依据用户 2026-07-26 的最终决策，
  撤销认证超时失败收敛；删除管理卡片的流程状态说明和动态恢复按钮，未启动主按钮改为“打开”，
  运行中常态显示“刷新”。“刷新”必须通过 Profile ID 委托所属 `LaunchFlow.reloadCurrentRole()`，
  拒绝不存在或未运行的 Profile，不接受任意 URL、不清 Session。完成定向及相关回归后，将此前
  AUTH 故障识别尝试、降级原因、按钮/IPC 验证和 `passed/attempted` 记录到
  `specs/001-tencent-game-launch/validation/windows-failure-recovery.md`
  （FR-013 至 FR-017、SC-006）
- [X] T057 [US3] **四类故障刷新验收**——分别对未认证登录 UI、有效 Session 的 SELECTOR、进入游戏跳转和 SWF/CDN/游戏内容制造故障，确认管理卡片始终提供“刷新”，每次只重载当前已分类安全角色、自动恢复有界且 Session 保留；另验证 renderer crash/unresponsive 和会话中途失效不删除数据，写入同一验证文档的独立场景（FR-015 至 FR-018、SC-006）
- [X] T058 [US3] 覆盖扫码、复用、失效和四类失败后检查普通日志/错误页/诊断包，确认无完整 Cookie、ticket、QQ 密码、QQ 号、query/fragment、pageSource，写入 `specs/001-tencent-game-launch/validation/windows-sensitive-log-audit.md`；汇总 T046-T057 到 `specs/001-tencent-game-launch/validation/us3-checkpoint.md`，仅在 SC-006 规定矩阵、SC-008、Session 保留及无无限刷新全部通过时标记 US3 完成（US3、FR-014、FR-019、SC-006、SC-008）

**Checkpoint**: 三个用户故事均独立可验收，替代流程和安全恢复已经通过自动与 Windows 实测。

---

## Phase 6: Polish & Cross-Cutting Concerns（验证后清理与最终回归）

**Purpose**: 只有在 US1/US2/US3 检查点全部通过后，分类审计并清理 Oasis 专用模块；inspector 的敏感捕获已由 G0/T007-T014 在真实观察前消除，本阶段只按当前用途决定保留安全元数据能力或删除；shadow 在确认无其他生产用途后原子删除。

- [X] T059 使用 `rg` 从 `src/main.js`、`src/app/`、`src/profiles/`、`src/ui/`、`src/network/` 和测试追踪 Oasis URL、Vault、JWT、tempmail、region/server、blocker/cookies、Profile 备份、CryptoService 以及 shadow `snapshotCookies`/`restoreCookies`/明文 JSON API 的全部引用；明确区分生产可达调用者、验证生产路径“不调用”的测试，以及仅验证旧 snapshot 模块自身行为的测试。另依据已完成的 G1/G2 和故障诊断证据评估是否保留 G0 已验证的安全网络元数据能力，不以调用者为零或未来自动化作为结论，也不得重新引入 G0 禁止字段。把分类、替代测试和 inspector 保留/删除决策写入 `specs/001-tencent-game-launch/validation/oasis-caller-audit.md`；任何其他生产用途都阻塞相应删除（FR-008、FR-009、FR-012 至 FR-014、SC-007、SC-008）
- [X] T060 [P] 仅对 T059 证明零生产调用者的凭据/认证栈，删除 `src/network/api-login.js`、`src/network/tempmail.js`、`src/utils/jwt.js`、`src/profiles/ProfileVault.js`、`src/profiles/PasswordManager.js`、`src/profiles/vault.js` 及各自 `__tests__`，不得为了旧测试保留兼容 facade；同时评估 `CryptoService`/Profile 备份是否仍有非凭据用途，无则删除，有则仅保留通用非敏感元数据能力并记录理由（FR-003、FR-012、FR-013、SC-007）
- [X] T061 [P] **安全网络观察去留（依赖 T059，且不得承担首次敏感处置）**——若 T059 证明本 Feature 当前仍需要网络元数据，则保留 G0 已验证的 resource type、origin、pathname、status code、error code allowlist并运行 T007 回归；若证明无当前用途，则删除 inspector 模块与当前调用链并运行替代诊断回归。两种分支都不得重新引入完整 URL、query/fragment、Cookie/Set-Cookie/Authorization、JWT/ticket/QQ 身份字段、请求体/响应体/页面源码。同时仅对 T059 证明零生产调用者的 Oasis server/network 改写栈执行删除，确认未加入腾讯 Cookie/CSP/`crossdomain.xml` 替代改写（FR-012 至 FR-014、SC-007、SC-008）
- [X] T062 **shadow snapshot 原子删除（依赖 T059）**——仅在 T059 确认 snapshot/restore 无其他生产用途后，在一个原子任务中删除 `src/profiles/partition.js` 的旧 API、实现、明文 JSON 路径及仅验证旧 snapshot 自身的测试；新增或保留 persist-only partition 回归与 manager“腾讯生产路径不调用 snapshot/restore”测试作为替代，并运行这些新断言。不得要求删除后重新运行已删除的旧 snapshot 断言；若存在其他生产用途则停止并人工评审（FR-008、FR-009、FR-013）
- [X] T063 再次用 `rg` 验证 `src/main.js`、`src/app/SessionLifecycle.js`、`src/app/Launcher.js`、`src/profiles/manager.js`、`src/ui/manager/IpcRouter.js`、`src/ui/app.js`、`src/ui/index.html` 不含残余可达 Oasis 正常流程引用，并确认 T061 的 inspector 结果要么不存在、要么只暴露安全网络元数据；把零调用者/零可见项和安全 inspector 结果写入 `specs/001-tencent-game-launch/validation/oasis-removal.md`，若仍有调用者或敏感捕获则停止并返回所属替代任务（FR-012、FR-014、SC-007、SC-008）
- [X] T064 **轻量静态安全/范围审计**——使用 `rg` 和逐命中人工分类检查生产代码：不存在腾讯认证票据解析、解密、复制、延寿或重放；不存在未经 Spec 授权的腾讯认证 API 构造；不存在自动点击、自动选服、游戏自动化 IPC、handler 或 command queue。排除仅测试名称、注释和安全拒绝断言后，把命中、判定和零生产可达结论写入 `specs/001-tencent-game-launch/validation/static-security-audit.md`（FR-003、FR-013、FR-020）
- [X] T065 运行全量 `npm test -- --runInBand`、定向 Jest 和 PowerShell ESLint，区分本 Feature 回归与既有 Windows `GpuDetector.test.js`/open-handle 基线，并运行 FR/SC→设计→任务引用、任务 ID/依赖、G1/G2/G3 成功与失败分支的文档一致性检查，把结果写入 `specs/001-tencent-game-launch/validation/final-automated.md`（FR-001 至 FR-020）
- [X] T066 执行 `npm run build:win` 并在 Windows portable 包按规定分母完整复跑：正式全新 Profile 启动矩阵 `3/3`，每个实例的 `game_internal`、`content_visible`、`mouse_response` 全 PASS；保持 Electron 主进程运行时，同一 Profile 关闭并重开游戏窗口后的有效 Session 复用 `2/2`、失效 Session 返回扫码 `2/2`，以及双 Profile、四类独立故障恢复。逐组记录 `passed/attempted`，并确认完整进程重启、G1 发现扫码及 G2 稳定性启动未混入正式分母，写入 `specs/001-tencent-game-launch/validation/windows-portable-release.md`（SC-001 至 SC-006、SC-008）
- [X] T067 对比实现前后 `package-lock.json` SHA-256 和 Node/npm/Electron/Flash 版本，检查 `specs/001-tencent-game-launch/validation/` 不含敏感证据，并在 `specs/001-tencent-game-launch/validation/final-checklist.md` 逐项签核 FR-001 至 FR-020、SC-001 至 SC-008（FR-001 至 FR-020、SC-001 至 SC-008）

---

## Runtime Validation Gates

- **G0（T007→T013→T014）**: 先以失败测试证明 inspector/诊断/IPC/日志不能采集、保存、广播或记录禁止内容，再仅允许 resource type、origin、pathname、status code、error code，未知字段默认拒绝。G0 PASS 是任何真实扫码、认证跳转、Flash/CDN 观察及 G1/G2 的硬前置；Phase 6 只决定安全能力去留。
- **统一规格同步条件**: 运行时只补充精确 host/path、已存在能力的 DOM selector、CDN 地址或具体兼容参数时，更新 Research/Plan/契约和失败测试；若改变产品需求、Feature 范围、安全边界、验收标准、成功率分母或增加用户能力，立即停止 Gate，先更新 Spec，再同步 Plan/Tasks/契约，重新执行 Constitution Check 和文档一致性确认。未完成同步不得继续实现，且不得在代码中静默扩大范围或安全例外。
- **G1（T027-T029）**: 仅在 G0 PASS 后开始，最多 5 轮；允许测试账号 non-SC 发现扫码且只记录 `role/origin/pathname/disposition/frame`。每轮只批准一个精确 scheme/hostname/port/path 或 disposition，并按统一规格同步条件完成文档、失败测试、精确实现、回归、重新发现。父窗和认证子窗递归导航链闭合是成功路径；官方流程未自然出现的 popup/二次 popup/redirect 由自动化或本地受控 fixture 验证 handler，人工腾讯流程记录有理由的 `N/A`，不得修改腾讯页面。达到上限、无法解释、需要宽泛规则或规格同步未完成时停止并人工评审，均保持 Session 且阻塞 T030。
- **G2（T030）**: 仅在 G0/G1 PASS 后开始，最多 3 个修订轮次；一轮是一次完整启动发现的一组阻塞事实及其对应修订和回归。修订后连续 2 次完整启动无新阻塞资源、DOM 信号或安全配置要求即 PASS，稳定验证不额外消耗修订轮次。消耗第 3 个修订轮次后仍不稳定，需要通配网络规则、宽泛 allowlist、静默关闭安全能力，或规格同步未完成时人工评审；G2 PASS 才能执行 T031 正式 `3/3`。
- **G3（T041-T044）**: 同一 Electron 主进程内的 Session 复用、会话失效和双 Profile 隔离必须在真实 Windows Electron 11 Session 中通过；完整进程退出后的免扫码不属于矩阵。T044 只验证腾讯路径不调用 shadow snapshot/restore 且旧能力不可达，不删除 API/实现。实际删除依赖 T059 调用者审计并由 T062 执行。
- 任一 Gate 失败都阻塞对应故事 Checkpoint 和 Phase 6 Oasis 删除。

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: 无依赖。
- **Phase 2 Foundational**: 依赖 Phase 1；T003-T008 先于 T009-T013；T007→T013→T014 是 G0，T014 阻塞全部用户故事以及任何真实扫码/认证/Flash/CDN 观察。
- **Phase 3 US1**: 依赖 T014/G0 PASS；T015-T019 测试先行，T020-T025 实现，T026 自动门，T027-T029 为 G1，T030 为 G2，T031 为正式 `3/3`，T032 为 MVP Checkpoint。G1/G2 发现触发规格变更分支时，必须先完成 Spec→Plan/Tasks/契约→Constitution Check→一致性确认依赖链。
- **Phase 4 US2**: 依赖 T032；T033-T035 测试先行，T041-T044 为 Session 隔离/旧能力不可达硬门；本阶段不删除 shadow API/实现。
- **Phase 5 US3**: 功能上依赖 T032；为避免同时修改 `TencentLaunchFlow.js`、`SessionLifecycle.js` 和 UI，推荐在 T045 后顺序执行。
- **Phase 6 Cleanup**: 依赖 T032、T045、T058；T059 分类审计阻塞 T060-T062，T061 只执行 G0 安全元数据能力的保留或删除决策，不负责首次敏感处置；shadow 原子删除只能在 T059 证明无其他生产用途后由 T062 执行；T064 完成静态安全/范围审计，所有清理完成后执行 T063-T067。

### User Story Dependency Graph

```text
Setup → Foundational → US1 (MVP)
                           ├──→ US2 ──┐
                           └──→ US3 ──┴──→ Caller Audit → Oasis Cleanup → Final Validation
```

### User Story Dependencies

- **US1 (P1)**: 建立完整首登闭环，是 MVP 和后续真实 Session/恢复验证的前提。
- **US2 (P2)**: 依赖 US1 的持久 Profile 窗口，但可用“有效/失效会话+A/B Profile”独立验收。
- **US3 (P3)**: 依赖 US1 的导航状态，但可用故障注入独立验收；不依赖 US2 的验收结果来定义错误行为。
- **Oasis 清理**: 不属于任一故事的先决条件；只能在三个故事替代流程通过后进行。

### Within Each User Story

1. 先编写并运行测试，确认会因缺少目标行为而失败；无需为 Red 阶段单独创建 Git commit。
2. 实现最小逻辑使定向测试通过。
3. 运行前序故事回归。
4. 执行 Windows 人工 Gate；G1/G2 发现新事实时先按统一规格同步条件分流，再按各自闭环顺序更新设计、失败测试、最小实现和回归，满足停止条件时请求人工评审。
5. Checkpoint 通过后再进入下一增量。

---

## Parallel Opportunities

### Foundational

```text
可并行：T003、T004、T005、T006、T008
随后顺序：T006 → T007（G0 失败测试）→ T013（G0 最小实现）→ T014（G0 闭合）；T009-T012 可按各自测试依赖执行。
原因：T007 会复用 logger/diagnostics/IPC 测试边界，不能与 T006 并行；G0 必须在真实网络观察前形成明确的测试→实现→闭合依赖。
```

### User Story 1

```text
可并行：T015、T016、T017、T018、T019
必须顺序：T020 → T021 → T022 → T023 → T024 → T025 → T026 → T027 → T028（G1 每轮循环）→ T029 → T030（G2 最多 3 个修订轮次；稳定验证不消耗轮次）→ T031（正式 `3/3`）→ T032
```

### User Story 2

```text
可并行：T033、T034、T035
必须顺序：T036 → T037 → T038 → T039 → T040 → T041 → T042 → T043 → T044 → T045
```

### User Story 3

```text
可并行：T046、T047、T048、T049
必须顺序：T050 → T051 → T052 → T053 → T054 → T055 → T056 → T057 → T058
```

### Cleanup

```text
T059 完成分类与当前诊断需要评估后，T060 与 T061 可并行；T061 只保留或删除已经由 G0/T007-T014 验证安全的元数据能力。T062 只依赖 T059 的“无其他生产用途”结论并原子删除 shadow API/实现/旧自测，以 persist-only 测试替代。T060-T062 完成后执行 T063，再执行 T064 → T065 → T066 → T067。
```

---

## Implementation Strategy

### MVP First（仅 User Story 1）

1. 完成 T001-T014，固定测试和安全基础；其中 G0/T007→T013→T014 必须在任何真实扫码、认证跳转或 Flash/CDN 观察前 PASS。
2. 完成 T015-T026，建立不依赖 Oasis 的腾讯首登主链。
3. 通过 G1 最多 5 轮的父窗/认证子窗链闭合和 G2 最多 3 个修订轮次、修订后连续 2 次完整启动稳定且不额外消耗轮次的闭环（T027-T030），再执行 T031 正式 `3/3`；不对未知 host、selector 或 Flash 行为做猜测性兼容。
4. 在 T032 停止并独立验收 US1；此时仍不批量删除 Oasis 文件。

### Incremental Delivery

1. **US1**: 全新 Profile 扫码→选服→内部 PPAPI 游戏，形成 MVP。
2. **US2**: 在 MVP 上证明同一主进程内的有效 Session 复用、失效回扫码、双 Profile 隔离及腾讯路径不调用 shadow snapshot；Phase 6 全量调用者审计前不删除旧能力。
3. **US3**: 加入四阶段可见错误、有界恢复和安全诊断。
4. **Cleanup**: caller audit 证明替代流程稳定且零调用者后，分组删除 Oasis 模块。
5. **Release Gate**: 全量自动测试、portable 构建、完整 Windows quickstart 和敏感证据审计。

---

## Notes

- `[P]` 仅表示文件和依赖均独立；未标 `[P]` 的任务不得为了提速并行修改共享流程文件。
- Gate 发现的事实必须先按统一规格同步条件分流：技术事实更新 Research/Plan/契约和失败测试；需求、范围、安全边界、验收、分母或新用户能力变化则停止 Gate，先更新 Spec，再同步 Plan/Tasks/契约、重跑 Constitution Check 和一致性确认。G1 每轮最多批准一条导航事实且总计最多 5 轮；发现扫码不计入 SC。G2 最多 3 个修订轮次，每轮处理一次完整启动的一组阻塞事实及其修订/回归，连续 2 次稳定验证无新阻塞才 PASS且不消耗额外修订轮次。
- 非核心帮助、协议和客服外链默认阻止；本 Feature 不新增 `shell.openExternal` allowlist。
- 不得采集 QQ 密码、二维码内容、Cookie/票据值，或通过自动扫码/自动选服完成验收。
- 不得升级 Node.js、npm、Electron、PPAPI、核心依赖或改写 `package-lock.json`。
- 每个 Checkpoint 均可停止并独立验证；Phase 6 之前不允许以“清理”为由破坏仍在替换中的启动链。
