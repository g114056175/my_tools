#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  const value = process.env.VIDEOSPEED_PLAYWRIGHT?.trim();
  return value ? require(path.resolve(value)) : require('playwright');
}
const { chromium } = loadPlaywright();

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), '../..');
const extensionDir = path.join(projectRoot, 'extension');
const outputDir = path.join(projectRoot, 'work', 'qa-078-focus');
const outputPath = path.join(outputDir, 'results.json');
const fixturePath = path.join(projectRoot, 'tests', 'fixtures', 'tiny.webm');
const SETTINGS = {
  enabled: true,
  preferredRate: 2,
  defaultMode: 'follow',
  customRate: 8,
  steps: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 6, 8, 10, 12],
  qualityEnabled: true,
  preferredQuality: 1080,
  shortcuts: { slower: '<', faster: '>', reset: ':', preferred: '"', fineSlower: '', fineFaster: '' },
  disabledSites: [],
  siteModes: {},
};

const report = {
  test: 'focus-lifecycle-check',
  startedAt: new Date().toISOString(),
  scope: 'Local HTTP YouTube-shaped fixture only; isolated Chromium profile and real Chrome tab/window focus changes; no popup and no real-site requests.',
  extensionVersion: null,
  packageVersion: null,
  chromium: null,
  chromiumExecutable: process.env.VIDEOSPEED_CHROMIUM || chromium.executablePath(),
  extensionId: null,
  extensionFileHashes: {},
  testSha256: null,
  packageSha256: null,
  fixtureSha256: null,
  fixture: null,
  checks: [],
  focusTransitions: [],
  deadlineObservations: [],
  routeAndMediaPulses: [],
  focusFallback: null,
  blockedExternalRequests: [],
  servedFixtureRequests: [],
  cleanup: {
    profileCreated: false,
    profileRemoved: false,
    profileVerifiedInsideOsTemp: false,
    browserClosed: false,
    serverClosed: false,
    error: null,
  },
  errors: [],
  result: 'NOT_RUN',
};

let context;
let serviceWorker;
let fixtureServer;
let profileRoot;
let fixturePort;
let fixtureOrigin;
const blockedExternalRequests = new Set();

function record(name, detail = {}) {
  report.checks.push({ name, pass: true, ...detail });
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(predicate, label, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) { lastError = error; }
    await delay(60);
  }
  throw new Error(label + (lastError ? ': ' + lastError.message : ''));
}

async function waitUntil(timestamp) {
  while (Date.now() < timestamp) await delay(Math.min(250, timestamp - Date.now()));
}

async function listFiles(directory, relative = '') {
  const output = [];
  for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
    const child = path.posix.join(relative.replaceAll('\\', '/'), entry.name);
    if (entry.isDirectory()) output.push(...await listFiles(directory, child));
    else if (entry.isFile()) output.push(child);
  }
  return output.sort();
}

async function hashFiles(directory) {
  const files = await listFiles(directory);
  const aggregate = createHash('sha256');
  for (const file of files) {
    const bytes = await readFile(path.join(directory, file));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    report.extensionFileHashes[file.replaceAll('\\', '/')] = sha256;
    aggregate.update(file).update('\0').update(bytes).update('\0');
  }
  report.extensionAggregateSha256 = aggregate.digest('hex');
}

function fixtureHtml(url) {
  const name = url.searchParams.get('case') || 'fixture';
  const routeId = url.searchParams.get('v') || name;
  const empty = url.searchParams.get('empty') === '1';
  const withShadow = url.searchParams.get('shadow') === '1';
  const initialVideo = empty ? '' : '<video id="v" class="html5-main-video" muted loop playsinline controls></video>';
  const script = `(()=>{
    const player=document.querySelector('#movie_player');
    const routeId=${JSON.stringify(routeId)};
    const stats={qualityCalls:[],rateEvents:[],insertCalls:0,createdAt:Date.now()};
    const shadowHost=${withShadow ? "document.createElement('div')" : 'null'};
    if(shadowHost){shadowHost.id='qa-known-shadow-root';player.append(shadowHost);}
    const knownShadow=shadowHost?.attachShadow({mode:'open'})||null;knownShadow?.append(document.createElement('span'));
    const track=video=>{
      video.addEventListener('ratechange',()=>stats.rateEvents.push({at:Date.now(),rate:video.playbackRate,defaultRate:video.defaultPlaybackRate}));
      video.src='/tiny.webm?case='+encodeURIComponent(${JSON.stringify(name)});
      return video;
    };
    const existing=player.querySelector('video');
    const video=existing?track(existing):null;
    player.getVideoData=()=>({video_id:routeId,title:'Focus lifecycle fixture '+routeId});
    player.getPlayerResponse=()=>({videoDetails:{videoId:routeId}});
    player.getAvailableQualityLevels=()=>['hd1080','hd720'];
    player.setPlaybackQualityRange=(min,max)=>stats.qualityCalls.push({at:Date.now(),min,max});
    player.setPlaybackQuality=quality=>stats.qualityCalls.push({at:Date.now(),min:quality,max:quality});
    const insert=()=>{
      stats.insertCalls++;
      let item=player.querySelector('video');
      if(!item){item=document.createElement('video');item.id='v';item.className='html5-main-video';item.muted=true;item.loop=true;item.playsInline=true;item.controls=true;player.append(item);track(item);}
      return item;
    };
    const insertShadowVideo=id=>{
      if(!knownShadow)throw new Error('fixture shadow root was not requested');
      let item=knownShadow.querySelector('#'+CSS.escape(id));
      if(!item){item=document.createElement('video');item.id=id;item.className='html5-main-video';item.muted=true;item.loop=true;item.playsInline=true;item.controls=true;knownShadow.append(item);track(item);}
      return item;
    };
    const appendShadowPendingVideo=id=>{
      if(!knownShadow)throw new Error('fixture shadow root was not requested');
      const item=document.createElement('video');item.id=id;item.className='html5-main-video';item.muted=true;item.loop=true;item.playsInline=true;item.controls=true;knownShadow.append(item);return item;
    };
    const appendExtraVideo=id=>{
      const item=document.createElement('video');item.id=id;item.className='html5-main-video';item.muted=true;item.loop=true;item.playsInline=true;item.controls=true;player.append(item);track(item);return item;
    };
    const appendUntrackedVideo=id=>{
      const item=document.createElement('video');item.id=id;item.className='html5-main-video';item.muted=true;item.loop=true;item.playsInline=true;item.controls=true;player.append(item);return item;
    };
    window.__qa={player,stats,routeId,get video(){return player.querySelector('video');},insert,
      async play(){const item=insert();try{await item.play()}catch{}return item;},insertShadowVideo,appendShadowPendingVideo,appendExtraVideo,appendUntrackedVideo,
      setRate(rate){const item=player.querySelector('video');if(item)item.playbackRate=rate;return item?.playbackRate??null;}};
  })();`;
  return '<!doctype html><html><head><meta charset="utf-8"><title>Focus lifecycle fixture</title>' +
    '<style>html,body{margin:0;background:#111;color:#fff}#movie_player{width:640px;height:360px;background:#000}.html5-main-video{width:100%;height:100%;display:block}</style>' +
    '</head><body><main id="movie_player" class="html5-video-player">' + initialVideo +
    '</main><script>' + script + '</script></body></html>';
}

