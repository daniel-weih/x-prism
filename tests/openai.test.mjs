import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings } from '../shared/config.js';
import { ensureDefaults, getSettings, saveSettings } from '../shared/storage.js';
import { listOpenAiApiModels, translateOpenAiApi, parseOpenAiTranslations, openaiApiOrigin, openAiTranslationTiers } from '../shared/openai-api.js';

const api = { openaiEndpoint: 'https://api.openai.com/v1/responses', openaiApiKey: 'test-only-key', openaiModel: 'test-chat-model' };
const legacyEndpoint = 'https://api.openai.com/v1/chat/completions';
const jsonResponse = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });
const outputMessage = (text, phase) => ({ type: 'message', role: 'assistant', phase, content: [{ type: 'output_text', text }] });
const completed = (...output) => jsonResponse({ status: 'completed', output });

test('legacy Codex and API selections migrate to distinct OpenAI modes without changing models or history', async () => {
  for (const [provider, mode] of [['codex', 'cli'], ['openai', 'api']]) {
    const model = 'gpt-6.1-sol';
    const memory = { sync: { prismSettings: { provider, ...api, openaiEndpoint: legacyEndpoint, openaiModel: model, openaiFastMode: provider === 'openai', codexModel: 'saved-cli', codexReasoningEffort: 'low' } }, local: { prismHistory: [{ id: 'keep-history' }] } };
    const area = name => ({ get: async key => ({ [key]: memory[name][key] }), set: async patch => Object.assign(memory[name], structuredClone(patch)) });
    globalThis.chrome = { storage: { sync: area('sync'), local: area('local') } };
    try {
      await ensureDefaults();
      await ensureDefaults();
      const migrated = await getSettings();
      assert.equal(migrated.provider, 'openai'); assert.equal(migrated.openaiConnection, mode);
      assert.equal(migrated.codexModel, 'saved-cli'); assert.equal(migrated.codexReasoningEffort, 'low');
      assert.equal(migrated.openaiModel, model); assert.equal(migrated.openaiEndpoint, api.openaiEndpoint);
      assert.equal(memory.sync.prismSettings.openaiEndpoint, api.openaiEndpoint);
      assert.equal(migrated.openaiApiKey, api.openaiApiKey);
      assert.equal(migrated.openaiReasoningEffort, '');
      assert.equal(migrated.openaiServiceTier, provider === 'openai' ? 'fast' : 'default');
      assert.ok(!Object.hasOwn(memory.sync.prismSettings, 'openaiFastMode'));
      await saveSettings({ openaiReasoningEffort: 'none', openaiServiceTier: 'ultrafast' });
      await saveSettings({ openaiConnection: mode === 'cli' ? 'api' : 'cli' });
      const switched = await getSettings();
      assert.notEqual(switched.openaiConnection, mode);
      assert.equal(switched.codexModel, 'saved-cli'); assert.equal(switched.openaiModel, model);
      assert.equal(switched.codexReasoningEffort, 'low'); assert.equal(switched.openaiReasoningEffort, 'none');
      assert.equal(switched.openaiServiceTier, 'ultrafast');
      await saveSettings({ openaiServiceTier: 'default' });
      assert.equal((await getSettings()).openaiServiceTier, 'default');
      assert.ok(!JSON.stringify(memory.sync).includes(api.openaiApiKey));
      assert.equal(memory.local.prismSecrets.openaiApiKey, api.openaiApiKey);
      assert.deepEqual(memory.local.prismHistory, [{ id: 'keep-history' }]);
    } finally { delete globalThis.chrome; }
  }
  assert.equal(normalizeSettings().openaiConnection, 'api');
  assert.equal(normalizeSettings().openaiEndpoint, api.openaiEndpoint);
  const custom = 'https://proxy.example/tenant/chat/completions?route=test';
  assert.equal(normalizeSettings({ openaiEndpoint: custom }).openaiEndpoint, custom);
  assert.equal(normalizeSettings({ openaiReasoningEffort: 'invalid' }).openaiReasoningEffort, '');
  assert.equal(normalizeSettings({ provider: 'openai', openaiConnection: 'cli' }).openaiConnection, 'cli');
  assert.equal(normalizeSettings({ provider: 'kimi', kimiConnection: 'api' }).provider, 'kimi');
});

