# Implementation Plan: 腾讯国服扫码登录与游戏启动基础链路

**Branch**: `001-tencent-game-launch` | **Date**: 2026-07-20 | **Spec**: [spec.md](./spec.md)

**Input**: `/specs/001-tencent-game-launch/spec.md`

## Summary

在现有 Electron 11 + PPAPI Flash 项目上，把面向用户的启动主链从 Oasis 账号密码、区域和服务器直达逻辑，替换为腾讯官方选服页 `https://huoying.qq.com/server/website/` 驱动的扫码登录、手动选服和内部游戏页导航。复用现有 Profile、持久 Partition、BrowserWindow、Flash 启动和窗口 registry；删除 Oasis Vault/API/JWT/tempmail、页面注入、Cookie 延寿和网络重写。后台保留显式导航状态、严格的顶层导航/弹窗路由和有界恢复；管理卡片不显示不可靠的阶段说明，改为运行中常态提供只重载当前安全角色的“刷新”。生产路径不读取或持久化腾讯票据，用户明确授权的临时本地诊断按 Spec 限定只读范围。

## Technical Context

**Language/Version**: CommonJS JavaScript，Node.js 16.20.2

**Primary Dependencies**: Electron 11.5.0、electron-log 4.x、内置 PPAPI Flash 34.0.0.376（Windows）；不新增运行时依赖

**Storage**: Electron `userData` 下的 Profile JSON；每个 Profile 使用 Chromium `persist:profile-<id>` Partition 原生持久化 Cookie/Storage

**Testing**: Jest 29（Node 环境、Electron mock）、ESLint；Windows/Electron 11/腾讯官方页面/PPAPI 的人工端到端验收

**Target Platform**: Windows x64 portable 为首要平台；保留现有 Linux 代码边界但不在本 Feature 扩展或承诺新平台

**Project Type**: 既有 Electron 桌面应用重构

**Performance Goals**: 不新增量化性能目标；登录/选服/游戏链路不得无限刷新，恢复操作应在一次用户动作后立即开始；多 Profile 不共享 Session

**Constraints**: 冻结 Node 16.20.2、npm 8.19.4、Electron 11.5.0、PPAPI 和核心依赖；不改 `package-lock.json`；不得解密、复制、延长或重放官方认证材料，不构造未经 Spec 授权的腾讯认证 API；游戏必须留在支持 PPAPI 的应用窗口内。T056 已获得用户明确授权，可在当前本地会话和指定测试 Profile 内临时只读检查必要的页面、表单、URL、Cookie/Storage 或身份/Session 参数，但不得读取 QQ 密码、修改认证状态、跨 Profile 访问或持久化原始值。`src/main/flags.js` 当前为 PPAPI 设置全局 `no-sandbox`、`disable-gpu-sandbox`、`disable-setuid-sandbox`，本 Feature 记录该既有限制并以认证子窗强隔离、递归精确导航和最小生产诊断数据面补偿，不顺带修改全局 sandbox 策略

**Scale/Scope**: 现有最多 10 个 Profile；本 Feature 至少以 2 个 Profile 验证隔离。一个 Profile 稳定映射一个持久 Partition、同时最多一个游戏窗口；不同 Profile 不共享 Session、窗口状态或恢复计数。只实现手动扫码、选服、启动和恢复，不注册或实现游戏自动化入口

### 已核实的现状

- 当前入口由 `src/config/urls.js` 生成 Oasis `narutowebgame.com/*/serverlist`，`Launcher` 和 `SessionLifecycle` 直接依赖该入口。
- 当前游戏窗已经通过 `webPreferences.partition`、`plugins: true` 和窗口 registry 建立每 Profile 独立窗口边界；PPAPI flags 在 `app.ready` 前设置，可复用。
- 当前启动前会从 Vault 取明文凭据并调用 Oasis API 注入 `oas_user` JWT；加载后仍有表单、CSS、FB mock 和 JWT 续期注入，均应移除。
- 当前 `new-window` 以字符串包含 `naruto`/`oasgames` 判定内部页面；腾讯游戏链接会被送到外部浏览器，必须替换。
- `persist:` Partition 可由 Chromium 原生保存登录态；shadow 模式却把认证 Cookie 明文快照到 JSON，且恢复未等待完成，不适用于本 Feature。
- 当前 `src/network/inspector.js` 由 `IpcRouter` 引用，会保存完整 URL、Cookie/JWT、票据解码结果和页面流量明细；这些敏感捕获必须移除，但是否保留安全网络元数据由当前 Feature 的 G1/G2 和故障诊断需要决定，不能只按调用者数量或未来自动化设想处理。
- 当前全局 PPAPI flags 包含 `no-sandbox` 等 sandbox 禁用项；这是既有运行时限制，不授权认证子窗继承游戏窗的插件、preload、宽松 webSecurity 或导航能力。
- 2026-07-20 对腾讯公开页面的只读核验：选服页与 `game.huoying.qq.com/main.html` 均返回 200；官方脚本强制登录，经 `CommLoginApp.cgi` 获取游戏 URL，website 渠道采用 `self.location.href`，游戏页再用 `swfobject` 创建入口 SWF。

