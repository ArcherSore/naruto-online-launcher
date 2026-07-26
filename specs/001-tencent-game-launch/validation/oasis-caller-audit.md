# T059 Oasis 调用者与安全 Inspector 去留审计

记录日期：2026-07-26  
审计方式：`rg` 全引用扫描 + 生产入口逐文件调用链复核  
结论：**PASS，可进入 T060–T062**

## 审计范围与分类规则

审计覆盖 `src/main.js`、`src/app/`、`src/profiles/`、`src/ui/`、
`src/network/` 及其测试，并补充检查被上述生产文件引用的 `src/config/` 和
`src/utils/`。命中按以下三类区分：

1. 当前腾讯生产入口实际可调用的能力；
2. 仅证明腾讯生产路径“不调用旧能力”的替代回归；
3. 只验证旧 Oasis/shadow 模块自身行为、应随模块删除的测试。

`require()` 造成的模块加载边只说明仍有迁移残留；只有从 `main.js`、manager IPC、
窗口生命周期或当前 renderer 入口能继续调用到相应行为，才视为当前业务调用者。

## 凭据、认证与加密备份栈

| 模块/能力 | 当前生产调用关系 | 分类与决策 |
| --- | --- | --- |
| `network/api-login.js` | 只调用 `network/tempmail.js`；无生产文件导入 | Oasis 自身实现，T060 删除 |
| `network/tempmail.js` | 只被 `api-login.js` 导入，并导入 `utils/jwt.js` | Oasis 自身实现，T060 删除 |
| `utils/jwt.js` | 只被 `tempmail.js` 和自身测试导入 | Oasis 自身实现，T060 删除 |
| `ProfileVault.js`、`PasswordManager.js`、`vault.js` | `profiles/manager.js` 仍有顶层加载边和旧 facade 方法；当前 `main.js` 只调用 manager 的 `setMemoryGuard`、`launch`、`close`，`SessionLifecycle` 只调用 `reportCrash`；当前 manager IPC 直接使用 `store`，不注册 Vault/密码/自动登录通道 | 没有腾讯业务行为调用者。T060 先断开 manager 的旧加载边、展示字段、清理调用和 facade，再删除模块及旧自测 |
| `CryptoService.js` 的凭据加密/加密备份 | 只被上述 Vault 栈和旧自测引用 | 无独立非凭据用途，T060 删除 |

当前生产路径中不存在 `api-login`、`tempmail`、JWT 解码、凭据读取、表单自动登录或
加密凭据备份的入口。`IpcRouter.test.js` 与 `tencent-ui.test.js` 中相关命中属于
“禁止重新注册/显示”的负测试，应作为替代回归保留。

### 通用 Profile 备份不是凭据备份

以下能力有当前非凭据用途，必须保留：

- `profiles/store.js` 在原子保存 `profiles.json` 时生成 `.bak`，并在主文件损坏时恢复；
- `IpcRouter.js` 的 `profiles:export/import` 和文件版通道只委托 `store.exportJSON()` /
  `store.importJSON()`，承载通用 Profile 元数据；
- `store.test.js` 已验证导出数据不含凭据和身份字段。

因此 T060 只删除 `CryptoService` 的加密凭据备份，不删除 `store` 的 `.bak` 恢复或
通用 Profile 元数据导入导出。

## Oasis URL、地区/服务器与旧网络改写

| 模块/能力 | 调用者分类 | 决策 |
| --- | --- | --- |
| `network/blocker.js` | 无生产导入；`Launcher.test.js` 仅 mock 并断言腾讯启动不调用；`blocker.test.js` 只验证旧模块 | T061 删除模块与旧自测，保留腾讯“不调用旧改写”的负断言 |
| `network/cookies.js` | 无生产导入；`Launcher.test.js` 仅 mock 并断言不调用；`cookies.test.js` 只验证旧 Cookie 延寿/CSP/清理模块 | T061 删除模块与旧自测，不添加腾讯 Cookie/CSP 替代改写 |
| `ui/server-selector.js` | 无生产导入，当前 UI/IPC 也无 `servers:*` 通道 | T061 删除 |
| `utils/EventTimers.js` 的 `br/na/eu/hk` Oasis 活动表 | 仍由 `main.js` 启停，并由 `IpcRouter`/`StateBroadcaster` 保留旧事件接线；当前 renderer 不消费 `events:*` 或 `events:update` | 仅为旧国际服残留、没有腾讯用途；T061 原子移除这些调用边、模块和只验证旧活动表的测试 |
| `config/regions.js` 的 `pt/en/fr/de/es/pl` | 被 `settings.js` 用作界面语言/locale 校验，不是游戏服务器地区 | 保留，避免把 locale 配置误删为 Oasis 区服 |
| `config/urls.js` 的 `huoying.qq.com/server/website/` | 腾讯官方选服页的精确角色 URL | 保留；路径中的单词 `server` 不是 Oasis 命中 |

