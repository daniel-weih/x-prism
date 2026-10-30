import {
  DEFAULT_SETTINGS,
  MAX_HISTORY_ITEMS,
  SECRET_SETTING_KEYS,
  STORAGE_KEYS,
  normalizeSettings
} from "./config.js";

function splitSettings(settings) {
  const publicSettings = { ...settings };
  const secrets = {};
  for (const key of SECRET_SETTING_KEYS) {
    secrets[key] = String(publicSettings[key] || "");
    delete publicSettings[key];
  }
  return { publicSettings, secrets };
}

export async function ensureDefaults() {
  const [synced, local] = await Promise.all([
    chrome.storage.sync.get(STORAGE_KEYS.settings),
    chrome.storage.local.get(STORAGE_KEYS.secrets)
  ]);
  const existing = synced[STORAGE_KEYS.settings];
  const merged = normalizeSettings({
    ...existing,
    ...(local[STORAGE_KEYS.secrets] || {})
  });
  const { publicSettings, secrets } = splitSettings(merged);
  await Promise.all([
    chrome.storage.sync.set({ [STORAGE_KEYS.settings]: publicSettings }),
    chrome.storage.local.set({ [STORAGE_KEYS.secrets]: secrets })
  ]);
  if (existing && SECRET_SETTING_KEYS.some((key) => key in existing)) {
    await chrome.storage.sync.set({ [STORAGE_KEYS.settings]: publicSettings });
  }
}

export async function getSettings() {
  const [synced, local] = await Promise.all([
    chrome.storage.sync.get(STORAGE_KEYS.settings),
    chrome.storage.local.get(STORAGE_KEYS.secrets)
  ]);
  return normalizeSettings({
    ...synced[STORAGE_KEYS.settings],
    ...local[STORAGE_KEYS.secrets]
  });
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = normalizeSettings({ ...current, ...patch });
  const { publicSettings, secrets } = splitSettings(next);
  await Promise.all([
    chrome.storage.sync.set({ [STORAGE_KEYS.settings]: publicSettings }),
    chrome.storage.local.set({ [STORAGE_KEYS.secrets]: secrets })
  ]);
  return next;
}

export function subscribeToSettings(listener) {
  const handler = (changes, area) => {
    const relevant = (area === "sync" && changes[STORAGE_KEYS.settings])
      || (area === "local" && changes[STORAGE_KEYS.secrets]);
    if (!relevant) return;
    getSettings().then(listener);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

export async function getHistory() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.history);
  return Array.isArray(stored[STORAGE_KEYS.history])
    ? stored[STORAGE_KEYS.history]
    : [];
}

let historyQueue = Promise.resolve();

// All UI mutations are routed through the worker so simultaneous tabs cannot
// overwrite each other's read/modify/write operations.
function mutateHistory(update) {
  const task = historyQueue.then(async () => {
    const { history, result } = update(await getHistory());
    await chrome.storage.local.set({ [STORAGE_KEYS.history]: history });
    return result;
  });
  historyQueue = task.catch(() => {});
  return task;
}

export function addHistory(entry) {
  const normalizedEntry = {
    id: entry.id || crypto.randomUUID(),
    sourceText: String(entry.sourceText || ""),
    translatedText: String(entry.translatedText || ""),
    sourceLanguage: entry.sourceLanguage || "auto",
    targetLanguage: entry.targetLanguage || "zh",
    provider: entry.provider || "chrome",
    createdAt: entry.createdAt || Date.now(),
    favorite: Boolean(entry.favorite)
  };
  return mutateHistory((history) => {
    const matches = (item) => item.sourceText === normalizedEntry.sourceText && item.translatedText === normalizedEntry.translatedText;
    const previous = history.find(matches);
    if (previous) {
      normalizedEntry.id = previous.id;
      normalizedEntry.favorite = Boolean(previous.favorite || normalizedEntry.favorite);
    }
    return { history: [normalizedEntry, ...history.filter((item) => !matches(item))].slice(0, MAX_HISTORY_ITEMS), result: normalizedEntry };
  });
}

export function toggleFavorite(id) {
  return mutateHistory((history) => {
    const next = history.map((entry) => entry.id === id ? { ...entry, favorite: !entry.favorite } : entry);
    return { history: next, result: next };
  });
}

export function removeHistoryItem(id) {
  return mutateHistory((history) => {
    const next = history.filter((entry) => entry.id !== id);
    return { history: next, result: next };
  });
}

export function clearHistory() {
  return mutateHistory(() => ({ history: [], result: [] }));
}
