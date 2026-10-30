import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { kimiTranslationBody, translateKimiApi, listKimiApiModels, parseKimiTranslations } from '../shared/kimi-api.js';
import { KimiClient, parseKimiPrintOutput } from '../native/kimi-client.mjs';
import { requestKimi } from '../shared/kimi.js';
import { ensureDefaults, saveSettings, getSettings } from '../shared/storage.js';

const settings = { kimiApiRegion: 'cn', kimiApiKey: 'test-only-key', kimiApiModel: 'kimi-k3', kimiApiThinking: 'low' };
const jsonResponse = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });

test('Kimi API sends ordered batches, exact region and credentials without redirects', async () => {
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push({url, init});
    const body = JSON.parse(init.body);
    const {texts} = JSON.parse(body.messages[1].content);
    return jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ translations: texts.map(text => `译${text}`) }) } }] });
  };
  const texts = Array.from({ length: 10 }, (_, i) => String(i));
  assert.deepEqual(await translateKimiApi(texts, 'en', 'zh', { ...settings, kimiApiRegion: 'global' }, fetcher), texts.map(text => `译${text}`));
  assert.equal(requests.length, 2);
  for (const {url, init} of requests) {
    assert.equal(url, 'https://api.moonshot.ai/v1/chat/completions');
    assert.equal(init.headers.Authorization, 'Bearer test-only-key');
    assert.equal(init.redirect, 'error');
    assert.equal(init.method, 'POST');
  }
});

test('Kimi model capabilities do not receive incompatible temperature or thinking parameters', () => {
  const body = (model, thinking) => kimiTranslationBody(['hello'], 'en', 'zh', { ...settings, kimiApiModel: model, kimiApiThinking: thinking });
  const k3 = body('kimi-k3.1-pro', 'max');
  assert.equal(k3.reasoning_effort, 'max'); assert.ok(!('thinking' in k3));
  const k25 = body('kimi-k2.5', 'off');
  assert.deepEqual(k25.thinking, { type: 'disabled' }); assert.ok(!('reasoning_effort' in k25));
  assert.deepEqual(body('kimi-k2.6', 'on').thinking, { type: 'enabled' });
  for (const model of ['kimi-k2.7-code', 'future-model']) {
    const request = body(model, 'off');
    assert.ok(!('thinking' in request)); assert.ok(!('reasoning_effort' in request));
  }
  assert.ok(!('temperature' in k3)); assert.ok(!('temperature' in k25));
});

test('Kimi rejects invalid credentials, redirects/regions, quota failures and incomplete responses', async () => {
  let called = false;
  const shouldNotCall = async () => { called = true; throw new Error('unexpected network'); };
  await assert.rejects(listKimiApiModels({ ...settings, kimiApiKey: '' }, shouldNotCall), /API Key/);
  await assert.rejects(listKimiApiModels({ ...settings, kimiApiRegion: 'https://untrusted.test' }, shouldNotCall), /服务区域/);
  assert.equal(called, false);
  for (const [status, pattern] of [[401, /Key 无效/], [429, /额度不足/], [500, /HTTP 500/]]) {
    await assert.rejects(listKimiApiModels(settings, async () => jsonResponse({ error: { message: 'private-key-must-not-leak' } }, status)), pattern);
  }
  await assert.rejects(translateKimiApi(['hello'], 'en', 'zh', settings, async () => jsonResponse({ choices: [{ finish_reason: 'length', message: { content: '{"translations":["你"]}' } }] })), /未完成/);
  for (const content of ['garbage', '{"translations":[]}', '{"translations":[12]}', '{"translations":[""]}']) assert.throws(() => parseKimiTranslations(content, 1));
  assert.deepEqual(parseKimiTranslations('```json\n{"translations":["你好"]}\n```', 1), ['你好']);
});

test('Kimi API model discovery uses the chosen account and does not invent models', async () => {
  const response = await listKimiApiModels(settings, async (url, init) => {
    assert.equal(url, 'https://api.moonshot.cn/v1/models'); assert.equal(init.method, 'GET');
    assert.equal(init.headers.Authorization, 'Bearer test-only-key'); assert.equal(init.body, undefined);
    return jsonResponse({ data: [{ id: 'account-model' }, { id: null }] });
  });
  assert.deepEqual(response.models, [{ model: 'account-model', displayName: 'account-model' }]);
  await assert.rejects(listKimiApiModels(settings, async () => jsonResponse({ data: [] })), /未返回可用模型/);
});

