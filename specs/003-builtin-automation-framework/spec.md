# Feature Specification: 内置自动化脚本框架

**Feature Branch**: `feature/framework`

**Created**: 2026-07-30

**Status**: Approved

**Input**: User description: "将已验证的后台点击 Demo 工程化为适合个人维护、随启动器发布的轻量内置自动化脚本框架。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 对指定 Profile 运行内置脚本 (Priority: P1)

作为启动器用户，我希望为一个正在运行的 Profile 选择并启动可信内置脚本，使它能读取该 Profile 的配置和已记录坐标，在不抢占前台窗口或系统鼠标的情况下完成连续后台点击。

**Why this priority**: 这是把已验证 Demo 转化为可用产品能力的最小闭环。

**Independent Test**: 在开发环境和安装包中分别启动同一内置示例脚本，使用指定 Profile 的两个已记录坐标完成顺序点击，并验证游戏窗口未获取焦点、系统鼠标位置未变化。

**Acceptance Scenarios**:

1. **Given** 一个已打开且内容尺寸有效的游戏窗口、有效坐标配置和已注册的示例脚本，且腾讯流程诊断状态仍可能不是 `GAME_READY`，**When** 用户为该 Profile 启动脚本，**Then** 启动与录点能力保持可用，脚本按记录顺序完成后台点击并以 `succeeded` 结束。
2. **Given** 游戏窗口未聚焦或被其他窗口遮挡，**When** 脚本执行点击，**Then** 游戏收到真实点击，前台窗口和系统鼠标位置均不改变。
3. **Given** 启动器从安装包运行，**When** 用户查看某个 Profile 的可用脚本，**Then** 随包发布的有效内置脚本与开发环境中的发现结果一致，且不要求安装外部运行时或自动化工具。

---

### User Story 2 - 控制运行并获得明确结果 (Priority: P2)

作为启动器用户，我希望查看脚本状态并能停止正在运行的脚本；发生超时、窗口关闭或自动化异常时，我能看到明确、可区分的结果，而不会让启动器或其他 Profile 失去控制。

**Why this priority**: 后台自动化必须可停止、可诊断，才能适合长期开启和个人维护。

**Independent Test**: 分别触发正常完成、用户停止、超时、窗口关闭、Profile 不存在和后台点击异常，验证状态转换、取消行为、失败原因及其他 Profile 不受影响。

**Acceptance Scenarios**:

1. **Given** 一个正在运行的脚本，**When** 用户停止它，**Then** 状态先变为 `stopping`，取消信号被触发，未执行的动作不再开始，最终状态为 `cancelled`。
2. **Given** 一个脚本超过本次运行的有限超时时限，**When** 超时发生，**Then** 运行被取消并以 `failed` 结束，原因明确标识为超时。
3. **Given** 运行期间游戏窗口关闭或后台点击能力异常，**When** 下一动作执行，**Then** 当前运行以 `failed` 结束并记录可操作的失败原因，启动器继续可用。
4. **Given** 同一 Profile 已有脚本或独立自动化命令在执行，**When** 又收到新的执行请求，**Then** 新请求不会与现有动作并发交错，并得到明确的忙碌结果。
5. **Given** 两个不同 Profile 均已打开，**When** 分别启动脚本，**Then** 两个运行可以独立并行，停止或失败其中一个不影响另一个。

---

### User Story 3 - 独立维护并随启动器发布脚本 (Priority: P3)

作为项目维护者，我希望每个脚本能够在独立目录中开发、测试和版本化，并在启动器启动时自动校验和注册，使新增内置脚本不需要复制窗口查找、坐标映射或后台点击细节。

**Why this priority**: 清晰、稳定的脚本合同是后续低成本维护和扩展的基础。

**Independent Test**: 分别放入一个有效脚本以及 manifest 非法、入口缺失、ID 重复、接口版本不兼容的脚本包，验证有效脚本可用、无效脚本被拒绝且错误互相独立。

**Acceptance Scenarios**:

