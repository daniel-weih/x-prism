import { PROVIDERS } from "./shared/config.js";
import { addHistory, clearHistory, removeHistoryItem, toggleFavorite, ensureDefaults, getSettings } from "./shared/storage.js";
import { lookupPronunciation } from "./shared/pronunciation.js";
import { requestCodex } from "./shared/codex.js";
import { requestKimi } from "./shared/kimi.js";
import { listKimiApiModels, translateKimiApi, kimiApiBase } from "./shared/kimi-api.js";
import { listOpenAiApiModels, translateOpenAiApi, openaiApiOrigin } from "./shared/openai-api.js";
import { CONTEXT_SELECTION, createExtensionConfigurator } from "./shared/extension-setup.js";
import { configureTabPanel, openTabPanel, pendingActionKey } from "./shared/side-panel.js";
import { splitForMyMemory, myMemoryTranslation } from "./shared/mymemory.js";

const providerIds = new Set(PROVIDERS.map(({ id }) => id));

const configureExtension = createExtensionConfigurator(chrome, ensureDefaults);
const configureOnLifecycleEvent = () => {
  configureExtension().catch((error) => console.error("Prism initialization failed:", error.message));
};
chrome.runtime.onInstalled.addListener(configureOnLifecycleEvent);
chrome.runtime.onStartup.addListener(configureOnLifecycleEvent);

function prepareTabPanel(tabId) {
  configureTabPanel(chrome, tabId).catch((error) => console.error("Prism side panel setup failed:", error.message));
}
chrome.tabs.onCreated.addListener((tab) => prepareTabPanel(tab.id));
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  prepareTabPanel(addedTabId);
  chrome.storage.session.remove(pendingActionKey(removedTabId)).catch(() => {});
});
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(pendingActionKey(tabId)).catch(() => {});
});

const openPanel = (tabId, action) => openTabPanel(chrome, tabId, action);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const action = info.menuItemId === CONTEXT_SELECTION
    ? { type: "selection", text: info.selectionText || "" }
    : { type: "page" };
  openPanel(tab?.id, action).catch(() => {});
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (!tab?.id) return;
  const type = command === "translate-selection"
    ? "PRISM_TRANSLATE_SELECTION"
    : "PRISM_TOGGLE_PAGE";
  // Chrome's callback preserves the shortcut's user gesture for panel fallback.
  chrome.tabs.sendMessage(tab.id, { type }, () => {
    if (chrome.runtime.lastError) {
      openPanel(tab.id, { type: command === "translate-selection" ? "selection" : "page" })
        .catch((error) => console.error("Prism side panel open failed:", error.message));
    }
  });
});

function detectLanguage(text) {
  return new Promise((resolve) => {
    chrome.i18n.detectLanguage(text, (result) => {
      if (chrome.runtime.lastError) return resolve("en");
      resolve(result?.languages?.[0]?.language || "en");
    });
  });
}

async function fetchJson(url, init = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, credentials: "omit", redirect: "error", signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = body?.message || body?.error?.message || body?.error || response.statusText;
      throw new Error(`${response.status}: ${detail}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function mapConcurrent(items, concurrency, mapper) {
  const result = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      result[index] = await mapper(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return result;
}

async function translateMyMemory(texts, source, target) {
  const actualSource = source || await detectLanguage(texts.slice(0, 6).join(" "));
  return mapConcurrent(texts, 3, async (text) => {
    const translatedChunks = [];
    for (const chunk of splitForMyMemory(text)) {
      const params = new URLSearchParams({ q: chunk, langpair: `${actualSource}|${target}` });
      const body = await fetchJson(`https://api.mymemory.translated.net/get?${params}`);
      translatedChunks.push(myMemoryTranslation(body));
    }
    return translatedChunks.join("");
  });
}

