export const NATIVE_HOST = "com.prism_translate.codex";

// A native port keeps MV3 alive while Codex is generating a translation.
// Close it after the request: no always-on server or listening TCP port.
export function requestCodex(payload, runtime = chrome.runtime, timeoutMs = 240_000) {
  return new Promise((resolve, reject) => {
    let port;
    let finished = false;
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      port?.disconnect();
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error("Codex 翻译超时，请降低推理强度或缩短文本。")), timeoutMs);
    try {
      port = runtime.connectNative(NATIVE_HOST);
      port.onMessage.addListener((message) => {
        if (message.ok) finish(null, message.result);
        else finish(new Error(message.error || "Codex request failed."));
      });
      port.onDisconnect.addListener(() => {
        const detail = runtime.lastError?.message;
        finish(new Error(`无法连接本地 Codex。请在设置中安装连接器并检测连接。${detail ? ` (${detail})` : ""}`));
      });
      port.postMessage(payload);
    } catch (error) {
      finish(error);
    }
  });
}
