# Feature Specification: 内置脚本共享视觉能力

**Feature Branch**: `feature/vision`

**Created**: 2026-08-10

**Status**: Draft

**Input**: User description: "为可信内置脚本提供正式共享视觉能力，支持 exact-scale 模板匹配、ROI、阈值、有限等待与取消，并使匹配中心可直接交给现有 automation.click()。"

## Clarifications

### Session 2026-08-10

- Q: `vision.find()` 完成有效截图与匹配但未找到达到 threshold 的目标时，应向脚本返回什么？ → A: 返回 `null`。
- Q: `vision.waitFor()` 在自己的 timeout 到达且目标仍未出现时，应如何向脚本表示结果？ → A: 抛出稳定的 `vision-timeout` 错误。
- Q: `vision.waitUntilGone()` 确认目标已消失并成功结束时，应向脚本返回什么？ → A: 返回 `true`。
- Q: 当视觉 timeout、用户 cancellation 和统一运行 deadline 几乎同时发生时，最终应保留哪个终止原因？ → A: 运行信号优先，否则视觉超时；结果一旦确定不得被后来事件覆盖。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 查找自己的模板并直接点击 (Priority: P1)

作为可信内置脚本作者，我希望按 `templateId` 在当前 Profile 的最新游戏截图中查找属于该脚本的模板，并获得匹配矩形、可直接点击的中心点和置信度，从而无需在每个脚本中重复实现截图解码、模板匹配和坐标转换。

**Why this priority**: 单次查找并把结果直接交给现有后台点击能力，是 Vision v1 的最小可用闭环，也是等待能力的基础。

**Independent Test**: 在当前固定游戏画面合同下，用包含已知 exact-scale 模板的截图执行 `vision.find()`，验证返回的 `rect` 位于截图像素空间、`center` 可原样传给 `automation.click()`，并通过后端实际派发坐标命中匹配目标。

**Acceptance Scenarios**:

1. **Given** 当前 Profile 窗口、webContents 和规范内容尺寸有效，且脚本自己的模板以原始比例出现在截图中，**When** 脚本按 `templateId` 调用 `vision.find()`，**Then** 返回该匹配的截图像素矩形、`[0,1)` normalized center 和 `[0,1]` 置信度。
2. **Given** 一次成功匹配，**When** 脚本把返回的 `center` 不作转换地传给 `automation.click()`，**Then** 当前正式坐标链把点击派发到该匹配目标的中心位置。
3. **Given** 脚本指定有效 ROI 和 threshold，**When** 目标在 ROI 内且达到 threshold，**Then** 只在 ROI 覆盖的截图像素区域内返回合格匹配；ROI 外更高置信度的相同图案不影响结果。
4. **Given** 截图中没有达到 threshold 的匹配，**When** 脚本调用 `vision.find()`，**Then** 方法返回 `null`，不把正常未匹配误报为运行失败。

---

### User Story 2 - 有限等待目标出现或消失 (Priority: P2)

作为可信内置脚本作者，我希望等待模板出现或消失，并能设置 timeout 与 polling interval，使脚本可以表达页面视觉条件，同时仍受本次运行的 cancellation 和 deadline 约束。

**Why this priority**: 游戏和 Flash 页面状态是异步变化的；有限、可取消的视觉等待能把已验证的单次识别转化为可靠脚本动作条件。

**Independent Test**: 用按轮次变化的截图序列分别验证目标出现、目标消失、超时、用户取消和运行 deadline，确认返回结果、截图轮次和终止原因均正确且没有超期轮询。

**Acceptance Scenarios**:

