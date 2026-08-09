# Implementation Plan：内置自动化脚本框架

**Branch**: `feature/framework` | **Date**: 2026-07-30 | **Spec**:
[spec.md](./spec.md)

**Input**: `specs/003-builtin-automation-framework/spec.md`

## Summary

从当前 `main@4967578` 基线把已验证的后台点击能力工程化为启动器内置的可信 CommonJS
脚本框架。框架在启动时从只读安装资源发现脚本，验证 manifest 并缓存入口；运行时向脚本提供
冻结的 Profile 上下文、配置、协作式取消、结构化日志和五项受限 Automation API。所有截图、
窗口定位、DPI/尺寸映射、Profile 占用和 CDP 生命周期集中由框架处理。

`demo/builtin-auto@a646977` 仅作为验证资产来源：选择性迁移归一化坐标算法、CDP 三事件点击、
AS3 靶场、Chromium/PPAPI smoke 思路和 `demo-click` 行为，不整体 cherry-pick Demo 提交，
不恢复失败的 FlashProbe/PreloadSwf/TCP 路线或临时 Debug UI/IPC。

## Technical Context

**Language/Version**: 生产脚本和启动器使用 JavaScript/CommonJS；开发工具链固定 Node.js
`16.20.2`、npm `8.19.4`；Electron `11.5.0` 主进程实际为 Node `12.18.3` /
Chromium `87`。允许脚本开发时使用 TypeScript，但 v1 不新增 TypeScript 工具链，发布物必须是
兼容该 Electron 运行时的 `.js`。

**Primary Dependencies**: 现有 Electron `11.5.0`、electron-log、Node 内置
`fs/path/crypto/events`；不新增第三方依赖，不修改 `package-lock.json`。

**Storage**: 脚本包经 electron-builder `files` 进入只读 ASAR；用户配置和坐标按
`userData/automation-data/profiles/<profileId>/scripts/<scriptId>/` 分离保存为有版本、原子
替换的 JSON；运行状态和录点截图仅驻留内存。

**Testing**: Jest `29.7.0` 单元/集成/契约测试；Windows x64 Electron runtime Chromium
smoke、Pepper Flash/AS3 runtime smoke、安装包发现及腾讯真实游戏最小人工回归。

**Target Platform**: 第一版只维护 Windows x64，并在该平台完成完整功能、Chromium、Pepper
Flash/AS3 和腾讯真实游戏人工验收；不要求 WSL 或 Linux AppImage 构建证据。不得升级
Electron、Pepper Flash 或核心依赖。

**Project Type**: 单体 Electron 桌面应用，主进程自动化域加现有 Manager renderer 控制面。

**Performance Goals**: 状态变化在 1 秒内反映到管理页；可取消的 `wait()` 在停止请求后 5 秒内
进入 `cancelled`；不同 Profile 可并行且互不等待。v1 不新增容量目标、启动扫描性能目标或
benchmark 工作。

**Constraints**: 游戏窗口不能因自动化获得焦点，不能移动系统鼠标；截图、录点、启动与点击
分别只依赖所属 Profile 的窗口/webContents、有效内容尺寸、输入及动作生命周期等客观资源，
腾讯流程阶段和 `GAME_READY` 仅作诊断或脚本策略；同 Profile 同时只能有一个脚本或独立命令；会向 event loop 交还控制权的
正常异步脚本、Automation API 操作和 `wait()` 使用默认 5 分钟 deadline，单次等待不超过
60 秒并支持协作式取消；同步死循环或长时间同步阻塞不保证硬终止；不得向脚本/renderer 暴露
Electron 对象、任意 CDP、Session 或登录态，不为恶意第三方脚本提供安全沙箱承诺。

**Scale/Scope**: 个人维护、可信内置脚本；v1 一个固定脚本根、一个 API 版本、一个示例脚本、
六种运行状态和五项 Automation API。第三方安装、在线更新、外部 Bridge、更多输入类型和
视觉识别均不在范围内。

## Constitution Check（Phase 0 前）

*Gate result: PASS。Phase 0 研究未发现需要违反章程的设计。*

