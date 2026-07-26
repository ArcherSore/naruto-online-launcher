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

**Decision**: 腾讯流程只使用 `persist:profile-<id>`。登录 Cookie/Storage 由 Chromium 原生 Session/Partition 管理；G3 只证明同一 Electron 主进程内关闭并重开同一 Profile 游戏窗口时复用该隔离 Session、腾讯路径不调用 shadow snapshot/restore，并保持旧 API 不可达。在 Phase 6 完成全量调用者审计前，不删除旧 API 或实现；只有审计证明零调用者后才随清理任务删除 shadow Cookie JSON 能力。

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

**Decision**: 生产日志只接受 Profile 非敏感标识、stage、event、origin/pathname、错误码和次数。在任何真实扫码、认证跳转或 Flash/CDN 观察前，先以失败测试证明 `network/inspector.js`、诊断、IPC 广播和普通日志不得持久采集、保存、广播或记录完整 URL、query/fragment、Cookie、Set-Cookie、Authorization、JWT、ticket、QQ 身份字段、请求体、响应体或页面源码，再将常规观察字段收敛到 resource type、origin、pathname、status code、error code 的 allowlist，未知字段默认拒绝。该安全处置是 G1/G2 的硬前置；Phase 6 只按本 Feature 的当前用途决定保留这套安全元数据观察能力，或在确认无当前用途后删除。诊断导出使用字段 allowlist，不依赖事后 token regex。若这些信号不足，用户可以针对具体故障明确授权当前本地会话内的临时只读诊断；它与生产 inspector 分离，限定指定 Profile、最短时限和必要页面/Session 数据，原始值不进入文件、日志、IPC、截图或诊断包，定位后立即丢弃。

**Rationale**: 当前 inspector 保存完整 URL/JWT，cookie debug IPC返回值，logger 无集中脱敏，而诊断 regex 不能覆盖 JWT/base64url 或腾讯票据。

**Alternatives considered**:

- 只在导出时正则清理：拒绝，敏感材料已经进入普通日志或内存 UI。
- 用 token 哈希跟踪：本 Feature 不需要身份关联，默认不收集更简单安全。

## Decision 9: 测试分层

**Decision**: URL/状态机/路由/Session/脱敏用 Jest；真实二维码、重定向、同进程 Session 复用、双 Profile、Windows portable 和 PPAPI 鼠标交互用可重复人工 E2E。官方流程未自然出现的 popup、二次 popup 或 redirect 事件使用自动化测试或本地受控 fixture 验证通用 handler，人工腾讯流程记录有理由的 `N/A`，不得为了触发事件修改腾讯页面。初始页面探针只定义接口、boolean/enum 返回类型、数据禁区和明确预算：只在受信任页面 `did-finish-load` 后调用，每次受信任顶层加载最多 1 次；计数以单次窗口 `LaunchFlow` 生命周期为作用域，每个 stage 最多 3 次、整个窗口流程最多 12 次，用户重新启动窗口后重置；单次超时 3 秒，不使用定时无限轮询，失败不清 Session并保持当前安全状态。生产 selector 集合在首次 Windows 验证前为空，不根据静态页面或经验猜测腾讯 selector。Windows 发现阶段由人工 DevTools 检查，只记录 selector 名称、存在性和安全布尔结果；经验证并更新研究/契约后，先写失败测试，再把 selector 加入生产规则。

**Rationale**: 当前 Electron 完全 mock，无法证明 Chromium 87、腾讯服务或 Flash 行为；但纯逻辑可稳定自动化。

**Alternatives considered**:

- 用大量 mock 声称 E2E 完成：拒绝，不能覆盖第三方页面和 PPAPI。
- 自动扫码：拒绝，超范围且违反认证边界。

**验收分母**: G1 测试账号发现扫码不计入 SC。G1/G2 PASS 后，全新 Profile 扫码并进入游戏连续 3 次；有效区服进入内部游戏窗口使用同一组三次正式启动；每个实例必须同时记录 `game_internal`、`content_visible`、`mouse_response`，三项全 PASS 才计入 passed。Electron 主进程保持运行时，同一 Profile 关闭并重开游戏窗口后的有效 Session 复用连续 2 次；失效 Session 返回扫码连续 2 次。每组记录 `passed/attempted`，规定矩阵必须全部通过。

