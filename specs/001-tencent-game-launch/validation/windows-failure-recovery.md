# T056–T057 / Windows 故障恢复验收

记录日期：2026-07-25  
当前状态：**T056 已按用户最终降级决定完成；T057 待执行**

## T056 未认证登录 UI 故障

### 前置事实核对

- G1 Windows 实测证明扫码 UI 在既有 `SELECTOR` 页面内自然显示；
- 自然流程没有顶层 `AUTH` navigate/redirect/popup，人工证据记为有理由的 `N/A`；
- 2026-07-25 用户通过 DevTools Elements 确认二维码 UI 的精确 selector 为
  `#qr_area > span.qrlogin_img_out`，存在性为 `true`；
- 只记录了 selector 与存在性，没有读取 HTML、文本、表单、二维码内容、Cookie、Storage、
  QQ 身份或 URL query/fragment；
- AUTH URL allowlist 仍为空，因为自然流程没有顶层 AUTH 导航；嵌入式登录 UI 将由该
  selector 的单一布尔探针识别为 `AUTHENTICATING`；
- T046 的 AUTH 分支由本地受控 AUTH fixture 验证，不能替代 SC-006 要求的 Windows
  未认证登录 UI 故障验收。

### 实施门

selector 发现阻塞已解除。严格按既定顺序完成 Research/Plan/数据模型/导航契约同步、
预期失败测试、最小生产 probe 和自动回归后，才开始正式人工 Attempt。届时必须先确认
嵌入式登录 UI 被标为 `AUTHENTICATING`，再执行 Offline + reload，验证 `AUTH_FAILED`、
`REOPEN_AUTH`、`RETURN_TO_SELECTOR`、自动上限和 Session 保留。

上述实施门现已完成：

- Red：`TencentLaunchFlow.test.js` 为 `55 passed / 6 failed`，失败仅来自缺少精确
  selector registry、布尔 probe 和 SELECTOR 登录状态分类；
- Green：`61/61`；
- 相关 6-suite 回归：`187/187`；
- US1/US2/US3 18-suite 联合回归：`566/566`；
- 探针脚本只执行固定 `document.querySelector(...) !== null`，静态与测试审计均未命中
  HTML/文本/表单/Cookie/Storage/身份字段读取；
- `package-lock.json` SHA-256 保持
  `216ABA49685A226E07553B67C114CCDD2F2954FA70D84440C92A5981658F1DBB`。

### 正式人工 Attempt

1. 完整关闭旧 Electron 进程并重新运行当前代码。
2. 创建并打开无有效 Session 的全新 Profile，等待二维码稳定显示，确认管理页阶段为
   `AUTHENTICATING`。
3. F12 打开该游戏窗口 DevTools；Network 勾选 `Disable cache`，切换为 Offline。
4. 在游戏窗口只按一次 F5；之后不要再次手动刷新，保持 Offline 等待一次自动
   `REOPEN_AUTH` 也失败。
5. 确认最终为 `AUTH_FAILED`/`waiting_user`，动作同时包含 `REOPEN_AUTH` 与
   `RETURN_TO_SELECTOR`，自动次数为 1。
6. 恢复 Online，点击 `REOPEN_AUTH`，确认二维码重新出现且 Session/Profile 未被删除。
7. 再制造一次故障或从失败态点击 `RETURN_TO_SELECTOR`，确认能回到固定 SELECTOR，
   Session/Profile 仍保留。

若 Offline reload 被缓存承载而没有产生主框架加载失败，本次不计失败次数，保持
`0/0` 并报告现象；不得连续手动刷新替代自动恢复上限验证。

### Windows 发现结果（2026-07-26，non-attempt）

用户按步骤在二维码可见的游戏窗口打开 F12，勾选 `Disable cache`、切换 Offline 并刷新：

- 管理页始终显示“等待扫码或手动选服”，没有显示“正在进行官方认证”；
- Offline 刷新后管理页状态保持不变，没有出现 `AUTH_FAILED`；
- 关闭该游戏窗口并在 Offline 条件下重新打开同一 Profile 后，管理页显示“正在打开官方
  选服页”及“重新加载选服页”，属于 SELECTOR 加载/恢复，不是 AUTH 失败；
- Profile 仍存在，没有观察到 Session/Profile 删除。

