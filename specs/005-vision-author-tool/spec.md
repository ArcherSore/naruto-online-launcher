# Feature Specification: 外部 Vision Author Tool

**Feature Branch**: `tools/vision-author`

**Created**: 2026-08-10

**Status**: Draft

**Input**: User description: "实现仅供项目开发者使用、连接当前运行 Launcher/Profile 正式 capture 链的外部 Vision Author Tool，用于从冻结帧制作真实游戏自动化脚本所需的 Template 与 ROI，并生成适配现有 Vision API 的示例代码；工具不得进入正式 Windows 发布包。"

## Clarifications

### Session 2026-08-10

- Q: Live 状态是否应按固定的约 1 秒 tick 尝试启动 capture，并在上一轮尚未完成时跳过当前 tick，而不是等上一轮结束后再等待 1 秒？ → A: 采用固定约 1 秒 tick；空闲时启动 capture，上一轮尚未完成时跳过该 tick，禁止并发、排队和补跑。
- Q: V1 的 Live View 是否只提供固定约 1000ms 刷新间隔，而不允许开发者选择 250ms、500ms 或其他间隔？ → A: V1 固定约 1000ms，不提供刷新间隔选择或自定义输入。
- Q: Target Script 是否必须由 Author Tool 枚举仓库中现有可信 `automation-scripts` 并供开发者选择，同时禁止手工输入 `scriptId` 或输出路径？ → A: Author Tool 枚举现有可信脚本供选择，禁止手工输入 `scriptId`、脚本目录或输出路径。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 选择 Profile 并冻结正式画面 (Priority: P1)

作为项目开发者，我希望查看当前 Launcher 中可供 authoring 的 Profile，选择其中一个并持续看到来自该 Profile 正式 capture 能力的完整游戏画面，从而确信我制作模板时看到的截图像素与脚本运行时 Vision 使用的是同一套画面和坐标语义。

**Why this priority**: 正确的画面来源、Profile 归属和冻结语义是所有模板与 ROI 产物可信的前提；没有这一闭环，后续框选和保存均没有使用价值。

**Independent Test**: 启动 Launcher 与至少一个 Profile 后打开 Author Tool，选择 Profile，观察连续帧及 metadata，再执行手动 Freeze、恢复 Live 和开始框选触发的自动 Freeze；验证冻结期间画面与帧身份保持不变且没有新增 capture。

**Acceptance Scenarios**:

1. **Given** 当前 Launcher 中存在一个满足 capture 客观前提的 Profile，**When** 开发者在 Author Tool 中选择该 Profile，**Then** 工具显示该 Profile 的安全身份信息，并开始显示由其正式 capture 能力返回的完整游戏画面及对应 metadata。
2. **Given** 工具处于 Live 状态，**When** 固定的约 1 秒刷新 tick 到达，**Then** 若当前没有未完成 capture，工具启动一轮新 capture；若上一轮尚未完成，则跳过该 tick，且不并发、不排队、不补跑。
3. **Given** 已显示一个完整有效帧，**When** 开发者手动 Freeze，**Then** 当前帧、Profile 身份、原始 PNG 和 metadata 被固定，直到恢复 Live 前均不发生变化。
4. **Given** 工具处于 Live 状态并已显示一个完整有效帧，**When** 开发者开始 Template 或 ROI 框选，**Then** 工具先自动冻结该已显示帧，再以该帧作为框选依据，而不是在框选开始时重新 capture。
5. **Given** 当前处于 Freeze 状态，**When** 开发者恢复 Live，**Then** 工具重新获取后续正式 capture 帧；既有 Template/ROI 参数可以保留为参考，但不再被视为当前 Live 帧的可保存选区。
6. **Given** Profile 列表中的目标最初尚未启动或其可用性随后发生变化，**When** 开发者点击刷新 Profile，**Then** 工具原地重新列举当前 Launcher Profile 及其可用性，无需刷新整个 Author 页面。
7. **Given** 工具处于 Live 状态且 Author 窗口失焦、被其他窗口遮挡或处于后台，**When** 固定刷新 tick 到达，**Then** 工具仍按约 1 秒节奏尝试 capture，不因 Chromium 后台节流而停止刷新。
8. **Given** Live View 已提交一个 frame 给图像元素，**When** 同一 frame 上仅发生 tick 计数、capture pending 或其他非帧状态更新，**Then** 工具不得重复设置该 frame 的图像 source 或重启其解码；只有不同的新 frame 成为当前显示帧时才提交一次新 source。
9. **Given** Author Renderer 运行于项目锁定的 Electron 11 浏览器环境，**When** 选择 Profile 或 Resume Live，**Then** 固定 ticker 必须以浏览器 timer host 作为正确调用 receiver 成功注册，不得在 t0 capture 后因 `Illegal invocation` 停止。

