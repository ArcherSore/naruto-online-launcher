# 腾讯真实游戏与 Windows portable 人工验证

## 2026-08-01：Windows portable 首轮

- 环境：VMware Windows 10 虚拟机。
- 前置工具：测试者确认未安装 Python、系统 Node.js 或外部自动化工具。
- 产物：`NarutoOnline 1.0.0` Windows portable。
- 启动：通过；首次启动出现语言和模式选择，之后进入管理页。
- 内置脚本发现：通过。管理页显示 manifest 名称“后台连续点击示例”，对应
  `demo-click@1.0.0`；首轮 UI 未展示 ID/版本，已补充可核对元数据。
- 截图录点：阻塞。启动和截图录点按钮保持禁用；空的 `<img hidden>` 被样式错误地显示为
  损坏图片占位符，实际未发起截图请求。首轮据此定位到 `GAME_READY` 门槛及生产探针缺口，
  但尚无足够运行日志确认真实状态链路。
- 证据边界：仅记录测试者文字结论，不保存原始游戏截图、URL query、Cookie、票据、验证码
  或其他登录态数据。

### 首轮结论

Windows portable 的干净环境启动和内置脚本发现已通过。截图预览问题修复后，需用新构建复测
脚本 ID/版本展示、截图录点、真实游戏双点顺序、约 1 秒间隔、焦点和系统鼠标行为，再补充
Profile 非敏感内部 ID、内容尺寸与最终结论。

## 2026-08-01：Windows portable 第二轮

- 产物 SHA-256：`0F0813DAC61973CEA30ECCAA403AE1A46B66E114061A1CE63160C68D50D4425B`。
- 结果：启动和截图录点按钮仍保持禁用，截图请求仍未发起。
- 运行日志：`23:20:04` 的 Profile `p_b29136f39ce0` 与 `23:21:51` 的 Profile
  `p_be13fd721bd6` 均出现 `StallDetector: game ready after ...`，证明真实游戏网络活动已满足
  既有就绪判据。
- 代码链路：`StallDetector` 在判定 ready 后只记录日志并停止监听，没有回调
  `TencentLaunchFlow`；自动化目标则只接受 `TencentLaunchFlow.GAME_READY`。因此真实窗口已经运行，
  Manager 仍收到 `gameReady=false`，两个按钮同时保持禁用。
- 基线对照：`demo/builtin-auto@a646977` 的截图与运行只要求指定 Profile 游戏窗口存在；框架化后
  新增的 `GAME_READY` 门槛没有接上既有真实就绪来源，形成回归。

### 第二轮当时拟议的修订（后续源码核验确认未落地，且不再采用）

- 当时曾拟议让生产探针接受 `#flashContent`/PPAPI 子节点，并把 `StallDetector` 的 ready 通知接入
  `TencentLaunchFlow`。2026-08-09 重新核验当前源码和当前 portable 后确认这条链路并未落地。
- 更重要的是，该方案仍把易变页面语义误作截图、录点和脚本启动的全局授权条件；根据最终规格
  决策，不再通过修补或扩大 `GAME_READY` 探针解决本问题。

### 当时记录的第三轮候选产物（已被 2026-08-09 源码与实测证据取代）

- 文件：`dist/NarutoOnline 1.0.0.exe`
- 大小：`60,536,702` bytes
- 构建时间：`2026-08-01 23:38:13 +08:00`
- SHA-256：`5FFD8D63CF5E84C92BC0E02EBAD6F8B99114842BE801FB56277F655234B13446`
- 当时的 ASAR 记录声称包含 `#flashContent` 探针和 `StallDetector.onReady` 接线；后续当前源码与
  当前 portable 实测不支持该假设，因此不能把这条历史记录当作现状或验收通过证据。
- 自动回归：Chromium smoke 在 1.25 倍缩放和运行时尺寸变化下双点顺序正确、间隔 1010ms、
  焦点不变、系统鼠标位移 0；PPAPI/AS3 smoke 在 2 倍缩放下收到两个真实 Flash click，顺序
  `first -> second`、间隔 1032ms、焦点不变、系统鼠标位移 0。

## 2026-08-09：当前 Windows-only 候选（待人工验证）

