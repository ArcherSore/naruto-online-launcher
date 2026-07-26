# T067 / 最终签核清单

记录日期：2026-07-26  
Feature：腾讯国服官方扫码、选服与应用内 Flash 启动  
结论：**PASS**

## 固定版本与锁文件

| 项目 | T001 实施前 | T067 实施后 | 结果 |
| --- | --- | --- | --- |
| Node.js | `v16.20.2` | `v16.20.2` | PASS |
| npm | `8.19.4` | `8.19.4` | PASS |
| Electron（声明/安装） | `11.5.0` | `11.5.0` / `11.5.0` | PASS |
| Windows PPAPI | `34.0.0.376` | `34.0.0.376` | PASS |
| Linux PPAPI 保留边界 | `34.0.0.137` | `34.0.0.137` | PASS |
| `package-lock.json` SHA-256 | `216ABA49685A226E07553B67C114CCDD2F2954FA70D84440C92A5981658F1DBB` | `216ABA49685A226E07553B67C114CCDD2F2954FA70D84440C92A5981658F1DBB` | PASS |

`git diff -- package-lock.json` 无输出。Windows 内置
`flash/pepflashplayer.dll` 存在，大小为 16,091,624 bytes；版本来自
`flash/manifest.json`，没有下载 fallback 替代 portable 正式验收主路径。

## 验证目录敏感证据审计

扫描范围：`specs/001-tencent-game-launch/validation/**/*.md`。

| 检查项 | 结果 |
| --- | --- |
| 含 query 或 fragment 的完整 URL | 0 |
| HTML/DOCTYPE/form/pageSource/innerHTML/outerHTML 原始值迹象 | 0 |
| Cookie、Set-Cookie、Authorization、ticket、JWT、skey、p_skey、uin 等赋值形态 | 0 |
| QR data URI、`qrsig`、`ptqrtoken`、OTP URI | 0 |
| JWT/Base64 长编码值 | 0 |
| 敏感身份文件名 | 0 |

逐项人工分类长值候选：

- `431226` 是已审计日志文件的字节数；
- `20480` 是 Cookie SQLite 文件大小，未读取数据库内容；
- 64 位十六进制串仅为公开的 `package-lock.json` 或 portable 产物 SHA-256；
- `windows-cookie-persistence.md` 是场景描述文件名，不包含 Cookie 值。

文档出现 `Cookie`、`ticket`、`QQ` 等字段名称仅用于规定禁区、记录零泄露结论或描述
测试类别，不包含认证材料。验证目录不含二维码图片、QQ 身份、页面源码、表单值、完整
Cookie、可复用票据、身份 query/fragment、请求体或响应体。

## Functional Requirements

| 要求 | 签核 | 主要证据 |
| --- | --- | --- |
| FR-001 默认入口为腾讯国服官方流程 | PASS | `windows-portable-release.md`、`oasis-removal.md` |
| FR-002 全新 Profile 打开官方选服页并支持二维码 | PASS | `windows-scan-redirect.md`、`windows-portable-release.md` |
| FR-003 只使用官方认证且无 QQ 密码入口 | PASS | `static-security-audit.md`、`us1-checkpoint.md` |
| FR-004 官方登录后可手动浏览并选择有效区服 | PASS | `windows-scan-redirect.md`、`windows-portable-release.md` |
| FR-005 手动进入所选区服对应 GAME_MAIN | PASS | `windows-navigation-discovery.md`、`windows-portable-release.md` |
| FR-006 游戏保持在具备 PPAPI 能力的应用内窗口 | PASS | `windows-ppapi.md`、`windows-portable-release.md` |
| FR-007 内容可见且鼠标交互有响应 | PASS | `windows-ppapi.md`、`windows-portable-release.md` |
| FR-008 同 Profile 绑定并复用隔离 Session | PASS | `windows-cookie-persistence.md`、`windows-portable-release.md` |
| FR-009 不同 Profile 状态和恢复操作相互隔离 | PASS | `windows-two-profile-isolation.md`、`windows-portable-release.md` |
| FR-010 同进程有效 Session 免扫码但不自动选服/进入 | PASS | `windows-cookie-persistence.md`、`windows-portable-release.md` |
| FR-011 失效 Session 返回官方扫码且无需删除数据 | PASS | `windows-session-expiry.md`、`windows-portable-release.md` |
| FR-012 UI 与正常流程无 Oasis/国际服/密码功能 | PASS | `oasis-removal.md`、`us1-checkpoint.md` |
| FR-013 不采集密码、不处理/绕过票据、不构造认证 API | PASS | `static-security-audit.md`、`windows-sensitive-log-audit.md` |
| FR-014 生产日志、IPC、诊断和 inspector 仅安全元数据 | PASS | `static-security-audit.md`、`windows-sensitive-log-audit.md` |
| FR-015 卡片无动态状态说明；“打开”/常态“刷新” | PASS | `us3-automated.md`、`windows-failure-recovery.md` |
| FR-016 刷新只重载当前安全角色且保留 Session | PASS | `us3-automated.md`、`windows-portable-release.md` |
| FR-017 自动恢复有界，手动刷新不以清 Session 为前提 | PASS | `windows-failure-recovery.md`、`us3-checkpoint.md` |
| FR-018 精确处理导航/子窗并保持认证子窗隔离 | PASS | `g1-closure.md`、`us1-automated.md` |
| FR-019 非敏感诊断可区分 Profile 与阶段 | PASS | `windows-sensitive-log-audit.md`、`windows-failure-recovery.md` |
| FR-020 固定持久 Partition、单窗口、无自动游戏入口 | PASS | `shadow-production-path.md`、`static-security-audit.md`、`windows-two-profile-isolation.md` |

## Success Criteria

| 标准 | 签核结果 | 证据 |
| --- | --- | --- |
| SC-001 全新 Profile 官方扫码启动 | PASS，`3/3` | `windows-portable-release.md` |
| SC-002 GAME_MAIN 应用内承载 | PASS，`3/3`，外部浏览器 0 | `windows-portable-release.md` |
| SC-003 每次内部/可见/鼠标三项全过 | PASS，`3/3` | `windows-portable-release.md` |
| SC-004 有效复用与失效回扫码 | PASS，`2/2`、`2/2` | `windows-portable-release.md` |
| SC-005 双 Profile 污染事件 | PASS，0 | `windows-portable-release.md` |
| SC-006 四类故障刷新恢复 | PASS，`4/4` | `windows-portable-release.md` |
| SC-007 Oasis/国际服/密码可见项 | PASS，0 | `oasis-removal.md`、`us1-checkpoint.md` |
| SC-008 日志与诊断敏感泄露项 | PASS，0 | `windows-sensitive-log-audit.md`、本文件敏感证据审计 |

## 自动验证与已知基线

- T060–T064 清理后的各组定向 Jest 与 ESLint 均通过，详见
  `final-automated.md`；
- T065 全量 Jest 为 `30/31` suites、`866/877` tests，通过项之外的 11 个失败全部是
  T001 已留证的 Windows/Linux `GpuDetector.test.js` mock 基线；
- Jest open-handle/force-exit 提示也是 T001 基线；
- 强制 `Page.crash` 造成 killed renderer 后无法恢复原窗口，是用户已接受的低概率限制；
  关闭并重开所属游戏窗口可恢复，Profile/Session 不会被删除。该限制不属于 SC-006 四类
  规定故障分母。

## 最终判定

FR-001 至 FR-020 全部 PASS，SC-001 至 SC-008 全部 PASS。portable 发布矩阵、Session
隔离、四类故障恢复、Oasis 清理、静态安全审计和敏感证据检查均满足当前 Feature 规格。
