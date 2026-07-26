# T032 / US1 MVP 检查点

记录日期：2026-07-25  
运行平台：Windows / Electron 11.5.0 / 内置 PPAPI  
分支：`001-tencent-game-launch`  
结论：**US1 MVP PASS**

## 证据范围

本检查点汇总 T015-T031 的自动与人工证据。成功率分母严格从
T029/G1 与 T030/G2 均 PASS 后的 T031 Attempt 1 开始：

- T027 的发现扫码、T028 的导航闭链均为 G1 non-SC；
- T030 的两次连续稳定性启动均为 G2 non-SC；
- 上述发现和稳定性运行不计入 SC-001、SC-002、SC-003；
- 正式矩阵仅包含三个相互独立的全新 Profile：`sc-1`、`sc-2`、`sc-3`。

## 自动化证据

| 范围 | 证据 | 结果 |
| --- | --- | --- |
| T015-T026 US1 自动门 | `validation/us1-automated.md` | 17/17 suites、495/495 tests PASS；SC-007 首次启动页与管理页边界通过 |
| T027 生命周期回归 | `SessionLifecycle.test.js` | Red：1 failed、10 passed；Green：相关 4/4 suites、128/128 tests PASS |
| T029 G1 闭合回归 | `validation/g1-closure.md` | 17/17 suites、496/496 tests PASS；ESLint PASS |
| T030 G2 定向回归 | `validation/windows-ppapi.md` | 6/6 suites、145/145 tests PASS；ESLint PASS |
| T032 US1 检查点复验 | 腾讯 UI、Launcher、SessionLifecycle、LaunchFlow 与 URL 分类 | 5/5 suites、112/112 tests PASS |

Jest 仍仅输出实施前已经记录的 open-handle/`--forceExit` 提示；没有新增测试失败。

## G1 / G2 门禁

| Gate | 运行 | 是否计入 SC | 结果 |
| --- | --- | --- | --- |
| G1 Round 1 | 官方页面内扫码并回到服务器选择界面 | 否 | PASS / non-SC |
| G1 Round 2 | 手动选服并内部导航至 GAME_MAIN | 否 | PASS / non-SC |
| G2 Stability 1 | 应用内部、内容可见、鼠标响应 | 否 | PASS / non-SC |
| G2 Stability 2 | 同 Profile 原生 Session 复用，手动选服；应用内部、内容可见、鼠标响应 | 否 | PASS / non-SC |

G1 没有发现新的精确 host/path、popup disposition 或 UNKNOWN；未自然出现的认证子窗事件具有合理
`N/A`，并由 T016 的自动化/本地受控 fixture 覆盖。G2 消耗修订轮次 `0/3`，连续两次启动均没有新的
SWF/CDN、mixed-content、policy、DOM 信号或安全配置阻塞。

## 正式 3/3 矩阵

| Attempt | Profile | game_internal | content_visible | mouse_response | 系统浏览器承载 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `sc-1` | PASS | PASS | PASS | 0 | PASS |
| 2 | `sc-2` | PASS | PASS | PASS | 0 | PASS |
| 3 | `sc-3` | PASS | PASS | PASS | 0 | PASS |

| 成功标准 | 正式结果 | 判定 |
| --- | --- | --- |
| SC-001 全新 Profile 扫码、手动选服并进入游戏 | `3/3` | PASS |
| SC-002 GAME_MAIN 在启动器内部承载 | `3/3`，系统浏览器承载 0 次 | PASS |
| SC-003 完整启动三项矩阵 | `3/3`，每次三项全 PASS | PASS |

## SC-007 复核

复核命令：

```powershell
rg -n "regionTabs|fRegion|fServer|btnPickServer|serverHint|filterRegion|region-grid|region-btn|data-region=|setup\.region\.|selectedRegion|Oasis|narutowebgame\.com|logintype=|tempmail|auto-login" src\ui\index.html src\ui\app.js src\ui\styles.css src\ui\setup\setup.html
```

结果：`no-visible-oasis-or-international-entry`。当前管理页和首次启动页不存在 Oasis/国际服区域、
服务器、临时邮箱或自动登录入口，SC-007 PASS。

## 敏感证据边界

全部人工证据仅记录安全的运行结果与 `role/origin/pathname` 导航元数据；没有读取或保存二维码、
QQ 身份、Cookie/票据值、身份 query/fragment、页面源码、表单值、请求体或响应体。

## US1 MVP 判定

**PASS**

- G1 与 G2 均已闭合，且全部明确标记 non-SC；
- SC-001、SC-002、SC-003 均为正式连续 `3/3`；
- 三次正式运行的 `game_internal`、`content_visible`、`mouse_response` 均全部 PASS；
- SC-007 静态边界通过；
- US1 MVP 可以完成，并按 tasks.md 顺序进入 T033 / US2。