---

### User Story 2 - 在同一冻结帧框选 Template 与 ROI (Priority: P2)

作为项目开发者，我希望在同一个冻结帧上分别框选 Template 区域和搜索 ROI，并查看准确的 screenshot-pixel 坐标、尺寸与 Template crop preview，从而能够用运行时 Vision 所理解的坐标制作可复现参数。

**Why this priority**: Template 和 ROI 必须共享同一画面上下文；准确的截图像素坐标和原始像素裁剪是 exact-scale 匹配可靠性的核心。

**Independent Test**: 对一个尺寸已知的冻结帧，在四角、边缘和中部执行正向与反向拖选，分别创建和调整 Template 与 ROI；核对显示矩形、crop preview 和原始 PNG 对应像素，并验证两类选区互不覆盖状态。

**Acceptance Scenarios**:

1. **Given** 当前存在可用于 authoring 的冻结帧，**When** 开发者框选 Template 区域，**Then** 工具显示该矩形在该帧 `imageSize` 截图像素空间中的整数 `x`、`y`、`width`、`height`，并显示来自同一原始 PNG 对应像素的 crop preview。
2. **Given** 同一冻结帧，**When** 开发者框选搜索 ROI，**Then** 工具独立保存并显示 ROI 的整数截图像素矩形，不改变已选 Template 区域。
3. **Given** Template 和 ROI 均已选定，**When** 开发者调整其中一个，**Then** 另一个选区保持不变，且两者都继续引用同一个冻结帧身份。
4. **Given** 工具为了适配可用空间而缩放显示冻结画面，**When** 开发者在显示画面上框选，**Then** 工具显示的矩形与原始截图像素边界一致，显示缩放不会改变、插值或猜测 authoring 坐标。
5. **Given** 当前帧不满足正式 Vision authoring 的尺寸或坐标合同，**When** 开发者查看或尝试使用该帧，**Then** 工具明确显示不满足项，允许诊断性查看，但阻止将其保存为正式模板，且不会静默缩放、裁正或替换 metadata。
6. **Given** 开发者已进入 Template 或 ROI 框选模式，**When** 按住鼠标并拖动，**Then** 对应选择框和截图像素坐标随指针移动实时更新，并仅在释放指针后提交最终选区及 Template preview。

---

### User Story 3 - 保存模板并复制运行时参数 (Priority: P3)

作为项目开发者，我希望从 Author Tool 枚举的现有可信脚本中选择 Target Script，为其输入安全的 `templateId`，将冻结帧中的 Template 区域保存到脚本专属目录，并复制 ROI 及 `find()` / `waitFor()` 示例，从而直接把 authoring 结果用于现有 `context.vision` 脚本。

**Why this priority**: 保存和代码生成把可信的截图选择转化为仓库内可审查、可运行的脚本资产，是工具的最终交付闭环。

**Independent Test**: 从工具枚举结果选择一个现有可信脚本，再选择有效冻结帧、Template 和 ROI，输入合法 `templateId` 后保存并复制输出；验证文件位置、PNG 像素、ROI 值和两种示例代码均与冻结帧选择一致，再覆盖伪造 `scriptId`、任意输出路径、非法 `templateId`、重复文件和写入失败场景。

**Acceptance Scenarios**:

