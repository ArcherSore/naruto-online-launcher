# Quickstart：实现后验证内置脚本共享视觉能力

本文是 Feature 实现完成后的验证指南，不表示当前 Plan 阶段已经存在 Vision 源码或测试。
正式产品/验收环境固定为 Windows x64、`1920×1080` 规范内容与 Windows 100% 显示缩放。

## 1. 环境与基线

- 使用 Volta 固定 Node.js `16.20.2`、npm `8.19.4`。
- 保持 Electron `11.5.0`、PPAPI Flash 和当前 `package-lock.json`。
- 确认分支为 `feature/vision`，不要搜索、恢复或合并不可用 POC 分支。
- 确认 Windows 显示缩放为 100%，游戏窗口由当前 GameViewport 维持规范内容合同。

```powershell
git branch --show-current
node --version
npm --version
npm test -- --runInBand
npm run lint
```

预期：分支与版本正确；实现前现有回归无退化。若基线失败，先记录与 Vision 无关的既存失败，
不得通过升级 Electron/Node 或修改 lockfile 绕过。

## 2. Vision API、matcher 与模板边界

实现后运行定向测试：

```powershell
npm test -- --runInBand src/automation/__tests__/coordinates.test.js src/automation/__tests__/vision-matcher.test.js src/automation/__tests__/vision-template-loader.test.js src/automation/__tests__/vision-api.test.js
```

预期至少证明：

- `context.vision` 冻结且只有 `find/waitFor/waitUntilGone`；现有 automation 五方法不变；
- exact-scale confidence、threshold 边界、ROI、贴边、最高置信度与 row-major tie-break；
- 同一输入跨不同 slice 划分和连续 100 次执行结果一致；
- `find` no-match 返回 null；`waitFor` local timeout 为 `vision-timeout`；
  `waitUntilGone` 有效 no-match 返回 true；
- 非法 templateId 在任何 fs 读取前拒绝；missing/read/PNG/decode/too-large 分类正确；
- 两个包相同 templateId 各自读取 registry packageRoot 下资源，不能跨包或借 symlink/junction 逃逸；
- PNG、bitmap、绝对路径和 raw error 不出现在公开 error/status/log。

## 3. 坐标完整链回归

```powershell
npm test -- --runInBand src/automation/__tests__/vision-coordinate-chain.test.js src/automation/__tests__/api.test.js src/automation/__tests__/recording.test.js src/app/__tests__/GameViewport.test.js
```

必须覆盖 [coordinate contract](./contracts/coordinate-contract.md) 的矩阵：

1. 固定 `1920×1080 + 100%` 合成截图中的模板 center 原样传给
   `automation.click()`，CDP move/press/release 三事件全部命中预期整数 content 坐标。
2. 使用 `(123,39)` 等浮点敏感 content pixel，确认不会回退到 `(122,38)`。
3. 纯逻辑构造 `imageSize=3840×2160`、`contentSize=1920×1080`、BrowserWindow/CDP viewport
   `960×540`，确认截图 `(246,78)` 映射到公开 contentPoint `(123,39)`，CDP 三事件为
   `(61.75,19.75)`，且页面仍命中同一规范 pixel。
4. 非整数比例 `200×100 → 101×51`、第一/最后 pixel、奇偶模板尺寸和 ROI 贴边均可逆且
   normalized `< 1`。
5. 匹配后 GameViewport 合同失效时 click 返回 `window-unavailable`，CDP 调用数为 0。
6. 若实现改动 `recording.js`，必须保留证据证明：先加入的 recording 集成测试通过
   `addPoint()` → normalized point → 当前 mapper 链，在原实现上因稳定复现 1px 回退而失败，
   随后改用 helper 才通过。
   若原实现上无法复现，预期结果是 `recording.js` 没有行为改动，而不是为了共用 helper 强改。

第 3 项只是防止空间混用并保护现有 `GameViewport` 内部 page zoom 的逻辑构造，不是 DPI/多缩放
产品支持或验收扩展。

## 4. Polling、取消、deadline 与响应性

```powershell
npm test -- --runInBand src/automation/__tests__/runner.test.js src/automation/__tests__/coordinator.test.js src/automation/__tests__/cancellation.test.js src/automation/__tests__/vision-api.test.js
```

预期：

- 首轮立即 capture；后续轮次从上一轮完成后等待最小 interval，不重叠、不 catch-up；
- 首次满足、后续满足和 local timeout 的结果/attempt 数符合合同；terminal 后新增 capture 为 0；
- local timeout、用户 stop、窗口关闭和统一 run deadline 竞态 100% 保留 first-settled 原因；
- in-flight capture 取消后结果被丢弃，match/下一 capture 不启动；
- 一个 wait 持有同 Profile FIFO，后续 click 排队；另一个 Profile 的 action 可继续推进；
- full-frame no-match 中 event-loop heartbeat、取消/deadline 检查和另一个 Profile action 能持续
  推进；约 8ms 只作为实现调优预算，不得写成逐 slice 的精确毫秒断言；
- signal 可被观察后 1 秒内停止发起新轮次。

若 no-match 测试证明协作式分片仍阻塞主线程或其他 Profile，不得直接实现 WorkerPool；先停止并
回到 Plan，用实测数据重新评审 Worker 决策。

## 5. 现有框架全量回归

```powershell
npm test -- --runInBand
npm run lint
```

预期：

- 所有既有 registry、runner、coordinator、capture、录点、click、错误、service、Profile 并发
  和 UI/IPC 测试继续通过；
