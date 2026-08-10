# Implementation Plan：外部 Vision Author Tool

**Branch**: `tools/vision-author` | **Date**: 2026-08-10 | **Spec**: [spec.md](./spec.md)

**Input**: `specs/005-vision-author-tool/spec.md` 及 2026-08-10 Clarify 结果

## Summary

在 `tools/vision-author/` 中实现一个只供仓库开发者使用的外置 Electron Author Tool。开发启动脚本通过
锁定 Electron 运行仓库根极薄 `vision-author-launcher.js` shim；shim 在正常 Electron main 阶段安装
同目录 developer bootstrap，再加载正式 `src/main.js`。bootstrap 在同一个 Launcher 主进程中组合
`Launcher.getAutomationTarget(profileId)` 与 `createAutomationBackend()`，再通过随机命名、会话令牌
保护的 Windows Named Pipe 连接一个独立 Author Tool 进程。正式 `src/main.js` 不引用工具或 bridge，
根 `package.json` 不增加发布可见入口，现有 electron-builder allowlist 继续完全排除 `tools/**`。

Author Tool renderer 使用固定 `1000ms` 的 `setInterval` tick 和单一 `capturePending` 门闩：空闲 tick
发起 capture，忙碌 tick 直接跳过，不排队、不补跑。每个 capture 只调用正式 backend；bridge 为返回帧
生成 opaque `frameId` 并在 Launcher 主进程内短时保存原始 PNG 与 metadata。Freeze 以当前已显示且已确认的
`frameId` pin 精确帧，Template、ROI、preview 与保存都引用该 frozen frame；恢复 Live 会释放保存资格，
旧坐标只作为 UI 参考保留。

Target Script 只来自同一 bridge 使用正式 registry 规则得到的启动时可信 catalog。保存请求不接受目录或
输出路径，只接受 catalog 中的 `scriptId`、合法 `templateId` 和绑定 frozen frame 的 `previewId`；bridge
从 registry record 的真实 `packageRoot` 解析目标，以同一原始 PNG 的无缩放 crop 生成 preview/save bytes，
经显式覆盖确认后使用同目录临时文件与 rename 原子写入。

## Technical Context

**Language/Version**: JavaScript/CommonJS；Volta 固定 Node.js `16.20.2`、npm `8.19.4`；Launcher 与
Author Tool 均运行在 Electron `11.5.0`，实现只使用其内置旧 Node 可用 API。

**Primary Dependencies**: 现有 Electron `BrowserWindow`、`nativeImage`、`webContents.capturePage()`、
`contextBridge`/`ipcRenderer`；Node 内置 `net`、`crypto`、`fs`、`path`、`child_process`；现有
`Launcher.getAutomationTarget`、automation backend/registry/Vision codec/template-id/rect helpers。
不新增第三方依赖，不修改 `package-lock.json`。

**Storage**: 完整 Live/frozen PNG、decoded bitmap、preview 与 replacement grant 仅存在于当前 Launcher
developer bridge 会话内存；唯一允许持久化的游戏画面是
`automation-scripts/<registered-package>/assets/vision/<templateId>.png`。连接令牌只通过子进程环境传递，
不写 descriptor 文件、仓库、日志或 userData。

**Testing**: Jest `29.7.0` 单元、协议、状态机、路径与模块集成测试；现有 automation/backend/registry/
Vision 回归；fake timers 验证固定 tick；Windows Electron 双进程人工验收；Windows unpacked/portable
内容检查与真实 Profile/多 Profile 人工验收。

**Target Platform**: V1 Author Tool 仅支持 Windows x64 仓库开发环境；正式模板 authoring 合同为
`imageSize=1920×1080`、`contentSize=1920×1080`、PNG 解码尺寸与 `imageSize` 一致。Launcher 正式发布
平台与 Electron/PPAPI 基线不变。

