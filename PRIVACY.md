# Prism privacy notes

Prism provides web translation and AI read aloud. Translation can run locally with Chrome Local AI; read aloud uses the configured OpenAI API service. Prism does not include analytics, advertising, telemetry, or bundled credentials.

## What stays on the device

- With **Chrome Local AI**, source text and translations are processed by Chrome's on-device Translator API.
- Chrome may download the required local translation language packs on first use. This download does not send the page text to a translation service. Automatic language detection uses an already-installed detector or Chrome's lightweight detection API; Prism does not download an additional detector for cloud translation.
- Translation history is stored in `chrome.storage.local` in the current Chrome profile.
- Provider API keys are stored separately in `chrome.storage.local`; Prism deliberately excludes them from Chrome Sync.
- Non-sensitive preferences may use `chrome.storage.sync` so the interface behaves consistently across the user's Chrome profiles.
- English pronunciation lookup reads the bundled US English IPA dictionary. It never sends a lookup to a dictionary service. This applies to the displayed phonetic notation only; word audio uses the OpenAI read-aloud service described below.

## When text leaves the device

For translation, text is sent over the network after the user selects a network-backed provider and starts a translation. The destination is the selected provider: MyMemory, an OpenAI-compatible endpoint, Kimi's selected API region, or the service configured in the user's local Codex / Kimi CLI. Prism sends the text needed for that translation; it does not send browsing history or page cookies. Detecting Kimi API models sends the API key to the selected API region without any page text. Starting read aloud, word pronunciation, or a voice preview also makes a network request, independently of the translation provider; see OpenAI read aloud below.

## OpenAI connections

OpenAI has two independent modes: **Local Codex CLI** and **API**. Switching modes retains their separate model settings. API mode uses the key entered by the user, independently of the Codex CLI login. Existing Codex selections migrate to CLI mode; existing OpenAI-compatible selections migrate to API mode without clearing settings or history.

### Local Codex connector

The optional connector requires the `nativeMessaging` permission and a one-time local host registration. The installer allowlists the explicit Prism extension ID. Chrome launches the connector on demand over standard input/output; no TCP listener, web endpoint, or additional API key is created. The connector uses the existing Codex login without reading or copying credential files, requests the available model catalog, and starts temporary translation threads with file changes, shell tools, MCP servers, plugins, and memory disabled. It honors the system proxy. Model and reasoning choices are stored as preferences; generated translations can enter Prism history if enabled. The connector doesn't log translation text. Codex and its configured service retain their own normal operational and billing policies.

### API

API mode sends translation text to the configured OpenAI or compatible Chat Completions endpoint, using the locally stored API key. Detecting models sends the key to the same origin’s models endpoint without any page text. Requests reject redirects and omit browser cookies. Endpoints must use HTTPS, except for local services on localhost or 127.0.0.1.

Custom endpoints require a separate Chrome host-access confirmation for the exact origin. Required host access is limited to the documented MyMemory API origin.

## Kimi connectors

**Kimi Code Subscription API** sends model detection credentials and translation requests only to the selected `https://api.kimi.com/coding/v1` or `https://api.kimi.ai/coding/v1` service. Its key, model, region and thinking settings are separate from Open Platform settings. The key stays in local extension storage, excluded from sync. Exact-origin permission and redirect rejection apply to this mode as well.

Kimi offers three independent modes. **Local CLI** uses the installed Kimi Code login via a separately registered Native Messaging host restricted to the specified extension ID. The connector does not read or copy credential files, open a TCP port, or restart existing CLI sessions. It uses ACP only for model discovery and cleanup. Translation uses print mode with a dedicated agent profile whose tools and subagents lists are empty, in a temporary directory, with an empty skills directory and telemetry disabled for the launched process. It shuts down its own child processes and attempts to delete only CLI sessions associated with that temporary directory. If interrupted, CLI recovery records may remain. Prism does not log translation text; Kimi's own operational logs, configured hooks and provider retention policies still apply. This is a cloud-backed service, not offline inference.

