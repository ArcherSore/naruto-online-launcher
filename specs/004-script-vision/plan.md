# Implementation Plan：内置脚本共享视觉能力

**Branch**: `feature/vision` | **Date**: 2026-08-10 | **Spec**: [spec.md](./spec.md)

**Input**: `specs/004-script-vision/spec.md` 及 2026-08-10 Clarify 结果

## Summary

在已完成的内置自动化框架上新增冻结的 `context.vision`，向可信随包脚本提供
`find`、`waitFor`、`waitUntilGone`。每轮通过现有 backend 捕获当前 Profile，使用 Electron
`nativeImage` 解码 PNG，以纯 JS 协作式分片执行 exact-scale、ROI 限定的确定性模板匹配；
模板只从 registry 已登记脚本的 `assets/vision/` 读取。

坐标实现严格以当前 main 为准：截图像素中心先映射到捕获时规范 content pixel，再编码为该
pixel 对应 normalized 单元格的中点；现有 click mapper 在执行时把它稳定还原为 content/CDP
整数坐标。BrowserWindow DIP 不进入该链。v1 不使用 Worker、不新增依赖、不扩展 multi-scale、
OCR、Python/OpenCV、输入或调度能力。

## Technical Context

**Language/Version**: JavaScript/CommonJS；Volta 固定 Node.js `16.20.2`、npm `8.19.4`；生产
代码保持 Electron `11.5.0` 内置旧 Node 运行时可用语法/API。

**Primary Dependencies**: 现有 Electron `nativeImage`、`webContents.capturePage()`、CDP
debugger，Node 内置 `fs/path` 与现有 automation runner/coordinator/error modules；不新增第三方
依赖，不修改 `package-lock.json`。

**Storage**: 模板位于只读 `automation-scripts/<package>/assets/vision/*.png` 并进入 ASAR；
成功解码的模板可在进程内按注册脚本+templateId 缓存。截图、位图、匹配结果和等待状态仅存在
于当前动作内，不持久化。

**Testing**: Jest `29.7.0` 纯逻辑、契约和模块集成；现有 GameViewport/backend/recording/runner
回归；Electron Chromium/CDP 与 Windows packaged-ASAR smoke；固定 `1920×1080 + 100%`
腾讯游戏人工验收。

**Target Platform**: Vision v1 正式交付与验收为 Windows x64、固定 `1920×1080` 规范内容、
Windows 100% 显示缩放；构造 `imageSize != contentSize` 仅用于纯逻辑防混用，不承诺 DPI 或
多缩放支持。

**Project Type**: 现有单体 Electron 桌面应用的主进程 automation 域扩展。

**Performance Goals**: matcher 以固定工作量和约 `8ms` 作为协作 slice 的实现预算；该数值不是
硬实时承诺，也不作为跨机器逐 slice 精确毫秒验收。正式性能验收是 full-frame no-match 期间
event-loop heartbeat、取消/deadline 和其他 Profile action 均可持续推进；取消/deadline 被运行时
观察后 1 秒内停止发起新轮次；相同输入重复 100 次结果完全一致。

**Constraints**: exact-scale only；ROI 为截图像素整数矩形；每轮 capture metadata 不可拆分；
同 Profile 动作 FIFO、不同 Profile 独立；单次 Vision wait 最长 60 秒且不能延长 runner 统一
deadline；in-flight `capturePage()` 不可强制取消，只能在返回后丢弃；不使用 Worker/WorkerPool、
外部运行时、新输入、页面阶段或 `GAME_READY` 硬门槛。

**Scale/Scope**: 可信内置脚本、固定脚本根、三个公开方法、一种 exact-scale 相似度、一个
模板命名合同和七个新增稳定错误码；不建立第三方模板、热更新、DSL 或并行调度框架。

## Constitution Check（Phase 0 前）

*Gate result: PASS。规格没有未解决澄清项，研究只针对当前源码揭示的实现未知。*

