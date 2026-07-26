# 腾讯《火影忍者 OL》启动器

基于 Electron 11.5.0 与 PPAPI Flash 的腾讯国服专用桌面启动器。

> **产品定位：腾讯国服专用。** 本项目面向腾讯官方《火影忍者 OL》，提供扫码登录、选服与游戏启动体验。

## 核心能力

- 通过腾讯官方页面完成扫码登录、选服与进入游戏。
- 每个 Profile 固定使用独立的 `persist:profile-<id>` Session。
- 登录态只由 Chromium Session 保存；启动器不采集 QQ 密码，不持久化或复制登录票据。
- 支持多 Profile 游戏窗口、后台运行、安全刷新与有界故障恢复。
- 内置 Windows/Linux PPAPI Flash，固定 Electron 11.5.0。
- 提供脱敏网络元数据 Inspector 与用户主动导出的诊断信息。

## 开发环境

项目通过 Volta 固定：

- Node.js 16.20.2
- npm 8.19.4
- Electron 11.5.0

```powershell
npm ci --no-audit --no-fund
npm test -- --runInBand
npm run lint
npx prettier --check "src/**/*.{js,html,css,json}" "tests/**/*.js"
```

源码启动：

```powershell
npm start
```

Windows portable 构建：

```powershell
npm run build:win
```

## 腾讯国服登录流程

1. 在管理窗口创建 Profile。
2. 点击“打开”，启动器创建该 Profile 的隔离游戏窗口。
3. 游戏窗口打开腾讯官方选服页。
4. 用户在官方页面扫码登录并手动选服。
5. 腾讯页面导航到游戏主页面，Flash 在同一 Session 中加载。

登录、选服与进入游戏均通过腾讯官方页面完成。

## 文档

- [仓库导航](docs/REPO_MAP.md)
- [架构说明](ARCHITECTURE.md)
- [安全边界](SECURITY.md)
- [Flash 配置](FLASH_SETUP.md)
- [腾讯启动流程规范](specs/001-tencent-game-launch/spec.md)

## Bug 反馈与问题排查

如果在使用过程中遇到问题或发现 Bug，欢迎通过 GitHub Issues 提交反馈：

1. 提交地址：[GitHub Issues](https://github.com/ArcherSore/naruto-online-launcher/issues)
2. **建议附带的信息**：
   - 问题的具体描述与复现步骤；
   - 操作系统版本及启动器版本；
   - **诊断 ZIP 包**（强力推荐）：
     - 在启动器管理界面点击 **“设置 → 高级 → 导出诊断包”**；
     - 保存生成的 `naruto-online-diag-*.zip` 文件并上传至 Issue 附件中。
     - *（诊断包已包含自动脱敏的系统环境、配置和日志，绝对不含账号密码、Token 或 Session 隐私）*

## 平台

- Windows x64 portable
- Linux x86_64 AppImage（X11/XWayland）
- macOS 不支持 PPAPI Flash

本项目与腾讯、万代南梦宫及相关权利方无隶属关系。