test('Fast is opt-in for documented text models and controls every translation batch', async () => {
  for (const model of ['gpt-6.2-sol', 'gpt-6.2-astra', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-astra', 'gpt-5.6-luna', 'gpt-4.1-mini-2025-04-14', 'o3']) assert.ok(openAiTranslationTiers(model, api.openaiEndpoint).includes('fast'));
  for (const model of ['', 'gpt-99', 'gpt-5-nano', 'gpt-5-pro', 'gpt-audio-1.5', 'gpt-realtime-2.1', 'ft:gpt-4.1:example', 'gpt-4.1-other', 'kimi-k3']) assert.deepEqual(openAiTranslationTiers(model, api.openaiEndpoint), ['default']);
  assert.equal(normalizeSettings({ openaiModel: 'gpt-6.1-sol', openaiFastMode: 'false' }).openaiServiceTier, 'default');
  assert.equal(normalizeSettings({ openaiModel: 'gpt-6.1-sol', openaiFastMode: true, openaiServiceTier: 'default' }).openaiServiceTier, 'default');
  const cases = [
    [{ openaiModel: 'gpt-6.1-sol', openaiServiceTier: 'fast' }, 'fast'],
    [{ openaiModel: 'gpt-4.1-mini-2025-04-14', openaiServiceTier: 'fast' }, 'fast'],
    [{ openaiModel: 'gpt-6.1-sol', openaiServiceTier: 'default' }, 'default'],
    [{ openaiModel: 'gpt-6.1-sol' }, 'default'],
    [{ openaiModel: 'gpt-6.1-sol', openaiServiceTier: 'fast', openaiEndpoint: 'https://proxy.example/v1/chat/completions' }, 'fast'],
    [{ openaiModel: 'gpt-6.1-sol', openaiServiceTier: 'default', openaiEndpoint: 'https://proxy.example/v1/chat/completions' }, undefined],
    [{ openaiModel: 'gpt-6.1-sol', openaiServiceTier: 'ultrafast', openaiEndpoint: 'https://proxy.example/v1/chat/completions' }, undefined],
    [{ openaiModel: 'gpt-6.1-terra', openaiServiceTier: 'ultrafast' }, 'default'],
    [{ openaiModel: 'gpt-99', openaiServiceTier: 'fast' }, 'default'],
    [{ openaiModel: 'kimi-k3', openaiServiceTier: 'fast', openaiEndpoint: 'https://proxy.example/v1/chat/completions' }, undefined]
  ];
  for (const [patch, expectedTier] of cases) {
    let calls = 0;
    const result = await translateOpenAiApi(Array(21).fill('hello'), 'en', 'zh', { ...api, ...patch, openaiReasoningEffort: 'low' }, async (url, init) => {
      calls++;
      assert.equal(url, patch.openaiEndpoint ?? api.openaiEndpoint);
      const body = JSON.parse(init.body);
      assert.equal(body.service_tier, expectedTier);
      if (url === api.openaiEndpoint) {
        assert.deepEqual(body.reasoning, { effort: 'low' });
        assert.equal(body.store, false);
        return completed(outputMessage(JSON.stringify(JSON.parse(body.input).map(() => '你好'))));
      }
      assert.equal(body.reasoning_effort, 'low');
      return jsonResponse({ service_tier: 'default', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(JSON.parse(body.messages[1].content).map(() => '你好')) } }] });
    });
    assert.equal(calls, 2);
    assert.equal(result.length, 21, 'A server-side downgrade still returns the translation');
  }
});

