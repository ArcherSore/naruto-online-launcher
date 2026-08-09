# Contract：Built-in Script Runtime API v1

## Entry Invocation

The framework invokes the cached CommonJS function once per accepted run:

```text
run(frozenContext) -> Promise settlement
```

Synchronous throw and asynchronous rejection both become `failed/script-failed`. A normal settlement becomes `succeeded` unless a prior stop, timeout or target failure already won termination.

## Run Context

```text
context
├── profileId: string
├── config: deeply frozen JSON object
├── signal: CancellationSignal
├── log: BoundStructuredLogger
└── automation: frozen AutomationApiV1
```

No other field is supported. In particular, the context must not contain Electron objects, window/webContents references, registry references, filesystem paths, Session/Partition objects, CDP methods, Cookie/Storage or login state.

## CancellationSignal

Supported read-only members:

- `aborted: boolean`
- `reason: string | null`
- `onabort: function | null`
- `addEventListener('abort', listener, { once? })`
- `removeEventListener('abort', listener)`

The shape is AbortSignal-compatible but does not require a global `AbortSignal` or support `instanceof`. Scripts cannot abort the controller.

Stable reasons:

- `user-stop`
- `timeout`
- `window-closed`
- `app-quit`

## BoundStructuredLogger

Methods:

- `debug(event, fields?)`
- `info(event, fields?)`
- `warn(event, fields?)`
- `error(event, fields?)`

The framework always binds `runId`, `profileId`, `scriptId`, level and timestamp. Scripts cannot override bound fields.

Allowed script fields are safe scalars such as `stage`, `action`, `durationMs`, `retryCount` and `errorCode`. Unknown keys, functions, Buffer, screenshot data, circular objects and oversized values are discarded or reduced to a fixed safe summary. Logger failure must not crash the launcher or reveal raw data.

## AutomationApiV1

### `capture()`

Returns:

```text
{
  png: Buffer,
  imageSize: { width, height },
  contentSize: { width, height },
  capturedAt: number
}
```

Rules:

- Bound to the current run Profile.
- Requires the bound target window/webContents to be available with a positive content size.
- `gameReady` is diagnostic only and does not authorize or deny capture.
- PNG is a fresh in-memory copy and is never logged or persisted by the framework.
- No URL, page DOM, Session or login metadata is returned.

### `getWindowState()`

Returns:

```text
{
  available: boolean,
  gameReady: boolean,
  focused: boolean,
  visible: boolean,
  minimized: boolean,
  contentSize: { width, height } | null,
  capturedAt: number
}
```

The method is read-only and does not focus, show, restore or resize the window.

### `getCoordinates()`

Returns a deeply frozen copy:

```text
[
  { order: 1, normalizedX: 0.25, normalizedY: 0.5 }
]
```

Missing file returns an empty array. Corrupt, mismatched or incompatible data rejects with `coordinates-invalid`.

### `click(point)`

Input:

```text
{ normalizedX: number, normalizedY: number }
```

Returns safe dispatch metadata:

```text
{
  dispatchedAt: number,
  contentPoint: { x: integer, y: integer }
}
```

Rules:

- Both normalized values must be finite and in `[0,1)`.
- Mapping uses current content size at action execution time.
- The Profile lease serializes the whole atomic click.
- The atomic click completes move/press/release and owned debugger cleanup before cancellation takes effect on the next action.
- The method never focuses the window and never calls an OS global mouse API.

### `wait(ms)`

- `ms` must be a finite non-negative integer.
- A single wait is at most 60,000 ms and cannot exceed the remaining run deadline.
- Already-cancelled calls reject immediately.
- Cancellation clears the timer and rejects with `run-cancelled` or `run-timeout` according to the winning reason.

## Common Action Preflight

Before every action starts, the framework checks:

1. run token still owns the Profile lease;
2. signal is not cancelled;
3. Profile still exists;
4. target window/webContents still exists;
5. dimensions required by the method are positive and current;
6. method inputs are valid.

Tencent flow stages and `gameReady` are diagnostic/script-policy inputs and are never a generic
capture, click, recording or start preflight gate.

Queued actions that have not started fail after cancellation and must not reach the backend.

## Profile Concurrency Contract

- One Profile: at most one script run or standalone automation command owns the lease.
- Busy start/command: immediate `profile-busy`, no backlog.
- Inside one run: all API actions execute FIFO even if the script requests them concurrently.
- Different Profiles: independent leases and action tails; parallel execution is allowed.
- stop bypasses lease acquisition and targets only the specified active `runId`.

## Run Status Contract

| Current | Trigger | Next | Error |
| --- | --- | --- | --- |
| `idle/terminal` | accepted start | `running` | none |
| `running` | script resolves first | `succeeded` | none |
| `running` | user stop accepted | `stopping` | none |
| `stopping` | atomic action cleaned up | `cancelled` | `run-cancelled` |
| `running` | deadline wins | `failed` | `run-timeout` |
| `running` | script/backend/storage failure | `failed` | stable failure code |

First termination wins. Terminal states cannot be overwritten by late script settlement or stale actions.

## Runtime Error Codes

| Code | Meaning / Recovery |
| --- | --- |
| `profile-not-found` | Profile no longer exists |
| `profile-busy` | stop/wait for the current run, then retry |
| `game-not-ready` | reserved legacy/diagnostic code; generic v1 start, capture, recording and click do not emit it |
| `window-unavailable` | reopen the Profile game window |
| `config-invalid` | repair or clear target script configuration |
| `coordinates-missing` | record at least one coordinate for scripts that require it |
| `coordinates-invalid` | clear and record coordinates again |
| `run-cancelled` | user/application cancellation completed |
| `run-timeout` | run exceeded the 5-minute framework deadline |
| `script-failed` | built-in script rejected or threw |
| `capture-failed` | screenshot failed |
| `capture-expired` | request a new coordinate screenshot |
| `cdp-unavailable` | backend unavailable on the target |
| `cdp-already-attached` | close game DevTools/other debugger and retry |
| `cdp-attach-failed` | CDP attach failed |
| `cdp-detached` | target/debugger detached during action |
| `cdp-dispatch-failed` | mouse event dispatch failed |
| `action-timeout` | a bounded backend action exceeded its deadline |
| `storage-read-failed` | target data could not be read |
| `storage-write-failed` | target data could not be written atomically |

Raw error text and stacks are not part of this public contract.
