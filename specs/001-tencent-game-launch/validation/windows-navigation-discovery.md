# T027 / G1 第 1 轮 Windows 导航发现

记录日期：2026-07-25  
运行平台：Windows / Electron 11.5.0  
Gate：G1 Round 1，**non-SC**  
Profile：`test`（仅内部显示代号，不对应或记录 QQ 身份）  
前置门：T014 / G0 PASS；T026 自动门 PASS

## 证据边界

本轮只记录 `role/origin/pathname/disposition/frame` 及安全的本地生命周期结果。未记录或读取：

- 二维码内容或截图证据；
- QQ 号、昵称、表单值或页面文本；
- Cookie/Storage、票据、Authorization 或身份参数；
- URL query/fragment；
- 页面源码、请求体或响应体。

用户后续曾表示允许扩大读取范围；该授权未被使用，因为 Constitution、FR-013/FR-014 和 T027 的数据禁区仍是不可放宽边界。

## T056 后续 selector 安全发现

2026-07-25，用户在 Windows/Electron 11 的全新 Profile 已稳定显示官方二维码时，使用 DevTools Elements 元素选择器定位并提交：

```text
selector = #qr_area > span.qrlogin_img_out
exists = true
```

只记录了 selector 名称和存在性。未提交或读取 HTML、页面文本、表单值、二维码内容、Cookie、Storage、QQ 身份、URL query/fragment 或任何身份参数。该事实不计入 G1/SC 成功率，只用于 T056 已有页面探针能力的规格同步。

2026-07-26 后续验证证明上述 selector 位于子 frame，在二维码可见时从 DevTools
`top` execution context 查询仍为 `false`，不能作为顶层生产探针。随后只发现并正反验证
承载该子文档的顶层 iframe：

```text
selector = #ptlogin_iframe
二维码状态：exists=true, visible=true
扫码后的选服状态：exists=false, visible=false
```

未读取 iframe `src`、子文档内容或身份数据。生产规则必须撤销子节点 selector，仅批准上述
顶层 iframe 的存在性/可见性布尔检查。

## Round 1 运行结果

| 次序 | Role | Origin | Pathname | Disposition | Frame | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `SELECTOR` | `https://huoying.qq.com` | `/server/website/` | `initial_load` | `top` | 官方选服页加载 |
| 2 | `AUTH` | `N/A` | `N/A` | `N/A` | `N/A` | 官方扫码 UI 在现有页面中自然显示；未出现可记录的顶层 AUTH 导航或认证子窗 |
| 3 | `SELECTOR` | `https://huoying.qq.com` | `/server/website/` | `same_page` | `top` | 扫码与官方确认成功后显示服务器选择界面 |

用户人工确认：

- 二维码可稳定显示；
- 扫码成功；
- 官方流程返回服务器选择界面；
- 本轮未手动选择区服或点击进入游戏，因此未验证 GAME_MAIN，不能计入 G2 或正式 SC。

## 首次运行阻塞与修复

首次启动时页面持续闪烁，未能稳定显示扫码区域。安全日志只显示本地生命周期事件，并证明约 2.5 秒内重复执行大量窗口打开/MemoryGuard 注册；没有读取腾讯页面内容或认证材料。

根因：`SessionLifecycle` 对同一 BrowserWindow 的重复 `ready-to-show` 事件重复调用 `onOpened` 和 `onReady`，后者再次执行 `TencentLaunchFlow.start()`，造成 SELECTOR 被循环重新加载。

按测试先行修复：

1. 在 `src/app/__tests__/SessionLifecycle.test.js` 增加“重复 `ready-to-show` 只启动一次窗口流程”断言；
2. Red 结果：`1 failed, 10 passed`，第二次事件导致 `show` 收到 2 次调用；
3. 在 `src/app/SessionLifecycle.js` 增加窗口级 `readyHandled` 一次性门闩；
4. Green 回归：`4/4` suites、`128/128` tests PASS；
5. PowerShell ESLint：PASS；
6. 修复后安全日志只出现 1 次窗口注册和 1 次窗口打开，用户确认页面不再闪烁。

