# Phase 0 Research：外部 Vision Author Tool

## 研究范围与事实来源

本研究只解决 Plan 需要确定的技术选择。事实优先来自当前源码与现有测试：

- `src/app/Launcher.js`
- `src/app/GameViewport.js`
- `src/automation/backend.js`
- `src/automation/index.js`
- `src/automation/registry.js`
- `src/automation/vision/{api,codec,matcher,template-loader}.js`
- `src/automation/recording.js`
- `src/ui/manager/{IpcRouter,StateBroadcaster}.js`
- `package.json` 与现有 automation/Vision tests

另使用锁定的 Electron 11.5.0 在 Windows 上实测 developer entry 的预加载时序；不以历史迁移文档作为
事实来源。

## Decision 1：显式 developer entry 启动同一正式 Launcher

**Decision**：使用 `tools/vision-author/start.ps1` 运行锁定 Electron，并把仓库根极薄 shim
`vision-author-launcher.js` 作为应用入口。shim 调用 `tools/vision-author/launcher-entry.js`；entry 在正常
Electron main 模块阶段取得 `electron.app`，恢复与根 `package.json` 一致的应用名和 `userData`，安装
bootstrap 后加载正式 `src/main.js`。bootstrap 只在 unpackaged developer 会话中运行，并在正式 Launcher
主进程内启动 bridge。

**Rationale**：

- 根 shim 使 `app.getAppPath()` 保持仓库根；entry 在正式配置模块加载前把应用名及 `userData` 归一为
  `naruto-online-launcher`，因此 Flash、Profile Store、Partition、single-instance lock 和
  `Launcher.gameWindows` 与普通开发启动一致。
- `src/main.js` 不需要 Author flag、环境变量判断或 tool require，因此正式包没有专用连接入口。
- Windows 实测证明 Electron 11.5.0 在 `NODE_OPTIONS --require` 阶段的 `require('electron')` 仍只是
  `electron.exe` 路径字符串，`electron.app` 不可用；显式 entry 避开该初始化时序。
- 根 shim 不在 electron-builder `build.files` allowlist；release verifier 还显式禁止它进入 `app.asar`。

**Alternatives considered**：

- 直接执行 `electron tools/vision-author/launcher-entry.js`：会把 `app.getAppPath()` 改为工具目录，进而改变
  Flash 与 `automation-scripts` 根，拒绝；改用仓库根 shim。
- `NODE_OPTIONS --require`：Electron 11 实测拿不到 `electron.app`，且失败发生在正式 main 之前，拒绝。
- 在 `src/main.js` 增加 `--vision-author`/env 分支：专用入口代码会进入 `src/**/*.js` 发布 allowlist，拒绝。
- 事后连接普通已运行 Launcher：普通实例没有 bridge，强行注入需公开接口或调试能力，超出 V1；明确要求
  关闭后从 developer 入口重启。

## Decision 2：外部进程使用随机 Windows Named Pipe

**Decision**：bootstrap 生成随机 pipe 名和 256-bit token，启动一个 Node `net` single-client server，
然后拉起独立 Electron Author 进程。Author main 通过 pipe 连接；第一帧完成 token handshake。消息为
4-byte length-prefixed JSON，最大 24 MiB。

**Rationale**：

- 真正保持 Author UI 为 Launcher 产品 UI 之外的外部进程。
- 不监听 TCP、不开 HTTP、不形成可发现 endpoint；随机名称+token+单 client 把能力限定到 bootstrap 拉起的工具。
- Node `net`/`crypto` 在 Electron 11 内置，无依赖与 lockfile 变化。
- 长度前缀比 NDJSON 更适合包含 base64 PNG 且便于严格消息上限。

**Alternatives considered**：

- `127.0.0.1` HTTP + bearer token：实现容易，但增加 socket/API 误用面并容易被视为 External API，拒绝。
- Electron `ipcMain`：只在同一 Electron application 的 renderer/main 间使用，不能直接连接第二 Electron 进程；
  现有 Manager IPC 还验证 sender，拒绝复用。