## Constitution Check

### Phase 0 研究前门禁

| 原则 | 结果 | 证据 |
| --- | --- | --- |
| I. 规格驱动 | PASS | 方案仅覆盖 US1-US3、FR-001 至 FR-020、SC-001 至 SC-008；未加入自动选服或自动化。 |
| II. 腾讯国服唯一方向 | PASS | Oasis 逻辑作为删除/替换对象，不设计兼容分支。 |
| III. 官方认证与受控诊断边界 | PASS | 官方网页扫码是唯一认证入口；Profile 不保存 QQ 密码或应用侧票据；T056 授权诊断限定当前会话、指定 Profile、只读、临时且不持久化。 |
| IV. 模块化而非过度抽象 | PASS | 复用 Launcher/SessionLifecycle 边界，仅增加满足阶段状态和路由要求的腾讯流程控制器。 |
| V. 旧版运行时兼容 | PASS | 固定 Node/npm/Electron/PPAPI，不新增依赖，不修改 lockfile。 |
| VI. Session 隔离 | PASS | 每 Profile 固定唯一 `persist:profile-<id>`；要求双 Profile 隔离测试。 |
| VII. 测试与验收先行 | PASS | 自动测试与 Windows 人工 E2E 范围在设计前确定。 |
| VIII. 简单性与必要性 | PASS | 腾讯区服完全由官方页选择，不新增服务器 API、凭据层或未来自动化框架。 |
| IX. 可诊断性 | PASS | 后台保留阶段状态、有界重试和脱敏诊断；管理卡片使用常态“刷新”代替不可靠的状态说明。 |
| X. 治理与语言规范 | PASS | 规划产物使用中文，技术标识和命令保留原文。 |

无 FAIL、无无理由 N/A，可进入 Phase 0。

### 2026-07-26 T056 降级复核

用户将管理卡片从阶段说明/动态恢复动作降级为运行中常态“刷新”。复核结果仍为 PASS：
后台有界状态机、官方认证、Session 隔离、旧运行时和脱敏边界均未放宽；新增 IPC 只接受
Profile ID，并由主进程窗口 registry 调用既有 `reloadCurrentRole()`，不接受任意 URL、
不清 Session、不增加自动化能力。

## Project Structure

### Documentation (this feature)

```text
specs/001-tencent-game-launch/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── navigation-contract.md
└── tasks.md                    # 由后续 speckit-tasks 生成
```

### Source Code (repository root)

```text
src/
├── main.js                     # 保留 PPAPI 启动顺序与应用生命周期
├── app/
│   ├── Launcher.js             # 保留窗口 registry/PPAPI 窗口，改接腾讯入口
│   ├── SessionLifecycle.js     # 收敛为通用窗口、崩溃、关闭生命周期
│   ├── TencentLaunchFlow.js    # 新增：阶段、导航、弹窗、失败与恢复
│   └── StallDetector.js        # 仅在 GAME_LOADING 阶段启用并脱敏
├── config/
│   └── urls.js                 # 替换为腾讯入口与严格 URL 分类
├── profiles/
│   ├── store.js                # 保留 Profile CRUD，移除正常流程的 Oasis 字段
│   ├── manager.js              # 保留窗口/MemoryGuard 协调，断开凭据/snapshot 调用
│   └── partition.js            # 固定唯一 persist partition；快照先保持不可达，调用者审计后再删除
├── network/                    # 删除 Oasis auth/cookie/blocker；腾讯流程默认不改网络响应
├── ui/
│   ├── app.js
│   ├── index.html
│   └── manager/                # Profile IPC 与流程状态广播
├── flash/                      # 原样保留 PPAPI 探测、清单和 mms.cfg 生命周期
└── utils/
    ├── logger.js               # 增加集中脱敏/结构化字段约束
    └── diagnostics.js          # 默认丢弃 query、fragment、Cookie、票据和页面源码

src/**/__tests__/               # 单元/模块集成测试，与源码相邻
tests/                          # Jest 全局 setup；真实 Electron 行为仍用人工 E2E
```

**Structure Decision**: 继续使用单一 Electron 项目和现有按职责拆分的 `src/`；只新增一个内聚的 `TencentLaunchFlow`，避免把腾讯流程继续塞入已混合窗口、Oasis 登录和恢复的 `SessionLifecycle`。不引入新包、服务端或独立前端工程。

## Design

### 保留、替换与删除

