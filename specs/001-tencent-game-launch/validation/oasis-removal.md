# T063 Oasis 清理后零调用者复核

记录日期：2026-07-26  
结论：**PASS**

## 清理结果

T060–T062 已删除：

- Oasis API login、tempmail、JWT、Vault、PasswordManager、CryptoService 与凭据备份；
- Oasis blocker、Cookie 延寿/CSP 改写、原生国际服 server selector；
- 无 renderer 消费者的 Oasis 活动/区服事件栈；
- shadow Cookie snapshot/restore API、认证域过滤及 `cookie-snapshots.json` 明文路径；
- 只验证上述旧模块自身行为的测试。

通用 Profile 元数据 `.bak` 恢复及非凭据 JSON 导入导出保留。腾讯 Profile 仍固定映射到
`persist:profile-<id>`。

## 零生产调用者

扫描范围：

- `src/main.js`
- `src/app/SessionLifecycle.js`
- `src/app/Launcher.js`
- `src/profiles/manager.js`
- `src/ui/manager/IpcRouter.js`
- `src/ui/app.js`
- `src/ui/index.html`

扫描模式包括 Oasis 域名、`logintype`、旧认证/凭据模块名、blocker/cookies、
server-selector、snapshot/restore 与 `cookie-snapshots`。结果：**0 命中**。

补充扫描全部非测试 `src/**/*.js|html`，结果同样为 **0 命中**。测试中保留的旧名称只用于
“不得重新依赖/显示”的负断言或 G0 合成敏感输入，不构成生产调用者。

正向调用链只剩：

- `Launcher -> TencentLaunchFlow -> config/urls` 的腾讯官方精确 URL 分类；
- `Launcher/ProfileManager -> partition.getPartitionName()` 的固定持久 Session；
- `IpcRouter -> inspector` 的显式安全网络元数据观察。

## 零用户可见旧入口

对 `src/ui/app.js` 和 `src/ui/index.html` 扫描 Oasis、国际服、tempmail、Vault、
password、region、server，结果：**0 命中**。

当前 Profile 卡片只提供通用名称/元数据、打开/显示、刷新、关闭、编辑和删除；没有本地区服
选择、账号密码、临时邮箱、凭据备份或 Oasis 品牌入口。

## Inspector 安全保留结果

`src/network/inspector.js` 仍只声明并生成：

1. `resourceType`
2. `origin`
3. `pathname`
4. `statusCode`
5. `errorCode`

对 inspector、diagnostics、IpcRouter、logger 扫描请求/响应 headers、body、
pageSource、完整 URL/JWT 捕获、Cookie 调试 IPC，结果：**0 命中**。未知 filter 字段继续
默认拒绝。

T061 的 G0/直接影响回归为 `8/8` suites、`199/199` tests PASS。

## 替代回归

- T060：Profile、Store、SessionLifecycle、IpcRouter、管理 UI，
  `5/5` suites、`182/182` tests PASS；
- T061：G0 Inspector/诊断/日志与旧网络调用负断言，
  `8/8` suites、`199/199` tests PASS；
- T062：persist-only Partition、manager 无 snapshot API、Launcher 隔离，
  `3/3` suites、`108/108` tests PASS。

没有为已删除模块保留兼容 facade，也没有要求重跑已删除的旧行为断言。
