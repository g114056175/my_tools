#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  const value = process.env.VIDEOSPEED_PLAYWRIGHT?.trim();
  if (!value) return require('playwright');
  const candidate = path.resolve(value);
  try {
    const info = require('node:fs').statSync(candidate);
    if (info.isDirectory() || info.isFile()) return require(candidate);
  } catch { /* A package name can also be supplied. */ }
  return require(value);
}
const { chromium } = loadPlaywright();

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '../..');
const extensionDirectory = path.join(projectRoot, 'extension');
const fixturePath = path.join(projectRoot, 'tests', 'fixtures', 'tiny.webm');
const reportDirectory = path.join(projectRoot, 'work', 'qa-069-activity');
const resultsPath = path.join(reportDirectory, 'results.json');
const runtimeFiles = [
  'manifest.json', 'background.js', 'content.js', 'page-bridge.js',
  'popup.html', 'popup.js', 'popup.css', 'settings.js', 'site-rules.js', 'site-domain.js',
  'i18n.js', 'locale-zh.js', 'quality-options.js',
  'icons/16.png', 'icons/32.png', 'icons/48.png', 'icons/128.png',
];
const probeKey = 'videospeed.qa-069.activity.dom-probe';
const messageProbeKey = 'videospeed.qa-069.activity.message-probe';
const checks = [];
const errors = [];
const hashes = {};
const chromeStates = [];
const coverageLimitations = ['Headless run keeps one Chromium window and switches real tabs only; OS-level blur and an active tab in a nonfocused browser window are unverified.'];
const blockedRequests = new Set();
const servedLocalRequests = [];
const cleanup = { temporaryProfileCreated: false, verifiedInsideOsTemp: false, removed: false, error: null };
let context;
let serviceWorker;
let fixtureServer;
let fixtureBaseUrl = '';
let fixturePort = 0;
let extensionId = '';
let temporaryRoot;
let version = 'unavailable';
let chromiumVersion = 'unavailable';
let fatalError = null;

const settings = {
  enabled: true,
  preferredRate: 2,
  defaultMode: 'custom',
  customRate: 8,
  steps: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 6, 8, 10, 12],
  qualityEnabled: true,
  preferredQuality: 720,
  shortcuts: { slower: '<', faster: '>', reset: ':', preferred: '"', fineSlower: '', fineFaster: '' },
  disabledSites: [],
  siteModes: {},
};

function record(name, status, detail = '') {
  checks.push({ name, status, detail: String(detail || '').replace(/\s+/gu, ' ').trim() });
}

async function check(name, fn) {
  try {
    const detail = await fn();
    record(name, 'PASS', detail);
  } catch (error) {
    const detail = error?.stack || error?.message || String(error);
    record(name, 'FAIL', detail);
    errors.push({ check: name, message: String(error?.message || error) });
    throw error;
  }
}

async function waitFor(predicate, message, timeout = 8000) {
  const started = performance.now();
  let lastError;
  while (performance.now() - started < timeout) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(message + (lastError ? ': ' + lastError.message : ''));
}

function fixtureHtml(url) {
  let frames = '';
  if (url.searchParams.has('iframe')) {
    frames += '<iframe id="qa-child" title="child fixture" src="/fixture?frame=child"></iframe>';
  }
  if (url.searchParams.has('extraFrames')) {
    frames += '<iframe id="qa-extra-a" title="extra fixture a" src="/fixture?frame=a"></iframe>' +
      '<iframe id="qa-extra-b" title="extra fixture b" src="/fixture?frame=b"></iframe>';
  }
  return [
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>VideoSpeed activity fixture</title>',
    '<style>body{font:16px system-ui;margin:16px;background:#f3f5f8}#player{width:480px;max-width:92vw;background:#111;padding:10px;border-radius:8px}video{display:block;width:100%;height:160px;background:#050505}iframe{display:block;width:500px;height:260px;border:1px solid #888;margin-top:8px}</style>',
    '</head><body><main id="player"><video id="qa-video" autoplay muted loop playsinline controls src="/tiny.webm"></video></main>',
    frames,
    '<script>(()=>{',
    'const player=document.querySelector("#player");',
    'const stats={qualityReads:0,qualitySetters:[]};',
    'player.getAvailableQualityLevels=()=>{stats.qualityReads++;return ["hd720","hd1080"]};',
    'player.setPlaybackQualityRange=(min,max)=>{stats.qualitySetters.push([min,max])};',
    'window.__qaQuality=stats;',
    'window.qaAppendVideo=async (suffix,shouldPlay=true)=>{const video=document.createElement("video");video.id="qa-video-"+suffix;video.autoplay=shouldPlay;video.muted=true;video.loop=true;video.playsInline=true;video.controls=true;video.src="/tiny.webm?media="+encodeURIComponent(suffix);player.append(video);if(shouldPlay)try{await video.play()}catch{}return video};',
    'window.qaVideo=id=>document.getElementById(id||"qa-video");',
    '})();</script></body></html>',
  ].join('');
}

