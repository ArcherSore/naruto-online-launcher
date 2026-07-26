# T066 / Windows portable 发布矩阵

记录日期：2026-07-26  
运行平台：Windows x64 / portable  
产物：`dist/Naruto Online 5.12.0.exe`

## 构建证据

```text
npm run build:win
exit code: 0
target: portable
Electron: 11.5.0
artifact size: 60,532,821 bytes
SHA-256: 724F09B8BF217028653D4BC33221C5EFEA58B14FF572553ED48B660BCB4818D3
```

启动 portable 前不存在开发态 `electron.exe`。启动后进程树由发布产物
`Naruto Online 5.12.0.exe` 解包到临时目录中的 `NarutoOnline.exe`，正式矩阵没有混入
开发态实例。

## 正式全新 Profile 启动

使用三个相互独立的全新 Profile 连续完成官方扫码、手动选服和进入游戏。用户逐项确认
三个实例均在启动器内部承载游戏、内容可见且鼠标有响应。

| Attempt | `game_internal` | `content_visible` | `mouse_response` | 结果 |
| --- | --- | --- | --- | --- |
| 1 | PASS | PASS | PASS | PASS |
| 2 | PASS | PASS | PASS | PASS |
| 3 | PASS | PASS | PASS | PASS |

```text
SC-001 passed/attempted = 3/3
SC-002 passed/attempted = 3/3
SC-003 passed/attempted = 3/3
系统浏览器承载游戏 = 0
```

完整 Electron 进程重启只用于建立 portable 发布态前置条件；G1 发现扫码和 G2 稳定性
启动均为历史 non-SC Gate 证据，三者均未混入上述正式分母。

## Session 复用、失效与双 Profile 隔离

保持 portable 的 Electron 主进程运行，只关闭并重开同一 Profile 的游戏窗口：

```text
有效 Session 复用 passed/attempted = 2/2
失效 Session 返回官方扫码 passed/attempted = 2/2
删除 Profile/Session 数据次数 = 0
```

双 Profile 使用相互隔离的账号状态；对其中一个 Profile 执行关闭重开、失效和重新扫码
时，另一 Profile 无变化，跨 Profile 登录状态污染事件为 0。

```text
SC-004 = PASS
SC-005 = PASS
```

## 四类独立故障恢复

每类均确认管理卡片常态显示“刷新”；恢复网络条件后，刷新只重载所属 Profile 当前已分类
的安全角色，Session 保留。没有任意 URL 加载、无限刷新、清理 Session 或强制删除应用
数据。

| 故障类别 | passed/attempted | 刷新可见 | 当前安全角色重载 | Session 保留 |
| --- | --- | --- | --- | --- |
| 未认证登录 UI 加载失败 | `1/1` | PASS | PASS | PASS |
| 已认证选服页加载失败 | `1/1` | PASS | PASS | PASS |
| 进入游戏跳转失败 | `1/1` | PASS | PASS | PASS |
| 游戏 / SWF 加载失败 | `1/1` | PASS | PASS | PASS |

```text
SC-006 passed/attempted = 4/4
```

强制 `killed` renderer 的原窗口恢复仍沿用 T057 中用户接受的低概率限制，不属于上述
四类规定分母；关闭并重开所属游戏窗口可恢复，且不会删除 Profile/Session。

## 敏感证据边界

本记录不包含二维码内容、QQ 身份、Cookie、Set-Cookie、Authorization、ticket/JWT、
完整 URL、query/fragment、表单值、页面源码、请求体或响应体。portable 复跑没有引入
新的诊断数据面；SC-008 的真实日志/诊断包审计见
`validation/windows-sensitive-log-audit.md`，最终验证目录扫描由 T067 执行。

## 判定

**PASS**

Windows portable 构建成功；SC-001 至 SC-006 的发布态规定矩阵全部达到分母，双 Profile
污染事件为 0，且没有把完整进程重启、G1 发现扫码或 G2 稳定性启动混入正式分母。