1. **Given** 目标最初不存在但在 timeout 内出现，**When** 脚本调用 `vision.waitFor()`，**Then** 系统按 polling interval 重新捕获并匹配，首次发现合格目标时返回与 `vision.find()` 兼容的匹配结果。
2. **Given** 目标最初存在但在 timeout 内消失，**When** 脚本调用 `vision.waitUntilGone()`，**Then** 系统在首次有效截图中确认指定 ROI 内无合格匹配时返回 `true`。
3. **Given** 目标状态在自身 timeout 内未满足且整个运行仍有效，**When** timeout 到达，**Then** 等待抛出稳定的 `vision-timeout` 错误，并且不再发起新的截图或匹配轮次。
4. **Given** 用户取消运行或统一运行 deadline 已先终止运行，**When** 任一视觉等待到达终止边界，**Then** 等待保留运行信号已确定的 `run-cancelled` 或 `run-timeout`，停止后续轮询，并且不会改写为 `vision-timeout`。
5. **Given** `waitUntilGone()` 第一次有效检查时目标已经不存在，**When** 方法执行，**Then** 它无需额外等待即可返回 `true`；该返回值只证明视觉条件满足，不证明此前点击或业务动作成功。

---

### User Story 3 - 安全维护脚本专属模板 (Priority: P3)

作为项目维护者，我希望模板随对应内置脚本一起维护和发布，脚本只能用 `templateId` 访问自己的模板，从而保持脚本包边界、安装包一致性和可诊断失败，而不开放任意文件或网络读取能力。

**Why this priority**: 共享视觉能力必须沿用可信内置脚本边界；模板来源不受控会扩大文件访问、跨脚本耦合和发布差异风险。

**Independent Test**: 构造有效模板、缺失模板、损坏 PNG、路径穿越、绝对路径、网络地址和跨脚本引用，验证只有当前脚本目录中的合法模板可被加载，其他请求全部被稳定拒绝且不读取边界外资源。

**Acceptance Scenarios**:

1. **Given** 模板位于 `automation-scripts/<script-id>/assets/vision/<template-id>.png`，且模板和脚本随同一安装包发布，**When** 当前脚本使用对应 `templateId`，**Then** Vision 只解析并使用该脚本自己的模板。
2. **Given** `templateId` 试图表达相对路径、绝对路径、路径穿越、网络资源或另一脚本的模板，**When** 脚本发起视觉调用，**Then** 请求在读取资源前被拒绝，并返回稳定的模板输入错误。
3. **Given** 模板缺失、不可读、不是有效 PNG 或尺寸无效，**When** 脚本发起视觉调用，**Then** 当前动作以可区分的模板错误结束，启动器和其他 Profile/脚本继续可用。
4. **Given** Windows x64 安装包包含一个带视觉模板的有效内置脚本，**When** 执行包内容与运行验证，**Then** 模板归属、发现结果和匹配行为与开发环境一致。

### Edge Cases

- `templateId` 为空、过长、含分隔符、点段、编码后路径语义、大小写歧义或不符合允许字符合同。
- 模板文件缺失、零尺寸、损坏、截断、扩展名正确但内容不是 PNG，或解码后尺寸与元数据不一致。
- 模板大于完整截图或指定 ROI；ROI 为零面积、越界、包含非有限值或不能形成有效整数像素矩形。
- threshold 位于允许范围边界，或为非有限值、越界值；timeout/polling interval 为零、负数、非有限值，或超出本次运行剩余 deadline。
- 多个位置具有相同或不同置信度的合格匹配；结果必须遵守公开、确定性的择优与并列规则。
- 目标恰好贴近截图或 ROI 边缘；返回矩形不得越界，中心必须仍满足 normalized point 合同。
- 在纯逻辑自动测试中构造截图 `imageSize` 与规范 `contentSize` 不相等、BrowserWindow DIP 采用另一组语义值；不得把截图像素直接误作内容坐标、BrowserWindow DIP 或 CDP 坐标，也不得把该构造测试解释为 DPI/多缩放产品支持。
- 匹配完成前后窗口关闭、webContents 销毁、规范 content size/zoom 合同失效或截图失败。
- 取消、运行 deadline、视觉 timeout、截图完成和匹配成功几乎同时发生；必须保留唯一、确定的终止结果。
- `waitUntilGone()` 遇到截图或模板错误；不得把“无法检查”误判为“目标已消失”。
- 隐藏、未聚焦或被遮挡的有效 Profile 窗口；页面阶段和 `GAME_READY` 仅作诊断或脚本策略，不单独禁用视觉能力。

