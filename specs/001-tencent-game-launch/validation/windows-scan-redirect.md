# T031 / US1 正式 3/3 启动矩阵

记录日期：2026-07-25  
运行平台：Windows / Electron 11.5.0 / 内置 PPAPI  
Gate：正式 SC 矩阵  
前置：T029 / G1 PASS，T030 / G2 PASS

## 分母边界

本记录只包含 G1/G2 PASS 后，从 Attempt 1 开始连续执行的三个相互独立全新 Profile：

- `sc-1`
- `sc-2`
- `sc-3`

T027 的 G1 发现扫码、T028 的导航闭链以及 T030 的两次 G2 稳定性启动均标记为 non-SC，未计入本矩阵。

任一正式 Attempt 的 `game_internal`、`content_visible`、`mouse_response` 三项必须全部 PASS 才计入 passed；本次没有失败，因此无需重置分母。

## 正式矩阵

| Attempt | Profile | 全新独立 Partition | 重新扫码 | 手动选服 | game_internal | content_visible | mouse_response | 系统浏览器承载 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `sc-1` | YES | PASS | PASS | PASS | PASS | PASS | 0 | PASS |
| 2 | `sc-2` | YES | PASS | PASS | PASS | PASS | PASS | 0 | PASS |
| 3 | `sc-3` | YES | PASS | PASS | PASS | PASS | PASS | 0 | PASS |

用户逐次人工确认：

- 三个 Profile 均为新建且相互独立；
- 每次均重新显示腾讯官方扫码入口并由用户完成扫码/官方确认；
- 每次均由用户手动选择有效区服；
- 每次均在应用内部进入游戏；
- 每次游戏/Flash 内容实际可见；
- 每次均执行一次普通鼠标操作并获得可观察游戏交互；
- 没有一次把游戏交给系统浏览器。

## 成功标准

| 成功标准 | passed/attempted | 附加条件 | 结果 |
| --- | --- | --- | --- |
| SC-001 全新 Profile 扫码→选服→进入游戏 | `3/3` | 每次为独立全新 Profile | PASS |
| SC-002 GAME_MAIN 在启动器内部承载 | `3/3` | 系统浏览器承载 0 次 | PASS |
| SC-003 完整启动三项矩阵 | `3/3` | 每次三项全部 PASS | PASS |

## 敏感证据边界

本记录没有保存或复制：

- 二维码内容或账号身份；
- QQ 号、角色名或区服参数；
- Cookie、票据、Authorization 或身份 query；
- 完整 URL query/fragment；
- 页面源码、表单值、请求体或响应体。

## T031 判定

**PASS**

SC-001、SC-002、SC-003 均达到正式连续 `3/3`；每个实例的 `game_internal`、`content_visible`、`mouse_response` 全部 PASS，系统浏览器承载游戏为 0 次。

下一项只能执行 T032，汇总 T015-T031 自动与人工证据并复核 SC-007，不能直接进入 US2。
