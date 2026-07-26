# Navigation Contract: 腾讯登录、选服与游戏窗口

## 目的

约束游戏 BrowserWindow、认证子窗、系统浏览器和流程状态之间的边界。该契约面向 Electron 11 的 `will-navigate`、`new-window`、redirect、load/crash 事件，不定义腾讯票据格式。

## 已知入口角色

| 角色 | 精确入口 | 承载位置 |
| --- | --- | --- |
| `SELECTOR` | `https://huoying.qq.com/server/website/` | Profile 游戏 BrowserWindow |
| `GAME_MAIN` | `https://game.huoying.qq.com/main.html` | 同一支持 PPAPI 的游戏 BrowserWindow |
| `AUTH` | 仅限 Windows/Electron 11 实测确认的腾讯官方顶层登录 host/path | 同一 Partition 的受控子窗或原页面 |
| `UNKNOWN` | 其余顶层目标、非 http(s) 以及帮助/协议/客服等非核心外链 | 阻止并显示恢复状态；不交系统浏览器 |

host 判断必须比较标准化后的完整 hostname，不能使用 `includes('qq')`、`includes('huoying')` 等 substring。默认端口以外的端口视为不同目标。

## 导航规则

1. `SELECTOR` 页面允许在原游戏窗口加载和刷新。
2. 从官方页面产生的 `GAME_MAIN` 导航，不论同页还是 `new-window`，都必须进入原 PPAPI 游戏窗口；不得调用 `shell.openExternal`。
3. `AUTH` popup 必须 `preventDefault` 后由应用创建受控子窗；子窗显式使用父 Profile 的同一 `partition`，固定 `plugins:false`、`nodeIntegration:false`、`contextIsolation:true`、`webSecurity:true`、`allowRunningInsecureContent:false`、`enableRemoteModule:false`、`webviewTag:false`，且不加载游戏窗口业务 preload。关闭后父窗仍停留官方流程。
4. 认证子窗自身的 navigate、redirect、`new-window` 和二次 popup 必须再次经过同一精确 scheme/hostname/port/path 分类；不得因来源已是 AUTH 而继承信任。UNKNOWN 必须 `preventDefault`、保持父 Profile Session和可恢复状态，二次 AUTH popup 仍受“同时最多一个认证子窗”和相同安全配置约束。
5. 认证 host/path 必须来自脱敏实测并形成精确 allowlist；发现未知目标时不动态放宽，只产生 `BLOCKED_NAVIGATION` 和“返回选服/重试登录”。
6. 帮助、协议、客服等非核心外链默认归类为 `UNKNOWN` 并阻止。本 Feature 不实现 `shell.openExternal` allowlist；游戏、登录确认、选服或 Session 恢复所需页面也不得交系统浏览器。
7. 不限制腾讯页面的普通子资源到顶层导航 allowlist；网络层默认不重写 Cookie/CSP、认证请求或 Flash policy。
8. 完整 URL 可以短暂交给 `loadURL`，但不得持久化、广播给管理 renderer、写入日志或错误页。可观测位置只保留 `origin + pathname`。
9. `src/main/flags.js` 的全局 `no-sandbox`/GPU sandbox 禁用项属于 PPAPI 既有限制，本 Feature 不修改；本节认证子窗隔离、递归分类和最小数据面是补偿边界，不得据此放宽任一子窗选项。

## Session 生命周期边界