| Principle | Result | Evidence |
| --- | --- | --- |
| I. 规格驱动 | PASS | 设计范围直接追溯到 3 个 User Stories、FR-001～026 与 SC-001～009；POC 仅作为用户确认的技术可行性事实。 |
| II. 腾讯国服唯一产品方向 | PASS | 只处理当前腾讯国服游戏窗口截图，不恢复 Oasis/巴西服逻辑。 |
| III. 官方认证与受控诊断边界 | PASS | Vision 不读取 DOM、URL、Cookie、Storage、票据或验证码；截图不进普通日志/持久存储，不需要授权认证诊断。 |
| IV. 模块化而非过度抽象 | PASS | 复用 registry、runner、coordinator、backend 与 Profile target；页面阶段和 `GAME_READY` 不是硬门槛。 |
| V. 旧版运行时兼容 | PASS | 只使用 Electron 11 nativeImage、CommonJS、Buffer、Promise、setImmediate 与现有自定义 signal；不升级依赖。 |
| VI. Session 隔离 | PASS | 每个查询由 runner 绑定真实 Profile/run，截图不缓存或跨 Profile；模板仅是同脚本只读安装资源，不接触 Session。 |
| VII. 测试与验收先行 | PASS | Spec 已要求完整 pixel→CDP、polling 竞态、资源越界、打包与 Profile 并发回归。 |
| VIII. 简单性与必要性 | PASS | 不使用 WorkerPool/新依赖/新调度器；只新增 matcher、模板 loader、Vision API 和共享坐标 helper。 |
| IX. 可诊断性 | PASS | 新失败进入现有安全错误 allowlist；日志只允许 Profile/script/run/阶段/时长/尺寸/code。 |
| X. 治理与语言规范 | PASS | 产物使用中文，公式/代码标识保持英文；当前源码和可复现数值结果优先于历史 POC。 |

## Project Structure

### Documentation（本 Feature）

```text
specs/004-script-vision/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── vision-api-contract.md
│   ├── coordinate-contract.md
│   └── template-resource-contract.md
└── tasks.md                         # 后续 $speckit-tasks 生成，本阶段不创建
```

### Source Code（计划涉及的主要路径）

```text
automation-scripts/
└── demo-click/
    ├── manifest.json                # apiVersion 保持 1
    ├── index.js                     # 现有行为保持不变
    └── assets/vision/
        └── sample-target.png        # 开发/ASAR 资源一致性与 packaged smoke 资产

src/
├── automation/
│   ├── coordinates.js               # 新：image/content/normalized 双向可测映射
│   ├── backend.js                   # 改：复用共享 validSize/mapNormalizedPoint
│   ├── recording.js                 # 条件改：仅在失败测试复现 1px 回退后采用 helper
│   ├── api.js                       # 改：抽取/复用 run-bound enqueue 与 preflight
│   ├── runner.js                    # 改：冻结 context 增加 vision
│   ├── index.js                     # 改：装配 codec、loader、matcher 与 run-bound vision
│   ├── errors.js                    # 改：Vision 稳定错误码/安全消息
│   ├── vision/
│   │   ├── api.js                   # 三方法、严格 options、FIFO/polling/终止编排
│   │   ├── codec.js                 # nativeImage PNG 解码与复制位图校验
│   │   ├── matcher.js               # 纯 JS exact-scale 分片匹配与确定性择优
│   │   └── template-loader.js       # registry packageRoot、路径/PNG/缓存边界
│   └── __tests__/
│       ├── coordinates.test.js
│       ├── vision-api.test.js
│       ├── vision-matcher.test.js
│       ├── vision-template-loader.test.js
│       ├── vision-coordinate-chain.test.js
│       └── existing suites updated as needed
├── app/
│   └── __tests__/GameViewport.test.js # 保留规范内容与漂移拒绝回归
└── ...

tests/
└── runtime/
    ├── cdp-background-smoke.js       # 扩展 Vision center→CDP 完整链
    └── packaged-automation-smoke.js  # 扩展真实 ASAR 模板加载/匹配

docs/
└── BUILTIN_AUTOMATION.md             # context.vision、模板和错误合同
```

**Structure Decision**：保留单体 Electron 与现有 `src/automation` 依赖方向。Vision 子目录只拆分
公开动作编排、纯 CPU matcher、Electron 解码和安全资源加载四个职责；共享坐标 helper 位于上层，
供 backend/Vision 使用，只有通过 recording 行为失败测试门禁后才供 recording 复用。没有
renderer、IPC、Session、登录或新输入模块改动。

## Architecture

```text
registered script.run(frozen context.vision)
  → vision/api（绑定 profileId/scriptId/lease/signal/deadline）
  → coordinator.enqueue（一次 find/wait 是一个 FIFO action）
  → template-loader（registry packageRoot → own assets/vision PNG）
  → backend.capture(current profile)
  → codec(nativeImage → copied bitmap)
  → matcher(exact-scale + ROI + threshold, cooperative slices)
  → coordinates(image center → content pixel → normalized cell midpoint)
  → frozen rect/center/confidence
  → script passes center unchanged to automation.click()
  → backend mapper(current canonical contentSize)
  → CDP Input.dispatchMouseEvent(content x/y)
```

跨模块副作用只有三项：runner context 新增只读 `vision`；backend/Vision 复用共享坐标 helper，
recording 是否复用受失败测试门禁；errors/docs/package smoke 增加 Vision 合同。Launcher、
GameViewport、coordinator、Session/Partition 与 CDP 事件序列不改产品行为。

## Design and Implementation Approach

### 1. 共享坐标合同与当前偏差保护

