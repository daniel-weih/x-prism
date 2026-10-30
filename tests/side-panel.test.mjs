import test from 'node:test';
import assert from 'node:assert/strict';
import { configureSidePanels, configureTabPanel, openTabPanel, panelTabId, pendingActionKey } from '../shared/side-panel.js';
import { messageTab, TAB_ACCESS_ERROR } from '../shared/tab-access.js';

function mockPanels(ids = [11, 22]) {
  const options = new Map(), opened = new Set(), stored = {}, calls = [];
  let defaults = { path: 'old-global.html', enabled: true }, behavior;
  const api = {
    tabs: { query: async () => ids.map(id => ({ id })) },
    sidePanel: {
      async setOptions(value) {
        calls.push(['options', value]);
        if (value.tabId === undefined) defaults = { ...defaults, ...value };
        else options.set(value.tabId, { ...options.get(value.tabId), ...value });
      },
      async setPanelBehavior(value) { behavior = value; },
      async open({ tabId }) {
        calls.push(['open', tabId]);
        const panel = options.get(tabId) || defaults;
        if (!panel.enabled) throw new Error('No active side panel');
        // Chrome falls back to its window-wide panel without tab options.
        opened.add(options.has(tabId) ? tabId : 'global');
      }
    },
    storage: { session: {
      async get(key) { return { [key]: stored[key] }; },
      async set(patch) { calls.push(['store', Object.keys(patch)]); Object.assign(stored, patch); },
      async remove(key) { delete stored[key]; }
    } }
  };
  return { api, options, opened, stored, calls, get behavior() { return behavior; },
    visible: tabId => opened.has(tabId) || opened.has('global') };
}

test('side panels are independent across existing and new tabs, with no global fallback', async () => {
  const m = mockPanels();
  await configureSidePanels(m.api);
  assert.deepEqual(m.behavior, { openPanelOnActionClick: true });
  assert.equal(m.calls[0][1].enabled, false);
  await m.api.sidePanel.open({ tabId: 11 }); // Toolbar behavior opens the prepared tab instance.
  assert.equal(m.visible(11), true); assert.equal(m.visible(22), false);
  assert.equal(m.options.get(11).path, 'sidepanel/sidepanel.html?tabId=11');
  assert.equal(m.options.get(22).path, 'sidepanel/sidepanel.html?tabId=22');
  await configureTabPanel(m.api, 33);
  assert.equal(m.visible(33), false);
  await m.api.sidePanel.open({ tabId: 22 });
  assert.equal(m.visible(11), true); assert.equal(m.visible(22), true); assert.equal(m.visible(33), false);
  await assert.rejects(m.api.sidePanel.open({ tabId: 44 }), /No active/);
  assert.equal(m.opened.has('global'), false);
});

test('tab setup tolerates a tab closing during startup but surfaces other errors', async () => {
  const m = mockPanels();
  const setOptions = m.api.sidePanel.setOptions;
  m.api.sidePanel.setOptions = async value => {
    if (value.tabId === 22) throw new Error('No tab with id: 22.');
    return setOptions(value);
  };
  await configureSidePanels(m.api);
  assert.ok(m.options.has(11)); assert.ok(m.behavior.openPanelOnActionClick);
  m.api.sidePanel.setOptions = async () => { throw new Error('unexpected setup failure'); };
  await assert.rejects(configureSidePanels(m.api), /unexpected setup failure/);
});

test('selection actions stay with their owning tab and open is issued before asynchronous storage', async () => {
  const m = mockPanels();
  await configureSidePanels(m.api);
  m.calls.length = 0;
  const first = openTabPanel(m.api, 11, { type: 'selection', text: 'first' });
  assert.deepEqual(m.calls[0], ['open', 11], 'Do not await storage before the gesture-bound open');
  await Promise.all([first, openTabPanel(m.api, 22, { type: 'selection', text: 'second' })]);
  assert.equal(m.stored[pendingActionKey(11)].text, 'first');
  assert.equal(m.stored[pendingActionKey(22)].text, 'second');
  assert.notEqual(m.stored[pendingActionKey(11)].id, m.stored[pendingActionKey(22)].id);
  assert.equal(m.stored.prismPendingAction, undefined);
  await assert.rejects(openTabPanel(m.api, -1, { type: 'page' }), /No target tab/);
});

