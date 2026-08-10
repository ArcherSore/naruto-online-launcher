# Contract：Vision Pixel → Automation Click Coordinate

## Coordinate Spaces

| Space | Source | Meaning |
| --- | --- | --- |
| Screenshot pixel | `capture().imageSize` | PNG/NativeImage 像素；ROI 与 rect 属于这里 |
| Canonical content/page | `capture().contentSize` / execution target | 脚本、Vision 与公开 `contentPoint` 使用的规范页面坐标；正式为 1920×1080 |
| Normalized point | `automation.click()` input | `{normalizedX,normalizedY}`，每值 finite `[0,1)` |
| BrowserWindow DIP / CDP viewport | `window.getContentSize()` | OS 窗口逻辑尺寸，也是当前 Electron 11 CDP Input 接收的 viewport 空间；只由 backend 内部读取 |
| CDP coordinate | `Input.dispatchMouseEvent.x/y` | backend 从规范 content pixel 映射出的 viewport 坐标，缩放不为 1 时可以是浮点数 |

数值相等不代表空间相同。实现、测试或脚本文档不得把其中任意两种无条件合并。

## Current Main Contract

1. `GameViewport` 通过 BrowserWindow DIP 与 page zoom 维持规范页面 `1920×1080`。
2. 合同有效时 `Launcher.getAutomationTarget().contentSize` 是 `{1920,1080}`；漂移时为 null，
   backend 拒绝为 `window-unavailable`。
3. `capture()` 返回同次 PNG、imageSize、contentSize 与 capturedAt；不保证两尺寸相等。
4. click 执行时重新读取当前有效 contentSize，并执行：

```text
x = min(contentWidth - 1, floor(normalizedX * contentWidth))
y = min(contentHeight - 1, floor(normalizedY * contentHeight))
```

5. `{x,y}` 仍是公开的整数 `contentPoint`。backend 再读取当前 BrowserWindow content DIP，映射到
   CDP viewport；若两尺寸相等，沿用原有整数坐标；否则使用规范 pixel 单元格中心：

```text
cdpX = (x + 0.5) * cdpViewportWidth / contentWidth
cdpY = (y + 0.5) * cdpViewportHeight / contentHeight
```

BrowserWindow DIP/CDP viewport 不进入 Vision 或脚本 API。这个内部末段映射抵消 `GameViewport`
的 page zoom，使页面收到的事件仍落在规范 content pixel 内。

## Vision Encoding

对匹配矩形 `rect`：

```text
imageCenterX = rect.x + rect.width / 2
imageCenterY = rect.y + rect.height / 2

contentX = min(contentWidth - 1,
               floor(imageCenterX * contentWidth / imageWidth))
contentY = min(contentHeight - 1,
               floor(imageCenterY * contentHeight / imageHeight))

normalizedX = (contentX + 0.5) / contentWidth
normalizedY = (contentY + 0.5) / contentHeight
```

`center` 只返回最后两项。`contentX/Y` 是内部中间值，不进入脚本 API。

## Why Cell Midpoint Is Required

把 `contentX/contentWidth` 作为 normalized 值位于单元格下边界，JavaScript 二进制浮点可能在
乘回时落到前一格。当前环境可复现：

```text
floor((123 / 1920) * 1920) = 122
floor((39 / 1080) * 1080) = 38
```

使用 `(contentX+0.5)/contentWidth` 后，值严格位于目标单元格内部；当前 click mapper 必然得到
`contentX`。最后像素也满足 normalized `< 1`。

该结论来自当前源码和数值行为，不代表已恢复或唯一定位不可用 POC 的历史偏差。

## Capture/Click Drift

- Vision 必须只使用同次 capture 的 imageSize 与 contentSize 生成 center。
- click 仍按执行时 contentSize 校验和映射；若 GameViewport 合同已漂移，必须拒绝，而不是用
  capture 时尺寸或旧 POC 坐标盲点。
- v1 不承诺 capture 与 click 之间页面内容不移动；脚本可用 `waitFor/waitUntilGone` 表达视觉
  条件，但这不是截图锁定或事务点击能力。

## Mandatory Regression Matrix

| Case | Input | Expected |
| --- | --- | --- |
| fixed product | image/content `1920×1080`, 100% | Vision center 经 click/CDP 命中模板 content center |
| float-sensitive | target content `(123,39)` at equal viewport size | 三个 CDP event 均为 `(123,39)`，不得回退一像素 |
| unequal image sizes | image `3840×2160`, content/CDP viewport `1920×1080` | screenshot center `(246,78)` → content/CDP `(123,39)` |
| distinct CDP viewport | above image/content, BrowserWindow DIP `960×540` | public contentPoint `(123,39)`；CDP 三事件 `(61.75,19.75)`，页面命中同一规范 pixel；不据此宣称 DPI 支持 |
| non-integer ratio | image `200×100`, content `101×51` | helper 量化后经 mapper 精确回到同一 content pixel |
| boundaries | first/last pixels, odd/even template sizes | normalized 始终 `[0,1)`，rect/center 不越界 |
| drift | target contentSize null after match | click 拒绝 `window-unavailable`，CDP 调用数为 0 |

完整链测试必须经过正式 Vision API → `automation.click()` → backend mapper → CDP sendCommand，
不能只分别测试公式。
