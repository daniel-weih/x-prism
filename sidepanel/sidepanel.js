import { createReader } from "./reader.js";
import { LANGUAGES, OPENAI_REASONING_EFFORTS, PROVIDERS } from "../shared/config.js";
import { kimiApiBase, kimiThinkingOptions } from "../shared/kimi-api.js";
import { openaiApiOrigin, supportsOpenAiFast } from "../shared/openai-api.js";
import { panelTabId, pendingActionKey } from "../shared/side-panel.js";
import {
  ensureDefaults,
  getHistory,
  getSettings,
  subscribeToSettings,
  saveSettings
} from "../shared/storage.js";
import { addHistory, clearHistory, removeHistoryItem, toggleFavorite } from "../shared/history-client.js";
import { hasLocalTranslator, translateMany, translateText } from "../shared/translator.js";
import {
  TAB_ACCESS_ERROR,
  messageTab,
  resolveTab,
  visiblePageDetails
} from "../shared/tab-access.js";

const copy = {
  en: {
    brandSubtitle: "Web translation & read aloud", tabTranslate: "Translate", tabPage: "Page", tabHistory: "History", tabSettings: "Settings",
    from: "From", to: "To", sourceText: "Source text", sourcePlaceholder: "Type, paste, or select text on any page…", paste: "Paste", clear: "Clear", translateNow: "Translate now",
    translation: "Translation", resultHint: "Your translation will appear here.", copy: "Copy", listen: "Listen", save: "Favorite", currentTab: "Current tab",
    readingMode: "Reading mode", readingModeHint: "Choose how translated text appears.", bilingual: "Bilingual", bilingualHint: "Original + translation", translatedOnly: "Translation", translatedHint: "Replace original text",
    pageReady: "Ready to translate this page", pageReadyHint: "Navigation, code, forms, and hidden content are skipped.", translatePage: "Translate this page", restoreOriginal: "Restore original page",
    pagePrivacy: "Local translation stays on this device. Cloud translation uses your chosen provider; read aloud uses the API service configured for OpenAI translation.", yourLibrary: "Your library", recentTranslations: "Recent translations",
    clearAll: "Clear all", searchHistory: "Search source or translation", noHistory: "No translations yet", noHistoryHint: "Translations you save will be waiting here.",
    makeItYours: "Make Prism yours", translationEngine: "Translation engine", engineHint: "Local by default. Cloud is always explicit.", endpoint: "Endpoint", apiKey: "API key", apiKeyOptional: "API key (optional)", model: "Model",
    interfaceLanguage: "Interface language", interfaceLanguageHint: "Follow Chrome or choose manually", appearance: "Appearance", appearanceHint: "Choose a light or dark appearance", system: "System", light: "Light", dark: "Dark",
    selectionBubble: "Selection bubble", selectionBubbleHint: "Show Prism after selecting text", saveHistorySetting: "Save history", saveHistoryHint: "Stored only in this browser profile", pageLimit: "Page segment limit",
    saveSettings: "Save settings", keysPrivacy: "API keys are kept in local extension storage and never synced by Prism.", copied: "Copied", saved: "Saved to history", settingsSaved: "Settings saved",
    enterText: "Enter some text first.", translating: "Translating…", downloading: "Downloading local translation pack…", pageTranslating: "Translating page", pageDone: "Page translated", pageRestored: "Original page restored",
    refreshPage: "Refresh this tab once so Prism can connect. Chrome settings, the Web Store, and new-tab pages cannot be translated.", restrictedPage: "Chrome protects this page from extensions.", noPageText: "No translatable text found.", segments: "segments", localUnavailable: "Local AI unavailable",
    historyCleared: "History cleared", openPage: "Open a web page", providerPermissionDenied: "Host access was not granted. This provider cannot connect yet.",
    listenWord: "Read word", noPronunciation: "Not in offline pronunciation dictionary", pronunciationUnavailable: "Pronunciation dictionary unavailable",
    codexHint: "Uses your local Codex CLI and login. Text is sent to your configured Codex model service; this is not offline inference.",
    codexConnect: "Detect connection & refresh models", reasoningEffort: "Reasoning effort", effortHint: "Lower reasoning is usually faster for translation.",
    codexSetup: "First-time setup", codexSetupHint: "In the Prism project folder, run this once, then detect the connection. Requires Node.js and a signed-in Codex CLI.",
    codexDetecting: "Connecting to Codex…", codexReady: "Connected", codexNotChecked: "Detect connection to load available models.", codexChoose: "Detect connection first", codexUnavailable: "Saved selection unavailable — choose again",
    openaiSaveFirst: "Save OpenAI settings before translating.", codexSelect: "Detect connection and choose a valid model and reasoning effort first.",
    openaiCli: "Local Codex CLI", openaiApi: "API", openaiDetecting: "Connecting to OpenAI API…",
    openaiApiHint: "Use an API key independently of your Codex CLI login. OpenAI-compatible services are also supported.",
    openaiApiSelect: "Enter the API endpoint, API key and model first.",
    openaiModelHint: "Choose a text chat model. If model detection is unavailable, enter the model ID manually.",
    openaiFastMode: "Fast mode",
    openaiFastHint: "Faster API translation at a higher price. Off uses Standard processing. Actual speed depends on service availability.",
    openaiFastCompatibleHint: "Faster API translation at a higher price. Your provider must support Fast; when off, its default tier applies.",
    openaiFastUnavailable: "Fast support is not confirmed for this model. Choose a supported OpenAI text model.",
    openaiEffortDefault: "Unspecified (model default)", openaiEffortNone: "none (reasoning off)",
    openaiEffortHint: "Unspecified uses the model default. Explicit levels, including none, require model support; use Unspecified for non-reasoning models.",
    kimiConnection: "Connection", kimiCli: "Local CLI", kimiApi: "Open Platform API",
    kimiCliHint: "Uses your local Kimi Code login and cloud service; this is not offline inference. Thinking follows your CLI configuration.",
    kimiApiHint: "Use a Kimi Open Platform API key, billed separately from your Kimi Code subscription.",
    kimiSetupHint: "Run this once in the Prism project folder, then detect the connection. Requires Node.js and a signed-in Kimi Code CLI.",
    kimiRegion: "Service region", kimiCn: "China · api.moonshot.cn", kimiGlobal: "Global · api.moonshot.ai",
    kimiModelHint: "Detect models or enter a model ID", kimiDetecting: "Connecting to Kimi…",
    kimiSelect: "Detect the Kimi CLI connection and choose a model first.", kimiApiSelect: "Enter a Kimi API key and model first.",
    kimiSaveFirst: "Save Kimi settings before translating.", thinkingOff: "Off", thinkingOn: "On", thinkingDefault: "Model default",
    preparing: "Preparing local translator…",
    detecting: "Detecting source language…",
    collecting: "Collecting page text…",
    applying: "Applying translations…",
    pageChanged: "The page changed during translation. Please translate it again.",
    changedSegments: "changed segments skipped",
    saveTranslationFirst: "Save your translation engine changes before translating.",
    historySaveFailed: "Translation complete; history could not be saved.",
    clipboardFailed: "Clipboard access failed. Please copy or paste manually.",
    historyFailed: "Could not update history. Please try again.",
    noMatches: "No matching translations",
    noMatchesHint: "Try another search or turn off the favorites filter.",
    favoritesOnly: "Favorites only",
    remove: "Delete",
    favorite: "Add to favorites",
    unfavorite: "Remove from favorites",
    auto: "Follow Chrome",
    confirmClear: "Delete all translation history, including favorites?",
    savedFavorite: "Added to favorites",
    localUnavailableHint: "Local translation is unavailable here. Use a supported Chrome version (138+) or choose another engine.",
    localPackUnavailable: "This language pair is unavailable locally. Choose another engine.",
    translationTimedOut: "Translation timed out. Try less text or a lower reasoning effort.",
    swap: "Swap languages",
    openSettings: "Open settings",
    localEngineHint: "Text is translated on this device. Chrome may download a local language pack the first time you use a language pair.",
    myMemoryHint: "An online service with no API key. Text is sent to MyMemory; daily usage limits apply."
  },
  zh: {
    brandSubtitle: "网页翻译与朗读", tabTranslate: "翻译", tabPage: "网页", tabHistory: "历史", tabSettings: "设置",
    from: "源语言", to: "目标语言", sourceText: "原文", sourcePlaceholder: "输入、粘贴，或在任意网页中选择文字…", paste: "粘贴", clear: "清空", translateNow: "立即翻译",
    translation: "译文", resultHint: "译文会显示在这里。", copy: "复制", listen: "朗读", save: "收藏", currentTab: "当前标签页",
    readingMode: "阅读模式", readingModeHint: "选择译文在网页中的呈现方式。", bilingual: "双语对照", bilingualHint: "原文 + 译文", translatedOnly: "仅看译文", translatedHint: "使用译文替换原文",
    pageReady: "可以翻译当前网页", pageReadyHint: "会跳过导航、代码、表单和隐藏内容。", translatePage: "翻译当前网页", restoreOriginal: "恢复原始网页",
    pagePrivacy: "本地翻译在设备内完成；云端翻译使用所选服务商，朗读使用 OpenAI 翻译中配置的 API 服务。", yourLibrary: "翻译资料库", recentTranslations: "最近翻译",
    clearAll: "全部清空", searchHistory: "搜索原文或译文", noHistory: "还没有翻译记录", noHistoryHint: "收藏或自动保存的翻译会出现在这里。",
    makeItYours: "把 Prism 调成顺手的样子", translationEngine: "翻译引擎", engineHint: "默认本地运行，云端服务始终由你明确选择。", endpoint: "接口地址", apiKey: "API 密钥", apiKeyOptional: "API 密钥（可选）", model: "模型",
    interfaceLanguage: "界面语言", interfaceLanguageHint: "跟随 Chrome 或手动选择", appearance: "外观", appearanceHint: "选择浅色、深色或跟随系统", system: "跟随系统", light: "浅色", dark: "深色",
    selectionBubble: "划词气泡", selectionBubbleHint: "选中文字后显示 Prism", saveHistorySetting: "保存历史", saveHistoryHint: "只保存在当前浏览器资料中", pageLimit: "网页片段上限",
    saveSettings: "保存设置", keysPrivacy: "API 密钥只保存在扩展的本地存储中，Prism 不会同步它们。", copied: "已复制", saved: "已保存到历史", settingsSaved: "设置已保存",
    enterText: "请先输入或选择文字。", translating: "正在翻译…", downloading: "正在下载本地翻译语言包…", pageTranslating: "正在翻译网页", pageDone: "网页翻译完成", pageRestored: "已恢复原始网页",
    refreshPage: "请刷新一次当前标签页，让 Prism 与网页建立连接。Chrome 设置页、扩展商店和新标签页无法翻译。", restrictedPage: "Chrome 不允许扩展访问这个系统页面。", noPageText: "没有找到可翻译的网页文字。", segments: "个片段", localUnavailable: "本地 AI 不可用",
    historyCleared: "历史记录已清空", openPage: "请先打开一个网页", providerPermissionDenied: "没有获得该地址的访问权限，暂时无法连接这个服务商。",
    listenWord: "朗读单词", noPronunciation: "离线词典暂未收录", pronunciationUnavailable: "音标词典暂不可用",
    codexHint: "复用本机 Codex CLI 和登录状态。原文会发送到 Codex 配置的模型服务，并非离线推理。",
    codexConnect: "检测连接并刷新模型", reasoningEffort: "推理强度", effortHint: "翻译通常选择较低强度，响应更快。",
    codexSetup: "首次连接设置", codexSetupHint: "在 Prism 项目目录中执行一次下面的命令，再检测连接。需要 Node.js 和已登录的 Codex CLI。",
    codexDetecting: "正在连接 Codex…", codexReady: "已连接", codexNotChecked: "检测连接后加载本机可用模型。", codexChoose: "请先检测连接", codexUnavailable: "已保存的选项不可用，请重新选择",
    openaiSaveFirst: "请先保存 OpenAI 设置，再开始翻译。", codexSelect: "请先检测连接，选择有效的模型和推理强度。",
    openaiCli: "本机 Codex CLI", openaiApi: "API", openaiDetecting: "正在连接 OpenAI API…",
    openaiApiHint: "使用 API Key，与 Codex CLI 登录独立；也支持 OpenAI 兼容服务。",
    openaiApiSelect: "请先填写 API 接口地址、API Key 和模型。",
    openaiModelHint: "请选择支持文本对话的模型；接口不支持检测时可手动填写模型 ID。",
    openaiFastMode: "Fast 模式",
    openaiFastHint: "加快 API 翻译，费用更高。关闭后使用标准档位，实际速度取决于服务可用性。",
    openaiFastCompatibleHint: "加快 API 翻译，费用更高。需接口服务商支持 Fast；关闭后沿用服务商默认档位。",
    openaiFastUnavailable: "尚未确认此模型支持 Fast，请选择支持的 OpenAI 文本模型。",
    openaiEffortDefault: "不指定（模型默认）", openaiEffortNone: "none（关闭推理）",
    openaiEffortHint: "不指定时使用模型默认值。各档位（含 none）需模型支持；非推理模型请选择“不指定”。",
    kimiConnection: "接入方式", kimiCli: "本机 CLI", kimiApi: "开放平台 API",
    kimiCliHint: "复用本机 Kimi Code 登录和云端模型服务，并非离线推理。思考强度沿用 CLI 配置。",
    kimiApiHint: "使用 Kimi 开放平台 API Key，与 Kimi Code 订阅分别计费。",
    kimiSetupHint: "在 Prism 项目目录中执行一次下面的命令，再检测连接。需要 Node.js 和已登录的 Kimi Code CLI。",
    kimiRegion: "服务区域", kimiCn: "国内 · api.moonshot.cn", kimiGlobal: "国际 · api.moonshot.ai",
    kimiModelHint: "检测模型或手动填写模型 ID", kimiDetecting: "正在连接 Kimi…",
    kimiSelect: "请先检测 Kimi CLI 连接并选择模型。", kimiApiSelect: "请先填写 Kimi API Key 和模型。",
    kimiSaveFirst: "请先保存 Kimi 设置，再开始翻译。", thinkingOff: "关闭思考", thinkingOn: "开启思考", thinkingDefault: "使用模型默认值",
    preparing: "正在准备本地翻译…",
    detecting: "正在识别原文语言…",
    collecting: "正在收集网页文字…",
    applying: "正在写入网页译文…",
    pageChanged: "网页内容已变化，请重新翻译当前网页。",
    changedSegments: "个已变化片段已跳过",
    saveTranslationFirst: "请先保存翻译引擎的修改，再开始翻译。",
    historySaveFailed: "译文已完成，但未能保存历史记录。",
    clipboardFailed: "无法访问剪贴板，请手动复制或粘贴。",
    historyFailed: "未能更新历史记录，请重试。",
    noMatches: "没有匹配的翻译",
    noMatchesHint: "试试其他关键词，或关闭仅看收藏。",
    favoritesOnly: "仅看收藏",
    remove: "删除",
    favorite: "收藏",
    unfavorite: "取消收藏",
    auto: "跟随 Chrome",
    confirmClear: "清空所有翻译历史（包含收藏）？",
    savedFavorite: "已收藏",
    localUnavailableHint: "当前环境无法使用本地翻译，请使用受支持的 Chrome（138+），或选择其他引擎。",
    localPackUnavailable: "本地翻译暂不支持这组语言，请选择其他引擎。",
    translationTimedOut: "翻译超时，请缩短文本或降低推理强度后重试。",
    swap: "交换语言",
    openSettings: "打开设置",
    localEngineHint: "文字在本机翻译。首次使用某组语言时，Chrome 可能需要下载对应的本地语言包。",
    myMemoryHint: "无需 API Key 的在线翻译服务。原文会发送至 MyMemory，服务有每日使用额度。"
  }
};

