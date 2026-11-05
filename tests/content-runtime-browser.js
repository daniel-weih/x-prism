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
      id: "prism-test-only", getURL: path => `about:blank?${path.split("?")[1] || ""}`, onMessage: eventHook(),
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

async function showSelectionMenu(node = $("#word"), pointer) {
  const range = document.createRange(); range.selectNodeContents(node);
  const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  if (pointer?.reverse) selection.setBaseAndExtent(node.firstChild, node.firstChild.length, node.firstChild, 0);
  const rect = range.getBoundingClientRect();
  node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: pointer?.x ?? rect.right, clientY: pointer?.y ?? rect.bottom }));
  await waitFor(() => view(".bubble")?.style.display === "flex");
}

const cases = [
  ["朗读命令使用当前选区，重复按键控制同一会话，新选区重启朗读", async () => {
    const controls = [];
    await fresh({ send(message) {
      if (message.type === "PRISM_READER_CONTROL") { controls.push(message); return Promise.resolve({ ok: true }); }
    } });
    const session = () => new URL(view(".reader-frame").src).searchParams.get("session");
    const attach = () => contentMessage({ type: "PRISM_READER_ATTACH", readerSession: session() });
    await showSelectionMenu();
    contentMessage({ type: "PRISM_READ" });
    const first = session();
    contentMessage({ type: "PRISM_READ" });
    const request = attach();
    check(request.paragraphs[0].text === "hello" && request.toggleRevision === 1, "初始化前的重复按键应排队暂停，保留选区");
    getSelection().removeAllRanges();
    contentMessage({ type: "PRISM_READ" });
    check(session() === first && controls.at(-1)?.revision === 2, "清空选区后再次按键应继续同一会话");
    const passage = document.createElement("p"); passage.textContent = "A different selection to read."; document.body.append(passage);
    try {
      await showSelectionMenu(passage); contentMessage({ type: "PRISM_READ" });
      check(session() !== first && attach().paragraphs[0].text === passage.textContent, "新选区应启动新的朗读");
      contentMessage({ type: "PRISM_READER_STATE", readerSession: session(), state: "idle", progress: 1 });
      getSelection().removeAllRanges(); contentMessage({ type: "PRISM_READ" });
      const wholePage = attach();
      check(wholePage.snapshot && wholePage.paragraphs.some(p => p.text !== passage.textContent), "朗读完成后无选区应读取整页，不能复用旧选区");
    } finally { passage.remove(); getSelection().removeAllRanges(); }
  }],
  ["翻译命令处理当前选区，清空选区后翻译网页且不复用旧选词", async () => {
    const calls = [];
    await fresh({ send(message) {
      if (message.type === "PRISM_REMOTE_TRANSLATE") {
        calls.push(message.texts);
        return Promise.resolve({ ok: true, translations: message.texts.map(text => `译文：${text}`) });
      }
    } });
    const press = () => contentMessage({ type: "PRISM_TRANSLATE" });
    try {
      await showSelectionMenu(); press();
      await waitFor(() => view(".result").textContent === "译文：hello");
      check(calls.length === 1 && calls[0].join() === "hello" && !document.querySelector(".prism-page-translation"), "有选区时只能翻译当前选中的文字");
      getSelection().removeAllRanges(); calls.length = 0; press();
      await waitFor(() => !view(".page-restore").hidden && view(".page-stop").hidden);
      check(calls.flat().some(text => text !== "hello") && view(".card").style.display === "none", "无选区应翻译网页并关闭旧的划词窗口");
      const count = calls.length;
      press();
      check(calls.length === count && Boolean(document.querySelector(".prism-page-translation")), "再次按翻译快捷键不应重复请求或恢复原文");
    } finally {
      contentMessage({ type: "PRISM_RESTORE_PAGE" });
    }
  }],
  ["旧 Option+Command+T 不再触发翻译或拦截按键", async () => {
    let calls = 0;
    await fresh({ send(message) { if (message.type === "PRISM_REMOTE_TRANSLATE") calls++; } });
    await showSelectionMenu();
    const event = new KeyboardEvent("keydown", { code: "KeyT", key: "†", altKey: true, metaKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    check(!event.defaultPrevented && calls === 0, "旧快捷键不能触发翻译或吞掉按键");
  }],
  ["浏览器翻译命令遵循当前选区，过长选区不会误触整页翻译", async () => {
    const calls = [];
    await fresh({ send(message) {
      if (message.type === "PRISM_REMOTE_TRANSLATE") { calls.push(message.texts); return Promise.resolve({ ok: true, translations: message.texts.map(() => "你好") }); }
    } });
    await showSelectionMenu(); contentMessage({ type: "PRISM_TRANSLATE" });
    await waitFor(() => view(".result").textContent === "你好");
    check(calls.length === 1 && calls[0].join() === "hello", "浏览器命令应翻译选区");
    const long = document.createElement("p"); long.textContent = "word ".repeat(2500); document.body.append(long);
    try {
      const range = document.createRange(); range.selectNodeContents(long); getSelection().removeAllRanges(); getSelection().addRange(range);
      contentMessage({ type: "PRISM_TRANSLATE" });
      check(calls.length === 1 && !document.querySelector(".prism-page-translation"), "超过限制的选区不能退化为网页翻译");
    } finally { long.remove(); getSelection().removeAllRanges(); }
    contentMessage({ type: "PRISM_TRANSLATE" });
    await waitFor(() => !view(".page-restore").hidden && view(".page-stop").hidden);
    check(calls.length > 1, "浏览器命令无选区时应翻译网页");
    contentMessage({ type: "PRISM_RESTORE_PAGE" });
  }],
  ["跨多行划词时，菜单和译文靠近鼠标松开位置，正反向选择均不越界", async () => {
    const passage = document.createElement("p");
    passage.textContent = "Select this multiline passage to translate it near the mouse. ".repeat(30);
    passage.style.cssText = "position:fixed;left:24px;top:40px;width:min(900px,calc(100vw - 48px));height:300px;overflow:hidden;background:white;margin:0";
    document.body.append(passage);
    try {
      for (const reverse of [false, true]) {
        await fresh();
        const box = passage.getBoundingClientRect();
        const pointer = reverse ? { x: box.left + 5, y: box.top + 10, reverse: true } : { x: box.right - 5, y: box.bottom - 10 };
        await showSelectionMenu(passage, pointer);
        const menu = view(".bubble").getBoundingClientRect();
        check(menu.left <= pointer.x + 12 && menu.right >= pointer.x - 12 && Math.abs(menu.top - pointer.y - 9) < 2, "菜单必须紧邻松开鼠标的位置，而不是整段选区的中心");
        view(".bubble-translate").click(); await waitFor(() => view(".result").textContent === "你好");
        const card = view(".card").getBoundingClientRect();
        check(card.left <= pointer.x + 12 && card.right >= pointer.x - 12 && Math.abs(card.top - pointer.y - 9) < 2, "译文必须沿用鼠标锚点");
        check(card.left >= 0 && card.right <= innerWidth && card.bottom <= innerHeight, "鼠标靠近边缘时也必须保持可见");
        contentMessage({ type: "PRISM_TRANSLATE_SELECTION" });
        await waitFor(() => !view(".result").classList.contains("loading"));
        const shortcutCard = view(".card").getBoundingClientRect();
        check(Math.abs(shortcutCard.left - card.left) < 1 && Math.abs(shortcutCard.top - card.top) < 1, "快捷键翻译同一选区也应沿用鼠标锚点");
      }
    } finally { passage.remove(); }
  }],
  ["单词发音在圆形按钮中启动，只朗读原词，不展开侧栏", async () => {
    const messages = [];
    await fresh({ send(message) { messages.push(message); } });
    await expectTranslation(); await waitFor(() => !view(".pronunciation").hidden);
    view(".speak-source").click();
    const frame = view(".reader-frame");
    check(frame && frame.allow === "autoplay", "应创建独立朗读框架");
    const session = new URL(frame.src).searchParams.get("session");
    const request = contentMessage({ type: "PRISM_READER_ATTACH", readerSession: session });
    check(request.paragraphs[0].text === "hello", "只朗读原词，不朗读音标或译文");
    check(!messages.some(m => m.type === "PRISM_OPEN_PANEL"), "不能自动打开侧栏");
    check(view(".dock-details").inert && !view(".dock").hidden, "朗读默认只显示圆形按钮");
    view(".status-orb").click();
    const box = frame.getBoundingClientRect();
    check(box.right <= innerWidth && box.left >= 0 && box.bottom <= innerHeight, "播放器应在视口内");
  }],
  ["划词朗读保留选区，新任务和关闭会拒绝旧播放器的迟到消息", async () => {
    const messages = []; await fresh({ send(message) { messages.push(message); } });
    await showSelectionMenu();
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    view(".bubble-read").dispatchEvent(down); check(down.defaultPrevented, "按下按钮应保留选区");
    view(".bubble-read").click();
    const first = new URL(view(".reader-frame").src).searchParams.get("session");
    check(getSelection().toString() === "hello", "保留网页选区");
    check(!messages.some(m => ["PRISM_REMOTE_TRANSLATE", "PRISM_OPEN_PANEL"].includes(m.type)), "朗读不先翻译或展开侧栏");
    contentMessage({ type: "PRISM_START_READING", action: { type: "read-selection", text: "New passage." } });
    const second = new URL(view(".reader-frame").src).searchParams.get("session");
    check(first !== second && !contentMessage({ type: "PRISM_READER_CLOSE", readerSession: first }).ok, "旧任务不能关闭新浮窗");
    check(!contentMessage({ type: "PRISM_READER_STATE", readerSession: first, state: "error", progress: 0 }).ok, "旧任务不能覆盖新圆环状态");
    check(view(".status-orb").dataset.state === "loading", "新朗读状态不能被旧任务改写");
    check(contentMessage({ type: "PRISM_READER_ATTACH", readerSession: second }).paragraphs[0].text === "New passage.", "新任务读取正确文本");
    contentMessage({ type: "PRISM_READER_CLOSE", readerSession: second });
    check(!view(".reader-frame") && !contentMessage({ type: "PRISM_READER_ALIVE", readerSession: second }).ok, "关闭后不接受旧消息");
    check(view(".dock").hidden, "关闭最后一个任务后圆形按钮消失");
  }],
  ["收起与展开保留朗读会话，圆环跟随播放、暂停和错误状态", async () => {
    await fresh(); contentMessage({ type: "PRISM_START_READING", action: { type: "read-selection", text: "A sample passage." } });
    const frame = view(".reader-frame");
    const session = new URL(frame.src).searchParams.get("session");
    contentMessage({ type: "PRISM_READER_STATE", readerSession: session, state: "playing", progress: .25 });
    check(view(".status-orb").dataset.symbol === "reading" && view(".orb-progress").getAttribute("stroke-dashoffset") === "75", "圆环应显示当前朗读进度");
    view(".status-orb").click();
    check(!view(".dock-details").inert, "点击圆形按钮可展开播放控件");
    contentMessage({ type: "PRISM_READER_COLLAPSE", readerSession: session });
    check(view(".dock-details").inert && view(".reader-frame") === frame && frame.isConnected, "收起不能卸载或替换播放器");
    contentMessage({ type: "PRISM_READER_STATE", readerSession: session, state: "paused", progress: .25 });
    check(view(".status-orb").dataset.symbol === "paused" && view(".dock-details").inert, "暂停状态更新不得自动展开");
    contentMessage({ type: "PRISM_READER_STATE", readerSession: session, state: "error", progress: .25 });
    check(view(".status-orb").dataset.symbol === "error", "失败时圆形按钮应提示错误");
    check(!contentMessage({ type: "PRISM_READER_STATE", readerSession: session, state: "playing", progress: NaN }).ok, "无效进度不得破坏圆环");
    view(".status-orb").click();
    check(view(".reader-frame") === frame && contentMessage({ type: "PRISM_READER_ALIVE", readerSession: session }).ok, "展开应复用同一朗读会话");
  }],
  ["同页导航会停止并移除旧朗读浮窗", async () => {
    await fresh(); contentMessage({ type: "PRISM_START_READING", action: { type: "read-selection", text: "A sample passage." } });
    const session = new URL(view(".reader-frame").src).searchParams.get("session");
    const previous = location.href;
    try {
      history.pushState({}, "", "#another-article");
      check(!contentMessage({ type: "PRISM_READER_ALIVE", readerSession: session }).ok, "导航后旧朗读会话必须失效");
      check(!view(".reader-frame"), "导航后移除播放器");
    } finally { history.replaceState({}, "", previous); }
  }],
  ["划词译文直接显示在选区旁，主动收起后才进入圆形按钮", async () => {
    await fresh(); await expectTranslation();
    const selection = getSelection().getRangeAt(0).getBoundingClientRect();
    const card = view(".card").getBoundingClientRect();
    check(getComputedStyle(view(".card")).visibility === "visible" && !view(".card").closest("[inert]"), "无需点击圆形按钮即可看到译文");
    check(Math.abs(card.top - selection.bottom - 9) < 2 && card.left <= selection.right && card.right >= selection.left, "译文应靠近选区");
    check(view(".dock").hidden, "显示划词译文时不再额外显示完成对勾");
    view(".result").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
    check(view(".card").style.display === "block", "点击译文内部不能关闭浮窗");
    view(".collapse").click(); check(view(".dock-details").inert && view(".status-orb") === view(".status-orb").getRootNode().activeElement, "收起返回圆形按钮并移交焦点");
    const box = view(".status-orb").getBoundingClientRect();
    check(box.width === box.height && box.width <= 56, "收起后应只占一个小圆");
    check(Math.abs(innerWidth - box.right - 16) < 2 && Math.abs(innerHeight - box.bottom - 16) < 2, "圆形按钮应停靠右下角");
    view(".status-orb").click(); check(view(".result").textContent === "你好", "展开后译文保留");
    await expectTranslation();
    check(view(".dock").hidden && !view(".card").closest("[inert]"), "新的划词翻译仍应直接展示");
    view(".dismiss").click(); check(view(".dock").hidden, "关闭最后一条译文后隐藏按钮");
  }],
  ["译文和音标变高时保持原来的展开方向，长内容可滚动", async () => {
    let finish, pronounce;
    await fresh({ send(message) {
      if (message.type === "PRISM_REMOTE_TRANSLATE") return new Promise(resolve => { finish = resolve; });
      if (message.type === "PRISM_PRONUNCIATION") return new Promise(resolve => { pronounce = resolve; });
    } });
    const anchor = document.createElement("span"); anchor.textContent = "hello";
    anchor.style.cssText = `position:fixed;left:45%;top:${Math.max(40, innerHeight - 320)}px;background:white`;
    document.body.append(anchor);
    try {
      await showSelectionMenu(anchor); view(".bubble-translate").click(); await waitFor(() => finish && pronounce);
      const before = view(".card").getBoundingClientRect();
      check(before.top > anchor.getBoundingClientRect().bottom, "加载窗口应先出现在选区下方");
      pronounce({ ok: true, pronunciation: { label: "US", ipa: "/həˈloʊ/" } });
      finish({ ok: true, translations: ["较长的译文，用于验证浮窗位置保持稳定。".repeat(100)] });
      await waitFor(() => !view(".result").classList.contains("loading") && !view(".pronunciation").hidden);
      const after = view(".card").getBoundingClientRect();
      check(Math.abs(after.top - before.top) < 1 && Math.abs(after.left - before.left) < 1, "内容增高不能让浮窗跳到选区另一侧");
      check(after.bottom <= innerHeight - 9, "长译文不能超出视口底部");
      check(view(".card").scrollHeight > view(".card").clientHeight || view(".result").scrollHeight > view(".result").clientHeight, "长内容必须能在浮窗内滚动");
      // A framework may replace the selected text while the request is pending.
      anchor.textContent = "Replacement text";
      document.dispatchEvent(new Event("scroll"));
      const replaced = view(".card").getBoundingClientRect();
      check(Math.abs(replaced.top - after.top) < 1 && Math.abs(replaced.left - after.left) < 1, "失效选区不能把浮窗移到页面左上角");
    } finally { anchor.remove(); }
  }],
  ["点击网页外部关闭译文，内部交互和已有朗读不受影响", async () => {
    await fresh();
    contentMessage({ type: "PRISM_START_READING", action: { type: "read-selection", text: "A sample passage." } });
    const frame = view(".reader-frame");
    await expectTranslation();
    view(".result").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
    check(view(".card").style.display === "block", "点击内部不能关闭译文");
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    check(view(".card").style.display === "none", "点击网页空白处应关闭译文");
    check(view(".reader-frame") === frame && !view(".dock").hidden, "关闭译文不能停止已有朗读");
  }],
  ["点击外部关闭等待中的翻译后，迟到的译文和音标不能重新打开窗口", async () => {
    let finish, pronounce;
    await fresh({ send(message) {
      if (message.type === "PRISM_REMOTE_TRANSLATE") return new Promise(resolve => { finish = resolve; });
      if (message.type === "PRISM_PRONUNCIATION") return new Promise(resolve => { pronounce = resolve; });
    } });
    translate(); await waitFor(() => finish && pronounce);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    check(view(".card").style.display === "none" && view(".dock").hidden, "关闭等待窗口应清除划词任务");
    finish({ ok: true, translations: ["迟到的译文"] });
    pronounce({ ok: true, pronunciation: { label: "US", ipa: "/həˈloʊ/" } });
    await new Promise(resolve => setTimeout(resolve, 20));
    check(view(".card").style.display === "none" && view(".dock").hidden, "迟到响应不能重新打开浮窗或圆形按钮");
    check(!view(".card").dataset.translation, "关闭后的请求结果应丢弃");
  }],
  ["翻译结束只更新圆环，不重新展开已收起的详情", async () => {
    let finish;
    await fresh({ send(message) { if (message.type === "PRISM_REMOTE_TRANSLATE") return new Promise(resolve => { finish = resolve; }); } });
    translate(); await waitFor(() => finish);
    check(view(".result").classList.contains("loading") && !view(".card").closest("[inert]"), "翻译等待状态也应直接显示");
    view(".collapse").click();
    check(view(".status-orb").dataset.busy === "true", "等待翻译时显示活动圆环");
    finish({ ok: true, translations: ["你好"] }); await waitFor(() => view(".result").textContent === "你好");
    check(view(".dock-details").inert && view(".status-orb").dataset.state === "done", "迟到结果不得重新展开详情");
    check(view(".orb-progress").getAttribute("stroke-dashoffset") === "0", "翻译完成圆环应满格");
  }],
  ["划词译文直接显示时，已有朗读继续使用原圆形按钮和会话", async () => {
    await fresh(); contentMessage({ type: "PRISM_START_READING", action: { type: "read-selection", text: "A sample passage." } });
    const frame = view(".reader-frame");
    const session = new URL(frame.src).searchParams.get("session");
    contentMessage({ type: "PRISM_READER_STATE", readerSession: session, state: "playing", progress: .25 });
    await expectTranslation();
    check(getComputedStyle(view(".card")).visibility === "visible" && !view(".card").closest("[inert]"), "朗读中也能直接查看划词译文");
    check(view(".reader-frame") === frame && contentMessage({ type: "PRISM_READER_ALIVE", readerSession: session }).ok, "划词翻译不能重建或停止朗读");
    check(view(".status-orb").dataset.symbol === "reading" && view(".dock-details").inert, "朗读仍保留为圆形按钮");
  }],
  ["整页翻译停止后丢弃迟到结果，不继续提交后续批次", async () => {
    let finish, calls = 0;
    await fresh({ send(message) { if (message.type === "PRISM_REMOTE_TRANSLATE") { calls++; return new Promise(resolve => { finish = () => resolve({ ok: true, translations: message.texts.map(() => "迟到译文") }); }); } } });
    contentMessage({ type: "PRISM_TOGGLE_PAGE" }); await waitFor(() => finish);
    check(!view(".page-status").hidden && view(".dock-details").inert, "进度默认收在圆形按钮内");
    view(".status-orb").click();
    view(".page-stop").click(); finish(); await new Promise(resolve => setTimeout(resolve, 30));
    check(calls === 1 && !document.querySelector(".prism-page-translation"), "停止后不得应用旧结果或启动新批次");
    check(view(".page-label").textContent.includes("停止"), "保留停止状态");
  }],
  ["整页翻译失败可从状态栏重试并恢复原文", async () => {
    let fail = true;
    await fresh({send(message) { if (message.type === "PRISM_REMOTE_TRANSLATE") return fail ? Promise.reject(new Error("Temporary service failure")) : Promise.resolve({ok:true,translations:message.texts.map(()=>"测试译文")}); }});
    contentMessage({type:"PRISM_TOGGLE_PAGE"});
    await waitFor(()=>!view(".page-retry").hidden);
    check(view(".status-orb").dataset.state === "error", "翻译失败应更新圆形按钮");
    view(".status-orb").click();
    check(view(".page-label").textContent === "Temporary service failure", "显示服务错误");
    fail = false;view(".page-retry").click();
    await waitFor(()=>!view(".page-restore").hidden && view(".page-stop").hidden);
    check(Boolean(document.querySelector(".prism-page-translation")),"重试后应用译文");
    view(".status-orb").click();
    view(".page-restore").click();
    check(!document.querySelector(".prism-page-translation"),"恢复原文清除译文");
  }],
  ["英文划词菜单和译文在屏幕边缘不越界，Escape 可收起", async () => {
    await fresh({settings:{uiLanguage:"en"}});
    const edge=document.createElement("p");edge.textContent="Selected text";edge.style.cssText="position:fixed;right:0;bottom:0;width:100px;margin:0;background:white";document.body.append(edge);
    try {
      await showSelectionMenu(edge);
      check(view(".bubble-read").textContent.trim()==="Read aloud", "朗读按钮应随界面语言切换");
      const box=view(".bubble").getBoundingClientRect();
      check(box.left>=0 && box.right<=innerWidth && box.top>=0 && box.bottom<=innerHeight,"浮窗应按实际宽度限制在视口内");
      view(".bubble-translate").click();
      await waitFor(()=>view(".result").textContent==="你好");
      const result=view(".card").getBoundingClientRect();
      check(result.left>=0 && result.right<=innerWidth && result.top>=0 && result.bottom<=innerHeight-9,"底部鼠标附近的译文应向上展开并保持可见");
      document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
      check(view(".bubble").style.display==="none","Escape 应收起浮窗");
      check(view(".dock-details").inert && !view(".dock").hidden,"Escape 应将译文收起到圆形按钮");
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
    check(getComputedStyle(view(".card")).visibility === "visible" && !view(".card").closest("[inert]"), "翻译失败也应直接显示具体错误");
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
