# 安全边界

## 腾讯登录

- 只使用腾讯官方网页扫码登录。
- 不要求、采集或保存 QQ 密码。
- 不伪造、解密、重放或绕过登录票据、验证码与风控。
- 不通过脚本注入凭据，不恢复旧 Oasis API 登录与临时邮箱模块。

## Session 隔离

每个 Profile 固定映射到唯一的 `persist:profile-<id>`。启动器不读取、复制、导出或跨 Profile 恢复 Cookie。删除 Profile 时只删除该 Profile 的本地数据。

## 导航

`TencentLaunchFlow` 只接受配置中定义的腾讯官方 URL 角色。未知顶层导航会被阻止并转为可恢复状态。选服由用户在官方页面完成。

## 网络与诊断

安全 Inspector 在采集入口即丢弃完整 URL、query、headers、body、Cookie 与页面源码，只保留：

- resource type
- origin
- pathname
- status code
- error code

日志不得包含凭据、Cookie、票据或完整认证 URL。诊断包只能由用户主动导出。

## PPAPI 风险

Electron 11 与 PPAPI Flash 均已停止维护。游戏窗口为了兼容腾讯 Flash 资源保留旧 Chromium/插件相关设置，因此只允许加载已分类的官方游戏流程，不应接入任意不可信 URL。Flash 二进制随仓库和发行包提供；缺失时应用报错退出，不自动下载替换。

## 报告问题

安全问题请通过仓库维护者提供的私密渠道报告，不要在公开 issue 中提交 Cookie、二维码、票据、日志原文或个人信息。