## Requirements *(mandatory)*

### Scope

**In scope**:

- 向可信内置脚本提供共享的 `vision.find(templateId, options)`、`vision.waitFor(templateId, options)` 和 `vision.waitUntilGone(templateId, options)`。
- exact-scale 模板匹配、ROI、threshold、timeout、polling interval、cancellation/deadline，以及 `rect`、可点击 `center` 和 `confidence`。
- 脚本专属模板的固定归属、随包发布、输入校验、边界隔离和稳定失败结果。
- 当前固定游戏窗口/content-size、截图 metadata、normalized point、coordinate mapper 和 CDP 点击链的自动回归。

**Out of scope**:

- multi-scale、OCR、feature matching、object detection、rotation 或其他图像识别方式。
- Python/OpenCV 或其他外部运行时、第三方模板、任意文件路径或网络模板资源。
- Vision DSL、调度器、第三方脚本系统或新的输入能力。
- 自动登录、验证码识别、腾讯风控绕过、认证票据处理或跨 Profile 页面/模板访问。
- 在本阶段决定是否使用 Worker；执行位置和并发实现由 Plan 根据本规格的响应性、取消和旧运行时约束论证。

### Coordinate Contract Baseline

- Vision v1 的正式产品与验收环境固定为 `1920×1080` 内容画面和 Windows 100% 显示缩放；DPI/多缩放支持不属于本 Feature。当前 main 已更新固定窗口/content-size 行为，历史 POC 点击在该更新后出现偏差；具体偏差原因和坐标转换公式 MUST 在 Plan 阶段重新读取当前 `GameViewport`、`capture()`、coordinate mapper、backend/CDP 与相关测试后确定，本 Spec 和 Clarify 不预设公式。
- `capture()` 返回 PNG、PNG 解码图像自己的 `imageSize`、规范自动化 `contentSize` 和捕获时间。`imageSize` 描述截图像素空间，`contentSize` 描述自动化内容/页面坐标空间；合同不允许调用方假定二者始终相等。
- `automation.click()` 的正式输入是 `{ normalizedX, normalizedY }`，两个有限值均位于 `[0,1)`。后端在动作实际执行时按当时有效的规范 `contentSize` 映射为整数内容/页面坐标，再把该坐标直接用于 CDP 鼠标事件；BrowserWindow DIP 不是该输入或最终内容坐标。
- 当前正式合同要求 Vision 依据截图 metadata 与 `automation.click()` 的 normalized point 合同建立兼容结果。Vision 不得沿用或猜测历史 POC 公式；现有录点、capture 与 mapper 的具体换算关系由 Plan 基于当前真实源码和测试确认。

### Capability Availability Boundaries

- **Framework prerequisites**: 当前运行仍拥有 Profile lease，取消信号与 deadline 有效，Profile、所属窗口和 webContents 存在，规范内容尺寸与视觉输入有效；需要截图的轮次还必须成功取得可解码图像。
- **Script strategy**: 当前页面是否适合搜索某个模板、应使用哪个 ROI/threshold、找到后是否点击，均由可信脚本通过受限 API 表达。
- **Diagnostic-only signals**: 扫码、选服、Flash 加载、腾讯流程阶段和 `GAME_READY` 可用于诊断或脚本判断，但不得成为 `find`、视觉等待或模板加载的全局页面语义门槛。

### Functional Requirements

