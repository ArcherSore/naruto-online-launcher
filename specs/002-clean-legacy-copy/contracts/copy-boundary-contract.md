# Copy Boundary Contract: 启动器自有可见文案

## 目的

定义哪些文本必须中文化、哪些英文可以保留，以及哪些葡语/Oasis/Unicode 命中必须因所有权或兼容原因保留。实现和测试只在本合同声明的 launcher-owned 表面上判定“可见遗留文案为零”。

## 语言合同

- 默认和 fallback locale：`zh-CN`
- 遗留迁移：`pt`、`pt-BR`、`pt_BR` → `zh-CN`
- 无效、空或非字符串 locale → `zh-CN`
- 葡萄牙语不得出现在支持集合、语言按钮、运行时字典或 IPC allowlist。
- 其他非葡萄牙语 locale 只有在用户显式选择时才能生效，不得成为默认或 fallback。
- setup 静态首屏、`<html lang>`、默认 active 按钮、内联字典 fallback 与主进程默认必须一致。

## Surface Registry

| Surface ID | 路径 | 触发/现状 | 合同 |
| --- | --- | --- | --- |
| `setup.window` | `src/main.js`、`src/ui/setup/setup.html` | 首次启动；当前默认葡语 | 第一帧中文；无葡语选项；保留标题哨兵、模式与关闭语义 |
| `manager.window` | `src/config/optimization.js`、`src/ui/index.html`、`src/ui/app.js`、`src/ui/manager/ManagerWindow.js` | 常规管理与优化预设；主 HTML 已中文，初始标题/预设元数据残留 | 静态/动态/ARIA/title/预设名称和说明中文；Profile 等允许词在中文上下文 |
| `manager.toast-dialog` | `src/ui/manager/IpcRouter.js` | CRUD、诊断、导入导出和错误 | 用户摘要/标题中文；IPC/error code/原始安全错误字段不翻译 |
| `game.loading.inline` | `src/app/Launcher.js` | 实际创建游戏窗后首个 `data:` 页面 | 可见文本中文；数据 URL、转义、窗口和流程调用不变 |
| `game.loading.asset` | `src/ui/loading/loading.html` | 已打包、当前无生产引用 | 静态/动态阶段、错误、重试中文；进度/恢复协议不变 |
| `native.flash-missing` | `src/main.js` | PPAPI 缺失 | title/message/detail/button 中文；检测和退出码不变 |
| `profile.generated-name` | `src/profiles/store.js`、`src/ui/manager/IpcRouter.js` | 无名创建、复制 | 默认名和副本后缀中文；ID/schema/去重不变 |
| `diagnostics.export` | `src/utils/diagnostics.js`、`src/ui/manager/IpcRouter.js` | 用户主动导出 | 对话框、toast、生成 README 中文；原始 entries 不清洗 |
| `linux.install` | `linux/install.sh` | 交互安装、依赖/取消/成功 | 展示与确认中文；命令、路径、分支、退出码不变 |
| `linux.uninstall` | `linux/uninstall.sh` | help、确认、删除进度、完成 | 展示中文；删除目标和审计日志结构不变 |
| `linux.run-error` | `linux/run.sh` | 缺少启动文件 | 中文摘要；路径与退出码不变 |
| `linux.desktop` | `linux/naruto-online.desktop`、`linux/install.sh` | 应用菜单/卸载动作 | 展示字段中文；`Exec`/`Categories`/`Keywords`/`StartupWMClass` 保留 |
| `package.desktop` | `package.json` | 打包生成 desktop 元数据 | Comment/GenericName 中文；`productName` 与兼容字段保留 |
| `tray-menu-notification` | 现状无实现 | `main.js` 明确无 tray/menu；notification 仅元数据 | 标记 N/A，不为文案任务新增功能 |

## 禁止项

以下内容在 launcher-owned、user-reachable 表面中的允许数量为 0：

