#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { cp, mkdir, readFile, realpath, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const qaDirectory = path.join(projectRoot, 'work', 'qa-autostart');
const sourceExtension = path.resolve(process.env.VIDEOSPEED_QA_EXTENSION_DIR?.trim() || path.join(projectRoot, 'extension'));
const label=process.env.VIDEOSPEED_QA_LABEL||'default';
assert.match(label,/^[a-z0-9-]{1,40}$/);
const runtimeExtension = path.join(qaDirectory, 'runtime-extension-'+label);
const reportPath = path.join(qaDirectory, label+'-results.json');
const prePopupPath = path.join(qaDirectory, label+'-pre-popup-evidence.json');
const requestedChrome = process.env.VIDEOSPEED_CHROMIUM?.trim() || 'C:/Users/pc15/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const expectedVersion = process.env.VIDEOSPEED_QA_VERSION?.trim() || JSON.parse(await readFile(path.join(sourceExtension, 'manifest.json'), 'utf8')).version;
const allowPopupComparison = process.env.VIDEOSPEED_QA_POPUP_AFTER_FAILURE === '1';
const newDocumentRounds = Number(process.env.VIDEOSPEED_QA_DOC_ROUNDS||20);
const spaRounds = Number(process.env.VIDEOSPEED_QA_SPA_ROUNDS||10);
const observationDelaysMs = [0, 100, 400, 1200];
const sampleStepMs = 250;
const expectedRate = 4;
const settings = {
  schemaVersion: 3, enabled: true, preferredRate: 2, defaultMode: 'follow', customRate: 2,
  steps: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4],
  qualityEnabled: false, preferredQuality: 1080,
  shortcuts: { slower: '<', faster: '>', reset: ':', preferred: '"', fineSlower: '', fineFaster: '' },
  disabledSites: [], siteModes: {},
};

const observerSource = String.raw`(() => {
  const api = {
    async seed(settings, lastRate, lastRateRevision) {
      await chrome.storage.local.set({ settings, lastRate, lastRateRevision });
      return chrome.storage.local.get(['settings', 'lastRate', 'lastRateRevision']);
    },
    async createTab(url) {
      const tab = await chrome.tabs.create({ url, active: true });
      return { id: tab.id, windowId: tab.windowId, active: tab.active === true, status: tab.status || '', url: tab.url || tab.pendingUrl || '' };
    },
    async queryTab(tabId) {
      const [tab] = await chrome.tabs.query({});
      const found = await chrome.tabs.get(tabId).catch(() => null);
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return { tab: found ? { id: found.id, windowId: found.windowId, active: found.active === true, status: found.status || '', url: found.url || found.pendingUrl || '' } : null,
        activeTab: active ? { id: active.id, windowId: active.windowId, active: active.active === true, url: active.url || active.pendingUrl || '' } : null };
    },
    async inspect(tabId) {
      const [stored, session, tabs] = await Promise.all([
        chrome.storage.local.get(['settings', 'lastRate', 'lastRateRevision']),
        chrome.storage.session.get('tabActivity'),
        chrome.tabs.query({ active: true, lastFocusedWindow: true }),
      ]);
      let isolated = null, injectionError = null;
      try {
        const rows = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED', func: () => {
          const value = globalThis[Symbol.for('video-control.api')];
          let diagnostics = null, snapshot = null;
          try { diagnostics = value?.diagnostics?.() ?? null; } catch (error) { diagnostics = { error: String(error?.message || error) }; }
          try { snapshot = value?.snapshot?.() ?? null; } catch (error) { snapshot = { error: String(error?.message || error) }; }
          return { present: !!value, version: value?.version || null, alive: value?.alive?.() === true,
            enabled: value?.enabled?.() === true, snapshot, diagnostics, qaFaults: globalThis.__qa072Faults || null, qaKeys:globalThis.__qa072Keys||[] };
        }});
        isolated = rows[0]?.result ?? null;
      } catch (error) { injectionError = String(error?.message || error); }
      const qaSession = await chrome.storage.session.get('qa072FaultState');
      return { at: Date.now(), runtimeId: chrome.runtime.id,
        settings: stored.settings || null, lastRate: stored.lastRate ?? null, lastRateRevision: stored.lastRateRevision ?? null,
        tabActivity: session.tabActivity || null,
        qaFaultState: qaSession.qa072FaultState || null,
        activeTab: tabs[0] ? { id: tabs[0].id, windowId: tabs[0].windowId, active: tabs[0].active === true, url: tabs[0].url || tabs[0].pendingUrl || '' } : null,
        isolated, injectionError };
    },
    async armFaults(tabId) { return chrome.runtime.sendMessage({ __qa072ArmFaults: true, tabId }); },
    async disarmFaults() { return chrome.runtime.sendMessage({ __qa072DisarmFaults: true }); },
    async localKeyProbe(tabId,restore=false) {
      const rows=await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},world:'ISOLATED',args:[restore],func:restore=>{
        if(restore){const probe=globalThis.__qaLocalKeyProbe;if(probe)chrome.runtime.sendMessage=probe.original;return probe?.commands??null;}
        const runtime=chrome.runtime,original=runtime.sendMessage,probe={original,commands:0};globalThis.__qaLocalKeyProbe=probe;
        runtime.sendMessage=function(message,...args){
          if(message?.scope==='video-control'&&message.action==='command'){probe.commands++;return new Promise(resolve=>setTimeout(()=>resolve({ok:false,error:'QA delayed command RPC'}),3000));}
          return Reflect.apply(original,runtime,[message,...args]);
        };return true;
      }});return rows[0]?.result;
    },
    async removeTab(tabId) { await chrome.tabs.remove(tabId); },
  };
  Object.defineProperty(globalThis, '__qaObserver', { value: api, configurable: false });
})();`;

