# Contract：Vision Authoring v1

## 1. Screenshot 与坐标合同

- authoring source 只能是当前 developer bridge 调用正式 `automation/backend.capture(profileId)` 的结果。
- screenshot pixel origin 为原 PNG 左上角；`x` 向右、`y` 向下。
- 可保存 frame 必须满足：
  - PNG 可由正式 Vision codec 解码；
  - decoded PNG size 等于 `imageSize`；
  - `imageSize={width:1920,height:1080}`；
  - `contentSize={width:1920,height:1080}`；
  - `capturedAt` 有效；
  - frame Profile 等于当前选择 Profile。
- 不满足可诊断显示，但 save 必须阻止；不得 resize、重采样、补 metadata 或换帧。

Rect 合同：

```js
{
  x: integer >= 0,
  y: integer >= 0,
  width: integer > 0,
  height: integer > 0
}
```

且 `x+width<=imageSize.width`、`y+height<=imageSize.height`。Template 和 ROI 均使用该合同。

## 2. Display mapping

显示可等比缩放，但只能把 pointer 反算到原图：

```text
localX = pointerX - renderedImageLeft
localY = pointerY - renderedImageTop
imageX = localX * imageSize.width / renderedImageWidth
imageY = localY * imageSize.height / renderedImageHeight
```

drag 两点取 min/max，左上边界 floor、右下边界 ceil，再 clamp 到原图。落在 letterbox 留白、零面积或越界的
selection 无效。UI 显示值永远是最终整数 screenshot pixels，不显示 DOM/CSS/DIP 作为 authoring 坐标。

## 3. Live schedule

- Profile selection 产生一个 t0 tick，随后固定 `setInterval(1000)`。
- tick 到达且 `capturePending=false`：启动一轮并设 true。
- tick 到达且 `capturePending=true`：跳过；不创建请求、队列、补跑标记。
- capture settle：只清 pending；不直接启动下一轮。
- 任一时刻 client 与 bridge 各自观察到的 Author capture 最大并发为 1。
- V1 不提供 interval preset 或 custom input。

## 4. Freeze identity

- 手动 Freeze 和开始 Template/ROI selection 共用同一 transition。
- transition 在使用 selection pointer 前同步停止 interval，并 pin 当前已显示/ack 的 `frameId`。
- Freeze 不 capture；无 displayed frame 或 frame 已失效时明确失败。
- Template、ROI、preview、save 都必须携带/解析同一 `frozenFrameId`。
- contract invalid 的 displayed frame 可 Freeze、selection 和 preview 作诊断，但 save 必须拒绝。
- 在途 capture 的迟到结果不能改变 frozen image/metadata/selection。
- Resume Live 释放 frozen frame 的保存资格；旧 Template/ROI 可 reference-only 显示/复制，但 save 禁止。

## 5. Template 与 preview

- Template rect 与 ROI rect 独立；调整任一不改变另一项。
- Preview 只由 bridge 对 pinned frozen 原 PNG 的 Template rect 做像素 crop。
- Preview result 创建 `previewId`，绑定 frozenFrameId + exact rect + exact crop PNG。
- Template 或 frame 改变使旧 preview 失效。
- Save 使用 previewId 对应的确切 PNG，不重新 capture、不从 canvas/缩略图生成、不 resize。

## 6. Target Script 与 templateId

- Target Script 只能从 Author registry catalog 选择。
- UI 不存在自由 `scriptId`/目录/输出路径字段。
- save request schema 不允许 path/filename/extension。
- templateId：1–64 位，`^[a-z0-9]+(?:-[a-z0-9]+)*$`。
- target 由 registry record 的真实 `packageRoot` 固定解析为 `assets/vision/<templateId>.png`，成功结果显示的
  仓库相对路径也必须从该 packageRoot 计算；manifest id 与目录名可以不同，不得按 scriptId 合成路径。
- 不创建脚本 package、不编辑 manifest、不写其他脚本。

## 7. Save 与覆盖

Save eligibility 同时要求：

```text
connected bridge
+ current registered Target Script
+ current valid pinned FrozenFrame
+ frozen frame source Profile/target still available (no recapture)
+ current valid Template rect
+ current PreviewArtifact
+ valid templateId
+ verified package/vision path boundary
+ no conflict OR valid explicit ReplacementGrant
```

写入采用 same-directory exclusive temp + flush + atomic rename。取消或失败不先删除旧目标。case-only 同名按冲突；
symlink/junction/reparse escape 或 target state 漂移均拒绝。若 preflight 时不存在的目标在 commit 前出现，commit
必须以 `target-conflict` 拒绝且写入数为 0，重新取得明确覆盖确认后才可继续。成功文件 bytes 等于 preview bytes，
尺寸等于 Template rect。

## 8. ROI 与 code generation

复制 ROI：

```js
{ x: 1400, y: 760, width: 480, height: 260 }
```

有 ROI 时：

```js
const match = await context.vision.find('battle-button', {
  roi: { x: 1400, y: 760, width: 480, height: 260 },
  threshold: 0.95
});

await context.vision.waitFor('battle-button', {
  roi: { x: 1400, y: 760, width: 480, height: 260 },
  threshold: 0.95,
  timeoutMs: 10000,
  pollIntervalMs: 250
});
```

无 ROI 时省略 `roi`。生成器不得新增 Vision API 或改变 runtime 默认值。clipboard 失败不改变任何 authoring state。

## 9. Forbidden sources/capabilities

V1 bridge 和 UI 都不得提供：desktop/window/HWND/BitBlt capture、外部图片 input、resize to 1920×1080、
URL/template import、Session/Cookie/DOM/Storage、CDP/click/input、runner、OCR、多尺度、网络模板、任意文件浏览/
写入、第三方 API 或插件能力。
