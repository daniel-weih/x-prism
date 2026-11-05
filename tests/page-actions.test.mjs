import test from 'node:test';
import assert from 'node:assert/strict';
import { relayReaderControl, relayReaderMessage, runPageAction } from '../shared/page-actions.js';

test('reader controls stay in the sending top-level tab and reject invalid callers', async () => {
  const calls = [];
  const api = { runtime: { id: 'prism-test' }, tabs: { sendMessage: async (...args) => { calls.push(args); return { ok: true }; } } };
  const sender = { id: api.runtime.id, frameId: 0, tab: { id: 22 } };
  const request = { session: '11111111-1111-4111-8111-111111111111', revision: 2, tabId: 99 };
  await relayReaderControl(api, sender, request);
  assert.deepEqual(calls, [[22, { type: 'PRISM_READER_TOGGLE', session: request.session, revision: 2 }]]);
  for (const invalid of [{ ...sender, id: 'foreign' }, { ...sender, frameId: 3 }, { ...sender, tab: undefined }]) {
    await assert.rejects(relayReaderControl(api, invalid, request), /Invalid reading control/);
  }
  for (const invalid of [{ ...request, session: '' }, { ...request, revision: 0 }, { ...request, revision: 1.5 }]) {
    await assert.rejects(relayReaderControl(api, sender, invalid), /Invalid reading control/);
  }
  assert.equal(calls.length, 1);
});

test('reader relay binds its iframe to the owning tab and permits only reader operations', async () => {
  const session = '11111111-1111-4111-8111-111111111111';
  const calls = [];
  const api = { runtime: { id: 'prism-test', getURL: path => `chrome-extension://prism-test/${path}` },
    tabs: { sendMessage: async (...args) => { calls.push(args); return { ok: true }; } } };
  const sender = { id: api.runtime.id, tab: { id: 22 }, frameId: 3, url: api.runtime.getURL(`reader/reader.html?session=${session}`) };
  const request = { session, tabId: 99, message: { type: 'PRISM_READER_ATTACH', readerSession: 'spoofed' } };
  await relayReaderMessage(api, sender, request);
  assert.deepEqual(calls[0], [22, { type: 'PRISM_READER_ATTACH', readerSession: session }, { frameId: 0 }]);
  for (const type of ['PRISM_READER_STATE', 'PRISM_READER_COLLAPSE']) {
    await relayReaderMessage(api, sender, { ...request, message: { type, state: 'paused', progress: .5 } });
    assert.deepEqual(calls.at(-1), [22, { type, state: 'paused', progress: .5, readerSession: session }, { frameId: 0 }]);
  }
  for (const invalid of [
    { ...sender, id: 'another-extension' }, { ...sender, tab: undefined }, { ...sender, frameId: 0 },
    { ...sender, url: `https://example.test/reader/reader.html?session=${session}` },
    { ...sender, url: `chrome-extension://another-extension/reader/reader.html?session=${session}` },
    { ...sender, url: sender.url.replace(session, 'not-current') }
  ]) await assert.rejects(relayReaderMessage(api, invalid, request), /Invalid reader/);
  await assert.rejects(relayReaderMessage(api, sender, { ...request, message: { type: 'PRISM_REMOTE_TRANSLATE' } }), /Invalid reader/);
  assert.equal(calls.length, 3);
});

test('page action recovery never redirects a closed owning tab to another active tab', async () => {
  let queried = false, sent = false;
  const api = { tabs: { get: async () => { throw new Error('No tab'); }, query: async () => { queried = true; return [{ id: 99 }]; }, sendMessage: async () => { sent = true; } } };
  await assert.rejects(runPageAction(api, 22, { type: 'read-page' }));
  await assert.rejects(runPageAction(api, undefined, { type: 'page' }));
  assert.equal(queried, false); assert.equal(sent, false);
});