| Principle | Result | Evidence |
| --- | --- | --- |
| I. 规格驱动 | PASS | 先有 3 个独立可测故事、29 项功能要求和 9 项可量化成功标准，再做技术取舍；未增加 Spec 之外的容量或启动扫描性能目标。 |
| II. 腾讯国服唯一产品方向 | PASS | 仅面向腾讯官方扫码、选服后的 PPAPI 游戏；不恢复 Oasis 或其他区服逻辑。 |
| III. 官方认证与受控诊断边界 | PASS | 通用能力仅接触已登记游戏窗口及安全 DTO，不读 URL、Cookie、Storage、票据或身份数据，不增加原始认证诊断。 |
| IV. 模块化而非过度抽象 | PASS | 自动化作为独立主进程域，通过 Launcher 窄适配和现有 IPC/广播路径接入；页面阶段与 `GAME_READY` 保留为诊断信息，不污染通用能力门槛。 |
| V. 旧版运行时兼容 | PASS | 设计以 Electron 11 内置 Node 12 为最低运行时，用同进程 CommonJS、deadline 和最小协作式取消信号，不引入 Worker、Child Process、VM 或新 Node API。 |
| VI. Session 隔离 | PASS | 所有动作以真实 `profileId` 绑定 Launcher registry，不枚举或共享 Session/Partition。 |
| VII. 测试与验收先行 | PASS | Spec 为每个故事定义独立测试；Windows x64 执行完整运行与发布验收。 |
| VIII. 简单性与必要性 | PASS | 保持个人维护的可信同进程 CommonJS、手写小型 manifest 校验和文件 JSON 存储；不引入隔离架构、benchmark、RPC 或新依赖。 |
| IX. 可诊断性 | PASS | 预先定义稳定错误码、状态机和安全结构化日志，不记录配置、坐标、截图或登录数据。 |
| X. 治理与语言规范 | PASS | 文档使用中文，代码/命令/原始标识保持英文；以当前源码和实测证据优先于历史文档。 |

本 Feature 不需要读取认证页原始页面、表单、URL、Cookie/Storage、身份或 Session 数据；
因此不启用“用户授权本地诊断”例外。录点截图仅来自 Launcher 已登记、窗口/webContents 与
内容尺寸有效的目标，绑定当前
ManagerWindow 与 `Profile + scriptId`，最多保留 5 分钟，不写磁盘、不进日志。

## Project Structure

### Documentation（本 Feature）

```text
specs/003-builtin-automation-framework/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── manifest-contract.md
│   ├── runtime-contract.md
│   └── manager-ipc-contract.md
└── tasks.md                         # 由后续 /speckit-tasks 生成
```

### Source Code（主要路径示意，非穷举）

```text
automation-scripts/
└── demo-click/
    ├── manifest.json
    ├── index.js
    └── assets/                      # 可选；空时不创建

src/
├── automation/
│   ├── registry.js                  # 固定目录扫描、manifest/入口校验、注册问题
│   ├── runner.js                    # 运行状态、取消、超时、入口调用
│   ├── coordinator.js               # Profile lease 与动作 FIFO
│   ├── api.js                       # 冻结的 Automation API v1
│   ├── backend.js                   # Launcher 窄适配、截图、尺寸映射、CDP 生命周期
│   ├── store.js                     # Profile + script 配置/坐标持久化
│   ├── recording.js                 # 短期内存录点截图
│   ├── cancellation.js              # Node 12 可用的最小取消信号
│   ├── errors.js                    # 稳定错误码与安全消息
│   └── __tests__/
│       ├── registry.test.js
│       ├── store.test.js
│       ├── coordinator.test.js
│       ├── runner.test.js
│       ├── api.test.js
│       ├── recording.test.js
│       └── demo-click.test.js
├── app/
│   ├── Launcher.js                  # 仅增加目标窄适配与关闭通知
│   └── __tests__/Launcher.test.js
├── main.js                          # 初始化、退出清理、依赖装配
├── ui/
│   ├── app.js                       # 自动化面板交互与状态渲染
│   ├── index.html                   # Profile 自动化入口和面板
│   ├── styles.css                   # 现有视觉体系内的轻量样式
│   ├── __tests__/automation-panel.test.js
│   └── manager/
│       ├── IpcRouter.js             # 白名单命令与 sender 验证
│       ├── StateBroadcaster.js      # catalog/status 全量与增量广播
│       └── __tests__/
│           ├── IpcRouter.test.js
│           └── StateBroadcaster.test.js
└── utils/
    ├── logger.js                    # 自动化安全字段白名单
    └── __tests__/logger.test.js

tests/
├── runtime/
│   ├── cdp-background-smoke.js
│   └── cdp-ppapi-background-smoke.js
└── fixtures/
    ├── automation-scripts/
    └── flash/
        ├── CdpClickTarget.as
        ├── CdpClickTarget.swf
        └── build.ps1
```

**Structure Decision**: 保持现有单体 Electron 结构；新增一个内聚的 `src/automation/` 域和仓库根
只读脚本目录，沿用已有 `Launcher`、Manager IPC、StateBroadcaster 和 renderer。上表只展示
主要路径和职责边界，不穷举测试 helper、README、validation 证据文件或小型装配文件；实施时若
两个很小模块合并可减少抽象层，但不得把脚本运行、存储和 CDP 重新堆入 `Launcher`。