test('every official tier sends the same Responses payload across batches, including with a legacy endpoint', async () => {
  for (const model of ['gpt-6.2-astra', 'gpt-6.2-sol', 'gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.1-sol-2026-11-01']) {
    assert.deepEqual(openAiTranslationTiers(model, api.openaiEndpoint), ['default', 'fast', 'ultrafast']);
  }
  for (const endpoint of ['https://api.openai.com/custom', 'https://eu.api.openai.com/v1/chat/completions', 'https://api.openai.com.example/v1/chat/completions', 'incomplete']) {
    assert.deepEqual(openAiTranslationTiers('gpt-6.2-sol', endpoint), ['default', 'fast']);
  }
  const settings = { ...api, openaiModel: 'gpt-6.2-sol', openaiReasoningEffort: 'low', openaiEndpoint: legacyEndpoint + '/?option=test' };
  const texts = Array.from({ length: 21 }, (_, i) => `text ${i}`);
  let calls = 0;
  async function fetchBatch(url, init, tier) {
    calls++;
    assert.equal(url, api.openaiEndpoint + '?option=test');
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    const body = JSON.parse(init.body);
    assert.deepEqual(Object.keys(body).sort(), ['input', 'instructions', 'model', 'reasoning', 'service_tier', 'store', 'stream']);
    assert.equal(body.model, 'gpt-6.2-sol');
    assert.equal(body.service_tier, tier);
    assert.equal(body.store, false);
    assert.equal(body.stream, false);
    assert.deepEqual(body.reasoning, { effort: 'low' });
    assert.match(body.instructions, /from en to zh/);
    const translated = JSON.parse(body.input).map(text => `译 ${text}`);
    return completed({ type: 'reasoning' }, outputMessage('Working…', 'commentary'), outputMessage(JSON.stringify(translated), 'final_answer'));
  }
  for (const tier of ['default', 'fast', 'ultrafast']) {
    const result = await translateOpenAiApi(texts, 'en', 'zh', { ...settings, openaiServiceTier: tier }, (url, init) => fetchBatch(url, init, tier));
    assert.deepEqual(result, texts.map(text => `译 ${text}`));
  }
  assert.equal(calls, 6);
  await assert.rejects(translateOpenAiApi(['hello'], 'en', 'zh', settings, async () => jsonResponse({ status: 'incomplete', output: [] })), /未完成翻译/);
});

test('Accelerated tier rejection is actionable, redacts provider details, and never silently retries', async () => {
  for (const [tier, label, status, error] of [
    ['fast', 'Fast', 400, { param: 'service_tier', message: 'private-key-must-not-leak' }],
    ['ultrafast', 'Ultrafast', 400, { message: 'Unsupported service_tier: private-key-must-not-leak' }],
    ['ultrafast', 'Ultrafast', 403, { message: 'private-key-must-not-leak' }]
  ]) {
    let calls = 0;
    await assert.rejects(translateOpenAiApi(['hello'], 'en', 'zh', { ...api, openaiModel: 'gpt-6.1-sol', openaiServiceTier: tier, openaiReasoningEffort: 'high' }, async () => {
      calls++;
      return jsonResponse({ error }, status);
    }), e => e.message.includes(label) && /切换/.test(e.message) && !e.message.includes('private-key'));
    assert.equal(calls, 1);
  }
});

test('API model discovery uses the selected endpoint and key, supports a custom base path and deduplicates model IDs', async () => {
  for (const [endpoint, models] of [
    [api.openaiEndpoint, 'https://api.openai.com/v1/models'],
    [legacyEndpoint, 'https://api.openai.com/v1/models'],
    ['https://example.test/proxy/v1/chat/completions/', 'https://example.test/proxy/v1/models'],
    ['https://example.test/proxy/v1/responses?route=test', 'https://example.test/proxy/v1/models?route=test']
  ]) {
    const result = await listOpenAiApiModels({ ...api, openaiEndpoint: endpoint }, async (url, init) => {
      assert.equal(url, models);
      assert.equal(init.method, 'GET'); assert.equal(init.body, undefined);
      assert.equal(init.headers.Authorization, 'Bearer test-only-key');
      assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
      return jsonResponse({ data: [{ id: 'gpt-6.2-sol' }, { id: 'gpt-audio-1.5' }, { id: 'account-model' }, null, { id: '' }, { id: 'gpt-6.2-sol' }] });
    });
    const expected = endpoint === legacyEndpoint || endpoint === api.openaiEndpoint
      ? ['gpt-6.2-sol'] : ['gpt-6.2-sol', 'gpt-audio-1.5', 'account-model'];
    assert.deepEqual(result.models, expected.map(model => ({ model, displayName: model })));
  }
  await assert.rejects(listOpenAiApiModels(api, async () => jsonResponse({ data: [] })), /未返回可用模型/);
});

