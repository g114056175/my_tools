#!/usr/bin/env node
// Reusable local Chromium long-playback soak for a built VideoSpeed extension.
// Optional configuration: VIDEOSPEED_SOAK_EXTENSION_DIR, _OUTPUT_DIR, _VERSION,
// _HASH, _SECONDS and _BROWSER. In headless runs the popup check is page-content
// smoke only; it is not toolbar UI or visual acceptance.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { appendFile, cp, mkdir, readFile, realpath, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const qaDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(qaDir, '../..');
const expectedVersion = process.env.VIDEOSPEED_SOAK_VERSION?.trim() || null;
const extensionSource = path.resolve(process.env.VIDEOSPEED_SOAK_EXTENSION_DIR?.trim() || path.join(projectRoot, 'extension'));
const outputDir = path.resolve(process.env.VIDEOSPEED_SOAK_OUTPUT_DIR?.trim() || path.join(projectRoot, 'work', 'qa-playback-soak'));
const runtimeExtension = path.join(outputDir, 'runtime-extension');
const reportPath = path.join(outputDir, 'results.json');
const samplesPath = path.join(outputDir, 'samples.jsonl');
const tracePath = path.join(outputDir, 'renderer-trace.json');
const screenshotPath = path.join(outputDir, 'failure.png');
const prePopupPath = path.join(outputDir, 'pre-popup-results.json');
const expectedHash = process.env.VIDEOSPEED_SOAK_HASH?.trim() || null;
const durationSeconds = Number(process.env.VIDEOSPEED_SOAK_SECONDS || 300);
const browserPath = process.env.VIDEOSPEED_SOAK_BROWSER?.trim() || process.env.VIDEOSPEED_CHROMIUM?.trim() || 'C:/Users/pc15/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const settings = {
  schemaVersion: 3, enabled: true, defaultMode: 'follow', customRate: 2, preferredRate: 2,
  steps: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4],
  qualityEnabled: false, preferredQuality: 1080,
  shortcuts: { slower: '<', faster: '>', reset: ':', preferred: '"', fineSlower: '', fineFaster: '' },
  disabledSites: [], siteModes: {},
};

const observerJs = String.raw`(() => {
  const qa = {
    async seed(settings, lastRate, revision) {
      await chrome.storage.local.set({ settings, lastRate, lastRateRevision: revision });
      return chrome.storage.local.get(['settings', 'lastRate', 'lastRateRevision']);
    },
    async createTab(url, active = true) { return chrome.tabs.create({ url, active }); },
    async activate(tabId) { return chrome.tabs.update(tabId, { active: true }); },
    async close(tabId) { return chrome.tabs.remove(tabId); },
    async inspect(tabId) {
      const [data, session, tab, active] = await Promise.all([
        chrome.storage.local.get(['settings', 'lastRate', 'lastRateRevision']),
        chrome.storage.session.get('tabActivity'),
        chrome.tabs.get(tabId).catch(() => null),
        chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(rows => rows[0] || null),
      ]);
      let isolated = null, injectionError = null;
      try {
        const rows = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED', func: () => {
          const api = globalThis[Symbol.for('video-control.api')];
          let snapshots = [], diagnostics = [];
          try { snapshots = api?.snapshot?.() || []; } catch (error) { diagnostics.push({ readError: String(error?.message || error) }); }
          try { diagnostics = api?.diagnostics?.() || diagnostics; } catch (error) { diagnostics.push({ diagnosticsError: String(error?.message || error) }); }
          const monitor = globalThis.__videoSpeedSoakMonitor, cutoff = Date.now()-1000;
          return { present: !!api, alive: api?.alive?.() === true, enabled: api?.enabled?.() === true, version: api?.version || null,
            snapshots, diagnostics, qaMonitor: monitor ? {
              keyCount:monitor.keys?.length||0,preventedCount:monitor.prevented?.length||0,stoppedCount:monitor.stopped?.length||0,
              recentKeys:monitor.keys?.slice(-8)||[],recentPrevented:monitor.prevented?.slice(-8)||[],
              messageTotal:monitor.messageTotal||0,messagesPerLastSecond:monitor.messages?.filter(item=>item.at>=cutoff).length||0,
              messagesByActionLastSecond:Object.fromEntries([...new Set((monitor.messages||[]).filter(item=>item.at>=cutoff).map(item=>item.action))]
                .map(action=>[action,monitor.messages.filter(item=>item.at>=cutoff&&item.action===action).length])),
              lastMessages:monitor.messages?.slice(-8)||[] } : null };
        }});
        isolated = rows[0]?.result || null;
      } catch (error) { injectionError = String(error?.message || error); }
      return { at: Date.now(), tab: tab && { id: tab.id, active: tab.active, status: tab.status, url: tab.url || tab.pendingUrl || '' },
        activeTab: active && { id: active.id, windowId: active.windowId, url: active.url || active.pendingUrl || '' },
        settings: data.settings || null, lastRate: data.lastRate ?? null, lastRateRevision: data.lastRateRevision ?? null,
        tabActivity: session.tabActivity || null, isolated, injectionError };
    },
    async health(tabId) {
      const startedAt = Date.now();
      try {
        const response = await chrome.runtime.sendMessage({ scope: 'video-control', action: 'activity', tabId });
        return { startedAt, completedAt: Date.now(), latencyMs: Date.now() - startedAt, ok: !!response, response: response ? {
          pageUrl: response.pageUrl, lastRate: response.lastRate, rateRevision: response.rateRevision,
          activity: response.activity,
        } : null };
      } catch (error) { return { startedAt, completedAt: Date.now(), latencyMs: Date.now() - startedAt, ok: false, error: String(error?.message || error) }; }
    },
    async openPopup() {
      try { await chrome.action.openPopup(); return { mode:'action', openedAt:Date.now() }; }
      catch (error) { return { mode:'action-error', error:String(error?.message||error) }; }
    },
    async openPopupTab(active = false) { return chrome.tabs.create({ url: chrome.runtime.getURL('popup.html'), active }); },
  };
  Object.defineProperty(globalThis, '__videoSpeedSoak', { value: qa });
})();`;

