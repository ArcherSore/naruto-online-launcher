# Data Model：内置自动化脚本框架

## 1. BuiltInScriptManifest

只读脚本包的声明数据。

| Field | Type | Required | Validation |
| --- | --- | --- | --- |
| `schemaVersion` | integer | yes | 必须等于 `1` |
| `id` | string | yes | lowercase ASCII slug，1～64 字符 |
| `name` | string | yes | trim 后非空，最多 80 字符 |
| `version` | string | yes | trim 后非空，最多 32 字符 |
| `entry` | string | yes | 相对 `.js` 路径，解析后仍位于脚本目录 |
| `apiVersion` | integer | yes | 必须等于框架支持的 `1` |
| `description` | string | no | 最多 500 字符 |

**Identity**: `id`。

**Canonical conflict key**: `id.normalize('NFKC').toLowerCase()`。

**Persistence**: 仅存在于只读脚本包，不复制到用户数据。

## 2. RegisteredScript

启动扫描后形成的内存注册记录。

| Field | Type | Description |
| --- | --- | --- |
| `manifest` | BuiltInScriptManifest | 已验证并冻结的 manifest |
| `packageRoot` | internal absolute path | 仅主进程内部使用，不经 IPC 暴露 |
| `entryPath` | internal absolute path | 仅主进程内部使用 |
| `run` | function | 缓存的 CommonJS 导出函数 |
| `registeredAt` | timestamp | 本次启动注册时间 |

**Validation**:

- packageRoot、entryPath 必须通过 lexical 和真实路径 containment。
- `run` 必须为函数。
- 注册记录及 manifest 对外只返回安全显示字段的副本。
- 注册表在启动扫描完成后冻结；运行期不新增、不删除、不热重载。

## 3. RegistrationIssue

某个脚本包或扫描根的拒绝结果。

| Field | Type | Description |
| --- | --- | --- |
| `scope` | enum | `root` 或 `package` |
| `packageName` | string/null | 目录显示名，不含绝对路径 |
| `scriptId` | string/null | 能安全提取时记录 |
| `code` | enum | 稳定注册错误码 |
| `safeMessage` | string | 固定、无路径和无原始 manifest 内容的说明 |

**Rules**:

- 同一 canonical ID 冲突时，每个冲突包各有一条 `script-id-conflict`。
- issue 不阻止其他有效包注册。
- UI 默认只需要有效脚本；issue 用于安全日志和开发诊断，不暴露入口绝对路径。

## 4. ScriptConfigEnvelope

按 `Profile + scriptId` 保存的用户配置。

```json
{
  "schemaVersion": 1,
  "profileId": "p_example",
  "scriptId": "demo-click",
  "updatedAt": "2026-07-30T00:00:00.000Z",
  "config": {}
}
```

**Validation**:

- `profileId` 必须匹配请求并且当前 Profile 真实存在。
- `scriptId` 必须匹配请求并且脚本已注册。
- `config` 必须是普通 JSON object；拒绝数组、原型对象、函数、Buffer、循环引用和非有限数字。
- 编码后文件不得超过 256 KiB。
- 读取时 envelope 身份、schema 或 payload 不符返回 `config-invalid`，不得静默改写文件。
- 文件不存在返回 `{}`；运行开始时 JSON clone 并深度冻结。

**Persistence path**:

```text
<userData>/automation-data/profiles/<profileId>/scripts/<scriptId>/config.json
```

## 5. CoordinateEnvelope

按 `Profile + scriptId` 保存的有序归一化坐标。

```json
{
  "schemaVersion": 1,
  "profileId": "p_example",
  "scriptId": "demo-click",
  "updatedAt": "2026-07-30T00:00:00.000Z",
  "points": [
    {
      "order": 1,
      "normalizedX": 0.25,
      "normalizedY": 0.5
    }
  ]
}
```

**Validation**:

- `points` 必须是数组，最多 100 个点。
- `order` 必须从 `1` 开始连续递增，不能重复。
- `normalizedX`、`normalizedY` 必须为有限数且位于 `[0, 1)`。
- 编码后文件不得超过 64 KiB。
- 文件不存在返回空数组；损坏、身份不匹配或 schema 不兼容返回 `coordinates-invalid`。
- 写入使用同目录唯一临时文件加 rename；失败不得破坏旧文件。

**Persistence path**:

```text
<userData>/automation-data/profiles/<profileId>/scripts/<scriptId>/coordinates.json
```

## 6. NormalizedPoint

脚本可见的不可变坐标值。

| Field | Type | Validation |
| --- | --- | --- |
| `order` | integer | `>= 1` |
| `normalizedX` | number | finite, `0 <= x < 1` |
| `normalizedY` | number | finite, `0 <= y < 1` |

执行点击时，框架用当前内容尺寸计算：

```text
x = min(contentWidth - 1, floor(normalizedX * contentWidth))
y = min(contentHeight - 1, floor(normalizedY * contentHeight))
```

脚本不得接收或缓存 `BrowserWindow`、截图像素到 CDP 坐标的内部映射对象。

## 7. WindowState

脚本可见的安全窗口快照。

| Field | Type | Description |
| --- | --- | --- |
| `available` | boolean | Profile 游戏窗口当前可用 |
| `gameReady` | boolean | 腾讯流程当前是否报告 `GAME_READY`；仅作诊断，不是通用能力门槛 |
| `focused` | boolean | 游戏窗口是否聚焦 |
| `visible` | boolean | 游戏窗口是否可见 |
| `minimized` | boolean | 游戏窗口是否最小化 |
| `contentSize.width` | integer/null | 可用时为正整数 |
| `contentSize.height` | integer/null | 可用时为正整数 |
| `capturedAt` | timestamp | 快照时间 |