该结果证明可见二维码没有被当前顶层
`document.querySelector("#qr_area > span.qrlogin_img_out")` 探针分类为
`AUTHENTICATING`，并且 DevTools Offline + F5 没有形成可用于 T056 的主框架 AUTH
加载失败。当前尚不能区分 selector 位于子 frame，还是登录 UI 在一次性探针完成后才异步
插入；必须先在 DevTools 顶层 execution context 对同一固定 selector 做一次仅布尔
`exists` 检查，再按事实同步文档和 Red 测试。

用户随后在二维码可见、DevTools Console execution context 为 `top` 时执行：

```text
document.querySelector("#qr_area > span.qrlogin_img_out") !== null
```

结果为 `false`。因此已排除“该 selector 在顶层文档中只是异步晚出现”的解释，确认二维码
节点位于子 frame；当前顶层探针无法直接查询它。下一步只允许发现承载该二维码文档的顶层
`<iframe>` 精确 selector 及 `exists/visible` 布尔结果，不读取 frame `src` query、子文档
HTML/文本、表单、二维码内容、Cookie、Storage 或身份参数。

用户通过 Elements 定位承载二维码文档的顶层 iframe，并在二维码可见时从 `top` execution
context 只检查存在性与可见性：

```text
selector = #ptlogin_iframe
exists = true
visible = true
```

该候选可在不进入子 frame、不读取 `src`、页面内容或身份数据的条件下由顶层探针访问。加入
生产 registry 前仍需完成反向验证：扫码成功进入服务器选择界面后，同一 selector 必须
`exists=false` 或 `visible=false`；否则它不能安全区分 `AUTHENTICATING` 与
`SELECTOR_READY`。

用户完成扫码并停留服务器选择界面后，在 `top` execution context 对同一 selector 检查：

```text
selector = #ptlogin_iframe
exists = false
visible = false
```

正反结果闭合，该 selector 可以安全区分二维码认证 UI 与服务器选择状态。它属于既有页面状态
探针的精确技术事实，不改变 Spec、Tasks、验收分母或安全边界；下一步按文档→Red→最小实现
替换不可达的子 frame selector。

### 顶层 iframe 修订自动证据

- 文档同步：Research、Plan、Data Model、Navigation Contract、Quickstart 与验证记录已撤销
  不可达子节点 selector，只批准顶层 `#ptlogin_iframe`；
- Red：`59 passed / 2 failed`，失败仅来自生产 registry 与脚本仍使用旧 selector；
- Green：`61/61`；
- 相关 6-suite 回归：`187/187`；
- US1/US2/US3 18-suite 联合回归：`566/566`；
- 生产脚本只查询固定 iframe 的存在性、`getClientRects()`、`display`、`visibility`；
  `contentDocument`、`contentWindow`、iframe `src`、子节点 selector 和敏感读取模式均未命中；
- `node --check` PASS；定向 ESLint 为 `0 errors`、一条既有测试辅助参数 warning；
- `git diff --check` 无 whitespace error；
- `package-lock.json` SHA-256 仍为
  `216ABA49685A226E07553B67C114CCDD2F2954FA70D84440C92A5981658F1DBB`。

上一轮 DevTools Offline + F5 被缓存承载，不能形成主框架失败。重新验收改用 DevTools
`Network request blocking` 的测试期精确规则
`https://huoying.qq.com/server/website/*`：必须先在线打开全新 Profile 并在管理页确认
“正在进行官方认证”，再启用规则并只按一次 F5。规则同时阻断第一次 reload 和唯一一次自动
`REOPEN_AUTH`；进入等待用户后先禁用规则，再验证两个恢复动作。该临时规则不得写入生产配置。

### 顶层 iframe 时序复测（2026-07-26，non-attempt）

用户完整重启并运行顶层 iframe 修订后，二维码稳定可见，但管理页仍显示“等待扫码或手动
选服”，后续 request blocking 也没有进入“认证页面加载失败”。由于同一 selector 已由用户在
二维码稳定后从顶层确认 `exists=true/visible=true`，而生产 probe 只在
`did-finish-load` 后立即检查一次，该结果确认 iframe 在立即检查之后异步插入/显示。正式
Attempt 仍未开始，保持 `0/0`。

用户随后要求读取 HTML 源码；该授权未使用，因为 Constitution、FR-013/FR-014 和 G0 禁止
页面源码采集且不可由单次人工授权放宽。修订只允许在单次 probe 内对固定 iframe 做最多
2500ms 的有界 MutationObserver 等待，不读取 HTML、mutation 内容、iframe `src`、子 frame、
Cookie、Storage 或身份数据。