async function startFixtureServer(mediaBytes) {
  fixtureServer = createServer((request, response) => {
    const url = new URL(request.url || '/', fixtureBaseUrl || 'http://127.0.0.1');
    servedLocalRequests.push({ path: url.pathname, query: url.search });
    if (url.pathname.endsWith('/tiny.webm')) {
      const range = /^bytes=(\d+)-(\d*)$/u.exec(String(request.headers.range || ''));
      if (range) {
        const start = Number(range[1]);
        const end = Math.min(range[2] ? Number(range[2]) : mediaBytes.length - 1, mediaBytes.length - 1);
        response.writeHead(206, {
          'content-type': 'video/webm', 'cache-control': 'no-store', 'accept-ranges': 'bytes',
          'content-range': 'bytes ' + start + '-' + end + '/' + mediaBytes.length,
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
    response.end(fixtureHtml(url));
  });
  await new Promise((resolve, reject) => {
    fixtureServer.once('error', reject);
    fixtureServer.listen(0, '127.0.0.1', resolve);
  });
  fixturePort = fixtureServer.address().port;
  fixtureBaseUrl = 'http://127.0.0.1:' + fixturePort;
}

async function installExternalBlocker() {
  await context.route('**/*', async route => {
    const raw = route.request().url();
    let url;
    try { url = new URL(raw); } catch { return route.abort('blockedbyclient'); }
    if (url.protocol === 'chrome-extension:' || url.protocol === 'about:' || url.protocol === 'data:') return route.continue();
    if (url.protocol === 'http:' && url.hostname === '127.0.0.1' && Number(url.port) === fixturePort) {
      return route.continue();
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') blockedRequests.add(url.protocol + '//' + url.host);
    return route.abort('blockedbyclient');
  });
}

async function worker() {
  if (serviceWorker?.url().includes('chrome-extension://' + extensionId + '/')) return serviceWorker;
  serviceWorker = context.serviceWorkers().find(item => item.url().includes('chrome-extension://' + extensionId + '/'));
  if (serviceWorker) return serviceWorker;
  serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  return serviceWorker;
}

async function seedSettings(patch = {}, memory = {}) {
  const sw = await worker();
  await sw.evaluate(async ({ settings, memory }) => {
    await chrome.storage.local.set({ settings, ...memory });
  }, { settings: { ...settings, ...patch }, memory });
}

async function storedRatePair() {
  const sw = await worker();
  return sw.evaluate(async () => {
    const value = await chrome.storage.local.get(['lastRate', 'lastRateRevision']);
    return { lastRate: value.lastRate, lastRateRevision: value.lastRateRevision };
  });
}

async function activitySnapshot() {
  const sw = await worker();
  return sw.evaluate(async () => chrome.storage.session.get('tabActivity'));
}

async function createTab(url, windowId, active = false) {
  const sw = await worker();
  return sw.evaluate(({ url, windowId, active }) => chrome.tabs.create({ url, windowId, active }), { url, windowId, active });
}

async function activateTab(tabId) {
  const sw = await worker();
  return sw.evaluate(id => chrome.tabs.update(id, { active: true }), tabId);
}

async function tabInfo(tabId) {
  const sw = await worker();
  return sw.evaluate(id => chrome.tabs.get(id), tabId);
}

async function pageForUrl(url) {
  try {
    return await waitFor(() => context.pages().find(page => page.url() === url), 'fixture target did not attach');
  } catch {
    const tabs = await (await worker()).evaluate(async () => (await chrome.tabs.query({})).map(tab => ({
      id: tab.id, windowId: tab.windowId, active: tab.active, status: tab.status,
      url: tab.url || '', pendingUrl: tab.pendingUrl || '',
    })));
    throw new Error('Playwright target missing for ' + url + '; pages=' +
      JSON.stringify(context.pages().map(page => page.url())) + '; tabs=' + JSON.stringify(tabs));
  }
}

async function closeTab(tabId) {
  const sw = await worker();
  await sw.evaluate(id => chrome.tabs.remove(id), tabId);
}

async function chromeState(label) {
  const sw = await worker();
  const state = await sw.evaluate(async () => {
    const windows = await chrome.windows.getAll({ populate: true });
    const shaped = windows.map(win => ({
      id: win.id,
      focused: win.focused === true,
      activeTabId: win.tabs?.find(tab => tab.active)?.id ?? null,
      tabs: (win.tabs || []).map(tab => ({
        id: tab.id,
        active: tab.active === true,
        status: tab.status || '',
        url: tab.url || '',
      })),
    }));
    return {
      focusedWindowIds: shaped.filter(win => win.focused).map(win => win.id),
      windows: shaped,
    };
  });
  chromeStates.push({ label, ...state });
  return state;
}

function frameForName(page, name) {
  return page.frames().find(frame => {
    try { return new URL(frame.url()).searchParams.get('frame') === name; } catch { return false; }
  });
}

async function waitFrame(page, name) {
  return waitFor(() => frameForName(page, name), 'fixture frame did not load: ' + name);
}

async function videoState(frame, selector = '#qa-video') {
  return frame.evaluate(selector => {
    const video = document.querySelector(selector);
    if (!video) return null;
    return {
      rate: video.playbackRate,
      defaultRate: video.defaultPlaybackRate,
      marker: video.getAttribute('data-video-control-id'),
      initialized: video.getAttribute('data-video-control-initialized'),
      readyState: video.readyState,
    };
  }, selector);
}

async function waitVideo(frame, selector, predicate, message, timeout = 8000) {
  return waitFor(async () => {
    const state = await videoState(frame, selector);
    return state && predicate(state) ? state : null;
  }, message, timeout);
}

async function qualityState(frame) {
  return frame.evaluate(() => ({
    reads: window.__qaQuality?.qualityReads ?? -1,
    setters: window.__qaQuality?.qualitySetters?.length ?? -1,
  }));
}

async function appendVideo(frame, suffix, shouldPlay = true) {
  return frame.evaluate(({ name, shouldPlay }) => window.qaAppendVideo(name, shouldPlay).then(video => video.id), { name: suffix, shouldPlay });
}

async function installDomProbe(tabId) {
  const sw = await worker();
  return sw.evaluate(async ({ tabId, key }) => chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'ISOLATED',
    args: [key],
    func: probeName => {
      const symbol = Symbol.for(probeName);
      if (globalThis[symbol]) return true;
      const state = { walkerCalls: 0, documentWalkerCalls: 0, videoQueries: 0 };
      globalThis[symbol] = state;
      const originalWalker = Document.prototype.createTreeWalker;
      Document.prototype.createTreeWalker = function (...args) {
        state.walkerCalls += 1;
        if (args[0] === this) state.documentWalkerCalls += 1;
        return Reflect.apply(originalWalker, this, args);
      };
      const originalQuery = Document.prototype.querySelectorAll;
      Document.prototype.querySelectorAll = function (selector, ...args) {
        if (this === document && /(?:^|[,\s])video(?:$|[,\s])/iu.test(String(selector))) state.videoQueries += 1;
        return Reflect.apply(originalQuery, this, [selector, ...args]);
      };
      return true;
    },
  }), { tabId, key: probeKey });
}

async function readDomProbe(tabId) {
  const sw = await worker();
  return sw.evaluate(async ({ tabId, key }) => chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'ISOLATED',
    args: [key],
    func: probeName => {
      const state = globalThis[Symbol.for(probeName)];
      return state ? { ...state } : null;
    },
  }), { tabId, key: probeKey });
}

async function contentApiState(tabId, frameId = 0) {
  const sw = await worker();
  const rows = await sw.evaluate(async ({ tabId, frameId }) => chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    world: 'ISOLATED',
    func: () => {
      const api = globalThis[Symbol.for('video-control.api')];
      return { present: !!api, session: !!api?.enabled?.(), alive: !!api?.alive?.() };
    },
  }), { tabId, frameId });
  return rows?.[0]?.result || null;
}

