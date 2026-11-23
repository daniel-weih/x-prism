import {
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
  await chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
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
    chrome.storage.local.set({ [STORAGE_KEYS.secrets]: secrets }),
    chrome.storage.local.remove?.("prismHistory")
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
    chrome.storage.local.set({ [STORAGE_KEYS.secrets]: secrets }),
    chrome.storage.local.remove?.("prismHistory")
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