1. `profileId -> persist:profile-<id>` 是唯一映射；同一 Electron 主进程内关闭游戏窗口时，只销毁该窗口、认证子窗、内存游戏 URL 和 `LaunchFlowState`，不得清理所属 Partition 的 Cookie/Storage。
2. 同一主进程内重开相同 Profile 必须重新取得同一个 Partition/Session；腾讯官方仍认可会话时直接到官方选服流程，仍由用户手动选服，不得自动进入游戏。
3. 完整退出 Electron 主进程后不保证免扫码。Electron 11 不恢复官方 session Cookie；再次启动后的状态由腾讯官方和 Chromium 原生持久数据决定，不计入 SC-004/T041。
4. 不得为跨进程免扫码读取 Cookie 值、把 session Cookie 改为 persistent、添加/延长过期时间、恢复 shadow snapshot、构造认证 API 或重放票据。
5. 会话失效时不得删除 Profile/Session 数据；让官方页面返回认证入口，并按 `SESSION_REJECTED`/`AUTHENTICATING` 状态与恢复契约继续。

## 事件到状态

| Electron/流程事件 | 条件 | 状态/动作 |
| --- | --- | --- |
| `ready-to-show` | 本地 loading 页 | 显示窗口，进入 `SELECTOR_LOADING`，加载 SELECTOR。 |
| `did-finish-load` | SELECTOR | 先保持 `SELECTOR_LOADING` 并运行最小探针；登录 UI 存在则 `AUTHENTICATING`，不存在则 `SELECTOR_READY`。 |
| `new-window` | AUTH | 创建共享 Partition 的认证子窗，进入 `AUTHENTICATING`。 |
| AUTH 子窗 navigate/redirect/`new-window`/二次 popup | 已批准 AUTH 或回 SELECTOR | 递归精确分类并使用同一安全子窗策略；不加载游戏 preload。 |
| AUTH 子窗 navigate/redirect/`new-window`/二次 popup | UNKNOWN | 阻止，保持 Session，进入可恢复的 `BLOCKED_NAVIGATION`。 |
| `will-navigate` / redirect | GAME_MAIN | 进入 `GAME_NAVIGATING`，继续在当前 PPAPI 窗口。 |
| `did-finish-load` | GAME_MAIN | 进入 `GAME_LOADING`；启用仅游戏阶段的 stall/SWF 观察。 |
| 页面探针 | 腾讯 Flash 容器/对象出现 | `GAME_READY` 候选；仍需人工确认可见和鼠标响应。 |
| 顶层导航 | 回到 SELECTOR/AUTH | 视为官方要求重新认证，更新为 `SESSION_REJECTED` 或 `AUTHENTICATING`，不是 Flash 错误。 |
| `did-fail-load` | 未认证且 AUTH UI 加载失败 | 进入 `AUTH_FAILED`；只提供 `REOPEN_AUTH`/`RETURN_TO_SELECTOR`，记录 Session 保留。 |
| `did-fail-load` | 已认证且 SELECTOR 加载失败 | 进入 `SELECTOR_FAILED`；只提供 `RELOAD_SELECTOR`，记录 Session 保留。 |
| `did-fail-load` | GAME_MAIN 导航或加载失败 | 进入对应 `NAVIGATION_FAILED`/`GAME_FAILED`；消耗该阶段有限次数并保留 Session。 |
| `render-process-gone` | 可恢复且未超限 | 仅 reload 当前安全角色；超限后等待用户。 |
| `new-window` / navigate | UNKNOWN | 阻止，`BLOCKED_NAVIGATION`，提供返回选服。 |

## 页面探针约束

- 初始实现只提供探针接口、boolean/enum 返回类型、数据禁区、失败行为和有限调用/重试约束；生产 selector registry 在 Windows 验证前为空，不预先猜测腾讯 DOM selector。
- 2026-07-26 Windows/Electron 11 顶层 Console 证明初次候选
  `#qr_area > span.qrlogin_img_out` 位于子 frame。后续人工把 `#ptlogin_iframe` 误认为顶层
  selector；立即查询和 2500ms observer 两版均在二维码可见时返回 false。
- Constitution 2.0.0 下的用户授权本机 CDP 诊断直接确认：顶层登录 UI 为
  `.qConnectLogin iframe.loginframe`；`#ptlogin_iframe` 位于 OAuth/QQ 登录的两层跨域
  frame 链，不在顶层文档。生产 registry 只批准前者。
