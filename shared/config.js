import { SPEECH_MODELS, speechVoices } from "./speech.js";
import { OPENAI_ORIGIN, isUnsupportedTranslationModel, openAiTranslationTiers, openaiTranslationUrl } from "./openai-api.js";
export const STORAGE_KEYS = Object.freeze({
  settings: "prismSettings",
  secrets: "prismSecrets"
});

export const SECRET_SETTING_KEYS = Object.freeze([
  "kimiApiKey",
  "kimiCodeKey",
  "openaiApiKey"
]);

export const OPENAI_REASONING_EFFORTS = Object.freeze([
  "none", "minimal", "low", "medium", "high", "xhigh", "max"
]);

export const DEFAULT_SETTINGS = Object.freeze({
  speechModel: "",
  speechVoice: "alloy",
  speechRate: 1,
  provider: "chrome",
  sourceLanguage: "auto",
  targetLanguage: "zh",
  pageMode: "bilingual",
  showSelectionBubble: true,
  autoTranslateSelection: false,
  uiLanguage: "auto",
  theme: "system",
  maxPageSegments: 240,
  openaiEndpoint: `${OPENAI_ORIGIN}/v1/responses`,
  openaiApiKey: "",
  openaiModel: "",
  openaiReasoningEffort: "",
  openaiServiceTier: "default",
  kimiConnection: "code",
  kimiApiRegion: "cn",
  kimiApiKey: "",
  kimiApiModel: "",
  kimiApiThinking: "default",
  kimiCodeRegion: "cn",
  kimiCodeKey: "",
  kimiCodeModel: "",
  kimiCodeThinking: "default"
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
    badge: "API"
  },
  {
    id: "kimi",
    name: "Kimi",
    local: false,
    badge: "API"
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

export const MAX_SINGLE_TEXT_LENGTH = 12_000;

export function normalizeSettings(value = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...value };
  if (!SPEECH_MODELS.includes(merged.speechModel)) merged.speechModel = DEFAULT_SETTINGS.speechModel;
  if (!speechVoices(merged.speechModel).includes(merged.speechVoice)) merged.speechVoice = speechVoices(merged.speechModel)[0];
  if (![0.75, 1, 1.25, 1.5, 2].includes(Number(merged.speechRate))) merged.speechRate = 1;
  else merged.speechRate = Number(merged.speechRate);
  let wasOfficialEndpoint = false;
  try {
    const raw = new URL(String(merged.openaiEndpoint || "").trim());
    wasOfficialEndpoint = raw.origin === OPENAI_ORIGIN && !raw.username && !raw.password && !raw.hash;
  } catch { /* Non-URL values are reset below. */ }
  merged.openaiEndpoint = DEFAULT_SETTINGS.openaiEndpoint;
  if (isUnsupportedTranslationModel(merged.openaiModel, openaiTranslationUrl(merged.openaiEndpoint))) merged.openaiModel = "";
  // The retired speech key was issued for the official service.
  if (wasOfficialEndpoint && !String(merged.openaiApiKey || "").trim() && value.speechApiKey) merged.openaiApiKey = value.speechApiKey;
  delete merged.speechApiKey;
  if (value.provider === "codex") merged.provider = "openai";
  if (!OPENAI_REASONING_EFFORTS.includes(merged.openaiReasoningEffort)) merged.openaiReasoningEffort = "";
  const tier = value.openaiServiceTier ?? (value.openaiFastMode === true ? "fast" : "default");
  merged.openaiServiceTier = openAiTranslationTiers(merged.openaiModel, merged.openaiEndpoint).includes(tier) ? tier : "default";
  delete merged.openaiFastMode;
  // Retired provider, local-CLI, and history settings must not leak back into sync when splitting secrets.
  for (const key of ["deeplApiKey", "deeplUseFree", "libreEndpoint", "libreApiKey", "openaiConnection", "codexModel", "codexReasoningEffort", "kimiCliModel", "saveHistory"]) delete merged[key];
  if (!["api", "code"].includes(merged.kimiConnection)) merged.kimiConnection = DEFAULT_SETTINGS.kimiConnection;
  if (!["cn", "global"].includes(merged.kimiApiRegion)) merged.kimiApiRegion = "cn";
  if (!["cn", "global"].includes(merged.kimiCodeRegion)) merged.kimiCodeRegion = "cn";
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