function aggregateProbe(rows) {
  return (rows || []).reduce((sum, row) => {
    const value = row.result || {};
    sum.walkerCalls += value.walkerCalls || 0;
    sum.documentWalkerCalls += value.documentWalkerCalls || 0;
    sum.videoQueries += value.videoQueries || 0;
    return sum;
  }, { walkerCalls: 0, documentWalkerCalls: 0, videoQueries: 0 });
}

async function settleDomProbe(tabId) {
  let previous = JSON.stringify(aggregateProbe(await readDomProbe(tabId)));
  let stable = 0;
  while (stable < 3) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const current = JSON.stringify(aggregateProbe(await readDomProbe(tabId)));
    if (current === previous) stable += 1;
    else { previous = current; stable = 0; }
  }
  return JSON.parse(previous);
}

async function installMessageProbe() {
  const sw = await worker();
  return sw.evaluate(key => {
    const symbol = Symbol.for(key);
    if (globalThis[symbol]) return true;
    const state = { settings: [] };
    const listener = (message, sender) => {
      if (message?.scope === 'video-control' && message.action === 'settings') {
        state.settings.push({ tabId: sender.tab?.id ?? null, frameId: sender.frameId ?? null });
      }
    };
    state.listener = listener;
    globalThis[symbol] = state;
    chrome.runtime.onMessage.addListener(listener);
    return true;
  }, messageProbeKey);
}

