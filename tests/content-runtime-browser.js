const MARKER = "__prismTranslateContentRuntimeV1";
// Keep language detection deterministic; exercise the injected i18n API instead
// of downloading or invoking Chrome's own LanguageDetector model in this fixture.
Object.defineProperty(window, "LanguageDetector", { value: undefined, configurable: true });
const $ = (selector) => document.querySelector(selector);
const view = (selector) => $("#prism-translate-host")?.shadowRoot.querySelector(selector);
const check = (condition, message) => { if (!condition) throw new Error(message); };
const waitFor = async (condition) => {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("等待测试状态超时");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};
const eventHook = () => {
  const listeners = new Set();
  return { listeners, addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn),
    emit: (...args) => { for (const fn of listeners) fn(...args); } };
};
let mock;
const uncaught = [];
window.addEventListener("unhandledrejection", (event) => uncaught.push(String(event.reason)));
window.addEventListener("error", (event) => uncaught.push(event.message));

function createChrome({ send, detect, settings = {} } = {}) {
  return {
    runtime: {
      id: "prism-test-only", onMessage: eventHook(),
      sendMessage(message) {
        if (send) { const result = send(message); if (result !== undefined) return result; }
        if (message.type === "PRISM_PRONUNCIATION") return Promise.resolve({ ok: true, pronunciation: { label: "US", ipa: "/həˈloʊ/" } });
        return Promise.resolve({ ok: true, translations: ["你好"] });
      }
    },
    storage: { onChanged: eventHook(), sync: { async get() {
      return { prismSettings: { provider: "codex", sourceLanguage: "en", targetLanguage: "zh", uiLanguage: "zh", saveHistory: true, ...settings } };
    } } },
    i18n: { getUILanguage: () => "zh-CN", detectLanguage: detect || ((_text, callback) => callback({ languages: [{ language: "en" }] })) }
  };
}