- **FR-001**: 运行上下文 MUST 向可信内置脚本提供只读、受限的 `vision` 能力，且第一版公开方法 MUST 仅包含 `find`、`waitFor` 和 `waitUntilGone`。
- **FR-002**: `vision.find(templateId, options)` MUST 针对当前 Profile 的一次新鲜截图执行一次 exact-scale 匹配，并在找到时返回匹配结果；完成有效截图与匹配但没有合格候选时 MUST 返回 `null`，MUST NOT 抛出“未找到”错误。
- **FR-003**: `vision.waitFor(templateId, options)` MUST 立即检查并按 polling interval 重试，首次找到合格匹配时返回与 `find` 相同合同的匹配结果；自身 timeout 到达且仍未找到时 MUST 抛出稳定的 `vision-timeout` 错误，MUST NOT 返回 `null` 或改写为运行 cancellation/deadline。
- **FR-004**: `vision.waitUntilGone(templateId, options)` MUST 立即检查并按 polling interval 重试，首次在有效截图的指定 ROI 内确认没有达到 threshold 的匹配时 MUST 返回 `true`；该结果只表示视觉条件满足，不承诺此前输入或业务动作成功，截图、解码、模板或窗口错误 MUST NOT 被解释为目标消失。
- **FR-005**: 三个方法 MUST 支持 exact-scale 模板匹配，第一版 MUST NOT 隐式缩放、旋转模板或使用本规格范围外的识别方式。
- **FR-006**: 三个方法 MUST 支持可选 ROI；ROI MUST 以当前截图 `imageSize` 的像素坐标描述，匹配不得读取 ROI 外像素，返回 `rect` 也 MUST 完全位于 ROI 和截图边界内。
- **FR-007**: 三个方法 MUST 支持可选 threshold；置信度和 threshold MUST 使用同一 `[0,1]` 合同，只有 confidence 大于或等于 threshold 的候选才能被视为匹配。
- **FR-008**: 所有成功匹配 MUST 返回 `rect`、`center` 和 `confidence`；`rect` MUST 明确属于截图像素空间，`center` MUST 是 `{ normalizedX, normalizedY }` 且可不经脚本转换直接作为现有 `automation.click()` 的输入，`confidence` MUST 为 `[0,1]` 的有限值。
- **FR-009**: Vision 生成 `center` 时 MUST 同时尊重捕获时的 `imageSize`/`contentSize` metadata 与当前正式 normalized point 合同；MUST NOT 把 screenshot pixel、规范 content/page coordinate、BrowserWindow DIP 和 CDP coordinate 当作同一坐标系。
- **FR-010**: 匹配结果交给 `automation.click()` 后，现有 coordinate mapper MUST 在执行时使用有效规范 `contentSize`；窗口合同漂移或坐标无效时 MUST 拒绝动作，不得盲目点击历史或推测位置。
- **FR-011**: 当前固定 `1920×1080 + 100%` 窗口/content-size 场景 MUST 有自动回归覆盖完整的 screenshot pixel → Vision `center` → `automation.click()` normalized point → coordinate mapper → CDP coordinate 链；纯逻辑测试 MUST 另外构造 `imageSize != contentSize` 及 BrowserWindow DIP 使用不同语义值的输入以防坐标系混用，但这些构造用例 MUST NOT 扩展为 DPI/多缩放支持或正式验收环境。
- **FR-012**: 当多个候选达到 threshold 时，Vision MUST 返回最高置信度候选；置信度并列时 MUST 使用公开且确定的空间顺序，确保相同输入得到相同结果。
- **FR-013**: `waitFor` 和 `waitUntilGone` MUST 支持有限 timeout 与 polling interval，验证其为有限有效值，并确保视觉 timeout 不超过当前运行剩余 deadline；任一视觉等待自身 timeout 到达且运行仍有效时 MUST 抛出 `vision-timeout`。
- **FR-014**: 所有视觉方法 MUST 服从现有 Profile lease、动作 FIFO、运行 cancellation 和统一 deadline。统一运行 deadline 是脚本启动时由现有 runner 设置、由本次运行所有动作共享且不可由单次视觉调用延长的最晚结束时间。每个终止边界 MUST 先检查现有运行信号：若信号已终止，MUST 保留其已确定的 `run-cancelled` 或 `run-timeout`；仅当运行仍有效且视觉 timeout 到达时才产生 `vision-timeout`。任何视觉调用结果一旦确定 MUST NOT 被后来事件改写，终止后 MUST NOT 开始新的截图或匹配轮次。
- **FR-015**: 视觉方法的通用可用性 MUST 仅依赖其客观所需的 Profile、窗口、webContents、规范内容尺寸、输入和动作生命周期；MUST NOT 以页面阶段、页面角色、Flash 状态或 `GAME_READY` 作为全局硬门槛。
- **FR-016**: 模板 MUST 属于对应脚本，并只允许通过 `templateId` 解析到 `automation-scripts/<script-id>/assets/vision/<template-id>.png`；调用方 MUST NOT 提供任意文件路径、URI 或替代模板根目录。
- **FR-017**: 模板解析 MUST 将当前 `scriptId` 作为不可由脚本覆盖的归属边界；一个脚本 MUST NOT 读取、探测或引用另一脚本的模板。
- **FR-018**: `templateId` MUST 采用有限、明确且不含路径语义的标识符合同；空值、路径分隔符、点段、绝对路径、路径穿越、编码后绕过、网络资源和其他越界表达 MUST 在资源读取前被拒绝。
- **FR-019**: 模板缺失、不可读、不是有效 PNG、解码失败、尺寸无效或大于搜索区域时 MUST 产生稳定、可区分且可恢复的错误；单次错误 MUST NOT 使启动器崩溃或影响其他 Profile/脚本。
- **FR-020**: ROI、threshold、timeout、polling interval 及其他公开 options MUST 被严格校验；非法、非有限、越界或互相矛盾的输入 MUST 在匹配前以稳定输入错误拒绝，不得静默纠正为另一含义。
- **FR-021**: 每轮视觉检查 MUST 使用同一次捕获的 PNG、`imageSize` 和 `contentSize`；不得把不同捕获轮次的图像与 metadata 混合，也不得跨 Profile 复用截图结果。
- **FR-022**: 截图和模板内容 MUST 只在完成当前视觉动作所需的范围和时限内使用，MUST NOT 默认写入普通日志、错误详情、用户数据或长期存储；诊断信息 MUST 仅包含安全的脚本、Profile、阶段、时长、尺寸和稳定错误代码等 allowlist 字段。
- **FR-023**: 模板 MUST 作为对应内置脚本的只读安装资源随 Windows x64 包发布；开发环境与安装包 MUST 发现相同模板并产生一致匹配结果，模板不得进入 Profile 用户数据或跨脚本共享目录。
- **FR-024**: Vision MUST 保持现有可信内置脚本边界，不得向脚本暴露 BrowserWindow、webContents、CDP、任意文件读取、网络读取、Session、Cookie、票据或认证状态数据。
- **FR-025**: 本 Feature MUST 保持 Node.js 16.20.2、npm 8.19.4、Electron 11.5.0、PPAPI Flash 和 Profile Session/Partition 隔离基线，不得要求 Python/OpenCV 或其他外部运行时，不得无故修改核心依赖或锁文件。
- **FR-026**: Vision 的错误与等待终止结果 MUST 至少能区分：视觉输入无效、模板被拒绝、模板缺失/解码失败、截图失败、窗口不可用、`find` 返回 `null` 的未找到、`vision-timeout`、`run-cancelled` 和统一 deadline 的 `run-timeout`；原始图片、路径边界外信息和底层敏感错误文本不得成为公开合同。

