# Behavior Preservation Contract: 登录、Session、导航与 Flash

## 目的

把用户文案/开发者固定文本的允许变更点与必须保持的核心行为分开，防止在清理过程中误删页面探针、改动 Partition、重写导航或破坏 Flash。

## 行为逻辑不修改的所有者

| 模块 | 不变合同 | 自动证据 |
| --- | --- | --- |
| `src/app/TencentLaunchFlow.js` | 只允许 logger 固定字面量 ASCII 英文化；腾讯 selector/auth/game 角色、弹窗路由、只读探针、有界恢复和状态快照不变 | `TencentLaunchFlow.test.js` + developer text contract |
| `src/app/SessionLifecycle.js` | 只允许 logger 固定字面量 ASCII 英文化；load/crash/responsive/close 委托、Session flush、无页面注入/清 Session 路径不变 | `SessionLifecycle.test.js` + developer text contract |
| `src/profiles/partition.js` | 只允许 logger 固定字面量 ASCII 英文化；`persist:profile-<id>` 稳定映射、A/B 不同 Partition、Session 获取不变 | `partition.test.js` + developer text contract |
| `src/config/urls.js` | 腾讯官方 URL、角色判定和敏感参数排除不变 | `urls.test.js` |
| `src/preload.js`、`src/ui/manager/KeyboardShortcuts.js`、`src/ui/manager/StateBroadcaster.js` | 只允许 logger 固定字面量 ASCII 英文化；最小 bridge、F5 当前安全角色刷新、安全状态广播字段不变 | KeyboardShortcuts/StateBroadcaster tests + developer text contract |
| `src/flash/plugin.js`、`src/flash/mms.js`、`src/main/flags.js` | 只允许 logger 固定字面量 ASCII 英文化；PPAPI 发现、mms.cfg、Chromium flags 不变 | 现有 Flash/flags 测试与启动验证 + developer text contract |
| `src/network/inspector.js` | 只允许 logger 固定字面量 ASCII 英文化；安全字段 allowlist 与有限网络元数据不变 | inspector tests + developer text contract |
| `src/utils/logger.js` | 只允许固定级别前缀改为 ASCII；安全字段 allowlist、脱敏、transport、level、轮转和导出 API 不变 | logger tests + developer text contract |

上述模块中，logger 第一参数之外的 diff 仍须停止并回到规格/计划；logger 调用数量、级别、第二参数或控制流变化也不属于允许点。

## 混合模块允许点

| 模块 | 允许修改 | 禁止改变 |
| --- | --- | --- |
| `src/main.js` | i18n 默认/保存 fallback、setup 标题/URL locale、Flash 缺失可见对话框、logger 固定模板与启动横幅 | ready 流程、Flash 检测/退出、setup 标题哨兵、`advancedMode`、管理窗初始化、窗口事件 |
| `src/app/Launcher.js` | `loadingPage()` 的可见文字 | BrowserWindow 参数、`plugins:true`、Partition、User-Agent、registry、TencentLaunchFlow/SessionLifecycle/快捷键挂接与调用顺序 |
| `src/ui/manager/IpcRouter.js` | 用户 toast/dialog 文案、语言 allowlist 来源、logger 固定模板和启动器自编机器错误摘要 | IPC channel、Profile 输入/输出 allowlist、恢复 action、Session/inspector、文件大小限制、handler 调用 |
| `src/profiles/store.js` | 自动生成的可见名称/副本相关显示值、logger 固定模板 | schema、Profile ID、迁移 allowlist、Partition 删除、日志调用结构与导入去重 |
| `src/utils/diagnostics.js` | 生成 README、保存对话框、展示文件名、logger 固定模板和启动器自编异常摘要 | entry 集合、日志/crash 原文、动态错误、脱敏、大小限制、ZIP 结构 |
| `src/ui/setup/setup.html` | 静态/字典文案、locale 集合/default/lang 属性 | CSP、性能模式值、`advancedMode`、`__SETUP_DONE__` payload、关闭时序 |
| `src/ui/loading/loading.html` | 可见静态/动态文案 | `setProgress`、phase 值、百分比/速度/ETA 解析、恢复 action/bridge |
| Linux 脚本 | 展示/确认字符串、desktop 展示字段 | 控制流、路径、变量、命令、删除目标、退出码、审计日志结构 |
| `package.json` | desktop `Comment`/`GenericName` 等展示元数据 | `name`、`productName`、appId、版本、依赖、scripts、引擎、Volta、可执行文件名 |

