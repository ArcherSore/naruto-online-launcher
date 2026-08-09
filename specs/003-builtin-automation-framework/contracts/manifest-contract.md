# Contract：Built-in Script Manifest v1

## Package Layout

```text
automation-scripts/
└── <package-directory>/
    ├── manifest.json
    ├── <entry>.js
    ├── ...optional relative CommonJS modules...
    └── assets/                 # optional, read-only
```

扫描器只枚举 `automation-scripts` 的直接子目录；文件不能直接充当脚本包。

## Manifest Example

```json
{
  "schemaVersion": 1,
  "id": "demo-click",
  "name": "后台连续点击示例",
  "version": "1.0.0",
  "entry": "index.js",
  "apiVersion": 1,
  "description": "按记录顺序点击当前 Profile 的归一化坐标。"
}
```

## Required Validation

| Field | Contract |
| --- | --- |
| `schemaVersion` | integer, exactly `1` |
| `id` | `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, 1～64 chars |
| `name` | trimmed non-empty string, max 80 chars |
| `version` | trimmed non-empty string, max 32 chars |
| `entry` | relative `.js` path inside package, max 240 chars |
| `apiVersion` | integer, exactly `1` |
| `description` | optional string, max 500 chars |

Unknown fields are ignored by v1 and must not change runtime behavior.

## Entry Contract

```js
module.exports = async function run(context) {
  // Trusted built-in script.
};
```

- The module export itself is the run function.
- The entry must not export `{ manifest, run }`; manifest ownership belongs to the registry.
- The function may resolve with any value, but the framework treats resolution only as success and does not persist or broadcast the returned value.
- Top-level module code must have no Profile-specific mutable state or side effects.
- TypeScript development output must already be compiled to compatible CommonJS JavaScript before packaging.

## Relative Module and Asset Policy

- Entry code may load relative JavaScript/JSON modules and read its own read-only assets.
- Built-in script source must not import `electron`, launcher `src/`, Profile modules, CDP/debugger modules, network/process execution modules, or absolute filesystem paths.
- This policy is enforced by project review, lint/boundary tests and package audit; it is not represented as an adversarial runtime sandbox.

## Discovery Result

Valid package:

```json
{
  "id": "demo-click",
  "name": "后台连续点击示例",
  "version": "1.0.0",
  "apiVersion": 1,
  "description": "按记录顺序点击当前 Profile 的归一化坐标。"
}
```

Absolute packageRoot/entryPath and the loaded function are internal and must never cross IPC.

Invalid package:

```json
{
  "packageName": "broken-script",
  "scriptId": null,
  "code": "manifest-json-invalid",
  "safeMessage": "内置脚本 manifest 不是有效 JSON"
}
```

## Registration Error Codes

| Code | Meaning |
| --- | --- |
| `scripts-root-unavailable` | root missing or unreadable; registry remains empty |
| `manifest-read-failed` | manifest cannot be read within size limit |
| `manifest-json-invalid` | JSON parse failed |
| `manifest-invalid` | field/type/value contract failed |
| `manifest-schema-incompatible` | `schemaVersion` unsupported |
| `script-id-conflict` | canonical ID has more than one candidate; all rejected |
| `entry-outside-package` | absolute/traversal/symlink escape |
| `entry-missing` | entry is not an existing regular file |
| `entry-load-failed` | CommonJS load threw |
| `entry-contract-invalid` | export is not a function |
| `api-version-incompatible` | `apiVersion` unsupported |

No registration error may stop validation of unrelated packages or terminate application startup.
