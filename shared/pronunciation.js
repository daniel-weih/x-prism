// Lookup only: no network dictionary or model-generated pronunciation.
let dictionaryPromise;

export function normalizeEnglishWord(value) {
  const word = String(value || "").trim().replace(/[’‘]/g, "'").toLowerCase();
  return /^[a-z]+(?:['-][a-z]+)*$/.test(word) && word.length <= 64 ? word : null;
}

export async function lookupPronunciation(text) {
  const word = normalizeEnglishWord(text);
  if (!word) return null;
  dictionaryPromise ||= fetch(chrome.runtime.getURL("assets/dictionaries/en-US.json"))
    .then((response) => {
      if (!response.ok) throw new Error("Pronunciation dictionary unavailable.");
      return response.json();
    }).catch((error) => { dictionaryPromise = null; throw error; });
  const dictionary = await dictionaryPromise;
  const ipa = Object.hasOwn(dictionary, word) ? dictionary[word] : null;
  return ipa ? { word, ipa, locale: "en-US", label: "US", source: "CMU / ipa-dict" } : null;
}