const observerHtml = '<!doctype html><meta charset="utf-8"><title>QA observer</title><script src="observer.js"></script>';
const qaMonitorSource = String.raw`(() => {
  const state = { keys: [], prevented: [], stopped: [], messages: [], messageTotal: 0 };
  Object.defineProperty(globalThis, '__videoSpeedSoakMonitor', { value:state, configurable:false });
  window.addEventListener('keydown', event => state.keys.push({at:Date.now(),key:event.key,code:event.code,trusted:event.isTrusted,shift:event.shiftKey}), true);
  const eventPrototype = Event.prototype;
  for (const [name, sink] of [['preventDefault','prevented'],['stopImmediatePropagation','stopped']]) {
    const original = eventPrototype[name];
    try { Object.defineProperty(eventPrototype, name, { configurable:true, writable:true, value:function(...args) {
      if (this?.type === 'keydown' && this.isTrusted) state[sink].push({at:Date.now(),key:this.key,code:this.code,trusted:this.isTrusted});
      return Reflect.apply(original, this, args);
    }}); } catch {}
  }
  const runtime=chrome.runtime,originalSend=runtime.sendMessage;
  runtime.sendMessage=function(message,...args){
    const call={at:Date.now(),action:message?.action||'unknown'};state.messageTotal++;
    state.messages.push(call);if(state.messages.length>500)state.messages.shift();
    let result;
    try{result=Reflect.apply(originalSend,runtime,[message,...args]);}
    catch(error){call.completedAt=Date.now();call.error=String(error?.message||error);throw error;}
    if(result&&typeof result.then==='function')return Promise.resolve(result).then(value=>{call.completedAt=Date.now();call.latencyMs=call.completedAt-call.at;call.ok=true;return value;},error=>{call.completedAt=Date.now();call.latencyMs=call.completedAt-call.at;call.ok=false;call.error=String(error?.message||error);throw error;});
    call.completedAt=Date.now();call.latencyMs=call.completedAt-call.at;call.ok=true;return result;
  };
})();`;
const pageHtml = String.raw`<!doctype html><html><head><meta charset="utf-8"><title>VideoSpeed soak</title>
<style>body{font:16px system-ui;margin:24px;background:#eee}video{width:900px;height:506px;background:#111}</style>
<script>
window.__soak = { startedAt: Date.now(), heartbeats: [], mediaEvents: [], keyEvents: [], toastMutations: [], longTasks: [], routeFeedback: [], mutationCount: 0 };
const soak = window.__soak;
const videoNow = () => document.querySelector('video#soak-video');
document.addEventListener('keydown', event => soak.keyEvents.push({at:Date.now(), key:event.key, code:event.code, trusted:event.isTrusted, defaultPrevented:event.defaultPrevented}), true);
for (const type of ['play','playing','pause','ended','ratechange','loadedmetadata','timeupdate']) document.addEventListener(type, event => {
  if (event.target?.tagName === 'VIDEO') soak.mediaEvents.push({at:Date.now(),type,rate:event.target.playbackRate,time:event.target.currentTime,paused:event.target.paused,trusted:event.isTrusted});
}, true);
try { new PerformanceObserver(list => soak.longTasks.push(...list.getEntries().map(e => ({at:Date.now(),duration:e.duration,name:e.name})))).observe({type:'longtask', buffered:true}); } catch {}
document.addEventListener('DOMContentLoaded', () => {
  const player=document.querySelector('#player');
  if (!player) return;
  new MutationObserver(records => {
    for (const record of records) soak.routeFeedback.push({at:Date.now(),attribute:record.attributeName,oldValue:record.oldValue,
      value:player.getAttribute(record.attributeName),href:location.href});
  }).observe(player,{attributes:true,attributeOldValue:true,attributeFilter:['data-soak-route','aria-label']});
});
let toastObserver = null;
new MutationObserver(records => {
  soak.mutationCount += records.length;
  const toast = document.getElementById('video-control-toast');
  if (toast && !toastObserver && toast.shadowRoot) {
    toastObserver = new MutationObserver(changes => soak.toastMutations.push({at:Date.now(),text:(toast.shadowRoot?.querySelector('span')?.textContent||'').trim(),changes:changes.length}));
    toastObserver.observe(toast.shadowRoot,{subtree:true,childList:true,characterData:true,attributes:true});
  }
  if (toast) soak.toastMutations.push({at:Date.now(),text:(toast.shadowRoot?.querySelector('span')?.textContent||'').trim(),changes:records.length});
}).observe(document, {subtree:true,childList:true,characterData:true,attributes:true});
let expectedBeat = Date.now() + 1000;
setInterval(() => { const now=Date.now(); soak.heartbeats.push({at:now,drift:now-expectedBeat}); expectedBeat=now+1000; }, 1000);
window.__replaceSoakVideo = async round => {
  const old=videoNow(); const video=document.createElement('video'); video.id='soak-video'; video.autoplay=true; video.loop=true; video.playsInline=true; video.controls=true;
  video.src='/tiny.webm?round='+round+'&t='+Date.now(); document.querySelector('#player').replaceChildren(video);
  try { await video.play(); } catch {}
  return {round,at:Date.now(),oldRate:old?.playbackRate ?? null,src:video.currentSrc||video.src};
};
window.__sameUrlReplaceState = round => {
  const before=location.href;
  history.replaceState({...history.state,videoSpeedSoakRound:round},'',before);
  const player=document.querySelector('#player');
  player.setAttribute('data-soak-route',String(round));
  player.setAttribute('aria-label','Soak route '+round);
  return {round,at:Date.now(),before,after:location.href,sameUrl:before===location.href,docStart:soak.startedAt};
};
window.__soakSnapshot = () => { const v=videoNow(),toast=document.getElementById('video-control-toast'); const hb=soak.heartbeats.at(-1); const cutoff=Date.now()-4000; return {
  at:Date.now(), href:location.href, title:document.title,docStart:soak.startedAt,
  video:v?{rate:v.playbackRate,defaultRate:v.defaultPlaybackRate,currentTime:v.currentTime,paused:v.paused,ended:v.ended,readyState:v.readyState,src:v.currentSrc||v.src}:null,
  toast:toast?(toast.shadowRoot?.querySelector('span')?.textContent||'').trim():null,
  heartbeat:hb||null,heartbeatCount:soak.heartbeats.length,mediaEventCount:soak.mediaEvents.length,keyEventCount:soak.keyEvents.length,
  toastMutationCount:soak.toastMutations.length,mutationCount:soak.mutationCount,routeFeedbackCount:soak.routeFeedback.length,longTaskCount:soak.longTasks.length,
  recentMedia:soak.mediaEvents.filter(item=>item.at>=cutoff).slice(-40),recentKeys:soak.keyEvents.filter(item=>item.at>=cutoff).slice(-12),
  recentRouteFeedback:soak.routeFeedback.filter(item=>item.at>=cutoff).slice(-12),
  recentToast:soak.toastMutations.filter(item=>item.at>=cutoff).slice(-12),recentLongTasks:soak.longTasks.slice(-6)
};};
</script></head><body><h1>Local loop soak</h1><main id="player"><video id="soak-video" autoplay loop playsinline controls src="/tiny.webm"></video></main>
<script>document.querySelector('video').play().catch(()=>{});</script></body></html>`;

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
async function treeHash(root) {
  const h = createHash('sha256');
  for (const f of await filesUnder(root)) h.update(f).update('\0').update(await readFile(path.join(root, f))).update('\0');
  return h.digest('hex');
}
function safeQaChild(parent, target) {
  const rel = path.relative(path.resolve(parent), path.resolve(target));
  assert.ok(rel && !rel.startsWith('..') && !path.isAbsolute(rel), 'refusing mutation outside QA directory');
  return path.resolve(target);
}
function makeReport() {
  return { version: expectedVersion, startedAt: Date.now(), expectedTreeHash: expectedHash, treeHash: null, browserPath,
    durationSeconds, seed: null, phases: [], keyActions: [], spaFeedbackTrials: [], samples: [], workerHealth: [], cdpMetrics: [], messageFrequency: [],
    rendererTraceEventCount: 0, popupCheck: null, popupValidationScope:'headless popup-page content smoke only; toolbar UI visual acceptance not performed',
    firstFailure: null, error: null,
    cleanup: { profileCreated:false, browserClosed:false, profileRemoved:false, verifiedInsideOsTemp:false, error:null } };
}