1. **Given** 开发者已从工具枚举结果中明确选择现有可信 Target Script，当前冻结帧合同有效且已框选 Template，**When** 开发者输入符合现有 Vision 模板标识符合同的 `templateId` 并保存，**Then** 工具以该脚本 registry record 的真实 `packageRoot` 为权威，把对应原始像素区域保存为 `automation-scripts/<registered-package>/assets/vision/<templateId>.png`；`<registered-package>` 表示该可信脚本在仓库中的实际包目录，不要求等于 manifest `scriptId`，保存不使用新 capture，也不对裁剪结果做 resize 或重采样。
2. **Given** `templateId` 为空、过长、含大写、空白、点段、路径分隔符或其他路径语义，**When** 开发者尝试保存，**Then** 工具在任何文件写入前拒绝操作，并明确说明允许的标识符格式。
3. **Given** 目标路径已有同名模板，**When** 开发者首次请求保存，**Then** 工具不会静默覆盖；只有开发者对该确切脚本与文件作出明确替换确认后才可写入。
4. **Given** 同一冻结帧上已有有效 ROI，**When** 开发者复制 ROI，**Then** 剪贴板内容准确表达现有 Vision API 接受的 `{ x, y, width, height }` 截图像素矩形。
5. **Given** 已有合法 `templateId`，并可选地存在有效 ROI，**When** 开发者生成或复制示例，**Then** 工具分别提供可直接改写使用的 `context.vision.find()` 与 `context.vision.waitFor()` 示例，且其中的 `templateId` 和 ROI 与当前冻结帧参数完全一致。
6. **Given** 开发者恢复 Live、切换 Profile、冻结帧失效或任何 active selection 不再绑定当前冻结帧，**When** 开发者尝试保存，**Then** 工具阻止保存并要求基于一个当前有效冻结帧重新确认或框选；保留的旧参数仍可查看或复制为参考。

---

### User Story 4 - 保持开发工具边界 (Priority: P4)

作为项目维护者，我希望 Author Tool 及其连接入口仅存在于仓库开发环境，并且只暴露完成 Profile 列举、正式 capture 与受控模板保存所需的数据和操作，从而避免把开发工具变成 Launcher 用户功能、公开 API 或第三方扩展面。

**Why this priority**: 工具会接触真实游戏画面和仓库脚本资产；开发环境隔离与最小暴露是发布安全和长期范围控制的必要条件。

**Independent Test**: 分别检查开发环境启动、无 Launcher/连接中断行为、跨 Profile 请求、认证敏感数据暴露和正式 Windows 发布包内容，验证开发者可完成 authoring，而发行用户无法发现或启动该工具或连接入口。

**Acceptance Scenarios**:

1. **Given** 处于受支持的仓库开发环境且普通 Launcher 实例未占用 single-instance lock，**When** 开发者通过 Vision Author developer entry 启动正式 Launcher 主进程与外部 Author Tool，**Then** 工具连接该入口启动的正在运行 Launcher 并完成本规格所述工作流，但不向普通已运行实例注入，也不要求 Launcher 提供面向第三方的公开接口。
2. **Given** Launcher 未运行、连接中断或所选 Profile 已关闭，**When** 工具尝试刷新或保存，**Then** 工具停止依赖该 Profile 的 authoring 操作、显示可恢复错误，并且不会回退到桌面截图、窗口截图或导入图片。
3. **Given** 同时存在多个 Profile，**When** 开发者选择其中一个进行 Live/Freeze 和保存，**Then** 每个显示帧与产物均只绑定所选 Profile，不读取或混合其他 Profile 的画面、Session 或状态。
4. **Given** 构建正式 Windows 发布包，**When** 检查包内容和运行入口，**Then** Author Tool 的代码、资源、启动入口及仅为其提供的开发者连接入口均不包含在发行包中。
5. **Given** Author Tool 已连接 Launcher，**When** 检查其可见数据与能力，**Then** 不包含 QQ 密码、Cookie、登录票据、验证码、Session 存储、任意页面数据访问或与本规格无关的自动化控制能力。

### Edge Cases