- 桌面截图或 HWND bridge：破坏 screenshot-pixel 语义，规格明确禁止。

## Decision 3：只复用正式 Profile capture backend

**Decision**：bridge 只实例化
`createAutomationBackend({targetProvider: Launcher.getAutomationTarget})`，所有帧调用其 `capture(profileId)`。

**Rationale**：

- 正式 runtime automation service 使用完全相同的组合（`src/automation/index.js`）。
- `Launcher.getAutomationTarget()` 从 `gameWindows[profileId]` 解析所属 window/webContents 与 GameViewport
  `contentSize`，不暴露 Session/Partition。
- `backend.capture()` 是当前唯一正式 `webContents.capturePage()` 调用点，返回不可拆分的
  `{png,imageSize,contentSize,capturedAt}`。
- `GAME_READY` 只是 target 诊断字段；backend 的客观门槛是 Profile/window/webContents/contentSize 有效，
  符合 Constitution 的通用能力边界。

**Alternatives considered**：

- 复用 `automation:recording:begin`：它绑定 Manager sender、script/owner、5 分钟 TTL，会替换/清除 frame，
  不满足 Freeze，拒绝。
- bridge 直接调用 `webContents.capturePage()`：会复制正式 capture 逻辑并产生第二来源，拒绝。
- `context.vision.find()`：每次调用都会重新 capture，不能作为 frozen preview/save 来源，拒绝。

## Decision 4：加固正式 capture 的 target race

**Decision**：在 `backend.capture()` 中记录 capture 前 target window/webContents/contentSize；await 返回后重新
解析并要求对象身份与 contentSize 均相同，不同则拒绝。

**Rationale**：当前实现 await 后只再次 `resolveTarget(profileId)`，没有比较旧/新 target。若同一 Profile 在
capture 中关闭并快速重开，旧 window 的图像可能被新 window 的存在“证明有效”。通用 hardening 同时保护
runtime Vision 和 Author Tool，且不改变截图来源或页面门槛。

**Alternatives considered**：只依赖 Author `selectionEpoch` 无法发现同一 profileId 的 window replacement；拒绝。

## Decision 5：正式 authoring 合同严格为 1920×1080

**Decision**：可保存 frozen frame 必须同时满足：

```text
decoded PNG size == frame.imageSize
frame.imageSize == { width: 1920, height: 1080 }
frame.contentSize == { width: 1920, height: 1080 }
capturedAt is finite
frame.profile.id == current selected Profile id
```

**Rationale**：

- `GameViewport` 明确把物理内容、页面坐标和截图统一为 `1920×1080`、有效 DPR 1。
- `automation-scripts/README.md` 明确 Vision v1 是固定 `1920×1080 + Windows 100%` exact-scale 合同。
- runtime codec 还验证 PNG signature/IHDR、16 MiB、nativeImage decode 与 metadata size；Author 复用这些检查后
  再执行 exact canonical size 门槛。
- `imageSize` 与 `contentSize` 仍分别展示和校验，不静默假设或转换。

**Alternatives considered**：

- 只接受 runtime codec 的“最大不超过 1920×1080”：会让非规范帧产出 exact-scale template，弱于正式作者
  合同，拒绝。
- 把任意帧 resize 到 1920×1080：改变像素和坐标，规格明确禁止。

## Decision 6：renderer 固定 tick，client/server 双 single-flight

**Decision**：选择 Profile 后执行 t0 tick，再使用 `setInterval(1000)`；`capturePending` 为 true 时跳过 tick。
settle 只清 pending，不启动下一轮。bridge 同样拒绝 connection 内并发 capture。

**Rationale**：严格实现 Clarify 选择：固定计划 tick，忙碌跳过，不采用“完成后等待 1 秒”，不排队/补跑。
client guard 证明 UX 行为，server guard 防止错误/恶意重复 request。

**Alternatives considered**：递归 `setTimeout` 放在 capture finally：会变成“完成后等待”，拒绝；interval preset/
custom input：V1 out of scope。