| 分类 | 模块 | 处理 |
| --- | --- | --- |
| 保留 | `main.js`、`main/flags.js`、`flash/*`、`FlashUpdater` | 保留 app-ready 前 PPAPI 配置、内置 DLL 优先和缺失后 relaunch；不升级。 |
| 保留并收敛 | `Launcher`、`SessionLifecycle`、`StallDetector` | 保留窗口 registry、关闭/崩溃有界恢复；导航和状态交给腾讯流程，stall 仅用于游戏加载且不得清 Session。 |
| 保留并迁移 | `profiles/store.js`、`manager.js`、`partition.js` | 保留 Profile CRUD、MemoryGuard 协调和唯一 Partition；正常入口不再使用 region/server/language/credentials。 |
| 替换 | `config/urls.js`、导航/弹窗处理 | 单一腾讯入口、精确 scheme/hostname/path 分类和 Electron 11 `new-window` 处理。 |
| Phase 2 先安全收敛、Phase 6 再按当前用途保留或删除 | 日志、诊断和 `network/inspector.js` | 在任何真实扫码、认证跳转或 Flash/CDN 观察前，以失败测试证明完整 URL、query/fragment、Cookie、Set-Cookie、Authorization、JWT、ticket、QQ 身份字段、请求体、响应体、页面源码不得被采集、保存、广播或记录，再将观察字段收敛为 resource type、origin、pathname、status code、error code，未知字段默认拒绝。Phase 6 只评估本 Feature 是否仍需这套安全元数据能力：需要则保留，不需要则删除；不得到 Phase 6 才首次处理敏感捕获。 |
| 删除 | `api-login.js`、`tempmail.js`、`utils/jwt.js`、Vault/PasswordManager 及其 facade | 这些模块只服务 Oasis 账号密码、JWT 或凭据注入；移除 UI、IPC、状态字段和专用测试。 |
| 删除 | Oasis server selector、region/gamecode、launcher params | 腾讯区服完全由官方页面呈现和选择，不在应用内重建服务器列表。 |
| 删除 | Oasis DOM/CSS、`#oas-player`、FB mock、表单注入、JWT renewal | 不对腾讯认证进行替代或票据续期。 |
| 先禁用、分类审计后原子删除 | shadow Cookie snapshot/restore | G3/T044 只验证腾讯生产路径不调用。T059 区分生产调用者、生产路径负测试和旧模块自测；确认无其他生产用途后，T062 原子删除 API、实现、明文 JSON 与仅针对旧 snapshot 的测试，并以 persist-only/不调用回归替代。 |
| 删除/禁用 | Cookie 延寿/Secure 降级、`crossdomain.xml` 阻断、`logintype` 重写、宽松 CSP 覆盖 | 依赖 Chromium 原生持久化并尊重腾讯服务端有效期；避免破坏 Flash 和认证。 |

若 `CryptoService` 在移除凭据备份后没有非凭据调用者，则随死代码删除；不为范围外的加密备份能力建立新设计。

### 腾讯导航设计

1. `ProfileManager.launch(profileId)` 解析稳定的 `persist:profile-<id>`，`Launcher` 创建 `plugins: true` 的游戏窗口并显示本地 loading 页。
2. `TencentLaunchFlow` 加载官方选服入口，不执行 API 登录、表单填充、Cookie 注入或自动选服。
3. 初始实现只建立页面探针接口、boolean/enum 返回类型、数据禁区、失败行为和有限调用约束；生产 selector 集合初始为空，不预猜腾讯 DOM。流程先以导航事件维护安全上一级状态。
4. 官方 website 渠道的同页跳转由原窗口承载；若实测出现认证弹窗，则创建使用父 Profile 同一 partition 的受控子窗，固定 `plugins:false`、`nodeIntegration:false`、`contextIsolation:true`、`webSecurity:true`、`allowRunningInsecureContent:false`、`enableRemoteModule:false`、`webviewTag:false`，且不配置游戏窗口业务 preload。子窗自身的 navigate、redirect、`new-window` 和二次 popup 递归进入同一精确分类器；未知目标阻止并回到可恢复状态。若游戏请求新窗口，则接管到原有 PPAPI 游戏窗口。
5. 顶层导航和 popup 只按解析后的精确 scheme/hostname/port/path 分类，绝不使用 substring、suffix 或宽泛 path。认证链通过 G1 最多 5 轮逐跳发现：每轮只批准一个精确 URL 元组或一个 popup disposition，并严格执行“更新 Research/Plan/Contract → 添加预期失败测试 → 实施单条精确规则 → 自动回归 → 重新发现”。完整链闭合后才能做扫码与重定向验收；达到上限、导航无法解释或需要宽泛规则时停止并请求人工评审。
6. G1 可使用测试账号执行不计入任何 SC 成功率的发现扫码；该导航记录只能包含 `role`、`origin`、`pathname`、`disposition`、`frame`。完整认证链闭合后进入 G2，只有 G1/G2 都 PASS 才执行正式 `3/3`。Windows 页面信号发现另以人工 DevTools 检查，只记录 selector 名称、存在性和安全 boolean，不记录源码、表单值或身份数据；验证后先更新 Research/Contract，再添加失败测试，最后才将 selector 加入生产规则。
7. 页面探针只在受信任顶层页面 `did-finish-load` 后调用；每次受信任顶层加载最多 1 次。计数以单次窗口 `LaunchFlow` 生命周期为作用域，每个 stage 最多 3 次、整个窗口流程最多 12 次，用户重新启动窗口后重置；单次超时 3 秒，不设置定时无限轮询。失败保持当前安全状态且不清 Session。
8. 子资源请求不套用顶层 host 白名单，不再默认阻断 `crossdomain.xml` 或改写官方响应。G2 最多消耗 3 个修订轮次；一轮是“一次完整启动发现的一组阻塞事实，加上对应文档修订、失败测试、最小实现和自动回归”，每轮只处理阻塞当前完整游戏启动场景的新 SWF/CDN、mixed-content、policy、页面信号或安全 flag。修订后连续 2 次完整启动未出现新的阻塞资源、DOM 信号或安全配置要求时 G2 PASS，稳定验证不额外消耗修订轮次；消耗第 3 个修订轮次后仍不稳定则停止并请求人工评审。禁止通配网络规则、宽泛 allowlist 或静默关闭安全能力。
9. `GAME_READY` 不能只由 URL 或 `did-finish-load` 判定：经 G2 验证的自动信号至少确认腾讯游戏页及 Flash 容器/对象出现。正式 `3/3` 中每个实例同时记录 `game_internal`、`content_visible`、`mouse_response`，三项全 PASS 才计入 passed。
10. 帮助、协议、客服等非核心外链以及未知顶层目标默认阻止；本 Feature 不实现 `shell.openExternal` allowlist。

