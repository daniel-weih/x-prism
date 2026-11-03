# Prism 历史版本与设计记录

以下截图与验证记录对应各自版本，不代表当前界面。

1.1.1 的界面、浮窗、工具栏统一使用深青色「文 / A」图标，语言符号改编自 [Lucide Languages](https://lucide.dev/icons/languages)，ISC 许可保留在 `../assets/LICENSE-lucide.txt`。[设计参考和前后对比](icon-comparison.html)包含 Google 翻译 和沉浸式翻译的商店图标参考；[1.1.1 实际渲染截图](previews/icon-comparison-1.1.1.jpg)包含浅色、深色背景与 16/32/48 px 显示效果。

1.1.0 功能预览（图标为旧版）：[音标与译文](previews/translation-preview.jpg)、[Codex 设置](previews/settings-preview.jpg)、[划词浮窗](previews/selection-preview.jpg)。截图来自本地开发预览：Chrome 扩展 API 由测试适配器模拟，词典及本机 Codex 调用为真实实现。已验证模型联动、保存、连续划词和原生消息协议。1.1.1 已通过实际安装的 Native Messaging 启动器验证模型列表和翻译；当前浏览器工具禁止访问扩展管理页，尚未验证 Chrome 重载后发起的真实原生消息调用。

1.1.1 修复了 `Cannot create item with duplicate id prism-translate-selection`：启动和安装事件共享初始化任务，已存在的菜单直接更新，并读取 Chrome 回调错误。回归测试覆盖并发初始化、重复初始化与失败后重试。更新后如错误页仍显示旧记录，可先“全部清除”，再重新触发翻译，区分历史记录与新报错。

1.1.2 处理了扩展重载后旧网页的 `Extension context invalidated`：捕获同步抛出和异步拒绝，保留选词并提供“刷新当前网页”按钮；新版重新注入时清理旧实例，保存历史失败也不会覆盖成功译文。已打开的旧版网页需刷新一次，才能获得这些处理。

1.1.3 将“保存设置”移到设置页顶部并随滚动保持可见；顶部引擎徽标和翻译请求使用已保存的引擎，不再把仅点选的草稿显示为已生效。检测到 Codex 连接并不代表已切换引擎，选择模型和推理强度后仍需保存。静态检查和 8 项 Node 回归测试通过；当前真实 Chrome 控制连接超时，尚未完成本版浏览器端验证。

1.1.4 使用已选定的单色「折光 P」：透明底，无渐变和底色块，统一用于工具栏、扩展列表、侧边栏及划词浮窗。侧边栏和浮窗内随深色主题反白，工具栏默认使用深色 PNG。源图为 `../assets/icon.svg`，导出 16/32/48/128 px PNG；[单色图标预览](logo-directions-20261027/monochrome-preview.png)。此前的[彩色候选稿](logo-directions-20261027/comparison.png)仅作为设计过程存档。

1.3.0 移除 DeepL 和 LibreTranslate，包括设置项、调用路径与 DeepL 专用域名权限。更新时清理这两项的旧配置和密钥，若原先选中已移除的引擎则回到 Chrome Local AI。界面统一为黑白灰：实色主按钮、细边框、明确的选中标记，侧边栏与划词浮窗支持对应的深色主题；网页译文沿用原网页文字颜色并通过左侧细线区分。 本次通过 18 项 Node 测试；浏览器预览验证了 320/360 px 布局、浅深色主题及保存状态。截图接口仍超时，未完成截图视觉复核；真实 Chrome 扩展重载需要手动进行。

1.4.0 将 Codex CLI 与 OpenAI-compatible 合并为 **OpenAI** 引擎，提供独立的 CLI / API 模式及 API 模型检测。旧配置自动迁移，模型与密钥保留。23 项 Node 测试及 10 项网页连接回归场景通过；浏览器预览验证了模式切换、权限拒绝、配置保存、窄侧栏和浅深色主题。CLI 使用实际 Native Messaging 启动器验证；API 使用模拟响应验证协议，尚未使用真实 API Key 联调。

1.5.0 将产品名称统一为 **Prism**，定位为网页翻译与 AI 朗读。划词菜单提供翻译和朗读入口，保留品牌标识并适配浅深色背景；新增选段、整篇、原文、译文和单词朗读，支持模型、音色、语速选择以及播放控制。朗读共用 OpenAI 翻译的接口与 Key；单词生成增加专用提示及音频转写校验。


[返回当前中文介绍](../README.zh-CN.md) · [English README](../README.md)
