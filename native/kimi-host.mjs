import { KimiClient } from "./kimi-client.mjs";

const client = new KimiClient();
let buffer = Buffer.alloc(0);
let busy = false;
let closing = false;

function respond(message) {
  if (closing) return;
  const body = Buffer.from(JSON.stringify(message));
  if (body.length > 1_000_000) return respond({ ok: false, error: "Translation is too large. Select less text." });
  const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
  process.stdout.write(Buffer.concat([header, body]));
}

async function handle(message) {
  if (busy) return respond({ ok: false, error: "A Kimi request is already in progress." });
  busy = true;
  try {
    if (!["models", "translate"].includes(message.action)) throw new Error("Unknown Prism request.");
    await client.start();
    const result = message.action === "models" ? await client.models() : await client.translate(message);
    respond({ ok: true, result });
  } catch (error) {
    respond({ ok: false, error: error.message });
  } finally {
    await client.close();
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0);
    if (length > 1_000_000) { shutdown(); return; }
    if (buffer.length < length + 4) break;
    const body = buffer.subarray(4, 4 + length); buffer = buffer.subarray(4 + length);
    try { handle(JSON.parse(body.toString("utf8"))); }
    catch { respond({ ok: false, error: "Invalid JSON request." }); }
  }
});

async function shutdown() {
  if (closing) return;
  closing = true;
  await client.close();
  process.exit(0);
}
process.stdin.on("end", shutdown);
process.stdout.on("error", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
