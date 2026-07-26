# Quickstart: 遗留界面文案清理验证指南

## 前置条件

- Windows 主验证环境；Linux VM/临时用户用于 AppImage 与安装脚本。
- Volta 已选择 Node.js 16.20.2、npm 8.19.4。
- Electron 11.5.0 与仓库随附 PPAPI Flash 保持不变。
- 使用测试 QQ 账号；不读取 QQ 密码、Cookie/Storage 或身份参数。
- 全新/遗留配置测试必须使用隔离的 Windows 测试用户、VM 或可丢弃 portable 副本，禁止删除真实用户的 `userData`。

版本确认：

```powershell
node --version
npm --version
```

预期：分别为 `v16.20.2`、`8.19.4`。

如依赖未安装：

```powershell
npm ci --no-audit --no-fund
```

预期：安装成功，`package-lock.json` 哈希不变。

## 自动检查

### 1. 文案与核心回归

```powershell
npm test -- --runInBand src/config/__tests__/settings.test.js src/ui/__tests__/copy-boundary.test.js src/ui/__tests__/developer-copy.test.js src/ui/__tests__/tencent-ui.test.js src/ui/manager/__tests__/IpcRouter.test.js src/utils/__tests__/diagnostics.test.js src/utils/__tests__/logger.test.js src/app/__tests__/Launcher.test.js src/app/__tests__/TencentLaunchFlow.test.js src/app/__tests__/SessionLifecycle.test.js src/profiles/__tests__/partition.test.js
```

预期：

- `zh-CN` 默认/fallback 与葡语迁移矩阵全部通过。
- launcher-owned 可见面中未授权葡语、Oasis 当前入口和普通英文动作项为 0。
- setup/runtime locale 集合一致且不含葡萄牙语。
- 动态 loading、dialog/toast、诊断 README 与 Linux 展示文案符合合同。
- 活动生产代码中的 logger 模板、启动横幅、异常摘要和开发诊断固定文本 100% 为 ASCII 英文，不含葡语、中文固定模板、Oasis/旧品牌或装饰性 Unicode。
- 路径、Profile 名、原始错误和结构化字段仍作为动态值保留并经过既有脱敏。
- 腾讯流程、SessionLifecycle、Partition 和 Launcher 核心断言全部通过。

### 2. 全量测试与质量

```powershell
npm test -- --runInBand
npm run lint
npx prettier --check "src/**/*.{js,html,css,json}" "tests/**/*.js"
```

预期：全部退出码为 0；不得把既有无关警告冒充本功能通过或失败，需单独记录。

### 3. Linux 脚本语法

```powershell
wsl -e bash -lc "cd /mnt/d/flash-auto-scripts/naruto-online-launcher && bash -n linux/install.sh linux/uninstall.sh linux/run.sh"
```

预期：退出码 0；该命令只做语法检查，不执行安装或删除。

### 4. Diff 门禁

```powershell
git diff --check
git diff -- package-lock.json src/config/urls.js src/preload.js src/main/flags.js
git diff -- src/app/TencentLaunchFlow.js src/app/SessionLifecycle.js src/profiles/partition.js src/flash src/network/inspector.js src/utils/logger.js
git diff -- package.json
```

预期：

- 无空白错误。
- 完全不修改列表无输出。
- 行为所有者列表只允许 developer text contract 登记的 logger 固定字面量或 logger ASCII 前缀变化；调用数量、级别、第二参数、控制流和其他逻辑无变化。
- `package-lock.json` 无输出。
- `package-lock.json` SHA-256 仍为 `DCD47B4DB444A346645678D5E63108E6465C77107A568BE3129D666744ACB226`。
- `package.json` 只允许 desktop 展示元数据变化；`productName`、appId、依赖、Volta 和可执行文件名不变。

## Windows 人工 E2E

### 1. 全新配置第一帧

1. 在隔离测试用户/VM 中首次运行。
2. 观察 setup 窗口出现前后的标题和首帧，不要先点击语言。
3. 检查欢迎语、语言名称、性能模式、说明和按钮。
4. 完成 setup 后检查管理窗口标题、HTML、空态、工具提示与辅助访问文本。

预期：

- 第一帧即为简体中文，`lang` 为 `zh-CN`，中文为默认 active。
- 没有葡萄牙语选项、`pt-BR`、葡语句子、Oasis 当前入口或 `Shinobi Launcher` 可见品牌。
- Flash、GPU、RAM、Profile 等允许技术词处于中文上下文。
- setup 保存后正常进入管理窗口。

### 2. 遗留与异常语言矩阵

在隔离环境分别准备以下 `config.json` 场景，每次记录启动前后语言、`firstBoot`、`windowBounds`、性能偏好及 Profile 数量：

1. 缺少 `language`
2. `language: ""`
3. `language: "invalid"`
4. `language: "pt"`
5. `language: "pt-BR"`
6. `language: "pt_BR"`
7. 对照：`language: "zh-CN"`
8. 对照：一个保留的非葡语显式 locale

预期：

- 1-6 首次可见面均为中文；7 保持中文；8 仅在显式选择时保持。
- 其他配置值不变，Profile 文件未重建，既有 Partition/Session 目录未重命名或清理。
- 如实现选择在本次运行持久化规范值，写回也只能改变 `language` 及用户在 setup 明确修改的字段。

### 3. 管理与错误面

依次覆盖：

- 新建、编辑、删除、取消删除 Profile。
- 无名/复制等可生成名称的模块路径。
- 达到 Profile 上限、找不到 Profile、游戏窗口未关闭时删除。
- 搜索无结果、内存状态不可用、诊断导出成功/失败。
- Profile 导入/导出文件对话框。
- 窗口置顶、最小化、最大化标题。

