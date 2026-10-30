# Prism Translate

一款本地优先、支持划词与整页双语对照的 Chrome 翻译扩展。它使用原生侧边栏，不遮挡正在阅读的页面；没有远程脚本、没有分析埋点，也没有内置任何 API 密钥。

## 功能

- 划词翻译气泡：选中文字即可翻译、复制、朗读或送入侧边栏。
- 侧边栏按标签页独立打开，切换到其他标签页不会自动展开；网页翻译始终作用于该侧栏所属的标签页。
- 英语单词音标：划词浮窗和侧边栏显示离线美式 IPA，附单词原文发音；多读音一并展示，未收录的词明确提示。
- 整页翻译：支持“原文 + 译文”和“仅看译文”，随时恢复页面原文。
- 本地优先：Chrome 138+ 可使用浏览器内置 Translator 与 Language Detector API。
- 多引擎：Chrome Local AI、OpenAI（本机 Codex CLI / API）、Kimi（本机 CLI / 开放平台 API）、MyMemory。
- 智能目标语言：发现源语言与目标语言相同时，会自动在中文和英文之间切换。
- 历史与收藏：可搜索、收藏和删除；所有记录只保存在当前 Chrome 资料中。
- 中英文界面、浅色/深色单色主题、模型下载和网页翻译进度。
- 快捷键：`⌥⇧T` 翻译选区，`⌥⇧P` 翻译或恢复当前网页。

## 安装

1. 打开 `chrome://extensions`。
2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目的 `prism-translate` 目录。
5. 打开任意普通网页并点击工具栏中的 Prism 图标；首次连接已经打开的页面时，Prism 会自动完成连接，无需手动刷新。

最低支持 Chrome 116。Chrome 本地翻译需要桌面版 Chrome 138 或更高版本；旧版本可在设置中选择云端引擎。Chrome 可能在首次使用某个语言对时下载模型。

“正在下载本地翻译语言包”只用于 Chrome Local AI 的语言包下载。下载完成后会切换到准备或翻译状态；OpenAI / Kimi 等云端请求等待结果时显示“正在翻译”，不会显示本地模型下载。等待阶段使用流动进度条，片段数量表示本次收集到的网页文字，并不表示模型下载数量。

翻译过程中如果网页跳转或重新采集，旧结果会被丢弃并提示重新翻译。局部文字变化时，只跳过已变化的片段，其余译文仍可写入，并显示实际完成数量。恢复原文时也会保留网站在此期间更新的文字。

## 翻译服务与隐私

| 服务 | 网络请求 | 凭据 |
| --- | --- | --- |
| Chrome Local AI | 文本在设备内处理；首次使用可能下载语言包 | 无 |
| OpenAI · Codex CLI | 通过本机 Codex 发送到其配置的模型服务 | 复用本机 Codex 登录 |
| Kimi · 本机 CLI | 通过本机 Kimi Code 发送到其模型服务 | 复用本机 Kimi Code 登录 |
| Kimi · 开放平台 API | 发送到所选国内或国际 Moonshot API | 用户自己的开放平台 API Key |
| MyMemory | 发送待翻译文本到 MyMemory | 无 |
| OpenAI · API（含兼容服务） | 发送到用户配置的 HTTPS 地址 | 用户自己的 API key |

API 密钥只写入 `chrome.storage.local`，不会写入 Chrome Sync。自定义服务地址会由 Chrome 单独询问该域名的访问权限。完整说明见 [PRIVACY.md](PRIVACY.md)。

## OpenAI 翻译

设置 → **OpenAI** → 选择 **本机 Codex CLI** 或 **API**。两种模式分别保存模型设置，切换后点击顶部 **保存设置**。

### 本机 Codex CLI

要求：macOS 或 Linux、Node.js 20+、已安装并登录的 Codex CLI。连接器已在 macOS / Codex CLI 0.165.0 上验证模型目录和真实翻译。模型在 Codex 配置的服务端运行，不代表离线推理。

1. 在 `chrome://extensions` 中重新加载此目录的扩展（版本 1.4.0）。
2. 打开 Prism → 设置 → **OpenAI** → **本机 Codex CLI** → **首次连接设置**，复制页面中带有实际扩展 ID 的命令。
3. 在本项目目录运行该命令：

   ```bash
   node scripts/install-codex-host.mjs <设置页面显示的扩展ID>
   ```

4. 点击 **检测连接并刷新模型**，选择模型与推理强度，再点击 **保存设置**。选项来自本机 `model/list`，按模型实际能力联动，不内置固定模型列表。
5. 返回翻译页输入 `hello`，或在普通网页选词并点击 Translate。音标会先出现，译文随后显示。

连接器使用 Chrome Native Messaging 调用 `codex app-server`，不监听本地网络端口，不读取或复制登录凭据。Chrome 只允许安装时指定的扩展 ID 连接。模型调用使用临时会话和临时空目录，关闭命令执行、MCP、插件及记忆，完成或断开后关闭独立的 Codex 子进程。不会重启已有 Codex 会话。

