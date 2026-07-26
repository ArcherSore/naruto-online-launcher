# 可见文案审计

处置值：`translate`、`remove-entry`、`retain-technical`、`retain-protected`、`n-a`。在最终验证前不得把 `pending` 改为 `verified`。

| Surface ID | 候选数 | 已翻译/删除 | 技术词保留 | 受保护保留 | 未分类 | 自动证据 | 人工证据 | 状态 |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| `setup.window` | 6 | 6 | 5 | 0 | 0 | PASS | NOT RUN | auto-pass |
| `manager.window` | 2 | 2 | 2 | 0 | 0 | PASS | NOT RUN | auto-pass |
| `manager.toast-dialog` | 7 | 7 | 4 | 4 | 0 | PASS | NOT RUN | auto-pass |
| `game.loading.inline` | 1 | 1 | 1 | 1 | 0 | PASS | NOT RUN | auto-pass |
| `game.loading.asset` | 11 | 11 | 7 | 2 | 0 | PASS | N/A（休眠资产） | verified |
| `native.flash-missing` | 1 | 1 | 3 | 1 | 0 | PASS | NOT RUN | auto-pass |
| `profile.generated-name` | 2 | 2 | 1 | 2 | 0 | PASS | NOT RUN | auto-pass |
| `diagnostics.export` | 3 | 3 | 4 | 5 | 0 | PASS | NOT RUN | auto-pass |
| `linux.install` | 5 | 5 | 6 | 4 | 0 | PASS | NOT RUN | auto-pass |
| `linux.uninstall` | 4 | 4 | 5 | 8 | 0 | PASS | NOT RUN | auto-pass |
| `linux.run-error` | 1 | 1 | 1 | 2 | 0 | PASS | NOT RUN | auto-pass |
| `linux.desktop` | 2 | 2 | 3 | 5 | 0 | PASS | NOT RUN | auto-pass |
| `package.desktop` | 2 | 2 | 3 | 6 | 0 | PASS | Windows 构建 PASS；Linux AppImage BLOCKED | auto-pass |
| `tray-menu-notification` | 0 | 0 | 0 | 0 | 0 | 现状无实现 | N/A | n-a |

## 候选项明细

| Entry ID | Surface | Source | Candidate | Disposition | Rationale / verification |
| --- | --- | --- | --- | --- | --- |
| `COPY-001` | `setup.window` | `src/config/i18n.js`、`src/config/settings.js` | 葡语默认/fallback/支持集合 | translate/remove-entry | `zh-CN` 规范化矩阵；settings/copy-boundary tests |
| `COPY-002` | `setup.window` | `src/ui/setup/setup.html`、`src/main.js` | 葡语第一帧、语言按钮、标题与保存 fallback | translate/remove-entry | locale parity、标题哨兵与 payload 保持 |
| `COPY-003` | `manager.window` | `src/ui/index.html`、`src/ui/manager/ManagerWindow.js` | 普通英文标题/旧品牌 | translate | tencent-ui/copy-boundary tests |
| `COPY-004` | `manager.toast-dialog` | `src/ui/manager/IpcRouter.js` | 葡语 toast/dialog/副本后缀 | translate | IpcRouter tests；用户摘要中文，启动器自编 machine `error` 摘要英文，动态原始错误保留 |
| `COPY-005` | `game.loading.inline` | `src/app/Launcher.js` | `Carregando` | translate | Launcher data URL 与转义断言 |
| `COPY-006` | `game.loading.asset` | `src/ui/loading/loading.html` | 葡语阶段、错误、重试 | translate | phase/action/bridge 未变；copy-boundary test |
| `COPY-007` | `native.flash-missing` | `src/main.js` | 普通英文原生错误框 | translate | 检测、单次 dialog、exit(1) 未变 |
| `COPY-008` | `profile.generated-name` | `src/profiles/store.js`、`src/ui/manager/IpcRouter.js` | `Conta`、`cópia` | translate | store/IpcRouter tests |
| `COPY-009` | `diagnostics.export` | `src/utils/diagnostics.js`、`src/ui/manager/IpcRouter.js` | 葡语 README/dialog/toast/文件名 | translate | diagnostics/IpcRouter tests；raw entries 保留 |
| `COPY-010` | `linux.*` | `linux/install.sh`、`linux/uninstall.sh`、`linux/run.sh` | 葡语/普通英文交互输出 | translate | 范围扫描、归一化输入 `bash -n` |
| `COPY-011` | `linux.desktop`、`package.desktop` | `linux/naruto-online.desktop`、`linux/install.sh`、`package.json` | 英文 Comment/GenericName/卸载动作 | translate | machine 字段与兼容键无 diff |
| `COPY-012` | `manager.window` | `src/config/optimization.js` | `Balanceado`、`Qualidade` 和葡语预设说明 | translate | `listForUI()` 名称/说明中文；preset code、参数、icon、颜色不变；copy-boundary test PASS |

## 英文技术词保留

| 类别 | 实际保留 | 允许 surface / 理由 |
| --- | --- | --- |
| 产品/运行时 | Naruto Online、Flash、PPAPI、SWF | 产品专名及 Flash 运行技术；均处于中文说明中 |
| 硬件/性能 | GPU、CPU、RAM、GC、FPS | 通用缩写，翻译会降低诊断一致性 |
| 会话/配置 | Session、Profile、Partition | 多账号隔离的稳定项目概念，默认 UI 使用中文上下文 |
| 协议/格式 | URL、JSON、ZIP、DOM、IPC | 机器/文件格式和边界术语 |
| 平台/工具 | AppImage、FUSE、X11、Wayland、DevTools、GitHub、QQ | 平台或服务专名 |
| 单位/状态 | MB、KB/s、ETA | 标准单位或短状态 |

## 受保护命中

- `external.tencent`：腾讯 URL/DOM/资源与导航逻辑无 diff；`TencentLaunchFlow.js` 仅一个 logger 固定分隔符按 developer text contract 改为 ASCII，自动合同 PASS，真实页面完整人工验证滞后。
- `diagnostic.raw`：既有日志文件、历史 crash、`config.json`、`profiles.json`、动态原始错误和协议 error code 保留；新生成的启动器固定模板按 developer text contract 英文化；diagnostics tests PASS。
- `protocol.identifier`：IPC channel、action/stage/error code、URL、MIME、User-Agent 保留。
- `compatibility.identifier`：`productName`、appId、可执行文件名、`StartupWMClass`、旧配置/日志路径保留。
- `third_party`：`package-lock.json`、Flash 二进制、LICENSE 与依赖资产无改动。
- `test.evidence`：历史 Oasis/葡语负向断言、迁移 fixture 和 Unicode 样本保留。
- `unicode.required`：中文 UI/翻译、用户数据、第三方内容、测试样本和转义保留；仅开发者运行固定文本移除装饰性 Unicode，未执行全仓非 ASCII 清洗。