async function inject(next = createChrome()) {
  mock = next;
  window.chrome = next;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "../content/content.js";
    script.onload = () => { script.remove(); resolve(); };
    script.onerror = reject;
    document.head.append(script);
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function fresh(options) {
  window[MARKER]?.dispose?.();
  delete window[MARKER];
  await inject(createChrome(options));
}

function translate() {
  const range = document.createRange();
  range.selectNodeContents($("#word"));
  const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  mock.runtime.onMessage.emit({ type: "PRISM_TRANSLATE_SELECTION" }, {}, () => {});
}

async function expectTranslation() {
  translate();
  await waitFor(() => view(".result")?.textContent === "你好");
  check(view(".recovery").hidden, "正常翻译不应显示刷新按钮");
}

async function expectRecovery() {
  translate();
  await waitFor(() => view(".recovery")?.hidden === false);
  check(view(".result").textContent.includes("刷新当前网页"), "应显示可操作的中文恢复提示");
  check(!view(".result").textContent.includes("Extension context"), "不得展示原始异常");
  check(view(".source").textContent === "hello", "原选词应保留");
}

function contentMessage(message) {
  let response;
  mock.runtime.onMessage.emit(message, {}, value => { response = value; });
  return response;
}

async function showSelectionMenu(node = $("#word")) {
  const range = document.createRange(); range.selectNodeContents(node);
  const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  await waitFor(() => view(".bubble")?.style.display === "flex");
}

const cases = [
  ["单词发音使用共享朗读链路，仅发送当前原词并显示打开失败", async () => {
    const messages = [];
    let fail = false;
    await fresh({ send(message) {
      if (message.type === "PRISM_OPEN_PANEL") {
        messages.push(message);
        return Promise.resolve(fail ? { ok: false, error: "Reader unavailable" } : { ok: true });
      }
    } });
    await expectTranslation();
    await waitFor(() => !view(".pronunciation").hidden);
    view(".speak-source").click();
    check(messages[0]?.action.text === "hello" && messages[0]?.action.type === "read-selection", "必须朗读原词，不能朗读音标或译文");
    fail = true;
    view(".speak-source").click();
    await waitFor(() => view(".toast").textContent === "Reader unavailable");
  }],
  ["划词菜单可直接朗读选中文字，保持选区且不触发翻译", async () => {
    const messages = [];
    await fresh({ send(message) { messages.push(message); if (message.type === "PRISM_OPEN_PANEL") return Promise.resolve({ ok: true }); } });
    await showSelectionMenu();
    check(view(".bubble").getAttribute("role") === "toolbar", "应为带独立按钮的工具栏");
    check(view(".bubble-translate").textContent.trim() === "翻译" && view(".bubble-read").textContent.trim() === "朗读", "显示翻译和朗读");
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    view(".bubble-read").dispatchEvent(down);check(down.defaultPrevented, "按下按钮应保留网页选区");
    view(".bubble-read svg").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitFor(() => messages.some(m => m.type === "PRISM_OPEN_PANEL"));
    const action = messages.find(m => m.type === "PRISM_OPEN_PANEL").action;
    check(action.type === "read-selection" && action.text === "hello", "应发送选中原文而非译文");
    check(!messages.some(m => m.type === "PRISM_REMOTE_TRANSLATE"), "朗读不应先翻译");
    check(getSelection().toString() === "hello" && view(".bubble").style.display === "none", "点击后保留选区并收起菜单");
  }],
  ["划词菜单翻译仍可用，朗读打开失败有可见提示", async () => {
    await fresh();await showSelectionMenu();view(".bubble-translate").click();
    await waitFor(() => view(".result").textContent === "你好");
    await fresh({send(message){if(message.type === "PRISM_OPEN_PANEL")return Promise.resolve({ok:false,error:"Panel unavailable"});}});
    await showSelectionMenu();view(".bubble-read").click();
    await waitFor(() => view(".toast").textContent === "Panel unavailable");
  }],
  ["英文划词菜单在屏幕右下角不越界，Escape 可关闭", async () => {
    await fresh({settings:{uiLanguage:"en"}});
    const edge=document.createElement("p");edge.textContent="Selected text";edge.style.cssText="position:fixed;right:0;bottom:0;width:100px;margin:0;background:white";document.body.append(edge);
    try {
      await showSelectionMenu(edge);
      check(view(".bubble-read").textContent.trim()==="Read aloud", "朗读按钮应随界面语言切换");
      const box=view(".bubble").getBoundingClientRect();
      check(box.left>=0 && box.right<=innerWidth && box.top>=0 && box.bottom<=innerHeight,"浮窗应按实际宽度限制在视口内");
      document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
      check(view(".bubble").style.display==="none","Escape 应收起浮窗");
    } finally {edge.remove();}
  }],
  ["正文朗读保留长段落与内联文字，过滤隐藏内容，并可高亮", async () => {
    await fresh();
    const article = document.createElement("article");
    article.innerHTML = '<h1>Reader title</h1><nav>Navigation noise</nav><p>Hello <b>world</b>!</p><p hidden>Hidden noise</p><p>2026</p><div class="prism-page-translation">Duplicate translation</div><footer>Footer noise</footer>';
    const long = document.createElement("p"); long.textContent = "长".repeat(2400); article.append(long); document.body.append(article);
    try {
      const r = contentMessage({ type: "PRISM_READING_COLLECT" });
      check(r.ok && r.paragraphs.some(p=>p.text==='Hello world!'), "内联节点应合并为完整段落");
      check(r.paragraphs.some(p=>p.text==='2026') && r.paragraphs.some(p=>p.text.length===2400), "数字和长段落不能遗漏");
      check(!r.paragraphs.some(p=>/noise|Duplicate/.test(p.text)), "必须过滤导航、页脚、隐藏和重复译文");
      contentMessage({type:"PRISM_READING_HIGHLIGHT",snapshot:r.snapshot,id:1});
      check(CSS.highlights.has("prism-reading"), "当前段落应高亮");
      contentMessage({type:"PRISM_READING_HIGHLIGHT",snapshot:r.snapshot,ids:[0,1,1]});
      check(CSS.highlights.get("prism-reading").size === 2, "合并片段应高亮所有原段落并去重");
      contentMessage({type:"PRISM_READING_HIGHLIGHT",snapshot:r.snapshot,ids:[]});
      check(!CSS.highlights.has("prism-reading"), "停止合并片段应清除整组高亮");
      contentMessage({type:"PRISM_READING_HIGHLIGHT",snapshot:r.snapshot,id:null});
      check(!CSS.highlights.has("prism-reading"), "停止后移除高亮");
    } finally { article.remove(); }
  }],
  ["朗读选择范围且不修改网页；替换模式读取保存的原文", async () => {
    await fresh();
    const article=document.createElement("article");article.innerHTML='<p>Original reader paragraph.</p>';document.body.append(article);
    try {
      const range=document.createRange();range.selectNodeContents(article.firstChild);getSelection().removeAllRanges();getSelection().addRange(range);
      const selected=contentMessage({type:"PRISM_READING_COLLECT",selection:true});
      check(selected.paragraphs[0].text==='Original reader paragraph.', "应读取选区");getSelection().removeAllRanges();
      const snapshot=contentMessage({type:"PRISM_COLLECT_PAGE"});const item=snapshot.items.find(i=>i.text==='Original reader paragraph.');
      contentMessage({type:"PRISM_APPLY_PAGE_BATCH",snapshotId:snapshot.snapshotId,mode:"translated",items:[{id:item.id,translation:"替换译文"}]});
      const read=contentMessage({type:"PRISM_READING_COLLECT"});
      check(read.paragraphs[0].text==='Original reader paragraph.' && article.textContent==='替换译文',"整篇朗读应读取原文且不恢复或修改页面");
    } finally {contentMessage({type:"PRISM_RESTORE_PAGE"});article.remove();}
  }],
  ["正常翻译与离线音标仍可显示", async () => {
    await fresh(); await expectTranslation();
    await waitFor(() => view(".pronunciation").textContent.includes("/həˈloʊ/"));
  }],
  ["点击前上下文失效：显示刷新提示", async () => {
    await fresh(); mock.runtime.id = undefined; await expectRecovery();
  }],
  ["音标 API 同步抛异常：不会遗漏到 Promise 外", async () => {
    await fresh({ send(message) { if (message.type === "PRISM_PRONUNCIATION") throw new Error("Extension context invalidated."); } });
    await expectRecovery();
  }],
  ["翻译 API 异步拒绝：显示刷新提示", async () => {
    await fresh({ send(message) { if (message.type === "PRISM_REMOTE_TRANSLATE") return Promise.reject(new Error("Extension context invalidated.")); } });
    await expectRecovery();
  }],
  ["语言检测同步抛异常：显示刷新提示", async () => {
    await fresh({ settings: { sourceLanguage: "auto" }, detect() { throw new Error("Extension context invalidated."); } });
    await expectRecovery();
  }],
  ["保存历史失败：已显示的译文不被覆盖", async () => {
    await fresh({ send(message) { if (message.type === "PRISM_ADD_HISTORY") return Promise.reject(new Error("storage unavailable")); } });
    await expectTranslation();
    await waitFor(() => view(".toast").textContent.includes("未能保存历史"));
    check(view(".result").textContent === "你好", "历史保存失败不得覆盖译文");
  }],
  ["一般服务错误：保留原错误，不误报插件更新", async () => {
    await fresh({ send(message) { if (message.type === "PRISM_REMOTE_TRANSLATE") return Promise.reject(new Error("Translation service unavailable")); } });
    translate(); await waitFor(() => view(".result").textContent === "Translation service unavailable");
    check(view(".recovery").hidden, "服务错误不应要求刷新");
  }],
  ["失效后重新注入：清理旧监听器并恢复翻译", async () => {
    await fresh(); const old = mock; const oldHost = $("#prism-translate-host");
    old.runtime.id = undefined; await inject();
    check(!oldHost.isConnected, "旧浮窗应移除");
    check(old.runtime.onMessage.listeners.size === 0 && old.storage.onChanged.listeners.size === 0, "旧监听器应移除");
    const host = $("#prism-translate-host"); await inject(mock);
    check(host === $("#prism-translate-host") && mock.runtime.onMessage.listeners.size === 1, "健康实例应复用");
    await expectTranslation();
  }],
  ["兼容旧版布尔标记：不会阻挡新版注入", async () => {
    window[MARKER]?.dispose?.(); window[MARKER] = true;
    await inject(); await expectTranslation();
  }],
  ["替换实例时，旧请求的迟到结果不能改写新浮窗", async () => {
    let finish;
    await fresh({ send(message) { if (message.type === "PRISM_REMOTE_TRANSLATE") return new Promise((resolve) => { finish = resolve; }); } });
    translate(); await waitFor(() => finish);
    mock.runtime.id = undefined; await inject(); await expectTranslation();
    finish({ ok: true, translations: ["旧请求结果"] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    check(view(".result").textContent === "你好", "旧请求应被废弃");
  }],
  ["历史保存返回失败：保留译文并提示", async () => {
    await fresh({ send(message) { if (message.type === "PRISM_ADD_HISTORY") return Promise.resolve({ ok: false, error: "quota exceeded" }); } });
    await expectTranslation();
    await waitFor(() => view(".toast").textContent.includes("未能保存历史"));
    check(view(".result").textContent === "你好", "保存历史不能覆盖译文");
  }],
  ["网页收集跳过隐藏祖先、导航及可编辑区域", async () => {
    await fresh();
    const fixture = document.createElement("div");
    fixture.innerHTML = `<p>Visible sample text</p><nav>Private navigation marker</nav><div style="display:none"><span>Hidden ancestor marker</span></div><div style="opacity:0"><span>Transparent ancestor marker</span></div><div aria-hidden="true">Aria hidden marker</div><div contenteditable="plaintext-only">Editable marker</div>`;
    document.body.append(fixture);
    const texts = contentMessage({ type: "PRISM_COLLECT_PAGE" }).items.map(item => item.text);
    check(texts.includes("Visible sample text"), "应收集可见正文");
    check(!texts.some(text => /marker/.test(text)), "不得收集隐藏、导航或可编辑文字");
    fixture.remove();
  }],
  ["过期网页快照不能覆盖新一轮采集", async () => {
    await fresh();
    const old = contentMessage({ type: "PRISM_COLLECT_PAGE" });
    const current = contentMessage({ type: "PRISM_COLLECT_PAGE" });
    check(old.snapshotId !== current.snapshotId, "每次采集必须拥有独立标识");
    const result = contentMessage({ type: "PRISM_APPLY_PAGE_BATCH", snapshotId: old.snapshotId, items: old.items.map(item => ({ id: item.id, translation: "旧译文" })) });
    check(result.ok === false && result.code === "PAGE_CHANGED", "过期译文必须被拒绝");
  }],
  ["动态网页变化后拒绝旧译文，恢复操作保留新内容", async () => {
    await fresh();
    const fixture = document.createElement("p"); fixture.textContent = "Original dynamic text"; document.body.append(fixture);
    let snapshot = contentMessage({ type: "PRISM_COLLECT_PAGE" });
    let item = snapshot.items.find(item => item.text === "Original dynamic text");
    fixture.firstChild.nodeValue = "Updated dynamic text";
    let result = contentMessage({ type: "PRISM_APPLY_PAGE_BATCH", snapshotId: snapshot.snapshotId, mode: "translated", items: [{ id: item.id, translation: "旧译文" }] });
    check(result.applied === 0 && result.skipped === 1 && fixture.textContent === "Updated dynamic text", "页面变化后不能写回旧译文");
    snapshot = contentMessage({ type: "PRISM_COLLECT_PAGE" });
    item = snapshot.items.find(item => item.text === "Updated dynamic text");
    result = contentMessage({ type: "PRISM_APPLY_PAGE_BATCH", snapshotId: snapshot.snapshotId, mode: "translated", items: [{ id: item.id, translation: "新译文" }] });
    check(result.ok && fixture.textContent === "新译文", "新快照应可翻译");
    fixture.firstChild.nodeValue = "Site updated again";
    contentMessage({ type: "PRISM_RESTORE_PAGE" });
    check(fixture.textContent === "Site updated again", "恢复不能覆盖网站的新内容");
    const stable = document.createElement("p"); stable.textContent = "Stable paragraph"; document.body.append(stable);
    snapshot = contentMessage({ type: "PRISM_COLLECT_PAGE" });
    const selected = snapshot.items.filter(item => ["Site updated again", "Stable paragraph"].includes(item.text));
    fixture.firstChild.nodeValue = "New site text";
    result = contentMessage({ type: "PRISM_APPLY_PAGE_BATCH", snapshotId: snapshot.snapshotId, mode: "translated", items: selected.map(item => ({ id: item.id, translation: "有效译文" })) });
    check(result.applied === 1 && result.skipped === 1 && stable.textContent === "有效译文" && fixture.textContent === "New site text", "局部变化不能阻断其他有效片段");
    contentMessage({ type: "PRISM_RESTORE_PAGE" });
    stable.remove();
    fixture.remove();
  }],
  ["本地模型初始化失败后可重试，已安装模型不显示下载", async () => {
    let attempts = 0;
    Object.defineProperty(window, "Translator", { configurable: true, value: {
      availability: async () => "available",
      create: async options => {
        check(!options.monitor, "已安装模型不应显示下载");
        if (++attempts === 1) throw new Error("Transient model failure");
        return { translate: async () => "你好", destroy() {} };
      }
    } });
    try {
      await fresh({ settings: { provider: "chrome" } });
      translate(); await waitFor(() => view(".result").textContent === "Transient model failure");
      await expectTranslation();
      check(attempts === 2, "失败的初始化不能永久留在缓存中");
    } finally { delete window.Translator; }
  }]
];

$("#run").onclick = async () => {
  $("#run").disabled = true; $("#results").replaceChildren(); uncaught.length = 0;
  let passed = 0;
  try {
    for (const [name, run] of cases) {
      $("#status").textContent = name;
      await run();
      const row = document.createElement("li"); row.textContent = `通过：${name}`; $("#results").append(row); passed++;
    }
    check(uncaught.length === 0, `未捕获异常：${uncaught.join("; ")}`);
    window[MARKER]?.dispose?.();
    $("#status").textContent = `${passed}/${cases.length} 通过 · 未捕获异常 0`;
  } catch (error) { $("#status").textContent = `失败：${error.message}（已通过 ${passed} 项）`; }
  finally { $("#run").disabled = false; }
};
$("#normal").onclick = async () => { await fresh(); translate(); };
$("#invalidate").onclick = async () => { await fresh(); mock.runtime.id = undefined; translate(); };
$("#reinject").onclick = async () => { if (mock) mock.runtime.id = undefined; await inject(); translate(); };
