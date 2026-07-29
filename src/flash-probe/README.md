# Flash Preload Probe（研究 Demo）

`FlashProbe.as` 是完整、可审计的 AS3 源码。生成文件 `FlashProbe.swf` 不手工构造，也不从第三方下载。

## 构建

依赖 Apache Flex SDK（含 `bin/mxmlc.bat` 和目标版本的 `playerglobal.swc`）或兼容的 AIR SDK 编译器，以及该 SDK 支持的 Java 运行时。默认目标是 Flash Player 32.0，与仓库的 Flash Player 34 PPAPI 兼容。

```powershell
.\src\flash-probe\build.ps1 -FlexHome 'D:\AS3Tools\flex-sdk-4.16.1'
```

Agent 固定连接 `127.0.0.1`。默认端口是 `32145`；启动器通过 `PreloadSwf` 查询参数把实际端口传给 Agent。如需其他端口：

```powershell
$env:SHINOBI_FLASH_PROBE_PORT='32146'
```

输出为同目录下的 `FlashProbe.swf`。启动器仅在 `SHINOBI_DEBUG=1` 且该文件存在时临时写入用户级 `mm.cfg`。