let context, server, profileRoot, observerPage, soakPage, pageCdp, browserCdp, tracingComplete, baseUrl, activeVideoTabId, idleTabId;
let traceEvents = [], traceEventOverflow = 0, fatalError = null;
const report = makeReport();
const traceCategories = 'devtools.timeline,blink.user_timing,v8';

async function main() {
  await mkdir(outputDir, { recursive: true });
  await writeFile(samplesPath, '', 'utf8');
  const actualHash = await treeHash(extensionSource);
  report.treeHash = actualHash;
  report.expectedTreeHash = expectedHash || actualHash;
  if (expectedHash && actualHash !== expectedHash) throw new Error(`extension hash mismatch: expected ${expectedHash}, got ${actualHash}`);
  const manifest = JSON.parse(await readFile(path.join(extensionSource, 'manifest.json'), 'utf8'));
  if (expectedVersion) assert.equal(manifest.version, expectedVersion, `source extension is not ${expectedVersion}`);
  report.version = manifest.version;
  const videoPath = path.join(projectRoot, 'tests', 'fixtures', 'tiny.webm');
  const videoBytes = await readFile(videoPath);
  server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/tiny.webm') { res.writeHead(200, { 'content-type':'video/webm', 'content-length':String(videoBytes.length), 'cache-control':'no-store', 'accept-ranges':'bytes' }); res.end(videoBytes); return; }
    if (url.pathname === '/soak') { res.writeHead(200, { 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store' }); res.end(pageHtml); return; }
    res.writeHead(200, { 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store' }); res.end('<!doctype html><title>Idle tab</title><p>QA idle tab</p>');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  profileRoot = await (await import('node:fs/promises')).mkdtemp(path.join(os.tmpdir(), 'videospeed-long-soak-'));
  report.cleanup.profileCreated = true;
  const runtimePath = safeQaChild(outputDir, runtimeExtension);
  await rm(runtimePath, { recursive:true, force:true });
  await cp(extensionSource, runtimePath, { recursive:true });
  await writeFile(path.join(runtimePath, 'soak-observer.html'), observerHtml, 'utf8');
  await writeFile(path.join(runtimePath, 'observer.js'), observerJs, 'utf8');
  await writeFile(path.join(runtimePath, 'soak-monitor.js'), qaMonitorSource, 'utf8');
  const runtimeManifestPath = path.join(runtimePath, 'manifest.json');
  const runtimeManifest = JSON.parse(await readFile(runtimeManifestPath, 'utf8'));
  const isolatedContent = runtimeManifest.content_scripts.find(item => item.world !== 'MAIN' && item.js.includes('content.js'));
  assert.ok(isolatedContent, 'isolated content script manifest entry not found');
  isolatedContent.js.unshift('soak-monitor.js');
  await writeFile(runtimeManifestPath, JSON.stringify(runtimeManifest, null, 2) + '\n', 'utf8');
  context = await chromium.launchPersistentContext(path.join(profileRoot, 'profile'), {
    executablePath: browserPath, headless: true, viewport:{width:1280,height:900},
    args:[
      `--disable-extensions-except=${runtimePath}`, `--load-extension=${runtimePath}`,
      '--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows','--disable-component-update','--disable-background-networking','--disable-sync','--no-first-run','--no-default-browser-check',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
    ],
  });
  context.setDefaultTimeout(10000);
  report.browserVersion = context.browser()?.version() || 'unknown';
  observerPage = context.pages()[0];
  assert.ok(observerPage, 'extension context has no initial page');
  browserCdp = await context.browser().newBrowserCDPSession();
  await browserCdp.send('Target.setDiscoverTargets', { discover:true });
  const getWorkerTarget = async () => (await browserCdp.send('Target.getTargets')).targetInfos.find(item => item.type === 'service_worker' && item.url.includes('/background.js')) || null;
  let workerTarget = null;
  const workerWaitStarted = Date.now();
  while (!workerTarget && Date.now()-workerWaitStarted < 15000) { workerTarget = await getWorkerTarget(); if (!workerTarget) await new Promise(resolve => setTimeout(resolve,50)); }
  if (workerTarget) report.workerTargetInitial = { targetId:workerTarget.targetId, url:workerTarget.url, attached:workerTarget.attached };
  const extId = workerTarget ? new URL(workerTarget.url).host : null;
  if (!extId) throw new Error('extension background service worker did not start');
  report.extensionId = extId;
  await observerPage.goto(`chrome-extension://${extId}/soak-observer.html`, { waitUntil:'domcontentloaded' });
  await observerPage.waitForFunction(() => !!globalThis.__videoSpeedSoak);
  report.seed = await observerPage.evaluate(({ settingsValue }) => globalThis.__videoSpeedSoak.seed(settingsValue, 2, 5), { settingsValue: settings });
  assert.equal(report.seed.lastRate, 2);
  assert.equal(report.seed.settings.defaultMode, 'follow');
  const videoTab = await observerPage.evaluate(url => globalThis.__videoSpeedSoak.createTab(url, true), `${baseUrl}/soak?phase=continuous&nonce=${Date.now()}`);
  activeVideoTabId = videoTab.id;
  soakPage = await waitForPage(`http://127.0.0.1:${server.address().port}/soak`);
  await soakPage.waitForFunction(() => typeof window.__soakSnapshot === 'function');
  await soakPage.waitForFunction(() => { const v=document.querySelector('video'); return v?.readyState >= 2 && !v.paused && v.currentTime > 0.2; }, null, { timeout:15000 });
  await waitUntil(async () => (await observerPage.evaluate(tabId => globalThis.__videoSpeedSoak.inspect(tabId), activeVideoTabId)).isolated?.alive === true, 10000);
  pageCdp = await context.newCDPSession(soakPage);
  pageCdp.on('Tracing.dataCollected', payload => {
    for (const event of payload.value || []) {
      if (traceEvents.length < 8000) traceEvents.push(event); else traceEventOverflow++;
    }
  });
  pageCdp.on('Tracing.tracingComplete', event => { tracingComplete = event; });
  await pageCdp.send('Performance.enable');
  await pageCdp.send('Tracing.start', { categories:traceCategories, options:'record-until-full', transferMode:'ReportEvents' });
  const initial = await sample(0, 'initial');
  report.phases.push({ name:'initial-ready', at:Date.now(), tabId:activeVideoTabId, sample:initial });
  if (initial.failure) { await fail(initial.failure, initial); return; }
  let expectedRate = 2;
  const firstLess = await pressAndMeasure('<', 1.75, 'native-less-1');
  report.keyActions.push(firstLess); expectedRate = firstLess.afterRate ?? expectedRate;
  if (!firstLess.pass) { await fail('first native < did not apply 1.75x / update toast', firstLess); return; }
  const secondLess = await pressAndMeasure('<', 1.5, 'native-less-2');
  report.keyActions.push(secondLess); expectedRate = secondLess.afterRate ?? expectedRate;
  if (!secondLess.pass) { await fail('second native < did not apply 1.5x / update toast', secondLess); return; }

  let elapsed = 0;
  while (elapsed < durationSeconds && !report.firstFailure) {
    const started = Date.now();
    const extendedSoak = durationSeconds >= 180;
    const blurStart = extendedSoak ? 100 : 30;
    const blurReturn = blurStart + 13;
    const replacementSeconds = extendedSoak ? [14,60,120,180,240,280] : [14,60,80];
    if (replacementSeconds.includes(elapsed)) {
      const changed = await soakPage.evaluate(round => window.__replaceSoakVideo(round), Math.floor(elapsed / 14));
      await soakPage.waitForFunction(() => { const v=document.querySelector('video'); return v?.readyState >= 2 && !v.paused && v.currentTime > 0.1; }, null, { timeout:10000 });
      const replacement = { at:Date.now(), elapsedSeconds:elapsed, ...changed };
      report.phases.push({ name:'video-replacement', ...replacement });
      await appendFile(samplesPath, JSON.stringify({ type:'phase', ...replacement }) + '\n', 'utf8');
    }
    if (extendedSoak && elapsed >= 150 && elapsed < 210 && elapsed % 5 === 0) {
      const round = elapsed;
      const routeChange = await soakPage.evaluate(value => window.__sameUrlReplaceState(value), round);
      await soakPage.waitForFunction(value => window.__soak.routeFeedback.some(item => item.attribute === 'data-soak-route' && item.value === String(value)), round, { timeout:1500 });
      const feedbackSample = await sample(elapsed, `same-url-route-${round}`);
      const attributeFeedback = feedbackSample.renderer.recentRouteFeedback.filter(item => item.attribute === 'data-soak-route' && item.value === String(round));
      const trial = { ...routeChange, observedAt:feedbackSample.at, observedRate:feedbackSample.video?.rate,
        apiAlive:feedbackSample.api.alive, docStart:feedbackSample.renderer.docStart,
        documentStable:feedbackSample.renderer.docStart === initial.renderer.docStart,
        attributeFeedbackCount:attributeFeedback.length, attributeFeedback };
      report.spaFeedbackTrials.push(trial);
      await appendFile(samplesPath, JSON.stringify({ type:'same-url-route-feedback', ...trial }) + '\n', 'utf8');
      if (!trial.sameUrl || !trial.documentStable || !trial.apiAlive || trial.attributeFeedbackCount < 1 ||
          Math.abs((trial.observedRate ?? NaN)-expectedRate) > 0.001) {
        await fail('same-URL replaceState / attribute observer feedback did not converge', trial);
      }
    }
    if (elapsed === blurStart) {
      const tab = await observerPage.evaluate(url => globalThis.__videoSpeedSoak.createTab(url, true), baseUrl + '/idle?phase=blur');
      idleTabId = tab.id;
      report.phases.push({ name:'tab-blur-start', at:Date.now(), elapsedSeconds:elapsed, idleTabId, activeVideoTabId });
      await appendFile(samplesPath, JSON.stringify(report.phases.at(-1)) + '\n', 'utf8');
    }
    if (elapsed === blurReturn && idleTabId) {
      await observerPage.evaluate(tabId => globalThis.__videoSpeedSoak.activate(tabId), activeVideoTabId);
      await observerPage.evaluate(tabId => globalThis.__videoSpeedSoak.close(tabId), idleTabId).catch(() => {});
      report.phases.push({ name:'tab-blur-return', at:Date.now(), elapsedSeconds:elapsed, activeVideoTabId, idleTabId });
      idleTabId = null;
      await appendFile(samplesPath, JSON.stringify(report.phases.at(-1)) + '\n', 'utf8');
      const returnKey = expectedRate < 1.75 ? '>' : '<';
      const returnRate = returnKey === '>' ? 1.75 : 1.5;
      const action = await pressAndMeasure(returnKey, returnRate, `return-${returnKey === '>' ? 'greater' : 'less'}`);
      report.keyActions.push(action);
      expectedRate = action.afterRate ?? expectedRate;
      if (!action.pass) await fail(`trusted ${returnKey} after 13s inactive tab failed`, action);
    }
    if (extendedSoak && elapsed >= 30 && elapsed % 30 === 0) {
      const key = expectedRate < 1.75 ? '>' : '<';
      const desired = key === '>' ? 1.75 : 1.5;
      const action = await pressAndMeasure(key, desired, `periodic-${elapsed}-${key}`);
      report.keyActions.push(action); expectedRate = action.afterRate ?? expectedRate;
      if (!action.pass) await fail(`periodic trusted ${key} at ${elapsed}s failed`, action);
    }
    if (!extendedSoak && elapsed === 56) {
      const action = await pressAndMeasure('<', 1.5, 'mid-soak-less');
      report.keyActions.push(action); expectedRate = action.afterRate ?? expectedRate;
      if (!action.pass) await fail('mid-soak trusted < did not apply 1.5x / update toast', action);
    }
    if (!extendedSoak && elapsed === 76) {
      const action = await pressAndMeasure('>', 1.75, 'late-greater');
      report.keyActions.push(action); expectedRate = action.afterRate ?? expectedRate;
      if (!action.pass) await fail('late trusted > did not apply 1.75x / update toast', action);
    }
    if (!report.firstFailure) {
      const point = await sample(elapsed + 1, `soak-${String(elapsed + 1).padStart(2,'0')}`);
      if (point.failure) await fail(point.failure, point);
      else if (point.video?.paused || point.video?.ended) await fail('video unexpectedly paused or ended during the soak', point);
      else if (point.video && Math.abs(point.video.rate - expectedRate) > 0.001) await fail(`rate drift: expected ${expectedRate}x, got ${point.video.rate}x`, point);
      else if (point.workerHealth && (!point.workerHealth.ok || point.workerHealth.latencyMs > 2500)) await fail('background worker read reply failed or exceeded 2500ms', point);
      else if (point.renderer?.heartbeatAgeMs > 3000 || Math.abs(point.renderer?.heartbeatDriftMs || 0) > 2500) await fail('renderer heartbeat stalled or drifted over 2500ms', point);
    }
    elapsed++;
    const remaining = 1000 - (Date.now() - started);
    if (remaining > 0 && !report.firstFailure) await new Promise(resolve => setTimeout(resolve, remaining));
  }
  report.soakCompletedSeconds = elapsed;
  const heapSeries=report.cdpMetrics.map(item=>item.metrics?.JSHeapUsedSize).filter(Number.isFinite);
  const taskSeries=report.cdpMetrics.map(item=>item.metrics?.TaskDuration).filter(Number.isFinite);
  const workerLatencies=report.workerHealth.map(item=>item.latencyMs).filter(Number.isFinite).sort((a,b)=>a-b);
  const messageTotals=report.messageFrequency.map(item=>item.total).filter(Number.isFinite);
  const messageRates=report.messageFrequency.map(item=>item.perLastSecond).filter(Number.isFinite);
  report.growthSummary={
    heap:{samples:heapSeries.length,firstBytes:heapSeries[0]??null,lastBytes:heapSeries.at(-1)??null,peakBytes:heapSeries.length?Math.max(...heapSeries):null,
      deltaBytes:heapSeries.length?heapSeries.at(-1)-heapSeries[0]:null},
    taskDurationSeconds:{first:taskSeries[0]??null,last:taskSeries.at(-1)??null,delta:taskSeries.length?taskSeries.at(-1)-taskSeries[0]:null},
    workerReplyLatencyMs:{samples:workerLatencies.length,median:workerLatencies.length?workerLatencies[Math.floor(workerLatencies.length/2)]:null,
      p95:workerLatencies.length?workerLatencies[Math.min(workerLatencies.length-1,Math.floor(workerLatencies.length*.95))]:null,
      max:workerLatencies.length?Math.max(...workerLatencies):null},
    contentMessageFrequency:{firstTotal:messageTotals[0]??null,lastTotal:messageTotals.at(-1)??null,
      maxPerSecond:messageRates.length?Math.max(...messageRates):null,averagePerSecond:messageRates.length?messageRates.reduce((sum,value)=>sum+value,0)/messageRates.length:null},
  };
  if (report.firstFailure) return;
  const finalShot = path.join(outputDir, 'final.png');
  await soakPage.screenshot({ path:finalShot, fullPage:false }).catch(() => {});
  report.finalScreenshot = finalShot;
  await withTimeout(pageCdp.send('Tracing.end'), 2000, 'stop renderer trace').catch(() => {});
  await waitUntil(() => tracingComplete, 4000).catch(() => {});
  if (traceEvents.length) await writeFile(tracePath, JSON.stringify({ categories:traceCategories, overflow:traceEventOverflow, events:traceEvents }, null, 2), 'utf8');
  report.rendererTrace = { path:traceEvents.length ? tracePath : null, eventCount:traceEvents.length, overflow:traceEventOverflow };
  report.prePopupEvidencePath = prePopupPath;
  await writeFile(report.prePopupEvidencePath, JSON.stringify(report, null, 2), 'utf8');
  await checkPopupAfterSoak();
}

async function waitForPage(url) {
  const normalized = url.replace(/\/$/, '');
  const start = Date.now();
  while (Date.now() - start < 10000) {
    const page = context.pages().find(item => item.url().startsWith(normalized));
    if (page) return page;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`page did not open: ${normalized}`);
}
async function waitUntil(predicate, timeoutMs) {
  const started = Date.now();
  while (Date.now()-started < timeoutMs) {
    try { const result = await predicate(); if (result) return result; } catch {}
    await new Promise(resolve => setTimeout(resolve,50));
  }
  throw new Error(`condition was not met within ${timeoutMs}ms`);
}
async function withTimeout(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer=setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),timeoutMs); })]);
  } finally { clearTimeout(timer); }
}

