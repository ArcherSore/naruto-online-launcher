# 贡献指南

## 环境

使用项目 Volta 配置：

- Node.js 16.20.2
- npm 8.19.4
- Electron 11.5.0

```powershell
npm ci --no-audit --no-fund
```

不要升级 Electron 或替换 PPAPI Flash 链；不要无故修改 `package-lock.json`。

## 开发与验证

```powershell
npm start
npm run lint
npx prettier --check "src/**/*.{js,html,css,json}" "tests/**/*.js"
npm test -- --runInBand
npm run build:win
```

涉及腾讯扫码、页面跳转或 Flash 的改动必须在交付时提供人工验证步骤。自动测试不得采集凭据、伪造票据或绕过腾讯认证。

## 代码边界

- 登录只走腾讯官方网页。
- 每个 Profile 必须使用独立持久 Partition。
- URL 分类、Session、窗口、Flash 与自动化模块保持职责清晰。
- Inspector 与日志不得记录 Cookie、headers、body、完整认证 URL 或票据。
- 不恢复 Oasis API login、tempmail、Vault 或页面凭据注入。

提交应围绕当前任务，避免无关格式化和大规模重命名。
