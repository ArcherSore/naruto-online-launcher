# Data Model：内置脚本共享视觉能力

Vision v1 不新增持久化用户数据或数据库。除模板 PNG 位于只读安装资源外，以下实体均为当前
进程、当前 run 或当前视觉 action 的内存对象。

## 1. VisionTemplateIdentity

| Field | Type | Description |
| --- | --- | --- |
| `scriptId` | string | runner 绑定的已注册脚本 ID，脚本不可覆盖 |
| `templateId` | string | 1～64 位 lowercase ASCII slug，不含扩展名或路径语义 |
| `packageIdentity` | internal opaque value | registry record/packageRoot 的内部身份，不公开 |

**Identity**：`RegisteredScript + templateId`，而不是 `Profile + templateId`。

**Rules**：

- `scriptId` 必须从当前 registry record 取得；不能用脚本传入值或目录名重建归属。
- templateId 校验失败必须发生在任何文件系统读取前。
- 不进行 URL decode、Unicode normalize、大小写折叠或路径 sanitize；不符合 slug 直接拒绝。

## 2. DecodedVisionTemplate

| Field | Type | Description |
| --- | --- | --- |
| `identity` | VisionTemplateIdentity | 所属脚本与模板标识 |
| `width` | positive integer | 解码像素宽，最大 1920 |
| `height` | positive integer | 解码像素高，最大 1080 |
| `bitmap` | internal Buffer | `width * height * 4` 的 nativeImage 位图副本 |

**Validation**：目标是 `assets/vision/<templateId>.png` 下普通文件；lexical/realpath containment、
精确大小写、PNG signature、最大 16 MiB、IHDR、nativeImage 非空、尺寸与位图长度均有效。

**Lifecycle**：只读；成功项可在进程内缓存，失败不缓存；不进入 IPC、context、日志或 userData。

## 3. VisionOptions

| Field | Methods | Type / Default | Validation |
| --- | --- | --- | --- |
| `roi` | all | `ImageRect` / full image | 整数、正面积、完全位于本轮 imageSize |
| `threshold` | all | number / `0.95` | finite，`0 <= value <= 1` |
| `timeoutMs` | waits only | integer / `10000` | explicit `1..60000`，不能越过 run deadline |
| `pollIntervalMs` | waits only | integer / `250` | explicit `50..10000` 且 `<= timeoutMs` |

**Rules**：options 省略等于空对象；拒绝 null、数组及其他非普通对象、未知 key 和不适用于该
method 的 timing key。默认 timeout 在 run 剩余时间不足时以 run deadline 为上界，不创建新的
终止原因。

## 4. CaptureFrame

| Field | Type | Description |
| --- | --- | --- |
| `profileId` | internal string | 当前 run 绑定 Profile |
| `png` | internal Buffer | backend 本轮返回的 PNG 副本 |
| `imageSize` | Size | PNG/NativeImage 截图像素空间 |
| `contentSize` | Size | 捕获时规范 automation 内容/页面空间 |
| `capturedAt` | timestamp | backend 捕获时间 |
| `bitmap` | internal Buffer | 解码后 `imageWidth * imageHeight * 4` 副本 |

**Invariants**：PNG、imageSize、contentSize、capturedAt 必须来自同一次 `capture()`；解码尺寸必须
等于 imageSize。不得与另一轮或另一 Profile metadata 混合。

**Lifecycle**：仅当前 attempt 使用；attempt 结束或 action terminal 后释放引用；不缓存、不落盘、
不进入普通日志。

## 5. Size

| Field | Type | Validation |
| --- | --- | --- |
| `width` | integer | `> 0` |
| `height` | integer | `> 0` |

`imageSize` 与 `contentSize` 是不同实体，即使固定验收环境中数值相等也不能合并。BrowserWindow
DIP 不属于该实体，也不作为 Vision 输入。

## 6. ImageRect / ROI

| Field | Type | Validation |
| --- | --- | --- |
| `x` | integer | `>= 0` |
| `y` | integer | `>= 0` |
| `width` | integer | `> 0` |
| `height` | integer | `> 0` |

矩形采用左闭右开 `[x,x+width) × [y,y+height)` 截图像素语义。ROI 必须完全位于 imageSize；
模板必须完整放入 ROI。返回匹配 rect 也必须完整位于 ROI。

## 7. MatchCandidate