### Key Entities

- **视觉模板**: 随一个可信内置脚本发布的只读 PNG 资源，由所属 `scriptId` 和安全 `templateId` 唯一确定。
- **视觉查询**: 一次 `find`、`waitFor` 或 `waitUntilGone` 调用，包含模板身份、匹配 options、当前 Profile/run 归属及生命周期限制。
- **搜索区域（ROI）**: 当前截图像素空间内的有限矩形，限定本轮允许参与匹配的像素。
- **匹配结果**: 同一次捕获产生的 `rect`、normalized `center` 和 `confidence`；其中只有 `center` 属于现有点击输入合同。
- **捕获 metadata**: 同一截图的 `imageSize`、规范 `contentSize` 和捕获时间，用于区分截图像素与自动化内容坐标。
- **视觉等待**: 由自身 timeout、polling interval、运行 cancellation 和统一运行 deadline 共同约束的有限轮询生命周期；统一 deadline 约束整个脚本运行，自身 timeout 只约束本次视觉等待。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 在覆盖无 ROI、有效 ROI、threshold 边界、目标贴边和多个候选的固定截图测试集中，所有已知 exact-scale 目标的 `rect` 与预期截图像素矩形完全一致，合格目标检出率为 100%，低于 threshold 的候选误报数为 0。
- **SC-002**: 在 Vision v1 正式的固定 `1920×1080 + 100%` 环境中，所有 Vision `center` 原样传入 `automation.click()` 后均派发到预期匹配中心；在额外构造 `imageSize != contentSize` 和不同 BrowserWindow DIP 语义值的纯逻辑测试中，坐标系混用用例数为 0，且不形成 DPI/多缩放支持承诺。
- **SC-003**: ROI 回归中，ROI 外目标返回数为 0；相同截图、模板和 options 重复执行 100 次时，所选 `rect`、`center` 和 `confidence` 的结果一致率为 100%。
- **SC-004**: `waitFor` 和 `waitUntilGone` 对首次即满足、后续轮次满足及 timeout 三类序列的终止结果正确率为 100%；实际捕获次数不超过由 timeout 和 polling interval 推导出的允许次数，终止后新增捕获数为 0。
- **SC-005**: 在用户取消和运行 deadline 回归中，100% 的视觉等待保留正确终止原因，并在取消或 deadline 可被运行时观察后的 1 秒内停止发起新轮次；被误报为普通视觉 timeout 的次数为 0。
- **SC-006**: 对相对路径、绝对路径、路径穿越、编码后绕过、网络地址和跨脚本引用六类越界输入，读取前拒绝率为 100%；跨脚本或跨 Profile 模板/截图读取次数为 0。
- **SC-007**: 对模板缺失、损坏 PNG、非法 ROI、非法 threshold、无效 timeout/polling interval、窗口关闭和截图失败场景，100% 返回预期稳定分类，启动器崩溃数为 0，其他 Profile 的视觉与自动化成功率不受影响。
- **SC-008**: Windows x64 开发环境与安装包的模板清单和版本一致，预期模板遗漏数为 0；同一组验收截图的匹配结果一致率为 100%。
- **SC-009**: 本 Feature 相关自动化回归与既有 GameViewport、截图、录点、normalized coordinate mapper、后台 CDP 点击和 Profile 并发回归全部通过，现有通过用例退化数为 0。