1. 从 `backend.js` 抽出 `validSize`、`mapNormalizedPoint` 到 `coordinates.js`，保持现有
   normalized → content 的 `floor` 合同与错误分类。
2. 新增 `mapImagePointToNormalized(imagePoint,imageSize,contentSize)`：按捕获 metadata 选择
   content pixel，并用 `(pixel + 0.5) / size` 编码到单元格中点。
3. Vision 的 `rect` 和 ROI 始终是截图像素；只有 `center` 是 normalized click point。
   BrowserWindow DIP 不作为参数，也不从 window 读取。
4. 先在 `recording.test.js` 通过正式 `addPoint()` → 已保存 normalized point → 当前
   `mapNormalizedPoint()` 链写出一个能稳定复现 1px 回退的失败测试。只有该测试在未改实现时
   确实失败，才让 `recording.js` 改用 midpoint helper 并使测试通过；若无法复现，保留现有
   recording 行为，不为代码统一而强改。
5. 完整回归必须覆盖：正式 `1920×1080 + 100%`；`123/39` 等浮点敏感像素；最后一行/列；
   奇偶模板中心；构造 `imageSize=3840×2160`、`contentSize=1920×1080`、BrowserWindow DIP
   `960×540` 且 DIP 不参与；匹配后窗口合同漂移时 click 拒绝。

历史 POC 不可用，因此本计划只陈述可从当前源码证明的错误类型与修正，不宣称已经定位旧公式
或唯一根因。

### 2. 模板资源与解码

1. loader 从 `registry.get(scriptId).packageRoot` 取得权威包根；不按 manifest ID 猜目录名，
   不接受脚本传 root/path/URI。
2. `templateId` 先按 lowercase slug 1～64 校验，固定追加 `.png`；再执行大小写精确的目录项
   比对、lexical/realpath containment、普通文件、16 MiB 上限和 PNG signature/IHDR 校验。
3. `codec.js` 用 `nativeImage.createFromBuffer()` 解码，拒绝 empty、尺寸无效、与 IHDR/metadata
   不一致或位图长度不等于 `width*height*4`；用 `toBitmap()` 而非只能在当前 tick 使用的
   `getBitmap()`。
4. 只缓存成功模板位图；cache key 包含已注册包身份和 templateId。失败不缓存，截图、ROI 和
   match result 从不跨轮次/Profile 缓存。
5. `package.json` 的 `automation-scripts/**` 已覆盖模板，无构建配置变更；给现有示例包增加一个
   小型正式 PNG 作为开发/ASAR parity 资产，不新增第二个生产脚本或改 demo-click 行为。

### 3. Matcher 与 Worker 决策

1. 位图按同一四字节 nativeImage 格式比较；confidence 使用四通道 mean absolute difference
   的补数，alpha 参与比较且不是 mask。
2. 搜索起点严格位于 ROI，模板外框必须完整落在 ROI 内；模板大于搜索区报
   `vision-template-too-large`，不得被 `waitUntilGone` 当作消失。
3. 扫描顺序固定 row-major；最高 confidence 胜出，完全并列取最上、再最左。所有结果深冻结。
4. matcher 保存候选位置、候选内像素游标和累计误差；达到固定像素工作量或约 8ms 内部预算时
   `setImmediate`，因此单个大模板候选也可跨 slice。每个 slice 校验取消/deadline。测试不得
   断言每个 slice 必须小于某个精确毫秒值，而应验证下述 event-loop 与跨 Profile 可推进性。
5. v1 明确不使用 Worker。测试必须证明 full-frame no-match 时 event-loop heartbeat 和另一个
   Profile action 能前进；若不能满足，视为 Plan 需要重新评审，而不是实现中增设 WorkerPool。

### 4. Vision API 与生命周期

1. runner 在现有 context 新增冻结 `vision`；公开 surface 只有三个方法，automation 的五动作
   surface 保持原样。run-bound gate 统一处理 lease ownership、signal、Profile 与 enqueue。
2. `find`：严格校验 → 模板加载 → 新鲜 capture → decode → 单轮 match；成功返回 result，
   合法 no-match 返回 `null`。
3. `waitFor`：立即执行同一单轮检查；no-match 后可取消 sleep；第一次匹配成功返回 result；
   run 仍有效而 local deadline 到达时抛 `vision-timeout`。
4. `waitUntilGone`：立即检查；第一次有效 capture/match 得到 no-match 时返回 `true`；任何模板、
   capture、decode、window 错误都继续作为错误，不能解释为 gone。
5. `waitFor`/`waitUntilGone` 整体持有一个 Profile FIFO action；内部调用 backend/clock/scheduler，
   禁止嵌套调用公开 Automation API。

### 5. Polling、timeout、cancellation 与 deadline