async function startServer(mediaBytes) {
  fixtureServer = createServer((request, response) => {
    const url = new URL(request.url || '/', fixtureOrigin || 'http://127.0.0.1');
    if (url.pathname === '/tiny.webm') {
      report.servedFixtureRequests.push({ path: url.pathname, query: url.search });
      const range = /^bytes=(\d+)-(\d*)$/u.exec(String(request.headers.range || ''));
      if (range) {
        const start = Number(range[1]);
        const end = Math.min(range[2] ? Number(range[2]) : mediaBytes.length - 1, mediaBytes.length - 1);
        response.writeHead(206, {
          'content-type': 'video/webm', 'cache-control': 'no-store', 'accept-ranges': 'bytes',
          'content-range': `bytes ${start}-${end}/${mediaBytes.length}`,
          'content-length': String(Math.max(0, end - start + 1)),
        });
        response.end(mediaBytes.subarray(start, end + 1));
      } else {
        response.writeHead(200, {
          'content-type': 'video/webm', 'cache-control': 'no-store', 'accept-ranges': 'bytes',
          'content-length': String(mediaBytes.length),
        });
        response.end(mediaBytes);
      }
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(url.pathname === '/away' ? '<!doctype html><title>Focus away</title>' : fixtureHtml(url));
  });
  await new Promise((resolve, reject) => {
    fixtureServer.once('error', reject);
    fixtureServer.listen(0, '127.0.0.1', resolve);
  });
  fixturePort = fixtureServer.address().port;
  fixtureOrigin = `http://www.youtube.com:${fixturePort}`;
  report.fixture = {
    origin: fixtureOrigin,
    routeHost: 'www.youtube.com',
    localServer: '127.0.0.1',
    actualTinyWebm: true,
    youtubePlayerApiMatchesRoute: true,
    realSite: false,
    mediaBytes: mediaBytes.length,
  };
}

async function worker() {
  if (serviceWorker && serviceWorker.url().includes(`chrome-extension://${report.extensionId}/`)) return serviceWorker;
  serviceWorker = context.serviceWorkers().find(item => item.url().includes(`chrome-extension://${report.extensionId}/`));
  if (serviceWorker) return serviceWorker;
  serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  return serviceWorker;
}

async function storageLocal() {
  return (await worker()).evaluate(() => chrome.storage.local.get(null));
}

async function storageSession() {
  return (await worker()).evaluate(() => chrome.storage.session.get('tabActivity'));
}

async function tabInfo(tabId) {
  return (await worker()).evaluate(id => chrome.tabs.get(id), tabId);
}

async function foregroundInfo() {
  return (await worker()).evaluate(async () => {
    const [window, tabs] = await Promise.all([
      chrome.windows.getLastFocused(),
      chrome.tabs.query({ active: true, lastFocusedWindow: true }),
    ]);
    return { focused: window?.focused === true, windowId: window?.id ?? null, tabId: tabs[0]?.id ?? null };
  });
}

async function contentState(tabId) {
  const rows = await (await worker()).evaluate(id => chrome.scripting.executeScript({
    target: { tabId: id, frameIds: [0] }, world: 'ISOLATED', func: () => {
      const api = globalThis[Symbol.for('video-control.api')];
      return { alive: api?.alive?.() === true, session: api?.enabled?.() === true,
        startup: api?.startup?.() ?? null, videos: api?.snapshot?.() ?? [],
        diagnostics: api?.diagnostics?.() ?? [] };
    },
  }), tabId);
  return rows?.[0]?.result ?? null;
}

async function simulateContentContextTakeover(tabId, strangerId) {
  const sw = await worker();
  const disposed = await sw.evaluate(({ tabId, strangerId }) => chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] }, world: 'ISOLATED', args: [strangerId], func: unknownId => {
      const key = Symbol.for('video-control.api');
      const api = globalThis[key];
      const before = { present: !!api, alive: api?.alive?.() === true, enabled: api?.enabled?.() === true };
      const state = video => video ? {
        marker: video.getAttribute('data-video-control-id'),
        pendingUntil: video.getAttribute('data-video-control-pending-until'),
        pendingKey: video.getAttribute('data-video-control-pending-key'),
        rate: video.playbackRate, defaultRate: video.defaultPlaybackRate,
      } : null;
      const known = document.getElementById('v');
      const stranger = document.getElementById(unknownId);
      const knownBeforeDispose = state(known), strangerBeforeDispose = state(stranger);
      api?.dispose?.();
      return { before, removed: !globalThis[key], knownBeforeDispose, knownAfterDispose: state(known),
        strangerBeforeDispose, strangerAfterDispose: state(stranger) };
    },
  }), { tabId, strangerId });
  const injected = await sw.evaluate(id => chrome.scripting.executeScript({
    target: { tabId: id, frameIds: [0] }, world: 'ISOLATED', files: ['content.js'],
  }), tabId);
  return { disposed: disposed?.[0]?.result ?? null,
    injected: (injected || []).map(item => ({ frameId: item.frameId, documentId: item.documentId ?? null })),
    at: Date.now() };
}

async function pageBridgeState(tabId) {
  const rows = await (await worker()).evaluate(id => chrome.scripting.executeScript({
    target: { tabId: id, frameIds: [0] }, world: 'MAIN', func: () => {
      const bridge = globalThis[Symbol.for('video-control.page-bridge-v3')];
      return { present: !!bridge, version: bridge?.version ?? null,
        active: bridge?.active?.() === true, owner: bridge?.owner?.() ?? null };
    },
  }), tabId);
  return rows?.[0]?.result ?? null;
}

async function installDomProbe(tabId) {
  return (await worker()).evaluate(id => chrome.scripting.executeScript({
    target: { tabId: id, frameIds: [0] }, world: 'ISOLATED', func: () => {
      const symbol = Symbol.for('video-speed-focus-lifecycle-dom-probe');
      if (globalThis[symbol]) return true;
      const state = { queries: [], walkers: [] };
      globalThis[symbol] = state;
      const isVideoQuery = selector => String(selector).split(',').some(part =>
        /(?:^|[^a-z0-9_-])video(?=$|[^a-z0-9_-])/iu.test(part.trim()));
      const wrapQuery = (prototype, rootName) => {
        if (!prototype || typeof prototype.querySelectorAll !== 'function') return;
        const original = prototype.querySelectorAll;
        prototype.querySelectorAll = function (selector, ...args) {
          if (isVideoQuery(selector)) state.queries.push({ at: Date.now(), root: rootName(this), selector: String(selector) });
          return Reflect.apply(original, this, [selector, ...args]);
        };
      };
      wrapQuery(Document.prototype, root => root === document ? 'document' : 'document-other');
      if (globalThis.ShadowRoot?.prototype) {
        wrapQuery(ShadowRoot.prototype, root => `shadow:${root.host?.id || 'open'}`);
      }
      const originalWalker = Document.prototype.createTreeWalker;
      Document.prototype.createTreeWalker = function (root, ...args) {
        state.walkers.push({ at: Date.now(), root: root === document ? 'document' : root?.host ? `shadow:${root.host.id || 'open'}` : 'node' });
        return Reflect.apply(originalWalker, this, [root, ...args]);
      };
      return true;
    },
  }), tabId);
}

async function resetDomProbe(tabId) {
  return (await worker()).evaluate(id => chrome.scripting.executeScript({
    target: { tabId: id, frameIds: [0] }, world: 'ISOLATED', func: () => {
      const state = globalThis[Symbol.for('video-speed-focus-lifecycle-dom-probe')];
      if (!state) return false;
      state.queries.length = 0; state.walkers.length = 0; return true;
    },
  }), tabId);
}

async function readDomProbe(tabId) {
  const rows = await (await worker()).evaluate(id => chrome.scripting.executeScript({
    target: { tabId: id, frameIds: [0] }, world: 'ISOLATED', func: () => {
      const state = globalThis[Symbol.for('video-speed-focus-lifecycle-dom-probe')];
      return state ? { queries: [...state.queries], walkers: [...state.walkers] } : null;
    },
  }), tabId);
  return rows?.[0]?.result ?? { queries: [], walkers: [] };
}

function summarizeScans(probe) {
  const documents = probe.queries.filter(item => item.root === 'document');
  const shadows = probe.queries.filter(item => item.root.startsWith('shadow:'));
  const intervals = documents.slice(1).map((item, index) => item.at - documents[index].at);
  return { documentCalls: documents.length, shadowCalls: shadows.length, documentIntervalsMs: intervals,
    documentQueryTimes: documents.map(item => item.at), documentQueries: documents,
    shadowRoots: [...new Set(shadows.map(item => item.root))],
    treeWalks: probe.walkers };
}

