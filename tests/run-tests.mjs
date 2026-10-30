import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SETTINGS, normalizeSettings, smartTargetFor } from "../shared/config.js";
import { SIDE_PANEL_PATH } from "../shared/side-panel.js";
import {
  TAB_ACCESS_ERROR,
  isRestrictedPageUrl,
  messageActiveTab,
  visiblePageDetails
} from "../shared/tab-access.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));

assert.equal(manifest.manifest_version, 3);
assert.ok(Number(manifest.minimum_chrome_version) >= 116);
assert.ok(!manifest.permissions.includes("tabs"), "Avoid broad tabs permission");
assert.ok(manifest.permissions.includes("scripting"), "On-demand recovery requires scripting permission");
assert.ok(!manifest.host_permissions.includes("<all_urls>"), "Avoid broad required host access");
assert.equal(manifest.side_panel, undefined, "Do not register a window-wide side panel");

const referencedPaths = [
  manifest.background.service_worker,
  SIDE_PANEL_PATH,
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon),
  ...manifest.content_scripts.flatMap((entry) => [...entry.js, ...entry.css])
];
for (const path of referencedPaths) {
  assert.ok(existsSync(resolve(root, path)), `Missing manifest asset: ${path}`);
}

const html = readFileSync(resolve(root, SIDE_PANEL_PATH), "utf8");
assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/i, "Inline scripts are not allowed");
assert.doesNotMatch(html, /https?:\/\//i, "Side panel must not load remote assets");

const allSourceFiles = [
  "background.js", "content/content.js", "sidepanel/sidepanel.js",
  "shared/config.js", "shared/storage.js", "shared/translator.js", "shared/tab-access.js", "shared/side-panel.js"
];
for (const file of allSourceFiles) {
  const source = readFileSync(resolve(root, file), "utf8");
  assert.doesNotMatch(source, /\beval\s*\(|new\s+Function\s*\(/, `${file} contains dynamic code execution`);
}

assert.equal(smartTargetFor("en", "en"), "zh");
assert.equal(smartTargetFor("zh-CN", "zh"), "en");
assert.equal(smartTargetFor("fr", "zh"), "zh");
assert.equal(normalizeSettings({ provider: "unknown" }).provider, "chrome");
assert.equal(normalizeSettings({ maxPageSegments: 9 }).maxPageSegments, 40);
assert.equal(normalizeSettings({ maxPageSegments: 9_000 }).maxPageSegments, 600);
assert.equal(DEFAULT_SETTINGS.autoTranslateSelection, false);

assert.equal(isRestrictedPageUrl("https://x.com/OpenAI"), false);
assert.equal(isRestrictedPageUrl("http://localhost:3000/test"), false);
assert.equal(isRestrictedPageUrl("chrome://settings"), true);
assert.equal(isRestrictedPageUrl(""), false, "A hidden URL is not proof of a restricted page");

const hiddenUrlTabs = {
  async query(options) {
    assert.deepEqual(options, { active: true, currentWindow: true });
    return [{ id: 42 }];
  },
  async sendMessage(tabId, message) {
    assert.equal(tabId, 42);
    assert.equal(message.type, "PRISM_GET_PAGE_STATE");
    return { ok: true, title: "X", url: "https://x.com/", active: false };
  }
};
const hiddenUrlResult = await messageActiveTab(hiddenUrlTabs, { type: "PRISM_GET_PAGE_STATE" });
assert.equal(hiddenUrlResult.response.url, "https://x.com/");
assert.deepEqual(visiblePageDetails(hiddenUrlResult.tab, hiddenUrlResult.response), {
  title: "X",
  url: "https://x.com/"
});

await assert.rejects(
  messageActiveTab({
    async query() { return [{ id: 7, url: "chrome://extensions" }]; },
    async sendMessage() { throw new Error("must not send"); }
  }, { type: "PRISM_GET_PAGE_STATE" }),
  (error) => error.code === TAB_ACCESS_ERROR.restrictedPage
);

let recoveredSendCount = 0;
let injectedTabId = null;
const recoveredResult = await messageActiveTab({
  async query() { return [{ id: 9 }]; },
  async sendMessage() {
    recoveredSendCount += 1;
    if (recoveredSendCount === 1) throw new Error("Receiving end does not exist");
    return { ok: true, title: "Already open", url: "https://example.test/" };
  }
}, { type: "PRISM_GET_PAGE_STATE" }, async (tabId) => { injectedTabId = tabId; });
assert.equal(injectedTabId, 9);
assert.equal(recoveredSendCount, 2);
assert.equal(recoveredResult.injected, true);

await assert.rejects(
  messageActiveTab({
    async query() { return []; },
    async sendMessage() { throw new Error("must not send"); }
  }, { type: "PRISM_GET_PAGE_STATE" }),
  (error) => error.code === TAB_ACCESS_ERROR.noActiveTab
);

await assert.rejects(
  messageActiveTab({
    async query() { return [{ id: 10 }]; },
    async sendMessage() { throw new Error("Receiving end does not exist"); }
  }, { type: "PRISM_GET_PAGE_STATE" }, async () => {
    throw new Error("The extensions gallery cannot be scripted.");
  }),
  (error) => error.code === TAB_ACCESS_ERROR.restrictedPage
);

await assert.rejects(
  messageActiveTab({
    async query() { return [{ id: 8 }]; },
    async sendMessage() { throw new Error("Receiving end does not exist"); }
  }, { type: "PRISM_GET_PAGE_STATE" }),
  (error) => error.code === TAB_ACCESS_ERROR.pageNotConnected
);

const storageSource = readFileSync(resolve(root, "shared/storage.js"), "utf8");
assert.match(storageSource, /SECRET_SETTING_KEYS/);
assert.match(storageSource, /chrome\.storage\.local\.set/);

console.log(`✓ Manifest references ${referencedPaths.length} existing assets`);
console.log("✓ No remote UI code or dynamic JavaScript execution");
console.log("✓ Settings normalization and smart-target behavior");
console.log("✓ Hidden tab metadata is resolved through the content script without broad tabs permission");
console.log("✓ Already-open tabs recover with one on-demand content-script injection");
console.log("✓ API keys are separated into local extension storage");
