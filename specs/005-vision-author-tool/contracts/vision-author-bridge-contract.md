# Contract：Vision Author Developer Bridge v1

## 1. 边界

该 contract 是仓库内 developer bootstrap 与其拉起的单个外部 Author Tool 进程之间的私有连接，不是公开
Launcher API、用户 IPC、第三方协议或兼容承诺。正式 Windows 包中不存在 server、client、pipe 名、启动入口
或本文件对应实现。

## 2. Transport 与认证

- Windows Named Pipe：随机 `\\.\pipe\naruto-vision-author-<pid>-<random>`。
- bootstrap 拉起一个 client；同时最多一个 socket。
- framing：4-byte unsigned big-endian payload length，随后 UTF-8 JSON。
- `protocolVersion=1`；消息最大 24 MiB。
- client 第一条 request 必须是 `hello`，含 bootstrap 通过 child env 传递的 32-byte random token。
- token 使用 constant-time 比较；失败、第二 client、超限/畸形 frame 立即关闭，无副作用。
- token 不发 renderer、不写磁盘/日志；握手后普通 request 不重复携带 token。

## 3. Envelope

Request：

```json
{
  "protocolVersion": 1,
  "type": "request",
  "requestId": "opaque-client-id",
  "op": "profiles.list",
  "payload": {}
}
```

Success response：

```json
{
  "protocolVersion": 1,
  "type": "response",
  "requestId": "opaque-client-id",
  "ok": true,
  "result": {}
}
```

Failure response：

```json
{
  "protocolVersion": 1,
  "type": "response",
  "requestId": "opaque-client-id",
  "ok": false,
  "error": {
    "code": "profile-unavailable",
    "safeMessage": "所选 Profile 当前无法 capture。",
    "recovery": "刷新 Profile 列表或启动该 Profile 后重试。"
  }
}
```

所有 request payload 必须是 plain object、只含 op 明确列出的 keys。未知字段、Buffer-like JSON、path、URL 或
PNG input 均返回 `invalid-request`，写入发生数为 0。

## 4. Operations

### `hello`

Payload：`{ "token": "hex-encoded-32-byte-secret" }`。

Result：`{ "sessionId": "opaque", "protocolVersion": 1 }`。

只允许作为第一条 request；成功后 token 不再返回。

### `profiles.list`

Payload：`{}`。

Result：

```json
{
  "profiles": [
    { "id": "p_aaaaaaaa", "name": "主账号", "available": true }
  ]
}
```

禁止字段：URL、server 页面数据、flow raw state、Cookie、Session、Partition、BrowserWindow、webContents。

### `scripts.list`

Payload：`{}`。

Result：

```json
{
  "scripts": [
    {
      "id": "demo-click",
      "name": "演示点击",
      "version": "1.0.0",
      "apiVersion": 1,
      "description": null
    }
  ]
}
```

列表固定来自该 developer 会话 Author registry 启动快照；不含 packageRoot/entry/path。

### `capture`

Payload：

```json
{ "profileId": "p_aaaaaaaa", "selectionEpoch": 4 }
```

Preconditions：Profile 来自当前 catalog 且正式 automation target 可用；connection 无未完成 capture。

Result：

```json
{
  "frame": {
    "frameId": "opaque",
    "profile": { "id": "p_aaaaaaaa", "name": "主账号" },
    "selectionEpoch": 4,
    "pngDataUrl": "data:image/png;base64,...",
    "imageSize": { "width": 1920, "height": 1080 },
    "contentSize": { "width": 1920, "height": 1080 },
    "capturedAt": 1786320000000,
    "contract": { "valid": true, "failures": [] }
  }
}
```

规则：只调用正式 backend；connection 最多一个 pending。`contract.valid=false` 可用于诊断显示，也允许通过
`frame.freeze` 固定后进行诊断、selection 与 preview，但始终不具备 save eligibility。请求/response 不接受或
返回 desktop/window crop source。

### `frame.displayed`

Payload：`{ "frameId": "opaque", "profileId": "p_aaaaaaaa", "selectionEpoch": 4 }`。

Result：`{ "displayedFrameId": "opaque" }`。