1. **Given** 一个符合第一版合同的内置脚本目录，**When** 启动器启动，**Then** 脚本通过校验并注册，用户可以为可用 Profile 查看和运行它。
2. **Given** manifest 非法、入口缺失或接口版本不兼容，**When** 启动器扫描脚本，**Then** 仅拒绝有问题的脚本并记录明确原因，其他有效脚本仍可用。
3. **Given** 两个脚本声明相同 ID，**When** 启动器扫描脚本，**Then** 所有冲突项均不注册，不以扫描顺序选择其中一个。
4. **Given** 一个脚本使用自己的配置和静态资源，**When** 启动器升级或另一脚本运行，**Then** 该脚本的用户配置不被安装资源或其他脚本覆盖。

### Edge Cases

- 启动器扫描时，内置脚本根目录不存在或不可读：启动器继续运行，返回空 catalog，并产生稳定的
  `scripts-root-unavailable` 注册诊断。
- 内置脚本根目录为空：启动器继续运行并返回空 catalog，不把空目录本身视为单包校验失败。
- manifest 不是合法 JSON，必填字段缺失、类型错误、值为空，或入口指向脚本目录之外。
- 同一 ID 在大小写或规范化后发生冲突。
- 脚本入口加载失败、未导出异步运行函数，或运行函数同步抛错、异步拒绝。
- 用户在 `idle` 或终态下重复停止，或在 `stopping` 时再次停止。
- Profile 在启动请求前已删除，或游戏窗口在截图、取状态、等待、点击期间关闭。
- 已记录坐标缺失、损坏、越界，或截图后窗口内容尺寸、DPI、全屏状态发生变化。
- 后台输入通道已被调试工具占用、意外断开、附加失败或派发失败。
- 取消和正常完成、超时或异常几乎同时发生。
- 日志写入失败或脚本生成超大、循环引用的日志字段。
- 一个 Profile 忙碌时持续收到重复启动或自动化命令；另一个 Profile 同时正常执行。
- 安装包中的脚本资源存在但未被扫描，或开发环境可发现而安装包遗漏。

## Requirements *(mandatory)*

### Scope

**In scope**:

- 可信内置脚本的发现、校验、注册、查看、启动、停止、状态与结构化日志。
- Profile 级配置、坐标记录、互斥运行、取消、超时和失败处理。
- 截图、窗口状态、归一化坐标后台点击和等待能力。
- 将现有 `demo-click` 迁移为正式示例脚本和端到端回归用例。

**Out of scope**:

- JSON Pipeline DSL、可视化流程编辑器、Python、Agent 或其他脚本语言。
- 第三方脚本安装、脚本商店、在线更新、完整安全沙箱和细粒度权限系统。
- 外部 HTTP、WebSocket、Named Pipe 或其他进程间自动化 Bridge。
- 图片模板匹配、OCR、视觉等待，以及键盘、拖拽、滚轮、右键等更多输入。
- 同一 Profile 被多个脚本同时控制。
- 自动登录、验证码处理、腾讯风控绕过、SWF 解析或修改、游戏内部 AS3 函数调用。

### 第一版验收平台

- **Windows x64**：执行完整功能验收，包括内置脚本打包、发现和注册、普通 Chromium、Pepper
  Flash/AS3，以及腾讯真实游戏最小人工验收。
- 第一版只维护和验收 Windows 版本；不要求 WSL、Linux AppImage 或其他平台构建证据。

### Functional Requirements