详细事件、URL 和恢复契约见 [navigation-contract.md](./contracts/navigation-contract.md)。

### Session 隔离与敏感数据

- `profileId -> persist:profile-<id>` 是唯一 Session 映射；登录态只存在于该 Chromium Partition，不复制到 Profile JSON、日志、诊断包或另一 Session。
- Electron 主进程保持运行时，同一 Profile 关闭并重开游戏窗口继续使用同一 Chromium Partition/Session；是否有效完全由腾讯官方页面/服务端判断，不延长 Cookie、不刷新票据。完整进程退出后的免扫码不属于本 Feature 验收。
- 会话失效时保留当前 Partition，让官方页面回到登录入口并重新扫码；普通 F5、stall 或加载失败不得自动清 Cookie。
- 本 Feature 不提供登录态重置或跨 Profile 清理；重新登录由官方页面在原 Partition 内完成。实现不得把清 Cookie 作为 F5、stall 或失败恢复的隐藏动作。
- G0 在任何真实扫码、认证跳转或 Flash/CDN 观察前执行：先为 inspector/诊断/IPC/日志增加敏感捕获的预期失败测试，再把网络观察收敛到 resource type、origin、pathname、status code、error code 的源头 allowlist；完整 URL、query/fragment、Cookie、Set-Cookie、Authorization、JWT、ticket、QQ 身份字段、请求体、响应体、页面源码及未知字段均默认拒绝。
- logger 接口对 URL 只接受 `origin + pathname`；query、fragment、Cookie/Authorization、`openid`、`access_token`、QQ 号和未知长身份串默认视为敏感。
- 删除 `dev:get-cookies` 值、完整页面源码、JWT/URL 捕获等 release IPC；诊断只输出 Profile 的非敏感内部标识/显示名、流程阶段、错误码和计数。

### 失败恢复

| 失败阶段 | 自动行为 | 管理卡片操作 | 会话处理 |
| --- | --- | --- | --- |
| 未认证：登录 UI 加载 | 最多一次重开认证入口；连续失败后停止 | 常态“刷新”当前已分类官方页面 | 保留 Session；不读取/重放票据 |
| 已认证：选服页加载 | 最多一次 reload；连续失败后停止 | 常态“刷新”当前 SELECTOR | 保留 Session |
| 游戏跳转 | 最多一次重试当前内存导航；失败后停止 | 常态“刷新”当前已分类安全角色 | 完整 URL 仅在当前流程内存中存活，不写日志/磁盘；保留 Session |
| 游戏加载/SWF | 仅 GAME_LOADING/GAME_READY 启用有界 stall/crash 恢复 | 常态“刷新”当前 GAME_MAIN | 保留 Session；不阻断 Flash policy |
| 会话失效 | 识别官方回登录/选服链路并更新阶段 | 按官方页面重新扫码 | 不误报为 Flash 失败 |
| 未知 host/协议或非核心外链 | 阻止核心窗口离开受信任链路 | `RETURN_TO_SELECTOR` | 不调用系统浏览器；保留 Session |

所有自动恢复共享有限计数和时间窗；达到上限后停止自动刷新。管理卡片不渲染后台阶段说明或动态恢复动作，只在窗口运行时常态提供“显示窗口”“刷新”“关闭”；“刷新”复用与 F5 相同的 `reloadCurrentRole()` 安全边界。

### Runtime Gates

**统一规格同步条件**: Gate 运行时发现仅补充技术事实（精确 host/path、已存在能力的 DOM selector、CDN 地址或具体兼容参数）时，更新 `research.md`、本 Plan、相关契约和预期失败测试即可。若发现会改变产品需求、Feature 范围、安全边界、验收标准、成功率分母，或要求增加新的用户能力，必须停止当前 Gate：先更新 `spec.md`，再同步本 Plan、`tasks.md` 和契约，重新执行 Constitution Check，并完成文档引用与一致性确认后才能继续实现。任何分支都不得在代码中静默扩大范围或安全例外。官方流程未自然出现的 popup、二次 popup 或 redirect 用自动化测试或本地受控 fixture 验证通用 handler，人工腾讯流程记录有理由的 `N/A`，不得修改腾讯页面来触发事件。

