# Quick Translation

[English](README.md) | 简体中文

一个用完即走的 VS Code 输入翻译浮层。无需配置 API Key，按固定顺序调用网页翻译服务：

1. Microsoft（Bing Translator）
2. Google Translate
3. 百度翻译

当前面的服务超时或失败时，插件会自动尝试下一个服务。界面支持英语和简体中文，并自动跟随 VS Code 的显示语言。

## 使用方式

- 打开任意文本编辑器，点击编辑器右上角的翻译图标。
- 如果编辑器中已有选中文本，打开后会自动带入并开始翻译。
- 也可以右键选区并选择 `Quick Translation: Translate Selection`。
- 选择 `Quick Translation: Translate and Replace Selection` 可不打开浮层，直接翻译并一次性替换全部非空选区。
- 或运行 `Quick Translation: Open Translation`。
- 打开翻译：`Cmd+Shift+Y`（macOS）/ `Ctrl+Shift+Y`（Windows、Linux）。
- 翻译并替换全部选区：`Cmd+Option+Shift+Y`（macOS）/ `Ctrl+Alt+Shift+Y`（Windows、Linux）。
- 打开配置：`Cmd+K Cmd+Y`（macOS）/ `Ctrl+K Ctrl+Y`（Windows、Linux）。
- 输入内容并停顿约 400ms，译文会显示在同一个浮层中。
- 译文出现后按 Enter，复制纯文本结果并关闭。
- 译文右侧按钮可以复制、替换原选区或将译文插入选区下方。
- 替换时会保留常见的行注释、块注释、缩进和字符串引号。
- 点击浮层外部或按 Esc，立即关闭。

VS Code 的工具栏按钮不提供可靠的长按或双击事件，因此配置入口采用原生交互：

- `Option/Alt + 点击`翻译图标，打开快速配置。
- 点击翻译浮层右上角的齿轮按钮。
- 运行 `Quick Translation: Configure Translation`。

浮层中的交换按钮可立即交换主要语言和第二语言。语言按钮可以只为本次翻译指定目标语言，不会修改全局配置。如果所有服务失败，可以查看错误、全部重试或指定某个服务重试。

## 语言和服务配置

默认主要语言为简体中文，第二语言为英语。输入主要语言时翻译为第二语言，输入其他语言时翻译为主要语言。

快速配置可以选择：

- 将配置保存到全局或当前工作区；工作区配置遵循 VS Code 原生规则并覆盖全局配置
- 启用哪些服务（实际顺序始终为 Microsoft → Google → 百度）
- 主要语言
- 第二语言
- 测试 Microsoft、Google 和百度的实时可用性与耗时

支持简体中文、繁体中文、英语、日语、韩语、法语、德语、西班牙语、俄语、葡萄牙语、意大利语和阿拉伯语。也可以在 VS Code 设置中搜索 `Quick Translation` 修改配置。

## 网页翻译说明

本插件模拟各服务商网页端的公开请求，不使用官方商业 API，也不需要用户密钥。待翻译文本会依次发送给已启用的服务，某个服务成功后便停止继续请求。

网页接口可能随服务商更新而变化，也可能受到网络、地区、频率限制或验证码影响；这些情况会触发下一个服务兜底。请不要用它翻译敏感信息，也不要用于高频批量调用。

## 开发

项目使用 Node.js 22、pnpm、TypeScript 和 esbuild：

```bash
fnm use
corepack pnpm install
corepack pnpm run compile
```

按 F5 启动 Extension Development Host。执行 `corepack pnpm run package:vsix` 生成可安装的 VSIX。