async function verifyBlurScanWindow(tab, blur, { expectShadowScan = true, allowRecoveryQuery = null } = {}) {
  await waitUntil(blur.blurredAt + 10_600);
  const afterTen = await readDomProbe(tab.tab.id);
  const tenSummary = summarizeScans(afterTen);
  assert.ok(tenSummary.documentCalls >= 4 && tenSummary.documentCalls <= 7,
    `${tab.name} did not use the expected low-frequency document scans during the 10s blur window: ${tenSummary.documentCalls}`);
  if (expectShadowScan) assert.ok(tenSummary.shadowCalls >= 4 && tenSummary.shadowCalls <= 7,
    `${tab.name} did not check its known open shadow root during the 10s blur window: ${tenSummary.shadowCalls}`);
  assert.ok(tenSummary.documentIntervalsMs.every(interval => interval >= 1_000 && interval <= 4_000),
    `${tab.name} background document scans were not spaced near 2s: ${tenSummary.documentIntervalsMs.join(',')}`);
  assert.equal(tenSummary.treeWalks.length, 0, `${tab.name} used a tree walk during low-frequency background discovery`);

  await waitUntil(blur.blurredAt + 30_500);
  const afterThirty = summarizeScans(await readDomProbe(tab.tab.id));
  const scansAfterTen = afterThirty.documentQueries.filter(item => !tenSummary.documentQueryTimes.includes(item.at));
  if (allowRecoveryQuery) {
    assert.ok(allowRecoveryQuery.at, `${tab.name} recovery scan time was not recorded`);
    assert.ok(scansAfterTen.length <= 2,
      `${tab.name} performed repeated document scans after 10s recovery: ${JSON.stringify(scansAfterTen)}`);
    assert.ok(scansAfterTen.every(item => Math.abs(item.at - allowRecoveryQuery.at) <= 2_000),
      `${tab.name} document scan continued outside the one recovery window: ${JSON.stringify(scansAfterTen)}`);
  } else assert.equal(scansAfterTen.length, 0, `${tab.name} kept scanning documents after 10s: ${JSON.stringify(scansAfterTen)}`);
  assert.equal(afterThirty.shadowCalls, tenSummary.shadowCalls, `${tab.name} kept scanning shadow roots after 10s`);
  const observation = { tab: tab.name, tabId: tab.tab.id, blurAt: blur.blurredAt,
    expectShadowScan, recoveryQueries: scansAfterTen, at10s: tenSummary, at30s: afterThirty };
  report.deadlineObservations.push({ tab: tab.name, source: 'isolated-world DOM probe', ...observation });
  return observation;
}

async function shadowState(tab, id) {
  return tab.page.evaluate(videoId => {
    const video = document.querySelector('#qa-known-shadow-root')?.shadowRoot?.querySelector('#' + CSS.escape(videoId));
    return video ? { exists: true, marker: video.getAttribute('data-video-control-id'), rate: video.playbackRate,
      defaultRate: video.defaultPlaybackRate, paused: video.paused } : { exists: false, marker: null, rate: null, defaultRate: null, paused: true };
  }, id);
}

async function verifyEventDiscovery(tab, blur) {
  await waitUntil(blur.blurredAt + 5_000);
  const before = await readDomProbe(tab.tab.id);
  const eventResult = await tab.page.evaluate(() => {
    const video = window.__qa.insertShadowVideo('late-shadow-event');
    video.dispatchEvent(new Event('loadedmetadata', { bubbles: true, composed: true }));
    return { id: video.id, marker: video.getAttribute('data-video-control-id'), at: Date.now() };
  });
  assert.ok(eventResult.marker, 'media event did not synchronously register a video in a known shadow root');
  const registered = await shadowState(tab, eventResult.id);
  const after = await readDomProbe(tab.tab.id);
  const observation = { tab: tab.name, tabId: tab.tab.id, offsetMs: Date.now() - blur.blurredAt,
    eventAt: eventResult.at, markerAtDispatch: eventResult.marker, state: registered, probeBefore: before, probeAfter: after };
  report.deadlineObservations.push({ tab: tab.name, source: 'media-event direct discovery', ...observation });
  return observation;
}

async function ratePair() {
  const values = await storageLocal();
  return { lastRate: values.lastRate, lastRateRevision: values.lastRateRevision };
}

async function seedSettingsAndFollowMemory() {
  const sw = await worker();
  const before = await waitFor(async () => {
    const value = await ratePair();
    return Number.isSafeInteger(value.lastRateRevision) && value.lastRateRevision >= 0 ? value : null;
  }, 'background did not initialize lastRateRevision');
  const seeded = { lastRate: 8, lastRateRevision: before.lastRateRevision + 1 };
  await sw.evaluate(({ settings, memory }) => chrome.storage.local.set({ settings, ...memory }), {
    settings: SETTINGS, memory: seeded,
  });
  await waitFor(async () => {
    const actual = await ratePair();
    return actual.lastRate === seeded.lastRate && actual.lastRateRevision === seeded.lastRateRevision ? actual : null;
  }, 'follow memory seed did not persist');
  report.followMemorySeed = { before, seeded };
  return seeded;
}

function urlFor(name, { empty = false, shadow = !empty } = {}) {
  const query = new URLSearchParams({ case: name, v: `focus-${name}` });
  if (empty) query.set('empty', '1');
  if (shadow) query.set('shadow', '1');
  return `${fixtureOrigin}/watch?${query}`;
}

async function createTab(windowId, name, { empty = false, shadow = !empty, active = true } = {}) {
  const url = urlFor(name, { empty, shadow });
  const createdAt = Date.now();
  const tab = await (await worker()).evaluate(options => chrome.tabs.create(options), { windowId, url, active });
  const page = await waitFor(() => context.pages().find(item => item.url() === url), `fixture page did not open: ${name}`, 15_000);
  await waitFor(async () => (await tabInfo(tab.id))?.status === 'complete', `fixture did not load: ${name}`, 20_000);
  await page.waitForFunction(() => !!window.__qa?.stats, null, { timeout: 10_000 });
  if (!empty) await page.waitForFunction(() => window.__qa?.video?.readyState >= 1, null, { timeout: 10_000 });
  return { name, url, tab, page, empty, shadow, createdAt };
}

async function createAwayWindow(focused = true) {
  const result = await (await worker()).evaluate(options => chrome.windows.create(options), {
    url: `${fixtureOrigin}/away`, focused, type: 'normal',
  });
  await waitFor(async () => {
    const info = await foregroundInfo();
    return info.focused && info.windowId === result.id ? info : null;
  }, 'away window did not receive real Chrome focus');
  return result;
}

async function closeAwayWindowForHeadlessReturn(awayWindowId, targetWindowId) {
  await (await worker()).evaluate(id => chrome.windows.remove(id), awayWindowId);
  const result = await waitFor(async () => {
    const [focus, activity] = await Promise.all([foregroundInfo(), storageSession()]);
    const snapshot = activity?.tabActivity;
    return focus.focused && focus.windowId === targetWindowId &&
      snapshot?.focusedWindowId === targetWindowId && snapshot?.focusedTabId === focus.tabId
      ? { focus, activity: snapshot } : null;
  }, 'target window did not receive focus after closing the headless away window', 8_000);
  report.focusFallback = {
    method: 'close away test window, then activate the target tab',
    reason: 'headless Chromium reported the target and away windows as focused simultaneously after windows.update',
    closedAwayWindowId: awayWindowId,
    targetWindowId,
    focusAfterClose: result,
  };
  return result;
}

