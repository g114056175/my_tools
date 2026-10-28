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
  localGetFailures = 0,
  activeQueryFailures = {},
  activeTargetResponses = {},
  receivers = [10],
  activityCheckpoint,
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
  if(activityCheckpoint!==undefined)localData.tabActivityGrace=activityCheckpoint;
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
  const activeTargetReplies = new Map(Object.entries(activeTargetResponses).map(([tabId, replies]) => [Number(tabId), [...replies]]));
  const state = {
    focusedWindowId,
    localData,
    sessionData,
    tabs,
    receivers: receiversSet,
    messages: [],
    executeCalls: [],
    tabQueries: [],
    runtimeActions: [],
    popupOpens: 0,
    localGetCalls: 0,
    localGetFailures,
    activeQueryFailures: new Map(Object.entries(activeQueryFailures).map(([windowId, count]) => [Number(windowId), count])),
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
        async get(keys) {
          state.localGetCalls++;
          if (state.localGetFailures > 0) {
            state.localGetFailures--;
            throw new Error('Injected storage.local.get failure');
          }
          return pick(localData, keys);
        },
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
          const failures = state.activeQueryFailures.get(query.windowId) || 0;
          if (failures > 0) {
            state.activeQueryFailures.set(query.windowId, failures - 1);
            throw new Error('Injected active-tab query failure');
          }
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
        state.messages.push({ tabId, message, delivered, at: Date.now() });
        if (!delivered) throw new Error('Could not establish connection. Receiving end does not exist.');
        if (message?.action === 'activeTarget') {
          const planned = activeTargetReplies.get(tabId)?.shift();
          if (planned === 'throw') throw new Error('Injected activeTarget transport failure');
          if (planned === 'missing') return { ok: true, version };
          if (planned === 'wrong') return { ok: true, version, activeId: message.id === null ? 'unexpected-id' : `wrong-${message.id}` };
          if (typeof planned === 'function') return planned({ tabId, message, version });
          if (planned && typeof planned === 'object') return planned;
          return { ok: true, version, activeId: message.id };
        }
        return { ok: true, version };
      },
    },
    webNavigation: {
      onHistoryStateUpdated: events.historyStateUpdated,
      onReferenceFragmentUpdated: events.referenceFragmentUpdated,
      onCommitted: events.navigationCommitted,
      async getAllFrames({tabId}) { return tabs.has(tabId)?[{frameId:0,documentId:`doc-${tabId}`}]:[]; },
    },
    action: { async setTitle() {}, async setIcon() {}, async openPopup() { state.popupOpens++; } },
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
    setActiveTargetResponses(tabId, replies) { activeTargetReplies.set(tabId, [...replies]); },
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
      await import(`../src/background.js?test=background-activity-${importId}`);
    },
    async sendRuntime(message, sender) {
      state.runtimeActions.push(message.action);
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

test('selection delivery requires a real acknowledgement and retries without popup', {timeout:10000},async()=>{
 const fixture=createChromeFixture({activeTargetResponses:{10:['throw','missing']}});
 await fixture.importBackground();await waitForInitialSnapshot(fixture);
 const sender=contentSender(10),videos=[{id:'media-a',connected:true,visible:true,playing:true,rate:1}];
 await fixture.sendRuntime({action:'report',videos},sender);
 await waitFor(()=>fixture.state.messages.filter(item=>item.message.action==='activeTarget'&&item.message.id==='media-a').length>=3,'selection retry acknowledgement');
 await new Promise(resolve=>setTimeout(resolve,20));
 const before=fixture.state.messages.filter(item=>item.message.action==='activeTarget'&&item.message.id==='media-a').length;
 await fixture.sendRuntime({action:'report',videos},sender);
 await new Promise(resolve=>setTimeout(resolve,40));
 assert.equal(fixture.state.messages.filter(item=>item.message.action==='activeTarget'&&item.message.id==='media-a').length,before);
 assert.equal(fixture.state.popupOpens,0);assert.ok(fixture.state.runtimeActions.every(action=>action==='report'));
});

test('a rejected initial settings read does not poison subsequent content startup', {timeout:10000},async()=>{
 const fixture=createChromeFixture({localGetFailures:1});
 await fixture.importBackground();await waitForInitialSnapshot(fixture);
 const result=await fixture.sendRuntime({action:'settings'},contentSender(10));
 assert.equal(result.ok,true);assert.equal(result.settings.defaultMode,'custom');assert.equal(result.lastRate,2);
 assert.ok(fixture.state.localGetCalls>=2);assert.equal(fixture.state.popupOpens,0);
});

test('content startup reconciles focus after an initial active-tab query failure', {timeout:10000},async()=>{
 const fixture=createChromeFixture({activeQueryFailures:{1:1},sessionSnapshot:undefined});
 await fixture.importBackground();await waitForInitialSnapshot(fixture);
 const result=await fixture.sendRuntime({action:'settings'},contentSender(10));
 assert.equal(result.ok,true);assert.equal(result.activity.focused,true);assert.equal(fixture.state.popupOpens,0);
});

test('extension update restores focused, recent and known-playing tabs without querying every page',async()=>{
 const now=Date.now(),fixture=createChromeFixture({tabs:[20,30,40,50].map(id=>({id,windowId:1,active:false,url:`https://example.test/${id}`,status:'complete'})),receivers:[10,20,30,40,50],sessionSnapshot:{focusedWindowId:1,focusedTabId:10,revision:5,untilByTab:{20:now+10_000,30:now-100},activeByWindow:{1:10,2:40}}});
 await fixture.importBackground();await waitForInitialSnapshot(fixture);
 await fixture.sendRuntime({action:'report',videos:[{id:'background-player',connected:true,playing:true,visible:false,rate:2}]},contentSender(50));
 fixture.events.runtimeInstalled.listeners[0]({reason:'update'});
 await waitFor(()=>fixture.state.executeCalls.length>=3,'scoped update restore probes');
 await new Promise(resolve=>setTimeout(resolve,25));
 assert.deepEqual([...new Set(fixture.state.executeCalls.map(call=>call.target.tabId))].sort((a,b)=>a-b),[10,20,50]);
 assert.ok(!fixture.state.tabQueries.some(query=>query?.url),'update enumerated all HTTP tabs');
});

test('a recovery probe that outlives its grace period cannot inject bridge or content files',async()=>{
 const fixture=createChromeFixture({tabs:[{id:20,windowId:1,active:false,url:'https://example.test/20',status:'complete'}],receivers:[10,20],sessionSnapshot:{focusedWindowId:1,focusedTabId:10,revision:5,untilByTab:{20:Date.now()+80},activeByWindow:{1:10}}});
 await fixture.importBackground();await waitForInitialSnapshot(fixture);
 const focused=fixture.planExecuteScript(),recent=fixture.planExecuteScript();focused.resolve([{frameId:0,result:false}]);
 fixture.events.runtimeInstalled.listeners[0]({reason:'update'});await waitFor(()=>fixture.state.executeCalls.length===2,'recent page recovery probe');
 await new Promise(resolve=>setTimeout(resolve,100));recent.resolve([{frameId:0,result:true}]);await new Promise(resolve=>setTimeout(resolve,25));
 assert.equal(fixture.state.executeCalls.filter(call=>call.target.tabId===20).length,1);assert.ok(fixture.state.executeCalls.every(call=>!call.files));
});

test('idle empty pages receive no policy messages or child-route probes on other-page setting changes',async()=>{
 const fixture=createChromeFixture({tabs:[{id:30,windowId:1,active:false,url:'https://example.test/30',status:'complete'}],receivers:[10,30]});
 await fixture.importBackground();await waitForInitialSnapshot(fixture);await new Promise(resolve=>setTimeout(resolve,20));
 fixture.events.runtimeConnect.listeners[0]({name:'video-control-content',sender:contentSender(30),onDisconnect:makeEvent()});
 fixture.state.messages=[];fixture.events.tabsUpdated.listeners[0](30,{url:'https://example.test/30#background-change'});
 fixture.events.historyStateUpdated.listeners[0]({tabId:30,frameId:1,documentId:'idle-child',url:'https://example.test/child'});
 const next={...fixture.state.localData.settings,preferredRate:3};fixture.state.localData.settings=next;fixture.events.storageChanged.listeners[0]({settings:{newValue:next}},'local');
 await new Promise(resolve=>setTimeout(resolve,40));
 assert.equal(fixture.state.messages.filter(item=>item.tabId===30).length,0);assert.equal(fixture.state.executeCalls.filter(call=>call.target.tabId===30).length,0);
});

test('power off still stops a known background player after its activity deadline expired',async()=>{
 const fixture=createChromeFixture({tabs:[{id:50,windowId:1,active:false,url:'https://example.test/50',status:'complete'}],receivers:[10,50]});
 await fixture.importBackground();await waitForInitialSnapshot(fixture);
 await fixture.sendRuntime({action:'report',videos:[{id:'background-player',connected:true,playing:true,visible:false,rate:2}]},contentSender(50));
 fixture.state.messages=[];const next={...fixture.state.localData.settings,enabled:false};fixture.state.localData.settings=next;
 fixture.events.storageChanged.listeners[0]({settings:{newValue:next}},'local');
 await waitFor(()=>fixture.state.messages.some(item=>item.tabId===50&&item.message.action==='power'&&item.message.settings.enabled===false),'background player power-off');
});

test('both background port disconnect callbacks consume the runtime error synchronously',async()=>{
 const fixture=createChromeFixture();await fixture.importBackground();await waitForInitialSnapshot(fixture);
 let reads=0,inside=false;Object.defineProperty(chrome.runtime,'lastError',{get(){assert.ok(inside);reads++;return {message:'BFCache closed the channel'};}});
 for(const name of ['video-control-content','video-control-popup']){
  const disconnect=makeEvent(),port={name,sender:contentSender(10),onDisconnect:disconnect,onMessage:makeEvent()};
  fixture.events.runtimeConnect.listeners[0](port);inside=true;disconnect.listeners[0]();inside=false;
 }
 assert.equal(reads,2);
});

test('new background tabs inherit recent opener loading grace without waking unrelated old pages',async()=>{
 const fixture=createChromeFixture({tabs:[{id:20,windowId:1,active:false,url:'https://example.test/20',status:'loading'},{id:30,windowId:1,active:false,url:'https://example.test/30',status:'complete'}],receivers:[10,20,30]});
 await fixture.importBackground();await waitForInitialSnapshot(fixture);
 fixture.events.tabsCreated.listeners[0]({id:20,windowId:1,active:false,openerTabId:10});
 await waitFor(()=>fixture.state.messages.some(item=>item.tabId===20&&item.message.activity?.until>Date.now()),'background new-tab loading grace');
 const response=await fixture.sendRuntime({action:'settings'},contentSender(20));assert.equal(response.activity.focused,false);assert.ok(response.activity.until>Date.now());
 assert.equal(fixture.state.messages.filter(item=>item.tabId===30).length,0);assert.equal(fixture.state.executeCalls.length,0);
});

test('an update with cleared session restores only unexpired local grace without renewing it',async()=>{
 const now=Date.now(),deadline=now+5_000;
 const fixture=createChromeFixture({sessionSnapshot:undefined,activityCheckpoint:{version:1,revision:90,untilByTab:{20:deadline,30:now-100,40:now+60_000}},tabs:[20,30,40].map(id=>({id,windowId:1,active:false,url:`https://example.test/${id}`,status:'complete'})),receivers:[10,20,30,40]});
 // The fixture defaults sessionSnapshot when omitted; explicitly model Chrome clearing it.
 delete fixture.state.sessionData.tabActivity;
 await fixture.importBackground();await waitForInitialSnapshot(fixture);
 const response=await fixture.sendRuntime({action:'settings'},contentSender(20));assert.equal(response.activity.until,deadline);assert.ok(response.activity.revision>=90);
 fixture.events.runtimeInstalled.listeners[0]({reason:'update'});await waitFor(()=>fixture.state.executeCalls.length>=2,'checkpoint update restore');
 assert.deepEqual([...new Set(fixture.state.executeCalls.map(call=>call.target.tabId))].sort((a,b)=>a-b),[10,20]);assert.ok(!fixture.state.tabQueries.some(query=>query?.url));
 assert.equal(fixture.state.localData.tabActivityGrace.untilByTab[20],deadline);
});

test('first upgrade uses recent browser timestamps as metadata, without probing old tabs',async()=>{
 const now=Date.now(),fixture=createChromeFixture({tabs:[{id:20,windowId:1,active:false,url:'https://example.test/20',status:'complete',lastAccessed:now-1000},{id:30,windowId:1,active:false,url:'https://example.test/30',status:'complete',lastAccessed:now-30_000}],receivers:[10,20,30]});
 delete fixture.state.sessionData.tabActivity;await fixture.importBackground();await waitForInitialSnapshot(fixture);
 fixture.events.runtimeInstalled.listeners[0]({reason:'update'});await waitFor(()=>fixture.state.executeCalls.length>=2,'metadata-migrated recent tab');
 assert.deepEqual([...new Set(fixture.state.executeCalls.map(call=>call.target.tabId))].sort((a,b)=>a-b),[10,20]);
 const response=await fixture.sendRuntime({action:'settings'},contentSender(20));assert.equal(response.activity.until,now-1000+10_000);
});

test('committed child frames in an idle empty page cannot trigger selection or highlight messages',async()=>{
 const fixture=createChromeFixture({tabs:[{id:30,windowId:1,active:false,url:'https://example.test/30',status:'complete'}],receivers:[10,30]});
 await fixture.importBackground();await waitForInitialSnapshot(fixture);
 await fixture.sendRuntime({action:'report',videos:[]},contentSender(30));fixture.state.messages=[];
 fixture.events.navigationCommitted.listeners[0]({tabId:30,frameId:1,documentId:'new-idle-child',url:'https://example.test/child'});
 await new Promise(resolve=>setTimeout(resolve,40));assert.equal(fixture.state.messages.filter(item=>item.tabId===30).length,0);
 const disconnect=makeEvent(),messages=makeEvent(),port={name:'video-control-popup',onDisconnect:disconnect,onMessage:messages};
 fixture.events.runtimeConnect.listeners[0](port);messages.listeners[0]({action:'watch',tabId:30});await new Promise(resolve=>setTimeout(resolve,15));
 fixture.state.messages=[];disconnect.listeners[0]();await new Promise(resolve=>setTimeout(resolve,30));
 assert.equal(fixture.state.messages.filter(item=>item.tabId===30).length,0,'closed popup scheduled an idle-page clear highlight');
});

test('pending loading permits one update recovery but ordinary notifications still require a video',async()=>{
 const deadline=Date.now()+40_000,fixture=createChromeFixture({tabs:[20,30].map(id=>({id,windowId:1,active:false,url:`https://example.test/${id}`,status:'complete'})),receivers:[10,20,30],sessionSnapshot:{focusedWindowId:1,focusedTabId:10,revision:5,untilByTab:{},loadingUntilByTab:{20:deadline},activeByWindow:{1:10}}});
 await fixture.importBackground();await waitForInitialSnapshot(fixture);
 assert.ok(fixture.state.messages.every(item=>item.tabId!==20),'empty pending tab received routine traffic');
 fixture.events.runtimeInstalled.listeners[0]({reason:'update'});await waitFor(()=>fixture.state.executeCalls.length>=2,'focused and pending update probes');
 assert.deepEqual([...new Set(fixture.state.executeCalls.map(call=>call.target.tabId))].sort((a,b)=>a-b),[10,20]);
 const response=await fixture.sendRuntime({action:'settings'},contentSender(20));assert.equal(response.activity.until,0);assert.equal(response.activity.loadingUntil,deadline);
 await fixture.sendRuntime({action:'report',videos:[{id:'pending',connected:true,playing:false,visible:true,rate:1}]},contentSender(20));
 await waitFor(()=>fixture.state.messages.some(item=>item.tabId===20&&item.message.id==='pending'),'late selected media');
 await fixture.sendRuntime({action:'initialized',id:'unrelated'},contentSender(20));assert.equal(fixture.state.sessionData.tabActivity.loadingUntilByTab[20],deadline);
 await fixture.sendRuntime({action:'initialized',id:'pending'},contentSender(20));assert.equal(fixture.state.sessionData.tabActivity.loadingUntilByTab[20],undefined);
 fixture.updateStatus(30,'loading');const old=await fixture.sendRuntime({action:'settings'},contentSender(30));assert.equal(old.activity.loadingUntil,undefined);
 assert.ok(fixture.state.executeCalls.every(call=>call.target.tabId!==30));
});