async function sample(second, label) {
  const results = await Promise.allSettled([
    withTimeout(soakPage.evaluate(() => window.__soakSnapshot()), 2000, 'renderer snapshot'),
    withTimeout(observerPage.evaluate(tabId => globalThis.__videoSpeedSoak.inspect(tabId), activeVideoTabId), 4000, 'isolated API inspection'),
    withTimeout(observerPage.evaluate(tabId => globalThis.__videoSpeedSoak.health(tabId), activeVideoTabId), 3000, 'worker health request'),
    withTimeout(pageCdp.send('Performance.getMetrics').then(result => Object.fromEntries(result.metrics.map(m => [m.name,m.value]))), 2500, 'CDP performance metrics'),
  ]);
  const get = (index, fallback = null) => results[index].status === 'fulfilled' ? results[index].value : fallback;
  const renderer = get(0), inspected = get(1), workerHealth = get(2), metrics = get(3);
  const errors = results.map((item,index) => item.status === 'rejected' ? `sample component ${index}: ${String(item.reason?.message||item.reason)}` : null).filter(Boolean);
  const safeRenderer = renderer || { at:Date.now(), href:soakPage.url(), video:null, heartbeats:[], recentMedia:[], recentKeys:[], recentToast:[], recentLongTasks:[] };
  const safeInspected = inspected || { isolated:null, tabActivity:null, activeTab:null, injectionError:'inspection timed out' };
  const safeHealth = workerHealth || { ok:false, error:'worker health request timed out', latencyMs:null };
  const safeMetrics = metrics || {};
  const apiSnapshot = safeInspected.isolated?.snapshots || [];
  const apiDiagnostics = safeInspected.isolated?.diagnostics || [];
  const video = safeRenderer.video;
  const mainHeartbeatAt = safeRenderer.heartbeat?.at ?? safeRenderer.at;
  const previous = report.samples.at(-1);
  const taskDelta = previous?.metrics ? {
    taskDurationSeconds: (safeMetrics.TaskDuration || 0) - (previous.metrics.TaskDuration || 0),
    scriptDurationSeconds: (safeMetrics.ScriptDuration || 0) - (previous.metrics.ScriptDuration || 0),
    layoutCount: (safeMetrics.LayoutCount || 0) - (previous.metrics.LayoutCount || 0),
    recalcStyleCount: (safeMetrics.RecalcStyleCount || 0) - (previous.metrics.RecalcStyleCount || 0),
  } : null;
  const diagnostic = apiDiagnostics.find(item => item.id === apiSnapshot[0]?.id) || apiDiagnostics[0] || null;
  const point = { second, label, at:Date.now(), url:safeRenderer.href,
    video, toast:safeRenderer.toast, renderer:{ docStart:safeRenderer.docStart, heartbeatAgeMs:Date.now()-mainHeartbeatAt, heartbeatDriftMs:safeRenderer.heartbeat?.drift ?? 0,
      heartbeatCount:safeRenderer.heartbeatCount, mediaEventCount:safeRenderer.mediaEventCount, keyEventCount:safeRenderer.keyEventCount,
      toastMutationCount:safeRenderer.toastMutationCount, mutationCount:safeRenderer.mutationCount,
      routeFeedbackCount:safeRenderer.routeFeedbackCount, longTaskCount:safeRenderer.longTaskCount,
      recentMedia:safeRenderer.recentMedia, recentKeys:safeRenderer.recentKeys,
      recentRouteFeedback:safeRenderer.recentRouteFeedback, recentToast:safeRenderer.recentToast, recentLongTasks:safeRenderer.recentLongTasks },
    api:{present:safeInspected.isolated?.present === true, alive:safeInspected.isolated?.alive === true, enabled:safeInspected.isolated?.enabled === true,
      version:safeInspected.isolated?.version || null, targetCount:apiSnapshot.length, target:apiSnapshot[0] ? {
        id:apiSnapshot[0].id, playing:apiSnapshot[0].playing, rate:apiSnapshot[0].rate, desiredRate:apiSnapshot[0].desiredRate,
        rateStatus:apiSnapshot[0].rateStatus, rateOrigin:apiSnapshot[0].rateOrigin, rateError:apiSnapshot[0].rateError } : null,
      diagnostics:diagnostic ? {rate:diagnostic.rate,desiredRate:diagnostic.desiredRate,rateStatus:diagnostic.rateStatus,
        rateOrigin:diagnostic.rateOrigin,rateError:diagnostic.rateError,memory:diagnostic.memory,
        lastEvents:diagnostic.events?.slice(-4),bridgeLast:diagnostic.bridge?.events?.slice(-3)} : null,
      keyboardMonitor:safeInspected.isolated?.qaMonitor ? {keyCount:safeInspected.isolated.qaMonitor.keyCount||0,
        preventedCount:safeInspected.isolated.qaMonitor.preventedCount||0,stoppedCount:safeInspected.isolated.qaMonitor.stoppedCount||0,
        recentKeys:safeInspected.isolated.qaMonitor.recentKeys||[],recentPrevented:safeInspected.isolated.qaMonitor.recentPrevented||[]} : null,
      runtimeMessages:safeInspected.isolated?.qaMonitor ? {total:safeInspected.isolated.qaMonitor.messageTotal||0,
        perLastSecond:safeInspected.isolated.qaMonitor.messagesPerLastSecond||0,
        byActionLastSecond:safeInspected.isolated.qaMonitor.messagesByActionLastSecond||{},
        lastMessages:safeInspected.isolated.qaMonitor.lastMessages||[]} : null,
      injectionError:safeInspected.injectionError || null },
    tabActivity:safeInspected.tabActivity, activeTab:safeInspected.activeTab,
    workerHealth:safeHealth, metrics:safeMetrics, rendererTaskDelta:taskDelta };
  if (errors.length) point.failure = errors.join('; ');
  if (!point.api.present || !point.api.alive) point.failure ||= 'isolated content API absent or not alive';
  if (!video) point.failure ||= 'video element unavailable';
  report.samples.push(point);
  report.workerHealth.push({second, ...safeHealth});
  report.messageFrequency.push({second,total:point.api.runtimeMessages?.total??null,
    perLastSecond:point.api.runtimeMessages?.perLastSecond??null,byActionLastSecond:point.api.runtimeMessages?.byActionLastSecond||{}});
  report.cdpMetrics.push({second, taskDelta, metrics:{TaskDuration:safeMetrics.TaskDuration,ScriptDuration:safeMetrics.ScriptDuration,JSHeapUsedSize:safeMetrics.JSHeapUsedSize}});
  await appendFile(samplesPath, JSON.stringify(point) + '\n', 'utf8');
  return point;
}

