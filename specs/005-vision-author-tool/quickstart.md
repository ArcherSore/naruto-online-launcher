# Quickstart / Validation Guide：Vision Author Tool

本文是实现完成后的可执行验收指南，不包含实现代码。V1 只支持 Windows x64 仓库开发环境。

## 1. Prerequisites

- 仓库位于可写工作区，已安装锁定依赖。
- Volta：Node.js `16.20.2`、npm `8.19.4`。
- Electron `11.5.0` 与 PPAPI Flash 文件完整。
- 已至少完成一次普通 Launcher setup。
- 至少一个 Profile 已在 Launcher 中打开真实游戏窗口。
- 开发测试前关闭所有普通 Launcher 实例；V1 不向已经普通启动的实例事后注入 bridge。

确认版本：

```powershell
node --version
npm --version
node -p "require('./node_modules/electron/package.json').version"
```

Expected：`v16.20.2`、`8.19.4`、`11.5.0`。

## 2. Automated validation

实现完成后先运行：

```powershell
npm test -- --runInBand
npm run lint
```

Expected：全部现有与 `tools/vision-author` suites 通过；无 Node/Electron/lockfile 升级。

重点测试必须证明：

- 固定 1000ms tick；slow capture 跨 tick 时并发 1、busy tick 启动 0、补跑 0。
- Freeze/切 Profile 后迟到 frame 不覆盖；Template/ROI/preview/save frameId 一致。
- 非 1920×1080、PNG/metadata mismatch、无效/越界 rect 均零写入。
- catalog 只含 registry 信任脚本；手工 scriptId/path、symlink/junction escape、非法 templateId 零写入。
- conflict 未确认零覆盖；rename 失败旧文件不变、temp 清理。
- bridge 错 token、第二 client、未知 op/字段、超限 message 零副作用。

## 3. Start the developer session

