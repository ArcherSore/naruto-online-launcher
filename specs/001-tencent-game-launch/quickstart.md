# Quickstart: 实现后的验证指南

## 前置条件

- Windows x64，Volta 可用；仓库根目录执行命令。
- Node.js `v16.20.2`、npm `8.19.4`、Electron `11.5.0`。
- 仓库内置 `flash/pepflashplayer.dll`，测试 QQ 账号和扫码设备。
- 准备两个独立 Profile（A/B）。采集证据时不得截图或复制二维码、Cookie、票据、QQ 号、完整 URL query。

## 自动检查

```powershell
node -v
npm -v
npx jest --runInBand --forceExit src/config/__tests__/urls.test.js src/app/__tests__/Launcher.test.js src/app/__tests__/TencentLaunchFlow.test.js src/profiles/__tests__/partition.test.js src/network/__tests__/inspector.test.js src/utils/__tests__/logger.test.js src/utils/__tests__/diagnostics.test.js src/ui/manager/__tests__/IpcRouter.test.js
$env:ESLINT_USE_FLAT_CONFIG='false'; npx eslint src/
npm test -- --runInBand
```

预期：

- 版本分别为 `v16.20.2`、`8.19.4`。
- 腾讯 URL/流程、Partition、脱敏和保留模块测试通过。
- 全量测试不再包含已删除 Oasis 行为的断言；任何既有 `GpuDetector.test.js` Windows 路径 mock 失败必须单独标记，不可误算为本 Feature 通过。
- 当前 `npm run lint` 在 PowerShell 使用 POSIX 环境变量语法，基线会失败；本 Feature 验证使用上面的 PowerShell 等价命令，不顺带修改该脚本。

## Windows E2E

所有规定矩阵都使用 `passed/attempted` 记录。某次失败不得通过覆盖记录或更换分母消失；必须修复后从该规定矩阵的第 1 次重新连续执行。

### 0. G0/G1/G2 运行时门

1. 先核对 G0/T007→T013→T014 证据：失败测试必须证明 inspector/诊断/IPC/日志不采集、保存、广播或记录完整 URL、query/fragment、Cookie、Set-Cookie、Authorization、JWT、ticket、QQ 身份字段、请求体、响应体、页面源码；实现后只允许 resource type、origin、pathname、status code、error code，未知字段默认拒绝。G0 未 PASS 时不得进行任何真实扫码、认证跳转或 Flash/CDN 观察。
2. G1 从第 1 轮开始，可用测试账号执行不计入任何 SC 成功率的发现扫码。该扫码的导航记录只允许 `role`、`origin`、`pathname`、`disposition`、`frame`；每轮只批准一个精确 `scheme/hostname/port/path` 或 popup disposition。页面探针发现另行只记录 selector 名称、存在性和安全 boolean/enum，不记录源码、表单值或身份数据。
3. 若发现只补充精确 host/path、已存在能力的 DOM selector、CDN 地址或具体兼容参数，更新 `research.md`、`plan.md`、相关契约和失败测试；若会改变产品需求、Feature 范围、安全边界、验收标准、成功率分母或增加用户能力，立即停止 Gate，先更新 `spec.md`，再同步 Plan、Tasks、契约，重新执行 Constitution Check 和文档一致性确认。同步完成前不得继续实现，也不得在代码中静默扩大范围或安全例外。
4. G1 每轮按上述规格同步分流后，添加并运行预期失败测试，实施一条精确规则，运行自动回归，再重新发现；最多 5 轮。认证链未闭合、导航无法解释、需要宽泛规则或规格同步未完成时停止并请求人工评审。
5. G1 必须覆盖认证子窗自身的 navigate、redirect、`new-window` 和二次 popup；官方流程未自然出现的事件由自动化测试或本地受控 fixture 验证通用 handler，人工腾讯流程记录有理由的 `N/A`，不得为了触发事件修改腾讯页面。完整链闭合后进入 G2，G2 PASS 后才执行本节场景 1 的正式 `3/3`。
6. G2 最多消耗 3 个修订轮次；一轮定义为“一次完整启动发现的一组阻塞事实，加上对应文档修订、失败测试、最小实现和自动回归”，每轮只处理阻塞当前完整游戏启动的新 SWF/CDN、mixed-content、policy、页面信号或安全 flag。G2 完整启动必须达到应用内游戏窗口、内容可见和一次鼠标响应；修订后连续 2 次完整启动无新的阻塞资源、DOM 信号或安全配置要求时 PASS，这两次稳定验证不额外消耗修订轮次。消耗第 3 个修订轮次后仍不稳定则停止并请求人工评审；G2 启动标记 non-SC，不计入正式 `3/3`。

