# T041 / G3a 同进程 Session 复用人工验收

记录日期：2026-07-25  
运行平台：Windows / Electron 11.5.0  
Profile：`g3a-valid`（内部测试代号）  
结论：**PASS，新口径正式矩阵 `2/2`**

## 当前规格与正式矩阵

2026-07-25 用户选择第二种验收口径。当前 T041 要求保持管理窗口和 Electron 主进程运行，
只关闭并重开同一 Profile 的游戏窗口；腾讯官方仍认可会话时无需扫码、仍由用户手动选服。
完整退出 Electron 主进程并重新 `npm start` 不计入 SC-004/T041。

| 正式运行 | Electron 主进程 | 重新打开同一 Profile | 结果 |
| --- | --- | --- | --- |
| Attempt 1 | 持续运行；只关闭游戏窗口 | 无需扫码，可以手动选服 | PASS |
| Attempt 2 | 持续运行；只关闭游戏窗口 | 无需扫码，可以手动选服 | PASS |

当前正式结果：`passed/attempted=2/2`。两次均由用户按新口径重新执行；此前的同进程诊断对照
没有追溯计入正式 Attempt。T041 / G3a PASS，可以按顺序进入 T042。

## 规格变更前的发现证据

原口径曾要求完全关闭应用和全部 Electron 进程，再重新执行 `npm start`。该口径的首次运行和
同进程诊断对照如下，仅作为范围调整与根因证据，不计入当前 T041：

| 运行 | Electron 主进程 | 重新打开同一 Profile | 结果 | 当前是否计入 T041 |
| --- | --- | --- | --- | --- |
| 旧口径 Attempt 1 | 完全退出后重新 `npm start` | 官方再次要求扫码 | FAIL | NO，旧标准已替换 |
| 同进程诊断对照 | 保持主进程，只关闭游戏窗口 | 无需扫码，可继续手动选服 | PASS | NO，不能追溯计入 |

该证据促成了 Spec → Plan/Tasks/契约的正式变更；新矩阵仍必须从 Attempt 1 开始连续执行 `2/2`。

## Profile 与 Partition 证据

只读取 Profile 内部代号、ID、Partition 路径和 Cookie 安全元数据；未读取 Cookie value、
`encrypted_value`、票据、QQ 身份、页面源码、表单或 URL query/fragment。

```text
Profile alias: g3a-valid
Profile id: p_210daddc4246
Partition: persist:profile-p_210daddc4246
Cookie DB:
  %APPDATA%\naruto-online-launcher\Partitions\profile-p_210daddc4246\Cookies
Cookie DB exists after restart: YES
Cookie DB size after restart: 20480 bytes
```

这证明 Profile ID 和持久 Partition 映射在进程重启前后稳定，失败不是写入临时 partition、
defaultSession 或新 Profile。

## 重启后 Cookie 安全元数据

以下只记录名称、域、`persistent/Secure/HttpOnly/SameSite` flags 和存在性：

| Domain | Names | Persistent | 备注 |
| --- | --- | --- | --- |
| `.graph.qq.com` | `ui` | YES | present |
| `.huoying.qq.com` | `IED_LOG_INFO2_QC`, `fake_id`, `sServerID`, `sServerName`, `tmpLastLoginInfo` | YES | present |
| `.ptlogin2.qq.com` | `pt2gguin`, `pt_guid_sig`, `pt_recent_uins` | YES | present；Secure，其中 `pt_recent_uins` 为 HttpOnly |
| `.qq.com` | `RK`, `eas_sid`, `ptcz` | YES | present |
| `.xui.ptlogin2.qq.com` | `__aegis_uid` | YES | present |
| `ams.game.qq.com` | `tgw_l7_route` | YES | present；Secure、SameSite=0 |
| `logs.game.qq.com` | `tgw_l7_route` | YES | present；Secure、SameSite=0 |
| `web.huoying.qq.com` | `_gorilla_csrf` | YES | present；HttpOnly、SameSite=1 |

重启后数据库仍有上述持久 Cookie，但腾讯官方仍要求扫码；因此这些 Cookie 本身不足以恢复有效登录。
同一 Electron 主进程内关闭/重开游戏窗口可以复用登录，说明有效认证状态当时存在于该 Profile
Session，但没有作为可跨应用会话的数据被 Electron 11 恢复。

## 根因证据

Electron 官方 Cookies 文档规定：未提供 `expirationDate` 的 Cookie 是 session cookie，
不会在应用会话之间保留；`cookies.flushStore()` 只把未写数据立即写入磁盘，不改变 Cookie
的 session/persistent 语义：

- <https://www.electronjs.org/docs/latest/api/cookies>

Electron v11.5.0 官方源码在持久 NetworkContext 中明确设置：

```text
restore_old_session_cookies = false
persist_session_cookies = false
```

源码：

- <https://github.com/electron/electron/blob/v11.5.0/shell/browser/net/network_context_service.cc>

因此，当前 `persist:` partition 会跨进程保留官方本身设置为 persistent 的 Cookie 和其他存储，
但 Electron 11 不恢复官方 session Cookie。现有 `flushStore()` 无法改变该行为。

## 安全与范围判定

以下做法不作为修复：

- 读取并复制腾讯 Cookie value；
- 把 session Cookie 改成 persistent 或自行添加/延长过期时间；
- 恢复旧 shadow `snapshotCookies`/`restoreCookies`；
- 构造、重放或续期腾讯票据；
- 使用 QQ 密码/API 预登录代替官方扫码。

这些做法违反 FR-013、认证边界及 T036 已建立的腾讯生产路径约束。

要继续满足“完整 Electron 进程重启后仍复用”的旧 SC-004，需要 Electron 运行时原生支持恢复
官方 session Cookie；Electron 11.5.0 当前公开能力和上述源码均不提供该行为。用户已确认采用
“同一主进程内关闭/重开游戏窗口可复用”，并按 Spec → Plan/Tasks/契约 → Constitution Check
同步。FR-013 的安全边界未改变；本文件保留旧失败与根因，当前标准下的正式矩阵已通过 `2/2`。
