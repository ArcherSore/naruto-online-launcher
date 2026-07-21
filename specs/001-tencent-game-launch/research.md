# Phase 0 Research: 腾讯国服扫码登录与游戏启动

## 证据范围

- 需求与约束：`spec.md`、Constitution 1.0.0、`AGENTS.md`。
- 仓库事实：实际读取 `Launcher`、`SessionLifecycle`、Profile/Partition、Oasis 登录/网络、Flash、UI/IPC、日志/诊断及相关测试；`docs/REPO_MAP.md` 仅用于定位。
- 外部事实（2026-07-20，只读、无认证）：腾讯选服页和游戏页响应头/HTML及其公开脚本。未采集或保存任何登录材料。
- 测试基线：Node 16.20.2、npm 8.19.4；相关 11 suites/374 tests 全通过。全量 Jest 为 37/38 suites、1223/1234 tests，通过外的 11 项均在 Windows 下的 `GpuDetector.test.js` Linux 路径 mock；Jest 还有未关闭句柄提示。
- Windows lint 基线：`npm run lint` 因 package script 使用 POSIX 前置环境变量语法而失败；PowerShell 等价命令 `$env:ESLINT_USE_FLAT_CONFIG='false'; npx eslint src/` 退出 0。该脚本兼容问题不在本 Feature 内顺带修复。

## Decision 1: 官方网页是唯一认证和选服入口

**Decision**: 新 Profile 直接加载 `https://huoying.qq.com/server/website/`，用户只在腾讯官方页面完成扫码、附加验证和区服选择；应用不调用登录 API、不构造区服登录请求、不读取票据值。

**Rationale**: 满足 FR-001 至 FR-005、FR-013。公开脚本确认选服页调用腾讯登录管理器和 `CommLoginApp.cgi`，服务端成功后生成 `gameurl`；website 渠道当前采用同页导航。

**Alternatives considered**:

- 复用 Oasis API/表单注入：拒绝，目标服务和票据完全不同，且违反官方扫码边界。
- 应用内重新实现腾讯服务器列表/登录 CGI：拒绝，超出 Spec，也会复制不稳定的官方逻辑。

## Decision 2: 复用 PPAPI 游戏窗，新增腾讯流程控制器

**Decision**: 保留游戏窗口的 BrowserWindow registry、`plugins: true`、业务 preload、安全隔离和关闭回调；把流程状态、顶层导航、popup 和恢复抽到一个 `TencentLaunchFlow`。认证子窗不复用游戏窗口业务 preload 或插件配置。`SessionLifecycle` 只保留通用窗口/renderer 生命周期。

**Rationale**: 当前窗口和 Flash boot 已形成稳定边界；现有 `SessionLifecycle` 同时承载 Oasis 登录、注入、JWT、导航和恢复，继续叠加会扩大跨模块副作用。

**Alternatives considered**:

- 重写整个 Launcher：拒绝，会丢弃已经测试的 registry、MemoryGuard 和 PPAPI 窗口能力。
- 继续扩充单个 SessionLifecycle：拒绝，难以证明认证、窗口和恢复职责边界。

## Decision 3: 每个 Profile 固定使用持久 Partition

**Decision**: 腾讯流程只使用 `persist:profile-<id>`。登录 Cookie/Storage 由 Chromium 原生持久化；G3 只证明腾讯路径不调用 shadow snapshot/restore，并保持旧 API 不可达。在 Phase 6 完成全量调用者审计前，不删除旧 API 或实现；只有审计证明零调用者后才随清理任务删除 shadow Cookie JSON 能力。

**Rationale**: 满足 FR-008 至 FR-011、FR-020；避免 shadow restore 未 await 的竞态、Oasis 域过滤错误和认证 Cookie 明文复制。

**Alternatives considered**:

- 把 snapshot 域改成 `qq.com`：拒绝，仍会复制可复用票据，且无法可靠枚举 Cookie/Storage。
- 使用 `defaultSession`：拒绝，Profile 会串号。
- 每次启动清 Cookie：拒绝，破坏有效会话复用。

## Decision 4: 尊重腾讯会话有效期，不续期或自动清理

**Decision**: 删除 Oasis Cookie 延寿、Secure 降级、JWT 续期和 F5“清存储+密码预登录”。普通 reload、stall 和失败恢复保留当前 Session。会话是否有效以官方页面/服务端行为为准。

**Rationale**: 满足 FR-010、FR-011、FR-013；Cookie 客户端过期时间不等于服务端认可，应用不得自行延长或恢复票据。

**Alternatives considered**:

- 延长腾讯 Cookie：拒绝，可能弱化官方失效策略。
- 检查或解码腾讯票据：拒绝，不需要且增加泄露面。
- 失败即清整个 Partition：拒绝，会把网络/Flash 错误误判成认证错误。

## Decision 5: 精确导航角色和受控弹窗