安装脚本默认注册到当前用户的 Google Chrome。其他 Chromium 浏览器可将其 NativeMessagingHosts 目录作为第二个参数传入。可通过 `PRISM_CODEX_BIN=/绝对路径/codex` 指定可执行文件；安装器会记录 Node 和 Codex 的绝对路径，避免从 Finder 启动 Chrome 时找不到命令。移动项目目录后需要重新安装连接器。Windows 暂无安装脚本。

若提示未登录，先在终端运行 `codex login`。若提示模型或推理强度不可用，重新检测并选择。较高推理强度或很长的网页可能触发超时；可降低强度或网页片段上限。连接器遵循系统代理，便于与本机 Codex 保持一致。

### API

选择 **API**，填写接口地址、API Key 和支持文本对话的模型 ID。默认地址为 `https://api.openai.com/v1/chat/completions`，也支持自定义 OpenAI 兼容服务。点击 **检测连接并刷新模型** 可读取该接口账号的模型列表；服务不支持模型列表时，仍可手动填写模型 ID 并保存。API 模式使用独立密钥，不复用 Codex CLI 登录。

**推理强度**默认“不指定（模型默认）”，请求不传 `reasoning_effort`；选择 `none` 会明确关闭推理，也可选择 `minimal`、`low`、`medium`、`high`、`xhigh`、`max`。各档位需所选模型支持；非推理模型（例如预填的 `gpt-4.1-mini`）保持“不指定”。API 与 CLI 的强度独立保存，点击 **保存设置** 后生效。

