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
3. 纯逻辑构造 `imageSize=3840×2160`、`contentSize=1920×1080`、BrowserWindow DIP sentinel
   `960×540`，确认 DIP 不参与换算，截图 `(246,78)` 映射到 content/CDP `(123,39)`。
4. 非整数比例 `200×100 → 101×51`、第一/最后 pixel、奇偶模板尺寸和 ROI 贴边均可逆且
   normalized `< 1`。
5. 匹配后 GameViewport 合同失效时 click 返回 `window-unavailable`，CDP 调用数为 0。
6. 若实现改动 `recording.js`，必须保留证据证明：先加入的 recording 集成测试通过
   `addPoint()` → normalized point → 当前 mapper 链，在原实现上因稳定复现 1px 回退而失败，
   随后改用 helper 才通过。
   若原实现上无法复现，预期结果是 `recording.js` 没有行为改动，而不是为了共用 helper 强改。

第 3 项只是防止空间混用的逻辑构造，不是 DPI/多缩放产品支持或验收扩展。

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
.\node_modules\.bin\electron.cmd tests/runtime/cdp-background-smoke.js
.\node_modules\.bin\electron.cmd tests/runtime/cdp-ppapi-background-smoke.js
```

扩展后的 smoke 应从正式 registry→runner→`context.vision` 得到 center，并原样交给正式
`automation.click()`；禁止直接从测试复制坐标到 backend。预期 Chromium 与 PPAPI/AS3 靶场均
接收正确三事件点击，游戏窗口不抢焦点、系统鼠标不移动，既有 click 行为无退化。

## 7. Windows package / ASAR 验证

```powershell
npm run build:win
$env:AUTOMATION_ASAR_PATH = (Resolve-Path 'dist/win-unpacked/resources/app.asar').Path
npm test -- --runInBand src/automation/__tests__/package-discovery.test.js
.\dist\win-unpacked\NarutoOnline.exe --automation-packaged-smoke
```

若实际 packaged smoke 仍使用独立 harness，则按实现后的正式命令替换最后一行。预期：

- `automation-scripts/**/assets/vision/*.png` 清单与开发树一致，SHA-256 差异数为 0；
- 从实际 ASAR 内 RegisteredScript packageRoot 加载、解码模板成功；
- 同一合成截图的 rect/center/confidence 与开发环境一致；
- 非法或损坏模板只失败当前 action，不阻止 catalog、其他脚本或其他 Profile；
- 无模板复制到 userData，无额外 `extraResources`、依赖或 lockfile 变更。

## 8. 腾讯真实游戏最小人工验收

1. 使用测试 Profile 按腾讯官方扫码、手工选服并进入游戏；不读取或记录 Cookie、票据、验证码、
   URL query 或认证页面原始数据。
2. 确认 Windows 100% 显示缩放和启动器报告的规范 contentSize `1920×1080`。
3. 选取一个不会消费资源、提交交易或影响账号安全的稳定 UI 目标，从对应脚本自己的
   `assets/vision/` 模板调用 `vision.find()`。
4. 记录非敏感的 templateId、imageSize/contentSize、rect、confidence 与测试时间；不要保存
   或提交包含登录/账号信息的原始截图。
5. 把返回 center 不作转换传给 `automation.click()`，目视确认目标中心被触发，前台窗口和系统
   鼠标位置不变。
6. 点击后用 `waitUntilGone()` 仅确认该视觉目标消失；另外目视确认预期业务 UI 是否出现，不能
   把 `true` 当作业务成功证明。
7. 分别验证 `waitFor` 后续出现、local timeout、用户停止和 run deadline；确认错误 code 与
   terminal 后零新增 capture。
8. 同时在 Profile A/B 做非破坏性查找，确认截图/result 不串 Profile；一个 Profile 关闭或模板
   失败不影响另一个。

若任何步骤需要绕过腾讯登录、验证码、设备验证或风控，立即停止；这些行为不属于本 Feature。

## 9. 通过标准

- [vision API contract](./contracts/vision-api-contract.md)、[coordinate contract](./contracts/coordinate-contract.md)
  与 [template contract](./contracts/template-resource-contract.md) 全部通过；
- SC-001～SC-009 的自动回归和人工固定环境证据齐全；
- full-chain CDP 坐标偏差数、ROI 外结果、跨脚本/Profile 读取、terminal 后 capture 和既有测试
  退化数均为 0；
- 不出现 Worker/WorkerPool、multi-scale、OCR、Python/OpenCV、新输入、新调度器或 DPI 产品扩展；
- Electron/Node/npm/PPAPI、Session/Partition、腾讯官方登录和 lockfile 均保持基线。
