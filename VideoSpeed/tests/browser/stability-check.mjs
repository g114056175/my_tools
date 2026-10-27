#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const playwrightPath = process.env.VIDEOSPEED_PLAYWRIGHT?.trim();
const playwright = playwrightPath ? require(path.resolve(playwrightPath)) : require('playwright');
const { chromium } = playwright;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const extension = path.join(root, 'extension');
const media = await readFile(path.join(root, 'tests/fixtures/tiny.webm'));
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const settings = {
  enabled: true, preferredRate: 2, defaultMode: 'custom', customRate: 8,
  qualityEnabled: false, preferredQuality: 720,
  steps: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 6, 8, 10, 12],
  shortcuts: { slower: '<', faster: '>', reset: ':', preferred: '"', fineSlower: '', fineFaster: '' },
  disabledSites: [], siteModes: {},
};
const probeKey = 'videospeed.qa-070.stability.nodes';
const gateKey = 'videospeed.qa-070.stability.refresh-gate';
let context, worker, host, popup, extensionId, profileRoot;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message, timeout = 8000) {
  const started = Date.now(); let last;
  while (Date.now() - started < timeout) {
    try { const result = await predicate(); if (result) return result; } catch (error) { last = error; }
    await wait(50);
  }
  throw new Error(message + (last ? `: ${last.message}` : ''));
}

function fixture(url) {
  const id = url.searchParams.get('v') || 'qa-child';
  const isChild = url.pathname === '/embed';
  const autoplay = isChild ? '' : 'autoplay';
  const child = isChild ? '' : '<iframe id="qa-child" title="delayed refresh fixture" src="/embed?v=qa-child"></iframe>';
  return `<!doctype html><html><head><meta charset="utf-8"><title>VideoSpeed isolated YouTube fixture</title>
  <style>body{font:16px system-ui;margin:20px;background:#f3f5f8}#movie_player{position:relative;width:640px;max-width:90vw;background:#111}video{display:block;width:100%;height:360px;background:#050505}iframe{display:block;width:500px;height:280px;margin-top:12px}</style></head>
  <body><div id="movie_player"><video id="qa-video" class="html5-main-video" ${autoplay} muted loop playsinline controls src="/tiny.webm?clip=${encodeURIComponent(id)}"></video></div>${child}
  <script>(()=>{let videoId=${JSON.stringify(id)};const player=document.querySelector('#movie_player');
  window.__qa={qualitySetters:[],get videoId(){return videoId}};
  player.getVideoData=()=>({video_id:videoId,title:'Fixture '+videoId});
  player.getPlayerResponse=()=>({videoDetails:{videoId,title:'Fixture '+videoId}});
  player.getAvailableQualityLevels=()=>['hd720','hd1080'];
  player.setPlaybackQualityRange=(min,max)=>window.__qa.qualitySetters.push([min,max]);
  window.qaChangeSource=async next=>{videoId=next;history.pushState({},'', '/watch?v='+encodeURIComponent(next));
    const old=player.querySelector('video'),video=document.createElement('video');
    video.id='qa-video';video.className='html5-main-video';video.autoplay=true;video.muted=true;video.loop=true;video.playsInline=true;video.controls=true;
    video.src='/tiny.webm?clip='+encodeURIComponent(next);old.replaceWith(video);try{await video.play()}catch{}
    window.dispatchEvent(new Event('yt-navigate-finish'));return video;};
  })();</script></body></html>`;
}

async function setupLocalRoutes() {
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.protocol === 'chrome-extension:' || url.protocol === 'about:' || url.protocol === 'data:') return route.continue();
    if (url.protocol === 'http:' && url.hostname === 'www.youtube.com') {
      if (url.pathname.endsWith('/tiny.webm')) return route.fulfill({
        status: 200, contentType: 'video/webm',
        headers: { 'cache-control': 'no-store', 'access-control-allow-origin': '*' }, body: media,
      });
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', headers: { 'cache-control': 'no-store' }, body: fixture(url) });
    }
    return route.abort('blockedbyclient');
  });
}

async function chromeState() {
  return worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const win = tab ? await chrome.windows.get(tab.windowId) : null;
    return { tab, focused: win?.focused === true };
  });
}

async function assertActiveFixture() {
  const state = await chromeState();
  assert.equal(state.focused, true, 'isolated Chrome window is not focused');
  assert.ok(state.tab?.url?.startsWith('http://www.youtube.com/'), 'fixture is not Chrome tabs.active');
  return state.tab;
}

async function message(action, fields = {}) {
  const result = await popup.evaluate(({ action, fields }) => new Promise(resolve => {
    chrome.runtime.sendMessage({ scope: 'video-control', action, ...fields }, response => {
      resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : response);
    });
  }), { action, fields });
  assert.equal(result?.ok, true, `${action} failed: ${result?.error || 'no response'}`);
  return result;
}