## 官方网页合同

- 不新增或修改腾讯页面 DOM、样式、文本、资源或响应的写入。
- 不注入翻译、隐藏元素、替换标题或代理官方文案。
- 现有 `TencentLaunchFlow` 只读探针允许继续查询固定 `.qConnectLogin iframe.loginframe` 的可见性并有界观察；单次预算 3 秒、每阶段最多 3 次、全流程最多 12 次，均保持不变。不得把“官网不修改”误解为删除该既有流程。
- 不读取或持久化新的 Cookie/Storage、身份参数、表单值或完整敏感 URL。
- 本功能不需要用户授权诊断；如实现中出现需要原始认证数据的主张，立即停止并回到规格。

## Session 隔离合同

- 同一 Profile 始终使用同一 `persist:profile-<id>`。
- 两个不同 Profile 的 Partition/Session 必须不同。
- 语言规范化只作用于全局配置，不读取、写入、复制或清理任何 Profile Session 数据。
- 遗留 `pt` 配置迁移不得重命名 `productName`、用户数据目录、Profile ID 或 Partition。
- 一个 Profile 的 Session 失效、刷新、关闭或诊断不得影响另一个 Profile。

## 导航与恢复合同

- 启动仍从腾讯 selector 开始，由用户完成官方扫码与手动选服。
- 认证弹窗与父 Profile 继续共享正确 Partition，窗口安全参数不变。
- F5/管理卡片刷新只 reload 当前安全角色，不清 Session、不回退 Oasis。
- 页面/阶段自动恢复保持每类一次，renderer crash 保持 10 分钟内最多 3 次，stall 保持现有上限与等待用户状态；不得新增无限刷新/重试。
- loading 文案替换不得改变 `ready-to-show` 后启动流程的时序。

## Flash 合同

- Electron 继续以 `plugins:true` 创建游戏窗口并使用现有 PPAPI 路径/版本。
- Flash 缺失对话框只翻译文字；检测失败仍记录错误、显示单次阻塞对话框并以相同失败码退出。
- 不修改 `mms.cfg`、低配模式、GPU/CPU flags、mixed-content/webSecurity 现有基线或 SWF stall 逻辑。
- 休眠下载 loading 页的 phase 协议即使当前不可达也保持。

## 自动门禁

至少运行：

```powershell
npm test -- --runInBand src/config/__tests__/settings.test.js src/ui/__tests__/copy-boundary.test.js src/ui/__tests__/tencent-ui.test.js src/ui/manager/__tests__/IpcRouter.test.js src/utils/__tests__/diagnostics.test.js src/app/__tests__/Launcher.test.js src/app/__tests__/TencentLaunchFlow.test.js src/app/__tests__/SessionLifecycle.test.js src/profiles/__tests__/partition.test.js
npm test -- --runInBand src/ui/__tests__/developer-copy.test.js src/utils/__tests__/logger.test.js
npm test -- --runInBand
npm run lint
npx prettier --check "src/**/*.{js,html,css,json}" "tests/**/*.js"
```

Linux 只读语法门禁：

```powershell
wsl -e bash -lc "cd /mnt/d/flash-auto-scripts/naruto-online-launcher && bash -n linux/install.sh linux/uninstall.sh linux/run.sh"
```

门禁还必须核对：

- `package-lock.json` 无 diff。
- `package-lock.json` SHA-256 仍为 `DCD47B4DB444A346645678D5E63108E6465C77107A568BE3129D666744ACB226`。
- 行为所有者只允许 developer text contract 登记的固定字面量 diff；协议与行为模块的其他 diff 为 0。
- `package.json.productName`、appId、可执行文件名、Volta 和依赖区无 diff。
- 混合模块的 diff 只落在允许点。

## 人工门禁

1. 隔离 Windows 环境的六类语言配置第一帧与数据保持。
2. 两个 Profile 的扫码、手动选服、Flash 进入为 `2/2`。
3. 同 Profile Session 复用/失效和双 Profile 隔离。
4. 至少一个页面失败、一个刷新、一个 renderer/Flash 恢复场景保持有界。
5. 腾讯官方页面视觉/交互无启动器翻译或 DOM 写入。
6. Windows portable 与 Linux AppImage 的真实启动。
7. Linux 安装、取消/失败、desktop、help 和卸载仅在临时用户/VM 执行。

任何核心回归、新的敏感数据读取、跨 Profile 污染、官网写入或锁文件变化均为阻塞失败。
