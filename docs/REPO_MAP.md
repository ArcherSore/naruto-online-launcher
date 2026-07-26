# Repository Map（main 上游基线）

`main` 已同步 `Chrispsz/naruto-online-launcher` 的 v1.4.0 压缩历史，作为腾讯国服改造的技术基线。腾讯扫码、选服、Session 隔离与安全边界的完整实现位于 `001-tencent-game-launch` 分支。

## main 核心目录

| 路径 | 职责 |
| --- | --- |
| `src/main.js` | Electron 启动编排 |
| `src/app/` | 窗口、生命周期、性能、Auditor |
| `src/config/` | URL、地区、设置与优化配置 |
| `src/flash/` | PPAPI 探测与 `mms.cfg` |
| `src/memory/` | 轻量 MemoryGuard |
| `src/network/` | 上游网络模块 |
| `src/profiles/` | 上游 Profile 与 Partition |
| `src/ui/` | 管理窗口与 renderer |
| `src/utils/` | 日志、诊断和 throttle/debounce |
| `flash/` | Windows/Linux PPAPI 二进制 |
| `.github/workflows/` | CI 与发行构建 |

## 上游 v1.4 主要变化

- 历史被压缩为新的根提交，因此本仓库通过无共同祖先的 merge 保留双方历史。
- 新增 `src/app/Auditor.js` 与 `src/utils/throttle.js`。
- 删除 `FlashUpdater`、`GcDaemon`、旧 debug 脚本、部分测试与调试工具。
- Flash 二进制继续随仓库和发行包提供；缺失时不再在线下载。
- Electron 仍为 11.5.0，electron-builder 仍为 22.14.13。

## 本仓库工具链

本项目继续使用 Volta 固定 Node.js 16.20.2 与 npm 8.19.4。上游 workflow 的 Node 20 不是完整迁移基线：上游 `package.json` 仍声明 Node `>=16`，且原 lockfile 存在版本与 Playwright 条目漂移。

## 腾讯功能分支

在 `001-tencent-game-launch` 分支中重点阅读：

- `src/app/TencentLaunchFlow.js`
- `src/app/Launcher.js`
- `src/app/SessionLifecycle.js`
- `src/config/urls.js`
- `src/profiles/partition.js`
- `src/ui/manager/IpcRouter.js`
- `specs/001-tencent-game-launch/`

腾讯功能分支不采集 QQ 密码、不恢复 Oasis API 登录、不读取或复制 Cookie，并为每个 Profile 固定使用独立持久 Partition。
