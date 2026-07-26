# Data Model: 腾讯国服启动流程

本 Feature 不新增数据库。持久数据仍位于 Electron `userData`；认证数据由 Chromium Partition 管理，不进入应用 Profile JSON。

## Profile

表示启动器中的独立使用身份，而不是 QQ 账号。

| 字段 | 类型 | 持久化 | 规则 |
| --- | --- | --- | --- |
| `id` | string | 是 | 唯一、不可由 renderer 覆盖；用于派生 Partition。 |
| `name` | string | 是 | 用户可见非敏感名称，沿用现有限长。 |
| `color`、`notes`、`tags`、`favorite` | 现有类型 | 是 | 可保留的通用管理元数据，不参与登录或 URL 构造。 |
| `createdAt`、`lastUsed`、统计字段 | number/object | 是 | 沿用现有 Profile 统计。 |
| `partitionName` | string（派生） | 否 | 恒为 `persist:profile-<id>`。 |

`region`、`language`、`server`、`hasVault`、用户名和密码不是腾讯启动流程实体。旧数据可被忽略或在实现时做一次无敏感迁移，但不得继续驱动入口、界面或兼容分支。

不变量：一个 Profile 稳定映射一个持久 Partition，并且同时最多关联一个 `GameInstance`；Profile A/B 不共享 Session、窗口状态或恢复计数。

## TencentOfficialSession

腾讯官方认可的浏览器登录状态。

| 属性 | 表示方式 | 规则 |
| --- | --- | --- |
| 所属 Profile | Partition 一对一映射 | 不能跨 Profile 读取、复制或清理。 |
| Cookie/Storage | Chromium `persist:` Partition | 应用不序列化 Cookie 值或票据。 |
| 有效性 | `unknown` / `accepted` / `rejected` | 只能从官方页面/服务端当前行为推断；应用不延长或伪造。 |
| 窗口生命周期 | 同一 Electron 主进程内复用 | 关闭游戏窗口只销毁该窗口和 `LaunchFlowState`；重开同一 Profile 时继续使用相同 Partition/Session。 |
| 进程生命周期 | 完整退出后不保证免扫码 | Electron 11 不恢复官方 session Cookie；再次启动后是否登录只由官方仍保留的原生持久数据决定，本 Feature 不复制、延长或重放。 |
| QQ 密码/票据 | 不建模 | 不采集、不存储、不输出。 |

关系：一个 Profile 恰好对应一个隔离 Partition；一个 Partition 在任一时刻承载至多一个官方会话状态。同一 Electron 主进程内，游戏窗口关闭不会授权应用清理该 Session；完整进程退出结束 Chromium session Cookie 生命周期。

## ServerSelection

用户在腾讯官方页面完成的瞬时选择。

| 字段 | 持久化 | 规则 |
| --- | --- | --- |
| 官方区服标识/名称 | 否 | 应用不解析或保存值，仅允许官方导航继续。 |
| 选择状态 | 否 | `not_selected` / `selected_by_official_page`。 |
| 生成的游戏 URL | 仅当前 `LaunchFlowState` 内存 | 只从受信任 `GAME_MAIN` 导航开始存活，供本次导航及 `RETRY_GAME_NAVIGATION` 使用；到达 `GAME_LOADING`、执行 `RETURN_TO_SELECTOR`、失败终止或窗口关闭时立即丢弃，不得写日志、Profile 或诊断包。 |

## LaunchFlowState

每个打开的 Profile 窗口拥有一个内存态流程对象。

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `profileId` | string | 必须匹配窗口所属 Profile。 |
| `stage` | enum | 见状态表。 |
| `status` | `idle/loading/ready/failed/waiting_user` | 用于管理 UI 和错误页。 |
| `attempts` | `{selector, auth, navigation, game, crash}` | 每类有上限和时间窗。 |
| `lastSafeLocation` | `{role, origin, pathname}` | 无 query、fragment 和身份值。 |
| `error` | `{stage, code, safeMessage}` 或 null | 不含完整 URL/响应体/票据。 |
| `availableActions` | action[] | 只包含当前阶段允许的恢复动作。 |
| `probeResult` | boolean/enum | 授权 CDP 诊断确认生产 registry 只含真实顶层 `.qConnectLogin iframe.loginframe`；`#ptlogin_iframe` 位于跨域子 frame 并已撤销。仅根据顶层节点存在性与可见性返回 `loginUiVisible`。单次 probe 可用最多 2500ms、必定断开的 MutationObserver 作时序容错；常驻探针不进入子 frame。 |