## Decision 10: G3a 以同一主进程内的 Session 复用为验收边界

**Decision**: 经 2026-07-25 Windows/Electron 11.5.0 实测并由用户确认，SC-004/T041 不再要求完整退出 Electron 主进程后免扫码。正式矩阵要求 Electron 主进程持续运行，仅关闭并重开同一 Profile 的游戏窗口；腾讯仍认可会话时连续 `2/2` 无需扫码、仍由用户手动选服。完整进程退出后再次扫码不计入该矩阵。

**Rationale**: 同进程对照已证明同一 Profile 的隔离 Session 可被游戏窗口复用；完整退出后官方再次要求扫码。Electron Cookies 文档说明无 `expirationDate` 的 Cookie 是 session Cookie、不会跨应用会话保留，Electron v11.5.0 的 `network_context_service.cc` 又明确设置 `restore_old_session_cookies=false`、`persist_session_cookies=false`。`flushStore()` 不改变这种生命周期语义。

**Sources**:

- <https://www.electronjs.org/docs/latest/api/cookies>
- <https://github.com/electron/electron/blob/v11.5.0/shell/browser/net/network_context_service.cc>
- <https://github.com/electron/electron/issues/9995>

**Alternatives considered**:

- 读取并复制 session Cookie、添加过期时间、恢复 shadow snapshot 或重放票据：拒绝，违反 FR-013。
- 升级/补丁 Electron 运行时：拒绝，违反冻结的 Electron 11.5.0/PPAPI 基线并扩大 Feature 范围。
- 保持完整进程重启为验收要求：拒绝，当前运行时公开语义不支持，用户已选择同进程窗口重开口径。

## 运行时验证项

- Chromium 87 下官方扫码的 iframe/popup/redirect 角色与精确顶层 host；按 G1 最多 5 轮逐跳闭合。
- 扫码选服后的参数名称、最终 `game.huoying.qq.com/main.html` 导航和游戏页失效回退。
- 同一 Electron 主进程内关闭并重开游戏窗口时官方 Session 是否连续 `2/2` 复用，以及双 Profile 完整隔离；完整进程退出后的免扫码不属于验收。
- 入口 SWF/CDN、mixed content、policy 文件、经 DevTools 验证的页面信号和最小 BrowserWindow 安全 flags；按 G2 文档→失败测试→最小实现→回归→重跑闭环验证。
- Windows portable 内置 DLL 与缺失时 `.7z` fallback。

上述事实均有保守默认：不认识的顶层导航和非核心外链阻止并可返回选服；不认识的会话状态不清 Cookie；Flash 未可交互不宣告成功。运行时发现若只补充技术事实（精确 host/path、既有能力的 DOM selector、CDN 地址或具体兼容参数），先更新本研究、Plan、相关契约和失败测试即可；若会改变产品需求、Feature 范围、安全边界、验收标准、成功率分母或增加用户能力，必须停止当前 Gate，先更新 `spec.md`，再同步 Plan、Tasks 和契约，重新执行 Constitution Check 并完成一致性确认后才能继续。任何分支都不得在代码中静默扩大范围或安全例外。

## G1 Windows/Electron 11 运行时确认（2026-07-25）

T027-T028 使用内部代号为 `test` 的测试 Profile 完成 non-SC 发现：

- `https://huoying.qq.com:443/server/website/` 在父游戏窗口稳定加载；
- 腾讯官方扫码 UI 在现有页面中自然显示；扫码成功后仍在该 SELECTOR 页面显示服务器选择界面；
- 自然流程未创建认证子窗，也未出现顶层 AUTH navigate、redirect、`new-window` 或二次 popup；这些人工项按契约记为有理由的 `N/A`，通用 handler 由 T016 自动化/本地受控 fixture 覆盖；
- 用户手动选择区服并点击进入游戏后，既有 `https://game.huoying.qq.com:443/main.html` 角色在应用内部承载，没有交给系统浏览器；
- 全过程未出现新的 UNKNOWN 顶层目标，因此不新增 AUTH host/path、popup disposition、DOM selector 或网络安全例外。

