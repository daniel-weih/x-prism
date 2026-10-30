import { configureSidePanels } from "./side-panel.js";

export const CONTEXT_SELECTION = "prism-translate-selection";
export const CONTEXT_PAGE = "prism-translate-page";

const MENUS = [
  { id: CONTEXT_SELECTION, title: "Translate selection with Prism", contexts: ["selection"] },
  { id: CONTEXT_PAGE, title: "Translate this page with Prism", contexts: ["page"] }
];

function menuCall(api, method, ...args) {
  return new Promise((resolve, reject) => {
    api.contextMenus[method](...args, () => {
      // create() returns an ID, not a Promise. Its callback is the only place
      // to observe lastError without producing an unchecked runtime error.
      const error = api.runtime.lastError;
      if (error) reject(new Error(error.message)); else resolve();
    });
  });
}

async function upsertMenu(api, { id, ...properties }) {
  try {
    await menuCall(api, "update", id, properties);
    return;
  } catch (error) {
    if (!/cannot find menu item|not found|does not exist/i.test(error.message)) throw error;
  }
  try {
    await menuCall(api, "create", { id, ...properties });
  } catch (error) {
    // Another extension lifecycle instance may have created it meanwhile.
    if (!/duplicate id/i.test(error.message)) throw error;
    await menuCall(api, "update", id, properties);
  }
}

export function createExtensionConfigurator(api, ensureDefaults) {
  let pending;
  return function configureExtension() {
    if (pending) return pending;
    pending = (async () => {
      await ensureDefaults();
      await configureSidePanels(api);
      // Existing menus persist across worker restarts. Update in place instead
      // of racing removeAll/create sequences from onInstalled and onStartup.
      for (const menu of MENUS) await upsertMenu(api, menu);
    })().finally(() => { pending = undefined; });
    return pending;
  };
}