let settings;
let uiLanguage = "en";
let selectedProvider = "chrome";
let lastResult = null;
let history = [];
let favoritesOnly = false;
let toastTimer;
let codexModels = [];
let kimiCliModels = [];
let kimiApiRequest = 0;
let openaiApiRequest = 0;
let inputRequest = 0;
let pageRequest = 0;
let pageBusy = false;
let pageRefreshRequest = 0;
let settingsSaving = false;
let pronunciationWord = "";
const ownerTabId = panelTabId(location.href);
let lastPendingActionId;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const t = (key) => copy[uiLanguage]?.[key] || copy.en[key] || key;

const reader = createReader({ getSettings: () => settings, sendToTab: sendToPanelTab, toast: showToast, showSettings: () => switchTab("settings"), getConnectionDraft: openaiSettingsDraft, chinese: () => uiLanguage === "zh" });
Object.assign(copy.en, { readSource: "Read aloud", readAloud: "Read aloud", readHint: "Listen to selected text or the article body.", readPage: "Read article", readSelection: "Read selection", speechSettings: "OpenAI · Read aloud", speechHint: "Uses the API connection configured for OpenAI translation. AI-generated voice.", speechKeyHint: "Shares the endpoint and API key from OpenAI translation. Choose only the reading model, voice and speed here.", voice: "Voice", speechRate: "Playback speed", voicePreview: "Preview voice", previewHint: "Preview uses these choices and incurs API usage. Save settings to use them for reading.", stopReading: "Stop", previousPart: "Previous", nextPart: "Next", readerNote: "AI-generated voice · Keep this panel open while listening." });
Object.assign(copy.zh, { readSource: "朗读原文", readAloud: "朗读", readHint: "朗读选中的段落，或按顺序朗读文章正文。", readPage: "朗读整篇文章", readSelection: "朗读选中段落", speechSettings: "OpenAI · 朗读设置", speechHint: "共用翻译中的 OpenAI API 配置，声音由 AI 合成。", speechKeyHint: "接口地址和 API Key 与 OpenAI 翻译共用，这里只需选择朗读模型、音色和速度。", voice: "音色", speechRate: "播放速度", voicePreview: "试听当前音色", previewHint: "试听使用当前选项并产生 API 用量；保存设置后用于网页朗读。", stopReading: "停止", previousPart: "上一段", nextPart: "下一段", readerNote: "AI 合成语音 · 朗读时请保持侧边栏打开。" });