async function pressAndMeasure(key, expectedRate, label) {
  const startedAt = Date.now();
  await soakPage.keyboard.press(key === '<' ? 'Shift+Comma' : 'Shift+Period');
  const keyName = key;
  let response = null;
  try {
    await soakPage.waitForFunction(({ startedAt, expectedRate, keyName }) => {
      const video = document.querySelector('video');
      const applied = window.__soak.mediaEvents.findLast(item => item.at >= startedAt && item.type === 'ratechange' && Math.abs(item.rate-expectedRate)<0.001);
      return !!video && !!applied && Math.abs(video.playbackRate - expectedRate) < 0.001;
    }, { startedAt, expectedRate, keyName:key }, { timeout:1500 });
    response = 'rate-expected';
  } catch { response = 'rate-timeout'; }
  await soakPage.waitForFunction(startedAt => window.__soak.toastMutations.some(item => item.at >= startedAt && item.text), startedAt, { timeout:800 }).catch(() => {});
  const inspected = await withTimeout(observerPage.evaluate(tabId => globalThis.__videoSpeedSoak.inspect(tabId), activeVideoTabId), 4000, 'isolated key inspection').catch(() => null);
  const renderer = await withTimeout(soakPage.evaluate(() => window.__soakSnapshot()), 2000, 'renderer key snapshot').catch(() => null);
  if (!renderer) return { label, key, expectedRate, startedAt, completedAt:Date.now(), response, pass:false, error:'renderer snapshot failed after key' };
  const monitorKeys = inspected?.isolated?.qaMonitor?.recentKeys || [];
  const actualKey = monitorKeys.findLast(item => item.at >= startedAt && item.key === keyName) || null;
  const rateEvent = renderer.recentMedia.findLast(item => item.at >= startedAt && item.type === 'ratechange') || null;
  const toastEvent = renderer.recentToast.findLast(item => item.at >= startedAt && item.text) || null;
  const state = { label, key:keyName, expectedRate, startedAt, completedAt:Date.now(), actualKey, trusted:actualKey?.trusted === true,
    rateEvent, afterRate:renderer.video?.rate ?? null, rateDelayMs:rateEvent ? rateEvent.at-startedAt : null,
    toast:renderer.toast, toastEvent, toastDelayMs:toastEvent ? toastEvent.at-startedAt : null,
    apiAlive:inspected.isolated?.alive === true, diagnosticRate:inspected.isolated?.diagnostics?.[0]?.rate ?? null,
    response, pass:actualKey?.trusted === true && Math.abs((renderer.video?.rate ?? NaN)-expectedRate)<0.001 &&
      !!rateEvent && !!toastEvent && inspected.isolated?.alive === true };
  await appendFile(samplesPath, JSON.stringify({type:'key-action',...state})+'\n','utf8');
  return state;
}

