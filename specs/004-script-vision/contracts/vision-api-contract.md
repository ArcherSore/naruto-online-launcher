# Contract：Built-in Script Vision API v1

## Run Context Extension

现有冻结 run context 向后兼容地增加一个字段：

```text
context
├── profileId
├── config
├── signal
├── log
├── automation                     # 现有五项方法不变
└── vision                         # 新增、冻结
    ├── find(templateId, options?)
    ├── waitFor(templateId, options?)
    └── waitUntilGone(templateId, options?)
```

`vision` 不暴露 Profile/script 参数、registry、模板根目录、fs、nativeImage、BrowserWindow、
webContents、CDP、Session、Cookie、URL 或认证数据。manifest `apiVersion` 保持 `1`。

## Types

```text
Size = { width: positive integer, height: positive integer }
ImageRect = { x: integer >= 0, y: integer >= 0,
              width: integer > 0, height: integer > 0 }
NormalizedPoint = { normalizedX: finite [0,1), normalizedY: finite [0,1) }
VisionMatchResult = {
  rect: ImageRect,                 # screenshot pixel space
  center: NormalizedPoint,         # automation.click input space
  confidence: finite [0,1]
}
```

所有成功返回对象及其嵌套对象均冻结。`rect` 不能直接当作 click/content/CDP 坐标；只有
`center` 可原样传给 `context.automation.click()`。

## `vision.find(templateId, options?)`

**Allowed options**：

- `roi?: ImageRect`
- `threshold?: number`，默认 `0.95`

**Behavior**：

1. 在当前 Profile FIFO 中执行一次完整 action。
2. 加载当前脚本自己的模板并捕获一张新鲜截图。
3. 在 ROI（省略时为完整截图）中做一次 exact-scale match。
4. 第一个确定性最佳候选达到 threshold 时返回 `VisionMatchResult`。
5. 有效截图与匹配完成但无合格候选时返回 `null`；no-match 不是 error。

`find` 不接受 `timeoutMs` 或 `pollIntervalMs`。

## `vision.waitFor(templateId, options?)`

**Allowed options**：

- `roi?: ImageRect`
- `threshold?: number`，默认 `0.95`
- `timeoutMs?: integer`，默认 `10000`，显式范围 `1..60000`
- `pollIntervalMs?: integer`，默认 `250`，显式范围 `50..10000`

`pollIntervalMs` 必须 `<= timeoutMs`。显式 `timeoutMs` 不得使 local deadline 越过调用时剩余
run deadline。运行剩余不足默认 `10000ms` 时，默认 local deadline 以 run deadline 为上界。

**Behavior**：

- 第一轮立即执行，不先 sleep。
- no-match 后，从上一轮完成起至少等待 `pollIntervalMs`，再开始下一轮；轮次不重叠、不补跑。
- 首次合格 match 返回与 `find` 相同的 `VisionMatchResult`。
- run 仍有效而 local deadline 到达时抛 `vision-timeout`，不返回 `null`。

## `vision.waitUntilGone(templateId, options?)`

options 与 `waitFor` 相同。

**Behavior**：

- 第一轮立即执行。
- 首次有效截图/match 在 ROI 内没有 confidence `>= threshold` 的候选时返回 `true`。
- `true` 只证明视觉条件满足；不证明此前 click、页面导航或业务动作成功。
- 模板大于 ROI、模板/PNG/capture/window 错误都抛稳定错误，不得解释为 gone。
- local deadline 到达且 run 仍有效时抛 `vision-timeout`。

## Option Validation

- `templateId` 合同见 [template-resource-contract](./template-resource-contract.md)。
- options 省略或为普通 object；拒绝数组、函数、Buffer 和其他类型。
- 拒绝未知 key、不适用于当前方法的 key、NaN、Infinity、小数 timing、零/负 timing、越界值。
- ROI 在 capture 后针对本轮 imageSize 校验；不静默裁剪、取整或变换。
- 模板不能大于 ROI；该错误为 `vision-template-too-large`。

## Matching Contract

- 无缩放、旋转、OCR、特征或对象检测。
- 截图/模板使用同一 nativeImage 四字节 bitmap 解码路径。
- confidence 为四通道 mean absolute error 的补数；alpha 参与比较，不是 mask。
- confidence 最高者获胜；完全并列时选 `y` 最小，再选 `x` 最小。
- ROI 外像素不得参与候选读取或结果选择。

## FIFO and Concurrency

- 一个 `find` 或完整 wait 调用占用当前 Profile 的一个 coordinator FIFO action。
- 同 Profile 后续 automation/vision action 必须等待该调用 terminal。
- 不同 Profile 保持独立 lease/action tail；matcher 分片必须向 event loop 让步，不能用同步全图
  no-match 阻塞另一 Profile。
- Vision 内部不得嵌套调用公开 `automation.capture()`/`automation.wait()`，以免再次 enqueue。

## Cancellation and Deadline Precedence

每个调用在以下边界检查 terminal：调用/动作开始、capture 前后、matcher slice 前后、poll timer
唤醒、返回/抛错前。

检查顺序：

1. lease 仍归当前 run；
2. runner signal 是否已经 aborted；`reason === 'timeout'` → `run-timeout`，其他 →
   `run-cancelled`；
3. wait 的 local deadline 是否到达；run 仍有效时 → `vision-timeout`；
4. 才能开始新 capture/slice 或 settle 正常结果。

一次调用只允许 settle 一次。已返回 result/null/true 或已抛 error 后，后来 abort/deadline/timer
不得覆盖。`capturePage()` in-flight 时收到 abort，返回数据必须丢弃，不进入 decode/match/下一轮。

## Stable Errors

| Code | Meaning |
| --- | --- |
| `vision-input-invalid` | method 参数、options、threshold、ROI 或 timing 无效 |
| `vision-template-id-invalid` | templateId 在任何读取前被拒绝 |
| `vision-template-not-found` | 当前脚本的目标 PNG 不存在 |
| `vision-template-read-failed` | 目标普通文件无法读取 |
| `vision-template-invalid` | 不是有效受限 PNG、解码/尺寸/位图不合法 |
| `vision-template-too-large` | 模板不能完整放入当前 ROI |
| `vision-timeout` | 视觉局部 timeout 获胜 |
| `window-unavailable` | 当前 Profile 窗口/webContents/content contract 无效 |
| `capture-failed` | capture 或截图 PNG 解码失败 |
| `run-cancelled` | runner 用户/窗口/退出取消优先 |
| `run-timeout` | runner 统一 deadline 优先 |

错误只公开 allowlist `code` 与固定 `safeMessage`；不得包含绝对路径、raw fs/nativeImage 文本、
PNG/bitmap、stack、URL、Cookie 或认证状态。

## Examples

```js
const match = await context.vision.find('battle-button', {
  roi: { x: 1400, y: 760, width: 480, height: 260 },
  threshold: 0.97
});
if (match) await context.automation.click(match.center);
```

```js
await context.vision.waitFor('battle-button', {
  timeoutMs: 10000,
  pollIntervalMs: 250
});

await context.vision.waitUntilGone('loading-indicator', {
  timeoutMs: 30000,
  pollIntervalMs: 500
});
```