Object.assign(copy.en, { keyboardShortcuts: "Keyboard shortcuts", keyboardShortcutsHint: "Use the current selection, or the page. Press Read again to pause or resume.", shortcutSelection: "Translate selection / page", shortcutRead: "Read / pause / resume", shortcutPage: "Translate / restore page", configureShortcuts: "Change shortcuts", shortcutUnassigned: "Not assigned", shortcutUnavailable: "Unavailable", shortcutsOpenFailed: "Open chrome://extensions/shortcuts to change shortcuts." });
Object.assign(copy.zh, { keyboardShortcuts: "键盘快捷键", keyboardShortcutsHint: "优先处理选中文字，无选区时处理网页；朗读中再次按下可暂停或继续。", shortcutSelection: "翻译选区 / 网页", shortcutRead: "朗读 / 暂停 / 继续", shortcutPage: "翻译 / 恢复网页", configureShortcuts: "修改快捷键", shortcutUnassigned: "未设置", shortcutUnavailable: "无法读取", shortcutsOpenFailed: "请打开 chrome://extensions/shortcuts 修改快捷键。" });

async function refreshShortcuts() {
  try {
    const commands = await chrome.commands.getAll();
    $$('[data-command]').forEach(node => {
      node.textContent = commands.find(command => command.name === node.dataset.command)?.shortcut || t("shortcutUnassigned");
    });
  } catch {
    $$('[data-command]').forEach(node => { node.textContent = t("shortcutUnavailable"); });
  }
}

function translationError(error) {
  if (error.name === "AbortError") return t("translationTimedOut");
  const key = { LOCAL_API_UNAVAILABLE: "localUnavailableHint", LANGUAGE_PAIR_UNAVAILABLE: "localPackUnavailable", TIMEOUT: "translationTimedOut" }[error.code];
  return key ? t(key) : error.message;
}

function resolvedUiLanguage(value) {
  if (value === "zh" || value === "en") return value;
  return chrome.i18n.getUILanguage().toLowerCase().startsWith("zh") ? "zh" : "en";
}

function applyLanguage() {
  document.documentElement.lang = uiLanguage === "zh" ? "zh-CN" : "en";
  $$('[data-i18n]').forEach((node) => { node.textContent = t(node.dataset.i18n); });
  $$('[data-i18n-placeholder]').forEach((node) => { node.placeholder = t(node.dataset.i18nPlaceholder); });
  $$('[data-i18n-label]').forEach((node) => { node.title = t(node.dataset.i18nLabel); node.setAttribute("aria-label", node.title); });
  populateLanguageMenus();
  void refreshShortcuts();
}