| Gate | 可执行成功路径 | 可执行失败分支 | 后续门禁 |
| --- | --- | --- | --- |
| G0 安全网络观察 | T007 先证明现有 inspector/诊断/IPC/日志的敏感采集失败；T013 只实现五类安全元数据及未知字段默认拒绝；T014 证明失败测试转绿和受影响回归通过 | 任一禁止字段仍可被采集、保存、广播或记录，或字段不在 allowlist 中时保持阻塞，不得开始真实扫码、认证跳转或 Flash/CDN 观察 | G0 PASS 是 T027 G1 与 T030 G2 的硬前置；Phase 6 只决定安全元数据能力保留或删除 |
| G1 认证导航 | 仅在 G0 PASS 后，T027 可用测试账号进行不计入 SC 的发现扫码且只记录 `role/origin/pathname/disposition/frame`；T028 每轮按规格同步分流、失败测试、精确实现、回归、重新发现执行，最多 5 轮；T029 证明父窗及认证子窗递归导航链闭合。未自然出现的 popup/redirect 以自动化或本地 fixture 证明 handler，人工记录有理由的 `N/A` | UNKNOWN 安全阻止后进入下一轮；第 5 轮后未闭合、导航无法解释、需要通配/suffix/宽泛 path/port，或触发规格变更分支但尚未完成 Spec/Plan/Tasks/契约/Constitution/一致性同步时停止 | G1 PASS 后进入 T030 G2；G2 PASS 后才能执行 T031 正式 `3/3` |
| G2 Flash/网络 | 仅在 G0/G1 PASS 后，T030 最多消耗 3 个修订轮次；每轮处理一次完整启动发现的一组阻塞事实并完成规格同步分流→失败测试→最小实现→回归；修订后连续 2 次完整启动无新阻塞资源、DOM 信号或安全配置要求即 PASS，稳定验证不消耗修订轮次 | 消耗第 3 个修订轮次后仍不稳定，需要通配网络规则、宽泛 allowlist、静默关闭安全能力，或规格变更分支尚未完成同步时停止并请求人工评审 | G2 PASS 才能执行 T031 正式 `3/3` 并完成 T032 US1 Checkpoint |
| G3 Session/隔离 | T041-T043 按规定矩阵证明同一主进程内关闭/重开游戏窗口的 Session 复用、失效与双 Profile 隔离；T044 仅证明腾讯生产路径不调用 shadow API | 任一矩阵未全过、跨 Profile 污染、清 Session 或生产路径 shadow 调用均保持阻塞；完整进程退出后的免扫码不在矩阵内，本阶段不删除旧 API/实现 | T045 后进入后续故事；T059 分类生产调用者/负测试/旧自测，T062 才可原子删除 |

Gate 证据只包含契约允许的脱敏字段；任何失败分支均保持当前 Profile Session，除非腾讯官方自身判定会话失效。

## Verification Strategy

当前基线：与入口、窗口、Session、网络和 Flash 相关的 11 个 suite 共 374 个测试通过；全量 Jest 为 37/38 suites、1223/1234 tests，11 个失败均来自 Windows 上 `GpuDetector.test.js` 的 Linux 路径 mock，并伴随未关闭句柄提示。`npm run lint` 在 PowerShell 因 POSIX 环境变量语法失败，但 PowerShell 等价 ESLint 命令通过。这些均记录为既有问题，不在本 Feature 顺带修复。

### 自动测试

- 腾讯 URL 常量、精确 host/path 分类、仿冒 hostname 和 query/fragment 脱敏。
- 导航状态机的合法/非法迁移、四阶段失败、一次自动重试、上限停止与恢复动作。
- Electron 11 `will-navigate`/redirect/`new-window` mock：游戏留在 PPAPI 窗口；认证子窗共享父 partition，固定 `plugins:false`、`nodeIntegration:false`、`contextIsolation:true`、`webSecurity:true`、`allowRunningInsecureContent:false`、`enableRemoteModule:false`、`webviewTag:false`、无游戏业务 preload；子窗及二次 popup 继续精确分类，UNKNOWN 可恢复阻止。
- 页面探针先覆盖接口、boolean/enum、空 selector registry、数据禁区，以及 `did-finish-load` 后调用、每次顶层加载 1 次、单次窗口 `LaunchFlow` 生命周期内每 stage 3 次/全流程 12 次、重启窗口重置、3 秒超时、无定时轮询、失败不清 Session并保持安全状态。T056 授权 CDP 诊断确认顶层精确 `.qConnectLogin iframe.loginframe`；`#ptlogin_iframe` 位于跨域子 frame，撤销该错误规则。生产探针仅根据顶层登录 iframe 的存在性和可见性返回 `loginUiVisible`，不进入子 frame。单次 probe 内保留一个最多 2500ms、最终必定 disconnect 的 `MutationObserver` 作为时序容错；外层仍以 3000ms 超时，禁止 interval、无界 observer 和 mutation 内容读取。SELECTOR 页结果为 `true` 时进入 `AUTHENTICATING`，为 `false` 时进入 `SELECTOR_READY`，异常/超时保持当前安全状态。
- Profile 到 persist Partition 的稳定一对一映射；两个 Profile 使用不同 Session；一方失效/重登不影响另一方。
- 普通 reload、stall、crash 和重新扫码均不由应用清认证存储。
- logger/diagnostics 对 query、fragment、Cookie、Authorization、JWT/base64url/腾讯身份字段的默认脱敏；敏感 debug IPC 不再注册。
- 轻量静态审计确认无腾讯票据解析/解密/复制/延寿/重放、无未经 Spec 授权的腾讯认证 API 构造，也无自动点击、自动选服、游戏自动化 IPC/handler/command queue。
- G0 的 `network/inspector.js`/诊断/IPC/日志测试先证明禁止字段不能被采集、保存、广播或记录，并证明只允许 resource type、origin、pathname、status code、error code、未知字段默认拒绝；Phase 6 仅测试最终决定后的“安全保留”或“无当前用途删除”，不再首次处理敏感字段。
- 保留的 Flash plugin/flags/Launcher 窗口配置和关闭 registry 测试。

