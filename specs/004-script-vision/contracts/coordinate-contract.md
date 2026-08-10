# Contract：Vision Pixel → Automation Click Coordinate

## Coordinate Spaces

| Space | Source | Meaning |
| --- | --- | --- |
| Screenshot pixel | `capture().imageSize` | PNG/NativeImage 像素；ROI 与 rect 属于这里 |
| Canonical content/page | `capture().contentSize` / execution target | automation 与 CDP 使用的页面坐标；正式为 1920×1080 |
| Normalized point | `automation.click()` input | `{normalizedX,normalizedY}`，每值 finite `[0,1)` |
| BrowserWindow DIP | `window.getContentSize()` | OS/窗口逻辑尺寸；不属于 Vision/click 输入或 CDP 坐标 |
| CDP coordinate | `Input.dispatchMouseEvent.x/y` | 当前 backend 的整数 content/page coordinate |

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

5. `{x,y}` 原样用于 CDP move/press/release，不再乘 screenshot/DIP 比例。

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
| float-sensitive | target content `(123,39)` | 三个 CDP event 均为 `(123,39)`，不得回退一像素 |
| unequal sizes | image `3840×2160`, content `1920×1080` | screenshot center `(246,78)` → CDP `(123,39)` |
| DIP sentinel | BrowserWindow DIP `960×540` alongside above | 结果不读取/使用 DIP；不据此宣称 DPI 支持 |
| non-integer ratio | image `200×100`, content `101×51` | helper 量化后经 mapper 精确回到同一 content pixel |
| boundaries | first/last pixels, odd/even template sizes | normalized 始终 `[0,1)`，rect/center 不越界 |
| drift | target contentSize null after match | click 拒绝 `window-unavailable`，CDP 调用数为 0 |

完整链测试必须经过正式 Vision API → `automation.click()` → backend mapper → CDP sendCommand，
不能只分别测试公式。