function applyTheme(value) {
  const dark = value === "dark" || (value === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

function showToast(message, duration = 2400) {
  clearTimeout(toastTimer);
  const toast = $("#toast");
  toast.textContent = message;
  toast.style.display = "block";
  toastTimer = setTimeout(() => { toast.style.display = "none"; }, duration);
}

function switchTab(name) {
  $$(".tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === name);
    button.setAttribute("aria-pressed", String(button.dataset.tab === name));
  });
  $$(".panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === name));
  if (name === "history") renderHistory();
  if (name === "page") refreshPageState();
  if (name === "settings") { updateSettingsSaveBar(); void refreshShortcuts(); }
}

function populateLanguageMenus() {
  const sourceValue = $("#source-language").value || settings?.sourceLanguage || "auto";
  const targetValue = $("#target-language").value || settings?.targetLanguage || "zh";
  for (const [selector, allowAuto, value] of [["#source-language", true, sourceValue], ["#target-language", false, targetValue]]) {
    const select = $(selector);
    select.replaceChildren();
    for (const [code, english, chinese] of LANGUAGES) {
      if (!allowAuto && code === "auto") continue;
      const option = document.createElement("option");
      option.value = code;
      option.textContent = uiLanguage === "zh" ? chinese : english;
      select.append(option);
    }
    select.value = value;
  }
}

function updateProviderStatus() {
  const provider = PROVIDERS.find(({ id }) => id === settings.provider) || PROVIDERS[0];
  const badge = provider.id === "openai" ? `OPENAI ${settings.openaiConnection.toUpperCase()}`
    : provider.id === "kimi" ? `KIMI ${settings.kimiConnection.toUpperCase()}` : provider.badge;
  $("#provider-status b").textContent = provider.id === "chrome" && !hasLocalTranslator() ? t("localUnavailable") : badge;
  $("#provider-status").classList.toggle("unavailable", provider.id === "chrome" && !hasLocalTranslator());
  if (!lastResult) $("#result-provider").textContent = badge;
}

function renderProviderGrid() {
  const grid = $("#provider-grid");
  grid.replaceChildren();
  for (const provider of PROVIDERS) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-pressed", String(provider.id === selectedProvider));
    button.className = `provider-option${provider.id === selectedProvider ? " active" : ""}`;
    const name = document.createElement("b");
    name.textContent = provider.name;
    const badge = document.createElement("small");
    badge.textContent = provider.id === "chrome" && !hasLocalTranslator() ? t("localUnavailable") : provider.badge;
    button.append(name, badge);
    button.addEventListener("click", () => {
      selectedProvider = provider.id;
      updateSettingsSaveBar();
      renderProviderGrid();
      updateProviderConfig();
      updateProviderStatus();
    });
    grid.append(button);
  }
}

function updateProviderConfig() {
  $$(".provider-config").forEach((node) => node.classList.remove("active"));
  $(`#${selectedProvider}-config`)?.classList.add("active");
}

function fillSettingsForm(values = settings) {
  reader.fill(values);
  selectedProvider = values.provider;
  $("#openai-connection").value = values.openaiConnection;
  $("#openai-endpoint").value = values.openaiEndpoint;
  $("#openai-key").value = values.openaiApiKey;
  $("#openai-model").value = values.openaiModel;
  $("#openai-fast").checked = values.openaiFastMode === true;
  updateOpenAiFast();
  $("#openai-effort").replaceChildren(
    new Option(t("openaiEffortDefault"), ""),
    ...OPENAI_REASONING_EFFORTS.map((effort) => new Option(effort === "none" ? t("openaiEffortNone") : effort, effort))
  );
  $("#openai-effort").value = values.openaiReasoningEffort;
  populateCodexModels(values.codexModel, values.codexReasoningEffort);
  $("#codex-install-command").textContent = `node scripts/install-codex-host.mjs ${chrome.runtime.id}`;
  if (!$("#codex-status").textContent) $("#codex-status").textContent = t("codexNotChecked");
  updateOpenAiConnection();
  $("#kimi-connection").value = values.kimiConnection;
  populateKimiCliModels(values.kimiCliModel);
  $("#kimi-api-region").value = values.kimiApiRegion;
  $("#kimi-api-key").value = values.kimiApiKey;
  $("#kimi-api-model").value = values.kimiApiModel;
  populateKimiThinking(values.kimiApiThinking);
  $("#kimi-install-command").textContent = `node scripts/install-kimi-host.mjs ${chrome.runtime.id}`;
  if (!$("#kimi-cli-status").textContent) $("#kimi-cli-status").textContent = t("codexNotChecked");
  updateKimiConnection();
  $("#ui-language").value = values.uiLanguage;
  $("#theme").value = values.theme;
  $("#selection-bubble").checked = values.showSelectionBubble;
  $("#save-history").checked = values.saveHistory;
  $("#page-limit").value = values.maxPageSegments;
  $("#page-limit-value").textContent = values.maxPageSegments;
  renderProviderGrid();
  updateProviderConfig();
  updateProviderStatus();
  updateSettingsSaveBar();
}

function setOptions(select, options, selected) {
  select.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
  select.value = selected;
}

function populateCodexModels(preferred = "", preferredEffort = "") {
  const options = codexModels.map((entry) => [entry.model, entry.displayName || entry.model]);
  let selected = preferred || codexModels.find((entry) => entry.isDefault)?.model || options[0]?.[0] || "";
  if (!options.length) options.push([preferred, preferred || t("codexChoose")]);
  else if (preferred && !codexModels.some((entry) => entry.model === preferred)) {
    options.unshift(["", t("codexUnavailable")]); selected = "";
  }
  setOptions($("#codex-model"), options, selected);
  $("#codex-model").disabled = !codexModels.length;
  populateCodexEfforts(preferredEffort);
}

function populateCodexEfforts(preferred = "") {
  const model = codexModels.find((entry) => entry.model === $("#codex-model").value);
  const options = (model?.supportedReasoningEfforts || []).map((entry) => [entry.reasoningEffort, entry.reasoningEffort]);
  let selected = preferred || (options.some(([value]) => value === "low") ? "low" : model?.defaultReasoningEffort) || "";
  if (!options.length) options.push([preferred, preferred || t("codexChoose")]);
  else if (!options.some(([value]) => value === selected)) { options.unshift(["", t("codexUnavailable")]); selected = ""; }
  setOptions($("#codex-effort"), options, selected);
  $("#codex-effort").disabled = !model;
}

async function detectCodex() {
  const button = $("#codex-connect");
  button.disabled = true;
  $("#codex-status").textContent = t("codexDetecting");
  try {
    const response = await chrome.runtime.sendMessage({ type: "PRISM_CODEX_MODELS" });
    if (!response?.ok) throw new Error(response?.error || "Codex unavailable.");
    if (!response.models?.length) throw new Error(t("codexSelect"));
    const model = $("#codex-model").value;
    const effort = $("#codex-effort").value;
    codexModels = response.models;
    populateCodexModels(model, effort);
    $("#codex-status").textContent = `${t("codexReady")} · ${response.version}`;
  } catch (error) {
    codexModels = [];
    populateCodexModels($("#codex-model").value, $("#codex-effort").value);
    $("#codex-status").textContent = error.message;
  } finally { button.disabled = false; updateSettingsSaveBar(); }
}

function updateOpenAiConnection() {
  const cli = $("#openai-connection").value === "cli";
  $("#openai-cli-config").hidden = !cli;
  $("#openai-api-config").hidden = cli;
}

function updateOpenAiFast() {
  const supported = supportsOpenAiFast($("#openai-model").value);
  const toggle = $("#openai-fast");
  toggle.disabled = !supported;
  if (!supported) toggle.checked = false;
  let official = false;
  try { official = new URL($("#openai-endpoint").value).origin === "https://api.openai.com"; } catch { /* Incomplete input. */ }
  $("#openai-fast-hint").textContent = t(!supported ? "openaiFastUnavailable" : official ? "openaiFastHint" : "openaiFastCompatibleHint");
}

function invalidateOpenAiApiModels() {
  openaiApiRequest++;
  $("#openai-api-models").replaceChildren();
  $("#openai-api-status").textContent = "";
  $("#openai-api-connect").disabled = false;
}

async function detectOpenAiApi() {
  const request = ++openaiApiRequest;
  const draft = openaiSettingsDraft();
  $("#openai-api-connect").disabled = true;
  $("#openai-api-status").textContent = t("openaiDetecting");
  try {
    if (!draft.openaiApiKey) throw new Error(t("openaiApiSelect"));
    if (!await requestProviderPermission("openai", draft)) throw new Error(t("providerPermissionDenied"));
    if (request !== openaiApiRequest) return;
    const response = await chrome.runtime.sendMessage({ type: "PRISM_OPENAI_MODELS", endpoint: draft.openaiEndpoint, apiKey: draft.openaiApiKey });
    if (request !== openaiApiRequest) return;
    if (!response?.ok || !response.models?.length) throw new Error(response?.error || t("openaiApiSelect"));
    $("#openai-api-models").replaceChildren(...response.models.map(({ model }) => new Option(model, model)));
    $("#openai-api-status").textContent = `${t("codexReady")} · ${response.models.length} ${uiLanguage === "zh" ? "个模型" : "models"}`;
  } catch (error) {
    if (request === openaiApiRequest) $("#openai-api-status").textContent = translationError(error);
  } finally { if (request === openaiApiRequest) $("#openai-api-connect").disabled = false; }
}

function openaiSettingsDraft() {
  return {
    openaiConnection: $("#openai-connection").value,
    openaiEndpoint: $("#openai-endpoint").value.trim(),
    openaiApiKey: $("#openai-key").value.trim(),
    openaiModel: $("#openai-model").value.trim(),
    openaiReasoningEffort: $("#openai-effort").value,
    openaiFastMode: !$("#openai-fast").disabled && $("#openai-fast").checked,
    codexModel: $("#codex-model").value,
    codexReasoningEffort: $("#codex-effort").value
  };
}

function hasUnsavedOpenAiSettings() {
  if (selectedProvider !== "openai") return false;
  const draft = openaiSettingsDraft();
  const keys = draft.openaiConnection === "cli" ? ["codexModel", "codexReasoningEffort"] : ["openaiEndpoint", "openaiApiKey", "openaiModel", "openaiReasoningEffort", "openaiFastMode"];
  return settings.provider !== "openai" || ["openaiConnection", ...keys].some((key) => draft[key] !== settings[key]);
}

function updateKimiConnection() {
  const cli = $("#kimi-connection").value === "cli";
  $("#kimi-cli-config").hidden = !cli;
  $("#kimi-api-config").hidden = cli;
}

function populateKimiCliModels(preferred = "") {
  const options = kimiCliModels.map((entry) => [entry.model, entry.displayName || entry.model]);
  let selected = preferred || kimiCliModels.find((entry) => entry.isDefault)?.model || options[0]?.[0] || "";
  if (!options.length) options.push([preferred, preferred || t("codexChoose")]);
  else if (preferred && !kimiCliModels.some((entry) => entry.model === preferred)) {
    options.unshift(["", t("codexUnavailable")]); selected = "";
  }
  setOptions($("#kimi-cli-model"), options, selected);
  $("#kimi-cli-model").disabled = !kimiCliModels.length;
}

function populateKimiThinking(preferred = $("#kimi-api-thinking").value) {
  const values = kimiThinkingOptions($("#kimi-api-model").value.trim());
  const labels = { off: t("thinkingOff"), on: t("thinkingOn"), default: t("thinkingDefault") };
  setOptions($("#kimi-api-thinking"), values.map((value) => [value, labels[value] || value]), values.includes(preferred) ? preferred : values[0]);
  $("#kimi-api-thinking").disabled = values.length === 1;
}

async function detectKimiCli() {
  const button = $("#kimi-cli-connect");
  button.disabled = true;
  $("#kimi-cli-status").textContent = t("kimiDetecting");
  try {
    const response = await chrome.runtime.sendMessage({ type: "PRISM_KIMI_MODELS", connection: "cli" });
    if (!response?.ok || !response.models?.length) throw new Error(response?.error || t("kimiSelect"));
    kimiCliModels = response.models;
    populateKimiCliModels($("#kimi-cli-model").value);
    $("#kimi-cli-status").textContent = `${t("codexReady")} · ${response.version}`;
  } catch (error) {
    kimiCliModels = [];
    populateKimiCliModels($("#kimi-cli-model").value);
    $("#kimi-cli-status").textContent = error.message;
  } finally { button.disabled = false; updateSettingsSaveBar(); }
}

function invalidateKimiApiModels() {
  kimiApiRequest++;
  $("#kimi-api-models").replaceChildren();
  $("#kimi-api-status").textContent = "";
  $("#kimi-api-connect").disabled = false;
}

async function detectKimiApi() {
  const request = ++kimiApiRequest;
  const region = $("#kimi-api-region").value;
  const apiKey = $("#kimi-api-key").value.trim();
  $("#kimi-api-connect").disabled = true;
  $("#kimi-api-status").textContent = t("kimiDetecting");
  try {
    if (!apiKey) throw new Error(t("kimiApiSelect"));
    if (!await requestProviderPermission("kimi", { kimiConnection: "api", kimiApiRegion: region })) throw new Error(t("providerPermissionDenied"));
    if (request !== kimiApiRequest) return;
    const response = await chrome.runtime.sendMessage({ type: "PRISM_KIMI_MODELS", connection: "api", region, apiKey });
    if (request !== kimiApiRequest) return;
    if (!response?.ok || !response.models?.length) throw new Error(response?.error || t("kimiApiSelect"));
    $("#kimi-api-models").replaceChildren(...response.models.map(({ model }) => new Option(model, model)));
    if (!$("#kimi-api-model").value.trim()) $("#kimi-api-model").value = response.models[0].model;
    populateKimiThinking();
    $("#kimi-api-status").textContent = `${t("codexReady")} · ${response.models.length} ${uiLanguage === "zh" ? "个模型" : "models"}`;
  } catch (error) {
    if (request === kimiApiRequest) $("#kimi-api-status").textContent = translationError(error);
  } finally {
    if (request === kimiApiRequest) {
      $("#kimi-api-connect").disabled = false;
      updateSettingsSaveBar();
    }
  }
}

function kimiSettingsDraft() {
  return {
    kimiConnection: $("#kimi-connection").value,
    kimiCliModel: $("#kimi-cli-model").value,
    kimiApiRegion: $("#kimi-api-region").value,
    kimiApiKey: $("#kimi-api-key").value.trim(),
    kimiApiModel: $("#kimi-api-model").value.trim(),
    kimiApiThinking: $("#kimi-api-thinking").value
  };
}

function hasUnsavedKimiSettings() {
  if (selectedProvider !== "kimi") return false;
  const draft = kimiSettingsDraft();
  const keys = draft.kimiConnection === "cli" ? ["kimiCliModel"] : ["kimiApiRegion", "kimiApiKey", "kimiApiModel", "kimiApiThinking"];
  return settings.provider !== "kimi" || ["kimiConnection", ...keys].some((key) => draft[key] !== settings[key]);
}

function hasUnsavedTranslationSettings() {
  return selectedProvider !== settings.provider || hasUnsavedKimiSettings() || hasUnsavedOpenAiSettings();
}

async function displayPronunciation(text, request) {
  if ($("#source-language").value !== "auto" && !$("#source-language").value.startsWith("en")) return;
  if (!/^[a-z]+(?:['’‘-][a-z]+)*$/i.test(text) || text.length > 64) return;
  const response = await chrome.runtime.sendMessage({ type: "PRISM_PRONUNCIATION", text }).catch(() => null);
  if (request !== inputRequest) return;
  const value = response?.pronunciation;
  pronunciationWord = text;
  $("#pronunciation-text").textContent = value ? `${value.label} ${value.ipa}` : t(response?.ok ? "noPronunciation" : "pronunciationUnavailable");
  $("#pronunciation-text").title = value?.source || "";
  $("#pronunciation").hidden = false;
}

function currentTranslationSettings() {
  return {
    ...settings,
    sourceLanguage: $("#source-language").value,
    targetLanguage: $("#target-language").value
  };
}

function setBusy(button, busy) {
  button.disabled = busy;
  button.setAttribute("aria-busy", String(busy));
}

function updateResultActions() {
  $$("#result-actions button").forEach((button) => { button.disabled = !lastResult; });
}

function resetInputResult() {
  inputRequest++;
  lastResult = null;
  pronunciationWord = "";
  $("#pronunciation").hidden = true;
  $("#model-progress").hidden = true;
  $("#result-card").classList.remove("has-result");
  $("#language-route").textContent = "";
  setBusy($("#translate-button"), false);
  updateResultActions();
  updateProviderStatus();
}

function showProgress(progress, page = false) {
  const bar = $(page ? "#page-progress" : "#model-progress");
  const value = Math.min(1, Math.max(0, progress.value || 0));
  const waiting = progress.phase !== "download" && !(progress.completed > 0);
  bar.hidden = false;
  bar.classList.toggle("indeterminate", waiting);
  bar.querySelector("span").style.width = waiting ? "" : `${Math.round(value * 100)}%`;
  let label;
  if (progress.phase === "download") label = `${t("downloading")} ${Math.round(value * 100)}%`;
  else if (progress.phase === "prepare") label = t("preparing");
  else if (progress.phase === "detect") label = t("detecting");
  else label = page ? `${t("pageTranslating")} · ${progress.completed || 0}/${progress.total}` : t("translating");
  $(page ? "#page-status" : "#result-text").textContent = label;
}

async function translateInput() {
  if ($("#translate-button").getAttribute("aria-busy") === "true") return;
  const text = $("#source-text").value.trim();
  if (!text) return showToast(t("enterText"));
  if (hasUnsavedTranslationSettings()) return showToast(t("saveTranslationFirst"));
  const translationSettings = currentTranslationSettings();
  const request = ++inputRequest;
  lastResult = null;
  updateResultActions();
  $("#pronunciation").hidden = true;
  displayPronunciation(text, request);
  const button = $("#translate-button");
  const resultCard = $("#result-card");
  setBusy(button, true);
  resultCard.classList.add("has-result");
  $("#result-text").textContent = t("translating");
  $("#language-route").textContent = "";
  showProgress({ phase: "translate" });
  try {
    const result = await translateText(text, translationSettings, (progress) => {
      if (request !== inputRequest) return;
      showProgress(progress);
    });
    if (request !== inputRequest) return;
    lastResult = { sourceText: text, translatedText: result.translation, sourceLanguage: result.sourceLanguage, targetLanguage: result.targetLanguage, provider: result.provider };
    $("#result-text").textContent = result.translation;
    $("#language-route").textContent = `${result.sourceLanguage} → ${result.targetLanguage}`;
    $("#result-provider").textContent = ["kimi", "openai"].includes(result.provider) ? result.provider.toUpperCase() : PROVIDERS.find(({ id }) => id === result.provider)?.badge || result.provider;
    $("#model-progress").hidden = true;
    updateResultActions();
    if (translationSettings.saveHistory) {
      try {
        await addHistory(lastResult);
        history = await getHistory();
      } catch {
        if (request === inputRequest) showToast(t("historySaveFailed"));
      }
    }
  } catch (error) {
    if (request !== inputRequest) return;
    $("#result-text").textContent = translationError(error);
    $("#model-progress").hidden = true;
  } finally {
    if (request === inputRequest) setBusy(button, false);
  }
}

async function panelTab() {
  return resolveTab(chrome.tabs, ownerTabId);
}

function pageAccessMessage(error) {
  if (error?.code === TAB_ACCESS_ERROR.noActiveTab) return t("openPage");
  if (error?.code === TAB_ACCESS_ERROR.restrictedPage) return t("restrictedPage");
  return t("refreshPage");
}

const contentInjectionTasks = new Map();
async function injectContentRuntime(tabId) {
  if (contentInjectionTasks.has(tabId)) return contentInjectionTasks.get(tabId);
  const task = (async () => {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content/content.css"]
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/content.js"]
    });
  })();
  contentInjectionTasks.set(tabId, task);
  try {
    await task;
  } finally {
    contentInjectionTasks.delete(tabId);
  }
}

async function sendToPanelTab(message) {
  try {
    const response = (await messageTab(chrome.tabs, message, injectContentRuntime, ownerTabId)).response;
    if (response?.ok === false) throw Object.assign(new Error(response.code === "PAGE_CHANGED" ? t("pageChanged") : response.error), { code: response.code });
    return response;
  } catch (error) {
    if (error.code && !Object.values(TAB_ACCESS_ERROR).includes(error.code)) throw error;
    throw new Error(pageAccessMessage(error), { cause: error });
  }
}

async function refreshPageState() {
  const refresh = ++pageRefreshRequest;
  const request = pageRequest;
  try {
    const { tab, response: state } = await messageTab(
      chrome.tabs,
      { type: "PRISM_GET_PAGE_STATE" },
      injectContentRuntime,
      ownerTabId
    );
    const page = visiblePageDetails(tab, state);
    if (refresh !== pageRefreshRequest || request !== pageRequest) return;
    $("#page-title").textContent = page.title || t("openPage");
    $("#page-url").textContent = page.url || "—";
    $("#page-title").title = page.title || "";
    $("#page-url").title = page.url || "";
    if (pageBusy) return;
    $("#page-progress").hidden = true;
    if (state?.mode) renderPageMode(state.mode);
    $("#restore-page").disabled = !state?.active;
    if (state?.active) {
      $("#page-status").textContent = t("pageDone");
      $("#page-detail").textContent = `${state.count} ${t("segments")}`;
      $("#page-progress-bar").style.width = "100%";
    } else {
      $("#page-status").textContent = t("pageReady");
      $("#page-detail").textContent = t("pageReadyHint");
      $("#page-progress-bar").style.width = "0";
    }
  } catch (error) {
    if (refresh !== pageRefreshRequest || request !== pageRequest || pageBusy) return;
    const tab = await panelTab().catch(() => null);
    $("#page-title").textContent = tab?.title || t("openPage");
    $("#page-url").textContent = tab?.url || "—";
    $("#page-status").textContent = pageAccessMessage(error);
    $("#page-detail").textContent = "";
    $("#page-progress-bar").style.width = "0";
    $("#page-progress").hidden = true;
    $("#restore-page").disabled = true;
  }
}

let pageRefreshTimer;
function schedulePageStateRefresh() {
  clearTimeout(pageRefreshTimer);
  pageRefreshTimer = setTimeout(refreshPageState, 120);
}

async function translatePage() {
  if (pageBusy) return;
  if (hasUnsavedTranslationSettings()) return showToast(t("saveTranslationFirst"));
  const request = ++pageRequest;
  const translationSettings = currentTranslationSettings();
  pageBusy = true;
  const button = $("#translate-page");
  setBusy(button, true);
  $("#restore-page").disabled = true;
  $("#page-status").textContent = t("collecting");
  $("#page-detail").textContent = "";
  $("#page-progress").hidden = false;
  $("#page-progress").classList.add("indeterminate");
  try {
    const snapshot = await sendToPanelTab({ type: "PRISM_COLLECT_PAGE" });
    if (!snapshot?.items?.length) throw new Error(t("noPageText"));
    if (request !== pageRequest) return;
    $("#page-status").textContent = `${t("pageTranslating")} · 0/${snapshot.items.length}`;
    $("#page-detail").textContent = snapshot.totalLimited ? `${snapshot.items.length}+ ${t("segments")}` : `${snapshot.items.length} ${t("segments")}`;
    const result = await translateMany(snapshot.items.map(({ text }) => text), translationSettings, (progress) => {
      if (request === pageRequest) showProgress(progress, true);
    });
    if (request !== pageRequest) return;
    $("#page-status").textContent = t("applying");
    const translatedItems = snapshot.items.map((item, index) => ({ id: item.id, translation: result.translations[index] }));
    let applied = 0, skipped = 0;
    for (let index = 0; index < translatedItems.length; index += 40) {
      if (request !== pageRequest) return;
      const batch = translatedItems.slice(index, index + 40);
      const response = await sendToPanelTab({ type: "PRISM_APPLY_PAGE_BATCH", snapshotId: snapshot.snapshotId, mode: settings.pageMode, items: batch });
      applied += response.applied ?? batch.length;
      skipped += response.skipped || 0;
    }
    if (!applied) throw new Error(t("pageChanged"));
    $("#page-status").textContent = t("pageDone");
    $("#page-detail").textContent = `${applied} ${t("segments")}${skipped ? ` · ${skipped} ${t("changedSegments")}` : ""} · ${result.sourceLanguage} → ${result.targetLanguage}`;
    $("#page-progress-bar").style.width = "100%";
    $("#restore-page").disabled = false;
  } catch (error) {
    if (request !== pageRequest) return;
    $("#page-status").textContent = translationError(error);
    $("#page-progress-bar").style.width = "0";
    const state = await sendToPanelTab({ type: "PRISM_GET_PAGE_STATE" }).catch(() => null);
    if (request === pageRequest) $("#restore-page").disabled = !state?.active;
  } finally {
    if (request === pageRequest) {
      pageBusy = false;
      setBusy(button, false);
      $("#page-progress").hidden = true;
    }
  }
}

async function restorePage() {
  if (pageBusy) return;
  try {
    await sendToPanelTab({ type: "PRISM_RESTORE_PAGE" });
    $("#page-status").textContent = t("pageRestored");
    $("#page-detail").textContent = t("pageReadyHint");
    $("#page-progress-bar").style.width = "0";
    $("#restore-page").disabled = true;
  } catch (error) {
    showToast(error.message);
  }
}

function renderPageMode(mode) {
  $$("#page-mode button").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
    button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
  });
}

