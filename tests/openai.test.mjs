import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings } from '../shared/config.js';
import { ensureDefaults, getSettings, saveSettings } from '../shared/storage.js';
import { listOpenAiApiModels, translateOpenAiApi, parseOpenAiTranslations, openaiApiOrigin, supportsOpenAiFast } from '../shared/openai-api.js';

const api = { openaiEndpoint: 'https://api.openai.com/v1/chat/completions', openaiApiKey: 'test-only-key', openaiModel: 'test-chat-model' };
const jsonResponse = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });

test('legacy Codex and API selections migrate to distinct OpenAI modes without changing models or history', async () => {
  for (const [provider, mode] of [['codex', 'cli'], ['openai', 'api']]) {
    const memory = { sync: { prismSettings: { provider, ...api, codexModel: 'saved-cli', codexReasoningEffort: 'low' } }, local: { prismHistory: [{ id: 'keep-history' }] } };
    const area = name => ({ get: async key => ({ [key]: memory[name][key] }), set: async patch => Object.assign(memory[name], structuredClone(patch)) });
    globalThis.chrome = { storage: { sync: area('sync'), local: area('local') } };
    try {
      await ensureDefaults();
      await ensureDefaults();
      const migrated = await getSettings();
      assert.equal(migrated.provider, 'openai'); assert.equal(migrated.openaiConnection, mode);
      assert.equal(migrated.codexModel, 'saved-cli'); assert.equal(migrated.codexReasoningEffort, 'low');
      assert.equal(migrated.openaiModel, api.openaiModel); assert.equal(migrated.openaiEndpoint, api.openaiEndpoint);
      assert.equal(migrated.openaiApiKey, api.openaiApiKey);
      assert.equal(migrated.openaiReasoningEffort, '');
      assert.equal(migrated.openaiFastMode, false);
      await saveSettings({ openaiReasoningEffort: 'none', openaiFastMode: true });
      await saveSettings({ openaiConnection: mode === 'cli' ? 'api' : 'cli' });
      const switched = await getSettings();
      assert.notEqual(switched.openaiConnection, mode);
      assert.equal(switched.codexModel, 'saved-cli'); assert.equal(switched.openaiModel, api.openaiModel);
      assert.equal(switched.codexReasoningEffort, 'low'); assert.equal(switched.openaiReasoningEffort, 'none');
      assert.equal(switched.openaiFastMode, true);
      await saveSettings({ openaiFastMode: false });
      assert.equal((await getSettings()).openaiFastMode, false);
      assert.ok(!JSON.stringify(memory.sync).includes(api.openaiApiKey));
      assert.equal(memory.local.prismSecrets.openaiApiKey, api.openaiApiKey);
      assert.deepEqual(memory.local.prismHistory, [{ id: 'keep-history' }]);
    } finally { delete globalThis.chrome; }
  }
  assert.equal(normalizeSettings().openaiConnection, 'api');
  assert.equal(normalizeSettings({ openaiReasoningEffort: 'invalid' }).openaiReasoningEffort, '');
  assert.equal(normalizeSettings({ provider: 'openai', openaiConnection: 'cli' }).openaiConnection, 'cli');
  assert.equal(normalizeSettings({ provider: 'kimi', kimiConnection: 'api' }).provider, 'kimi');
});

test('Fast is opt-in for documented text models and controls every translation batch', async () => {
  for (const model of ['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-astra', 'gpt-5.6-luna', 'gpt-4.1-mini-2025-04-14', 'o3']) assert.equal(supportsOpenAiFast(model), true);
  for (const model of ['', 'gpt-99', 'gpt-5-nano', 'gpt-5-pro', 'gpt-audio-1.5', 'gpt-realtime-2.1', 'ft:gpt-4.1:example', 'gpt-4.1-other', 'kimi-k3']) assert.equal(supportsOpenAiFast(model), false);
  assert.equal(normalizeSettings({ openaiFastMode: 'false' }).openaiFastMode, false);
  const cases = [
    [{ openaiModel: 'gpt-6.1-sol', openaiFastMode: true }, 'fast'],
    [{ openaiModel: 'gpt-4.1-mini-2025-04-14', openaiFastMode: true }, 'fast'],
    [{ openaiModel: 'gpt-6.1-sol', openaiFastMode: false }, 'default'],
    [{ openaiModel: 'gpt-6.1-sol' }, 'default'],
    [{ openaiModel: 'gpt-6.1-sol', openaiFastMode: true, openaiEndpoint: 'https://proxy.example/v1/chat/completions' }, 'fast'],
    [{ openaiModel: 'gpt-6.1-sol', openaiFastMode: false, openaiEndpoint: 'https://proxy.example/v1/chat/completions' }, undefined],
    [{ openaiModel: 'gpt-99', openaiFastMode: true }, undefined],
    [{ openaiModel: 'kimi-k3', openaiFastMode: true }, undefined]
  ];
  for (const [patch, expectedTier] of cases) {
    let calls = 0;
    const result = await translateOpenAiApi(Array(21).fill('hello'), 'en', 'zh', { ...api, ...patch, openaiReasoningEffort: 'low' }, async (_url, init) => {
      calls++;
      const body = JSON.parse(init.body);
      assert.equal(body.service_tier, expectedTier);
      assert.equal(body.reasoning_effort, 'low');
      return jsonResponse({ service_tier: 'default', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(JSON.parse(body.messages[1].content).map(() => '你好')) } }] });
    });
    assert.equal(calls, 2);
    assert.equal(result.length, 21, 'A server-side downgrade still returns the translation');
  }
});