**Project Type**: 现有单体 Electron Launcher 加一个仓库外置开发工具；Launcher bridge 与 Author UI
均只在 developer bootstrap 会话存在，不形成产品功能或第三方服务。

**Performance Goals**: Live 固定每 `1000ms` 产生计划 tick；正常验收中相邻 tick 为 `900–1100ms`。
任一时刻最多一个 Author capture 未完成；忙碌 tick 新启动数、排队数、补跑数均为 0。有效 capture 完成后
下一轮只在后续计划 tick 启动。工具不承诺实时视频帧率。

**Constraints**: 只复用正式 Profile capture，不得调用桌面/HWND/BitBlt/外部图片/resize 回退；
Freeze 不取消无法强制中止的既有 `capturePage()`，但必须立即停止后续 tick 并丢弃迟到结果；bridge 不暴露
Session、Cookie、URL、webContents、CDP、click、runner 或任意文件能力；普通 `npm start` 不存在连接面；
普通 Launcher 已运行时必须关闭后以 developer bootstrap 重启，V1 不做事后注入。

**Scale/Scope**: 单开发者、单 Author Tool 客户端、单连接会话、一个当前 Profile、一个 pinned frozen frame、
独立 Template/ROI、一个 preview artifact、现有可信脚本 catalog；不建立多客户端服务、网络 API、插件协议、
热更新脚本 registry 或通用开发者平台。

## Constitution Check（Phase 0 前）

*Gate result: PASS。Spec 无 `[NEEDS CLARIFICATION]`；三个 Clarify 选择已写入 FR-006、FR-018、
SC-001 与 SC-007。*

| Principle | Result | Evidence |
| --- | --- | --- |
| I. 规格驱动 | PASS | 设计直接追溯 4 个 User Stories、FR-001～031、SC-001～010；协议与进程选择只服务已定义开发工作流。 |
| II. 腾讯国服唯一产品方向 | PASS | 只连接当前腾讯国服 Launcher 的 Profile 游戏窗口，不恢复任何 Oasis/巴西服路径。 |
| III. 官方认证与受控诊断边界 | PASS | bridge DTO 只含 Profile `id/name`、capture metadata 和 PNG；不读 URL、DOM、Cookie、Storage、票据、验证码或 QQ 密码。 |
| IV. 模块化而非过度抽象 | PASS | bridge 组合正式 backend/registry；页面阶段与 `GAME_READY` 不作为 capture 门槛；没有公开 SDK、插件或通用协议层。 |
| V. 旧版运行时兼容 | PASS | 只使用 Electron 11/Node 内置 API和 CommonJS；不升级 Node/npm/Electron/PPAPI，不增加依赖。 |
| VI. Session 隔离 | PASS | capture 仅按显式 `profileId` 解析 Launcher registry target；不暴露或访问 Session/Partition；迟到帧按 Profile+epoch 丢弃。 |
| VII. 测试与验收先行 | PASS | 计划覆盖 tick 竞态、frozen-frame 身份、crop 像素、registry/path、双 Profile、断连恢复和实际发行包检查。 |
| VIII. 简单性与必要性 | PASS | 一个随机 Named Pipe、一个窄 bridge、一个外部窗口；不用 HTTP、数据库、前端框架、Worker 或新 package。 |
| IX. 可诊断性 | PASS | 只返回稳定安全错误、合同失败项和恢复动作；PNG/token/path/raw fs error 不进普通日志。 |
| X. 治理与语言规范 | PASS | 计划与设计产物使用中文，技术标识/命令保持原文，现有源码和测试证据优先。 |

## Project Structure

### Documentation（本 Feature）

```text
specs/005-vision-author-tool/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── vision-author-bridge-contract.md
│   └── vision-authoring-contract.md
└── tasks.md                         # 后续 $speckit-tasks 生成；本阶段不创建
```

### Source Code（计划涉及的主要路径）