const observerHtml = '<!doctype html><meta charset="utf-8"><title>QA observer</title><script src="qa-observer.js"></script>';
const qaFaultSource = String.raw`(() => {
  globalThis.__qa072Keys=[];
  window.addEventListener('keydown',event=>globalThis.__qa072Keys.push({at:Date.now(),key:event.key,code:event.code,trusted:event.isTrusted,shift:event.shiftKey}),true);
  if (new URL(location.href).searchParams.get('qa072') !== 'all') return;
  const state = { mode: 'all', settingsRequestCount: 0, settingsRejected: false, settingsRejectedAt: null };
  Object.defineProperty(globalThis, '__qa072Faults', { value: state, configurable: false });
  const runtime = chrome.runtime, original = runtime.sendMessage;
  runtime.sendMessage = function(message, ...args) {
    if (message?.scope === 'video-control' && message.action === 'settings') {
      state.settingsRequestCount++;
      if (!state.settingsRejected) {
        state.settingsRejected = true;
        state.settingsRejectedAt = Date.now();
        return Promise.reject(new Error('QA-072 injected rejection of first settings request'));
      }
    }
    return Reflect.apply(original, runtime, [message, ...args]);
  };
})();`;
const pageHtml = String.raw`<!doctype html><html><head><meta charset="utf-8"><title>QA AutoStart Fixture</title>
<script>
window.__qaDocStart = Date.now(); window.__qaMediaEvents = []; window.__qaKeyEvents = []; window.__qaMainBridgeReadyEvents = [];
document.addEventListener('video-control:bridge-ready-v1', event => { let detail = null; try { detail = JSON.parse(event.detail); } catch {} window.__qaMainBridgeReadyEvents.push({ at: Date.now(), detail }); }, true);
const qaRecord = (type, event) => { if (event.target?.tagName === 'VIDEO') window.__qaMediaEvents.push({ type, at: Date.now(), rate: event.target.playbackRate, defaultRate: event.target.defaultPlaybackRate, currentTime: event.target.currentTime, paused: event.target.paused, trusted: event.isTrusted }); };
for (const type of ['playing', 'play', 'loadedmetadata', 'ratechange', 'pause']) document.addEventListener(type, event => qaRecord(type, event), true);
window.addEventListener('keydown', event => window.__qaKeyEvents.push({ at: Date.now(), key: event.key, code: event.code, trusted: event.isTrusted, shift: event.shiftKey }), true);
window.__qaMedia = () => { const video = document.querySelector('#qa-video'), audio = document.querySelector('#qa-audio'); return { video: video ? { rate: video.playbackRate, defaultRate: video.defaultPlaybackRate, currentTime: video.currentTime, paused: video.paused, ended: video.ended, readyState: video.readyState, muted: video.muted, id: video.getAttribute('data-video-control-id'), src: video.currentSrc } : null, audio: audio ? { paused: audio.paused, muted: audio.muted, volume: audio.volume, currentTime: audio.currentTime, readyState: audio.readyState } : null }; };
window.__qaReplaceVideo = async round => { history.pushState({ round }, '', '/spa?round=' + round); const old = document.querySelector('#qa-video'); const video = document.createElement('video'); video.id = 'qa-video'; video.autoplay = true; video.loop = true; video.playsInline = true; video.controls = true; video.src = '/tiny.webm?round=' + round; document.querySelector('#player').replaceChildren(video); try { await video.play(); } catch {} return { round, href: location.href, docStart: window.__qaDocStart }; };
</script></head><body><main id="player"><video id="qa-video" autoplay loop playsinline controls src="/tiny.webm"></video></main>
<audio id="qa-audio" autoplay loop src="/tone.wav"></audio><script>const qaAudio=document.querySelector('#qa-audio');qaAudio.volume=.2;qaAudio.play().catch(()=>{});document.querySelector('#qa-video').play().catch(()=>{});</script></body></html>`;

let context, server, browserCdp, workerCdp, observerPage, profileRoot, runtimeId = '', baseUrl = '', videoBytes, toneBytes, fatalError = null;
let extensionTreeSha256 = null;
const cdpServiceWorkerEvents = [], cdpTargetEvents = [], serverTrace = [];
let retainedFailurePage = null, retainedFailureTabId = null;
const cleanup = { profileCreated: false, browserClosed: false, profileRemoved: false, verifiedInsideOsTemp: false, error: null };
const report = {
  package: 'VideoSpeed', version: expectedVersion, startedAt: Date.now(), mode: 'native-no-popup',
  rounds: { newDocument: newDocumentRounds, spa: spaRounds, observationDelaysMs }, expectedRate,
  extensionTreeSha256: null, node: process.execPath, chromiumExecutable: requestedChrome,
  browserVersion: null, extensionId: null, seed: null, seedVerified: false,
  newDocumentTrials: [], spaTrials: [], keyboardTrial: null, controlledFaultTrial: null, coldWorkerTrial: null,
  startupWarnings: [], failures: [], prePopupEvidencePath: prePopupPath, popupOpenedAt: null, popupComparison: null,
  serverTrace, cdpServiceWorkerEvents, cdpTargetEvents, cleanup,
};