**Decision**: 使用 `URL` 解析后的 scheme、hostname、port、pathname 做角色分类。选服和游戏主链始终留在应用内；认证 popup 如经实测需要，使用父 Profile 同一 partition，并固定 `plugins:false`、`nodeIntegration:false`、`contextIsolation:true`、`webSecurity:true`、`allowRunningInsecureContent:false`、`enableRemoteModule:false`、`webviewTag:false`，不加载游戏窗口业务 preload。认证子窗自身的 navigate、redirect、`new-window` 和二次 popup 递归进入相同精确分类器；未知目标阻止并保持可恢复状态。帮助、协议、客服等非核心外链也默认阻止，本 Feature 不实现 `shell.openExternal` allowlist。

**Rationale**: 当前 substring 规则会错误信任仿冒 host，并把腾讯游戏链接送外部浏览器。Electron 11 使用旧 `new-window` 事件，必须按当前 API 实现。

**Alternatives considered**:

- 所有 http(s) 都在游戏窗口打开：拒绝，会把不可信页面放进 `webSecurity: false` + PPAPI 窗口。
- 所有 popup 都交系统浏览器：拒绝，可能拆散扫码 Session 或把游戏交给外部浏览器。

**G1 发现结论的形成方式**: 认证导航采用最多 5 轮的有界循环。允许用测试账号执行不计入 SC 成功率的发现扫码；该扫码的导航证据只能包含 `role`、`origin`、`pathname`、`disposition`、`frame`。每轮只依据脱敏 Windows/Electron 11 实测批准一个精确 `scheme/hostname/port/path` 元组或一个 popup disposition；随后依次更新本研究、`plan.md` 和导航契约，添加并运行预期失败测试，实施该条精确规则，运行自动回归，再重新发现下一跳。达到 5 轮、出现无法解释的导航，或必须依赖通配、hostname suffix/substring、宽泛 path/port 才能继续时，G1 停止并请求人工评审。父窗与认证子窗的完整认证链闭合前不得执行正式 `3/3` 验收。

**既有 sandbox 限制**: `src/main/flags.js` 为 PPAPI 设置全局 `no-sandbox`、`disable-gpu-sandbox`、`disable-setuid-sandbox`。本 Feature 不顺带改变这组全局策略；补偿边界是认证子窗禁用插件、remote module、webview 和业务 preload，启用 `webSecurity`、禁止 insecure content，并对其全部后续导航/弹窗递归精确分类。该记录不把全局 no-sandbox 解释为认证子窗放宽授权。

## Decision 6: 不默认修改腾讯网络与响应

**Decision**: 移除 Oasis blocker、`logintype` 重写、`crossdomain.xml` 全局阻断、Cookie/CSP 改写。腾讯子资源按网页原始行为加载；仅在运行时证据证明必要且不触碰认证时，才加入最小网络规则。G2 的一个修订轮次定义为“一次完整启动发现的一组阻塞事实，加上对应文档修订、失败测试、最小实现和自动回归”；最多消耗 3 个修订轮次，每轮只处理阻塞当前完整游戏启动场景的新 SWF/CDN、mixed-content、policy、页面信号或安全 flag。“完整启动”要求内部游戏窗口、内容可见和一次鼠标响应均成立，但 G2 启动仍标记 non-SC。完成修订后，连续 2 次完整启动未出现新的阻塞资源、DOM 信号或安全配置要求时 G2 PASS，这两次稳定验证不额外消耗修订轮次；消耗第 3 个修订轮次后仍不稳定则停止并请求人工评审。

**Rationale**: Flash 可能需要 policy 文件；当前 cookies 模块会把游戏 Cookie 延到一年并设 `secure:false`；多个 `onBeforeRequest` 处理器还可能互相覆盖。

**Alternatives considered**:

- 直接把旧域名替换成腾讯域名：拒绝，旧规则语义是 Oasis 特有的。
- 保留宽松 CSP 覆盖作为“兼容保险”：拒绝，尚无证据证明腾讯 PPAPI 需要，且会扩大脚本能力。

G2 不接受通配网络规则、宽泛 allowlist 或静默关闭/削弱安全能力作为通过条件；若最小精确规则无法解释或验证，Gate 保持阻塞并请求人工评审。

## Decision 7: 显式状态机与有界恢复

**Decision**: 以 selector/auth/game-navigation/game-loading/game-ready 分阶段；每阶段最多一次自动 reload 或既有有界 crash/stall 重试，达到上限后等待用户从固定 allowlist 选择 `RELOAD_SELECTOR`、`REOPEN_AUTH`、`RETRY_GAME_NAVIGATION`、`RELOAD_GAME` 或 `RETURN_TO_SELECTOR`。动作只在契约规定阶段出现，游戏导航 URL 只在当前窗口流程内存中存活，所有恢复均不清 Session。

**Rationale**: 满足 FR-015 至 FR-019。当前失败页只知道通用 load 失败，stall 在选服等待时也可能误触并清 Cookie。

**Alternatives considered**:

- 固定时间循环刷新：拒绝，会导致无限刷新并可能反复触发风控。
- URL 到达即判成功：拒绝，不满足 Flash 可见和鼠标可交互的 SC-003。

## Decision 8: 诊断默认最小化并在源头脱敏

**Decision**: 日志只接受 Profile 非敏感标识、stage、event、origin/pathname、错误码和次数。在任何真实扫码、认证跳转或 Flash/CDN 观察前，先以失败测试证明 `network/inspector.js`、诊断、IPC 广播和普通日志不得采集、保存、广播或记录完整 URL、query/fragment、Cookie、Set-Cookie、Authorization、JWT、ticket、QQ 身份字段、请求体、响应体或页面源码，再将观察字段收敛到 resource type、origin、pathname、status code、error code 的 allowlist，未知字段默认拒绝。该安全处置是 G1/G2 的硬前置；Phase 6 只按本 Feature 的当前用途决定保留这套安全元数据观察能力，或在确认无当前用途后删除，不得到 Phase 6 才首次处理敏感捕获，也不得以未来自动化作为保留理由。诊断导出使用字段 allowlist，不依赖事后 token regex。

**Rationale**: 当前 inspector 保存完整 URL/JWT，cookie debug IPC返回值，logger 无集中脱敏，而诊断 regex 不能覆盖 JWT/base64url 或腾讯票据。

**Alternatives considered**:

- 只在导出时正则清理：拒绝，敏感材料已经进入普通日志或内存 UI。
- 用 token 哈希跟踪：本 Feature 不需要身份关联，默认不收集更简单安全。

## Decision 9: 测试分层

**Decision**: URL/状态机/路由/Session/脱敏用 Jest；真实二维码、重定向、Cookie 持久化、双 Profile、Windows portable 和 PPAPI 鼠标交互用可重复人工 E2E。官方流程未自然出现的 popup、二次 popup 或 redirect 事件使用自动化测试或本地受控 fixture 验证通用 handler，人工腾讯流程记录有理由的 `N/A`，不得为了触发事件修改腾讯页面。初始页面探针只定义接口、boolean/enum 返回类型、数据禁区和明确预算：只在受信任页面 `did-finish-load` 后调用，每次受信任顶层加载最多 1 次；计数以单次窗口 `LaunchFlow` 生命周期为作用域，每个 stage 最多 3 次、整个窗口流程最多 12 次，用户重新启动窗口后重置；单次超时 3 秒，不使用定时无限轮询，失败不清 Session并保持当前安全状态。生产 selector 集合初始为空，不根据静态页面或经验猜测腾讯 selector。Windows 发现阶段由人工 DevTools 检查，只记录 selector 名称、存在性和安全布尔结果；经验证并更新研究/契约后，先写失败测试，再把 selector 加入生产规则。

**Rationale**: 当前 Electron 完全 mock，无法证明 Chromium 87、腾讯服务或 Flash 行为；但纯逻辑可稳定自动化。

**Alternatives considered**:

- 用大量 mock 声称 E2E 完成：拒绝，不能覆盖第三方页面和 PPAPI。
- 自动扫码：拒绝，超范围且违反认证边界。

**验收分母**: G1 测试账号发现扫码不计入 SC。G1/G2 PASS 后，全新 Profile 扫码并进入游戏连续 3 次；有效区服进入内部游戏窗口使用同一组三次正式启动；每个实例必须同时记录 `game_internal`、`content_visible`、`mouse_response`，三项全 PASS 才计入 passed。有效 Session 跨重启复用连续 2 次；失效 Session 返回扫码连续 2 次。每组记录 `passed/attempted`，规定矩阵必须全部通过。

## 运行时验证项

- Chromium 87 下官方扫码的 iframe/popup/redirect 角色与精确顶层 host；按 G1 最多 5 轮逐跳闭合。
- 扫码选服后的参数名称、最终 `game.huoying.qq.com/main.html` 导航和游戏页失效回退。
- 官方 Cookie/Storage 是否在 persist Partition 跨重启复用，以及双 Profile 完整隔离。
- 入口 SWF/CDN、mixed content、policy 文件、经 DevTools 验证的页面信号和最小 BrowserWindow 安全 flags；按 G2 文档→失败测试→最小实现→回归→重跑闭环验证。
- Windows portable 内置 DLL 与缺失时 `.7z` fallback。

上述事实均有保守默认：不认识的顶层导航和非核心外链阻止并可返回选服；不认识的会话状态不清 Cookie；Flash 未可交互不宣告成功。运行时发现若只补充技术事实（精确 host/path、既有能力的 DOM selector、CDN 地址或具体兼容参数），先更新本研究、Plan、相关契约和失败测试即可；若会改变产品需求、Feature 范围、安全边界、验收标准、成功率分母或增加用户能力，必须停止当前 Gate，先更新 `spec.md`，再同步 Plan、Tasks 和契约，重新执行 Constitution Check 并完成一致性确认后才能继续。任何分支都不得在代码中静默扩大范围或安全例外。
