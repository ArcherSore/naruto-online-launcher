# 腾讯国服启动链人工验收记录规范

本目录只保存可审查的脱敏结论，不保存登录材料。所有人工验收均使用测试账号，并遵守 FR-013、FR-014、FR-019 与 SC-008。

## 永久禁止记录的内容

- 二维码图片、二维码内容或可复用扫码材料。
- Cookie/Set-Cookie 的值、Authorization、JWT、ticket、skey、p_skey、access_token 或其他票据值。
- QQ 号、昵称、密码、openid、uin 或其他账号身份字段。
- 完整 URL、query、fragment、请求头、请求体、响应体、页面源码、表单值或页面文本。
- 能从日志、截图、文件名或错误消息中恢复登录状态的任何材料。

Cookie 持久化验收如确有需要，只能记录 Cookie 名称、域、flags 和存在性，禁止记录值。URL 只能记录标准化后的 `origin` 与 `pathname`。

“永久禁止记录”不等于绝对禁止临时读取。用户针对具体故障明确授权时，开发诊断会话可以
在当前本地进程、指定测试 Profile 和最短必要时限内，只读检查解决问题所需的页面
DOM/HTML、frame、表单、完整 URL、Cookie/Storage、身份或 Session 参数。不得读取 QQ
密码字段、修改认证状态、跨 Profile 访问、复制/延长/重放认证材料或利用它们恢复登录。
原始结果不得进入本验证目录、仓库文件、日志、截图、文件名、IPC 或诊断包；文档只保留
selector、字段名、生命周期顺序和脱敏结论，定位完成后立即停止并丢弃临时数据。

## 允许字段

```text
Profile: <非敏感内部测试代号>
Gate/Round/Attempt: <G0/G1/G2/G3/SC；轮次或序号>
Stage/Event: <stage>/<event>
Role: SELECTOR | AUTH | GAME_MAIN | UNKNOWN
Origin/Path: <origin + pathname；不含 query/fragment>
Disposition/Frame: <如适用，否则 N/A>
Probe: <只允许 selector 名称 + exists=true/false 或安全 enum；否则 N/A>
Result: PASS | FAIL
passed/attempted: <n>/<n> 或 N/A
game_internal: PASS | FAIL | N/A
content_visible: PASS | FAIL | N/A
mouse_response: PASS | FAIL | N/A
Session preserved: YES | NO | N/A
Safe error code/message: <不含身份材料>
Evidence reviewer: <人工代号>
Date: <YYYY-MM-DD>
```

G1 发现扫码只能填写 `Gate/Round/Attempt`、`Role`、`Origin/Path`、`Disposition/Frame`、`Result` 和必要的安全错误码；其余字段一律写 `N/A`。G1 发现和 G2 稳定性启动必须标记 `non-SC`，不得混入正式成功率分母。

## 阻塞规则

1. G0/T014 未 PASS 前，禁止真实扫码、认证跳转、Flash/CDN 观察及 G1/G2。
2. 任何禁止字段进入采集、日志、IPC、错误页、截图或诊断包时，立即停止当前 Gate，删除该敏感证据的所有副本并报告安全问题；不得用事后涂黑代替源头收敛。
3. G1 每轮最多批准一个精确 `scheme/hostname/port/path` 元组或 popup disposition，最多 5 轮。未知目标保持阻止；需要通配、suffix/substring、宽泛 port/path 或出现无法解释导航时停止并请求人工评审。
4. G2 最多消耗 3 个修订轮次。每轮只处理一次完整启动发现的一组阻塞事实；修订后必须连续 2 次 non-SC 完整启动无新阻塞事实。达到上限仍不稳定时停止并请求人工评审。
5. 运行时发现若改变需求、Feature 范围、安全边界、验收标准、成功率分母或新增用户能力，立即停止 Gate，先同步 Spec、Plan、Tasks、契约、Constitution Check 和一致性检查。
6. G1/G2 未 PASS，不得执行正式 `3/3`；US1 Checkpoint 未 PASS，不得执行 US2 人工门或 Phase 6 清理。
7. G3 任一持久化、失效或双 Profile 隔离矩阵未全过，或观察到跨 Profile 污染、清 Session、shadow 生产调用，US2 保持阻塞。
8. 四类故障恢复、Session 保留、敏感日志审计任一未通过，US3 与 Phase 6 保持阻塞。
9. 任一规定矩阵中途失败，修复后必须从该矩阵第 1 次重新连续执行；不得缩小分母、覆盖失败记录或将发现轮次计入正式结果。
10. 无人工操作者、无测试账号、腾讯官方服务不可用、无法完成扫码/鼠标交互或无法安全制造故障时，任务保持未完成并明确记录阻塞，不得推定 PASS。

## 单次验收记录模板

```markdown
# <Gate/场景名称>

- 前置任务：<任务 ID 与 PASS 证据>
- 环境：Windows x64 / Electron 11.5.0 / PPAPI 34.0.0.376
- 操作者：<人工代号>
- 日期：<YYYY-MM-DD>
- SC 计数：formal | non-SC

## 尝试记录

| Attempt | Profile | Stage/Event | Role | Origin/Path | Disposition/Frame | Probe | Result | passed/attempted | game_internal | content_visible | mouse_response | Session preserved | Safe error |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `<代号>` | `<stage/event>` | `<role>` | `<origin/pathname>` | `N/A` | `N/A` | `PASS/FAIL` | `<n>/<n>` | `PASS/FAIL/N/A` | `PASS/FAIL/N/A` | `PASS/FAIL/N/A` | `YES/NO/N/A` | `<安全错误码>` |

## 结论

- Gate/场景：PASS | FAIL | BLOCKED
- 禁止字段检查：PASS | FAIL
- 失败是否保留：YES | N/A
- 后续允许任务：<任务 ID 或 NONE>
- 备注：<仅非敏感结论>
```

## 提交前复核

- 使用文本搜索检查 `?`、`#`、`Cookie` 值、长 token、QQ 身份字段和页面源码迹象；逐项人工判断，不以搜索零命中代替审查。
- 文件名、Markdown 链接和截图名称同样不得包含身份材料。
- 只有规定前置任务、分母和安全审计均满足时才标记 PASS。