test('Fast rejection is actionable, redacts provider details, and never silently retries', async () => {
  for (const error of [{ param: 'service_tier', message: 'private-key-must-not-leak' }, { message: 'Unsupported service_tier: private-key-must-not-leak' }]) {
    let calls = 0;
    await assert.rejects(translateOpenAiApi(['hello'], 'en', 'zh', { ...api, openaiModel: 'gpt-6.1-sol', openaiFastMode: true, openaiReasoningEffort: 'high' }, async () => {
      calls++;
      return jsonResponse({ error }, 400);
    }), e => /关闭 Fast/.test(e.message) && !e.message.includes('private-key'));
    assert.equal(calls, 1);
  }
});

test('API model discovery uses the selected endpoint and key, supports a custom base path and deduplicates model IDs', async () => {
  const result = await listOpenAiApiModels({ ...api, openaiEndpoint: 'https://example.test/proxy/v1/chat/completions/' }, async (url, init) => {
    assert.equal(url, 'https://example.test/proxy/v1/models');
    assert.equal(init.method, 'GET'); assert.equal(init.body, undefined);
    assert.equal(init.headers.Authorization, 'Bearer test-only-key');
    assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
    return jsonResponse({ data: [{ id: 'account-model' }, null, { id: '' }, { id: 'account-model' }] });
  });
  assert.deepEqual(result.models, [{ model: 'account-model', displayName: 'account-model' }]);
  await assert.rejects(listOpenAiApiModels(api, async () => jsonResponse({ data: [] })), /未返回可用模型/);
});

test('API translation preserves batch order and model defaults while rejecting truncated or malformed output', async () => {
  const requests = [];
  const texts = Array.from({ length: 23 }, (_, i) => `text ${i}`);
  const result = await translateOpenAiApi(texts, 'en', 'zh', api, async (url, init) => {
    const body = JSON.parse(init.body); requests.push(body);
    assert.equal(url, api.openaiEndpoint); assert.equal(body.model, api.openaiModel);
    assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, 'Bearer test-only-key');
    assert.ok(!('temperature' in body)); assert.ok(!('reasoning_effort' in body));
    assert.ok(!('tools' in body));
    return jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(JSON.parse(body.messages[1].content).map(text => `译 ${text}`)) } }] });
  });
  assert.deepEqual(result, texts.map(text => `译 ${text}`)); assert.equal(requests.length, 2);
  for (const reason of ['length', 'content_filter', 'tool_calls']) {
    await assert.rejects(translateOpenAiApi(['hello'], 'en', 'zh', api, async () => jsonResponse({ choices: [{ finish_reason: reason, message: { content: '["hello"]' } }] })), /未完成翻译/);
  }
  assert.deepEqual(parseOpenAiTranslations('```json\n{"translations":["你好"]}\n```', 1), ['你好']);
  for (const content of ['[]', '[null]', '[{}]', '[""]', 'not json']) assert.throws(() => parseOpenAiTranslations(content, 1), /格式不正确|不完整/);
});

test('API reasoning can be omitted or explicitly set independently of CLI, including across batches', async () => {
  const texts = Array(21).fill('hello');
  for (const effort of ['', 'none', 'high']) {
    let calls = 0;
    await translateOpenAiApi(texts, 'en', 'zh', { ...api, openaiReasoningEffort: effort, codexReasoningEffort: 'low' }, async (_url, init) => {
      calls++;
      const body = JSON.parse(init.body);
      if (effort) assert.equal(body.reasoning_effort, effort);
      else assert.ok(!Object.hasOwn(body, 'reasoning_effort'));
      return jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(JSON.parse(body.messages[1].content).map(() => '你好')) } }] });
    });
    assert.equal(calls, 2);
  }
  let rejectedCalls = 0;
  await assert.rejects(translateOpenAiApi(['hello'], 'en', 'zh', { ...api, openaiReasoningEffort: 'none' }, async () => {
    rejectedCalls++;
    return jsonResponse({ error: { message: 'private-key-must-not-leak' } }, 400);
  }), error => /推理强度/.test(error.message) && !error.message.includes('private-key-must-not-leak'));
  assert.equal(rejectedCalls, 1, 'Unsupported effort must not be silently retried with a different setting');
});

