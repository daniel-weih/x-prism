export const KIMI_NATIVE_HOST = "com.prism_translate.kimi";

export function requestKimi(payload, runtime = chrome.runtime, timeoutMs = 240_000) {
  return new Promise((resolve, reject) => {
    let port, finished = false;
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      port?.disconnect();
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error("Kimi 翻译超时，请缩短文本后重试。")), timeoutMs);
    try {
      port = runtime.connectNative(KIMI_NATIVE_HOST);
      port.onMessage.addListener((message) => message.ok
        ? finish(null, message.result)
        : finish(new Error(message.error || "Kimi request failed.")));
      port.onDisconnect.addListener(() => {
        const detail = runtime.lastError?.message;
        finish(new Error(`无法连接本机 Kimi。请安装连接器并检测连接。${detail ? ` (${detail})` : ""}`));
      });
      port.postMessage(payload);
    } catch (error) { finish(error); }
  });
}