1. options 合同采用 [Vision API contract](./contracts/vision-api-contract.md) 的默认值和范围；
   未知 key、非有限值、越界 ROI、显式 timeout 超出剩余 run deadline 均在匹配前拒绝。
2. interval 是上一轮完成到下一轮开始的最小间隔；不使用 `setInterval`，不重叠、不补跑。
3. 每个 capture/match/sleep/settle 边界先检查 runner signal：`timeout` 映射 `run-timeout`，其他
   reason 映射 `run-cancelled`；只有 run 仍活动才检查并抛 `vision-timeout`。
4. abort listener 与 timer 使用 once-settle guard；结果一旦确定立即清理，迟到 abort、capture、
   match 或 timer 不得覆盖。
5. `capturePage()` 进行中无法取消；abort 后等待它返回并丢弃结果，不 decode/match，不开始下一轮。

### 6. 错误、日志与隔离

1. 新增七个 Vision code 及固定中文 safeMessage；raw fs/nativeImage error、绝对路径、PNG 字节、
   stack 和截图不进入公开 error/status/log。
2. 诊断日志 allowlist 仅含 `runId/profileId/scriptId/templateId`（已通过 slug 校验）、阶段、
   image/content/template/ROI 尺寸、attempt、duration 与稳定 code；默认不记录 rect/center/confidence。
3. 模板归属绑定 script；capture/query 绑定当前 run Profile。一个模板错误只终止当前 action，
   不清 registry、template cache、其他 Profile lease 或 Session。
4. 页面阶段、Flash 状态与 `GAME_READY` 仍只作诊断/脚本策略，不进入 Vision preflight。

### 7. 验证层级与交付顺序

1. **坐标失败优先测试**：共享 helper、浮点敏感像素、image/content/DIP 分离、漂移拒绝；
   recording 改动必须先有当前实现可复现的 1px 失败测试，否则明确跳过 recording 修改。
2. **Matcher 纯逻辑**：confidence/threshold、ROI、边缘、tie-break、slice 确定性、no-match 响应。
3. **资源边界**：templateId 拒绝前零读取、registry packageRoot、symlink/junction、PNG/尺寸/cache。
4. **Runtime contract**：冻结 context.vision、同 Profile FIFO、不同 Profile 推进、find/waits、
   终止竞态与 terminal 后零新增 capture。
5. **正式坐标链**：合成目标 → Vision center → automation.click → mapper → CDP 三事件坐标。
6. **发布**：package discovery SHA parity、Windows ASAR template load/match、既有 Chromium/PPAPI
   click smoke 与腾讯固定环境人工回归。

每一层先写失败测试再实现最小行为；不得用 mock 跳过 coordinate helper→backend mapper 的关键
集成，也不得让 packaged smoke 从仓库路径旁路 ASAR。

## Constitution Check（Phase 1 后）

*Gate result: PASS。research、data model、contracts 与 quickstart 已把全部设计决定转成可测试边界。*

| Principle | Result | Post-design evidence |
| --- | --- | --- |
| I. 规格驱动 | PASS | [research](./research.md) 的十项决定均对应 FR/SC；未新增识别算法、输入或调度能力。 |
| II. 腾讯国服唯一产品方向 | PASS | [quickstart](./quickstart.md) 只验收腾讯国服固定画面，不涉及其他区服。 |
| III. 官方认证与受控诊断边界 | PASS | [template contract](./contracts/template-resource-contract.md) 与错误合同排除路径/认证数据；人工步骤禁止保存登录截图或票据。 |
| IV. 模块化而非过度抽象 | PASS | Vision 复用现有 registry/runner/coordinator/backend；四个小模块按 API/codec/matcher/loader 职责拆分，无新 scheduler。 |
| V. 旧版运行时兼容 | PASS | 设计仅使用 Electron 11 已存在 nativeImage 与 Node/CommonJS 能力；无 Worker、新依赖或 lockfile 变更。 |
| VI. Session 隔离 | PASS | [data model](./data-model.md) 把 query/capture 绑定 Profile/run；模板只按脚本共享且不包含 Profile/Session 数据。 |
| VII. 测试与验收先行 | PASS | [quickstart](./quickstart.md) 覆盖 unit、runtime、CDP、ASAR、Profile 并发与人工固定环境验收。 |
| VIII. 简单性与必要性 | PASS | WorkerPool、multi-scale、OCR、alpha mask、外部 runtime 和新脚本调度均被明确拒绝。 |
| IX. 可诊断性 | PASS | [Vision API contract](./contracts/vision-api-contract.md) 定义稳定终止/error；图像、路径和 raw error 不持久化。 |
| X. 治理与语言规范 | PASS | 全部 Phase 0/1 产物使用中文并以当前源码为事实基线；无 Constitution 修改。 |

## Complexity Tracking

无章程违反项，不需要例外说明。
