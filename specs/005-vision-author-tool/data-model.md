# Data Model：外部 Vision Author Tool

本 Feature 不增加数据库或长期业务记录。以下实体是 developer bridge 与 Author UI 当前会话内的内存状态；唯一
持久化实体是保存成功的 Template PNG。

## 1. BridgeSession

代表 developer bootstrap 与唯一 Author Tool client 的连接。

| Field | Type | Rules |
| --- | --- | --- |
| `sessionId` | opaque string | 启动时随机，日志仅允许短前缀 |
| `pipeName` | string | 随机 Windows Named Pipe；不写普通日志/文件 |
| `token` | 32-byte secret | 只经 child env 传递；认证后仍不得回传 renderer |
| `protocolVersion` | integer | V1 固定 `1` |
| `authenticated` | boolean | `hello` 成功后才允许任何 op |
| `clientConnected` | boolean | 同时最多一个 client |
| `capturePending` | boolean | bridge 端 single-flight 防线 |
| `selectedProfileId` | string/null | 当前 capture 目标；必须来自 Profile catalog |
| `selectionEpoch` | integer | Profile 切换/恢复/失效时单调增加 |
| `displayedFrameId` | string/null | renderer 已显示并 ack 的候选帧 |
| `frozenFrameId` | string/null | 同时最多一个 pinned frame |

**Validation**：未认证、第二 client、未知 op、超限消息、错误 token 均不得创建或修改其他实体。

## 2. ProfileOption

安全的可选择 Profile DTO。

| Field | Type | Rules |
| --- | --- | --- |
| `id` | string | 来自 Profile Store；请求必须精确回传 catalog 值 |
| `name` | string | 安全展示字段 |
| `available` | boolean | 正式 backend window state 的客观可捕获性 |

不得包含 URL、server 页面数据、flow 原始数据、Cookie、Session、Partition、BrowserWindow 或 webContents。
`GAME_READY` 若未来显示也只能是诊断字段，不影响 `available`；V1 可不传。

## 3. ScriptOption

Author registry 的安全 catalog 项。

| Field | Type | Rules |
| --- | --- | --- |
| `id` | lowercase slug | registry 已登记的 manifest id |
| `name` | string | registry 安全字段 |
| `version` | string | registry 安全字段 |
| `apiVersion` | integer | V1 必须为 `1` |
| `description` | string/null | registry 安全字段 |

`packageRoot`、entry path 和任意 filesystem path 只存在 bridge 内的 registry record，不进入 DTO。

## 4. CaptureFrame

一次正式 backend capture 的不可拆分结果。

| Field | Type | Rules |
| --- | --- | --- |
| `frameId` | opaque string | bridge 随机生成，connection scoped |
| `profile` | `ProfileIdentity` | `{id,name}`，与请求和当前 epoch 一致 |
| `selectionEpoch` | integer | response 接受时必须等于 UI 当前值 |
| `png` | Buffer | 原始 `backend.capture()` PNG；只在 bridge 内存保存 |
| `pngDataUrl` | string | 只作为安全 DTO 发送 UI，不接受反向上传 |
| `imageSize` | Size | screenshot pixels |
| `contentSize` | Size | 正式 canonical content pixels |
| `capturedAt` | number | backend 同次 capture 时间 |
| `contract` | FrameContractResult | 可诊断、决定可保存性 |
| `status` | enum | `CANDIDATE`、`DISPLAYED`、`PINNED`、`RELEASED` |

`FrameContractResult`：

```text
valid: boolean
failures: zero or more stable codes
  png-invalid
  png-image-size-mismatch
  image-size-not-canonical
  content-size-not-canonical
  captured-at-invalid
  profile-mismatch
```

**Canonical contract**：`imageSize=1920×1080`、`contentSize=1920×1080`、decoded PNG size 等于
`imageSize`。invalid frame 可被 pin 作诊断、选择与 preview，但其 FrozenFrame 的 `contractValid=false`，
不能获得保存资格。

## 5. LiveControllerState

Author renderer 的调度状态。

| Field | Type | Rules |
| --- | --- | --- |
| `mode` | enum | `DISCONNECTED`、`LIVE`、`FREEZING`、`FROZEN` |
| `selectedProfileId` | string/null | 变更时 epoch 增加 |
| `selectionEpoch` | integer | 防止迟到 response 覆盖 |
| `capturePending` | boolean | true 时 tick 只跳过 |
| `intervalMs` | integer | V1 常量 `1000`，不是设置 |
| `scheduledTickCount` | integer | 诊断/测试 |
| `startedCaptureCount` | integer | 诊断/测试 |
| `skippedTickCount` | integer | 诊断/测试 |
| `displayedFrameId` | string/null | 只有 ack 后可 Freeze |

### State transitions

