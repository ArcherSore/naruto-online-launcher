# Contract：Script-owned Vision Template Resource

## Resource Layout

```text
automation-scripts/<package-directory>/
├── manifest.json                   # manifest.id is the public scriptId
├── index.js
└── assets/
    └── vision/
        └── <templateId>.png
```

`<package-directory>` 不要求等于 manifest ID。权威映射是 registry 的
`RegisteredScript.packageRoot`；loader 不得用 `automation-scripts/<scriptId>` 猜目录。

## Public Identifier

`templateId`：

- string，长度 1～64；
- 匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`；
- 不包含 `.png` 扩展名；
- 大小写敏感，只允许 lowercase ASCII；
- 不执行 URL decode、NFKC normalize、separator 替换或 sanitize。

因此空值、`.`/`..`、`/`、`\`、drive prefix、UNC、NUL、`%2e%2e`、`file:`、`http:`、Unicode、
大写或扩展名输入都在任何文件读取前返回 `vision-template-id-invalid`。

## Resolution Algorithm

1. 从当前 runner/registry record 取得不可由脚本覆盖的 packageRoot。
2. 固定 visionRoot 为 `<packageRoot>/assets/vision`。
3. 用目录枚举确认精确文件名 `<templateId>.png`，避免 Windows 大小写折叠造成开发/ASAR 差异。
4. 对 root 与 candidate 做 lexical containment。
5. 对存在资源做 realpath containment；拒绝 symlink/junction 跨出 visionRoot 或 packageRoot。
6. 只接受普通文件，不接受目录、device、socket 或替代资源根。
7. 读取后校验 PNG，绝不把 candidate/root/path 暴露给脚本、IPC、status 或普通日志。

缺少 visionRoot 或目标文件归为 `vision-template-not-found`；存在但读取失败归为
`vision-template-read-failed`。

## PNG Contract

- 文件上限 `16 MiB`。
- 必须有标准 PNG signature；扩展名正确但 JPEG/其他内容仍拒绝。
- IHDR width/height 必须为正，且不超过固定视觉基准 `1920×1080`。
- Electron nativeImage 解码必须非 empty；decoder size 必须等于 IHDR；bitmap 长度必须等于
  `width * height * 4`。
- 上述失败统一为 `vision-template-invalid`。
- 模板大于当前 full image/ROI 时为 `vision-template-too-large`；不得作为正常 no-match/gone。
- v1 alpha 是普通匹配通道，不是透明蒙版；不进行隐式 resize/rotation。

## Ownership and Isolation

- 当前 scriptId 是归属边界；公开 API 没有 scriptId、package 或 root override。
- 相同 templateId 在两个脚本包中表示两个不同模板；一个脚本不能探测另一个包是否存在该 ID。
- 模板不属于 Profile 数据，可按脚本身份在进程内只读缓存并用于该脚本的多个 Profile run。
- screenshot、ROI、match result、query state 仍严格绑定当前 Profile/run，不能因模板 cache 共享。
- 模板不得复制到 `userData/automation-data`，不得网络下载、用户上传或第三方安装。

## Cache Contract

- 仅缓存完全校验并成功解码的 `DecodedVisionTemplate`。
- key 必须包含 registry package identity + templateId，不能只有 templateId。
- missing/read/decode/size failure 不缓存。
- registry 在本次进程启动内不可变，因此不做文件 watcher 或热重载。
- shutdown 清空内存 cache；没有持久 cache/index。

## Packaging Contract

- 继续使用 `package.json -> build.files -> automation-scripts/**`；不新增 `extraResources` 或第二套路径。
- 开发树与 Windows ASAR 的 `assets/vision/*.png` 文件清单和 SHA-256 必须一致。
- packaged smoke 必须从实际 ASAR 内已注册 packageRoot 解析并解码至少一个模板，使用同一 matcher
  得到与开发环境相同 rect/center/confidence。
- 模板缺失不能阻止其他脚本注册或应用启动；错误只影响当前 Vision action。

## Safe Diagnostics

允许：已校验的 `scriptId/templateId`、阶段、文件字节数、template/image/ROI 尺寸、耗时、稳定 code。

禁止：绝对/real path、PNG/bitmap、raw fs/nativeImage error、stack、跨包候选、用户 Profile 数据、
URL、Cookie、Session 或认证内容。