Chrome 会请求所选接口域名的访问权限；请求拒绝重定向，API Key 只保存在本地扩展存储，不参与同步。CLI 模式不需要 API Key 或 API 域名权限。接口采用 [Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)，模型列表采用 [Models API](https://developers.openai.com/api/reference/resources/models/methods/list)。

升级时，原 **Codex** 引擎自动迁移为 **OpenAI / 本机 Codex CLI**，原 **OpenAI Compatible** 自动迁移为 **OpenAI / API**，保留已有模型、推理强度、接口地址、密钥和历史记录。

## Kimi 翻译

设置 → **Kimi** → 选择接入方式。两种模式分别保存模型；点击顶部 **保存设置** 后，侧边栏、划词和网页翻译都会使用所选模式。

**本机 CLI**：要求 macOS / Linux、Node.js 20+ 和已登录的 Kimi Code CLI。本次以 Kimi Code 2.2.0 验证。首次运行：

```bash
node scripts/install-kimi-host.mjs <设置页面显示的扩展ID>
```

然后点击 **检测连接并刷新模型**，选择模型并保存。模型来自本机 CLI 当前账号，思考强度沿用 CLI 配置。可用 `PRISM_KIMI_BIN=/绝对路径/kimi` 指定安装路径；移动项目后须重新安装连接器。默认注册到 Google Chrome，其他 Chromium 浏览器可传入其 NativeMessagingHosts 目录作为第二个参数。

连接器通过 ACP 获取模型目录，实际翻译使用 print 模式和独立的翻译 agent 配置，明确设置 `tools: []`、`subagents: []`，不执行原文中的指令。使用临时空目录，结束后关闭自身子进程并尝试删除仅属于该目录的 CLI 会话。该模式复用本机登录，不读取或复制凭据，仍使用云端服务；CLI 自身的运行日志和服务端留存遵循 Kimi 的规则。参考 [自定义 Agent](https://moonshotai.github.io/kimi-code/en/customization/agents) 和 [ACP](https://moonshotai.github.io/kimi-code/en/reference/kimi-acp)。

**开放平台 API**：选择国内 `api.moonshot.cn` 或国际 `api.moonshot.ai`，填入该区域的 API Key，检测并选择模型，也可手动填写模型 ID。API Key 与 Kimi Code 登录独立，计费也独立。模型支持时可选择思考开关或推理强度；未知模型沿用服务端默认值。Chrome 只在连接或保存时请求所选域名的权限，密钥仅存于浏览器本地。参考 [Chat API](https://platform.kimi.com/docs/api/chat) 和 [模型说明](https://platform.kimi.com/docs/api/models-overview)。

已通过实际安装的 Native Messaging 启动器验证模型目录和真实翻译。17 项 Node 测试通过，覆盖 API 协议、模型参数、错误处理、密钥存储和后台模式路由；本地浏览器预览（模拟 Chrome API）验证了模式切换、各自模型保存、域名权限、密钥不参与同步和未保存设置拦截。未提供 API Key，因此尚未进行真实 API 翻译。截图接口超时；Chrome 重载后的实际扩展调用仍需在浏览器验证。

## 音标来源与图标

音标来自随扩展打包的 [ipa-dict](https://github.com/open-dict-data/ipa-dict) 美式英语词典（基于 CMU 数据），共 125,927 个词条；查询只读取本地 JSON，不调用网络词典或让模型猜读音。目前未提供英式音标，也不会按上下文替用户选定多音词的读法。发音按钮使用浏览器语音合成，实际声音由系统可用语音决定。

数据版本与校验值见 `assets/dictionaries/source.json`，许可证保留在同目录。1.1.1 的界面、浮窗、工具栏统一使用深青色「文 / A」图标，语言符号改编自 [Lucide Languages](https://lucide.dev/icons/languages)，ISC 许可保留在 `assets/LICENSE-lucide.txt`。[设计参考和前后对比](docs/icon-comparison.html)包含 Google 翻译 和沉浸式翻译的商店图标参考；[1.1.1 实际渲染截图](docs/previews/icon-comparison-1.1.1.jpg)包含浅色、深色背景与 16/32/48 px 显示效果。

1.1.0 功能预览（图标为旧版）：[音标与译文](docs/previews/translation-preview.jpg)、[Codex 设置](docs/previews/settings-preview.jpg)、[划词浮窗](docs/previews/selection-preview.jpg)。截图来自本地开发预览：Chrome 扩展 API 由测试适配器模拟，词典及本机 Codex 调用为真实实现。已验证模型联动、保存、连续划词和原生消息协议。1.1.1 已通过实际安装的 Native Messaging 启动器验证模型列表和翻译；当前浏览器工具禁止访问扩展管理页，尚未验证 Chrome 重载后发起的真实原生消息调用。

1.1.1 修复了 `Cannot create item with duplicate id prism-translate-selection`：启动和安装事件共享初始化任务，已存在的菜单直接更新，并读取 Chrome 回调错误。回归测试覆盖并发初始化、重复初始化与失败后重试。更新后如错误页仍显示旧记录，可先“全部清除”，再重新触发翻译，区分历史记录与新报错。

1.1.2 处理了扩展重载后旧网页的 `Extension context invalidated`：捕获同步抛出和异步拒绝，保留选词并提供“刷新当前网页”按钮；新版重新注入时清理旧实例，保存历史失败也不会覆盖成功译文。已打开的旧版网页需刷新一次，才能获得这些处理。

1.1.3 将“保存设置”移到设置页顶部并随滚动保持可见；顶部引擎徽标和翻译请求使用已保存的引擎，不再把仅点选的草稿显示为已生效。检测到 Codex 连接并不代表已切换引擎，选择模型和推理强度后仍需保存。静态检查和 8 项 Node 回归测试通过；当前真实 Chrome 控制连接超时，尚未完成本版浏览器端验证。

1.1.4 使用已选定的单色「折光 P」：透明底，无渐变和底色块，统一用于工具栏、扩展列表、侧边栏及划词浮窗。侧边栏和浮窗内随深色主题反白，工具栏默认使用深色 PNG。源图为 `assets/icon.svg`，导出 16/32/48/128 px PNG；[单色图标预览](docs/logo-directions-20261027/monochrome-preview.png)。此前的[彩色候选稿](docs/logo-directions-20261027/comparison.png)仅作为设计过程存档。

1.3.0 移除 DeepL 和 LibreTranslate，包括设置项、调用路径与 DeepL 专用域名权限。更新时清理这两项的旧配置和密钥，若原先选中已移除的引擎则回到 Chrome Local AI。界面统一为黑白灰：实色主按钮、细边框、明确的选中标记，侧边栏与划词浮窗支持对应的深色主题；网页译文沿用原网页文字颜色并通过左侧细线区分。 本次通过 18 项 Node 测试；浏览器预览验证了 320/360 px 布局、浅深色主题及保存状态。截图接口仍超时，未完成截图视觉复核；真实 Chrome 扩展重载需要手动进行。

1.4.0 将 Codex CLI 与 OpenAI-compatible 合并为 **OpenAI** 引擎，提供独立的 CLI / API 模式及 API 模型检测。旧配置自动迁移，模型与密钥保留。23 项 Node 测试及 10 项网页连接回归场景通过；浏览器预览验证了模式切换、权限拒绝、配置保存、窄侧栏和浅深色主题。CLI 使用实际 Native Messaging 启动器验证；API 使用模拟响应验证协议，尚未使用真实 API Key 联调。

## 开发与检查

无需构建工具或运行时依赖，扩展内也不加载 CDN。修改代码后在 `chrome://extensions` 中点击“重新加载”即可。

```bash
npm run check
```

浏览器回归测试位于 `tests/content-runtime-browser.html`，通过本地 HTTP 服务打开并点击“运行回归测试”。它加载实际划词与网页脚本，模拟 Chrome API 的失效、重注入、迟到响应、历史保存失败、隐藏内容过滤、网页快照过期和本地模型初始化失败后的重试；不代表真实扩展重载或真实模型服务的端到端验收。当前 15 项场景通过。`npm run check` 覆盖 37 项 Node 测试及静态检查。

用于检查划词和整页翻译的静态页面位于 `demo/test-page.html`。图标源文件为 `assets/icon.svg`，在 macOS 上可用下面的命令重新生成 PNG：

```bash
swift scripts/render_icons.swift
```

## English

Prism Translate is a local-first Chrome extension for selection translation, bilingual page reading, history, speech, and configurable cloud providers. Load this folder as an unpacked extension, open Prism from the toolbar, and choose **Chrome Local AI** for on-device translation on Chrome 138+. See the feature list and privacy table above; the interface itself can switch between English and Chinese.
