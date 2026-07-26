# T001 实施前基线

记录日期：2026-07-21  
运行平台：Windows / PowerShell  
分支：`001-tencent-game-launch`

## 固定运行时与资产

| 项目 | 实际值 | 结果 |
| --- | --- | --- |
| `node -v` | `v16.20.2` | PASS |
| `npm -v` | `8.19.4` | PASS |
| `package.json` Electron | `11.5.0` | PASS |
| Windows PPAPI | `34.0.0.376` | PASS |
| Linux PPAPI（保留边界） | `34.0.0.137` | PASS |
| `package-lock.json` SHA-256 | `216ABA49685A226E07553B67C114CCDD2F2954FA70D84440C92A5981658F1DBB` | 基线 |

## 相关 Jest

命令：

```powershell
npx jest --runInBand --forceExit src/config/__tests__/urls.test.js src/app/__tests__/Launcher.test.js src/app/__tests__/SessionLifecycle.test.js src/app/__tests__/StallDetector.test.js src/profiles/__tests__/partition.test.js src/profiles/__tests__/manager.test.js src/network/__tests__/inspector.test.js src/utils/__tests__/logger.test.js src/utils/__tests__/diagnostics.test.js src/ui/manager/__tests__/IpcRouter.test.js src/flash/__tests__/plugin.test.js
```

结果：PASS，`11/11` suites、`471/471` tests；耗时 `7.212 s`。Jest 在 `--forceExit` 后提示可能存在未关闭的异步句柄。该提示是实施前基线，不计为本 Feature 引入。

## 全量 Jest

命令：

```powershell
npm test -- --runInBand
```

结果：已知基线失败，`37/38` suites、`1223/1234` tests 通过，`11` 个失败全部位于 `src/app/__tests__/GpuDetector.test.js`。失败集中于 Windows 主机上模拟 Linux `/sys/class/drm`/GPU vendor 的路径与派生环境变量断言。测试主体耗时 `118.754 s`，进程最终报告：

```text
Force exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?
```

本 Feature 不修复该既有跨平台 mock/open-handle 问题；后续全量结果必须与本基线分开比较。

## ESLint

项目脚本：

```powershell
npm run lint
```

结果：已知 Windows 基线失败。脚本使用 POSIX 前置环境变量语法，错误为：

```text
'ESLINT_USE_FLAT_CONFIG' is not recognized as an internal or external command,
operable program or batch file.
```

PowerShell 等价命令：

```powershell
$env:ESLINT_USE_FLAT_CONFIG='false'; npx eslint src/
```

结果：PASS，退出码 `0`，无 lint 输出。

## 基线结论

- Node、npm、Electron、PPAPI 与项目冻结版本一致。
- 锁文件哈希已固定，后续任务不得无故修改。
- 相关启动链测试当前通过；全量失败和 open-handle 提示均已作为既有问题留证。
- 后续自动验证使用 PowerShell 等价 ESLint 命令，并保留 `npm run lint` 的跨平台脚本问题作为基线差异。