该修复没有新增 URL、AUTH host、popup disposition 或安全例外，也没有清理/读取 Session。

## 本轮候选与判定

本轮唯一确认候选：

```text
scheme=https
hostname=huoying.qq.com
port=443 (default)
pathname=/server/website/
role=SELECTOR
disposition=initial_load/same_page
frame=top
```

判定：该元组已在现有导航契约和 `src/config/urls.js` 中精确批准，因此本轮不扩展 allowlist、不新增 selector、不修改认证策略。未发现可以安全提出的顶层 AUTH host/path 候选。

## 自然事件覆盖

| 人工事件 | 结果 | 理由 |
| --- | --- | --- |
| 认证子窗 navigate | `N/A` | 官方流程未自然创建认证子窗 |
| 认证子窗 redirect | `N/A` | 官方流程未自然创建认证子窗 |
| 认证子窗 `new-window` | `N/A` | 官方流程未自然创建认证子窗 |
| 二次 popup | `N/A` | 官方流程未自然创建认证子窗 |
| UNKNOWN 阻止 | 未触发 | 本轮没有自然出现未知顶层目标 |

上述通用 handler 由 T016 的 Electron 11 自动化/本地受控 fixture 覆盖；本轮没有修改腾讯页面来人为触发。

## T027 结论

**PASS（仅 G1 Round 1 发现完成）**

- G0 前置满足；
- 官方扫码与回到选服页的自然路径完成；
- 单轮只确认一个精确 SELECTOR 元组；
- 没有扩大数据面、动态 allowlist 或安全例外；
- 本轮为 non-SC，不进入任何正式成功率分母。

G1 尚未闭合：GAME_MAIN 导航未实测。必须按顺序进入 T028，手动选择区服并点击进入游戏，记录下一跳的安全导航事实后再判断是否需要精确规则。

## T028 / G1 Round 2

Gate：G1 Round 2，**non-SC**

用户在同一已扫码 Profile 中手动选择可进入区服并点击进入游戏，人工确认“内部进入成功”。

| Role | Origin | Pathname | Disposition | Frame | 结果 |
| --- | --- | --- | --- | --- | --- |
| `GAME_MAIN` | `https://game.huoying.qq.com` | `/main.html` | `internal` | `top` | 应用内部承载；未交给系统浏览器 |

Round 2 判定：

- 唯一候选是既有 `https://game.huoying.qq.com:443/main.html` 精确元组；
- 该元组已经存在于 Spec、Research、Plan、导航契约、`src/config/urls.js` 和 T016 测试；
- 没有发现新的 UNKNOWN、AUTH host/path、popup disposition 或 selector；
- 因此不新增 allowlist、不新增生产实现，也不能为了满足流程形式伪造新的 Red 测试；
- 既有 `will-navigate`、redirect、`new-window` 回原 PPAPI 窗口测试作为对应自动覆盖，随后运行受影响回归。

Round 2 只确认顶层游戏导航留在应用内部。用户未在本轮声明 Flash 内容可见或鼠标响应，因此该结果不计入 G2 或正式 SC。

自动回归：

- US1 定向测试：`17/17` suites、`496/496` tests PASS；
- PowerShell ESLint：PASS；
- `package-lock.json` SHA-256 保持 `216ABA49685A226E07553B67C114CCDD2F2954FA70D84440C92A5981658F1DBB`；
- Jest 仍输出实施前已记录的 open-handle 提示，没有新增失败。

## T028 结论

**PASS**

G1 的实际父窗链已闭合为：

```text
SELECTOR（官方页面内扫码） -> SELECTOR（服务器选择） -> GAME_MAIN（应用内部）
```

没有需要继续批准的 UNKNOWN 候选，G1 发现循环在第 2 轮停止；未消耗剩余 3 轮。下一步只能执行 T029 G1 闭合审计，不能直接进入 G2。