- 葡萄牙语 locale：`pt` 作为可选/默认值、`pt-BR`、`pt_BR`、`Português`
- 已识别的葡语 UI 词组，例如 `Bem-vindo`、`Carregando`、`Tentar novamente`、`Perfil não encontrado`、`Exportar perfis`、`Diagnóstico falhou`
- Oasis/国际服当前产品入口：`Oasis`、`narutowebgame.com`、`logintype=` 及国际服登录/地区/服务器能力
- 普通英文 UI 动作或说明：`Save`、`Exit`、`Play`、`Installer`、`Uninstaller`、`Please run the installer again`
- `Shinobi Launcher` 作为当前用户可见产品品牌

禁止项不是全仓规则：历史、测试、协议和兼容标识按下文排除。活动生产代码中的开发者运行固定文本由 [developer-text-contract.md](./developer-text-contract.md) 单独约束，不再作为“普通日志”整体排除。

## 英文技术词允许表

| 类别 | 允许词/示例 | 理由 |
| --- | --- | --- |
| 产品/运行时 | `Naruto Online`、`Flash`、`PPAPI`、`SWF` | 产品专名与核心运行技术 |
| 硬件/性能 | `GPU`、`CPU`、`RAM`、`GC`、`FPS` | 通用技术缩写 |
| 会话/配置 | `Session`、`Profile`、`Partition` | 项目用于解释多账号隔离的稳定概念 |
| 协议/格式 | `URL`、`JSON`、`ZIP`、`DOM`、`IPC` | 协议或文件格式 |
| 平台/工具 | `AppImage`、`FUSE`、`X11`、`Wayland`、`DevTools`、`GitHub`、`QQ` | 平台/工具/服务专名 |
| 单位/状态 | `MB`、`KB/s`、`ETA` | 标准单位或短状态 |
| 原样技术标识 | 命令、路径、文件名、扩展名、环境变量、错误码 | 翻译会破坏执行或诊断 |

除“原样技术标识”外，允许词默认需要中文上下文。新增允许类别必须先更新本合同并补测试。

## 受保护排除

- 腾讯官方网页及认证子窗的 DOM、文本、样式、资源、标题、跳转和响应。
- 操作系统拥有的文件选择器按钮或系统错误。
- 用户提供的 Profile 名称、备注和文件路径。
- 既有日志文件、历史 crash、动态外部错误、结构化错误码、已有脱敏后的原始诊断条目；活动生产代码中的启动器固定日志模板除外。
- URL、IPC channel、stage/action code、MIME、User-Agent 等协议标识。
- `package.json.productName`、`StartupWMClass`、可执行文件/目录、`SHINOBI_DEBUG`、旧日志路径等兼容标识。
- LICENSE、依赖锁文件、Flash 二进制和第三方资产。
- 历史文档、Constitution、负向测试、迁移 fixture 和 Unicode 编码样本。
- 中文、emoji、箭头、框线、破折号、省略号、转义序列等必要 Unicode。

## 自动审计合同

1. 测试必须从 Surface Registry 的路径与已知渲染位置提取 launcher-authored 文案，不能对整个仓库执行禁止词断言。
2. HTML 扫描需区分可见文本、属性、内联运行时文案与注释；休眠 HTML 也纳入。
3. JavaScript UI 扫描需覆盖 dialog/toast/title、动态 HTML、默认名称和生成 README；logger 与开发者异常摘要不计入中文 UI，但必须进入独立的 developer text AST 扫描，machine identifier 和动态 error 值继续排除。
4. shell 扫描只覆盖展示/确认函数和 desktop 展示字段；不得把命令、变量、路径及审计日志行当作翻译目标。
5. 每个排除命中必须能映射到受保护类别；未知命中不能静默忽略。
6. 测试必须同时证明默认 `zh-CN`、葡语 locale 不可选、setup/runtime 集合一致、允许词表受限。

## 验收结果格式

| Surface ID | 候选数 | 已翻译/删除 | 技术词保留 | 受保护保留 | 未分类 | 自动证据 | 人工证据 |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| `<surface>` | 0 | 0 | 0 | 0 | 0 | `<test>` | `<step/result>` |

所有 surface 的“未分类”必须为 0；launcher-owned 可达面的未授权葡语/Oasis 必须为 0。