async function readMessageProbe() {
  const sw = await worker();
  return sw.evaluate(key => globalThis[Symbol.for(key)]?.settings || null, messageProbeKey);
}

async function frameMemory(tabId) {
  const sw = await worker();
  return sw.evaluate(async id => chrome.scripting.executeScript({
    target: { tabId: id, allFrames: true },
    world: 'ISOLATED',
    func: () => {
      const api = globalThis[Symbol.for('video-control.api')];
      const diagnostics = api?.diagnostics?.() || [];
      return diagnostics[0]?.memory || null;
    },
  }), tabId);
}

async function sendControl(tabId, frameId, id, command, value) {
  const sw = await worker();
  return sw.evaluate(async ({ tabId, frameId, id, command, value }) => chrome.tabs.sendMessage(
    tabId,
    { scope: 'video-control', action: 'control', id, command, value },
    { frameId },
  ), { tabId, frameId, id, command, value });
}

async function runChecks() {
  const qa = {};
  await check('未訪問背景分頁不建立 Session、不掃描、不呼叫畫質 setter', async () => {
    await seedSettings({}, { lastRate: 3, lastRateRevision: 1 });
    const urlA = fixtureBaseUrl + '/fixture?iframe=1';
    qa.pageA = context.pages()[0];
    assert.ok(qa.pageA, 'isolated Chromium did not start with its default tab');
    await qa.pageA.goto(urlA, { waitUntil: 'domcontentloaded' });
    await qa.pageA.waitForSelector('#qa-video');
    const tabs = await (await worker()).evaluate(async () => chrome.tabs.query({}));
    const initialTab = tabs.find(tab => tab.url === urlA);
    assert.ok(initialTab?.id && initialTab.windowId, 'Chrome tabs.query did not return the initial fixture tab');
    qa.tabA = initialTab;
    qa.windowId = initialTab.windowId;
    const initialState = await chromeState('initial active tab');
    assert.equal(initialState.windows.length, 1, 'expected one isolated browser window');
    assert.equal(initialState.windows[0]?.focused, true, 'Chrome did not report the single test window focused');
    assert.equal(initialState.windows[0]?.activeTabId, qa.tabA.id, 'initial fixture is not Chrome active tab');

    qa.childA = await waitFrame(qa.pageA, 'child');
    const framesA = [qa.pageA.mainFrame(), qa.childA];
    await installDomProbe(qa.tabA.id);
    await waitFor(async () => (await Promise.all(framesA.map(frame => videoState(frame)))).every(value => value?.marker),
      'active window did not register all initial fixture videos');
    await waitFor(async () => (await Promise.all(framesA.map(qualityState))).some(value => value.setters > 0),
      'active window did not apply the fixture quality preset');
    const presetVideo = await waitFor(async () => {
      for (const frame of framesA) {
        const state = await videoState(frame);
        if (state?.marker && Math.abs(state.rate - 8) < 0.011) return { frame, state };
      }
      return null;
    }, 'active fixture did not apply its custom speed preset');
    // Applying the preset and acknowledging its memory are separate messages.
    // Finish that setup before measuring whether a synthetic key writes memory.
    const beforeSyntheticKey = await waitFor(async()=>{const pair=await storedRatePair();return pair.lastRate===8?pair:null;},'preset memory acknowledgement');
    await presetVideo.frame.evaluate(() => window.dispatchEvent(
      new KeyboardEvent('keydown', { key: '>', bubbles: true, cancelable: true }),
    ));
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.ok(Math.abs((await videoState(presetVideo.frame)).rate - presetVideo.state.rate) < 0.011,
      'untrusted synthetic > changed the current playback rate');
    assert.deepEqual(await storedRatePair(), beforeSyntheticKey, 'untrusted synthetic > changed lastRate or lastRateRevision');

    const urlB = fixtureBaseUrl + '/fixture?iframe=1&frame=background';
    qa.tabB = await createTab(urlB, qa.windowId, false);
    assert.ok(qa.tabB?.id, 'Chrome did not create the inactive background tab');
    try {
      await waitFor(async () => {
        qa.backgroundTabInfo = await tabInfo(qa.tabB.id);
        return (qa.backgroundTabInfo.url === urlB || qa.backgroundTabInfo.pendingUrl === urlB) &&
          qa.backgroundTabInfo.status === 'complete' && qa.backgroundTabInfo.active === false;
      }, 'Chrome did not finish loading the inactive background tab');
    } catch {
      throw new Error('Chrome background tab query did not retain the requested inactive URL and complete state: ' +
        JSON.stringify(qa.backgroundTabInfo || await tabInfo(qa.tabB.id)));
    }
    assert.equal(qa.backgroundTabInfo.url, urlB, 'Chrome tabs.query did not confirm the completed background URL');
    assert.equal(qa.backgroundTabInfo.active, false, 'background navigation activated the hidden tab');
    qa.pageB = await pageForUrl(urlB);
    await qa.pageB.waitForSelector('#qa-video');
    qa.childB = await waitFrame(qa.pageB, 'child');
    await installDomProbe(qa.tabB.id);
    await Promise.all([qa.pageB.mainFrame(), qa.childB].map(frame => frame.evaluate(() => {
      document.querySelectorAll('video').forEach(video => video.pause());
    })));
    qa.qualityBeforeB = await Promise.all([qa.pageB.mainFrame(), qa.childB].map(qualityState));
    qa.probeBeforeB = aggregateProbe(await readDomProbe(qa.tabB.id));
    const inactive = await chromeState('unvisited background tab');
    assert.equal(inactive.windows.length, 1, 'background tab opened another browser window');
    assert.equal(inactive.windows.find(win => win.id === qa.windowId)?.focused, true);
    assert.equal(inactive.windows.find(win => win.id === qa.windowId)?.activeTabId, qa.tabA.id);
    assert.equal((await videoState(qa.pageB.mainFrame())).marker, null, 'unvisited background video already has a control marker');
    const isolated = await contentApiState(qa.tabB.id);
    const pageBridge = await qa.pageB.mainFrame().evaluate(() => ({
      pageBridge: !!globalThis[Symbol.for('video-control.page-bridge-v3')],
      bridgeActive: !!globalThis[Symbol.for('video-control.page-bridge-v3')]?.active?.(),
    }));
    assert.deepEqual({ ...isolated, ...pageBridge }, { present: true, session: false, alive: true, pageBridge: true, bridgeActive: false },
      'background static scripts were absent or started a session');
    const appended = await appendVideo(qa.pageB.mainFrame(), 'unvisited');
    qa.backgroundVideoId = appended;
    await new Promise(resolve => setTimeout(resolve, 450));
    assert.equal((await videoState(qa.pageB.mainFrame(), '#' + appended)).marker, null, 'background static script registered a new video');
    assert.equal((await videoState(qa.childB)).marker, null, 'unvisited iframe video already has a control marker');
    assert.deepEqual(aggregateProbe(await readDomProbe(qa.tabB.id)), qa.probeBeforeB, 'hidden background tab performed an observed DOM scan');
    assert.deepEqual(await Promise.all([qa.pageB.mainFrame(), qa.childB].map(qualityState)), qa.qualityBeforeB, 'hidden background tab invoked a quality setter');
    return 'Chrome query confirmed the tab was inactive in a focused window. Static scripts ran without a Session; ISOLATED DOM counters, markers, and quality setters stayed unchanged after adding a video. A synthetic > key left preset rate and storage pair unchanged.';
  });

  await check('前景啟用與切換分頁 grace；iframe 繼承期限', async () => {
    const { windowId, tabA, tabB, pageA, childA, pageB, childB, probeBeforeB } = qa;
    await activateTab(tabB.id);
    const activeB = await chromeState('background tab activated');
    assert.equal(activeB.windows.find(win => win.id === windowId)?.focused, true);
    assert.equal(activeB.windows.find(win => win.id === windowId)?.activeTabId, tabB.id);
    const newB = qa.backgroundVideoId;
    try {
      await waitVideo(pageB.mainFrame(), '#' + newB, item => !!item.marker, 'activated tab did not discover the new video');
    } catch (error) {
      const debug = {
        tab: await tabInfo(tabB.id),
        activity: await activitySnapshot(),
        api: await contentApiState(tabB.id),
        video: await videoState(pageB.mainFrame(), '#' + newB),
        dom: aggregateProbe(await readDomProbe(tabB.id)),
        quality: await qualityState(pageB.mainFrame()),
      };
      throw new Error((error?.message || String(error)) + '; diagnostics=' + JSON.stringify(debug));
    }
    try {
      await waitVideo(pageB.mainFrame(), '#' + newB, item => Math.abs(item.rate - 8) < 0.011,
        'activated tab did not apply the preset');
    } catch (error) {
      throw new Error((error?.message || String(error)) + '; marked video=' +
        JSON.stringify(await videoState(pageB.mainFrame(), '#' + newB)));
    }
    await waitVideo(childB, '#qa-video', item => !!item.marker, 'activated tab activity was not inherited by its iframe');
    await waitFor(async () => (await Promise.all([pageB.mainFrame(), childB].map(qualityState))).some(value => value.setters > 0),
      'activated tab did not invoke its quality setter in either frame');
    const scans = aggregateProbe(await readDomProbe(tabB.id));
    assert.ok(scans.documentWalkerCalls > probeBeforeB.documentWalkerCalls || scans.videoQueries > probeBeforeB.videoQueries,
      'activation did not produce an observed ISOLATED DOM scan');

    const afterTabSwitch = await appendVideo(pageA.mainFrame(), 'tab-grace');
    await waitVideo(pageA.mainFrame(), '#' + afterTabSwitch, item => !!item.marker, 'previous tab did not scan during tab-switch grace');
    const afterTabSwitchFrame = await appendVideo(childA, 'tab-grace-frame');
    await waitVideo(childA, '#' + afterTabSwitchFrame, item => !!item.marker, 'iframe did not inherit tab-switch grace');

    await activateTab(tabA.id);
    const activeA = await chromeState('tab A reactivated');
    assert.equal(activeA.windows.find(win => win.id === windowId)?.activeTabId, tabA.id);
    const afterTabAway = await appendVideo(pageB.mainFrame(), 'tab-grace-again');
    await waitVideo(pageB.mainFrame(), '#' + afterTabAway, item => !!item.marker, 'inactive tab did not scan during its grace period');
    const afterTabAwayFrame = await appendVideo(childB, 'tab-grace-again-frame');
    await waitVideo(childB, '#' + afterTabAwayFrame, item => !!item.marker, 'iframe did not inherit the inactive-tab deadline');
    const inactiveAgain = await chromeState('tab B inactive before expiry');
    assert.equal(inactiveAgain.windows.find(win => win.id === windowId)?.activeTabId, tabA.id);
    qa.tabBDeactivatedAt = performance.now();
    return 'Chrome tabs.query confirmed real tab A/B activation changes. Both tab-switch grace periods discovered new videos in the top frame and iframe; OS-level blur is unverified.';
  });

  await check('超過 10 秒停止探索與背景控制；返回後補查並保留當片速度', async () => {
    const { tabA, tabB, pageA, pageB, childB, tabBDeactivatedAt } = qa;
    const remaining = Math.max(0, 10500 - (performance.now() - tabBDeactivatedAt));
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
    const elapsedMs = performance.now() - tabBDeactivatedAt;
    assert.ok(elapsedMs >= 10400, 'real grace wait was shorter than 10.4 seconds: ' + Math.round(elapsedMs) + 'ms');

    const probeBeforeExpiry = await settleDomProbe(tabB.id);
    const oldVideo = await videoState(pageB.mainFrame(), '#qa-video-unvisited');
    assert.equal(oldVideo?.marker,null, 'initialized background video still has a controller');
    const control = await sendControl(tabB.id, 0, 'expired-target', 'set', 3);
    assert.equal(control?.ok, false, 'background control was still accepted');
    await pageB.mainFrame().evaluate(()=>{document.querySelector('#qa-video-unvisited').playbackRate=3;});
    await waitVideo(pageB.mainFrame(), '#qa-video-unvisited', state => Math.abs(state.rate - 3) < 0.011,
      'background page speed was overwritten');

    const beforeQuality = await Promise.all([pageB.mainFrame(), childB].map(qualityState));
    const newB = await appendVideo(pageB.mainFrame(), 'expired-tab', false);
    const newChildB = await appendVideo(childB, 'expired-tab-frame', false);
    await new Promise(resolve => setTimeout(resolve, 700));
    for (const [frame, id] of [[pageB.mainFrame(), newB], [childB, newChildB]]) {
      assert.equal((await videoState(frame, '#' + id)).marker, null, 'expired background discovered a new video: ' + id);
    }
    assert.deepEqual(await Promise.all([pageB.mainFrame(), childB].map(qualityState)), beforeQuality, 'expired tab invoked a quality setter');
    assert.deepEqual(aggregateProbe(await readDomProbe(tabB.id)), probeBeforeExpiry, 'expired tab iframe continued DOM exploration');

    await activateTab(tabB.id);
    const returned = await chromeState('tab B activated after expiry');
    assert.equal(returned.windows.find(win => win.id === qa.windowId)?.activeTabId, tabB.id);
    await waitVideo(pageB.mainFrame(), '#' + newB, state => !!state.marker, 'return did not discover the new video');
    await waitVideo(childB, '#' + newChildB, state => !!state.marker, 'return did not catch up the iframe');
    assert.ok(Math.abs((await videoState(pageB.mainFrame(), '#qa-video-unvisited')).rate - 3) < 0.011,
      'return reapplied preset to the same manually changed video');
    await pageB.mainFrame().evaluate(id => document.getElementById(id).play(), newB);
    await waitVideo(pageB.mainFrame(), '#' + newB, state => Math.abs(state.rate - 8) < 0.011,
      'the new clip did not receive its preset after playback resumed');
    return 'One real ' + Math.round(elapsedMs) + 'ms wait expired discovery. Background control was rejected; top/iframe new clips had no markers, scans, or setters until return; catch-up kept the already initialized clip at the page-selected 3×.';
  });

  await check('三個 frame 的 storage pair 同步不增加 settings 訊息', async () => {
    await closeTab(qa.tabB.id);
    await seedSettings({ defaultMode: 'follow' }, { lastRate: 3, lastRateRevision: 100 });
    await installMessageProbe();
    const urlD = fixtureBaseUrl + '/fixture?extraFrames=1&frame=storage';
    await qa.pageA.goto(urlD, { waitUntil: 'domcontentloaded' });
    const pageD = qa.pageA;
    const tabD = qa.tabA;
    await pageD.waitForSelector('#qa-video');
    await waitFrame(pageD, 'a');
    await waitFrame(pageD, 'b');
    await waitFor(async () => (await readMessageProbe())?.length >= 3, 'did not observe settings requests from all fixture frames');
    const before = await readMessageProbe();
    const frameIds = new Set(before.filter(item => item.tabId === tabD.id).map(item => item.frameId));
    assert.equal(frameIds.size, 3, 'expected three initial settings requests from distinct frames');
    assert.equal(before.length, 3, 'expected exactly one initial settings request per frame');
    assert.ok(before.every(item => item.tabId === tabD.id), 'unexpected page contributed to the message count');
    await waitFor(async () => {
      const rows = await frameMemory(tabD.id);
      return rows?.length === 3 && rows.every(row => row.result?.rate === 3 && row.result?.revision === 100);
    }, 'RateClient did not initialize from the storage pair in all three frames');
    const sw = await worker();
    await sw.evaluate(async () => chrome.storage.local.set({ lastRate: 4, lastRateRevision: 101 }));
    await waitFor(async () => {
      const rows = await frameMemory(tabD.id);
      return rows?.length === 3 && rows.every(row => row.result?.rate === 4 && row.result?.revision === 101);
    }, 'storage pair did not update all three RateClient snapshots');
    const after = await readMessageProbe();
    assert.equal(after.length, before.length, 'storage pair caused per-frame settings runtime messages');
    return 'Counted ' + frameIds.size + ' initial settings requests (frameIds ' + [...frameIds].join(',') +
      '); storage pair advanced all RateClient snapshots to revision 101 with zero additional settings messages.';
  });
}