- Launcher 当前没有 Profile、只有正在创建或已关闭的 Profile，或 Profile 在列表显示后立即失效。
- 固定刷新 tick 到达时上一轮 capture 尚未结束、capture 长时间挂起、失败后恢复，或连接在返回帧途中断开；忙碌 tick 必须跳过，不得并发、排队、补跑或把迟到帧归给新选择的 Profile。
- 开发者在 capture 完成前切换 Profile，或快速连续切换多个 Profile；旧请求返回的 PNG 与 metadata 不得替换当前 Profile 画面。
- Freeze 恰好发生在新帧返回、Template/ROI 框选开始或 Profile 失效的同一时刻；必须产生一个唯一且可解释的 frozen frame，或明确报告无法冻结。
- PNG 无法解码、PNG 实际尺寸与 `imageSize` 不一致、`imageSize`/`contentSize` 缺失或非法、Profile 身份缺失，或 metadata 不符合当前正式 Vision authoring 合同。
- 框选从任意方向拖动、起止点相同、超出图片边界、落在缩放显示的留白区域，或矩形经像素边界换算后成为零面积。
- Template 大于 ROI、ROI 不包含 Template，或两者重叠关系变化；工具不得臆测二者必须包含，但必须保持各自准确坐标并让生成结果忠实反映选择。
- 选区已生成后恢复 Live、切换 Profile、重新 Freeze 或冻结帧失效；旧参数可保留参考，但不得冒充新帧产物完成保存。
- 仓库中没有可枚举的可信脚本，枚举后的 Target Script 在保存前失效，或请求试图手工提供 `scriptId`、脚本目录或输出路径。
- `templateId` 大小写歧义、同名文件、目标目录缺失、文件只读、写入失败或写入过程中断。
- 复制操作因系统剪贴板不可用而失败；屏幕上的 ROI 和示例内容仍应保留，且失败不得触发保存或重新 capture。
- Author Tool 自身缩放、窗口尺寸或显示器变化；不得改变已冻结原始 PNG、框选像素或已生成参数。
- 普通 `npm start` Launcher 已运行并占用 single-instance lock；developer entry 必须 fail closed，提示开发者关闭该实例后从 developer entry 重启，不得尝试事后注入或开放普通实例连接面。

## Requirements *(mandatory)*

### Scope

**In scope**:

- 仓库开发环境中的外部 Vision Author Tool，以及仅支持该工具与当前运行 Launcher 协作所需的开发者入口。
- 当前可用 Profile 的列举、选择、正式 capture Live View、无重叠刷新、手动/自动 Freeze 和恢复 Live。
- 同一 frozen frame 上的 Template 与 ROI 独立框选、截图像素坐标、crop preview、metadata 与合同校验。
- 向现有可信内置脚本专属目录保存 Template PNG、复制 ROI，以及生成/复制适配现有 `context.vision.find()` / `waitFor()` 的示例。
- 开发环境隔离、Profile 归属、错误恢复、敏感数据最小化与正式 Windows 发布包排除验证。

**Out of scope**:

- OCR、多尺度识别、神经网络、特征匹配、旋转匹配、目标检测或其他新识别算法。
- 取色工具、Swipe、Keyboard、点击执行、输入录制或其他自动化动作能力。
- Pipeline/DSL 编辑器、调度器、第三方脚本系统、公开 External API 或插件协议。
- 用户模板导入、任意外部截图文件、网络模板、第三方模板库或跨脚本共享模板目录。
- Windows 桌面截图、HWND/BitBlt 截图、Launcher 窗口手工 crop，或将画面自动 resize 到 `1920×1080`。
- 面向普通 Launcher 用户的入口、设置、帮助或支持承诺，以及把 Author Tool 纳入正式发布包。
- V1 中由开发者选择预设刷新间隔或输入自定义刷新间隔。
- 在 Specify 阶段决定 Author Tool 与 Launcher 的通信协议、Electron 进程结构、文件模块拆分、是否独立 package 或具体 UI 技术实现。

### Functional Requirements