test('Kimi print output accepts final assistant JSON and rejects tool calls and missing translations', () => {
  const output = [JSON.stringify({ role: 'user', content: 'hello' }), JSON.stringify({ role: 'assistant', content: '{"translations":["你好"]}' })].join('\n');
  assert.deepEqual(parseKimiPrintOutput(output, 1), ['你好']);
  assert.throws(() => parseKimiPrintOutput(JSON.stringify({ role: 'assistant', tool_calls: [{ name: 'shell' }] }) + '\n' + output, 1), /不允许调用工具/);
  assert.throws(() => parseKimiPrintOutput(output, 2), /不完整/);
});

test('missing Kimi executable fails promptly and removes its temporary directory', async () => {
  const client = new KimiClient('/missing/prism-kimi-binary');
  try { await assert.rejects(client.start(), /无法启动 Kimi/); }
  finally { await client.close(); }
  await assert.rejects(access(client.cwd));
});

test('Kimi native ports close after result, disconnect and timeout', async () => {
  for (const mode of ['success', 'disconnect', 'timeout']) {
    let reply, disconnect, closed = 0;
    const runtime = { lastError: undefined, connectNative(name) {
      assert.equal(name, 'com.prism_translate.kimi');
      return { onMessage: { addListener(fn) { reply = fn; } }, onDisconnect: { addListener(fn) { disconnect = fn; } },
        disconnect() { closed++; }, postMessage() { queueMicrotask(() => {
          if (mode === 'success') reply({ ok: true, result: { translations: ['你好'] } });
          if (mode === 'disconnect') { runtime.lastError = { message: 'host missing' }; disconnect(); }
        }); } };
    } };
    if (mode === 'success') assert.deepEqual(await requestKimi({}, runtime, 20), { translations: ['你好'] });
    else await assert.rejects(requestKimi({}, runtime, 20), mode === 'timeout' ? /超时/ : /host missing/);
    assert.equal(closed, 1);
  }
});

test('Kimi settings retain independent models, migrate secrets locally and preserve unrelated engines', async () => {
  const memory = { sync: { prismSettings: { provider: 'codex', codexModel: 'saved-codex', kimiApiKey: 'old-key' } }, local: {} };
  const area = name => ({ get: async key => ({ [key]: memory[name][key] }), set: async patch => Object.assign(memory[name], structuredClone(patch)) });
  globalThis.chrome = { storage: { sync: area('sync'), local: area('local') } };
  try {
    await ensureDefaults();
    assert.equal(memory.local.prismSecrets.kimiApiKey, 'old-key');
    assert.ok(!('kimiApiKey' in memory.sync.prismSettings));
    await saveSettings({ provider: 'kimi', kimiConnection: 'cli', kimiCliModel: 'kimi-code/k3', ...settings });
    await saveSettings({ kimiConnection: 'api' });
    const saved = await getSettings();
    assert.equal(saved.kimiCliModel, 'kimi-code/k3'); assert.equal(saved.kimiApiModel, 'kimi-k3'); assert.equal(saved.codexModel, 'saved-codex');
    assert.ok(!JSON.stringify(memory.sync).includes('test-only-key'));
    assert.equal(memory.local.prismSecrets.kimiApiKey, 'test-only-key');
  } finally { delete globalThis.chrome; }
});