function hash(value) { return createHash('sha256').update(value).digest('hex'); }
async function filesUnder(root, relative = '') {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.posix.join(relative.replaceAll('\\', '/'), entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files.sort();
}
async function treeDigest(root) {
  const digest = createHash('sha256');
  for (const file of await filesUnder(root)) digest.update(file).update('\0').update(await readFile(path.join(root, file))).update('\0');
  return digest.digest('hex');
}
function assertQaChild(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'refusing filesystem mutation outside QA child directory');
  return path.resolve(candidate);
}
async function waitFor(predicate, message, timeoutMs = 10000, intervalMs = 40) {
  const started = Date.now(); let last;
  while (Date.now() - started < timeoutMs) {
    try { const value = await predicate(); if (value) return value; } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(message + (last ? ': ' + String(last?.message || last) : ''));
}
function makeTone(durationSeconds = 30, sampleRate = 16000) {
  const sampleCount = Math.floor(durationSeconds * sampleRate), dataBytes = sampleCount * 2, bytes = Buffer.alloc(44 + dataBytes);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + dataBytes, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < sampleCount; index++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * index / sampleRate) * 2600), 44 + index * 2);
  return bytes;
}
async function startServer() {
  server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    serverTrace.push({ type: 'request', at: Date.now(), method: request.method, path: url.pathname, query: url.search, range: request.headers.range || '' });
    if (['/autoplay', '/spa', '/cold', '/fault'].includes(url.pathname)) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); response.end(pageHtml); return;
    }
    if (url.pathname === '/warmup') { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); response.end('<!doctype html><title>QA warmup</title><p>QA warmup</p>'); return; }
    if (url.pathname === '/tiny.webm') { response.writeHead(200, { 'content-type': 'video/webm', 'content-length': String(videoBytes.length), 'cache-control': 'no-store' }); response.end(videoBytes); return; }
    if (url.pathname === '/tone.wav') { response.writeHead(200, { 'content-type': 'audio/wav', 'content-length': String(toneBytes.length), 'cache-control': 'no-store' }); response.end(toneBytes); return; }
    response.writeHead(404, { 'content-type': 'text/plain' }); response.end('QA-072 not found');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = 'http://127.0.0.1:' + server.address().port;
}
async function observerCall(name, ...args) { let timer;try{return await Promise.race([observerPage.evaluate(({ method, values }) => globalThis.__qaObserver[method](...values), { method: name, values: args }),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('QA observer timeout: '+name)),6000);})]);}finally{clearTimeout(timer);} }
async function createTestPage(url) {
  const tab = await observerCall('createTab', url);
  const page = await waitFor(() => context.pages().find(item => item.url() === url), 'test tab page did not attach: ' + url, 12000);
  await page.bringToFront();
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
  await page.waitForFunction(() => typeof window.__qaMedia === 'function', null, { timeout: 10000 });
  return { tab, page };
}
async function waitForMedia(page) {
  return page.waitForFunction(() => {
    const state = window.__qaMedia?.();
    return state?.video?.readyState >= 2 && !state.video.paused && state.video.currentTime > 0.03 &&
      state.audio?.readyState >= 2 && !state.audio.paused && !state.audio.muted && state.audio.volume > 0 && state.audio.currentTime > 0.03;
  }, null, { timeout: 15000 });
}
async function capture(page, tabId, label) {
  const [browserMedia, mediaEvents, keyEvents, extension] = await Promise.all([
    page.evaluate(() => ({ docStart: window.__qaDocStart, href: location.href, title: document.title,
      mainBridgeFault: globalThis.__qa072MainBridgeDelay || null,
      mainBridgeState: (() => { const bridge = globalThis[Symbol.for('video-control.page-bridge-v3')]; return bridge ? { present: true, version: bridge.version, active: bridge.active?.() === true } : { present: false }; })(),
      media: window.__qaMedia?.() || null,
      events: [...(window.__qaMediaEvents || [])], keys: [...(window.__qaKeyEvents || [])],
      mainBridgeReadyEvents: [...(window.__qaMainBridgeReadyEvents || [])] })),
    Promise.resolve(null), Promise.resolve(null), observerCall('inspect', tabId),
  ]);
  void mediaEvents; void keyEvents;
  const video = browserMedia.media?.video;
  const diagnostics = extension.isolated?.diagnostics;
  const expectedDiagnostic = Array.isArray(diagnostics) ? diagnostics.find(item => item.id === video?.id) || diagnostics[0] : null;
  const apiVideos = Array.isArray(extension.isolated?.snapshot) ? extension.isolated.snapshot : [];
  return {
    label, at: Date.now(), docStart: browserMedia.docStart, href: browserMedia.href, title: browserMedia.title,
    video: browserMedia.media?.video || null, audio: browserMedia.media?.audio || null,
    pageEvents: browserMedia.events.slice(-24), keyEvents: [...browserMedia.keys,...(extension.isolated?.qaKeys||[])].slice(-24),
    mainBridgeReadyEvents: browserMedia.mainBridgeReadyEvents,
    mainBridgeFault: browserMedia.mainBridgeFault, mainBridgeState: browserMedia.mainBridgeState,
    isolated: extension.isolated, isolatedVideoMatch: apiVideos.find(item => item.id === video?.id) || apiVideos[0] || null,
    diagnostics: expectedDiagnostic, qaFaultState:extension.qaFaultState, tabActivity: extension.tabActivity, activeTab: extension.activeTab,
    settings: extension.settings, lastRate: extension.lastRate, lastRateRevision: extension.lastRateRevision,
    injectionError: extension.injectionError,
  };
}
async function observeSamples(page, tabId, label) {
  const samples = [];
  for (const delayMs of observationDelaysMs) {
    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs - observationDelaysMs[observationDelaysMs.indexOf(delayMs) - 1]));
    samples.push(await capture(page, tabId, `${label}+${delayMs}ms`));
  }
  return samples;
}
function trialFailure(samples) {
  const first = samples[0], last = samples.at(-1);
  const firstPlaying = first.pageEvents.find(item => item.type === 'playing');
  return {
    firstPlayingRate: firstPlaying?.rate ?? null,
    firstObservedRate: first.video?.rate ?? null,
    finalRate: last.video?.rate ?? null,
    finalApiPresent: last.isolated?.present === true,
    finalApiAlive: last.isolated?.alive === true,
    finalApiRate: last.isolatedVideoMatch?.rate ?? last.diagnostics?.rate ?? null,
    finalApiRateOrigin: last.isolatedVideoMatch?.rateOrigin ?? last.diagnostics?.rateOrigin ?? null,
    startupMismatch: (firstPlaying?.rate ?? first.video?.rate) !== expectedRate,
    finalMiss: last.video?.rate !== expectedRate,
  };
}
async function saveFailureScreenshot(page, name) {
  const target = path.join(qaDirectory, name + '-pre-popup.png');
  await page.screenshot({ path: target, fullPage: false }).catch(() => {});
  return target;
}
function serviceWorkerTarget(targets, extensionId) {
  return targets.find(item => item.type === 'service_worker' && item.url === `chrome-extension://${extensionId}/background.js`) || null;
}
async function browserTargets() { return (await browserCdp.send('Target.getTargets')).targetInfos; }
function latestWorkerVersion(extensionId) {
  const candidates = cdpServiceWorkerEvents.flatMap(event => event.versions || []).filter(item => item.scriptURL === `chrome-extension://${extensionId}/background.js`);
  return candidates.at(-1) || null;
}

