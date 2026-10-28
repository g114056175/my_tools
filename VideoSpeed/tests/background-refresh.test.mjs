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
      async sendMessage(_tab,message) { return { ok: true, version,activeId:message?.id }; },
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

test('empty child frames do not accumulate selection recipients; a later video still registers',async()=>{
 const fixture=createChromeFixture(),selections=[];
 chrome.tabs.sendMessage=async(_tab,message,options)=>{
  if(message.action==='activeTarget')selections.push({id:message.id,documentId:options?.documentId});
  return {ok:true,version,activeId:message.id};
 };
 await import('../extension/background.js?test=empty-child-frames');
 const send=(message,sender)=>new Promise(resolve=>fixture.events.runtimeMessage.listeners[0]({scope:'video-control',...message},sender,resolve));
 const top=createContentSender('top');
 await send({action:'report',videos:[video('main')]},top);
 for(let frameId=1;frameId<=200;frameId++)await send({action:'report',videos:[]},{...top,frameId,documentId:'empty-'+frameId});
 await new Promise(resolve=>setTimeout(resolve,30));
 assert.ok(selections.length>0);assert.ok(selections.every(item=>item.documentId==='top'),'empty ad/analytics documents must not receive selection notifications');
 const child={...top,frameId:201,documentId:'real-child'};
 await send({action:'report',videos:[{...video('child'),visibleArea:4000,lastPlayedAt:Date.now()+1000}]},child);
 await new Promise(resolve=>setTimeout(resolve,30));
 assert.ok(selections.some(item=>item.documentId==='real-child'&&item.id==='child'));
 selections.length=0;await send({action:'report',videos:[]},child);
 await new Promise(resolve=>setTimeout(resolve,30));
 assert.ok(selections.some(item=>item.documentId==='top'&&item.id==='main'));
 assert.ok(selections.every(item=>item.documentId!=='real-child'),'an emptied child must leave the selection recipient set');
});

test('an unresponsive page refresh does not keep the popup waiting or start duplicate probes',async()=>{
 const fixture=createChromeFixture();
 await import('../extension/background.js?test=popup-refresh-deadline');
 const sender=createPopupMessageSender();
 const send=message=>new Promise(resolve=>fixture.events.runtimeMessage.listeners[0]({scope:'video-control',...message},sender,resolve));
 const plan=fixture.plan({probes:[{frameId:0,documentId:'doc-slow',result:true}]});
 const start=Date.now(),first=send({action:'getState',tabId:1});await plan.started.promise;
 const result=await within(first,'popup refresh deadline');
 assert.equal(result.ok,true);assert.equal(result.target,null);assert.ok(Date.now()-start<2000);
 const repeated=await within(send({action:'getState',tabId:1}),'shared pending refresh deadline');
 assert.equal(repeated.ok,true);assert.equal(plan.phase,'refresh','a timed out popup must share the existing in-flight page probe');
 plan.final.resolve([{frameId:0,documentId:'doc-slow',result:[video('recovered')]}]);
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal((await send({action:'cachedState',tabId:1})).target?.id,'recovered');
});

test('a failed selection drops only a confirmed removed iframe and returns to the live video',async()=>{
 const fixture=createChromeFixture(),calls=[];
 chrome.webNavigation.getAllFrames=async()=>[{frameId:0,documentId:'top'}];
 chrome.tabs.sendMessage=async(_tab,message,options)=>{
  if(message.action==='activeTarget')calls.push(options?.documentId);
  if(options?.documentId==='removed-child')return null;
  return {ok:true,version,activeId:message.id};
 };
 await import('../extension/background.js?test=removed-child-selection');
 const top=createContentSender('top');
 const send=(message,sender=top)=>new Promise(resolve=>fixture.events.runtimeMessage.listeners[0]({scope:'video-control',...message},sender,resolve));
 await send({action:'report',videos:[video('main')]});
 await send({action:'report',videos:[{...video('gone'),visibleArea:4000,lastPlayedAt:Date.now()+1000}]},{...top,frameId:99,documentId:'removed-child'});
 await new Promise(resolve=>setTimeout(resolve,80));
 assert.equal((await send({action:'cachedState',tabId:1})).target?.id,'main');
 calls.length=0;await send({action:'report',videos:[video('main')]});
 await new Promise(resolve=>setTimeout(resolve,30));
 assert.ok(!calls.includes('removed-child'),'later reports must not keep contacting the removed document');
});

test('a delayed geometry report cannot replace a newer snapshot from the same document',async()=>{
 const fixture=createChromeFixture();await import('../extension/background.js?test=snapshot-order');
 const sender=createContentSender('current');
 const send=message=>new Promise(resolve=>fixture.events.runtimeMessage.listeners[0]({scope:'video-control',...message},sender,resolve));
 await send({action:'report',snapshotRevision:2,videos:[{...video('new'),playing:false,visibleArea:200000}]});
 await send({action:'report',snapshotRevision:1,videos:[{...video('old'),playing:true,visibleArea:500000}]});
 assert.equal((await send({action:'cachedState',tabId:1})).target?.id,'new');
});

test('a replacement control session can restart snapshot revisions without accepting retired-session reports',async()=>{
 const fixture=createChromeFixture();await import('../extension/background.js?test=snapshot-session-recovery');
 const sender=createContentSender('current');
 const send=message=>new Promise(resolve=>fixture.events.runtimeMessage.listeners[0]({scope:'video-control',...message},sender,resolve));
 await send({action:'report',snapshotEpoch:100,snapshotRevision:20,videos:[video('retired')]});
 await send({action:'report',snapshotEpoch:200,snapshotRevision:1,videos:[video('recovered')]});
 assert.equal((await send({action:'cachedState',tabId:1})).target?.id,'recovered');
 await send({action:'report',snapshotEpoch:100,snapshotRevision:99,videos:[video('retired')]});
 assert.equal((await send({action:'cachedState',tabId:1})).target?.id,'recovered');
 await send({action:'report',snapshotEpoch:100,snapshotRevision:100,videos:[]});
 assert.equal((await send({action:'cachedState',tabId:1})).target?.id,'recovered','retired-session cleanup must not clear its replacement');
});

test('a new competing top-frame video updates the child hotkey path even when selection stays in the child',async()=>{
 const fixture=createChromeFixture(),messages=[];
 chrome.tabs.sendMessage=async(_tab,message,options)=>{if(message.action==='activeTarget')messages.push({message,documentId:options?.documentId});return {ok:true,version,activeId:message.id};};
 await import('../extension/background.js?test=competing-frame-media');
 const send=(message,sender)=>new Promise(resolve=>fixture.events.runtimeMessage.listeners[0]({scope:'video-control',...message},sender,resolve));
 const top=createContentSender('top'),child={...top,frameId:1,documentId:'child'};
 await send({action:'report',videos:[]},top);
 await send({action:'report',videos:[{...video('main'),visibleArea:200000}]},child);
 await new Promise(resolve=>setTimeout(resolve,30));
 assert.ok(messages.some(item=>item.documentId==='child'&&item.message.id==='main'&&item.message.hasOtherFrames===false));
 messages.length=0;
 await send({action:'report',videos:[{...video('secondary'),visibleArea:10000}]},top);
 await new Promise(resolve=>setTimeout(resolve,30));
 assert.ok(messages.some(item=>item.documentId==='child'&&item.message.id==='main'&&item.message.hasOtherFrames===true));
});
