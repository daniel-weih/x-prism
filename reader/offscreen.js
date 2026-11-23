import { SpeechPlayer } from "../shared/speech.js";

let activeSession = null;
let ownerTabId = null;

function notifyState(session, tabId, payload) {
  if (!session || !Number.isSafeInteger(tabId)) return;
  chrome.runtime.sendMessage({
    type: "PRISM_OFFSCREEN_STATE",
    session,
    tabId,
    ...payload
  }).catch(() => {});
}

const player = new SpeechPlayer({
  onChange(payload) {
    notifyState(activeSession, ownerTabId, payload);
  }
});

function stopCurrent() {
  if (!activeSession) return;
  player.stop();
  activeSession = null;
  ownerTabId = null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.target !== "offscreen") return false;
  const session = message.session;
  if (message.type === "PRISM_OFFSCREEN_START") {
    stopCurrent();
    activeSession = session;
    ownerTabId = message.tabId;
    void player.start(message.paragraphs, message.settings);
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === "PRISM_OFFSCREEN_STOP") {
    const matchesSession = session && session === activeSession;
    const matchesTab = Number.isSafeInteger(message.tabId) && message.tabId === ownerTabId;
    if (matchesSession || matchesTab) stopCurrent();
    sendResponse({ ok: true });
    return false;
  }
  if (!session || session !== activeSession) {
    sendResponse({ ok: false, error: "Inactive reading session." });
    return false;
  }
  if (message.type === "PRISM_OFFSCREEN_TOGGLE") {
    void player.toggle();
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === "PRISM_OFFSCREEN_MOVE") {
    const delta = Number(message.delta);
    if (delta === -1 || delta === 1) void player.move(delta);
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === "PRISM_OFFSCREEN_RATE") {
    const rate = Number(message.rate);
    if (player.settings && Number.isFinite(rate)) {
      player.settings.speechRate = rate;
      player.rate(rate);
    }
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
