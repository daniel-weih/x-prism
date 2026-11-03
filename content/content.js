(() => {
  "use strict";

  const RUNTIME_MARKER = "__prismTranslateContentRuntimeV1";
  const previous = globalThis[RUNTIME_MARKER];
  if (previous?.isAlive?.()) return;
  previous?.dispose?.();
  const runtime = chrome.runtime;
  const storage = chrome.storage;
  const listeners = new AbortController();
  let disposed = false;
  let disconnected = false;
  let selectionTimer;

  // An extension reload can leave the old, disconnected UI node in a tab that
  // was already open. The new runtime owns a fresh node and message listener.
  document.getElementById("prism-translate-host")?.remove();

  const DEFAULTS = {
    provider: "chrome",
    sourceLanguage: "auto",
    targetLanguage: "zh",
    pageMode: "bilingual",
    showSelectionBubble: true,
    autoTranslateSelection: false,
    saveHistory: true,
    theme: "system",
    maxPageSegments: 240
  };
  const BLOCK_TAGS = new Set([
    "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DIV", "DL", "DT",
    "FIGCAPTION", "FOOTER", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER",
    "LI", "MAIN", "NAV", "P", "SECTION", "TD", "TH"
  ]);
  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE", "SVG", "CANVAS", "TEXTAREA",
    "INPUT", "SELECT", "OPTION", "KBD", "SAMP"
  ]);
  const translatorCache = new Map();
  const pageRecords = new Map();
  let settings = { ...DEFAULTS };
  let pageMode = "bilingual";
  let pageActive = false;
  let lastSelection = "";
  let lastSelectionRect = null;
  let hideTimer;
  let selectionRequest = 0;
  let pageTranslationPending = false;
  let pageSnapshotId = null;
  let pageSnapshotUrl = "";
  let detectorPromise;

  const logo = (name) => `<svg aria-hidden="true" viewBox="0 0 24 24"><defs><clipPath id="prism-logo-${name}"><path d="M0 0H24V2.093L0 20.409ZM0 22.17 24 3.854V24H0Z"/></clipPath></defs><path fill="currentColor" fill-rule="evenodd" clip-path="url(#prism-logo-${name})" d="M5 3H12C17 3 20 5.6 20 10S17 17 12 17H9V22H5ZM9 7V13H12C14.6 13 16 12 16 10S14.6 7 12 7Z"/></svg>`;

  const host = document.createElement("div");
  host.id = "prism-translate-host";
  host.dataset.prismVersion = "1.5.0";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all:initial; }
      * { box-sizing:border-box; }
      button { font:inherit; }
      button:focus-visible { outline:2px solid currentColor; outline-offset:3px; }
      .bubble { --menu-bg:#fff; --menu-text:#30343b; --menu-muted:#737983; --menu-border:#e3e5e8; --menu-hover:#f1f3f5; --menu-active:#e8ebef; --menu-shadow:0 2px 4px #18202d08,0 6px 20px #18202d12;
        position:fixed; display:none; align-items:center; gap:2px; max-width:calc(100vw - 24px); pointer-events:auto; padding:3px; border:1px solid var(--menu-border); border-radius:8px; color:var(--menu-text); font:500 12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:var(--menu-bg); box-shadow:var(--menu-shadow); color-scheme:light; }
      .bubble.dark { --menu-bg:#292b2f; --menu-text:#e8eaed; --menu-muted:#a8adb7; --menu-border:#41444a; --menu-hover:#383b41; --menu-active:#454951; --menu-shadow:0 2px 4px #0002,0 6px 20px #0003; color-scheme:dark; }
      .bubble-brand { display:grid; place-items:center; flex-shrink:0; width:24px; height:28px; margin-left:3px; color:var(--menu-text); }
      .bubble-brand svg { display:block; width:18px; height:18px; }
      .bubble-action { display:flex; align-items:center; justify-content:center; gap:6px; min-width:0; min-height:28px; padding:0 9px; border:0; border-radius:5px; background:transparent; color:inherit; cursor:pointer; white-space:nowrap; transition:background-color .12s; }
      .bubble-action:hover { background:var(--menu-hover); }
      .bubble-action:active { background:var(--menu-active); }
      .bubble-action:focus-visible { outline:2px solid var(--menu-muted); outline-offset:-2px; }
      .bubble-action svg { width:14px; height:14px; flex-shrink:0; color:var(--menu-muted); }
      .bubble-divider { width:1px; height:12px; margin:0 1px; background:var(--menu-border); flex-shrink:0; }
      .gem { width:22px; height:22px; display:grid; place-items:center; }
      .gem svg,.brand svg { width:22px; height:22px; display:block; }
      .card { --surface:#fff; --subtle:#f6f6f6; --stroke:#e2e2e2; --text:#242424; --muted:#666; --inverse:#fff; color-scheme:light;
        position:fixed; display:none; width:min(390px,calc(100vw - 24px)); max-height:calc(100vh - 20px); pointer-events:auto; overflow:auto; border:1px solid var(--stroke); border-radius:12px; color:var(--text); background:var(--surface); box-shadow:0 8px 32px #0002; font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
      .card.dark { --surface:#202020; --subtle:#292929; --stroke:#404040; --text:#ededed; --muted:#b0b0b0; --inverse:#202020; color-scheme:dark; }
      .head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:13px 16px 10px; }
      .brand { display:flex; align-items:center; gap:8px; font-weight:700; }
      .provider { padding:2px 5px; border:1px solid var(--stroke); border-radius:4px; font-size:9px; font-weight:500; color:var(--muted); }
      .close,.tool { border:0; color:var(--muted); background:transparent; cursor:pointer; border-radius:6px; }
      .close { width:28px; height:28px; font-size:20px; }
      .close:hover,.tool:hover { background:var(--subtle); color:var(--text); }
      .source { margin:0 16px 12px; max-height:64px; overflow:auto; color:var(--muted); font-size:12px; overflow-wrap:anywhere; }
      .pronunciation { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin:0 16px 12px; color:var(--muted); font:14px/1.5 -apple-system,"Segoe UI",sans-serif; }
      .pronunciation[hidden] { display:none; }
      .pronunciation button { border:1px solid var(--stroke); border-radius:5px; padding:3px 6px; color:var(--text); background:var(--subtle); cursor:pointer; font-size:11px; }
      .result { min-height:62px; max-height:210px; overflow:auto; margin:0 12px; padding:12px; white-space:pre-wrap; overflow-wrap:anywhere; border:1px solid var(--stroke); border-radius:8px; background:var(--subtle); font-size:15px; line-height:1.7; }
      .result.loading { color:var(--muted); }
      .recovery { margin:12px 16px 2px; }.recovery[hidden] { display:none; }
      .reload-page { border:0; border-radius:7px; padding:9px 14px; background:var(--text); color:var(--inverse); cursor:pointer; font:600 12px/1.4 -apple-system,sans-serif; }
      .result.loading::after { content:""; display:inline-block; width:14px; height:14px; margin-left:8px; vertical-align:-2px; border:2px solid var(--stroke); border-top-color:var(--text); border-radius:50%; animation:spin .7s linear infinite; }
      .foot { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:10px 12px; }
      .meta { min-width:0; overflow-wrap:anywhere; color:var(--muted); font-size:10px; }
      .tools { display:flex; flex-shrink:0; gap:3px; }.tools[hidden] { display:none; }
      .tool { min-width:30px; height:30px; padding:0 7px; font-size:12px; }
      .tool svg { display:block; width:16px; height:16px; }
      .toast { position:fixed; left:50%; bottom:24px; display:none; max-width:min(440px,calc(100vw - 28px)); transform:translateX(-50%); padding:10px 14px; border:1px solid #ffffff44; border-radius:8px; pointer-events:none; color:#fff; background:#242424; box-shadow:0 4px 16px #0002; font:500 12px/1.5 -apple-system,sans-serif; }
      @keyframes spin { to { transform:rotate(360deg); } }
      @media(prefers-reduced-motion:reduce) { .result.loading::after { animation:none; } }
    </style>
    <div class="bubble" role="toolbar" aria-label="Selected text actions">
      <span class="bubble-brand" role="img" aria-label="Prism" title="Prism">${logo("bubble")}</span>
      <button class="bubble-action bubble-translate" type="button"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h12M9 3v2M5 5c0 5 4 8 8 10M13 5c0 5-4 8-9 10M14 21l4-10 4 10M16 17h4"/></svg><span>Translate</span></button>
      <span class="bubble-divider" aria-hidden="true"></span>
      <button class="bubble-action bubble-read" type="button"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/></svg><span>Read aloud</span></button>
    </div>
    <section class="card" role="dialog" aria-label="Prism translation">
      <div class="head"><div class="brand">${logo("card")} Prism <span class="provider"></span></div><button class="close" aria-label="Close">×</button></div>
      <div class="source"></div><div class="pronunciation" hidden aria-live="polite"><span></span><button class="speak-source" type="button">朗读单词</button></div><div class="result"></div>
      <div class="recovery" hidden><button class="reload-page" type="button">刷新当前网页</button></div>
      <div class="foot"><span class="meta"></span><div class="tools"><button class="tool copy" title="Copy">Copy</button><button class="tool speak" title="Speak"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/></svg></button><button class="tool panel" title="Open side panel">↗</button></div></div>
    </section>
    <div class="toast"></div>`;
  (document.documentElement || document.body).appendChild(host);

  const bubble = shadow.querySelector(".bubble");
  const card = shadow.querySelector(".card");
  const sourceNode = shadow.querySelector(".source");
  const resultNode = shadow.querySelector(".result");
  const metaNode = shadow.querySelector(".meta");
  const providerNode = shadow.querySelector(".provider");
  const toastNode = shadow.querySelector(".toast");
  const pronunciationNode = shadow.querySelector(".pronunciation");
  const recoveryNode = shadow.querySelector(".recovery");
  let browserLanguage = navigator.language || "en";
  try { browserLanguage = chrome.i18n.getUILanguage(); } catch { /* cached fallback survives an extension reload */ }

  function chineseUi() {
    return settings.uiLanguage === "zh" || (settings.uiLanguage !== "en" && browserLanguage.toLowerCase().startsWith("zh"));
  }

  const label = (zh, en) => chineseUi() ? zh : en;

  function localizeControls() {
    bubble.setAttribute("aria-label", label("选中文字操作", "Selected text actions"));
    shadow.querySelector(".bubble-translate span").textContent = label("翻译", "Translate");
    shadow.querySelector(".bubble-read span").textContent = label("朗读", "Read aloud");
    for (const [selector, zh, en] of [[".bubble-translate", "翻译选中文字", "Translate selection"], [".bubble-read", "朗读选中文字", "Read selected text"]]) {
      const button = shadow.querySelector(selector);
      button.title = label(zh, en); button.setAttribute("aria-label", button.title);
    }
    shadow.querySelector(".copy").textContent = label("复制", "Copy");
    for (const [selector, zh, en] of [[".close", "关闭", "Close"], [".copy", "复制译文", "Copy translation"], [".speak", "朗读译文", "Read translation"], [".panel", "打开侧栏", "Open side panel"]]) {
      const node = shadow.querySelector(selector);
      node.title = label(zh, en);
      node.setAttribute("aria-label", node.title);
    }
  }

  function isAlive() {
    try { return !disposed && !disconnected && Boolean(runtime.id) && host.isConnected; }
    catch { return false; }
  }

  function contextLost(error) {
    return !isAlive() || /extension context invalidated/i.test(error?.message || "");
  }

  function assertConnected() {
    if (!isAlive()) throw new Error("Extension context invalidated.");
  }

  // An invalidated Chrome API can throw before returning a Promise.
  async function sendRuntimeMessage(message) {
    assertConnected();
    return await runtime.sendMessage(message);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    CSS.highlights?.delete("prism-reading");
    selectionRequest++;
    clearTimeout(hideTimer);
    clearTimeout(selectionTimer);
    listeners.abort();
    try { runtime.onMessage.removeListener(onRuntimeMessage); } catch { /* old context */ }
    try { storage.onChanged.removeListener(onSettingsChanged); } catch { /* old context */ }
    restorePage();
    for (const pending of translatorCache.values()) {
      Promise.resolve(pending).then((translator) => translator.destroy?.()).catch(() => {});
    }
    translatorCache.clear();
    host.remove();
    if (globalThis[RUNTIME_MARKER]?.dispose === dispose) delete globalThis[RUNTIME_MARKER];
  }

  globalThis[RUNTIME_MARKER] = { isAlive, dispose };

  function showReconnect(text = lastSelection, rect = lastSelectionRect) {
    if (disposed || !host.isConnected) return;
    disconnected = true;
    selectionRequest++;
    hideBubble();
    pronunciationNode.hidden = true;
    delete card.dataset.translation;
    card.dataset.source = text;
    sourceNode.textContent = text.length > 260 ? `${text.slice(0, 260)}…` : text;
    resultNode.classList.remove("loading");
    resultNode.textContent = chineseUi()
      ? "插件已更新或断开连接。请先保存网页中未提交的内容，再刷新当前网页继续翻译。"
      : "Prism was updated or disconnected. Save any unfinished work, then refresh this page to continue translating.";
    metaNode.textContent = chineseUi() ? "需要刷新网页" : "Refresh page to reconnect";
    providerNode.textContent = chineseUi() ? "已断开" : "DISCONNECTED";
    shadow.querySelector(".tools").hidden = true;
    shadow.querySelector(".reload-page").textContent = chineseUi() ? "刷新当前网页" : "Refresh this page";
    recoveryNode.hidden = false;
    card.classList.toggle("dark", darkMode());
    card.style.display = "block";
    place(card, rect || { left: innerWidth / 2 - 1, width: 2, top: 80, bottom: 100 });
  }

  Promise.resolve().then(() => { assertConnected(); return storage.sync.get("prismSettings"); }).then((stored) => {
    if (disposed) return;
    settings = { ...DEFAULTS, ...(stored.prismSettings || {}) };
    pageMode = settings.pageMode;
    localizeControls();
  }).catch((error) => { if (contextLost(error)) disconnected = true; });
  function onSettingsChanged(changes, area) {
    if (area === "sync" && changes.prismSettings) {
      settings = { ...DEFAULTS, ...(changes.prismSettings.newValue || {}) };
      pageMode = settings.pageMode;
      localizeControls();
      bubble.classList.toggle("dark", selectionMenuDark());
      if (!settings.showSelectionBubble) hideBubble();
    }
  }
  storage.onChanged.addListener(onSettingsChanged);

  function darkMode() {
    return settings.theme === "dark" || (settings.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  }

  function showToast(message, duration = 2500) {
    if (disposed || !host.isConnected) return;
    clearTimeout(hideTimer);
    toastNode.textContent = message;
    toastNode.style.display = "block";
    hideTimer = setTimeout(() => { toastNode.style.display = "none"; }, duration);
  }

  function selectionDetails() {
    const selection = document.getSelection();
    const text = selection?.toString().trim() || "";
    if (!text || selection.rangeCount === 0 || text.length > 12_000) return null;
    const range = selection.getRangeAt(0);
    if (host.contains(range.commonAncestorContainer)) return null;
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    return { text, rect };
  }

  function place(element, rect, preferredBelow = true) {
    const width = element === bubble ? element.offsetWidth : Math.min(390, innerWidth - 24);
    const height = element.offsetHeight || 280;
    const left = Math.max(12, Math.min(innerWidth - width - 12, rect.left + rect.width / 2 - width / 2));
    let top = preferredBelow ? rect.bottom + 9 : rect.top - height - 9;
    if (top + height > innerHeight - 10) top = Math.max(10, rect.top - height - 9);
    element.style.left = `${left}px`;
    element.style.top = `${Math.max(10, top)}px`;
  }

  function hideBubble() { bubble.style.display = "none"; }
  function selectionMenuDark() {
    if (settings.theme === "dark" || settings.theme === "light") return settings.theme === "dark";
    // Match the selected passage's surface, which may differ from the OS theme.
    const anchor = document.getSelection()?.anchorNode;
    for (let element = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement; element; element = element.parentElement) {
      const background = getComputedStyle(element).backgroundColor;
      if (!background.startsWith("rgb")) continue;
      const values = background.match(/[\d.]+/g)?.map(Number);
      if (values?.length >= 3 && (values[3] ?? 1) >= 0.9) return values[0] * .2126 + values[1] * .7152 + values[2] * .0722 < 140;
    }
    const scheme = getComputedStyle(document.documentElement).colorScheme;
    return scheme.includes("dark") && (!scheme.includes("light") || darkMode());
  }

  function showBubble(details) {
    lastSelection = details.text;
    lastSelectionRect = details.rect;
    bubble.classList.toggle("dark", selectionMenuDark());
    bubble.style.display = "flex";
    place(bubble, details.rect);
  }

  document.addEventListener("mouseup", (event) => {
    if (!host.isConnected) { dispose(); return; }
    if (event.target === host || !settings.showSelectionBubble) return;
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      if (disposed || !host.isConnected) return;
      const details = selectionDetails();
      if (details) {
        showBubble(details);
        if (settings.autoTranslateSelection) translateSelection(details.text, details.rect);
      } else {
        hideBubble();
      }
    }, 10);
  }, { capture: true, signal: listeners.signal });

  document.addEventListener("mousedown", (event) => {
    if (!host.isConnected) { dispose(); return; }
    if (event.composedPath().includes(host)) return;
    hideBubble();
    if (!card.contains(event.target)) card.style.display = "none";
  }, { capture: true, signal: listeners.signal });

  async function detectLanguage(text) {
    if ("LanguageDetector" in globalThis) {
      try {
        const availability = await LanguageDetector.availability();
        if (availability === "available") {
          detectorPromise ||= LanguageDetector.create().catch((error) => { detectorPromise = null; throw error; });
          const detector = await detectorPromise;
          return (await detector.detect(text.slice(0, 4000)))?.[0]?.detectedLanguage || "und";
        }
      } catch { /* fall through */ }
    }
    assertConnected();
    return new Promise((resolve, reject) => chrome.i18n.detectLanguage(text, (result) => {
      const error = runtime.lastError;
      if (error) { reject(new Error(error.message)); return; }
      resolve(result?.languages?.[0]?.language || "und");
    }));
  }

  function smartTarget(source, preferred) {
    if (!source || source === "und") return preferred;
    if (source.toLowerCase() === preferred.toLowerCase()) return source.toLowerCase().startsWith("zh") ? "en" : "zh";
    if (source.toLowerCase().startsWith("zh") && preferred.toLowerCase().startsWith("zh")) return "en";
    return preferred;
  }

  async function localTranslate(texts, source, target, onProgress) {
    if (!("Translator" in globalThis)) throw new Error(label("当前环境无法使用本地翻译，请使用受支持的 Chrome（138+）或选择其他引擎。", "Local translation is unavailable. Use a supported Chrome version (138+) or choose another engine."));
    const key = `${source}:${target}`;
    if (!translatorCache.has(key)) {
      translatorCache.set(key, (async () => {
        const availability = await Translator.availability({ sourceLanguage: source, targetLanguage: target });
        if (availability === "unavailable") throw new Error(label("本地翻译暂不支持这组语言，请选择其他引擎。", "This language pair is unavailable locally. Choose another engine."));
        return Translator.create({
          sourceLanguage: source, targetLanguage: target,
          ...(availability === "available" ? {} : { monitor(monitor) {
            monitor.addEventListener("downloadprogress", (event) => onProgress?.(event.loaded >= 1
              ? label("正在准备本地翻译…", "Preparing local translator…")
              : `${label("正在下载本地翻译语言包…", "Downloading local translation pack…")} ${Math.round(event.loaded * 100)}%`));
          } })
        });
      })().catch((error) => { translatorCache.delete(key); throw error; }));
    }
    const translator = await translatorCache.get(key);
    onProgress?.(label("正在翻译…", "Translating…"));
    const output = [];
    for (let index = 0; index < texts.length; index += 1) {
      output.push(await translator.translate(texts[index]));
      onProgress?.(`${label("正在翻译…", "Translating…")} ${index + 1}/${texts.length}`);
    }
    return output;
  }

  async function translateTexts(texts, onProgress) {
    assertConnected();
    const current = { ...settings };
    if (current.sourceLanguage === "auto") onProgress?.(label("正在识别原文语言…", "Detecting source language…"));
    const detected = current.sourceLanguage === "auto" ? await detectLanguage(texts.slice(0, 6).join(" ")) : current.sourceLanguage;
    const source = detected === "und" ? "en" : detected;
    const target = smartTarget(source, current.targetLanguage);
    if (current.provider === "chrome") {
      return { translations: await localTranslate(texts, source, target, onProgress), source, target, provider: current.provider };
    }
    onProgress?.(label("正在翻译…", "Translating…"));
    const response = await sendRuntimeMessage({
      type: "PRISM_REMOTE_TRANSLATE",
      provider: current.provider,
      texts,
      sourceLanguage: current.sourceLanguage === "auto" ? source : current.sourceLanguage,
      targetLanguage: target
    });
    if (!response?.ok) throw new Error(response?.error || "Translation failed.");
    return { translations: response.translations, source, target, provider: current.provider };
  }

  async function translateSelection(text = lastSelection, rect = lastSelectionRect) {
    if (disposed || !host.isConnected) return;
    if (!isAlive()) { showReconnect(text, rect); return; }
    if (!text) {
      showToast(label("请先选择文字。", "Select some text first."));
      return;
    }
    hideBubble();
    const request = ++selectionRequest;
    recoveryNode.hidden = true;
    shadow.querySelector(".tools").hidden = false;
    delete card.dataset.translation;
    card.dataset.source = text;
    pronunciationNode.hidden = true;
    if ((settings.sourceLanguage === "auto" || settings.sourceLanguage.startsWith("en")) && /^[a-z]+(?:['’‘-][a-z]+)*$/i.test(text) && text.length <= 64) {
      sendRuntimeMessage({ type: "PRISM_PRONUNCIATION", text }).then((response) => {
        if (request !== selectionRequest) return;
        const value = response?.pronunciation;
        const chinese = chineseUi();
        pronunciationNode.querySelector("span").textContent = value ? `${value.label} ${value.ipa}` : (chinese ? (response?.ok ? "离线词典暂未收录" : "音标词典暂不可用") : (response?.ok ? "Not in offline dictionary" : "Dictionary unavailable"));
        pronunciationNode.title = value?.source || "";
        pronunciationNode.querySelector("button").textContent = chinese ? "朗读单词" : "Read word";
        pronunciationNode.querySelector("button").title = chinese ? "使用已设置的模型和音色，在侧栏朗读原单词" : "Read the original word in the side panel with your selected model and voice";
        pronunciationNode.hidden = false;
        if (rect) place(card, rect);
      }).catch((error) => { if (request === selectionRequest && contextLost(error)) showReconnect(text, rect); });
    }
    card.classList.toggle("dark", darkMode());
    sourceNode.textContent = text.length > 260 ? `${text.slice(0, 260)}…` : text;
    resultNode.textContent = label("正在翻译…", "Translating…");
    resultNode.classList.add("loading");
    metaNode.textContent = "";
    providerNode.textContent = settings.provider === "chrome" ? "ON-DEVICE"
      : settings.provider === "codex" ? "OPENAI CLI"
      : settings.provider === "openai" ? `OPENAI ${(settings.openaiConnection || "api").toUpperCase()}`
      : settings.provider === "kimi" ? `KIMI ${(settings.kimiConnection || "cli").toUpperCase()}` : settings.provider.toUpperCase();
    card.style.display = "block";
    place(card, rect || { left: innerWidth / 2 - 1, width: 2, top: 80, bottom: 100 });
    try {
      const result = await translateTexts([text], (label) => { if (request === selectionRequest) metaNode.textContent = label; });
      if (request !== selectionRequest) return;
      const translated = result.translations[0];
      resultNode.textContent = translated;
      resultNode.classList.remove("loading");
      metaNode.textContent = `${result.source}  →  ${result.target}`;
      card.dataset.translation = translated;
      card.dataset.source = text;
      if (rect) place(card, rect);
      if (settings.saveHistory) {
        sendRuntimeMessage({
          type: "PRISM_ADD_HISTORY",
          entry: { sourceText: text, translatedText: translated, sourceLanguage: result.source, targetLanguage: result.target, provider: result.provider }
        }).then((response) => { if (!response?.ok) throw new Error(response?.error || "History unavailable"); }).catch((error) => {
          if (request !== selectionRequest) return;
          if (contextLost(error)) disconnected = true;
          // Saving history must never replace a successfully displayed translation.
          showToast(chineseUi() ? "译文已完成，但未能保存历史记录。" : "Translation complete; history could not be saved.");
        });
      }
    } catch (error) {
      if (request !== selectionRequest) return;
      if (contextLost(error)) { showReconnect(text, rect); return; }
      resultNode.textContent = error.message;
      resultNode.classList.remove("loading");
      metaNode.textContent = label("暂时无法翻译", "Translation unavailable");
    }
  }

  function listen(node, type, handler) { node.addEventListener(type, handler, { signal: listeners.signal }); }
  function openReader(text) {
    if (!text) return;
    // Invoke from the click handler so sidePanel.open retains user activation.
    sendRuntimeMessage({ type: "PRISM_OPEN_PANEL", action: { type: "read-selection", text } })
      .then(response => { if (!response?.ok) throw new Error(response?.error || label("无法打开朗读侧栏", "Unable to open reading panel")); })
      .catch(error => { if (contextLost(error)) showReconnect(text); else showToast(error.message); });
  }
  // Keep the webpage selection intact while pressing either action.
  listen(bubble, "mousedown", event => event.preventDefault());
  listen(shadow.querySelector(".bubble-translate"), "click", () => translateSelection(lastSelection, lastSelectionRect));
  listen(shadow.querySelector(".bubble-read"), "click", () => {
    const text = lastSelection;
    if (!text) return;
    hideBubble(); card.style.display = "none"; selectionRequest++;
    openReader(text);
  });
  listen(document, "keydown", event => { if (event.key === "Escape") { hideBubble(); card.style.display = "none"; selectionRequest++; } });
  document.addEventListener("scroll", hideBubble, { capture: true, passive: true, signal: listeners.signal });
  listen(window, "resize", hideBubble);
  listen(shadow.querySelector(".reload-page"), "click", () => location.reload());
  listen(shadow.querySelector(".speak-source"), "click", () => openReader(card.dataset.source));
  listen(shadow.querySelector(".close"), "click", () => { card.style.display = "none"; selectionRequest++; });
  listen(shadow.querySelector(".copy"), "click", async () => {
    if (!card.dataset.translation) return;
    try {
      await navigator.clipboard.writeText(card.dataset.translation);
      showToast(label("译文已复制", "Translation copied"));
    } catch { showToast(label("无法访问剪贴板，请手动复制。", "Clipboard unavailable. Please copy manually.")); }
  });
  listen(shadow.querySelector(".speak"), "click", () => openReader(card.dataset.translation));
  listen(shadow.querySelector(".panel"), "click", () => {
    sendRuntimeMessage({ type: "PRISM_OPEN_PANEL", action: { type: "selection", text: card.dataset.source || lastSelection } })
      .catch((error) => { if (contextLost(error)) showReconnect(card.dataset.source || lastSelection); else showToast(error.message); });
  });

  function shouldSkipTextNode(node) {
    const parent = node.parentElement;
    if (!parent || !node.nodeValue?.trim()) return true;
    if (parent.isContentEditable || SKIP_TAGS.has(parent.tagName) || parent.closest("script,style,noscript,code,pre,svg,canvas,textarea,input,select,option,nav,[role='navigation'],[hidden],[aria-hidden='true'],[inert]")) return true;
    if (parent.closest("#prism-translate-host") || parent.classList.contains("prism-page-translation")) return true;
    const text = node.nodeValue.trim();
    if (text.length < 2 || text.length > 2_000 || /^[\d\s.,:/+\-–—%()[\]{}]+$/.test(text)) return true;
    for (let element = parent; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || Number(style.opacity) === 0 || style.contentVisibility === "hidden") return true;
    }
    return false;
  }

  function restorePage() {
    for (const record of pageRecords.values()) {
      if (record.node.isConnected && record.node.nodeValue === record.rendered) record.node.nodeValue = record.original;
      record.translationNode?.remove();
    }
    pageRecords.clear();
    pageSnapshotId = null;
    pageActive = false;
    showToast(label("已恢复原始网页", "Original page restored"));
  }

  function collectPage() {
    if (pageActive) restorePage();
    pageRecords.clear();
    pageSnapshotId = crypto.randomUUID();
    pageSnapshotUrl = location.href;
    let id = 0;
    let totalLimited = false;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => shouldSkipTextNode(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    while (walker.nextNode()) {
      if (id >= settings.maxPageSegments) { totalLimited = true; break; }
      const node = walker.currentNode;
      id += 1;
      pageRecords.set(id, { id, node, original: node.nodeValue, rendered: node.nodeValue, translation: "", translationNode: null });
    }
    return {
      items: Array.from(pageRecords.values(), ({ id: itemId, original }) => ({ id: itemId, text: original.trim() })),
      title: document.title,
      url: location.href,
      snapshotId: pageSnapshotId,
      totalLimited
    };
  }

  function renderRecord(record, mode) {
    if (!record.node.isConnected || record.node.nodeValue !== record.rendered) {
      record.translationNode?.remove();
      pageRecords.delete(record.id);
      return false;
    }
    record.translationNode?.remove();
    record.translationNode = null;
    if (mode === "translated") {
      const leading = record.original.match(/^\s*/)?.[0] || "";
      const trailing = record.original.match(/\s*$/)?.[0] || "";
      record.node.nodeValue = `${leading}${record.translation}${trailing}`;
      record.rendered = record.node.nodeValue;
      return true;
    }
    record.node.nodeValue = record.original;
    record.rendered = record.original;
    const translated = document.createElement("span");
    translated.className = "prism-page-translation";
    if (BLOCK_TAGS.has(record.node.parentElement?.tagName)) translated.classList.add("prism-page-translation-block");
    translated.textContent = record.translation;
    record.node.parentNode?.insertBefore(translated, record.node.nextSibling);
    record.translationNode = translated;
    return true;
  }

  function applyPageBatch(items, mode = pageMode, snapshotId = pageSnapshotId) {
    if (!snapshotId || snapshotId !== pageSnapshotId || pageSnapshotUrl !== location.href) return { ok: false, code: "PAGE_CHANGED" };
    pageMode = mode === "translated" ? "translated" : "bilingual";
    let applied = 0, skipped = 0;
    for (const item of items || []) {
      const record = pageRecords.get(Number(item.id));
      if (!record) { skipped++; continue; }
      record.translation = String(item.translation || "");
      if (record.translation && renderRecord(record, pageMode)) applied++;
      else skipped++;
    }
    pageActive = Array.from(pageRecords.values()).some((record) => record.translation);
    return { ok: true, applied, skipped, active: pageActive };
  }

  async function translateCurrentPage() {
    if (disposed || !host.isConnected) return;
    if (!isAlive()) { showReconnect(); return; }
    if (pageTranslationPending) { showToast(label("网页正在翻译，请稍候。", "Page translation is already in progress.")); return; }
    if (pageActive) {
      restorePage();
      return;
    }
    const snapshot = collectPage();
    if (!snapshot.items.length) {
      showToast(label("没有找到可翻译的网页文字。", "No translatable text found on this page."));
      return;
    }
    pageTranslationPending = true;
    showToast(label(`正在翻译 ${snapshot.items.length} 个片段…`, `Translating ${snapshot.items.length} segments…`), 60_000);
    try {
      const result = await translateTexts(snapshot.items.map(({ text }) => text), (label) => showToast(label, 60_000));
      if (disposed || !host.isConnected) return;
      const applied = applyPageBatch(snapshot.items.map((item, index) => ({ id: item.id, translation: result.translations[index] })), pageMode, snapshot.snapshotId);
      if (!applied.ok || !applied.applied) throw new Error(label("网页内容已变化，请重新翻译。", "The page changed. Please translate it again."));
      showToast(`${label(`已翻译 ${applied.applied} 个片段`, `Translated ${applied.applied} segments`)}${applied.skipped ? label(` · 跳过 ${applied.skipped} 个已变化片段`, ` · ${applied.skipped} changed segments skipped`) : ""} · ${result.source} → ${result.target}`);
    } catch (error) {
      if (pageSnapshotId === snapshot.snapshotId) restorePage();
      if (contextLost(error)) { showReconnect(); return; }
      showToast(error.message, 5000);
    } finally { pageTranslationPending = false; }
  }

  let readingSnapshot = null;
  let readingUrl = "";
  const readingNodes = new Map();
  function collectReading(selectionOnly) {
    readingNodes.clear();
    readingSnapshot = crypto.randomUUID(); readingUrl = location.href;
    CSS.highlights?.delete("prism-reading");
    if (selectionOnly) {
      const selection = getSelection();
      const text = selection?.toString().trim() || lastSelection;
      if (selection?.rangeCount) readingNodes.set(0, selection.getRangeAt(0).cloneRange());
      return { ok: true, paragraphs: text ? [{ id: 0, text }] : [], snapshot: readingSnapshot, url: readingUrl };
    }
    const visible = element => {
      for (let e = element; e; e = e.parentElement) {
        const style = getComputedStyle(e);
        if (e.hidden || e.getAttribute("aria-hidden") === "true" || style.display === "none" || ["hidden", "collapse"].includes(style.visibility) || style.opacity === "0" || style.contentVisibility === "hidden") return false;
      }
      return true;
    };
    const roots = [...document.querySelectorAll("article,main,[role=main]")].filter(visible);
    const root = roots.sort((a, b) => b.textContent.length - a.textContent.length)[0] || document.body;
    const originals = new Map([...pageRecords.values()].filter(r => r.node.isConnected && r.node.nodeValue === r.rendered).map(r => [r.node, r.original]));
    const paragraphs = []; let block, current, length = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const node = walker.currentNode, parent = node.parentElement;
      if (node.nodeType === Node.ELEMENT_NODE) { if (node.tagName === "BR" && current && visible(node)) current.text += "\n"; continue; }
      if (!parent || parent.isContentEditable || parent.closest("script,style,noscript,code,pre,svg,canvas,input,textarea,select,button,nav,aside,footer,[role=navigation],[role=banner],[role=dialog],[role=contentinfo],[inert],#prism-translate-host,.prism-page-translation") || !visible(parent)) continue;
      const text = originals.get(node) ?? node.nodeValue;
      if (!text?.trim()) continue;
      const nextBlock = parent.closest("p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th,figcaption,div,section,article,main") || parent;
      if (nextBlock !== block) {
        block = nextBlock; current = { id: paragraphs.length, text: "" }; paragraphs.push(current); readingNodes.set(current.id, block);
      }
      current.text += text; length += text.length;
      if (length > 240_000) return { ok: false, error: label("文章过长，请选择部分段落朗读。", "Article too long. Select a smaller section.") };
    }
    return { ok: true, paragraphs, snapshot: readingSnapshot, url: readingUrl };
  }
  function highlightReading(message) {
    if (message.snapshot !== readingSnapshot || readingUrl !== location.href) return;
    CSS.highlights?.delete("prism-reading");
    if (!CSS.highlights || typeof Highlight === "undefined") return;
    const ranges = [];
    for (const id of new Set(Array.isArray(message.ids) ? message.ids : [message.id])) {
      const node = readingNodes.get(id);
      if (!node) continue;
      if (node instanceof Range) { if (node.commonAncestorContainer.isConnected) ranges.push(node); }
      else if (node.isConnected) { const range = document.createRange(); range.selectNodeContents(node); ranges.push(range); }
    }
    if (ranges.length) CSS.highlights.set("prism-reading", new Highlight(...ranges));
  }

  function onRuntimeMessage(message, sender, sendResponse) {
    if (disposed) return false;
    if (message?.type === "PRISM_READING_COLLECT") { sendResponse(collectReading(message.selection)); return false; }
    if (message?.type === "PRISM_READING_HIGHLIGHT") { highlightReading(message); sendResponse({ ok: true }); return false; }
    if (message?.type === "PRISM_TRANSLATE_SELECTION") {
      const details = selectionDetails();
      translateSelection(details?.text || lastSelection, details?.rect);
      sendResponse({ ok: true, hasSelection: Boolean(details?.text || lastSelection) });
      return false;
    }
    if (message?.type === "PRISM_TOGGLE_PAGE") {
      translateCurrentPage();
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "PRISM_COLLECT_PAGE") {
      sendResponse({ ok: true, ...collectPage() });
      return false;
    }
    if (message?.type === "PRISM_APPLY_PAGE_BATCH") {
      sendResponse(applyPageBatch(message.items, message.mode, message.snapshotId));
      return false;
    }
    if (message?.type === "PRISM_RESTORE_PAGE") {
      restorePage();
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "PRISM_SET_PAGE_MODE") {
      pageMode = message.mode === "translated" ? "translated" : "bilingual";
      for (const record of pageRecords.values()) if (record.translation) renderRecord(record, pageMode);
      sendResponse({ ok: true, active: pageActive, mode: pageMode });
      return false;
    }
    if (message?.type === "PRISM_GET_PAGE_STATE") {
      sendResponse({
        ok: true,
        active: pageActive,
        mode: pageMode,
        count: Array.from(pageRecords.values()).filter((record) => record.translation && record.node.isConnected).length,
        title: document.title,
        url: location.href
      });
      return false;
    }
    return false;
  }
  runtime.onMessage.addListener(onRuntimeMessage);
})();