async function activateTab(windowId, tabId, page) {
  await (await worker()).evaluate(async ({ windowId, tabId }) => {
    await chrome.windows.update(windowId, { focused: true });
    await chrome.tabs.update(tabId, { active: true });
  }, { windowId, tabId });
  await page?.bringToFront();
  let info;
  try {
    info = await waitFor(async () => {
      const foreground = await foregroundInfo();
      return foreground.focused && foreground.windowId === windowId && foreground.tabId === tabId ? foreground : null;
    }, `Chrome did not focus tab ${tabId}`);
  } catch (error) {
    const chromeState = await (await worker()).evaluate(async ({ windowId, tabId }) => {
      const [targetWindow, tab, targetActiveTabs, lastFocused, activity] = await Promise.all([
        chrome.windows.get(windowId), chrome.tabs.get(tabId), chrome.tabs.query({ active: true, windowId }),
        chrome.windows.getLastFocused(), chrome.storage.session.get('tabActivity'),
      ]);
      return { targetWindow, tab, targetActiveTabs, lastFocused,
        lastFocusedTabs: await chrome.tabs.query({ active: true, lastFocusedWindow: true }), activity: activity.tabActivity };
    }, { windowId, tabId });
    throw new Error(`${error.message}; browser state=${JSON.stringify({ pageUrl: page?.url(), pageClosed: page?.isClosed(), chromeState })}`);
  }
  return { ...info, activation: 'chrome.windows/tabs API and Playwright page.bringToFront' };
}

async function waitForBlur(tab, reason) {
  const result = await waitFor(async () => {
    const activity = (await storageSession()).tabActivity;
    const focus = await foregroundInfo();
    const until = activity?.untilByTab?.[String(tab.tab.id)];
    if (activity?.focusedTabId === tab.tab.id || !Number.isSafeInteger(until) || until <= Date.now()) return null;
    if (focus.tabId === tab.tab.id && focus.windowId === activity.focusedWindowId) return null;
    return { activity, until, focus };
  }, `${tab.name} blur deadline was not observable in worker session tabActivity`, 8_000);
  const blurredAt = result.until - 10_000;
  assert.ok(Math.abs(result.until - (blurredAt + 10_000)) <= 2, `${tab.name} did not receive the expected 10s blur lease`);
  const transition = { tab: tab.name, tabId: tab.tab.id, blurredAt, graceUntil: result.until,
    focusedTabIdAfterBlur: result.activity.focusedTabId, focusedWindowIdAfterBlur: result.activity.focusedWindowId,
    awayTabId: result.focus.tabId, awayWindowId: result.focus.windowId, source: 'chrome.storage.session.tabActivity.untilByTab' };
  report.focusTransitions.push(transition);
  return transition;
}

function temporalValuesForTab(activity, tabId) {
  const found = [];
  const wanted = String(tabId);
  const walk = (value, parts = [], hasTabId = false) => {
    if (!value || typeof value !== 'object') {
      if (typeof value === 'number' && Number.isFinite(value) && hasTabId &&
          /until|deadline|expiry|expires/iu.test(parts.join('.'))) {
        found.push({ path: parts.join('.'), value });
      }
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      walk(item, [...parts, key], hasTabId || key === wanted);
    }
  };
  walk(activity);
  return found;
}

async function waitForPendingDeadline(tab, blur) {
  const expected = blur.blurredAt + 30_000;
  const value = await waitFor(async () => {
    const activity = (await storageSession()).tabActivity;
    const values = temporalValuesForTab(activity, tab.tab.id)
      .filter(item => !item.path.endsWith(`untilByTab.${tab.tab.id}`) &&
        Math.abs(item.value - expected) <= 1_500);
    return values.length ? { activity, values } : null;
  }, `${tab.name} 30s pending-init deadline was not observable in worker session tabActivity`, 5_000);
  const observation = { tab: tab.name, tabId: tab.tab.id, source: 'chrome.storage.session.tabActivity',
    expectedDeadline: expected, entries: value.values, snapshot: value.activity };
  report.deadlineObservations.push(observation);
  return { expected, entries: value.values };
}

async function pageState(tab) {
  return tab.page.evaluate(() => {
    const video = window.__qa?.video;
    if (!video) return { exists: false, marker: null, initialized: null, rate: null, defaultRate: null,
      qualityInitialized: null, pendingUntil: null, pendingKey: null,
      paused: true, readyState: 0, currentTime: 0, rateEvents: [], qualityCalls: [] };
    return {
      exists: true,
      marker: video.getAttribute('data-video-control-id'),
      initialized: video.getAttribute('data-video-control-initialized'),
      qualityInitialized: video.getAttribute('data-video-control-quality-initialized'),
      pendingUntil: video.getAttribute('data-video-control-pending-until'),
      pendingKey: video.getAttribute('data-video-control-pending-key'),
      rate: video.playbackRate,
      defaultRate: video.defaultPlaybackRate,
      paused: video.paused,
      readyState: video.readyState,
      currentTime: video.currentTime,
      rateEvents: [...window.__qa.stats.rateEvents],
      qualityCalls: [...window.__qa.stats.qualityCalls],
      routeId: window.__qa.routeId,
    };
  });
}

async function namedVideoState(tab, id) {
  return tab.page.evaluate(videoId => {
    const video = document.getElementById(videoId);
    if (!video || video.tagName !== 'VIDEO') return null;
    return {
      marker: video.getAttribute('data-video-control-id'),
      initialized: video.getAttribute('data-video-control-initialized'),
      qualityInitialized: video.getAttribute('data-video-control-quality-initialized'),
      pendingUntil: video.getAttribute('data-video-control-pending-until'),
      pendingKey: video.getAttribute('data-video-control-pending-key'),
      rate: video.playbackRate,
      defaultRate: video.defaultPlaybackRate,
      paused: video.paused,
      readyState: video.readyState,
    };
  }, id);
}

async function waitRegistered(tab) {
  return waitFor(async () => {
    const state = await pageState(tab);
    return state.marker ? state : null;
  }, `${tab.name} was not registered while focused`, 10_000);
}

async function playAndWaitForInitialization(tab, expectedRate, label = tab.name) {
  await tab.page.evaluate(() => window.__qa.play());
  return waitFor(async () => {
    const state = await pageState(tab);
    return !state.paused && state.readyState >= 2 && state.currentTime > 0 &&
      Math.abs(state.rate - expectedRate) < 0.011 && state.qualityCalls.length > 0 ? state : null;
  }, `${label} did not apply speed and request quality`, 10_000);
}

async function pulseRouteAndMedia(tab, blur, offsetMs) {
  await waitUntil(blur.blurredAt + offsetMs);
  const before = (await storageSession()).tabActivity;
  await tab.page.evaluate(offset => {
    const video = window.__qa.video;
    if (video) video.dispatchEvent(new Event('loadedmetadata'));
    history.replaceState({ pulse: offset }, '', location.pathname + location.search + '#pulse-' + offset);
  }, offsetMs);
  await delay(100);
  const after = (await storageSession()).tabActivity;
  const beforeValues = temporalValuesForTab(before, tab.tab.id);
  const afterValues = temporalValuesForTab(after, tab.tab.id);
  const stable = beforeValues.filter(item => /pending|init|load|discovery|control/iu.test(item.path));
  for (const item of stable) {
    const same = afterValues.find(next => next.path === item.path && next.value === item.value);
    assert.ok(same, `${tab.name} route/media event extended or removed ${item.path} at +${offsetMs}ms`);
  }
  report.routeAndMediaPulses.push({ tab: tab.name, offsetMs, before: stable, after: afterValues,
    activityRevisionBefore: before?.revision, activityRevisionAfter: after?.revision });
}

async function waitForStoppedBackgroundControl(tab) {
  return waitFor(async () => {
    const [content, bridge] = await Promise.all([contentState(tab.tab.id), pageBridgeState(tab.tab.id)]);
    return content?.alive && content.session === false && bridge?.active === false ? { content, bridge } : null;
  }, `${tab.name} kept its background content/page bridge after speed and quality completed`, 5_000);
}

