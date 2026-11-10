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
  let lastPointerAnchor = null;
  let bubbleDrag = null;
  let hideTimer;
  let selectionRequest = 0;
  let pageTranslationPending = false;
  let pageRequest = 0;
  let readerSession = null, readerRequest = null, readerFrame = null;
  let readerAttached = false, readerToggleRevision = 0, readerSelectionText = "";
  let selectionState = null, pageState = null, readerState = null;
  let cardAnchorRange = null, cardAnchorRect = null;
  let cardPointerOffset = null;
  let cardBelow = null;
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
      .bubble-brand { display:grid; place-items:center; flex-shrink:0; width:24px; height:28px; margin-left:3px; color:var(--menu-text); cursor:grab; touch-action:none; user-select:none; }
      .bubble.dragging,.bubble.dragging .bubble-brand { cursor:grabbing; }
      .bubble-brand svg { display:block; width:18px; height:18px; }
      .bubble-action { display:flex; align-items:center; justify-content:center; gap:6px; min-width:0; min-height:28px; padding:0 9px; border:0; border-radius:5px; background:transparent; color:inherit; cursor:pointer; white-space:nowrap; transition:background-color .12s; }
      .bubble-action:hover { background:var(--menu-hover); }
      .bubble-action:active { background:var(--menu-active); }
      .bubble-action:focus-visible { outline:2px solid var(--menu-muted); outline-offset:-2px; }
      .bubble-action svg { width:14px; height:14px; flex-shrink:0; color:var(--menu-muted); }
      .bubble-divider { width:1px; height:12px; margin:0 1px; background:var(--menu-border); flex-shrink:0; }
      .gem { width:22px; height:22px; display:grid; place-items:center; }
      .gem svg,.brand svg { width:22px; height:22px; display:block; }
      .dock { position:fixed; right:16px; bottom:16px; width:52px; height:52px; pointer-events:none; }
      .dock[hidden] { display:none; }
      .dock-details { position:absolute; right:0; bottom:62px; display:flex; flex-direction:column; align-items:flex-end; gap:8px; width:min(390px,calc(100vw - 32px)); max-height:calc(100vh - 100px); padding:4px; overflow:auto; }
      /* Preserve the mounted audio frame and its layout while the controls are tucked away. */
      .dock-details[inert] { visibility:hidden; pointer-events:none; }
      .status-orb { position:relative; display:grid; place-items:center; width:52px; height:52px; padding:0; border:1px solid #e2e2e2; border-radius:50%; color:#30343b; background:#fff; box-shadow:0 3px 14px #18202d24; cursor:pointer; pointer-events:auto; }
      .status-orb.dark { color:#eee; background:#26282d; border-color:#45484f; }
      .status-orb:hover { box-shadow:0 4px 18px #18202d38; }
      .orb-ring { position:absolute; inset:3px; width:44px; height:44px; transform:rotate(-90deg); fill:none; stroke:currentColor; stroke-width:2; }
      .orb-track { opacity:.12; }
      .orb-progress { stroke-linecap:round; transition:stroke-dashoffset .2s; }
      .status-orb[data-busy="true"] .orb-ring { animation:spin 1.2s linear infinite; }
      .status-orb[data-state="error"] .orb-ring { color:#c0771a; }
      .orb-symbol { display:grid; place-items:center; width:22px; height:22px; }
      .orb-symbol svg { width:22px; height:22px; }
      .orb-symbol > svg { display:none; }
      .status-orb[data-symbol="translation"] .orb-translation,.status-orb[data-symbol="reading"] .orb-reading,.status-orb[data-symbol="paused"] .orb-paused,.status-orb[data-symbol="done"] .orb-done,.status-orb[data-symbol="error"] .orb-error { display:block; }
      .reader-frame { display:block; width:100%; height:142px; flex-shrink:0; border:0; background:transparent; pointer-events:auto; }
      .page-status { width:100%; flex-shrink:0; pointer-events:auto; padding:12px; border:1px solid #e2e2e2; border-radius:12px; color:#242424; background:#fff; box-shadow:0 3px 12px #0002; font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
      .page-status[hidden] { display:none; }
      .page-status.dark { color:#eee; background:#242424; border-color:#424242; color-scheme:dark; }
      .page-status .page-row { display:flex; align-items:center; gap:8px; }
      .page-status .page-label { flex:1; min-width:0; overflow-wrap:anywhere; }
      .page-status button { border:1px solid #8885; border-radius:6px; padding:4px 8px; background:transparent; color:inherit; cursor:pointer; }
      .page-status button[hidden] { display:none; }
      .page-status progress { width:100%; height:3px; margin-top:8px; accent-color:currentColor; }
      .card { --surface:#fff; --subtle:#f6f6f6; --stroke:#e2e2e2; --text:#242424; --muted:#666; --inverse:#fff; color-scheme:light;
        position:relative; flex-shrink:0; display:none; width:100%; max-height:calc(100vh - 112px); pointer-events:auto; overflow:auto; border:1px solid var(--stroke); border-radius:12px; color:var(--text); background:var(--surface); box-shadow:0 8px 32px #0002; font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
      .card.anchored { position:fixed; width:min(390px,calc(100vw - 24px)); max-height:calc(100vh - 24px); }
      .card.dark { --surface:#202020; --subtle:#292929; --stroke:#404040; --text:#ededed; --muted:#b0b0b0; --inverse:#202020; color-scheme:dark; }
      .head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:13px 16px 10px; }
      .brand { display:flex; align-items:center; gap:8px; font-weight:700; }
      .selection-status { font-size:10px; font-weight:400; color:var(--muted); white-space:nowrap; }
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
      @media(prefers-reduced-motion:reduce) { .result.loading::after,.status-orb[data-busy="true"] .orb-ring { animation:none; } .orb-progress { transition:none; } }
    </style>
    <div class="bubble" role="toolbar" aria-label="Selected text actions">
      <span class="bubble-brand" role="img" aria-label="Prism" title="Prism">${logo("bubble")}</span>
      <button class="bubble-action bubble-translate" type="button"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h12M9 3v2M5 5c0 5 4 8 8 10M13 5c0 5-4 8-9 10M14 21l4-10 4 10M16 17h4"/></svg><span>Translate</span></button>
      <span class="bubble-divider" aria-hidden="true"></span>
      <button class="bubble-action bubble-read" type="button"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/></svg><span>Read aloud</span></button>
    </div>
    <section class="card anchored" role="dialog" aria-label="Prism translation">
      <div class="head"><div class="brand">${logo("card")} Prism <span class="provider"></span><span class="selection-status" role="status"></span></div><div><button class="close collapse" aria-label="Collapse">−</button><button class="close dismiss" aria-label="Close">×</button></div></div>
      <div class="source"></div><div class="pronunciation" hidden aria-live="polite"><span></span><button class="speak-source" type="button">朗读单词</button></div><div class="result"></div>
      <div class="recovery" hidden><button class="reload-page" type="button">刷新当前网页</button></div>
      <div class="foot"><span class="meta"></span><div class="tools"><button class="tool copy" title="Copy">Copy</button><button class="tool speak" title="Speak"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/></svg></button><button class="tool panel" title="Open side panel">↗</button></div></div>
    </section>
    <div class="dock" hidden>
    <div class="dock-details" id="prism-details" inert aria-hidden="true">
    <section class="page-status" hidden aria-label="Page translation"><div class="page-row"><span class="page-label" role="status"></span><button class="page-stop" type="button">Stop</button><button class="page-retry" type="button" hidden>Retry</button><button class="page-restore" type="button" hidden>Restore</button><button class="page-close" type="button" aria-label="Close">×</button></div><progress max="1" value="0" aria-label="Translation progress"></progress></section>
    </div>
    <button class="status-orb" type="button" aria-label="Prism" aria-expanded="false" aria-controls="prism-details" data-symbol="translation">
      <svg class="orb-ring" viewBox="0 0 44 44" aria-hidden="true"><circle class="orb-track" cx="22" cy="22" r="20"/><circle class="orb-progress" cx="22" cy="22" r="20" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/></svg>
      <span class="orb-symbol" aria-hidden="true">
        <svg class="orb-translation" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h12M9 3v2M5 5c0 5 4 8 8 10M13 5c0 5-4 8-9 10M14 21l4-10 4 10M16 17h4"/></svg>
        <svg class="orb-reading" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/></svg>
        <svg class="orb-paused" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
        <svg class="orb-done" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4 10-10"/></svg>
        <svg class="orb-error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v9M12 18v1"/></svg>
      </span>
    </button>
    </div>
    <div class="toast"></div>`;
  (document.documentElement || document.body).appendChild(host);

  const bubble = shadow.querySelector(".bubble");
  const bubbleHandle = shadow.querySelector(".bubble-brand");
  const card = shadow.querySelector(".card");
  const sourceNode = shadow.querySelector(".source");
  const resultNode = shadow.querySelector(".result");
  const metaNode = shadow.querySelector(".meta");
  const providerNode = shadow.querySelector(".provider");
  const toastNode = shadow.querySelector(".toast");
  const pronunciationNode = shadow.querySelector(".pronunciation");
  const recoveryNode = shadow.querySelector(".recovery");
  const dock = shadow.querySelector(".dock");
  const dockDetails = shadow.querySelector(".dock-details");
  const statusOrb = shadow.querySelector(".status-orb");
  let browserLanguage = navigator.language || "en";
  try { browserLanguage = chrome.i18n.getUILanguage(); } catch { /* cached fallback survives an extension reload */ }

  function chineseUi() {
    return settings.uiLanguage === "zh" || (settings.uiLanguage !== "en" && browserLanguage.toLowerCase().startsWith("zh"));
  }

  const label = (zh, en) => chineseUi() ? zh : en;

  function positionSelectionCard() {
    if (!card.classList.contains("anchored") || card.style.display !== "block") return;
    if (cardAnchorRange?.commonAncestorContainer.isConnected && !cardAnchorRange.collapsed) {
      const current = cardAnchorRange.getBoundingClientRect();
      if (current.width || current.height) {
        cardAnchorRect = cardPointerOffset
          ? { left: current.left + cardPointerOffset.x, width: 0, top: current.top + cardPointerOffset.y, bottom: current.top + cardPointerOffset.y }
          : current;
      }
    }
    const rect = cardAnchorRect;
    if (!rect) return;
    const margin = 12, gap = 9;
    const below = innerHeight - margin - rect.bottom - gap;
    const above = rect.top - gap - margin;
    // Choose the side once. Async translation/pronunciation must not flip the
    // popup across the selection when its contents grow.
    cardBelow ??= below >= card.offsetHeight || below >= above;
    const minHeight = Math.min(120, Math.max(0, innerHeight - margin * 2));
    const edge = cardBelow
      ? Math.max(margin, Math.min(rect.bottom + gap, innerHeight - margin - minHeight))
      : Math.min(innerHeight - margin, Math.max(rect.top - gap, margin + minHeight));
    card.style.left = `${Math.max(margin, Math.min(innerWidth - card.offsetWidth - margin, rect.left + rect.width / 2 - card.offsetWidth / 2))}px`;
    card.style.top = cardBelow ? `${edge}px` : "auto";
    card.style.bottom = cardBelow ? "auto" : `${innerHeight - edge}px`;
    card.style.maxHeight = `${Math.max(0, cardBelow ? innerHeight - margin - edge : edge - margin)}px`;
  }

  function showSelectionCard(rect) {
    const selection = document.getSelection();
    cardAnchorRange = selection?.rangeCount && selection.toString().trim() === card.dataset.source
      ? selection.getRangeAt(0).cloneRange() : null;
    cardAnchorRect = rect || { left: innerWidth / 2 - 1, width: 2, top: 80, bottom: 100 };
    const rangeRect = cardAnchorRange?.getBoundingClientRect();
    cardPointerOffset = rect?.pointer && rangeRect
      ? { x: rect.left - rangeRect.left, y: rect.top - rangeRect.top } : null;
    cardBelow = null;
    card.style.removeProperty("max-height");
    card.style.removeProperty("bottom");
    card.scrollTop = 0;
    resultNode.scrollTop = 0;
    shadow.insertBefore(card, dock);
    card.classList.add("anchored");
    card.style.display = "block";
    setDockExpanded(false);
    positionSelectionCard();
  }

  function collapseSelection(focusOrb = false) {
    if (!selectionState || card.style.display !== "block") return;
    card.classList.remove("anchored");
    card.style.removeProperty("left");
    card.style.removeProperty("top");
    card.style.removeProperty("bottom");
    card.style.removeProperty("max-height");
    dockDetails.prepend(card);
    setDockExpanded(false, focusOrb);
  }

  function dismissSelection() {
    card.style.display = "none";
    selectionRequest++;
    selectionState = null;
    cardAnchorRange = null;
    cardAnchorRect = null;
    cardPointerOffset = null;
    renderOrb();
  }

  function setDockExpanded(expanded, focusOrb = false) {
    dockDetails.inert = !expanded;
    dockDetails.setAttribute("aria-hidden", String(!expanded));
    statusOrb.setAttribute("aria-expanded", String(expanded));
    renderOrb();
    if (expanded) dockDetails.scrollTop = dockDetails.scrollHeight;
    if (focusOrb) statusOrb.focus({ preventScroll: true });
  }

  function renderOrb() {
    const tasks = [readerState, pageState, card.classList.contains("anchored") ? null : selectionState].filter(Boolean);
    dock.hidden = !tasks.length;
    if (!tasks.length) {
      dockDetails.inert = true;
      dockDetails.setAttribute("aria-hidden", "true");
      statusOrb.setAttribute("aria-expanded", "false");
      return;
    }
    const current = tasks.find(task => task.state === "error") || tasks.find(task => task.state === "loading") || tasks[0];
    const descriptions = tasks.map(task => {
      const kind = task.kind === "reading" ? label("朗读", "Reading") : label("翻译", "Translation");
      const states = { loading: label("进行中", "in progress"), playing: label("播放中", "playing"), paused: label("已暂停", "paused"), done: label("已完成", "complete"), stopped: label("已停止", "stopped"), error: label("失败，点击查看", "failed; open for details") };
      return `${kind} · ${states[task.state]}${task.progress > 0 ? ` · ${Math.round(task.progress * 100)}%` : ""}`;
    });
    const busy = current.state === "loading" && !current.progress;
    statusOrb.dataset.state = current.state;
    statusOrb.dataset.busy = String(busy);
    statusOrb.dataset.symbol = ["error", "paused", "done"].includes(current.state) ? current.state : current.kind;
    statusOrb.classList.toggle("dark", darkMode());
    statusOrb.querySelector(".orb-progress").setAttribute("stroke-dashoffset", String(100 * (1 - (busy ? .25 : current.progress))));
    const action = dockDetails.inert ? label("点击展开", "Click to expand") : label("点击收起", "Click to collapse");
    statusOrb.title = [...descriptions, action].join("\n");
    statusOrb.setAttribute("aria-label", statusOrb.title.replaceAll("\n", "; "));
  }

  function localizeControls() {
    bubble.setAttribute("aria-label", label("选中文字操作", "Selected text actions"));
    bubbleHandle.title = label("按住拖动", "Drag to move");
    bubbleHandle.setAttribute("aria-label", `Prism · ${bubbleHandle.title}`);
    shadow.querySelector(".bubble-translate span").textContent = label("翻译", "Translate");
    shadow.querySelector(".bubble-read span").textContent = label("朗读", "Read aloud");
    for (const [selector, zh, en] of [[".bubble-translate", "翻译选中文字", "Translate selection"], [".bubble-read", "朗读选中文字", "Read selected text"]]) {
      const button = shadow.querySelector(selector);
      button.title = label(zh, en); button.setAttribute("aria-label", button.title);
    }
    shadow.querySelector(".copy").textContent = label("复制", "Copy");
    for (const [selector, zh, en] of [[".collapse", "收起到圆形按钮", "Collapse to circle"], [".dismiss", "关闭", "Close"], [".copy", "复制译文", "Copy translation"], [".speak", "朗读译文", "Read translation"], [".panel", "打开侧栏", "Open side panel"]]) {
      const node = shadow.querySelector(selector);
      node.title = label(zh, en);
      node.setAttribute("aria-label", node.title);
    }
    renderOrb();
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
    pageRequest++;
    readerFrame?.remove();
    readerFrame = null; readerSession = null; readerRequest = null;
    clearTimeout(hideTimer);
    clearTimeout(selectionTimer);
    endBubbleDrag();
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

  function showReconnect(text = lastSelection, rect = lastSelectionRect, reveal = true) {
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
    shadow.querySelector(".selection-status").textContent = "";
    shadow.querySelector(".tools").hidden = true;
    shadow.querySelector(".reload-page").textContent = chineseUi() ? "刷新当前网页" : "Refresh this page";
    recoveryNode.hidden = false;
    card.classList.toggle("dark", darkMode());
    card.style.display = "block";
    selectionState = { kind: "translation", state: "error", progress: 0 };
    if (reveal) showSelectionCard(rect);
    else positionSelectionCard();
    renderOrb();
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
    let rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    if (lastPointerAnchor && text === lastSelection
      && range.compareBoundaryPoints(Range.START_TO_START, lastPointerAnchor.range) === 0
      && range.compareBoundaryPoints(Range.END_TO_END, lastPointerAnchor.range) === 0) {
      const top = rect.top + lastPointerAnchor.y;
      rect = { left: rect.left + lastPointerAnchor.x, width: 0, top, bottom: top, pointer: true };
    }
    return { text, rect, range };
  }

  function place(element, rect, preferredBelow = true) {
    const width = element === bubble ? element.offsetWidth : Math.min(390, innerWidth - 24);
    const height = element.offsetHeight || 280;
    const left = Math.max(12, Math.min(innerWidth - width - 12, rect.left + rect.width / 2 - width / 2));
    let top = preferredBelow ? rect.bottom + 9 : rect.top - height - 9;
    if (top + height > innerHeight - 10) top = Math.max(10, rect.top - height - 9);
    element.style.left = `${left}px`;
    element.style.top = `${Math.max(10, Math.min(innerHeight - height - 10, top))}px`;
  }

  function endBubbleDrag() {
    const drag = bubbleDrag;
    bubbleDrag = null;
    bubble.classList.remove("dragging");
    if (drag && bubbleHandle.hasPointerCapture(drag.pointerId)) bubbleHandle.releasePointerCapture(drag.pointerId);
  }

  function hideBubble() { endBubbleDrag(); bubble.style.display = "none"; }
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
    const bounds = details.range.getBoundingClientRect();
    lastPointerAnchor = { range: details.range.cloneRange(), x: details.rect.left - bounds.left, y: details.rect.top - bounds.top };
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
        // Anchor at the drag endpoint, not the center of a potentially long,
        // multiline selection. Keep this point when the user clicks Translate.
        details.rect = { left: event.clientX, width: 0, top: event.clientY, bottom: event.clientY, pointer: true };
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
    clearTimeout(selectionTimer);
    hideBubble();
    if (card.classList.contains("anchored") || !dockDetails.inert) dismissSelection();
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

  async function localTranslate(texts, source, target, onProgress, isCurrent = () => true) {
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
      if (!isCurrent()) throw new DOMException("Translation stopped", "AbortError");
      output.push(await translator.translate(texts[index]));
      onProgress?.(`${label("正在翻译…", "Translating…")} ${index + 1}/${texts.length}`);
    }
    return output;
  }

  async function translateTexts(texts, onProgress, isCurrent = () => true) {
    assertConnected();
    const current = { ...settings };
    if (current.sourceLanguage === "auto") onProgress?.(label("正在识别原文语言…", "Detecting source language…"));
    const detected = current.sourceLanguage === "auto" ? await detectLanguage(texts.slice(0, 6).join(" ")) : current.sourceLanguage;
    if (!isCurrent()) throw new DOMException("Translation stopped", "AbortError");
    const source = detected === "und" ? "en" : detected;
    const target = smartTarget(source, current.targetLanguage);
    if (current.provider === "chrome") {
      return { translations: await localTranslate(texts, source, target, onProgress, isCurrent), source, target, provider: current.provider };
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
    selectionState = { kind: "translation", state: "loading", progress: 0 };
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
        pronunciationNode.querySelector("button").title = chinese ? "使用已设置的模型和音色，在小浮窗朗读原单词" : "Read the original word in the compact player with your selected model and voice";
        pronunciationNode.hidden = false;
        positionSelectionCard();
      }).catch((error) => { if (request === selectionRequest && contextLost(error)) showReconnect(text, rect, false); });
    }
    card.classList.toggle("dark", darkMode());
    sourceNode.textContent = text.length > 260 ? `${text.slice(0, 260)}…` : text;
    shadow.querySelector(".selection-status").textContent = label("翻译中", "Translating");
    resultNode.textContent = label("正在翻译…", "Translating…");
    resultNode.classList.add("loading");
    metaNode.textContent = "";
    providerNode.textContent = settings.provider === "chrome" ? "ON-DEVICE"
      : settings.provider === "codex" ? "OPENAI CLI"
      : settings.provider === "openai" ? `OPENAI ${(settings.openaiConnection || "api").toUpperCase()}`
      : settings.provider === "kimi" ? `KIMI ${(settings.kimiConnection || "cli").toUpperCase()}` : settings.provider.toUpperCase();
    showSelectionCard(rect);
    try {
      const result = await translateTexts([text], (label) => { if (request === selectionRequest) metaNode.textContent = label; });
      if (request !== selectionRequest) return;
      const translated = result.translations[0];
      shadow.querySelector(".selection-status").textContent = label("已完成", "Done");
      resultNode.textContent = translated;
      resultNode.classList.remove("loading");
      metaNode.textContent = `${result.source}  →  ${result.target}`;
      card.dataset.translation = translated;
      card.dataset.source = text;
      selectionState = { kind: "translation", state: "done", progress: 1 };
      renderOrb();
      positionSelectionCard();
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
      if (contextLost(error)) { showReconnect(text, rect, false); return; }
      shadow.querySelector(".selection-status").textContent = label("失败", "Failed");
      resultNode.textContent = error.message;
      resultNode.classList.remove("loading");
      metaNode.textContent = label("暂时无法翻译", "Translation unavailable");
      selectionState = { kind: "translation", state: "error", progress: 0 };
      renderOrb();
      positionSelectionCard();
    }
  }

  function listen(node, type, handler) { node.addEventListener(type, handler, { signal: listeners.signal }); }
  function closeReader() {
    readerSession = null; readerRequest = null;
    readerAttached = false; readerToggleRevision = 0; readerSelectionText = "";
    readerFrame?.remove(); readerFrame = null;
    readerState = null;
    renderOrb();
    CSS.highlights?.delete("prism-reading");
  }
  function openReader(text, wholePage = false) {
    if (!isAlive()) { showReconnect(text); return; }
    const request = collectReading(!wholePage);
    if (text && !wholePage && request.paragraphs?.[0]?.text !== text) {
      request.paragraphs = [{ text }]; request.snapshot = null;
    }
    if (!request.ok || !request.paragraphs?.some(p => p.text?.trim())) {
      showToast(request.error || label("请先选择文字。", "Select some text first.")); return;
    }
    closeReader();
    readerSession = crypto.randomUUID(); readerRequest = request;
    readerSelectionText = wholePage ? "" : request.paragraphs.map(p => p.text).join("");
    readerFrame = document.createElement("iframe");
    readerFrame.className = "reader-frame";
    readerFrame.title = label("Prism 朗读控制", "Prism reading controls");
    readerFrame.allow = "autoplay";
    readerFrame.src = runtime.getURL(`reader/reader.html?session=${readerSession}`);
    dockDetails.append(readerFrame);
    readerState = { kind: "reading", state: "loading", progress: 0 };
    collapseSelection();
    setDockExpanded(false);
  }
  function readSelectionOrPage() {
    const text = document.getSelection()?.toString().trim() || "";
    if (text.length > 240_000) {
      showToast(label("选区过长，请选择部分段落朗读。", "Selection too long. Select a smaller section.")); return;
    }
    hideBubble();
    if (readerSession && readerFrame?.isConnected && readerRequest?.url === location.href
      && readerState?.state !== "done" && (!text || text === readerSelectionText)) {
      const session = readerSession;
      const revision = ++readerToggleRevision;
      // A shortcut pressed before the iframe attaches is applied at startup.
      if (readerAttached) sendRuntimeMessage({ type: "PRISM_READER_CONTROL", session, revision })
        .then(response => { if (!response?.ok) throw new Error("Reading controls unavailable."); })
        .catch(() => { if (session === readerSession) showToast(label("请展开朗读窗口操作播放。", "Open the reader to control playback.")); });
      return;
    }
    openReader(text, !text);
  }
  // Keep the webpage selection intact while pressing either action.
  listen(bubble, "mousedown", event => event.preventDefault());
  listen(bubbleHandle, "pointerdown", event => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    clearTimeout(selectionTimer);
    const rect = bubble.getBoundingClientRect();
    bubbleHandle.setPointerCapture(event.pointerId);
    bubbleDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    bubble.classList.add("dragging");
  });
  listen(bubbleHandle, "pointermove", event => {
    if (!bubbleDrag || event.pointerId !== bubbleDrag.pointerId) return;
    event.preventDefault();
    const left = bubbleDrag.left + event.clientX - bubbleDrag.x;
    const top = bubbleDrag.top + event.clientY - bubbleDrag.y;
    bubble.style.left = `${Math.max(12, Math.min(innerWidth - bubble.offsetWidth - 12, left))}px`;
    bubble.style.top = `${Math.max(10, Math.min(innerHeight - bubble.offsetHeight - 10, top))}px`;
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    listen(bubbleHandle, type, event => {
      if (event.pointerId === bubbleDrag?.pointerId) endBubbleDrag();
    });
  }
  listen(window, "blur", endBubbleDrag);
  listen(shadow.querySelector(".bubble-translate"), "click", () => translateSelection(lastSelection, lastSelectionRect));
  listen(shadow.querySelector(".bubble-read"), "click", () => {
    const text = lastSelection;
    if (!text) return;
    hideBubble(); card.style.display = "none"; selectionRequest++; selectionState = null;
    openReader(text);
  });
  listen(statusOrb, "click", () => setDockExpanded(dockDetails.inert));
  listen(document, "keydown", event => {
    if (event.key !== "Escape") return;
    hideBubble();
    const focusOrb = card.contains(shadow.activeElement) || dockDetails.contains(shadow.activeElement);
    collapseSelection();
    setDockExpanded(false, focusOrb);
  });
  document.addEventListener("scroll", () => { hideBubble(); positionSelectionCard(); }, { capture: true, passive: true, signal: listeners.signal });
  listen(window, "resize", () => { hideBubble(); positionSelectionCard(); });
  listen(shadow.querySelector(".reload-page"), "click", () => location.reload());
  listen(shadow.querySelector(".speak-source"), "click", () => openReader(card.dataset.source));
  listen(shadow.querySelector(".dismiss"), "click", dismissSelection);
  listen(shadow.querySelector(".collapse"), "click", () => collapseSelection(true));
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

  const pageStatus = shadow.querySelector(".page-status");
  function showPageStatus(text, completed = 0, total = 1, state = pageTranslationPending ? "loading" : "done") {
    pageStatus.hidden = false; pageStatus.classList.toggle("dark", darkMode());
    pageStatus.querySelector(".page-label").textContent = text;
    pageStatus.querySelector("progress").value = completed / total;
    pageStatus.querySelector(".page-retry").hidden = true;
    pageStatus.querySelector(".page-retry").textContent = label("重试", "Retry");
    pageStatus.querySelector(".page-stop").hidden = !pageTranslationPending;
    pageStatus.querySelector(".page-stop").textContent = label("停止", "Stop");
    pageStatus.querySelector(".page-restore").hidden = !pageActive;
    pageStatus.querySelector(".page-restore").textContent = label("恢复原文", "Restore");
    pageState = { kind: "translation", state, progress: Math.max(0, Math.min(1, completed / total)) };
    renderOrb();
  }
  function stopPageTranslation() { pageRequest++; pageTranslationPending = false; }
  listen(pageStatus.querySelector(".page-stop"), "click", () => {
    stopPageTranslation(); showPageStatus(label("翻译已停止", "Translation stopped"), pageState?.progress || 0, 1, "stopped");
  });
  listen(pageStatus.querySelector(".page-retry"), "click", () => {
    stopPageTranslation(); restorePage(); translateCurrentPage();
  });
  listen(pageStatus.querySelector(".page-restore"), "click", () => {
    stopPageTranslation(); restorePage(); showPageStatus(label("已恢复原文", "Original restored"), 1);
  });
  listen(pageStatus.querySelector(".page-close"), "click", () => {
    stopPageTranslation(); pageStatus.hidden = true; pageState = null; renderOrb();
  });
  function translateSelectionOrPage() {
    const details = selectionDetails();
    if (details) {
      translateSelection(details.text, details.rect);
    } else if (document.getSelection()?.toString().trim()) {
      // An unsupported/oversized selection must not trigger a whole-page job.
      showToast(label("请缩短选区，选择可见的网页文字。", "Select a shorter passage of visible page text."));
    } else {
      hideBubble();
      dismissSelection();
      translateCurrentPage(false);
    }
  }

  async function translateCurrentPage(toggle = true) {
    if (disposed || !host.isConnected) return;
    if (!isAlive()) { showReconnect(); return; }
    if (pageTranslationPending) { showPageStatus(label("网页正在翻译…", "Translating page…")); return; }
    setDockExpanded(false);
    if (pageActive) {
      if (toggle) { restorePage(); showPageStatus(label("已恢复原文", "Original restored"), 1); }
      else showPageStatus(label("网页已翻译", "Page already translated"), 1);
      return;
    }
    const request = ++pageRequest;
    const snapshot = collectPage();
    if (!snapshot.items.length) {
      showPageStatus(label("没有找到可翻译的网页文字。", "No translatable text found.")); return;
    }
    pageTranslationPending = true;
    const current = () => request === pageRequest && !disposed && host.isConnected && pageSnapshotId === snapshot.snapshotId && pageSnapshotUrl === location.href;
    let applied = 0;
    showPageStatus(label("正在翻译网页…", "Translating page…"));
    try {
      // Small batches let Stop discard the in-flight result and prevent further
      // requests, while completed passages remain available until Restore.
      for (let index = 0; index < snapshot.items.length; index += 20) {
        if (!current()) return;
        const batch = snapshot.items.slice(index, index + 20);
        const result = await translateTexts(batch.map(({ text }) => text), text => {
          if (current()) showPageStatus(`${text} · ${index}/${snapshot.items.length}`, index, snapshot.items.length);
        }, current);
        if (!current()) return;
        const updated = applyPageBatch(batch.map((item, i) => ({ id: item.id, translation: result.translations[i] })), pageMode, snapshot.snapshotId);
        if (!updated.ok) throw new Error(label("网页内容已变化，请重新翻译。", "The page changed. Please translate again."));
        applied += updated.applied;
        showPageStatus(label(`已翻译 ${applied} 个片段`, `Translated ${applied} segments`), index + batch.length, snapshot.items.length);
      }
      if (!applied) throw new Error(label("网页内容已变化，请重新翻译。", "The page changed. Please translate again."));
    } catch (error) {
      if (!current()) return;
      if (contextLost(error)) { showReconnect(); return; }
      showPageStatus(error.message, pageState?.progress || 0, 1, "error");
      pageStatus.querySelector(".page-retry").hidden = false;
    } finally {
      if (request === pageRequest) {
        pageTranslationPending = false;
        pageStatus.querySelector(".page-stop").hidden = true;
        pageStatus.querySelector(".page-restore").hidden = !pageActive;
        if (pageState?.state === "loading") pageState.state = "done";
        renderOrb();
      }
    }
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
    if (message?.readerSession) {
      if (message.readerSession !== readerSession) {
        sendResponse({ ok: false, error: "Reading page changed." }); return false;
      }
      if (readerRequest?.url !== location.href) {
        closeReader(); sendResponse({ ok: false, error: "Reading page changed." }); return false;
      }
      if (message.type === "PRISM_READER_ATTACH") {
        readerAttached = true;
        sendResponse({ ...readerRequest, toggleRevision: readerToggleRevision }); return false;
      }
      if (message.type === "PRISM_READER_ALIVE") { sendResponse({ ok: true }); return false; }
      if (message.type === "PRISM_READER_LAYOUT") {
        readerFrame.style.height = `${Math.max(70, Math.min(300, Number(message.height) || 142))}px`;
        sendResponse({ ok: true }); return false;
      }
      if (message.type === "PRISM_READER_STATE") {
        if (!["loading", "playing", "paused", "idle", "error"].includes(message.state) || !Number.isFinite(message.progress)) {
          sendResponse({ ok: false, error: "Invalid reading state." }); return false;
        }
        readerState = { kind: "reading", state: message.state === "idle" ? "done" : message.state, progress: Math.max(0, Math.min(1, message.progress)) };
        renderOrb(); sendResponse({ ok: true }); return false;
      }
      if (message.type === "PRISM_READER_COLLAPSE") { setDockExpanded(false, true); sendResponse({ ok: true }); return false; }
      if (message.type === "PRISM_READER_CLOSE") { closeReader(); sendResponse({ ok: true }); return false; }
    }
    if (message?.type === "PRISM_START_READING") {
      openReader(message.action?.text, message.action?.type === "read-page");
      sendResponse({ ok: true }); return false;
    }
    if (message?.type === "PRISM_READ") {
      readSelectionOrPage(); sendResponse({ ok: true }); return false;
    }
    if (message?.type === "PRISM_READING_COLLECT") { sendResponse(collectReading(message.selection)); return false; }
    if (message?.type === "PRISM_READING_HIGHLIGHT") { highlightReading(message); sendResponse({ ok: true }); return false; }
    if (message?.type === "PRISM_TRANSLATE_SELECTION") {
      const details = selectionDetails();
      translateSelection(message.text || details?.text || lastSelection, details?.rect);
      sendResponse({ ok: true, hasSelection: Boolean(details?.text || lastSelection) });
      return false;
    }
    if (message?.type === "PRISM_TRANSLATE") {
      translateSelectionOrPage();
      sendResponse({ ok: true });
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
      stopPageTranslation();
      restorePage();
      if (pageState) showPageStatus(label("已恢复原文", "Original restored"), 1);
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