- **FR-001**: Author Tool MUST 仅定位为仓库开发者工具，MUST NOT 成为普通用户 Launcher 功能、公开 Launcher API、第三方插件协议或正式发布能力。
- **FR-002**: 工具 MUST 能列出当前正在运行 Launcher 中满足安全身份展示要求的 Profile，并允许开发者明确选择一个 Profile 作为当前 capture 与 authoring 目标；MUST 提供显式刷新 Profile 操作，以原地重新列举 Profile 及可用性而无需刷新整个 Author 页面。
- **FR-003**: 可选择的 Profile MUST 以 Launcher 当前正式 Profile/窗口 capture 能力的客观可用性为依据；页面阶段、Flash 状态或 `GAME_READY` 可以显示为诊断信息，但 MUST NOT 在没有独立安全必要性时成为全局 authoring 门槛。
- **FR-004**: 工具 MUST 只通过所选 Profile 的正式 capture 能力取得完整游戏画面；MUST NOT 将桌面截图、HWND/BitBlt、Launcher 窗口手工 crop、自动 resize 后的画面或外部图片文件用作正式 authoring 来源或失败回退。
- **FR-005**: 每个完整帧 MUST 将原始 PNG 与同次 capture 的 metadata 作为不可拆分的单元，metadata 至少包含 `imageSize`、`contentSize`、捕获时间和足以确认所选 Profile 的安全身份；MUST NOT 混用不同 capture 或不同 Profile 的图像与 metadata。
- **FR-006**: V1 Live 状态 MUST 使用固定的约 1000 毫秒 tick 尝试启动 capture，MUST NOT 提供预设或自定义刷新间隔选择；tick 到达且没有未完成 capture 时 MUST 启动一轮 capture，上一轮尚未完成时 MUST 跳过该 tick。任何时刻同一工具实例对当前 Profile 最多只能有一个 capture 未完成，跳过的 tick MUST NOT 排队、补跑或改变后续 tick 节奏；Author 窗口失焦、被遮挡或处于后台时该节奏 MUST 继续，不得受 Chromium 后台节流影响。Renderer 调用原生 timer MUST 保留 Electron 11 浏览器 timer host receiver，不得在 t0 capture 后因 `Illegal invocation` 导致 ticker 注册失败。
- **FR-007**: 新帧只有在 PNG、metadata 和 Profile 归属均完整且仍对应当前选择时才能替换 Live View；失败、迟到或来自旧 Profile 的结果 MUST NOT 覆盖最近一个有效显示帧。Renderer MUST 以 frame identity 去重图像 source 提交：tick 计数、pending/error/mode 等非帧状态变化 MUST NOT 对同一 frame 重复设置 source 或重启图片解码。
- **FR-008**: 工具 MUST 提供明确的 Live 与 Freeze 状态。Freeze MUST 固定当前完整显示帧的原始 PNG、metadata、Profile 身份和帧身份，并停止后续周期 capture，直至开发者恢复 Live。
- **FR-009**: 开发者开始 Template 或 ROI 框选时，工具 MUST 在使用选择输入前自动 Freeze 当前完整显示帧；此操作 MUST NOT 为框选另行 capture 或替换已显示帧。
- **FR-010**: Template 区域、ROI、crop preview、复制参数与模板保存 MUST 记录并校验其 frozen frame 身份；模板保存所使用的帧 MUST 与 Template 框选和 preview 使用的帧完全相同。
- **FR-011**: 恢复 Live 后，工具 MAY 保留既有 Template/ROI 参数作为参考，但 MUST 清楚区分这些参数与当前 Live 画面，且 MUST NOT 允许它们在未重新绑定当前有效 frozen frame 的情况下保存模板。
- **FR-012**: 工具 MUST 允许在同一 frozen frame 上分别创建、查看和调整 Template 区域与搜索 ROI；调整任一选区 MUST NOT 隐式改变另一选区；按住指针拖动期间，对应选择框和截图像素坐标 MUST 随指针移动实时显示，最终选区与 Template preview 仅在释放指针后提交。
- **FR-013**: Template 和 ROI MUST 使用当前 frozen frame `imageSize` 的 screenshot-pixel 矩形 `{ x, y, width, height }`；所有值 MUST 是落在原始图像边界内的整数，宽高 MUST 大于零。
- **FR-014**: 无论冻结画面在工具中如何适配显示，框选、显示坐标、crop preview、复制值和保存 crop 均 MUST 回到原始 screenshot pixel；工具 MUST NOT 把界面显示像素、内容坐标或其他坐标空间冒充截图像素。
- **FR-015**: crop preview MUST 来自 frozen frame 原始 PNG 的 Template 像素矩形，且 MUST 在选择或帧发生变化时明确更新或失效；不得使用另一次 capture、缩略图或重建画面生成 preview。
- **FR-016**: 工具 MUST 显示 frozen frame 的 `imageSize`、`contentSize`、Profile 身份、捕获时间、Live/Freeze 状态和 authoring 合同有效性，使开发者能够判断当前选区的坐标上下文。
- **FR-017**: 工具 MUST 按当前正式 Vision authoring 尺寸与坐标合同校验每个候选 frozen frame，包括 PNG 实际尺寸、`imageSize`/`contentSize` 有效性及其允许关系；不满足合同时 MUST 明确列出失败原因并阻止模板保存，MUST NOT 静默缩放、裁正、替换 metadata 或自动修复为 `1920×1080`。
- **FR-018**: 工具 MUST 枚举仓库中符合现有可信脚本资格的 `automation-scripts` 并仅允许开发者从枚举结果选择一个 Target Script；MUST NOT 接受手工输入的 `scriptId`、脚本目录或输出路径。模板保存范围 MUST 由所选脚本 registry record 的真实 `packageRoot` 确定，并限于其 `assets/vision/`；对应仓库路径为 `automation-scripts/<registered-package>/assets/vision/`，其中实际包目录不要求等于 manifest `scriptId`。工具 MUST NOT 创建第三方脚本或跨脚本写入。
- **FR-019**: `templateId` MUST 与现有 Vision API 的标识符合同一致：长度为 1–64，仅含小写英文字母、数字及分隔非空段的单连字符；路径、扩展名、空白、大写、连续/首尾连字符和任何其他路径语义 MUST 在写入前被拒绝。
- **FR-020**: 保存模板 MUST 仅裁取当前有效 frozen frame 原始 PNG 中 Template 矩形对应的原始像素，输出为所选 registry record 的 `<packageRoot>/assets/vision/<templateId>.png`，其仓库相对路径为 `automation-scripts/<registered-package>/assets/vision/<templateId>.png`；MUST NOT 在保存时重新 capture、resize、重采样或改用 preview 像素。
- **FR-021**: 若目标文件已存在，工具 MUST 在写入前显示确切目标脚本与 `templateId` 并取得明确替换确认；MUST NOT 静默覆盖。若 preflight 时不存在的目标在 commit 前出现，commit MUST 将其视为新冲突、保持写入数为 0，并要求重新取得明确替换确认。取消或写入失败 MUST 保留原文件不被部分结果替换。
- **FR-022**: 工具 MUST 支持复制当前有效 ROI，复制值 MUST 精确使用现有 Vision API 接受的截图像素 `{ x, y, width, height }` 语义。
- **FR-023**: 工具 MUST 能分别生成并复制适配现有 `context.vision.find()` 与 `context.vision.waitFor()` 的示例；示例 MUST 使用当前合法 `templateId`，存在有效 ROI 时 MUST 使用其精确值，不得引入本 Feature 范围外的 API 或参数。
- **FR-024**: 未选择 Profile/目标脚本、没有完整 frozen frame、Template 无效、帧合同无效、选区帧不一致或目标路径越界时，工具 MUST 在任何模板写入前阻止保存并给出可执行的恢复提示。
- **FR-025**: Launcher 不可用、连接断开、Profile 关闭或 capture 失败时，工具 MUST 显示有限且可恢复的状态，停止依赖失效目标的新操作，并允许在 Launcher/Profile 恢复后重新选择或继续 Live；MUST NOT 无限重试、静默失败或切换到禁止的截图来源。
- **FR-026**: 多 Profile 场景下，工具 MUST 保持帧、metadata、选区、preview 和保存操作的 Profile 归属一致；切换 Profile MUST 使旧帧产物退出当前可保存状态，且 MUST NOT 读取或暴露其他 Profile 的 Session 数据。
- **FR-027**: Author Tool 与其开发者连接能力 MUST 只交换本规格工作流所需的安全 Profile 身份、capture PNG、capture metadata、可用/错误状态和受控保存意图；MUST NOT 暴露 QQ 密码、Cookie、登录票据、验证码、Session 存储、任意页面读取或无关自动化控制。
- **FR-028**: 除开发者明确保存的 Template crop 外，Live/frozen 原始画面 MUST NOT 默认写入仓库、普通日志、诊断包或长期存储；错误信息 MUST 使用安全、有限且不包含认证材料的上下文。
- **FR-029**: 正式 Windows 发布包 MUST 排除 Author Tool 的代码、资源、启动入口以及仅为其存在的 Launcher 开发者连接入口；发布版运行时 MUST 无法发现或启用该工具。
- **FR-030**: 本 Feature MUST 保持 Node.js 16.20.2、npm 8.19.4、Electron 11.5.0、PPAPI Flash、现有 Vision API 与各 Profile Session/Partition 隔离基线，不得以升级核心运行时或扩展公开脚本能力作为前提。
- **FR-031**: 与 MFAToolsPlus 的关系 MUST 仅限对 Live View、Freeze、ROI/Target 分离等交互思想的独立参考；Author Tool MUST NOT 复制其 GPL 源码、素材或其他受保护表达。

