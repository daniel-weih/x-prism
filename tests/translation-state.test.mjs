import test from 'node:test';
import assert from 'node:assert/strict';
import { addHistory, clearHistory, getHistory, toggleFavorite } from '../shared/storage.js';
import { splitForMyMemory, myMemoryTranslation } from '../shared/mymemory.js';

const settings = { provider: 'chrome', sourceLanguage: 'en', targetLanguage: 'zh' };
const freshTranslator = () => import(`../shared/translator.js?test=${crypto.randomUUID()}`);

test('an installed language detector never displays a model download while awaiting the API', async () => {
  let finish, requested;
  const started = new Promise(resolve => { requested = resolve; });
  globalThis.LanguageDetector = {
    availability: async () => 'available',
    create: async options => {
      assert.equal(options?.monitor, undefined, 'Installed detection is not a download');
      return { detect: async () => [{ detectedLanguage: 'en' }] };
    }
  };
  globalThis.chrome = { runtime: { sendMessage: () => { requested(); return new Promise(resolve => { finish = resolve; }); } } };
  try {
    const { translateMany } = await freshTranslator();
    const progress = [];
    const pending = translateMany(['hello'], { ...settings, sourceLanguage: 'auto', provider: 'openai' }, event => progress.push(event));
    await started;
    assert.deepEqual(progress.map(event => event.phase), ['detect', 'translate']);
    assert.equal(progress.at(-1).completed, 0);
    finish({ ok: true, translations: ['你好'] });
    assert.deepEqual((await pending).translations, ['你好']);
  } finally { delete globalThis.LanguageDetector; delete globalThis.chrome; }
});

test('local download completes into preparation and then zero-progress translation before results', async () => {
  let finish, translating;
  const started = new Promise(resolve => { translating = resolve; });
  globalThis.Translator = {
    availability: async () => 'downloadable',
    create: async ({ monitor }) => {
      monitor({ addEventListener(name, listener) { assert.equal(name, 'downloadprogress'); listener({ loaded: 0.4 }); listener({ loaded: 1 }); } });
      return { translate: () => { translating(); return new Promise(resolve => { finish = resolve; }); } };
    }
  };
  try {
    const { translateMany } = await freshTranslator();
    const progress = [];
    const pending = translateMany(['hello'], settings, event => progress.push(event));
    await started;
    assert.deepEqual(progress.map(event => event.phase), ['download', 'prepare', 'translate']);
    assert.equal(progress.at(-1).completed, 0);
    finish('你好'); await pending;
    assert.equal(progress.at(-1).completed, 1);
  } finally { delete globalThis.Translator; }
});

test('installed local packs skip download UI and a failed initialization can be retried', async () => {
  let attempts = 0;
  globalThis.Translator = {
    availability: async () => 'available',
    create: async options => {
      assert.equal(options.monitor, undefined);
      if (++attempts === 1) throw new Error('temporary initialization failure');
      return { translate: async () => '你好' };
    }
  };
  try {
    const { translateMany } = await freshTranslator();
    await assert.rejects(translateMany(['hello'], settings), /temporary/);
    const progress = [];
    await translateMany(['hello'], settings, event => progress.push(event));
    assert.ok(progress.every(event => event.phase === 'translate'));
    assert.equal(attempts, 2);
  } finally { delete globalThis.Translator; }
});

test('simultaneous history saves preserve every entry and repeating a translation preserves its favorite', async () => {
  const data = {};
  globalThis.chrome = { storage: { local: {
    get: async key => ({ [key]: structuredClone(data[key]) }),
    set: async patch => { await Promise.resolve(); Object.assign(data, structuredClone(patch)); }
  } } };
  try {
    await Promise.all(Array.from({ length: 12 }, (_, index) => addHistory({ sourceText: `text ${index}`, translatedText: `译文 ${index}` })));
    assert.equal((await getHistory()).length, 12);
    const entry = (await getHistory())[0];
    await toggleFavorite(entry.id);
    await addHistory({ sourceText: entry.sourceText, translatedText: entry.translatedText });
    const repeated = (await getHistory())[0];
    assert.equal(repeated.favorite, true); assert.equal(repeated.id, entry.id);
    assert.equal((await getHistory()).length, 12);
    await clearHistory(); assert.equal((await getHistory()).length, 0);
  } finally { delete globalThis.chrome; }
});

test('history write failure does not poison subsequent saves', async () => {
  let fail = true; const data = {};
  globalThis.chrome = { storage: { local: {
    get: async key => ({ [key]: data[key] }),
    set: async patch => { if (fail) { fail = false; throw new Error('storage full'); } Object.assign(data, patch); }
  } } };
  try {
    await assert.rejects(addHistory({ sourceText: 'first' }), /storage full/);
    await addHistory({ sourceText: 'second' });
    assert.equal((await getHistory())[0].sourceText, 'second');
  } finally { delete globalThis.chrome; }
});

test('MyMemory splits by UTF-8 size without corrupting Unicode and rejects API errors inside HTTP 200', () => {
  for (const text of ['中文测试'.repeat(200), 'A😀 B '.repeat(200), 'English translation sentence. '.repeat(100)]) {
    const chunks = splitForMyMemory(text);
    assert.equal(chunks.join(''), text);
    assert.ok(chunks.every(chunk => new TextEncoder().encode(chunk).length <= 450));
    assert.ok(chunks.every(chunk => !chunk.includes('\ufffd')));
  }
  assert.throws(() => myMemoryTranslation({ responseStatus: 403, responseData: { translatedText: 'QUOTA ERROR' } }), /failed/);
  assert.equal(myMemoryTranslation({ responseStatus: 200, responseData: { translatedText: '你好' } }), '你好');
});
