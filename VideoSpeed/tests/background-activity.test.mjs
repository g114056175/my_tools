import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const version = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8')).version;
let importId = 0;

const makeEvent = () => ({
  listeners: [],
  addListener(listener) { this.listeners.push(listener); },
});

const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};

const within = (promise, label, timeoutMs = 5000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs);
  Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
});

async function waitFor(predicate, label, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function createChromeFixture({
  focusedWindowId = 1,
  activeTabIds = { 1: 10 },
  tabs: tabRows = [],
  activeByWindow = { 1: 10 },
  sessionSnapshot = { version: 1, focusedWindowId: 1, focusedTabId: 10, revision: 5, untilByTab: {}, activeByWindow },
  delaySessionRead = false,
  receivers = [10],
} = {}) {
  const events = Object.fromEntries([
    'runtimeMessage', 'runtimeConnect', 'runtimeInstalled', 'storageChanged',
    'tabsActivated', 'tabsCreated', 'tabsUpdated', 'tabsRemoved', 'windowFocusChanged', 'windowRemoved',
    'historyStateUpdated', 'referenceFragmentUpdated', 'navigationCommitted',
  ].map(name => [name, makeEvent()]));
  const settings = {
    enabled: true,
    preferredRate: 2,
    defaultMode: 'custom',
    customRate: 2,
    qualityEnabled: false,
    preferredQuality: 1080,
    steps: [1, 2],
    shortcuts: {},
    disabledSites: [],
    siteModes: {},
  };
  const localData = { settings, lastRate: 2, lastRateRevision: 1 };
  const sessionData = {};
  if (sessionSnapshot !== undefined) sessionData.tabActivity = sessionSnapshot;
  const sessionRead = deferred();
  const sessionReadStarted = deferred();
  const activitySaved = deferred();
  const tabs = new Map(tabRows.map(tab => [tab.id, { ...tab }]));
  for (const [windowId, tabId] of Object.entries(activeTabIds)) {
    const current = tabs.get(tabId) || { id: tabId, windowId: Number(windowId), url: `https://example.test/${tabId}`, status: 'complete' };
    current.windowId = Number(windowId);
    current.active = true;
    tabs.set(tabId, current);
  }
  const receiversSet = new Set(receivers);
  const activeQueries = [];
  const executePlans = [];
  const state = {
    focusedWindowId,
    localData,
    sessionData,
    tabs,
    receivers: receiversSet,
    messages: [],
    executeCalls: [],
    tabQueries: [],
  };
  const pick = (data, keys) => {
    const requested = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(requested.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]));
  };
  const activeTabs = windowId => [...tabs.values()].filter(tab => tab.windowId === windowId && tab.active);
  const chrome = {
    runtime: {
      getURL: path => `chrome-extension://videospeed-test/${path}`,
      onMessage: events.runtimeMessage,
      onConnect: events.runtimeConnect,
      onInstalled: events.runtimeInstalled,
    },
    i18n: { getUILanguage: () => 'zh-TW' },
    storage: {
      onChanged: events.storageChanged,
      local: {
        async get(keys) { return pick(localData, keys); },
        async set(values) { Object.assign(localData, values); },
        onChanged: events.storageChanged,
      },
      session: {
        async get(keys) {
          if (keys === 'tabActivity' && delaySessionRead) {
            sessionReadStarted.resolve();
            return sessionRead.promise;
          }
          return pick(sessionData, keys);
        },
        async set(values) {
          Object.assign(sessionData, values);
          if (Object.hasOwn(values, 'tabActivity')) activitySaved.resolve(values.tabActivity);
        },
      },
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged: events.windowFocusChanged,
      onRemoved: events.windowRemoved,
      async getLastFocused() {
        const id = state.focusedWindowId;
        return { id: Number.isInteger(id) ? id : -1, focused: Number.isInteger(id) };
      },
    },
    tabs: {
      onActivated: events.tabsActivated,
      onCreated: events.tabsCreated,
      onUpdated: events.tabsUpdated,
      onRemoved: events.tabsRemoved,
      async query(query) {
        state.tabQueries.push(query);
        if (query?.active && Number.isInteger(query.windowId)) {
          const planIndex = activeQueries.findIndex(plan => plan.windowId === query.windowId);
          if (planIndex >= 0) return activeQueries.splice(planIndex, 1)[0].deferred.promise;
          return activeTabs(query.windowId).map(tab => ({ ...tab }));
        }
        if (query?.url) return [...tabs.values()].filter(tab => /^https?:/.test(tab.url || '')).map(tab => ({ ...tab }));
        return [...tabs.values()].map(tab => ({ ...tab }));
      },
      async get(tabId) {
        const tab = tabs.get(tabId);
        if (!tab) throw new Error('No tab with id');
        return { ...tab };
      },
      async sendMessage(tabId, message) {
        const delivered = receiversSet.has(tabId);
        state.messages.push({ tabId, message, delivered });
        if (!delivered) throw new Error('Could not establish connection. Receiving end does not exist.');
        return { ok: true, version };
      },
    },
    webNavigation: {
      onHistoryStateUpdated: events.historyStateUpdated,
      onReferenceFragmentUpdated: events.referenceFragmentUpdated,
      onCommitted: events.navigationCommitted,
      async getAllFrames() { return []; },
    },
    action: { async setTitle() {}, async setIcon() {}, async openPopup() {} },
    scripting: {
      async executeScript(details) {
        state.executeCalls.push(details);
        if (executePlans.length) return executePlans.shift().promise;
        return [{ frameId: 0, result: false }];
      },
    },
  };
  globalThis.chrome = chrome;
  return {
    events,
    state,
    sessionRead,
    sessionReadStarted,
    activitySaved,
    planActiveQuery(windowId) {
      const value = deferred();
      activeQueries.push({ windowId, deferred: value });
      return value;
    },
    planExecuteScript() {
      const value = deferred();
      executePlans.push(value);
      return value;
    },
    setReceiver(tabId, enabled = true) {
      if (enabled) receiversSet.add(tabId);
      else receiversSet.delete(tabId);
    },
    setStatus(tabId, status) { tabs.get(tabId).status = status; },
    activate(tabId, windowId) {
      for (const tab of tabs.values()) if (tab.windowId === windowId) tab.active = false;
      const tab = tabs.get(tabId);
      if (!tab) throw new Error(`Unknown fixture tab ${tabId}`);
      tab.windowId = windowId;
      tab.active = true;
      events.tabsActivated.listeners[0]({ tabId, windowId });
    },
    focus(windowId) {
      this.state.focusedWindowId = windowId;
      events.windowFocusChanged.listeners[0](windowId);
    },
    updateStatus(tabId, status) {
      this.setStatus(tabId, status);
      events.tabsUpdated.listeners[0](tabId, { status });
    },
    async importBackground() {
      importId++;
      await import(`../extension/background.js?test=background-activity-${importId}`);
    },
    async sendRuntime(message, sender) {
      const listener = events.runtimeMessage.listeners[0];
      assert.ok(listener, 'background message listener was not registered');
      return new Promise(resolve => {
        listener({ scope: 'video-control', ...message }, sender, resolve);
      });
    },
  };
}