### 1. 全新 Profile 扫码与选服

1. 分别创建 3 个相互独立的全新 Profile，确认应用 UI 没有 Oasis region/server、邮箱或密码字段。
2. 对每个 Profile 启动一次，确认内部窗口显示 `https://huoying.qq.com/server/website/` 和官方二维码入口。
3. 每次扫码并在官方流程完成确认/附加验证，手动选择可用区服。
4. 每次确认原应用窗口进入 `https://game.huoying.qq.com/main.html`；系统浏览器没有承载游戏，并逐次记录 `game_internal`、`content_visible`、`mouse_response`。

预期：流程状态按登录/选服、跳转、游戏加载变化；没有自动选择区服或自动点击进入。每个实例的三项字段全部 PASS 才计入 passed；SC-001、SC-002、SC-003 共用正式矩阵并均记录 `3/3`，外部浏览器承载游戏为 0 次。

### 2. Flash 可见与交互

1. 等待游戏页稳定，确认 Flash object/入口 SWF 实际出现。
2. 在游戏内容区域执行一次正常鼠标操作。

预期：内容可见且产生可观察响应。仅 URL 到达或 `did-finish-load` 不算通过；结果回填场景 1 同一正式矩阵的 `content_visible` 和 `mouse_response`。

### 3. 同 Profile 会话复用与失效

1. 对同一 Profile 正常关闭游戏窗并退出应用，再启动；确认腾讯仍认可会话时无需再次扫码，但仍由用户手动选服。连续执行 2 次。
2. 使用官方 logout、会话撤销或测试过期方式使同一 Profile 的 Session 失效，再重开/继续流程并确认返回扫码。重新准备失效条件后连续执行 2 次。

预期：有效 Session 复用 `2/2`；失效 Session 返回扫码 `2/2`。均记录 `passed/attempted`，不要求删除 Profile/Session，不触发 Oasis/API/JWT fallback。

### 4. 双 Profile 隔离

1. A/B 分别扫码两个测试账号并同时打开。
2. 关闭、重开、logout 和恢复 A；观察 B。
3. 对 A 执行关闭、重载、失效后重新扫码等恢复动作，再次观察 B。

预期：A/B 的 Cookie、页面、窗口和恢复计数互不变化；Partition 分别为 `persist:profile-A`/`persist:profile-B` 形式的不同值。

### 5. 未认证状态下登录 UI 加载失败

1. 使用没有有效 Session 的全新 Profile，在官方认证 UI 开始加载时用 DevTools Network Offline 或受控断网制造失败。
2. 记录阶段、可用动作和 Session 是否保留；恢复网络，使用 `REOPEN_AUTH`，必要时使用 `RETURN_TO_SELECTOR` 后重新触发认证。

预期：显示 `AUTH` 失败阶段；自动重开不超过 1 次，随后等待用户；动作成功触发且不清 Session。

### 6. 已认证状态下选服页加载失败

1. 使用已认证且 Session 有效的 Profile，在选服页加载/刷新时用 DevTools Network Offline 或受控断网制造失败。
2. 记录阶段、可用动作和 Session 是否保留；恢复网络，使用 `RELOAD_SELECTOR`。

预期：显示 `SELECTOR` 失败阶段；自动 reload 不超过 1 次，随后等待用户；有效 Session 被保留，不回退成未认证故障。

### 7. 游戏跳转失败

1. 已登录选服后，在点击进入游戏前临时断网。
2. 恢复网络，分别测试“重试”和“返回选服”。

预期：标识 `GAME_NAVIGATING` 失败；完整游戏 URL/参数不出现在错误页、日志或诊断包。

### 8. 游戏/SWF 加载失败与 renderer crash

1. 只阻断已脱敏确认的 SWF/CDN 路径或在加载期断网。
2. 触发一次 renderer crash/unresponsive 测试。

预期：只在游戏阶段启用 stall/crash 恢复；达到上限后停止；可 reload 游戏或返回选服；登录态不因自动恢复被清除。

### 9. popup、重定向与非核心外链