| Field | Type | Description |
| --- | --- | --- |
| `rect` | ImageRect | 模板在截图像素空间的位置与原始尺寸 |
| `errorSum` | non-negative integer | 四通道 absolute difference 总和 |
| `confidence` | finite number | `1 - errorSum / (255*4*pixelCount)` |

**Ordering**：confidence 降序；完全相等时 `rect.y` 升序，再 `rect.x` 升序。输入与 options 相同
时，分片边界不能改变排序。

## 8. VisionMatchResult

```text
{
  rect: { x, y, width, height },
  center: { normalizedX, normalizedY },
  confidence
}
```

| Field | Space | Rules |
| --- | --- | --- |
| `rect` | screenshot pixel | 当前 CaptureFrame 中的整数矩形 |
| `center` | automation normalized | 两值 finite 且 `[0,1)`；可原样传给 click |
| `confidence` | unit interval | finite 且 `[0,1]` |

**Center derivation**：先把 `rect.x + width/2`、`rect.y + height/2` 映射为整数 content pixel，
再编码到对应 normalized 单元格中点。result 与所有嵌套对象均冻结；不公开 content pixel、
imageSize/contentSize、路径、Profile 或 capture buffer。

## 9. VisionQuery

| Field | Type | Description |
| --- | --- | --- |
| `method` | enum | `find / waitFor / waitUntilGone` |
| `template` | DecodedVisionTemplate | 当前脚本自有模板 |
| `options` | VisionOptions | 已严格验证并冻结 |
| `profileId` | internal string | runner 绑定 |
| `scriptId` | internal string | runner 绑定 |
| `lease` | internal opaque value | 当前 Profile action ownership |
| `signal` | CancellationSignal | runner 的唯一取消信号 |
| `runDeadlineAt` | timestamp | runner 统一 deadline |
| `localDeadlineAt` | timestamp/null | waits 的局部 deadline；find 为 null |
| `attempt` | positive integer | 已开始 capture 的轮次 |

**No persistence**：query、attempt 和返回值不写入运行状态或用户数据。

## 10. VisionQuery State Machine

```text
created
  └─ enqueue/preflight ─> loading-template
                           └─ valid ─> capturing
                                       └─ decoded ─> matching
                                                      ├─ find match ─> matched(result)
                                                      ├─ find no match ─> not-found(null)
                                                      ├─ waitFor match ─> matched(result)
                                                      ├─ waitUntilGone no match ─> gone(true)
                                                      └─ condition unmet ─> sleeping
                                                                              └─ wake ─> capturing

任意非终态
  ├─ run signal/deadline wins ─> failed(run-cancelled | run-timeout)
  ├─ local deadline wins while run active ─> failed(vision-timeout)
  └─ input/template/window/capture/decode error ─> failed(stable code)
```

**Transition rules**：

- `capturing` 中的 Electron call 不可强制取消；signal 到达后返回结果被丢弃，不能转入 matching。
- `sleeping` 使用 abort-aware timer；取消清除 timer。
- 每个 terminal 只能 settle 一次；迟到 signal/timer/capture/slice 不得修改 terminal。
- `waitUntilGone` 只有一次有效 match 的 no-match 才能进入 `gone`；错误不能进入 `gone`。
- action terminal 后 attempt/capture 增量必须为 0。

## 11. TemplateCacheEntry

| Field | Type | Description |
| --- | --- | --- |
| `key` | internal opaque string/object | 已注册包身份 + templateId |
| `template` | DecodedVisionTemplate | 成功解码的只读模板 |

**Isolation**：同一脚本的只读模板可供不同 Profile run 复用；不同脚本即使 templateId 相同也有
不同 key。cache 不含截图、Profile ID、ROI、match result 或用户数据。

## 12. Stable terminal/error values

| Outcome | Public value/code |
| --- | --- |
| find valid no-match | `null` |
| waitFor match | VisionMatchResult |
| waitUntilGone valid no-match | `true` |
| local wait timeout | `vision-timeout` |
| run cancellation | `run-cancelled` |
| unified run deadline | `run-timeout` |
| invalid args/options/ROI | `vision-input-invalid` |
| rejected templateId | `vision-template-id-invalid` |
| absent template | `vision-template-not-found` |
| read failure | `vision-template-read-failed` |
| invalid PNG/decode/dimensions | `vision-template-invalid` |
| template larger than ROI | `vision-template-too-large` |
| target/capture failure | existing `window-unavailable` / `capture-failed` |
