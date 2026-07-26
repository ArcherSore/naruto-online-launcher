# 受保护内容验证

## 自动结果

- 腾讯流程、URL 分类、SessionLifecycle、Partition、inspector、logger 全部测试通过。
- 完全不修改模块无 diff。
- diagnostics ZIP entry、历史 crash、日志读取、脱敏与大小限制测试通过。
- 卸载审计日志、兼容目录/文件名、machine error 字段被分类为受保护保留。

## 人工结果

`NOT RUN`：未打开真实腾讯 selector/auth/game 页面进行视觉对比，未导出真实诊断 ZIP。没有读取或保存 QQ 密码、Cookie/Storage、认证参数或腾讯页面原文。