async function writeReport() {
  await mkdir(reportDirectory, { recursive: true });
  await writeFile(resultsPath, JSON.stringify({
    version,
    chromium: chromiumVersion,
    hashes,
    checks,
    errors,
    actualChromeState: chromeStates,
    coverageLimitations,
    servedLocalRequests,
    blockedExternalRequests: [...blockedRequests],
    cleanup,
  }, null, 2) + '\n', 'utf8');
}

try {
  await mkdir(reportDirectory, { recursive: true });
  await stat(fixturePath);
  const manifest = JSON.parse(await readFile(path.join(extensionDirectory, 'manifest.json'), 'utf8'));
  version = manifest.version;
  assert.equal(manifest.name, 'VideoSpeed');
  assert.equal(manifest.version, JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8')).version);
  const bundleHash = createHash('sha256');
  for (const filename of runtimeFiles) {
    const bytes = await readFile(path.join(extensionDirectory, filename));
    hashes[filename] = createHash('sha256').update(bytes).digest('hex');
    bundleHash.update(filename).update('\0').update(bytes).update('\0');
  }
  hashes.runtimeSha256 = bundleHash.digest('hex');

  const requestedExecutable = process.env.VIDEOSPEED_CHROMIUM?.trim();
  if (requestedExecutable && !path.isAbsolute(requestedExecutable)) throw new Error('VIDEOSPEED_CHROMIUM must be an absolute path');
  const executablePath = requestedExecutable || chromium.executablePath();
  if (!path.isAbsolute(executablePath)) throw new Error('Chromium executable path is not absolute: ' + executablePath);
  await stat(executablePath);

  await startFixtureServer(await readFile(fixturePath));
  temporaryRoot = await (await import('node:fs/promises')).mkdtemp(path.join(os.tmpdir(), 'videospeed-activity-'));
  cleanup.temporaryProfileCreated = true;
  const profileDirectory = path.join(temporaryRoot, 'profile');
  context = await chromium.launchPersistentContext(profileDirectory, {
    executablePath,
    headless: true,
    viewport: { width: 1100, height: 800 },
    args: [
      '--disable-extensions-except=' + extensionDirectory,
      '--load-extension=' + extensionDirectory,
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--no-first-run',
      '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
    ],
  });
  context.setDefaultTimeout(10000);
  context.on('page', page => page.on('pageerror', error => errors.push({ page: page.url(), message: error.message })));
  await installExternalBlocker();
  chromiumVersion = context.browser()?.version() || 'unknown';
  serviceWorker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  extensionId = new URL(serviceWorker.url()).host;
  await runChecks();
} catch (error) {
  fatalError = error;
  if (!checks.length) record('Browser setup', 'FAIL', error?.stack || error?.message || error);
  if (!errors.length) errors.push({ check: 'Browser setup or suite', message: String(error?.message || error) });
} finally {
  await context?.close().catch(error => { fatalError ||= error; });
  if (fixtureServer) await new Promise(resolve => fixtureServer.close(resolve)).catch(error => { fatalError ||= error; });
  if (temporaryRoot) {
    const resolved = await realpath(temporaryRoot).catch(() => path.resolve(temporaryRoot));
    const relative = path.relative(path.resolve(os.tmpdir()), resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) ||
      !path.basename(resolved).startsWith('videospeed-activity-')) {
      cleanup.error = 'Refused path outside this run mkdtemp directory';
      fatalError ||= new Error(cleanup.error);
    } else {
      cleanup.verifiedInsideOsTemp = true;
      await rm(resolved, { recursive: true, force: true }).then(() => { cleanup.removed = true; }).catch(error => {
        cleanup.error = String(error?.message || error);
        fatalError ||= error;
      });
    }
  }
  await writeReport().catch(error => { fatalError ||= error; });
}

const failures = checks.filter(item => item.status === 'FAIL');
console.log('VideoSpeed activity check: ' + (checks.length - failures.length) + '/' + checks.length + ' passed');
console.log('Report: ' + resultsPath);
console.log('Runtime SHA-256: ' + (hashes.runtimeSha256 || 'unavailable'));
if (fatalError) console.error(fatalError.stack || fatalError.message || fatalError);
if (failures.length) {
  for (const item of failures) console.error('FAIL ' + item.name + ': ' + item.detail);
  process.exitCode = 1;
} else if (fatalError) process.exitCode = 1;
