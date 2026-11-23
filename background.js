import { runPageAction, relayReaderMessage, relayReaderControl, verifyReaderSender } from "./shared/page-actions.js";
import { PROVIDERS } from "./shared/config.js";
import { ensureDefaults, getSettings } from "./shared/storage.js";
import { lookupPronunciation } from "./shared/pronunciation.js";
import { kimiApiSettings, listKimiApiModels, translateKimiApi, kimiApiBase } from "./shared/kimi-api.js";
import { listOpenAiApiModels, translateOpenAiApi, openaiApiOrigin } from "./shared/openai-api.js";
import { speechOrigin, validateSpeech } from "./shared/speech.js";
import { CONTEXT_READ_SELECTION, CONTEXT_READ_PAGE, CONTEXT_SELECTION, createExtensionConfigurator } from "./shared/extension-setup.js";
import { configureTabPanel, openTabPanel, pendingActionKey } from "./shared/side-panel.js";

const providerIds = new Set(PROVIDERS.map(({ id }) => id));
const OFFSCREEN_PATH = "reader/offscreen.html";
let creatingOffscreen = null;

async function hasOffscreenDocument() {
  if (!chrome.runtime.getContexts) return false;
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)]
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Play synthesized speech audio without webpage autoplay restrictions."
    }).catch((error) => {
      if (!/Only a single offscreen document/i.test(error?.message || "")) throw error;
    }).finally(() => { creatingOffscreen = null; });
  }
  await creatingOffscreen;
}

async function stopOffscreen(filter) {
  if (!await hasOffscreenDocument()) return;
  await chrome.runtime.sendMessage({ target: "offscreen", type: "PRISM_OFFSCREEN_STOP", ...filter }).catch(() => {});
}

async function handleReaderAudio(sender, message) {
  if (!verifyReaderSender(chrome, sender, message?.session)) throw new Error("Invalid reader.");
  const { session, action } = message;
  if (action === "stop") {
    await stopOffscreen({ session });
    return { ok: true };
  }
  if (action === "start") {
    const settings = await getSettings();
    validateSpeech(settings);
    if (!await chrome.permissions.contains({ origins: [speechOrigin(settings)] })) {
      throw new Error("请打开设置，保存 OpenAI API 配置并允许访问服务。");
    }
    await ensureOffscreenDocument();
    return chrome.runtime.sendMessage({
      target: "offscreen",
      type: "PRISM_OFFSCREEN_START",
      session,
      tabId: sender.tab.id,
      paragraphs: message.paragraphs,
      settings
    });
  }
  if (!await hasOffscreenDocument()) return { ok: false, error: "Reading session ended." };
  if (action === "toggle") {
    return chrome.runtime.sendMessage({ target: "offscreen", type: "PRISM_OFFSCREEN_TOGGLE", session });
  }
  if (action === "move") {
    return chrome.runtime.sendMessage({ target: "offscreen", type: "PRISM_OFFSCREEN_MOVE", session, delta: message.delta });
  }
  if (action === "rate") {
    return chrome.runtime.sendMessage({ target: "offscreen", type: "PRISM_OFFSCREEN_RATE", session, rate: message.rate });
  }
  throw new Error("Unsupported reader audio action.");
}

const configureExtension = createExtensionConfigurator(chrome, ensureDefaults, getSettings);
const configureOnLifecycleEvent = () => {
  configureExtension().catch((error) => console.error("Prism initialization failed:", error.message));
};
chrome.runtime.onInstalled.addListener(configureOnLifecycleEvent);
chrome.runtime.onStartup.addListener(configureOnLifecycleEvent);
chrome.storage.onChanged?.addListener((changes, area) => {
  const settings = changes.prismSettings;
  if (area !== "sync" || !settings || settings.oldValue?.uiLanguage === settings.newValue?.uiLanguage) return;
  configureExtension.refreshMenus().catch((error) => console.error("Prism menu update failed:", error.message));
});

function prepareTabPanel(tabId) {
  configureTabPanel(chrome, tabId).catch((error) => console.error("Prism side panel setup failed:", error.message));
}
chrome.tabs.onCreated.addListener((tab) => prepareTabPanel(tab.id));
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  prepareTabPanel(addedTabId);
  chrome.storage.session.remove(pendingActionKey(removedTabId)).catch(() => {});
  void stopOffscreen({ tabId: removedTabId });
});
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(pendingActionKey(tabId)).catch(() => {});
  void stopOffscreen({ tabId });
});

const openPanel = (tabId, action) => openTabPanel(chrome, tabId, action);