- 生产探针只允许对固定 `.qConnectLogin iframe.loginframe` 检查
  `document.querySelector`、`getClientRects()`、顶层 `display` 与 `visibility`，并只返回
  `loginUiVisible` 布尔值；不得进入跨域子文档。
- 单次 probe 保留最多 2500ms 的有界 observer 作为时序容错；成功或到期均 disconnect 并
  清理 timer，外层 3000ms 预算继续兜底。不得使用 interval 或无界 observer。
- 探针只在受信任顶层页面 `did-finish-load` 后调用；每次受信任顶层页面加载最多 1 次。计数以单次窗口 `LaunchFlow` 生命周期为作用域，每个 stage 累计最多 3 次、整个窗口流程累计最多 12 次，用户重新启动窗口后重置；单次必须在 3 秒超时，不得使用 timer/interval 做无限轮询。
- 常规 Windows 发现只记录 selector、存在性和安全 boolean/enum。若这些信号不足且用户对具体
  故障明确授权，可启动临时本地只读诊断，检查必要的页面 DOM/HTML、frame、表单、完整 URL、
  Cookie/Storage、身份或 Session 参数；范围必须限定当前会话、指定测试 Profile 和最短时限。
- 候选 selector 经验证后，必须先更新 `research.md` 和本契约，再添加并运行预期失败测试；只有之后才能加入生产 selector registry。
- 探针只可返回安全布尔/枚举，例如登录 UI 是否可见、选服容器是否存在、Flash 容器/对象是否出现；具体 selector 必须来自上述验证顺序。
- 常驻生产探针不读取 Cookie、localStorage 值、表单值、身份、票据、页面 HTML 或游戏数据。
  授权诊断不得读取 QQ 密码，不得修改认证状态、跨 Profile 访问、复制/延长/重放票据，也不得
  把原始值写入仓库、日志、截图、IPC 或诊断包；定位完成后立即停止并丢弃。
- SELECTOR 页探针结果为 `loginUiVisible=true` 时进入 `AUTHENTICATING`，为 `false` 时进入 `SELECTOR_READY`。首次探针失败保持 `SELECTOR_LOADING`；已识别嵌入式登录 UI 后，同一 SELECTOR reload 在新探针完成前保持 `AUTHENTICATING`，从而让加载失败映射为 `AUTH_FAILED`。探针失败不得触发清 Session，允许用户看到官方页面且不自动循环。

## G0 安全网络观察硬门

1. 在任何真实扫码、认证跳转或 Flash/CDN 观察前，必须先为现有生产
   `network/inspector.js`、诊断路径、IPC 广播和普通日志添加并运行预期失败测试，证明它们
   不得持久采集、保存、广播或写入日志：完整 URL、query、fragment、Cookie、Set-Cookie、
   Authorization、JWT、ticket、QQ 身份字段、请求体、响应体、页面源码。该门不禁止符合
   FR-013/FR-014 的一次性用户授权本地诊断。
2. G0 的最小实现只允许 resource type、origin、pathname、status code、error code 进入网络观察事件；字段 allowlist 在源头执行，未知字段默认拒绝，不得依赖导出时或日志末端再脱敏。
3. 上述失败测试转绿并完成受影响回归后 G0 才 PASS；G0 PASS 是 G1 和 G2 的共同前置条件。Phase 6 只决定保留这套安全元数据能力，或在证明本 Feature 无当前用途后删除，不负责首次消除敏感捕获。

## Runtime Gate 规格同步规则