首次发现运行暴露一个本地生命周期缺陷：同一 BrowserWindow 的重复 `ready-to-show` 会重复执行 `TencentLaunchFlow.start()`，造成 SELECTOR 循环重载和页面闪烁。修复采用窗口级一次性门闩，并以 Red→Green 测试证明同一窗口只启动一次流程；该修复不改变导航契约或 Session。

上述结果确认既有 SELECTOR/GAME_MAIN 精确元组，不形成新的产品需求、范围、安全边界、验收标准或用户能力，因此无需修改 Feature Spec，也无需新增 allowlist 失败测试或实现规则。

## T056 嵌入式登录 UI selector 确认（2026-07-25 至 2026-07-26）

初次 Elements 发现只提交了二维码子文档内 selector
`#qr_area > span.qrlogin_img_out`。2026-07-26 Windows 实测证明：二维码可见时，在 DevTools
Console `top` execution context 执行该 selector 的存在性判断返回 `false`，因此它位于子
frame，不能作为顶层生产探针。

随后人工把 `#ptlogin_iframe` 当作顶层候选，并报告二维码状态
`exists=true/visible=true`、选服状态 `false/false`。生产实现据此先后尝试立即查询和
2500ms observer，但两次真实 Windows 重启均在二维码可见时返回
`SELECTOR_READY`，证明该候选的 execution context 判断不可靠。

Constitution 2.0.0 生效且用户明确授权后，Codex 通过仅绑定本机的 CDP 直接读取同一测试
Profile 的顶层页面源码和 frame tree，得到闭合事实：

| 层级 | 脱敏结构事实 |
| --- | --- |
| 顶层 `huoying.qq.com/server/website/` | `document.readyState=complete`；存在且可见的登录节点为 `.qConnectLogin iframe.loginframe` |
| 第一层跨域 frame | 腾讯 OAuth 页面 |
| 第二层跨域 frame | QQ 登录页面；`#ptlogin_iframe` 属于该子 frame 链，不在顶层文档 |
| 管理页 | 同时仍显示 `SELECTOR_READY` 对应的“等待扫码或手动选服” |

顶层授权源码确认登录 iframe 的稳定结构是：

```html
<div class="qConnectLogin">
  <!-- cover/content -->
  <iframe class="loginframe" ...></iframe>
</div>
```

原始 `src` query、页面文本和任何可能的认证值不写入本研究；诊断结束后只保留上述结构事实。

**Decision**: 生产 selector 改为顶层精确 `.qConnectLogin iframe.loginframe`。脚本仍只检查
该节点的存在性与顶层可见性（`getClientRects()`、`display`、`visibility`），最终只返回
`loginUiVisible` 布尔值；不进入跨域子 frame。保留单次 probe 内 2500ms observer 作为有界
时序容错，但它不再是根因修复。`true` 映射为 `AUTHENTICATING`，`false` 映射为
`SELECTOR_READY`；异常或超时保持现有安全恢复契约。所有分支不清 Session、不自动循环。

这是对既有页面状态探针的真实结构修正，不增加生产敏感数据采集；授权诊断边界已经同步到
Feature Spec、Plan、Data Model、Contract、Quickstart 和 Tasks。

## T056 管理卡片降级决定（2026-07-26）

真实 `electron-log` 证明 DevTools Offline/刷新在部分运行中只产生一次顶层
`did-fail-load(-106)`；第一次事件被一次自动恢复消耗后，Chromium 可能由缓存继续承载页面，
既不产生第二次失败，也不形成可稳定判定的失败终态。追加超时收敛仍未满足用户对真实行为的
预期，用户最终决定撤销该功能。

**Decision**:

- 撤销认证自动恢复后的超时失败收敛；
- 管理卡片不再显示 `LaunchFlowState` 阶段说明或动态恢复按钮；
- 未启动主按钮文案改为“打开”；
- 运行中常态显示“刷新”，通过 Profile ID 由主进程窗口 registry 委托所属
  `LaunchFlow.reloadCurrentRole()`，与 F5 共用安全角色分类；
- 后台状态机、有界自动恢复、脱敏诊断和 Session 隔离继续保留，不接受 renderer 提交 URL，
  不清 Cookie/Storage。

该决定改变用户可见恢复要求和 SC-006 记录字段，已先同步 Spec、Plan、Tasks、Data Model、
Navigation Contract 与 Quickstart，再进入测试和实现。