- automation API 仍只有五方法，runner context 仅新增公开 `vision`；
- `GAME_READY=false` 但窗口/webContents/content 合同有效时 Vision 仍可调用；
- 没有 Session/Partition、登录、腾讯流程、PPAPI 或 package-lock 退化。

## 6. Electron/CDP runtime smoke

```powershell
.\node_modules\.bin\electron.cmd tests/runtime/cdp-viewport-coordinate-smoke.js
.\node_modules\.bin\electron.cmd tests/runtime/cdp-background-smoke.js
.\node_modules\.bin\electron.cmd tests/runtime/cdp-ppapi-background-smoke.js
```

viewport smoke 不强制 device scale factor，使用当前 `GameViewport` 创建真实窗口，要求规范
页面/截图仍为 `1920×1080`，并验证 canonical contentPoint 经 BrowserWindow/CDP viewport 映射
后命中同一个 DOM pixel。扩展后的 background smoke 应从正式 registry→runner→`context.vision`
得到 center，并原样交给正式 `automation.click()`；禁止直接从测试复制坐标到 backend。预期
Chromium 与 PPAPI/AS3 靶场均接收正确三事件点击，游戏窗口不抢焦点、系统鼠标不移动，既有
click 行为无退化。

## 7. Windows package / ASAR 验证

```powershell
npm run build:win
$env:AUTOMATION_ASAR_PATH = (Resolve-Path 'dist/win-unpacked/resources/app.asar').Path
npm test -- --runInBand src/automation/__tests__/package-discovery.test.js
.\node_modules\.bin\electron.cmd tests/runtime/packaged-automation-smoke.js $env:AUTOMATION_ASAR_PATH
```

最后一行使用项目固定的 Electron `11.5.0` 运行 harness，但 registry、脚本和模板均从实际
`app.asar` 读取，不从仓库路径旁路资源。预期：

- `automation-scripts/**/assets/vision/*.png` 清单与开发树一致，SHA-256 差异数为 0；
- 从实际 ASAR 内 RegisteredScript packageRoot 加载、解码模板成功；
- 同一合成截图的 rect/center/confidence 与开发环境一致；
- 非法或损坏模板只失败当前 action，不阻止 catalog、其他脚本或其他 Profile；
- 无模板复制到 userData，无额外 `extraResources`、依赖或 lockfile 变更。

## 8. 腾讯真实游戏最小人工验收

1. 使用测试 Profile 按腾讯官方扫码、手工选服并进入游戏；不读取或记录 Cookie、票据、验证码、
   URL query 或认证页面原始数据。
2. 确认 Windows 100% 显示缩放和启动器报告的规范 contentSize `1920×1080`。
3. 选取一个不会消费资源、提交交易或影响账号安全的稳定 UI 目标，用外部工具把 exact-scale
   局部模板保存到所选脚本的 `assets/vision/<template-id>.png`。
4. 在启动器自动化面板选中该脚本，点击“Vision 框选”，在当前截图拖出 ROI；面板会自动填入
   screenshot-pixel ROI 并按现有录点合同保存中心 normalized 坐标，模板下拉框只显示该脚本
   自己的 PNG。
5. 先点击“匹配”，确认绿色命中框、rect 和 confidence；再点击“匹配并点击”，目视确认正式
   `automation.click(result.center)` 命中目标，且前台窗口和系统鼠标位置不变。
6. 记录非敏感的 templateId、imageSize/contentSize、rect、confidence 与测试时间；不要保存
   或提交包含登录/账号信息的原始截图。
7. 如需验证动态等待，再按 `tests/manual/README.md` 的可选命令行 harness 运行 `waitFor` 或
   `waitUntilGone`；`waitUntilGone()` 仅确认该视觉目标消失，不能把 `true` 当作业务成功证明。
8. 验证 `waitFor` 能观察真实目标后续出现；如方便再让两个 Profile 各执行一次 Vision，确认
   没有串窗口。local timeout、运行 cancellation/deadline、terminal 后零 capture、heartbeat 与
   错误分类以自动测试为准，不要求在腾讯页面重复人工验证。

### 2026-08-10 人工验收记录

- 用户在真实腾讯 PPAPI 游戏页面通过启动器自动化面板完成 `demo-click` 的“匹配”与
  “匹配并点击”，并目视确认目标被正确触发。
- 本次使用本地临时模板 ID `target`，模板尺寸 `42×50`，ROI `1355,359,61,50`，threshold
  `0.95`；模板原图不进入提交。
- 同一会话日志显示 registry 扫描成功且 issueCount 为 0；从会话开始到退出，未出现 Vision、
  capture、template、CDP 或 script failure/warning。
- UI 结果没有写日志，因此不补造 rect/confidence 数值；动态 `waitFor`/`waitUntilGone` 与双
  Profile 真实页面场景本次未单独重复，仍以自动测试和后续按需人工验证为准。

若任何步骤需要绕过腾讯登录、验证码、设备验证或风控，立即停止；这些行为不属于本 Feature。

## 9. 通过标准

- [vision API contract](./contracts/vision-api-contract.md)、[coordinate contract](./contracts/coordinate-contract.md)
  与 [template contract](./contracts/template-resource-contract.md) 全部通过；
- SC-001～SC-009 的自动回归和人工固定环境证据齐全；
- full-chain CDP 坐标偏差数、ROI 外结果、跨脚本/Profile 读取、terminal 后 capture 和既有测试
  退化数均为 0；
- 不出现 Worker/WorkerPool、multi-scale、OCR、Python/OpenCV、新输入、新调度器或 DPI 产品扩展；
- Electron/Node/npm/PPAPI、Session/Partition、腾讯官方登录和 lockfile 均保持基线。