`oasgames.com`、`narutowebgame.com`、`passport.oas*`、`logintype` 和旧
`gamecode` 的生产实现命中均局限于待删除模块；`SessionLifecycle.test.js` 和
`tencent-ui.test.js` 中的命中是防止旧入口回归的源代码负断言。

## Shadow Cookie snapshot/restore

生产调用链复核结果：

- `Launcher` 始终使用 `partition.getPartitionName(profile)`，该函数固定返回
  `persist:profile-<id>`；
- 当前腾讯 launch、close、reload、失效与恢复路径没有
  `snapshotCookies()` 或 `restoreCookies()` 调用；
- `profiles/manager.js` 仅在旧 `remove()` facade 中保留 `removeSnapshot()` 清理调用；
  当前 manager IPC 删除 Profile 时直接走 `store.remove()`，没有调用该 facade；
- `partition.test.js` 的 snapshot/restore/removeSnapshot 大段测试只验证旧模块自身行为；
- `manager.test.js` 中“不调用 snapshot/restore”的测试属于生产路径负测试。

因此不存在 shadow snapshot/restore 的其他生产用途。T062 可以在一个任务内删除：

- `snapshotCookies`、`restoreCookies`、`removeSnapshot` 及其导出；
- `cookie-snapshots.json`、认证域过滤和明文 JSON 持久化实现；
- manager 的遗留清理边；
- 只验证旧 snapshot 模块自身行为的测试。

替代测试必须保留/补充固定 `persist:profile-<id>`、每 Profile 唯一 Session，以及
腾讯生产路径不调用 snapshot/restore 的断言。

## 安全网络 Inspector 去留

决定：**保留** `network/inspector.js` 及当前四个 manager IPC 通道。

理由不是“未来可能有用”或“仍有调用者”，而是本 Feature 的当前证据：

- G1/G2 实际用安全网络元数据定位认证导航、SWF/CDN 与游戏主页面；
- T057 四类故障矩阵继续需要区分 resource、origin/pathname、状态码和错误码；
- T058 已证明普通日志、错误数据链和真实诊断包没有敏感字段泄漏；
- 当前实现只在 webRequest 回调入口生成
  `resourceType/origin/pathname/statusCode/errorCode` 五字段对象，未知过滤字段拒绝；
- 完整 URL、query/fragment、headers、Cookie、Authorization、JWT/ticket、QQ 身份、
  请求体、响应体和页面源码不会进入 entries。

T061 走“保留”分支，仅运行 T007 对应的 inspector、diagnostics、IpcRouter 和 logger
定向安全回归，不扩展 allowlist。

## 测试替换清单

应随旧模块删除：

- `network/__tests__/api-login.test.js`
- `network/__tests__/tempmail.test.js`
- `utils/__tests__/jwt.test.js`
- `profiles/__tests__/CryptoService.test.js`
- `profiles/__tests__/PasswordManager.test.js`
- `profiles/__tests__/ProfileVault.test.js`
- `profiles/__tests__/vault.test.js`
- `network/__tests__/blocker.test.js`
- `network/__tests__/cookies.test.js`
- `utils/__tests__/EventTimers.test.js`
- `partition.test.js` 中只验证 snapshot/restore/removeSnapshot 的区段

应保留或更新：

- `Launcher.test.js`：腾讯启动不安装旧 blocker/cookies；
- `SessionLifecycle.test.js`：不恢复 Vault/API login/Oasis 注入；
- `manager.test.js`：固定持久 Partition，腾讯路径不调用 snapshot/restore；
- `partition.test.js`：固定 persist 映射与 Profile 隔离；
- `IpcRouter.test.js`、`tencent-ui.test.js`：无 Vault、tempmail、server selector、
  凭据备份或 Oasis 可见入口；
- `inspector.test.js`、`diagnostics.test.js`、`IpcRouter.test.js`、`logger.test.js`：
  G0 五字段 allowlist 与禁止敏感数据边界；
- `store.test.js`：通用非凭据 Profile 元数据备份/导入导出。

## 阻塞项判定

未发现凭据认证栈、Oasis 网络改写或 shadow snapshot 的独立腾讯用途。现存
manager/EventTimers 引用均是必须与对应模块同任务断开的旧栈调用边，不构成要求保留旧
能力的“其他生产用途”。若 T060–T062 开始前扫描发现新的外部调用者，应停止对应删除；
以本次审计状态，可按任务顺序继续。