### Key Entities

- **Authoring Profile**: 当前运行 Launcher 中被开发者选择的 Profile 安全身份及其 capture 可用状态；不包含 Session、Cookie 或认证材料。
- **Capture Frame**: 一次正式 Profile capture 返回的原始 PNG、`imageSize`、`contentSize`、捕获时间、Profile 身份与稳定帧身份的不可拆分集合。
- **Frozen Frame**: 被明确 Freeze 且不再随 Live 刷新变化的 Capture Frame，是 Template、ROI、preview 和保存的唯一像素来源。
- **Template Selection**: frozen frame 截图像素空间中的非零整数矩形，定义最终模板 PNG 的原始像素范围。
- **Search ROI**: 与 Template Selection 独立的 frozen frame 截图像素矩形，用于限制运行时 Vision 搜索范围。
- **Target Script**: 由 Author Tool 从仓库现有可信 `automation-scripts` 中枚举并由开发者选择的脚本身份及其 registry record；record 的真实 `packageRoot` 是受限模板资产目录与保存路径的唯一权威，manifest `scriptId` 不要求等于包目录名，且不接受手工身份或路径。
- **Template Asset**: 由目标脚本、合法 `templateId` 和 frozen frame Template Selection 唯一确定的 PNG 文件。
- **Generated Example**: 使用当前 `templateId` 与可选 ROI 表达现有 `context.vision.find()` 或 `waitFor()` 调用的可复制文本。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 在 10 秒 Live 验收中，相邻计划刷新 tick 的间隔均为 900–1100 毫秒；当每次 capture 都在下一 tick 前完成时，每个 tick 均启动一轮 capture。当 capture 人为延迟跨越一个或多个 tick 时，最大并发 capture 数始终为 1，每个忙碌 tick 的新启动数为 0，完成后补跑数为 0，capture 完成后的下一次启动只发生在后续计划 tick。
- **SC-002**: 对手动 Freeze 与开始 Template/ROI 框选触发的自动 Freeze 各重复 20 次，冻结后 30 秒内显示帧、原始 PNG 摘要、metadata 和帧身份保持一致率为 100%，冻结期间新增周期 capture 数为 0。
- **SC-003**: 在已知尺寸图片的四角、边缘、中部、反向拖选和缩放显示测试集中，Template 与 ROI 显示坐标和尺寸与预期 screenshot pixel 矩形完全一致率为 100%，越界或零面积矩形被接受次数为 0。
- **SC-004**: 对所有成功保存的模板，保存文件像素与同一 frozen frame Template 矩形原始像素逐像素一致率为 100%；保存动作触发的新 capture 数、resize 数和重采样数均为 0。
- **SC-005**: 对 PNG 尺寸不一致、非法 `imageSize`、非法 `contentSize`、Profile 身份错配和当前 authoring 合同不满足的测试帧，模板保存阻止率为 100%，静默修正或自动转为 `1920×1080` 的次数为 0。
- **SC-006**: 在包含两个同时运行 Profile、延迟返回和快速切换的 50 次测试中，帧、metadata、选区、preview 或保存产物跨 Profile 混用次数为 0。
- **SC-007**: 对仓库中所有符合现有可信脚本资格的 `automation-scripts`，Target Script 枚举的遗漏数和额外项数均为 0；对从枚举结果选择的脚本、有效 `templateId` 和可选 ROI，模板实际仓库相对路径与该脚本 registry `packageRoot`、复制 ROI、`find()` 示例和 `waitFor()` 示例与选择值一致率均为 100%；对手工 `scriptId`、任意脚本目录、任意输出路径、非法标识符、越界目标与未确认覆盖，写入发生次数为 0。
- **SC-008**: 由熟悉现有自动化脚本但未参与实现的项目开发者，在已有运行 Profile 的前提下，可在 2 分钟内完成“选择 Profile → Freeze → 框选 Template/ROI → 保存 → 复制示例”的首个有效产物流程，且无需使用任何外部截图或图片编辑工具。
- **SC-009**: Launcher 未运行、连接中断、Profile 关闭、capture 失败、剪贴板失败和模板写入失败的验收中，工具崩溃数为 0，禁止截图来源回退次数为 0，每种失败均提供至少一个明确恢复动作。
- **SC-010**: 对正式 Windows 发布产物的内容与入口检查中，Author Tool 代码、资源、启动入口和仅为其提供的开发者连接入口发现数均为 0；现有 Launcher、Flash、Profile 隔离和 Vision 自动化回归退化数为 0。

