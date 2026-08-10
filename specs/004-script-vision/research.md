# Research：内置脚本共享视觉能力

本文只使用当前仓库源码、现有测试与用户确认的 POC 技术事实。不可用的 POC 分支没有被搜索、
恢复或作为坐标公式来源。所有决定面向 Vision v1 的固定 `1920×1080 + Windows 100%` 产品环境。

## Decision 1：以当前 backend 的 normalized point 合同为唯一坐标真相

**Decision**：`src/app/GameViewport.js` 的规范内容/页面空间固定为 `1920×1080`；
`src/automation/backend.js` 的 `capture()` 返回截图像素 `imageSize` 与规范页面
`contentSize`，两者必须保持独立。`automation.click()` 只接受 `[0,1)` normalized point，
执行时按当前有效 `contentSize` 计算公开的整数内容坐标；backend 再按当前 BrowserWindow
content DIP 把该规范 pixel 单元格映射到 Electron 11 CDP viewport，最后调用
`Input.dispatchMouseEvent`。BrowserWindow DIP 不参与 Vision center 或脚本 normalized 合同，
但属于 backend 的最后一段内部映射。

**Rationale**：

- `GameViewport.createMetrics(scale)` 只用 DIP 尺寸与逆 zoom 维持规范页面；
  `getAutomationContentSize()` 仅在窗口 DIP 与 zoom 合同均有效时返回 `{1920,1080}`。
- `Launcher.getAutomationTarget()` 把该规范尺寸作为 backend target 的显式 `contentSize`。
- `capture()` 从 NativeImage 取得真实 `imageSize`，没有要求 `imageSize === contentSize`。
- `mapNormalizedPoint()` 明确使用 `floor(normalized * contentSize)`，公开 `contentPoint` 继续保持该
  整数结果。当前 Electron 11 的 CDP Input 使用 BrowserWindow content viewport；缩放不为 1 时
  backend 必须再按 `window.getContentSize()/contentSize` 映射规范 pixel 单元格中心。

**Alternatives considered**：把 BrowserWindow `getContentSize()` 用作 Vision contentSize、假定截图与
内容尺寸相等、直接把 screenshot pixel 或规范 content pixel 无条件送给 CDP、沿用旧 POC 分母。
它们都会混合不同坐标空间，全部拒绝。

## Decision 2：用 normalized 单元格中点保证 pixel → click 可逆

**Decision**：匹配矩形仍返回截图像素空间；其连续中心为
`imageCenter = rect origin + rect size / 2`。Vision 使用同次 capture metadata 先选择目标整数
内容像素，再把该像素编码到 normalized 单元格中点：

```text
contentX = min(contentWidth - 1, floor(imageCenterX * contentWidth / imageWidth))
contentY = min(contentHeight - 1, floor(imageCenterY * contentHeight / imageHeight))

normalizedX = (contentX + 0.5) / contentWidth
normalizedY = (contentY + 0.5) / contentHeight
```

该换算抽到 `src/automation/coordinates.js` 并由 Vision 使用；backend 的正式 click 解码合同
保持 `floor(normalized * contentSize)` 不变。`recording.js` 只有在先通过其公开录点链写出一个
能在当前实现上稳定失败、明确复现 1px 回退的测试后，才改用该 helper；若测试无法复现，
本 Feature 不为追求实现统一而改变现有录点行为。

**Rationale**：当前 `recording.js` 使用 `contentX / contentWidth`，即 normalized 单元格下边界。
在当前 Node/JavaScript 数值语义下，公式层已可复现：

```text
floor((123 / 1920) * 1920) = 122
floor((39 / 1080) * 1080) = 38
```

单元格中点始终位于 `[0,1)`，经当前 mapper 可稳定落回选定内容像素，包括最后一行/列。
这证明当前正式链上存在一像素浮点边界风险，但公式复现不能替代 recording 集成行为的失败
测试，也不能证明它是历史 POC 偏差的唯一根因。历史偏差还可能来自旧分母、旧固定尺寸或把
DIP/image/content 混用。

**Alternatives considered**：直接使用 `imageCenter / imageSize` 在数学上等价，但没有明确保证
浮点乘回内容尺寸后落入目标整数单元格；给 click mapper 全局加 epsilon 会改变任意合法
normalized point 的边界语义；仅为共享 helper 的形式统一而无条件改 recording 也缺少行为证据。
三者均不采用。

## Decision 3：`context.vision` 是唯一公开入口

**Decision**：runner 的冻结 context 新增同级只读字段 `vision`，仅包含 `find`、`waitFor`、
`waitUntilGone`。现有 `context.automation` 五项方法和 manifest `apiVersion: 1` 保持不变；这是
对可信脚本 context 的向后兼容扩展。`profileId`、`scriptId`、lease、signal 与 `deadlineAt` 由
runner 绑定，脚本不能覆盖。