```text
vision-author-launcher.js             # 根目录极薄 developer shim；build allowlist 之外
tools/vision-author/                  # electron-builder files allowlist 之外
├── start.ps1                         # developer-only ASCII PowerShell 启动入口
├── launcher-entry.js                 # 归一应用身份、安装 bootstrap、加载正式 main
├── launcher-bootstrap.js             # 同一 Launcher 进程中的 bridge/Author 子进程生命周期
├── bridge/
│   ├── protocol.js                   # 4-byte length prefix、auth、request/response DTO
│   ├── server.js                     # 单客户端随机 Windows Named Pipe
│   ├── session.js                    # capture pending、frame cache、freeze/pin/release
│   ├── catalog.js                    # 正式 registry 的安全 catalog 与保存时重校验
│   ├── frame.js                      # authoring contract、crop/preview identity
│   └── template-writer.js            # registry-rooted、确认绑定、原子 save
├── app/
│   ├── main.js                       # 独立 Electron 进程；pipe client 与开发窗口
│   ├── preload.js                    # 最小 contextBridge
│   ├── index.html
│   ├── app.js                        # Live/Freeze 状态、选择、copy/code generation
│   └── styles.css
└── __tests__/
    ├── protocol.test.js
    ├── live-controller.test.js
    ├── session.test.js
    ├── frame.test.js
    ├── catalog.test.js
    ├── template-writer.test.js
    └── release-boundary.test.js

src/
└── automation/
    ├── backend.js                    # 加固 capture 前后 target/contentSize 同一性
    └── __tests__/
        └── vision-coordinate-chain.test.js # 正式 capture target replacement race 回归

tests/
└── runtime/
    └── packaged-automation-smoke.js  # 保持模板随可信脚本发布的正向回归
```

**Structure Decision**：除根目录极薄 `vision-author-launcher.js` shim 外，工具、专用 bridge、入口逻辑、UI 与
专属测试全部位于 `tools/vision-author/**`。
正式 `src/main.js` 保持零引用，根 `package.json` 不增加 author script 或 `tools/**` build glob。唯一计划修改的
产品源码是正式 capture race hardening，职责仍属于 automation backend，且由现有 runtime Vision 与 Author
Tool 同时受益，不构成开发连接入口。

## Architecture

```text
tools/vision-author/start.ps1
  → electron <repo>/vision-author-launcher.js
    → tools/vision-author/launcher-entry.js
    → 归一 app name/userData → 安装 developer bootstrap → 加载正式 src/main.js
    → 正式 src/main.js / app.getAppPath() / Profile Store / Launcher.gameWindows
    → developer bootstrap（仅 unpackaged 当前进程）
      → createRegistry({ app }).scan()
      → createAutomationBackend({ targetProvider: Launcher.getAutomationTarget })
      → random Windows Named Pipe + 256-bit token
      → spawn external tools/vision-author/app/main.js
        → authenticated single pipe client
        → isolated local BrowserWindow + preload/contextBridge
        → renderer Live/Freeze/selection UI

capture request
  → bridge session single-flight guard
  → formal backend.capture(profileId)
  → Launcher.getAutomationTarget(profileId)
  → selected Profile webContents.capturePage()
  → { original PNG, imageSize, contentSize, capturedAt }
  → authoring contract validation + safe Profile identity + opaque frameId
  → in-memory candidate frame

freeze(displayedFrameId)
  → pin exact Launcher-side frame
  → Template rect / ROI rect both reference pinned frameId
  → preview(frameId, rect) → previewId + exact crop PNG
  → save(previewId, catalog scriptId, templateId, optional replacementGrant)
  → registry.get(scriptId).packageRoot
  → assets/vision/<templateId>.png atomic rename
```

bridge 只暴露 Author Tool 所需的安全 DTO 和操作，不把 backend、registry record、BrowserWindow、
webContents、Session 或 filesystem handle 交给外部进程。Author Tool 关闭时 bridge 释放所有完整帧、token、
preview 与确认 grant；Launcher 可继续运行，但不会为另一客户端保留或重新开放端点。

