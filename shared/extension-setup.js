import { configureSidePanels } from "./side-panel.js";

export const CONTEXT_SELECTION = "prism-translate-selection";
export const CONTEXT_READ_SELECTION = "prism-read-selection";
export const CONTEXT_READ_PAGE = "prism-read-page";
export const CONTEXT_PAGE = "prism-translate-page";

function menusForLanguage(language) {
  const zh = language.toLowerCase().startsWith("zh");
  return [
    { id: CONTEXT_READ_SELECTION, title: zh ? "朗读选中段落" : "Read selection", contexts: ["selection"] },
    { id: CONTEXT_READ_PAGE, title: zh ? "朗读整篇文章" : "Read article", contexts: ["page"] },
    { id: CONTEXT_SELECTION, title: zh ? "翻译选中文本" : "Translate selection", contexts: ["selection"] },
    { id: CONTEXT_PAGE, title: zh ? "翻译当前网页" : "Translate page", contexts: ["page"] }
  ];
}

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

export function createExtensionConfigurator(api, ensureDefaults, readSettings = async () => ({})) {
  let pending;
  let menuQueue = Promise.resolve();
  function refreshMenus() {
    const update = menuQueue.then(async () => {
      const settings = await readSettings();
      const language = ["zh", "en"].includes(settings.uiLanguage)
        ? settings.uiLanguage : api.i18n?.getUILanguage() || "en";
      // Update persistent IDs so changing the UI language also changes menus.
      for (const menu of menusForLanguage(language)) await upsertMenu(api, menu);
    });
    menuQueue = update.catch(() => {});
    return update;
  }
  function configureExtension() {
    if (pending) return pending;
    pending = (async () => {
      await ensureDefaults();
      await configureSidePanels(api);
      // Existing menus persist across worker restarts. Update in place instead
      // of racing removeAll/create sequences from onInstalled and onStartup.
      await refreshMenus();
    })().finally(() => { pending = undefined; });
    return pending;
  }
  configureExtension.refreshMenus = refreshMenus;
  return configureExtension;
}