## Assumptions

- POC 已验证固定分辨率 exact-scale 模板匹配、ROI 性能收益以及不需要 multi-scale；本 Feature 将这些视为已证实的技术可行性事实，不寻找或恢复 POC 分支。
- Vision 的调用者仍是经项目审核并随包发布的可信内置脚本；本 Feature 不承诺隔离恶意同进程脚本。
- 模板由对应脚本维护者从合法、稳定的游戏画面制作并随脚本版本化，不来源于用户上传、第三方安装或网络下载。
- `find` 是单次检查；`waitFor` 和 `waitUntilGone` 是有限轮询。未明确的默认 threshold、timeout、polling interval 及允许范围由 Plan 在满足本规格可测性和统一 deadline 的前提下确定并形成公开合同。
- ROI 与 `rect` 属于截图像素空间；返回的 `center` 属于现有 `automation.click()` normalized point 合同。具体 normalize 算法、历史点击偏差根因及内部坐标中间值 MUST 在 Plan 阶段读取当前源码、mapper、capture、backend 和测试后确定，Clarify 与本 Spec 不写死公式。
- 是否使用 Worker 是 Plan 阶段的响应性与兼容性决策；无论选择何种执行位置，都必须满足取消、deadline、动作 FIFO、旧版运行时和成功标准。
- 第一版正式交付与完整验收平台为 Windows x64，Vision v1 产品环境固定为 `1920×1080 + 100%`；现有 Electron/PPAPI 与 Profile Session 隔离能力继续作为依赖，不在本 Feature 中升级或重构其产品边界。