预期：启动器摘要、按钮与标题为中文；原始错误码不作为普通主体文案；CRUD、文件限制和窗口行为不变。

### 4. 游戏初始加载与腾讯官方页面

1. 从管理界面打开一个新 Profile。
2. 观察实际 `data:` 初始加载页。
3. 等待腾讯 selector，完成官方扫码与手动选服。
4. 对比普通浏览器中的官方页面布局与交互。

预期：

- 初始 loading 文案中文，Profile 名安全显示。
- 腾讯官方页面未被翻译、隐藏、改样式或写入 DOM。
- 二维码、官方确认和手动选服仍由腾讯页面完成。
- 不采集账号密码，不出现 Oasis/国际服回退。

### 4.1 Windows 启动日志可读性

在未预先切换到 UTF-8 的普通 Windows `cmd.exe` 中运行：

```bat
chcp
npm start
```

观察从启动横幅到配置加载、Flash PPAPI 搜索、管理窗口就绪的日志；完成一次扫码进入游戏和刷新后退出。

预期：

- 启动器编写的固定部分全部是可读、可复制搜索的 ASCII 英文。
- 日志级别显示为 `[DEBUG]`、`[INFO]`、`[WARN]` 或 `[ERROR]`，产品横幅为 `Naruto Online Launcher`。
- 不出现 `鈩癸笍`、`鈫?`、`regi茫o` 等由固定模板造成的乱码，不出现葡萄牙语或旧启动器品牌。
- 配置、Flash、Profile、Session、导航和刷新事件可用稳定英文关键词定位。
- 中文 Profile 名、中文路径或外部错误等动态值保持原样；其显示效果可受终端代码页影响，但不得被启动器翻译、删除或音译。

### 5. 双 Profile、Session 与恢复

1. 新建 Profile A、B。
2. 分别完成扫码、手动选服与 Flash 进入，记录 `2/2`。
3. 同一主进程内重新聚焦/刷新 A，确认只作用于 A。
4. 让 A 的 Session 失效或返回 selector，确认 B 仍保持。
5. 覆盖一次页面失败和一次 renderer/Flash 恢复。

预期：

- A/B 使用不同持久 Partition，跨 Profile 污染为 0。
- F5/管理刷新只 reload 当前安全角色，不清 Session。
- 恢复次数有界，无无限刷新、无限重试或 Oasis 回退。
- Flash 可见且至少完成一次鼠标交互。

### 6. Flash 缺失原生错误

仅在可丢弃的 portable 副本中临时移走该副本的 PPAPI 文件后启动；不要修改工作仓库或真实安装。

预期：单次中文错误框说明安装损坏和 Flash 要求，关闭后以失败状态退出；恢复副本文件后可正常启动。

### 7. 诊断导出边界

1. 主动导出诊断 ZIP。
2. 检查保存对话框、默认名称和生成 README。
3. 检查 ZIP entry 清单及一份无敏感信息的测试日志。

预期：

- 对话框与 README 中文。
- `config.json`、`profiles.json`、历史 crash 和 `logs/*` 的存在/内容结构未被葡语/Oasis 关键字清洗。
- 既有脱敏仍有效，不含 QQ 密码、Cookie、Authorization、token 或身份值。

## Linux VM / 临时用户验证

### 1. 展示与非破坏分支

- 运行 `bash linux/uninstall.sh --help`。
- 在无 AppImage 的临时目录运行安装脚本，覆盖缺文件提示。
- 覆盖安装取消、缺依赖提示和 `run.sh` 缺启动文件分支。

预期：人类可读输出为中文；命令、路径、参数和退出码保持。

### 2. 真实安装与 desktop

只在临时用户或 VM：

1. 使用测试 AppImage 完成安装。
2. 检查应用菜单名称、说明、通用名称和卸载动作。
3. 启动应用，确认现有 `StartupWMClass` 和配置路径工作。
4. 运行卸载，确认提示、进度和完成文案。

预期：

- 启动器自有文案中文，无葡语/Oasis 当前入口或可见 `Shinobi Launcher` 品牌。
- `Exec`、`Categories`、`Keywords`、`StartupWMClass`、路径和删除目标未因翻译改变。
- 卸载只删除合同列明的现有目标，审计日志仍生成。

## 构建验收

```powershell
npm run build:win
npm run build:linux
```

预期：Windows portable 与 Linux AppImage 均构建成功；在对应平台真实启动后，系统窗口标题、desktop 入口和第一帧符合中文合同，既有 `userData`、Profile 与 Session 连续。

## 结果记录模板

| 验证项 | 环境/Profile | 结果 | 证据 | 风险/备注 |
| --- | --- | --- | --- | --- |
| 自动定向测试 | Node/Electron 版本 | PASS/FAIL | suite/test 数 | |
| 全量测试/lint/format | 本机 | PASS/FAIL | 命令输出 | |
| 语言矩阵 | 隔离 Windows 用户/VM | passed/attempted | 配置前后摘要 | |
| 可见面审计 | Surface Registry | passed/attempted | 合同表 | |
| 开发者运行文本 | 默认 Windows cmd + 自动合同 | PASS/FAIL | ASCII/禁词计数、启动日志 | 动态 Unicode 单独记录 |
| 双 Profile | A/B | passed/attempted | 仅脱敏结果 | |
| 官方页面不修改 | selector/auth/game | PASS/FAIL | 视觉/交互结论 | 不记录认证原文 |
| Flash | Profile A/B | passed/attempted | 可见+交互 | |
| Windows portable | Windows | PASS/FAIL | 构建/启动 | |
| Linux AppImage/脚本 | 临时用户/VM | PASS/FAIL | 构建/安装/卸载 | |
| 诊断边界 | 测试 Profile | PASS/FAIL | entry/脱敏结论 | 不保存敏感原文 |