const contentSender = tabId => ({
  tab: { id: tabId, url: `https://example.test/${tabId}` },
  url: `https://example.test/${tabId}`,
  frameId: 0,
  documentId: `doc-${tabId}`,
});

async function waitForInitialSnapshot(fixture) {
  await within(fixture.activitySaved.promise, 'initial tab activity snapshot');
}

test('focus-query result is discarded after a newer focus change, preserving the briefly active tab grace', { timeout: 20000 }, async () => {
  const fixture = createChromeFixture({
    focusedWindowId: 1,
    activeTabIds: { 1: 10, 2: 20, 3: 30 },
    tabs: [
      { id: 10, windowId: 1, active: true, url: 'https://example.test/10', status: 'complete' },
      { id: 20, windowId: 2, active: true, url: 'https://example.test/20', status: 'complete' },
      { id: 30, windowId: 3, active: true, url: 'https://example.test/30', status: 'complete' },
    ],
    activeByWindow: { 1: 10, 2: 20, 3: 30 },
    sessionSnapshot: { version: 1, focusedWindowId: 1, focusedTabId: 10, revision: 5, untilByTab: {}, activeByWindow: { 1: 10 } },
    receivers: [10, 20, 30],
  });
  await fixture.importBackground();
  await waitForInitialSnapshot(fixture);

  const delayedWindowTwoQuery = fixture.planActiveQuery(2);
  fixture.activate(20, 2); // onActivated precedes the OS window focus notification.
  fixture.focus(2);
  await waitFor(() => fixture.state.tabQueries.some(query => query?.active && query.windowId === 2), 'window 2 focus query');
  fixture.focus(3); // this must blur tab 20 before the delayed query resolves.

  const beforeLateQuery = await fixture.sendRuntime({ action: 'settings' }, contentSender(20));
  assert.equal(beforeLateQuery.ok, true);
  assert.equal(beforeLateQuery.activity.focused, false);
  assert.ok(beforeLateQuery.activity.until > Date.now(), 'tab 20 did not receive a grace deadline');
  assert.ok(beforeLateQuery.activity.until <= Date.now() + 10_000);

  delayedWindowTwoQuery.resolve([{ id: 20, windowId: 2, active: true, url: 'https://example.test/20', status: 'complete' }]);
  await new Promise(resolve => setTimeout(resolve, 0));
  const afterLateQuery = await fixture.sendRuntime({ action: 'settings' }, contentSender(20));
  assert.deepEqual(afterLateQuery.activity, beforeLateQuery.activity, 'stale query changed the newer focus state');
});

