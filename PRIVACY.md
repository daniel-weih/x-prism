# Prism privacy notes

Prism provides web translation and AI read aloud. Translation can run locally with Chrome Local AI; read aloud uses the configured OpenAI API service. Prism does not include analytics, advertising, telemetry, or bundled credentials.

## What stays on the device

- With **Chrome Local AI**, source text and translations are processed by Chrome's on-device Translator API.
- Chrome may download the required local translation language packs on first use. This download does not send the page text to a translation service. Automatic language detection uses an already-installed detector or Chrome's lightweight detection API; Prism does not download an additional detector for cloud translation.
- Translation text and translations are not saved to local history or persistent caches.
- Provider API keys are stored separately in `chrome.storage.local`; Prism deliberately excludes them from Chrome Sync.
- Non-sensitive preferences may use `chrome.storage.sync` so the interface behaves consistently across the user's Chrome profiles.
- English pronunciation lookup reads the bundled US English IPA dictionary. It never sends a lookup to a dictionary service. This applies to the displayed phonetic notation only; word audio uses the OpenAI read-aloud service described below.

## When text leaves the device

For translation, text is sent over the network after the user selects a network-backed provider and starts a translation. The destination is the selected official provider: OpenAI (`https://api.openai.com`) or Kimi's selected API region (`moonshot.cn/ai` or `kimi.com/ai`). Prism sends the text needed for that translation; it does not send browsing history or page cookies. Detecting models sends the API key to the selected official API origin without any page text. Starting read aloud, word pronunciation, or a voice preview also makes a network request to OpenAI, independently of the translation provider; see OpenAI read aloud below.

## OpenAI connection

OpenAI uses only the official OpenAI API (`https://api.openai.com/v1/responses`) with the API key entered by the user. All translation tiers use `/v1/responses` with `store: false`. Detecting models sends the key to `https://api.openai.com/v1/models` without any page text. Requests reject redirects and omit browser cookies. Custom endpoints and local CLI connectors are not supported.

Prism requests no permanent host permissions. Optional host permissions are restricted to the explicit official provider origins (`api.openai.com`, `api.moonshot.cn`, `api.moonshot.ai`, `api.kimi.com`, `api.kimi.ai`).

## Kimi connections

**Kimi Code Subscription API** sends model detection credentials and translation requests only to the selected `https://api.kimi.com/coding/v1` or `https://api.kimi.ai/coding/v1` service. Its key, model, region and thinking settings are separate from Open Platform settings. The key stays in local extension storage, excluded from sync. Exact-origin permission and redirect rejection apply to this mode as well.

**Open Platform API** sends translation text and the user's API key only to `https://api.moonshot.cn/v1` or `https://api.moonshot.ai/v1`, selected in Settings. Prism requests host access for that exact origin and rejects redirects. The key is kept in local extension storage and excluded from sync. No Kimi service is used unless the user chooses that mode and detects models or translates.

## OpenAI read aloud

Page-initiated reading uses an extension-owned iframe inside a closed Shadow DOM in the bottom-right corner. API keys stay inside the extension context; page scripts receive neither keys nor audio. The iframe relays only its own tab’s reading state and highlight controls, and its session attach handshake is one-time only. Closing it or leaving the page stops playback. Page translation and selection translation do not automatically open the side panel.

Read aloud shares the official OpenAI API key configured for OpenAI translation. Starting reading sends the requested word, selected passage, input text, translation, or extracted article body to OpenAI; preview sends a fixed sample sentence. This also applies when the translation engine is Chrome Local AI. Speech is AI-generated and API usage is billed by OpenAI.

The shared OpenAI API key stays in `chrome.storage.local`, excluded from sync. There is no separate reading credential. Read aloud uses OpenAI's official Realtime API (`gpt-realtime-2.1` / `gpt-realtime-2.1-mini`) with a short-lived client secret for WebSocket authentication. No key is passed to page scripts, included in a URL, or stored with audio. Client-secret requests omit cookies and reject redirects. OpenAI's retention policies still apply.

For every speech chunk, Prism checks the model-reported audio transcript against the source before playback and rejects missing or mismatched transcripts. Paragraph checks ignore differences in casing, whitespace and punctuation; spoken rewrites of numbers or symbols can still be rejected. This is not independent audio recognition; no additional transcription service is called. Realtime requests carry explicit reading instructions and only the current script, without conversation history.

Each synthesis request contains text from one source paragraph. Long paragraphs can be split into multiple clips; adjacent paragraphs are not combined. Audio is held only in player memory, targeting an estimated 25-second playback window with at most two synthesis requests in flight and at most four future chunks plus the current chunk retained. Pausing prevents new prefetch requests while allowing already-started requests to complete. Reading text and audio are not added to translation history or persistent caches. Stop, page navigation and closing the panel release playback resources and cancel pending work; requests already processed by OpenAI may still incur usage.

## Page access

The content script runs on ordinary HTTP(S) pages to provide the selection menu, translation, and text extraction for read aloud. It skips passwords and other form controls, editable content, scripts, styles, code blocks, canvases, SVG, and hidden text. Chrome internal pages and the Chrome Web Store remain inaccessible to extensions.

If an ordinary page was already open when Prism was installed or reloaded, Chrome may not yet have attached the content script. After the user opens Prism for that tab, Prism uses the temporary `activeTab` grant and the `scripting` API to attach only its bundled content script to that tab and retries once. Prism does not request the broad `tabs` permission or use this recovery path to read browsing history.

## Removal

Removing the extension removes its local settings and history from the Chrome profile. Cloud providers may have their own retention policies; consult the provider selected in Settings.

Version 1.10.0 removes translation history/favorites and MyMemory (eliminating all permanent `host_permissions`).

Version 1.9.0 removes local Codex/Kimi CLI connectors (`nativeMessaging`), custom OpenAI endpoints, and Chat Completions (`gpt-audio-1.5`). On initialization, obsolete CLI preferences are removed and custom OpenAI endpoints reset to `https://api.openai.com/v1/responses`. If you previously registered a local Native Messaging host in an earlier version, you can delete `com.prism_translate.{codex,kimi}.json` under Chrome's `NativeMessagingHosts` directory and the `Prism Translate` / `prism-translate` launcher directory.

Version 1.3.0 removes DeepL and LibreTranslate. On initialization, their obsolete preferences and API keys are removed from Prism storage. Existing translation history is retained. If either removed engine was selected, the preference returns to Chrome Local AI.