### 必须人工验证的 Windows E2E

- G1 可先用测试账号做发现扫码，证据只含 `role/origin/pathname/disposition/frame` 且不计入任何 SC；认证链闭合且 G2 PASS 后再开始正式矩阵。
- 全新 Profile 显示官方二维码；扫码、官方附加验证、手动选服后进入内部游戏页，连续执行 3 次。每次同时记录 `game_internal`、`content_visible`、`mouse_response`，三项全 PASS 才计入 passed，最终 `passed/attempted=3/3`。
- 有效区服进入内部游戏窗口连续执行 3 次并记录 `passed/attempted=3/3`；进入系统浏览器为 0 次。该矩阵与 SC-003 共用同一组三次正式启动。
- 游戏内容可见、入口 SWF 实际加载并响应一次鼠标操作。
- Electron 主进程保持运行时，同 Profile 关闭并重开游戏窗口后的有效会话连续复用 2 次、失效 Session 返回扫码连续执行 2 次，分别记录 `passed/attempted=2/2`；完整进程退出后的行为不计入该矩阵。
- 两个 Profile 同时登录不同账号，在同一主进程内关闭/重开游戏窗口、失效、恢复和清理互不影响。
- 未认证状态登录 UI 加载失败与已认证状态选服页加载失败分别验收并记录阶段、恢复动作和 Session 保留；游戏跳转、游戏加载、SWF/renderer crash、断网/TLS/DNS 均显示正确阶段和有界恢复。
- 官方登录 iframe/popup、新窗口和重定向路由符合契约；未自然出现的 popup、二次 popup 或 redirect 由自动化测试或本地受控 fixture 验证通用 handler，人工流程记录有理由的 `N/A` 且不修改腾讯页面；非核心帮助/协议/客服链接默认阻止，游戏进入外部浏览器次数为 0。
- Windows portable 包中的 Flash DLL 被识别，`navigator.plugins`/Flash object 可用。
- 扫描普通日志和诊断包，确认没有完整 Cookie、ticket、QQ 密码、身份 query/fragment 或页面源码。

完整命令和步骤见 [quickstart.md](./quickstart.md)。

### FR/SC 设计、任务与验证映射

| 需求 | 设计落点 | 任务 | 验证落点 |
| --- | --- | --- | --- |
| FR-001–FR-007 | 腾讯导航设计、G1/G2 | T003、T009、T015-T032 | T026、T027-T032；quickstart 0-2 |
| FR-008–FR-011 | Session 隔离与敏感数据、G3 | T005、T011、T033-T045、T059、T062 | T040-T045、T065-T067；quickstart 3-4 |
| FR-012 | 保留、替换与删除 | T017-T025、T059-T064 | T019、T026、T063-T065、T067 |
| FR-013–FR-014 | 认证边界、诊断脱敏、G1/G2 | T002、T006-T007、T012-T013、T016、T018、T021-T024、T027-T030、T044、T057-T064 | T014、T026-T032、T044、T055-T058、T064-T065、T067；quickstart 0、9-10 |
| FR-015–FR-019 | 失败恢复、导航契约恢复 allowlist | T004、T010、T046-T058 | T054-T058、T065-T067；quickstart 5-10 |
| FR-020 | Profile/Partition/GameInstance 不变量 | T005、T008、T011、T015、T022、T033、T036、T043、T049-T050、T054、T064-T067 | T014、T033、T040、T043-T045、T064-T067；quickstart 4 |
| SC-001 | 首登矩阵 | T026、T031-T032、T066-T067 | quickstart 1；正式 `3/3` |
| SC-002 | 内部 GAME_MAIN 矩阵 | T016、T026、T031-T032、T066-T067 | quickstart 1、9；正式 `3/3` 且外部浏览器 0 次 |
| SC-003 | 正式启动三项矩阵 | T030-T032、T066-T067 | quickstart 1-2；每实例 `game_internal`、`content_visible`、`mouse_response` 全 PASS，正式 `3/3` |
| SC-004 | 同进程有效/失效 Session 矩阵 | T033、T040-T042、T045、T066-T067 | quickstart 3；同一主进程内有效 `2/2`、失效 `2/2`；完整进程重启不计入 |
| SC-005 | 双 Profile 隔离 | T005、T033、T040、T043、T045、T066-T067 | quickstart 4；污染 0 次 |
| SC-006 | 四类独立故障与恢复 | T046-T058、T066-T067 | quickstart 5-8；逐类 `passed/attempted` 全通过 |
| SC-007 | Oasis 可见入口为零 | T017、T019、T023-T026、T059-T064、T067 | T019、T026、T063-T065、T067；quickstart 1 |
| SC-008 | 敏感信息泄露为零 | T002、T006-T007、T012-T013、T016、T057-T058、T059-T061、T064-T067 | T014、T026、T030、T055、T058、T064-T065、T067；quickstart 10 |

