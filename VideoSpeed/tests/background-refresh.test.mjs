import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;

const makeEvent = () => ({
  listeners: [],
  addListener(listener) { this.listeners.push(listener); },
});

const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};

const within = (promise, label) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 5000);
  Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
});

function createChromeFixture() {
  const events = Object.fromEntries([
    'runtimeMessage', 'runtimeConnect', 'runtimeInstalled', 'storageChanged',
    'tabsActivated', 'tabsUpdated', 'tabsRemoved', 'windowFocusChanged',
    'historyStateUpdated', 'referenceFragmentUpdated', 'navigationCommitted',
  ].map(name => [name, makeEvent()]));
  const scriptPlans = [];
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
  const storageData = {
    settings,
    tabActivity: { version: 1, focusedWindowId: 5, focusedTabId: 1, revision: 1, untilByTab: {} },
  };
  const pick = keys => {
    const requested = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(requested.filter(key => Object.hasOwn(storageData, key)).map(key => [key, storageData[key]]));
  };

  globalThis.chrome = {
    runtime: {
      getURL: path => 'chrome-extension://videospeed-test/' + path,
      onMessage: events.runtimeMessage,
      onConnect: events.runtimeConnect,
      onInstalled: events.runtimeInstalled,
    },
    i18n: { getUILanguage: () => 'zh-TW' },
    storage: {
      onChanged: events.storageChanged,
      local: { async get(keys) { return pick(keys); }, async set(values) { Object.assign(storageData, values); }, onChanged: events.storageChanged },
      session: {
        async get(keys) { return pick(keys); },
        async set(values) { Object.assign(storageData, values); },
      },
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged: events.windowFocusChanged,
      async getLastFocused() { return { id: 5, focused: true }; },
    },
    tabs: {
      onActivated: events.tabsActivated,
      onUpdated: events.tabsUpdated,
      onRemoved: events.tabsRemoved,
      async query(query) {
        return query?.active ? [{ id: 1, windowId: 5, url: 'https://example.test/watch' }] : [];
      },
      async get(id) { return { id, windowId: 5, active: true, url: 'https://example.test/watch' }; },
      async sendMessage() { return { ok: true, version }; },
    },
    webNavigation: {
      onHistoryStateUpdated: events.historyStateUpdated,
      onReferenceFragmentUpdated: events.referenceFragmentUpdated,
      onCommitted: events.navigationCommitted,
      async getAllFrames() {
        return [
          { frameId: 0, url: 'https://example.test/watch' },
          { frameId: 1, url: 'https://example.test/child' },
        ];
      },
    },
    action: { async setTitle() {}, async setIcon() {}, async openPopup() {} },
    scripting: {
      async executeScript() {
        while (scriptPlans[0]?.phase === 'done') scriptPlans.shift();
        const scriptPlan = scriptPlans[0];
        assert.ok(scriptPlan, 'a refresh script plan must be installed before getState');
        if (scriptPlan.phase === 'probe') {
          scriptPlan.phase = 'refresh';
          return scriptPlan.probes;
        }
        assert.equal(scriptPlan.phase, 'refresh');
        scriptPlan.started.resolve();
        const result = await scriptPlan.final.promise;
        scriptPlan.phase = 'done';
        return result;
      },
    },
  };

  return {
    events,
    plan({ probes, result }) {
      const scriptPlan = { phase: 'probe', probes, started: deferred(), final: deferred(), result };
      scriptPlans.push(scriptPlan);
      return scriptPlan;
    },
  };
}

function createPopupMessageSender() {
  return {
    tab: { id: 1, url: 'https://example.test/watch' },
    url: 'chrome-extension://videospeed-test/popup.html',
    frameId: 0,
    documentId: 'popup-document',
  };
}

function createContentSender(documentId) {
  return {
    tab: { id: 1, url: 'https://example.test/watch' },
    url: 'https://example.test/watch',
    frameId: 0,
    documentId,
  };
}