## Design and Implementation Approach

### 1. Developer-only 启动与发布隔离

1. `start.ps1` 从仓库根解析本地 Electron 11 binary，以根 `vision-author-launcher.js` 为显式应用入口；
   `launcher-entry.js` 在正常 Electron main 阶段取得 `electron.app`，归一应用名/userData，安装 bootstrap 后
   加载正式 `src/main.js`。不改 `src/main.js`，也不以 `electron tools/...` 改变 `app.getAppPath()`。
2. bootstrap 必须在任何能力初始化前 fail closed：只允许 `process.type === 'browser'`、
   `process.defaultApp === true`、`app.isPackaged === false`、`app.getAppPath()` 为当前仓库根且
   `tools/vision-author` 位于其下。
3. bootstrap 等待正式 `ready` handler 完成当前同步初始化后启动 bridge；若 single-instance lock 因普通
   Launcher 已运行而退出，则不创建 pipe、不启动 Author Tool，并由启动脚本给出“关闭现有 Launcher，
   再使用 Vision Author 开发入口重启”的恢复提示。V1 不向普通实例注入连接代码。
4. bootstrap 生成随机 pipe 名与 32-byte token，只通过清理过开发注入变量的 Author 子进程环境传递；
   token、pipe、PNG 和绝对保存路径不写日志。Author 子进程退出或 Launcher 退出即关闭 pipe、清内存并
   终止另一侧。
5. electron-builder `build.files` 保持只含 `automation-scripts/**` 与 `src/**/*.{js,html,css,png}`；不加入
   `tools/**` 或根 shim。release verifier 必须检查真实 `app.asar` 与 portable 内容均不存在 root shim、tool、
   bootstrap、bridge、UI、启动脚本或协议字符串，并确认正式 `src/main.js` 无 author require/flag/env hook。

锁定 Electron 11.5.0 的 Windows 实测表明，`NODE_OPTIONS --require` 执行时 `require('electron')` 仍为可执行
文件路径，无法取得 `electron.app`，不能作为本 Feature 的注入方式。首要边界仍是 developer entry/tool 文件
不进包、正式 main 零入口；真实启动回归必须同时观察 Launcher、可见 Author 窗口与随机 Pipe。

### 2. 最小 Named Pipe contract

1. 使用 Node `net` 监听 `\\.\pipe\naruto-vision-author-<pid>-<random>`，只接受 bootstrap 启动的一个
   Author client；不监听 TCP/HTTP，不提供固定端点或发现服务。
2. 消息使用 `4-byte unsigned big-endian length + UTF-8 JSON`。单消息上限 24 MiB，以容纳现有
   `MAX_PNG_BYTES=16 MiB` 的 base64；请求 payload 不接受 PNG/bitmap、文件路径或任意键。
3. 第一条消息必须是 protocol v1 `hello`，token 用 `crypto.timingSafeEqual` 比较；失败、第二客户端、
   未认证请求、未知 op、重复 requestId、超限或畸形 JSON 均断开且不执行副作用。
4. request/response 以 opaque `requestId` 关联。公开 op 仅为：Profile/catalog 列举、capture、
   displayed-frame 确认、freeze/release、Template preview、save preflight/commit、session close。
   详细字段见 [bridge contract](./contracts/vision-author-bridge-contract.md)。
5. Author Electron main 是唯一 pipe client；renderer 使用 `contextIsolation: true`、`nodeIntegration: false`
   的 preload allowlist 调用，不直接接触 `net`、token、`fs` 或 Electron main API。

### 3. Profile 列举与正式 capture 链

1. Profile catalog 从 `profileStore.getAll()` 取候选，但对 UI 只返回 `{id,name,available}`；
   `available` 仅由 `backend.getWindowState(profileId).available` 和正式 `contentSize` 客观有效性决定。
   不返回 server URL、flow 原数据、Partition、Session、Cookie 或窗口对象。
