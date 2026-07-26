# 架构说明

## 进程与隔离边界

Electron 主进程负责配置、Flash flags、Profile Store、管理窗口与游戏窗口。每个游戏窗口对应一个 Profile，并固定绑定 `persist:profile-<id>`。不同 Profile 不共享、复制或恢复 Cookie。

```text
Manager renderer
  -> IpcRouter
    -> ProfileManager
      -> Launcher
        -> BrowserWindow(partition=persist:profile-<id>)
          -> SessionLifecycle
          -> TencentLaunchFlow
          -> KeyboardShortcuts
          -> Auditor
```

## 启动顺序

1. `src/main.js` 在 Electron ready 前读取配置、探测 PPAPI 文件并调用 `src/main/flags.js`。
2. 缺少内置 Flash 时停止启动并显示安装损坏提示，不在线下载插件。
3. ready 后加载 Profile Store、初始化 MemoryGuard 与管理窗口。
4. `ProfileManager.launch()` 委托 `Launcher` 创建隔离窗口。
5. `TencentLaunchFlow` 从腾讯官方选服页开始，分类官方认证、选服与游戏 URL。
6. `SessionLifecycle` 只处理窗口 load、crash、responsive 与 close 等通用事件。

## 模块职责

- `src/app/Launcher.js`：窗口创建、registry、Session 与流程装配。
- `src/app/TencentLaunchFlow.js`：腾讯页面状态机、认证子窗、导航约束与有界恢复。
- `src/app/SessionLifecycle.js`：通用窗口生命周期与 Session flush。
- `src/app/StallDetector.js`：关键 SWF 加载停滞检测。
- `src/app/Auditor.js`：按 Profile 保存游玩时长、crash、stall 与 reload 统计，不保存 URL、Cookie 或凭据。
- `src/profiles/store.js`：Profile 通用元数据。
- `src/profiles/partition.js`：Profile 到持久 Partition 的固定映射。
- `src/network/inspector.js`：只记录 resource type、origin、pathname、status code、error code。
- `src/ui/manager/IpcRouter.js`：管理窗口 IPC。
- `src/memory/MemoryGuard.js`：低内存模式判断与轻量状态；不执行强制 renderer GC。

## Flash

`src/flash/plugin.js` 选择平台二进制，`src/main/flags.js` 在 ready 前注入 `ppapi-flash-path` 与版本。二进制通过 `package.json.build.extraResources` 进入发行包。

## 数据

- 全局配置：Electron `userData/config.json`
- Profile：Electron `userData/profiles/profiles.json`
- Chromium 登录态：对应 Profile 的持久 Partition
- Auditor：Electron `userData/audit/`
- 日志与诊断：本地文件，诊断导出由用户主动触发