## Decision 7：Launcher-side frame pinning

**Decision**：capture 返回前 bridge 把原 PNG 与 metadata 放入短时 connection frame cache 并分配 opaque
`frameId`。renderer 显示并 ack 后才可 Freeze；Freeze 传当前 displayed frameId，bridge pin 精确记录。
preview/save 只传 frame/preview identity，不回传或上传 PNG。

**Rationale**：

- 外部 renderer 的 data URL、canvas 或任意文件不能冒充正式 frame。
- bridge 能证明 Profile、capture、Template、preview、save 的同一性。
- Freeze 不新 capture；已在途结果按 epoch 丢弃。
- 完整帧只在内存保留，resume/close 后清理。

**Alternatives considered**：

- renderer 保存 PNG 并在 save 时上传：允许外部图片伪装和 mutable buffer，拒绝。
- Freeze 时重新 capture：与当前显示帧不一致，规格禁止。
- 只保存最新 frame 而无 ack/pin：display/return race 无法解释，拒绝。

## Decision 8：preview artifact 同时作为 save source

**Decision**：Template 选择产生 bridge-side `PreviewArtifact {previewId,frozenFrameId,rect,png}`；preview PNG 从
pinned 原始 PNG 无缩放裁剪，并进行尺寸/像素验证。save 只接受 previewId，不再次接受 rect，最终写入同一
preview bytes。

**Rationale**：这比“保存时按同一 rect 再裁一次”更强地证明 preview 与落盘内容相同，同时仍不持久化完整帧。

**Alternatives considered**：DOM canvas crop 或 preview 再编码：可能受显示缩放/插值影响，拒绝。

## Decision 9：registry-rooted save 与原子覆盖

**Decision**：bridge 的 Author registry 使用现有 `createRegistry({app}).scan()`；UI catalog 只来自 `list()`。
save 以 `registry.get(scriptId).packageRoot` 为唯一根，固定输出 `assets/vision/<templateId>.png`，使用同目录
exclusive temp + flush + rename。冲突用一次性 replacement grant 绑定精确 target identity。

**Rationale**：

- registry 已验证固定 root、manifest/API、ID conflict、entry lexical/realpath 和 CommonJS contract。
- 合法 manifest id 不要求等于目录名；必须使用 record.packageRoot，不能按 scriptId 拼目录。
- 现有 automation store 已使用同目录 temp/rename，并有失败保留原文件测试。
- 请求 schema 不含 path，天然拒绝任意输出。

**Alternatives considered**：

- 外部工具自行接受 scriptId/path：破坏 trusted enumeration，拒绝。
- 静默 overwrite 或先 unlink：无法满足确认与失败保留，拒绝。
- 建立脚本/manifest 编辑器：超出 V1。

## Decision 10：发布隔离使用结构性检查

**Decision**：所有专用内容位于 `tools/vision-author/**`，保持 electron-builder files allowlist 不变；自动测试读取
配置并检查真实 unpacked `app.asar`，标准 `npm start` 还要验证无 pipe/Author window。

**Rationale**：仅靠 `if (!app.isPackaged)` 仍会把工具代码装进发行包，不满足 SC-010。结构排除+真实 artifact
检查同时验证“文件不存在”和“入口不存在”。可信脚本下保存的模板是生产脚本资产，按既有规则进入包，属于预期。

**Alternatives considered**：把 bridge 放 `src/developer` 再用 runtime guard：代码仍被 `src/**/*.js` 打包，拒绝。

## 已知实现期风险

- Electron 11 Windows 双进程 Named Pipe、child lifecycle 与大型 base64 帧需真实联调；Plan 已安排 protocol 单测和
  Windows 人工验收。
- Windows junction/reparse point 边界必须用真实临时目录测试，不能只测 POSIX-style symlink。
- `capturePage()` 无取消 API；Freeze/切 Profile 只能丢弃迟到结果，不能保证底层调用立即终止。
- runtime template loader 缓存已加载模板；V1 覆盖后需重启 Launcher，再做脚本验收。

