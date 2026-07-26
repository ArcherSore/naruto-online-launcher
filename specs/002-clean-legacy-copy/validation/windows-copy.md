# Windows 文案与语言矩阵

## 自动证据

- `settings.test.js`：缺失、空、无效、非字符串、`pt`、`pt-BR`、`pt_BR` 均规范化为 `zh-CN`。
- 其他 `firstBoot`、`advancedMode`、窗口/性能配置保持。
- `copy-boundary.test.js`：setup 第一帧、active 按钮、runtime/setup locale parity 通过。
- Windows portable 构建成功。

## 人工结果

`NOT RUN`：未在隔离 Windows 用户/VM 中启动全新及八类配置，也未检查 500×400 窗口中文截断。不得把自动断言视为第一帧人工 PASS。