上述是 Constitution 1.0.0 下的历史决定。用户在 2026-07-26 复测 observer 版本仍失败后，
明确要求修订宪法并继续直接诊断；Constitution 2.0.0、FR-013/FR-014 现允许当前本地会话、
指定测试 Profile、最短必要时限内的只读页面/Session 检查，仍禁止 QQ 密码读取、认证修改、
跨 Profile、持久化原始值及票据恢复/重放。

### 顶层 iframe 异步时序修订自动证据

- Red：`60 passed / 1 failed`，唯一失败为旧实现缺少有界等待；
- Green：`61/61`；
- 相关 6-suite：`187/187`；
- US1/US2/US3 18-suite 联合回归：`566/566`；
- `node --check` PASS；定向 ESLint 为 `0 errors`、一条既有 warning；
- 敏感读取模式静态审计零命中；
- Node.js `v16.20.2`、npm `8.19.4`，`package-lock.json` SHA-256 仍为
  `216ABA49685A226E07553B67C114CCDD2F2954FA70D84440C92A5981658F1DBB`。

生产探针现在会立即检查固定 `#ptlogin_iframe`；若尚未出现，则在同一次 probe 内只观察
`document.body` 的节点变化以及 `style/class/hidden` 属性，最多等待 2500ms。成功与超时均
清理 observer/timer，不读取 DOM 内容或任何认证数据。自动前置重新 PASS，下一次完整重启
复测仍是 T056 的首次正式 Attempt。

### 2500ms observer 修订 Windows 复测（2026-07-26，non-attempt）

用户完整重启后，二维码已经出现，但管理页仍显示“等待扫码或手动选服”。因此
`#ptlogin_iframe` 在顶层、2500ms 内变为可见的假设被再次否定；该轮不进入故障注入，也不
计入正式分母。下一步按 Constitution 2.0.0 的授权诊断边界直接检查真实 frame/DOM 与页面
生命周期，原始数据不写入本文件，只记录最终脱敏结构事实。

### Constitution 2.0.0 授权诊断结果（2026-07-26，non-attempt）

Codex 启动仅绑定本机的 CDP 调试实例，并在用户明确授权下只读检查 T056 测试 Profile。
脱敏结构事实如下：

- 顶层 SELECTOR 已 `readyState=complete`；
- 顶层存在且可见的登录 UI 为 `.qConnectLogin iframe.loginframe`；
- `#ptlogin_iframe` 位于 OAuth/QQ 登录的两层跨域子 frame 链，不在顶层文档；
- 同一时刻管理页仍显示“等待扫码或手动选服”。

因此根因不是 observer 等待不足，而是生产 selector 的 execution context 错误。原始 iframe
URL query、页面文本和任何认证值未写入本文件。下一修订必须先让 registry/脚本 selector 测试
Red，再改为顶层 `.qConnectLogin iframe.loginframe` 并完成相关/全量回归。

本次为故障注入准备发现，不计入正式分母：

```text
passed/attempted = 0/0
```

### 计数

```text
passed/attempted = 0/0
```

这不是失败次数；T056 尚未开始正式尝试。

## T056 最终降级与真实 Electron 验收（2026-07-26）

真实日志证明 DevTools Offline/F5 在 Chromium 缓存承载下可能只产生一次
`did-fail-load(-106)`；一次自动恢复后不再产生稳定的第二次成功/失败信号。追加 8 秒认证
失败收敛仍未符合用户预期，因此已按用户最终决定撤销该看门狗，并把管理卡片降级为无状态
说明、运行中常态刷新。

实施结果：

- 管理卡片删除 `flow-state` 和动态 `flow-recovery-actions`；
- 未启动主按钮由“打开官方扫码/选服页”改为“打开”；
- 运行中固定显示“显示窗口 / 刷新 / 关闭”；
- `profile:refresh` 只接受已存在 Profile 的字符串 ID；
- 主进程窗口 registry 找到所属 `LaunchFlow` 后只调用 `reloadCurrentRole()`；
- 不存在、未运行或当前角色为 UNKNOWN 时拒绝；renderer 不能提交 URL，不清 Session。

自动证据：

- Red：3 suites 的 6 个新断言全部失败，分别命中旧状态 UI、缺少刷新 IPC 和缺少
  Launcher 接口；
- Green 定向：3 suites，`6/6`；
- T056 相关回归：6 suites，`173/173`；
- 全量：41 suites 中 40 suites 通过，`1154/1165`；唯一失败为项目已知的
  `GpuDetector.test.js` Windows/Linux sysfs mock 基线 11 项，与本次 UI/刷新调用链无关，
  不记为 T056 通过证据，也不隐瞒为全绿。