2. Profile 可选门槛不检查 `GAME_READY`、扫码/选服阶段、焦点、可见性或最小化状态。可选择性只取决于
   Profile 存在、对应 window/webContents 未销毁、GameViewport content contract 有效。
3. capture op 必须直接调用由
   `createAutomationBackend({targetProvider: Launcher.getAutomationTarget})` 得到的 `backend.capture()`；
   bridge 不得直接调用 `capturePage()`，不得实现任何 fallback。
4. 正式 backend 加固 await race：保存捕获前 window/webContents/contentSize，返回后重新解析同一
   Profile，并要求 window/webContents 引用和 contentSize 均未变化；否则按正式安全错误拒绝旧帧。
5. bridge 把 backend frame 与安全 Profile identity、随机 `frameId` 组合成不可变帧 DTO。frame 必须满足：
   PNG 可由正式 Vision codec 解码；PNG 实际尺寸等于 `imageSize`；`imageSize` 与 `contentSize` 都严格为
   `1920×1080`；`capturedAt` 有效；Profile 与当前 selection epoch 一致。失败帧可返回 metadata 与安全
   原因作诊断，但不能产生可保存的 frozen frame，且绝不 resize/crop 修复。

### 4. Live 调度与迟到结果

1. 选择 Profile 时 renderer 增加 `selectionEpoch`、清除当前保存资格，立即执行一次 t0 tick，再以
   `setInterval(1000)` 保持固定计划节奏；V1 不渲染或接受 interval 控件。
2. 每个 tick 只检查 `mode === LIVE` 和 `capturePending === false`。满足时先置 pending 再发请求；
   pending 为 true 时只增加本地 `skippedTickCount`，不创建 Promise、timer、队列或补跑标记。
3. capture settle 只清 pending；禁止在 `.finally()` 或完成回调中直接启动下一轮。下一轮只能由后续
   `setInterval` tick 触发，从而与 Clarify 选择和 SC-001 一致。
4. response 同时校验连接 session、Profile id、selection epoch 和 mode。切换 Profile、Freeze 或断连后
   到达的旧 response 只释放 bridge candidate，不改变图像、metadata、选区或保存资格。
5. capture 端 bridge 也设置单连接 `capturePending` 防御门闩；重复 capture 返回稳定 `capture-busy`，
   不在服务端排队。客户端与服务端双层约束都需 fake-timer/延迟 Promise 测试。

### 5. Freeze、frame identity 与恢复 Live

1. renderer 只有在一帧已显示并完成 `frame.displayed(frameId)` ack 后才启用 Freeze/框选。bridge 将该帧
   标为 connection 当前 displayed frame；未 ack candidate 不具备 Freeze 资格。
2. 手动 Freeze 或开始 Template/ROI 框选时，renderer 同步进入 `FREEZING`、停止 interval、增加 view
   generation，并提交当前 displayed `frameId`。bridge 只可 pin 该确切 frame；不存在/归属不符时明确失败，
   不 capture 另一帧替代。
3. bridge 同时最多保存一个 displayed candidate、一个 in-flight candidate 和一个 pinned frozen frame；
   pin 后复制/冻结其原始 PNG、metadata、Profile identity。完整帧不落盘。
4. Freeze 发生时已经开始的 `capturePage()` 无法强制取消；其完成结果必须被 generation 丢弃并释放，
   不改变 frozen frame。Freeze 后不再产生新的 capture 调用。
5. 恢复 Live 调用 `frame.release`，bridge 删除 frozen PNG、preview 与 replacement grants；UI 可保留
   Template/ROI 数值和生成文本并标记为 reference-only，但任何保存请求都会因 frame/preview 已释放而拒绝。
6. Profile 切换、窗口关闭、pipe 断开与工具退出采用同样的保存资格失效路径；窗口关闭时 frozen bytes 可短暂
   保留作诊断，但 save preflight 必须重查 Profile/target 可用性并拒绝写入。不同 Profile 的 frameId 不可互换。