- **FR-001**: 第一版脚本运行时 MUST 统一使用 JavaScript；入口 MUST 使用 CommonJS 合同并导出一个异步运行函数。开发阶段 MAY 使用 TypeScript，但所有发布脚本 MUST 预先编译为可直接运行的 JavaScript。
- **FR-002**: 启动器 MUST 只发现和运行由本项目维护、随启动器发布的可信内置脚本，MUST NOT 接受用户安装或指定的任意第三方脚本。
- **FR-003**: 每个内置脚本 MUST 位于独立目录，包含 `manifest.json` 和 JavaScript 入口文件，并 MAY 包含只读 `assets` 资源目录。
- **FR-004**: 第一版 manifest MUST 包含 `schemaVersion`、`id`、`name`、`version`、`entry`、`apiVersion`，MAY 包含 `description`；其他字段不得成为第一版运行所必需的条件。
- **FR-005**: 启动器启动时 MUST 扫描固定的内置脚本目录，校验 manifest 结构和值、ID 唯一性、入口存在且位于脚本目录内、入口导出合同以及 Automation API 版本兼容性。根目录不存在或不可读时，启动器 MUST 继续运行、返回空 catalog，并产生稳定的 `scripts-root-unavailable` 注册诊断；根目录为空时 MUST 继续运行并返回空 catalog。
- **FR-006**: 单个脚本校验失败 MUST NOT 阻止其他有效脚本注册或阻止启动器继续运行；ID 冲突的所有脚本 MUST 拒绝注册，并为每个拒绝项提供稳定、明确的原因。
- **FR-007**: 开发环境和 Windows x64 安装包 MUST 包含并发现相同版本的内置脚本入口、manifest 和所需静态资源。Windows x64 MUST 完成完整功能、Chromium、Pepper Flash/AS3 和腾讯真实游戏人工验收。正式发布验证中，任何预期内置脚本未进入 Windows 安装包 MUST 导致发布验收失败。
- **FR-008**: 脚本运行上下文 MUST 只提供当前 `profileId`、当前脚本配置、取消信号、结构化日志接口和受限 Automation API。
- **FR-009**: 第一版 Automation API MUST 仅覆盖：获取当前 Profile 截图、获取窗口状态、读取当前 Profile 与脚本的已记录坐标、按归一化坐标执行左键单击、等待指定时间。通用能力 MUST 仅以各自客观需要的 Profile、窗口、webContents、有效内容尺寸、输入和动作生命周期作为可用门槛；腾讯页面阶段或 `GAME_READY` 只可作为诊断信息或脚本策略，不得成为截图、录点、脚本启动或点击的全局硬门槛。
- **FR-010**: 框架 MUST 统一处理 Profile 窗口定位、窗口/webContents 可用性、DPI、截图尺寸、内容尺寸、坐标映射、后台输入生命周期和错误转换；脚本 MUST NOT 重复实现或绕过这些职责。页面是否适合某个脚本操作由脚本通过受限 Automation API 判断。
- **FR-011**: 框架 MUST NOT 向脚本暴露 `BrowserWindow`、`webContents`、`webContents.debugger`、Electron 主进程对象、Profile registry、任意后台输入方法或任何登录 Cookie、票据及登录态数据；内置脚本 MUST NOT 直接访问这些对象或数据。
- **FR-012**: 第一版的信任边界 MUST 以“仅运行项目审核并随包发布的脚本 + 受限运行上下文”为基础；本 Feature MUST NOT 声称能够安全运行恶意脚本或提供完整沙箱。
- **FR-013**: 脚本程序、manifest 和 assets MUST 作为只读安装资源；用户配置和已记录坐标 MUST 存储在安装资源之外。
- **FR-014**: 用户配置和坐标 MUST 同时按 `Profile + scriptId` 隔离；读取、写入、清除或迁移一个组合的数据 MUST NOT 改变其他 Profile 或脚本的数据。
- **FR-015**: 启动器更新或内置脚本资源替换 MUST NOT 覆盖既有用户配置和坐标；不兼容数据 MUST 返回明确错误或进入可恢复的空配置状态，MUST NOT 被静默解释为其他 Profile 或脚本的数据。
- **FR-016**: 用户 MUST 能为指定 Profile 查看已注册的可用脚本，并执行启动、停止和查看当前或最近一次运行状态。只要该 Profile 的游戏窗口客观可用，UI MUST 允许启动脚本和开始截图录点；诊断性的 `gameReady=false` MUST NOT 单独禁用这些操作。
- **FR-017**: 运行状态 MUST 至少包含 `idle`、`running`、`stopping`、`succeeded`、`failed`、`cancelled`。首次运行前为 `idle`；终态保留到下一次启动，不得因查询而丢失。
- **FR-018**: 每次运行 MUST 有唯一可追踪标识、开始时间、结束时间、`profileId`、`scriptId`、当前状态及可选失败代码和安全错误摘要。
- **FR-019**: 用户停止运行时，框架 MUST 触发取消信号、进入 `stopping`、阻止尚未开始的后续动作，并在脚本响应取消后进入 `cancelled`；重复停止 MUST 幂等且不得启动新动作。
- **FR-020**: 对会向 Electron event loop 交还控制权的正常异步脚本、Automation API 操作和 `wait()`，框架 MUST 提供统一 deadline、协作式取消和超时失败；超过时限后 MUST 触发取消并以 `failed` 结束，失败原因明确标识为超时。可信同进程 CommonJS 脚本的同步死循环或长时间同步阻塞会阻塞 event loop，第一版 MUST NOT 声称能够硬终止此类执行；该限制作为可信内置脚本的已知残余风险记录并通过审查、测试及脚本作者约束降低。
- **FR-021**: 同一 Profile 在同一时刻 MUST 最多有一个脚本运行或一条独立自动化命令执行；忙碌期间的新执行请求 MUST 明确拒绝，停止请求不受此限制。不同 Profile MUST 能独立并行。
- **FR-022**: Profile 不存在、窗口不可用或关闭、配置或坐标无效、入口加载失败、脚本异常、取消、超时及后台输入异常 MUST 产生互相可区分的结果；单次失败 MUST NOT 导致启动器崩溃或影响其他 Profile 的 Session、窗口及运行。
- **FR-023**: 结构化日志 MUST 能按运行、Profile、脚本、阶段和严重级别关联，MUST NOT 记录截图内容、QQ 密码、Cookie、票据、验证码或其他登录态数据；脚本提供的不可安全序列化字段 MUST 被拒绝或安全降级。
- **FR-024**: 截图和窗口状态 MUST 仅针对当前运行的 Profile。截图要求目标窗口/webContents 可用且内容尺寸有效，不要求特定腾讯页面阶段或 `GAME_READY`。截图不得默认进入普通日志或长期保留；为用户主动记录坐标或生成测试证据而保留时，MUST 与对应 Profile 和脚本关联，并具有明确清理方式。
- **FR-025**: 归一化坐标点击 MUST 使用执行时的有效窗口状态和内容尺寸完成映射；坐标或窗口状态无效时 MUST 拒绝点击，不得盲目派发到旧位置。
- **FR-026**: 后台点击 MUST 在不聚焦游戏窗口、不改变当前前台窗口、不调用系统全局鼠标移动的前提下触发真实 PPAPI Flash 左键单击。
- **FR-027**: 现有 `demo-click` MUST 迁移为符合第一版合同的正式示例脚本，保留读取指定 Profile 坐标、按顺序连续后台点击的已验证能力，并作为普通 Chromium、本地 Pepper Flash/AS3 和腾讯真实游戏最小回归链路的入口。
- **FR-028**: 框架化后，现有普通 Chromium 与 Pepper Flash/AS3 自动化测试以及受影响的启动器回归测试 MUST 继续通过；腾讯真实游戏 MUST 保留可重复、最小化的人工验证步骤，并明确人工证据不能替代自动测试。
- **FR-029**: 本 Feature MUST 保持现有 Node.js、npm、Electron、PPAPI 和 Profile Session/Partition 隔离基线，不得要求用户安装 Python、Node.js 或外部自动化工具，也不得采集、修改、重放或绕过腾讯认证材料、验证码及风控。

