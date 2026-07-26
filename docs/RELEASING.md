# 发布与构建指南 (Releasing Guide)

本文档说明 **Naruto Online CN Launcher (腾讯《火影忍者 OL》国服桌面启动器)** 的版本发布与打包流程。

## 环境要求

项目通过 Volta 锁定了固定的 Node.js 与 Electron 版本：

- **Node.js**: `16.20.2`
- **npm**: `8.19.4`
- **Electron**: `11.5.0` (内置 Flash PPAPI 支持)

## 手动发布流程 (Release Workflow)

为了确保安全与离线可控，项目采用 **“本地打包 + 手动创建 GitHub Release”** 模式，打包脚本中禁用了自动上传（`--publish never`）。

### 1. 代码准备与校验

发布前，在本地运行完整的校验与单元测试：

```powershell
# 安装依赖
npm ci --no-audit --no-fund

# 运行代码规范检查
npm run lint

# 运行全量单元测试
npm test
```

### 2. 更新版本与 Changelog

确认 [package.json](file:///d:/flash-auto-scripts/naruto-online-launcher/package.json) 与 [package-lock.json](file:///d:/flash-auto-scripts/naruto-online-launcher/package-lock.json) 中的版本号一致（例如 `1.0.0`），并在 [CHANGELOG.md](file:///d:/flash-auto-scripts/naruto-online-launcher/CHANGELOG.md) 中记录变更要点。

### 3. 本地打包构建

根据目标平台生成安装包：

- **Windows x64 Portable**:
  ```powershell
  npm run build:win
  ```
  打包产物将位于 `dist/NarutoOnline 1.0.0.exe`。

- **Linux AppImage**:
  ```bash
  npm run build:linux
  ```
  打包产物将位于 `dist/naruto-online-1.0.0.AppImage`。

### 4. Git 标签与手动 GitHub Release

构建成功且本地测试无误后：

```powershell
# 提交发布修改
git add -A
git commit -m "chore(release): v1.0.0"

# 创建 Release 标签
git tag -a v1.0.0 -m "v1.0.0 — 火影忍者 OL 启动器"

# 推送到 ArcherSore 远程仓库
git push origin main
git push origin v1.0.0
```

推送到带有 `v*` 的 Tag 时，GitHub Actions 会自动触发 `.github/workflows/build-release.yml`，在云端并行构建 Windows 与 Linux 的产物压缩包。你也可以直接打开 GitHub Release 界面，手动上传本地 `dist/` 中生成的构建产物。