### 6. Template/ROI 选择、preview 与坐标

1. 显示层按容器等比缩放原图，明确记录 rendered image content box；留白区域不参与命中。
2. pointer 坐标先减 content-box origin，再按 `imageSize/renderedSize` 映射；任意拖动方向规范为 left/top/
   right/bottom，边界使用 floor/ceil 得到完整覆盖的整数 screenshot-pixel rect，最后复用 Vision
   `validRect(rect,imageSize)`。零面积或越界选择拒绝。
3. `pointerdown` 立即取得 pointer capture 并触发必要的自动 Freeze；`pointermove` 只渲染当前拖拽矩形与
   screenshot-pixel 坐标，不修改 frozen-frame draft；`pointerup` 才提交最终 Template/ROI 并生成 preview，
   同时覆盖自动 Freeze 尚未完成就先释放指针的竞态。
4. Template 与 ROI 是两个独立 `SelectionRect`，均包含同一 `frozenFrameId`；调整一个不修改另一个。
   两者不要求包含或相交。
5. Template 变化后请求 bridge 创建 `PreviewArtifact`。bridge 只从 pinned 原 PNG 解码，以 Template rect
   做无缩放像素 crop，重新编码 PNG，并返回 `previewId`；输出再 decode 并验证尺寸与逐像素来源。不得从
   DOM canvas、缩略图或另一次 capture 生成 preview。
6. save 不再接收 rect，而接收当前 `previewId`。bridge 由 preview 找回 frozenFrameId、Template rect 与
   crop bytes，从而保证选择、preview 和最终保存是同一 frozen frame 的同一像素产物。

### 7. 可信 Target Script 与模板保存

1. bridge 在启动时用 `createRegistry({app}).scan()` 创建本 developer 会话的唯一 Author registry；catalog
   只发送 `registry.list()` 的安全字段。UI 只提供下拉选择，不提供 `scriptId`、目录或输出路径输入。
2. V1 catalog 是 Launcher 启动快照；仓库脚本包变化后需重启 developer 会话。保存时仍通过
   `registry.get(scriptId)` 重取 record，并重新验证 packageRoot/目录/manifest 所需文件仍存在；失效即拒绝。
3. 目标路径必须以 record 的 `packageRoot` 为权威，不能假设目录名等于 manifest id。固定生成
   `<packageRoot>/assets/vision/<templateId>.png`；请求 schema 根本不包含 pathname/filename/extension。
4. `templateId` 直接复用 `validTemplateId()`：1–64 位 lowercase ASCII slug。对 packageRoot、既有
   `assets`/`vision`、target 执行 lexical containment、`lstat`、realpath、普通文件/目录和 symlink/junction
   拒绝；Windows case-insensitive 同名冲突按已存在处理。
5. 首次发现同名文件时只返回 conflict 和一次性 `replacementGrant`；grant 绑定 connection、frozenFrameId、
   previewId、scriptId、templateId、target 的 stat identity 与短 TTL。确认请求必须携带 grant，写前重查；
   任何变化都要求重新确认。
6. 对 preflight 时不存在的目标，commit 也必须重新检查 absent 状态；若目标在两步之间出现，必须返回
   `target-conflict`、保持写入数为 0，并要求重新 preflight/确认，不能由 temp rename 静默覆盖新目标。
7. save preflight 还必须确认 frozen frame 所属 Profile 仍存在且正式 target 可用；该重查不 capture 新帧。
8. 写入使用目标同目录随机 temp、`flag:'wx'`、写入并 flush 后 `rename`。temp 不以 `.png` 结尾；失败清 temp，
   不先 unlink 正式文件，因此取消/失败保持原文件。成功返回 repo-relative 安全路径，不返回任意绝对路径。