### Stage 枚举

- `BOOTSTRAPPING`
- `SELECTOR_LOADING`
- `SELECTOR_READY`
- `AUTHENTICATING`
- `GAME_NAVIGATING`
- `GAME_LOADING`
- `GAME_READY`
- `SELECTOR_FAILED`
- `AUTH_FAILED`
- `NAVIGATION_FAILED`
- `GAME_FAILED`
- `SESSION_REJECTED`
- `BLOCKED_NAVIGATION`
- `CLOSED`

### 状态迁移

| 起点 | 事件 | 终点 |
| --- | --- | --- |
| `BOOTSTRAPPING` | loading 页显示并开始官方入口 | `SELECTOR_LOADING` |
| `SELECTOR_LOADING` | 选服入口加载完成且登录 UI selector 不存在 | `SELECTOR_READY` |
| `SELECTOR_LOADING` | 选服入口加载完成且登录 UI selector 存在 | `AUTHENTICATING` |
| `SELECTOR_READY` | 官方登录顶层/子窗开始 | `AUTHENTICATING` |
| `AUTHENTICATING` | 官方回到已可选服页面 | `SELECTOR_READY` |
| `SELECTOR_READY` | 官方产生受信任游戏导航 | `GAME_NAVIGATING` |
| `GAME_NAVIGATING` | 到达受信任游戏主页面 | `GAME_LOADING` |
| `GAME_LOADING` | Flash 容器/对象出现且页面稳定 | `GAME_READY`（最终鼠标交互仍人工验收） |
| 任一加载态 | 有界自动恢复耗尽 | 对应 `*_FAILED` + `waiting_user` |
| 游戏相关态 | 官方拒绝会话/回登录链 | `SESSION_REJECTED`，随后返回 `SELECTOR_LOADING/READY` |
| 任一打开态 | 未知顶层导航 | `BLOCKED_NAVIGATION` |
| 任一打开态 | 窗口关闭 | `CLOSED` |

禁止从失败态无上限自动回到 loading；只能由显式用户动作或剩余的有限自动次数触发。

## GameInstance

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `profileId` | string | 与 Profile/Partition 一致。 |
| `windowId` | number | 当前 Electron BrowserWindow；同一 Profile 同时最多一个。 |
| `partitionName` | string | `persist:profile-<id>`。 |
| `flashEnabled` | boolean | 来自窗口配置/插件探测，不等于游戏成功。 |
| `contentSignal` | `unknown/container_found/object_found` | 只读探针，不读取身份数据。 |
| `gameInternal` | boolean | 正式启动是否始终由应用内游戏窗口承载；映射 `game_internal`。 |
| `contentVisible` | boolean | 正式启动中游戏内容是否可见；映射 `content_visible`。 |
| `mouseResponse` | boolean | 正式启动中一次正常鼠标操作是否得到可观察响应；映射 `mouse_response`。 |

`GameInstance` 不包含 automation handler、命令队列或游戏操作入口；本 Feature 不注册或实现游戏自动化接口。

正式 `3/3` 中，`gameInternal`、`contentVisible`、`mouseResponse` 必须全部为 true，该实例才计入 passed。

## AuthWindowPolicy

认证子窗是当前 Profile 的受控临时窗口，不是游戏运行实例。

| 属性 | 固定值/规则 |
| --- | --- |
| `partition` | 与父 Profile 完全相同的持久 partition |
| `plugins` | `false` |
| `nodeIntegration` | `false` |
| `contextIsolation` | `true` |
| `webSecurity` | `true` |
| `allowRunningInsecureContent` | `false` |
| `enableRemoteModule` | `false` |
| `webviewTag` | `false` |
| `preload` | 不设置游戏窗口业务 preload |
| 后续导航 | navigate、redirect、`new-window`、二次 popup 全部递归执行精确 URL 分类；UNKNOWN 阻止并保留可恢复状态 |

全局 `no-sandbox` 是 PPAPI 基线的既有限制，不是 `AuthWindowPolicy` 字段，也不允许放宽上述补偿边界。

## ProbeExecutionBudget

| 属性 | 规则 |
| --- | --- |
| 触发点 | 仅受信任顶层页面 `did-finish-load` 后 |
| 每次顶层加载 | 最多 1 次 |
| 计数作用域 | 单次窗口 `LaunchFlow` 生命周期；用户重新启动窗口后重置 |
| 每个 stage | 最多 3 次 |
| 整个窗口流程 | 最多 12 次 |
| 单次超时 | 3 秒 |
| 调度 | 不使用 timer/interval 无限轮询 |
| 失败 | 不清 Session，保持当前安全状态 |