## Design and Implementation Approach

### 1. 启动发现与注册

1. 在 Profile Store 已加载、管理 IPC 与窗口创建前构造自动化服务。
2. 从 `path.join(app.getAppPath(), 'automation-scripts')` 读取直接子目录并确定性排序。根目录
   不存在或不可读时继续启动、返回空 catalog，并记录稳定的 `scripts-root-unavailable` 注册诊断；
   根目录为空时继续启动并返回空 catalog。
3. 按 [manifest contract](./contracts/manifest-contract.md) 做字段、大小、路径 containment、
   ID 冲突和 API 版本检查；冲突组全部拒绝，单包失败不阻止启动。
4. 对唯一有效候选 `require` 一次，校验直接导出函数并缓存；注册表在本次启动期间冻结。
5. 更新 electron-builder `files` 白名单，使开发目录和 ASAR 使用同一路径规则；不使用
   `extraResources` 或 cwd。正式发布验证若发现预期内置脚本未进入安装包，验收直接失败。

### 2. 数据、录点与 Profile 边界

1. 所有读写先验证 Profile 当前存在、脚本已注册，再使用未经替换的已验证 ID 形成数据路径。
2. 配置与坐标采用 [data model](./data-model.md) 的 envelope、大小上限和临时文件 + rename；
   文件缺失返回默认值，损坏/身份/schema 不符返回错误且保留原文件。
3. 录点截图只在所属 Profile 的窗口/webContents 可用且内容尺寸有效时生成，不以腾讯流程阶段
   或 `GAME_READY` 为硬门槛；结果绑定 `captureId + profileId + scriptId + ManagerWindow`，
   单组合只留一个、5 分钟过期，关闭窗口或退出即清理。
4. Profile 删除不顺带递归删除自动化数据；删除/恢复策略另立 Feature。

### 3. 运行、并发、取消与状态

1. 启动请求通过所有校验后尝试取得 Profile lease；忙碌立即返回 `profile-busy`，不排队。
2. 创建唯一 run token、5 分钟 deadline、最小 AbortSignal-compatible signal 和冻结 context，
   将状态置为 `running` 后调用缓存入口；deadline 覆盖会向 event loop 交还控制权的正常异步
   脚本、Automation API 操作和 `wait()`。
3. 同一 lease 内所有 Automation API 动作追加到 FIFO tail；每个动作开始前重新校验 token、
   signal、Profile、窗口/webContents、所需内容尺寸和输入。不同 Profile 使用独立 tail；页面阶段
   与 `GAME_READY` 不参与通用 preflight。
4. 用户停止先进入 `stopping`；当前 move/press/release 原子点击与 owned debugger 清理完成后
   阻止后续动作并进入 `cancelled`。正常异步执行或 API 操作在 event loop 可调度 deadline 时
   固定进入 `failed/run-timeout`。
5. 首个终止原因获胜；迟到的脚本 settlement、旧动作和旧 lease release 都由 token fencing
   拒绝。应用退出与窗口关闭触发对应取消/失败并完成有限清理。

同进程可信脚本若同步死循环或长时间同步阻塞会阻塞 Electron event loop，导致 deadline、取消
和状态更新在阻塞解除前无法执行；v1 不提供硬终止保证。实现以项目代码审查、边界 lint、行为
测试和“长等待必须使用 API `wait`”约束降低这一已知残余风险，不引入 Worker、Child Process、
VM 或其他隔离架构，也不宣称完整沙箱。

### 4. Automation API 与后台点击

1. 向脚本只暴露 [runtime contract](./contracts/runtime-contract.md) 的五项 API、配置快照、
   signal 和绑定 logger。
2. `capture` 与 `click` 只面向 Launcher 已登记、窗口/webContents 可用且内容尺寸有效的 Profile；
   `gameReady` 可作为只读诊断字段返回，但不参与通用能力授权。窗口状态 DTO 不含 URL、标题、
   ID、Session 或登录态。
3. `click` 在执行时用当前 content size 将 `[0,1)` 坐标映射为整数内容坐标；不得复用截图像素
   或脚本自算 DPI。
4. 每次点击短暂 attach CDP `1.3`，依次发送 `mouseMoved/mousePressed/mouseReleased`，finally
   只 detach 本次拥有的连接；不聚焦窗口、不调用 OS 鼠标 API。
5. 不在生产路径保存前后截图或执行全图像素差；runtime smoke 的证据限测试临时目录。

### 5. 管理 UI、IPC 与日志

1. 依照 [manager IPC contract](./contracts/manager-ipc-contract.md) 扩展现有
   `IpcRouter → domain service → StateBroadcaster → ManagerWindow`。
