# T064 静态安全与范围审计

记录日期：2026-07-26  
方式：生产代码 `rg` 扫描 + 逐命中源码复核  
结论：**PASS**

## 腾讯认证票据

生产代码扫描：

- `session.cookies.get/set/remove`
- `getAllCookies`
- `decrypt`、`replay`、`renew`、`refreshToken`
- `openid`、`access_token`、`ticket`、`skey`、`p_skey`、`uin`、`jwt`

判定：

- Cookie 读取、写入、删除与票据解析/解密/复制/延寿/重放代码为 **0**；
- `SessionLifecycle` 只调用 Chromium `cookies.flushStore()`，不取得 Cookie 名称或值；
- `logger.js` 中的票据字段名只用于输入边界的防御性脱敏正则，不解析或使用票据；
- `diagnostics.js` 中 JWT 仅出现在脱敏注释/拒绝规则；
- video `decode/decoder` 命中属于 Flash/GPU 视频解码，与认证无关。

结论：腾讯认证状态只留在 Profile 独立的 Chromium Session 内。

## 认证 API 与 URL 构造

对非测试生产代码扫描认证/login/token/passport URL、`fetch()`、`https.request`、
`net.request`、`auth API` 与 `login API`：

- 实际网络构造命中为 **0**；
- 唯一文本命中是 `TencentLaunchFlow.reloadCurrentRole()` 注释明确拒绝 API/密码登录；
- `config/urls.js` 只定义已批准的
  `https://huoying.qq.com/server/website/` 与
  `https://game.huoying.qq.com/main.html` 精确顶层角色；
- UNKNOWN URL 继续默认拒绝。

结论：没有未经 Spec 授权的腾讯认证 API。

## 自动点击、自动选服与游戏自动化

生产扫描 `click()`、`dispatchEvent`、`MouseEvent`、auto-select、auto-enter、
select-last-server、enter-game、game-automation、command queue/enqueue 及相关 IPC：
**0 命中**。

逐项复核 `executeJavaScript`：

- `TencentLaunchFlow` 只用固定 selector 查询认证 UI 是否存在/可见，通过
  `getComputedStyle`、`getClientRects` 和有界 `MutationObserver` 返回 boolean；
- 探针不读取文本、表单值、Cookie 或身份参数，不触发 click/submit；
- `main.js` 的调用只更新本地 Flash provisioning loading window；
- `ui/loading/loading.html` 暴露的本地函数只供主进程更新下载进度。

IPC 清单只包含通用 Profile CRUD/launch/refresh/close、固定恢复动作、窗口、内存、
诊断、安全 Inspector、Flash、语言与通用元数据导入导出。`profile:refresh` 和 F5
只重载当前已分类安全角色；`automatic` 来源只表示有界故障恢复，不执行选服或游戏操作。

结论：自动点击、自动选服、进入游戏自动化 IPC/handler 和 command queue 均为 **0**。

## 额外残余清理

首次扫描发现 `config/i18n.js` 仍保留无当前 renderer 消费者的历史 Vault、密码、
auto-login、国际服 region/server 和活动通知文案。它们没有执行路径，但仍可被旧 i18n IPC
读取，因此本任务将其删除并把删除确认改为通用本地 Profile 数据表述。

复扫结果：

- legacy i18n 模式：0 命中；
- `src/config/__tests__/i18n.test.js`：`1/1` suite、`11/11` tests PASS。

## 最终判定

- 腾讯票据解析/解密/复制/延寿/重放：0；
- 未授权腾讯认证 API：0；
- 自动点击/自动选服/游戏自动化命令入口：0；
- 仅测试名称、注释、安全拒绝规则和视频解码误报均已分类，不计为生产能力。