const video = id => ({
  id,
  title: 'Current document video',
  connected: true,
  playing: true,
  visible: true,
  visibleArea: 1000,
  lastPlayedAt: Date.now(),
  rate: 2,
});

test('refreshFrames preserves newer frame reports across delayed allFrames snapshots', { timeout: 20000 }, async () => {
  const fixture = createChromeFixture();
  await import('../extension/background.js?test=background-refresh');

  const popupSender = createPopupMessageSender();
  const send = (message, sender = popupSender) => new Promise(resolve => {
    fixture.events.runtimeMessage.listeners[0]({ scope: 'video-control', ...message }, sender, resolve);
  });
  const oldDocuments = [
    { frameId: 0, documentId: 'doc-old', result: true },
    { frameId: 1, documentId: 'child-old', result: true },
  ];

  // First exercise a same-document report arriving after refresh began.
  const sameDocument = fixture.plan({ probes: oldDocuments });
  const sameDocumentRefresh = send({ action: 'getState', tabId: 1, refresh: true });
  await within(sameDocument.started.promise, 'same-document refresh');
  await send({ action: 'report', videos: [video('v-same-document')] }, createContentSender('doc-old'));
  sameDocument.final.resolve([
    { frameId: 0, documentId: 'doc-old', result: [] },
    { frameId: 1, documentId: 'child-old', result: [] },
  ]);
  const sameDocumentState = await within(sameDocumentRefresh, 'same-document getState');
  assert.equal(sameDocumentState.target?.id, 'v-same-document');

  // Now change the top document while a second allFrames refresh is outstanding.
  const crossNavigation = fixture.plan({ probes: oldDocuments });
  const navigationRetry = fixture.plan({ probes: [
    { frameId: 0, documentId: 'doc-new', result: true },
    { frameId: 1, documentId: 'child-new', result: true },
  ] });
  navigationRetry.final.resolve([
    { frameId: 0, documentId: 'doc-new', result: [video('v-new-document')] },
    { frameId: 1, documentId: 'child-new', result: [] },
  ]);
  const navigationRefresh = send({ action: 'getState', tabId: 1, refresh: true });
  await within(crossNavigation.started.promise, 'pre-navigation refresh');
  fixture.events.tabsUpdated.listeners[0](1, { status: 'loading' });
  await send({ action: 'report', videos: [video('v-new-document')] }, createContentSender('doc-new'));
  crossNavigation.final.resolve([
    { frameId: 0, documentId: 'doc-old', result: [] },
    { frameId: 1, documentId: 'child-old', result: [] },
  ]);
  const navigationState = await within(navigationRefresh, 'navigation getState and retry');
  assert.equal(navigationState.target?.id, 'v-new-document');
  assert.equal(navigationState.target?.documentId, 'doc-new');

  // A subframe commit has its own invalidation path and can happen without a
  // new content report yet. A delayed result for that frame must stay stale.
  fixture.events.navigationCommitted.listeners[0]({ tabId: 1, frameId: 1 });
  const childNavigation = fixture.plan({ probes: [
    { frameId: 0, documentId: 'doc-new', result: true },
    { frameId: 1, documentId: 'child-new', result: true },
  ] });
  const childRefresh = send({ action: 'getState', tabId: 1, refresh: true });
  await within(childNavigation.started.promise, 'subframe refresh');
  fixture.events.navigationCommitted.listeners[0]({ tabId: 1, frameId: 1 });
  childNavigation.final.resolve([
    { frameId: 0, documentId: 'doc-new', result: [video('v-new-document')] },
    { frameId: 1, documentId: 'child-old', result: [{ ...video('v-stale-child'), lastPlayedAt: Date.now() + 10_000 }] },
  ]);
  const childState = await within(childRefresh, 'subframe getState');
  assert.equal(childState.target?.id, 'v-new-document');
});