9. 新模板在下一次 runtime load 时立即可用；覆盖已被当前 Launcher Vision loader 缓存的模板可能继续使用旧
   bitmap。V1 不为 developer bridge 暴露 runtime cache；quickstart 要求覆盖后重启 Launcher 再做真实脚本
   验证。该限制不影响保存正确性，且避免为 V1 增加公开/热更新能力。

### 8. ROI、示例代码与剪贴板

1. ROI 文本严格为 `{ x, y, width, height }` screenshot-pixel JSON/JavaScript object 语义，值来自当前
   `SelectionRect`；reference-only ROI 允许复制，但 UI 必须明确它不绑定当前 Live frame、不能用于保存。
2. 示例由纯函数生成并在 UI 显示：`context.vision.find(<templateId>, options)` 与
   `context.vision.waitFor(<templateId>, options)`。合法 templateId 用 `JSON.stringify` 生成字符串字面量；
   有 ROI 时精确加入，没有时省略。
3. 采用现有 API 默认 `threshold=0.95`；wait 示例显式展示 `timeoutMs:10000`、
   `pollIntervalMs:250` 作为可编辑参数，不改变 runtime 默认值或 V1 Live interval。
4. 剪贴板只在 Author Tool renderer 通过受控 preload 操作。失败保留屏幕文本、返回恢复提示，不触发 capture、
   preview 或 save。

### 9. 错误、可观察性与清理

1. bridge 对外只发送 contract 中的稳定 code、安全消息和恢复动作；内部日志可记录 op、requestId、Profile id、
   frameId 前缀、耗时、尺寸、result code，但不记录 PNG/base64、token、绝对路径、URL、Session 或 raw fs error。
2. Launcher 未运行/pipe 断开时 UI 进入 `DISCONNECTED`，停止 tick、禁用 Freeze/preview/save；不会回退到任何
   图片来源。Profile 关闭时保留 frozen frame 仅供诊断/复制，但保存默认要求 bridge session 与 pinned frame
   有效；按 Spec 的失效场景阻止写入。
3. capture 挂起不启动并发轮次。V1 不强杀 `capturePage()`；切 Profile/Freeze/关闭连接后以 epoch 丢弃结果。
   工具可以显示“capture 仍未返回；可切换 Profile、恢复连接或重启 developer 会话”。
4. session close 依次停止 ticker、拒绝新请求、清 frame/preview/grant/token、关闭 socket、销毁 Author window；
   Launcher 退出时负责终止 child，child 退出时 bridge 关闭专用 listener但不关闭游戏窗口。

## Validation Strategy

### 自动化验证

- fake timers 验证 t0 + 固定 1000ms tick、900–1100ms 统计、忙碌 tick 0 启动/0 队列/0 补跑、完成后只在
  后续 tick 启动，以及 Freeze 后调用数不增长。
- 延迟 Promise 覆盖 Profile 快切、Freeze 与返回竞态、旧 epoch、断连、同 `profileId` 窗口关闭重开；
  frame/image/metadata/Profile 不混用。
- frame/selection/preview 测试覆盖四角、反向拖动、留白、零面积、display scaling、PNG header/decoded/
  metadata mismatch、非 `1920×1080` 保存阻止和逐像素 crop。
- Renderer 回归覆盖 Profile 原地重新列举、已选项保留、拖动期间 overlay 百分比实时更新，以及
  Author BrowserWindow `backgroundThrottling: false`，保证失焦/被遮挡时固定 Live tick 不被 Chromium 暂停。
- Renderer 以 `frameId` 为图像 source 提交 identity；同一 frame 上的 scheduled/pending/error/mode emit
  只更新文本与控件，不得重复赋值大 PNG data URL。回归测试须证明第二轮 capture pending 时旧 frame 的
  `img.src` 写入次数保持不变，而新 frame ack 后只增加一次。
