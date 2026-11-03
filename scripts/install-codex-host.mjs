import { mkdir, writeFile, readFile, chmod } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const id = process.argv[2];
if (!/^[a-p]{32}$/.test(id || "")) {
  console.error("Usage: node scripts/install-codex-host.mjs <extension ID from Prism settings> [native-host directory]");
  process.exit(1);
}
if (!["darwin", "linux"].includes(process.platform)) throw new Error("This installer currently supports macOS and Linux.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binary = process.env.PRISM_CODEX_BIN || execFileSync("/bin/sh", ["-c", "command -v codex"], { encoding: "utf8" }).trim();
const version = execFileSync(binary, ["--version"], { encoding: "utf8" }).trim();
const folder = process.argv[3] || (process.platform === "darwin"
  ? join(homedir(), "Library/Application Support/Google/Chrome/NativeMessagingHosts")
  : join(homedir(), ".config/google-chrome/NativeMessagingHosts"));
const support = process.env.PRISM_SUPPORT_DIR || (process.platform === "darwin" ? join(homedir(), "Library/Application Support/Prism Translate") : join(homedir(), ".local/share/prism-translate"));
await mkdir(support, { recursive: true, mode: 0o700 });
await mkdir(folder, { recursive: true });
const quote = (value) => `'${value.replace(/'/g, "'\\''")}'`;
const launcher = join(support, "codex-host");
await writeFile(launcher, `#!/bin/sh\nexport PRISM_CODEX_BIN=${quote(binary)}\nexport PATH=${quote(`${dirname(binary)}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`)}\nexec ${quote(process.execPath)} ${quote(join(root, "native/host.mjs"))} "$@"\n`, { mode: 0o700 });
await chmod(launcher, 0o700);
const manifestPath = join(folder, "com.prism_translate.codex.json");
const previous = await readFile(manifestPath, "utf8").then(JSON.parse).catch(() => ({}));
const allowedOrigins = new Set((previous.allowed_origins || []).filter((origin) => /^chrome-extension:\/\/[a-p]{32}\/$/.test(origin)));
allowedOrigins.add(`chrome-extension://${id}/`);
await writeFile(manifestPath, JSON.stringify({ name: "com.prism_translate.codex", description: "Prism local Codex connector", path: launcher, type: "stdio", allowed_origins: [...allowedOrigins] }, null, 2) + "\n");
console.log(`Installed for ${id}\n${version}\n${manifestPath}\nReload Prism in chrome://extensions, then use Settings → OpenAI → Local Codex CLI → Detect connection.`);