### Key Entities

- **内置脚本包**: 随启动器发布的只读程序单元，由 manifest、入口和可选静态资源组成。
- **脚本 Manifest**: 描述脚本身份、显示信息、版本、入口及兼容 API 版本的注册合同。
- **脚本注册记录**: 一次启动扫描后形成的有效脚本信息，或带明确原因的拒绝结果。
- **脚本运行**: 某个 `Profile + scriptId` 的一次执行，包含唯一标识、状态、时间、取消与超时结果。
- **运行上下文**: 仅对当前运行有效的 Profile 身份、脚本配置、取消信号、日志和受限能力集合。
- **脚本用户数据**: 按 `Profile + scriptId` 隔离并独立于安装资源保存的配置与归一化坐标。
- **Profile 自动化占用状态**: 表示该 Profile 当前是否已有脚本或自动化命令执行，用于防止动作交错。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 在开发环境和 Windows x64 安装包的发现验证中，随包发布的所有预期有效脚本均被发现并注册，版本与 manifest 一致，遗漏数为 0；任何预期脚本未进入正式 Windows 安装包时，发布验收失败。
- **SC-002**: 对 manifest 非法、入口缺失、ID 重复和 API 版本不兼容四类无效包，注册测试的拒绝率为 100%，且每类返回可区分原因；同次扫描中的有效脚本仍 100% 可用。
- **SC-003**: 示例脚本在普通页面靶场和隐藏的真实 Flash 靶场中均能按顺序完成至少两个归一化坐标点击，真实点击计数和顺序全部正确。
- **SC-004**: 所有后台点击回归中，点击前后游戏窗口均未获得焦点，当前前台窗口未改变，系统鼠标坐标变化为 0。
- **SC-005**: 针对同一 Profile 的重叠执行测试中，观测到的最大并发自动化数为 1、动作交错数为 0；两个不同 Profile 的并行用例均可同时进入 `running` 并独立达到各自终态。
- **SC-006**: 正常完成、用户停止、可协作取消的异步超时、窗口关闭、Profile 不存在和后台输入异常六类场景均在 100% 用例中进入正确终态并返回可区分原因；其中停止请求在 1 秒内可见为 `stopping`，可取消的 `wait()` 在 5 秒内进入 `cancelled`，正常异步脚本、Automation API 操作或 `wait()` 超过 deadline 后进入 `failed/run-timeout`。同步死循环或长时间同步阻塞不纳入硬终止验收，并作为可信同进程执行模型的已知残余风险保留。
- **SC-007**: 使用至少两个 Profile 和两个脚本形成的四组配置/坐标数据互不覆盖，应用重启及安装资源更新后仍保持原归属和值。
- **SC-008**: 在未安装 Python、系统 Node.js 或外部自动化工具的干净 Windows x64 测试环境中，安装包可发现并运行示例脚本。
- **SC-009**: 框架化后的现有后台点击与启动器相关自动化回归全部通过，并在 Windows x64 完成一次腾讯真实游戏最小人工回归，确认连续后台点击、焦点和系统鼠标行为未退化。

