# Vision 腾讯真游戏手动验收

启动器自动化面板已经提供 Windows x64、`1920×1080 + 100%` 固定环境的主要人工验收入口。本目录保留可选命令行 harness，主要用于 `waitFor` / `waitUntilGone` 动态场景；两种入口都不扩展 Linux、DPI 或多缩放支持。

## 准备

1. 从当前固定尺寸游戏画面裁出 exact-scale 局部 PNG，保存到待测脚本的 `assets/vision/<template-id>.png`；不保存完整截图、URL、Cookie、票据或验证码。
2. 启动 launcher 并打开目标 Profile，在“自动化”面板选中该脚本，点击“Vision 框选”并拖出 ROI。面板会自动填入 screenshot-pixel ROI、保存中心坐标并列出该脚本自己的模板。
3. 点击“匹配”查看绿色命中框、rect/confidence；点击“匹配并点击”后目视确认目标被触发、游戏窗口不抢焦点且 OS 鼠标未移动。无需运行命令行。

## 可选命令行 harness

只有需要在真实页面观察 `waitFor` / `waitUntilGone` 的动态变化时，才需要关闭所有 launcher 实例并使用下列命令。ROI 可直接传 `--roi x,y,w,h`，也可先在 UI 点击“复制 ROI”后省略参数，让 harness 从剪贴板导入。ROI 不使用 BrowserWindow DIP。

每条命令会先在 `automation-scripts/` staging 一个随机 ID 的临时 RegisteredScript，再启动现有 launcher。registry 扫描后，在目标 Profile 的“自动化”面板选择名称以 `Vision 手动验收：` 开头的脚本并点击“开始”。脚本只调用冻结的 `context.vision` 与 `context.automation.click()`；终态或 launcher 退出时会删除临时包及复制的模板。

## find → click(center)

目标已显示且点击后会产生可目视确认的业务变化时运行：

```powershell
.\node_modules\.bin\electron.cmd tests\manual\vision-real-game.js find-click --template D:\temp\target.png --threshold 0.95
```

终端会输出 `VISION_MANUAL_RESULT`（templateId、rect、confidence、center）与 `VISION_MANUAL_CLICK dispatched`。目视确认点击命中、后台窗口不抢焦点、OS 鼠标未移动；`waitUntilGone() === true` 或 click 已派发都不能替代业务成功确认。

## waitFor

先让目标处于未出现状态，启动脚本后在真实页面触发目标出现：

```powershell
.\node_modules\.bin\electron.cmd tests\manual\vision-real-game.js waitFor --template D:\temp\target.png --threshold 0.95 --timeout-ms 15000 --poll-ms 250
```

成功时终端输出首次匹配的 rect/confidence/center；本命令不点击。

## waitUntilGone

先让目标处于已出现状态，启动脚本后在真实页面触发目标消失：

```powershell
.\node_modules\.bin\electron.cmd tests\manual\vision-real-game.js waitUntilGone --template D:\temp\target.png --threshold 0.95 --timeout-ms 15000 --poll-ms 250
```

成功时终端输出 `gone:true`；仍需目视判断页面业务是否真的成功。

## 清理检查

- 正常成功、失败或退出 launcher 后，终端应出现 `VISION_MANUAL_CLEANUP`。
- 若机器断电等原因留下目录，关闭 launcher 后只删除 `automation-scripts/manual-vision-acceptance-*`；不要删除整个 `automation-scripts/`。
- 验收结束后删除本地源模板。临时脚本、模板和任何构建产物都不得提交。
- local timeout、运行 cancellation/deadline、terminal 后零 capture、event-loop heartbeat、错误分类及 Profile 并发已由自动测试覆盖，不需要在腾讯页面重复人工验证。
