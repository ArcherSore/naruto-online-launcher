# Linux AppImage 与系统集成

| 验证项 | 结果 | 证据/备注 |
| --- | --- | --- |
| 原始工作树 `bash -n` | FAIL（环境基线） | Windows CRLF 导致 `do\r` |
| 只读 CRLF 归一化后的 `bash -n` | PASS | install/uninstall/run 三个脚本 |
| `linux-unpacked` | PASS | electron-builder 完成 Linux x64 打包阶段 |
| AppImage | BLOCKED | 远程构建服务连续三次 EOF |
| `uninstall.sh --help` | NOT RUN | 未在 Linux 临时用户执行 |
| 安装取消/缺依赖/run 缺文件 | NOT RUN | 未在 Linux VM 执行 |
| 真实安装、desktop、启动、卸载 | NOT RUN | 需要 Linux VM/临时用户与 AppImage |

未执行任何安装或删除操作。
