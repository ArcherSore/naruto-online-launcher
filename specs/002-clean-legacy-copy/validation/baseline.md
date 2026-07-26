# 实现与验证基线

## 固定运行时

| 项目 | 基线 |
| --- | --- |
| Node.js | `v16.20.2` |
| npm | `8.19.4` |
| Electron | `11.5.0` |
| Flash | 仓库随附 PPAPI，接入方式不得变更 |
| `package-lock.json` SHA-256 | `DCD47B4DB444A346645678D5E63108E6465C77107A568BE3129D666744ACB226` |

## 清理前测试

| 门禁 | 结果 | 备注 |
| --- | --- | --- |
| 定向基线 | PASS：5 suites / 125 tests | `settings`、`tencent-ui`、`Launcher`、`SessionLifecycle`、`partition` |
| 全量基线 | PASS：17 suites / 522 tests | 退出码 0 |
| 既有警告 | 已记录 | Jest 报告 force-exit/open handle；不得冒充本功能的新失败或通过 |

## 清理后测试

| 门禁 | 结果 | 备注 |
| --- | --- | --- |
| 开发者文本修订定向 Jest | PASS：4 suites / 85 tests | developer-copy、logger、IpcRouter、diagnostics；按用户决定未重复全量验证 |
| Quickstart 最终定向 Jest | PASS：9 suites / 267 tests | 覆盖 quickstart 指定的全部 9 个测试文件 |
| US1/US2 定向 Jest | PASS：7 suites / 262 tests | 中文默认、Surface Registry、管理 UI、Launcher、IPC、Profile、diagnostics |
| 核心行为 Jest | PASS：9 suites / 247 tests | 腾讯流程、Launcher、SessionLifecycle、Partition、URL、快捷键、状态广播、inspector、logger |
| 全量 Jest | PASS：18 suites / 547 tests | 退出码 0；只有既有 force-exit/open-handle 提示 |
| ESLint | PASS | `npm run lint` 退出码 0 |
| Prettier 全仓 check | FAIL（既有基线） | 48 个文件报告格式/换行差异，包含未修改的核心模块；未执行全仓重写 |
| Windows portable | PASS | `dist/Naruto Online 1.4.0.exe` |
| Linux AppImage | BLOCKED | `linux-unpacked` 完成；远程构建服务连续 3 次 EOF，未生成 AppImage |
| `git diff --check` | PASS | 无空白错误；仅 Git CRLF 提示 |
| `package-lock.json` SHA-256 | PASS | `DCD47B4DB444A346645678D5E63108E6465C77107A568BE3129D666744ACB226` |

## 命令记录

```powershell
npm test -- --runInBand
npm run lint
npx prettier --check "src/**/*.{js,html,css,json}" "tests/**/*.js"
npm run build:win
npm run build:linux
git diff --check
```

Linux 脚本直接 `bash -n` 因工作树 CRLF 报 `do\r`；使用只读 `sed 's/\r$//'` 输入后，三个脚本均通过 `bash -n`。未改写全文件换行。