try {
  const manifest = JSON.parse(await readFile(path.join(sourceExtension, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, expectedVersion, 'extension manifest is not the expected candidate version');
  const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  report.projectPackageVersion = packageJson.version;
  if (sourceExtension === path.resolve(path.join(projectRoot, 'extension')))
    assert.equal(packageJson.version, expectedVersion, 'project package is not the expected candidate version');
  extensionTreeSha256 = await treeDigest(sourceExtension);
  report.extensionTreeSha256 = extensionTreeSha256;
  const runTarget = assertQaChild(qaDirectory, runtimeExtension);
  await rm(runTarget, { recursive: true, force: true });
  await cp(sourceExtension, runtimeExtension, { recursive: true });
  await writeFile(path.join(runtimeExtension, 'qa-observer.html'), observerHtml, 'utf8');
  await writeFile(path.join(runtimeExtension, 'qa-observer.js'), observerSource, 'utf8');
  await writeFile(path.join(runtimeExtension, 'qa-fault.js'), qaFaultSource, 'utf8');
  const qaManifestPath = path.join(runtimeExtension, 'manifest.json');
  const qaManifest = JSON.parse(await readFile(qaManifestPath, 'utf8'));
  const isolatedScripts = qaManifest.content_scripts.find(item => item.world !== 'MAIN' && item.js.includes('content.js'));
  assert.ok(isolatedScripts, 'could not find the isolated content script entry for QA fault injection');
  isolatedScripts.js.unshift('qa-fault.js');
  await writeFile(qaManifestPath, JSON.stringify(qaManifest, null, 2) + '\n', 'utf8');
  const backgroundPath = path.join(runtimeExtension, qaManifest.background.service_worker);
  let qaBackground = await readFile(backgroundPath, 'utf8');
  qaBackground = `(() => {
   const original=chrome.tabs.sendMessage.bind(chrome.tabs);
   chrome.tabs.sendMessage=async(tabId,message,...options)=>{
    const state=globalThis.__qa072ArmedFaults;
    if(message?.action==='activeTarget'&&message.id&&state?.activeTargetPending&&tabId===state.tabId){
     state.activeTargetPending=false;state.activeTargetRejectedAt=Date.now();state.activeTargetTabId=tabId;
     await chrome.storage.session.set({qa072FaultState:{...state}});
     throw new Error('QA-072 injected one-time activeTarget delivery rejection');
    }
    return original(tabId,message,...options);
   };
  })();\n` + qaBackground;
  qaBackground += `\n\n// QA-only controlled fault arming; only the isolated profile receives this build.\n` +
    `globalThis.__qa072ArmedFaults=null;\n` +
    `chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{\n` +
    ` if(message?.__qa072ArmFaults===true){globalThis.__qa072ArmedFaults={activeTargetPending:true,tabId:message.tabId,armedAt:Date.now()};chrome.storage.session.set({qa072FaultState:{...globalThis.__qa072ArmedFaults}}).then(()=>sendResponse({ok:true,armedAt:globalThis.__qa072ArmedFaults.armedAt}),error=>sendResponse({ok:false,error:String(error?.message||error)}));return true;}\n` +
    ` if(message?.__qa072DisarmFaults===true){globalThis.__qa072ArmedFaults=null;chrome.storage.session.remove('qa072FaultState').then(()=>sendResponse({ok:true}),error=>sendResponse({ok:false,error:String(error?.message||error)}));return true;}\n` +
    `});\n`;
  await writeFile(backgroundPath, qaBackground, 'utf8');
  const bridgePath = path.join(runtimeExtension, 'page-bridge.js');
  const originalBridge = await readFile(bridgePath, 'utf8');
  const qaManifestMain = qaManifest.content_scripts.find(item => item.world === 'MAIN' && item.js.includes('page-bridge.js'));
  assert.ok(qaManifestMain, 'could not find MAIN page bridge manifest entry');
  qaManifestMain.js = qaManifestMain.js.map(file => file === 'page-bridge.js' ? 'qa-page-bridge.js' : file);
  await writeFile(qaManifestPath, JSON.stringify(qaManifest, null, 2) + '\n', 'utf8');
  const withheldMainBridge = `(()=>{if(new URL(location.href).searchParams.get('qa072')==='all'){Object.defineProperty(globalThis,'__qa072MainBridgeDelay',{value:{mode:'static-main-bridge-withheld',withheldAt:Date.now(),startedAt:null},configurable:false});return}${originalBridge}\n})();`;
  await writeFile(path.join(runtimeExtension, 'qa-page-bridge.js'), withheldMainBridge, 'utf8');
  videoBytes = await readFile(path.join(projectRoot, 'tests', 'fixtures', 'tiny.webm'));
  toneBytes = makeTone();
  await startServer();
  profileRoot = await (await import('node:fs/promises')).mkdtemp(path.join(os.tmpdir(), 'videospeed-qa072-autostart-'));
  cleanup.profileCreated = true;
  context = await chromium.launchPersistentContext(path.join(profileRoot, 'profile'), {
    executablePath: requestedChrome, headless: true, viewport: { width: 1280, height: 900 },
    args: [
      '--disable-extensions-except=' + runtimeExtension, '--load-extension=' + runtimeExtension,
      '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
    ],
  });
  context.setDefaultTimeout(12000);
  report.browserVersion = context.browser()?.version() || 'unknown';
  browserCdp = await context.browser().newBrowserCDPSession();
  browserCdp.on('Target.targetCreated', event => { if (event.targetInfo?.type === 'service_worker') cdpTargetEvents.push({ type: 'Target.targetCreated', receivedAt: Date.now(), targetInfo: event.targetInfo }); });
  browserCdp.on('Target.targetDestroyed', event => cdpTargetEvents.push({ type: 'Target.targetDestroyed', receivedAt: Date.now(), targetId: event.targetId }));
  browserCdp.on('ServiceWorker.workerVersionUpdated', event => cdpServiceWorkerEvents.push({ type: 'ServiceWorker.workerVersionUpdated', receivedAt: Date.now(), ...event }));
  await browserCdp.send('Target.setDiscoverTargets', { discover: true });
  const startupWorker = await waitFor(async () => {
    const current = await browserTargets();
    return current.find(item => item.type === 'service_worker' && item.url.endsWith('/background.js')) || null;
  }, 'extension background worker target was not discoverable without attachment', 15000);
  runtimeId = new URL(startupWorker.url).host;
  report.extensionId = runtimeId;
  report.initialWorkerTarget = { targetId: startupWorker.targetId, url: startupWorker.url, discoveredAt: Date.now(), attached: false };
  const initialPage = context.pages()[0];
  assert.ok(initialPage, 'isolated Chromium did not create its initial test tab');
  await initialPage.goto(`chrome-extension://${runtimeId}/qa-observer.html`, { waitUntil: 'domcontentloaded' });
  observerPage = initialPage;
  await observerPage.waitForFunction(() => !!globalThis.__qaObserver, null, { timeout: 10000 });
  workerCdp = await context.newCDPSession(observerPage);
  workerCdp.on('ServiceWorker.workerVersionUpdated', event => cdpServiceWorkerEvents.push({ type: 'ServiceWorker.workerVersionUpdated', receivedAt: Date.now(), ...event }));
  await workerCdp.send('ServiceWorker.enable');
  const seed = await observerPage.evaluate(({ value, rate, revision }) => globalThis.__qaObserver.seed(value, rate, revision), { value: settings, rate: 4, revision: 77 });
  report.seed = seed;
  report.seedVerified = seed.settings?.defaultMode === 'follow' && seed.lastRate === 4 && seed.lastRateRevision === 77;
  assert.equal(report.seedVerified, true, 'follow/lastRate=4 settings were not seeded before test pages');
  report.seededAt = Date.now();
  report.workerInfoAfterSeed = {
    targets: (await browserTargets()).filter(item => item.type === 'service_worker' && item.url.includes(runtimeId)).map(item => ({ targetId: item.targetId, url: item.url })),
    latestVersion: latestWorkerVersion(runtimeId),
  };

  for (let index = 1; index <= newDocumentRounds; index++) {
    const caseName = `doc-${String(index).padStart(2, '0')}`;
    const url = `${baseUrl}/autoplay?case=${caseName}&nonce=${Date.now()}`;
    const { page, tab } = await createTestPage(url);
    await waitForMedia(page);
    const samples = await observeSamples(page, tab.id, caseName);
    const outcome = trialFailure(samples);
    const trial = { index, caseName, url, tabId: tab.id, windowId: tab.windowId, createdAt: tab, docStart: samples[0].docStart,
      samples, outcome, nativeActiveAtFinalSample: samples.at(-1).activeTab?.id === tab.id };
    report.newDocumentTrials.push(trial);
    if (outcome.startupMismatch) report.startupWarnings.push?.({ stage: 'new-document', caseName, firstPlayingRate: outcome.firstPlayingRate, finalRate: outcome.finalRate });
    if (outcome.finalMiss || !outcome.finalApiPresent || !trial.nativeActiveAtFinalSample) {
      const failure = { stage: 'new-document', index, caseName, url, tabId: tab.id, ...outcome, nativeActiveAtFinalSample: trial.nativeActiveAtFinalSample };
      report.failures.push(failure);
      if (!report.firstFailure) report.firstFailure = { ...failure, screenshot: await saveFailureScreenshot(page, caseName) };
    }
    await page.close().catch(() => {});
  }

  const spaCase = 'spa-10-rounds';
  const spaUrl = `${baseUrl}/spa?case=${spaCase}&nonce=${Date.now()}`;
  const spaSession = await createTestPage(spaUrl);
  await waitForMedia(spaSession.page);
  report.spaInitial = { tabId: spaSession.tab.id, windowId: spaSession.tab.windowId, sample: await capture(spaSession.page, spaSession.tab.id, 'spa-initial') };
  for (let index = 1; index <= spaRounds; index++) {
    const route = await spaSession.page.evaluate(round => window.__qaReplaceVideo(round), index);
    await waitForMedia(spaSession.page);
    const samples = await observeSamples(spaSession.page, spaSession.tab.id, `spa-${String(index).padStart(2, '0')}`);
    const outcome = trialFailure(samples);
    const trial = { index, route, samples, outcome, nativeActiveAtFinalSample: samples.at(-1).activeTab?.id === spaSession.tab.id };
    report.spaTrials.push(trial);
    if (outcome.startupMismatch) report.startupWarnings.push?.({ stage: 'spa', index, firstPlayingRate: outcome.firstPlayingRate, finalRate: outcome.finalRate });
    if (outcome.finalMiss || !outcome.finalApiPresent || !trial.nativeActiveAtFinalSample) {
      const failure = { stage: 'spa', index, caseName: `spa-${index}`, url: route.href, tabId: spaSession.tab.id, ...outcome, nativeActiveAtFinalSample: trial.nativeActiveAtFinalSample };
      report.failures.push(failure);
      if (!report.firstFailure) report.firstFailure = { ...failure, screenshot: await saveFailureScreenshot(spaSession.page, `spa-${index}`) };
    }
  }

  await spaSession.page.bringToFront();
  const keyboardBefore = await capture(spaSession.page, spaSession.tab.id, 'keyboard-before');
  await spaSession.page.waitForFunction(rate=>window.__qaMedia?.()?.video?.rate===rate,expectedRate,{timeout:5000});
  const keyTrial = { tabId: spaSession.tab.id, before: keyboardBefore, actions: [] };
  try {
    await observerCall('localKeyProbe',spaSession.tab.id);
    await spaSession.page.keyboard.press('Shift+Comma');
    await spaSession.page.waitForTimeout(sampleStepMs);
    keyTrial.afterSlower = await capture(spaSession.page, spaSession.tab.id, 'keyboard-after-less-than');
    keyTrial.slowerToast=await spaSession.page.evaluate(()=>document.querySelector('#video-control-toast')?.shadowRoot?.querySelector('span')?.textContent);
    keyTrial.actions.push({ action: '<', keyEvents: keyTrial.afterSlower.keyEvents.slice(-3) });
    await spaSession.page.keyboard.press('Shift+Period');
    await spaSession.page.waitForTimeout(sampleStepMs);
    keyTrial.afterFaster = await capture(spaSession.page, spaSession.tab.id, 'keyboard-after-greater-than');
    keyTrial.fasterToast=await spaSession.page.evaluate(()=>document.querySelector('#video-control-toast')?.shadowRoot?.querySelector('span')?.textContent);
    keyTrial.backgroundCommandCalls=await observerCall('localKeyProbe',spaSession.tab.id,true);
    keyTrial.actions.push({ action: '>', keyEvents: keyTrial.afterFaster.keyEvents.slice(-3) });
    const trustedLess = keyTrial.afterSlower.keyEvents.some(event => event.key === '<' && event.trusted);
    const trustedGreater = keyTrial.afterFaster.keyEvents.some(event => event.key === '>' && event.trusted);
    keyTrial.trustedKeysObserved = trustedLess && trustedGreater;
    keyTrial.lessChangedRate = keyTrial.before.video?.rate === expectedRate && keyTrial.afterSlower.video?.rate < expectedRate;
    keyTrial.greaterRestoredRate = keyTrial.afterSlower.video?.rate < expectedRate && keyTrial.afterFaster.video?.rate === expectedRate;
    keyTrial.pass = keyTrial.trustedKeysObserved && keyTrial.lessChangedRate && keyTrial.greaterRestoredRate && keyTrial.backgroundCommandCalls===0 &&
      keyTrial.slowerToast===keyTrial.afterSlower.video.rate+'×' && keyTrial.fasterToast===expectedRate+'×';
  } catch (error) { keyTrial.error = String(error?.message || error); keyTrial.pass = false; }
  report.keyboardTrial = keyTrial;
  if (!keyTrial.pass) {
    const failure = { stage: 'keyboard', url: keyTrial.before.href, tabId: spaSession.tab.id, ...keyTrial };
    report.failures.push(failure);
    if (!report.firstFailure) report.firstFailure = { ...failure, screenshot: await saveFailureScreenshot(spaSession.page, 'keyboard') };
  }
  await spaSession.page.close().catch(() => {});

  const faultTab = await observerCall('createTab', 'about:blank');
  const faultPage = await waitFor(() => context.pages().find(item => item.url() === 'about:blank'), 'controlled-fault tab page did not attach', 10000);
  await faultPage.bringToFront();
  const armedFaults = await observerCall('armFaults',faultTab.id);
  assert.equal(armedFaults?.ok, true, 'could not arm the one-time background activeTarget rejection');
  const faultUrl = `${baseUrl}/fault?qa072=all&case=first-message-and-bridge-delay&nonce=${Date.now()}`;
  await faultPage.goto(faultUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await faultPage.waitForFunction(() => typeof window.__qaMedia === 'function', null, { timeout: 10000 });
  await waitForMedia(faultPage);
  const faultTrial = { tabId: faultTab.id, windowId: faultTab.windowId, url: faultUrl, armedFaults,
    injectedFaults: { settingsRejectedOnce: true, activeTargetRejectedOnce: true, staticMainBridgeWithheld: true },
    samples: [], actions: [] };
  faultTrial.justLoaded=await capture(faultPage,faultTab.id,'fault-without-input-initial');
  if(process.env.VIDEOSPEED_QA_WAIT_FAULT_PRESET!=='0'){
   await faultPage.waitForFunction(rate=>window.__qaMedia?.()?.video?.rate===rate,expectedRate,{timeout:5000}).catch(()=>{});
   faultTrial.automaticBeforeKeys=await capture(faultPage,faultTab.id,'fault-recovered-without-input');
   faultTrial.automaticPresetWithoutInput=faultTrial.automaticBeforeKeys.video?.rate===expectedRate&&faultTrial.automaticBeforeKeys.keyEvents.length===0;
  }
  faultTrial.beforeFirstHotkey = await capture(faultPage, faultTab.id, 'fault-before-first-hotkey');
  await faultPage.keyboard.press('Shift+Comma');
  await faultPage.waitForTimeout(sampleStepMs);
  faultTrial.afterFirstLess = await capture(faultPage, faultTab.id, 'fault-after-first-less');
  faultTrial.actions.push({ action: '<', keyEvents: faultTrial.afterFirstLess.keyEvents.slice(-3) });
  await faultPage.keyboard.press('Shift+Period');
  await faultPage.waitForTimeout(sampleStepMs);
  faultTrial.afterFirstGreater = await capture(faultPage, faultTab.id, 'fault-after-first-greater');
  faultTrial.actions.push({ action: '>', keyEvents: faultTrial.afterFirstGreater.keyEvents.slice(-3) });
  await faultPage.waitForFunction(() => window.__qaMainBridgeReadyEvents?.some(event => event.detail?.enabled === true), null, { timeout: 4000 }).catch(() => {});
  await faultPage.waitForTimeout(250);
  faultTrial.afterBridgeDelay = await capture(faultPage, faultTab.id, 'fault-after-main-bridge-delay');
  faultTrial.samples = [faultTrial.beforeFirstHotkey, faultTrial.afterFirstLess, faultTrial.afterFirstGreater, faultTrial.afterBridgeDelay];
  const faultState = faultTrial.afterBridgeDelay;
  const settingsFault = faultState.isolated?.qaFaults;
  const activeTargetFault = faultState.qaFaultState;
  const bridgeFault = faultState.mainBridgeFault;
  faultTrial.instrumentationValid = settingsFault?.settingsRejected === true && settingsFault.settingsRequestCount >= 1 &&
    Number.isFinite(activeTargetFault?.activeTargetRejectedAt) && bridgeFault?.mode === 'static-main-bridge-withheld' &&
    Number.isFinite(bridgeFault?.withheldAt);
  const trustedFirstLess = faultTrial.afterFirstLess.keyEvents.some(event => event.key === '<' && event.trusted);
  const trustedFirstGreater = faultTrial.afterFirstGreater.keyEvents.some(event => event.key === '>' && event.trusted);
  faultTrial.initialHotkeyEffective = trustedFirstLess && Number.isFinite(faultTrial.beforeFirstHotkey.video?.rate) &&
    Number.isFinite(faultTrial.afterFirstLess.video?.rate) && faultTrial.afterFirstLess.video.rate !== faultTrial.beforeFirstHotkey.video.rate;
  faultTrial.firstHotkeyRate = faultTrial.afterFirstLess.video?.rate ?? null;
  faultTrial.returnHotkeyEffective = trustedFirstGreater && faultTrial.afterFirstGreater.video?.rate === expectedRate;
  faultTrial.expectedPresetAtEnd = faultTrial.afterBridgeDelay.video?.rate === expectedRate;
  faultTrial.apiPresentAtEnd = faultTrial.afterBridgeDelay.isolated?.present === true;
  faultTrial.apiTargetAtEnd = faultTrial.afterBridgeDelay.isolated?.snapshot?.some(item => item.playing && item.rate === expectedRate) === true;
  faultTrial.mainBridgeRecovered = faultTrial.afterBridgeDelay.mainBridgeState?.present === true &&
    faultTrial.afterBridgeDelay.mainBridgeReadyEvents.some(event => event.detail?.enabled === true);
  faultTrial.mainBridgeReadyAt = faultTrial.afterBridgeDelay.mainBridgeReadyEvents.find(event => event.detail?.enabled === true)?.at ?? null;
  faultTrial.mainBridgeReadyVersion = faultTrial.afterBridgeDelay.mainBridgeReadyEvents.find(event => event.detail?.enabled === true)?.detail?.version ?? null;
  faultTrial.pageStartRate = faultTrial.beforeFirstHotkey.pageEvents.find(event => event.type === 'playing')?.rate ?? null;
  faultTrial.sessionActivityAtEnd = faultTrial.afterBridgeDelay.tabActivity;
  faultTrial.pass = faultTrial.automaticPresetWithoutInput!==false && faultTrial.instrumentationValid && faultTrial.initialHotkeyEffective && faultTrial.returnHotkeyEffective &&
    faultTrial.expectedPresetAtEnd && faultTrial.apiPresentAtEnd && faultTrial.apiTargetAtEnd && faultTrial.mainBridgeRecovered;
  report.controlledFaultTrial = faultTrial;
  if (!faultTrial.instrumentationValid) report.startupWarnings.push({ stage: 'controlled-fault', message: 'One or more QA-only faults were not observed; trial is invalid.' });
  else if (!faultTrial.pass) {
    const failure = { stage: 'controlled-fault', url: faultUrl, tabId: faultTab.id,
      settingsRejected: settingsFault?.settingsRejected === true,
      activeTargetRejected: Number.isFinite(activeTargetFault?.activeTargetRejectedAt),
      staticMainBridgeWithheld: bridgeFault?.mode === 'static-main-bridge-withheld',
      mainBridgeRecovered: faultTrial.mainBridgeRecovered,
      pageStartRate: faultTrial.pageStartRate, firstHotkeyRate: faultTrial.firstHotkeyRate,
      finalRate: faultTrial.afterBridgeDelay.video?.rate ?? null, apiPresent: faultTrial.apiPresentAtEnd,
      firstHotkeyEffective: faultTrial.initialHotkeyEffective, ...trialFailure([faultTrial.beforeFirstHotkey, faultTrial.afterBridgeDelay]) };
    report.failures.push(failure);
    if (!report.firstFailure) report.firstFailure = { ...failure, screenshot: await saveFailureScreenshot(faultPage, 'controlled-fault') };
  }
  await observerCall('disarmFaults').catch(() => null);
  if (!report.failures.length) await faultPage.close().catch(() => {});

  const coldPage = await context.newPage();
  await coldPage.goto('about:blank');
  await coldPage.bringToFront();
  const warmupUrl = baseUrl + '/warmup?nonce=' + Date.now();
  await coldPage.goto(warmupUrl, { waitUntil: 'domcontentloaded' });
  await new Promise(resolve => setTimeout(resolve, 300));
  await coldPage.goto('about:blank');
  const beforeColdTarget = await waitFor(async () => {
    const target = serviceWorkerTarget(await browserTargets(), runtimeId);
    return target || null;
  }, 'could not bring extension service worker to a running state before stop', 10000);
  let version = latestWorkerVersion(runtimeId);
  if (!version?.versionId) {
    await workerCdp.send('ServiceWorker.enable');
    version = await waitFor(() => latestWorkerVersion(runtimeId)?.versionId ? latestWorkerVersion(runtimeId) : null,
      'service worker version id was not available without target attachment', 5000);
  }
  const cold = { stopRequestedAt: Date.now(), beforeTarget: { targetId: beforeColdTarget.targetId, url: beforeColdTarget.url },
    versionId: version.versionId, workerVersionBeforeStop: version, workerAttached: false,
    tabId: (await observerPage.evaluate(() => chrome.tabs.query({ active: true, lastFocusedWindow: true }))).at(0)?.id ?? null,
    beforeSessionTabActivity: (await observerPage.evaluate(() => chrome.storage.session.get('tabActivity'))).tabActivity || null };
  report.coldWorkerTrial = cold;
  await workerCdp.send('ServiceWorker.stopWorker', { versionId: version.versionId });
  cold.stopCommandReturnedAt = Date.now();
  await waitFor(async () => {
    const currentTargets = await browserTargets();
    const record = latestWorkerVersion(runtimeId);
    return !serviceWorkerTarget(currentTargets, runtimeId) && record?.runningStatus === 'stopped' ? record : null;
  }, 'service worker did not stop before cold page navigation', 10000);
  cold.stoppedAt = Date.now();
  cold.workerVersionStopped = latestWorkerVersion(runtimeId);
  cold.targetsAfterStop = (await browserTargets()).filter(item => item.type === 'service_worker' && item.url.includes(runtimeId));
  cold.versionAfterStop = latestWorkerVersion(runtimeId);
  const coldUrl = `${baseUrl}/cold?case=worker-cold&nonce=${Date.now()}`;
  cold.navigationStartedAt = Date.now();
  await coldPage.goto(coldUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await waitForMedia(coldPage);
  cold.mediaStartedAt = Date.now();
  const coldTabInfo = await observerPage.evaluate(() => chrome.tabs.query({ active: true, lastFocusedWindow: true })).then(rows => rows[0] || null);
  cold.tabId = coldTabInfo?.id ?? cold.tabId;
  cold.samples = await observeSamples(coldPage, cold.tabId, 'cold-worker-wake');
  const restartedWorker = await waitFor(async () => {
    const current = await browserTargets();
    const worker = serviceWorkerTarget(current, runtimeId);
    const event = cdpServiceWorkerEvents.find(item => item.type === 'ServiceWorker.workerVersionUpdated' &&
      item.receivedAt >= cold.navigationStartedAt && item.versions?.some(version => version.scriptURL === `chrome-extension://${runtimeId}/background.js` &&
        version.versionId === cold.versionId && version.runningStatus === 'running'));
    const record = latestWorkerVersion(runtimeId);
    const stoppedEvent = cdpServiceWorkerEvents.find(item => item.type === 'ServiceWorker.workerVersionUpdated' &&
      item.receivedAt <= cold.navigationStartedAt && item.versions?.some(version => version.scriptURL === `chrome-extension://${runtimeId}/background.js` &&
        version.versionId === cold.versionId && version.runningStatus === 'stopped'));
    return worker && event && stoppedEvent && record?.versionId === cold.versionId && record?.runningStatus === 'running' ?
      { worker, event, stoppedEvent, record } : null;
  }, 'cold document did not restart the stopped background service worker', 12000);
  cold.workerRestart = { targetId: restartedWorker.worker.targetId, runningEventAt: restartedWorker.event.receivedAt,
    stoppedEventAt: restartedWorker.stoppedEvent.receivedAt, versionId: restartedWorker.record.versionId,
    runningStatus: restartedWorker.record.runningStatus, targetIdReused: restartedWorker.worker.targetId === beforeColdTarget.targetId };
  cold.restartConfirmed = restartedWorker.stoppedEvent.receivedAt < cold.navigationStartedAt &&
    cold.workerRestart.runningEventAt >= cold.navigationStartedAt && cold.workerRestart.runningStatus === 'running';
  cold.outcome = trialFailure(cold.samples);
  cold.contentApiPresent = cold.samples.at(-1).isolated?.present === true;
  cold.contentScriptWakeEvidence = cold.restartConfirmed && cold.contentApiPresent && cold.mediaStartedAt >= cold.navigationStartedAt;
  cold.targetActivity = cold.samples.at(-1).tabActivity;
  report.coldWorkerTrial = cold;
  if (!cold.contentScriptWakeEvidence || cold.outcome.finalMiss || !cold.outcome.finalApiPresent) {
    const failure = { stage: 'cold-worker-wake', caseName: 'worker-cold', url: coldUrl, tabId: cold.tabId,
      workerRestartConfirmed: cold.restartConfirmed, contentApiPresent: cold.contentApiPresent, ...cold.outcome };
    report.failures.push(failure);
    if (!report.firstFailure) report.firstFailure = { ...failure, screenshot: await saveFailureScreenshot(coldPage, 'cold-worker') };
  }
  if (!report.failures.length) await coldPage.close().catch(() => {});

  report.completedAt = Date.now();
  report.popupOpenedAt = null;
  report.popupOpenedBeforeEvidence = false;
  report.testsPassedWithoutPopup = report.failures.length === 0;
  report.extensionTreeSha256After = await treeDigest(sourceExtension);
  report.extensionTreeUnchangedDuringRun = report.extensionTreeSha256After === report.extensionTreeSha256;
  await writeFile(prePopupPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  if (report.failures.length && allowPopupComparison) {
    const failureUrl = report.firstFailure.url || coldUrl;
    let comparisonPage = context.pages().find(page => page.url() === failureUrl) || null;
    if (!comparisonPage) {
      comparisonPage = await context.newPage();
      await comparisonPage.goto(failureUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await comparisonPage.waitForFunction(() => !!window.__qaMedia, null, { timeout: 8000 }).catch(() => {});
    }
    await comparisonPage.bringToFront().catch(() => {});
    const lastUrl = comparisonPage.url();
    const matchingTab = await observerPage.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url), lastUrl).catch(() => null);
    if (matchingTab?.id && await comparisonPage.evaluate(() => !!window.__qaMedia).catch(() => false)) {
      report.popupComparison = { beforePopup: await capture(comparisonPage, matchingTab.id, 'retained-failure-before-popup') };
      report.popupOpenedAt = Date.now();
      const popupUrl = `chrome-extension://${runtimeId}/popup.html`;
      const popupTab = await observerPage.evaluate(({ url, windowId }) => chrome.tabs.create({ url, windowId, active: false }).then(tab => ({ id: tab.id, windowId: tab.windowId, active: tab.active === true, url: tab.url })), { url: popupUrl, windowId: matchingTab.windowId });
      const popupPage = await waitFor(() => context.pages().find(page => page.url() === popupUrl), 'popup comparison page did not open after failure evidence', 10000);
      await popupPage.waitForTimeout(150);
      report.popupComparison.popupEarly = await popupPage.evaluate(() => ({ target: document.querySelector('#single-target')?.textContent?.trim() || '',
        bodyEmpty: document.body.classList.contains('empty'), playbackHidden: document.querySelector('#playback')?.hidden ?? null,
        rate: document.querySelector('#current-rate')?.value || '', rateDisabled: document.querySelector('#current-rate')?.disabled ?? null }));
      await popupPage.waitForTimeout(900);
      report.popupComparison.popupSettled = await popupPage.evaluate(() => ({ target: document.querySelector('#single-target')?.textContent?.trim() || '',
        bodyEmpty: document.body.classList.contains('empty'), playbackHidden: document.querySelector('#playback')?.hidden ?? null,
        rate: document.querySelector('#current-rate')?.value || '', rateDisabled: document.querySelector('#current-rate')?.disabled ?? null }));
      report.popupComparison.popupTab = popupTab;
      report.popupComparison.afterPopupPageRate = await comparisonPage.evaluate(() => window.__qaMedia?.()?.video?.rate ?? null).catch(() => null);
      const popupShot = path.join(qaDirectory, 'popup-after-failure.png');
      await popupPage.setViewportSize({ width: 420, height: 240 });
      await popupPage.screenshot({ path: popupShot, clip: { x: 0, y: 0, width: 420, height: 240 } }).catch(() => {});
      report.popupComparison.screenshot = popupShot;
      report.popupOpenedAfterEvidence = true;
    } else {
      report.popupComparison = { ...report.popupComparison, error: 'Could not attach popup comparison to retained failing URL' };
    }
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  } else {
    if (report.failures.length) report.popupComparisonSkipped = 'VIDEOSPEED_QA_POPUP_AFTER_FAILURE was not enabled; no popup was opened.';
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  }
} catch (error) {
  fatalError = error;
  report.error = String(error?.stack || error?.message || error);
  report.completedAt = Date.now();
  if (report.popupOpenedAt === null) {
    report.prePopupEvidenceCapturedAt = Date.now();
    await writeFile(prePopupPath, JSON.stringify(report, null, 2) + '\n', 'utf8').catch(() => {});
  }
} finally {
  for (const page of context?.pages() || []) await page.close().catch(() => {});
  await context?.close().then(() => { cleanup.browserClosed = true; }).catch(error => { cleanup.error = String(error?.message || error); });
  await workerCdp?.detach().catch(() => {});
  await browserCdp?.detach().catch(() => {});
  if (server) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)).catch(() => {}); }
  if (profileRoot) {
    const resolved = await realpath(profileRoot).catch(() => path.resolve(profileRoot));
    const relative = path.relative(path.resolve(os.tmpdir()), resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(resolved).startsWith('videospeed-qa072-autostart-')) {
      cleanup.error = 'Refused profile removal outside the QA-072 isolated OS temp directory';
    } else {
      cleanup.verifiedInsideOsTemp = true;
      await rm(resolved, { recursive: true, force: true }).then(() => { cleanup.profileRemoved = true; }).catch(error => { cleanup.error = String(error?.message || error); });
    }
  }
  report.cleanup = cleanup;
  if (!report.completedAt) report.completedAt = Date.now();
  await mkdir(qaDirectory, { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8').catch(() => {});
}

const summary = {
  version: report.version, extensionTreeSha256: report.extensionTreeSha256,
  newDocument: { count: report.newDocumentTrials.length, finalMisses: report.newDocumentTrials.filter(item => item.outcome?.finalMiss).map(item => item.caseName) },
  spa: { count: report.spaTrials.length, finalMisses: report.spaTrials.filter(item => item.outcome?.finalMiss).map(item => item.index) },
  keyboardPass: report.keyboardTrial?.pass ?? null,
  controlledFault: report.controlledFaultTrial ? { instrumentationValid: report.controlledFaultTrial.instrumentationValid,
    pass: report.controlledFaultTrial.pass, pageStartRate: report.controlledFaultTrial.pageStartRate,
    firstHotkeyRate: report.controlledFaultTrial.firstHotkeyRate, finalRate: report.controlledFaultTrial.afterBridgeDelay?.video?.rate ?? null,
    apiPresent: report.controlledFaultTrial.apiPresentAtEnd, mainBridgeRecovered: report.controlledFaultTrial.mainBridgeRecovered } : null,
  coldWorker: report.coldWorkerTrial ? { restartConfirmed: report.coldWorkerTrial.restartConfirmed, contentScriptWakeEvidence: report.coldWorkerTrial.contentScriptWakeEvidence, rate: report.coldWorkerTrial.samples?.at(-1)?.video?.rate ?? null } : null,
  failureCount: report.failures.length, popupOpenedAt: report.popupOpenedAt,
  prePopupEvidence: prePopupPath, report: reportPath, cleanup, error: report.error || null,
};
console.log(JSON.stringify(summary, null, 2));
if (fatalError || report.failures.length || !report.controlledFaultTrial?.pass || !report.coldWorkerTrial?.restartConfirmed || report.popupOpenedAt || report.newDocumentTrials.length !== newDocumentRounds || report.spaTrials.length !== spaRounds) process.exitCode = 1;