**Rationale**：Spec 使用独立 `vision.*` 语义；把 Vision 绑定在 runner context 可复用身份、
Profile lease、deadline 与可信脚本边界，同时不把 loader、文件路径、Electron 对象或 CDP 暴露
给脚本。

**Alternatives considered**：把方法混入 `automation` 会改变已冻结的五动作合同；让脚本传
Profile/script/root 会破坏归属；独立调度器或 IPC 会重复现有 runner。全部拒绝。

## Decision 4：视觉调用复用现有 Profile FIFO，并把一次等待视为一个动作

**Decision**：`find` 整体是一个 coordinator action；`waitFor`/`waitUntilGone` 的模板加载、
多轮 capture/match 与轮询间隔也整体是一个 action。同一 Profile 的后续 click/capture 必须排在
视觉等待之后，不同 Profile 继续使用独立 lease/action tail。Vision 内部直接调用绑定 backend，
不调用公开 `automation.capture()` 或 `automation.wait()`。

**Rationale**：公开 Automation API 会再次 enqueue；在已入队 Vision action 中调用会形成
嵌套 FIFO 自锁。把完整视觉等待作为单一动作还能防止未 await 的脚本动作插入同一视觉条件，
而 runner 的 stop/deadline signal 仍可从 FIFO 外触发。

**Alternatives considered**：每个 poll 分别 enqueue 会允许其他动作插队并破坏视觉等待原子性；
新建并行队列会重复 coordinator。均拒绝。

## Decision 5：v1 不使用 Worker，采用主进程协作式分片 matcher

**Decision**：PNG 由 Electron 11 `nativeImage.createFromBuffer()` 解码，使用 `toBitmap()` 的
副本跨 event-loop tick 匹配。纯 JS matcher 按固定像素工作量和约 8ms 内部实现预算分片，
在 slice 间通过 `setImmediate` 让出事件循环，并在每个 slice 前后检查 run signal、run deadline
与本地 timeout。约 8ms 不是硬实时或逐 slice 验收承诺；正式验收关注大 no-match 下 event-loop
heartbeat、取消/deadline 和另一个 Profile action 是否持续推进。不得实现同步全图扫描，也不
设计 WorkerPool。

**Rationale**：`1920×1080` full-frame no-match 是最坏路径，polling 会重复该路径；同步循环会
阻塞 runner timeout、用户停止、窗口关闭、CDP 和其他 Profile。协作式分片能让取消与 deadline
被主线程观察，且不增加依赖。单一 Worker 会造成跨 Profile head-of-line blocking；per-run
Worker 或 pool 需要 ASAR entry、Buffer 传输、崩溃映射、取消协议、退出清理和新并行生命周期，
超出 v1 的必要复杂度。

**Alternatives considered**：同步主线程不可满足响应性；单共享 Worker 会串住不同 Profile；
每调用/每 run Worker 启停和复制成本高；WorkerPool 超出范围。若实现期基准证明分片仍不能满足
既定响应验收，必须回到 Plan 重新记录证据，而不是在 Tasks 中静默引入 Worker。

## Decision 6：固定 exact-scale 相似度与确定性择优规则

**Decision**：截图与模板均通过同一个 Windows Electron 11 nativeImage 解码器得到四字节位图；
不缩放、不旋转。每个候选的置信度为四通道平均绝对误差的补数：

```text
confidence = 1 - sum(abs(searchByte - templateByte)) / (255 * 4 * templatePixelCount)
```

值夹在 `[0,1]`。模板 alpha 参与普通通道比较，不作为透明蒙版。matcher 扫描 ROI 时按
`y` 从小到大、同一行 `x` 从小到大；返回最高 confidence，完全并列时保留该 row-major 顺序的
第一个候选。低于 threshold 的候选可按最大误差预算提前终止，但不能改变最终结果。

**Rationale**：该算法只使用整数差与固定分母，纯 JS、确定、可分片、易于构造 threshold 边界
测试；模板和截图使用同一 decoder，位图通道排列不会造成两条路径不一致。POC 已证明
exact-scale + ROI + nativeImage 路线可行，本计划不增加 multi-scale 或其他识别算法。

**Alternatives considered**：归一化互相关需要更多浮点统计和零方差分支；感知色差、alpha mask、
特征匹配或 OpenCV 都扩大 v1。全部拒绝。

## Decision 7：公开 options 采用严格、有限合同

**Decision**：