function renderHistory() {
  const search = $("#history-search").value.trim().toLowerCase();
  const visible = history.filter((entry) => {
    if (favoritesOnly && !entry.favorite) return false;
    return !search || `${entry.sourceText} ${entry.translatedText}`.toLowerCase().includes(search);
  });
  const list = $("#history-list");
  list.replaceChildren();
  for (const entry of visible) {
    const article = document.createElement("article");
    article.className = "history-item surface-card";
    const route = document.createElement("div"); route.className = "route"; route.textContent = `${entry.sourceLanguage} → ${entry.targetLanguage} · ${entry.provider}`;
    const original = document.createElement("p"); original.className = "original"; original.textContent = entry.sourceText;
    const translated = document.createElement("p"); translated.className = "translated"; translated.textContent = entry.translatedText;
    const tools = document.createElement("div"); tools.className = "history-tools";
    const favorite = document.createElement("button"); favorite.type = "button"; favorite.textContent = entry.favorite ? "★" : "☆";
    favorite.title = t(entry.favorite ? "unfavorite" : "favorite");
    favorite.setAttribute("aria-label", favorite.title);
    favorite.addEventListener("click", async (event) => { event.stopPropagation(); try { history = await toggleFavorite(entry.id); renderHistory(); } catch { showToast(t("historyFailed")); } });
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×";
    remove.title = t("remove"); remove.setAttribute("aria-label", remove.title);
    remove.addEventListener("click", async (event) => { event.stopPropagation(); try { history = await removeHistoryItem(entry.id); renderHistory(); } catch { showToast(t("historyFailed")); } });
    tools.append(favorite, remove); article.append(route, original, translated, tools);
    article.tabIndex = 0;
    const open = () => {
      resetInputResult();
      $("#source-text").value = entry.sourceText;
      lastResult = { ...entry };
      $("#result-text").textContent = entry.translatedText;
      $("#language-route").textContent = `${entry.sourceLanguage} → ${entry.targetLanguage}`;
      $("#result-provider").textContent = entry.provider === "codex" ? "OPENAI CLI" : String(entry.provider).toUpperCase();
      $("#result-card").classList.add("has-result");
      updateResultActions(); updateCharacterCount(); switchTab("translate");
    };
    article.addEventListener("click", open);
    article.addEventListener("keydown", (event) => { if (event.target === article && ["Enter", " "].includes(event.key)) { event.preventDefault(); open(); } });
    list.append(article);
  }
  $("#history-empty").style.display = visible.length ? "none" : "block";
  $("#history-empty h3").textContent = t(search || favoritesOnly ? "noMatches" : "noHistory");
  $("#history-empty p").textContent = t(search || favoritesOnly ? "noMatchesHint" : "noHistoryHint");
  $("#clear-history").disabled = !history.length;
}