test('API endpoint and credential validation prevent unsafe requests; provider errors never echo secrets', async () => {
  let calls = 0;
  const neverFetch = async () => { calls++; throw new Error('unexpected request'); };
  for (const endpoint of ['file:///tmp/key', 'http://example.test/v1/chat/completions', 'https://user:password@example.test/v1/chat/completions', 'not-a-url']) {
    await assert.rejects(listOpenAiApiModels({ ...api, openaiEndpoint: endpoint }, neverFetch));
  }
  await assert.rejects(listOpenAiApiModels({ ...api, openaiApiKey: '' }, neverFetch), /API Key/);
  await assert.rejects(listOpenAiApiModels({ ...api, openaiEndpoint: 'https://example.test/custom' }, neverFetch), /手动填写/);
  assert.equal(calls, 0);
  assert.equal(openaiApiOrigin('http://127.0.0.1:8080/v1/chat/completions'), 'http://127.0.0.1:8080/*');
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(listOpenAiApiModels(api, async () => jsonResponse({ error: { message: 'private-key-must-not-leak' } }, status)), error => !error.message.includes('private-key-must-not-leak'));
  }
  await assert.rejects(listOpenAiApiModels(api, async () => { throw new Error('private-key-must-not-leak'); }), error => /无法连接/.test(error.message) && !error.message.includes('private-key'));
});

test('background uses saved OpenAI mode for all translation callers, honors legacy IDs and restricts model discovery', async () => {
  const noEvent = { addListener() {} };
  let listener, permit = true, apiCalls = 0, nativePayload;
  const saved = { provider: 'openai', openaiConnection: 'cli', codexModel: 'saved-cli', codexReasoningEffort: 'low', openaiReasoningEffort: 'none', ...api, openaiModel: 'gpt-6.1-sol', openaiFastMode: true };
  const originalFetch = globalThis.fetch;
  globalThis.chrome = {
    runtime: { id: 'prism-test', getURL: path => `chrome-extension://prism-test/${path}`, onInstalled: noEvent, onStartup: noEvent,
      onMessage: { addListener(fn) { listener = fn; } },
      connectNative(name) {
        assert.equal(name, 'com.prism_translate.codex'); let reply;
        return { onMessage: { addListener(fn) { reply = fn; } }, onDisconnect: noEvent, disconnect() {},
          postMessage(payload) { nativePayload = payload; queueMicrotask(() => reply({ ok: true, result: { translations: payload.texts.map(() => 'CLI 译文') } })); } };
      } },
    contextMenus: { onClicked: noEvent }, commands: { onCommand: noEvent },
    tabs: { onCreated: noEvent, onReplaced: noEvent, onRemoved: noEvent },
    storage: { sync: { get: async () => ({ prismSettings: saved }) }, local: { get: async () => ({ prismSecrets: { openaiApiKey: api.openaiApiKey } }) } },
    permissions: { contains: async ({ origins }) => { assert.deepEqual(origins, ['https://api.openai.com/*']); return permit; } }
  };
  globalThis.fetch = async (url, init) => {
    apiCalls++; assert.equal(init.headers.Authorization, 'Bearer test-only-key');
    if (url.endsWith('/models')) return jsonResponse({ data: [{ id: 'account-model' }] });
    assert.equal(JSON.parse(init.body).reasoning_effort, 'none');
    assert.equal(JSON.parse(init.body).service_tier, 'fast');
    return jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: '["API 译文"]' } }] });
  };
  try {
    await import('../background.js');
    const sender = { id: 'prism-test', url: 'https://example.test/page' };
    const message = { type: 'PRISM_REMOTE_TRANSLATE', provider: 'openai', texts: ['hello'], sourceLanguage: 'en', targetLanguage: 'zh', connection: 'api', apiKey: 'ignored-message-key', reasoningEffort: 'high', openaiFastMode: false };
    const send = (msg = message, from = sender) => new Promise(resolve => assert.equal(listener(msg, from, resolve), true));
    assert.deepEqual(await send(), { ok: true, translations: ['CLI 译文'] });
    assert.equal(nativePayload.model, 'saved-cli'); assert.equal(nativePayload.effort, 'low');
    assert.equal(nativePayload.apiKey, undefined); assert.equal(nativePayload.service_tier, undefined); assert.equal(apiCalls, 0);
    saved.openaiConnection = 'api'; message.connection = 'cli';
    assert.deepEqual(await send(), { ok: true, translations: ['API 译文'] });
    permit = false;
    assert.equal((await send()).ok, false); assert.equal(apiCalls, 1);
    const modelsMessage = { type: 'PRISM_OPENAI_MODELS', endpoint: api.openaiEndpoint, apiKey: api.openaiApiKey };
    const extensionSender = { ...sender, url: 'chrome-extension://prism-test/sidepanel/sidepanel.html' };
    assert.equal(listener(modelsMessage, sender, () => assert.fail('untrusted page must not receive models')), false);
    assert.equal((await send(modelsMessage, extensionSender)).ok, false); assert.equal(apiCalls, 1);
    permit = true;
    assert.deepEqual((await send(modelsMessage, extensionSender)).models, [{ model: 'account-model', displayName: 'account-model' }]);
    saved.provider = 'codex'; delete saved.openaiConnection;
    assert.deepEqual(await send({ ...message, provider: 'codex' }), { ok: true, translations: ['CLI 译文'] });
    saved.provider = 'openai';
    assert.deepEqual(await send(), { ok: true, translations: ['API 译文'] });
  } finally { globalThis.fetch = originalFetch; delete globalThis.chrome; }
});