async function pageVideoReady(id) {
  await host.waitForFunction(expected => {
    const video = document.querySelector('#qa-video');
    return video && video.readyState >= 1 && !video.paused &&
      video.getAttribute('data-video-control-ready') === 'true' &&
      video.getAttribute('data-video-control-ready-key') === 'yt:' + expected;
  }, id, { timeout: 10000 });
  await host.waitForFunction(() => Math.abs((document.querySelector('#qa-video')?.playbackRate || 1) - 8) < 0.011,
    null, { timeout: 10000 });
}

async function currentTarget() {
  const response = await message('getState');
  assert.equal(response.tabId, (await assertActiveFixture()).id, 'getState used a tab other than tabs.active');
  assert.ok(response.target, 'getState returned no target');
  assert.equal(response.target.frameId, 0, 'fixture main video was not selected');
  const video = await host.evaluate(() => ({
    id: document.querySelector('#qa-video')?.getAttribute('data-video-control-id'),
    rate: document.querySelector('#qa-video')?.playbackRate,
  }));
  assert.ok(video.id, 'main video has no registry ID');
  assert.equal(response.target.id, video.id, 'getState target does not match the main video');
  assert.ok(Math.abs(response.target.rate - 8) < 0.011 && Math.abs(video.rate - 8) < 0.011,
    `first apply/getState did not report 8×: ${JSON.stringify({ target: response.target, video })}`);
  return { ...response.target, documentId: response.target.documentId || '' };
}

async function openPopupPage() {
  const cdp = await context.newCDPSession(host);
  await cdp.send('Target.createTarget', { url: `chrome-extension://${extensionId}/popup.html`, background: true });
  await cdp.detach();
  popup = await until(() => context.pages().find(page => page.url() === `chrome-extension://${extensionId}/popup.html`), 'popup extension page did not open');
  await popup.setViewportSize({ width: 420, height: 800 });
  await popup.waitForSelector('#current-rate');
  await until(async () => (await chromeState()).tab?.url?.startsWith('http://www.youtube.com/'), 'opening popup changed tabs.active');
  await popup.evaluate(() => {
    const port = chrome.runtime.connect({ name: 'video-control-popup' });
    const state = { port, updates: 0 };
    port.onMessage.addListener(message => { if (message?.action === 'updated') state.updates++; });
    globalThis.__qaStabilityPort = state;
  });
}

async function scriptFrame(tabId, frameId, operation, args = []) {
  const rows = await popup.evaluate(async ({ tabId, frameId, operation, args }) => {
    return chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] }, world: 'ISOLATED', args: [operation, args],
      func: (operation, args) => {
        const key = args[0];
        if (operation === 'checkNodes') {
        const marker = document.querySelector('[data-video-control-media-highlight]');
        const toast = document.querySelector('#video-control-toast');
        let previous = globalThis[Symbol.for(key)];
        if (!previous) globalThis[Symbol.for(key)] = previous = { marker, toast };
        return {
          markerCount: document.querySelectorAll('[data-video-control-media-highlight]').length,
          toastCount: document.querySelectorAll('#video-control-toast').length,
          markerSame: !!marker && marker === previous.marker,
          toastSame: !!toast && toast === previous.toast,
          persistentToast: toast?.hasAttribute('data-persistent') === true,
        };
        }
        if (operation === 'installChildGate') {
        const api = globalThis[Symbol.for('video-control.api')];
        if (!api?.alive?.()) throw Error('child frame content API is unavailable');
        const original = api.refresh, gate = { started: false, release: null, holding: true };
        api.refresh = async function (...args) {
          if (gate.holding) { gate.started = true; await new Promise(resolve => { gate.release = resolve; }); }
          return Reflect.apply(original, this, args);
        };
        globalThis[Symbol.for(key)] = gate;
        return true;
        }
        if (operation === 'childGateState') {
        const release = args[1];
        const gate = globalThis[Symbol.for(key)];
        if (release && gate) { gate.holding = false; gate.release?.(); }
        return { installed: !!gate, started: !!gate?.started };
        }
        if (operation === 'disposeTop') {
        const key = Symbol.for('video-control.qa-070.active-target-events');
        let probe = globalThis[key];
        if (!probe) {
          probe = { ids: [] }; globalThis[key] = probe;
          chrome.runtime.onMessage.addListener(message => {
            if (message?.scope === 'video-control' && message.action === 'activeTarget') probe.ids.push(message.id || null);
          });
        }
        probe.ids.length = 0;
        const oldId = document.querySelector('#qa-video')?.getAttribute('data-video-control-id');
        globalThis[Symbol.for('video-control.api')]?.dispose?.();
        return { oldId, apiRemoved: !globalThis[Symbol.for('video-control.api')] };
        }
        if (operation === 'apiReady') {
        const api = globalThis[Symbol.for('video-control.api')];
        return { alive: !!api?.alive?.(), enabled: !!api?.enabled?.(), id: document.querySelector('#qa-video')?.getAttribute('data-video-control-id') };
        }
        if (operation === 'activeTargetHas') {
        const id = args[0];
        return globalThis[Symbol.for('video-control.qa-070.active-target-events')]?.ids.includes(id) === true;
        }
        throw new Error('unknown frame probe operation: ' + operation);
      },
    });
  }, { tabId, frameId, operation, args });
  if (!rows?.length || !Object.hasOwn(rows[0], 'result')) throw new Error(
    `frame probe ${operation} returned no result for tab ${tabId}/frame ${frameId}: ${JSON.stringify(rows)}`,
  );
  return rows[0].result;
}