```text
DISCONNECTED
  └─ connect + select Profile → LIVE

LIVE
  ├─ tick + idle → capture pending → LIVE
  ├─ tick + busy → skip → LIVE
  ├─ manual Freeze / selection start → FREEZING
  ├─ Profile switch → LIVE(new epoch, no save binding)
  └─ pipe loss → DISCONNECTED

FREEZING
  ├─ pin displayed frame succeeds → FROZEN
  ├─ pin fails → LIVE or explicit no-frame error
  └─ disconnect → DISCONNECTED

FROZEN
  ├─ Template/ROI/preview/save → FROZEN (same frameId)
  ├─ Resume Live → LIVE(new epoch, frozen frame released)
  ├─ Profile switch → LIVE(new epoch, frozen frame released)
  └─ disconnect → DISCONNECTED
```

Freeze 期间不允许启动新 capture；进入 `FREEZING` 后在途 response 只能释放。

## 6. FrozenFrame

对 exact `CaptureFrame` 的 pinned 身份，不复制语义、不重新 capture。

| Field | Type | Rules |
| --- | --- | --- |
| `frameId` | opaque string | 等于已显示 CaptureFrame id |
| `profile` | `ProfileIdentity` | Freeze 后不可变化 |
| `png` | Buffer | 同一原始 PNG 的不可变副本/所有权 |
| `imageSize` | Size | 不可变化 |
| `contentSize` | Size | 不可变化 |
| `capturedAt` | number | 不可变化 |
| `contractValid` | boolean | false 时不产生保存资格 |
| `sourceAvailable` | boolean | save preflight 重查 Profile/target；关闭后为 false |
| `pinnedAt` | number | 会话诊断时间 |

同时最多一个；resume/Profile switch/session close 时释放。旧 Selection 数值可留 UI，但不再持有 frame binding。

## 7. SelectionRect

Template 或 ROI 的 screenshot-pixel 矩形。

| Field | Type | Rules |
| --- | --- | --- |
| `kind` | enum | `TEMPLATE` 或 `ROI` |
| `frozenFrameId` | string | 必须等于当前 FrozenFrame |
| `x` / `y` | integer | `>=0` |
| `width` / `height` | integer | `>0` |
| `referenceOnly` | boolean | resume/switch 后 true；不可保存 |

边界：`x+width<=imageSize.width`、`y+height<=imageSize.height`。Template 与 ROI 互不修改，不要求包含关系。

## 8. PreviewArtifact

Template preview 与最终 save 的共同 source。

| Field | Type | Rules |
| --- | --- | --- |
| `previewId` | opaque string | connection scoped |
| `frozenFrameId` | string | 必须为当前 pinned frame |
| `templateRect` | SelectionRect | `kind=TEMPLATE` |
| `png` | Buffer | 从 frozen 原 PNG 无缩放 crop |
| `imageSize` | Size | 等于 Template `width/height` |
| `createdAt` | number | session-local |

Template rect 或 frozen frame 变化即释放旧 PreviewArtifact。save 只按 previewId 取 bytes，不接收替代 rect/PNG。

## 9. AuthoringDraft

UI 当前工作参数。

| Field | Type | Rules |
| --- | --- | --- |
| `frozenFrameId` | string/null | save 时必须为当前 pinned frame |
| `template` | SelectionRect/null | save 必需 |
| `roi` | SelectionRect/null | code/copy 可选 |
| `previewId` | string/null | save 必需且绑定 template |
| `targetScriptId` | string/null | 只能从 ScriptOption 选择 |
| `templateId` | string | `validTemplateId()` |
| `findExample` | string | 纯函数派生 |
| `waitForExample` | string | 纯函数派生 |
| `saveEligible` | boolean | 全部 frame/preview/script/id/path contract 同时满足 |

`saveEligible` 是派生值，不能由 renderer 单独声明；bridge 在任何写入前重新校验所有输入，并要求 frozen
frame 的 `sourceAvailable=true`。该可用性重查不得 capture 新帧。

## 10. ReplacementGrant

同名模板显式覆盖确认的一次性凭据。

| Field | Type | Rules |
| --- | --- | --- |
| `grantId` | opaque secret | 单次使用、短 TTL |
| `sessionId` | string | 必须为当前连接 |
| `frozenFrameId` | string | 必须仍 pinned |
| `previewId` | string | 必须仍当前 |
| `scriptId` / `templateId` | string | 精确目标 |
| `targetIdentity` | object | save preflight 时的安全 stat identity |
| `expiresAt` | number | 过期重新确认 |

取消、任一选项变化、resume、disconnect 或 target stat 改变即失效。

## 11. SavedTemplate

唯一持久化实体。

| Field | Type | Rules |
| --- | --- | --- |
| `scriptId` | string | 已注册 catalog id |
| `templateId` | string | 合法 lowercase slug |
| `relativePath` | string | `automation-scripts/<registered-package>/assets/vision/<templateId>.png` |
| `png` | file bytes | 精确等于 PreviewArtifact PNG |
| `width` / `height` | integer | Template rect size |
| `replaced` | boolean | 只有有效 ReplacementGrant 时 true |

不保存完整 frame、Profile identity、ROI、token 或 connection metadata。