只允许 ack 当前 connection candidate。ack 完成前 UI 不启用 Freeze/selection。

### `frame.freeze`

Payload：`{ "frameId": "opaque", "profileId": "p_aaaaaaaa", "selectionEpoch": 4 }`。

Result：返回 pinned frame 的安全 identity/metadata，不需要重复发送 PNG。

规则：frameId 必须等于 current displayed frame、Profile/epoch 一致。contract invalid 的 frame 仍可 pin 作
诊断、selection 与 preview，但结果保持 `contract.valid=false`，任何 save preflight 必须拒绝。不得 capture
新帧替代。

### `frame.release`

Payload：`{ "frameId": "opaque" }`。

Result：`{ "released": true }`。

释放 candidate 或 pinned frame；释放 pinned frame 同时删除 preview 与 replacement grant。幂等 close 可接受。

### `preview.create`

Payload：

```json
{
  "frozenFrameId": "opaque",
  "templateRect": { "x": 100, "y": 200, "width": 80, "height": 40 }
}
```

Result：

```json
{
  "preview": {
    "previewId": "opaque",
    "frozenFrameId": "opaque",
    "templateRect": { "x": 100, "y": 200, "width": 80, "height": 40 },
    "pngDataUrl": "data:image/png;base64,...",
    "imageSize": { "width": 80, "height": 40 }
  }
}
```

bridge 从 pinned 原 PNG 无缩放 crop；不接受 PNG、canvas bytes 或其他 frame source。

### `template.save.preflight`

Payload：

```json
{
  "frozenFrameId": "opaque",
  "previewId": "opaque",
  "scriptId": "demo-click",
  "templateId": "battle-button"
}
```

Result（新文件）：

```json
{
  "status": "ready",
  "relativePath": "automation-scripts/demo-click/assets/vision/battle-button.png"
}
```

Result（冲突）：

```json
{
  "status": "confirmation-required",
  "relativePath": "automation-scripts/demo-click/assets/vision/battle-button.png",
  "replacementGrant": "opaque-one-time-value"
}
```

bridge 必须从 registry record 解析真实 packageRoot；即使安全展示路径使用 manifest/package label，也不得从
request path 推导。`relativePath` 必须由真实 packageRoot 计算并准确表达实际仓库相对路径，不得用 manifest
`scriptId` 合成一个与真实包目录不一致的路径。preflight 不写文件。

### `template.save.commit`

Payload：与 preflight 相同；只有冲突时额外允许 `replacementGrant`。

Result：

```json
{
  "saved": true,
  "replaced": false,
  "relativePath": "automation-scripts/demo-click/assets/vision/battle-button.png",
  "imageSize": { "width": 80, "height": 40 }
}
```

规则：

- request 不含 rect、PNG、目录、filename、extension 或 output path。
- preview 必须仍绑定当前 pinned frame。
- pinned frame contract 必须有效，且其 Profile 仍存在、正式 target 仍可用；该检查不得 capture。
- scriptId 必须仍在 Author registry，templateId 必须通过正式 slug validator。
- preflight 返回 `ready` 后若目标在 commit 前出现，commit 必须返回 `target-conflict`、写入数为 0，并要求重新
  preflight/确认；不得把新出现的目标当作可无确认覆盖文件。
- 冲突 commit 必须有未过期、未使用且 target identity 未变化的 grant。
- 写入使用 preview 的确切 PNG bytes；同目录 temp + flush + rename；失败原文件保持。

### `session.close`

Payload：`{}`。停止接收新请求、释放全部 frame/preview/grant/token 并关闭 pipe。

## 5. Stable errors

至少覆盖：

- `authentication-failed`
- `protocol-invalid`
- `message-too-large`
- `invalid-request`
- `profile-not-found`
- `profile-unavailable`
- `capture-busy`
- `capture-failed`
- `frame-stale`
- `frame-contract-invalid`
- `selection-invalid`
- `preview-stale`
- `script-not-found`
- `template-id-invalid`
- `target-conflict`
- `replacement-confirmation-invalid`
- `target-boundary-invalid`
- `storage-write-failed`
- `connection-closed`

raw exception、绝对 path、token、PNG、URL、Session 信息不得出现在 error DTO。