async function checkNodes(tabId) {
  return scriptFrame(tabId, 0, 'checkNodes', [probeKey]);
}

async function childRefreshGate(tabId, frameId) {
  const installed = await scriptFrame(tabId, frameId, 'installChildGate', [gateKey]);
  assert.equal(installed, true, 'could not install isolated child refresh gate');
}

async function childGateState(tabId, frameId, release = false) {
  return scriptFrame(tabId, frameId, 'childGateState', [gateKey, release]);
}

async function run() {
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, version, 'extension build does not match package version');
  const executablePath = process.env.VIDEOSPEED_CHROMIUM?.trim() || chromium.executablePath();
  assert.ok(path.isAbsolute(executablePath), 'Chromium path must be absolute'); await stat(executablePath);
  profileRoot = await mkdtemp(path.join(os.tmpdir(), 'videospeed-stability-'));
  context = await chromium.launchPersistentContext(path.join(profileRoot, 'profile'), {
    executablePath, headless: true, viewport: { width: 1100, height: 850 },
    args: [
      `--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--disable-background-networking', '--disable-component-update', '--disable-sync',
      '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
    ],
  });
  context.setDefaultTimeout(10000);
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  extensionId = new URL(worker.url()).host;
  await setupLocalRoutes();
  await worker.evaluate(settings => chrome.storage.local.set({ settings }), settings);
  host = context.pages()[0];
  await host.goto('http://www.youtube.com/watch?v=mpa-start', { waitUntil: 'domcontentloaded' });
  await pageVideoReady('mpa-start');
  const initialTab = await assertActiveFixture();
  await openPopupPage();

  const mpa = [];
  let previous = await currentTarget();
  for (let i = 1; i <= 10; i++) {
    await host.reload({ waitUntil: 'domcontentloaded' });
    await pageVideoReady('mpa-start');
    const target = await currentTarget();
    assert.notEqual(target.id, previous.id, `MPA reload ${i} reused the previous media ID`);
    assert.notEqual(target.documentId, previous.documentId, `MPA reload ${i} reused the previous document ID`);
    mpa.push({ iteration: i, idChanged: true, documentChanged: true, rate: target.rate }); previous = target;
  }

  const spa = [];
  const spaDocument = previous.documentId;
  for (let i = 1; i <= 10; i++) {
    const id = `spa-${i}`;
    await host.evaluate(next => window.qaChangeSource(next), id);
    await pageVideoReady(id);
    const target = await currentTarget();
    assert.equal(target.documentId, spaDocument, `SPA source change ${i} replaced the document`);
    assert.equal(target.id, await host.locator('#qa-video').getAttribute('data-video-control-id'), `SPA source change ${i} returned a stale target`);
    spa.push({ iteration: i, id, rate: target.rate, documentStable: true });
  }

  const tab = await assertActiveFixture();
  const frames = await popup.evaluate(id => chrome.webNavigation.getAllFrames({ tabId: id }), tab.id);
  const child = frames.find(frame => frame.frameId > 0);
  assert.ok(child, 'fixture child frame did not load');
  const childApi = await scriptFrame(tab.id, child.frameId, 'apiReady');
  if (!childApi?.alive) {
    const diagnostic = await popup.evaluate(async ({ tabId, frameId }) => {
      const rows = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] }, world: 'ISOLATED',
        func: () => ({ href: location.href, hasApi: !!globalThis[Symbol.for('video-control.api')], apiVersion: globalThis[Symbol.for('video-control.api')]?.version || '' }),
      });
      return { rows, frames: await chrome.webNavigation.getAllFrames({ tabId }) };
    }, { tabId: tab.id, frameId: child.frameId });
    throw new Error('child frame API did not start: ' + JSON.stringify({ child, childApi, diagnostic }));
  }
  await childRefreshGate(tab.id, child.frameId);
  const delayedRead = popup.evaluate(() => new Promise(resolve => chrome.runtime.sendMessage(
    { scope: 'video-control', action: 'getState', refresh: true }, resolve,
  )));
  await until(async () => (await childGateState(tab.id, child.frameId)).started, 'child API refresh did not enter the controlled delay');
  const held = await childGateState(tab.id, child.frameId);
  assert.deepEqual(held, { installed: true, started: true }, 'child refresh did not pause at the fixture delay gate');
  await childGateState(tab.id, child.frameId, true);
  const delayedState = await delayedRead;
  assert.equal(delayedState?.ok, true, `delayed refresh failed: ${delayedState?.error || 'no response'}`);

  await message('getState');
  const baselineNodes = await until(async () => {
    await popup.evaluate(id => globalThis.__qaStabilityPort.port.postMessage({ action: 'watch', tabId: id }), tab.id);
    const nodes = await checkNodes(tab.id);
    return nodes.markerCount === 1 && nodes.toastCount === 1 && nodes.persistentToast ? nodes : null;
  }, 'popup watch did not create one persistent marker and toast');
  const updateBase = await popup.evaluate(() => globalThis.__qaStabilityPort.updates);
  const stableSamples = [];
  for (let i = 1; i <= 12; i++) {
    await host.evaluate(() => document.querySelector('#qa-video').dispatchEvent(new Event('loadedmetadata', { bubbles: true })));
    await popup.evaluate(id => globalThis.__qaStabilityPort.port.postMessage({ action: 'watch', tabId: id }), tab.id);
    await until(async () => (await popup.evaluate(() => globalThis.__qaStabilityPort.updates)) >= updateBase + i,
      `popup port did not receive report update ${i}`, 5000);
    const nodes = await checkNodes(tab.id);
    assert.deepEqual(nodes, { markerCount: 1, toastCount: 1, markerSame: true, toastSame: true, persistentToast: true },
      `marker/toast DOM node identity changed after loadedmetadata/report ${i}: ${JSON.stringify(nodes)}`);
    stableSamples.push({ iteration: i, update: updateBase + i, markerSame: true, toastSame: true });
  }

  const reinjection = await scriptFrame(tab.id, 0, 'disposeTop');
  assert.ok(reinjection.oldId && reinjection.apiRemoved, 'content dispose did not clear the current API/media identity');
  const cached = await message('cachedState');
  assert.equal(cached.target?.id, reinjection.oldId, 'dispose unexpectedly sent report[] and cleared the old background target');
  await popup.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED', files: ['content.js'] }), tab.id);
  await until(async () => {
    const api = await scriptFrame(tab.id, 0, 'apiReady');
    return api.alive && api.enabled && api.id;
  }, 'same-document content reinjection did not create a live session and new media ID');
  const nextId = (await scriptFrame(tab.id, 0, 'apiReady')).id;
  assert.notEqual(nextId, reinjection.oldId, 'reinjected Session reused the previous unique media ID');
  await until(() => scriptFrame(tab.id, 0, 'activeTargetHas', [nextId]), 'background did not resend activeTarget with the reinjected Session ID');
  await pageVideoReady('spa-10');
  const beforeNewVideo = await host.locator('#qa-video').getAttribute('data-video-control-id');
  const newSource = 'reinject-new-video';
  await host.evaluate(id => window.qaChangeSource(id), newSource);
  await pageVideoReady(newSource);
  const finalTarget = await currentTarget();
  assert.notEqual(finalTarget.id, beforeNewVideo, 'new post-reinjection video did not receive a unique ID');

  console.log(JSON.stringify({
    result: 'PASS', version, chromium: context.browser()?.version() || 'unknown', activeTabId: initialTab.id,
    gate1: { mpaReloads: mpa, spaSourceChanges: spa },
    childRefreshControl: { frameId: child.frameId, delayed: held.started, released: true },
    gate2: { updates: 12, baseline: baselineNodes, samples: stableSamples },
    gate3: { oldId: reinjection.oldId, cachedTargetRetainedWithoutReportEmpty: cached.target.id,
      reinjectedId: nextId, activeTargetResent: true, newVideoId: finalTarget.id, newVideoRate: finalTarget.rate },
    coverage: 'Local YouTube-structure fixture served from in-memory routes; controlled child refresh scheduling is a harness delay, not a real-site reproduction.',
  }, null, 2));
}

let failure;
try { await run(); } catch (error) { failure = error; console.error(error?.stack || error); }
finally {
  await context?.close().catch(() => {});
  if (profileRoot) {
    const resolved = await realpath(profileRoot).catch(() => path.resolve(profileRoot));
    const relative = path.relative(path.resolve(os.tmpdir()), resolved);
    if (!relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(resolved).startsWith('videospeed-stability-')) {
      await rm(resolved, { recursive: true, force: true }).catch(error => { failure ||= error; });
    } else failure ||= new Error('Refused to remove profile outside this run temporary directory');
  }
}
if (failure) process.exitCode = 1;