1. 若运行时发现只补充技术事实，例如精确 host/path、既有能力的 DOM selector、CDN 地址或具体兼容参数，则更新 `research.md`、`plan.md`、相关契约和预期失败测试即可，随后按所属 Gate 的有界循环继续。
2. 若发现会改变产品需求、Feature 范围、安全边界、验收标准、成功率分母，或要求增加新的用户能力，必须立即停止当前 Gate：先更新 `spec.md`，再同步 `plan.md`、`tasks.md` 和相关契约，重新执行 Constitution Check，并完成文档引用与一致性确认；全部通过后才能继续实现或重跑 Gate。
3. 不得在代码中静默扩大范围、安全例外或用户能力。官方流程未自然出现的 popup、二次 popup 或 redirect，可由自动化测试或本地受控 fixture 验证通用 handler；人工腾讯流程应记录有理由的 `N/A`，不得为触发事件修改腾讯页面。
- DOM 选择器必须经过当次 Windows/Electron 11 验证；变更后以可见失败结束，不做无限轮询。

## G1 认证导航发现契约

1. G1 仅在 G0 PASS 后开始，最多执行 5 轮，从第 1 轮开始编号。允许使用测试账号执行不计入 SC 成功率的发现扫码；发现扫码的导航证据只能包含 `role`、`origin`、`pathname`、`disposition`、`frame`。
2. 每轮只可依据当轮实测批准一个精确 `scheme/hostname/port/path` 元组或一个 popup disposition；不得在同一轮批量批准导航规则。
3. 每轮严格按以下顺序执行：更新 `research.md`、`plan.md` 和本契约并复查 Constitution；添加并运行预期失败测试；实施该条精确规则；运行全部受影响自动回归；重新发现下一跳。
4. 新发现仍被安全阻止是可执行的失败分支：记录 `BLOCKED_NAVIGATION`，保持 Session，进入下一轮；不得在运行时自动加入 allowlist。
5. 父窗以及认证子窗 navigate/redirect/`new-window`/二次 popup 的完整认证链闭合后，G1 才成功；正式 `3/3` 还必须等待 G2 PASS。第 5 轮后仍未闭合、出现无法解释的导航，或继续需要通配、hostname suffix/substring、宽泛 port/path 时，G1 失败并停止，要求人工评审。

## G2 Flash/网络发现契约

1. G2 仅在 G0 和 G1 均 PASS 后开始，最多消耗 3 个修订轮次。一个修订轮次定义为“一次完整启动发现的一组阻塞事实，加上对应修订和回归”；每轮只记录和处理阻塞当前完整游戏启动场景的新 SWF/CDN 精确 host/path、mixed-content 结果、policy 请求、经验证页面信号或所需安全 flag，证据不得包含 query、响应体、表单值或身份数据。
2. 对该次完整启动发现的一组阻塞事实，先更新 `research.md`、`plan.md` 和本契约，再添加并运行预期失败测试，然后实施最小精确规则、运行自动回归并重跑完整启动；规格同步按上一节分流。
3. G2 的“完整启动”必须达到应用内游戏窗口、内容可见和一次鼠标响应。完成修订后，连续 2 次完整启动未出现新的阻塞资源、DOM 信号或安全配置要求时 G2 PASS；这两次稳定验证均须记录安全资源元数据和结论、标记 non-SC，但不额外消耗修订轮次，也不计入正式 `3/3`。
4. 消耗第 3 个修订轮次后仍不稳定则 G2 失败并停止，要求人工评审。通配网络规则、宽泛 allowlist、静默关闭或削弱安全能力均不构成解决方案。

## 恢复契约