async function translateRemote(message) {
  const settings = await getSettings();
  // Already-open tabs may still send the pre-1.4 provider ID.
  const provider = message.provider === "codex" ? "openai" : message.provider || settings.provider;
  if (!providerIds.has(provider)) throw new Error("This translation engine is no longer available. Choose an engine in Prism Settings.");
  if (provider === "chrome") throw new Error("Local translation must run in the visible extension page.");
  const texts = Array.isArray(message.texts)
    ? message.texts.map((text) => String(text || "").trim()).filter(Boolean)
    : [];
  if (!texts.length) throw new Error("No text to translate.");
  if (texts.length > 600 || texts.some((text) => text.length > 12_000) || texts.join("").length > 240_000) {
    throw new Error("Too much text. Translate a smaller selection or reduce the page segment limit.");
  }
  const source = message.sourceLanguage === "auto" ? "" : message.sourceLanguage;
  const target = message.targetLanguage || settings.targetLanguage;
  let translations;
  if (provider === "mymemory") translations = await translateMyMemory(texts, source, target);
  if (provider === "kimi") {
    if (settings.kimiConnection === "api") {
      await assertKimiApiPermission(settings.kimiApiRegion);
      translations = await translateKimiApi(texts, source, target, settings);
    } else {
      const result = await requestKimi({ action: "translate", texts, sourceLanguage: source || "auto", targetLanguage: target, model: settings.kimiCliModel });
      translations = result.translations;
    }
  }
  if (provider === "openai") {
    if (settings.openaiConnection === "api") {
      await assertOpenAiApiPermission(settings.openaiEndpoint);
      translations = await translateOpenAiApi(texts, source, target, settings);
    } else {
      const result = await requestCodex({
        action: "translate", texts, sourceLanguage: source || "auto", targetLanguage: target,
        model: settings.codexModel, effort: settings.codexReasoningEffort
      });
      translations = result.translations;
    }
  }
  if (!translations || translations.length !== texts.length) {
    throw new Error(`The provider returned ${translations?.length || 0} of ${texts.length} translations.`);
  }
  return translations;
}

async function assertKimiApiPermission(region) {
  const origin = `${new URL(kimiApiBase(region)).origin}/*`;
  if (!await chrome.permissions.contains({ origins: [origin] })) throw new Error("请在 Kimi API 设置中保存设置并允许访问所选服务区域。");
}

async function assertOpenAiApiPermission(endpoint) {
  if (!await chrome.permissions.contains({ origins: [openaiApiOrigin(endpoint)] })) {
    throw new Error("请在 OpenAI API 设置中保存设置并允许访问所选接口地址。");
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message?.type === "PRISM_OPENAI_MODELS" && sender.url?.startsWith(chrome.runtime.getURL(""))) {
    assertOpenAiApiPermission(message.endpoint)
      .then(() => listOpenAiApiModels({ openaiEndpoint: message.endpoint, openaiApiKey: message.apiKey }))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "PRISM_KIMI_MODELS" && sender.url?.startsWith(chrome.runtime.getURL(""))) {
    const result = message.connection === "api"
      ? assertKimiApiPermission(message.region).then(() => listKimiApiModels({ kimiApiRegion: message.region, kimiApiKey: message.apiKey }))
      : requestKimi({ action: "models" }, chrome.runtime, 45_000);
    result.then((data) => sendResponse({ ok: true, ...data }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "PRISM_CODEX_MODELS" && sender.url?.startsWith(chrome.runtime.getURL(""))) {
    requestCodex({ action: "models" }, chrome.runtime, 30_000)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "PRISM_PRONUNCIATION") {
    lookupPronunciation(message.text)
      .then((pronunciation) => sendResponse({ ok: true, pronunciation }))
      .catch(() => sendResponse({ ok: false, pronunciation: null }));
    return true;
  }
  if (message?.type === "PRISM_OPEN_PANEL") {
    openPanel(sender.tab?.id, message.action || { type: "selection", text: message.text || "" })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "PRISM_ADD_HISTORY") {
    addHistory(message.entry)
      .then((entry) => sendResponse({ ok: true, entry }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "PRISM_UPDATE_HISTORY" && sender.url?.startsWith(chrome.runtime.getURL(""))) {
    const actions = { add: addHistory, clear: clearHistory, remove: removeHistoryItem, favorite: toggleFavorite };
    const action = Object.hasOwn(actions, message.action) && actions[message.action];
    if (!action) return false;
    action(message.value).then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "PRISM_REMOTE_TRANSLATE") {
    translateRemote(message)
      .then((translations) => sendResponse({ ok: true, translations }))
      .catch((error) => sendResponse({
        ok: false,
        error: error.name === "AbortError" ? "The translation request timed out." : error.message,
        code: error.name === "AbortError" ? "TIMEOUT" : "PROVIDER_ERROR"
      }));
    return true;
  }
  return false;
});