test('background routes Kimi selection/page requests through saved mode and enforces API host access', async () => {
  const noEvent = { addListener() {} };
  let listener, permit = true, nativePayload, apiCalls = 0;
  const saved = { provider: 'kimi', kimiConnection: 'cli', kimiCliModel: 'kimi-code/k3', ...settings };
  const originalFetch = globalThis.fetch;
  globalThis.chrome = {
    runtime: { id: 'prism-test', getURL: path => `chrome-extension://prism-test/${path}`, onInstalled: noEvent, onStartup: noEvent,
      onMessage: { addListener(fn) { listener = fn; } },
      connectNative(name) {
        assert.equal(name, 'com.prism_translate.kimi'); let reply;
        return { onMessage: { addListener(fn) { reply = fn; } }, onDisconnect: noEvent, disconnect() {},
          postMessage(payload) { nativePayload = payload; queueMicrotask(() => reply({ ok: true, result: { translations: payload.texts.map(() => '本机译文') } })); } };
      } },
    contextMenus: { onClicked: noEvent }, commands: { onCommand: noEvent },
    tabs: { onCreated: noEvent, onReplaced: noEvent, onRemoved: noEvent },
    storage: { sync: { get: async () => ({ prismSettings: saved }) }, local: { get: async () => ({ prismSecrets: { kimiApiKey: 'saved-key' } }) } },
    permissions: { contains: async ({ origins }) => { assert.deepEqual(origins, ['https://api.moonshot.cn/*']); return permit; } }
  };
  globalThis.fetch = async (url, init) => {
    apiCalls++; assert.equal(url, 'https://api.moonshot.cn/v1/chat/completions');
    assert.equal(init.headers.Authorization, 'Bearer saved-key');
    return jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: '{"translations":["接口译文"]}' } }] });
  };
  try {
    await import('../background.js');
    const sender = { id: 'prism-test', url: 'https://example.test' };
    const message = { type: 'PRISM_REMOTE_TRANSLATE', provider: 'kimi', texts: ['hello'], sourceLanguage: 'en', targetLanguage: 'zh', apiKey: 'ignored-message-key' };
    const send = () => new Promise(resolve => assert.equal(listener(message, sender, resolve), true));
    assert.deepEqual(await send(), { ok: true, translations: ['本机译文'] });
    assert.equal(nativePayload.model, 'kimi-code/k3'); assert.equal(nativePayload.apiKey, undefined);
    saved.kimiConnection = 'api';
    assert.deepEqual(await send(), { ok: true, translations: ['接口译文'] });
    permit = false;
    const denied = await send(); assert.equal(denied.ok, false); assert.match(denied.error, /允许访问/); assert.equal(apiCalls, 1);
    message.provider = 'libre';
    const removed = await send(); assert.equal(removed.ok, false); assert.match(removed.error, /no longer available/); assert.equal(apiCalls, 1);
    assert.equal(listener(message, { id: 'other-extension' }, () => {}), false);
    assert.equal(listener({ type: 'PRISM_KIMI_MODELS', connection: 'api' }, sender, () => {}), false);
  } finally { globalThis.fetch = originalFetch; delete globalThis.chrome; }
});

test('retiring engines clears obsolete keys from both stores and keeps remaining engines intact', async () => {
  const memory = { sync: { prismSettings: { provider: 'libre', libreEndpoint: 'https://old.test/translate', deeplUseFree: true, deeplApiKey: 'old-synced-secret', kimiCliModel: 'kimi-code/k3' } }, local: { prismSecrets: { libreApiKey: 'old-secret', deeplApiKey: 'old-deepl-secret', kimiApiKey: 'keep-kimi', openaiApiKey: 'keep-openai' } } };
  const area = name => ({ get: async key => ({ [key]: memory[name][key] }), set: async patch => Object.assign(memory[name], structuredClone(patch)) });
  globalThis.chrome = { storage: { sync: area('sync'), local: area('local') } };
  try {
    await ensureDefaults();
    const saved = await getSettings();
    assert.equal(saved.provider, 'chrome'); assert.equal(saved.kimiCliModel, 'kimi-code/k3');
    assert.equal(saved.kimiApiKey, 'keep-kimi'); assert.equal(saved.openaiApiKey, 'keep-openai');
    for (const key of ['libreEndpoint','libreApiKey','deeplApiKey','deeplUseFree']) {
      assert.ok(!(key in saved)); assert.ok(!(key in memory.sync.prismSettings)); assert.ok(!(key in memory.local.prismSecrets));
    }
    await saveSettings({ provider: 'deepl' });
    assert.equal((await getSettings()).provider, 'chrome');
    assert.ok(!JSON.stringify(memory.sync).includes('keep-kimi'));
  } finally { delete globalThis.chrome; }
});