1. 观察扫码登录是否使用 iframe、同窗或 popup，并记录 host/path/disposition，不记录 query 值。
2. 检查认证子窗与父 Profile 使用同一 partition，且为 `plugins:false`、`nodeIntegration:false`、`contextIsolation:true`、`webSecurity:true`、`allowRunningInsecureContent:false`、`enableRemoteModule:false`、`webviewTag:false`，没有游戏窗口业务 preload。
3. 对官方流程自然出现的事件做人工记录；未自然出现的认证子窗 navigate、redirect、`new-window`、二次 popup 或游戏页新窗口通过自动化测试或本地受控 fixture 触发并验证通用 handler，人工场景记录有理由的 `N/A`，不得修改腾讯页面。另在受控测试中触发官方帮助/协议/客服链接和一个未知协议/host。

预期：认证 popup 使用上述固定安全策略；子窗所有后续导航继续精确分类，未知目标被阻止且 Session/恢复入口保留；游戏回原 PPAPI 窗口；非核心外链和未知目标均被阻止，不调用 `shell.openExternal`。全局 `no-sandbox` 仅记录为既有限制，本 Feature 不修改它。

### 10. 日志与诊断泄露检查

覆盖扫码、复用、失效和四类失败后，导出用户诊断并检查普通日志。

预期：只出现 Profile 非敏感标识、stage、resource type、origin/pathname、status/error code 和次数；不存在 QQ 密码、Cookie、Set-Cookie、Authorization、JWT、ticket、QQ 身份字段、完整 URL、query/fragment、请求体、响应体、页面源码或可复用登录材料。若保留 `network/inspector.js`，其输出也只能是上述安全元数据，未知字段默认拒绝。

### 11. 页面探针预算与静态安全审计

1. 对每个受信任顶层角色触发 `did-finish-load`，检查探针只在该事件后调用，每次顶层加载最多 1 次；计数以单次窗口 `LaunchFlow` 生命周期为作用域，每个 stage 最多 3 次、整个窗口流程最多 12 次，用户重新启动窗口后重置；单次 3 秒超时，且没有 timer/interval 无限轮询。
2. 制造探针超时/异常，确认不清 Session并保持当前安全状态。
3. 使用 `rg` 审计腾讯票据 parse/decode/decrypt/copy/extend/replay、腾讯认证 API 构造，以及 auto click/选服、automation IPC、handler、command queue；逐项人工排除仅测试名称、注释和安全拒绝断言。

预期：探针预算全部生效；静态审计不存在生产可达的禁止行为。任何命中必须解释并记录，不能仅凭字符串扫描自动判 PASS。

### 12. Windows portable

```powershell
npm run build:win
```

在干净 Windows x64 环境启动 portable 包，重复场景 1、2、3。预期内置 `pepflashplayer.dll` 被识别，PPAPI 可用；本 Feature 不以下载 fallback 代替内置 DLL 主路径验收。

## 运行时事实记录模板

G1 发现扫码只填写 `Role`、`Origin/Path`、`Disposition/Frame` 及 non-SC 轮次标记；不得填写或采集模板中的 Probe、错误消息、正式矩阵等其他字段。其他 Gate/验收才按需使用完整模板。

```text
Profile: <内部测试代号，不写 QQ 号>
Gate/Round/Attempt: <G1/G2/SC；轮次或 attempted 序号；发现/G2 稳定性启动标记 non-SC>
Stage/Event: <stage>/<event>
Role: SELECTOR | AUTH | GAME_MAIN | UNKNOWN
Origin/Path: <不含 query/fragment>
Disposition/Frame: <如有>
Probe: <仅经 DevTools 检查的 selector 名称 + exists=true/false 或安全 enum；如无则 N/A>
Result: PASS | FAIL；passed/attempted=<n>/<n>
Formal launch fields: game_internal=<PASS|FAIL> content_visible=<PASS|FAIL> mouse_response=<PASS|FAIL>
Session preserved: YES | NO | N/A
Safe error code/message: <无身份材料>
```

若官方页面结构、host 或 Flash 链路与契约不符，停止扩大 allowlist，保存上述脱敏证据并执行 G1/G2 的规格同步分流：技术事实更新 Research/Plan/契约和失败测试；需求、范围、安全边界、验收、分母或新用户能力变化则先停 Gate并完成 Spec→Plan/Tasks/契约→Constitution Check→一致性确认。