function endpointPattern(value) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Only HTTP(S) endpoints are supported.");
  return `${url.protocol}//${url.host}/*`;
}

async function requestProviderPermission(provider, draft) {
  const kimiApi = provider === "kimi" && draft.kimiConnection === "api";
  const openaiApi = provider === "openai" && draft.openaiConnection === "api";
  if (!kimiApi && !openaiApi) return true;
  const pattern = kimiApi ? endpointPattern(kimiApiBase(draft.kimiApiRegion)) : openaiApiOrigin(draft.openaiEndpoint);
  if (await chrome.permissions.contains({ origins: [pattern] })) return true;
  return chrome.permissions.request({ origins: [pattern] });
}

function settingsDraft() {
  return {
    ...reader.draft(),
    ...kimiSettingsDraft(),
    ...openaiSettingsDraft(),
    provider: selectedProvider,
    sourceLanguage: $("#source-language").value,
    targetLanguage: $("#target-language").value,
    uiLanguage: $("#ui-language").value,
    theme: $("#theme").value,
    showSelectionBubble: $("#selection-bubble").checked,
    saveHistory: $("#save-history").checked,
    maxPageSegments: Number($("#page-limit").value)
  };
}

async function persistSettings() {
  if (settingsSaving) return;
  settingsSaving = true;
  updateSettingsSaveBar();
  const draft = settingsDraft();
  try {
    if (selectedProvider === "openai") {
      if (draft.openaiConnection === "cli" && (!draft.codexModel || !draft.codexReasoningEffort)) throw new Error(t("codexSelect"));
      if (draft.openaiConnection === "api" && (!draft.openaiEndpoint || !draft.openaiApiKey || !draft.openaiModel)) throw new Error(t("openaiApiSelect"));
    }
    if (selectedProvider === "kimi") {
      if (draft.kimiConnection === "cli" && !draft.kimiCliModel) throw new Error(t("kimiSelect"));
      if (draft.kimiConnection === "api" && (!draft.kimiApiKey || !draft.kimiApiModel)) throw new Error(t("kimiApiSelect"));
    }
    const granted = await requestProviderPermission(selectedProvider, draft);
    if (!granted) throw new Error(t("providerPermissionDenied"));
    settings = await saveSettings(draft);
    if (Object.entries(draft).every(([key, value]) => settingsDraft()[key] === value)) {
      uiLanguage = resolvedUiLanguage(settings.uiLanguage);
      applyLanguage(); applyTheme(settings.theme); fillSettingsForm();
    }
    updateProviderStatus();
    showToast(t("settingsSaved"));
  } catch (error) {
    showToast(error.message, 5000);
  } finally {
    settingsSaving = false;
    updateSettingsSaveBar();
  }
}

