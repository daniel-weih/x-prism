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

const cases = [
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