async function run() {
  await mkdir(outputDir, { recursive: true });
  try {
    const manifest = JSON.parse(await readFile(path.join(extensionDir, 'manifest.json'), 'utf8'));
    const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
    report.extensionVersion = manifest.version;
    report.packageVersion = packageJson.version;
    report.packageSha256 = createHash('sha256').update(await readFile(path.join(projectRoot, 'package.json'))).digest('hex');
    assert.equal(manifest.version, packageJson.version, 'built extension version does not match package.json');
    await hashFiles(extensionDir);
    report.testSha256 = createHash('sha256').update(await readFile(scriptPath)).digest('hex');
    const fixtureBytes = await readFile(fixturePath);
    report.fixtureSha256 = createHash('sha256').update(fixtureBytes).digest('hex');
    await startServer(fixtureBytes);

    profileRoot = await mkdtemp(path.join(os.tmpdir(), 'videospeed-qa078-focus-'));
    report.cleanup.profileCreated = true;
    context = await chromium.launchPersistentContext(path.join(profileRoot, 'profile'), {
      executablePath: process.env.VIDEOSPEED_CHROMIUM || chromium.executablePath(),
      headless: true,
      args: [
        '--load-extension=' + extensionDir,
        '--disable-extensions-except=' + extensionDir,
        '--autoplay-policy=no-user-gesture-required',
        '--disable-background-networking',
        '--no-first-run',
        '--host-resolver-rules=MAP www.youtube.com 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
      ],
    });
    context.setDefaultTimeout(15_000);
    context.on('page', page => page.on('pageerror', error => report.errors.push({ url: page.url(), message: error.message })));
    context.on('request', request => {
      let url;
      try { url = new URL(request.url()); }
      catch { blockedExternalRequests.add(request.url()); return; }
      if (url.protocol === 'chrome-extension:' || url.protocol === 'about:' || url.protocol === 'data:') return;
      if (url.hostname === 'www.youtube.com' && Number(url.port) === fixturePort) return;
      if (url.protocol === 'http:' || url.protocol === 'https:') blockedExternalRequests.add(`${url.protocol}//${url.host}`);
    });

    serviceWorker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15_000 });
    report.extensionId = new URL(serviceWorker.url()).host;
    report.chromium = context.browser()?.version() || 'unknown';
    const seededMemory = await seedSettingsAndFollowMemory();

    const targetWindow = await (await worker()).evaluate(url => chrome.windows.create({ url, focused: true, type: 'normal' }), `${fixtureOrigin}/away`);
    await waitFor(async () => {
      const foreground = await foregroundInfo();
      return foreground.focused && foreground.windowId === targetWindow.id ? foreground : null;
    }, 'fixture target window was not focused');

    const alreadyPlaying = await createTab(targetWindow.id, 'already-playing');
    await waitRegistered(alreadyPlaying);
    const playingState = await playAndWaitForInitialization(alreadyPlaying, 8);
    const initializedKey = `yt:${playingState.routeId}`;
    assert.equal(playingState.initialized, initializedKey, 'initial video did not persist its media identity');
    const initializationConfirmedAt = Date.now();
    await waitUntil(initializationConfirmedAt + 1_100);
    const beforeBlurRuntime = {
      pageBridge: await pageBridgeState(alreadyPlaying.tab.id),
      content: await contentState(alreadyPlaying.tab.id),
      page: await pageState(alreadyPlaying),
    };
    assert.equal(beforeBlurRuntime.page.marker, playingState.marker, 'initialized foreground marker changed before blur');
    assert.equal(beforeBlurRuntime.pageBridge.active, true, 'MAIN bridge was not active before blur');
    assert.equal(beforeBlurRuntime.content.session, true, 'ISOLATED session was not enabled before blur');
    assert.ok(beforeBlurRuntime.content.diagnostics.length > 0, 'ISOLATED diagnostics did not expose the foreground controller before blur');
    record('focused initial scan and speed/quality initialization', {
      tabId: alreadyPlaying.tab.id, rate: playingState.rate, defaultRate: playingState.defaultRate,
      initialized: playingState.initialized, qualityCalls: playingState.qualityCalls.length,
      settleObservationMs: Date.now() - initializationConfirmedAt,
    });

    const known15 = await createTab(targetWindow.id, 'known-play-at-15s');
    const known15State = await waitRegistered(known15);
    await installDomProbe(known15.tab.id);
    const blurAlreadyPlaying = await waitForBlur(alreadyPlaying, 'switch to known pending video');
    const initToBlurMs = blurAlreadyPlaying.blurredAt - initializationConfirmedAt;
    report.deadlineObservations.push({ tab: alreadyPlaying.name, source: 'runtime lifecycle before/after blur',
      initializationConfirmedAt, blurAt: blurAlreadyPlaying.blurredAt, initToBlurMs, beforeBlurRuntime });
    assert.ok(initToBlurMs >= 1_000, `already-playing control blurred only ${initToBlurMs}ms after initialization confirmation`);
    const releasedAlreadyPlaying = await waitFor(async () => {
      const state = await pageState(alreadyPlaying);
      return state.marker === null ? { state, releasedAt: Date.now() } : null;
    }, 'initialized video controller was not released after blur', 2_000);
    const afterBlurRuntime = {
      pageBridge: await pageBridgeState(alreadyPlaying.tab.id),
      content: await contentState(alreadyPlaying.tab.id),
      page: releasedAlreadyPlaying.state,
    };
    assert.equal(afterBlurRuntime.page.marker, null, 'background registry marker remained after release');
    assert.equal(afterBlurRuntime.content.diagnostics.length, 0, 'ISOLATED diagnostics retained a controller after blur');
    report.deadlineObservations.push({ tab: alreadyPlaying.name, source: 'runtime lifecycle after blur release',
      releasedAt: releasedAlreadyPlaying.releasedAt, blurToReleaseMs: releasedAlreadyPlaying.releasedAt - blurAlreadyPlaying.blurredAt,
      ...afterBlurRuntime });
    const requestedPageRate = await alreadyPlaying.page.evaluate(() => {
      const before = window.__qa.video.playbackRate;
      const after = window.__qa.setRate(1);
      return { at: Date.now(), before, after, actual: window.__qa.video.playbackRate };
    });
    assert.equal(requestedPageRate.actual, 1, 'page setter did not set 1x after background controller release');
    const manualBackgroundState = await pageState(alreadyPlaying);
    await delay(900);
    const afterNoRepair = await pageState(alreadyPlaying);
    assert.equal(afterNoRepair.rate, 1, 'initialized background video was repaired after blur');
    assert.ok(!afterNoRepair.rateEvents.slice(manualBackgroundState.rateEvents.length).some(event => event.rate === 8),
      'background controller wrote the old speed after the page changed it to 1x');
    const memoryAfterBackgroundChange = await ratePair();
    assert.deepEqual(memoryAfterBackgroundChange, seededMemory, 'page rate change polluted global follow memory');
    record('already initialized background video stops speed enforcement immediately', {
      tabId: alreadyPlaying.tab.id, initializationConfirmedAt, initToBlurMs, blurAt: blurAlreadyPlaying.blurredAt,
      releasedAt: releasedAlreadyPlaying.releasedAt, blurToReleaseMs: releasedAlreadyPlaying.releasedAt - blurAlreadyPlaying.blurredAt,
      beforeBlurRuntime, afterBlurRuntime,
      requestedPageRate, changedTo1xAt: manualBackgroundState.rateEvents.at(-1)?.at ?? Date.now(),
      after: { rate: afterNoRepair.rate, defaultRate: afterNoRepair.defaultRate, rateEvents: afterNoRepair.rateEvents },
      followMemoryBefore: seededMemory, followMemoryAfter: memoryAfterBackgroundChange,
    });

    const empty12 = await createTab(targetWindow.id, 'blank-then-video-at-12s', { empty: true });
    await installDomProbe(empty12.tab.id);
    const blurKnown15 = await waitForBlur(known15, 'switch to blank page');
    await resetDomProbe(known15.tab.id);
    await resetDomProbe(empty12.tab.id);
    await delay(80);
    const emptyContent = await contentState(empty12.tab.id);
    assert.ok(emptyContent?.alive, 'blank fixture content script is missing');
    const known15Lease = await waitForPendingDeadline(known15, blurKnown15);
    const eventCase = await createTab(targetWindow.id, 'shadow-media-event-at-5s', { empty: true, shadow: true });
    const eventCaseFocus = await waitFor(async () => {
      const state = await foregroundInfo();
      return state.focused && state.windowId === targetWindow.id && state.tabId === eventCase.tab.id ? state : null;
    }, 'shadow event fixture was not the real focused Chrome tab');
    const shadowRootFocusedAt = Date.now();
    await waitUntil(shadowRootFocusedAt + 1_100);
    const pendingShadowInsertedAt = Date.now();
    const focusedShadowPendingId = await eventCase.page.evaluate(() =>
      window.__qa.appendShadowPendingVideo('focused-shadow-pending').id);
    const focusedShadowState = await waitFor(async () => {
      const state = await shadowState(eventCase, focusedShadowPendingId);
      return state.marker ? state : null;
    }, 'focused initial scan did not discover the pending video in its open shadow root', 4_000);
    await installDomProbe(eventCase.tab.id);
    report.deadlineObservations.push({ tab: eventCase.name, source: 'focused initial shadow discovery',
      eventCaseFocus, shadowRootFocusedAt, pendingShadowInsertedAt,
      focusedBeforeInsertionMs: pendingShadowInsertedAt - shadowRootFocusedAt,
      focusedShadowPendingId, state: focusedShadowState, discoveredAt: Date.now() });
    const emptyBlur = await waitForBlur(empty12, 'switch to shadow event fixture');
    await resetDomProbe(empty12.tab.id);
    await resetDomProbe(eventCase.tab.id);
    await delay(80);
    const inserted31 = await createTab(targetWindow.id, 'known-play-at-31s');
    const inserted31State = await waitRegistered(inserted31);
    await installDomProbe(inserted31.tab.id);
    const blurEventCase = await waitForBlur(eventCase, 'switch to 31s pending fixture');
    await resetDomProbe(eventCase.tab.id);
    await resetDomProbe(inserted31.tab.id);
    await delay(80);
    const awayTab = await (await worker()).evaluate(windowId => chrome.tabs.create({
      windowId, url: 'about:blank', active: true,
    }), targetWindow.id);
    const blurInserted31 = await waitForBlur(inserted31, 'switch to away tab');
    await resetDomProbe(inserted31.tab.id);
    await delay(80);
    const inserted31Lease = await waitForPendingDeadline(inserted31, blurInserted31);
    const awayWindow = await createAwayWindow(true);
    const awayState = await foregroundInfo();
    assert.equal(awayState.windowId, awayWindow.id, 'focus moved to a different Chrome window');
    for (const tab of [alreadyPlaying, known15, empty12, eventCase, inserted31]) {
      const info = await tabInfo(tab.tab.id);
      assert.equal(info.active, false, `${tab.name} remained the active tab`);
      assert.equal(info.windowId, targetWindow.id, `${tab.name} moved out of the fixture window`);
    }
    report.realFocus = { targetWindowId: targetWindow.id, awayWindowId: awayWindow.id,
      activeAwayTabId: awayTab.id, focusedWindowId: awayState.windowId, foregroundTabId: awayState.tabId };

    const pulseTasks = [];
    let pulseError = null;
    const known15Recovery = { at: null };
    for (const offset of [4_000, 8_000, 12_000]) {
      pulseTasks.push(pulseRouteAndMedia(known15, blurKnown15, offset).catch(error => { pulseError ||= error; }));
    }
    for (const offset of [4_000, 8_000, 12_000, 18_000, 24_000, 28_000]) {
      pulseTasks.push(pulseRouteAndMedia(inserted31, blurInserted31, offset).catch(error => { pulseError ||= error; }));
    }
    const scanTasks = [known15, empty12, eventCase, inserted31].map(tab => {
      const blur = tab === known15 ? blurKnown15 : tab === empty12 ? emptyBlur : tab === eventCase ? blurEventCase : blurInserted31;
      return verifyBlurScanWindow(tab, blur, {
        expectShadowScan: tab !== empty12,
        allowRecoveryQuery: tab === known15 ? known15Recovery : null,
      }).catch(error => { pulseError ||= error; });
    });
    const eventDiscoveryTask = verifyEventDiscovery(eventCase, blurEventCase).catch(error => { pulseError ||= error; });

    await waitUntil(emptyBlur.blurredAt + 12_000);
    assert.ok(Date.now() > emptyBlur.blurredAt + 10_000, 'blank-page case did not pass its 10s discovery deadline');
    await empty12.page.evaluate(() => window.__qa.play());
    await delay(500);
    const emptyAt12 = await pageState(empty12);
    assert.equal(emptyAt12.marker, null, 'video inserted after 10s was registered in the background');
    assert.equal(emptyAt12.rate, 1, 'video inserted after 10s received a speed in the background');
    assert.equal(emptyAt12.defaultRate, 1, 'video inserted after 10s received a default speed in the background');
    assert.equal(emptyAt12.qualityCalls.length, 0, 'video inserted after 10s invoked background quality control');
    const emptyRuntime = await contentState(empty12.tab.id);
    assert.equal(emptyRuntime?.session, false, 'blank page kept a session after its 10s discovery lease');
    record('empty background page stops discovery at 10s', {
      tabId: empty12.tab.id, blurAt: emptyBlur.blurredAt, insertedAt: Date.now(), state: emptyAt12, runtime: emptyRuntime,
      activity: (await storageSession()).tabActivity,
    });

    const known15TwelveSecondPulse = await waitFor(() => report.routeAndMediaPulses.find(item =>
      item.tab === known15.name && item.offsetMs === 12_000), 'known15 +12s route/media pulse was not recorded', 5_000);
    await waitUntil(blurKnown15.blurredAt + 12_000);
    const takeoverStartedAt = Date.now();
    assert.ok(takeoverStartedAt - blurKnown15.blurredAt < 15_000,
      'known15 context takeover started too close to or after its 15s playback deadline');
    const strangerId = await known15.page.evaluate(() =>
      window.__qa.appendUntrackedVideo('reinject-unmarked-video').id);
    const strangerBeforeTakeover = await namedVideoState(known15, strangerId);
    const knownBeforeTakeover = await pageState(known15);
    assert.equal(strangerBeforeTakeover.marker, null, 'unmarked video was discovered before isolated-context takeover');
    assert.equal(strangerBeforeTakeover.rate, 1, 'unmarked video received a speed before isolated-context takeover');
    assert.ok(knownBeforeTakeover.marker, 'known pending video lost its registry marker before takeover');
    assert.ok(knownBeforeTakeover.pendingUntil, 'known video had no pending-until marker before takeover');
    assert.ok(knownBeforeTakeover.pendingKey, 'known video had no pending media key before takeover');
    const deadlineBeforeTakeover = await waitForPendingDeadline(known15, blurKnown15);
    assert.equal(deadlineBeforeTakeover.expected, blurKnown15.blurredAt + 30_000,
      'known15 pending deadline was not fixed at blur + 30s before takeover');
    assert.deepEqual(deadlineBeforeTakeover.entries, known15Lease.entries,
      'known15 pending deadline changed before context takeover');
    const runtimeBeforeTakeover = await contentState(known15.tab.id);
    const pendingDiagnosticBefore = runtimeBeforeTakeover?.diagnostics?.find(item => item.id === knownBeforeTakeover.marker);
    assert.equal(pendingDiagnosticBefore?.pendingUntil, deadlineBeforeTakeover.expected,
      'ISOLATED session did not expose the same per-element pending-until before takeover');

    const takeover = await simulateContentContextTakeover(known15.tab.id, strangerId);
    known15Recovery.at = takeover.at;
    assert.equal(takeover.disposed?.before?.alive, true, 'simulated stale isolated context was not alive before dispose');
    assert.equal(takeover.disposed?.removed, true, 'dispose did not remove the old video-control API');
    assert.equal(takeover.disposed?.knownAfterDispose?.pendingUntil, knownBeforeTakeover.pendingUntil,
      'dispose changed the existing element pending-until marker');
    assert.equal(takeover.disposed?.knownAfterDispose?.pendingKey, knownBeforeTakeover.pendingKey,
      'dispose changed the existing element pending media key');
    assert.equal(takeover.disposed?.strangerAfterDispose?.marker, null,
      'stale isolated context registered the unmarked video during dispose');

    const runtimeAfterTakeover = await waitFor(async () => {
      const content = await contentState(known15.tab.id);
      return content?.alive && content.session && content.videos.length ? content : null;
    }, 'injected content.js did not restore a session for the marked known video', 8_000);
    const knownAfterTakeover = await waitRegistered(known15);
    const strangerAfterTakeover = await namedVideoState(known15, strangerId);
    assert.equal(knownAfterTakeover.pendingUntil, knownBeforeTakeover.pendingUntil,
      'known pending-until marker changed after isolated-context takeover');
    assert.equal(knownAfterTakeover.pendingKey, knownBeforeTakeover.pendingKey,
      'known pending media key changed after isolated-context takeover');
    assert.equal(knownAfterTakeover.initialized, null, 'known video initialized before its scheduled first playback');
    assert.equal(strangerAfterTakeover.marker, null, 'unmarked video acquired a control marker after takeover');
    assert.equal(strangerAfterTakeover.initialized, null, 'unmarked video was initialized after takeover');
    assert.equal(strangerAfterTakeover.pendingUntil, null, 'unmarked video acquired a pending deadline after takeover');
    assert.equal(strangerAfterTakeover.rate, 1, 'unmarked video received a speed after takeover');
    assert.equal(strangerAfterTakeover.defaultRate, 1, 'unmarked video received a default speed after takeover');
    const deadlineAfterTakeover = await waitForPendingDeadline(known15, blurKnown15);
    assert.equal(deadlineAfterTakeover.expected, deadlineBeforeTakeover.expected,
      'known15 pending deadline moved during content takeover');
    assert.deepEqual(deadlineAfterTakeover.entries, deadlineBeforeTakeover.entries,
      'worker loadingUntil changed during content takeover');
    const pendingDiagnosticAfter = runtimeAfterTakeover.diagnostics.find(item => item.id === knownAfterTakeover.marker);
    assert.equal(pendingDiagnosticAfter?.pendingUntil, pendingDiagnosticBefore.pendingUntil,
      'recovered ISOLATED session changed the per-element pending-until value');
    record('same-document context takeover retains known pending lease and rejects unmarked media', {
      tabId: known15.tab.id, blurAt: blurKnown15.blurredAt,
      routePulseOffsetMs: known15TwelveSecondPulse.offsetMs,
      routePulseRevision: known15TwelveSecondPulse.activityRevisionAfter,
      takeoverStartedAt, takeover, knownBeforeTakeover, knownAfterTakeover,
      strangerBeforeTakeover, strangerAfterTakeover,
      deadlineBeforeTakeover: { expected: deadlineBeforeTakeover.expected, entries: deadlineBeforeTakeover.entries },
      deadlineAfterTakeover: { expected: deadlineAfterTakeover.expected, entries: deadlineAfterTakeover.entries },
      pendingUntilBefore: pendingDiagnosticBefore.pendingUntil, pendingUntilAfter: pendingDiagnosticAfter.pendingUntil,
      runtime: { before: { alive: runtimeBeforeTakeover.alive, session: runtimeBeforeTakeover.session },
        after: { alive: runtimeAfterTakeover.alive, session: runtimeAfterTakeover.session,
          videos: runtimeAfterTakeover.videos.map(item => item.id) } },
    });

    await waitUntil(blurKnown15.blurredAt + 15_000);
    assert.ok(Date.now() < blurKnown15.blurredAt + 30_000, '15s play missed the 30s pending initialization deadline');
    const late15 = await playAndWaitForInitialization(known15, 8, 'known video started at 15s in background');
    assert.ok(known15State.marker, 'known pending element was not marked before blur');
    assert.equal(late15.initialized, `yt:${late15.routeId}`, '15s background playback initialized the wrong media key');
    assert.equal(late15.qualityCalls.length, 1, 'known video quality was applied more than once after takeover');
    const strangerAfterKnownPlay = await namedVideoState(known15, strangerId);
    assert.equal(strangerAfterKnownPlay.marker, null, 'unmarked video acquired a marker when the known video started');
    assert.equal(strangerAfterKnownPlay.rate, 1, 'unmarked video received speed when the known video started');
    assert.equal(strangerAfterKnownPlay.defaultRate, 1, 'unmarked video received a default speed when the known video started');
    const known15Released = await waitForStoppedBackgroundControl(known15);
    const known15Activity = (await storageSession()).tabActivity;
    record('known pending video starts at 15s and releases after speed plus quality result', {
      tabId: known15.tab.id, blurAt: blurKnown15.blurredAt, playedAt: Date.now(),
      deadline: known15Lease, state: late15, released: known15Released,
      activityAfterCompletion: known15Activity,
    });

    await waitUntil(blurInserted31.blurredAt + 31_000);
    assert.ok(Date.now() > blurInserted31.blurredAt + 30_000, '31s case did not pass its pending initialization deadline');
    await inserted31.page.evaluate(() => window.__qa.play());
    await delay(600);
    const late31 = await pageState(inserted31);
    assert.equal(late31.marker, null, 'expired pending video was registered after 30s');
    assert.equal(late31.rate, 1, 'expired pending video received speed in the background');
    assert.equal(late31.defaultRate, 1, 'expired pending video received default speed in the background');
    assert.equal(late31.qualityCalls.length, 0, 'expired pending video invoked background quality control');
    const expiredRuntime = await contentState(inserted31.tab.id);
    assert.equal(expiredRuntime?.session, false, 'expired pending video retained a background session');
    record('known pending video does not initialize after 30s despite route/media events', {
      tabId: inserted31.tab.id, blurAt: blurInserted31.blurredAt, playedAt: Date.now(),
      deadline: inserted31Lease, state: late31, runtime: expiredRuntime,
      pulses: report.routeAndMediaPulses.filter(item => item.tab === inserted31.name),
    });

    await Promise.all(pulseTasks);
    await Promise.all(scanTasks);
    await eventDiscoveryTask;
    if (pulseError) throw pulseError;

    await closeAwayWindowForHeadlessReturn(awayWindow.id, targetWindow.id);
    const focusExpired = await activateTab(targetWindow.id, inserted31.tab.id, inserted31.page);
    const focusedExpired = await waitRegistered(inserted31);
    const focused31 = await waitFor(async () => {
      const state = await pageState(inserted31);
      return Math.abs(state.rate - 8) < 0.011 && state.qualityCalls.length > 0 ? state : null;
    }, 'returning to the expired tab did not discover and initialize its playing video', 12_000);
    record('expired known video initializes after returning to foreground', {
      tabId: inserted31.tab.id, focus: focusExpired, registryMarker: focusedExpired.marker, state: focused31,
    });

    await activateTab(targetWindow.id, empty12.tab.id, empty12.page);
    const focusedEmpty = await waitRegistered(empty12);
    const focusedEmptyPlayback = await waitFor(async () => {
      const state = await pageState(empty12);
      return Math.abs(state.rate - 8) < 0.011 && state.qualityCalls.length > 0 ? state : null;
    }, 'newly focused page did not initialize its previously unseen playing video', 12_000);
    record('new focus performs a fresh scan and initializes a previously unseen video', {
      tabId: empty12.tab.id, registryMarker: focusedEmpty.marker, state: focusedEmptyPlayback,
    });

    const freshFocused = await createTab(targetWindow.id, 'fresh-focused-page');
    const freshFocusedState = await waitRegistered(freshFocused);
    const freshPlayback = await playAndWaitForInitialization(freshFocused, 8, 'newly focused page');
    const freshInitializationConfirmedAt = Date.now();
    await waitUntil(freshInitializationConfirmedAt + 1_100);
    assert.equal(freshPlayback.rate, 8, 'fresh focused video was not initialized at the expected actual rate');
    assert.equal(freshPlayback.defaultRate, 8, 'fresh focused video did not acquire its extension-owned default rate');
    record('newly focused page independently initializes its media', {
      tabId: freshFocused.tab.id, registryMarker: freshFocusedState.marker,
      initializationConfirmedAt: freshInitializationConfirmedAt, state: freshPlayback,
    });
    await installDomProbe(freshFocused.tab.id);
    await resetDomProbe(freshFocused.tab.id);
    await delay(150);
    const extraId = await freshFocused.page.evaluate(() => window.__qa.appendExtraVideo('focused-incremental-video').id);
    const extraMarker = await waitFor(() => freshFocused.page.evaluate(id =>
      document.getElementById(id)?.getAttribute('data-video-control-id') || null, extraId),
    'focused incremental observer did not register an inserted video');
    const incrementalProbe = await readDomProbe(freshFocused.tab.id);
    assert.equal(incrementalProbe.queries.filter(item => item.root === 'document').length, 0,
      'focused incremental discovery repeated a full document video query');
    assert.equal(incrementalProbe.walkers.filter(item => item.root === 'document').length, 0,
      'focused incremental discovery walked the entire document again');
    record('focused dwell discovers a new video incrementally', {
      tabId: freshFocused.tab.id, videoId: extraId, marker: extraMarker, probe: incrementalProbe,
    });

    const focusInitialized = await activateTab(targetWindow.id, alreadyPlaying.tab.id, alreadyPlaying.page);
    const blurFreshForGlobalOff = await waitForBlur(freshFocused, 'switch from fresh initialized media to already initialized media');
    const freshInitToBlurMs = blurFreshForGlobalOff.blurredAt - freshInitializationConfirmedAt;
    assert.ok(freshInitToBlurMs >= 1_000, `fresh video blurred only ${freshInitToBlurMs}ms after initialization confirmation`);
    const freshReleasedBeforeGlobalOff = await waitFor(async () => {
      const state = await pageState(freshFocused);
      return state.marker === null ? state : null;
    }, 'fresh initialized video marker remained after blur', 2_000);
    assert.equal(freshReleasedBeforeGlobalOff.rate, 8, 'fresh background video actual rate changed before global off');
    assert.equal(freshReleasedBeforeGlobalOff.defaultRate, 8, 'fresh background video default rate was not retained before global off');
    const returnedPlaying = await waitFor(async () => {
      const state = await pageState(alreadyPlaying);
      return state.marker && state.initialized === initializedKey ? state : null;
    }, 'return to initialized video did not restore its existing identity', 12_000);
    await delay(800);
    const returnedStable = await pageState(alreadyPlaying);
    assert.equal(returnedStable.rate, 1, 'returning to initialized media reapplied the default over the current page rate');
    assert.equal(returnedStable.initialized, initializedKey, 'returning changed the initialized media identity');
    assert.equal(returnedStable.qualityCalls.length, playingState.qualityCalls.length,
      'returning re-applied quality to already initialized media');
    const finalMemory = await ratePair();
    assert.deepEqual(finalMemory, seededMemory, 'background page rate change polluted global follow memory');
    record('return to initialized media preserves current rate and does not reapply defaults', {
      tabId: alreadyPlaying.tab.id, focus: focusInitialized, beforeBlur: playingState, firstReturn: returnedPlaying,
      afterReturn: returnedStable, followMemoryBefore: seededMemory, followMemoryAfter: finalMemory,
    });

    const releasedBeforeGlobalOff = await pageState(freshFocused);
    assert.equal(releasedBeforeGlobalOff.marker, null, 'fresh background controller was not released before global off');
    assert.equal(releasedBeforeGlobalOff.rate, 8, 'actual playback rate changed before global off');
    assert.equal(releasedBeforeGlobalOff.defaultRate, 8, 'fixture did not retain the extension-owned default before global off');
    const currentSettings = (await storageLocal()).settings;
    await (await worker()).evaluate(settings => chrome.storage.local.set({
      settings: { ...settings, enabled: false },
    }), currentSettings || SETTINGS);
    const restoredAfterGlobalOff = await waitFor(async () => {
      const state = await pageState(freshFocused);
      return state.defaultRate === 1 ? state : null;
    }, 'global off did not restore the original defaultPlaybackRate', 8_000);
    assert.equal(restoredAfterGlobalOff.rate, 8, 'global off changed the current playback rate');
    assert.equal(restoredAfterGlobalOff.marker, null, 'global off restored a video control marker');
    const disabledRuntime = {
      pageBridge: await pageBridgeState(freshFocused.tab.id),
      content: await contentState(freshFocused.tab.id),
    };
    record('global off restores extension-owned default after blur without changing actual speed', {
      tabId: freshFocused.tab.id, initializationConfirmedAt: freshInitializationConfirmedAt,
      initToBlurMs: freshInitToBlurMs, blur: blurFreshForGlobalOff,
      beforeGlobalOff: releasedBeforeGlobalOff, afterGlobalOff: restoredAfterGlobalOff, runtime: disabledRuntime,
    });

    assert.deepEqual(report.errors, [], 'fixture page raised page errors');
    assert.deepEqual([...blockedExternalRequests], [], 'fixture attempted a non-fixture external request');
    report.result = 'PASS';
  } catch (error) {
    report.result = 'FAIL';
    report.error = String(error?.stack || error?.message || error);
    report.errors.push({ message: String(error?.message || error) });
  } finally {
    report.blockedExternalRequests = [...blockedExternalRequests];
    report.completedAt = new Date().toISOString();
    await context?.close().then(() => { report.cleanup.browserClosed = true; })
      .catch(error => { report.cleanup.error ||= String(error?.message || error); });
    if (fixtureServer) {
      await new Promise(resolve => {
        fixtureServer.closeAllConnections?.();
        fixtureServer.close(resolve);
      }).then(() => { report.cleanup.serverClosed = true; })
        .catch(error => { report.cleanup.error ||= String(error?.message || error); });
    }
    if (profileRoot) {
      const resolved = await realpath(profileRoot).catch(() => path.resolve(profileRoot));
      const temp = await realpath(os.tmpdir()).catch(() => path.resolve(os.tmpdir()));
      const relative = path.relative(temp, resolved);
      const safe = path.basename(resolved).startsWith('videospeed-qa078-focus-') && relative &&
        relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
      if (!safe) report.cleanup.error ||= 'Refused cleanup outside dedicated videospeed-qa078 OS temp directory';
      else {
        report.cleanup.profileVerifiedInsideOsTemp = true;
        await rm(resolved, { recursive: true, force: true }).then(() => { report.cleanup.profileRemoved = true; })
          .catch(error => { report.cleanup.error ||= String(error?.message || error); });
      }
    }
    await mkdir(outputDir, { recursive: true });
    await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
      .catch(error => { report.cleanup.error ||= String(error?.message || error); });
  }
  console.log(JSON.stringify({ result: report.result, extensionVersion: report.extensionVersion,
    extensionAggregateSha256: report.extensionAggregateSha256, extensionFileHashes: report.extensionFileHashes,
    testSha256: report.testSha256, packageSha256: report.packageSha256, fixtureSha256: report.fixtureSha256,
    chromium: report.chromium, checks: report.checks,
    focusTransitions: report.focusTransitions, deadlineObservations: report.deadlineObservations,
    routeAndMediaPulses: report.routeAndMediaPulses, cleanup: report.cleanup,
    focusFallback: report.focusFallback,
    outputPath, error: report.error || null }, null, 2));
  if (report.result !== 'PASS' || report.cleanup.error) process.exitCode = 1;
}

await run();