test('official translation filters model suggestions and rejects saved speech models before sending', async () => {
  const supported = ['gpt-6.2-astra', 'gpt-5.4-nano', 'gpt-4.1-mini-2025-04-14', 'ft:gpt-4.1-mini-2025-04-14:example:demo:id'];
  const excluded = ['gpt-audio-1.5', 'gpt-live-1.1', 'gpt-realtime-2.1-mini', 'gpt-image-2.6-flare',
    'gpt-4o-mini-tts', 'gpt-4o-transcribe', 'whisper-1', 'text-embedding-3-small', 'omni-moderation-latest'];
  const catalog = ids => async () => jsonResponse({ data: ids.map(id => ({ id })) });
  assert.deepEqual((await listOpenAiApiModels(api, catalog([...excluded, ...supported]))).models.map(item => item.model), supported);
  await assert.rejects(listOpenAiApiModels(api, catalog(excluded)), /未返回可用模型/);
  for (const model of excluded) {
    const settings = { ...api, openaiEndpoint: legacyEndpoint, openaiModel: model, speechModel: 'gpt-audio-1.5' };
    const migrated = normalizeSettings(settings);
    assert.equal(migrated.openaiModel, '');
    assert.equal(migrated.speechModel, 'gpt-audio-1.5');
    await assert.rejects(translateOpenAiApi(['hello'], 'en', 'zh', settings, () => assert.fail('unexpected request')), /Responses API/);
    assert.equal(normalizeSettings({ ...settings, openaiEndpoint: 'https://example.test/v1/responses' }).openaiModel, model);
  }
  assert.equal(normalizeSettings({ ...api, openaiModel: 'new-text-model' }).openaiModel, 'new-text-model');
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
    return completed(outputMessage(JSON.stringify(JSON.parse(body.input).map(text => `译 ${text}`))));
  });
  assert.deepEqual(result, texts.map(text => `译 ${text}`)); assert.equal(requests.length, 2);
  for (const reason of ['length', 'content_filter', 'tool_calls']) {
    const customChat = { ...api, openaiEndpoint: 'https://proxy.example/v1/chat/completions' };
    await assert.rejects(translateOpenAiApi(['hello'], 'en', 'zh', customChat, async () => jsonResponse({ choices: [{ finish_reason: reason, message: { content: '["hello"]' } }] })), /未完成翻译/);
  }
  await assert.rejects(translateOpenAiApi(['hello'], 'en', 'zh', api, async () => completed(outputMessage('["Commentary only"]', 'commentary'))), /格式不正确|未完成翻译/);
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
      if (effort) assert.deepEqual(body.reasoning, { effort });
      else assert.ok(!Object.hasOwn(body, 'reasoning'));
      return completed(outputMessage(JSON.stringify(JSON.parse(body.input).map(() => '你好'))));
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
  const saved = { provider: 'openai', openaiConnection: 'cli', codexModel: 'saved-cli', codexReasoningEffort: 'low', openaiReasoningEffort: 'low', ...api, openaiEndpoint: legacyEndpoint, openaiModel: 'gpt-6.1-sol', openaiFastMode: true };
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
    if (url.endsWith('/models')) return jsonResponse({ data: [{ id: 'gpt-realtime-2.1' }, { id: 'gpt-6.2-sol' }] });
    assert.equal(url, api.openaiEndpoint);
    const body = JSON.parse(init.body);
    assert.deepEqual(body.reasoning, { effort: 'low' });
    assert.equal(body.service_tier, saved.openaiServiceTier ?? 'fast');
    return completed(outputMessage(body.service_tier === 'ultrafast' ? '["Ultrafast 译文"]' : '["API 译文"]'));
  };
  try {
    await import('../background.js');
    const sender = { id: 'prism-test', url: 'https://example.test/page' };
    const message = { type: 'PRISM_REMOTE_TRANSLATE', provider: 'openai', texts: ['hello'], sourceLanguage: 'en', targetLanguage: 'zh', connection: 'api', apiKey: 'ignored-message-key', reasoningEffort: 'high', openaiServiceTier: 'default' };
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
    assert.deepEqual((await send(modelsMessage, extensionSender)).models, [{ model: 'gpt-6.2-sol', displayName: 'gpt-6.2-sol' }]);
    saved.provider = 'codex'; delete saved.openaiConnection;
    assert.deepEqual(await send({ ...message, provider: 'codex' }), { ok: true, translations: ['CLI 译文'] });
    saved.provider = 'openai';
    assert.deepEqual(await send(), { ok: true, translations: ['API 译文'] });
    saved.openaiServiceTier = 'ultrafast';
    assert.deepEqual(await send(), { ok: true, translations: ['Ultrafast 译文'] });
  } finally { globalThis.fetch = originalFetch; delete globalThis.chrome; }
});