**Open Platform API** sends translation text and the user's API key only to `https://api.moonshot.cn/v1` or `https://api.moonshot.ai/v1`, selected in Settings. Prism requests host access for that exact origin and rejects redirects. The key is kept in local extension storage and excluded from sync. CLI and API model settings are separate; neither mode reuses the other's credentials. No Kimi service is used unless the user chooses that mode and detects models or translates.

## OpenAI read aloud

Page-initiated reading uses an extension-owned iframe in the bottom-right corner. API keys stay inside the extension context; page scripts receive neither keys nor audio. The iframe relays only its own tab’s reading state and highlight controls. Closing it or leaving the page stops playback. Page translation and selection translation do not automatically open the side panel.

Read aloud shares the endpoint and API key configured for OpenAI translation. Starting reading sends the requested word, selected passage, input text, translation, or extracted article body to that service; preview sends a fixed sample sentence. This also applies when the translation engine is Chrome Local AI. Speech is AI-generated and API usage is billed by the configured service.

The shared OpenAI API key stays in `chrome.storage.local`, excluded from sync. There is no separate reading credential. Chat audio uses the exact configured translation endpoint. Realtime is currently supported only with the official OpenAI endpoint; custom-service credentials are never forwarded to OpenAI. No key is passed to page scripts, included in a URL, or stored with audio. Chat audio requests use `store: false`, omit cookies and reject redirects. Realtime uses a short-lived client secret for WebSocket authentication. OpenAI's retention policies still apply.

For every speech chunk, Prism checks the model-reported audio transcript against the source before playback and rejects missing or mismatched transcripts. Paragraph checks ignore differences in casing, whitespace and punctuation; spoken rewrites of numbers or symbols can still be rejected. This is not independent audio recognition; no additional transcription service is called. Realtime requests carry explicit reading instructions and only the current script, without conversation history.

Each synthesis request contains text from one source paragraph. Long paragraphs can be split into multiple clips; adjacent paragraphs are not combined. Audio is held only in player memory, targeting an estimated 25-second playback window with at most two synthesis requests in flight and at most four future chunks plus the current chunk retained. Pausing prevents new prefetch requests while allowing already-started requests to complete. Reading text and audio are not added to translation history or persistent caches. Stop, page navigation and closing the panel release playback resources and cancel pending work; requests already processed by OpenAI may still incur usage.

## Page access

The content script runs on ordinary HTTP(S) pages to provide the selection menu, translation, and text extraction for read aloud. It skips passwords and other form controls, editable content, scripts, styles, code blocks, canvases, SVG, and hidden text. Chrome internal pages and the Chrome Web Store remain inaccessible to extensions.

If an ordinary page was already open when Prism was installed or reloaded, Chrome may not yet have attached the content script. After the user opens Prism for that tab, Prism uses the temporary `activeTab` grant and the `scripting` API to attach only its bundled content script to that tab and retries once. Prism does not request the broad `tabs` permission or use this recovery path to read browsing history.

## Removal

Removing the extension removes its local settings and history from the Chrome profile. Cloud providers may have their own retention policies; consult the provider selected in Settings.

The separately installed Codex host registration is not removed automatically. On macOS its default files are `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.prism_translate.codex.json` and `~/Library/Application Support/Prism Translate/codex-host`; deleting these disables the connector without removing Codex itself. Linux uses `~/.config/google-chrome/NativeMessagingHosts/` and `~/.local/share/prism-translate/` respectively.

The Kimi registration is also separate: in the same directories, remove `com.prism_translate.kimi.json` and the `kimi-host` launcher to disable it. This does not uninstall Kimi Code or remove its own sessions and logs.

Version 1.3.0 removes DeepL and LibreTranslate. On initialization, their obsolete preferences and API keys are removed from Prism storage. Existing translation history is retained. If either removed engine was selected, the preference returns to Chrome Local AI.