## 尚未确认的技术事实及验证方法

这些是外部页面/旧 Chromium 的运行时事实，不作为应用伪造兼容逻辑的依据；设计对未知行为采用“阻止、显示阶段、允许返回选服”的安全默认。

| 事实 | 当前证据 | 验证方法 |
| --- | --- | --- |
| Chromium 87 下二维码是 iframe、同窗还是 popup，涉及哪些顶层认证 host | T056 授权 CDP 已确认顶层 `.qConnectLogin iframe.loginframe`，内部为两层跨域登录 frame | 生产只探测顶层固定 selector；原始 URL/query 不进入文档或常驻采集。 |
| 扫码后 `CommLoginApp.cgi` 的完整重定向和所需参数 | 官方脚本确认由服务端返回 `gameurl`，website 为同页跳转 | 测试账号扫码选服，记录参数名是否存在但不记录值，确认最终精确 host/path。 |
| 会话失效在各阶段的页面/导航表征 | 游戏页有 `web.checkLogin()` 和 re-login 配置 | 官方 logout、测试会话过期或撤销后先观察脱敏导航；不足时按授权诊断边界临时只读检查，文档与失败测试先于生产 selector。 |
| 腾讯 Flash CDN、mixed content、`crossdomain.xml` 和 `webSecurity` 需求 | 游戏页确认使用 swfobject，真实资源需登录后生成 | G2 最多 3 个修订轮次，每轮处理一次完整启动发现的一组阻塞事实及其修订/回归；只使用 G0 已验证的安全网络元数据。修订后连续 2 次完整启动无新阻塞事实即 PASS，稳定验证不消耗修订轮次；消耗第 3 个修订轮次后仍不稳定则人工评审。 |
| Windows portable 的 PPAPI 与 fallback | 内置 DLL 16MB、manifest 34.0.0.376；源码链闭合 | `npm run build:win` 后在干净 Windows 环境启动；内置 DLL 缺失与 `7z` fallback 另作风险验证。 |

若 G1/G2 实测只补充精确 host/path、已存在能力的 DOM selector、CDN 地址或具体兼容参数，先回写 `research.md`/本 Plan/导航契约并添加预期失败测试。若事实会改变产品需求、Feature 范围、安全边界、验收标准、成功率分母或增加用户能力，则停止 Gate，先更新 `spec.md`，再同步本 Plan、`tasks.md` 和契约，重新执行 Constitution Check 并完成一致性确认；不得在代码中静默扩大范围或安全例外。

## Phase 1 后 Constitution 复查

| 原则 | 结果 | Phase 1 设计证据 |
| --- | --- | --- |
| I | PASS | 数据模型和导航契约均映射到 Profile、官方会话、区服选择、游戏实例和流程状态。 |
| II | PASS | 设计明确删除 Oasis 主链和测试，不保留兼容入口。 |
| III | PASS | 官方页面拥有认证；认证子窗采用完整安全 webPreferences、无游戏 preload 和递归精确导航；生产 inspector 保持最小化，授权诊断只读且不持久化。 |
| IV | PASS | 新增单一 `TencentLaunchFlow`；窗口、Session、Flash、诊断职责分离。 |
| V | PASS | 无依赖、runtime、Electron、PPAPI 或 lockfile 变更。 |
| VI | PASS | 固定持久 Partition，腾讯路径禁用 shadow 票据快照；实际删除受 Phase 6 全量调用者审计约束，并定义双 Profile 验证。 |
| VII | PASS | quickstart 覆盖认证子窗、探针预算、G1/G2 有界门、正式 `3/3` 三字段矩阵及不可可靠自动化的 GUI/Flash E2E。 |
| VIII | PASS | 不实现服务器 API、密码系统、自动选服、自动进入或自动化框架。 |
| IX | PASS | 状态机、错误阶段、有界重试、返回选服和脱敏事件均已形成契约。 |
| X | PASS | 全部设计产物为中文且与 Constitution 2.0.0 一致。 |

Phase 1 后仍无 FAIL、无无理由 N/A、无待澄清设计项，可进入后续 Tasks 阶段。运行时未知项已有安全默认与明确验证门，不授权扩大范围或放宽认证边界。

## G1 运行时复查（2026-07-25）

T027-T028 的 Windows/Electron 11 non-SC 发现确认：

