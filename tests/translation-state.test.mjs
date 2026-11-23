import test from 'node:test';
import assert from 'node:assert/strict';

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