## Assumptions

- Author Tool 的唯一用户是能够访问和修改本仓库的项目开发者；V1 不设计额外的普通用户权限或第三方接入模型。
- Author Tool 按项目现有可信脚本资格枚举 `automation-scripts`，开发者只能从该结果选择 Target Script；V1 不接受手工 `scriptId` 或路径，也不负责创建脚本包、编辑 manifest 或维护第三方脚本。
- 普通 `npm start` 实例不包含 Vision Author 连接面；V1 要求开发者先关闭占用 single-instance lock 的普通实例，再通过 developer entry 启动同一个正式 Launcher 主进程和外部 Author Tool，不支持对已运行普通实例事后注入。
- 当前 Launcher 正式 capture 返回原始 PNG、`imageSize`、`contentSize` 与捕获时间，且运行时 Vision 以 `imageSize` 的 screenshot pixel 解释 ROI 和匹配矩形；本 Feature 复用并验证该既有语义，不在 Specify 阶段重定义其内部换算。
- 正式 Vision authoring 尺寸与坐标合同以当前受支持运行环境和现有 Vision 合同为事实来源；Plan 必须从真实源码与测试列出可接受的 metadata 关系和拒绝条件，但不得通过静默缩放扩大合同。
- V1 Live 按固定的约 1000 毫秒 tick 尝试启动 capture，不提供刷新间隔配置；忙碌 tick 直接跳过且不影响后续固定节奏。V1 优先保证不重叠、帧归属和可恢复性，不承诺实时视频帧率。
- 恢复 Live 或切换 Profile 后，旧 Template/ROI 参数可保留供人工参考或复制，但默认不继续持有可保存资格；开发者需要在当前有效 frozen frame 上重新确认或框选后才能保存。
- 同名模板默认要求显式替换确认；V1 不提供自动版本号、历史版本管理或撤销仓库文件变更能力。
- Template crop 是唯一允许持久化的游戏画面内容；Live 与 frozen 完整帧默认只在当前 authoring 会话所需时限内保留。
- `find()` / `waitFor()` 示例以现有 `context.vision` 合同为目标；未由 Template/ROI authoring 确定的 threshold、timeout 和 polling 参数可以采用现有 API 默认值或清晰的可编辑占位，不在本 Feature 中改变运行时默认值。
- V1 的完整人工验收平台为当前项目支持的 Windows x64 开发环境；核心运行时、Electron、Flash 和 Session 隔离边界保持不变。
