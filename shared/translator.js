import {
  MAX_SINGLE_TEXT_LENGTH,
  smartTargetFor
} from "./config.js";

const translatorCache = new Map();
let detectorPromise;

export class PrismTranslationError extends Error {
  constructor(message, code = "TRANSLATION_FAILED") {
    super(message);
    this.name = "PrismTranslationError";
    this.code = code;
  }
}

function reportDownload(monitor, onProgress) {
  if (!monitor || !onProgress) return;
  monitor.addEventListener("downloadprogress", (event) => {
    const value = Math.min(1, Math.max(0, event.loaded || 0));
    onProgress({ phase: value >= 1 ? "prepare" : "download", value });
  });
}

async function detectWithChromeI18n(text) {
  return new Promise((resolve) => {
    chrome.i18n.detectLanguage(text, (result) => {
      if (chrome.runtime.lastError) {
        resolve("und");
        return;
      }
      resolve(result?.languages?.[0]?.language || "und");
    });
  });
}

export async function detectLanguage(text) {
  const sample = String(text || "").trim().slice(0, 4_000);
  if (!sample) return "und";
  if (!("LanguageDetector" in globalThis)) {
    return detectWithChromeI18n(sample);
  }
  try {
    detectorPromise ||= (async () => {
      const availability = await LanguageDetector.availability();
      // Do not spend the same transient user activation downloading two models.
      // Chrome's lightweight detector is a reliable fallback until the AI detector is ready.
      if (availability !== "available") return null;
      // The model is already installed. Its synthetic 100% event is not a download.
      return LanguageDetector.create();
    })();
    const detector = await detectorPromise;
    if (!detector) return detectWithChromeI18n(sample);
    const results = await detector.detect(sample);
    return results?.[0]?.detectedLanguage || "und";
  } catch {
    detectorPromise = undefined;
    return detectWithChromeI18n(sample);
  }
}

export function hasLocalTranslator() {
  return "Translator" in globalThis;
}

async function getLocalTranslator(sourceLanguage, targetLanguage, onProgress) {
  if (!hasLocalTranslator()) {
    throw new PrismTranslationError(
      "Chrome local translation is unavailable. Use Chrome 138+ or choose a cloud provider.",
      "LOCAL_API_UNAVAILABLE"
    );
  }
  const key = `${sourceLanguage}:${targetLanguage}`;
  if (!translatorCache.has(key)) {
    translatorCache.set(key, (async () => {
      const availability = await Translator.availability({
        sourceLanguage,
        targetLanguage
      });
      if (availability === "unavailable") {
        throw new PrismTranslationError(
          `The ${sourceLanguage} → ${targetLanguage} language pack is unavailable.`,
          "LANGUAGE_PAIR_UNAVAILABLE"
        );
      }
      return Translator.create({
        sourceLanguage,
        targetLanguage,
        ...(availability === "available" ? {} : {
          monitor: (monitor) => reportDownload(monitor, onProgress)
        })
      });
    })().catch((error) => {
      translatorCache.delete(key);
      throw error;
    }));
  }
  return translatorCache.get(key);
}

async function localTranslateMany(texts, sourceLanguage, targetLanguage, onProgress) {
  const translator = await getLocalTranslator(sourceLanguage, targetLanguage, onProgress);
  onProgress?.({ phase: "translate", value: 0, completed: 0, total: texts.length });
  const output = new Array(texts.length);
  let cursor = 0;
  let completed = 0;
  const worker = async () => {
    while (cursor < texts.length) {
      const index = cursor++;
      output[index] = await translator.translate(texts[index]);
      completed += 1;
      onProgress?.({ phase: "translate", value: completed / texts.length, completed, total: texts.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, texts.length) }, worker));
  return output;
}

async function remoteTranslateMany(texts, provider, sourceLanguage, targetLanguage, onProgress) {
  onProgress?.({ phase: "translate", value: 0, completed: 0, total: texts.length });
  const response = await chrome.runtime.sendMessage({
    type: "PRISM_REMOTE_TRANSLATE",
    provider,
    texts,
    sourceLanguage,
    targetLanguage
  });
  if (!response?.ok) {
    throw new PrismTranslationError(
      response?.error || "The translation provider returned an error.",
      response?.code || "REMOTE_TRANSLATION_FAILED"
    );
  }
  onProgress?.({ phase: "translate", value: 1, completed: texts.length, total: texts.length });
  return response.translations;
}

export async function translateMany(texts, settings, onProgress) {
  const normalizedTexts = texts
    .map((text) => String(text || "").trim())
    .filter(Boolean);
  if (!normalizedTexts.length) {
    throw new PrismTranslationError("Enter or select some text first.", "EMPTY_TEXT");
  }
  if (normalizedTexts.some((text) => text.length > MAX_SINGLE_TEXT_LENGTH)) {
    throw new PrismTranslationError(
      `A translation segment is longer than ${MAX_SINGLE_TEXT_LENGTH.toLocaleString()} characters.`,
      "TEXT_TOO_LONG"
    );
  }
  if (settings.sourceLanguage === "auto") onProgress?.({ phase: "detect" });
  const detectedLanguage = settings.sourceLanguage === "auto"
    ? await detectLanguage(normalizedTexts.slice(0, 8).join(" "))
    : settings.sourceLanguage;
  const sourceLanguage = detectedLanguage === "und" ? "en" : detectedLanguage;
  const targetLanguage = smartTargetFor(sourceLanguage, settings.targetLanguage);
  const translations = settings.provider === "chrome"
    ? await localTranslateMany(normalizedTexts, sourceLanguage, targetLanguage, onProgress)
    : await remoteTranslateMany(
      normalizedTexts,
      settings.provider,
      settings.sourceLanguage === "auto" ? sourceLanguage : settings.sourceLanguage,
      targetLanguage,
      onProgress
    );
  return {
    translations,
    sourceLanguage,
    targetLanguage,
    provider: settings.provider
  };
}

export async function translateText(text, settings, onProgress) {
  const result = await translateMany([text], settings, onProgress);
  return { ...result, translation: result.translations[0] };
}