| 动作 | 允许阶段 | 来源 | 重试上限 | 内存 URL 生命周期 | Session 规则 |
| --- | --- | --- | --- | --- | --- |
| `RELOAD_SELECTOR` | `SELECTOR_LOADING`、`SELECTOR_FAILED` | 所属 Profile 的自动恢复或用户动作 | 自动最多 1 次；之后每次用户动作只执行 1 次 | 只加载固定 SELECTOR，不保存游戏 URL | 不得清 Cookie/Storage |
| `REOPEN_AUTH` | `AUTHENTICATING`、`AUTH_FAILED`、`SESSION_REJECTED` | 所属 Profile 的自动恢复或用户动作 | 自动最多 1 次；同时最多一个认证子窗 | 只使用已批准 AUTH 入口，不持久化完整 URL | 不得清 Cookie/Storage，不读取/重放票据 |
| `RETRY_GAME_NAVIGATION` | `GAME_NAVIGATING`、`NAVIGATION_FAILED` | 所属 Profile 的自动恢复或用户动作 | 自动最多 1 次；之后每次用户动作只执行 1 次 | 只复用当前流程内存中的受信任 GAME_MAIN URL；离开阶段、返回选服或关闭即销毁 | 不得清 Cookie/Storage |
| `RELOAD_GAME` | `GAME_LOADING`、`GAME_READY`、`GAME_FAILED` | 所属 Profile 的自动恢复、用户动作或有界 crash/stall | 普通自动 reload 最多 1 次；crash/stall 10 分钟最多 3 次 | 只 reload 当前已分类 GAME_MAIN；返回选服或关闭即丢弃引用 | 不得清 Cookie/Storage |
| `RETURN_TO_SELECTOR` | `AUTH_FAILED`、`NAVIGATION_FAILED`、`GAME_FAILED`、`SESSION_REJECTED`、`BLOCKED_NAVIGATION` | 用户动作或官方拒绝会话后的确定性回退 | 不自动循环；每次动作只执行 1 次 | 立即销毁游戏 URL并加载固定 SELECTOR | 不得清 Cookie/Storage |

达到自动上限后后台仍进入 `status=waiting_user` 并停止自动刷新，但管理卡片不显示阶段、错误码/安全消息或动态恢复动作。运行中 Profile 的卡片常态显示“刷新”，renderer 只能提交该卡片的 Profile ID；主进程必须由窗口 registry 找到所属 `LaunchFlow` 并调用 `reloadCurrentRole()`，不得接受 renderer 提交 URL。F5、卡片“刷新”、stall、crash 和任何失败恢复均不得清 Cookie/Storage，也不得修改另一 Profile 的恢复计数。

## 诊断事件契约

允许字段：

```text
profileId, profileLabel, stage, event, role, origin, pathname,
resourceType, statusCode, errorCode, retryCount, retryLimit, timestamp
```

禁止字段：

```text
url, query, fragment, Cookie, Set-Cookie, Authorization, headers, JWT,
requestBody, responseBody, openid, access_token, ticket, skey, p_skey,
uin, qqIdentity, password, pageSource
```

任何未知字段默认拒绝进入普通日志和诊断导出。

## G1 Windows/Electron 11 闭链证据（2026-07-25）

| 顺序 | Role | 精确 Origin/Pathname | Disposition/Frame | 结果 |
| --- | --- | --- | --- | --- |
| 1 | `SELECTOR` | `https://huoying.qq.com/server/website/` | `initial_load/top` | 父游戏窗口稳定加载 |
| 2 | `AUTH` | `N/A` | `N/A` | 扫码 UI 在现有页面自然显示；未产生顶层 AUTH 事件 |
| 3 | `SELECTOR` | `https://huoying.qq.com/server/website/` | `same_page/top` | 扫码成功后显示服务器选择界面 |
| 4 | `GAME_MAIN` | `https://game.huoying.qq.com/main.html` | `internal/top` | 手动选服后由应用内部窗口承载 |

自然流程没有出现认证子窗 navigate、redirect、`new-window` 或二次 popup，人工记录为有理由的 `N/A`；T016 自动化/本地受控 fixture 已验证这些通用 handler。没有发现 UNKNOWN 顶层目标，也没有新增 host/path、popup disposition、selector 或安全例外。

上述为 G1 non-SC 证据，只证明认证/选服/游戏顶层导航链符合本契约；未证明 Flash 内容可见、鼠标响应、CDN/policy 或 G2 稳定性。