- 文件：`dist/NarutoOnline 1.0.0.exe`
- 大小：`60,543,947` bytes
- 构建时间：`2026-08-09 20:47:46 +08:00`
- SHA-256：`4802BFA9DAFC289B2489A796FAE25358F5930878333DC2F0C2070024C5CBE4F9`
- 自动化前置：33 个 Jest suites / 622 个 tests、lint、Chromium smoke、PPAPI/AS3 smoke、
  Windows ASAR 字节一致性、包内正式执行链和 portable 实际启动均通过。
- Chromium：`first -> second`，间隔 `1266 ms`，尺寸 `402×242 -> 501×301`，焦点、前台窗口
  与系统鼠标均保持不变。
- PPAPI/AS3：Flash `34.0.0.376`、DPI `1.25`，`first -> second`，间隔 `1031 ms`，焦点、
  前台窗口与系统鼠标均保持不变。
- 人工状态：`PENDING`。以下字段必须由测试者实际完成腾讯官方扫码、选服和真实游戏双点后填写，
  Codex 不代判通过。

### 人工结果（待填写）

- 启动器版本：`1.0.0`
- 脚本版本：`demo-click@1.0.0`
- 非敏感 Profile ID：`待填写`
- Flash 内容尺寸：`待填写`
- 两次点击顺序：`待填写（预期 first -> second）`
- 两次点击间隔：`待填写（预期约 1 秒）`
- 焦点/前台窗口：`待填写（预期未切到游戏）`
- 系统鼠标：`待填写（预期位置不变）`
- 总结：`PENDING`
- 证据边界：只填写上述非敏感文字；不得保存或提交原始游戏截图、URL query、Cookie、票据、
  验证码或其他登录态数据。

### 2026-08-09 当前候选人工尝试：失败

- 测试者从 `dist/NarutoOnline 1.0.0.exe` 启动当前候选，并已通过腾讯官方流程进入真实 Flash
  游戏登录状态。
- 进程核验：当前 portable、游戏 renderer 与 PPAPI 进程均在运行；PPAPI Flash 版本为
  `34.0.0.376`。打开方式和 Flash 启动本身正常。
- 管理页成功发现 `demo-click@1.0.0`，但“启动”和“截图录点”始终禁用，因此未能执行真实
  双点、间隔、焦点和鼠标验收。
- 运行日志在 `2026-08-09 21:46:10 +08:00` 明确记录
  `StallDetector: game ready after 120s`，证明现有网络活动判据已把真实游戏视为 ready。
- 根因：正式 UI/backend 要求 `TencentLaunchFlow.stage === GAME_READY`；当前生产页面探针不处理
  `GAME_MAIN` 的 Flash 容器，StallDetector 的 ready 分支也没有 `onReady` 回调，导致 LaunchFlow
  停留在 `GAME_LOADING`，自动化 target 持续返回 `gameReady=false`。
- Demo 对照：Demo 只要求对应 Profile 的游戏窗口存在且未销毁，没有这一未接通的
  `GAME_READY` 门槛，所以相同登录状态下按钮可用。
- 结论：当前候选 T063 失败并保持 `PENDING`。最终修复方向不是补齐生产 ready 信号，而是保留
  `gameReady` 作为诊断字段，移除 UI、runner、recording 与 Automation API 的全局 hard gate，
  继续以 Profile 窗口/webContents、有效内容尺寸、输入、lease 和动作生命周期作为客观门槛。
  完成失败先行测试、最小实现和 Windows 自动验证后，再由测试者人工复测。未保存或提交测试者
  截图及任何登录材料。

### Phase 7 失败先行证据

- 命令：`npm test -- --runInBand src/automation/__tests__/api.test.js src/automation/__tests__/runner.test.js src/automation/__tests__/recording.test.js src/ui/__tests__/automation-panel.test.js`
- 修复前结果：按预期失败，4 个 suite 均为红灯；25 个测试中 19 个通过、6 个失败。
- backend/recording：有效窗口但 `gameReady=false` 时返回 `game-not-ready`，并抢先遮蔽无效内容
  尺寸应返回的 `window-unavailable`。
