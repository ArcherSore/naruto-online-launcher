# Vision Author Tool

该目录包含仅供本仓库开发者使用的外部 Vision Author Tool。仓库根的极薄开发 shim
`vision-author-launcher.js` 先在正常 Electron main 阶段安装本目录 bootstrap，再加载同一个正式 Launcher
主进程；工具只复用当前 Profile 的正式 automation capture backend。它不是 Launcher 用户功能、公开 API
或第三方插件接口。

## 运行边界

- 运行时固定为项目 Volta 配置：Node.js `16.20.2`、npm `8.19.4`、Electron `11.5.0`。
- 不新增第三方依赖，不修改 `package-lock.json`。
- 普通 `npm start` 不创建 Vision Author bridge、pipe 或 Author 窗口。
- Developer entry 不使用 `NODE_OPTIONS --require`；Electron 11 在该预加载阶段尚不提供 `electron.app`。
- `start.ps1` 保持纯 ASCII，以兼容 Windows PowerShell 5.1 对无 BOM 脚本的旧编码规则。
- 使用本工具前须关闭普通 Launcher，再从仓库根运行：

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File tools/vision-author/start.ps1
  ```

- 工具只接受正式 `createAutomationBackend(...).capture(profileId)` 返回的完整 PNG 与 metadata。禁止使用
  桌面截图、窗口/HWND/BitBlt 截图、手工裁剪 Launcher、外部图片或 resize 作为来源或失败回退。
- 完整 Live/frozen frame、token、preview 与 replacement grant 仅驻留当前开发会话内存。唯一允许持久化的
  游戏画面是开发者明确保存到可信脚本 `assets/vision/<templateId>.png` 的 Template crop。
- `tools/vision-author/**`、根 `vision-author-launcher.js` 和专用连接入口不得进入正式 Windows 发布包；正式
  `src/main.js` 不引用本目录。

## V1 使用方式

1. 从工具列出的当前 Profile 中选择一个可用目标；Profile 启动或关闭后点击“刷新 Profile”，无需按 F5。
2. Live View 按固定约 `1000ms` tick capture；默认 timer adapter 保留 Electron Renderer 的原生 host receiver，忙碌 tick 跳过，不并发、不排队、不补跑，Author 窗口失焦或被遮挡时仍继续。每个新 `frameId` 只向图像元素提交一次 PNG，计数/pending 等状态变化不会重复重启同一帧解码。
3. Freeze 当前已显示帧，或在开始 Template/ROI 框选时自动 Freeze。
4. 在同一 frozen frame 上选择 Template 与 ROI；拖动期间选择框与 screenshot-pixel 坐标实时变化，松手后提交并生成 preview。
5. 从正式 registry catalog 选择 Target Script，输入合法 `templateId` 后保存，并复制 ROI/示例代码。

覆盖当前 Launcher 已加载过的模板后，重启 developer Launcher 再验证 runtime Vision；V1 不提供缓存热更新。

