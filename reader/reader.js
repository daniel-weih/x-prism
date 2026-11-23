import { getSettings } from "../shared/storage.js";
import { speechOrigin, validateSpeech } from "../shared/speech.js";

const $ = selector => document.querySelector(selector);
const session = new URL(location.href).searchParams.get("session");
const send = async message => {
  const response = await chrome.runtime.sendMessage({ type: "PRISM_READER_PAGE", session, message });
  if (!response?.ok) throw new Error(response?.error || "Reading page is no longer available.");
  return response;
};
const audio = async (action, payload = {}) => {
  const response = await chrome.runtime.sendMessage({ type: "PRISM_READER_AUDIO", session, action, ...payload });
  if (!response?.ok) throw new Error(response?.error || "Audio playback unavailable.");
  return response;
};
let settings, snapshot, closed = false, ready = false, chinese = false, heartbeat;
const say = (zh, en) => chinese ? zh : en;
let pendingToggleRevision = 0, appliedToggleRevision = 0;

function applyShortcutToggle() {
  if (!ready || closed) return;
  const toggle = (pendingToggleRevision - appliedToggleRevision) % 2;
  appliedToggleRevision = pendingToggleRevision;
  if (toggle) void audio("toggle").catch(() => {});
}
function onRuntimeMessage(message, sender, respond) {
  if (sender.id !== chrome.runtime.id || closed || message?.session !== session) return false;
  if (message.type === "PRISM_READER_TOGGLE") {
    if (!Number.isSafeInteger(message.revision) || message.revision < 1) return false;
    pendingToggleRevision = Math.max(pendingToggleRevision, message.revision);
    applyShortcutToggle();
    respond({ ok: true }); return false;
  }
  if (message.type === "PRISM_READER_AUDIO_STATE") {
    render(message);
    respond({ ok: true }); return false;
  }
  return false;
}
chrome.runtime.onMessage.addListener(onRuntimeMessage);

function render({ state, index, total, chunk, error }) {
  if (closed || !ready) return;
  const labels = { idle: say("朗读完成", "Finished"), loading: say("正在生成语音", "Preparing audio"), playing: say("正在朗读", "Reading"), paused: say("已暂停", "Paused"), error: say("朗读失败", "Reading failed") };
  $("#status").textContent = labels[state];
  $("#position").textContent = total ? `${index + 1} / ${total}` : "";
  $("#excerpt").textContent = error || chunk?.text || say("已完成本次朗读。", "Reading complete.");
  $("#excerpt").title = $("#excerpt").textContent;
  $("#player").classList.toggle("error", Boolean(error));
  $("#toggle").textContent = ["playing", "loading"].includes(state) ? say("暂停", "Pause") : state === "error" ? say("重试", "Retry") : say("播放", "Play");
  $("#toggle").disabled = state === "idle";
  $("#previous").disabled = !total || index === 0;
  $("#next").disabled = !total || index + 1 >= total;
  $("#progress").value = state === "idle" ? 1 : total ? index / total : 0;
  void send({ type: "PRISM_READER_STATE", state, progress: $("#progress").value }).catch(close);
  if (snapshot) void send({ type: "PRISM_READING_HIGHLIGHT", snapshot, ids: state === "idle" ? [] : chunk?.ids || [] }).catch(close);
}

function close() {
  if (closed) return;
  closed = true; clearInterval(heartbeat);
  chrome.runtime.onMessage.removeListener(onRuntimeMessage);
  void chrome.runtime.sendMessage({ type: "PRISM_READER_AUDIO", session, action: "stop" }).catch(() => {});
  void send({ type: "PRISM_READER_CLOSE" }).catch(() => {});
}
$("#close").addEventListener("click", close);
$("#toggle").addEventListener("click", () => { void audio("toggle").catch(() => {}); });
$("#previous").addEventListener("click", () => { void audio("move", { delta: -1 }).catch(() => {}); });
$("#next").addEventListener("click", () => { void audio("move", { delta: 1 }).catch(() => {}); });
$("#rate").addEventListener("change", () => {
  void audio("rate", { rate: Number($("#rate").value) }).catch(() => {});
});
$("#collapse").addEventListener("click", () => {
  void send({ type: "PRISM_READER_COLLAPSE" }).catch(close);
});
window.addEventListener("keydown", event => {
  if (event.key === "Escape") void send({ type: "PRISM_READER_COLLAPSE" }).catch(close);
});
$("#settings").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "PRISM_OPEN_PANEL", action: { type: "settings" } }).catch(() => {});
});
window.addEventListener("pagehide", close);
new ResizeObserver(() => {
  if (!closed) void send({ type: "PRISM_READER_LAYOUT", height: document.body.offsetHeight }).catch(() => {});
}).observe(document.body);

async function initialize() {
  const request = await send({ type: "PRISM_READER_ATTACH" });
  settings = await getSettings();
  if (closed) return;
  chinese = settings.uiLanguage === "zh" || (settings.uiLanguage !== "en" && chrome.i18n.getUILanguage().startsWith("zh"));
  document.documentElement.lang = chinese ? "zh-CN" : "en";
  document.documentElement.classList.toggle("dark", settings.theme === "dark" || (settings.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches));
  for (const [id, zh, en] of [["settings", "设置", "Settings"], ["collapse", "收起为圆形按钮", "Collapse to circle"], ["close", "停止并关闭", "Stop and close"], ["previous", "上一段", "Previous section"], ["next", "下一段", "Next section"], ["rate", "播放速度", "Playback speed"]]) {
    $("#" + id).title = say(zh, en); $("#" + id).setAttribute("aria-label", say(zh, en));
  }
  $("#ai-label").textContent = say("AI 合成语音", "AI voice");
  $("#rate").value = String(settings.speechRate);
  validateSpeech(settings);
  if (!await chrome.permissions.contains({ origins: [speechOrigin(settings)] })) throw new Error(say("请打开设置，保存 OpenAI API 配置并允许访问服务。", "Open Settings to save your OpenAI API connection and allow access."));
  if (closed) return;
  snapshot = request.snapshot;
  ready = true;
  heartbeat = setInterval(() => { void send({ type: "PRISM_READER_ALIVE" }).catch(close); }, 2000);
  await audio("start", { paragraphs: request.paragraphs });
  pendingToggleRevision = Math.max(pendingToggleRevision, request.toggleRevision || 0);
  applyShortcutToggle();
}
initialize().catch(error => {
  if (closed) return;
  ready = true;
  render({ state: "error", index: 0, total: 0, error: error.message });
  $("#toggle").disabled = true;
});