async function fail(reason, evidence) {
  if (report.firstFailure) return;
  report.firstFailure = { at:Date.now(), reason, evidence };
  await preserveFailure();
}
async function preserveFailure() {
  report.popupOpened = false;
  report.failureScreenshot = screenshotPath;
  if (pageCdp) await withTimeout(pageCdp.send('Tracing.end'), 1500, 'stop renderer trace').catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 300));
  if (traceEvents.length) await writeFile(tracePath, JSON.stringify({ categories:traceCategories, overflow:traceEventOverflow, events:traceEvents }, null, 2), 'utf8').catch(() => {});
  report.rendererTrace = { path:traceEvents.length ? tracePath : null, eventCount:traceEvents.length, overflow:traceEventOverflow };
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8').catch(() => {});
  await withTimeout(soakPage.screenshot({ path:screenshotPath, fullPage:false }), 2000, 'failure screenshot').catch(error => { report.screenshotError=String(error?.message||error); });
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8').catch(() => {});
}
async function checkPopupAfterSoak() {
  const openStartedAt = Date.now();
  let actionResult = await withTimeout(observerPage.evaluate(() => globalThis.__videoSpeedSoak.openPopup()), 3000, 'toolbar popup open').catch(error => ({mode:'action-timeout',error:String(error?.message||error)}));
  const popupUrl = `chrome-extension://${report.extensionId}/popup.html`;
  const start = Date.now(); let popupPage = null, popupTab = null;
  while (Date.now()-start < 1500) {
    popupPage = context.pages().find(page => page.url() === popupUrl) || null;
    if (popupPage) break;
    await new Promise(resolve => setTimeout(resolve,50));
  }
  if (!popupPage) {
    popupTab = await withTimeout(observerPage.evaluate(() => globalThis.__videoSpeedSoak.openPopupTab(false)), 3000, 'popup page fallback').catch(error => null);
    while (Date.now()-start < 8000) {
      popupPage = context.pages().find(page => page.url() === popupUrl) || null;
      if (popupPage) break;
      await new Promise(resolve => setTimeout(resolve,50));
    }
  }
  if (!popupPage) {
    report.popupCheck = { opened:false, headless:true, toolbarVisualAcceptance:false, validation:'headless popup-page content smoke',
      surface:popupTab ? 'fallback-extension-tab' : 'action-popup-page', tab:popupTab, elapsedMs:Date.now()-start, actionResult };
    report.firstFailure = { at:Date.now(), reason:'popup did not open after the completed soak', evidence:report.popupCheck };
    return;
  }
  try {
    await popupPage.waitForFunction(() => document.readyState === 'complete' && !!document.body, null, { timeout:5000 });
    await popupPage.waitForTimeout(400);
    report.popupCheck = { ...await popupPage.evaluate(() => ({ opened:true, readyState:document.readyState,
      target:document.querySelector('#single-target')?.textContent?.trim() || '',
      bodyEmpty:document.body.classList.contains('empty'), playbackHidden:document.querySelector('#playback')?.hidden ?? null,
      rate:document.querySelector('#current-rate')?.value || '', rateDisabled:document.querySelector('#current-rate')?.disabled ?? null })),
      headless:true, toolbarVisualAcceptance:false, validation:'headless popup-page content smoke',
      surface:popupTab ? 'fallback-extension-tab' : 'action-popup-page',
      openLatencyMs:Date.now()-openStartedAt, actionResult, fallbackTab:popupTab };
  } catch (error) {
    report.popupCheck = { opened:true, headless:true, toolbarVisualAcceptance:false, validation:'headless popup-page content smoke',
      surface:popupTab ? 'fallback-extension-tab' : 'action-popup-page', error:String(error?.message||error), tab:popupTab, actionResult };
    report.firstFailure = { at:Date.now(), reason:'popup did not become responsive', evidence:report.popupCheck };
  }
}