async function pageActionStatus(tabId, failed) {
  if (!Number.isSafeInteger(tabId) || !chrome.action) return;
  await Promise.allSettled([
    chrome.action.setBadgeText({ tabId, text: failed ? "!" : "" }),
    chrome.action.setTitle({ tabId, title: failed ? "Prism: 请在普通网页中重试 / Try again on a regular web page." : "Open Prism" })
  ]);
}
function dispatchPageAction(tabId, action) {
  return runPageAction(chrome, tabId, action).then(() => pageActionStatus(tabId, false), () => pageActionStatus(tabId, true));
}
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const action = info.menuItemId === CONTEXT_READ_SELECTION ? { type: "read-selection", text: info.selectionText || "" }
    : info.menuItemId === CONTEXT_READ_PAGE ? { type: "read-page" }
    : info.menuItemId === CONTEXT_SELECTION ? { type: "selection", text: info.selectionText || "" } : { type: "page" };
  return dispatchPageAction(tab?.id, action);
});
chrome.commands.onCommand.addListener((command, tab) => {
  const type = { "translate-selection": "translate", "read-selection-or-page": "read", "toggle-page-translation": "page" }[command];
  if (!type || !Number.isSafeInteger(tab?.id) || tab.id < 0) return;
  return dispatchPageAction(tab.id, { type });
});

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
  const source = message.sourceLanguage === "auto" ? "" : String(message.sourceLanguage || "").trim();
  const target = String(message.targetLanguage || settings.targetLanguage || "").trim();
  if (source && !/^[a-zA-Z-]{2,20}$/.test(source)) throw new Error("Invalid source language.");
  if (!/^[a-zA-Z-]{2,20}$/.test(target)) throw new Error("Invalid target language.");
  let translations;
  if (provider === "kimi") {
    await assertKimiApiPermission(kimiApiSettings(settings).kimiApiRegion, settings.kimiConnection);
    translations = await translateKimiApi(texts, source, target, settings);
  }
  if (provider === "openai") {
    await assertOpenAiApiPermission(settings.openaiEndpoint);
    translations = await translateOpenAiApi(texts, source, target, settings);
  }
  if (!translations || translations.length !== texts.length) {
    throw new Error(`The provider returned ${translations?.length || 0} of ${texts.length} translations.`);
  }
  return translations;
}

async function assertKimiApiPermission(region, connection = "api") {
  const origin = `${new URL(kimiApiBase(region, connection)).origin}/*`;
  if (!await chrome.permissions.contains({ origins: [origin] })) throw new Error("请在 Kimi API 设置中保存设置并允许访问所选服务区域。");
}

async function assertOpenAiApiPermission(endpoint) {
  if (!await chrome.permissions.contains({ origins: [openaiApiOrigin(endpoint)] })) {
    throw new Error("请在 OpenAI API 设置中保存设置并允许访问所选接口地址。");
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message?.type === "PRISM_READER_CONTROL") {
    relayReaderControl(chrome, sender, message).then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: "Reading controls unavailable." }));
    return true;
  }
  if (message?.type === "PRISM_READER_PAGE") {
    relayReaderMessage(chrome, sender, message).then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: "Reading page is no longer available." }));
    return true;
  }
  if (message?.type === "PRISM_READER_AUDIO") {
    handleReaderAudio(sender, message)
      .then((result) => sendResponse(result || { ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "PRISM_OFFSCREEN_STATE" && sender.url === chrome.runtime.getURL(OFFSCREEN_PATH)) {
    if (Number.isSafeInteger(message.tabId) && /^[a-f0-9-]{36}$/.test(message.session || "")) {
      chrome.tabs.sendMessage(message.tabId, {
        type: "PRISM_READER_AUDIO_STATE",
        session: message.session,
        state: message.state,
        index: message.index,
        total: message.total,
        chunk: message.chunk,
        error: message.error
      }).catch(() => { void stopOffscreen({ session: message.session }); });
    }
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "PRISM_OPENAI_MODELS" && sender.url?.startsWith(chrome.runtime.getURL(""))) {
    assertOpenAiApiPermission()
      .then(() => listOpenAiApiModels({ openaiApiKey: message.apiKey }))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "PRISM_KIMI_MODELS" && sender.url?.startsWith(chrome.runtime.getURL(""))) {
    if (!["api", "code"].includes(message.connection)) {
      sendResponse({ ok: false, error: "Unsupported Kimi connection." });
      return false;
    }
    assertKimiApiPermission(message.region, message.connection)
      .then(() => listKimiApiModels({ kimiConnection: message.connection, kimiApiRegion: message.region, kimiApiKey: message.apiKey, kimiCodeRegion: message.region, kimiCodeKey: message.apiKey }))
      .then((data) => sendResponse({ ok: true, ...data }))
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