1. SELECTOR 精确元组仍为 `https://huoying.qq.com:443/server/website/`，官方扫码 UI 在现有页面自然显示，扫码完成后同页进入服务器选择状态。
2. 认证阶段未自然产生顶层 AUTH 窗口、navigate、redirect、`new-window` 或二次 popup；人工项记为有理由的 `N/A`，T016 已覆盖通用递归 handler。
3. 用户手动选服后，既有 `https://game.huoying.qq.com:443/main.html` 在应用内部承载，未交给系统浏览器。
4. G1 当时未发现 UNKNOWN 顶层目标或新的精确候选，不修改 URL 分类、认证子窗策略、selector registry 或网络规则。
5. 首次运行发现的 SELECTOR 闪烁来自本地 `ready-to-show` 重复处理；已用窗口级一次性门闩和回归测试修复，不改变 Session 或外部页面行为。

本次复查不改变 Spec、Feature 范围、安全边界、验收标准、成功率分母或用户能力。Constitution I-X 结论保持 PASS；G1 结果仍为 non-SC，不能代替 G2 或正式 `3/3`。

### T056 selector 技术事实同步（2026-07-25 至 2026-07-26）

初次提交的 `#qr_area > span.qrlogin_img_out` 位于二维码子 frame。真实 Windows 顶层
Console 对它返回 `false`，上一版生产探针因此把可见二维码误判为
`SELECTOR_READY`。后续人工把 `#ptlogin_iframe` 误认为顶层候选；立即查询和 2500ms
observer 两版生产实现均被真实 Windows 否定。

真实 Windows 重启复测进一步证明：二维码稳定可见后管理页仍显示
`SELECTOR_READY`。Constitution 2.0.0 和用户明确授权生效后，通过本机 CDP 读取真实顶层
HTML/frame tree，确认顶层登录 UI 是 `.qConnectLogin iframe.loginframe`；
`#ptlogin_iframe` 位于 OAuth/QQ 登录的跨域子 frame 链，顶层查询永远为 false。原始 URL
query、页面文本和认证值未进入文档。

生产 registry 改为只包含顶层 `.qConnectLogin iframe.loginframe`。常驻探针继续只根据
节点存在性、`getClientRects()`、`display`、`visibility` 返回布尔值，不进入子 frame，也不
增加生产数据采集。保留单次 `executeJavaScript` 内最多 2500ms 的 `MutationObserver` 作为
有界时序容错，结束时必须 disconnect，外层 3000ms 预算继续兜底。

SELECTOR 页首次 `did-finish-load` 后先保持 `SELECTOR_LOADING` 并运行有界探针：`loginUiVisible=true` 进入 `AUTHENTICATING`，`false` 进入 `SELECTOR_READY`，首次探针失败保持 `SELECTOR_LOADING`。一旦识别为嵌入式认证，同一 SELECTOR reload 在新探针完成前保留 `AUTHENTICATING`，使其 `did-fail-load` 按现有失败契约映射为 `AUTH_FAILED`。该同步不修改 Spec、Tasks、验收分母或用户能力，Constitution I–X 继续 PASS。

## G3a 验收标准变更后的 Constitution 复查（2026-07-25）

T041 实测确认：同一 Electron 主进程内关闭并重开游戏窗口可以复用同一 Profile 的有效 Session；完整退出全部 Electron 进程后，Electron 11.5.0 不恢复腾讯官方 session Cookie，官方会再次要求扫码。用户选择将 SC-004 正式口径调整为前者。Spec 已先更新，随后同步 Research、Plan、Tasks、Data Model、Navigation Contract、Quickstart 与验证记录；成功分母仍为有效 `2/2`、失效 `2/2`，但有效组明确限定为同一主进程内的两次窗口重开。

| 原则 | 结果 | 变更后证据 |
| --- | --- | --- |
| I | PASS | Profile、腾讯官方会话、窗口与流程状态的数据关系新增了明确的进程/窗口生命周期。 |
| II | PASS | 未恢复 Oasis 或任何国际服兼容路径。 |
| III | PASS | 完整进程退出后允许官方重新扫码；禁止复制、延长、重放 Cookie/票据及构造认证 API；授权只读诊断不得用于恢复登录。 |
| IV | PASS | 继续由 Profile manager、Chromium Session、窗口和 `TencentLaunchFlow` 分担职责，无新增影子会话层。 |
| V | PASS | 不升级 Node、npm、Electron、PPAPI 或依赖，不修改 lockfile。 |
| VI | PASS | 每 Profile 固定 Partition 与双 Profile 隔离保持不变；同进程复用不调用 shadow snapshot/restore。 |
| VII | PASS | Quickstart/T041/T042/T043 明确真实 Windows 人工矩阵、准备步骤、正式分母及完整进程重启的 non-SC 边界。 |
| VIII | PASS | 未增加自动扫码、自动选服、自动进入或游戏自动化能力。 |
| IX | PASS | 有效复用、官方拒绝、重新扫码和失败恢复仍使用显式状态与有界动作。 |
| X | PASS | Spec、Plan、Tasks、Research、Data Model、Contract、Quickstart 与验证记录均以中文同步。 |

本次变更没有 FAIL 或无理由 N/A。它缩小了产品验收范围，但没有放宽认证安全禁区、Profile 隔离、运行时冻结或成功率分母；完成文档一致性确认后方可按新口径重新执行 T041。
