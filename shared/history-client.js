async function updateHistory(action, value) {
  const response = await chrome.runtime.sendMessage({ type: "PRISM_UPDATE_HISTORY", action, value });
  if (!response?.ok) throw new Error(response?.error || "History could not be updated.");
  return response.result;
}

export const addHistory = (entry) => updateHistory("add", entry);
export const clearHistory = () => updateHistory("clear");
export const removeHistoryItem = (id) => updateHistory("remove", id);
export const toggleFavorite = (id) => updateHistory("favorite", id);
