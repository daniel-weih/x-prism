import { messageTab } from "./tab-access.js";

export const READER_PATH = "reader/reader.html";

export function runPageAction(api, tabId, action) {
  if (!Number.isSafeInteger(tabId) || tabId < 0) return Promise.reject(new Error("No target page."));
  const type = action.type === "selection" ? "PRISM_TRANSLATE_SELECTION"
    : action.type === "translate" ? "PRISM_TRANSLATE"
    : action.type === "read" ? "PRISM_READ"
    : action.type === "page" ? "PRISM_TOGGLE_PAGE" : "PRISM_START_READING";
  return messageTab(api.tabs, { type, action, text: action.text }, async id => {
    await api.scripting.insertCSS({ target: { tabId: id }, files: ["content/content.css"] });
    await api.scripting.executeScript({ target: { tabId: id }, files: ["content/content.js"] });
  }, tabId);
}

export function relayReaderControl(api, sender, request) {
  if (sender.id !== api.runtime.id || sender.frameId !== 0 || !Number.isSafeInteger(sender.tab?.id) || sender.tab.id < 0
      || !/^[a-f0-9-]{36}$/.test(request.session || "") || !Number.isSafeInteger(request.revision) || request.revision < 1) {
    return Promise.reject(new Error("Invalid reading control."));
  }
  // Only the matching extension iframe answers. The sender's tab is authoritative.
  return api.tabs.sendMessage(sender.tab.id, { type: "PRISM_READER_TOGGLE", session: request.session, revision: request.revision });
}

const readerMessages = new Set([
  "PRISM_READER_ATTACH", "PRISM_READER_LAYOUT", "PRISM_READER_CLOSE",
  "PRISM_READER_ALIVE", "PRISM_READING_HIGHLIGHT", "PRISM_READER_STATE", "PRISM_READER_COLLAPSE"
]);

// Only our extension iframe can relay to its owning top-level document. Neither
// page scripts nor a caller-supplied tab ID can control another tab's reader.
export function relayReaderMessage(api, sender, request) {
  let url;
  try { url = new URL(sender.url); } catch { return Promise.reject(new Error("Invalid reader.")); }
  const expected = new URL(api.runtime.getURL(READER_PATH));
  if (sender.id !== api.runtime.id || url.protocol !== expected.protocol || url.host !== expected.host || url.pathname !== expected.pathname
      || !Number.isSafeInteger(sender.tab?.id) || (!Number.isInteger(sender.frameId) || sender.frameId <= 0)
      || !/^[a-f0-9-]{36}$/.test(request.session || "") || url.searchParams.get("session") !== request.session
      || !readerMessages.has(request.message?.type)) {
    return Promise.reject(new Error("Invalid reader."));
  }
  return api.tabs.sendMessage(sender.tab.id, { ...request.message, readerSession: request.session }, { frameId: 0 });
}