test('a failed panel open queues no action and leaves other pending work untouched', async () => {
  const m = mockPanels();
  m.api.sidePanel.open = async () => { throw new Error('gesture expired'); };
  await assert.rejects(openTabPanel(m.api, 11, { type: 'page' }), /gesture expired/);
  assert.equal(m.stored[pendingActionKey(11)], undefined);
  m.stored[pendingActionKey(11)] = { id: 'newer-action', tabId: 11, type: 'selection' };
  await assert.rejects(openTabPanel(m.api, 11, { type: 'page' }), /gesture expired/);
  assert.equal(m.stored[pendingActionKey(11)].id, 'newer-action');
});

test('page translation and recovery stay on the owning tab after focus moves; a closed tab never redirects', async () => {
  let active = 11, closed = false, first = true;
  const messages = [], injections = [];
  const tabs = {
    async query() { throw new Error(`Must not use active tab ${active}`); },
    async get(id) { if (closed) throw new Error('No tab'); return { id }; },
    async sendMessage(id, message) {
      messages.push([id, message.type]);
      if (first) { first = false; throw new Error('Receiving end does not exist'); }
      return { ok: true, items: [{ id: 'p1', text: 'hello' }] };
    }
  };
  await messageTab(tabs, { type: 'PRISM_COLLECT_PAGE' }, async id => injections.push(id), 11);
  active = 22;
  await messageTab(tabs, { type: 'PRISM_APPLY_PAGE_BATCH' }, undefined, 11);
  assert.deepEqual(injections, [11]);
  assert.ok(messages.every(([id]) => id === 11));
  assert.equal(messages.at(-1)[1], 'PRISM_APPLY_PAGE_BATCH');
  closed = true;
  await assert.rejects(messageTab(tabs, { type: 'PRISM_RESTORE_PAGE' }, undefined, 11), error => error.code === TAB_ACCESS_ERROR.noActiveTab);
  assert.equal(messages.length, 3);
});

test('panel ownership is explicit in its URL, with no accidental tab zero default', () => {
  const base = 'chrome-extension://prism/sidepanel/sidepanel.html';
  assert.equal(panelTabId(base), null);
  assert.equal(panelTabId(`${base}?tabId=11`), 11);
  for (const value of ['', '-1', 'NaN', '1.5']) assert.equal(panelTabId(`${base}?tabId=${value}`), null);
});

test('background prepares new/replaced tabs and routes context-menu and bubble actions to their source', async () => {
  const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
  const m = mockPanels();
  const noEvent = event();
  const runtime = { id: 'prism-test', onInstalled: noEvent, onStartup: noEvent, onMessage: event() };
  const contextMenus = { onClicked: event() }, commands = { onCommand: event() };
  let pageConnected = false;
  const tabs = { ...m.api.tabs, onCreated: event(), onReplaced: event(), onRemoved: event(),
    sendMessage(_id, _message, callback) {
      runtime.lastError = pageConnected ? undefined : { message: 'No content script' };
      callback(); runtime.lastError = undefined;
    }
  };
  globalThis.chrome = { ...m.api, runtime, tabs, contextMenus, commands };
  try {
    await import('../background.js?tab-panel-routing');
    tabs.onCreated.listeners[0]({ id: 11 });
    tabs.onCreated.listeners[0]({ id: 22 });
    const listener = runtime.onMessage.listeners[0];
    const response = await new Promise(resolve => {
      assert.equal(listener({ type: 'PRISM_OPEN_PANEL', action: { type: 'selection', text: 'bubble' } }, { id: runtime.id, tab: { id: 11 } }, resolve), true);
    });
    assert.equal(response.ok, true);
    assert.equal(m.stored[pendingActionKey(11)].text, 'bubble');
    contextMenus.onClicked.listeners[0]({ menuItemId: 'prism-translate-selection', selectionText: 'context' }, { id: 22 });
    await Promise.resolve();
    assert.equal(m.stored[pendingActionKey(22)].text, 'context');
    commands.onCommand.listeners[0]('toggle-page-translation', { id: 11 });
    await Promise.resolve();
    assert.equal(m.stored[pendingActionKey(11)].type, 'page');
    const openCount = m.calls.filter(([type]) => type === 'open').length;
    pageConnected = true;
    commands.onCommand.listeners[0]('translate-selection', { id: 11 });
    assert.equal(m.calls.filter(([type]) => type === 'open').length, openCount);
    tabs.onReplaced.listeners[0](33, 22);
    assert.ok(m.options.has(33)); assert.equal(m.stored[pendingActionKey(22)], undefined);
    tabs.onRemoved.listeners[0](11);
    assert.equal(m.stored[pendingActionKey(11)], undefined);
  } finally { delete globalThis.chrome; }
});