真实 Electron/CDP 验收：

1. 未启动卡片按钮为“打开 / 编辑 / 删除”，`.flow-state=0`、
   `.flow-recovery-actions=0`；
2. 打开测试 Profile 后按钮为“显示窗口 / 刷新 / 关闭 / 编辑 / 删除”；
3. 点击“刷新”前后顶层均为固定 `https://huoying.qq.com/server/website/`；
   `performance.timeOrigin` 更新，临时 window 标记消失，证明发生真实文档 reload；
4. 关闭窗口后“刷新”消失，按钮恢复“打开 / 编辑 / 删除”；
5. 全程 Profile/Session 未删除，没有任意 URL 输入。

```text
passed/attempted = 1/1
```

T056 通过。原先关于 AUTH 失败状态和动态恢复按钮的历史记录保留为决策轨迹，不再作为当前
FR-015/FR-016 或 SC-006 的验收要求。

## T057 已认证选服/游戏故障

执行日期：2026-07-26。测试使用本机 Electron 11.5.0、同一隔离 Profile 与仅绑定
`127.0.0.1:9222` 的临时 CDP；只记录安全顶层角色、origin/path、布尔值、HTTP 状态和次数，
未读取或保存 Cookie、QQ 号、页面身份字段、完整 query/fragment。

### 四类故障刷新验收

1. **未认证登录 UI**：顶层 `.qConnectLogin iframe.loginframe` 存在且可见。阻断
   SELECTOR Document 后，手动“刷新”和一次有界自动恢复均失败；管理卡片持续保留
   “显示窗口 / 刷新 / 关闭 / 编辑 / 删除”。解除阻断并再次刷新后二维码登录 UI 恢复，
   Profile/Session 未删除。`passed/attempted = 1/1`。
2. **有效 Session 的 SELECTOR**：扫码进入官方选服页后阻断一次 SELECTOR Document；
   管理卡片与 Profile 保留。解除阻断并点击“刷新”后回到
   `https://huoying.qq.com/server/website/`，`readyState=complete` 且选服内容存在，
   无需重新扫码。`passed/attempted = 1/1`。
3. **进入游戏跳转**：只阻断安全顶层
   `https://game.huoying.qq.com/main.html`。用户点击进入游戏后共捕获 7 个短时请求；
   继续等待 6 秒无新增，未形成无限重试。管理卡片持续提供“刷新”；解除阻断并刷新时只
   恢复当前安全 SELECTOR，Session 保留。`passed/attempted = 1/1`。
4. **SWF/CDN/游戏内容**：允许 GAME_MAIN 顶层进入，只阻断
   `https://res.huoying.qq.com` 的 `.swf`。共阻断 1 次，继续等待 6 秒无新增；解除阻断并
   点击“刷新”后观测到 6 个 SWF 请求全部为 HTTP 200，GAME_MAIN
   `readyState=complete` 且存在 2 个 Flash `object/embed` 节点。
   `passed/attempted = 1/1`。

### renderer crash、unresponsive 与会话失效

- CDP `Page.crash` 在 Electron 11 中报告为人为 `killed`。游戏 renderer 消失后管理页、
  Profile 和固定“刷新/关闭”按钮均保留；“关闭→打开”同一 Profile 后直接回到选服页，
  无需重新扫码，证明 Session 未删除。
- 对强制终止 renderer 已尝试既有 `webContents.reload()` 与安全角色
  `BrowserWindow.loadURL()` 两种原窗恢复方式，均不能重建 Electron 11 已终止的
  renderer。用户明确决定暂不继续处理该低概率错误；相关实验代码与临时测试已撤回。
- 通过 CDP 在 SELECTOR renderer 制造死循环 8 秒；管理页保持响应、Profile 与固定按钮
  均存在。“关闭→打开”后再次直接进入选服页，Session 未删除。
- 在有效 Session 的 SELECTOR 点击官方 `#dologout`，再点击官方 `#dologin`；可见的
  `.qConnectLogin iframe.loginframe` 重新出现，Profile 和管理按钮未删除。该过程未直接
  修改 Cookie/Storage，也未读取身份值。

```text
passed/attempted = 7/7
```

T057 通过。强制 `killed` renderer 的原窗恢复属于已由用户接受的低概率未实现项；它不影响
正常页面“刷新”、关闭后重开同一 Profile 或 Session 隔离，不作为本轮 T057 失败项。