function updateCharacterCount() {
  $("#character-count").textContent = `${$("#source-text").value.length.toLocaleString()} / 12,000`;
}

async function processPendingAction(value) {
  if (ownerTabId === null) return;
  const key = pendingActionKey(ownerTabId);
  const action = value || (await chrome.storage.session.get(key))[key];
  if (!action || action.tabId !== ownerTabId || !action.id || action.id === lastPendingActionId || Date.now() - action.createdAt > 30_000) return;
  lastPendingActionId = action.id;
  await chrome.storage.session.remove(key);
  if (action.type === "settings") {
    switchTab("settings");
  } else if (action.type === "read-selection" || action.type === "read-page") {
    switchTab("page");
    reader.start(action.type === "read-page" ? "page" : "text", action.text);
  } else if (action.type === "selection") {
    switchTab("translate");
    if (action.text) {
      resetInputResult();
      $("#source-text").value = action.text;
      updateCharacterCount();
      translateInput();
    }
  } else if (action.type === "page") {
    switchTab("page");
    translatePage();
  }
}

function updateSettingsSaveBar() {
  const dirty = Object.entries(settingsDraft()).some(([key, value]) => value !== settings[key]);
  $("#save-settings").disabled = settingsSaving || !dirty;
  $("#save-settings").setAttribute("aria-busy", String(settingsSaving));
}