try {
  await main();
} catch (error) {
  fatalError = error;
  report.error = String(error?.stack || error?.message || error);
} finally {
  for (const page of context?.pages() || []) await page.close().catch(() => {});
  await context?.close().then(() => { report.cleanup.browserClosed=true; }).catch(error => { report.cleanup.error=String(error?.message||error); });
  if (server) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)).catch(() => {}); }
  if (profileRoot) {
    const resolved = await realpath(profileRoot).catch(() => path.resolve(profileRoot));
    const rel = path.relative(path.resolve(os.tmpdir()), resolved);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !path.basename(resolved).startsWith('videospeed-long-soak-')) report.cleanup.error='refused profile cleanup outside dedicated temp folder';
    else { report.cleanup.verifiedInsideOsTemp=true; await rm(resolved,{recursive:true,force:true}).then(()=>{report.cleanup.profileRemoved=true;}).catch(error=>{report.cleanup.error=String(error?.message||error);}); }
  }
  report.completedAt=Date.now();
  await writeFile(reportPath,JSON.stringify(report,null,2),'utf8').catch(()=>{});
}
const gateFailures = [];
if (fatalError || report.error) gateFailures.push('harness error');
if (report.firstFailure) gateFailures.push('report contains firstFailure');
if (!Number.isFinite(report.soakCompletedSeconds) || report.soakCompletedSeconds < durationSeconds) gateFailures.push('soak duration incomplete');
const expectedKeyActions = durationSeconds >= 180
  ? 2 + Math.floor(Math.max(0, durationSeconds - 1) / 30) + (durationSeconds > 113 ? 1 : 0)
  : 2 + (durationSeconds > 56 ? 1 : 0) + (durationSeconds > 76 ? 1 : 0);
