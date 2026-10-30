export const TAB_ACCESS_ERROR = Object.freeze({
  noActiveTab: "NO_ACTIVE_TAB",
  restrictedPage: "RESTRICTED_PAGE",
  pageNotConnected: "PAGE_NOT_CONNECTED"
});

export class TabAccessError extends Error {
  constructor(code, cause) {
    super(code, cause ? { cause } : undefined);
    this.name = "TabAccessError";
    this.code = code;
  }
}

export function isRestrictedPageUrl(value) {
  if (!value) return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol !== "http:" && protocol !== "https:";
  } catch {
    return true;
  }
}

export async function queryActiveTab(tabsApi) {
  const [tab] = await tabsApi.query({ active: true, currentWindow: true });
  return tab;
}

export async function resolveTab(tabsApi, tabId) {
  if (tabId == null) return queryActiveTab(tabsApi);
  try {
    return await tabsApi.get(tabId);
  } catch (cause) {
    // A closed owning tab must never fall back to whichever tab is now active.
    throw new TabAccessError(TAB_ACCESS_ERROR.noActiveTab, cause);
  }
}

function looksLikeProtectedPageError(error) {
  const message = String(error?.message || error || "");
  return /cannot access (?:a )?(?:chrome|edge|about):\/\//i.test(message)
    || /extensions gallery cannot be scripted/i.test(message)
    || /cannot access contents of (?:the )?url/i.test(message)
    || /the page cannot be scripted/i.test(message);
}

export function messageActiveTab(tabsApi, message, inject) {
  return messageTab(tabsApi, message, inject);
}

export async function messageTab(tabsApi, message, inject, tabId) {
  const tab = await resolveTab(tabsApi, tabId);
  if (!Number.isInteger(tab?.id) || tab.id < 0) throw new TabAccessError(TAB_ACCESS_ERROR.noActiveTab);

  // Chrome hides tab.url and tab.title when the extension deliberately avoids
  // the broad "tabs" permission. A missing URL therefore does not mean that
  // this is a protected page: let the installed content script answer instead.
  if (isRestrictedPageUrl(tab.url)) {
    throw new TabAccessError(TAB_ACCESS_ERROR.restrictedPage);
  }

  try {
    const response = await tabsApi.sendMessage(tab.id, message);
    return { tab, response };
  } catch (firstCause) {
    if (!inject) {
      throw new TabAccessError(TAB_ACCESS_ERROR.pageNotConnected, firstCause);
    }

    try {
      await inject(tab.id);
      const response = await tabsApi.sendMessage(tab.id, message);
      return { tab, response, injected: true };
    } catch (cause) {
      const code = looksLikeProtectedPageError(cause)
        ? TAB_ACCESS_ERROR.restrictedPage
        : TAB_ACCESS_ERROR.pageNotConnected;
      throw new TabAccessError(code, cause);
    }
  }
}

export function visiblePageDetails(tab, response) {
  return {
    title: response?.title || tab?.title || "",
    url: response?.url || tab?.url || ""
  };
}