**Excluded fields**: URL、title、window ID、webContents ID、Session、Partition、Cookie、Storage、登录或身份参数。

## 8. CaptureResult

脚本主动截图返回的内存结果。

| Field | Type | Description |
| --- | --- | --- |
| `png` | Buffer copy | 当前 Profile 游戏画面，不持久化 |
| `imageSize` | `{width,height}` | PNG 像素尺寸 |
| `contentSize` | `{width,height}` | 捕获时内容尺寸 |
| `capturedAt` | timestamp | 捕获时间 |

**Rules**:

- 仅在目标 Profile 的窗口/webContents 可用且内容尺寸为正时生成；不要求 `gameReady=true`。
- 每次调用返回新 Buffer，不存入普通日志或运行状态。
- 脚本负责丢弃自己的引用；框架不为普通脚本 capture 建磁盘证据。

## 9. CoordinateCaptureRecord

管理 UI 录点期间的短期内存记录，不属于脚本用户数据。

| Field | Type | Description |
| --- | --- | --- |
| `captureId` | random string | 不可猜测的临时标识 |
| `profileId` | string | 绑定 Profile |
| `scriptId` | string | 绑定脚本 |
| `pngDataUrl` | string | 仅返回给当前 ManagerWindow |
| `imageSize` | size | PNG 尺寸 |
| `contentSize` | size | 捕获时内容尺寸 |
| `createdAt` | timestamp | 创建时间 |
| `expiresAt` | timestamp | 创建后 5 分钟 |

**Lifecycle**:

- 每个 `Profile + scriptId` 最多一个活动 record；新 record 替换旧 record。
- 录点请求必须同时匹配 captureId、Profile 和 scriptId。
- 过期、窗口关闭、重新录制或应用退出时清理。
- 不写入磁盘，不进入日志。

## 10. ScriptRun

一次脚本运行的当前/最近状态。

| Field | Type | Description |
| --- | --- | --- |
| `runId` | random string | 本次运行唯一 ID |
| `profileId` | string | 目标 Profile |
| `scriptId` | string | 已注册脚本 |
| `status` | enum | `idle/running/stopping/succeeded/failed/cancelled` |
| `startedAt` | timestamp/null | 开始时间 |
| `endedAt` | timestamp/null | 终态时间 |
| `deadlineAt` | timestamp/null | 5 分钟 deadline |
| `stopReason` | enum/null | `user-stop/timeout/window-closed/app-quit` |
| `error` | object/null | `{code, safeMessage}` |

**Not stored**:

- 脚本返回值、stack、配置内容、坐标内容、截图、窗口对象、CDP 响应。

**Retention**:

- 仅内存保存。
- 初始查询合成 `idle`。
- 终态保留至同一 `Profile + scriptId` 下一次启动。
- 应用重启后重新为 `idle`。

## 11. ScriptRun State Machine

```text
idle
  └─ start accepted ─> running
                         ├─ function resolves first ─> succeeded
                         ├─ script/backend/storage error ─> failed
                         ├─ deadline wins ─> failed(run-timeout)
                         └─ user stop accepted ─> stopping ─> cancelled
```

**Transition rules**:

- `idle/terminal -> running`: Profile lease 可获取、Profile/脚本/游戏状态有效时。
- `running -> stopping`: 仅用户 stop 或应用退出的协作式停止。
- `stopping -> cancelled`: 当前原子动作结束且后续动作已 fenced。
- `running -> failed`: timeout、窗口关闭、Profile 不存在、输入或脚本异常。
- `running -> succeeded`: 脚本 Promise 首先正常完成且未收到终止原因。
- 终态不可再次改变；重复 stop 返回当前快照。
- 同 tick 竞态由首次设置的 termination token 决定。

## 12. ProfileAutomationLease

同一 Profile 的运行与动作占用。

| Field | Type | Description |
| --- | --- | --- |
| `profileId` | string | Map key |
| `token` | opaque random object/string | 只有拥有者可释放 |
| `runId` | string/null | 脚本运行时存在 |
| `acquiredAt` | timestamp | 占用时间 |
| `actionTail` | Promise | 当前 FIFO 动作尾 |
| `released` | boolean | 防止重复释放 |

**Rules**:

- 新运行或独立命令只能 `tryAcquire`；已有 lease 时返回 `profile-busy`。
- stop 可绕过 acquire，但只能取消当前 run。
- 同一 run 的 Automation API 动作追加到 actionTail。
- 取消后尚未开始的 action 在 preflight 阶段拒绝。
- release 必须校验 token，旧 run 不能释放新 lease。
- 不同 profileId 的 lease 互不等待。

## 13. CancellationSignal

Electron 11/Node 12 可用的最小只读取消合同。

| Member | Type | Description |
| --- | --- | --- |
| `aborted` | boolean getter | 首次取消后永久为 true |
| `reason` | string/null getter | 稳定 reason code |
| `onabort` | function/null | 可选单一回调 |
| `addEventListener('abort', fn, options)` | function | 支持 `{once:true}` |
| `removeEventListener('abort', fn)` | function | 移除监听 |

脚本不能获得 controller 或调用 abort。框架在 user stop、timeout、窗口关闭或退出时设置 reason。

## 14. AutomationStatusEvent

发送给 Manager renderer 的白名单 DTO。

```json
{
  "runId": "run-id",
  "profileId": "p_example",
  "scriptId": "demo-click",
  "status": "running",
  "startedAt": 0,
  "endedAt": null,
  "error": null
}
```

**Allowed fields only**:

`runId`、`profileId`、`scriptId`、`status`、`startedAt`、`endedAt`、`error.code`、`error.safeMessage`。

deadline、stopReason、绝对路径、脚本 stack 和内部 token 不经 IPC 暴露。