- `threshold` 默认 `0.95`，允许有限数 `[0,1]`。
- `roi` 为截图像素整数矩形 `{x,y,width,height}`；省略表示完整截图。
- `waitFor`/`waitUntilGone` 的 `timeoutMs` 默认 `10000`，显式值为整数 `1..60000`。
- `pollIntervalMs` 默认 `250`，显式值为整数 `50..10000` 且不大于 `timeoutMs`。
- `find` 不接受 timing options；所有方法拒绝未知 option key。
- 显式 timeout 不得把本地 deadline 放到 run deadline 之后；默认 timeout 在运行剩余不足
  `10000ms` 时以 run deadline 为上界，让最终原因由 `run-timeout` 决定。

**Rationale**：默认值适合页面视觉等待且沿用现有单动作 60 秒上限；严格 key 校验避免脚本拼写
错误被静默忽略。`find` 已提供立即检查，因此等待的零 timeout 没有必要。

**Alternatives considered**：无限/零 timeout、重叠 polling、自动纠正非法值或允许 interval 大于
timeout 都会削弱可测性。全部拒绝。

## Decision 8：轮询与终止采用单一 first-settled 规则

**Decision**：第一轮立即 capture；每轮完成且条件未满足后，等待至少一个
`pollIntervalMs` 再开始下一轮，不重叠、不追赶丢失 tick。调用开始、capture 前后、每个 matcher
slice 前后、timer 醒来和 terminal settle 前都执行统一边界检查：先检查 runner signal/lease，
再检查本地 Vision timeout。signal 已终止时保留 `run-timeout` 或 `run-cancelled`；只有 run 仍
有效时才产生 `vision-timeout`。一旦结果 settle，移除 listener/清理 timer，后来事件不得改写。

**Rationale**：与 Clarify 的运行信号优先和 runner 的首终止原因合同一致。Electron
`capturePage()` 本身不能被取消；若 capture 期间收到取消，等待其 settle 后丢弃结果，不开始
decode/match/下一次 capture。

**Alternatives considered**：独立 AbortController、独立总运行 deadline 或固定 `setInterval`
会产生双重终止真相、重叠轮次或迟到 capture。全部拒绝。

## Decision 9：模板以 registry 记录的 packageRoot 为权威归属

**Decision**：loader 只接受 runner 绑定的 RegisteredScript 与公开 `templateId`。`templateId`
必须匹配 1～64 位 lowercase ASCII slug：`^[a-z0-9]+(?:-[a-z0-9]+)*$`，不含扩展名。目标固定为
`<registered packageRoot>/assets/vision/<templateId>.png`。任何文件读取前先拒绝非法 ID；随后做
lexical + realpath containment、精确大小写文件名、普通文件、PNG signature、最大 16 MiB、
IHDR/decoder 尺寸一致、非空且不超过 `1920×1080` 校验。成功模板可按
`registered package + templateId` 进程内缓存；失败不缓存，截图永不缓存。

**Rationale**：registry 允许包目录名与 manifest ID 不同，因此不能用 `root + scriptId` 重建
路径。模板是只读安装资源，不属于 `store` 的 Profile 用户数据。同脚本模板可跨其多个 Profile
复用只读字节，但每轮截图、ROI、匹配与结果仍绑定当前 Profile/run。

**Alternatives considered**：任意路径/URI、目录名拼 scriptId、manifest 模板清单、复制到 userData、
脚本自行 `fs` 读取或共享模板目录均无必要或违反边界。全部拒绝。

## Decision 10：沿用安全错误体系和现有打包通配

**Decision**：在 `errors.js` allowlist 中新增：

- `vision-input-invalid`
- `vision-template-id-invalid`
- `vision-template-not-found`
- `vision-template-read-failed`
- `vision-template-invalid`
- `vision-template-too-large`
- `vision-timeout`

窗口、截图和运行终止继续复用 `window-unavailable`、`capture-failed`、`run-cancelled`、
`run-timeout`。正常 no-match 仅由 `find -> null` 或 `waitUntilGone -> true` 表达。公开错误只含
稳定 `code/safeMessage`。`package.json` 已含 `automation-scripts/**`，无需修改 build 配置、
依赖或 lockfile；打包测试必须明确验证真实 `assets/vision/*.png` 的清单、字节和匹配一致性。

**Rationale**：未知错误会被现有 `AutomationError` 降级为 `script-failed`；不登记新码无法满足
FR-019/026。现有打包通配已递归包含 assets，不需要重复资源管线。

**Alternatives considered**：把所有失败归为 `script-failed/capture-failed` 无法恢复；新增依赖或
extraResources 会产生第二套开发/安装路径。全部拒绝。

## Resolved unknowns

Technical Context 的未知项已全部解决。公开默认值、匹配公式、alpha 语义、坐标公式、Worker
决策、轮询时序、错误码与模板边界均已形成可测试合同。
