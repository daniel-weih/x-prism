import { SPEECH_MODELS, speechVoices } from "./speech.js";
export const STORAGE_KEYS = Object.freeze({
  settings: "prismSettings",
  secrets: "prismSecrets",
  history: "prismHistory"
});

export const SECRET_SETTING_KEYS = Object.freeze([
  "kimiApiKey",
  "openaiApiKey"
]);

export const OPENAI_REASONING_EFFORTS = Object.freeze([
  "none", "minimal", "low", "medium", "high", "xhigh", "max"
]);

export const DEFAULT_SETTINGS = Object.freeze({
  speechModel: "gpt-audio-1.5",
  speechVoice: "alloy",
  speechRate: 1,
  provider: "chrome",
  sourceLanguage: "auto",
  targetLanguage: "zh",
  pageMode: "bilingual",
  showSelectionBubble: true,
  autoTranslateSelection: false,
  saveHistory: true,
  uiLanguage: "auto",
  theme: "system",
  maxPageSegments: 240,
  openaiConnection: "cli",
  openaiEndpoint: "https://api.openai.com/v1/chat/completions",
  openaiApiKey: "",
  openaiModel: "gpt-4.1-mini",
  openaiReasoningEffort: "",
  openaiFastMode: false,
  codexModel: "",
  codexReasoningEffort: "",
  kimiConnection: "cli",
  kimiCliModel: "",
  kimiApiRegion: "cn",
  kimiApiKey: "",
  kimiApiModel: "",
  kimiApiThinking: "default"
});

export const PROVIDERS = Object.freeze([
  {
    id: "chrome",
    name: "Chrome Local AI",
    local: true,
    badge: "ON-DEVICE"
  },
  {
    id: "openai",
    name: "OpenAI",
    local: false,
    badge: "CLI / API"
  },
  {
    id: "kimi",
    name: "Kimi",
    local: false,
    badge: "CLI / API"
  },
  {
    id: "mymemory",
    name: "MyMemory",
    local: false,
    badge: "NO KEY"
  }
]);

export const LANGUAGES = Object.freeze([
  ["auto", "Auto detect", "自动检测"],
  ["zh", "Chinese (Simplified)", "简体中文"],
  ["zh-Hant", "Chinese (Traditional)", "繁體中文"],
  ["en", "English", "英语"],
  ["ja", "Japanese", "日语"],
  ["ko", "Korean", "韩语"],
  ["fr", "French", "法语"],
  ["de", "German", "德语"],
  ["es", "Spanish", "西班牙语"],
  ["it", "Italian", "意大利语"],
  ["pt", "Portuguese", "葡萄牙语"],
  ["ru", "Russian", "俄语"],
  ["ar", "Arabic", "阿拉伯语"],
  ["hi", "Hindi", "印地语"],
  ["th", "Thai", "泰语"],
  ["vi", "Vietnamese", "越南语"],
  ["id", "Indonesian", "印度尼西亚语"],
  ["tr", "Turkish", "土耳其语"],
  ["nl", "Dutch", "荷兰语"],
  ["pl", "Polish", "波兰语"],
  ["sv", "Swedish", "瑞典语"],
  ["uk", "Ukrainian", "乌克兰语"]
]);

export const MAX_HISTORY_ITEMS = 100;
export const MAX_SINGLE_TEXT_LENGTH = 12_000;

export function normalizeSettings(value = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...value };
  if (!SPEECH_MODELS.includes(merged.speechModel)) merged.speechModel = DEFAULT_SETTINGS.speechModel;
  if (!speechVoices(merged.speechModel).includes(merged.speechVoice)) merged.speechVoice = speechVoices(merged.speechModel)[0];
  if (![0.75, 1, 1.25, 1.5, 2].includes(Number(merged.speechRate))) merged.speechRate = 1;
  else merged.speechRate = Number(merged.speechRate);
  // Consolidate the former official-only speech key without overriding the
  // existing translation credential or sending an official key to a proxy.
  if (!String(merged.openaiApiKey || "").trim() && value.speechApiKey) {
    try {
      if (new URL(merged.openaiEndpoint).origin === "https://api.openai.com") merged.openaiApiKey = value.speechApiKey;
    } catch { /* Keep invalid endpoint handling in the API settings. */ }
  }
  delete merged.speechApiKey;
  // Before 1.4, "codex" was CLI-only and "openai" was API-only.
  if (value.provider === "codex") {
    merged.provider = "openai";
    merged.openaiConnection = "cli";
  } else if (!["cli", "api"].includes(value.openaiConnection)) {
    merged.openaiConnection = value.provider === "openai" ? "api" : DEFAULT_SETTINGS.openaiConnection;
  }
  if (!OPENAI_REASONING_EFFORTS.includes(merged.openaiReasoningEffort)) merged.openaiReasoningEffort = "";
  merged.openaiFastMode = merged.openaiFastMode === true;
  // Retired provider settings must not leak back into sync when splitting secrets.
  for (const key of ["deeplApiKey", "deeplUseFree", "libreEndpoint", "libreApiKey"]) delete merged[key];
  if (!["cli", "api"].includes(merged.kimiConnection)) merged.kimiConnection = "cli";
  if (!["cn", "global"].includes(merged.kimiApiRegion)) merged.kimiApiRegion = "cn";
  merged.maxPageSegments = Math.min(
    600,
    Math.max(40, Number(merged.maxPageSegments) || DEFAULT_SETTINGS.maxPageSegments)
  );
  if (!PROVIDERS.some((provider) => provider.id === merged.provider)) {
    merged.provider = DEFAULT_SETTINGS.provider;
  }
  if (!LANGUAGES.some(([code]) => code === merged.sourceLanguage)) {
    merged.sourceLanguage = DEFAULT_SETTINGS.sourceLanguage;
  }
  if (!LANGUAGES.some(([code]) => code === merged.targetLanguage && code !== "auto")) {
    merged.targetLanguage = DEFAULT_SETTINGS.targetLanguage;
  }
  return merged;
}

export function smartTargetFor(sourceLanguage, preferredTarget) {
  if (!sourceLanguage || sourceLanguage === "auto" || sourceLanguage === "und") {
    return preferredTarget;
  }
  const normalizedSource = sourceLanguage.toLowerCase();
  const normalizedTarget = preferredTarget.toLowerCase();
  if (normalizedSource === normalizedTarget) {
    return normalizedSource.startsWith("zh") ? "en" : "zh";
  }
  if (normalizedSource.startsWith("zh") && normalizedTarget.startsWith("zh")) {
    return "en";
  }
  return preferredTarget;
}