- 默认 timer adapter 必须通过持有 `window/global` host 的 wrapper 调用 `host.setInterval/clearInterval`，不得把
  原生浏览器 timer 函数复制到普通对象后作为其方法调用。除 Jest fake timer 单测外，使用锁定 Electron 11
  Renderer probe 验证 t0 后 ticker 可触发，防止 Node 宽松 receiver 语义掩盖 `Illegal invocation`。
- bridge protocol 覆盖错误 token、第二 client、超限、畸形 JSON、未知字段/op、重复 requestId、未认证副作用 0；
  DTO allowlist 不含 URL/Session/Partition/Cookie/webContents/path。
- registry/save 覆盖 manifest id 与目录名不同、伪造 id/path、包删除/替换、symlink/junction/case-only 冲突、
  非法 templateId、目标冲突/取消/grant 过期、rename 失败原文件保持和 temp 清理。
- `npm test -- --runInBand` 与 `npm run lint` 回归现有 Launcher/Profile/automation/Vision；不修改 lockfile。
- Windows `electron-builder --win dir` 后检查真实 `app.asar`：`tools/vision-author`、bridge、bootstrap、Author UI/
  preload/启动脚本/协议标识均为 0；同时 automation script/template 仍存在。

### 人工端到端验证

- 以 developer 入口启动 Launcher 和 Author Tool，选择真实腾讯游戏 Profile，核对 Profile identity、
  `imageSize/contentSize=1920×1080`、约 1s Live、长 capture 跳 tick。
- 在同一 frozen frame 选择 Template/ROI，核对坐标、preview、恢复 Live reference-only、再次 Freeze 重新绑定；
  保存后用图片像素检查和真实 `context.vision.find()/waitFor()` 验证。
- 同时打开两个隔离 Profile，快速切换并关闭一个，确认无跨 Profile frame/metadata/保存混合，另一个 Session 与
  游戏运行不受影响。
- 用标准 `npm start` 验证没有 pipe/Author 入口；构建 portable 并验证包内容和启动行为均无 Author Tool。

详细可执行步骤见 [quickstart.md](./quickstart.md)。

## Constitution Check（Phase 1 后复查）

*Gate result: PASS。research、data model、bridge contract、authoring contract 与 quickstart 均已生成；无未解决
澄清项、不可追溯设计或 Constitution FAIL。*

| Principle | Result | Phase 1 evidence |
| --- | --- | --- |
| I. 规格驱动 | PASS | data model 的 frame/selection/save 状态及两个 contract 均映射 FR/SC，未增加用户功能。 |
| II. 腾讯国服唯一产品方向 | PASS | quickstart 只验证当前 Launcher 腾讯游戏 Profile。 |
| III. 官方认证与受控诊断边界 | PASS | bridge DTO allowlist 和日志边界明确排除认证与 Session 数据；无需授权诊断。 |
| IV. 模块化而非过度抽象 | PASS | tool bridge/session/writer/UI 按职责拆分，正式 backend 仅做通用 race hardening。 |
| V. 旧版运行时兼容 | PASS | research 已确认 Electron 11.5 支持所选开发预加载，所有 runtime/API 均在现有基线内；无依赖变更。 |
| VI. Session 隔离 | PASS | contract 要求每个 frame/profile/epoch 精确绑定及双 Profile 验收，bridge 永不访问 Session。 |
| VII. 测试与验收先行 | PASS | quickstart 给出自动、真实 Profile、双 Profile、错误恢复和发行包验证层级。 |
| VIII. 简单性与必要性 | PASS | 选择一个 private pipe 和固定 op allowlist；拒绝 HTTP、公开 API、热更新和任意路径。 |
| IX. 可诊断性 | PASS | data model 与 contract 定义稳定状态/code/恢复动作及内存清理。 |
| X. 治理与语言规范 | PASS | 全部 Plan 产物为中文且没有修改 Constitution。 |

## Complexity Tracking

无 Constitution violation；本 Feature 不需要例外或复杂性豁免。
