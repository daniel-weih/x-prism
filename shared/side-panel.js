export const SIDE_PANEL_PATH = "sidepanel/sidepanel.html";

const validTabId = (tabId) => Number.isSafeInteger(tabId) && tabId >= 0;

export function panelTabId(url) {
  const value = new URL(url).searchParams.get("tabId");
  if (value === null || !/^\d+$/.test(value)) return null;
  const tabId = Number(value);
  return validTabId(tabId) ? tabId : null;
}

export function pendingActionKey(tabId) {
  return `prismPendingAction:${tabId}`;
}

export function configureTabPanel(api, tabId) {
  if (!validTabId(tabId)) return Promise.resolve();
  return api.sidePanel.setOptions({
    tabId, path: `${SIDE_PANEL_PATH}?tabId=${tabId}`, enabled: true
  });
}

export async function configureSidePanels(api) {
  // There must be no window-wide fallback. Prepare tab instances ahead of a
  // click so Chrome can open them directly within the user's gesture.
  await api.sidePanel.setOptions({ enabled: false });
  const tabs = await api.tabs.query({});
  await Promise.all(tabs.map((tab) => configureTabPanel(api, tab.id).catch((error) => {
    // Tabs can close while startup/install configuration is still running.
    if (!/no tab with id|invalid tab id/i.test(error.message)) throw error;
  })));
  await api.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

export function openTabPanel(api, tabId, action) {
  if (!validTabId(tabId)) return Promise.reject(new Error("No target tab for the side panel."));
  // Do not await storage or setup before open(): that can lose user activation.
  const opening = api.sidePanel.open({ tabId });
  if (!action) return opening;
  const key = pendingActionKey(tabId);
  // Existing panels receive storage changes; a newly created panel also reads
  // its key at startup. Only queue the action after opening succeeds.
  return opening.then(() => api.storage.session.set({
    [key]: { ...action, tabId, id: crypto.randomUUID(), createdAt: Date.now() }
  }));
}