2. 所有命令验证 sender、字符串参数、Profile、脚本和运行状态；renderer 不能传入口路径、
   窗口/WebContents ID、CDP method 或 Electron 参数。
3. Profile 卡片提供自动化入口；面板可列脚本、录点、启动、停止和查看当前/最近终态。
   截图/启动仅在目标游戏窗口不可用时禁用，`gameReady=false` 不单独禁用；停止仅对当前 run 生效。
4. `manager:ready` 推送全量 catalog/status，运行变化推送白名单增量，避免轮询。
5. logger 自动绑定 `runId/profileId/scriptId`，只接受安全标量；不记录配置、坐标、Buffer、
   截图、路径、URL query 或原始异常 stack。
6. 正式通道取代 Demo 的 `automation-demo:*`；实现完成后不得保留临时通道或 Debug-only 面板。

### 6. `demo-click` 与验证资产迁移

1. 新建正式 manifest 和 CommonJS 入口：读取当前 Profile 的坐标，空列表明确失败，按顺序
   `click`，相邻点击通过 `wait` 保持约 1000ms 间隔并响应取消。
2. 从 Demo 选择性复制 AS3 源码/已验证 SWF/build 脚本及测试意图；runtime smoke 必须改走正式
   registry、runner 和 API，不能直接调用 backend/debugger。
3. 把 Demo 中的单体 `AutomationDemo` 与固定 `Debug/automation-demo` 存储行为拆成正式域测试；
   不迁移像素差证明、证据目录、最多两点限制或字符串清洗造成的目录碰撞。
4. 先通过 mock 单元/契约测试，再运行 Chromium、PPAPI/AS3，最后执行腾讯真实游戏人工回归。

## Delivery Sequence

1. **Foundation**：错误合同、manifest registry、打包资源、数据存储及对应失败优先测试。
2. **Runtime core**：Profile coordinator、取消信号、runner 状态机、受限 API 和 backend。
3. **Integration**：Launcher 窄适配、启动/退出装配、IPC、状态广播、安全日志。
4. **User flow**：管理页脚本面板、录点、启动/停止/状态恢复。
5. **Regression asset**：迁移 `demo-click`、Chromium 与 PPAPI/AS3 fixtures/smoke。
6. **Release verification**：全量 Jest/lint；Windows x64 执行打包发现、完整功能、Chromium、
   PPAPI/AS3 和腾讯真实游戏最小人工回归。

每一阶段先写失败测试，再实现最小行为；后续阶段不得绕过已建立的 registry、lease、API 或
IPC 契约直接访问 Electron/CDP。

## Constitution Check（Phase 1 后）

*Gate result: PASS。研究、数据模型、契约和 quickstart 已把章程要求落实为可测试边界。*

| Principle | Result | Post-design evidence |
| --- | --- | --- |
| I. 规格驱动 | PASS | 所有设计实体、状态和命令均可追溯到 FR/SC；未保留额外容量或启动扫描性能目标。 |
| II. 腾讯国服唯一产品方向 | PASS | 示例和人工回归只覆盖腾讯国服；腾讯流程状态作为诊断信息保留，不被误用为通用能力硬门槛。 |
| III. 官方认证与受控诊断边界 | PASS | WindowState/IPC/log DTO 显式排除认证数据；短期截图有 Profile、脚本、sender、期限和清理边界。 |
| IV. 模块化而非过度抽象 | PASS | registry/runner/coordinator/backend/store 职责可独立测试；通用能力只验证客观资源，页面适用性留给脚本通过受限 API 判断。 |
| V. 旧版运行时兼容 | PASS | 自有最小取消信号、同进程 CommonJS 和 Node 内置能力适配 Electron 11/Node 12；同步阻塞不能硬终止被明确记录为残余风险。 |
| VI. Session 隔离 | PASS | data path、run、lease、capture 和 IPC 均以真实 Profile ID 绑定；不同 Profile 独立并行。 |
| VII. 测试与验收先行 | PASS | [quickstart](./quickstart.md) 覆盖单元与契约；Windows x64 覆盖 Chromium、PPAPI/AS3、安装包和腾讯人工回归。 |
| VIII. 简单性与必要性 | PASS | 无新依赖、无 Worker/Child Process/VM、无外部 Bridge、无 benchmark、无恶意代码沙箱、无热重载或生产截图证据。 |
| IX. 可诊断性 | PASS | [runtime contract](./contracts/runtime-contract.md) 定义稳定 code、首因终态与安全日志字段。 |
| X. 治理与语言规范 | PASS | 产物为中文且标明事实优先级；Demo 历史证据与当前未重跑状态明确区分。 |

## Complexity Tracking

无章程违反项，不需要例外说明。