## Assumptions

- 脚本作者是项目维护者；所有第一版脚本在发布前接受与启动器代码相同的审查和测试。
- 第一版只承诺左键单击和固定等待，不从已验证点击能力推断其他输入或视觉识别能力。
- 正常异步脚本、Automation API 操作和 `wait()` 采用框架统一的有限 deadline 与协作式取消策略；
  具体默认时限和是否允许脚本配置缩短时限留到 Plan 阶段确定。同步死循环或长时间同步阻塞
  会阻塞 Electron event loop，第一版不提供硬终止保证。
- 用户配置是脚本可读取的普通设置，不包含登录 Cookie、票据、验证码或其他认证材料。
- 第一版只维护 Windows x64，并在该平台完成打包、完整功能、Chromium、Pepper Flash/AS3
  和腾讯真实游戏人工验收。
- 现有 Profile registry、窗口、Session/Partition 和 PPAPI 能力继续作为框架依赖，但其具体接入方式、进程模型和内部代码结构由 Plan 阶段决定。
- `GAME_READY` 是现有腾讯启动流程的诊断状态，不是“窗口已出现”或“脚本可运行”的可靠同义词；未来图像识别、页面等待和动作条件由脚本通过受限 Automation API 实现，不扩大本 Feature 的视觉识别范围。