test('loading tabs skip recovery injection and a completed recent tab receives the next activity update', { timeout: 20000 }, async () => {
  const fixture = createChromeFixture({
    focusedWindowId: 1,
    activeTabIds: { 1: 10 },
    tabs: [
      { id: 10, windowId: 1, active: true, url: 'https://example.test/10', status: 'complete' },
      { id: 20, windowId: 1, active: false, url: 'https://example.test/20', status: 'loading' },
    ],
    receivers: [10],
  });
  await fixture.importBackground();
  await waitForInitialSnapshot(fixture);

  fixture.activate(20, 1);
  await waitFor(() => fixture.state.messages.some(item => item.tabId === 20), 'first activity message to loading tab');
  assert.equal(fixture.state.executeCalls.length, 0, 'loading tab started a recovery injection before its receiver existed');

  fixture.setReceiver(20);
  fixture.updateStatus(20, 'complete');
  await waitFor(() => fixture.state.messages.some(item => item.tabId === 20 && item.delivered), 'activity message after document complete');
  const delivered = fixture.state.messages.findLast(item => item.tabId === 20 && item.delivered);
  assert.equal(delivered.message.activity.focused, true);
  assert.equal(fixture.state.executeCalls.length, 0, 'completed manifest receiver should not require recovery injection');
});

test('receiver recovery probe does not block later focus notifications and uses injectImmediately', { timeout: 20000 }, async () => {
  const fixture = createChromeFixture({
    focusedWindowId: 1,
    activeTabIds: { 1: 10, 2: 30 },
    tabs: [
      { id: 10, windowId: 1, active: true, url: 'https://example.test/10', status: 'complete' },
      { id: 20, windowId: 1, active: false, url: 'https://example.test/20', status: 'complete' },
      { id: 30, windowId: 2, active: true, url: 'https://example.test/30', status: 'complete' },
    ],
    activeByWindow: { 1: 10, 2: 30 },
    sessionSnapshot: { version: 1, focusedWindowId: 1, focusedTabId: 10, revision: 5, untilByTab: {}, activeByWindow: { 1: 10, 2: 30 } },
    receivers: [10, 30],
  });
  const probe = fixture.planExecuteScript();
  await fixture.importBackground();
  await waitForInitialSnapshot(fixture);

  fixture.activate(20, 1);
  await waitFor(() => fixture.state.executeCalls.length === 1, 'recovery probe for complete page');
  assert.equal(fixture.state.executeCalls[0].injectImmediately, true);

  const previousMessages = fixture.state.messages.filter(item => item.tabId === 20 && item.delivered).length;
  fixture.setReceiver(20);
  fixture.focus(2);
  await waitFor(() => fixture.state.messages.filter(item => item.tabId === 20 && item.delivered).length > previousMessages,
    'new focus notification while recovery probe is pending', 1500);
  assert.equal(fixture.state.executeCalls.length, 1, 'notification queued another injection instead of reaching the receiver');

  fixture.focus(1);
  const activeState = await fixture.sendRuntime({ action: 'settings' }, contentSender(20));
  assert.equal(activeState.activity.focused, true);
  assert.equal(fixture.state.executeCalls.length, 1);

  probe.resolve([{ frameId: 0, result: true }]);
  await waitFor(() => fixture.state.executeCalls.length === 3, 'bridge and content recovery scripts');
  await waitFor(() => fixture.state.messages.some(item => item.tabId === 20 && item.delivered && item.message.activity.focused), 'recovery completion follow-up');
  assert.ok(fixture.state.executeCalls.every(details => details.injectImmediately === true), 'an executeScript call omitted injectImmediately');
});

test('cold startup seeds the actual focused window before replaying buffered same-window activations', { timeout: 20000 }, async () => {
  const fixture = createChromeFixture({
    focusedWindowId: 1,
    activeTabIds: { 1: 21 },
    tabs: [
      { id: 20, windowId: 1, active: false, url: 'https://example.test/20', status: 'complete' },
      { id: 21, windowId: 1, active: true, url: 'https://example.test/21', status: 'complete' },
    ],
    activeByWindow: {},
    sessionSnapshot: undefined,
    delaySessionRead: true,
    receivers: [21],
  });
  await fixture.importBackground();
  await within(fixture.sessionReadStarted.promise, 'delayed session read');

  fixture.activate(20, 1);
  fixture.activate(21, 1);
  fixture.sessionRead.resolve({});

  const saved = await within(fixture.activitySaved.promise, 'cold-start activity snapshot');
  assert.equal(saved.focusedWindowId, 1);
  assert.equal(saved.focusedTabId, 21);
  assert.equal(saved.activeByWindow['1'], 21);
  const tab20State = await fixture.sendRuntime({ action: 'settings' }, contentSender(20));
  assert.equal(tab20State.activity.focused, false);
  assert.ok(tab20State.activity.until > Date.now(), 'buffered tab 20 activation was not replayed into a grace deadline');
});