从仓库根运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/vision-author/start.ps1
```

Expected：

1. 正式 Launcher 正常启动，现有 Profile/Session/Flash 行为与 `npm start` 相同。
2. 独立 Vision Author Tool 窗口随后出现。
3. 无 TCP/HTTP listener；只有该 developer 会话随机 Named Pipe。
4. Author Tool 只显示 Profile 安全身份和 registry catalog，不显示 URL/Cookie/Session/Partition/path。

若普通 Launcher 已运行，Expected：developer 会话不创建 Author Tool/pipe，并提示关闭现有实例后重试。

## 4. Live scheduling acceptance

1. 打开一个可 capture Profile，在 Author Tool 选择它。
2. 观察至少 10 秒，记录 frame capturedAt、计划 tick、started/skipped count。
3. 用测试 seam 或调试开关把一轮正式 capture completion 延迟到跨越两个 tick；该 seam 只能位于开发工具，
   不得替换截图来源。

Expected：

- 首个 t0 tick 后，计划 tick 间隔均在 900–1100ms。
- capture 每次在下一 tick 前完成时，每 tick 启动一次。
- slow capture 期间最大并发 1；两个 busy tick 各启动 0；完成瞬间补跑 0；只在下一个计划 tick 启动。
- UI 没有 250/500/custom interval 控件。

## 5. Freeze and selection acceptance

1. 等待显示一帧且 metadata 为 `imageSize=1920×1080`、`contentSize=1920×1080`。
2. 点击 Freeze，记录 frameId/profile/capturedAt。
3. 等待 3 秒，确认图像与 metadata 不变且没有新 capture start。
4. Resume Live；再开始 Template selection，确认 selection 开始前自动 Freeze 当前显示帧。
5. 在四角、边缘、中部执行正向/反向 drag；分别创建/调整 Template 与 ROI。
6. 改变窗口大小和显示缩放，仅观察 Author UI display mapping。

Expected：

- Freeze pin 的是点击时已经显示的 frame，不新 capture。
- 已在途 capture 即使返回也不替换 frozen frame。
- Template/ROI 都显示整数 screenshot-pixel `{x,y,width,height}`，互不修改。
- 留白/零面积 selection 拒绝；缩放 Author 窗口不改变已有坐标。
- preview 尺寸等于 Template rect，并与 frozen PNG 对应像素逐一一致。

## 6. Contract rejection acceptance

通过测试 fixture 或受控 mock 让 frame 出现以下任一情况：

- PNG 实际尺寸与 `imageSize` 不同；
- `imageSize` 不是 1920×1080；
- `contentSize` 缺失、非法或不是 1920×1080；
- Profile identity 与当前选择不符。

Expected：UI 显示失败项；允许诊断查看；Template save disabled；写入数 0；没有 resize/crop correction/fallback。

## 7. Target Script and save acceptance

1. 核对 Target Script 下拉与正式 registry 可接受 catalog 完全一致。
2. 选择一个现有脚本、有效 frozen frame/Template/ROI，输入合法 templateId 后保存。
3. 核对生成文件位于该 registry package 的 `assets/vision/<templateId>.png`。
4. 核对文件 bitmap 与 preview、frozen frame Template pixels 一致。
5. 测试 manifest id 与目录名不同的 registry fixture，确认按 packageRoot 写入，不按 id 猜目录。
6. 测试非法 templateId、伪造 scriptId、request 增加 output path、script dir 被删除/替换、symlink/junction。
7. 创建同名文件：先取消，再取得明确 replacement grant 并确认；再模拟 target 在确认后变化。

Expected：

- UI 无手工 scriptId/path input；伪造请求全部零写入。
- 首次保存只写目标脚本；不创建脚本 package/manifest。
- 冲突未确认不覆盖；有效 grant 仅可使用一次；target 漂移需重新确认。
- 任一写入失败旧文件保持，temp 清除。
- 覆盖当前 Launcher 曾加载的 template 后，重启 developer Launcher 再进行 runtime Vision 验收，避免旧 cache。

## 8. ROI and examples

1. Copy ROI，粘贴到纯文本编辑器。
2. 分别复制 `find()` 和 `waitFor()` 示例。
3. 清除 ROI，重新生成。
4. 模拟 clipboard failure。

Expected：ROI 值与 UI screenshot pixels 完全一致；示例 templateId 一致；有 ROI 时精确包含、无 ROI 时省略；
wait 示例只使用现有 API 参数。clipboard failure 保留屏幕文本且不触发 capture/save。

## 9. Multi-Profile isolation

1. 同时打开 Profile A/B（各自独立 Partition）。
2. 在 A Live 时快速切 B，并让 A capture 延迟返回。
3. Freeze B，选择并保存；随后关闭 A。
4. 反向重复，并在一个 Profile window 关闭后快速重开同 id。

Expected：B 的显示/frozen/save 只含 B identity/frame；A 迟到结果被丢弃；关闭 A 不改变 B 的 frame、Session、
Flash 或游戏运行；同 id 重开 race 的旧 window capture 被正式 backend 拒绝。

## 10. Disconnect and cleanup

分别测试 Launcher 未运行、pipe 中断、Profile 关闭、capture 失败/挂起、Author child 退出、Launcher 退出。

Expected：工具崩溃 0；停止 tick/save；显示至少一个恢复动作；fallback capture 0；退出后 frame/preview/token/grant
内存释放，完整 PNG 不写仓库或 userData。

## 11. Release exclusion

结构检查：

```powershell
node -e "const p=require('./package.json'); const f=p.build.files.join('\n'); if (/tools[\\/]vision-author/i.test(f)) process.exit(1); console.log('build allowlist excludes vision-author')"
rg -n "vision-author|launcher-bootstrap" src package.json
```

Expected：build allowlist 不含 tools；正式 `src/**` 和 root package scripts 不含 Author 专用入口。

构建 unpacked Windows artifact：

```powershell
npx electron-builder --win dir --publish never
node tools/vision-author/scripts/assert-package-excluded.js dist/win-unpacked/resources/app.asar
```

随后运行 portable 构建：

```powershell
npm run build:win
```

Expected：

- `app.asar` 中 tool/bootstrap/bridge/Author UI/start entry 数均为 0。
- 标准 packaged executable 不创建 Author pipe/window。
- `automation-scripts/**` 与正式模板仍在包内，runtime packaged automation smoke 通过。
- Launcher、Flash、Profile isolation、Vision runtime 回归退化数为 0。

## 12. Acceptance completion

由熟悉 automation script 但未参与实现的开发者计时执行：

```text
选择 Profile → Freeze → Template/ROI → preview → 选择 Target Script
→ 输入 templateId → save → copy find/waitFor examples
```

Expected：2 分钟内完成第一个有效产物，不使用外部截图或图片编辑器；SC-001～SC-010 全部有自动或人工证据。

