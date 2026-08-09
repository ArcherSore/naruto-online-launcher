# Contract：Manager Automation IPC v1

## Security Boundary

Every channel in this document:

1. accepts calls only from the current ManagerWindow renderer;
2. revalidates Profile and script IDs in the main process;
3. returns only JSON-safe DTOs, except the coordinate capture data URL;
4. never accepts an entry path, file path, window/webContents ID, CDP method, URL, Cookie, ticket or Session value;
5. never logs the capture data URL, config contents or coordinate contents.

Response envelope:

```text
{ ok: true, ...payload }
{ ok: false, error: "<stable-code>" }
```

## Queries and Commands

### `automation:list`

Request:

```text
{ profileId: string }
```

Success:

```text
{
  ok: true,
  target: { available: boolean, gameReady: boolean },
  scripts: [
    {
      id,
      name,
      version,
      apiVersion,
      description,
      status
    }
  ]
}
```

`status` is the current or most recent safe ScriptRun snapshot for that `Profile + scriptId`, or synthesized `idle`.

### `automation:status`

Request:

```text
{ profileId: string, scriptId: string }
```

Success:

```text
{ ok: true, status: AutomationStatusEvent }
```

The query is side-effect free and does not clear a terminal state.

### `automation:start`

Request:

```text
{ profileId: string, scriptId: string }
```

Success:

```text
{ ok: true, status: { runId, profileId, scriptId, status: "running", startedAt } }
```

Validation failures include `profile-not-found`, `script-not-found`, `profile-busy`, `window-unavailable`, `config-invalid`. A diagnostic `gameReady=false` is not a start validation failure.

The request returns after the run has been accepted, not after the script finishes. Completion is delivered by status event/query.

### `automation:stop`

Request:

```text
{ profileId: string, runId: string }
```

Success:

```text
{ ok: true, status: AutomationStatusEvent }
```

- An active matching run becomes `stopping`.
- Repeating the same stop returns the current `stopping` or terminal snapshot.
- A stale runId must not cancel a newer run and returns `run-not-active`.

### `automation:coordinates:get`

Request:

```text
{ profileId: string, scriptId: string }
```

Success:

```text
{
  ok: true,
  points: [
    { order, normalizedX, normalizedY }
  ]
}
```

### `automation:recording:begin`

Request:

```text
{ profileId: string, scriptId: string }
```

Success:

```text
{
  ok: true,
  capture: {
    captureId,
    pngDataUrl,
    imageSize: { width, height },
    contentSize: { width, height },
    expiresAt
  },
  points: [...]
}
```

Requires an available target window/webContents with a positive content size. `gameReady` is diagnostic
only. The capture is in memory, bound to the pair and expires after 5 minutes.

### `automation:recording:add-point`

Request:

```text
{
  profileId: string,
  scriptId: string,
  captureId: string,
  imageX: finite number,
  imageY: finite number
}
```

Success:

```text
{
  ok: true,
  point: { order, normalizedX, normalizedY },
  points: [...]
}
```

The main process maps displayed PNG coordinates through capture metadata and persists the normalized point. It rejects expired/mismatched captures and out-of-range values.

### `automation:coordinates:clear`

Request:

```text
{ profileId: string, scriptId: string }
```

Success:

```text
{ ok: true, points: [] }
```

Only the target pair is cleared.

## Push Events

### `automation:catalog`

Sent by `StateBroadcaster.pushAll()` when the manager is ready/reopened:

```text
{
  scripts: [
    { id, name, version, apiVersion, description }
  ]
}
```

No absolute package/entry path or rejected manifest content is included.

### `automation:statuses`

Full safe in-memory status list sent by `pushAll()`:

```text
{
  statuses: [AutomationStatusEvent]
}
```

### `automation:status`

Single transition event:

```text
{
  runId,
  profileId,
  scriptId,
  status,
  startedAt,
  endedAt,
  error: { code, safeMessage } | null
}
```

StateBroadcaster must enforce exact status enums and field allowlists before calling `ManagerWindow.send`.

## UI Behavior

- Each Profile card exposes an “自动化” entry even when the game is closed, so users can view scripts and saved coordinates.
- Start and screenshot recording are enabled when that Profile's game target is available; a diagnostic
  `gameReady=false` does not disable them. Backend methods still reject missing/destroyed windows,
  invalid webContents or non-positive content size.
- A selected running script shows Stop; terminal states remain visible until the next start.
- `profile-busy`, DevTools conflict, timeout, window close and invalid coordinates use fixed Chinese recovery text keyed by error code.
- Renderer reload/reopen reconstructs catalog and statuses from `manager:ready -> pushAll`; it does not depend on receiving every prior transition event.

## Removed Demo Channels

Formal implementation must not retain or expose:

- `automation-demo:capture`
- `automation-demo:click`
- `automation-demo:manager-capture`
- `automation-demo:manager-click`
- `automation-demo:manager-recording-*`
- `automation-demo:manager-run-script`
- Debug-only `CDP POC` product controls

Their behavior is replaced by the versioned generic contracts above.