if (report.keyActions.length < expectedKeyActions || report.keyActions.some(item => item.pass !== true)) gateFailures.push('trusted key/rate/toast checks incomplete or failed');
const expectedSpaFeedbackTrials = durationSeconds > 150
  ? Math.floor((Math.min(durationSeconds, 210) - 1 - 150) / 5) + 1
  : 0;
if (report.spaFeedbackTrials.length < expectedSpaFeedbackTrials || report.spaFeedbackTrials.some(item =>
  !item.sameUrl || !item.documentStable || !item.apiAlive || item.attributeFeedbackCount < 1 || !Number.isFinite(item.observedRate))) {
  gateFailures.push('same-URL SPA feedback checks incomplete or failed');
}
if (!report.popupCheck?.opened || report.popupCheck.bodyEmpty !== false || report.popupCheck.playbackHidden !== false ||
    report.popupCheck.rateDisabled !== false || !report.popupCheck.target || !(Number(report.popupCheck.rate) > 0)) {
  gateFailures.push('popup-page content smoke missing target or usable playback controls');
}
if (!report.cleanup.profileRemoved || !report.cleanup.browserClosed || !report.cleanup.verifiedInsideOsTemp || report.cleanup.error) {
  gateFailures.push('isolated browser/profile cleanup incomplete');
}
report.exitGate = { passed:gateFailures.length === 0, failures:gateFailures, checkedAt:Date.now() };
await writeFile(reportPath, JSON.stringify(report,null,2), 'utf8').catch(() => {});
console.log(JSON.stringify({ version:report.version, treeHash:report.treeHash, durationSeconds:report.soakCompletedSeconds,
  spaFeedbackTrials:report.spaFeedbackTrials.length,
  samples:report.samples.length, keyActions:report.keyActions.map(item=>({label:item.label,key:item.key,expected:item.expectedRate,actual:item.afterRate,rateDelayMs:item.rateDelayMs,toastDelayMs:item.toastDelayMs,pass:item.pass})),
  firstFailure:report.firstFailure, popupOpened:report.popupCheck?.opened ?? false,
  popupValidationScope:report.popupValidationScope, popupCheck:report.popupCheck,
  rendererTrace:report.rendererTrace, cleanup:report.cleanup, exitGate:report.exitGate, error:report.error },null,2));
if (gateFailures.length) process.exitCode=1;