## SafeNetworkObservation

该生产实体必须在 G1/G2 及任何真实扫码、认证跳转、Flash/CDN 观察前通过 G0 建立，只允许
`resourceType`、`origin`、`pathname`、`statusCode`、`errorCode` 及所属 Profile/stage；
未知字段默认拒绝。完整 URL、query/fragment、Cookie、Set-Cookie、Authorization、JWT、
ticket、QQ 身份字段、headers、requestBody、responseBody 和页面源码不进入该生产模型，
不保存、不广播、不写日志。Phase 6 只根据本 Feature 的实际用途决定保留该安全实体或删除。

## AuthorizedDiagnosticSession

该实体只存在于用户明确授权的当前本地开发诊断会话，不属于生产数据模型，也不持久化。

| 字段 | 规则 |
| --- | --- |
| `authorization` | 当前会话中的用户明确指令 |
| `purpose` | 一个具体、可复现的故障，例如 T056 状态误判 |
| `profileBoundary` | 一个指定测试 Profile；禁止跨 Profile |
| `readScope` | 解决故障所需的最小 DOM/HTML/frame/form/URL/Cookie/Storage/identity/Session 数据 |
| `mode` | 只读；不得修改认证状态 |
| `expires` | 定位完成或当前诊断会话结束，以先发生者为准 |
| `retention` | 原始值不写文件、日志、截图、IPC、诊断包或长期存储；结束后立即丢弃 |
| `prohibited` | QQ 密码读取、票据解密/复制/延长/重放、登录恢复、跨 Profile 访问 |

## RecoveryAction

| 动作 | 允许阶段 | 允许来源 | 重试上限 | 内存 URL 生命周期 | Session 规则 |
| --- | --- | --- | --- | --- | --- |
| `RELOAD_SELECTOR` | `SELECTOR_LOADING`、`SELECTOR_FAILED` | 该 Profile 的一次自动恢复或用户点击 | 自动最多 1 次；之后仅用户逐次触发 | 只加载固定 `SELECTOR`，不保留游戏 URL | 不清 Cookie/Storage |
| `REOPEN_AUTH` | `AUTHENTICATING`、`AUTH_FAILED`、`SESSION_REJECTED` | 该 Profile 的一次自动恢复或用户点击 | 自动最多 1 次；同时最多一个认证子窗 | 只重新触发已批准 AUTH 入口，不保存完整 URL | 不清 Cookie/Storage，不读取/重放票据 |
| `RETRY_GAME_NAVIGATION` | `GAME_NAVIGATING`、`NAVIGATION_FAILED` | 该 Profile 的一次自动恢复或用户点击 | 自动最多 1 次；之后仅用户逐次触发 | 仅复用当前流程内存中的受信任 GAME_MAIN URL；离开该阶段、返回选服或关闭即销毁 | 不清 Cookie/Storage |
| `RELOAD_GAME` | `GAME_LOADING`、`GAME_READY`、`GAME_FAILED` | 该 Profile 的一次自动恢复、用户点击或既有有界 crash/stall | 普通自动 reload 最多 1 次；crash/stall 10 分钟最多 3 次 | 只 reload 当前已分类 GAME_MAIN；返回选服或关闭即丢弃引用 | 不清 Cookie/Storage |
| `RETURN_TO_SELECTOR` | `AUTH_FAILED`、`NAVIGATION_FAILED`、`GAME_FAILED`、`SESSION_REJECTED`、`BLOCKED_NAVIGATION` | 用户点击或官方拒绝会话后的确定性回退 | 不自动循环；每次用户动作只执行 1 次 | 立即销毁内存游戏 URL并加载固定 `SELECTOR` | 不清 Cookie/Storage |

所有动作只能由所属 Profile 的流程状态机发起，renderer 不能提交任意 URL、Profile 或清 Session 请求；动作不得影响另一 Profile，也不得自动选择区服或进入游戏。登录态重置不属于本 Feature。

### 管理卡片刷新

管理卡片不渲染 `LaunchFlowState` 的阶段说明或 `availableActions`。窗口运行时固定显示
“刷新”，renderer 只发送卡片自身的 `profileId`；主进程使用窗口 registry 找到对应
`LaunchFlow` 并调用 `reloadCurrentRole()`。不存在、未运行或无法分类当前顶层角色时返回
失败，不回退到任意 `webContents.reload()`，也不清 Cookie/Storage。
