import { SPEECH_MODELS, speechOrigin, speechVoices, validateSpeech, SpeechPlayer } from "../shared/speech.js";

export function createReader({ getSettings, sendToTab, toast, showSettings, getConnectionDraft, chinese }) {
  const $ = selector => document.querySelector(selector);
  const say = (zh, en) => chinese() ? zh : en;
  let sourceUrl, readingSnapshot, generation = 0;
  const player = new SpeechPlayer({ onChange: render });
  function render({ state, index, total, chunk, error }) {
    $("#reader-player").hidden = state === "idle";
    const labels = { loading: say("正在生成语音", "Generating speech"), playing: say("正在朗读", "Reading"), paused: say("已暂停", "Paused"), error: say("朗读失败", "Reading failed") };
    $("#reader-status").textContent = error || `${labels[state] || ""} · ${index + 1} / ${total}`;
    $("#reader-text").textContent = chunk?.text || "";
    $("#reader-toggle").textContent = ["playing", "loading"].includes(state) ? say("暂停", "Pause") : state === "error" ? say("重试", "Retry") : say("继续", "Resume");
    $("#reader-prev").disabled = index === 0;
    $("#reader-next").disabled = index + 1 >= total;
    if (readingSnapshot) sendToTab({ type: "PRISM_READING_HIGHLIGHT", snapshot: readingSnapshot, ids: state === "idle" ? [] : chunk?.ids || [] }).catch(() => {});
  }
  function stop() { generation++; player.stop(); sourceUrl = null; readingSnapshot = null; }
  function voices(preferred) {
    const list = speechVoices($("#speech-model").value);
    $("#speech-voice").replaceChildren(...list.map(v => new Option(v[0].toUpperCase() + v.slice(1), v)));
    $("#speech-voice").value = list.includes(preferred) ? preferred : list[0];
  }
  function fill(settings) {
    $("#speech-model").replaceChildren(new Option(say("请选择朗读模型", "Choose a speech model"), ""), ...SPEECH_MODELS.map(m => new Option(m, m)));
    $("#speech-model").value = SPEECH_MODELS.includes(settings.speechModel) ? settings.speechModel : "";
    voices(settings.speechVoice);
    $("#speech-rate").value = String(settings.speechRate || 1);
  }
  function draft() { return { speechModel: $("#speech-model").value, speechVoice: $("#speech-voice").value, speechRate: Number($("#speech-rate").value) }; }
  async function permission(settings) {
    const origin = speechOrigin(settings);
    // Called directly from a click: preserve Chrome's permission user gesture.
    if (await chrome.permissions.contains({ origins: [origin] })) return true;
    return chrome.permissions.request({ origins: [origin] });
  }
  async function start(mode, text) {
    stop();
    const revision = generation;
    try {
      const saved = getSettings();
      const settings = mode === "preview" ? { ...saved, ...getConnectionDraft(), ...draft() } : saved;
      validateSpeech(settings);
      const permissionPromise = permission(settings);
      const snapshotPromise = mode === "page" || mode === "selection"
        ? sendToTab({ type: "PRISM_READING_COLLECT", selection: mode === "selection" }) : null;
      // Observe both rejections, including extraction failing before permission resolves.
      const [granted, snapshot] = await Promise.all([permissionPromise, snapshotPromise]);
      if (revision !== generation) return;
      if (!granted) throw new Error(say("需要允许访问 OpenAI 才能朗读。", "Allow OpenAI access to read aloud."));
      let paragraphs;
      if (snapshot) {
        if (!snapshot.ok) throw new Error(snapshot.error);
        paragraphs = snapshot.paragraphs; sourceUrl = snapshot.url; readingSnapshot = snapshot.snapshot;
      } else paragraphs = [{ text: mode === "preview" ? say("你好，这是网页朗读试听。清晨的阳光照进窗户，新的一天开始了。", "Welcome to your reading companion. Morning sunlight fills the room, and a new day begins.") : text }];
      if (!paragraphs?.some(p => p.text?.trim())) throw new Error(say("没有找到可朗读的文字，请先选择段落。", "No readable text. Select a paragraph first."));
      if (paragraphs.reduce((n, p) => n + p.text.length, 0) > 240_000) throw new Error(say("文章过长，请分段选择朗读。", "This article is too long. Select smaller sections."));
      $("#reader-rate").value = String(settings.speechRate);
      void player.start(paragraphs, settings);
    } catch (e) { if (revision === generation) { toast(e.message, 6000); if (!getSettings().openaiApiKey) showSettings(); } }
  }
  function wire() {
    $("#speech-model").addEventListener("change", () => voices($("#speech-voice").value));
    $("#speech-preview").addEventListener("click", () => start("preview"));
    $("#read-page").addEventListener("click", () => start("page"));
    $("#read-selection").addEventListener("click", () => start("selection"));
    $("#read-source-text").addEventListener("click", () => start("text", $("#source-text").value));
    $("#reader-toggle").addEventListener("click", () => player.toggle());
    $("#reader-stop").addEventListener("click", stop);
    $("#reader-prev").addEventListener("click", () => player.move(-1));
    $("#reader-next").addEventListener("click", () => player.move(1));
    $("#reader-rate").addEventListener("change", () => { player.settings.speechRate = Number($("#reader-rate").value); player.rate(player.settings.speechRate); });
    window.addEventListener("pagehide", stop);
  }
  return { fill, draft, wire, start, stop, pageChanged: url => { if (sourceUrl && sourceUrl !== url) stop(); } };
}