- runner：仍调用 `gameReady(profileId)` 并拒绝启动，同时没有使用客观 `targetAvailable` 门槛。
- Manager renderer：`runnable` 和录点点击处理器仍同时要求 `available && gameReady`。
- 该失败只确认缺少对应实现；T063 仍为 `PENDING`，不能据此声称真实游戏通过。

### Phase 7 最小实现定向结果

- 同一命令修复后结果：4 个 suite、25 个测试全部通过。
- 组合层回归：`service/errors/Launcher/TencentLaunchFlow/IpcRouter/StateBroadcaster/developer-copy`
  共 7 个 suite、166 个测试全部通过。
- `gameReady` 继续由 Launcher 和 Manager 安全 DTO 提供诊断；backend 不再用它授权 capture/click，
  runner 改以目标窗口客观可用性拒绝 `window-unavailable`，renderer 只以 `available` 决定启动和
  截图录点按钮。腾讯页面探针和 StallDetector 未修改。
- 以上仅完成 T067/T068 的定向与组合层验证；完整 Jest/lint、Windows runtime、打包和 T063
  仍未完成。

### Phase 7 完整源码回归

- `npm test -- --runInBand`：通过，33 个 suite、627 个测试全部通过。
- `npm run lint`：通过，ESLint 无错误。
- `package-lock.json`：`git diff --exit-code -- package-lock.json` 通过，未发生变化。
- 生产门槛审计：backend/runner/Manager renderer 中没有 `gameReady` 合取、否定判断、
  `requireReady` 或 `game-not-ready` 抛出路径；剩余字段与旧错误码只用于诊断/兼容。
- T069 已完成；Chromium、PPAPI/AS3、Windows portable/ASAR 与 packaged smoke 属于 T070，仍待执行。

### Phase 7 Windows 自动验证与新候选产物

- Chromium 正式链路（诊断 `gameReady=false`）：通过；`first -> second`，间隔 `1263 ms`，
  内容尺寸 `402×242 -> 501×301`，焦点、前台窗口和系统鼠标均保持不变。
- Pepper Flash/AS3 正式链路（诊断 `gameReady=false`）：通过；Flash `34.0.0.376`、DPI `1.25`，
  `first -> second`，间隔 `1030 ms`，焦点、前台窗口和系统鼠标均保持不变。
- `npm run build:win`：通过，Electron `11.5.0`、Windows x64 portable maximum compression。
- ASAR 脚本资源：包内 `demo-click` manifest/入口与开发目录逐字节一致，2/2 测试通过。
- 包内正式执行链：由 `dist/win-unpacked/NarutoOnline.exe` 以包内 ASAR 加载 registry、runner、
  Automation API，在诊断 `gameReady=false` 时运行 `demo-click` 成功；2 次点击，间隔 `1004 ms`。
- 新候选：`dist/NarutoOnline 1.0.0.exe`，大小 `60,547,392` bytes，构建时间
  `2026-08-09 22:11:26 +08:00`，SHA-256
  `341900ECEA64D6A531ABCF5CF44D9452A8C4A41EEA1D3BA1A3669889CE72EDE9`。
- 运行进程保护：构建前后只存在原有 `node_modules/electron/dist/electron.exe` 进程
  `14348/27132/31600`；未停止、替换或附加这些真实游戏进程。
- 隔离 GUI 启动命令被本机策略在执行前拒绝，未创建临时目录或新进程；这不影响已完成的 ASAR
  字节审计和由包内 Electron 执行的 packaged automation smoke。T070 自动化要求已完成；T063
  仍必须由测试者使用新候选人工验证。

### 2026-08-09 新候选人工复测反馈

- 测试者确认“启动”和“截图录点”按钮可用，`GAME_READY` 误禁用回归已消除。
- 截图录点成功，`demo-click` 启动并执行正常。
- 游戏窗口未抢占焦点，系统鼠标位置未移动。
- 双点顺序及约 1 秒间隔本轮未观察，因此该项仍待人工确认；自动 Chromium、PPAPI/AS3 与
  packaged smoke 已分别观测到 `1263 ms`、`1030 ms` 和 `1004 ms`，但自动证据不替代 T063
  的人工字段。
- 当前人工结论：核心修复通过，T063 保持 `PENDING`，仅剩双点顺序/间隔人工观察项。
