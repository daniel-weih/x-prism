# Prism Translate privacy notes

Prism is local-first and does not include analytics, advertising, telemetry, or bundled credentials.

## What stays on the device

- With **Chrome Local AI**, source text and translations are processed by Chrome's on-device Translator API.
- Chrome may download the required local translation language packs on first use. This download does not send the page text to a translation service. Automatic language detection uses an already-installed detector or Chrome's lightweight detection API; Prism does not download an additional detector for cloud translation.
- Translation history is stored in `chrome.storage.local` in the current Chrome profile.
- Provider API keys are stored separately in `chrome.storage.local`; Prism deliberately excludes them from Chrome Sync.
- Non-sensitive preferences may use `chrome.storage.sync` so the interface behaves consistently across the user's Chrome profiles.
- English pronunciation lookup reads the bundled US English IPA dictionary. It never sends a lookup to a dictionary service. The word-audio button uses browser speech synthesis and the system's available voices.

## When text leaves the device

Text is sent over the network only after the user selects a network-backed provider and starts a translation. The destination is the selected provider: MyMemory, an OpenAI-compatible endpoint, Kimi's selected API region, or the service configured in the user's local Codex / Kimi CLI. Prism sends the text needed for that translation; it does not send browsing history or page cookies. Detecting Kimi API models sends the API key to the selected API region without any page text.

## OpenAI connections

OpenAI has two independent modes: **Local Codex CLI** and **API**. Switching modes retains their separate model settings. API mode uses the key entered by the user, independently of the Codex CLI login. Existing Codex selections migrate to CLI mode; existing OpenAI-compatible selections migrate to API mode without clearing settings or history.

### Local Codex connector

The optional connector requires the `nativeMessaging` permission and a one-time local host registration. The installer allowlists the explicit Prism extension ID. Chrome launches the connector on demand over standard input/output; no TCP listener, web endpoint, or additional API key is created. The connector uses the existing Codex login without reading or copying credential files, requests the available model catalog, and starts temporary translation threads with file changes, shell tools, MCP servers, plugins, and memory disabled. It honors the system proxy. Model and reasoning choices are stored as preferences; generated translations can enter Prism history if enabled. The connector doesn't log translation text. Codex and its configured service retain their own normal operational and billing policies.

### API

API mode sends translation text to the configured OpenAI or compatible Chat Completions endpoint, using the locally stored API key. Detecting models sends the key to the same origin’s models endpoint without any page text. Requests reject redirects and omit browser cookies. Endpoints must use HTTPS, except for local services on localhost or 127.0.0.1.

Custom endpoints require a separate Chrome host-access confirmation for the exact origin. Required host access is limited to the documented MyMemory API origin.

## Kimi connectors

Kimi offers two independent modes. **Local CLI** uses the installed Kimi Code login via a separately registered Native Messaging host restricted to the specified extension ID. The connector does not read or copy credential files, open a TCP port, or restart existing CLI sessions. It uses ACP only for model discovery and cleanup. Translation uses print mode with a dedicated agent profile whose tools and subagents lists are empty, in a temporary directory, with an empty skills directory and telemetry disabled for the launched process. It shuts down its own child processes and attempts to delete only CLI sessions associated with that temporary directory. If interrupted, CLI recovery records may remain. Prism does not log translation text; Kimi's own operational logs, configured hooks and provider retention policies still apply. This is a cloud-backed service, not offline inference.

**Open Platform API** sends translation text and the user's API key only to `https://api.moonshot.cn/v1` or `https://api.moonshot.ai/v1`, selected in Settings. Prism requests host access for that exact origin and rejects redirects. The key is kept in local extension storage and excluded from sync. CLI and API model settings are separate; neither mode reuses the other's credentials. No Kimi service is used unless the user chooses that mode and detects models or translates.

## Page access

The content script runs on ordinary HTTP(S) pages to provide selection and page translation. It skips passwords and other form controls, editable content, scripts, styles, code blocks, canvases, SVG, and hidden text. Chrome internal pages and the Chrome Web Store remain inaccessible to extensions.

If an ordinary page was already open when Prism was installed or reloaded, Chrome may not yet have attached the content script. After the user opens Prism for that tab, Prism uses the temporary `activeTab` grant and the `scripting` API to attach only its bundled content script to that tab and retries once. Prism does not request the broad `tabs` permission or use this recovery path to read browsing history.

## Removal

Removing the extension removes its local settings and history from the Chrome profile. Cloud providers may have their own retention policies; consult the provider selected in Settings.

The separately installed Codex host registration is not removed automatically. On macOS its default files are `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.prism_translate.codex.json` and `~/Library/Application Support/Prism Translate/codex-host`; deleting these disables the connector without removing Codex itself. Linux uses `~/.config/google-chrome/NativeMessagingHosts/` and `~/.local/share/prism-translate/` respectively.

The Kimi registration is also separate: in the same directories, remove `com.prism_translate.kimi.json` and the `kimi-host` launcher to disable it. This does not uninstall Kimi Code or remove its own sessions and logs.

Version 1.3.0 removes DeepL and LibreTranslate. On initialization, their obsolete preferences and API keys are removed from Prism storage. Existing translation history is retained. If either removed engine was selected, the preference returns to Chrome Local AI.