function receiveSettings(next) {
  if (settingsSaving) return;
  const draft = settingsDraft();
  const edits = Object.fromEntries(Object.entries(draft).filter(([key, value]) => value !== settings[key]));
  settings = next;
  const values = { ...next, ...edits };
  $("#source-language").value = values.sourceLanguage;
  $("#target-language").value = values.targetLanguage;
  uiLanguage = resolvedUiLanguage(values.uiLanguage);
  applyLanguage(); applyTheme(values.theme); fillSettingsForm(values);
  if (!pageBusy) refreshPageState();
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); showToast(t("copied")); }
  catch { showToast(t("clipboardFailed")); }
}

function wireEvents() {
  reader.wire();
  $("#configure-shortcuts").addEventListener("click", async () => {
    try { await chrome.tabs.create({ url: "chrome://extensions/shortcuts" }); }
    catch { showToast(t("shortcutsOpenFailed"), 5000); }
  });
  window.addEventListener("focus", () => { void refreshShortcuts(); });
  chrome.tabs.onUpdated.addListener((tabId, change) => { if (tabId === ownerTabId && (change.status === "loading" || change.url)) reader.stop(); });
  $('[data-panel="settings"]').addEventListener("input", updateSettingsSaveBar);
  $('[data-panel="settings"]').addEventListener("change", updateSettingsSaveBar);
  $("#openai-connection").addEventListener("change", updateOpenAiConnection);
  $("#openai-api-connect").addEventListener("click", detectOpenAiApi);
  $("#openai-endpoint").addEventListener("input", invalidateOpenAiApiModels);
  $("#openai-endpoint").addEventListener("input", updateOpenAiFast);
  $("#openai-model").addEventListener("input", updateOpenAiFast);
  $("#openai-key").addEventListener("input", invalidateOpenAiApiModels);
  $("#kimi-connection").addEventListener("change", updateKimiConnection);
  $("#kimi-cli-connect").addEventListener("click", detectKimiCli);
  $("#kimi-api-connect").addEventListener("click", detectKimiApi);
  $("#kimi-api-model").addEventListener("input", () => populateKimiThinking());
  $("#kimi-api-region").addEventListener("change", invalidateKimiApiModels);
  $("#kimi-api-key").addEventListener("input", invalidateKimiApiModels);
  $("#copy-kimi-command").addEventListener("click", () => copyText($("#kimi-install-command").textContent));
  $("#codex-connect").addEventListener("click", detectCodex);
  $("#codex-model").addEventListener("change", () => populateCodexEfforts());
  $("#copy-codex-command").addEventListener("click", () => copyText($("#codex-install-command").textContent));
  $("#speak-source").addEventListener("click", () => {
    if (!pronunciationWord) return;
    reader.start("text", pronunciationWord);
  });
  $$(".tab").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));
  $("#provider-status").addEventListener("click", () => switchTab("settings"));
  $("#source-text").addEventListener("input", () => { resetInputResult(); updateCharacterCount(); });
  $("#source-text").addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") translateInput();
  });
  $("#paste-text").addEventListener("click", async () => {
    try { const text = await navigator.clipboard.readText(); resetInputResult(); $("#source-text").value = text.slice(0, 12000); updateCharacterCount(); }
    catch { showToast(t("clipboardFailed")); }
  });
  $("#clear-text").addEventListener("click", () => { resetInputResult(); $("#source-text").value = ""; updateCharacterCount(); });
  for (const selector of ["#source-language", "#target-language"]) $(selector).addEventListener("change", () => { resetInputResult(); updateSettingsSaveBar(); });
  $("#swap-languages").addEventListener("click", () => {
    const source = $("#source-language").value;
    const target = $("#target-language").value;
    $("#source-language").value = target;
    $("#target-language").value = source === "auto" ? (target.startsWith("zh") ? "en" : "zh") : source;
    resetInputResult(); updateSettingsSaveBar();
  });
  $("#translate-button").addEventListener("click", translateInput);
  $("#copy-result").addEventListener("click", () => { if (lastResult) copyText(lastResult.translatedText); });
  $("#speak-result").addEventListener("click", () => { if (lastResult) reader.start("text", lastResult.translatedText); });
  $("#favorite-result").addEventListener("click", async () => { if (lastResult) { try { await addHistory({ ...lastResult, favorite: true }); history = await getHistory(); showToast(t("savedFavorite")); } catch { showToast(t("historyFailed")); } } });
  $("#translate-page").addEventListener("click", translatePage);
  $("#restore-page").addEventListener("click", restorePage);
  $$("#page-mode button").forEach((button) => button.addEventListener("click", async () => {
    const mode = button.dataset.mode;
    try {
      await sendToPanelTab({ type: "PRISM_SET_PAGE_MODE", mode });
      settings = await saveSettings({ pageMode: mode });
      renderPageMode(mode);
    } catch (error) { showToast(error.message); }
  }));
  $("#history-search").addEventListener("input", renderHistory);
  $("#favorites-only").addEventListener("click", () => { favoritesOnly = !favoritesOnly; $("#favorites-only").classList.toggle("active", favoritesOnly); $("#favorites-only").setAttribute("aria-pressed", String(favoritesOnly)); renderHistory(); });
  $("#clear-history").addEventListener("click", async () => { if (confirm(t("confirmClear"))) { try { await clearHistory(); history = []; renderHistory(); showToast(t("historyCleared")); } catch { showToast(t("historyFailed")); } } });
  $("#page-limit").addEventListener("input", () => { $("#page-limit-value").textContent = $("#page-limit").value; });
  $("#theme").addEventListener("change", () => applyTheme($("#theme").value));
  $("#ui-language").addEventListener("change", () => {
    const draft = settingsDraft();
    uiLanguage = resolvedUiLanguage(draft.uiLanguage);
    applyLanguage(); fillSettingsForm({ ...settings, ...draft }); renderHistory();
    if (!pageBusy) refreshPageState();
  });
  $("#save-settings").addEventListener("click", persistSettings);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if ($("#theme").value === "system") applyTheme("system"); });
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    if (ownerTabId === null || tabId === ownerTabId) schedulePageStateRefresh();
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if ((ownerTabId === null || tabId === ownerTabId) && (changeInfo.status === "complete" || changeInfo.url)) schedulePageStateRefresh();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    const action = changes[pendingActionKey(ownerTabId)]?.newValue;
    if (area === "session" && action) processPendingAction(action).catch((error) => showToast(error.message, 5000));
    if (area === "local" && changes.prismHistory) { history = changes.prismHistory.newValue || []; renderHistory(); }
  });
}

async function initialize() {
  await ensureDefaults();
  settings = await getSettings();
  history = await getHistory();
  uiLanguage = resolvedUiLanguage(settings.uiLanguage);
  applyTheme(settings.theme);
  applyLanguage();
  fillSettingsForm();
  $("#source-language").value = settings.sourceLanguage;
  $("#target-language").value = settings.targetLanguage;
  renderPageMode(settings.pageMode);
  updateResultActions();
  $("#input-shortcut").textContent = /Mac/i.test(navigator.platform) ? "⌘ ↵" : "Ctrl ↵";
  wireEvents();
  subscribeToSettings(receiveSettings);
  updateCharacterCount();
  refreshPageState();
  processPendingAction().catch((error) => showToast(error.message, 5000));
}

initialize().catch((error) => showToast(error.message, 5000));
